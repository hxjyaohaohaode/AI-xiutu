import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  CheckCircle,
  DeviceMobile,
  Eye,
  EyeSlash,
  LockKey,
} from '@phosphor-icons/react';
import { api, errorMessage, jsonRequest } from '../lib/api';
import type { PublicConfig, Session } from '../lib/types';
import { Busy, DialogMotionContext, IconButton, InlineError } from './Ui';
import { AccountPageFrame } from '../account/AccountPageFrame';
import { accountPageCopy } from '../account/page-copy';
import { MotionDisclosure, MotionSwitch } from '../motion/Presence';
import { t, useLocale } from '../i18n';
import {
  AuthCooldowns,
  AuthOperations,
  authFailure,
  authFieldForFailure,
  authFailureConsumedCode,
  authPayload,
  authResultUncertain,
  emptyAuthFields,
  maskedAuthPhone,
  normalizedAuthPhone,
  isAuthSession,
  isAuthOtpReceipt,
  retryAfterSeconds,
  validateAuthField,
  validateAuthFields,
  withAuthDeadline,
  type AuthField,
  type AuthFieldErrors,
  type AuthMode,
  type AuthOperation,
  type AuthSessionMeta,
} from '../account/auth-model';

export type { AuthMode, AuthSessionMeta } from '../account/auth-model';

