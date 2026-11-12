import { secureUuid } from '../lib/uuid';
import type { CollageRect } from './collage-layout';

export const COLLAGE_MAX_ITEMS = 12;
export const COLLAGE_MAX_FILE_BYTES = 48 * 1024 * 1024;
export const COLLAGE_MAX_TOTAL_BYTES = 160 * 1024 * 1024;
export const COLLAGE_MAX_TOTAL_PIXELS = 96_000_000;
const MAX_FRAME_PIXELS = 32_000_000;
const MAX_ANIMATION_FRAMES = 240;
const CAMERA = 'http://ns.google.com/photos/1.0/camera/';
const ITEM = 'http://ns.google.com/photos/1.0/container/item/';
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

type AnimationTrack = { animated: boolean; frameCount: number };
type BrowserImageDecoder = {
  tracks: { ready: Promise<void>; selectedTrack: AnimationTrack | null };
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
};
type DecoderConstructor = {
  new (options: { data: ArrayBuffer; type: string }): BrowserImageDecoder;
  isTypeSupported(type: string): Promise<boolean>;
};
type Animation = {
  frame(): VideoFrame;
  advance(now: number): void;
  pause(): void;
  close(): void;
};

export type CollageMedia = {
  id: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  kind: 'photo' | 'video' | 'live' | 'animation';
  cover?: ImageBitmap;
  video?: HTMLVideoElement;
  animation?: Animation;
  dispose(): void;
};

export const collageAccept =
  'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,image/gif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.webp,.avif,.heic,.heif,.gif,.mp4,.webm,.mov';
const videoName = /\.(mp4|mov|webm)$/i;
const imageName = /\.(jpe?g|png|webp|avif|heic|heif|gif)$/i;
const isVideo = (file: File) =>
  videoName.test(file.name) || /^video\/(mp4|quicktime|webm)$/.test(file.type);
const isImage = (file: File) =>
  imageName.test(file.name) || /^image\/(jpeg|png|webp|avif|heic|heif|gif)$/.test(file.type);
const stem = (file: File) => file.name.replace(/\.[^.]+$/, '').toLocaleLowerCase();

export type MediaInput = { photo?: File; video?: File };
export function groupCollageFiles(files: File[], explicitPair: boolean): MediaInput[] {
  if (!files.length || files.some((file) => !isVideo(file) && !isImage(file)))
    throw new Error('COLLAGE_FORMAT');
  if (files.some((file) => file.size === 0 || file.size > COLLAGE_MAX_FILE_BYTES))
    throw new Error('COLLAGE_FILE_LIMIT');
  const pairs = new Map<File, File>();
  if (explicitPair) {
    const photo = files.find(isImage),
      video = files.find(isVideo);
    if (files.length !== 2 || !photo || !video) throw new Error('COLLAGE_PAIR');
    return [{ photo, video }];
  }
  const photos = files.filter(isImage),
    videos = files.filter(isVideo);
  for (const photo of photos) {
    const matches = videos.filter((video) => stem(video) === stem(photo));
    if (matches.length === 1 && photos.filter((item) => stem(item) === stem(photo)).length === 1)
      pairs.set(photo, matches[0]!);
  }
  const used = new Set(pairs.values());
  return files.flatMap<MediaInput>((file) => {
    if (isImage(file)) return [{ photo: file, video: pairs.get(file) }];
    return used.has(file) ? [] : [{ video: file }];
  });
}

async function isMp4(file: Blob) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}

