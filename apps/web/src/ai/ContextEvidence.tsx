import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';

export function ContextEvidence({
  turnId,
  live,
}: {
  turnId?: string;
  live: Record<string, any> | null;
}) {
  const [manifest, setManifest] = useState<Record<string, any> | null>(null);
  const [source, setSource] = useState<{ prompt?: string; output?: { text: string } } | null>(null);
  const [error, setError] = useState('');
  const sourceRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSource(null);
    setManifest(null);
    setError('');
    if (turnId)
      void api<{ manifest: Record<string, any> | null }>(`/assistant-turns/${turnId}/context`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setManifest(result.manifest);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(errorMessage(err));
        });
    return () => {
      controller.abort();
      sourceRequest.current?.abort();
    };
  }, [turnId]);
  const current = live ?? manifest;
  if (!current) return null;
  return (
    <MotionDetails className="assistant-context">
      <summary>
        {t('本轮依据 ·')}
        {(current.sourceTurnIds ?? []).length} {t('轮对话')}
      </summary>
      <p>{t('查看本轮引用的要求、偏好和原始对话。')}</p>
      {Boolean(current.memorySources?.length || current.resourceMemorySources?.length) && (
        <ul aria-label={t('本轮使用的记忆')}>
          {[...(current.memorySources ?? []), ...(current.resourceMemorySources ?? [])].map(
            (item) => (
              <li key={item.id}>
                {item.title} {t('· 版本')}
                {item.version}
              </li>
            ),
          )}
        </ul>
      )}
      <div className="context-source-list">
        {(current.sourceTurnIds ?? []).map((id: string, index: number) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              sourceRequest.current?.abort();
              const controller = new AbortController();
              sourceRequest.current = controller;
              setError('');
              setSource(null);
              void api<{ prompt?: string; output?: { text: string } }>(`/assistant-turns/${id}`, {
                signal: controller.signal,
              })
                .then((result) => {
                  if (!controller.signal.aborted) setSource(result);
                })
                .catch((err) => {
                  if (!controller.signal.aborted) setError(errorMessage(err));
                });
            }}
          >
            {t('第')}
            {index + 1} {t('轮原文')}
          </button>
        ))}
      </div>
      {source && (
        <div className="context-source-content">
          <p>
            <strong>{t('当时的要求')}</strong>
            <br />
            {source.prompt}
          </p>
          <p>
            <strong>{t('当时的回复')}</strong>
            <br />
            {source.output?.text}
          </p>
        </div>
      )}
      <MotionDetails className="ai-context-budget">
        <summary>{t('上下文用量估算')}</summary>
        <p>
          {t('文字')}
          {current.retainedTokens + current.mandatoryTokens} {t('tokens；输出与图片预留')}{' '}
          {current.reservedTokens} {t('tokens。已归档')}
          {current.compactedSourceIds?.length ?? 0}{' '}
          {t('段助手说明，仍可查阅原文。实际用量以供应商回执为准。')}
        </p>
      </MotionDetails>
      {error && <p role="alert">{error}</p>}
    </MotionDetails>
  );
}
