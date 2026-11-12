import { ArrowRight, Check, FolderPlus } from '@phosphor-icons/react';
import { AccountPageFrame } from './AccountPageFrame';
import type { PublicConfig, Session } from '../lib/types';
import { t, useLocale } from '../i18n';
import { accountPhone } from './account-model';

/** Shown only after the register endpoint returns a validated, active session. */
export function AccountReady({
  session,
  hasImage,
  onContinue,
  onImport,
  onProject,
  config,
  onHome,
}: {
  session: Session;
  hasImage: boolean;
  onContinue: () => void;
  onImport: () => void;
  onProject: () => void;
  config: PublicConfig | null;
  onHome?: () => void;
}) {
  useLocale();
  const personal = session.spaces.find((space) => space.kind === 'personal');
  return (
    <AccountPageFrame
      title={t('账号已创建')}
      config={config}
      onBack={onContinue}
      onHome={onHome}
      className="account-page-ready"
    >
      <div className="account-ready" data-testid="account-onboarding">
        <div className="account-ready-identity">
          <span className="account-ready-check" aria-hidden>
            <Check size={22} weight="bold" />
          </span>
          <div>
            <strong>{session.user?.displayName}</strong>
            <span>{session.user ? t(accountPhone(session.user.phoneMasked)) : ''}</span>
          </div>
        </div>
        {personal && (
          <div className="account-ready-space">
            <span>{t('个人空间')}</span>
            <strong>{personal.name}</strong>
          </div>
        )}
        <div className="account-ready-actions">
          <button
            className="button button-primary"
            data-testid="account-start"
            onClick={hasImage ? onContinue : onImport}
          >
            {hasImage ? t('继续编辑') : t('打开照片')}
            <ArrowRight size={18} />
          </button>
          <button className="account-ready-next" onClick={onProject} disabled={!personal}>
            <FolderPlus size={20} />
            <span>
              <strong>{t('新建云端项目')}</strong>
            </span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </AccountPageFrame>
  );
}
