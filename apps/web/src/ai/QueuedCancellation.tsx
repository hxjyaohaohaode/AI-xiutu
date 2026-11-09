import { useEffect, useRef, useState } from 'react';
import { XCircle } from '@phosphor-icons/react';
import { api, ApiError, errorMessage, jsonRequest } from '../lib/api';
import { Busy, InlineError } from '../components/Ui';
import { usePresence } from '../motion/usePresence';
import type { AIJob } from './types';

/** Cancels only an unsent queued job. The API owns permission, locking and quota release. */
export function QueuedCancellation({ job, onChanged }: { job: AIJob; onChanged: () => void }) {
  const available = job.state === 'queued' && !!job.canCancel;
  const presence = usePresence(available, 'ai-cancellation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const locked = useRef(false);
  const live = useRef(true);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  async function cancel() {
    if (locked.current || job.state !== 'queued' || !job.canCancel) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ job: AIJob; replayed: boolean; quotaReleased: boolean }>(
        `/ai-jobs/${job.id}/cancel`,
        jsonRequest('POST', { reason: '用户取消尚未执行的排队任务' }),
      );
      if (!live.current) return;
      if (result.job.state === 'cancelled' && result.quotaReleased) {
        setMessage('排队已取消，本次预占已释放。');
      } else {
        setError('任务状态已变化，请以刷新后的任务记录为准。');
      }
    } catch (failure) {
      if (!live.current) return;
      const uncertain =
        !(failure instanceof ApiError) || failure.status === 0 || failure.status >= 500;
      setError(
        uncertain
          ? '没有收到取消结果，正在刷新任务状态。系统不会重发生成请求；确认仍在排队后可再次取消。'
          : errorMessage(failure),
      );
    } finally {
      if (live.current) {
        locked.current = false;
        setBusy(false);
        // Also refresh 409s: dispatch may have won the race. Never infer a refund locally.
        changed.current();
      }
    }
  }

  if (!presence.present) return null;
  return (
    <div
      className="ai-queue-control"
      data-motion="ai-cancellation"
      data-motion-state={presence.phase}
      inert={!available}
      aria-hidden={!available}
    >
      <button
        className="text-button"
        disabled={!available || busy || !!message}
        onClick={() => void cancel()}
      >
        {busy ? <Busy label="" /> : <XCircle size={16} />}
        {busy ? '正在确认排队状态' : '取消排队'}
      </button>
      {message && (
        <p className="ai-status-copy" role="status">
          {message}
        </p>
      )}
      <InlineError message={error} />
    </div>
  );
}
