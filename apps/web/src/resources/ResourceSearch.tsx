import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  BookmarkSimple,
  MagnifyingGlass,
  PencilSimple,
  Images,
  Trash,
} from '@phosphor-icons/react';
import { api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import type { Asset, Space } from '../lib/types';
import { Busy, EmptyState, InlineError, Modal } from '../components/Ui';
import { localPixelBudget } from '../editor/useEditor';
import { MediaSourceViewer } from '../media/MediaSourceViewer';
import './resources.css';

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
  const [title, setTitle] = useState(item.memory?.title ?? ''),
    [tags, setTags] = useState(item.memory?.tags.join('，') ?? ''),
    [note, setNote] = useState(item.memory?.note ?? '');
  const [remembered, setRemembered] = useState(item.memory?.remembered ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
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
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!item.memory || busy || !window.confirm('删除这份个人长期标注？原图和团队素材仍然保留。'))
      return;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/assets/${item.asset.id}/memory`,
        jsonRequest('DELETE', { expectedVersion: item.memory.version }),
      );
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="长期复用说明" subtitle={item.asset.name} onClose={onClose} canClose={() => !busy}>
      <form className="stack-form" onSubmit={(e) => void save(e)} data-motion="resource-memory">
        <label className="switch-row">
          <span>加入我的长期素材</span>
          <input
            type="checkbox"
            checked={remembered}
            disabled={busy}
            onChange={(e) => setRemembered(e.target.checked)}
          />
        </label>
        <label>
          便于查找的名称
          <input
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          个人标签
          <input
            value={tags}
            maxLength={1230}
            disabled={busy}
            onChange={(e) => setTags(e.target.value)}
            placeholder="用逗号分隔"
          />
        </label>
        <label>
          复用时要记得的说明
          <textarea
            value={note}
            maxLength={2000}
            rows={4}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：保留这个配色；适合产品封面。不自动分析身份。"
          />
        </label>
        <p className="form-hint">
          这些标注仅属于你的账号，不会修改团队素材信息或自动发给
          AI；只有你明确选择引用时才带入共创。原项目权限撤销后，长期标注也不会恢复素材访问权。
        </p>
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
              删除个人标注
            </button>
          )}
          <button className="button button-primary" disabled={busy}>
            {busy ? <Busy label="保存中" /> : '保存个人说明'}
          </button>
        </div>
      </form>
    </Modal>
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
  const [scope, setScope] = useState<'all' | 'personal' | 'team'>('all'),
    [spaceId, setSpaceId] = useState(''),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [source, setSource] = useState('');
  const [items, setItems] = useState<ResourceItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(false),
    [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null),
    [edit, setEdit] = useState<ResourceItem | null>(null),
    [refresh, setRefresh] = useState(0);
  const [sourceDetails, setSourceDetails] = useState<Asset | null>(null);
  const generation = useRef(0),
    moreLock = useRef(false);
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
  }, [endpoint, refresh]);
  async function loadMore() {
    if (!cursor || moreLock.current) return;
    const id = generation.current;
    setMore(true);
    moreLock.current = true;
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
    setOpening(item.asset.id);
    setError(null);
    try {
      await onOpen(item);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(null);
    }
  }
  return (
    <section
      className="resource-search"
      aria-label={rememberedOnly ? '我的长期素材' : '搜索所有有权访问的素材'}
    >
      <header className="view-heading" data-motion="resource-heading">
        <div>
          <h1>{rememberedOnly ? '长期素材' : '找回灵感与素材'}</h1>
          <p>
            {rememberedOnly
              ? '只保留你主动加入的素材和个人说明；访问仍遵守来源空间权限。'
              : '同一个搜索入口，查找有权访问的个人、团队和受邀项目素材。'}
          </p>
        </div>
      </header>
      <div className="resource-filters" data-motion="resource-search">
        <label className="resource-search-input">
          <MagnifyingGlass size={18} />
          <input
            type="search"
            value={query}
            maxLength={120}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名称、标签、复用说明"
            aria-label="搜索资源"
          />
        </label>
        <select
          aria-label="资源范围"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as typeof scope);
            setSpaceId('');
          }}
        >
          <option value="all">全部可访问</option>
          <option value="personal">个人空间</option>
          <option value="team">团队空间</option>
        </select>
        <select aria-label="指定空间" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
          <option value="">不限定空间</option>
          {spaces
            .filter((s) => scope === 'all' || s.kind === scope)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <select aria-label="素材来源" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">所有来源</option>
          <option value="upload">上传</option>
          <option value="generated">AI生成</option>
          <option value="sketch">草图</option>
        </select>
      </div>
      <InlineError message={error} />
      {busy && <Busy label="正在检索可访问资源" />}
      {!busy && !items.length && !error && (
        <EmptyState
          icon={<Images size={30} />}
          title={rememberedOnly ? '还没有长期素材' : '没有找到符合条件的素材'}
          description={
            rememberedOnly
              ? '在素材卡片上选择“长期复用”，添加属于自己的说明。'
              : '试着缩短搜索词，或放宽空间与来源筛选。'
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
              aria-label={`打开${item.memory?.title ?? item.asset.annotations?.title ?? item.asset.name}`}
            >
              {item.asset.thumbnailUrl ||
              item.asset.width * item.asset.height <= localPixelBudget() ? (
                <img src={item.asset.thumbnailUrl ?? item.asset.url} alt="" loading="lazy" />
              ) : (
                <span>
                  <Images size={32} />
                  {item.asset.width} × {item.asset.height}
                </span>
              )}
              {opening === item.asset.id && (
                <span className="resource-opening">
                  <Busy label="打开中" />
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
                  {item.memory?.remembered ? '复用说明' : '长期复用'}
                </button>
                {item.asset.provenance?.kind === 'media-import' && (
                  <button className="text-button" onClick={() => setSourceDetails(item.asset)}>
                    原件与母版
                  </button>
                )}
                {onReference && (
                  <button className="text-button" onClick={() => onReference(item)}>
                    <PencilSimple size={16} />
                    作为AI参考
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {cursor && (
        <button className="button button-secondary" disabled={more} onClick={() => void loadMore()}>
          {more ? <Busy label="读取中" /> : '更多资源'}
        </button>
      )}
      {sourceDetails && (
        <Modal
          title="原件与母版"
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
