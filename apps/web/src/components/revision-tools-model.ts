import { forkRevisionSchema } from '@ai-xiutu/contracts';
import { ApiError } from '../lib/api';
import type { RevisionSummary } from '../lib/types';
import { secureUuid } from '../lib/uuid';

export type RevisionReference = Pick<RevisionSummary, 'id' | 'artworkId' | 'assetId' | 'version'>;
export type RevisionForkSuccess = {
  artworkId: string;
  projectId: string;
  revisionId: string;
  sourceRevisionId: string;
  sourceAssetId: string;
};
export type RevisionForkCheckpoint = {
  schema: 'revision-fork-v1';
  actorId: string;
  artworkId: string;
  projectId: string;
  sourceAssetId: string;
  sourceVersion: number;
  body: { revisionId: string; title: string; idempotencyKey: string };
  created?: RevisionForkSuccess;
};
export type RevisionCheckpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const revisionForkStorageKey = (actorId: string, artworkId: string) =>
  `xiutu:revision-fork:${actorId}:${artworkId}`;
const asRecord = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function freezeRevisionFork(
  input: {
    actorId: string;
    artworkId: string;
    projectId: string;
    revision: RevisionReference;
    title: string;
  },
  makeKey: () => string = secureUuid,
): RevisionForkCheckpoint {
  if (
    !uuid(input.actorId) ||
    !uuid(input.artworkId) ||
    !uuid(input.projectId) ||
    !uuid(input.revision.assetId) ||
    input.revision.artworkId !== input.artworkId ||
    !Number.isSafeInteger(input.revision.version) ||
    input.revision.version < 1
  )
    throw new Error('请从当前作品选择一个已保存的版本。');
  const body = forkRevisionSchema.parse({
    revisionId: input.revision.id,
    title: input.title,
    idempotencyKey: makeKey(),
  });
  return Object.freeze({
    schema: 'revision-fork-v1',
    actorId: input.actorId,
    artworkId: input.artworkId,
    projectId: input.projectId,
    sourceAssetId: input.revision.assetId,
    sourceVersion: input.revision.version,
    body: Object.freeze(body),
  });
}

