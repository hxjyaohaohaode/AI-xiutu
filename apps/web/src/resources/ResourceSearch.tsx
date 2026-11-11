import { t, useLocale } from '../i18n';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  BookmarkSimple,
  MagnifyingGlass,
  PencilSimple,
  Images,
  Trash,
  ArrowClockwise,
  X,
  LockKey,
} from '@phosphor-icons/react';
import { api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import type { Asset, Space } from '../lib/types';
import { Busy, EmptyState, InlineError, Modal } from '../components/Ui';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { FeatureSkeleton } from '../components/DeferredFeature';
import { MotionDetails } from '../motion/Presence';
import { MediaSourceViewer } from '../media/MediaSourceViewer';
import { useConfirmation } from '../components/ConfirmationDialog';
import { confirmStableScope } from '../lib/confirmation-scope';
import './resources.css';
import './collection-refinement.css';
import { AssetThumbnail } from './AssetThumbnail';
import { resourceExperienceCopy } from './experience-copy';

import { resourceQuery, type ResourceItem, type ResourcePage as Page } from './model';
export type { ResourceItem, ResourceMemory } from './model';

function MemoryEditor({
  item,
  onClose,
  onSaved,
}: {
  item: ResourceItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = resourceExperienceCopy(useLocale());
  const [title, setTitle] = useState(item.memory?.title ?? ''),
    [tags, setTags] = useState(item.memory?.tags.join('，') ?? ''),
    [note, setNote] = useState(item.memory?.note ?? '');
  const [remembered, setRemembered] = useState(item.memory?.remembered ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const confirmation = useConfirmation();
  const mounted = useRef(false);
  const locked = useRef(false);
  const latest = useRef({ item, title, tags, note, remembered, busy, onClose, onSaved });
  latest.current = { item, title, tags, note, remembered, busy, onClose, onSaved };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const readMemory = () => ({
    mounted: mounted.current,
    item: latest.current.item,
    assetId: latest.current.item.asset.id,
    projectId: latest.current.item.asset.projectId,
    version: latest.current.item.memory?.version,
    title: latest.current.title,
    tags: latest.current.tags,
    note: latest.current.note,
    remembered: latest.current.remembered,
    busy: latest.current.busy,
    locked: locked.current,
  });
  async function canClose() {
    const current = latest.current;
    if (locked.current || current.busy) return false;
    const dirty =
      current.title !== (current.item.memory?.title ?? '') ||
      current.tags !== (current.item.memory?.tags.join('，') ?? '') ||
      current.note !== (current.item.memory?.note ?? '') ||
      current.remembered !== (current.item.memory?.remembered ?? true);
    if (!dirty) return true;
    const outcome = await confirmStableScope(readMemory, () =>
      confirmation.confirm({
        description: c.unsavedMemory,
        confirmLabel: c.discardMemory,
        tone: 'danger',
      }),
    );
    if (outcome === 'changed' && mounted.current) setError('素材或个人标注已经变化，请重新核对。');
    return outcome === 'confirmed';
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!mounted.current || locked.current || busy) return;
    locked.current = true;
    const savedItem = item;
    const isCurrent = () => mounted.current && latest.current.item === savedItem;
    setBusy(true);
    setError(null);
    try {
      const values = [
        ...new Set(
          tags
            .split(/[,，\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      if (values.length > 30 || values.some((s) => s.length > 40))
        throw new Error('最多30个标签，每个不超过40字。');
      await api(
        `/assets/${item.asset.id}/memory`,
        jsonRequest('PUT', {
          expectedVersion: item.memory?.version ?? 0,
          remembered,
          title: title.trim() || null,
          tags: values,
          note: note.trim(),
        }),
      );
      if (isCurrent()) {
        latest.current.onSaved();
        latest.current.onClose();
      }
    } catch (e) {
      if (isCurrent()) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function remove() {
    if (!mounted.current || !latest.current.item.memory || latest.current.busy || locked.current)
      return;
    const outcome = await confirmStableScope(readMemory, () =>
      confirmation.confirm({
        description: t('删除这份个人长期标注？原图和团队素材仍然保留。'),
        confirmLabel: '删除个人标注',
        tone: 'danger',
      }),
    );
    if (outcome !== 'confirmed') {
      if (outcome === 'changed' && mounted.current)
        setError('素材或个人标注已经变化，请重新核对。');
      return;
    }
    if (!mounted.current || locked.current || latest.current.busy || !latest.current.item.memory)
      return;
    const deletedItem = latest.current.item;
    const expectedVersion = deletedItem.memory!.version;
    const isCurrent = () => mounted.current && latest.current.item === deletedItem;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/assets/${deletedItem.asset.id}/memory`,
        jsonRequest('DELETE', { expectedVersion }),
      );
      if (isCurrent()) {
        latest.current.onSaved();
        latest.current.onClose();
      }
    } catch (e) {
      if (isCurrent()) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Modal
        title={t('长期复用说明')}
        subtitle={item.asset.name}
        onClose={onClose}
        canClose={canClose}
      >
        <form className="stack-form" onSubmit={(e) => void save(e)} data-motion="resource-memory">
          <label className="switch-row">
            <span>{t('加入我的长期素材')}</span>
            <input
              type="checkbox"
              checked={remembered}
              disabled={busy}
              onChange={(e) => setRemembered(e.target.checked)}
            />
          </label>
          <label>
            {t('便于查找的名称')}
            <input
              value={title}
              maxLength={200}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            {t('个人标签')}
            <input
              value={tags}
              maxLength={1230}
              disabled={busy}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t('用逗号分隔')}
            />
          </label>
          <label>
            {t('复用时要记得的说明')}
            <textarea
              value={note}
              maxLength={2000}
              rows={4}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              placeholder={c.memoryPlaceholder}
            />
          </label>
          <p className="resource-private-note">
            <LockKey size={15} aria-hidden />
            {c.privateNote}
          </p>
          <MotionDetails className="resource-privacy-details">
            <summary>{c.privacy}</summary>
            <p className="form-hint">
              {t(
                '这些标注仅属于你的账号，不会修改团队素材信息或自动发给 AI；只有你明确选择引用时才带入共创。原项目权限撤销后，长期标注也不会恢复素材访问权。',
              )}
            </p>
          </MotionDetails>
          <InlineError message={error} />
          <div className="dialog-actions">
            {item.memory && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash size={16} />
                {t('删除个人标注')}
              </button>
            )}
            <button className="button button-primary" disabled={busy}>
              {busy ? <Busy label={t('保存中')} /> : t('保存个人说明')}
            </button>
          </div>
        </form>
      </Modal>
      {confirmation.dialog}
    </>
  );
}

export function ResourceSearch({
  spaces,
  rememberedOnly = false,
  onOpen,
  onReference,
}: {
  spaces: Space[];
  rememberedOnly?: boolean;
  onOpen: (item: ResourceItem) => Promise<void> | void;
  onReference?: (item: ResourceItem) => void;
}) {
  const c = resourceExperienceCopy(useLocale());
  const [scope, setScope] = useState<'all' | 'personal' | 'team'>('all'),
    [spaceId, setSpaceId] = useState(''),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [source, setSource] = useState('');
  const [items, setItems] = useState<ResourceItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(true),
    [more, setMore] = useState(false),
    [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null),
    [edit, setEdit] = useState<ResourceItem | null>(null),
    [refresh, setRefresh] = useState(0);
  const [sourceDetails, setSourceDetails] = useState<Asset | null>(null);
  const generation = useRef(0),
    moreLock = useRef(false);
  const accessKey = spaces
    .map((space) => `${space.id}:${space.kind}:${space.role}`)
    .sort()
    .join('|');
  useEffect(() => {
    setEdit(null);
    setSourceDetails(null);
  }, [accessKey]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const filters = useMemo(
    () => ({ scope, spaceId, query: search, remembered: rememberedOnly, source }),
    [scope, spaceId, search, rememberedOnly, source],
  );
  const endpoint = resourceQuery(filters);
  useEffect(() => {
    const id = ++generation.current,
      controller = new AbortController();
    setItems([]);
    setCursor(null);
    setBusy(true);
    setMore(false);
    moreLock.current = false;
    setError(null);
    api<Page>(endpoint, { signal: controller.signal })
      .then((value) => {
        if (id === generation.current) {
          setItems(value.resources);
          setCursor(value.nextCursor);
        }
      })
      .catch((e) => {
        if (id === generation.current && e.name !== 'AbortError') setError(errorMessage(e));
      })
      .finally(() => {
        if (id === generation.current) setBusy(false);
      });
    return () => controller.abort();
  }, [endpoint, refresh, accessKey]);
  async function loadMore() {
    if (!cursor || moreLock.current) return;
    const id = generation.current;
    setMore(true);
    moreLock.current = true;
    setError(null);
    try {
      const result = await api<Page>(resourceQuery({ ...filters, cursor }));
      if (id === generation.current) {
        setItems((old) => [
          ...old,
          ...result.resources.filter((n) => !old.some((p) => p.asset.id === n.asset.id)),
        ]);
        setCursor(result.nextCursor);
      }
    } catch (e) {
      if (id === generation.current) setError(errorMessage(e));
    } finally {
      if (id === generation.current) {
        setMore(false);
        moreLock.current = false;
      }
    }
  }
  async function open(item: ResourceItem) {
    if (opening) return;
    const id = generation.current;
    setOpening(item.asset.id);
    setError(null);
    try {
      await onOpen(item);
    } catch (e) {
      if (id === generation.current) setError(errorMessage(e));
    } finally {
      setOpening(null);
    }
  }
  const filtered = !!query.trim() || scope !== 'all' || !!spaceId || !!source;
  const reset = () => {
    setQuery('');
    setSearch('');
    setScope('all');
    setSpaceId('');
    setSource('');
  };
  return (
    <section
      className="resource-search"
      aria-label={rememberedOnly ? t('我的长期素材') : t('搜索所有有权访问的素材')}
    >
      <header className="view-heading" data-motion="resource-heading">
        <div>
          <h1>{rememberedOnly ? t('长期素材') : t('查找素材')}</h1>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy || more}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <ArrowClockwise size={17} aria-hidden />
          {t('刷新')}
        </button>
      </header>
      <div className="resource-filters" data-motion="resource-search">
        <label className="resource-search-input">
          <MagnifyingGlass size={18} />
          <input
            type="search"
            value={query}
            maxLength={120}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('名称、标签、复用说明')}
            aria-label={t('搜索资源')}
          />
          {query && (
            <button
              type="button"
              aria-label={c.clearSearch}
              onClick={() => {
                setQuery('');
                setSearch('');
              }}
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </label>
        <ChoiceSelect
          ariaLabel={t('资源范围')}
          value={scope}
          onValueChange={(value) => {
            setScope(value);
            setSpaceId('');
          }}
          options={[
            { value: 'all', label: t('全部可访问') },
            { value: 'personal', label: t('个人空间') },
            { value: 'team', label: t('团队空间') },
          ]}
        />
        <ChoiceSelect
          ariaLabel={t('指定空间')}
          value={spaceId}
          onValueChange={setSpaceId}
          options={[
            { value: '', label: t('不限定空间') },
            ...spaces
              .filter((s) => scope === 'all' || s.kind === scope)
              .map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <ChoiceSelect
          ariaLabel={t('素材来源')}
          value={source}
          onValueChange={setSource}
          options={[
            { value: '', label: t('所有来源') },
            { value: 'upload', label: t('上传') },
            { value: 'generated', label: t('AI 生成') },
            { value: 'sketch', label: t('草图') },
            { value: 'derived', label: t('加工素材') },
          ]}
        />
      </div>
      <div className="resource-result-status">
        <span role="status">
          {busy ? (
            t('读取中')
          ) : (
            <>
              <strong>{items.length}</strong> {c.results}
              {cursor ? ` · ${c.more}` : ''}
            </>
          )}
        </span>
        {filtered && (
          <button type="button" className="text-button" onClick={reset}>
            <X size={14} aria-hidden />
            {c.reset}
          </button>
        )}
      </div>
      <InlineError message={error} />
      {error && !busy && !items.length && (
        <button
          type="button"
          className="button button-secondary resource-retry"
          onClick={() => setRefresh((value) => value + 1)}
        >
          <ArrowClockwise size={17} aria-hidden />
          {c.reload}
        </button>
      )}
      {busy && <FeatureSkeleton profile="gallery" label={t('正在检索可访问资源')} compact />}
      {!busy && !items.length && !error && (
        <EmptyState
          icon={<Images size={30} />}
          title={
            rememberedOnly
              ? filtered
                ? c.emptyMemoryFiltered
                : t('还没有长期素材')
              : t('没有找到符合条件的素材')
          }
          description={
            rememberedOnly && !filtered
              ? t('在素材卡片上选择“长期复用”，添加属于自己的说明。')
              : t('试着缩短搜索词，或放宽空间与来源筛选。')
          }
          action={
            filtered ? (
              <button type="button" className="button button-secondary" onClick={reset}>
                {c.reset}
              </button>
            ) : undefined
          }
        />
      )}
      <div className="resource-grid">
        {items.map((item) => (
          <article
            className="resource-card"
            key={item.asset.id}
            data-motion="resource-card"
            data-motion-pixels="true"
          >
            <button
              className="resource-cover"
              disabled={!!opening}
              onClick={() => void open(item)}
              aria-label={t('打开{v0}', {
                v0: item.memory?.title ?? item.asset.annotations?.title ?? item.asset.name,
              })}
            >
              <AssetThumbnail
                key={`${item.asset.id}:${refresh}`}
                src={item.asset.thumbnailUrl ?? `/v1/assets/${item.asset.id}/thumbnail`}
              />
              {opening === item.asset.id && (
                <span className="resource-opening">
                  <Busy label={t('打开中')} />
                </span>
              )}
            </button>
            <div className="resource-meta">
              <strong>
                {item.memory?.title || item.asset.annotations?.title || item.asset.name}
              </strong>
              <small>
                {item.space.name} · {item.project.title}
              </small>
              <span>
                {formatDate(item.asset.createdAt)} · {item.asset.width}×{item.asset.height}
              </span>
              <div className="resource-tags">
                {(item.memory?.tags ?? item.asset.annotations?.tags ?? [])
                  .slice(0, 4)
                  .map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
              </div>
              <div className="resource-actions">
                <button className="text-button" onClick={() => setEdit(item)}>
                  <BookmarkSimple weight={item.memory?.remembered ? 'fill' : 'regular'} size={17} />
                  {item.memory?.remembered ? t('复用说明') : t('长期复用')}
                </button>
                {item.asset.provenance?.kind === 'media-import' && (
                  <button className="text-button" onClick={() => setSourceDetails(item.asset)}>
                    {t('原件与母版')}
                  </button>
                )}
                {onReference && (
                  <button className="text-button" onClick={() => onReference(item)}>
                    <PencilSimple size={16} />
                    {t('作为AI参考')}
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {cursor && (
        <button className="button button-secondary" disabled={more} onClick={() => void loadMore()}>
          {more ? <Busy label={t('读取中')} /> : error ? c.retryMore : t('更多资源')}
        </button>
      )}
      {sourceDetails && (
        <Modal
          title={t('原件与母版')}
          subtitle={sourceDetails.name}
          onClose={() => setSourceDetails(null)}
        >
          <MediaSourceViewer assetId={sourceDetails.id} />
        </Modal>
      )}
      {edit && (
        <MemoryEditor
          key={edit.asset.id}
          item={edit}
          onClose={() => setEdit(null)}
          onSaved={() => setRefresh((n) => n + 1)}
        />
      )}
    </section>
  );
}
