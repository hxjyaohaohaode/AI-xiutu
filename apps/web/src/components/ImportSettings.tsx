import { useState } from 'react';
import { CloudArrowUp, FolderOpen, ImageSquare } from '@phosphor-icons/react';
import { PIXEL_BUDGETS, MAX_LOCAL_FILE_BYTES } from '../editor/useEditor';
import type { Project, PublicConfig } from '../lib/types';
import { errorMessage } from '../lib/api';
import { Busy, InlineError, Modal } from './Ui';

export function ImportSettings({
  budget,
  onBudget,
  file,
  reason,
  config,
  project,
  loggedIn,
  onAuth,
  onCreateProject,
  onRetry,
  onServerImport,
  onClose,
}: {
  budget: number;
  onBudget: (value: number) => void;
  file: File | null;
  reason: string | null;
  config: PublicConfig | null;
  project: Project | null;
  loggedIn: boolean;
  onAuth: () => void;
  onCreateProject: () => void;
  onRetry: () => Promise<boolean>;
  onServerImport: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const small = window.matchMedia('(pointer: coarse) and (max-width: 959px)').matches;
  async function serverImport() {
    setBusy(true);
    setError(null);
    try {
      await onServerImport();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    setBusy(true);
    setError(null);
    try {
      if (await onRetry()) onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="图片导入与分辨率"
      subtitle="原图保留。更高的资源预算需要你明确选择。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {file && (
        <div className="import-file-summary">
          <ImageSquare size={23} />
          <div>
            <strong>{file.name}</strong>
            <span>{(file.size / 1024 / 1024).toFixed(1)} MiB · 尚未自动上传</span>
          </div>
        </div>
      )}
      {reason && <p className="form-hint">{reason}</p>}
      <div className="stack-form">
        <label>
          本机处理预算
          <select
            aria-label="本机图像像素预算"
            value={budget}
            disabled={busy}
            onChange={(event) => onBudget(Number(event.target.value))}
          >
            {PIXEL_BUDGETS.map((value) => (
              <option key={value} value={value} disabled={small && value > 16_777_216}>
                {(value / 1e6).toFixed(1)} 百万像素
                {value === 4_194_304
                  ? ' · 手机建议'
                  : value === 16_777_216
                    ? ' · 标准桌面'
                    : value === 40_000_000
                      ? ' · 高分辨率'
                      : ' · 高内存设备'}
              </option>
            ))}
          </select>
        </label>
        <p className="resource-budget-note">
          选择的上限不是设备性能保证。分块处理减少中间缓冲，但解码、原始像素和导出仍至少可能占用约{' '}
          {Math.ceil((budget * 12) / 1024 / 1024)}{' '}
          MiB，另有浏览器与编码器开销。内存不足时请降低预算或使用较小副本。当前本地文件上限{' '}
          {Math.round(MAX_LOCAL_FILE_BYTES / 1024 / 1024)} MiB。
        </p>
        <p className="fine-print">
          本地按文件内容识别 JPEG / PNG / WebP / 静态 GIF / BMP /
          AVIF，仍受浏览器解码支持及头部检查限制。TIFF、特殊AVIF或无法本地验证的格式，可以明确选择服务端规范化。
        </p>
        {file && (
          <button className="button button-secondary" disabled={busy} onClick={() => void retry()}>
            {busy ? (
              <Busy />
            ) : (
              <>
                <FolderOpen size={17} />
                按当前预算重新在本机打开
              </>
            )}
          </button>
        )}
      </div>
      {file && (
        <section className="server-import-section">
          <h3>需要服务端规范化？</h3>
          <p>
            确认后会把文件上传到当前项目，检查并转为单帧
            PNG，保存为一份新作品。不是原文件备份：不保留原编码、EXIF、动画或多页结构；动画及多页文件会拒绝。
          </p>
          <p className="fine-print">
            当前服务端格式：
            {config?.media?.serverImport?.join(' / ').toUpperCase() || '能力尚未读取'}；上传上限{' '}
            {Math.floor(
              (config?.media?.maxUploadBytes ?? config?.limits.maxUploadBytes ?? 0) / 1024 / 1024,
            )}{' '}
            MiB。规范化后仍要符合本机预算才能本地编辑。
          </p>
          {!loggedIn ? (
            <button className="button button-secondary" onClick={onAuth}>
              登录后选择上传
            </button>
          ) : !project ? (
            <button className="button button-secondary" onClick={onCreateProject}>
              先创建保存项目
            </button>
          ) : (
            <button
              className="button button-primary"
              disabled={busy || !config?.media?.serverImport?.length}
              onClick={() => void serverImport()}
            >
              {busy ? (
                <Busy label="正在上传并规范化" />
              ) : (
                <>
                  <CloudArrowUp size={18} />
                  确认上传到「{project.title}」
                </>
              )}
            </button>
          )}
        </section>
      )}
      <InlineError message={error} />
    </Modal>
  );
}
