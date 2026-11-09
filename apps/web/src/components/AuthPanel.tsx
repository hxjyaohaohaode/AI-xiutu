import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, LockKey, DeviceMobile, Eye, EyeSlash } from '@phosphor-icons/react';
import { api, errorMessage, jsonRequest } from '../lib/api';
import type { PublicConfig, Session } from '../lib/types';
import { Brand, Busy, IconButton, InlineError, Modal } from './Ui';
import { brandLogoUrl } from '../lib/brand';

type Mode = 'password' | 'otp' | 'register' | 'reset';
export function AuthPanel({
  config,
  onSession,
  onClose,
}: {
  config: PublicConfig | null;
  onSession: (session: Session) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setMessage('');
    setPassword('');
    setCode('');
  };
  async function sendCode() {
    if (!phone.trim()) {
      setError('请先填写手机号。');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await api<{ message: string }>(
        '/auth/otp',
        jsonRequest('POST', {
          phone: phone.trim(),
          purpose: mode === 'register' ? 'register' : mode === 'reset' ? 'reset' : 'login',
        }),
      );
      setMessage(result.message || '验证码已发送，请查看短信。');
      setCooldown(60);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'reset') {
        await api(
          '/auth/reset',
          jsonRequest('POST', { phone: phone.trim(), code: code.trim(), newPassword: password }),
        );
        switchMode('password');
        setMessage('密码已更新，请用新密码登录。');
      } else {
        const endpoint =
          mode === 'register'
            ? '/auth/register'
            : mode === 'otp'
              ? '/auth/login-otp'
              : '/auth/login';
        const body =
          mode === 'register'
            ? {
                phone: phone.trim(),
                password,
                code: code.trim(),
                displayName: displayName.trim(),
                ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
              }
            : mode === 'otp'
              ? { phone: phone.trim(), code: code.trim() }
              : { phone: phone.trim(), password };
        const session = await api<Session>(endpoint, jsonRequest('POST', body));
        onSession(session);
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const title =
    mode === 'register' ? '把灵感留在这里' : mode === 'reset' ? '找回你的账号' : '欢迎回到创作中';
  return (
    <Modal title={title} onClose={onClose}>
      <div className="auth-brand">
        <Brand name={config?.brand.name} logoUrl={brandLogoUrl(config?.brand)} compact />
        <p>保存作品，延续每一份灵感。</p>
      </div>
      {(mode === 'password' || mode === 'otp') && (
        <div className="segmented">
          <button
            className={mode === 'password' ? 'selected' : ''}
            onClick={() => switchMode('password')}
          >
            <LockKey size={17} />
            密码登录
          </button>
          <button className={mode === 'otp' ? 'selected' : ''} onClick={() => switchMode('otp')}>
            <DeviceMobile size={17} />
            验证码登录
          </button>
        </div>
      )}
      <form className="stack-form" onSubmit={submit}>
        <label>
          手机号
          <input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="请输入手机号"
            maxLength={18}
            required
          />
        </label>
        {mode === 'register' && (
          <label>
            怎么称呼你
            <input
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="你的昵称"
              maxLength={40}
              required
            />
          </label>
        )}
        {mode !== 'password' && (
          <label>
            短信验证码
            <div className="input-action">
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6 位验证码"
                maxLength={10}
                required
              />
              <button type="button" onClick={sendCode} disabled={sending || cooldown > 0}>
                {sending ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后重发` : '获取验证码'}
              </button>
            </div>
          </label>
        )}
        {mode !== 'otp' && (
          <label>
            {mode === 'reset' ? '新密码' : '密码'}
            <div className="input-action">
              <input
                type={visible ? 'text' : 'password'}
                autoComplete={mode === 'password' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'password' ? '请输入密码' : '至少 10 位字符'}
                minLength={mode === 'password' ? 1 : 10}
                maxLength={128}
                required
              />
              <IconButton
                label={visible ? '隐藏密码' : '显示密码'}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
              </IconButton>
            </div>
          </label>
        )}
        {mode === 'register' && (
          <label>
            注册邀请码 {config?.registrationMode !== 'invite' && <small>选填</small>}
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="填写收到的注册邀请码"
              autoComplete="off"
              required={config?.registrationMode === 'invite'}
              maxLength={100}
            />
          </label>
        )}
        {mode !== 'password' && config?.capabilities.smsConfigured === false && (
          <p className="form-hint">
            短信服务尚未开通，验证码暂时无法发送。已有账号可使用密码登录。
          </p>
        )}
        {message && (
          <p className="success-note" role="status">
            {message}
          </p>
        )}
        <InlineError message={error} />
        <button className="button button-primary button-full" type="submit" disabled={busy}>
          {busy ? (
            <Busy />
          ) : (
            <>
              {mode === 'register' ? '创建账号' : mode === 'reset' ? '更新密码' : '登录'}
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
      <div className="auth-links">
        {mode === 'password' || mode === 'otp' ? (
          <>
            <button onClick={() => switchMode('reset')}>忘记密码？</button>
            <button onClick={() => switchMode('register')}>
              创建新账号 <ArrowRight size={14} />
            </button>
          </>
        ) : (
          <button onClick={() => switchMode('password')}>返回登录</button>
        )}
      </div>
      <p className="fine-print">
        未登录也可以本地修图和导出。保存到项目或确认提交参考图时，照片才会上传。
      </p>
    </Modal>
  );
}
