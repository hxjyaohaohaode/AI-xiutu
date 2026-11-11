import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Check, CircleHalf, Cursor, Minus } from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { aboutCopy } from './copy';
import { getSampleImage, type SampleSettings } from './sample-settings';
const DEMO_IMAGE = getSampleImage();

export function ColorStudy({ onOpen }: { onOpen: (settings: SampleSettings) => void }) {
  const figure = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const locale = useLocale();
  const c = aboutCopy(locale);
  const [split, setSplit] = useState(42);
  const [warmth, setWarmth] = useState(18);
  const [exposure, setExposure] = useState(0.1);
  const [preset, setPreset] = useState<'natural' | 'vivid' | 'soft'>('natural');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [rendered, setRendered] = useState(false);
  const worker = useRef<Worker | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ warmth, exposure, preset });
  current.current = { warmth, exposure, preset };
  const requestId = useRef(0);
  const pending = useRef(false);
  const dirty = useRef(false);
  const labelId = useId();
  const dispatch = useRef<() => void>(() => {});
  dispatch.current = () => {
    if (!worker.current || pending.current) {
      dirty.current = true;
      return;
    }
    pending.current = true;
    dirty.current = false;
    worker.current.postMessage({ id: ++requestId.current, ...current.current });
  };

  useEffect(() => {
    const target = figure.current;
    if (!target || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '360px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    let instance: Worker | null = null;
    const image = new Image();
    image.decoding = 'async';
    setReady(false);
    setFailed(false);
    setRendered(false);
    setRenderError(false);
    image.onload = () => {
      if (!live) return;
      setReady(true);
      try {
        const width = Math.min(720, image.naturalWidth);
        const height = Math.round((width * image.naturalHeight) / image.naturalWidth);
        const buffer = document.createElement('canvas');
        buffer.width = width;
        buffer.height = height;
        const context = buffer.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        instance = new Worker(new URL('./demo.worker.ts', import.meta.url), { type: 'module' });
        worker.current = instance;
        instance.onmessage = (
          event: MessageEvent<{
            id: number;
            error?: boolean;
            image?: { width: number; height: number; data: Uint8ClampedArray };
          }>,
        ) => {
          if (!live || worker.current !== instance) return;
          pending.current = false;
          if (event.data.error) setRenderError(true);
          else if (!dirty.current && event.data.image && canvas.current) {
            const output = event.data.image;
            canvas.current.width = output.width;
            canvas.current.height = output.height;
            const target = canvas.current.getContext('2d');
            if (target) {
              target.putImageData(
                new ImageData(new Uint8ClampedArray(output.data), output.width, output.height),
                0,
                0,
              );
              setRendered(true);
              setRenderError(false);
            }
          }
          if (dirty.current) dispatch.current();
        };
        instance.onerror = () => {
          if (live) {
            setRenderError(true);
            pending.current = false;
            worker.current = null;
            instance?.terminate();
          }
        };
        pending.current = true;
        instance.postMessage(
          {
            id: ++requestId.current,
            source: { width, height, data: pixels.data },
            ...current.current,
          },
          [pixels.data.buffer],
        );
      } catch {
        setRenderError(true);
      }
    };
    image.onerror = () => {
      if (live) setFailed(true);
    };
    image.src = DEMO_IMAGE;
    return () => {
      live = false;
      image.onload = null;
      image.onerror = null;
      instance?.terminate();
      if (worker.current === instance) worker.current = null;
      pending.current = false;
      dirty.current = false;
    };
  }, [attempt, visible]);
  useEffect(() => {
    if (ready) dispatch.current();
  }, [warmth, exposure, preset, ready]);
  const reset = () => {
    setWarmth(18);
    setExposure(0.1);
    setPreset('natural');
    setSplit(42);
  };

  return (
    <figure className="color-study" aria-labelledby={labelId} ref={figure} data-pointer-protect>
      <div className="study-topline">
        <span>{c.studyIndex}</span>
        <span id={labelId}>{c.study}</span>
      </div>
      <div
        className="study-picture"
        style={{ '--split': split + '%' } as CSSProperties}
        aria-busy={!ready && !failed}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse' || event.buttons !== 0 || !rendered) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          setSplit(
            Math.max(
              0,
              Math.min(100, Math.round(((event.clientX - bounds.left) / bounds.width) * 100)),
            ),
          );
        }}
      >
        <img
          src={DEMO_IMAGE}
          width="1536"
          height="1024"
          alt={c.sample}
          loading="lazy"
          decoding="async"
        />
        <canvas
          ref={canvas}
          className="study-result"
          aria-hidden="true"
          style={{ opacity: rendered ? 1 : 0 }}
        />
        {!ready && !failed && (
          <div className="study-loading" role="status">
            <span />
            {c.previewLoading}
          </div>
        )}
        {failed && (
          <div className="study-loading" role="alert">
            <span>{c.previewFailed}</span>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {c.retry}
            </button>
          </div>
        )}
        {rendered && (
          <>
            <span
              className="study-image-label study-original"
              style={{ opacity: split < 18 ? 0 : 1 }}
            >
              {c.original}
            </span>
            <span
              className="study-image-label study-edited"
              style={{ opacity: split > 82 ? 0 : 1 }}
            >
              {c.edited}
            </span>
            <span className="study-divider" aria-hidden="true">
              <span>
                <Minus size={12} />
                <CircleHalf size={18} />
                <Minus size={12} />
              </span>
            </span>
            <input
              className="study-compare"
              type="range"
              min="0"
              max="100"
              value={split}
              aria-label={c.compareLabel}
              onChange={(event) => setSplit(Number(event.currentTarget.value))}
            />
          </>
        )}
      </div>
      <figcaption>
        <span>
          <Cursor size={14} />
          {c.compare}
        </span>
        <span>{c.sample}</span>
      </figcaption>
      <div className="study-controls">
        <div className="study-presets" aria-label={c.adjust}>
          {(['natural', 'vivid', 'soft'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={preset === value}
              onClick={() => setPreset(value)}
            >
              <span className={'preset-dot preset-' + value} />
              {value === 'natural' ? c.neutral : value === 'vivid' ? c.vivid : c.soft}
              {preset === value && <Check size={12} />}
            </button>
          ))}
        </div>
        <label className="study-range">
          <span>{c.warmth}</span>
          <input
            type="range"
            min="-60"
            max="60"
            step="1"
            value={warmth}
            onChange={(event) => setWarmth(Number(event.currentTarget.value))}
          />
          <output>
            {warmth > 0 ? '+' : ''}
            {warmth}
          </output>
        </label>
        <label className="study-range exposure-range">
          <span>{c.exposure}</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.05"
            value={exposure}
            onChange={(event) => setExposure(Number(event.currentTarget.value))}
          />
          <output>
            {exposure > 0 ? '+' : ''}
            {exposure.toFixed(2)}
          </output>
        </label>
        <div className="study-footer">
          <button type="button" className="study-reset" onClick={reset}>
            {c.reset}
          </button>
          <button type="button" className="study-open" onClick={() => onOpen(current.current)}>
            {c.openSample}
            <ArrowUpRight size={15} />
          </button>
        </div>
      </div>
      {renderError && (
        <p className="study-error" role="status">
          {c.renderFailed}
        </p>
      )}
    </figure>
  );
}
