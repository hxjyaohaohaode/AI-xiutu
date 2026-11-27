import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Key } from '@phosphor-icons/react';
import { api, ApiError, errorMessage, jsonRequest } from '../lib/api';
import { t } from '../i18n';

export function AccountPasswordChange({
  userId,
  onChanged,
  onSessionExpired,
}: {
  userId: string;
  onChanged: () => void;
  onSessionExpired?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    if (newPassword !== data.get('confirmation')) {
      setMessage('两次输入的新密码不一致。');
      return;
    }
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      await api('/auth/change-password', jsonRequest('POST', {
        expectedUserId: userId, currentPassword, newPassword,
      }));
      form.reset();
      if (!mounted.current) return;
      setOpen(false);
      setMessage('密码已更新，其他设备已退出。');
      onChanged();
    } catch (error) {
      if (!mounted.current) return;
      setMessage(errorMessage(error));
      if (error instanceof ApiError && error.status === 401) onSessionExpired?.();
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="account-security-row">
      <Key size={22} aria-hidden />
      <div>
        <h4>{t('更改密码')}</h4>
        {open ? (
          <form className="account-password-form" onSubmit={save}>
            <label>{t('当前密码')}
              <input name="currentPassword" type="password" autoComplete="current-password"
                maxLength={128} required disabled={busy} />
            </label>
            <label>{t('新密码')}
              <input name="newPassword" type="password" autoComplete="new-password"
                minLength={10} maxLength={128} required disabled={busy} />
            </label>
            <label>{t('确认新密码')}
              <input name="confirmation" type="password" autoComplete="new-password"
                minLength={10} maxLength={128} required disabled={busy} />
            </label>
            <p>{t('更新后，当前浏览器保留登录，其他设备需要重新登录。')}</p>
            <div className="account-password-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                {t(busy ? '保存中' : '更新密码')}
              </button>
              <button type="button" className="text-button" disabled={busy} onClick={() => {
                setOpen(false);
                setMessage('');
              }}>
                {t('取消')}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="account-action" onClick={() => {
            setMessage('');
            setOpen(true);
          }}>
            {t('更改密码')}
          </button>
        )}
        {message && <p role="status">{t(message)}</p>}
      </div>
    </div>
  );
}
