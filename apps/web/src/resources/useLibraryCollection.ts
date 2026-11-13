import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { dateFolderRange, type FolderCount, type FolderGroup } from './LibraryFolders';
import { resourceParameters, type ResourceItem, type ResourcePage } from './model';

export type LibraryTab = 'project' | 'all' | 'memory';
export const SOURCE_LABELS = {
  upload: '上传照片',
  generated: 'AI 生成',
  sketch: '手绘草图',
  derived: '加工素材',
  unknown: '来源未记录',
} as const;
export type LibraryFilters = {
  query: string;
  source: keyof typeof SOURCE_LABELS | 'all';
  period: 'all' | 'today' | 'week' | 'month';
  projectId: string;
  scope: 'all' | 'personal' | 'team';
  spaceId: string;
  groupBy: FolderGroup;
  folder: string;
};

export function initialLibraryFilters(projectId = ''): LibraryFilters {
  return {
    query: '', source: 'all', period: 'all', projectId, scope: 'all', spaceId: '', groupBy: 'date', folder: '',
  };
}

type LibraryEntry = { asset: Asset; resource?: ResourceItem };
type ListData = { entries: LibraryEntry[]; cursor: string | null };
type FolderData = { groups: FolderCount[]; projects?: { id: string; title: string }[] };
type Snapshot = {
  list?: ListData;
  folders?: FolderData;
  error?: string;
  folderError?: string;
  moreError?: string;
  settled: boolean;
};
const EMPTY_ENTRIES: LibraryEntry[] = [];
const EMPTY_FOLDERS: FolderCount[] = [];

