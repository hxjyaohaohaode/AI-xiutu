import type { FileKind } from './kinds';
import { t } from '../i18n';

/**
 * Loading placeholders shaped like what is about to appear: a page of lines for
 * documents, a grid for sheets, a 16:9 stage with a rail for decks, a soft
 * block for images, numbered lines for code, a player for media and rows for
 * archives. They shimmer only when motion is allowed.
 */
export type SkeletonShape = 'page' | 'grid' | 'deck' | 'image' | 'code' | 'media' | 'list';

export function shapeFor(kind: FileKind): SkeletonShape {
  if (kind === 'docx' || kind === 'odt' || kind === 'rtf' || kind === 'markdown' || kind === 'epub' || kind === 'html' || kind === 'pdf') return 'page';
  if (kind === 'sheet') return 'grid';
  if (kind === 'pptx' || kind === 'odp') return 'deck';
  if (kind === 'image' || kind === 'svg' || kind === 'psd' || kind === 'tiff' || kind === 'heic' || kind === 'font') return 'image';
  if (kind === 'audio' || kind === 'video') return 'media';
  if (kind === 'zip' || kind === 'tar' || kind === 'gzip' || kind === 'rar') return 'list';
  return 'code';
}

const widths = [92, 78, 86, 64, 90, 72, 84, 58, 88, 70];

export function Skeleton({ shape, label = '读取中' }: { shape: SkeletonShape; label?: string }) {
  return (
    <div className={'fc-skel fc-skel-' + shape} role="status" aria-live="polite">
      <span className="fc-visually-hidden">{t(label)}</span>
      {shape === 'page' && (
        <div className="fc-skel-paper" aria-hidden>
          <i className="fc-skel-title" />
          {widths.map((w, i) => (
            <i key={i} style={{ width: `${w}%` }} className={i === 4 ? 'fc-skel-gap' : ''} />
          ))}
        </div>
      )}
      {shape === 'grid' && (
        <div className="fc-skel-sheet" aria-hidden>
          {Array.from({ length: 60 }, (_, i) => (
            <i key={i} className={i < 6 ? 'is-head' : ''} />
          ))}
        </div>
      )}
      {shape === 'deck' && (
        <div className="fc-skel-deck" aria-hidden>
          <div className="fc-skel-rail">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} />
            ))}
          </div>
          <div className="fc-skel-slide">
            <i className="fc-skel-title" />
            <i />
            <i />
          </div>
        </div>
      )}
      {shape === 'image' && <div className="fc-skel-photo" aria-hidden />}
      {shape === 'code' && (
        <div className="fc-skel-code" aria-hidden>
          {widths.concat(widths).map((w, i) => (
            <i key={i} style={{ width: `${w * 0.6}%`, marginInlineStart: `${(i % 4) * 4}%` }} />
          ))}
        </div>
      )}
      {shape === 'media' && (
        <div className="fc-skel-media" aria-hidden>
          <div className="fc-skel-screen" />
          <i />
        </div>
      )}
      {shape === 'list' && (
        <div className="fc-skel-list" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <b />
              <i style={{ width: `${widths[i]! * 0.5}%` }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
