import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiResultDecision } from '@ai-xiutu/contracts';
import { api, ApiError, errorMessage, jsonRequest } from '../lib/api';
import type { AIJob } from './types';
import { decisionAttempt, type DecisionDraft, type DecisionResponse } from './decisions';
import { t } from '../i18n';

export function useResultDecisions(
  job: AIJob,
  scope: string,
  onChanged: () => void,
  workflow: {
    onBeforeArtworkWrite?: () => void | Promise<void>;
    onAfterArtworkWrite?: () => void | Promise<void>;
  } = {},
) {
  const [decisions, setDecisions] = useState<AiResultDecision[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<DecisionDraft | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const workflowRef = useRef(workflow);
  workflowRef.current = workflow;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    generation.current += 1;
    setDecisions([]);
    setError(null);
    setUncertain(null);
    setBusy(false);
    setLoading(false);
    lock.current = false;
    return () => {
      generation.current += 1;
    };
  }, [job.id, job.state, scope]);

  useEffect(() => {
    const epoch = generation.current;
    const controller = new AbortController();
    if (job.state !== 'completed') return;
    setLoading(true);
    setError((previous) => (previous?.startsWith('决定记录读取失败：') ? null : previous));
    api<{ decisions: AiResultDecision[] }>(`/ai-jobs/${job.id}/decisions`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (epoch === generation.current)
          setDecisions((previous) => {
            // A slower history read must not erase a decision acknowledged in the meantime.
            const rows = new Map(previous.map((row) => [row.id, row]));
            for (const row of value.decisions) rows.set(row.id, row);
            return [...rows.values()]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 100);
          });
      })
      .catch((failure) => {
        if (epoch === generation.current && failure.name !== 'AbortError')
          setError((previous) => previous ?? '决定记录读取失败：' + errorMessage(failure));
      })
      .finally(() => {
        if (epoch === generation.current) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [job.id, job.state, scope, refresh]);

  const decide = useCallback(
    async (draft: DecisionDraft): Promise<DecisionResponse | null> => {
      if (lock.current) return null;
      const epoch = generation.current;
      lock.current = true;
      setBusy(true);
      setError(null);
      let dispatched = false;
      let preparedArtwork = false;
      const currentWorkflow = workflowRef.current;
      try {
        if (['replace', 'layer', 'apply-plan'].includes(draft.action)) {
          await currentWorkflow.onBeforeArtworkWrite?.();
          preparedArtwork = true;
        }
        let storage: Storage | undefined;
        try {
          storage = window.sessionStorage;
        } catch {
          /* in-memory retry identity remains */
        }
        const request = decisionAttempt(scope, job.id, draft, storage);
        const init = jsonRequest('POST', request);
        dispatched = true;
        const result = await api<DecisionResponse>(`/ai-jobs/${job.id}/decisions`, init);
        if (epoch !== generation.current) return null;
        setUncertain(null);
        setDecisions((previous) => [
          result.decision,
          ...previous.filter((row) => row.id !== result.decision.id),
        ]);
        try {
          onChangedRef.current();
        } catch {
          // The acknowledged server decision stays successful even if its parent view fails to refresh.
        }
        return result;
      } catch (failure) {
        if (epoch === generation.current) {
          const ambiguous =
            dispatched &&
            (!(failure instanceof ApiError) || failure.status === 0 || failure.status >= 500);
          setUncertain(ambiguous ? draft : null);
          setError(
            ambiguous
              ? '没有收到明确答复。再次确认会沿用同一个操作标识，避免重复保存；不会重发 AI 任务。'
              : errorMessage(failure),
          );
          if (failure instanceof ApiError && failure.status === 409) {
            // Refresh project/document versions; adoption still needs a new explicit confirmation.
            try {
              onChangedRef.current();
            } catch {
              /* original conflict remains visible */
            }
          }
        }
        return null;
      } finally {
        if (preparedArtwork) {
          try {
            await currentWorkflow.onAfterArtworkWrite?.();
          } catch {
            if (epoch === generation.current)
              setError(
                (previous) =>
                  previous ?? '决定已处理，但作品刷新失败，请重新打开作品核对当前版本。',
              );
          }
        }
        if (epoch === generation.current) {
          lock.current = false;
          setBusy(false);
        }
      }
    },
    [scope, job.id],
  );
  return {
    decisions,
    busy,
    loading,
    error: error?.startsWith('决定记录读取失败：')
      ? t('决定记录读取失败：{reason}', { reason: t(error.slice('决定记录读取失败：'.length)) })
      : error
        ? t(error)
        : null,
    uncertain,
    decide,
    reload: () => setRefresh((value) => value + 1),
  };
}

export type ResultDecisionController = ReturnType<typeof useResultDecisions>;
