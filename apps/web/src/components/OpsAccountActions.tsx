import { t } from '../i18n';
import { api, jsonRequest } from '../lib/api';
import type { User } from '../lib/types';
import { useConfirmation } from './ConfirmationDialog';

export type OpsAccount = User & { managesAccounts: boolean };

export function OpsAccountActions({
  user,
  canManageAccounts,
  reason,
  disabled,
  action,
}: {
  user: OpsAccount;
  canManageAccounts: boolean;
  reason: string;
  disabled: boolean;
  action: (work: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const { confirm, dialog } = useConfirmation();
  if (user.managesAccounts || user.status === 'closed') return null;
  const blocked = disabled || reason.trim().length < 3;
  const endpoint = '/ops/users/' + user.id;
  const label = user.isOperator ? '撤回运营权限' : '授予运营权限';

  async function changeRole() {
    const accepted = await confirm({
      title: label,
      description: t('将为 {name}（{phone}）{action}。该账号需要重新登录。', {
        name: user.displayName, phone: user.phoneMasked, action: t(label),
      }),
      confirmLabel: label,
    });
    if (!accepted) return;
    await action(
      () => api(endpoint + '/role', jsonRequest('PUT', {
        expectedRole: user.isOperator ? 'operator' : 'user',
        role: user.isOperator ? 'user' : 'operator',
        reason,
      })),
      t('账号权限已更新'),
    );
  }

  async function closeAccount() {
    const accepted = await confirm({
      title: '注销账号',
      description: t('确认注销 {name}（{phone}）？账号将无法恢复。会话和共享权限会撤销，历史作品与账务记录将保留。', {
        name: user.displayName, phone: user.phoneMasked,
      }),
      confirmLabel: '确认注销',
      tone: 'danger',
    });
    if (!accepted) return;
    await action(
      () => api(endpoint + '/close', jsonRequest('POST', { reason })),
      t('账号已注销'),
    );
  }

  return (
    <div className="ops-account-actions">
      {!user.isOperator && (
        <button
          type="button"
          className="text-button"
          disabled={blocked}
          onClick={() => void action(
            () => api(endpoint, jsonRequest('PATCH', {
              status: user.status === 'banned' ? 'active' : 'banned',
              reason,
            })),
            t('用户状态已更新'),
          )}
        >
          {t(user.status === 'banned' ? '恢复' : '限制账号')}
        </button>
      )}
      {canManageAccounts && (user.isOperator || user.status === 'active') && (
        <button type="button" className="text-button" disabled={blocked} onClick={() => void changeRole()}>
          {t(label)}
        </button>
      )}
      {canManageAccounts && !user.isOperator && (
        <button type="button" className="text-button" disabled={blocked} onClick={() => void closeAccount()}>
          {t('注销账号')}
        </button>
      )}
      {dialog}
    </div>
  );
}
