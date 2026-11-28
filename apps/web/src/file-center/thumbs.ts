import { useEffect, useRef, useState } from 'react';
import type { Item } from './archives';
import { LIMITS } from './kinds';

/**
 * Card thumbnails, generated only for cards on screen, at most three at a time,
 * and cached for the life of the file center. Sources: downscaled images, the
 * preview image Office/ODF packages carry, the PSD's embedded thumbnail, and a
 * frame grabbed from videos. Everything else shows its type icon.
 */

const cache = new Map<string, string | null>();
let running = 0;
const queue: (() => void)[] = [];
const schedule = <T,>(job: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    const start = () => {
      running++;
      job()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < 3) start();
    else queue.push(start);
  });

async function canvasUrl(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, 360 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
  return blob ? URL.createObjectURL(blob) : null;
}

async function videoFrame(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('video'));
      setTimeout(() => reject(new Error('timeout')), 8000);
    });
    video.currentTime = Math.min(1, (video.duration || 2) / 3);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 3000);
    });
    return await canvasUrl(video, video.videoWidth, video.videoHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function makeThumb(item: Item): Promise<string | null> {
  if (item.unavailable) return null;
  if (item.kind === 'video') return item.size < 4 * 1024 ** 3 ? videoFrame(await item.blob()) : null;
  if (item.size > LIMITS.thumbBytes) return null;
  if (item.kind === 'image' || item.kind === 'heic') {
    const blob = await item.blob();
    const bitmap = await createImageBitmap(blob, { resizeWidth: 360, resizeQuality: 'medium' }).catch(() => null);
    if (!bitmap) return null;
    try {
      return await canvasUrl(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }
  if (item.kind === 'svg') return URL.createObjectURL(new Blob([await item.blob()], { type: 'image/svg+xml' }));
  if (item.kind === 'docx' || item.kind === 'pptx' || item.kind === 'odt' || item.kind === 'odp' || (item.kind === 'sheet' && /\.(xlsx|xlsm|ods)$/i.test(item.name))) {
    const { packageThumbnail } = await import('./convert');
    const thumb = await packageThumbnail(await item.blob());
    return thumb ? URL.createObjectURL(thumb) : null;
  }
  if (item.kind === 'psd' && item.size < 60 * 1024 * 1024) {
    const { readPsd } = await import('ag-psd');
    const psd = readPsd(await (await item.blob()).arrayBuffer(), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: false });
    const thumb = psd.imageResources?.thumbnail;
    return thumb ? canvasUrl(thumb, thumb.width, thumb.height) : null;
  }
  return null;
}

export function useThumb(item: Item) {
  const [url, setUrl] = useState<string | null | undefined>(cache.get(item.id));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (cache.has(item.id)) {
      setUrl(cache.get(item.id));
      return;
    }
    const el = ref.current;
    if (!el) return;
    let live = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      schedule(() => makeThumb(item))
        .catch(() => null)
        .then((value) => {
          cache.set(item.id, value);
          if (live) setUrl(value);
        });
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [item]);
  return { ref, url };
}

export function clearThumbs() {
  for (const url of cache.values()) if (url) URL.revokeObjectURL(url);
  cache.clear();
}
