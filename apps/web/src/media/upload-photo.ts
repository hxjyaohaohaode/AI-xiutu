import { sha256 } from '@noble/hashes/sha2.js';
import { isRetainedPhoto, PHOTO_MAX_BYTES, PHOTO_RETAIN_BYTES, MAX_HEADER_BYTES, MAX_TILED_DIMENSION, PHOTO_MAX_PIXELS, readImageHeader } from '@ai-xiutu/editor';
import { api, jsonRequest } from '../lib/api';
import type { Asset } from '../lib/types';
import { t } from '../i18n';
import { secureUuid } from '../lib/uuid';

interface PhotoJob {
  id: string; projectId: string; size: number; uploadedBytes: number; maxChunkBytes: number;
  state: 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled'; errorMessage: string | null;
}
type Receipt = { job: PhotoJob; asset: Asset | null };
const chunkSize = 4 * 1024 * 1024;
const digests = new WeakMap<File, Promise<string>>();

export async function photoFileDigest(file: File, signal?: AbortSignal) {
  const hash = sha256.create();
  for (let i = 0; i < file.size; i += chunkSize) {
    signal?.throwIfAborted();
    hash.update(new Uint8Array(await file.slice(i, i + chunkSize).arrayBuffer()));
  }
  signal?.throwIfAborted();
  return Array.from(hash.digest(), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** Large static photos use the same private original/master/proxy lifecycle as the media library.
 * Retry identity includes the content digest, account, project, and requested asset name. */
export async function uploadProjectPhoto(file: File, projectId: string, actorId: string,
  assertCurrent: () => void = () => {}, ordinaryQuery = ''): Promise<Asset> {
  let retained = false;
  const header = new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer());
  try {
    const info = readImageHeader(header, { maxPixels: PHOTO_MAX_PIXELS, maxDimension: MAX_TILED_DIMENSION });
    retained = !info.animated && isRetainedPhoto(info.format, file.size, info.width * info.height);
  } catch {
    const staticPhoto = (header[0] === 0xff && header[1] === 0xd8) ||
      (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47);
    if (staticPhoto && file.size > PHOTO_RETAIN_BYTES)
      throw new Error(t('大图的尺寸或格式超出普通照片导入范围。'));
    // Other supported formats use the ordinary asset decoder.
  }
  assertCurrent();
  if (!retained) {
    const body = new FormData();
    body.append('file', file);
    return (await api<{ asset: Asset }>('/projects/' + projectId + '/assets' + ordinaryQuery, { method: 'POST', body })).asset;
  }
  let digest = digests.get(file);
  if (!digest) {
    digest = photoFileDigest(file).catch((error) => { digests.delete(file); throw error; });
    digests.set(file, digest);
  }
  const content = await digest;
  const declaredSource = new URLSearchParams(ordinaryQuery).get('source') === 'sketch' ? 'sketch' : 'upload';
  const checkpoint = 'photo-upload:' + declaredSource + ':' + actorId + ':' + projectId + ':' + content + ':' + file.name;
  let key: string | null = null;
  try { key = sessionStorage.getItem(checkpoint); } catch {}
  if (!key) {
    key = secureUuid();
    try { sessionStorage.setItem(checkpoint, key); } catch {}
  }
  assertCurrent();
  let { job } = await api<{ job: PhotoJob }>('/projects/' + projectId + '/media-imports',
    jsonRequest('POST', { profile: 'photo', name: file.name, size: file.size, sourceSha256: content, declaredSource, idempotencyKey: key, generateTiles: false }));
  const path = '/media-imports/' + job.id;
  if (job.projectId !== projectId || job.size !== file.size || job.maxChunkBytes < 1 ||
      job.maxChunkBytes > chunkSize || job.uploadedBytes < 0 || job.uploadedBytes > file.size)
    throw new Error(t('原件上传回执无效，请重试。'));
  let offset = job.uploadedBytes;
  while (job.state === 'uploading' && offset < file.size) {
    assertCurrent();
    const end = Math.min(file.size, offset + job.maxChunkBytes);
    const ack = await api<{ uploadedBytes: number }>(path + '/chunk?offset=' + offset, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file.slice(offset, end),
    });
    if (ack.uploadedBytes !== end) throw new Error(t('原件上传回执无效，请重试。'));
    offset = end;
  }
  if (job.state === 'uploading') {
    assertCurrent();
    ({ job } = await api<{ job: PhotoJob }>(path + '/complete', jsonRequest('POST')));
  }
  for (;;) {
    assertCurrent();
    const receipt = await api<Receipt>(path);
    if (receipt.job.state === 'ready' && receipt.asset?.projectId === projectId &&
        receipt.asset.provenance?.sourceSha256 === content) return receipt.asset;
    if (receipt.job.state !== 'processing') {
      try { sessionStorage.removeItem(checkpoint); } catch {}
      throw new Error(receipt.job.errorMessage || t('未能核实项目原件，请重试。'));
    }
    await new Promise((done) => setTimeout(done, 600));
  }
}

export function retainedPhotoDimensions(asset: Asset | undefined) {
  const source = asset?.provenance;
  const width = source?.uprightWidth, height = source?.uprightHeight;
  return source?.editorProxy === true && typeof width === 'number' && typeof height === 'number' &&
    Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
    ? { width, height, sha256: typeof source.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sourceSha256)
        ? source.sourceSha256 : null, photoExportable: source.profile === 'photo' &&
        (source.originalFormat === 'jpeg' || source.originalFormat === 'png') &&
        typeof source.originalBytes === 'number' && Number.isSafeInteger(source.originalBytes) &&
        source.originalBytes > 0 && source.originalBytes <= PHOTO_MAX_BYTES &&
        typeof source.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sourceSha256) &&
        width * height <= PHOTO_MAX_PIXELS && Math.max(width, height) <= MAX_TILED_DIMENSION }
    : undefined;
}
