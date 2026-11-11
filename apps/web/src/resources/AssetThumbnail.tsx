import { useState } from 'react';
import { Images } from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { resourceExperienceCopy } from './experience-copy';
import './asset-thumbnail.css';

/** A source preview only. Never substitute another photograph after a failed read. */
export function AssetThumbnail({ src, alt = '' }: { src: string | null; alt?: string }) {
  const c = resourceExperienceCopy(useLocale());
  const [result, setResult] = useState<{ src: string; state: 'ready' | 'error' } | null>(null);
  const state = !src ? 'absent' : result?.src === src ? result.state : 'loading';
  return (
    <div className="asset-thumbnail" data-state={state}>
      {src && state !== 'error' && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setResult({ src, state: 'ready' })}
          onError={() => setResult({ src, state: 'error' })}
        />
      )}
      {state === 'loading' && <span className="asset-thumbnail-loading" aria-hidden />}
      {(state === 'error' || state === 'absent') && (
        <div className="asset-thumbnail-fallback" role="img" aria-label={alt || c.previewFailed}>
          <Images size={27} aria-hidden />
          <small>{state === 'error' ? c.previewFailed : c.previewUnavailable}</small>
        </div>
      )}
    </div>
  );
}
