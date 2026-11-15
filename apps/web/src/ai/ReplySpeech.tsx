import { SpeakerHigh } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { errorMessage } from '../lib/api';
import type { AIJob } from './types';

export interface ReplyNarration {
  model: string;
  points?: number;
  jobs: readonly AIJob[];
  start(text: string): Promise<AIJob>;
}

let playing: HTMLAudioElement | null = null;

export function ReplySpeech({ text, narration, active }: {
  text: string;
  narration: ReplyNarration;
  active: boolean;
}) {
  const [job, setJob] = useState<AIJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const latest = narration.jobs.find((item) => item.id === job?.id) ?? job;
  const completed = latest?.state === 'completed' && latest.output?.kind === 'specialist' && latest.output.audio;
  const rendering = starting || latest?.state === 'queued' || latest?.state === 'running';
  const unknown = latest?.state === 'unknown';
  useEffect(() => {
    const player = audio.current;
    if (!active) player?.pause();
    return () => {
      player?.pause();
      if (playing === player) playing = null;
    };
  }, [active, completed]);

  async function start() {
    if (!active || rendering || unknown) return;
    setStarting(true);
    setError(null);
    try { setJob(await narration.start(text)); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setStarting(false); }
  }

  if (completed && latest) return (
    <audio ref={audio} className="assistant-reply-audio" aria-label={t('播放 AI 音频')}
      src={`/v1/ai-jobs/${latest.id}/audio`} controls autoPlay={active} preload="metadata"
      onPlay={(event) => {
        if (!active) { event.currentTarget.pause(); return; }
        if (playing !== event.currentTarget) playing?.pause();
        playing = event.currentTarget;
      }} />
  );

  return (
    <>
      <button type="button" title={narration.model} aria-label={t(rendering ? '正在生成朗读' : '朗读')}
        disabled={!active || rendering || unknown}
        onClick={() => void start()}>
        <SpeakerHigh size={14} aria-hidden />
        {t(rendering ? '正在生成朗读' : '朗读')}
        {!rendering && narration.points !== undefined && <span>{t('{v0} 点', { v0: narration.points })}</span>}
      </button>
      {(error || unknown || latest?.state === 'failed') && (
        <span role="status">{error ?? t(unknown ? '朗读结果待核验' : '未能生成朗读')}</span>
      )}
    </>
  );
}
