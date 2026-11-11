import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from './ChoiceSelect';
import { secureUuid } from '../lib/uuid';
import { useState, type FormEvent } from 'react';
import { MagnifyingGlass, UserCircle, CheckCircle } from '@phosphor-icons/react';
import { api, errorMessage, jsonRequest } from '../lib/api';
import type { User } from '../lib/types';
import { Busy, InlineError } from './Ui';

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
  const space = account?.spaces.find((item) => item.id === spaceId);
  const entitlements = space?.entitlements;
  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setUsers(
        (await api<{ users: User[] }>(`/ops/users?query=${encodeURIComponent(query.trim())}`))
          .users,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function select(user: User) {
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      const result = await api<AccountSpaces>(`/ops/users/${user.id}/entitlements`);
      setAccount(result);
      setSpaceId(
        result.spaces.find((item) => item.kind === 'personal')?.id ?? result.spaces[0]?.id ?? '',
      );
      setKey(secureUuid());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function adjust(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      await api(
        '/ops/adjustments',
        jsonRequest('POST', { spaceId, units, reason: reason.trim(), idempotencyKey: key }),
      );
      if (account)
        setAccount(await api<AccountSpaces>(`/ops/users/${account.user.id}/entitlements`));
      setKey(secureUuid());
      setSuccess(
        t('{action} {units} 服务点，已写入权益账本。', {
          action: t(units > 0 ? '增加' : '更正减少'),
          units: Math.abs(units),
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quota-manager" data-motion="quota">
      <section className="surface ops-section">
        <h2>{t('先找到需要调整的用户')}</h2>
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
        <p className="fine-print">
          {t('只读取账号及其个人空间、拥有的团队的权益，不读取私人作品内容。')}
        </p>
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
        <h2>{t('有依据地调整服务点')}</h2>
        <p className="form-hint">
          {t('正数增加赠额，负数只更正仍可用的额度。不改写已消费或占用的点数，也不表示现金收款。')}
        </p>
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
            <CheckCircle size={18} />
            {t(success)}
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
