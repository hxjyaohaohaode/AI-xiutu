import { ArrowRight, Check, FolderPlus, Image } from '@phosphor-icons/react';
import { Modal } from '../components/Ui';
import type { Session } from '../lib/types';
import { t, useLocale } from '../i18n';
import { accountPhone } from './account-model';

/** Shown only after the register endpoint returns a validated, active session. */
export function AccountReady({
  session,
  hasImage,
  onContinue,
  onImport,
  onProject,
}: {
  session: Session;
  hasImage: boolean;
  onContinue: () => void;
  onImport: () => void;
  onProject: () => void;
}) {
  useLocale();
  const personal = session.spaces.find((space) => space.kind === 'personal');
  return (
    <Modal
      title={t('账号已创建')}
      onClose={onContinue}
      className="account-ready-dialog"
      profile="form"
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
        <p>
          {personal
            ? hasImage
              ? t('空间已就绪，继续完成你的作品。')
              : t('空间已就绪，开始你的第一件作品。')
            : t('已登录，可以先在本地编辑照片。')}
        </p>
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
            onClick={onContinue}
          >
            {hasImage ? t('继续编辑') : t('进入工作台')}
            <ArrowRight size={18} />
          </button>
          <button className="account-ready-next" onClick={hasImage ? onProject : onImport}>
            {hasImage ? <FolderPlus size={20} /> : <Image size={20} />}
            <span>
              <strong>{hasImage ? t('新建云端项目') : t('打开照片')}</strong>
              <small>{hasImage ? t('保存作品与版本') : t('从设备选择图片')}</small>
            </span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
