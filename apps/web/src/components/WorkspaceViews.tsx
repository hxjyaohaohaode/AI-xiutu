import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowSquareOut,
  Check,
  ChatCircleDots,
  Circle,
  Clock,
  FileText,
  Images,
  Plus,
  ShareNetwork,
  UsersThree,
  DownloadSimple,
  UploadSimple,
  CheckCircle,
  NotePencil,
  Sparkle,
  Copy,
} from '@phosphor-icons/react';
import { api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import type {
  Asset,
  Artwork,
  Comment,
  Project,
  ProjectDocument,
  Revision,
  Task,
} from '../lib/types';
import { Busy, EmptyState, IconButton, InlineError } from './Ui';
import { PixelCanvas } from '../editor/CanvasStage';
import { localPixelBudget, type EditorState } from '../editor/useEditor';
import type { RGBAImage } from '@ai-xiutu/editor';

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
    <div className="content-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">YOUR WORK, IN ONE PLACE</span>
          <h1>{project?.title ?? '作品，从一张照片开始'}</h1>
          <p>{project?.description || '把每次探索留成版本，随时回到喜欢的那一步。'}</p>
        </div>
        <div className="view-actions">
          {project && (
            <>
              <button className="button button-secondary" onClick={onCopy}>
                <Copy size={17} />
                复制到空间
              </button>
              {['owner', 'admin'].includes(project.role) && (
                <button className="button button-secondary" onClick={onShare}>
                  <ShareNetwork size={17} />
                  共享
                </button>
              )}
            </>
          )}
          <button className="button button-primary" onClick={onImport}>
            <Plus size={17} />
            导入照片
          </button>
        </div>
      </div>
      {!project ? (
        <EmptyState
          icon={<Images size={34} />}
          title="给作品一个自己的位置"
          description="创建项目后，可以保存照片、调整配方和每次修改的版本。"
          action={
            <button className="button button-secondary" onClick={onCreate}>
              创建项目
              <ArrowRight size={16} />
            </button>
          }
        />
      ) : !artworks.length ? (
        <EmptyState
          icon={<Images size={34} />}
          title="这里还没有作品"
          description="打开照片开始编辑，再点击「保存版本」，它就会出现在这里。"
          action={
            <button className="button button-secondary" onClick={onImport}>
              <UploadSimple size={17} />
              打开照片
            </button>
          }
        />
      ) : (
        <div className="artwork-grid">
          {artworks.map((work) => {
            const asset = assets.find((a) => a.id === work.assetId);
            return (
              <button key={work.id} className="artwork-card" onClick={() => onOpen(work)}>
                <div className="artwork-cover">
                  {asset?.thumbnailUrl ||
                  (asset && asset.width * asset.height <= localPixelBudget()) ? (
                    <img src={asset!.thumbnailUrl ?? asset!.url} alt={work.title} loading="lazy" />
                  ) : (
                    <div className="large-source-cover">
                      <Images size={36} />
                      {asset && (
                        <small>
                          {asset.width}×{asset.height} · 大尺寸原件
                        </small>
                      )}
                    </div>
                  )}
                  <span>
                    打开编辑
                    <ArrowSquareOut size={15} />
                  </span>
                </div>
                <div className="artwork-card-meta">
                  <strong>{work.title}</strong>
                  <span>
                    版本 {work.headVersion}
                    <i /> {formatDate(work.updatedAt)}
                  </span>
                  <small>封面显示原始素材</small>
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
}: {
  editor: EditorState;
  artwork: Artwork | null;
  onOpenRevision: (revision: Revision) => void;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'side' | 'original' | 'edited'>(() =>
    window.innerWidth < 760 ? 'edited' : 'side',
  );
  useEffect(() => {
    setRevisions([]);
    if (!artwork) return;
    const controller = new AbortController();
    api<{ revisions: Revision[] }>(`/artworks/${artwork.id}/revisions`, {
      signal: controller.signal,
    })
      .then((value) => setRevisions(value.revisions))
      .catch((error) => {
        if (error.name !== 'AbortError') setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [artwork?.id, artwork?.headVersion]);
  if (!editor.file)
    return (
      <EmptyState
        icon={<Images size={34} />}
        title="先打开一张图片"
        description="原件与当前编辑会在这里完整显示，不需要滚动查看整张画面。"
      />
    );
  return (
    <div className="content-view compare-view">
      <div className="view-heading">
        <div>
          <h1>对比</h1>
          <p>构图不同的版本会各自适应画布，原件始终保留。</p>
        </div>
        <div className="compare-mode-choice">
          <button className={mode === 'side' ? 'selected' : ''} onClick={() => setMode('side')}>
            并排
          </button>
          <button
            className={mode === 'original' ? 'selected' : ''}
            onClick={() => setMode('original')}
          >
            原图
          </button>
          <button className={mode === 'edited' ? 'selected' : ''} onClick={() => setMode('edited')}>
            当前
          </button>
        </div>
      </div>
      <div className={`compare-pair ${mode !== 'side' ? 'single' : ''}`}>
        {mode !== 'edited' && (
          <section>
            <header>
              <span>原始图片</span>
              <small>完整原件</small>
            </header>
            <ComparisonFrame image={editor.originalPreview} />
          </section>
        )}
        {mode !== 'original' && (
          <section>
            <header>
              <span>当前编辑</span>
              <small>{editor.rendering ? '正在更新' : '本地预览'}</small>
            </header>
            <ComparisonFrame image={editor.rendered} />
          </section>
        )}
      </div>
      <InlineError message={error} />
      {artwork && (
        <details className="saved-versions">
          <summary>
            查看云端历史版本 <span>打开后成为本地草稿，不覆盖最新版本</span>
          </summary>
          <div className="version-list">
            {revisions.map((revision) => (
              <button key={revision.id} onClick={() => onOpenRevision(revision)}>
                <Clock size={19} />
                <div>
                  <strong>{revision.label || `版本 ${revision.version}`}</strong>
                  <small>{formatDate(revision.createdAt)}</small>
                </div>
                <span>V{revision.version}</span>
              </button>
            ))}
          </div>
        </details>
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
}: {
  project: Project;
  artwork: Artwork | null;
  revision: Revision | null;
  refreshToken: number;
  onShare: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [body, setBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'project' | 'version'>('project');
  const load = async () => {
    const [c, t] = await Promise.all([
      api<{ comments: Comment[] }>(`/projects/${project.id}/comments`),
      api<{ tasks: Task[] }>(`/projects/${project.id}/tasks`),
    ]);
    setComments(c.comments);
    setTasks(t.tasks);
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ comments: Comment[] }>(`/projects/${project.id}/comments`),
      api<{ tasks: Task[] }>(`/projects/${project.id}/tasks`),
    ])
      .then(([c, t]) => {
        if (live) {
          setComments(c.comments);
          setTasks(t.tasks);
        }
      })
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [project.id, refreshToken]);
  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/projects/${project.id}/comments`,
        jsonRequest('POST', {
          body: body.trim(),
          ...(scope === 'version' && artwork && revision
            ? { artworkId: artwork.id, revisionId: revision.id }
            : {}),
        }),
      );
      setBody('');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${project.id}/tasks`, jsonRequest('POST', { title: taskTitle.trim() }));
      setTaskTitle('');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeTask(task: Task) {
    setError(null);
    try {
      await api(
        `/tasks/${task.id}`,
        jsonRequest('PATCH', {
          expectedVersion: task.version,
          status: task.status === 'done' ? 'todo' : task.status === 'todo' ? 'doing' : 'done',
        }),
      );
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function resolve(comment: Comment) {
    setError(null);
    try {
      await api(`/comments/${comment.id}`, jsonRequest('PATCH', { resolved: !comment.resolved }));
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="content-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">BETTER, TOGETHER</span>
          <h1>想法放在一起。</h1>
          <p>{project.title} · 意见、下一步和作品版本，在同一个地方。</p>
        </div>
        <button className="button button-secondary" onClick={onShare}>
          <ShareNetwork size={17} />
          共享项目
        </button>
      </div>
      <InlineError message={error} />
      {loading ? (
        <Busy label="正在读取项目讨论" />
      ) : (
        <div className="collaboration-grid">
          <section className="surface discussion">
            <div className="section-heading">
              <h2>
                <ChatCircleDots size={20} />
                项目讨论
              </h2>
              <span>{comments.length} 条</span>
            </div>
            <div className="comments-list">
              {comments.length ? (
                comments.map((comment) => (
                  <article
                    key={comment.id}
                    className={`comment ${comment.resolved ? 'resolved' : ''}`}
                  >
                    <div className="comment-avatar">
                      {(comment.authorName ?? '创作者').slice(0, 1)}
                    </div>
                    <div className="comment-body">
                      <header>
                        <strong>{comment.authorName ?? '项目成员'}</strong>
                        <time>{formatDate(comment.createdAt)}</time>
                      </header>
                      <p>{comment.body}</p>
                      <footer>
                        <span>{comment.revisionId ? '绑定作品版本' : '项目讨论'}</span>
                        <button onClick={() => resolve(comment)}>
                          {comment.resolved ? (
                            <>
                              <Check size={13} />
                              已解决
                            </>
                          ) : (
                            '标记解决'
                          )}
                        </button>
                      </footer>
                    </div>
                  </article>
                ))
              ) : (
                <div className="quiet-empty">
                  <ChatCircleDots size={29} />
                  <p>
                    还没有讨论
                    <br />
                    <small>说说这张作品，哪里让你心动？</small>
                  </p>
                </div>
              )}
            </div>
            <form className="comment-composer" onSubmit={addComment}>
              <label className="sr-only" htmlFor="comment-body">
                向项目成员发送意见
              </label>
              <textarea
                id="comment-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="给队员留个想法…"
                maxLength={8000}
                required
              />
              <footer>
                <select
                  aria-label="讨论范围"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'project' | 'version')}
                >
                  <option value="project">整个项目</option>
                  {artwork && revision && (
                    <option value="version">当前作品 · V{revision.version}</option>
                  )}
                </select>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy || !body.trim()}
                >
                  发送意见
                  <ArrowRight size={16} />
                </button>
              </footer>
            </form>
          </section>
          <section className="surface task-panel">
            <div className="section-heading">
              <h2>
                <CheckCircle size={20} />
                接下来做什么
              </h2>
              <span>
                {tasks.filter((t) => t.status === 'done').length}/{tasks.length}
              </span>
            </div>
            <div className="task-list">
              {tasks.map((task) => (
                <div className={`task-item ${task.status}`} key={task.id}>
                  <button
                    aria-label={`${task.title}：${task.status === 'todo' ? '开始处理' : task.status === 'doing' ? '标记完成' : '重新打开'}`}
                    onClick={() => changeTask(task)}
                  >
                    {task.status === 'done' ? (
                      <CheckCircle size={22} weight="fill" />
                    ) : task.status === 'doing' ? (
                      <Clock size={22} />
                    ) : (
                      <Circle size={22} />
                    )}
                  </button>
                  <div>
                    <strong>{task.title}</strong>
                    <small>
                      {task.status === 'todo'
                        ? '待开始'
                        : task.status === 'doing'
                          ? '进行中'
                          : '已完成'}
                    </small>
                  </div>
                </div>
              ))}
              {!tasks.length && <p className="quiet-copy">把讨论变成一个可以完成的小任务。</p>}
            </div>
            <form className="task-add" onSubmit={addTask}>
              <input
                aria-label="新任务标题"
                placeholder="添加一件要做的事"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                maxLength={200}
                required
              />
              <IconButton label="添加任务" type="submit" disabled={busy || !taskTitle.trim()}>
                <Plus size={19} />
              </IconButton>
            </form>
            <p className="fine-print">点按任务状态：待开始 → 进行中 → 已完成。</p>
          </section>
        </div>
      )}
    </div>
  );
}

export function DocumentsView({
  project,
  refreshToken,
  onDirtyChange,
}: {
  project: Project;
  refreshToken: number;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [selected, setSelected] = useState<ProjectDocument | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    let live = true;
    api<{ documents: ProjectDocument[] }>(`/projects/${project.id}/documents`)
      .then((v) => {
        if (live) setDocs(v.documents);
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [project.id, refreshToken]);
  useEffect(() => {
    setSelected(null);
    setTitle('');
    setBody('');
    setDirty(false);
  }, [project.id]);
  function choose(doc: ProjectDocument | null) {
    if (dirty && !window.confirm('这份文档还有未保存的修改。放弃修改并切换吗？')) return;
    setSelected(doc);
    setTitle(doc?.title ?? '');
    setBody(doc?.body ?? '');
    setDirty(false);
    setError(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ document: ProjectDocument }>(
        selected ? `/documents/${selected.id}` : `/projects/${project.id}/documents`,
        jsonRequest(selected ? 'PATCH' : 'POST', {
          title: title.trim(),
          body,
          ...(selected ? { expectedVersion: selected.version } : {}),
        }),
      );
      setSelected(result.document);
      setDirty(false);
      const list = await api<{ documents: ProjectDocument[] }>(`/projects/${project.id}/documents`);
      setDocs(list.documents);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="content-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">A SHARED UNDERSTANDING</span>
          <h1>把想法，写清楚。</h1>
          <p>创作要求、参考说明和最终文案，都与项目一起保存。</p>
        </div>
      </div>
      <div className="documents-layout">
        <aside className="surface document-list">
          <button className="button button-secondary button-full" onClick={() => choose(null)}>
            <Plus size={17} />
            新建文档
          </button>
          {docs.map((doc) => (
            <button
              key={doc.id}
              className={`document-row ${selected?.id === doc.id ? 'selected' : ''}`}
              onClick={() => choose(doc)}
            >
              <FileText size={18} />
              <span>
                {doc.title}
                <small>
                  V{doc.version} · {formatDate(doc.updatedAt)}
                </small>
              </span>
            </button>
          ))}
          {!docs.length && <p className="quiet-copy">你的第一份创作说明，会出现在这里。</p>}
        </aside>
        <form className="surface document-editor" onSubmit={save}>
          <input
            className="document-title"
            aria-label="文档标题"
            placeholder="给这份想法起个标题"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            maxLength={200}
            required
          />
          <textarea
            aria-label="文档内容"
            placeholder="想传达什么？希望保留哪些细节？在这里写下团队共同的方向…"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
            maxLength={100000}
          />
          <InlineError message={error} />
          <footer>
            <span>
              {dirty ? '有未保存的修改' : selected ? `已保存 · 版本 ${selected.version}` : '新文档'}
            </span>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || !title.trim()}
            >
              {busy ? (
                <Busy />
              ) : (
                <>
                  <Check size={17} />
                  保存文档
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export function DeliveryView({
  editor,
  artwork,
  onExport,
  onRecipeImport,
}: {
  editor: EditorState;
  artwork: Artwork | null;
  onExport: () => void;
  onRecipeImport: () => void;
}) {
  return (
    <div className="content-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">READY FOR THE NEXT CHAPTER</span>
          <h1>带着作品，出发。</h1>
          <p>导出当前画面，或保留可编辑的调整配方。</p>
        </div>
      </div>
      <div className="delivery-grid">
        <section className="surface delivery-card">
          <div className="delivery-icon">
            <Images size={30} />
          </div>
          <span className="small-label">完成后的画面</span>
          <h2>导出图片</h2>
          <p>
            PNG 保留透明背景，JPEG 适合分享，WebP 取决于浏览器编码能力。按原图尺寸重新计算当前调整。
          </p>
          <button className="button button-primary" onClick={onExport} disabled={!editor.file}>
            <DownloadSimple size={18} />
            选择导出格式
          </button>
        </section>
        <section className="surface delivery-card">
          <div className="delivery-icon recipe">
            <NotePencil size={30} />
          </div>
          <span className="small-label">下一次继续创作</span>
          <h2>保存编辑配方</h2>
          <p>保存调色、曲线、构图和局部参数。配方不包含照片，请一并保留原件。</p>
          <button
            className="button button-secondary"
            disabled={!editor.file}
            onClick={editor.exportRecipe}
          >
            <DownloadSimple size={18} />
            下载配方 JSON
          </button>
          <button className="text-button" disabled={!editor.file} onClick={onRecipeImport}>
            <UploadSimple size={16} />
            导入已有配方
          </button>
        </section>
      </div>
      <div className="delivery-note">
        <CheckCircle size={19} />
        <p>
          {artwork
            ? `当前云端作品版本为 V${artwork.headVersion}。本地修改需保存后才进入项目历史。`
            : '本地导出无需登录。登录并保存到项目后，可以从其他设备继续编辑。'}
          <br />
          原图和配方可能包含个人内容，分享前请确认接收范围。
        </p>
      </div>
    </div>
  );
}
