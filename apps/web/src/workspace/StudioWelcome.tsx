import { ArrowUpRight, ShieldCheck } from '@phosphor-icons/react';
import { StudioGlyph } from '../components/StudioGlyph';

/** Empty workspace actions use the same import and AI paths as the editor. */
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
  return (
    <section
      className="studio-welcome"
      aria-labelledby="studio-welcome-title"
      data-account-state={accountState}
    >
      <div className="welcome-image-symbol" aria-hidden="true">
        <StudioGlyph name="works" size={28} />
      </div>
      <h1 id="studio-welcome-title">编辑图片</h1>
      <p className="welcome-description">调色、修饰与图层合成</p>
      <button type="button" className="button button-primary welcome-import" onClick={onImport}>
        <StudioGlyph name="import" size={20} /> 打开照片 <ArrowUpRight size={18} />
      </button>
      <p className="welcome-drop-hint">也可以把照片拖到这里</p>
      <div className="welcome-alternatives">
        <button type="button" onClick={onDraw}>
          <StudioGlyph name="paint" size={19} />
          <span>绘制草图</span>
          <ArrowUpRight size={14} />
        </button>
        <span aria-hidden="true" />
        <button type="button" onClick={onAI}>
          <StudioGlyph name="ai" size={19} />
          <span>AI 助手</span>
          <ArrowUpRight size={14} />
        </button>
      </div>
      <p className="welcome-privacy">
        <ShieldCheck size={15} />
        照片先在本地编辑，导入不会自动上传
      </p>
      {accountState === 'guest' && onSignIn && onRegister && (
        <div className="welcome-session" data-testid="guest-account-entry">
          <div>
            <strong>云端工作空间</strong>
            <span>保存版本与团队协作</span>
          </div>
          <div className="welcome-session-actions">
            <button type="button" onClick={onSignIn}>
              登录
            </button>
            <button type="button" onClick={onRegister}>
              注册账号
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