/** Android Motion Photo 1.0 JPEG and the older Google MicroVideo XMP offset. */
export async function embeddedMotionPhoto(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
  if (bytes[0] !== 255 || bytes[1] !== 216) return null;
  const header = new TextDecoder().decode(bytes);
  const packets = header.match(/<(?:[\w.-]+:)?xmpmeta\b[\s\S]*?<\/(?:[\w.-]+:)?xmpmeta>/gi) ?? [];
  for (const packet of packets) {
    const doc = new DOMParser().parseFromString(packet, 'application/xml');
    if (doc.querySelector('parsererror')) continue;
    const nodes = [...doc.getElementsByTagName('*')];
    const enabled = nodes.some((node) => node.getAttributeNS(CAMERA, 'MotionPhoto') === '1');
    const item = enabled
      ? nodes.find(
          (node) =>
            node.getAttributeNS(ITEM, 'Semantic') === 'MotionPhoto' &&
            node.getAttributeNS(ITEM, 'Mime') === 'video/mp4',
        )
      : undefined;
    const legacy = nodes.find((node) => node.getAttributeNS(CAMERA, 'MicroVideo') === '1');
    const count =
      item?.getAttributeNS(ITEM, 'Length') ?? legacy?.getAttributeNS(CAMERA, 'MicroVideoOffset');
    if (!count || !/^\d{1,9}$/.test(count)) continue;
    const length = Number(count);
    const start = file.size - length;
    if (length < 16 || length > COLLAGE_MAX_FILE_BYTES || start < 4) continue;
    const motion = file.slice(start, file.size, 'video/mp4');
    if (await isMp4(motion)) return { cover: file.slice(0, start, 'image/jpeg'), motion };
  }
  return null;
}

export async function encodeMotionPhoto(cover: Blob, motion: Blob): Promise<Blob> {
  const first = new Uint8Array(await cover.slice(0, 2).arrayBuffer());
  if (first[0] !== 255 || first[1] !== 216 || !(await isMp4(motion)))
    throw new Error('COLLAGE_MOTION_EXPORT');
  const xmp = new TextEncoder().encode(
    XMP_HEADER +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description xmlns:Camera="' +
      CAMERA +
      '" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="' +
      ITEM +
      '" Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1" Camera:MotionPhotoPresentationTimestampUs="-1">' +
      '<Container:Directory><rdf:Seq>' +
      '<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li>' +
      '<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="' +
      motion.size +
      '"/></rdf:li>' +
      '</rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>',
  );
  const length = xmp.length + 2;
  return new Blob(
    [first, new Uint8Array([255, 225, length >> 8, length & 255]), xmp, cover.slice(2), motion],
    { type: 'image/jpeg' },
  );
}

