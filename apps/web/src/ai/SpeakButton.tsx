import { Pause, Play, SpeakerHigh } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from '../i18n';

let cancelActiveReading: (() => void) | undefined;

export function SpeakButton({ text, active = true }: { text: string; active?: boolean }) {
  const locale = useLocale();
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const cancelReading = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelReading.current?.(), [active, text, locale]);

  if (!supported) return null;
  function toggle() {
    const speech = window.speechSynthesis;
    if (utterance.current) {
      if (paused) speech.resume();
      else speech.pause();
      setPaused(!paused);
      return;
    }
    cancelActiveReading?.();
    const next = new SpeechSynthesisUtterance(text);
    next.lang = locale;
    const language = locale.toLowerCase();
    const voices = speech.getVoices().filter((voice) => voice.localService);
    next.voice = voices.find((voice) => voice.lang.toLowerCase() === language) ??
      voices.find((voice) => voice.lang.toLowerCase().split('-')[0] === language.split('-')[0]) ?? null;
    function finish(failure: boolean) {
      if (utterance.current !== next) return;
      utterance.current = null;
      if (cancelActiveReading === cancelReading.current) cancelActiveReading = undefined;
      cancelReading.current = undefined;
      setSpeaking(false);
      setPaused(false);
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
      if (speech.paused) speech.resume();
      speech.speak(next);
    } catch {
      finish(true);
    }
  }
  return (
    <>
      <button type="button" className="text-button" disabled={!active} onClick={toggle}>
        {speaking ? paused ? <Play size={16} /> : <Pause size={16} /> : <SpeakerHigh size={16} />}
        {t(speaking ? paused ? '继续朗读' : '暂停朗读' : '朗读')}
      </button>
      {failed && <span role="status">{t('本机朗读暂不可用')}</span>}
    </>
  );
}
