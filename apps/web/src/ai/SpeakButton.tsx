import { SpeakerHigh, Stop } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from '../i18n';

let cancelActiveReading: (() => void) | undefined;

export function SpeakButton({ text, active = true }: { text: string; active?: boolean }) {
  const locale = useLocale();
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [failed, setFailed] = useState(false);
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const cancelReading = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelReading.current?.(), [active, text, locale]);

  if (!supported) return null;
  function toggle() {
    const speech = window.speechSynthesis;
    if (utterance.current) {
      cancelReading.current?.();
      return;
    }
    cancelActiveReading?.();
    const next = new SpeechSynthesisUtterance(text);
    next.lang = locale;
    function finish(failure: boolean) {
      if (utterance.current !== next) return;
      utterance.current = null;
      if (cancelActiveReading === cancelReading.current) cancelActiveReading = undefined;
      cancelReading.current = undefined;
      setSpeaking(false);
      setFailed(failure);
    }
    next.onend = () => finish(false);
    next.onerror = (event) => finish(!['canceled', 'interrupted'].includes(event.error));
    utterance.current = next;
    cancelActiveReading = cancelReading.current = () => {
      next.onend = next.onerror = null;
      finish(false);
      speech.cancel();
    };
    setSpeaking(true);
    setFailed(false);
    try {
      speech.speak(next);
    } catch {
      finish(true);
    }
  }
  return (
    <>
      <button type="button" className="text-button" disabled={!active} onClick={toggle}>
        {speaking ? <Stop size={16} /> : <SpeakerHigh size={16} />}
        {t(speaking ? '停止朗读' : '朗读')}
      </button>
      {failed && <span role="status">{t('本机朗读暂不可用')}</span>}
    </>
  );
}
