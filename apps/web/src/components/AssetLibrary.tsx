import { getLocale, t, useLocale } from '../i18n';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
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
  X,
  Eye,
  SquaresFour,
  GridFour,
  Swap,
  SlidersHorizontal,
  CaretDown,
} from '@phosphor-icons/react';
import { api, ApiError, errorMessage, formatDate, jsonRequest } from '../lib/api';
import type { Asset, Artwork, Project, Space } from '../lib/types';
import { Busy, EmptyState, InlineError, Modal } from './Ui';
import { FeatureSkeleton } from './DeferredFeature';
import { ChoiceSelect } from './ChoiceSelect';
import { OptionChips } from './Controls';
import { MediaSourceViewer } from '../media/MediaSourceViewer';
import { useConfirmation } from './ConfirmationDialog';
import { confirmStableScope } from '../lib/confirmation-scope';
import { AnimationDialog, AssetRecognitionDialog, ProjectAssetTools } from './AssetTools';
import { RestorationDialog } from '../restoration/RestorationDialog';
import { StudioGlyph } from './StudioGlyph';
import { MotionDetails, MotionDisclosure } from '../motion/Presence';
import { AssetThumbnail } from '../resources/AssetThumbnail';
import { resourceExperienceCopy } from '../resources/experience-copy';
import '../resources/collection-refinement.css';

export const SOURCE_LABELS = {
  upload: '上传照片',
  generated: 'AI 生成',
  sketch: '手绘草图',
  derived: '加工素材',
  unknown: '来源未记录',
} as const;
type Source = keyof typeof SOURCE_LABELS;
type Period = 'all' | 'today' | 'week' | 'month';
type GroupBy = 'project' | 'date' | 'source';

