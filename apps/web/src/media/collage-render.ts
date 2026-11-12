import {
  collageGeometry,
  tileImageRect,
  type CollageItem,
  type CollageRect,
  type CollageScene,
} from './collage-layout';
import { collageFrame, drawCollageSource as draw, type CollageMedia } from './collage-media';

export function collageContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('COLLAGE_RENDER');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
}

function drawForeground(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  item: CollageItem,
  cell: CollageRect,
  image: CollageRect,
  scratch: HTMLCanvasElement,
  track: boolean,
) {
  const subject = item.subject;
  if (!subject) return;
  const x = cell.x + cell.width / 2,
    y = cell.y + cell.height / 2;
  context.save();
  context.translate(
    x + subject.offsetX * context.canvas.width,
    y + subject.offsetY * context.canvas.height,
  );
  context.scale(subject.scale, subject.scale);
  context.translate(-x, -y);
  const needed = Math.max(image.width, image.height) * subject.scale;
  const scratchEdge = Math.min(4096, Math.max(512, Math.ceil(needed)));
  const scale = Math.min(1, scratchEdge / Math.max(item.width, item.height));
  const width = Math.max(1, Math.round(item.width * scale));
  const height = Math.max(1, Math.round(item.height * scale));
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }
  const offset = track ? subject.track?.(source) : undefined;
  const clipped = collageContext(scratch);
  clipped.clearRect(0, 0, width, height);
  draw(clipped, source, { x: 0, y: 0, width, height });
  clipped.globalCompositeOperation = 'destination-in';
  clipped.drawImage(
    subject.matte,
    (offset?.x ?? 0) * width,
    (offset?.y ?? 0) * height,
    width,
    height,
  );
  clipped.globalCompositeOperation = 'source-over';
  draw(context, scratch, image);
  context.restore();
}

export function paintCollage(
  canvas: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
  scene: CollageScene,
  media: ReadonlyMap<string, CollageMedia>,
  edge: number,
  playing = false,
  even = false,
) {
  const geometry = collageGeometry(scene, edge, even);
  const { width, height, cells } = geometry;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = collageContext(canvas);
  context.clearRect(0, 0, width, height);
  if (scene.background !== 'transparent') {
    context.fillStyle = scene.background;
    context.fillRect(0, 0, width, height);
  }
  const placed = scene.items.flatMap((item, index) => {
    const entry = media.get(item.id);
    const cell = cells[index];
    if (!entry || !cell) return [];
    return [
      {
        item,
        cell,
        source: collageFrame(entry, playing),
        image: tileImageRect(item, cell, scene.mode !== 'layout'),
        track: !!entry.animation || (!!entry.video && (playing || !entry.cover)),
      },
    ];
  });
  for (const { item, cell, source, image } of placed) {
    if (item.subject?.only) continue;
    context.save();
    context.beginPath();
    context.rect(cell.x, cell.y, cell.width, cell.height);
    context.clip();
    draw(context, source, image);
    context.restore();
  }
  for (const { item, cell, source, image, track } of placed)
    if (item.subject) drawForeground(context, source, item, cell, image, scratch, track);
  return geometry;
}

export function collageBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob && blob.type === type ? resolve(blob) : reject(new Error('COLLAGE_RENDER'))),
      type,
      0.94,
    ),
  );
}
const mp4Types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/mp4;codecs=avc1.42E01E'];
const webmTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
export function collageRecordingType(mp4Only = false) {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof HTMLCanvasElement.prototype.captureStream !== 'function'
  )
    return undefined;
  return [...mp4Types, ...(mp4Only ? [] : webmTypes)].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

type Recording = {
  scene: CollageScene;
  media: ReadonlyMap<string, CollageMedia>;
  seconds: number;
  mp4Only: boolean;
  signal: AbortSignal;
  onProgress: (value: number) => void;
};

export async function recordCollage(options: Recording) {
  const requested = collageRecordingType(options.mp4Only);
  if (!requested) throw new Error('COLLAGE_MOTION_EXPORT');
  const fallback = options.mp4Only
    ? requested
    : (webmTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? requested);
  try {
    return await encodeCollage(options, requested, 1920);
  } catch (error) {
    options.signal.throwIfAborted();
    if (error instanceof Error && error.message === 'COLLAGE_PLAY') throw error;
    options.onProgress(0);
    return encodeCollage(options, fallback, 1280);
  }
}

async function encodeCollage(
  { scene, media, seconds, mp4Only, signal, onProgress }: Recording,
  mimeType: string,
  frameSize: number,
) {
  signal.throwIfAborted();
  const canvas = document.createElement('canvas'),
    scratch = document.createElement('canvas');
  const output = scene.background === 'transparent' ? { ...scene, background: '#ffffff' } : scene;
  paintCollage(canvas, scratch, output, media, frameSize, false, true);
  const poster = mp4Only ? await collageBlob(canvas, 'image/jpeg') : undefined;
  signal.throwIfAborted();
  const stream = canvas.captureStream(30);
  const clips = [...media.values()].filter((item) => !!item.video);
  const animations = [...media.values()].filter((item) => !!item.animation);
  try {
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    return await new Promise<{ video: Blob; poster?: Blob }>((resolve, reject) => {
      const listeners = new AbortController();
      const duration = Math.min(8, Math.max(1, seconds)) * 1000;
      let frame = 0,
        finished = false,
        lastProgress = -1;
      const end = (error?: unknown) => {
        if (finished) return;
        finished = true;
        listeners.abort();
        window.clearTimeout(watchdog);
        cancelAnimationFrame(frame);
        if (recorder.state !== 'inactive') recorder.stop();
        if (error) reject(error);
        else if (chunks.length)
          resolve({ video: new Blob(chunks, { type: mimeType.split(';')[0] }), poster });
        else reject(new Error('COLLAGE_MOTION_EXPORT'));
      };
      const watchdog = window.setTimeout(
        () => end(new Error('COLLAGE_MOTION_EXPORT')),
        duration + 6000,
      );
      signal.addEventListener('abort', () => end(new DOMException('Aborted', 'AbortError')), {
        signal: listeners.signal,
      });
      recorder.addEventListener('error', () => end(new Error('COLLAGE_MOTION_EXPORT')), {
        signal: listeners.signal,
      });
      recorder.addEventListener(
        'dataavailable',
        (event) => {
          if (event.data.size) chunks.push(event.data);
        },
        { signal: listeners.signal },
      );
      recorder.addEventListener('stop', () => end(), { signal: listeners.signal });
      void (async () => {
        for (const { video } of clips) {
          video!.muted = true;
          video!.currentTime = 0;
        }
        await Promise.all(clips.map(({ video }) => video!.play()));
        signal.throwIfAborted();
        if (finished) return;
        recorder.start(250);
        const started = performance.now();
        const tick = (now: number) => {
          try {
            animations.forEach(({ animation }) => animation!.advance(now));
            paintCollage(canvas, scratch, output, media, frameSize, true, true);
            const progress = Math.floor(100 * Math.min(1, (now - started) / duration));
            if (progress !== lastProgress) {
              lastProgress = progress;
              onProgress(progress);
            }
            if (progress >= 100) recorder.stop();
            else frame = requestAnimationFrame(tick);
          } catch (error) {
            end(error);
          }
        };
        frame = requestAnimationFrame(tick);
      })().catch((error) => end(error));
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    clips.forEach(({ video }) => video!.pause());
    animations.forEach(({ animation }) => animation!.pause());
  }
}
