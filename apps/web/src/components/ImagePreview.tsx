import { useEffect, useRef, useState } from 'react';
import type { RGBAImage } from '@ai-xiutu/editor';

/** Fits the actual rendered pixels without cropping, resampling the recipe or creating a stale URL. */
export function ImagePreview({ image, label }: { image: RGBAImage | null; label: string }) {
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.width = image?.width ?? 1;
    element.height = image?.height ?? 1;
    if (!image) return;
    element.getContext('2d')?.putImageData(
      new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0,
    );
  }, [image]);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const scale = image ? Math.max(.001, Math.min(size.width / image.width, size.height / image.height)) : 1;
  return <div className="rendered-image-preview" ref={area} role="img" aria-label={label}>
    <div style={{ width: image ? image.width * scale : 1, height: image ? image.height * scale : 1 }}>
      <canvas ref={canvas} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  </div>;
}
