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
    <details className="assistant-context">
      <summary>上下文依据 · {(current.sourceTurnIds ?? []).length} 轮原文</summary>
      <p>
        用户要求逐字保留；旧助手说明可按原文引用回查。文字估算{' '}
        {current.retainedTokens + current.mandatoryTokens} tokens，另预留输出与图片{' '}
        {current.reservedTokens} tokens。
      </p>
      <p>
        已归档 {current.compactedSourceIds?.length ?? 0}{' '}
        段助手说明。图片预留值用于控制预算，实际用量以供应商回执为准。
      </p>
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
            第 {index + 1} 轮原文
          </button>
        ))}
      </div>
      {source && (
        <div className="context-source-content">
          <p>
            <strong>当时的要求</strong>
            <br />
            {source.prompt}
          </p>
          <p>
            <strong>当时的回复</strong>
            <br />
            {source.output?.text}
          </p>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
