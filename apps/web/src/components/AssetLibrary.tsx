import { t, useLocale } from '../i18n';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowClockwise,
  CalendarBlank,
  BookmarkSimple,
  Copy,
  Images,
  MapPin,
  PencilSimple,
  Plus,
  ShareNetwork,
  Eye,
  Swap,
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
import { MotionDetails } from '../motion/Presence';
import { AssetThumbnail } from '../resources/AssetThumbnail';
import { resourceExperienceCopy } from '../resources/experience-copy';
import { dateFolderRange, LibraryFolders, libraryFolders } from '../resources/LibraryFolders';
import { LibraryMasonry, LibraryToolbar, type LibraryDensity } from '../resources/LibraryPresentation';
import { initialLibraryFilters, SOURCE_LABELS, useLibraryCollection, type LibraryFilters, type LibraryTab } from '../resources/useLibraryCollection';
import { MemoryEditor } from '../resources/MemoryEditor';
import type { ResourceItem } from '../resources/model';
import { FloatingNotice } from './FloatingNotice';
import '../resources/collection-refinement.css';

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
      <Modal title={t('整理素材信息')} hideTitle className="asset-metadata-dialog" onClose={onClose} canClose={canClose}>
        <form
          className="stack-form asset-metadata-form"
          onSubmit={(event) => void save(event)}
          data-motion="modal-content"
        >
          <header className="asset-metadata-identity">
            <LibraryThumbnail asset={asset} title={asset.name} />
            <div>
              <strong>{asset.annotations?.title || asset.name}</strong>
              <small>{asset.width} × {asset.height} · {t(SOURCE_LABELS[asset.source ?? 'unknown'])}</small>
            </div>
          </header>
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
            {t('拍摄时间')}
            <input
              type="datetime-local"
              value={capturedAt}
              disabled={busy}
              onChange={(event) => setCapturedAt(event.target.value)}
            />
          </label>
          <label>
            {t('地点')}
            <input
              value={location}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setLocation(event.target.value)}
              placeholder={t('选填')}
            />
          </label>
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
  tab,
  active,
  density,
  setDensity,
  actorId,
  spaces,
  accessRevision,
  onSignIn,
  onResourceChanged,
  space,
  project,
  projects,
  artworks,
  withdrawnAssets,
  withdrawnArtworks,
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
  onCollage,
}: {
  tab: LibraryTab;
  active: boolean;
  density: LibraryDensity;
  setDensity: (value: LibraryDensity) => void;
  actorId: string | null;
  spaces: Space[];
  accessRevision: number;
  onSignIn?: () => void;
  onResourceChanged: () => void;
  space: Space | null;
  project: Project | null;
  projects: Project[];
  artworks: Artwork[];
  withdrawnAssets: ReadonlySet<string>;
  withdrawnArtworks: ReadonlySet<string>;
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
  onCollage: () => void;
}) {
  const locale = useLocale();
  const c = resourceExperienceCopy(locale);
  const filterId = useId();
  const resources = tab !== 'project';
  const externalProject = !!project && project.spaceId !== space?.id;
  const defaultProject = resources ? '' : project?.id ?? '';
  const scopeKey = JSON.stringify([actorId, !resources ? space?.id ?? null : null, defaultProject]);
  const [filterState, setFilterState] = useState(() => ({
    key: scopeKey, value: initialLibraryFilters(defaultProject),
  }));
  const filters = filterState.key === scopeKey ? filterState.value : initialLibraryFilters(defaultProject);
  const { query, source, period, projectId: projectFilter, scope, spaceId: spaceFilter, groupBy, folder } = filters;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [memoryEditor, setMemoryEditor] = useState<ResourceItem | null>(null);
  const accessKey = JSON.stringify([actorId, accessRevision, ...spaces.map((item) => `${item.id}:${item.role}`).sort(),
    ...projects.map((item) => `${item.id}:${item.role}`).sort()]);
  const enabled = !!actorId && (resources || !!(space || project));
  const collection = useLibraryCollection({ tab, enabled, active, filters,
    spaceId: resources ? undefined : space?.id, accessKey, refreshToken });
  const { cursor, loading, loadingMore, error, folderError } = collection;
  const entries = useMemo(
    () => collection.entries.filter(({ asset }) => !withdrawnAssets.has(asset.id)),
    [collection.entries, withdrawnAssets],
  );
  const setRefresh = collection.refresh;
  const assets = useMemo(() => entries.map(({ asset }) => asset), [entries]);
  const changeFilters = (patch: Partial<LibraryFilters>) =>
    setFilterState({ key: scopeKey, value: { ...filters, ...patch } });
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
  const [actionAssetId, setActionAssetId] = useState<string | null>(null);
  const artworkByAsset = useMemo(() => {
    const byAsset = new Map<string, Artwork>();
    for (const work of artworks) {
      if (withdrawnArtworks.has(work.id)) continue;
      const latest = byAsset.get(work.assetId);
      if (!latest || Date.parse(work.updatedAt ?? work.createdAt ?? '') > Date.parse(latest.updatedAt ?? latest.createdAt ?? ''))
        byAsset.set(work.assetId, work);
    }
    return byAsset;
  }, [artworks, withdrawnArtworks]);
  const [expandedAssetDetails, setExpandedAssetDetails] = useState<Set<string>>(() => new Set());
  const scopedProjects = externalProject
    ? [project!]
    : projects.filter((item) => item.spaceId === space?.id);
  const toolProject = tools && (project?.id === tools.asset.projectId
    ? project : projects.find((item) => item.id === tools.asset.projectId));
  const toolsEditable = !!toolProject && ['owner', 'admin', 'editor'].includes(toolProject.role);
  useEffect(() => {
    setTools(null);
    setProjectTools(false);
    setActionAssetId(null);
    setSourceDetails(null);
    setEditing(null);
    setMemoryEditor(null);
    setReplacement(null);
    setExpandedAssetDetails(new Set());
  }, [scopeKey, accessKey, active]);
  const cards = useMemo(() => entries.map(({ asset, resource }) => {
    const work = asset.projectId === project?.id ? artworkByAsset.get(asset.id) : undefined;
    const description = work ? 'V' + work.headVersion : t(SOURCE_LABELS[asset.source ?? 'unknown']);
    return {
      id: asset.id,
      img: asset.thumbnailUrl ?? '/v1/assets/' + asset.id + '/thumbnail',
      width: asset.width,
      height: asset.height,
      title: resource?.memory?.title || work?.title || asset.annotations?.title || asset.name,
      description: resource ? `${resource.space.name} · ${resource.project.title}` : description,
    };
  }), [entries, project?.id, artworkByAsset, locale]);
  function folderLabel(key: string) {
    if (groupBy === 'project') return collection.folderProjects?.find((item) => item.id === key)?.title
      ?? scopedProjects.find((item) => item.id === key)?.title ?? t('已授权项目');
    if (groupBy === 'source') return t(SOURCE_LABELS[key as keyof typeof SOURCE_LABELS] ?? SOURCE_LABELS.unknown);
    if (groupBy === 'type') return key.split('/').at(-1)?.toUpperCase() || key;
    const date = dateFolderRange(key);
    const depth = key.split('-').length;
    return date ? new Intl.DateTimeFormat(locale, {
      year: 'numeric', ...(depth > 1 ? { month: 'long' } : {}), ...(depth > 2 ? { day: 'numeric' } : {}),
    }).format(date.start) : key;
  }
  const folders = libraryFolders(collection.counts, folderLabel, groupBy);
  const filterCount = Number(source !== 'all') + Number(period !== 'all') + Number(scope !== 'all');
  const filtered = !!query.trim() || filterCount > 0 || !!folder || !!spaceFilter || projectFilter !== defaultProject;
  const resetFilters = () => setFilterState({ key: scopeKey, value: initialLibraryFilters(defaultProject) });
  return (
    <section className={`library-view-body library-density-${density}`}
      data-library-scope={tab} hidden={!active} inert={!active}
      aria-label={t(tab === 'project' ? '项目作品' : tab === 'all' ? '跨空间查找' : '长期素材')}>
      <header className="library-scope-heading">
        <div className="library-scope-name">
          <strong>{resources ? t(tab === 'memory' ? '长期素材' : '跨空间查找') : project?.title ?? space?.name ?? t('项目作品')}</strong>
          {externalProject && !resources && <span className="library-shared-label">{t('受邀共享项目')}</span>}
          {enabled && (
            <span className="library-result-count" role="status">
              {entries.length || !loading ? <><strong>{entries.length}</strong> {c.results}</> : t('读取中')}
              {cursor && ` · ${c.more}`}
              {loading && entries.length > 0 && ` · ${t('读取中')}`}
            </span>
          )}
        </div>
        <div className="view-actions">
          {!resources && project && (
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
          <button className="button button-primary library-import-action" onClick={onImport}
            aria-label={t(project && !['owner', 'admin', 'editor'].includes(project.role) ? '打开本地照片' : '导入照片')}>
            <Plus size={18} />
            {project && !['owner', 'admin', 'editor'].includes(project.role)
              ? t('打开本地照片')
              : t('导入照片')}
          </button>
        </div>
      </header>
      {!resources && project && !['owner', 'admin', 'editor'].includes(project.role) && (
        <p className="studio-access-note">
          <Eye size={16} />
          {t('当前项目可浏览。你可以打开照片在本地尝试，保存时需要选择可编辑的项目。')}
        </p>
      )}
      {!enabled ? (
        <EmptyState
          icon={<Images size={32} />}
          title={t(onSignIn ? resources ? '登录后查找素材' : '登录后查看作品' : '选择工作空间')}
          action={
            <button className="button button-secondary" onClick={onSignIn ?? onCreate}>
              {t(onSignIn ? '登录' : '创建项目')}
              <ArrowRight size={16} />
            </button>
          }
        />
      ) : (
        <>
          <LibraryToolbar
            query={query} onQuery={(query) => changeFilters({ query, folder: '' })}
            selector={resources ? (
              <>
                <span>{t('空间')}</span>
                <ChoiceSelect ariaLabel={t('指定空间')} value={spaceFilter} onValueChange={(spaceId) => changeFilters({ spaceId, folder: '' })}
                  options={[
                    { value: '', label: t('全部可访问') },
                    ...spaces.filter((item) => scope === 'all' || item.kind === scope).map((item) => ({ value: item.id, label: item.name })),
                  ]} />
              </>
            ) : (
              <>
                <span>{t('项目')}</span>
                <ChoiceSelect ariaLabel={t('素材所属项目')} value={projectFilter}
                  onValueChange={(value) => {
                    const next = scopedProjects.find((item) => item.id === value);
                    if (next && next.id !== project?.id) onSelectProject(next);
                    else changeFilters({ projectId: value, folder: '' });
                  }}
                  options={[
                    ...(!externalProject ? [{ value: '', label: t('当前空间全部项目') }] : []),
                    ...scopedProjects.map((item) => ({ value: item.id, label: item.title })),
                  ]} />
              </>
            )}
            filterId={filterId} filtersOpen={filtersOpen} filterCount={filterCount}
            onToggle={() => setFiltersOpen(!filtersOpen)}
            onReset={filtered ? resetFilters : undefined}
            density={density} onDensity={setDensity} onRefresh={collection.refresh} refreshing={loading}
          >
            <div className="library-filter-options">
              {resources && (
                <OptionChips label={t('资源范围')} value={scope}
                  onChange={(scope) => changeFilters({ scope, spaceId: '', folder: '' })}
                  options={[
                    { value: 'all', label: t('全部可访问') },
                    { value: 'personal', label: t('个人空间') },
                    { value: 'team', label: t('团队空间') },
                  ]} />
              )}
              <OptionChips label={t('按来源筛选')} value={source}
                onChange={(source) => changeFilters({ source, folder: '' })}
                options={[
                  { value: 'all', label: t('全部来源') },
                  ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({
                    value: value as keyof typeof SOURCE_LABELS, label: t(label),
                  })),
                ]} />
              <div className="library-filter-row">
                <OptionChips label={t('按入库日期筛选')} value={period}
                  onChange={(period) => changeFilters({ period, folder: '' })}
                  options={[
                    { value: 'all', label: t('全部日期') },
                    { value: 'today', label: t('今天') },
                    { value: 'week', label: t('近7天') },
                    { value: 'month', label: t('近30天') },
                  ]} />
                <label>
                  {t('分组')}
                  <ChoiceSelect ariaLabel={t('素材分组方式')} value={groupBy} size="compact"
                    onValueChange={(groupBy) => changeFilters({
                      groupBy, folder: '',
                      ...(groupBy === 'project' && !externalProject ? { projectId: '' } : {}),
                    })}
                    options={[
                      { value: 'date', label: t('入库日期') },
                      { value: 'project', label: t('所属项目') },
                      { value: 'source', label: t('素材来源') },
                      { value: 'type', label: t('文件类型') },
                    ]} />
                </label>
              </div>
            </div>
          </LibraryToolbar>
          <FloatingNotice message={error ?? folderError ?? collection.moreError ?? null} onRetry={collection.refresh} />
          <div className="library-explorer">
            <LibraryFolders key={groupBy} by={groupBy} folders={folders} selected={folder}
              onSelect={(folder) => changeFilters({ folder })} />
            <div className="library-results" aria-busy={loading} inert={!active}>
              {loading && !entries.length && (
                <FeatureSkeleton profile="gallery" label={t('读取当前授权范围')} compact />
              )}
              {!loading && !entries.length && !error && (
                <EmptyState icon={<Images size={32} />} title={tab === 'memory' && filtered
                  ? c.emptyMemoryFiltered : t(tab === 'memory' ? '还没有长期素材'
                    : filtered ? '没有符合筛选的素材' : '这里还没有素材')}
                  description={tab === 'memory' && !filtered
                    ? t('在素材卡片上选择“长期复用”，添加属于自己的说明。') : undefined}
                  action={filtered ? (
                    <button type="button" className="button button-secondary" onClick={resetFilters}>
                      {t('清除筛选')}
                    </button>
                  ) : tab === 'project' ? (
                    <button type="button" className="button button-secondary" onClick={onImport}>
                      <Plus size={17} /> {t('打开一张照片')}
                    </button>
                  ) : undefined} />
              )}
              {entries.length > 0 && (
                <section className="library-group" inert={collection.provisional}>
                  {folder && <h2>{folderLabel(folder)}</h2>}
                  <LibraryMasonry items={cards} density={density}
                    onOpen={({ id }) => {
                      const entry = entries.find(({ asset }) => asset.id === id);
                      if (!entry) return;
                      const work = entry.asset.projectId === project?.id ? artworkByAsset.get(entry.asset.id) : undefined;
                      if (work) onOpen(work);
                      else onOpenAsset(entry.asset);
                    }}
                    onDetails={setActionAssetId} />
              {active && entries.filter(({ asset }) => asset.id === actionAssetId).map(({ asset, resource }) => {
                  const sameProject = asset.projectId === project?.id;
                  const parent = sameProject ? project : projects.find((item) => item.id === asset.projectId);
                  const versions = sameProject
                    ? artworks.filter((work) => work.assetId === asset.id && !withdrawnArtworks.has(work.id))
                    : [];
                  const canProcess = !!parent && ['owner', 'admin', 'editor'].includes(parent.role);
                  const editable = canProcess && !!asset.annotationVersion;
                  const title = resource?.memory?.title || asset.annotations?.title || asset.name;
                  return (
                    <Modal key={asset.id} title={title} hideTitle onClose={() => setActionAssetId(null)} className="asset-metadata-dialog library-asset-menu">
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
                                  setActionAssetId(null);
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
                              onClick={() => { setActionAssetId(null); setEditing(asset); }}
                            >
                              <PencilSimple size={16} />
                            </button>
                          )}
                        </div>
                        {resource ? <small>{resource.space.name} · {resource.project.title}</small>
                          : !sameProject && <small>{parent?.title ?? t('当前授权项目')}</small>}
                        <button type="button" className="text-button library-original-link"
                          onClick={() => { setActionAssetId(null); onOpenAsset(asset); }}>
                          <StudioGlyph name="works" size={16} />
                          {t('打开原图')}
                        </button>
                        {resource && (
                          <button type="button" className="text-button"
                            onClick={() => { setActionAssetId(null); setMemoryEditor(resource); }}>
                            <BookmarkSimple weight={resource.memory?.remembered ? 'fill' : 'regular'} size={16} />
                            {t(resource.memory?.remembered ? '复用说明' : '长期复用')}
                          </button>
                        )}
                        {canProcess && asset.provenance?.animation !== true && (
                          <button
                            className="text-button library-restoration-action"
                            type="button"
                            onClick={() => { setActionAssetId(null); setTools({ asset, kind: 'restoration' }); }}
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
                              <button key={work.id} onClick={() => { setActionAssetId(null); onOpen(work); }}>
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
                              onClick={() => { setActionAssetId(null); setTools({ asset, kind: 'ocr' }); }}
                            >
                              <StudioGlyph name="docs" size={16} />
                              {t('识别文字与表格')}
                            </button>
                            {asset.provenance?.animation === true && (
                              <button
                                className="text-button"
                                onClick={() => { setActionAssetId(null); setTools({ asset, kind: 'animation' }); }}
                              >
                                <StudioGlyph name="works" size={16} />
                                {t('GIF 帧编辑')}
                              </button>
                            )}
                          </div>
                          {asset.provenance?.kind === 'media-import' && (
                            <button className="text-button" onClick={() => { setActionAssetId(null); setSourceDetails(asset); }}>
                              {t('查看原件与母版')}
                            </button>
                          )}
                          {!!(resource?.memory?.tags ?? asset.annotations?.tags)?.length && (
                            <div className="library-tags">
                              {(resource?.memory?.tags ?? asset.annotations?.tags ?? []).map((tag) => (
                                <button key={tag} type="button" onClick={() => { setActionAssetId(null); changeFilters({ folder: '', query: tag }); }}>
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
                    </Modal>
                  );
                })}
            </section>
          )}
          {cursor && (
            <div className="library-load-more">
              <button
                className="button button-secondary"
                disabled={loadingMore || loading}
                onClick={() => void collection.loadMore()}
              >
                {loadingMore ? <Busy /> : collection.moreError ? c.retryMore : t('载入更多素材')}
              </button>
            </div>
          )}
            </div>
          </div>
        </>
      )}
      {projectTools && project && ['owner', 'admin', 'editor'].includes(project.role) && (
        <ProjectAssetTools
          key={project.id}
          projectId={project.id}
          onClose={() => setProjectTools(false)}
          onCreated={setRefresh}
          onOpenCollage={() => {
            setProjectTools(false);
            onCollage();
          }}
        />
      )}
      {tools?.kind === 'restoration' && (
        <RestorationDialog
          key={tools.asset.projectId + ':' + tools.asset.id}
          asset={assets.find((item) => item.id === tools.asset.id) ?? tools.asset}
          editable={toolsEditable}
          onClose={() => setTools(null)}
          onCreated={setRefresh}
          onOpen={tools.asset.projectId === project?.id ? onOpenAsset : undefined}
        />
      )}
      {tools?.kind === 'ocr' && (
        <AssetRecognitionDialog
          key={tools.asset.id}
          asset={tools.asset}
          editable={toolsEditable}
          onClose={() => setTools(null)}
          onChange={setRefresh}
        />
      )}
      {tools?.kind === 'animation' && (
        <AnimationDialog
          key={tools.asset.id}
          asset={tools.asset}
          editable={toolsEditable}
          onClose={() => setTools(null)}
          onChange={setRefresh}
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
      {active && memoryEditor && (
        <MemoryEditor key={memoryEditor.asset.id} item={memoryEditor}
          onClose={() => setMemoryEditor(null)} onSaved={onResourceChanged} />
      )}
      {editing && (
        <MetadataDialog
          key={editing.id}
          asset={editing}
          onClose={() => setEditing(null)}
          onReload={setRefresh}
          onSaved={collection.updateAsset}
        />
      )}
    </section>
  );
}