function parseForkCheckpoint(
  raw: unknown,
  actorId: string,
  artworkId: string,
): RevisionForkCheckpoint {
  const value = asRecord(raw);
  if (
    !value ||
    Object.keys(value).some(
      (key) =>
        ![
          'schema',
          'actorId',
          'artworkId',
          'projectId',
          'sourceAssetId',
          'sourceVersion',
          'body',
          'created',
        ].includes(key),
    ) ||
    value.schema !== 'revision-fork-v1' ||
    value.actorId !== actorId ||
    value.artworkId !== artworkId ||
    !uuid(value.projectId) ||
    !uuid(value.sourceAssetId) ||
    !Number.isSafeInteger(value.sourceVersion) ||
    Number(value.sourceVersion) < 1
  )
    throw new Error('分支恢复记录不完整，暂时不能新建另一条请求。');
  const body = forkRevisionSchema.parse(value.body);
  const created = asRecord(value.created);
  if (
    value.created !== undefined &&
    (!created ||
      Object.keys(created).some(
        (key) =>
          !['artworkId', 'projectId', 'revisionId', 'sourceRevisionId', 'sourceAssetId'].includes(
            key,
          ),
      ) ||
      !uuid(created.artworkId) ||
      !uuid(created.revisionId) ||
      created.projectId !== value.projectId ||
      created.sourceRevisionId !== body.revisionId ||
      created.sourceAssetId !== value.sourceAssetId ||
      created.artworkId === artworkId)
  )
    throw new Error('分支回执记录不完整，请先核对这次操作。');
  return Object.freeze({
    schema: 'revision-fork-v1',
    actorId,
    artworkId,
    projectId: value.projectId,
    sourceAssetId: value.sourceAssetId,
    sourceVersion: Number(value.sourceVersion),
    body: Object.freeze(body),
    ...(created ? { created: Object.freeze(created as RevisionForkSuccess) } : {}),
  });
}
export function readRevisionFork(
  storage: RevisionCheckpointStorage,
  actorId: string,
  artworkId: string,
) {
  const raw = storage.getItem(revisionForkStorageKey(actorId, artworkId));
  if (!raw) return null;
  try {
    return parseForkCheckpoint(JSON.parse(raw), actorId, artworkId);
  } catch {
    throw new Error('本机存在无法读取的分支恢复记录。请先核对原操作，避免重复创建。');
  }
}
export function persistRevisionFork(
  storage: RevisionCheckpointStorage,
  value: RevisionForkCheckpoint,
) {
  const existing = readRevisionFork(storage, value.actorId, value.artworkId);
  if (
    existing &&
    (existing.body.idempotencyKey !== value.body.idempotencyKey ||
      JSON.stringify(existing.body) !== JSON.stringify(value.body))
  )
    throw new Error('这个作品还有另一条分支请求需要核对。');
  if (existing?.created && !value.created)
    throw new Error('这次分支已经创建，请打开已有回执中的作品。');
  storage.setItem(revisionForkStorageKey(value.actorId, value.artworkId), JSON.stringify(value));
}
export function completeRevisionFork(
  storage: RevisionCheckpointStorage,
  value: RevisionForkCheckpoint,
  created: RevisionForkSuccess,
) {
  const existing = readRevisionFork(storage, value.actorId, value.artworkId);
  if (!existing || existing.body.idempotencyKey !== value.body.idempotencyKey) return;
  persistRevisionFork(storage, { ...value, created });
}
export function clearRevisionFork(
  storage: RevisionCheckpointStorage,
  value: RevisionForkCheckpoint,
) {
  const existing = readRevisionFork(storage, value.actorId, value.artworkId);
  if (existing?.body.idempotencyKey === value.body.idempotencyKey)
    storage.removeItem(revisionForkStorageKey(value.actorId, value.artworkId));
}

export async function openRevisionForkResult(
  frozen: RevisionForkCheckpoint,
  receipt: RevisionForkSuccess,
  actions: {
    storage: RevisionCheckpointStorage;
    isCurrent: () => boolean;
    onCreated: (receipt: RevisionForkSuccess) => void | boolean | Promise<void | boolean>;
    onClose: () => void;
  },
): Promise<'inactive' | 'kept' | 'opened'> {
  if (!actions.isCurrent()) return 'inactive';
  const opened = await actions.onCreated(receipt);
  if (opened === false) return 'kept';
  // Opening another artwork normally unmounts the source dialog. The known
  // receipt is still complete; key matching protects a later local request.
  clearRevisionFork(actions.storage, frozen);
  if (actions.isCurrent()) actions.onClose();
  return 'opened';
}

/** The API returns the creation snapshot on replay, not the branch's possibly newer head. */
export function revisionForkReceipt(
  value: unknown,
  frozen: RevisionForkCheckpoint,
): RevisionForkSuccess {
  const result = asRecord(value),
    artwork = asRecord(result?.artwork),
    revision = asRecord(result?.revision),
    asset = asRecord(result?.asset);
  if (
    !result ||
    typeof result.replayed !== 'boolean' ||
    !artwork ||
    !revision ||
    !asset ||
    !uuid(artwork.id) ||
    artwork.id === frozen.artworkId ||
    artwork.title !== frozen.body.title ||
    !uuid(revision.id) ||
    revision.id === frozen.body.revisionId ||
    artwork.projectId !== frozen.projectId ||
    artwork.assetId !== frozen.sourceAssetId ||
    artwork.headRevisionId !== revision.id ||
    artwork.headVersion !== 1 ||
    revision.artworkId !== artwork.id ||
    revision.assetId !== frozen.sourceAssetId ||
    revision.version !== 1 ||
    revision.authorId !== frozen.actorId ||
    asset.id !== frozen.sourceAssetId ||
    asset.projectId !== frozen.projectId
  )
    throw new Error('分支回执与原版本不一致。请用原请求核对，暂不重新创建。');
  const origin = asRecord(revision.origin);
  if (origin?.kind !== 'history-fork' || origin.sourceRevisionId !== frozen.body.revisionId)
    throw new Error('分支回执没有匹配的历史版本来源。');
  return Object.freeze({
    artworkId: artwork.id,
    projectId: frozen.projectId,
    revisionId: revision.id,
    sourceRevisionId: frozen.body.revisionId,
    sourceAssetId: frozen.sourceAssetId,
  });
}

