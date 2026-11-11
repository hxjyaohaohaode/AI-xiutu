import { t } from '../i18n';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { VoiceServerEvent } from '@ai-xiutu/contracts';
import './voice-captions.css';

type Fragment = Omit<Extract<VoiceServerEvent, { type: 'transcript' }>, 'type'>;
export type CaptionState = Partial<Record<Fragment['role'], Fragment>>;

export function appendCaption(state: CaptionState, fragment: Fragment): CaptionState {
  const previous = state[fragment.role];
  const sameItem = previous?.itemId === fragment.itemId;
  const contiguous =
    fragment.startMs === undefined ||
    previous?.endMs === undefined ||
    fragment.startMs <= previous.endMs + 1500;
  const append = fragment.delta && previous && sameItem && contiguous;
  return {
    ...state,
    [fragment.role]: {
      ...fragment,
      endMs: fragment.endMs ?? (append ? previous.endMs : undefined),
      text: (append ? previous.text + fragment.text : fragment.text).slice(-360),
    },
  };
}

export function VoiceCaptions({
  captions,
  userLabel,
  initiallyVisible = true,
  onVisibilityChange,
  status,
}: {
  captions: CaptionState;
  userLabel?: string;
  initiallyVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
  status?: string;
}) {
  const [visible, setVisible] = useState(initiallyVisible);
  const id = useId();
  const userLine = useRef<HTMLParagraphElement>(null);
  const assistantLine = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (!visible) return;
    for (const line of [userLine.current, assistantLine.current])
      if (line) line.scrollTop = line.scrollHeight;
  }, [visible, captions]);
  return (
    <div className="voice-captions">
      <button
        type="button"
        aria-controls={id}
        aria-expanded={visible}
        onClick={() => {
          setVisible(!visible);
          onVisibilityChange?.(!visible);
        }}
      >
        {visible ? t('隐藏字幕') : t('显示字幕')}
      </button>
      <div id={id} hidden={!visible} className="voice-captions-lines" aria-label={t('实时字幕')}>
        {captions.user?.text && (
          <p ref={userLine}>
            <b>{userLabel ?? t('你')}</b> {captions.user.text}
          </p>
        )}
        {captions.assistant?.text && (
          <p ref={assistantLine}>
            <b>AI</b> {captions.assistant.text}
          </p>
        )}
        {status && <p role="status">{t(status)}</p>}
        {!status && !captions.user?.text && !captions.assistant?.text && <p>{t('等待语音字幕')}</p>}
      </div>
    </div>
  );
}
