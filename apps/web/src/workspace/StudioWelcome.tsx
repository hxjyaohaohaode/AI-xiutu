import {
  ArrowUpRight,
  ImageSquare,
  PencilSimple,
  ShieldCheck,
  Sparkle,
} from '@phosphor-icons/react';

/** Empty workspace actions use the same import and AI paths as the editor. */
export function StudioWelcome({
  onImport,
  onDraw,
  onAI,
}: {
  onImport: () => void;
  onDraw: () => void;
  onAI: () => void;
}) {
  return (
    <section className="studio-welcome" aria-labelledby="studio-welcome-title">
      <div className="welcome-art" aria-hidden="true">
        <span className="welcome-frame welcome-frame-back" />
        <span className="welcome-frame welcome-frame-front">
          <ImageSquare size={38} weight="light" />
        </span>
        <span className="welcome-spark">
          <Sparkle size={20} weight="fill" />
        </span>
      </div>
      <p className="welcome-eyebrow">给灵感一点空间</p>
      <h1 id="studio-welcome-title">好作品，从这一张开始。</h1>
      <p className="welcome-description">
        调一束光，留一种色彩。
        <br className="welcome-mobile-break" />
        让想法慢慢成为作品。
      </p>
      <button type="button" className="button button-primary welcome-import" onClick={onImport}>
        <ImageSquare size={20} /> 打开照片 <ArrowUpRight size={18} />
      </button>
      <p className="welcome-drop-hint">也可以把照片拖到这里</p>
      <div className="welcome-alternatives">
        <button type="button" onClick={onDraw}>
          <PencilSimple size={18} />
          <span>画一张草图</span>
          <ArrowUpRight size={14} />
        </button>
        <span aria-hidden="true" />
        <button type="button" onClick={onAI}>
          <Sparkle size={18} />
          <span>和 AI 一起创作</span>
          <ArrowUpRight size={14} />
        </button>
      </div>
      <p className="welcome-privacy">
        <ShieldCheck size={15} />
        照片先在本地编辑，导入不会自动上传
      </p>
    </section>
  );
}
