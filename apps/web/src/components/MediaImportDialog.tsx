import { getLocale, t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { UploadSimple, CheckCircle } from '@phosphor-icons/react';
import type { Asset, Project } from '../lib/types';
import { api, ApiError, jsonRequest, errorMessage } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import { Modal, InlineError, Busy } from './Ui';
import { MediaSourceViewer } from '../media/MediaSourceViewer';
import '../media/media.css';
interface Capabilities {
  available: boolean;
  enabled: boolean;
  nativeConfigured: boolean;
  nativeReady: boolean;
  maxPixels: number;
  maxRawPixels: number;
  maxHdrPixels: number;
  maxPsdPixels: number;
  heicPq?: { available: boolean; maxPixels: number; maxBytes: number };
  heicHlg?: { available: boolean; maxPixels: number; maxBytes: number };
  maxInputBytes: number;
  rasterFormats: string[];
  maxChunkBytes: number;
}
interface ImportJob {
  id: string;
  projectId: string;
  name: string;
  size: number;
  uploadedBytes: number;
  state: 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled';
  assetId: string | null;
  errorMessage: string | null;
  maxChunkBytes: number;
}
export function MediaImportDialog({
  project,
  onImported,
  onClose,
}: {
  project: Project;
  onImported: (asset: Asset) => void | Promise<void>;
  onClose: () => void;
}) {
  const [caps, setCaps] = useState<Capabilities | null>(null),
    [error, setError] = useState<string | null>(null),
    [file, setFile] = useState<File | null>(null),
    [job, setJob] = useState<ImportJob | null>(null),
    [asset, setAsset] = useState<Asset | null>(null),
    [uploading, setUploading] = useState(false),
    [cancelling, setCancelling] = useState(false),
    [opening, setOpening] = useState(false),
    [restorePending, setRestorePending] = useState(true),
    [restoreBlocked, setRestoreBlocked] = useState(false),
    [restoreAttempt, setRestoreAttempt] = useState(0),
    [message, setMessage] = useState(''),
    [tiles, setTiles] = useState(true);
  const controller = useRef<AbortController | null>(null),
    selected = useRef<HTMLInputElement>(null),
    attempt = useRef({ file: '', id: secureUuid() });
  const alive = useRef(true);
  const uploadLock = useRef(false),
    cancelLock = useRef(false),
    openLock = useRef(false);
  const canWrite = ['owner', 'admin', 'editor'].includes(project.role);
  const checkpoint = `media-import:${project.id}`;
  useEffect(() => {
    alive.current = true;
    setRestorePending(true);
    setRestoreBlocked(false);
    const cancel = new AbortController();
    api<Capabilities>('/media-capabilities', { signal: cancel.signal })
      .then((value) => {
        if (!cancel.signal.aborted) setCaps(value);
      })
      .catch((e) => {
        if (!cancel.signal.aborted && !(e instanceof Error && e.name === 'AbortError'))
          setError(errorMessage(e));
      });
    try {
      const saved = sessionStorage.getItem(checkpoint);
      if (saved)
        api<{ job: ImportJob; asset: Asset | null }>(`/media-imports/${saved}`, {
          signal: cancel.signal,
        })
          .then((value) => {
            if (cancel.signal.aborted) return;
            setJob(value.job);
            setAsset(value.asset);
          })
          .catch((e) => {
            if (cancel.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
            if (e instanceof ApiError && e.status === 404 && e.code === 'IMPORT_NOT_FOUND') {
              try {
                sessionStorage.removeItem(checkpoint);
              } catch {}
            } else {
              setRestoreBlocked(true);
              setError(t('上次导入的恢复记录已保留。{reason}', { reason: t(errorMessage(e)) }));
            }
          })
          .finally(() => {
            if (!cancel.signal.aborted) setRestorePending(false);
          });
      else setRestorePending(false);
    } catch {
      /* resume still available during this view */
      setRestorePending(false);
    }
    return () => {
      alive.current = false;
      cancel.abort();
      controller.current?.abort();
    };
  }, [checkpoint, restoreAttempt]);
  useEffect(() => {
    if (job?.state !== 'processing') return;
    const cancel = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api<{ job: ImportJob; asset: Asset | null }>(
          `/media-imports/${job.id}`,
          { signal: cancel.signal },
        );
        if (cancel.signal.aborted) return;
        if (cancelLock.current) {
          timer = setTimeout(() => void poll(), 1200);
          return;
        }
        setJob(value.job);
        setAsset(value.asset);
        if (value.job.state === 'failed') setError(value.job.errorMessage);
        if (value.job.state === 'processing') timer = setTimeout(() => void poll(), 1200);
      } catch (e) {
        if (!cancel.signal.aborted) {
          setError(errorMessage(e));
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    void poll();
    return () => {
      cancel.abort();
      clearTimeout(timer);
    };
  }, [job?.id, job?.state]);
  async function upload() {
    if (
      !file ||
      !caps?.available ||
      uploadLock.current ||
      cancelLock.current ||
      restorePending ||
      restoreBlocked ||
      !canWrite
    )
      return;
    uploadLock.current = true;
    setUploading(true);
    setError(null);
    setMessage('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      let current = job;
      if (!current || ['failed', 'cancelled'].includes(current.state)) {
        const fingerprint = `${file.name}:${file.size}:${file.lastModified}:${tiles}`;
        if (attempt.current.file !== fingerprint || current)
          attempt.current = { file: fingerprint, id: secureUuid() };
        current = (
          await api<{ job: ImportJob }>(`/projects/${project.id}/media-imports`, {
            ...jsonRequest('POST', {
              name: file.name,
              size: file.size,
              idempotencyKey: attempt.current.id,
              generateTiles: tiles,
            }),
            signal: abort.signal,
          })
        ).job;
        try {
          sessionStorage.setItem(checkpoint, current.id);
        } catch {
          /* optional convenience */
        }
      } else
        current = (
          await api<{ job: ImportJob }>(`/media-imports/${current.id}`, { signal: abort.signal })
        ).job;
      if (abort.signal.aborted || !alive.current) return;
      if (current.name !== file.name || current.size !== file.size)
        throw new Error('续传时请选择同一份原文件，或先取消之前的导入。');
      if (current.state !== 'uploading') {
        setJob(current);
        return;
      }
      setJob(current);
      // An interrupted acknowledgement is resolved by fetching the confirmed offset.
      // Replaying a previously confirmed chunk is checked byte-for-byte by the API.
      let offset = current.uploadedBytes;
      for (let verified = 0; verified < offset; verified += current.maxChunkBytes) {
        await api(`/media-imports/${current.id}/chunk?offset=${verified}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file.slice(verified, Math.min(offset, verified + current.maxChunkBytes)),
          signal: abort.signal,
        });
      }
      while (offset < file.size) {
        const result = await api<{ uploadedBytes: number }>(
          `/media-imports/${current.id}/chunk?offset=${offset}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file.slice(offset, offset + current.maxChunkBytes),
            signal: abort.signal,
          },
        );
        offset = result.uploadedBytes;
        current = { ...current, uploadedBytes: offset };
        if (alive.current && !abort.signal.aborted) setJob(current);
      }
      const result = await api<{ job: ImportJob }>(`/media-imports/${current.id}/complete`, {
        ...jsonRequest('POST'),
        signal: abort.signal,
      });
      if (alive.current && !abort.signal.aborted) setJob(result.job);
    } catch (e) {
      if (alive.current && !abort.signal.aborted) setError(errorMessage(e));
    } finally {
      uploadLock.current = false;
      if (alive.current) setUploading(false);
      controller.current = null;
    }
  }
  async function cancelJob() {
    if (cancelLock.current || !job || !canWrite) return;
    cancelLock.current = true;
    setCancelling(true);
    controller.current?.abort();
    setError(null);
    setMessage('');
    try {
      const result = await api<{ ok: boolean; cleanupPending: boolean }>(
        `/media-imports/${job.id}/cancel`,
        jsonRequest('POST'),
      );
      if (!alive.current) return;
      setJob(null);
      setAsset(null);
      setMessage(
        result.cleanupPending
          ? '导入已取消，服务器仍在清理临时文件。存储预占将在确认清理后释放。'
          : '导入已取消，临时存储预占已释放。',
      );
      try {
        sessionStorage.removeItem(checkpoint);
      } catch {}
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      cancelLock.current = false;
      if (alive.current) setCancelling(false);
    }
  }
  async function openAsset() {
    if (!asset || openLock.current) return;
    openLock.current = true;
    setOpening(true);
    setError(null);
    try {
      await onImported(asset);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      openLock.current = false;
      if (alive.current) setOpening(false);
    }
  }
  const progress = job ? Math.round((job.uploadedBytes / job.size) * 100) : 0;
  return (
    <Modal
      title={t('导入原件')}
      subtitle={project.title}
      onClose={onClose}
      canClose={() => !cancelLock.current && !openLock.current}
      className="studio-dialog media-import-dialog"
    >
      <div className="media-import" data-motion="media-import">
        {caps?.available ? (
          <>
            <div className="media-import-limits">
              <span>
                {t('静态栅格最多')}
                {(caps.maxPixels / 1e6).toLocaleString(getLocale())} {t('百万像素')}
              </span>
              <span>
                {t('单文件')}
                {Math.floor(caps.maxInputBytes / 1024 ** 2)} MiB
              </span>
              {caps.available && caps.heicPq?.available && (
                <span>
                  HEIC PQ · {(caps.heicPq.maxPixels / 1e6).toLocaleString(getLocale())}{' '}
                  {t('百万像素')} · {Math.floor(caps.heicPq.maxBytes / 1024 ** 2)} MiB
                </span>
              )}
              {caps.available && caps.heicHlg?.available && (
                <span>
                  HEIC / HIF HLG · {(caps.heicHlg.maxPixels / 1e6).toLocaleString(getLocale())}{' '}
                  {t('百万像素')} · {Math.floor(caps.heicHlg.maxBytes / 1024 ** 2)} MiB
                </span>
              )}
            </div>
            <div className="media-import-limits" aria-label={t('格式像素上限')}>
              <span>RAW · {(caps.maxRawPixels / 1e6).toLocaleString(getLocale())} MP</span>
              <span>HDR · {(caps.maxHdrPixels / 1e6).toLocaleString(getLocale())} MP</span>
              <span>PSD · {(caps.maxPsdPixels / 1e6).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} MP</span>
            </div>
          </>
        ) : (
          !caps && !error && <Busy label={t('正在读取原件导入能力')} />
        )}
        {!canWrite && (
          <p className="form-hint" role="status">
            {t('当前项目为只读。请选择有编辑权限的项目后导入原件。')}
          </p>
        )}
        {caps && !caps.available && (
          <p role="status" className="control-note">
            {t(
              '高精度导入暂不可用，普通图片仍可在本地编辑。',
            )}
          </p>
        )}
        {caps?.available && !caps.nativeReady && (
          <p className="control-note">
            {t('当前可处理')}
            {caps.rasterFormats.join('、')}{' '}
            {t('与 PSD 合成图；RAW / EXR / Radiance 暂不可用。')}
          </p>
        )}
        {!asset && (
          <>
            <input
              ref={selected}
              type="file"
              className="sr-only"
              aria-label={t('选择高精度原件')}
              disabled={
                !caps?.available ||
                !canWrite ||
                uploading ||
                cancelling ||
                restorePending ||
                restoreBlocked ||
                job?.state === 'processing'
              }
              onChange={(event) => {
                const next = event.target.files?.[0];
                event.target.value = '';
                if (next) {
                  if (!caps) return;
                  if (next.size < 1 || next.size > caps.maxInputBytes) {
                    setError(
                      next.size < 1
                        ? t('请选择有内容的原件文件。')
                        : t('文件超过当前 {v0} MiB 上限。', {
                            v0: Math.floor(caps.maxInputBytes / 1024 ** 2),
                          }),
                    );
                    return;
                  }
                  setFile(next);
                  setError(null);
                  setMessage('');
                }
              }}
            />
            <button
              className="media-file-picker"
              disabled={
                !caps?.available ||
                !canWrite ||
                uploading ||
                cancelling ||
                restorePending ||
                restoreBlocked ||
                job?.state === 'processing'
              }
              onClick={() => selected.current?.click()}
            >
              <UploadSimple size={24} />
              <span>
                {file?.name ?? t('选择原件')}
                <small>
                  {file
                    ? `${(file.size / 1024 ** 2).toFixed(2)} MiB`
                    : t('JPEG、TIFF、PNG、RAW、PSD、HDR 等，按实际解码能力验证')}
                </small>
              </span>
            </button>
            <label className="media-check">
              <input
                type="checkbox"
                checked={tiles}
                disabled={
                  !canWrite || !!job || uploading || cancelling || restorePending || restoreBlocked
                }
                onChange={(event) => setTiles(event.target.checked)}
              />
              {t('建立分级图块，便于按原尺寸查看细节')}
            </label>
          </>
        )}
        {job && (
          <div className="media-upload-progress" role="status">
            <div>
              <span>
                {job.state === 'processing'
                  ? t('已上传，正在隔离处理')
                  : job.state === 'ready'
                    ? t('原件与母版已保存')
                    : job.state === 'failed'
                      ? t('处理未完成')
                      : job.state === 'cancelled'
                        ? t('已取消')
                        : uploading
                          ? t('正在上传')
                          : t('上传已暂停，可选择同一文件继续')}
              </span>
              <span>{progress}%</span>
            </div>
            <progress max={100} value={progress} aria-label={t('原件上传进度')} />
            <small>
              {job.name} · {(job.uploadedBytes / 1024 ** 2).toFixed(1)} /{' '}
              {(job.size / 1024 ** 2).toFixed(1)} MiB
            </small>
          </div>
        )}
        <InlineError message={error} />
        {restorePending && <Busy label={t('正在恢复上次导入状态')} />}
        {(restoreBlocked || (!caps && error)) && (
          <button
            type="button"
            className="button button-secondary"
            disabled={restorePending}
            onClick={() => {
              setError(null);
              setRestoreAttempt((value) => value + 1);
            }}
          >
            {restoreBlocked ? t('重新读取导入状态') : t('重新读取导入能力')}
          </button>
        )}
        {message && (
          <p className="success-note" role="status">
            {t(message)}
          </p>
        )}
        {asset ? (
          <>
            <MediaSourceViewer assetId={asset.id} />
            <button
              className="button button-primary"
              disabled={opening}
              onClick={() => void openAsset()}
            >
              {opening ? (
                <Busy label={t('正在打开工作预览')} />
              ) : (
                <>
                  <CheckCircle size={17} />
                  {t('使用工作预览继续编辑')}
                </>
              )}
            </button>
          </>
        ) : (
          <div className="media-import-actions">
            {job && ['uploading', 'processing'].includes(job.state) && (
              <button
                className="text-button"
                disabled={cancelling || !canWrite}
                onClick={() => void cancelJob()}
              >
                {cancelling ? t('正在取消…') : t('取消导入')}
              </button>
            )}
            <button
              className="button button-primary"
              disabled={
                !file ||
                !caps?.available ||
                !canWrite ||
                uploading ||
                cancelling ||
                restorePending ||
                restoreBlocked ||
                job?.state === 'processing'
              }
              onClick={() => void upload()}
            >
              {uploading ? (
                <Busy label={t('上传中')} />
              ) : job?.state === 'uploading' ? (
                t('继续上传')
              ) : (
                t('导入原件')
              )}
            </button>
          </div>
        )}
        <p className="control-note">
          {t(
            '原件和派生图计入空间存储。关闭后暂停上传，已开始的处理会继续。',
          )}
        </p>
      </div>
    </Modal>
  );
}
