import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ImageSquare } from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { editorialCopy } from './editorial-copy';

/** Keep the frame present through loading, errors and retries; never collapse a chapter. */
export function EditorialImage({
  name,
  alt,
  eager = false,
  className = '',
}: {
  name: string;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  return <ImageFrame src={`/about/${name}.webp`} alt={alt} eager={eager} className={className} />;
}

export function ProductImage({
  name = 'workspace',
  mobile = false,
  tablet = false,
  eager = false,
  alt,
}: {
  name?: string;
  mobile?: boolean;
  tablet?: boolean;
  eager?: boolean;
  alt?: string;
}) {
  const locale = useLocale();
  const c = editorialCopy(locale);
  return (
    <ImageFrame
      src={`/about/${name}-${locale}.webp`}
      alt={alt ?? c.deviceAlt}
      eager={eager}
      width={mobile ? 390 : tablet ? 1024 : 1440}
      height={mobile ? 844 : tablet ? 768 : 960}
      className={`experience-product-image${mobile ? ' is-phone' : tablet ? ' is-tablet' : ''}`}
    />
  );
}

function ImageFrame({
  src,
  alt,
  eager = false,
  className = '',
  width = 1536,
  height = 1024,
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
  width?: number;
  height?: number;
}) {
  const c = editorialCopy(useLocale());
  const ref = useRef<HTMLImageElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'pending' | 'ready' | 'error'>('pending');
  useEffect(() => {
    setState(ref.current?.complete && ref.current.naturalWidth ? 'ready' : 'pending');
  }, [src, attempt]);
  return (
    <div
      className={`about-image ${className}`}
      data-image-state={state}
      style={{ aspectRatio: `${width} / ${height}` }}
      aria-busy={state === 'pending'}
    >
      <img
        ref={ref}
        key={`${src}:${attempt}`}
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
      />
      {state === 'pending' && <span className="about-image-skeleton" aria-hidden="true" />}
      {state === 'error' && (
        <div className="about-image-error" role="status">
          <ImageSquare size={24} />
          <span>{c.imageFailed}</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            <ArrowClockwise size={16} />
            {c.retry}
          </button>
        </div>
      )}
    </div>
  );
}
