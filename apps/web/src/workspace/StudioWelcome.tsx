import { ArrowUpRight, ShieldCheck } from '@phosphor-icons/react';
import { StudioGlyph } from '../components/StudioGlyph';
import { t, useI18n } from '../i18n';

/** Every first-use action opens the real editor, drawing board or assistant. */
export function StudioWelcome({
  onImport,
  onDraw,
  onAI,
  accountState = 'guest',
  onSignIn,
  onRegister,
}: {
  onImport: () => void;
  onDraw: () => void;
  onAI: () => void;
  accountState?: 'loading' | 'guest' | 'signed-in';
  onSignIn?: () => void;
  onRegister?: () => void;
}) {
  useI18n();
  return (
    <section
      className="studio-welcome studio-welcome-editorial"
      aria-labelledby="studio-welcome-title"
      data-account-state={accountState}
    >
      <div className="welcome-introduction">
        <span className="welcome-eyebrow">{t('创作工作台')}</span>
        <h1 id="studio-welcome-title">{t('编辑图片')}</h1>
        <p className="welcome-description">{t('从整体色调，到每一处细节。')}</p>
        <div className="welcome-alternatives">
          <button type="button" onClick={onDraw}>
            <StudioGlyph name="paint" size={20} />
            <span>{t('绘制草图')}</span>
            <ArrowUpRight size={16} />
          </button>
          <button type="button" onClick={onAI}>
            <StudioGlyph name="ai" size={20} />
            <span>{t('AI 助手')}</span>
            <ArrowUpRight size={16} />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="welcome-import-plane"
        aria-label={t('打开照片')}
        onClick={onImport}
      >
        <span className="welcome-photo-frame" aria-hidden="true">
          <StudioGlyph name="import" size={34} />
          <span className="welcome-frame-corner corner-tl" />
          <span className="welcome-frame-corner corner-tr" />
          <span className="welcome-frame-corner corner-bl" />
          <span className="welcome-frame-corner corner-br" />
        </span>
        <span className="welcome-import-label">
          <strong>{t('打开照片')}</strong>
          <ArrowUpRight size={21} />
        </span>
        <span className="welcome-drop-hint">{t('也可以把照片拖到这里')}</span>
      </button>
      <p className="welcome-privacy">
        <ShieldCheck size={15} />
        {t('在本地编辑，照片不会自动上传')}
      </p>
      {accountState === 'guest' && onSignIn && onRegister && (
        <div className="welcome-session" data-testid="guest-account-entry">
          <div>
            <strong>{t('云端工作空间')}</strong>
            <span>{t('保存版本与团队协作')}</span>
          </div>
          <div className="welcome-session-actions">
            <button type="button" onClick={onSignIn}>
              {t('登录')}
            </button>
            <button type="button" onClick={onRegister}>
              {t('注册账号')}
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
