import { ArrowRight, Check, FolderPlus, Image } from '@phosphor-icons/react';
import { Modal } from '../components/Ui';
import type { Session } from '../lib/types';

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
  const personal = session.spaces.find((space) => space.kind === 'personal');
  return (
    <Modal title="账号已创建" onClose={onContinue} className="account-ready-dialog" profile="form">
      <div className="account-ready" data-testid="account-onboarding">
        <div className="account-ready-identity">
          <span className="account-ready-check" aria-hidden>
            <Check size={22} weight="bold" />
          </span>
          <div>
            <strong>{session.user?.displayName}</strong>
            <span>{session.user?.phoneMasked}</span>
          </div>
        </div>
        <p>
          {personal
            ? '个人空间已就绪。你可以继续编辑，或创建项目保存作品与版本。'
            : '你已登录。可以先在本机编辑照片，空间状态将在同步后更新。'}
        </p>
        <div className="account-ready-actions">
          <button
            className="button button-primary"
            data-testid="account-start"
            onClick={onContinue}
          >
            {hasImage ? '继续编辑' : '进入工作台'}
            <ArrowRight size={18} />
          </button>
          <button className="account-ready-next" onClick={hasImage ? onProject : onImport}>
            {hasImage ? <FolderPlus size={20} /> : <Image size={20} />}
            <span>
              <strong>{hasImage ? '新建云端项目' : '打开照片'}</strong>
              <small>{hasImage ? '整理作品，保留编辑版本' : '从当前设备选择图片'}</small>
            </span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
