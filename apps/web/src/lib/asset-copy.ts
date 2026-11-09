import { secureUuid } from './uuid';
import type { AssetCopyRequest } from '@ai-xiutu/contracts';

const attempts = new Map<string, string>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The original attempt survives a lost response. The server additionally
 * reuses an existing active source→target copy for independently generated keys. */
export function assetCopyAttempt(
  actorId: string,
  sourceAssetId: string,
  targetProjectId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
  makeUuid: () => string = secureUuid,
): AssetCopyRequest {
  const key = `asset-copy:v1:${actorId}:${sourceAssetId}:${targetProjectId}`;
  let token = attempts.get(key);
  if (!token) {
    try {
      const saved = storage?.getItem(key);
      if (saved && uuid.test(saved)) token = saved;
    } catch {
      /* Storage may be unavailable in private mode. */
    }
  }
  if (!token) token = makeUuid();
  attempts.set(key, token);
  if (attempts.size > 500) attempts.delete(attempts.keys().next().value!);
  try {
    storage?.setItem(key, token);
  } catch {
    /* Keep the in-memory identity. */
  }
  return { targetProjectId, idempotencyKey: token };
}

export function sourcePersistenceRoute(
  sourceId: string,
  knownProjectId: string | undefined,
  targetProjectId: string,
): 'reuse' | 'copy' | 'upload' {
  if (knownProjectId === targetProjectId) return 'reuse';
  if (uuid.test(sourceId)) return 'copy';
  if (sourceId.startsWith('local-')) return 'upload';
  throw new Error('素材来源标识不可解析，请重新选择本地素材或从云端项目打开。');
}
