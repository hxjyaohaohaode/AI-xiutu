import type { CSSProperties } from 'react';
import { StatusMark } from '../components/StatusMark';
import './interaction-v2.css';

const SEND = 'M12 4.5L18.5 11L14 11L14 19L10 19L10 11L5.5 11Z';
const STOP = 'M12 7L17 7L17 12L17 17L7 17L7 12L7 7Z';

/** The 240 ms same-topology morph comes from PromptBar #114. It is presentation
 * only: the parent must provide a real stop operation before a stop can appear. */
export function ComposerAction({
  state = 'send',
  label,
  title,
  disabled,
  onStop,
}: {
  state?: 'send' | 'waiting' | 'stop' | 'stopping';
  label: string;
  title?: string;
  disabled: boolean;
  onStop?: () => void;
}) {
  const stopping = (state === 'stop' || state === 'stopping') && !!onStop;
  const waiting = state === 'waiting' || ((state === 'stop' || state === 'stopping') && !onStop);
  const path = stopping ? STOP : SEND;
  return (
    <button
      className="ai-send-button ai-submit-request ai-composer-action"
      aria-label={label}
      title={title ?? label}
      type={stopping ? 'button' : 'submit'}
      disabled={disabled || waiting || state === 'stopping'}
      aria-busy={waiting || state === 'stopping' || undefined}
      data-action={stopping ? 'stop' : waiting ? 'waiting' : 'send'}
      onClick={stopping ? onStop : undefined}
    >
      {waiting ? (
        <StatusMark state="pending" />
      ) : (
        <svg
          className="ai-send-glyph"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth=".7"
          strokeLinejoin="round"
        >
          <path d={path} style={{ d: `path('${path}')` } as CSSProperties} />
        </svg>
      )}
    </button>
  );
}
