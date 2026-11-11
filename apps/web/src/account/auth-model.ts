import type { Session } from '../lib/types';

/** Browser guidance mirrors the current auth contract; the API remains authoritative. */
export type AuthMode = 'password' | 'otp' | 'register' | 'reset';
export type AuthField = 'phone' | 'code' | 'password' | 'displayName' | 'inviteCode';
export type AuthFields = Record<AuthField, string>;
export type AuthFieldErrors = Partial<Record<AuthField, string>>;
export type AuthSessionMeta = { method: 'password' | 'otp' | 'register' | 'session' };

export const emptyAuthFields = (): AuthFields => ({
  phone: '',
  code: '',
  password: '',
  displayName: '',
  inviteCode: '',
});

export function normalizedAuthPhone(value: string): string | null {
  if (value.length < 8 || value.length > 24) return null;
  const compact = value.trim().replace(/[\s()-]/g, '');
  const phone = /^1[3-9]\d{9}$/.test(compact) ? `+86${compact}` : compact;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function maskedAuthPhone(value: string): string {
  const phone = normalizedAuthPhone(value);
  return phone ? `${phone.slice(0, 3)} •••• ${phone.slice(-4)}` : '当前手机号';
}

export function fieldsForAuth(mode: AuthMode): AuthField[] {
  if (mode === 'password') return ['phone', 'password'];
  if (mode === 'otp') return ['phone', 'code'];
  if (mode === 'reset') return ['phone', 'code', 'password'];
  return ['phone', 'code', 'displayName', 'password', 'inviteCode'];
}

export function validateAuthField(
  field: AuthField,
  fields: AuthFields,
  mode: AuthMode,
  inviteRequired = false,
): string | undefined {
  if (!fieldsForAuth(mode).includes(field)) return;
  const value = fields[field];
  if (field === 'phone')
    return normalizedAuthPhone(value) ? undefined : '请输入大陆手机号，或带国家区号的完整号码。';
  if (field === 'code') return /^\d{6}$/.test(value.trim()) ? undefined : '请输入 6 位短信验证码。';
  if (field === 'password') {
    if (!value) return mode === 'password' ? '请输入密码。' : '请设置至少 10 位字符的密码。';
    if (mode !== 'password' && value.length < 10) return '密码至少需要 10 位字符。';
    if (value.length > 128) return '密码不能超过 128 位字符。';
  }
  if (field === 'displayName') {
    if (!value.trim()) return '请填写昵称。';
    if (value.trim().length > 120) return '昵称不能超过 120 个字符。';
  }
  if (field === 'inviteCode') {
    const invite = value.trim();
    if (!invite && inviteRequired) return '当前注册需要邀请码。';
    if (invite && (invite.length < 10 || invite.length > 100)) return '请填写完整的注册邀请码。';
  }
}

export function validateAuthFields(
  fields: AuthFields,
  mode: AuthMode,
  inviteRequired = false,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  for (const field of fieldsForAuth(mode)) {
    const message = validateAuthField(field, fields, mode, inviteRequired);
    if (message) errors[field] = message;
  }
  return errors;
}

export function authPayload(fields: AuthFields, mode: AuthMode) {
  const phone = normalizedAuthPhone(fields.phone);
  if (!phone) throw new Error('请输入有效手机号。');
  if (mode === 'password') return { phone, password: fields.password };
  if (mode === 'otp') return { phone, code: fields.code.trim() };
  if (mode === 'reset') return { phone, code: fields.code.trim(), newPassword: fields.password };
  return {
    phone,
    code: fields.code.trim(),
    password: fields.password,
    displayName: fields.displayName.trim(),
    ...(fields.inviteCode.trim() ? { inviteCode: fields.inviteCode.trim() } : {}),
  };
}

type AuthFailure = { code?: unknown; status?: unknown; details?: unknown };
export function authFailure(error: unknown): AuthFailure {
  return error !== null && typeof error === 'object' ? error : {};
}

export function retryAfterSeconds(error: unknown): number | null {
  const { code, details } = authFailure(error);
  const value =
    details !== null && typeof details === 'object' && 'retryAfterSeconds' in details
      ? details.retryAfterSeconds
      : undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    return Math.min(Math.ceil(value), Math.floor(Number.MAX_SAFE_INTEGER / 1000));
  return code === 'OTP_COOLDOWN' ? 60 : null;
}

export function authFieldForFailure(error: unknown): AuthField | null {
  switch (authFailure(error).code) {
    case 'INVALID_PHONE':
      return 'phone';
    case 'OTP_INVALID':
      return 'code';
    case 'INVITE_INVALID':
    case 'INVITE_REQUIRED':
      return 'inviteCode';
    default:
      return null;
  }
}

/** A missing/malformed success or transport/server failure cannot prove no mutation occurred. */
export function authResultUncertain(error: unknown): boolean {
  const { status } = authFailure(error);
  return (
    status === 0 || (typeof status === 'number' && status >= 500) || error instanceof SyntaxError
  );
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown) =>
  typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const textWithin = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Validate fields we actually consume, allowing additive fields from newer servers. */
export function isAuthSession(value: unknown): value is Session {
  if (!record(value) || !Array.isArray(value.spaces)) return false;
  if (value.user === null) return value.spaces.length === 0;
  const user = value.user;
  if (
    !record(user) ||
    !uuid(user.id) ||
    !textWithin(user.displayName, 120) ||
    !textWithin(user.phoneMasked, 64) ||
    typeof user.isOperator !== 'boolean' ||
    user.status !== 'active'
  )
    return false;
  const ids = new Set<string>();
  return value.spaces.every((space: unknown) => {
    if (
      !record(space) ||
      !uuid(space.id) ||
      !textWithin(space.name, 512) ||
      !['personal', 'team'].includes(String(space.kind)) ||
      !['owner', 'admin', 'editor', 'reviewer', 'viewer'].includes(String(space.role)) ||
      ids.has(String(space.id))
    )
      return false;
    ids.add(String(space.id));
    return true;
  });
}

export function isAuthOtpReceipt(
  value: unknown,
): value is { ok: true; expiresIn: number; message: string } {
  return (
    record(value) &&
    value.ok === true &&
    typeof value.message === 'string' &&
    typeof value.expiresIn === 'number' &&
    Number.isSafeInteger(value.expiresIn) &&
    value.expiresIn > 0
  );
}

/** Only these definitive errors occur after the backend has consumed a valid code. */
export function authFailureConsumedCode(mode: AuthMode, error: unknown): boolean {
  const code = authFailure(error).code;
  return mode === 'register'
    ? ['INVITE_INVALID', 'INVITE_REQUIRED', 'REGISTRATION_UNAVAILABLE'].includes(String(code))
    : mode === 'otp'
      ? code === 'INVALID_CREDENTIALS'
      : mode === 'reset' && code === 'RESET_UNAVAILABLE';
}

/** In-memory only. A normalized phone shares its SMS deadline across all purposes. */
export class AuthCooldowns {
  private deadlines = new Map<string, number>();

  set(phone: string, seconds: number, now: number, scope: 'sms' | 'submit' = 'sms') {
    const normalized = normalizedAuthPhone(phone);
    if (!normalized || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(now)) return;
    for (const [expiredKey, deadline] of this.deadlines)
      if (deadline <= now) this.deadlines.delete(expiredKey);
    const key = `${scope}:${normalized}`;
    const deadline = Math.min(Number.MAX_SAFE_INTEGER, now + Math.ceil(seconds) * 1000);
    this.deadlines.set(key, Math.max(this.deadlines.get(key) ?? 0, deadline));
  }

  remaining(phone: string, now: number, scope: 'sms' | 'submit' = 'sms') {
    const normalized = normalizedAuthPhone(phone);
    if (!normalized) return 0;
    const key = `${scope}:${normalized}`;
    const deadline = this.deadlines.get(key) ?? 0;
    if (deadline <= now) {
      this.deadlines.delete(key);
      return 0;
    }
    return Math.ceil((deadline - now) / 1000);
  }
}

export function cooldownLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒后重试`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟后重试`;
  return `${Math.ceil(seconds / 3600)} 小时后重试`;
}

