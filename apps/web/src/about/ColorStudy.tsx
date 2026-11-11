import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Check, Cursor } from '@phosphor-icons/react';
import { formatNumber, useLocale } from '../i18n';
import { aboutCopy } from './copy';
import {
  getSampleImage,
  samplePreset,
  changeSampleParameter,
  SAMPLE_PARAMETER_LIMITS,
  type SampleSettings,
  type SampleParameter,
} from './sample-settings';
import { studyCopy } from './study-copy';
import { ElasticCompare } from './ElasticCompare';
const DEMO_IMAGE = getSampleImage();
const PARAMETERS: readonly SampleParameter[] = [
  'exposure',
  'warmth',
  'contrast',
  'saturation',
  'highlights',
  'shadows',
  'vibrance',
  'clarity',
];

export function ColorStudy({ onOpen }: { onOpen: (settings: SampleSettings) => void }) {
  const figure = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const locale = useLocale();
  const c = aboutCopy(locale);
  const study = studyCopy(locale);
  const [split, setSplit] = useState(42);
  const [settings, setSettings] = useState(() => samplePreset('natural'));
  const [failed, setFailed] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [updating, setUpdating] = useState(false);
  const worker = useRef<Worker | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(settings);
  current.current = settings;
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
    setUpdating(true);
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
    setFailed(false);
    setRendered(false);
    setRenderError(false);
    image.onload = () => {
      if (!live) return;
      try {
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image unavailable');
        const scale = Math.min(
          1,
          720 / image.naturalWidth,
          Math.sqrt(400_000 / (image.naturalWidth * image.naturalHeight)),
        );
        const width = Math.max(1, Math.floor(image.naturalWidth * scale));
        const height = Math.max(1, Math.floor(image.naturalHeight * scale));
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
          if (!live || worker.current !== instance || event.data.id !== requestId.current) return;
          pending.current = false;
          // Display each newer completed frame during a drag; only the newest
          // waiting settings are dispatched next. The busy label remains until
          // those settings finish, so a fast drag does not freeze the photograph.
          if (event.data.error) {
            if (!dirty.current) setRenderError(true);
          } else if (event.data.image && canvas.current) {
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
            } else setRenderError(true);
          }
          if (dirty.current) dispatch.current();
          else setUpdating(false);
        };
        instance.onerror = () => {
          if (live) {
            setRenderError(true);
            setUpdating(false);
            pending.current = false;
            worker.current = null;
            instance?.terminate();
          }
        };
        pending.current = true;
        dirty.current = false;
        setUpdating(true);
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
        setUpdating(false);
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
    // The initial source message already includes the newest complete snapshot.
    if (worker.current) dispatch.current();
  }, [settings]);
  const reset = () => {
    setSettings(samplePreset('natural'));
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
        aria-busy={!failed && !renderError && (!rendered || updating)}
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
        {!rendered && !failed && !renderError && (
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
            <ElasticCompare
              value={split}
              onChange={setSplit}
              label={c.compareLabel}
              canvasRef={canvas}
            />
          </>
        )}
      </div>
      <figcaption>
        <span>
          <Cursor size={14} />
          {c.compare}
        </span>
        <span aria-live="off">
          {updating ? study.updating : settings.preset === 'custom' ? study.custom : c.sample}
        </span>
      </figcaption>
      <div className="study-controls">
        <div className="study-presets" role="group" aria-label={c.adjust}>
          {(['natural', 'vivid', 'soft'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={settings.preset === value}
              onClick={() => setSettings(samplePreset(value))}
            >
              <span className={'preset-dot preset-' + value} />
              {value === 'natural' ? c.neutral : value === 'vivid' ? c.vivid : c.soft}
              <Check size={12} aria-hidden style={{ opacity: settings.preset === value ? 1 : 0 }} />
            </button>
          ))}
        </div>
        <div className="study-adjustments" data-preset={settings.preset}>
          {PARAMETERS.map((key) => {
            const limits = SAMPLE_PARAMETER_LIMITS[key];
            const value = formatNumber(settings[key], {
              minimumFractionDigits: key === 'exposure' ? 2 : 0,
              maximumFractionDigits: key === 'exposure' ? 2 : 0,
              signDisplay: 'exceptZero',
            });
            const controlId = `${labelId}-${key}`;
            return (
              <label className={`study-range study-range-${key}`} key={key} htmlFor={controlId}>
                <span>{study.labels[key]}</span>
                <input
                  id={controlId}
                  type="range"
                  min={limits.min}
                  max={limits.max}
                  step={limits.step}
                  value={settings[key]}
                  aria-valuetext={key === 'exposure' ? `${value} EV` : value}
                  onChange={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    setSettings((previous) => changeSampleParameter(previous, key, next));
                  }}
                />
                <output htmlFor={controlId} aria-live="off">
                  {value}
                  {key === 'exposure' && <small> EV</small>}
                </output>
              </label>
            );
          })}
        </div>
        <div className="study-footer">
          <button type="button" className="study-reset" onClick={reset}>
            {c.reset}
          </button>
          <button type="button" className="study-open" onClick={() => onOpen(current.current)}>
            {study.open}
            <ArrowUpRight size={15} />
          </button>
        </div>
      </div>
      {renderError && (
        <p className="study-error" role="status">
          <span>{c.renderFailed}</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            {c.retry}
          </button>
        </p>
      )}
    </figure>
  );
}