function AuthStage({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stage = element.current;
      // A user or autofill may already have reached the incoming form before
      // its scheduled focus. Never move focus out of the field they now own.
      if (!stage || stage.contains(document.activeElement)) return;
      const target = stage.querySelector<HTMLElement>('[data-auth-initial]');
      if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={element}>{children}</div>;
}

export function AuthPanel({
  config,
  onSession,
  onClose,
  initialMode = 'password',
  onReset,
  cooldowns: sharedCooldowns,
  onHome,
  onModeChange,
  onRegisterExitGuard,
  backToAbout = false,
}: {
  config: PublicConfig | null;
  onSession: (session: Session, meta?: AuthSessionMeta) => void;
  onClose: () => void;
  initialMode?: AuthMode;
  onReset?: () => void;
  /** App may retain only deadlines across dialog mounts; credentials stay inside this form. */
  cooldowns?: AuthCooldowns;
  onHome?: () => void;
  onModeChange?: (mode: AuthMode) => void;
  onRegisterExitGuard?: (guard: (() => boolean) | null) => void;
  backToAbout?: boolean;
}) {
  const c = accountPageCopy(useLocale());
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [registerStep, setRegisterStep] = useState<'phone' | 'details'>('phone');
  const [fields, setFields] = useState(emptyAuthFields);
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const touched = useRef(new Set<AuthField>());
  const [visible, setVisible] = useState(false);
  const [activeKind, setActiveKind] = useState<AuthOperation['kind'] | null>(null);
  const [clock, setClock] = useState(Date.now);
  const [fallbackCooldowns] = useState(() => new AuthCooldowns());
  const cooldowns = sharedCooldowns ?? fallbackCooldowns;
  const [operations] = useState(() => new AuthOperations());
  const accepted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [smsState, setSmsState] = useState<'idle' | 'sent' | 'unknown'>('idle');
  const [smsExpiresIn, setSmsExpiresIn] = useState(600);
  const [resetDone, setResetDone] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [recoveredSession, setRecoveredSession] = useState<Session | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [inviteExpanded, setInviteExpanded] = useState(false);
  const phoneInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const dialogMotion = useContext(DialogMotionContext);
  const busy = activeKind !== null;
  const smsUnavailable = config?.capabilities.smsConfigured === false;
  const inviteRequired = config?.registrationMode === 'invite';
  const phone = normalizedAuthPhone(fields.phone);
  const smsCooldown = cooldowns.remaining(fields.phone, clock);
  const submitCooldown = cooldowns.remaining(fields.phone, clock, 'submit');
  const isRegisterPhone = mode === 'register' && registerStep === 'phone';
  const resumeRegistration = isRegisterPhone && smsState !== 'idle';

  useEffect(() => {
    onRegisterExitGuard?.(() => accepted.current || !operations.busy);
    return () => onRegisterExitGuard?.(null);
  }, [operations, onRegisterExitGuard]);

  useEffect(() => {
    if (dialogMotion?.open !== false) operations.mount();
    else {
      operations.unmount();
      setActiveKind(null);
      // An external owner may close and reopen before this subtree unmounts.
      // Abort cancels observation, not a request already received by the API.
      if (activeKind === 'submit') {
        setUncertain(true);
        setFields((current) => ({ ...current, password: '', code: '' }));
        setVisible(false);
      } else if (activeKind === 'sms') {
        setSmsState('unknown');
        setCooldown(60);
      }
    }
    return () => operations.unmount();
  }, [operations, dialogMotion?.open]);
  useEffect(() => {
    if (!smsCooldown && !submitCooldown) return;
    const update = () => setClock(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [smsCooldown > 0, submitCooldown > 0]);

  function switchMode(next: AuthMode) {
    if (operations.busy || accepted.current) return;
    if (next === mode && !resetDone && !uncertain) return;
    setDirection(next === 'password' ? 'back' : 'forward');
    setMode(next);
    setRegisterStep('phone');
    setError(null);
    setErrors({});
    touched.current.clear();
    setSmsState('idle');
    setFields((current) => ({ ...current, password: '', code: '' }));
    setVisible(false);
    setResetDone(false);
    setUncertain(false);
    setRecoveredSession(null);
    setRecoveryMessage('');
    setClock(Date.now());
    onModeChange?.(next);
  }
  function updateField(field: AuthField, value: string) {
    const next = { ...fields, [field]: value };
    if (field === 'phone' && normalizedAuthPhone(value) !== phone) {
      next.code = '';
      setSmsState('idle');
      setClock(Date.now());
    }
    setFields(next);
    if (touched.current.has(field))
      setErrors((previous) => ({
        ...previous,
        [field]: validateAuthField(field, next, mode, inviteRequired),
      }));
  }
  function blurField(field: AuthField, nextFocus: EventTarget | null) {
    // A validation row can move the action between pointer down and click.
    // Buttons validate the fields they need, and navigation can leave the form directly.
    if (nextFocus === null || (nextFocus instanceof Element && nextFocus.closest('button'))) return;
    touched.current.add(field);
    setErrors((previous) => ({
      ...previous,
      [field]: validateAuthField(field, fields, mode, inviteRequired),
    }));
  }
  function showErrors(next: AuthFieldErrors) {
    setErrors(next);
    for (const field of Object.keys(next) as AuthField[]) touched.current.add(field);
    requestAnimationFrame(() => {
      const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (invalid?.isConnected && !invalid.closest('[inert]')) invalid.focus();
    });
  }
  function setCooldown(seconds: number, scope: 'sms' | 'submit' = 'sms') {
    const now = Date.now();
    cooldowns.set(fields.phone, seconds, now, scope);
    setClock(now);
  }
  function finish(operation: AuthOperation) {
    if (operations.finish(operation)) setActiveKind(null);
  }
  function acceptSession(next: Session, meta: AuthSessionMeta) {
    if (accepted.current || !next.user) return;
    accepted.current = true;
    setFields(emptyAuthFields());
    onSession(next, meta);
    onClose();
  }

  async function sendCode() {
    if (operations.busy || smsUnavailable || cooldowns.remaining(fields.phone, Date.now())) return;
    const validation = validateAuthField('phone', fields, mode, inviteRequired);
    if (validation) return showErrors({ phone: validation });
    const operation = operations.begin('sms');
    if (!operation) return;
    const purpose = mode === 'register' ? 'register' : mode === 'reset' ? 'reset' : 'login';
    setActiveKind('sms');
    setError(null);
    setSmsState('idle');
    setFields((current) => ({ ...current, code: '' }));
    setErrors((current) => ({ ...current, code: undefined }));
    try {
      const receipt = await withAuthDeadline(operation, (signal) =>
        api<unknown>('/auth/otp', {
          ...jsonRequest('POST', { phone, purpose }),
          signal,
        }),
      );
      if (!operations.owns(operation)) return;
      if (!isAuthOtpReceipt(receipt)) throw new SyntaxError('短信回执不完整');
      setCooldown(60);
      setSmsExpiresIn(receipt.expiresIn);
      setSmsState('sent');
      if (mode === 'register') {
        setDirection('forward');
        setRegisterStep('details');
      }
    } catch (failure) {
      if (!operations.owns(operation)) return;
      const retry = retryAfterSeconds(failure);
      if (retry !== null) setCooldown(retry);
      const failureCode = String(authFailure(failure).code);
      const unknown = failureCode === 'SMS_SEND_UNKNOWN' || authResultUncertain(failure);
      if (unknown && !['SMS_NOT_CONFIGURED', 'SMS_UNAVAILABLE'].includes(failureCode)) {
        setCooldown(retry ?? 60);
        setSmsState('unknown');
        if (mode === 'register') {
          setDirection('forward');
          setRegisterStep('details');
        }
      } else setError(errorMessage(failure));
    } finally {
      finish(operation);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (operations.busy || uncertain || accepted.current) return;
    if (isRegisterPhone) {
      if (resumeRegistration) continueRegistration();
      else await sendCode();
      return;
    }
    if (cooldowns.remaining(fields.phone, Date.now(), 'submit')) return;
    const validation = validateAuthFields(fields, mode, inviteRequired);
    if (Object.keys(validation).length) return showErrors(validation);
    const operation = operations.begin('submit');
    if (!operation) return;
    setActiveKind('submit');
    setError(null);
    setErrors({});
    try {
      const endpoint = mode === 'password' ? 'login' : mode === 'otp' ? 'login-otp' : mode;
      const result = await withAuthDeadline(operation, (signal) =>
        api<Session | { ok: true }>(`/auth/${endpoint}`, {
          ...jsonRequest('POST', authPayload(fields, mode)),
          signal,
        }),
      );
      if (!operations.owns(operation)) return;
      if (mode === 'reset') {
        if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true)
          throw new SyntaxError('重置回执不完整');
        setFields((current) => ({ ...current, password: '', code: '' }));
        setVisible(false);
        setResetDone(true);
        setDirection('forward');
        onReset?.();
      } else {
        if (!isAuthSession(result) || !result.user) throw new SyntaxError('登录回执不完整');
        acceptSession(result, { method: mode });
      }
    } catch (failure) {
      if (!operations.owns(operation)) return;
      const retry = retryAfterSeconds(failure);
      if (retry !== null) setCooldown(retry, 'submit');
      if (authResultUncertain(failure)) {
        setUncertain(true);
        setError(null);
        setFields((current) => ({ ...current, password: '', code: '' }));
        setVisible(false);
      } else {
        const field = authFieldForFailure(failure);
        if (field) showErrors({ [field]: errorMessage(failure) });
        else setError(errorMessage(failure));
        if (authFailureConsumedCode(mode, failure)) {
          setFields((current) => ({ ...current, code: '' }));
          setErrors((current) => ({ ...current, code: '本次验证码已使用，请重新获取。' }));
          setSmsState('idle');
        }
      }
    } finally {
      finish(operation);
    }
  }

  async function checkSession() {
    const operation = operations.begin('session');
    if (!operation) return;
    setActiveKind('session');
    setError(null);
    setRecoveredSession(null);
    setRecoveryMessage('');
    try {
      const current = await withAuthDeadline(operation, (signal) =>
        api<Session>('/session', { signal }),
      );
      if (!operations.owns(operation)) return;
      if (!isAuthSession(current)) throw new Error('暂时无法确认登录状态，请稍后重试。');
      if (current.user) setRecoveredSession(current);
      else
        setRecoveryMessage(
          mode === 'register'
            ? '尚未检测到登录会话。注册可能已经完成，请先尝试登录。'
            : '尚未检测到登录会话，请返回登录后重试。',
        );
    } catch (failure) {
      if (operations.owns(operation)) setError(errorMessage(failure));
    } finally {
      finish(operation);
    }
  }

  async function useRecoveredSession() {
    const expectedUserId = recoveredSession?.user?.id;
    if (!expectedUserId || accepted.current) return;
    const operation = operations.begin('session');
    if (!operation) return;
    setActiveKind('session');
    setError(null);
    try {
      // Another tab may have changed the HttpOnly cookie after the preview.
      // Reconfirm the displayed actor before letting it replace App's owner.
      const current = await withAuthDeadline(operation, (signal) =>
        api<unknown>('/session', { signal }),
      );
      if (!operations.owns(operation)) return;
      if (!isAuthSession(current)) throw new Error('暂时无法确认登录状态，请稍后重试。');
      if (current.user?.id !== expectedUserId) {
        setRecoveredSession(current.user ? current : null);
        setRecoveryMessage(
          current.user ? '登录状态已变化，请确认当前账号后继续。' : '当前会话已退出，请返回登录。',
        );
        return;
      }
      acceptSession(current, { method: 'session' });
    } catch (failure) {
      if (operations.owns(operation)) setError(errorMessage(failure));
    } finally {
      finish(operation);
    }
  }
  function continueRegistration() {
    if (operations.busy) return;
    const validation = validateAuthField('phone', fields, mode, inviteRequired);
    if (validation) return showErrors({ phone: validation });
    setDirection('forward');
    setError(null);
    setErrors({});
    setRegisterStep('details');
  }

  const fieldId = (field: AuthField) => `${id}-${field}`;
  const cooldownText = (seconds: number) =>
    seconds < 60
      ? t('{count} 秒后重试', { count: seconds })
      : seconds < 3600
        ? t('{count} 分钟后重试', { count: Math.ceil(seconds / 60) })
        : t('{count} 小时后重试', { count: Math.ceil(seconds / 3600) });
  const descriptions = (field: AuthField, hint = false) =>
    [hint ? `${fieldId(field)}-hint` : '', errors[field] ? `${fieldId(field)}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const fieldError = (field: AuthField) =>
    errors[field] ? (
      <span id={`${fieldId(field)}-error`} className="auth-field-error" role="status">
        {t(errors[field]!)}
      </span>
    ) : null;
  const phoneField = (
    <div className="auth-field auth-phone-field">
      <label htmlFor={fieldId('phone')}>{t('手机号')}</label>
      <input
        ref={phoneInput}
        data-testid="auth-phone"
        id={fieldId('phone')}
        name="phone"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        value={fields.phone}
        onChange={(event) => updateField('phone', event.target.value)}
        onBlur={(event) => blurField('phone', event.relatedTarget)}
        placeholder={t('手机号或国际区号 + 号码')}
        minLength={8}
        maxLength={24}
        required
        data-auth-initial
        aria-invalid={!!errors.phone}
        aria-describedby={descriptions('phone')}
      />
      {fieldError('phone')}
    </div>
  );
  const smsLabel = smsUnavailable
    ? t('短信暂不可用')
    : activeKind === 'sms'
      ? t('发送中…')
      : smsCooldown
        ? cooldownText(smsCooldown)
        : t('获取验证码');
  const codeField = (
    <div className="auth-field auth-code-field">
      <label htmlFor={fieldId('code')}>{t('短信验证码')}</label>
      <div className="auth-code-row">
        <input
          id={fieldId('code')}
          data-testid="auth-code"
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          value={fields.code}
          onChange={(event) => updateField('code', event.target.value)}
          onBlur={(event) => blurField('code', event.relatedTarget)}
          placeholder={t('6 位验证码')}
          minLength={6}
          maxLength={6}
          required
          data-auth-initial={mode === 'register' ? '' : undefined}
          aria-invalid={!!errors.code}
          aria-describedby={descriptions('code')}
        />
        <button
          type="button"
          className="auth-send-code"
          onClick={sendCode}
          disabled={busy || !!smsCooldown || smsUnavailable || !phone}
        >
          {smsLabel}
        </button>
      </div>
      {fieldError('code')}
    </div>
  );
  const passwordField = (
    <div className="auth-field auth-password-field">
      <label htmlFor={fieldId('password')}>{mode === 'reset' ? t('新密码') : t('密码')}</label>
      <div className="auth-password-row">
        <input
          id={fieldId('password')}
          data-testid="auth-password"
          name="password"
          type={visible ? 'text' : 'password'}
          autoComplete={mode === 'password' ? 'current-password' : 'new-password'}
          value={fields.password}
          onChange={(event) => updateField('password', event.target.value)}
          onBlur={(event) => blurField('password', event.relatedTarget)}
          placeholder={mode === 'password' ? t('请输入密码') : t('至少 10 位字符')}
          minLength={mode === 'password' ? 1 : 10}
          maxLength={128}
          required
          aria-invalid={!!errors.password}
          aria-describedby={descriptions('password', mode !== 'password')}
        />
        <IconButton
          label={visible ? t('隐藏密码') : t('显示密码')}
          aria-pressed={visible}
          className="auth-password-toggle"
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeSlash size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
        </IconButton>
      </div>
      {mode !== 'password' && (
        <span id={`${fieldId('password')}-hint`} className="auth-field-hint">
          {t('10–128 位字符，支持粘贴密码。')}
        </span>
      )}
      {fieldError('password')}
    </div>
  );
  const title = resetDone
    ? t('密码已更新')
    : mode === 'register'
      ? t('注册账号')
      : mode === 'reset'
        ? t('重置密码')
        : t('登录工作空间');
  const screen = resetDone
    ? 'reset-done'
    : uncertain
      ? 'uncertain'
      : `${mode}-${mode === 'register' ? registerStep : 'form'}`;

  return (
    <AccountPageFrame
      title={title}
      config={config}
      onBack={() => {
        if (operations.busy) return;
        if (!uncertain && mode === 'register' && registerStep === 'details') {
          setDirection('back');
          setRegisterStep('phone');
          setError(null);
          setErrors({});
        } else if (!uncertain && (mode === 'register' || mode === 'reset')) switchMode('password');
        else onClose();
      }}
      onHome={onHome}
      backLabel={
        !uncertain && mode === 'register' && registerStep === 'details'
          ? c.previous
          : !uncertain && (mode === 'register' || mode === 'reset')
            ? t('返回登录')
            : backToAbout
              ? c.home
              : c.back
      }
      busy={busy}
      className={`account-auth account-auth-${mode}`}
    >
      {!resetDone && !uncertain && (
        <div className="auth-entry-links" role="group" aria-label={c.entryLabel}>
          <button
            type="button"
            aria-label={c.switchLogin}
            aria-pressed={mode !== 'register'}
            disabled={busy}
            onClick={() => {
              if (mode === 'register' || mode === 'reset') switchMode('password');
            }}
          >
            {t('登录')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'register'}
            disabled={busy}
            onClick={() => switchMode('register')}
          >
            {t('创建新账号')}
          </button>
        </div>
      )}
      {!resetDone && !uncertain && (mode === 'password' || mode === 'otp') && (
        <div className="auth-methods" role="group" aria-label={t('登录方式')}>
          <button
            type="button"
            aria-pressed={mode === 'password'}
            onClick={() => switchMode('password')}
            disabled={busy}
          >
            <LockKey size={17} aria-hidden />
            {t('密码登录')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'otp'}
            onClick={() => switchMode('otp')}
            disabled={busy}
          >
            <DeviceMobile size={17} aria-hidden />
            {t('验证码登录')}
          </button>
        </div>
      )}
      {!uncertain && mode === 'register' && (
        <ol className="auth-steps" aria-label={t('注册进度')}>
          <li
            aria-current={registerStep === 'phone' ? 'step' : undefined}
            data-complete={registerStep === 'details' || undefined}
          >
            <span>1</span>
            {t('手机号')}
          </li>
          <li aria-current={registerStep === 'details' ? 'step' : undefined}>
            <span>2</span>
            {t('账号设置')}
          </li>
        </ol>
      )}
      <MotionSwitch
        switchKey={screen}
        role="auth-fields"
        className="auth-stage"
        data-testid="auth-stage"
        data-auth-direction={direction}
      >
        <AuthStage key={screen}>
          {resetDone ? (
            <div
              className="auth-result auth-reset-result"
              role="status"
              data-testid="auth-reset-success"
            >
              <CheckCircle className="auth-result-icon" size={32} aria-hidden />
              <h3>{t('请用新密码重新登录')}</h3>
              <p>{t('该手机号对应账号的旧登录已失效，作品和项目仍会保留。')}</p>
              <button
                type="button"
                className="button button-primary auth-primary"
                data-auth-initial
                onClick={() => switchMode('password')}
              >
                {t('返回登录')} <ArrowRight size={18} aria-hidden />
              </button>
            </div>
          ) : uncertain ? (
            <div className="auth-result auth-recovery-result" data-testid="auth-recovery">
              <h3 tabIndex={-1} data-auth-initial>
                {t('请求结果尚未确认')}
              </h3>
              <p>
                {mode === 'reset'
                  ? t('密码可能已更新。请尝试用新密码登录，必要时重新获取验证码。')
                  : t('网络没有返回完整结果。先检查当前会话，避免重复提交。')}
              </p>
              {recoveredSession?.user && (
                <div className="auth-recovered-account" role="status">
                  <span>{t('检测到已登录账号')}</span>
                  <strong>{recoveredSession.user.displayName}</strong>
                  <small>{recoveredSession.user.phoneMasked}</small>
                  <button
                    type="button"
                    className="button button-primary auth-primary"
                    onClick={useRecoveredSession}
                    disabled={busy}
                  >
                    {busy ? (
                      <Busy label={t('正在确认')} />
                    ) : (
                      <>
                        {t('使用这个账号')} <ArrowRight size={18} aria-hidden />
                      </>
                    )}
                  </button>
                </div>
              )}
              {recoveryMessage && <p role="status">{t(recoveryMessage)}</p>}
              <InlineError message={error ? t(error) : null} />
              {mode !== 'reset' && !recoveredSession?.user && (
                <button
                  type="button"
                  className="button button-primary auth-primary"
                  onClick={checkSession}
                  disabled={busy}
                >
                  {activeKind === 'session' ? <Busy label={t('正在检查')} /> : t('检查登录状态')}
                </button>
              )}
              <button
                type="button"
                className="auth-text-button"
                disabled={busy}
                onClick={() => switchMode('password')}
              >
                {t('返回登录')}
              </button>
            </div>
          ) : (
            <form
              ref={form}
              className="auth-form"
              onSubmit={submit}
              noValidate
              aria-busy={busy}
              data-testid="auth-form"
            >
              <fieldset disabled={busy} className="auth-fields">
                {mode !== 'register' || registerStep === 'phone' ? (
                  phoneField
                ) : (
                  <div className="auth-phone-summary">
                    <span>
                      <small>{t('手机号')}</small>
                      <strong>{t(maskedAuthPhone(fields.phone))}</strong>
                    </span>
                    <button
                      type="button"
                      className="auth-text-button"
                      onClick={() => {
                        setDirection('back');
                        setRegisterStep('phone');
                        setError(null);
                        setErrors({});
                      }}
                    >
                      {t('更改')}
                    </button>
                  </div>
                )}
                {!isRegisterPhone && (
                  <>
                    {mode !== 'password' && codeField}
                    {mode === 'register' && (
                      <div className="auth-field auth-name-field">
                        <label htmlFor={fieldId('displayName')}>{t('怎么称呼你')}</label>
                        <input
                          id={fieldId('displayName')}
                          data-testid="auth-display-name"
                          name="displayName"
                          autoComplete="nickname"
                          value={fields.displayName}
                          onChange={(event) => updateField('displayName', event.target.value)}
                          onBlur={(event) => blurField('displayName', event.relatedTarget)}
                          placeholder={t('你的昵称')}
                          maxLength={120}
                          required
                          aria-invalid={!!errors.displayName}
                          aria-describedby={descriptions('displayName')}
                        />
                        {fieldError('displayName')}
                      </div>
                    )}
                    {mode !== 'otp' && passwordField}
                    {mode === 'register' && (
                      <div className="auth-invite-section">
                        {!inviteRequired && (
                          <button
                            type="button"
                            className="auth-text-button auth-invite-trigger"
                            aria-expanded={
                              inviteExpanded || !!fields.inviteCode || !!errors.inviteCode
                            }
                            aria-controls={`${id}-invitation`}
                            onClick={() => setInviteExpanded((value) => !value)}
                          >
                            {t('有邀请码？')}
                          </button>
                        )}
                        <MotionDisclosure
                          id={`${id}-invitation`}
                          open={
                            inviteRequired ||
                            inviteExpanded ||
                            !!fields.inviteCode ||
                            !!errors.inviteCode
                          }
                        >
                          <div className="auth-field auth-invite-field">
                            <label htmlFor={fieldId('inviteCode')}>
                              {t('注册邀请码')}
                              <small>{inviteRequired ? t('必填') : t('选填')}</small>
                            </label>
                            <input
                              id={fieldId('inviteCode')}
                              data-testid="auth-invite-code"
                              name="inviteCode"
                              value={fields.inviteCode}
                              onChange={(event) => updateField('inviteCode', event.target.value)}
                              onBlur={(event) => blurField('inviteCode', event.relatedTarget)}
                              placeholder={
                                inviteRequired ? t('填写收到的注册邀请码') : t('如果你收到过邀请码')
                              }
                              autoComplete="off"
                              required={inviteRequired}
                              minLength={10}
                              maxLength={100}
                              aria-invalid={!!errors.inviteCode}
                              aria-describedby={descriptions('inviteCode')}
                            />
                            {fieldError('inviteCode')}
                          </div>
                        </MotionDisclosure>
                      </div>
                    )}
                  </>
                )}
                {mode !== 'password' && smsUnavailable && (
                  <p className="auth-service-note" role="status">
                    {t('短信暂未开通。已有账号可使用密码登录，也可以继续本地编辑。')}
                  </p>
                )}
                {smsState !== 'idle' && (
                  <p className={`auth-sms-note is-${smsState}`} role="status">
                    {smsState === 'unknown'
                      ? t('发送结果待确认。已收到的验证码仍可使用，请勿连续重发。')
                      : smsExpiresIn % 60 === 0
                        ? t('验证码已提交发送，{count} 分钟内有效。', { count: smsExpiresIn / 60 })
                        : t('验证码已提交发送，{count} 秒内有效。', { count: smsExpiresIn })}
                  </p>
                )}
                <InlineError message={error ? t(error) : null} />
                <button
                  className="button button-primary auth-primary"
                  type="submit"
                  disabled={
                    busy ||
                    (isRegisterPhone
                      ? !resumeRegistration && (smsUnavailable || !!smsCooldown)
                      : !!submitCooldown)
                  }
                >
                  {activeKind === 'submit' || (isRegisterPhone && activeKind === 'sms') ? (
                    <Busy
                      label={
                        isRegisterPhone
                          ? t('正在发送')
                          : mode === 'register'
                            ? t('正在创建')
                            : mode === 'reset'
                              ? t('正在更新')
                              : t('正在登录')
                      }
                    />
                  ) : (
                    <>
                      {isRegisterPhone
                        ? resumeRegistration
                          ? c.continueDetails
                          : smsLabel
                        : submitCooldown
                          ? cooldownText(submitCooldown)
                          : mode === 'register'
                            ? t('创建账号')
                            : mode === 'reset'
                              ? t('更新密码')
                              : t('登录')}
                      <ArrowRight size={18} aria-hidden />
                    </>
                  )}
                </button>
                {isRegisterPhone && !resumeRegistration && (
                  <button
                    type="button"
                    className="auth-text-button auth-existing-code"
                    onClick={continueRegistration}
                  >
                    {t('已有验证码，继续')}
                  </button>
                )}
              </fieldset>
            </form>
          )}
        </AuthStage>
      </MotionSwitch>
      {!resetDone && !uncertain && (mode === 'password' || mode === 'otp') && (
        <div className="auth-navigation">
          <button
            type="button"
            className="auth-text-button"
            onClick={() => switchMode('reset')}
            disabled={busy}
          >
            {t('忘记密码？')}
          </button>
        </div>
      )}
    </AccountPageFrame>
  );
}
