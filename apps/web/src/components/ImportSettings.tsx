import { t } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';
import { useRef, useState } from 'react';
import { CloudArrowUp, FolderOpen, ImageSquare } from '@phosphor-icons/react';
import { PIXEL_BUDGETS, MAX_LOCAL_FILE_BYTES, localImportLimits } from '../editor/useEditor';
import type { EditorRecipe } from '@ai-xiutu/editor';
import type { Project, PublicConfig } from '../lib/types';
import { errorMessage } from '../lib/api';
import { Busy, InlineError, Modal } from './Ui';

export function ImportSettings({
  budget,
  recipeVersion,
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
  onProfessionalImport,
  onClose,
  onBack,
  embedded = false,
}: {
  budget: number;
  recipeVersion: EditorRecipe['schemaVersion'];
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
  onProfessionalImport: () => void;
  onClose: () => void;
  onBack?: () => void;
  embedded?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const canWrite = !!project && ['owner', 'admin', 'editor'].includes(project.role);
  const serverByteLimit = config?.media?.maxUploadBytes ?? config?.limits.maxUploadBytes;
  const exceedsServerLimit = !!file && !!serverByteLimit && file.size > serverByteLimit;
  const limits = localImportLimits(file ? 4 : recipeVersion, budget);
  async function serverImport() {
    if (locked.current || !canWrite || exceedsServerLimit) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await onServerImport();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function retry() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      if (await onRetry()) onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const content = (
    <>
      {file && (
        <div className="import-file-summary">
          <ImageSquare size={23} />
          <div>
            <strong>{file.name}</strong>
            <span>
              {(file.size / 1024 / 1024).toFixed(1)} {t('MiB · 尚未自动上传')}
            </span>
          </div>
        </div>
      )}
      {reason && <p className="form-hint">{reason}</p>}
      <div className="stack-form" data-motion="modal-content">
        <label>
          {t('本机处理预算')}
          <ChoiceSelect
            ariaLabel={t('本机图像像素预算')}
            value={String(limits.maxPixels)}
            disabled={busy}
            onValueChange={(value) => onBudget(Number(value))}
            options={PIXEL_BUDGETS.filter((value) => value <= limits.ceiling).map((value) => ({
              value: String(value),
              label: t('{v0} 百万像素', { v0: (value / 1e6).toFixed(1) }),
              description:
                value === 4_194_304
                  ? t('手机建议')
                  : value === 16_777_216
                    ? t('标准桌面')
                    : undefined,
            }))}
          />
        </label>
        <output className="import-budget-limit">{t('单边上限')} {limits.maxDimension} px</output>
        {file && (
          <button className="button button-primary" disabled={busy} onClick={() => void retry()}>
            {busy ? (
              <Busy />
            ) : (
              <>
                <FolderOpen size={17} />
                {t('按当前预算重新在本机打开')}
              </>
            )}
          </button>
        )}
        <details className="import-constraints">
          <summary>{t('格式与资源限制')}</summary>
          <p className="resource-budget-note">
            {t(
              '选择的上限不是设备性能保证。分块处理减少中间缓冲，但解码、原始像素和导出仍至少可能占用约',
            )}{' '}
            {Math.ceil((limits.maxPixels * 12) / 1024 / 1024)}{' '}
            {t('MiB，另有浏览器与编码器开销。内存不足时请降低预算或使用较小副本。当前本地文件上限')}{' '}
            {Math.round(MAX_LOCAL_FILE_BYTES / 1024 / 1024)} MiB。
          </p>
          <p className="fine-print">
            {t(
              '本地按文件内容识别 JPEG / PNG / WebP / 静态 GIF / BMP / AVIF，仍受浏览器解码支持及头部检查限制。TIFF、特殊AVIF或无法本地验证的格式，可以明确选择服务端规范化。',
            )}
          </p>
        </details>
      </div>
      <section className="server-import-section">
        <h3>{t('原片与专业格式')}</h3>
        <button
          className="button button-secondary"
          disabled={busy || (!!project && !canWrite)}
          onClick={!loggedIn ? onAuth : !project ? onCreateProject : onProfessionalImport}
        >
          <CloudArrowUp size={18} />
          {!loggedIn
            ? t('登录后导入原片')
            : !project
              ? t('先选择保存项目')
              : t('打开原片与专业格式')}
        </button>
        {project && !canWrite && (
          <p className="form-hint" role="status">
            {t('当前项目为只读。选择有编辑权限的项目后，可上传原件；本机编辑仍可使用。')}
          </p>
        )}
      </section>
      {file && (
        <section className="server-import-section">
          <h3>{t('需要服务端规范化？')}</h3>
          <p>
            {t('上传到当前项目并转换为单帧 PNG，不保留原编码或 EXIF。动画和多页文件不支持此方式。')}
          </p>
          <p className="fine-print">
            {t('当前服务端格式：')}
            {config?.media?.serverImport?.join(' / ').toUpperCase() || t('能力尚未读取')}
            {t('；上传上限')}{' '}
            {serverByteLimit ? `${Math.floor(serverByteLimit / 1024 / 1024)} MiB` : t('尚未读取')}
            {t(
              '。 规范化后仍要同时符合本机预算与 v3/v4 的16.8百万像素上限才能本地编辑；更大素材可保存在项目中，需明确准备较小副本后编辑。',
            )}
          </p>
          {exceedsServerLimit && (
            <p className="form-hint" role="status">
              {t(
                '这份文件超过当前服务端规范化的上传上限。可使用上方“原片与专业格式”入口查看独立原件导入能力。',
              )}
            </p>
          )}
          {!loggedIn ? (
            <button className="button button-secondary" onClick={onAuth}>
              {t('登录后选择上传')}
            </button>
          ) : !project ? (
            <button className="button button-secondary" onClick={onCreateProject}>
              {t('先创建保存项目')}
            </button>
          ) : (
            <button
              className="button button-primary"
              disabled={
                busy || !canWrite || exceedsServerLimit || !config?.media?.serverImport?.length
              }
              onClick={() => void serverImport()}
            >
              {busy ? (
                <Busy label={t('正在上传并规范化')} />
              ) : (
                <>
                  <CloudArrowUp size={18} />
                  {t('确认上传到「')}
                  {project.title}」
                </>
              )}
            </button>
          )}
        </section>
      )}
      <InlineError message={error} />
    </>
  );
  if (embedded) return content;
  return (
    <Modal
      title={t('图片导入与分辨率')}
      onClose={onClose}
      onBack={busy ? undefined : onBack}
      canClose={() => !locked.current}
      className="studio-dialog import-dialog"
    >
      {content}
    </Modal>
  );
}
