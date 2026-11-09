import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowClockwise,
  ArrowSquareOut,
  CalendarBlank,
  Copy,
  Images,
  MagnifyingGlass,
  MapPin,
  PencilSimple,
  Plus,
  ShareNetwork,
} from '@phosphor-icons/react';
import { api, ApiError, errorMessage, formatDate, jsonRequest } from '../lib/api';
import type { Asset, Artwork, Project, Space } from '../lib/types';
import { Busy, EmptyState, InlineError, Modal } from './Ui';
import { OptionChips } from './Controls';

export const SOURCE_LABELS = {
  upload: '上传照片',
  generated: 'AI 生成',
  sketch: '手绘草图',
  unknown: '来源未记录',
} as const;
type Source = keyof typeof SOURCE_LABELS;
type Period = 'all' | 'today' | 'week' | 'month';
type GroupBy = 'project' | 'date' | 'source';
function localInputDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function MetadataDialog({
  asset,
  onClose,
  onSaved,
  onReload,
}: {
  asset: Asset;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
  onReload: () => void;
}) {
  const [title, setTitle] = useState(asset.annotations?.title ?? '');
  const [tags, setTags] = useState(asset.annotations?.tags.join('，') ?? '');
  const [capturedAt, setCapturedAt] = useState(localInputDate(asset.annotations?.capturedAt));
  const [location, setLocation] = useState(asset.annotations?.location?.label ?? '');
  const [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [error, setError] = useState<string | null>(null);
  const original = {
    title: asset.annotations?.title ?? '',
    tags: asset.annotations?.tags.join('，') ?? '',
    capturedAt: localInputDate(asset.annotations?.capturedAt),
    location: asset.annotations?.location?.label ?? '',
  };
  const dirty =
    title !== original.title ||
    tags !== original.tags ||
    capturedAt !== original.capturedAt ||
    location !== original.location;
  const canClose = () => !busy && (!dirty || window.confirm('整理信息尚未保存，确定关闭吗？'));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !dirty || !asset.annotationVersion) return;
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = { expectedVersion: asset.annotationVersion };
      if (title !== original.title) patch.title = title.trim() || null;
      if (tags !== original.tags) {
        const values = Array.from(
          new Set(
            tags
              .split(/[,，\n]/)
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        );
        if (values.length > 20 || values.some((value) => value.length > 40))
          throw new Error('最多20个标签，每个不超过40字。');
        patch.tags = values;
      }
      if (capturedAt !== original.capturedAt)
        patch.capturedAt = capturedAt ? new Date(capturedAt).toISOString() : null;
      if (location !== original.location)
        patch.location = location.trim() ? { label: location.trim() } : null;
      const result = await api<{ asset: Asset }>(
        '/assets/' + asset.id + '/annotations',
        jsonRequest('PATCH', patch),
      );
      onSaved(result.asset);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="整理素材信息" subtitle={asset.name} onClose={onClose} canClose={canClose}>
      <form
        className="stack-form asset-metadata-form"
        onSubmit={(event) => void save(event)}
        data-motion="modal-content"
      >
        <label>
          标题
          <input
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="给这张素材一个好找的名字"
          />
        </label>
        <label>
          标签
          <input
            value={tags}
            disabled={busy}
            onChange={(event) => setTags(event.target.value)}
            placeholder="用逗号分隔，例如：人像，旅行，待精修"
          />
        </label>
        <label>
          拍摄时间（自行填写）
          <input
            type="datetime-local"
            value={capturedAt}
            disabled={busy}
            onChange={(event) => setCapturedAt(event.target.value)}
          />
          <small>
            按当前设备时区 {Intl.DateTimeFormat().resolvedOptions().timeZone}{' '}
            解释，保存时包含时区。不从照片推测。
          </small>
        </label>
        <label>
          地点（自行填写）
          <input
            value={location}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="可留空；不会读取设备定位"
          />
        </label>
        <p className="control-note">
          来源：{SOURCE_LABELS[asset.source ?? 'unknown']} · 入库于{' '}
          {formatDate(asset.createdAt) || '未记录'}
          。这些说明随项目权限可见，不会改写原图或自动公开。
        </p>
        <InlineError message={error} />
        {conflict ? (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              if (window.confirm('信息已被其他成员修改。关闭当前草稿并读取最新信息吗？')) {
                onReload();
                onClose();
              }
            }}
          >
            <ArrowClockwise size={16} />
            读取最新信息
          </button>
        ) : (
          <button className="button button-primary" disabled={busy || !dirty}>
            {busy ? <Busy /> : '保存整理信息'}
          </button>
        )}
      </form>
    </Modal>
  );
}
export function AssetLibrary({
  space,
  project,
  projects,
  artworks,
  refreshToken,
  onOpen,
  onOpenAsset,
  onSelectProject,
  onImport,
  onCreate,
  onCopy,
  onShare,
}: {
  space: Space | null;
  project: Project | null;
  projects: Project[];
  artworks: Artwork[];
  refreshToken: number;
  onOpen: (artwork: Artwork) => void;
  onOpenAsset: (asset: Asset) => void;
  onSelectProject: (project: Project) => void;
  onImport: () => void;
  onCreate: () => void;
  onCopy: () => void;
  onShare: () => void;
}) {
  const [projectFilter, setProjectFilter] = useState(project?.id ?? '');
  const [query, setQuery] = useState(''),
    [debouncedQuery, setDebouncedQuery] = useState('');
  const [source, setSource] = useState<Source | 'all'>('all'),
    [period, setPeriod] = useState<Period>('all'),
    [groupBy, setGroupBy] = useState<GroupBy>('date');
  const [assets, setAssets] = useState<Asset[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Asset | null>(null),
    [refresh, setRefresh] = useState(0);
  const requestGeneration = useRef(0),
    moreLock = useRef(false);
  const externalProject = !!project && project.spaceId !== space?.id;
  const scopedProjects = externalProject
    ? [project!]
    : projects.filter((item) => item.spaceId === space?.id);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => setProjectFilter(project?.id ?? ''), [project?.id, space?.id]);
  const endpoint = useMemo(() => {
    if (!space && !projectFilter) return null;
    const params = new URLSearchParams({ limit: '50' });
    if (!projectFilter && space) params.set('spaceId', space.id);
    if (debouncedQuery) params.set('query', debouncedQuery);
    if (source !== 'all') params.set('source', source);
    if (period !== 'all') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      if (period === 'week') start.setDate(start.getDate() - 6);
      if (period === 'month') start.setDate(start.getDate() - 29);
      params.set('createdFrom', start.toISOString());
    }
    return (projectFilter ? '/projects/' + projectFilter + '/assets' : '/assets') + '?' + params;
  }, [space?.id, projectFilter, debouncedQuery, source, period]);
  useEffect(() => {
    const current = ++requestGeneration.current;
    const controller = new AbortController();
    setAssets([]);
    setCursor(null);
    setError(null);
    setLoadingMore(false);
    moreLock.current = false;
    if (!endpoint) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<{ assets: Asset[]; nextCursor: string | null }>(endpoint, { signal: controller.signal })
      .then((result) => {
        if (current !== requestGeneration.current) return;
        setAssets(result.assets);
        setCursor(result.nextCursor);
      })
      .catch((error) => {
        if (current === requestGeneration.current && (error as Error).name !== 'AbortError')
          setError(errorMessage(error));
      })
      .finally(() => {
        if (current === requestGeneration.current) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [endpoint, refreshToken, refresh]);
  async function loadMore() {
    if (!endpoint || !cursor || moreLock.current) return;
    moreLock.current = true;
    setLoadingMore(true);
    setError(null);
    const current = requestGeneration.current;
    try {
      const result = await api<{ assets: Asset[]; nextCursor: string | null }>(
        endpoint + '&cursor=' + encodeURIComponent(cursor),
      );
      if (current !== requestGeneration.current) return;
      setAssets((previous) => [
        ...previous,
        ...result.assets.filter((asset) => !previous.some((old) => old.id === asset.id)),
      ]);
      setCursor(result.nextCursor);
    } catch (error) {
      if (current === requestGeneration.current) setError(errorMessage(error));
    } finally {
      if (current === requestGeneration.current) {
        setLoadingMore(false);
        moreLock.current = false;
      }
    }
  }
  const groups = useMemo(() => {
    const result = new Map<string, { name: string; items: Asset[] }>();
    for (const asset of assets) {
      const name =
        groupBy === 'project'
          ? (scopedProjects.find((item) => item.id === asset.projectId)?.title ?? '已授权项目')
          : groupBy === 'source'
            ? SOURCE_LABELS[asset.source ?? 'unknown']
            : asset.createdAt
              ? new Date(asset.createdAt).toLocaleDateString('zh-CN', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : '入库日期未记录';
      const key = groupBy === 'project' ? asset.projectId : name;
      result.set(key, { name, items: [...(result.get(key)?.items ?? []), asset] });
    }
    return Array.from(result);
  }, [assets, groupBy, projects, space?.id, project?.id]);
  return (
    <div className="content-view asset-library">
      <header className="view-heading" data-motion="view-header">
        <div>
          <span className="eyebrow">
            {externalProject ? '受邀共享项目' : space?.kind === 'team' ? '团队空间' : '个人空间'}
            {space && !externalProject ? ' · ' + space.name : ''}
          </span>
          <h1>{project?.title ?? '作品与素材'}</h1>
          <p>{project?.description || '在自己的空间里，按项目、来源和日期找回作品。'}</p>
        </div>
        <div className="view-actions">
          {project && (
            <>
              <button className="text-button" onClick={onCopy}>
                <Copy size={17} />
                复制项目
              </button>
              {['owner', 'admin'].includes(project.role) && (
                <button className="text-button" onClick={onShare}>
                  <ShareNetwork size={17} />
                  共享
                </button>
              )}
            </>
          )}
          <button className="button button-primary" onClick={onImport}>
            <Plus size={18} />
            导入照片
          </button>
        </div>
      </header>
      {!space && !project ? (
        <EmptyState
          icon={<Images size={32} />}
          title="为创作选一个空间"
          description="登录后选择个人或团队空间。照片仍可直接在本机打开编辑。"
          action={
            <button className="button button-secondary" onClick={onCreate}>
              创建项目
              <ArrowRight size={16} />
            </button>
          }
        />
      ) : (
        <>
          <div className="asset-library-filters" data-motion="view-header">
            <label className="library-search">
              <MagnifyingGlass size={18} />
              <input
                aria-label="搜索当前范围素材"
                value={query}
                maxLength={120}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称、标题、标签…"
              />
            </label>
            <label className="library-project-select">
              <span>项目</span>
              <select
                aria-label="素材所属项目"
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                {!externalProject && <option value="">当前空间全部项目</option>}
                {scopedProjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <OptionChips
              label="按来源筛选"
              value={source}
              onChange={setSource}
              options={[
                { value: 'all', label: '全部来源' },
                ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({
                  value: value as Source,
                  label,
                })),
              ]}
            />
            <div className="library-filter-row">
              <OptionChips
                label="按入库日期筛选"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: 'all', label: '全部日期' },
                  { value: 'today', label: '今天' },
                  { value: 'week', label: '近7天' },
                  { value: 'month', label: '近30天' },
                ]}
              />
              <label>
                分组
                <select
                  aria-label="素材分组方式"
                  value={groupBy}
                  onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                >
                  <option value="date">入库日期</option>
                  <option value="project">所属项目</option>
                  <option value="source">素材来源</option>
                </select>
              </label>
            </div>
          </div>
          <div className="library-status" aria-live="polite">
            {loading ? (
              <Busy label="读取当前授权范围" />
            ) : (
              <span>
                已载入 {assets.length} 张{cursor ? ' · 还有更多' : ''}
              </span>
            )}
            <button
              className="text-button"
              onClick={() => setRefresh((value) => value + 1)}
              disabled={loading}
            >
              <ArrowClockwise size={16} />
              刷新
            </button>
          </div>
          <InlineError message={error} />
          {!loading && !assets.length && !error && (
            <EmptyState
              icon={<Images size={32} />}
              title={
                query || source !== 'all' || period !== 'all'
                  ? '没有符合筛选的素材'
                  : '这里还没有素材'
              }
              description={
                query || source !== 'all' || period !== 'all'
                  ? '试试其他关键词、来源或日期。'
                  : '导入照片并保存到项目，或创建一张草图。'
              }
            />
          )}
          {groups.map(([key, { name, items }]) => (
            <section className="library-group" key={key}>
              <h2>
                {name}
                <span>{items.length} 张已载入</span>
              </h2>
              <div className="library-grid">
                {items.map((asset) => {
                  const parent = scopedProjects.find((item) => item.id === asset.projectId);
                  const sameProject = asset.projectId === project?.id;
                  const versions = sameProject
                    ? artworks.filter((work) => work.assetId === asset.id)
                    : [];
                  const editable =
                    !!parent &&
                    ['owner', 'admin', 'editor'].includes(parent.role) &&
                    !!asset.annotationVersion;
                  const title = asset.annotations?.title || asset.name;
                  const open = () =>
                    sameProject ? onOpenAsset(asset) : parent && onSelectProject(parent);
                  return (
                    <article className="library-asset" key={asset.id}>
                      <button
                        className="library-cover"
                        onClick={open}
                        disabled={!sameProject && !parent}
                        aria-label={
                          sameProject
                            ? '打开素材 ' + title
                            : '进入素材所属项目 ' + (parent?.title ?? '')
                        }
                        data-motion="artwork-media"
                        data-motion-pixels="true"
                      >
                        <img
                          src={asset.thumbnailUrl ?? '/v1/assets/' + asset.id + '/thumbnail'}
                          alt={title}
                          loading="lazy"
                        />
                        <span>
                          {sameProject ? '编辑原图' : '进入项目'}
                          <ArrowSquareOut size={15} />
                        </span>
                      </button>
                      <div className="library-asset-meta" data-motion="artwork-meta">
                        <div>
                          <strong title={title}>{title}</strong>
                          {editable && (
                            <button
                              className="library-edit-metadata"
                              aria-label={'整理 ' + title + ' 的信息'}
                              onClick={() => setEditing(asset)}
                            >
                              <PencilSimple size={16} />
                            </button>
                          )}
                        </div>
                        <p>
                          {SOURCE_LABELS[asset.source ?? 'unknown']} · {asset.width}×{asset.height}
                        </p>
                        <small>{parent?.title ?? '当前授权项目'}</small>
                        {!!asset.annotations?.tags.length && (
                          <div className="library-tags">
                            {asset.annotations.tags.map((tag) => (
                              <button key={tag} onClick={() => setQuery(tag)}>
                                {tag}
                              </button>
                            ))}
                          </div>
                        )}
                        {asset.annotations?.capturedAt && (
                          <small className="library-declared">
                            <CalendarBlank size={13} />
                            {formatDate(asset.annotations.capturedAt)} · 声明时间
                          </small>
                        )}
                        {asset.annotations?.location && (
                          <small className="library-declared">
                            <MapPin size={13} />
                            {asset.annotations.location.label} · 声明地点
                          </small>
                        )}
                        {!!versions.length && (
                          <div className="library-version-links">
                            {versions.map((work) => (
                              <button key={work.id} onClick={() => onOpen(work)}>
                                <span>{work.title}</span>
                                <strong>V{work.headVersion}</strong>
                                <ArrowRight size={14} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          {cursor && (
            <div className="library-load-more">
              <button
                className="button button-secondary"
                disabled={loadingMore || loading}
                onClick={() => void loadMore()}
              >
                {loadingMore ? <Busy /> : '载入更多素材'}
              </button>
            </div>
          )}
          <p className="control-note">
            缩略图展示原始素材；作品按钮打开对应编辑版本。分组数量只统计已经载入的结果，不代表空间总量。
          </p>
        </>
      )}
      {editing && (
        <MetadataDialog
          key={editing.id}
          asset={editing}
          onClose={() => setEditing(null)}
          onReload={() => setRefresh((value) => value + 1)}
          onSaved={(asset) =>
            setAssets((previous) => previous.map((item) => (item.id === asset.id ? asset : item)))
          }
        />
      )}
    </div>
  );
}
