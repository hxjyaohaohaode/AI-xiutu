import { useEffect, useRef, useState } from 'react';
import { Microphone, Stop, Trash, Waveform } from '@phosphor-icons/react';
import { recordingToWav } from '../lib/audio';
import { errorMessage } from '../lib/api';
import { Busy, IconButton, InlineError } from './Ui';

export function VoiceCapture({ onReady }: { onReady: (base64: string | null) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'preparing' | 'ready'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const live = useRef(true);
  const ready = useRef(onReady);
  ready.current = onReady;
  const supported =
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined';
  function clearTimers() {
    if (timeout.current) clearTimeout(timeout.current);
    if (interval.current) clearInterval(interval.current);
    timeout.current = null;
    interval.current = null;
  }
  function stop() {
    clearTimers();
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimers();
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state === 'recording') recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      ready.current(null);
    };
  }, []);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function start() {
    setError(null);
    setState('preparing');
    ready.current(null);
    setUrl(null);
    chunks.current = [];
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: false,
      });
      if (!live.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const instance = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = instance;
      let totalBytes = 0;
      instance.ondataavailable = (event) => {
        totalBytes += event.data.size;
        if (totalBytes > 6 * 1024 * 1024) {
          setError('录音过大，已停止。请重新录制较短的内容。');
          stop();
          return;
        }
        if (event.data.size) chunks.current.push(event.data);
      };
      instance.onerror = () => {
        stop();
        if (live.current) {
          setError('麦克风录制中断，请重新录制。');
          setState('idle');
        }
      };
      instance.onstop = async () => {
        clearTimers();
        media.getTracks().forEach((track) => track.stop());
        if (!live.current) return;
        setState('preparing');
        try {
          if (totalBytes > 6 * 1024 * 1024) throw new Error('录音过大，请重新录制。');
          const result = await recordingToWav(
            new Blob(chunks.current, { type: instance.mimeType }),
          );
          if (!live.current) return;
          setSeconds(result.seconds);
          setUrl(URL.createObjectURL(result.wav));
          ready.current(result.base64);
          setState('ready');
        } catch (e) {
          if (live.current) {
            setError(errorMessage(e));
            setState('idle');
          }
        }
      };
      instance.start(500);
      setSeconds(0);
      setState('recording');
      const started = Date.now();
      interval.current = setInterval(
        () => setSeconds(Math.min(30, (Date.now() - started) / 1000)),
        200,
      );
      timeout.current = setTimeout(stop, 30_000);
    } catch (e) {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (live.current) {
        setState('idle');
        setError(
          (e as Error).name === 'NotAllowedError'
            ? '麦克风权限未获允许。可以在浏览器设置中允许，或直接输入文字。'
            : errorMessage(e),
        );
      }
    }
  }
  return (
    <div
      className="voice-capture"
      data-motion="voice-controls"
      data-recording={state === 'recording'}
    >
      <div className={`voice-orb ${state}`}>
        <Waveform size={32} weight="light" />
      </div>
      <strong>
        {state === 'recording'
          ? '正在录音'
          : state === 'ready'
            ? '录音已就绪'
            : '录制语音'}
      </strong>
      <p>最多 30 秒。录音先保留在本机，点击下方发送后才进行语音识别。</p>
      {!supported ? (
        <p className="form-hint">
          当前浏览器无法录音。请使用支持麦克风的浏览器，并通过 HTTPS 打开，也可以直接输入文字。
        </p>
      ) : (
        <>
          <span className="recording-time">
            {Math.floor(seconds).toString().padStart(2, '0')} / 30 秒
          </span>
          {state === 'preparing' ? (
            <Busy label="正在准备录音" />
          ) : state === 'recording' ? (
            <button className="button button-recording" onClick={stop}>
              <Stop size={18} weight="fill" />
              停止录音
            </button>
          ) : (
            <button className="button button-secondary" onClick={() => void start()}>
              <Microphone size={18} />
              {state === 'ready' ? '重新录制' : '开始录音'}
            </button>
          )}
          {url && (
            <div className="voice-playback">
              <audio controls src={url} preload="metadata" />
              <IconButton
                label="删除这段本地录音"
                onClick={() => {
                  setUrl(null);
                  ready.current(null);
                  setState('idle');
                  setSeconds(0);
                }}
              >
                <Trash size={18} />
              </IconButton>
            </div>
          )}
        </>
      )}
      <InlineError message={error} />
    </div>
  );
}