/** Only a first attempt's documented pre-write rejection releases the frozen request. */
export function revisionForkRejected(error: unknown, firstAttempt: boolean, hasReceipt = false) {
  return (
    firstAttempt &&
    !hasReceipt &&
    error instanceof ApiError &&
    [400, 401, 403, 404, 409].includes(error.status) &&
    [
      'AUTH_REQUIRED',
      'PROJECT_FORBIDDEN',
      'PROJECT_NOT_FOUND',
      'SPACE_FORBIDDEN',
      'ARTWORK_NOT_FOUND',
      'REVISION_NOT_FOUND',
      'INVALID_RECIPE',
      'LAYER_NOT_UPLOADED',
      'LAYER_ASSET_MISMATCH',
      'SOURCE_UNAVAILABLE',
      'VALIDATION_ERROR',
    ].includes(error.code)
  );
}

export type RevisionRenderInfo = {
  artworkId: string;
  revisionId: string;
  version: number;
  source: { assetId: string; width: number; height: number; kind: 'canonical' | 'retained-proxy' };
  output: { width: number; height: number } | null;
  pixelFormat: 'srgb-rgba8';
  available: boolean;
  limits: string[];
  encodedBytes?: number;
  estimatedWorkingBytes?: number;
  budget?: { maxRasterPixels?: number; maxEncodedBytes?: number; maxWorkingBytes?: number };
};
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
export function validateRevisionRenderInfo(
  value: unknown,
  revision: RevisionReference,
): RevisionRenderInfo {
  const item = asRecord(value),
    source = asRecord(item?.source),
    output = asRecord(item?.output);
  if (
    !item ||
    item.artworkId !== revision.artworkId ||
    item.revisionId !== revision.id ||
    item.version !== revision.version ||
    !source ||
    source.assetId !== revision.assetId ||
    !positive(source.width) ||
    !positive(source.height) ||
    !['canonical', 'retained-proxy'].includes(String(source.kind)) ||
    item.pixelFormat !== 'srgb-rgba8' ||
    typeof item.available !== 'boolean' ||
    !Array.isArray(item.limits) ||
    !item.limits.every((limit) => typeof limit === 'string') ||
    (item.output !== null && (!output || !positive(output.width) || !positive(output.height)))
  )
    throw new Error('服务端渲染信息与所选版本不一致，请重新读取。');
  return item as RevisionRenderInfo;
}
export function revisionRenderState(
  info: RevisionRenderInfo,
): 'available' | 'unsupported' | 'unknown-budget' {
  if (!info.available || info.limits.length) return 'unsupported';
  if (
    !info.output ||
    !positive(info.encodedBytes) ||
    !positive(info.estimatedWorkingBytes) ||
    !positive(info.budget?.maxRasterPixels) ||
    !positive(info.budget?.maxEncodedBytes) ||
    !positive(info.budget?.maxWorkingBytes)
  )
    return 'unknown-budget';
  if (
    info.encodedBytes! > info.budget!.maxEncodedBytes! ||
    info.estimatedWorkingBytes! > info.budget!.maxWorkingBytes! ||
    !Number.isSafeInteger(info.source.width * info.source.height) ||
    info.source.width * info.source.height > info.budget!.maxRasterPixels! ||
    !Number.isSafeInteger(info.output.width * info.output.height) ||
    info.output.width * info.output.height > info.budget!.maxRasterPixels!
  )
    return 'unsupported';
  return 'available';
}
export const revisionRenderLimitLabels: Record<string, string> = {
  GEOMETRY_UNAVAILABLE: '这个版本的几何变换无法计算输出尺寸',
  SOURCE_RASTER_BUDGET: '源图尺寸超出渲染上限',
  LAYER_RASTER_BUDGET: '合成图层超出像素预算',
  OUTPUT_RASTER_BUDGET: '输出或中间画布尺寸超出渲染上限',
  ENCODED_INPUT_BUDGET: '源文件总大小超出读取预算',
  DECODED_WORKING_BUDGET: '解码与合成超过工作内存预算',
};
const browserDownloadLimit = 128 * 1024 * 1024;
export async function fetchRevisionPng(
  info: RevisionRenderInfo,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Blob> {
  if (revisionRenderState(info) !== 'available')
    throw new Error('请先确认这个版本的输出与渲染预算。');
  signal?.throwIfAborted();
  const response = await fetcher(
    `/v1/artworks/${encodeURIComponent(info.artworkId)}/revisions/${encodeURIComponent(info.revisionId)}/render`,
    { credentials: 'include', signal },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.error?.code ?? `HTTP_${response.status}`,
      body?.error?.message ?? '服务端导出未完成，请稍后重试。',
      response.status,
      body?.error?.details,
    );
  }
  if (
    response.headers.get('content-type')?.split(';')[0].trim() !== 'image/png' ||
    response.headers.get('x-xiutu-revision') !== info.revisionId ||
    response.headers.get('x-xiutu-pixel-format') !== info.pixelFormat
  ) {
    await response.body?.cancel();
    throw new Error('导出内容或版本标识不匹配，没有保存文件。');
  }
  const contentLength = response.headers.get('content-length');
  const declared = contentLength === null ? null : Number(contentLength);
  if (declared !== null && Number.isFinite(declared) && declared > browserDownloadLimit) {
    await response.body?.cancel();
    throw new Error('这次导出超过本机 128 MiB 下载预算。');
  }
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  if (!response.body) throw new Error('没有收到完整的 PNG 文件。');
  const reader = response.body.getReader();
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > browserDownloadLimit) throw new Error('这次导出超过本机 128 MiB 下载预算。');
      chunks.push(new Uint8Array(chunk.value).buffer);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  signal?.throwIfAborted();
  if (
    declared !== null &&
    !response.headers.get('content-encoding') &&
    (!Number.isSafeInteger(declared) || declared !== bytes)
  )
    throw new Error('PNG 下载长度不完整，没有保存文件。');
  const blob = new Blob(chunks, { type: 'image/png' });
  const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (
    header.length < 24 ||
    signature.some((byte, index) => header[index] !== byte) ||
    new DataView(header.buffer).getUint32(16) !== info.output!.width ||
    new DataView(header.buffer).getUint32(20) !== info.output!.height
  )
    throw new Error('PNG 内容或输出尺寸不匹配，没有保存文件。');
  // Check chunk boundaries through IEND without decoding pixels or allocating
  // another full-sized image buffer. A correct 24-byte header is not a file.
  let offset = 8,
    imageBytes = 0,
    ended = false;
  while (offset < blob.size) {
    signal?.throwIfAborted();
    const chunkHeader = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    if (chunkHeader.length !== 8) break;
    const length = new DataView(chunkHeader.buffer).getUint32(0);
    const type = String.fromCharCode(...chunkHeader.slice(4));
    if (
      length > 0x7fffffff ||
      !/^[A-Za-z]{4}$/.test(type) ||
      offset + length + 12 > blob.size ||
      (type === 'IHDR' && (offset !== 8 || length !== 13))
    )
      break;
    if (type === 'IDAT') imageBytes += length;
    offset += length + 12;
    if (type === 'IEND') {
      ended = length === 0 && offset === blob.size && imageBytes > 0;
      break;
    }
  }
  if (!ended) throw new Error('PNG 文件结构不完整，没有保存文件。');
  signal?.throwIfAborted();
  return blob;
}