export type AuthOperation = Readonly<{
  generation: number;
  kind: 'sms' | 'submit' | 'session';
  controller: AbortController;
}>;

export const AUTH_REQUEST_TIMEOUT_MS = 30_000;

export class AuthRequestTimeoutError extends Error {
  readonly code = 'AUTH_REQUEST_TIMEOUT';
  readonly status = 0;

  constructor() {
    super('等待结果超时，请求可能已完成，请先确认当前状态。');
    this.name = 'AuthRequestTimeoutError';
  }
}

type AuthDeadlineScheduler = (expire: () => void, delay: number) => () => void;
const scheduleAuthDeadline: AuthDeadlineScheduler = (expire, delay) => {
  const timer = setTimeout(expire, delay);
  return () => clearTimeout(timer);
};

/** Stop observing a stalled request without cancelling its form owner. A timeout
 * is an unknown result, not proof that the server rolled back the operation.
 */
export async function withAuthDeadline<T>(
  operation: AuthOperation,
  request: (signal: AbortSignal) => Promise<T>,
  schedule: AuthDeadlineScheduler = scheduleAuthDeadline,
): Promise<T> {
  const ownerSignal = operation.controller.signal;
  if (ownerSignal.aborted) throw new DOMException('请求已停止观察', 'AbortError');
  const requestController = new AbortController();
  let settled = false;
  let interrupt!: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = reject;
  });
  const stop = (error: Error) => {
    if (settled) return;
    settled = true;
    // Reject first so an abort-aware transport cannot replace the timeout with
    // an ambiguous AbortError. The operation owner remains live for finally.
    interrupt(error);
    requestController.abort();
  };
  const cancelFromOwner = () => stop(new DOMException('请求已停止观察', 'AbortError'));
  ownerSignal.addEventListener('abort', cancelFromOwner, { once: true });
  const cancelDeadline = schedule(
    () => stop(new AuthRequestTimeoutError()),
    AUTH_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = Promise.resolve().then(() => {
      if (requestController.signal.aborted) throw new DOMException('请求已停止观察', 'AbortError');
      return request(requestController.signal);
    });
    // The deadline also settles a transport that fails to observe cancellation.
    return await Promise.race([interrupted, response]);
  } finally {
    settled = true;
    cancelDeadline();
    ownerSignal.removeEventListener('abort', cancelFromOwner);
  }
}

/** Ownership, not a promise's finally block, decides which request may release the UI. */
export class AuthOperations {
  private generation = 0;
  private mounted = false;
  private active: AuthOperation | null = null;

  mount() {
    this.mounted = true;
  }

  begin(kind: AuthOperation['kind']): AuthOperation | null {
    if (!this.mounted || this.active) return null;
    this.active = { generation: ++this.generation, kind, controller: new AbortController() };
    return this.active;
  }

  owns(operation: AuthOperation): boolean {
    return this.mounted && this.active === operation && !operation.controller.signal.aborted;
  }

  finish(operation: AuthOperation): boolean {
    if (!this.owns(operation)) return false;
    this.active = null;
    return true;
  }

  get busy() {
    return this.active !== null;
  }

  unmount() {
    this.mounted = false;
    ++this.generation;
    this.active?.controller.abort();
    this.active = null;
  }
}