function checkFrame(width: number, height: number) {
  if (!width || !height || width * height > MAX_FRAME_PIXELS || Math.max(width, height) > 8192)
    throw new Error('COLLAGE_FRAME_LIMIT');
}
async function loadVideo(file: Blob, signal: AbortSignal) {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = true;
  video.loop = true;
  const dispose = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const listeners = new AbortController();
      const timer = window.setTimeout(() => finish(new Error('COLLAGE_DECODE')), 12_000);
      const finish = (error?: Error) => {
        window.clearTimeout(timer);
        listeners.abort();
        if (error) reject(error);
        else resolve();
      };
      if (signal.aborted) return finish(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', () => finish(new DOMException('Aborted', 'AbortError')), {
        signal: listeners.signal,
      });
      video.addEventListener('error', () => finish(new Error('COLLAGE_DECODE')), {
        signal: listeners.signal,
      });
      video.addEventListener('loadeddata', () => finish(), { signal: listeners.signal });
      video.src = url;
    });
    checkFrame(video.videoWidth, video.videoHeight);
    if (!(video.duration > 0)) throw new Error('COLLAGE_DECODE');
    return { video, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

async function animationMime(file: File) {
  const header = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const gif = header[0] === 71 && header[1] === 73 && header[2] === 70;
  const tag = new TextDecoder('latin1').decode(header);
  const webp = tag.slice(8, 16) === 'WEBPVP8X' && (header[20]! & 2) !== 0;
  const png = header[0] === 137 && tag.slice(1, 4) === 'PNG' && tag.includes('acTL');
  return gif ? 'image/gif' : webp ? 'image/webp' : png ? 'image/png' : null;
}

export async function needsMotionWorkspace(file: File) {
  if (isVideo(file)) return true;
  if (!isImage(file)) return false;
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  if (isJpeg) return !!(await embeddedMotionPhoto(file));
  return !!(await animationMime(file));
}

async function loadAnimation(file: File, signal: AbortSignal): Promise<Animation | null> {
  const type = await animationMime(file);
  if (!type) return null;
  const Decoder = (globalThis as typeof globalThis & { ImageDecoder?: DecoderConstructor })
    .ImageDecoder;
  if (!Decoder || !(await Decoder.isTypeSupported(type)))
    throw new Error('COLLAGE_ANIMATION_UNAVAILABLE');
  const decoder = new Decoder({ data: await file.arrayBuffer(), type });
  try {
    await decoder.tracks.ready;
    signal.throwIfAborted();
    const track = decoder.tracks.selectedTrack;
    if (!track) throw new Error('COLLAGE_DECODE');
    if (!track.animated) {
      decoder.close();
      return null;
    }
    if (track.frameCount > MAX_ANIMATION_FRAMES) throw new Error('COLLAGE_FRAME_LIMIT');
    let frame = (await decoder.decode({ frameIndex: 0 })).image;
    try {
      checkFrame(frame.displayWidth, frame.displayHeight);
      signal.throwIfAborted();
    } catch (error) {
      frame.close();
      throw error;
    }
    let index = 0,
      nextAt = 0,
      pending = false,
      closed = false,
      decodeFailed = false;
    const delay = () => Math.max(16, (frame.duration ?? 100_000) / 1000);
    return {
      frame: () => frame,
      advance(now) {
        if (decodeFailed) throw new Error('COLLAGE_PLAY');
        if (!nextAt) nextAt = now + delay();
        if (closed || pending || now < nextAt) return;
        pending = true;
        const next = (index + 1) % track.frameCount;
        void decoder
          .decode({ frameIndex: next })
          .then(({ image }) => {
            if (closed) {
              image.close();
              return;
            }
            frame.close();
            frame = image;
            index = next;
            nextAt = performance.now() + delay();
          })
          .catch(() => {
            decodeFailed = !closed;
          })
          .finally(() => {
            pending = false;
          });
      },
      pause() {
        nextAt = 0;
      },
      close() {
        closed = true;
        frame.close();
        decoder.close();
      },
    };
  } catch (error) {
    decoder.close();
    throw error;
  }
}

export async function decodeCollageMedia(
  input: MediaInput,
  signal: AbortSignal,
): Promise<CollageMedia> {
  let cover: ImageBitmap | undefined;
  let moving: Awaited<ReturnType<typeof loadVideo>> | undefined;
  let animation: Animation | null = null;
  const dispose = () => {
    cover?.close();
    moving?.dispose();
    animation?.close();
  };
  try {
    const embedded = input.photo && !input.video ? await embeddedMotionPhoto(input.photo) : null;
    const video = input.video ?? embedded?.motion;
    if (input.photo && !video) animation = await loadAnimation(input.photo, signal);
    if (input.photo && !animation) {
      cover = await createImageBitmap(embedded?.cover ?? input.photo);
      checkFrame(cover.width, cover.height);
    }
    if (video) moving = await loadVideo(video, signal);
    signal.throwIfAborted();
    const width = cover?.width ?? animation?.frame().displayWidth ?? moving!.video.videoWidth;
    const height = cover?.height ?? animation?.frame().displayHeight ?? moving!.video.videoHeight;
    return {
      id: secureUuid(),
      name: (input.photo ?? input.video)!.name,
      bytes: (input.photo?.size ?? 0) + (input.video?.size ?? 0),
      kind: moving ? (cover ? 'live' : 'video') : animation ? 'animation' : 'photo',
      width,
      height,
      cover,
      video: moving?.video,
      animation: animation ?? undefined,
      dispose,
    };
  } catch (error) {
    dispose();
    if (error instanceof Error && error.message.startsWith('COLLAGE_')) throw error;
    if (signal.aborted) signal.throwIfAborted();
    throw new Error('COLLAGE_DECODE');
  }
}

export function collageFrame(media: CollageMedia, playing: boolean): CanvasImageSource {
  if (media.video && (playing || !media.cover) && media.video.readyState >= 2) return media.video;
  return media.cover ?? media.animation?.frame() ?? media.video!;
}

/** A paired clip can have a different encoded aspect from its still cover. */
export function drawCollageSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: CollageRect,
) {
  if (!(source instanceof HTMLVideoElement)) {
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
    return;
  }
  const scale = Math.max(rect.width / source.videoWidth, rect.height / source.videoHeight);
  const width = rect.width / scale;
  const height = rect.height / scale;
  context.drawImage(
    source,
    (source.videoWidth - width) / 2,
    (source.videoHeight - height) / 2,
    width,
    height,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
}
