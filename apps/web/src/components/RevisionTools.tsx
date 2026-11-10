import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowClockwise,
  DownloadSimple,
  GitBranch,
  CheckCircle,
  Clock,
} from '@phosphor-icons/react';
import { api, downloadBlob, errorMessage, filenameBase, jsonRequest } from '../lib/api';
import type { Artwork } from '../lib/types';
import { Busy, InlineError, Modal } from './Ui';
import { MotionDetails } from '../motion/Presence';
import {
  clearRevisionFork,
  completeRevisionFork,
  fetchRevisionPng,
  freezeRevisionFork,
  openRevisionForkResult,
  persistRevisionFork,
  readRevisionFork,
  revisionForkReceipt,
  revisionForkRejected,
  revisionForkStorageKey,
  revisionRenderLimitLabels,
  revisionRenderState,
  validateRevisionRenderInfo,
  type RevisionForkCheckpoint,
  type RevisionForkSuccess,
  type RevisionReference,
  type RevisionRenderInfo,
} from './revision-tools-model';
import './revision-tools.css';

export type { RevisionForkSuccess, RevisionReference } from './revision-tools-model';
export type CreatedRevisionBranch = RevisionForkSuccess;
const byteLabel = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '未提供';
  if (!value) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const exponent = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** exponent).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} ${units[exponent]}`;
};

export function RevisionTools({
  actorId,
  artworkId,
  artworkTitle,
  revision,
  canFork = false,
  onForkRequested,
}: {
  actorId: string;
  artworkId: string;
  artworkTitle?: string;
  revision: RevisionReference;
  canFork?: boolean;
  onForkRequested?: () => void;
}) {
  if (revision.artworkId !== artworkId)
    return <InlineError message="请选择当前作品的已保存版本。" />;
  return (
    <div className="revision-tools">
      <RevisionRenderTools
        actorId={actorId}
        artworkId={artworkId}
        artworkTitle={artworkTitle}
        revision={revision}
      />
      {onForkRequested && (
        <button
          type="button"
          className="button button-secondary revision-fork-trigger"
          disabled={!canFork}
          onClick={onForkRequested}
          title={canFork ? '从这个已保存版本创建独立作品' : '需要项目编辑权限'}
        >
          <GitBranch size={17} aria-hidden /> 从此版本建分支
        </button>
      )}
    </div>
  );
}

export function RevisionRenderTools(props: {
  actorId: string;
  artworkId: string;
  artworkTitle?: string;
  revision: RevisionReference;
}) {
  if (props.revision.artworkId !== props.artworkId)
    return <InlineError message="请选择当前作品的已保存版本。" />;
  const identity = JSON.stringify([
    props.actorId,
    props.artworkId,
    props.revision.id,
    props.revision.assetId,
    props.revision.version,
  ]);
  return <RevisionRenderContent {...props} identity={identity} key={identity} />;
}
function RevisionRenderContent({
  actorId,
  artworkId,
  artworkTitle,
  revision,
  identity,
}: {
  actorId: string;
  artworkId: string;
  artworkTitle?: string;
  revision: RevisionReference;
  identity: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [info, setInfo] = useState<RevisionRenderInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const infoRequest = useRef<AbortController | null>(null);
  const renderRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const active = useRef(identity);
  active.current = identity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      infoRequest.current?.abort();
      renderRequest.current?.abort();
    };
  }, []);
  async function readInfo() {
    if (
      !actorId ||
      revision.artworkId !== artworkId ||
      infoRequest.current ||
      renderRequest.current
    )
      return;
    const controller = new AbortController();
    infoRequest.current = controller;
    setReading(true);
    setError(null);
    setInfo(null);
    setNotice(null);
    try {
      const value = await api<unknown>(
        `/artworks/${encodeURIComponent(artworkId)}/revisions/${encodeURIComponent(revision.id)}/render-info`,
        { signal: controller.signal },
      );
      const received = validateRevisionRenderInfo(value, revision);
      if (mounted.current && active.current === identity && !controller.signal.aborted)
        setInfo(received);
    } catch (error) {
      if (mounted.current && active.current === identity && !controller.signal.aborted)
        setError(errorMessage(error));
    } finally {
      if (infoRequest.current === controller) infoRequest.current = null;
      if (mounted.current && active.current === identity) setReading(false);
    }
  }
  async function download() {
    if (
      !info ||
      revisionRenderState(info) !== 'available' ||
      renderRequest.current ||
      infoRequest.current
    )
      return;
    const controller = new AbortController();
    renderRequest.current = controller;
    setRendering(true);
    setError(null);
    setNotice(null);
    try {
      const blob = await fetchRevisionPng(info, fetch, controller.signal);
      if (
        !mounted.current ||
        active.current !== identity ||
        controller.signal.aborted ||
        renderRequest.current !== controller
      )
        return;
      downloadBlob(blob, `${filenameBase(artworkTitle || '作品')}-v${revision.version}.png`);
      setNotice('PNG 已交给浏览器下载。');
    } catch (error) {
      if (mounted.current && active.current === identity && !controller.signal.aborted)
        setError(errorMessage(error));
    } finally {
      if (renderRequest.current === controller) {
        renderRequest.current = null;
        if (mounted.current && active.current === identity) setRendering(false);
      }
    }
  }
  const readiness = info ? revisionRenderState(info) : null;
  return (
    <MotionDetails className="revision-render" open={expanded} onOpenChange={setExpanded}>
      <summary
        onClick={() => {
          if (!expanded && !info && !reading) void readInfo();
        }}
      >
        <span>
          <DownloadSimple size={17} aria-hidden /> 服务端版本导出
        </span>
        <span>{rendering ? <Busy label="渲染中" /> : `v${revision.version}`}</span>
      </summary>
      <div className="revision-render-body">
        {reading && (
          <p className="revision-tool-status" role="status">
            <Busy label="检查版本与渲染预算" />
          </p>
        )}
        <InlineError message={error} />
        {info && (
          <>
            <p className="revision-render-state" data-state={readiness}>
              {readiness === 'available' ? (
                <>
                  <CheckCircle size={16} aria-hidden /> 这个版本可请求 PNG 导出
                </>
              ) : readiness === 'unknown-budget' ? (
                '尚未取得完整渲染预算'
              ) : (
                '这个版本暂不支持服务端导出'
              )}
            </p>
            <dl className="revision-render-facts">
              <div>
                <dt>保存的图像源</dt>
                <dd>
                  {info.source.width.toLocaleString('zh-CN')} ×{' '}
                  {info.source.height.toLocaleString('zh-CN')} px
                </dd>
              </div>
              <div>
                <dt>输出尺寸</dt>
                <dd>
                  {info.output
                    ? `${info.output.width.toLocaleString('zh-CN')} × ${info.output.height.toLocaleString('zh-CN')} px`
                    : '未提供'}
                </dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>
                  {info.source.kind === 'retained-proxy' ? '编辑代理图' : '规范化图像'} · sRGB 8 位
                </dd>
              </div>
              <div>
                <dt>文件总量</dt>
                <dd>{byteLabel(info.encodedBytes)}</dd>
              </div>
            </dl>
            {info.source.kind === 'retained-proxy' && (
              <p className="revision-tool-note">
                此处导出已保存的编辑代理版本；保留原件与高位深母版请从原件入口下载。
              </p>
            )}
            {info.limits.length > 0 && (
              <ul className="revision-render-limits">
                {info.limits.map((code) => (
                  <li key={code}>{revisionRenderLimitLabels[code] ?? code}</li>
                ))}
              </ul>
            )}
            <MotionDetails className="revision-budget">
              <summary>渲染预算</summary>
              <dl>
                <div>
                  <dt>预计工作内存</dt>
                  <dd>
                    {byteLabel(info.estimatedWorkingBytes)} /{' '}
                    {byteLabel(info.budget?.maxWorkingBytes)}
                  </dd>
                </div>
                <div>
                  <dt>文件读取上限</dt>
                  <dd>{byteLabel(info.budget?.maxEncodedBytes)}</dd>
                </div>
                <div>
                  <dt>像素上限</dt>
                  <dd>
                    {typeof info.budget?.maxRasterPixels === 'number'
                      ? `${info.budget.maxRasterPixels.toLocaleString('zh-CN')} px`
                      : '未提供'}
                  </dd>
                </div>
              </dl>
            </MotionDetails>
          </>
        )}
        {notice && (
          <p className="revision-tool-status" role="status">
            {notice}
          </p>
        )}
        <div className="revision-tool-actions">
          <button
            type="button"
            className="text-button"
            disabled={reading || rendering || !actorId}
            onClick={() => void readInfo()}
          >
            <ArrowClockwise size={15} aria-hidden /> {info ? '重新检查' : '检查版本'}
          </button>
          {rendering ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                renderRequest.current?.abort();
                renderRequest.current = null;
                setRendering(false);
                setNotice('已取消本次下载。');
              }}
            >
              <Busy label="渲染中" /> 取消
            </button>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              disabled={reading || readiness !== 'available'}
              onClick={() => void download()}
            >
              <DownloadSimple size={16} aria-hidden /> 下载 PNG
            </button>
          )}
        </div>
      </div>
    </MotionDetails>
  );
}

type ForkProps = {
  actorId: string;
  artwork: Pick<Artwork, 'id' | 'projectId' | 'title'>;
  revision: RevisionReference;
  onClose: () => void;
  onCreated: (receipt: RevisionForkSuccess) => void | boolean | Promise<void | boolean>;
};
export function RevisionForkDialog(props: ForkProps) {
  const identity = JSON.stringify([
    props.actorId,
    props.artwork.id,
    props.artwork.projectId,
    props.revision.id,
    props.revision.assetId,
    props.revision.version,
  ]);
  return <RevisionForkContent {...props} identity={identity} key={identity} />;
}
function RevisionForkContent({
  actorId,
  artwork,
  revision,
  onClose,
  onCreated,
  identity,
}: ForkProps & { identity: string }) {
  const [title, setTitle] = useState(() =>
    `${artwork.title} · v${revision.version} 分支`.slice(0, 120),
  );
  const [pending, setPending] = useState<RevisionForkCheckpoint | null>(null);
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState<'idle' | 'creating' | 'opening'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const active = useRef(identity);
  active.current = identity;
  const callbacks = useRef({ onClose, onCreated });
  callbacks.current = { onClose, onCreated };
  const current = () => mounted.current && active.current === identity;
  function restore() {
    if (lock.current) return;
    try {
      const value = readRevisionFork(window.localStorage, actorId, artwork.id);
      if (value && value.projectId !== artwork.projectId)
        throw new Error('恢复记录与当前项目不一致。');
      setPending(value);
      setReady(true);
      setError(null);
    } catch (error) {
      setReady(false);
      setError(errorMessage(error));
    }
  }
  useEffect(() => {
    mounted.current = true;
    restore();
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === revisionForkStorageKey(actorId, artwork.id))
        restore();
    };
    window.addEventListener('storage', changed);
    return () => {
      mounted.current = false;
      request.current?.abort();
      window.removeEventListener('storage', changed);
    };
  }, []);
  async function openCreated(value: RevisionForkCheckpoint, receipt: RevisionForkSuccess) {
    if (!current()) return;
    setStage('opening');
    const outcome = await openRevisionForkResult(value, receipt, {
      storage: window.localStorage,
      isCurrent: current,
      onCreated: callbacks.current.onCreated,
      onClose: () => callbacks.current.onClose(),
    });
    if (outcome === 'kept' && current()) setNotice('分支已创建，尚未打开。');
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (lock.current || !ready) return;
    lock.current = true;
    setError(null);
    setNotice(null);
    let frozen = pending;
    let firstAttempt = false;
    let sent = false;
    let accepted = false;
    try {
      const stored = readRevisionFork(window.localStorage, actorId, artwork.id);
      if (stored && stored.projectId !== artwork.projectId)
        throw new Error('恢复记录与当前项目不一致。');
      if (stored && stored.body.idempotencyKey !== frozen?.body.idempotencyKey) {
        setPending(stored);
        setNotice('发现此前的分支请求，请先恢复这次操作。');
        return;
      }
      frozen = stored ?? frozen;
      if (frozen?.created) {
        setPending(frozen);
        await openCreated(frozen, frozen.created);
        return;
      }
      if (!frozen) {
        if (!title.trim() || title.trim().length > 120)
          throw new Error('请填写 1–120 字的新作品名称。');
        frozen = freezeRevisionFork({
          actorId,
          artworkId: artwork.id,
          projectId: artwork.projectId,
          revision,
          title,
        });
        firstAttempt = true;
      }
      persistRevisionFork(window.localStorage, frozen);
      setPending(frozen);
      setStage('creating');
      const controller = new AbortController();
      request.current = controller;
      sent = true;
      const result = await api<unknown>(
        `/artworks/${encodeURIComponent(frozen.artworkId)}/fork-revision`,
        { ...jsonRequest('POST', frozen.body), signal: controller.signal },
      );
      const receipt = revisionForkReceipt(result, frozen);
      accepted = true;
      const completed = { ...frozen, created: receipt };
      try {
        completeRevisionFork(window.localStorage, frozen, receipt);
      } catch {
        if (current()) setNotice('分支已创建；未能保存本机回执，原请求标识仍保留。');
      }
      if (!current()) return;
      setPending(completed);
      await openCreated(completed, receipt);
    } catch (failure) {
      if (frozen && sent && revisionForkRejected(failure, firstAttempt, accepted)) {
        try {
          clearRevisionFork(window.localStorage, frozen);
          if (current()) setPending(null);
        } catch {
          /* Retaining the identity is safer than replacing an unreadable checkpoint. */
        }
      }
      if (current())
        setError(
          failure instanceof DOMException && failure.name === 'AbortError'
            ? '已停止等待，创建结果尚未确认。可以继续原请求。'
            : errorMessage(failure),
        );
    } finally {
      request.current = null;
      lock.current = false;
      if (current()) setStage('idle');
    }
  }
  const saved = pending?.created;
  return (
    <Modal
      title={saved ? '分支已创建' : '从历史版本创建分支'}
      subtitle={
        saved ? '可以打开这份独立作品继续编辑。' : '保留这个版本的图像源、合成图层与编辑配方。'
      }
      onClose={onClose}
      canClose={() => !lock.current}
      className="studio-dialog revision-fork-dialog"
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="revision-fork-origin">
          <GitBranch size={22} aria-hidden />
          <div>
            <strong>{artwork.title}</strong>
            <span>版本 {pending?.sourceVersion ?? revision.version} → 新的独立作品</span>
          </div>
        </div>
        <label className="field">
          新作品名称
          <input
            value={pending?.body.title ?? title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!!pending || stage !== 'idle' || !ready}
            maxLength={120}
            autoComplete="off"
          />
        </label>
        {!ready && !error && (
          <p className="revision-tool-status" role="status">
            <Busy label="读取恢复状态" />
          </p>
        )}
        {pending && !saved && (
          <div className="revision-recovery" role="status">
            <Clock size={18} aria-hidden />
            <div>
              <strong>
                {stage === 'creating' ? '正在提交这次分支操作' : '这次操作还没有确认结果'}
              </strong>
              <p>
                {stage === 'creating'
                  ? '请等待服务端返回。'
                  : '继续原请求会沿用同一版本、名称和请求标识，已创建的分支会返回原回执。'}
              </p>
            </div>
          </div>
        )}
        {saved && (
          <p className="revision-created" role="status">
            <CheckCircle size={18} aria-hidden /> 新作品已创建。打开时会重新读取它的最新版本。
          </p>
        )}
        {pending && (
          <MotionDetails className="revision-request-details">
            <summary>查看操作标识</summary>
            <dl>
              <div>
                <dt>请求 ID</dt>
                <dd>
                  <code>{pending.body.idempotencyKey}</code>
                </dd>
              </div>
              <div>
                <dt>原始版本</dt>
                <dd>
                  <code>{pending.body.revisionId}</code>
                </dd>
              </div>
              {saved && (
                <div>
                  <dt>新作品</dt>
                  <dd>
                    <code>{saved.artworkId}</code>
                  </dd>
                </div>
              )}
            </dl>
          </MotionDetails>
        )}
        <InlineError message={error} />
        {notice && (
          <p className="revision-tool-status" role="status">
            {notice}
          </p>
        )}
        <div className="revision-tool-actions">
          {stage === 'creating' ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => request.current?.abort()}
            >
              停止等待
            </button>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              disabled={stage !== 'idle'}
              onClick={onClose}
            >
              {pending ? '稍后处理' : '取消'}
            </button>
          )}
          {!ready ? (
            <button type="button" className="button button-secondary" onClick={restore}>
              <ArrowClockwise size={16} aria-hidden /> 重读恢复记录
            </button>
          ) : (
            <button
              type="submit"
              className="button"
              disabled={stage !== 'idle' || (!pending && !title.trim())}
            >
              {stage === 'creating' ? (
                <Busy label="创建中" />
              ) : stage === 'opening' ? (
                <Busy label="打开中" />
              ) : saved ? (
                '打开已创建分支'
              ) : pending ? (
                '继续原请求'
              ) : (
                '创建并打开'
              )}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
