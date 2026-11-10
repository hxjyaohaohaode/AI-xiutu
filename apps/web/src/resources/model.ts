import type {
  ResourceMemory as Memory,
  ResourceSearchItem,
  ResourceSearchResponse,
} from '@ai-xiutu/contracts';
import type { Asset } from '../lib/types';
export type ResourceMemory = Memory;
export type ResourceItem = ResourceSearchItem<Asset>;
export type ResourcePage = ResourceSearchResponse<Asset>;
export function resourceQuery(input: {
  scope: 'all' | 'personal' | 'team';
  spaceId: string;
  query: string;
  remembered: boolean;
  source: string;
  cursor?: string;
}) {
  const p = new URLSearchParams({ limit: '40', scope: input.scope });
  if (input.spaceId) p.set('spaceId', input.spaceId);
  if (input.query.trim()) p.set('query', input.query.trim());
  if (input.remembered) p.set('remembered', 'true');
  if (input.source) p.set('source', input.source);
  if (input.cursor) p.set('cursor', input.cursor);
  return '/resources?' + p;
}
