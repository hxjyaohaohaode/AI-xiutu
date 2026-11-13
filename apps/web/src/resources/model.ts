import type {
  ResourceMemory as Memory,
  ResourceSearchItem,
  ResourceSearchResponse,
} from '@ai-xiutu/contracts';
import type { Asset } from '../lib/types';
export type ResourceMemory = Memory;
export type ResourceItem = ResourceSearchItem<Asset>;
export type ResourcePage = ResourceSearchResponse<Asset>;
export function resourceParameters(input: {
  scope: 'all' | 'personal' | 'team';
  spaceId: string;
  query: string;
  remembered: boolean;
  source: string;
  cursor?: string;
  limit?: number;
  projectId?: string;
}) {
  const p = new URLSearchParams({ limit: String(input.limit ?? 40), scope: input.scope });
  if (input.spaceId) p.set('spaceId', input.spaceId);
  if (input.projectId) p.set('projectId', input.projectId);
  if (input.query.trim()) p.set('query', input.query.trim());
  if (input.remembered) p.set('remembered', 'true');
  if (input.source) p.set('source', input.source);
  if (input.cursor) p.set('cursor', input.cursor);
  return p;
}

export function resourceQuery(input: Parameters<typeof resourceParameters>[0]) {
  return '/resources?' + resourceParameters(input);
}
