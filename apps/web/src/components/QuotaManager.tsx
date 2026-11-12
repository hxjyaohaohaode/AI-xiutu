import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from './ChoiceSelect';
import { secureUuid } from '../lib/uuid';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MagnifyingGlass, UserCircle, CheckCircle } from '@phosphor-icons/react';
import { api, errorMessage, jsonRequest } from '../lib/api';
import type { User } from '../lib/types';
import { Busy, InlineError } from './Ui';
import { StatusMark } from './StatusMark';

type Entitlements = {
  available: number;
  held: number;
  freeAvailable: number;
  purchasedAvailable: number;
  usage: { spent: number; expired: number; revoked: number };
};
type AccountSpaces = {
  user: User;
  spaces: { id: string; kind: string; name?: string; role: string; entitlements: Entitlements }[];
};
export function QuotaManager() {
  const alive = useRef(true);
  const writing = useRef(false);
  const read = useRef<{ id: number; controller: AbortController | null }>({
    id: 0,
    controller: null,
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      read.current.id++;
      read.current.controller?.abort();
    };
  }, []);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [account, setAccount] = useState<AccountSpaces | null>(null);
  const [spaceId, setSpaceId] = useState('');
  const [units, setUnits] = useState(200);
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(() => secureUuid());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState('');
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [accountState, setAccountState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [readError, setReadError] = useState<string | null>(null);
  const space = account?.spaces.find((item) => item.id === spaceId);
  const entitlements = space?.entitlements;
  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy || writing.current || !query.trim()) return;
    const requestId = ++read.current.id;
    read.current.controller?.abort();
    const controller = new AbortController();
    read.current.controller = controller;
    const current = () =>
      alive.current && read.current.id === requestId && !controller.signal.aborted;
    setBusy(true);
    setReadError(null);
    setSearchState('loading');
    try {
      const result = await api<{ users: User[] }>(
        `/ops/users?query=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      );
      if (!current()) return;
      setUsers(result.users);
      setSearchState('ready');
    } catch (e) {
      if (current()) {
        setReadError(errorMessage(e));
        setSearchState('error');
      }
    } finally {
      if (current()) setBusy(false);
      if (read.current.controller === controller) read.current.controller = null;
    }
  }
  async function select(user: User) {
    if (busy || writing.current) return;
    const requestId = ++read.current.id;
    read.current.controller?.abort();
    const controller = new AbortController();
    read.current.controller = controller;
    const current = () =>
      alive.current && read.current.id === requestId && !controller.signal.aborted;
    setBusy(true);
    setReadError(null);
    setAccountState('loading');
    setSuccess('');
    try {
      const result = await api<AccountSpaces>(`/ops/users/${user.id}/entitlements`, {
        signal: controller.signal,
      });
      if (!current()) return;
      setAccount(result);
      setAccountState('ready');
      setSpaceId(
        result.spaces.find((item) => item.kind === 'personal')?.id ?? result.spaces[0]?.id ?? '',
      );
      setKey(secureUuid());
    } catch (e) {
      if (current()) {
        setReadError(errorMessage(e));
        setAccountState('error');
      }
    } finally {
      if (current()) setBusy(false);
      if (read.current.controller === controller) read.current.controller = null;
    }
  }
  async function adjust(event: FormEvent) {
    event.preventDefault();
    if (
      writing.current ||
      busy ||
      !spaceId ||
      !Number.isSafeInteger(units) ||
      !units ||
      reason.trim().length < 3
    )
      return;
    writing.current = true;
    const snapshot = { spaceId, units, reason: reason.trim(), key, actorId: account?.user.id };
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      const receipt = await api<{ entitlements: Entitlements }>(
        '/ops/adjustments',
        jsonRequest('POST', {
          spaceId: snapshot.spaceId,
          units: snapshot.units,
          reason: snapshot.reason,
          idempotencyKey: snapshot.key,
        }),
      );
      if (!alive.current) return;
      // The mutation receipt is authoritative. A later read failure must never
      // turn a committed adjustment into a retryable failed write.
      setAccount((current) => {
        if (!current || current.user.id !== snapshot.actorId) return current;
        return {
          ...current,
          spaces: current.spaces.map((item) =>
            item.id === snapshot.spaceId ? { ...item, entitlements: receipt.entitlements } : item,
          ),
        };
      });
      setKey(secureUuid());
      setReason('');
      setSuccess(
        t('{action} {units} 服务点，已写入权益账本。', {
          action: t(snapshot.units > 0 ? '增加' : '更正减少'),
          units: Math.abs(snapshot.units),
        }),
      );
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div
      className="quota-manager"
      data-motion="quota"
      data-search-state={searchState}
      data-account-state={accountState}
    >
      <section className="surface ops-section">
        <h2>{t('用户')}</h2>
        <form className="search-form" onSubmit={search}>
          <MagnifyingGlass size={19} />
          <input
            aria-label={t('搜索额度用户')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('输入手机号或昵称')}
            disabled={busy}
            required
          />
          <button className="button button-secondary" disabled={busy}>
            {busy ? <Busy label="" /> : t('查找')}
          </button>
        </form>
        <InlineError message={readError} />
        {searchState === 'ready' && !users.length && (
          <p className="quiet-copy" role="status">
            {t('没有符合条件的用户。')}
          </p>
        )}
        <div className="quota-user-results">
          {users.map((user) => (
            <button
              key={user.id}
              disabled={busy}
              aria-pressed={account?.user.id === user.id}
              onClick={() => void select(user)}
            >
              <UserCircle size={26} />
              <span>
                <strong>{user.displayName}</strong>
                <small>
                  {user.phoneMasked} ·{' '}
                  {user.status === 'active'
                    ? t('正常')
                    : user.status === 'banned'
                      ? t('已限制')
                      : t('待短信验证')}
                </small>
              </span>
              {account?.user.id === user.id && <CheckCircle size={19} />}
            </button>
          ))}
        </div>
      </section>
      {account && (
        <section className="surface ops-section">
          <h2>
            {account.user.displayName} {t('的空间权益')}
          </h2>
          {account.spaces.length ? (
            <>
              <label className="quota-space-label">
                {t('选择空间')}
                <ChoiceSelect
                  ariaLabel={t('额度调整目标空间')}
                  value={spaceId}
                  disabled={busy}
                  onValueChange={(value) => {
                    setSpaceId(value);
                    setKey(secureUuid());
                  }}
                  options={account.spaces.map((item) => ({
                    value: item.id,
                    label: item.name || (item.kind === 'personal' ? t('个人空间') : t('团队空间')),
                    description: item.kind === 'personal' ? t('个人') : t('拥有的团队'),
                  }))}
                />
              </label>
              {entitlements && (
                <div className="quota-account-balances">
                  <div>
                    <span>{t('可用服务点')}</span>
                    <strong>{entitlements.available}</strong>
                  </div>
                  <div>
                    <span>{t('任务占用')}</span>
                    <strong>{entitlements.held}</strong>
                  </div>
                  <div>
                    <span>{t('累计消费')}</span>
                    <strong>{entitlements.usage.spent}</strong>
                  </div>
                  <div>
                    <span>{t('免费可用 / 购买可用')}</span>
                    <strong>
                      {entitlements.freeAvailable} / {entitlements.purchasedAvailable}
                    </strong>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="form-hint">
              {t(
                '此账号尚无可调整的空间。待验证用户需自行完成短信注册，不能把待验证状态当作已激活。',
              )}
            </p>
          )}
        </section>
      )}
      <form className="surface ops-section stack-form" onSubmit={adjust}>
        <h2>{t('额度调整')}</h2>
        <label>
          {t('调整数量（正数增加，负数减少）')}
          <input
            aria-label={t('调整服务点数量')}
            type="number"
            min="-100000"
            max="100000"
            step="1"
            value={units}
            disabled={busy}
            onChange={(event) => {
              setUnits(Number(event.target.value));
              setKey(secureUuid());
            }}
            required
          />
        </label>
        <label>
          {t('操作原因')}
          <input
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setKey(secureUuid());
            }}
            disabled={busy}
            minLength={3}
            maxLength={500}
            placeholder={t('写明赠额或更正的依据')}
            required
          />
        </label>
        <MotionDetails className="advanced-space-id">
          <summary>{t('高级：直接填写已核实的空间 ID')}</summary>
          <label>
            {t('空间 ID')}
            <input
              value={spaceId}
              onChange={(event) => {
                setSpaceId(event.target.value);
                setKey(secureUuid());
              }}
              disabled={busy}
              placeholder={t('核实归属后填写 UUID')}
            />
          </label>
        </MotionDetails>
        <InlineError message={error} />
        {success && (
          <p className="success-note" role="status">
            <StatusMark state="done" size="small" label={t(success)} />
          </p>
        )}
        <button
          className="button button-primary"
          disabled={busy || !spaceId || !units || reason.trim().length < 3}
        >
          {busy ? (
            <Busy />
          ) : (
            t('确认{v0} {v1} 点', { v0: units > 0 ? t('增加') : t('减少'), v1: Math.abs(units) })
          )}
        </button>
      </form>
    </div>
  );
}
