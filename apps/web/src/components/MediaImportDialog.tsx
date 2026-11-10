import { useEffect, useRef, useState } from 'react';
import { UploadSimple, CheckCircle } from '@phosphor-icons/react';
import type { Asset, Project } from '../lib/types';
import { api, jsonRequest, errorMessage } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import { Modal, InlineError, Busy } from './Ui';
import { MediaSourceViewer } from '../media/MediaSourceViewer';
import '../media/media.css';
interface Capabilities {
  available: boolean;
  enabled: boolean;
  nativeConfigured: boolean;
  maxPixels: number;
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
    [tiles, setTiles] = useState(true);
  const controller = useRef<AbortController | null>(null),
    selected = useRef<HTMLInputElement>(null),
    attempt = useRef({ file: '', id: secureUuid() });
  const alive = useRef(true);
  const checkpoint = `media-import:${project.id}`;
  useEffect(() => {
    alive.current = true;
    const cancel = new AbortController();
    api<Capabilities>('/media-capabilities', { signal: cancel.signal })
      .then(setCaps)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(errorMessage(e));
      });
    try {
      const saved = sessionStorage.getItem(checkpoint);
      if (saved)
        api<{ job: ImportJob; asset: Asset | null }>(`/media-imports/${saved}`, {
          signal: cancel.signal,
        })
          .then((value) => {
            setJob(value.job);
            setAsset(value.asset);
          })
          .catch(() => sessionStorage.removeItem(checkpoint));
    } catch {
      /* resume still available during this view */
    }
    return () => {
      alive.current = false;
      cancel.abort();
      controller.current?.abort();
    };
  }, [checkpoint]);
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
    if (!file || !caps?.available || uploading) return;
    setUploading(true);
    setError(null);
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
        if (alive.current) setJob(current);
      }
      const result = await api<{ job: ImportJob }>(`/media-imports/${current.id}/complete`, {
        ...jsonRequest('POST'),
        signal: abort.signal,
      });
      if (alive.current) setJob(result.job);
    } catch (e) {
      if (alive.current && !(e instanceof DOMException && e.name === 'AbortError'))
        setError(errorMessage(e));
    } finally {
      if (alive.current) setUploading(false);
      controller.current = null;
    }
  }
  async function cancelJob() {
    controller.current?.abort();
    if (!job) return;
    setError(null);
    try {
      await api(`/media-imports/${job.id}/cancel`, jsonRequest('POST'));
      setJob(null);
      setAsset(null);
      try {
        sessionStorage.removeItem(checkpoint);
      } catch {}
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const progress = job ? Math.round((job.uploadedBytes / job.size) * 100) : 0;
  return (
    <Modal title="保留原件，轻量编辑" subtitle={project.title} onClose={onClose}>
      <div className="media-import" data-motion="media-import">
        <p>
          高像素与专业格式经过独立处理。保留原件、16
          位母版和色彩信息，编辑器使用轻量预览；原文件不会被覆盖。
        </p>
        <div className="media-import-limits">
          <span>最高 2 亿像素静态栅格</span>
          <span>单文件 512 MiB</span>
          <span>4 MiB 分片续传</span>
        </div>
        <p className="control-note">
          RAW / HDR 上限 5000 万像素，PSD 上限约 1677
          万像素；格式支持还取决于部署的解码器。此入口不会承诺所有专业格式可无损往返。
        </p>
        {caps && !caps.available && (
          <p role="status" className="control-note">
            当前服务器尚未启用高精度素材处理。普通导入仍可使用，运营需配置 Linux
            隔离处理环境和存储容量。
          </p>
        )}
        {caps?.available && !caps.nativeConfigured && (
          <p className="control-note">
            当前可处理 {caps.rasterFormats.join('、')} 与支持的 PSD 合成图；RAW / EXR / Radiance
            需要安装原生解码器。
          </p>
        )}
        {!asset && (
          <>
            <input
              ref={selected}
              type="file"
              className="sr-only"
              aria-label="选择高精度原件"
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) {
                  if (next.size > (caps?.maxInputBytes ?? 536870912)) {
                    setError('文件超过 512 MiB');
                    return;
                  }
                  setFile(next);
                  setError(null);
                }
                event.target.value = '';
              }}
            />
            <button
              className="media-file-picker"
              disabled={!caps?.available || uploading || job?.state === 'processing'}
              onClick={() => selected.current?.click()}
            >
              <UploadSimple size={24} />
              <span>
                {file?.name ?? '选择原件'}
                <small>
                  {file
                    ? `${(file.size / 1024 ** 2).toFixed(2)} MiB`
                    : 'JPEG、TIFF、PNG、RAW、PSD、HDR 等，按实际解码能力验证'}
                </small>
              </span>
            </button>
            <label className="media-check">
              <input
                type="checkbox"
                checked={tiles}
                disabled={!!job || uploading}
                onChange={(event) => setTiles(event.target.checked)}
              />
              建立分级图块，便于按原尺寸查看细节
            </label>
          </>
        )}
        {job && (
          <div className="media-upload-progress" role="status">
            <div>
              <span>
                {job.state === 'processing'
                  ? '已上传，正在隔离处理'
                  : job.state === 'ready'
                    ? '原件与母版已保存'
                    : job.state === 'failed'
                      ? '处理未完成'
                      : job.state === 'cancelled'
                        ? '已取消'
                        : uploading
                          ? '正在上传'
                          : '上传已暂停，可选择同一文件继续'}
              </span>
              <span>{progress}%</span>
            </div>
            <progress max={100} value={progress} />
            <small>
              {job.name} · {(job.uploadedBytes / 1024 ** 2).toFixed(1)} /{' '}
              {(job.size / 1024 ** 2).toFixed(1)} MiB
            </small>
          </div>
        )}
        <InlineError message={error} />
        {asset ? (
          <>
            <MediaSourceViewer assetId={asset.id} />
            <button className="button button-primary" onClick={() => void onImported(asset)}>
              <CheckCircle size={17} />
              使用工作预览继续编辑
            </button>
          </>
        ) : (
          <div className="media-import-actions">
            {job && ['uploading', 'processing'].includes(job.state) && (
              <button className="text-button" onClick={() => void cancelJob()}>
                取消导入并清理临时文件
              </button>
            )}
            <button
              className="button button-primary"
              disabled={!file || !caps?.available || uploading || job?.state === 'processing'}
              onClick={() => void upload()}
            >
              {uploading ? (
                <Busy label="上传中" />
              ) : job?.state === 'uploading' ? (
                '继续上传'
              ) : (
                '导入原件'
              )}
            </button>
          </div>
        )}
        <p className="control-note">
          原件与派生文件计入所在空间的存储额度。关闭面板会暂停上传；处理中的任务继续运行。AI
          不会因导入而自动读取图片。
        </p>
      </div>
    </Modal>
  );
}