function LibraryThumbnail({ asset, title }: { asset: Asset; title: string }) {
  const src = asset.thumbnailUrl ?? '/v1/assets/' + asset.id + '/thumbnail';
  return <AssetThumbnail src={src} alt={title} />;
}
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
  const confirmation = useConfirmation();
  const mounted = useRef(false);
  const locked = useRef(false);
  const latest = useRef({
    asset,
    title,
    tags,
    capturedAt,
    location,
    busy,
    dirty,
    onClose,
    onSaved,
    onReload,
  });
  latest.current = {
    asset,
    title,
    tags,
    capturedAt,
    location,
    busy,
    dirty,
    onClose,
    onSaved,
    onReload,
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const readDraft = () => ({
    mounted: mounted.current,
    asset: latest.current.asset,
    assetId: latest.current.asset.id,
    projectId: latest.current.asset.projectId,
    version: latest.current.asset.annotationVersion,
    title: latest.current.title,
    tags: latest.current.tags,
    capturedAt: latest.current.capturedAt,
    location: latest.current.location,
    busy: latest.current.busy,
    locked: locked.current,
  });
  async function confirmDiscard(description: string, confirmLabel: string) {
    if (!mounted.current || locked.current || latest.current.busy) return false;
    const outcome = await confirmStableScope(readDraft, () =>
      confirmation.confirm({
        description,
        confirmLabel,
        tone: 'danger',
      }),
    );
    if (outcome === 'changed' && mounted.current)
      setError('素材或整理草稿已经变化，请检查后重试。');
    return outcome === 'confirmed';
  }
  const canClose = async () =>
    !locked.current &&
    !latest.current.busy &&
    (!latest.current.dirty ||
      (await confirmDiscard('整理信息尚未保存，确定关闭吗？', '放弃并关闭')));
  async function reloadLatest() {
    if (
      await confirmDiscard('信息已被其他成员修改。关闭当前草稿并读取最新信息吗？', '读取最新信息')
    ) {
      latest.current.onReload();
      latest.current.onClose();
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!mounted.current || locked.current || busy || !dirty || !asset.annotationVersion) return;
    locked.current = true;
    const savedAsset = asset;
    const isCurrent = () => mounted.current && latest.current.asset === savedAsset;
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
      if (isCurrent()) {
        latest.current.onSaved(result.asset);
        latest.current.onClose();
      }
    } catch (error) {
      if (isCurrent()) {
        setError(errorMessage(error));
        if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') setConflict(true);
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Modal title={t('整理素材信息')} subtitle={asset.name} onClose={onClose} canClose={canClose}>
        <form
          className="stack-form asset-metadata-form"
          onSubmit={(event) => void save(event)}
          data-motion="modal-content"
        >
          <label>
            {t('标题')}
            <input
              value={title}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('给这张素材一个好找的名字')}
            />
          </label>
          <label>
            {t('标签')}
            <input
              value={tags}
              disabled={busy}
              onChange={(event) => setTags(event.target.value)}
              placeholder={t('用逗号分隔，例如：人像，旅行，待精修')}
            />
          </label>
          <label>
            {t('拍摄时间（自行填写）')}
            <input
              type="datetime-local"
              value={capturedAt}
              disabled={busy}
              onChange={(event) => setCapturedAt(event.target.value)}
            />
            <small>
              {t('按当前设备时区')}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}{' '}
            </small>
          </label>
          <label>
            {t('地点（自行填写）')}
            <input
              value={location}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setLocation(event.target.value)}
              placeholder={t('可留空；不会读取设备定位')}
            />
          </label>
          <p className="control-note">
            {t('来源：')}
            {t(SOURCE_LABELS[asset.source ?? 'unknown'])} {t('· 入库于')}{' '}
            {formatDate(asset.createdAt) || t('未记录')}
          </p>
          <InlineError message={error} />
          {conflict ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => {
                void reloadLatest();
              }}
            >
              <ArrowClockwise size={16} />
              {t('读取最新信息')}
            </button>
          ) : (
            <button className="button button-primary" disabled={busy || !dirty}>
              {busy ? <Busy /> : t('保存整理信息')}
            </button>
          )}
        </form>
      </Modal>
      {confirmation.dialog}
    </>
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
  replacementTarget,
  replacementHasDraft,
  onReplaceSource,
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
  replacementTarget?: Artwork | null;
  replacementHasDraft?: boolean;
  onReplaceSource?: (
    asset: Asset,
    artwork: Artwork,
    mode: 'reset' | 'carry-color',
  ) => Promise<void>;
  onSelectProject: (project: Project) => void;
  onImport: () => void;
  onCreate: () => void;
  onCopy: () => void;
  onShare: () => void;
}) {
  const locale = useLocale();
  const c = resourceExperienceCopy(locale);
  const filterId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const [sourceDetails, setSourceDetails] = useState<Asset | null>(null);
  const [replacement, setReplacement] = useState<{ asset: Asset; artwork: Artwork } | null>(null);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const replacementLock = useRef(false);
  async function replace(mode: 'reset' | 'carry-color') {
    if (!replacement || !onReplaceSource || replacementLock.current) return;
    replacementLock.current = true;
    setReplacementBusy(true);
    setReplacementError(null);
    try {
      await onReplaceSource(replacement.asset, replacement.artwork, mode);
      setReplacement(null);
    } catch (error) {
      setReplacementError(errorMessage(error));
    } finally {
      replacementLock.current = false;
      setReplacementBusy(false);
    }
  }
  const [tools, setTools] = useState<{
    asset: Asset;
    kind: 'ocr' | 'animation' | 'restoration';
  } | null>(null);
  const [projectTools, setProjectTools] = useState(false);
  const [expandedAssetDetails, setExpandedAssetDetails] = useState<Set<string>>(() => new Set());
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const requestGeneration = useRef(0),
    moreLock = useRef(false);
  const externalProject = !!project && project.spaceId !== space?.id;
  const scopedProjects = externalProject
    ? [project!]
    : projects.filter((item) => item.spaceId === space?.id);
  const toolProject =
    tools &&
    (project?.id === tools.asset.projectId
      ? project
      : scopedProjects.find((item) => item.id === tools.asset.projectId));
  const toolsEditable = !!toolProject && ['owner', 'admin', 'editor'].includes(toolProject.role);
  useEffect(() => {
    setTools(null);
    setProjectTools(false);
    setExpandedAssetDetails(new Set());
  }, [space?.id, project?.id]);
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
          ? (scopedProjects.find((item) => item.id === asset.projectId)?.title ?? t('已授权项目'))
          : groupBy === 'source'
            ? t(SOURCE_LABELS[asset.source ?? 'unknown'])
            : asset.createdAt
              ? new Date(asset.createdAt).toLocaleDateString(getLocale(), {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : t('入库日期未记录');
      const key = groupBy === 'project' ? asset.projectId : name;
      result.set(key, { name, items: [...(result.get(key)?.items ?? []), asset] });
    }
    return Array.from(result);
  }, [assets, groupBy, projects, space?.id, project?.id, locale]);
  const filtered =
    !!query.trim() || source !== 'all' || period !== 'all' || projectFilter !== (project?.id ?? '');
  const resetFilters = () => {
    setQuery('');
    setDebouncedQuery('');
    setSource('all');
    setPeriod('all');
    setProjectFilter(project?.id ?? '');
  };
  return (
    <div className={`content-view studio-view asset-library library-density-${density}`}>
      <header className="view-heading" data-motion="view-header">
        <div>
          <div className="library-title-line">
            <h1>{project?.title ?? space?.name ?? t('作品')}</h1>
            {(space || project) && (
              <div className="library-result-count" aria-live="polite">
                {loading ? (
                  <span>{t('读取中')}</span>
                ) : (
                  <span>
                    <strong>{assets.length}</strong> {t('张已载入')}
                    {cursor ? t(' · 还有更多') : ''}
                  </span>
                )}
              </div>
            )}
          </div>
          {project?.description && <p>{project.description}</p>}
          {externalProject && <span className="library-shared-label">{t('受邀共享项目')}</span>}
        </div>
        <div className="view-actions">
          {project && (
            <>
              {['owner', 'admin', 'editor'].includes(project.role) && (
                <button
                  className="text-button library-secondary-action"
                  onClick={() => setProjectTools(true)}
                  aria-label={t('拼图与 GIF')}
                  title={t('拼图与 GIF')}
                >
                  <StudioGlyph name="collage" size={18} />
                  <span>{t('拼图与 GIF')}</span>
                </button>
              )}
              <button
                className="text-button library-secondary-action"
                onClick={onCopy}
                aria-label={t('复制项目')}
                title={t('复制项目')}
              >
                <Copy size={17} />
                <span>{t('复制项目')}</span>
              </button>
              {['owner', 'admin'].includes(project.role) && (
                <button
                  className="text-button library-secondary-action"
                  onClick={onShare}
                  aria-label={t('共享')}
                  title={t('共享')}
                >
                  <ShareNetwork size={17} />
                  <span>{t('共享')}</span>
                </button>
              )}
            </>
          )}
          <button className="button button-primary library-import-action" onClick={onImport}>
            <Plus size={18} />
            {project && !['owner', 'admin', 'editor'].includes(project.role)
              ? t('打开本地照片')
              : t('导入照片')}
          </button>
        </div>
      </header>
      {project && !['owner', 'admin', 'editor'].includes(project.role) && (
        <p className="studio-access-note">
          <Eye size={16} />
          {t('当前项目可浏览。你可以打开照片在本地尝试，保存时需要选择可编辑的项目。')}
        </p>
      )}
      {!space && !project ? (
        <EmptyState
          icon={<Images size={32} />}
          title={t('选择工作空间')}
          description={t('登录后选择个人或团队空间。照片仍可直接在本机打开编辑。')}
          action={
            <button className="button button-secondary" onClick={onCreate}>
              {t('创建项目')}
              <ArrowRight size={16} />
            </button>
          }
        />
      ) : (
        <>
          <div
            className="asset-library-filters library-filters-progressive"
            data-motion="view-header"
          >
            <label className="library-search">
              <MagnifyingGlass size={18} />
              <input
                aria-label={t('搜索当前范围素材')}
                value={query}
                maxLength={120}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('搜索名称、标题、标签…')}
              />
              {query && (
                <button
                  type="button"
                  className="library-clear-search"
                  aria-label={t('清除素材搜索')}
                  onClick={() => {
                    setQuery('');
                    setDebouncedQuery('');
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <label className="library-project-select">
              <span>{t('项目')}</span>
              <ChoiceSelect
                ariaLabel={t('素材所属项目')}
                value={projectFilter}
                onValueChange={setProjectFilter}
                options={[
                  ...(!externalProject ? [{ value: '', label: t('当前空间全部项目') }] : []),
                  ...scopedProjects.map((item) => ({ value: item.id, label: item.title })),
                ]}
              />
            </label>
            <button
              type="button"
              className="library-filter-toggle"
              aria-label={
                source !== 'all' || period !== 'all'
                  ? `${c.filters} · ${Number(source !== 'all') + Number(period !== 'all')} ${c.filterCount}`
                  : c.filters
              }
              title={c.filters}
              aria-expanded={filtersOpen}
              aria-controls={filterId}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal size={18} aria-hidden />
              <span className="library-filter-label">{c.filters}</span>
              {(source !== 'all' || period !== 'all') && (
                <span
                  className="library-filter-count"
                  aria-label={`${Number(source !== 'all') + Number(period !== 'all')} ${c.filterCount}`}
                >
                  {Number(source !== 'all') + Number(period !== 'all')}
                </span>
              )}
              <CaretDown size={13} aria-hidden />
            </button>
            <div className="library-status-actions">
              {filtered && (
                <button className="text-button library-reset-filters" onClick={resetFilters}>
                  <X size={15} />
                  {t('重置筛选')}
                </button>
              )}
              <div className="library-density-choice" role="group" aria-label={t('素材显示密度')}>
                <button
                  aria-label={t('大图显示')}
                  title={t('大图显示')}
                  aria-pressed={density === 'comfortable'}
                  onClick={() => setDensity('comfortable')}
                >
                  <SquaresFour size={19} />
                </button>
                <button
                  aria-label={t('紧凑显示')}
                  title={t('紧凑显示')}
                  aria-pressed={density === 'compact'}
                  onClick={() => setDensity('compact')}
                >
                  <GridFour size={19} />
                </button>
              </div>
              <button
                className="text-button library-refresh"
                onClick={() => setRefresh((value) => value + 1)}
                disabled={loading}
                aria-label={t('刷新')}
                title={t('刷新')}
              >
                <ArrowClockwise size={16} />
                <span>{t('刷新')}</span>
              </button>
            </div>
            <MotionDisclosure
              id={filterId}
              open={filtersOpen}
              className="library-filter-disclosure"
            >
              <div className="library-filter-options">
                <OptionChips
                  label={t('按来源筛选')}
                  value={source}
                  onChange={setSource}
                  options={[
                    { value: 'all', label: t('全部来源') },
                    ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({
                      value: value as Source,
                      label: t(label),
                    })),
                  ]}
                />
                <div className="library-filter-row">
                  <OptionChips
                    label={t('按入库日期筛选')}
                    value={period}
                    onChange={setPeriod}
                    options={[
                      { value: 'all', label: t('全部日期') },
                      { value: 'today', label: t('今天') },
                      { value: 'week', label: t('近7天') },
                      { value: 'month', label: t('近30天') },
                    ]}
                  />
                  <label>
                    {t('分组')}
                    <ChoiceSelect
                      ariaLabel={t('素材分组方式')}
                      value={groupBy}
                      size="compact"
                      onValueChange={setGroupBy}
                      options={[
                        { value: 'date', label: t('入库日期') },
                        { value: 'project', label: t('所属项目') },
                        { value: 'source', label: t('素材来源') },
                      ]}
                    />
                  </label>
                </div>
              </div>
            </MotionDisclosure>
          </div>
          <InlineError message={error} />
          {loading && !assets.length && (
            <FeatureSkeleton profile="gallery" label={t('读取当前授权范围')} compact />
          )}
          {!loading && !assets.length && !error && (
            <EmptyState
              icon={<Images size={32} />}
              title={
                query || source !== 'all' || period !== 'all'
                  ? t('没有符合筛选的素材')
                  : t('这里还没有素材')
              }
              description={
                query || source !== 'all' || period !== 'all'
                  ? t('试试其他关键词、来源或日期。')
                  : t('导入照片并保存到项目，或创建一张草图。')
              }
              action={
                filtered ? (
                  <button className="button button-secondary" onClick={resetFilters}>
                    {t('清除筛选')}
                  </button>
                ) : (
                  <button className="button button-secondary" onClick={onImport}>
                    <Plus size={17} />
                    {t('打开一张照片')}
                  </button>
                )
              }
            />
          )}
          {groups.map(([key, { name, items }]) => (
            <section className="library-group" key={key}>
              <h2>
                {name}
                <span>
                  {items.length} {t('张已载入')}
                </span>
              </h2>
              <div className="library-grid">
                {items.map((asset) => {
                  const parent = scopedProjects.find((item) => item.id === asset.projectId);
                  const sameProject = asset.projectId === project?.id;
                  const versions = sameProject
                    ? artworks.filter((work) => work.assetId === asset.id)
                    : [];
                  const canProcess = !!parent && ['owner', 'admin', 'editor'].includes(parent.role);
                  const editable = canProcess && !!asset.annotationVersion;
                  const title = asset.annotations?.title || asset.name;
                  const open = () =>
                    sameProject ? onOpenAsset(asset) : parent && onSelectProject(parent);
                  return (
                    <article className="library-asset" key={asset.id}>
                      <button
                        className="library-cover"
                        style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
                        onClick={open}
                        disabled={!sameProject && !parent}
                        aria-label={
                          sameProject
                            ? t('打开素材 ') + title
                            : t('进入素材所属项目 ') + (parent?.title ?? '')
                        }
                        data-motion="artwork-media"
                        data-motion-pixels="true"
                      >
                        <LibraryThumbnail
                          key={`${asset.id}:${refresh}`}
                          asset={asset}
                          title={title}
                        />
                        <span>
                          {sameProject
                            ? asset.provenance?.animation === true
                              ? t('打开封面')
                              : t('打开原图')
                            : t('进入项目')}
                          <ArrowSquareOut size={15} />
                        </span>
                      </button>
                      <div className="library-asset-meta" data-motion="artwork-meta">
                        <div>
                          <strong title={title}>{title}</strong>
                          {sameProject &&
                            replacementTarget &&
                            replacementTarget.assetId !== asset.id &&
                            onReplaceSource && (
                              <button
                                className="library-edit-metadata"
                                aria-label={t('用 {v0} 替换当前底图', { v0: title })}
                                title={t('替换当前底图')}
                                onClick={() => {
                                  setReplacementError(null);
                                  setReplacement({ asset, artwork: replacementTarget });
                                }}
                              >
                                <Swap size={16} />
                              </button>
                            )}
                          {editable && (
                            <button
                              className="library-edit-metadata"
                              aria-label={t('整理 ') + title + t(' 的信息')}
                              onClick={() => setEditing(asset)}
                            >
                              <PencilSimple size={16} />
                            </button>
                          )}
                        </div>
                        <p>
                          {t(SOURCE_LABELS[asset.source ?? 'unknown'])} · {asset.width}×
                          {asset.height}
                        </p>
                        {!sameProject && <small>{parent?.title ?? t('当前授权项目')}</small>}
                        {canProcess && asset.provenance?.animation !== true && (
                          <button
                            className="text-button library-restoration-action"
                            type="button"
                            onClick={() => setTools({ asset, kind: 'restoration' })}
                          >
                            <StudioGlyph name="repair" size={16} />
                            {t('修复照片')}
                          </button>
                        )}
                        {!!versions.length && (
                          <div className="library-version-links">
                            <div className="library-version-heading">
                              <span>{c.savedWorks}</span>
                              <small>{versions.length}</small>
                            </div>
                            {versions.map((work) => (
                              <button key={work.id} onClick={() => onOpen(work)}>
                                <span>{work.title}</span>
                                <strong>V{work.headVersion}</strong>
                                <ArrowRight size={14} aria-hidden />
                              </button>
                            ))}
                          </div>
                        )}
                        <MotionDetails
                          className="library-asset-details"
                          open={expandedAssetDetails.has(asset.id)}
                          onOpenChange={(open) =>
                            setExpandedAssetDetails((previous) => {
                              const expanded = new Set(previous);
                              if (open) expanded.add(asset.id);
                              else expanded.delete(asset.id);
                              return expanded;
                            })
                          }
                        >
                          <summary>
                            {c.details}
                            <CaretDown size={14} aria-hidden />
                          </summary>
                          <div className="library-asset-tools">
                            <button
                              className="text-button"
                              onClick={() => setTools({ asset, kind: 'ocr' })}
                            >
                              <StudioGlyph name="docs" size={16} />
                              {t('识别文字与表格')}
                            </button>
                            {asset.provenance?.animation === true && (
                              <button
                                className="text-button"
                                onClick={() => setTools({ asset, kind: 'animation' })}
                              >
                                <StudioGlyph name="works" size={16} />
                                {t('GIF 帧编辑')}
                              </button>
                            )}
                          </div>
                          {asset.provenance?.kind === 'media-import' && (
                            <button className="text-button" onClick={() => setSourceDetails(asset)}>
                              {t('查看原件与母版')}
                            </button>
                          )}
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
                              {formatDate(asset.annotations.capturedAt)} {t('· 声明时间')}
                            </small>
                          )}
                          {asset.annotations?.location && (
                            <small className="library-declared">
                              <MapPin size={13} />
                              {asset.annotations.location.label} {t('· 声明地点')}
                            </small>
                          )}
                        </MotionDetails>
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
                {loadingMore ? <Busy /> : t('载入更多素材')}
              </button>
            </div>
          )}
        </>
      )}
      {projectTools && project && ['owner', 'admin', 'editor'].includes(project.role) && (
        <ProjectAssetTools
          key={project.id}
          projectId={project.id}
          assets={assets.filter((asset) => asset.projectId === project.id)}
          onClose={() => setProjectTools(false)}
          onCreated={() => setRefresh((value) => value + 1)}
        />
      )}
      {tools?.kind === 'restoration' && (
        <RestorationDialog
          key={tools.asset.projectId + ':' + tools.asset.id}
          asset={assets.find((item) => item.id === tools.asset.id) ?? tools.asset}
          editable={toolsEditable}
          onClose={() => setTools(null)}
          onCreated={() => setRefresh((value) => value + 1)}
          onOpen={tools.asset.projectId === project?.id ? onOpenAsset : undefined}
        />
      )}
      {tools?.kind === 'ocr' && (
        <AssetRecognitionDialog
          key={tools.asset.id}
          asset={tools.asset}
          editable={toolsEditable}
          onClose={() => setTools(null)}
          onChange={() => setRefresh((value) => value + 1)}
        />
      )}
      {tools?.kind === 'animation' && (
        <AnimationDialog
          key={tools.asset.id}
          asset={tools.asset}
          editable={toolsEditable}
          onClose={() => setTools(null)}
          onChange={() => setRefresh((value) => value + 1)}
        />
      )}
      {replacement && (
        <Modal
          title={t('替换当前底图')}
          subtitle={replacement.artwork.title}
          onClose={() => setReplacement(null)}
          canClose={() => !replacementBusy}
        >
          <p>
            {t('将 {v0} 保存为新的底图版本。', {
              v0: replacement.asset.annotations?.title ?? replacement.asset.name,
            })}
          </p>
          {replacementHasDraft && <p>{t('当前有未保存的编辑。继续会离开这份草稿。')}</p>}
          <InlineError message={replacementError} />
          <div className="button-row">
            <button
              className="button button-secondary"
              disabled={replacementBusy}
              onClick={() => void replace('carry-color')}
            >
              {t('替换并沿用已保存调色')}
            </button>
            <button
              className="button button-primary"
              disabled={replacementBusy}
              onClick={() => void replace('reset')}
            >
              {t('替换底图')}
            </button>
          </div>
        </Modal>
      )}
      {sourceDetails && (
        <Modal
          title={t('原件与母版')}
          subtitle={sourceDetails.name}
          onClose={() => setSourceDetails(null)}
          className="media-source-dialog"
          profile="media"
        >
          <MediaSourceViewer assetId={sourceDetails.id} />
        </Modal>
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
