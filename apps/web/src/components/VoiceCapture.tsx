import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Microphone, Trash } from '@phosphor-icons/react';
import { voiceErrorMessage } from '../ai/voice-error';
import { LocalRecording, type LocalRecordingPhase } from '../ai/local-recording';
import VoicePill from './react-bits/VoicePill';
import { IconButton, InlineError } from './Ui';
import '../ai/interaction-v2.css';

export function VoiceCapture({
  onReady,
  active = true,
  notice = '本机录音，确认发送后识别。最多 30 秒。',
}: {
  onReady: (base64: string | null) => void;
  active?: boolean;
  notice?: string;
}) {
  const [state, setState] = useState<LocalRecordingPhase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<LocalRecording | null>(null);
  const live = useRef(true);
  const ready = useRef(onReady);
  ready.current = onReady;
  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined';
  useEffect(() => {
    live.current = true;
    const hide = () => {
      if (document.visibilityState === 'hidden') current.current?.finish();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      live.current = false;
      current.current?.cancel();
      current.current = null;
      document.removeEventListener('visibilitychange', hide);
      ready.current(null);
    };
  }, []);
  useEffect(() => {
    if (!active) current.current?.finish();
  }, [active]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  function discard() {
    current.current?.cancel();
    current.current = null;
    ready.current(null);
    setState('idle');
    setUrl(null);
    setSeconds(0);
    setStream(null);
  }
  function start() {
    if (!active || !supported) return;
    current.current?.cancel();
    setError(null);
    setUrl(null);
    setSeconds(0);
    const owner = new LocalRecording({
      phase: (phase) => {
        if (live.current && current.current === owner) setState(phase);
      },
      elapsed: (elapsed) => {
        if (live.current && current.current === owner) setSeconds(elapsed);
      },
      stream: (media) => {
        if (live.current && current.current === owner) setStream(media);
      },
      ready: (clip) => {
        if (!live.current || current.current !== owner) return;
        ready.current(clip?.base64 ?? null);
        if (clip) setUrl(URL.createObjectURL(clip.wav));
      },
      error: (failure) => {
        if (live.current && current.current === owner) setError(voiceErrorMessage(failure));
      },
    });
    current.current = owner;
    void owner.start();
  }
  const recording = state === 'recording';
  const preparing = state === 'preparing';
  return (
    <div
      className="voice-capture voice-capture-v2"
      data-motion="voice-controls"
      data-recording={recording}
      data-state={state}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && (recording || preparing) && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          discard();
        }
      }}
    >
      <div className="voice-capture-heading">
        <Microphone size={20} aria-hidden="true" />
        <strong>
          {recording ? t('正在录音') : state === 'ready' ? t('录音已就绪') : t('录制语音')}
        </strong>
      </div>
      <p className="voice-capture-consent">{t(notice)}</p>
      {!supported ? (
        <p className="form-hint">
          {t(
            '当前浏览器无法录音。请使用支持麦克风的浏览器，并通过 HTTPS 打开，也可以直接输入文字。',
          )}
        </p>
      ) : (
        <>
          <div className="recording-reference-row">
            {preparing && <span role="status">{t('正在准备录音')}</span>}
            <VoicePill size={36} reactive="external" externalStream={stream}
              background="var(--surface-hover)" accentColor="var(--accent-ink)" iconColor="var(--ink)"
              externalActive={recording || preparing} disabled={!active}
              cancelLabel={t('取消录音')} ariaLabel={recording ? t('停止录音') : state === 'ready' ? t('重新录制') : t('开始录音')}
              onStart={start} onStop={({ reason }) => {
                if (reason === 'cancel' || reason === 'escape' || reason === 'disabled' || reason === 'unmount') discard();
                else current.current?.finish();
              }} />
            {state === 'ready' && <span className="recording-time">{`0:${String(Math.floor(seconds)).padStart(2, '0')}`}</span>}
          </div>
          {url && (
            <div className="voice-playback">
              <audio controls src={url} preload="metadata" />
              <IconButton label={t('删除这段本地录音')} onClick={discard}>
                <Trash size={17} />
              </IconButton>
            </div>
          )}
        </>
      )}
      <InlineError message={error} />
    </div>
  );
}
