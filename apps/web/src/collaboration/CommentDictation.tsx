import { useEffect, useRef, useState } from 'react';
import { Microphone, Stop } from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';

type SpeechEngine = {
  processLocally: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechConstructor = {
  new (): SpeechEngine;
  available(options: { langs: string[]; processLocally: true }): Promise<string>;
};

export function CommentDictation({ onText, disabled }: { onText(text: string): void; disabled?: boolean }) {
  const locale = useLocale();
  const active = useRef(false);
  const engine = useRef<SpeechEngine | null>(null);
  const latest = useRef(onText);
  latest.current = onText;
  const [state, setState] = useState<'idle' | 'loading' | 'recording'>('idle');
  const [message, setMessage] = useState('');
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      engine.current?.abort();
      engine.current = null;
    };
  }, []);
  async function start() {
    if (engine.current || state !== 'idle') return;
    setMessage('');
    setState('loading');
    const browser = window as Window & { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor };
    const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    try {
      if (!Speech?.available) throw new Error(t('当前浏览器不支持本机语音输入。'));
      const recognition = new Speech();
      if (!('processLocally' in recognition)) throw new Error(t('当前浏览器不支持本机语音输入。'));
      recognition.processLocally = true;
      if (recognition.processLocally !== true) throw new Error(t('无法启用本机语音输入。'));
      recognition.lang = locale;
      if (await Speech.available({ langs: [locale], processLocally: true }) !== 'available')
        throw new Error(t('此语言的本机语音包暂不可用。'));
      if (!active.current) return;
      engine.current = recognition;
      recognition.onresult = ({ results }) => {
        const text = Array.from(results).map((result) => result[0]?.transcript ?? '').join(' ').trim();
        if (active.current && text) latest.current(text);
      };
      recognition.onerror = ({ error }) => {
        if (active.current && error !== 'aborted') setMessage(t('语音输入未完成，请检查麦克风或继续键入。'));
      };
      recognition.onend = () => {
        engine.current = null;
        if (active.current) setState('idle');
      };
      recognition.start();
      setState('recording');
    } catch (error) {
      engine.current = null;
      if (active.current) {
        setState('idle');
        setMessage(error instanceof Error ? error.message : t('无法开启语音输入。'));
      }
    }
  }
  const label = t(state === 'recording' ? '结束语音输入' : '语音输入');
  return (
    <>
      <button type="button" className="comment-dictation" aria-label={label} title={label}
        aria-pressed={state === 'recording'} disabled={disabled || state === 'loading'}
        onClick={() => state === 'recording' ? engine.current?.stop() : void start()}>
        {state === 'recording' ? <Stop size={16} weight="fill" /> : <Microphone size={16} />}
      </button>
      {message && <small className="comment-dictation-error" role="status">{message}</small>}
    </>
  );
}
