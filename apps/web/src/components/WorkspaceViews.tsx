import { getLocale, t } from '../i18n';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  ArrowSquareOut,
  Check,
  ChatCircleDots,
  Circle,
  Clock,
  FileText,
  Images,
  Plus,
  ShareNetwork,
  DownloadSimple,
  UploadSimple,
  CheckCircle,
  NotePencil,
  Copy,
  ArrowClockwise,
  Eye,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import {
  api,
  ApiError,
  downloadBlob,
  errorMessage,
  filenameBase,
  formatDate,
  jsonRequest,
} from '../lib/api';
import type {
  Asset,
  Artwork,
  Comment,
  Project,
  ProjectDocument,
  Revision,
  RevisionSummary,
  Task,
} from '../lib/types';
import { Busy, EmptyState, IconButton, InlineError, Modal } from './Ui';
import { ChoiceSelect } from './ChoiceSelect';
import { ImagePreview } from './ImagePreview';
import { CompareReveal } from './CompareReveal';
import { FeatureSkeleton } from './DeferredFeature';
import { interactionText } from '../workspace/interaction-copy';
import { RevisionTools, RevisionForkDialog, type CreatedRevisionBranch } from './RevisionTools';
import { MotionDetails } from '../motion/Presence';
import { useConfirmation } from './ConfirmationDialog';
import { confirmStableScope } from '../lib/confirmation-scope';
import { PixelCanvas } from '../editor/CanvasStage';
import { localPixelBudget, type EditorState } from '../editor/useEditor';
import { appendRevisionHistoryPage, type RevisionHistoryPage } from '../lib/revisionHistory';
import type { RGBAImage } from '@ai-xiutu/editor';
import {
  documentDrafts,
  isDocumentSaveReceipt,
  projectDocumentsFromResponse,
  serializeDocumentDraft,
} from '../account/document-drafts';
import '../ai/decisions.css';

// These gates reflect the API's current project role. The API remains authoritative.
export function workspacePermissions(role: string) {
  return {
    edit: ['owner', 'admin', 'editor'].includes(role),
    comment: ['owner', 'admin', 'editor', 'reviewer'].includes(role),
    share: ['owner', 'admin'].includes(role),
  };
}

export function canResolveProjectComment(
  role: string,
  currentUserId: string | undefined,
  authorId: string | undefined,
) {
  const permissions = workspacePermissions(role);
  return (
    permissions.comment && (permissions.edit || (!!currentUserId && authorId === currentUserId))
  );
}

