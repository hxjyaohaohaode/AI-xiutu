import type { Session, Space } from '../lib/types';
import type { DocumentDraft } from './document-drafts';

export type AccountTab = 'overview' | 'security' | 'billing' | 'data';

export type AccountEntitlements = {
  spaceId: string;
  available: number;
  held: number;
  freeAvailable: number;
  purchasedAvailable: number;
  periodEnd: string;
};

/** An explicit, inaccessible space must not silently fall back to personal funds. */
export function accountSpace(session: Session, spaceId: string | null): Space | null {
  if (!session.user) return null;
  return (
    session.spaces.find((space) =>
      spaceId === null ? space.kind === 'personal' : space.id === spaceId,
    ) ?? null
  );
}

export function accountScope(userId: string | undefined, spaceId: string | undefined) {
  return userId && spaceId ? JSON.stringify([userId, spaceId]) : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isUnits = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function isAccountTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    hour < 24 &&
    minute < 60 &&
    second < 60
  );
}

/** No coercion, rounded balances, cross-space receipts, or malformed success states. */
export function readAccountEntitlements(
  value: unknown,
  expectedSpaceId: string,
): AccountEntitlements {
  if (
    !isRecord(value) ||
    value.spaceId !== expectedSpaceId ||
    !isUnits(value.available) ||
    !isUnits(value.held) ||
    !isUnits(value.freeAvailable) ||
    !isUnits(value.purchasedAvailable) ||
    value.available !== value.freeAvailable + value.purchasedAvailable ||
    !isAccountTimestamp(value.periodEnd)
  ) {
    throw new Error('额度数据暂时无法确认，请刷新后重试。');
  }
  return {
    spaceId: value.spaceId,
    available: value.available,
    held: value.held,
    freeAvailable: value.freeAvailable,
    purchasedAvailable: value.purchasedAvailable,
    periodEnd: value.periodEnd,
  };
}

const unitsFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const periodFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatAccountUnits(value: number) {
  return isUnits(value) ? unitsFormatter.format(value) : '—';
}

export function formatAccountPeriod(value: string) {
  return isAccountTimestamp(value) ? periodFormatter.format(new Date(value)) : '待确认';
}

export function accountStatus(status: string) {
  switch (status) {
    case 'active':
      return { label: '正常', tone: 'success' } as const;
    case 'pending':
      return { label: '待完成注册', tone: 'warning' } as const;
    case 'banned':
      return { label: '已受限', tone: 'danger' } as const;
    default:
      return { label: '待确认', tone: 'neutral' } as const;
  }
}

export function accountRole(role: string) {
  const roles: Record<string, string> = {
    owner: '所有者',
    admin: '管理员',
    editor: '编辑者',
    reviewer: '审阅者',
    viewer: '查看者',
  };
  return roles[role] ?? '权限待确认';
}

/** A surprising unmasked server value must not expose a private phone number. */
export function accountPhone(phoneMasked: string) {
  const phone = phoneMasked.trim();
  if (/^[+\d\s()*•·xX-]{4,32}$/.test(phone) && /[*•·xX]/.test(phone)) return phone;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `•••• ${digits.slice(-4)}` : '手机号已隐藏';
}

export function nextAccountTab(current: AccountTab, key: string): AccountTab | null {
  const tabs: AccountTab[] = ['overview', 'security', 'billing', 'data'];
  const at = tabs.indexOf(current);
  if (key === 'Home') return tabs[0];
  if (key === 'End') return tabs[tabs.length - 1];
  if (key === 'ArrowRight' || key === 'ArrowDown') return tabs[(at + 1) % tabs.length];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return tabs[(at + tabs.length - 1) % tabs.length];
  return null;
}

/** Recheck both ownership and the exact retained snapshot immediately before acting. */
export function accountDraftActionAllowed(
  actorId: string | null,
  current: DocumentDraft | null,
  expected: DocumentDraft,
  action: 'export' | 'discard',
): boolean {
  return (
    !!actorId &&
    !!current &&
    expected.actorId === actorId &&
    current.actorId === actorId &&
    current.projectId === expected.projectId &&
    current.revision === expected.revision &&
    (action === 'export' || current.saveState !== 'pending')
  );
}
