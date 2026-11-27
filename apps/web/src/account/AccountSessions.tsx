import { useEffect, useRef, useState } from 'react';
import { Devices } from '@phosphor-icons/react';
import { api, ApiError, errorMessage, jsonRequest } from '../lib/api';
import { t } from '../i18n';
import { useConfirmation } from '../components/ConfirmationDialog';

export function AccountSessions({
  userId,
  onSessionExpired,
}: {
  userId: string;
  onSessionExpired?: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const current = useRef(false);
  const sessionExpired = useRef(onSessionExpired);
  sessionExpired.current = onSessionExpired;
  const confirmation = useConfirmation();
  useEffect(() => {
    const controller = new AbortController();
    current.current = true;
    setError('');
    void api<{ otherSessions: number }>('/auth/sessions', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((result) => {
        if (!controller.signal.aborted) setCount(result.otherSessions);
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
        if (failure instanceof ApiError && failure.status === 401) sessionExpired.current?.();
      });
    return () => {
      current.current = false;
      controller.abort();
    };
  }, [userId, refresh]);

  async function revoke() {
    const accepted = await confirmation.confirm({
      title: t('退出其他会话'),
      description: t('其他浏览器和设备将需要重新登录。当前会话会保留。'),
      confirmLabel: t('退出其他会话'),
    });
    if (!accepted || !current.current) return;
    setPending(true);
    setError('');
    try {
      await api('/auth/logout-others', jsonRequest('POST', { expectedUserId: userId }));
      if (current.current) setRefresh((n) => n + 1);
    } catch (failure) {
      if (current.current) {
        setError(errorMessage(failure));
        if (failure instanceof ApiError && failure.status === 401) sessionExpired.current?.();
      }
    } finally {
      if (current.current) setPending(false);
    }
  }
  return (
    <div className="account-security-row">
      <Devices size={22} aria-hidden />
      <div>
        <h4>{t('登录会话')}</h4>
        <p role="status">
          {error ||
            (count === null
              ? t('正在读取')
              : count === 0
                ? t('仅当前会话有效')
                : t('另有 {count} 个有效会话', { count }))}
        </p>
        {error ? (
          <button type="button" className="account-action" onClick={() => setRefresh((n) => n + 1)}>
            {t('重试')}
          </button>
        ) : (
          Boolean(count) && (
            <button
              type="button"
              className="account-action"
              disabled={pending}
              onClick={() => void revoke()}
            >
              {t('退出其他会话')}
            </button>
          )
        )}
      </div>
      {confirmation.dialog}
    </div>
  );
}