export function WorksView({
  project,
  artworks,
  assets,
  onOpen,
  onImport,
  onCreate,
  onCopy,
  onShare,
}: {
  project: Project | null;
  artworks: Artwork[];
  assets: Asset[];
  onOpen: (artwork: Artwork) => void;
  onImport: () => void;
  onCreate: () => void;
  onCopy: () => void;
  onShare: () => void;
}) {
  return (
    <div className="content-view studio-view works-view">
      <div className="view-heading" data-motion="view-header">
        <div>
          <h1>{project?.title ?? t('项目作品')}</h1>
          {project?.description && <p>{project.description}</p>}
        </div>
        <div className="view-actions">
          {project && (
            <>
              <button className="button button-secondary" onClick={onCopy}>
                <Copy size={17} />
                {t('复制到空间')}
              </button>
              {['owner', 'admin'].includes(project.role) && (
                <button className="button button-secondary" onClick={onShare}>
                  <ShareNetwork size={17} />
                  {t('共享')}
                </button>
              )}
            </>
          )}
          <button className="button button-primary" onClick={onImport}>
            <Plus size={17} />
            {t('导入照片')}
          </button>
        </div>
      </div>
      {project && artworks.length > 0 && (
        <div className="studio-view-meta">
          <span>
            <Images size={16} />
            {artworks.length} {t('件作品')}
          </span>
        </div>
      )}
      {!project ? (
        <EmptyState
          icon={<Images size={34} />}
          title={t('创建项目')}
          description={t('创建项目后，可以保存照片、调整配方和每次修改的版本。')}
          action={
            <button className="button button-secondary" onClick={onCreate}>
              {t('创建项目')}
              <ArrowRight size={16} />
            </button>
          }
        />
      ) : !artworks.length ? (
        <EmptyState
          icon={<Images size={34} />}
          title={t('这里还没有作品')}
          description={t('打开照片开始编辑，再点击「保存版本」，它就会出现在这里。')}
          action={
            <button className="button button-secondary" onClick={onImport}>
              <UploadSimple size={17} />
              {t('打开照片')}
            </button>
          }
        />
      ) : (
        <div className="artwork-grid">
          {artworks.map((work) => {
            const asset = assets.find((a) => a.id === work.assetId);
            return (
              <button key={work.id} className="artwork-card" onClick={() => onOpen(work)}>
                <div
                  className="artwork-cover"
                  style={{ aspectRatio: asset ? `${asset.width} / ${asset.height}` : '4 / 3' }}
                  data-motion="artwork-media"
                  data-motion-pixels="true"
                >
                  {asset?.thumbnailUrl ||
                  (asset && asset.width * asset.height <= localPixelBudget()) ? (
                    <img src={asset!.thumbnailUrl ?? asset!.url} alt={work.title} loading="lazy" />
                  ) : (
                    <div className="large-source-cover">
                      <Images size={36} />
                      {asset && (
                        <small>
                          {asset.width}×{asset.height} {t('· 大尺寸原件')}
                        </small>
                      )}
                    </div>
                  )}
                  <span>
                    {t('打开编辑')}
                    <ArrowSquareOut size={15} />
                  </span>
                </div>
                <div className="artwork-card-meta" data-motion="artwork-meta">
                  <strong>{work.title}</strong>
                  <span>
                    {t('版本')}
                    {work.headVersion}
                    <i /> {formatDate(work.updatedAt)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ComparisonFrame({ image }: { image: RGBAImage | null }) {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const fit = image
    ? Math.max(0.001, Math.min((size.width - 20) / image.width, (size.height - 20) / image.height))
    : 1;
  return (
    <div className="comparison-image-region" ref={area}>
      <div
        className="comparison-image-frame"
        style={{ width: image ? image.width * fit : 1, height: image ? image.height * fit : 1 }}
      >
        <PixelCanvas image={image} />
      </div>
    </div>
  );
}
export function CompareView({
  editor,
  artwork,
  onOpenRevision,
  onRestoreRevision,
  currentUserId,
  onForkCreated,
  isDirty = true,
  canRestore = false,
}: {
  editor: EditorState;
  artwork: Artwork | null;
  onOpenRevision: (revision: RevisionSummary) => void | Promise<void>;
  onRestoreRevision?: (revision: RevisionSummary) => Promise<void>;
  currentUserId?: string;
  onForkCreated?: (result: CreatedRevisionBranch) => Promise<boolean | void>;
  isDirty?: boolean;
  canRestore?: boolean;
}) {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [nextBeforeVersion, setNextBeforeVersion] = useState<number | null>(null);
  const [historyHeadVersion, setHistoryHeadVersion] = useState<number | null>(null);
  const [historyReadFailed, setHistoryReadFailed] = useState(false);
  const historyRows = useRef<RevisionSummary[]>([]);
  const historyRequest = useRef<AbortController | null>(null);
  const historyScope = useRef('');
  historyScope.current = `${artwork?.id ?? ''}:${artwork?.headVersion ?? ''}`;
  const [busyRevision, setBusyRevision] = useState<string | null>(null);
  const [forkRevision, setForkRevision] = useState<RevisionSummary | null>(null);
  const [restore, setRestore] = useState<{
    revision: RevisionSummary;
    artworkId: string;
    headVersion: number;
  } | null>(null);
  const scope = useRef(historyScope.current);
  scope.current = historyScope.current;
  const [mode, setMode] = useState<'slide' | 'side' | 'original' | 'edited'>('slide');
  const [split, setSplit] = useState(50);
  const slideAvailable = !!editor.originalPreview && !!editor.rendered &&
    editor.originalPreview.width === editor.rendered.width &&
    editor.originalPreview.height === editor.rendered.height;
  const visibleMode = mode === 'slide' && !slideAvailable ? 'side' : mode;
  const historyChanged =
    !!artwork && historyHeadVersion !== null && historyHeadVersion > artwork.headVersion;
  async function loadHistory(beforeVersion?: number) {
    if (!artwork || historyRequest.current) return;
    const expected = historyScope.current;
    const controller = new AbortController();
    historyRequest.current = controller;
    setLoadingRevisions(true);
    setHistoryReadFailed(false);
    setError(null);
    try {
      const query =
        beforeVersion === undefined
          ? '?summary=true'
          : `?summary=true&beforeVersion=${beforeVersion}`;
      const response = await api<RevisionHistoryPage>(`/artworks/${artwork.id}/revisions${query}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || historyScope.current !== expected) return;
      const page = appendRevisionHistoryPage(
        beforeVersion === undefined ? [] : historyRows.current,
        response,
        artwork.id,
        beforeVersion,
      );
      historyRows.current = page.revisions;
      setRevisions(page.revisions);
      setNextBeforeVersion(page.nextBeforeVersion);
      setHistoryHeadVersion((previous) =>
        page.headVersion === null ? previous : Math.max(previous ?? 0, page.headVersion),
      );
    } catch (failure) {
      if (!controller.signal.aborted && historyScope.current === expected) {
        setHistoryReadFailed(true);
        setError(errorMessage(failure));
      }
    } finally {
      if (historyRequest.current === controller) {
        historyRequest.current = null;
        if (!controller.signal.aborted && historyScope.current === expected)
          setLoadingRevisions(false);
      }
    }
  }
  useEffect(() => {
    historyRequest.current?.abort();
    historyRequest.current = null;
    historyRows.current = [];
    setRevisions([]);
    setNextBeforeVersion(null);
    setHistoryHeadVersion(null);
    setHistoryReadFailed(false);
    setError(null);
    setRestore(null);
    setForkRevision(null);
    setBusyRevision(null);
    if (!artwork) {
      setLoadingRevisions(false);
      return;
    }
    void loadHistory();
    return () => {
      historyRequest.current?.abort();
      historyRequest.current = null;
    };
  }, [artwork?.id, artwork?.headVersion, currentUserId]);
  async function openRevision(revision: RevisionSummary) {
    if (busyRevision) return;
    const expected = scope.current;
    setBusyRevision(revision.id);
    setError(null);
    try {
      await onOpenRevision(revision);
    } catch (failure) {
      if (scope.current === expected) setError(errorMessage(failure));
    } finally {
      if (scope.current === expected) setBusyRevision(null);
    }
  }
  async function restoreRevision() {
    if (!restore || !canRestore || !onRestoreRevision || busyRevision || isDirty || historyChanged)
      return;
    if (artwork?.id !== restore.artworkId || artwork.headVersion !== restore.headVersion) {
      setError('当前作品版本已改变，请重新查看历史后恢复。');
      return;
    }
    const expected = scope.current;
    setBusyRevision(restore.revision.id);
    setError(null);
    try {
      await onRestoreRevision(restore.revision);
      if (scope.current === expected) setRestore(null);
    } catch (failure) {
      if (scope.current === expected) setError(errorMessage(failure));
    } finally {
      if (scope.current === expected) setBusyRevision(null);
    }
  }
  if (!editor.file)
    return (
      <div className="content-view studio-view">
        <EmptyState
          icon={<Images size={34} />}
          title={t('先打开一张图片')}
        />
      </div>
    );
  return (
    <div className="content-view studio-view compare-view">
      <div className="view-heading" data-motion="view-header">
        <div>
          <h1 className="view-artwork-title">{artwork?.title ?? editor.file.name}</h1>
        </div>
        <div className="compare-mode-choice" role="group" aria-label={t('对比显示方式')}>
          {(['slide', 'side', 'original', 'edited'] as const).map((item) => (
            <button key={item} type="button" aria-pressed={visibleMode === item}
              className={visibleMode === item ? 'selected' : ''}
              disabled={item === 'slide' && !slideAvailable}
              title={item === 'slide' && !slideAvailable ? t('不同画幅请使用并排对比') : undefined}
              onClick={() => setMode(item)}>
              {t(({ slide: '滑动对比', side: '并排', original: '原图', edited: '当前' })[item])}
            </button>
          ))}
        </div>
      </div>
      {visibleMode === 'slide' ? (
        <CompareReveal before={editor.originalPreview} after={editor.rendered} value={split} onChange={setSplit} />
      ) : (
        <div className={`compare-pair ${visibleMode !== 'side' ? 'single' : ''}`}>
          {visibleMode !== 'edited' && (
            <section><header><span>{t('原始图片')}</span></header><ComparisonFrame image={editor.originalPreview} /></section>
          )}
          {visibleMode !== 'original' && (
            <section>
              <header><span>{t('当前编辑')}</span><small aria-live="polite">{editor.rendering ? t('正在更新') : isDirty ? t('本地草稿') : t('当前预览')}</small></header>
              <ComparisonFrame image={editor.rendered} />
            </section>
          )}
        </div>
      )}
      <InlineError message={error} />
      {artwork && (
        <MotionDetails className="saved-versions">
          <summary>
            {t('云端版本')}
            {revisions.length > 0 ? t('· 已载入 {v0}', { v0: revisions.length }) : ''}
            <span>
              {t('当前 V')}
              {artwork.headVersion} {t('· 恢复会保留已有版本')}
            </span>
          </summary>
          {loadingRevisions &&
            (revisions.length ? (
              <Busy label={t('正在读取版本')} />
            ) : (
              <FeatureSkeleton profile="panel" label={t('正在读取版本')} compact />
            ))}
          {!loadingRevisions && !revisions.length && !historyReadFailed && (
            <p className="control-note">{t('尚未读取到保存版本。')}</p>
          )}
          <div className="version-list">
            {revisions.map((revision) => (
              <div className="revision-entry" key={revision.id} data-motion="revision-entry">
                <button
                  className="revision-open"
                  disabled={!!busyRevision}
                  onClick={() => void openRevision(revision)}
                >
                  <Clock size={19} />
                  <div>
                    <strong>{revision.label || t('版本 {v0}', { v0: revision.version })}</strong>
                    <small>{formatDate(revision.createdAt)}</small>
                  </div>
                  <span>
                    {busyRevision === revision.id ? (
                      <Busy label="" />
                    ) : (
                      t('V{v0}{v1}', {
                        v0: revision.version,
                        v1: revision.version === artwork.headVersion ? t(' · 当前') : '',
                      })
                    )}
                  </span>
                </button>
                <MotionDetails className="revision-more">
                  <summary>{t('版本详情与操作')}</summary>
                  <span className="revision-source-note">
                    {revision.assetId !== artwork.assetId
                      ? t('使用此版本自己的原图来源')
                      : t('与当前作品使用同一原图')}{' '}
                    {t('· 打开为本地草稿')}
                  </span>
                  {currentUserId && (
                    <RevisionTools
                      actorId={currentUserId}
                      artworkId={artwork.id}
                      artworkTitle={artwork.title}
                      revision={revision}
                      canFork={canRestore && !!onForkCreated}
                      onForkRequested={() => setForkRevision(revision)}
                    />
                  )}
                  {canRestore && onRestoreRevision && revision.version !== artwork.headVersion && (
                    <button
                      className="revision-restore text-button"
                      disabled={!!busyRevision || isDirty || historyChanged}
                      title={
                        historyChanged
                          ? t('云端版本已更新，请重新打开作品后再恢复')
                          : isDirty
                            ? t('先保存或撤销本地修改后再恢复云端版本')
                            : undefined
                      }
                      onClick={() =>
                        setRestore({
                          revision,
                          artworkId: artwork.id,
                          headVersion: artwork.headVersion,
                        })
                      }
                    >
                      {t('恢复为新版本')}
                    </button>
                  )}
                </MotionDetails>
              </div>
            ))}
          </div>
          {(nextBeforeVersion !== null || historyReadFailed) && (
            <button
              className="button button-secondary"
              disabled={loadingRevisions || !!busyRevision}
              onClick={() => void loadHistory(nextBeforeVersion ?? undefined)}
            >
              {loadingRevisions
                ? t('正在读取版本…')
                : historyReadFailed
                  ? t('重试读取版本')
                  : t('加载更早版本')}
            </button>
          )}
          {historyChanged && (
            <p className="control-note" role="status">
              {t('云端已更新至 V')}
              {historyHeadVersion}
              {t('。历史仍可查看；请重新打开作品后再恢复版本。')}
            </p>
          )}
          {isDirty && canRestore && onRestoreRevision && (
            <p className="control-note">
              {t('先保存或撤销本地修改后，才能将历史恢复为云端新版本。')}
            </p>
          )}
        </MotionDetails>
      )}
      {forkRevision &&
        artwork &&
        forkRevision.artworkId === artwork.id &&
        currentUserId &&
        onForkCreated && (
          <RevisionForkDialog
            actorId={currentUserId}
            artwork={artwork}
            revision={forkRevision}
            onClose={() => setForkRevision(null)}
            onCreated={onForkCreated}
          />
        )}
      {restore && canRestore && (
        <Modal
          title={t('恢复 V{v0}', { v0: restore.revision.version })}
          subtitle={t('恢复会追加新版本，所有已有版本继续保留。')}
          canClose={() => !busyRevision}
          onClose={() => setRestore(null)}
        >
          <div className="ai-decision-confirm" data-motion="revision-restore">
            <p>
              {t('使用 V')}
              {restore.revision.version} {t('当时的原始图片与完整编辑配方，接在当前 V')}
              {restore.headVersion} {t('之后。不会把旧配方套用到另一张原图。')}
            </p>
            {isDirty && (
              <p className="parameter-error">
                {t('本地又有了未保存修改，请先保存或撤销，再恢复历史。')}
              </p>
            )}
            {historyChanged && (
              <p className="parameter-error">
                {t('云端已更新至 V')}
                {historyHeadVersion}
                {t('，请重新打开作品后再恢复。')}
              </p>
            )}
            <InlineError message={error} />
            <div className="ai-result-actions">
              <button
                className="button button-secondary"
                disabled={!!busyRevision}
                onClick={() => setRestore(null)}
              >
                {t('返回')}
              </button>
              <button
                className="button button-primary"
                disabled={
                  !!busyRevision ||
                  historyChanged ||
                  isDirty ||
                  artwork?.id !== restore.artworkId ||
                  artwork?.headVersion !== restore.headVersion
                }
                onClick={() => void restoreRevision()}
              >
                {busyRevision ? <Busy label={t('恢复中')} /> : t('确认恢复为新版本')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function CollaborateView({
  project,
  artwork,
  revision,
  refreshToken,
  onShare,
  currentUserId,
  embedded = false,
  onExpand,
  onReturnToEditor,
}: {
  embedded?: boolean;
  onExpand?: () => void;
  onReturnToEditor?: () => void;
  project: Project;
  artwork: Artwork | null;
  revision: Revision | null;
  refreshToken: number;
  onShare: () => void;
  currentUserId?: string;
}) {
  const permissions = workspacePermissions(project.role);
  const [comments, setComments] = useState<Comment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [body, setBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;
  const mutationLock = useRef(false);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [scope, setScope] = useState<'project' | 'version'>('project');
  const [commentFilter, setCommentFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [showCompleted, setShowCompleted] = useState(true);
  const [panelSection, setPanelSection] = useState<'discussion' | 'tasks'>('discussion');
  const requestGeneration = useRef(0);
  const activeProject = useRef<string | null>(project.id);
  activeProject.current = project.id;

  async function load(signal?: AbortSignal) {
    const generation = ++requestGeneration.current;
    const [c, t] = await Promise.all([
      api<{ comments: Comment[] }>(`/projects/${project.id}/comments`, { signal }),
      api<{ tasks: Task[] }>(`/projects/${project.id}/tasks`, { signal }),
    ]);
    if (
      signal?.aborted ||
      generation !== requestGeneration.current ||
      activeProject.current !== project.id
    )
      return;
    setComments(c.comments);
    setTasks(t.tasks);
    setHasLoaded(true);
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void load(controller.signal)
      .catch((e) => !controller.signal.aborted && setError(errorMessage(e)))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [project.id, refreshToken, reloadToken]);
  useEffect(() => {
    activeProject.current = project.id;
    return () => {
      activeProject.current = null;
      requestGeneration.current++;
    };
  }, [project.id]);
  useEffect(() => {
    if (!artwork || !revision || revision.artworkId !== artwork.id) setScope('project');
  }, [artwork?.id, revision?.id]);

  async function mutate(key: string, action: () => Promise<void>) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setPending(key);
    setError(null);
    try {
      await action();
      if (activeProject.current === project.id) await load();
    } catch (e) {
      if (activeProject.current === project.id) setError(errorMessage(e));
    } finally {
      mutationLock.current = false;
      if (activeProject.current === project.id) setPending(null);
    }
  }
  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!permissions.comment || !body.trim() || body.trim().length > 5000) return;
    if (scope === 'version' && (!artwork || !revision || revision.artworkId !== artwork.id)) {
      setError('当前作品版本已变化，请重新选择讨论范围。');
      return;
    }
    await mutate('comment', async () => {
      await api(
        `/projects/${project.id}/comments`,
        jsonRequest('POST', {
          body: body.trim(),
          ...(scope === 'version' && artwork && revision
            ? { artworkId: artwork.id, revisionId: revision.id }
            : {}),
        }),
      );
      if (activeProject.current === project.id) setBody('');
    });
  }
  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!permissions.edit || !taskTitle.trim() || taskTitle.trim().length > 120) return;
    await mutate('task', async () => {
      await api(`/projects/${project.id}/tasks`, jsonRequest('POST', { title: taskTitle.trim() }));
      if (activeProject.current === project.id) setTaskTitle('');
    });
  }
  async function changeTask(task: Task) {
    if (!permissions.edit) return;
    await mutate(`task:${task.id}`, async () => {
      await api(
        `/tasks/${task.id}`,
        jsonRequest('PATCH', {
          expectedVersion: task.version,
          status: task.status === 'done' ? 'todo' : task.status === 'todo' ? 'doing' : 'done',
        }),
      );
    });
  }
  async function resolve(comment: Comment) {
    if (!canResolveProjectComment(project.role, currentUserId, comment.authorId)) return;
    await mutate(`comment:${comment.id}`, async () => {
      await api(`/comments/${comment.id}`, jsonRequest('PATCH', { resolved: !comment.resolved }));
    });
  }
  const openComments = comments.filter((comment) => !comment.resolved).length;
  const completedTasks = tasks.filter((task) => task.status === 'done').length;
  const visibleComments = comments.filter(
    (comment) =>
      commentFilter === 'all' ||
      (commentFilter === 'resolved' ? comment.resolved : !comment.resolved),
  );
  const visibleTasks = tasks.filter((task) => showCompleted || task.status !== 'done');
  return (
    <div
      className={`content-view studio-view collaboration-view${embedded ? ' collaboration-panel' : ''}`}
    >
      <div className="view-heading" data-motion="view-header">
        <div className="collaboration-heading-title">
          <h1>{project.title}</h1>
          {!embedded && !loading && hasLoaded && (
            <dl className="collaboration-heading-stats" aria-label={t('项目协作概览')}>
              <div>
                <dt>{t('待解决')}</dt>
                <dd>{openComments}</dd>
              </div>
              <div>
                <dt>{t('进行中')}</dt>
                <dd>{tasks.filter((task) => task.status === 'doing').length}</dd>
              </div>
              <div>
                <dt>{t('已完成')}</dt>
                <dd>{completedTasks}</dd>
              </div>
            </dl>
          )}
        </div>
        <div className="view-actions">
          {!embedded && onReturnToEditor && (
            <button type="button" className="button button-quiet" onClick={onReturnToEditor}>
              <ArrowLeft size={17} />
              {interactionText('keepEditing')}
            </button>
          )}
          {embedded && onExpand && (
            <IconButton label={interactionText('expandCollaboration')} onClick={onExpand}>
              <ArrowSquareOut size={17} />
            </IconButton>
          )}
          <button
            className="button button-secondary"
            onClick={() => setReloadToken((value) => value + 1)}
            disabled={loading || busy}
          >
            <ArrowClockwise size={17} />
            {t('刷新')}
          </button>
          {permissions.share && (
            <button className="button button-secondary" onClick={onShare}>
              <ShareNetwork size={17} />
              {t('共享项目')}
            </button>
          )}
        </div>
      </div>
      {!permissions.edit && (
        <p className="studio-access-note">
          <Eye size={16} />
          {permissions.comment
            ? t('你可以查看项目、发表意见，并处理自己留下的讨论。')
            : t('当前为浏览模式，可以查看项目讨论和任务进度。')}
        </p>
      )}
      <InlineError message={error} />
      {loading ? (
        <FeatureSkeleton profile="collaboration" label={t('正在读取讨论与任务')} compact />
      ) : !hasLoaded ? (
        <EmptyState
          icon={<ChatCircleDots size={32} />}
          title={t('暂时无法读取项目协作')}
          description={t('请重新读取；如果项目权限已变化，可以从空间导航切换到可访问的项目。')}
          action={
            <button
              className="button button-secondary"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              <ArrowClockwise size={16} />
              {t('重新读取')}
            </button>
          }
        />
      ) : (
        <>
          {embedded && (
            <nav className="collaboration-panel-tabs" aria-label={t('项目协作')}>
              <button
                type="button"
                aria-pressed={panelSection === 'discussion'}
                onClick={() => setPanelSection('discussion')}
              >
                {t('项目讨论')}
                <span>{openComments}</span>
              </button>
              <button
                type="button"
                aria-pressed={panelSection === 'tasks'}
                onClick={() => setPanelSection('tasks')}
              >
                {interactionText('tasks')}
                <span>{tasks.length - completedTasks}</span>
              </button>
            </nav>
          )}
          <div className="collaboration-grid">
            <section
              className="surface discussion"
              data-motion="discussion"
              hidden={embedded && panelSection !== 'discussion'}
              inert={embedded && panelSection !== 'discussion'}
            >
              <div className="section-heading">
                <h2>
                  <ChatCircleDots size={20} />
                  {t('项目讨论')}
                </h2>
                <span>
                  {comments.length} {t('条')}
                </span>
              </div>
              <div className="studio-segments" role="group" aria-label={t('筛选讨论状态')}>
                {(
                  [
                    ['all', t('全部')],
                    ['open', t('待解决')],
                    ['resolved', t('已解决')],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={commentFilter === value}
                    onClick={() => setCommentFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="comments-list" aria-busy={busy}>
                {visibleComments.length ? (
                  visibleComments.map((comment) => (
                    <article
                      key={comment.id}
                      data-motion="comment"
                      className={`comment ${comment.resolved ? 'resolved' : ''}`}
                    >
                      <div className="comment-avatar" aria-hidden="true">
                        {(comment.authorName ?? t('创作者')).slice(0, 1)}
                      </div>
                      <div className="comment-body">
                        <header>
                          <strong>
                            {comment.authorName ?? t('项目成员')}
                            {comment.authorId === currentUserId && currentUserId ? (
                              <small className="comment-you">{t('你')}</small>
                            ) : null}
                          </strong>
                          <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
                        </header>
                        <p>{comment.body}</p>
                        <footer>
                          <span>
                            {comment.revisionId === revision?.id && revision
                              ? t('当前作品 · V{v0}', { v0: revision.version })
                              : comment.revisionId
                                ? t('绑定作品版本')
                                : t('项目讨论')}
                          </span>
                          {canResolveProjectComment(
                            project.role,
                            currentUserId,
                            comment.authorId,
                          ) ? (
                            <button
                              disabled={busy}
                              onClick={() => void resolve(comment)}
                              aria-label={
                                comment.resolved
                                  ? t('重新打开这条讨论')
                                  : t('将这条讨论标记为已解决')
                              }
                            >
                              {pending === `comment:${comment.id}` ? (
                                <Busy label={t('保存中')} />
                              ) : comment.resolved ? (
                                <>
                                  <Check size={14} />
                                  {t('已解决 · 重新打开')}
                                </>
                              ) : (
                                t('标记解决')
                              )}
                            </button>
                          ) : (
                            <span
                              className={`comment-resolution ${comment.resolved ? 'is-resolved' : ''}`}
                            >
                              {comment.resolved ? (
                                <>
                                  <Check size={14} />
                                  {t('已解决')}
                                </>
                              ) : (
                                t('待解决')
                              )}
                            </span>
                          )}
                        </footer>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="quiet-empty">
                    <p>
                      {comments.length
                        ? commentFilter === 'open'
                          ? t('没有待解决的意见')
                          : t('还没有已解决的意见')
                        : t('尚无讨论')}
                    </p>
                  </div>
                )}
              </div>
              {permissions.comment && (
                <form className="comment-composer" onSubmit={(event) => void addComment(event)}>
                  <label className="sr-only" htmlFor="comment-body">
                    {t('向项目成员发送意见')}
                  </label>
                  <textarea
                    id="comment-body"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={t('输入意见或修改要求…')}
                    maxLength={5000}
                    disabled={busy}
                    required
                  />
                  <footer>
                    <ChoiceSelect<'project' | 'version'>
                      ariaLabel={t('讨论范围')}
                      value={scope}
                      disabled={busy}
                      size="compact"
                      onValueChange={setScope}
                      options={[
                        { value: 'project', label: t('整个项目') },
                        ...(artwork && revision && revision.artworkId === artwork.id
                          ? [
                              {
                                value: 'version' as const,
                                label: t('当前作品 · V{v0}', { v0: revision.version }),
                              },
                            ]
                          : []),
                      ]}
                    />
                    <span className="composer-count">{body.length}/5000</span>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={busy || !body.trim()}
                    >
                      {pending === 'comment' ? (
                        <Busy label={t('发送中')} />
                      ) : (
                        <>
                          {t('发送意见')}
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </footer>
                </form>
              )}
            </section>
            <section
              className="surface task-panel"
              hidden={embedded && panelSection !== 'tasks'}
              inert={embedded && panelSection !== 'tasks'}
            >
              <div className="section-heading">
                <h2>
                  <CheckCircle size={20} />
                  {t('接下来做什么')}
                </h2>
                {tasks.length > 0 && (
                  <span>
                    {completedTasks}/{tasks.length}
                  </span>
                )}
              </div>
              {tasks.length > 0 && (
                <div
                  className="task-progress"
                  role="progressbar"
                  aria-label={t('项目任务完成进度')}
                  aria-valuemin={0}
                  aria-valuemax={tasks.length}
                  aria-valuenow={completedTasks}
                >
                  <span style={{ width: `${(completedTasks / tasks.length) * 100}%` }} />
                </div>
              )}
              {completedTasks > 0 && (
                <button
                  className="text-button task-filter"
                  aria-pressed={!showCompleted}
                  onClick={() => setShowCompleted((value) => !value)}
                >
                  {showCompleted
                    ? t('收起已完成')
                    : t('显示 {v0} 件已完成', { v0: completedTasks })}
                </button>
              )}
              <div className="task-list">
                {visibleTasks.map((task) => (
                  <div className={`task-item ${task.status}`} data-motion="task-item" key={task.id}>
                    {permissions.edit ? (
                      <button
                        disabled={busy}
                        aria-label={t('{v0}：{v1}', {
                          v0: task.title,
                          v1:
                            task.status === 'todo'
                              ? t('开始处理')
                              : task.status === 'doing'
                                ? t('标记完成')
                                : t('重新打开'),
                        })}
                        onClick={() => void changeTask(task)}
                      >
                        {pending === `task:${task.id}` ? (
                          <Busy label="" />
                        ) : task.status === 'done' ? (
                          <CheckCircle size={23} weight="fill" />
                        ) : task.status === 'doing' ? (
                          <Clock size={23} />
                        ) : (
                          <Circle size={23} />
                        )}
                      </button>
                    ) : (
                      <span className="task-status-icon" aria-hidden="true">
                        {task.status === 'done' ? (
                          <CheckCircle size={23} weight="fill" />
                        ) : task.status === 'doing' ? (
                          <Clock size={23} />
                        ) : (
                          <Circle size={23} />
                        )}
                      </span>
                    )}
                    <div>
                      <strong>{task.title}</strong>
                      <small>
                        {task.status === 'todo'
                          ? t('待开始')
                          : task.status === 'doing'
                            ? t('进行中')
                            : t('已完成')}
                      </small>
                      {task.description && <p className="task-description">{task.description}</p>}
                    </div>
                  </div>
                ))}
                {!visibleTasks.length && (tasks.length > 0 || !permissions.edit) && (
                  <p className="quiet-copy">
                    {tasks.length
                      ? t('当前任务都已完成。')
                      : t('团队添加的任务会出现在这里。')}
                  </p>
                )}
              </div>
              {permissions.edit && (
                <form className="task-add" onSubmit={(event) => void addTask(event)}>
                  <input
                    aria-label={t('新任务标题')}
                    placeholder={t('添加一件要做的事')}
                    value={taskTitle}
                    disabled={busy}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    maxLength={120}
                    required
                  />
                  <IconButton
                    label={t('添加任务')}
                    type="submit"
                    disabled={busy || !taskTitle.trim()}
                  >
                    {pending === 'task' ? <Busy label="" /> : <Plus size={19} />}
                  </IconButton>
                </form>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export function DocumentsView({
  actorId,
  project,
  refreshToken,
  onDirtyChange,
}: {
  actorId: string | null;
  project: Project;
  refreshToken: number;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const canEdit = !!actorId && workspacePermissions(project.role).edit;
  const ownerKey = JSON.stringify([actorId, project.id]);
  const [renderedOwner, setRenderedOwner] = useState(ownerKey);
  const retainedDraft = useSyncExternalStore(
    documentDrafts.subscribe,
    () => documentDrafts.get(actorId, project.id),
    () => null,
  );
  const [draftInEditor, setDraftInEditor] = useState(false);
  const editingLineage = useRef<number | null>(null);
  const recoveryDraft = draftInEditor ? null : retainedDraft;
  const pendingSave = retainedDraft?.saveState === 'pending';
  const uncertainCreation = !retainedDraft?.base && retainedDraft?.saveState === 'unknown';
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [selected, setSelected] = useState<ProjectDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [mobileList, setMobileList] = useState(true);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'read' | null>(null);
  const busy = pending !== null;
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const saveLock = useRef(false);
  const activeOperation = useRef(0);
  const requestGeneration = useRef(0);
  const activeOwner = useRef<string | null>(ownerKey);
  activeOwner.current = ownerKey;
  const currentDraft = useRef({ title, body });
  currentDraft.current = { title, body };
  const confirmation = useConfirmation();
  const documentScope = useRef({ selectedId: selected?.id, version: selected?.version, canEdit });
  documentScope.current = { selectedId: selected?.id, version: selected?.version, canEdit };
  async function confirmDiscard(description: string) {
    const result = await confirmStableScope(
      () => ({
        owner: activeOwner.current,
        retainedRevision: documentDrafts.get(actorId, project.id)?.revision,
        ...documentScope.current,
        ...currentDraft.current,
        generation: requestGeneration.current,
        saving: saveLock.current,
      }),
      () => confirmation.confirm({ description }),
    );
    if (result === 'changed') setError('文档或项目已更新，请核对当前文字后重新操作。');
    return result === 'confirmed';
  }
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++requestGeneration.current;
    setLoading(true);
    if (!actorId) return () => controller.abort();
    api<unknown>(`/projects/${project.id}/documents`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (
          !controller.signal.aborted &&
          generation === requestGeneration.current &&
          activeOwner.current === ownerKey
        )
          setDocs(projectDocumentsFromResponse(value));
      })
      .catch(
        (e) =>
          !controller.signal.aborted &&
          activeOwner.current === ownerKey &&
          setError(errorMessage(e)),
      )
      .finally(
        () => !controller.signal.aborted && activeOwner.current === ownerKey && setLoading(false),
      );
    return () => controller.abort();
  }, [actorId, project.id, refreshToken, reloadToken]);
  useEffect(() => {
    activeOwner.current = ownerKey;
    setRenderedOwner(ownerKey);
    activeOperation.current++;
    saveLock.current = false;
    setPending(null);
    setDraftInEditor(false);
    editingLineage.current = null;
    setSelected(null);
    setCreating(false);
    setMobileList(true);
    setDocs([]);
    setQuery('');
    setTitle('');
    setBody('');
    setDirty(false);
    setConflict(false);
    setError(null);
    return () => {
      if (activeOwner.current === ownerKey) activeOwner.current = null;
      activeOperation.current++;
      requestGeneration.current++;
    };
  }, [ownerKey]);

  useEffect(
    () =>
      documentDrafts.subscribeSaves((notice) => {
        if (
          activeOwner.current !== ownerKey ||
          notice.actorId !== actorId ||
          notice.projectId !== project.id
        )
          return;
        requestGeneration.current++;
        const saved = { ...notice.document };
        setDocs((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)]);
        if (editingLineage.current !== notice.lineage) return;
        // A known receipt can arrive after this editor was remounted. Advance only
        // its matching lineage's base; never replace text entered after recovery.
        setSelected(saved);
        setCreating(false);
        setConflict(false);
        setDirty(
          currentDraft.current.title.trim() !== saved.title ||
            currentDraft.current.body !== saved.body,
        );
      }),
    [actorId, project.id, ownerKey],
  );

  useEffect(
    () =>
      documentDrafts.subscribeDiscards((notice) => {
        if (
          activeOwner.current !== ownerKey ||
          notice.actorId !== actorId ||
          notice.projectId !== project.id ||
          notice.lineage !== editingLineage.current
        )
          return;
        // AccountCenter can explicitly discard this editor's draft while its modal
        // is open. Resolve both copies together, without treating a save as discard.
        const base = notice.base ? { ...notice.base } : null;
        activeOperation.current++;
        requestGeneration.current++;
        saveLock.current = false;
        editingLineage.current = null;
        currentDraft.current = { title: base?.title ?? '', body: base?.body ?? '' };
        setSelected(base);
        setTitle(currentDraft.current.title);
        setBody(currentDraft.current.body);
        setPending(null);
        setCreating(false);
        setDraftInEditor(!!base);
        setDirty(false);
        setConflict(false);
        setError(null);
        if (!base) setMobileList(true);
      }),
    [actorId, project.id, ownerKey],
  );

  function updateDraft(next: { title: string; body: string }) {
    if (!actorId || activeOwner.current !== ownerKey || !canEdit) return;
    const previous = documentDrafts.get(actorId, project.id);
    const base = previous && previous.lineage === editingLineage.current ? previous.base : selected;
    const changed = next.title !== (base?.title ?? '') || next.body !== (base?.body ?? '');
    const awaitingResult = !!previous && previous.saveState !== 'idle';
    const retainReversion = awaitingResult || conflict || !!newerVersion;
    if (changed || retainReversion) {
      const captured = documentDrafts.put({
        actorId,
        projectId: project.id,
        projectTitle: project.title,
        base,
        ...next,
      });
      if (!captured.ok) {
        setError(
          captured.reason === 'capacity'
            ? '本页保留的文档草稿已达上限。请先返回已有草稿的项目保存，或导出并丢弃，再编辑新的文档。'
            : '文字超过草稿保留范围，本次输入未应用。',
        );
        return;
      }
      editingLineage.current = captured.draft.lineage;
    } else {
      if (previous) documentDrafts.remove(actorId, project.id, previous.revision);
      editingLineage.current = null;
    }
    // Synchronous capture precedes React state: a session update/unmount in the
    // same turn cannot discard the last typed character.
    currentDraft.current = next;
    setTitle(next.title);
    setBody(next.body);
    setDirty(changed || retainReversion);
    setDraftInEditor(true);
  }

  function recoverDraft() {
    const draft = documentDrafts.get(actorId, project.id);
    if (!draft || busy || activeOwner.current !== ownerKey) return;
    setSelected(draft.base ? { ...draft.base } : null);
    setCreating(!draft.base);
    currentDraft.current = { title: draft.title, body: draft.body };
    setTitle(draft.title);
    setBody(draft.body);
    setDirty(true);
    setDraftInEditor(true);
    editingLineage.current = draft.lineage;
    setMobileList(false);
    setError(null);
    setConflict(false);
  }

  function exportDraft() {
    const draft = documentDrafts.get(actorId, project.id);
    if (!draft || activeOwner.current !== ownerKey) return;
    try {
      downloadBlob(
        new Blob([serializeDocumentDraft(draft)], { type: 'application/json;charset=utf-8' }),
        `${filenameBase(draft.title || '未命名文档')}-未保存草稿.json`,
      );
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  async function discardRecovery() {
    const draft = documentDrafts.get(actorId, project.id);
    if (!draft || !actorId || busy || pendingSave) return;
    if (
      !(await confirmDiscard(
        '丢弃这份保留在本页的未保存草稿？此操作不会取消已经提交的保存请求，也不会删除云端文档。',
      ))
    )
      return;
    if (activeOwner.current !== ownerKey) return;
    if (!documentDrafts.discard(actorId, project.id, draft.revision)) {
      setError('草稿已经变化，请重新核对后操作。');
      return;
    }
    setError(null);
  }

  async function choose(doc: ProjectDocument | null) {
    if (saveLock.current || pendingSave || (!doc && !canEdit)) return;
    if (recoveryDraft) {
      setError('请先恢复或丢弃本页保留的草稿，再切换文档；可以先导出一份。');
      return;
    }
    if (
      dirty &&
      !(await confirmDiscard(
        uncertainCreation
          ? '上次新建结果尚未确认。建议先导出草稿；切换会丢弃本页文字，但不会取消已经提交的保存请求。确定切换吗？'
          : '这份文档还有未保存的修改。放弃修改并切换吗？',
      ))
    )
      return;
    if (activeOwner.current !== ownerKey) return;
    const previous = documentDrafts.get(actorId, project.id);
    if (previous && actorId) documentDrafts.remove(actorId, project.id, previous.revision);
    editingLineage.current = null;
    setSelected(doc);
    setCreating(!doc);
    setMobileList(false);
    setTitle(doc?.title ?? '');
    setBody(doc?.body ?? '');
    currentDraft.current = { title: doc?.title ?? '', body: doc?.body ?? '' };
    setDraftInEditor(true);
    setDirty(false);
    setError(null);
    setConflict(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      saveLock.current ||
      pendingSave ||
      uncertainCreation ||
      !canEdit ||
      !title.trim() ||
      title.trim().length > 120 ||
      (!dirty && selected)
    )
      return;
    const operation = ++activeOperation.current;
    const capturedDraft = documentDrafts.get(actorId, project.id);
    if (!capturedDraft || !documentDrafts.beginSave(capturedDraft)) {
      setError('草稿状态已变化，请先核对当前内容再保存。');
      return;
    }
    saveLock.current = true;
    setPending('save');
    setError(null);
    const snapshot = { title: capturedDraft.title.trim(), body: capturedDraft.body };
    let confirmedReceipt = false;
    try {
      const result = await api<{ document?: unknown }>(
        capturedDraft.base
          ? `/documents/${capturedDraft.base.id}`
          : `/projects/${project.id}/documents`,
        jsonRequest(capturedDraft.base ? 'PATCH' : 'POST', {
          ...snapshot,
          ...(capturedDraft.base ? { expectedVersion: capturedDraft.base.version } : {}),
        }),
      );
      if (!isDocumentSaveReceipt(capturedDraft, result?.document))
        throw new Error('保存回执不完整，当前草稿已保留。请核对云端列表，不要重复新建。');
      confirmedReceipt = true;
      // Receipt settlement is lineage-scoped and safe after unmount/expiry;
      // explicit actor cleanup removes that lineage and cannot be resurrected.
      documentDrafts.acknowledgeSave(capturedDraft, result.document);
      if (activeOwner.current !== ownerKey || activeOperation.current !== operation) return;
      const generation = ++requestGeneration.current;
      const list = projectDocumentsFromResponse(
        await api<unknown>(`/projects/${project.id}/documents`),
      );
      if (activeOwner.current === ownerKey && generation === requestGeneration.current)
        setDocs(list);
    } catch (e) {
      if (!confirmedReceipt)
        documentDrafts.finishUnconfirmedSave(
          capturedDraft,
          e instanceof ApiError && e.status >= 400 && e.status < 500,
        );
      if (activeOwner.current === ownerKey && activeOperation.current === operation) {
        setError(
          confirmedReceipt
            ? t('文档已保存，但列表暂未刷新。{reason}', { reason: t(errorMessage(e)) })
            : errorMessage(e),
        );
        if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') setConflict(true);
      }
    } finally {
      if (activeOperation.current === operation) {
        saveLock.current = false;
        if (activeOwner.current === ownerKey) setPending(null);
      }
    }
  }
  async function readLatest() {
    if (!selected || saveLock.current || pendingSave) return;
    if (dirty && !(await confirmDiscard('读取最新版本会替换当前未保存的文字。确定继续吗？')))
      return;
    if (activeOwner.current !== ownerKey) return;
    const operation = ++activeOperation.current;
    const replacedDraft = documentDrafts.get(actorId, project.id);
    saveLock.current = true;
    setPending('read');
    setError(null);
    try {
      const generation = ++requestGeneration.current;
      const list = projectDocumentsFromResponse(
        await api<unknown>(`/projects/${project.id}/documents`),
      );
      if (
        activeOwner.current !== ownerKey ||
        generation !== requestGeneration.current ||
        activeOperation.current !== operation
      )
        return;
      const latest = list.find((doc) => doc.id === selected.id);
      if (!latest) throw new Error('这份文档已不可访问，请重新选择文档。');
      setDocs(list);
      setSelected(latest);
      setTitle(latest.title);
      setBody(latest.body);
      currentDraft.current = { title: latest.title, body: latest.body };
      if (replacedDraft && actorId)
        documentDrafts.remove(actorId, project.id, replacedDraft.revision);
      editingLineage.current = null;
      setDirty(false);
      setConflict(false);
    } catch (e) {
      if (activeOwner.current === ownerKey && activeOperation.current === operation)
        setError(errorMessage(e));
    } finally {
      if (activeOperation.current === operation) {
        saveLock.current = false;
        if (activeOwner.current === ownerKey) setPending(null);
      }
    }
  }
  const visibleDocs = docs.filter((doc) =>
    doc.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const newerVersion =
    selected && docs.some((doc) => doc.id === selected.id && doc.version > selected.version);
  if (!actorId || renderedOwner !== ownerKey)
    return (
      <div className="content-view studio-view documents-view">
        <FeatureSkeleton profile="documents" label={t('正在同步文档账号')} />
      </div>
    );
  return (
    <div className="content-view studio-view documents-view">
      {confirmation.dialog}
      <div className="view-heading" data-motion="view-header">
        <div>
          <h1>{project.title}</h1>
        </div>
        <span className="studio-count">
          <FileText size={17} />
          {loading ? t('读取中') : t('{v0} 份文档', { v0: docs.length })}
        </span>
      </div>
      {recoveryDraft && (
        <section
          className="document-draft-recovery"
          aria-label={t('保留的未保存草稿')}
          data-testid="document-draft-recovery"
        >
          <div className="document-draft-copy">
            <span className="document-draft-kicker">
              <NotePencil size={16} aria-hidden />
              {t('本页保留了一份未保存草稿')}
            </span>
            <h2>{recoveryDraft.title || t('未命名文档')}</h2>
            <p>
              {recoveryDraft.base
                ? t('基于版本 {v0} · ', { v0: recoveryDraft.base.version })
                : t('尚未确认云端版本 · ')}
              {recoveryDraft.body.length.toLocaleString(getLocale())}{' '}
              {t('字。恢复后需自行保存；刷新或关闭本页会丢失草稿。')}
            </p>
          </div>
          <div className="document-draft-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={recoverDraft}
              data-testid="document-draft-recover"
            >
              <NotePencil size={16} aria-hidden />
              {canEdit ? t('恢复编辑') : t('查看草稿')}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={exportDraft}
              data-testid="document-draft-export"
            >
              <DownloadSimple size={16} aria-hidden />
              {t('导出草稿')}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy || pendingSave}
              onClick={() => void discardRecovery()}
              data-testid="document-draft-discard"
            >
              {t('丢弃草稿')}
            </button>
          </div>
        </section>
      )}
      {retainedDraft && retainedDraft.saveState !== 'idle' && (
        <div
          className="document-draft-status"
          role="status"
          data-testid="document-draft-save-state"
        >
          <p>
            {pendingSave
              ? t('上次保存请求仍在等待结果。你可以继续整理文字，结果确认前不会再次提交。')
              : uncertainCreation
                ? t(
                    '上次新建结果尚未确认，当前已暂停再次新建。请刷新云端列表核对；先导出草稿，再决定打开已有文档或丢弃本页草稿。',
                  )
                : t('上次保存结果尚未确认。文字仍保留在本页，请先核对云端版本。')}
          </p>
          <button
            type="button"
            className="text-button"
            disabled={loading || busy}
            onClick={() => setReloadToken((value) => value + 1)}
          >
            <ArrowClockwise size={15} aria-hidden />
            {t('刷新云端列表')}
          </button>
        </div>
      )}
      {!canEdit && (
        <p className="studio-access-note">
          <Eye size={16} />
          {dirty
            ? t('当前编辑权限已变化，未保存的文字仍保留，可选择并复制。')
            : t('当前为浏览模式，可以查看和复制项目文档。')}
        </p>
      )}
      {!selected && !creating && <InlineError message={error} />}
      <div className="documents-layout" data-mobile-view={mobileList ? 'list' : 'editor'}>
        <aside
          className="surface document-list"
          data-motion="document-list"
          aria-label={t('项目文档列表')}
        >
          {(selected || creating || dirty) && (
            <button
              type="button"
              className="document-continue text-button"
              onClick={() => setMobileList(false)}
            >
              {t('继续编辑当前文档')}
              <ArrowRight size={16} />
            </button>
          )}
          {canEdit && (
            <button
              className="button button-secondary button-full"
              disabled={busy || pendingSave || !!recoveryDraft}
              onClick={() => choose(null)}
            >
              <Plus size={17} />
              {t('新建文档')}
            </button>
          )}
          {docs.length > 0 && (
            <label className="document-search">
              <MagnifyingGlass size={16} />
              <input
                aria-label={t('搜索项目文档')}
                placeholder={t('查找文档…')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
          {loading && <FeatureSkeleton profile="panel" label={t('正在读取')} compact />}
          <div className="document-rows">
            {visibleDocs.map((doc) => (
              <button
                key={doc.id}
                className={`document-row ${selected?.id === doc.id ? 'selected' : ''}`}
                aria-pressed={selected?.id === doc.id}
                disabled={busy || pendingSave || !!recoveryDraft}
                onClick={() => choose(doc)}
              >
                <FileText size={18} />
                <span title={doc.title}>
                  {doc.title}
                  <small>
                    V{doc.version} · {formatDate(doc.updatedAt)}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {!loading && !visibleDocs.length && (
            <p className="quiet-copy">
              {query ? t('没有找到这份文档。') : t('保存后的创作说明，会出现在这里。')}
            </p>
          )}
          <button
            className="text-button document-refresh"
            disabled={loading || busy}
            onClick={() => {
              setError(null);
              setReloadToken((value) => value + 1);
            }}
          >
            <ArrowClockwise size={15} />
            {t('刷新列表')}
          </button>
        </aside>
        {selected || (creating && canEdit) || dirty ? (
          <form
            className="surface document-editor"
            onSubmit={(event) => void save(event)}
            data-motion="document-editor"
          >
            <div className="document-editor-label">
              <button
                type="button"
                className="document-back text-button"
                onClick={() => setMobileList(true)}
              >
                <ArrowLeft size={16} /> {t('文档列表')}
              </button>
              <FileText size={16} />
              <span>{selected ? t('版本 {v0}', { v0: selected.version }) : t('新建文档')}</span>
              <span className={dirty ? 'document-save-state is-dirty' : 'document-save-state'}>
                {dirty ? t('有未保存修改') : selected ? t('已保存') : t('尚未保存')}
              </span>
            </div>
            <input
              className="document-title"
              aria-label={t('文档标题')}
              placeholder={t('文档标题')}
              value={title}
              readOnly={!canEdit || pending === 'read'}
              onChange={(event) => {
                updateDraft({ title: event.target.value, body: currentDraft.current.body });
              }}
              maxLength={120}
              required
            />
            <textarea
              aria-label={t('文档内容')}
              placeholder={t('输入项目说明、参考要求或交付文案…')}
              value={body}
              readOnly={!canEdit || pending === 'read'}
              onChange={(event) => {
                updateDraft({ title: currentDraft.current.title, body: event.target.value });
              }}
              maxLength={100000}
            />
            {(newerVersion || conflict) && (
              <div className="document-conflict">
                <span>{t('云端已有更新。当前文字已保留，读取前可先复制需要的内容。')}</span>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || pendingSave}
                  onClick={() => void readLatest()}
                >
                  <ArrowClockwise size={15} />
                  {t('读取最新版本')}
                </button>
              </div>
            )}
            <InlineError message={error} />
            <footer>
              <span aria-live="polite">
                {busy
                  ? pending === 'read'
                    ? t('正在读取最新版本…')
                    : t('正在保存…')
                  : !canEdit
                    ? t('只读文档')
                    : dirty
                      ? t('有未保存的修改')
                      : selected
                        ? t('已保存 · 版本 {v0}', { v0: selected.version })
                        : t('新文档')}
                <small>
                  {body.length.toLocaleString(getLocale())} {t('字')}
                </small>
              </span>
              <div className="document-draft-editor-actions">
                {dirty && retainedDraft && (
                  <button type="button" className="button button-secondary" onClick={exportDraft}>
                    <DownloadSimple size={16} aria-hidden />
                    {t('导出草稿')}
                  </button>
                )}
                {canEdit && (
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={
                      busy ||
                      pendingSave ||
                      uncertainCreation ||
                      !title.trim() ||
                      (!dirty && !!selected)
                    }
                  >
                    {busy ? (
                      <Busy label={pending === 'read' ? t('读取中') : t('保存中')} />
                    ) : (
                      <>
                        <Check size={17} />
                        {t('保存文档')}
                      </>
                    )}
                  </button>
                )}
              </div>
            </footer>
          </form>
        ) : (
          <div className="surface document-placeholder">
            <EmptyState
              icon={<NotePencil size={34} />}
              title={docs.length ? t('选择文档') : t('创建第一份文档')}
              description={
                docs.length
                  ? t('从列表打开创作说明、参考笔记或作品文案。')
                  : canEdit
                    ? t('点击新建文档，记录项目说明与编辑要求。')
                    : t('团队保存文档后，你可以在这里阅读。')
              }
              action={
                canEdit && !recoveryDraft ? (
                  <button className="button button-secondary" onClick={() => choose(null)}>
                    <Plus size={17} />
                    {t('新建文档')}
                  </button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function DeliveryView({ editor, artwork, sourcePending, onExport, onRecipeImport }: {
  editor: EditorState;
  artwork: Artwork | null;
  sourcePending: boolean;
  onExport: () => void;
  onRecipeImport: () => void;
}) {
  const busy = sourcePending || editor.loading;
  const dimensions = editor.rendered ?? editor.dimensions;
  return (
    <div className="content-view studio-view delivery-view">
      <div className="view-heading" data-motion="view-header"><h1>{t('导出与交付')}</h1></div>
      {editor.file ? (
        <section className="delivery-composition" aria-label={t('当前交付作品')}>
          <div className="delivery-current-preview" role="img" aria-label={t('当前编辑的预览图')}>
            <ComparisonFrame image={editor.rendered} />
          </div>
          <div className="delivery-action-rail">
            <h2>{artwork?.title ?? editor.file.name}</h2>
            <div className="delivery-facts">
              {dimensions && <span>{dimensions.width} × {dimensions.height}</span>}
              {artwork && <span>V{artwork.headVersion}</span>}
            </div>
            <span className="studio-status" aria-live="polite">
              {busy ? <Busy label={t('正在读取图片')} /> : editor.rendering ? <Busy label={t('正在更新预览')} /> : <><CheckCircle size={16} />{t('可导出当前编辑')}</>}
            </span>
            <div className="delivery-primary-action">
              <button className="button button-primary" onClick={onExport} disabled={busy}>
                <DownloadSimple size={18} />{t('导出图片')}
              </button>
              <span>PNG · JPEG · WebP</span>
            </div>
            <div className="delivery-recipe-actions">
              <button className="text-button" disabled={busy} onClick={editor.exportRecipe}>
                <NotePencil size={18} />{t('保存编辑配方')}
              </button>
              <button className="text-button" disabled={busy} onClick={onRecipeImport}>
                <UploadSimple size={18} />{t('导入已有配方')}
              </button>
            </div>
            <small className="delivery-recipe-note">{t('配方不含原图')}</small>
          </div>
        </section>
      ) : (
        <EmptyState icon={<Images size={34} />} title={t('还没有打开照片')} description={t('打开照片后即可导出。')} />
      )}
    </div>
  );
}