function libraryRequest(tab: LibraryTab, filters: LibraryFilters, spaceId: string | undefined, folders: boolean) {
  const resources = tab !== 'project';
  const projectId = !folders && filters.folder && filters.groupBy === 'project'
    ? filters.folder : filters.projectId;
  if (!resources && !projectId && !spaceId) return null;
  const source = filters.source === 'all' ? '' : filters.source;
  const path = resources ? '/resources' : projectId ? '/projects/' + projectId + '/assets' : '/assets';
  const params = resources
    ? resourceParameters({ ...filters, projectId, source, remembered: tab === 'memory', limit: 50 })
    : new URLSearchParams({ limit: '50' });
  if (!resources) {
    if (!projectId && spaceId) params.set('spaceId', spaceId);
    if (filters.query) params.set('query', filters.query);
    if (source) params.set('source', source);
  }
  let start: Date | undefined;
  if (filters.period !== 'all') {
    start = new Date();
    start.setHours(0, 0, 0, 0);
    if (filters.period === 'week') start.setDate(start.getDate() - 6);
    if (filters.period === 'month') start.setDate(start.getDate() - 29);
  }
  if (folders) {
    params.set('groupBy', filters.groupBy);
    params.set('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone);
  } else if (filters.folder) {
    if (filters.groupBy === 'source') params.set('source', filters.folder);
    if (filters.groupBy === 'type') params.set('mime', filters.folder);
    if (filters.groupBy === 'date') {
      const range = dateFolderRange(filters.folder);
      if (range) {
        if (!start || range.start > start) start = range.start;
        if (start >= range.end) return null;
        params.set('createdTo', range.end.toISOString());
      }
    }
  }
  if (start) params.set('createdFrom', start.toISOString());
  return path + '?' + params;
}

async function readList(path: string, resources: boolean, signal: AbortSignal): Promise<ListData> {
  if (resources) {
    const result = await api<ResourcePage>(path, { signal });
    return {
      entries: result.resources.map((resource) => ({ asset: resource.asset, resource })),
      cursor: result.nextCursor,
    };
  }
  const result = await api<{ assets: Asset[]; nextCursor: string | null }>(path, { signal });
  return { entries: result.assets.map((asset) => ({ asset })), cursor: result.nextCursor };
}

/** Each scope retains its own filters and last successful page, including loaded pages. */
export function useLibraryCollection({
  tab, enabled, filters, spaceId, accessKey, refreshToken, active,
}: {
  tab: LibraryTab;
  enabled: boolean;
  filters: LibraryFilters;
  spaceId?: string;
  accessKey: string;
  refreshToken: number;
  active: boolean;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState(filters.query.trim());
  useEffect(() => {
    const value = filters.query.trim();
    if (!value) {
      setDebouncedQuery('');
      return;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(value), 250);
    return () => window.clearTimeout(timer);
  }, [filters.query]);
  const requests = useMemo(() => {
    const values = { ...filters, query: filters.query.trim() ? debouncedQuery : '' };
    return {
      list: libraryRequest(tab, values, spaceId, false),
      folders: libraryRequest(tab, values, spaceId, true),
    };
  }, [tab, filters, spaceId, debouncedQuery]);
  const endpoint = requests.list;
  const folderEndpoint = requests.folders;
  const resources = tab !== 'project';
  const key = JSON.stringify([accessKey, endpoint, folderEndpoint]);
  // A previous query can occupy the same region while the new results arrive.
  // Old images never cross account, membership, project, or explicit space boundaries.
  const owner = JSON.stringify([accessKey, spaceId, filters.scope, filters.spaceId, filters.projectId,
    filters.groupBy === 'project' ? filters.folder : '']);
  const [cache, setCache] = useState<{
    owner: string; pages: Map<string, Snapshot>; last: string | null;
  }>({ owner, pages: new Map(), last: null });
  const [refresh, setRefresh] = useState(0);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [moreKey, setMoreKey] = useState<string | null>(null);
  const pageRequest = useRef<AbortController | null>(null);
  const readStamp = useRef<{ key: string; refresh: number; refreshToken: number } | null>(null);
  const exact = cache.owner === owner ? cache.pages.get(key) : undefined;
  const fallback = cache.owner === owner && cache.last ? cache.pages.get(cache.last) : undefined;
  const list = exact?.list ?? (!exact?.settled ? fallback?.list : undefined);
  const folders = exact?.folders ?? (!exact?.settled ? fallback?.folders : undefined);
  function update(change: (old: Snapshot | undefined) => Snapshot) {
    setCache((old) => {
      const pages = old.owner === owner ? new Map(old.pages) : new Map<string, Snapshot>();
      const value = change(pages.get(key));
      pages.delete(key);
      pages.set(key, value);
      if (pages.size > 8) pages.delete(pages.keys().next().value!);
      return { owner, pages, last: value.list ? key : old.owner === owner ? old.last : null };
    });
  }
  useLayoutEffect(() => {
    if (cache.owner !== owner) setCache({ owner, pages: new Map(), last: null });
  }, [owner, cache.owner]);
  useEffect(() => {
    if (!active || !enabled || (!endpoint && !folderEndpoint)) return;
    const stamp = readStamp.current;
    if (stamp?.key === key && stamp.refresh === refresh && stamp.refreshToken === refreshToken) return;
    const controller = new AbortController();
    setLoadingKey(key);
    setMoreKey(null);
    update((old) => ({ list: old?.list, folders: old?.folders, settled: false }));
    void Promise.allSettled([
      endpoint ? readList(endpoint, resources, controller.signal) : Promise.resolve({ entries: [], cursor: null }),
      folderEndpoint ? api<FolderData>(folderEndpoint, { signal: controller.signal }) : Promise.resolve({ groups: [] }),
    ]).then(([next, nextFolders]) => {
      if (controller.signal.aborted) return;
      if (next.status === 'fulfilled' && nextFolders.status === 'fulfilled')
        readStamp.current = { key, refresh, refreshToken };
      update((old) => ({
        list: next.status === 'fulfilled' ? next.value : old?.list,
        folders: nextFolders.status === 'fulfilled' ? nextFolders.value : old?.folders,
        error: next.status === 'rejected' ? errorMessage(next.reason) : undefined,
        folderError: nextFolders.status === 'rejected' ? errorMessage(nextFolders.reason) : undefined,
        settled: true,
      }));
      setLoadingKey(null);
    });
    return () => {
      controller.abort();
      pageRequest.current?.abort();
      pageRequest.current = null;
      setLoadingKey((current) => current === key ? null : current);
      setMoreKey((current) => current === key ? null : current);
    };
  }, [active, enabled, endpoint, folderEndpoint, key, owner, refresh, refreshToken, resources]);
  async function loadMore() {
    if (!active || !endpoint || !exact?.list?.cursor || pageRequest.current || loadingKey === key) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setMoreKey(key);
    update((old) => ({ ...old, settled: true, moreError: undefined }));
    try {
      const result = await readList(endpoint + '&cursor=' + encodeURIComponent(exact.list.cursor), resources, controller.signal);
      if (controller.signal.aborted) return;
      update((old) => {
        const entries = old?.list?.entries ?? [];
        const loaded = new Set(entries.map(({ asset }) => asset.id));
        return {
          ...old, settled: true,
          list: { entries: [...entries, ...result.entries.filter(({ asset }) => !loaded.has(asset.id))], cursor: result.cursor },
        };
      });
    } catch (error) {
      if (!controller.signal.aborted) update((old) => ({ ...old, settled: true, moreError: errorMessage(error) }));
    } finally {
      if (pageRequest.current === controller) {
        pageRequest.current = null;
        setMoreKey(null);
      }
    }
  }
  function updateAsset(asset: Asset) {
    setCache((old) => {
      const pages = new Map(old.pages);
      for (const [id, page] of pages) {
        if (!page.list?.entries.some((entry) => entry.asset.id === asset.id)) continue;
        const entries = page.list.entries.map((entry) => entry.asset.id === asset.id
          ? { asset, resource: entry.resource ? { ...entry.resource, asset } : undefined } : entry);
        pages.set(id, { ...page, list: { ...page.list, entries } });
      }
      return { ...old, pages };
    });
  }
  const loading = enabled && !!(endpoint || folderEndpoint) && (loadingKey === key || !exact?.settled);
  return {
    entries: enabled && endpoint ? list?.entries ?? EMPTY_ENTRIES : EMPTY_ENTRIES,
    counts: enabled ? folders?.groups ?? EMPTY_FOLDERS : EMPTY_FOLDERS,
    folderProjects: folders?.projects,
    cursor: exact?.list?.cursor ?? null,
    loading,
    loadingMore: moreKey === key,
    provisional: !!list && !exact?.list,
    error: exact?.error,
    folderError: exact?.folderError,
    moreError: exact?.moreError,
    refresh: () => setRefresh((n) => n + 1),
    loadMore,
    updateAsset,
  };
}
