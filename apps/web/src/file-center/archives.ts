import { LIMITS, fileKind, leafName, type FileKind } from './kinds';

/**
 * Archive readers that never load a whole archive just to list it.
 *
 * - ZIP: reads the end-of-central-directory record and the central directory
 *   from the tail of the Blob (ZIP64 included). An entry is read only when it is
 *   opened: stored entries are zero-copy Blob slices; deflated entries stream
 *   through DecompressionStream with a byte cap and a compression-ratio guard.
 * - TAR: walks 512-byte headers with Blob slices; entry data stays a slice.
 * - TAR.GZ / GZ: gzip has no index, so these stream once and keep at most
 *   LIMITS.streamedArchiveBytes of output.
 * - RAR: decoded by the UnRAR WebAssembly build, which needs the whole archive
 *   in memory, so it is limited by LIMITS.rarBytes.
 *
 * Unsafe names (absolute paths, `..` segments, backslashes) are dropped, as are
 * macOS resource forks.
 */

export interface Item {
  id: string;
  /** Display path; for archive entries it starts with the archive's name. */
  path: string;
  name: string;
  size: number;
  kind: FileKind;
  modified?: number;
  /** Set when the entry is listed but cannot be opened (encrypted, unsupported method). */
  unavailable?: string;
  /** Returns the content. Zero-copy for local files, stored entries and TAR members. */
  blob(): Promise<Blob>;
}

let sequence = 0;
const nextId = () => `i${++sequence}`;

export function fileItem(file: File, path = file.name): Item {
  return {
    id: nextId(),
    path,
    name: leafName(path),
    size: file.size,
    kind: fileKind(path),
    modified: file.lastModified || undefined,
    blob: async () => file,
  };
}

export function bytesItem(path: string, bytes: Uint8Array | Blob, modified?: number): Item {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]);
  return { id: nextId(), path, name: leafName(path), size: blob.size, kind: fileKind(path), modified, blob: async () => blob };
}

export function safeEntryPath(name: string): string | null {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const parts = name.split('/').filter((p) => p && p !== '.');
  if (!parts.length || parts.includes('..')) return null;
  if (parts.some((p) => p === '__MACOSX' || p === '.DS_Store' || p.startsWith('._'))) return null;
  return parts.join('/');
}

async function bytesAt(blob: Blob, start: number, end: number) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) + b[o + 3]! * 0x1000000;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000;

function decodeName(raw: Uint8Array, utf8Flag: boolean) {
  if (utf8Flag) return new TextDecoder('utf-8').decode(raw);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(raw);
  if (!utf8.includes('�')) return utf8;
  // Windows zip tools write the system code page; for Chinese systems that is GBK.
  try {
    return new TextDecoder('gb18030').decode(raw);
  } catch {
    return utf8;
  }
}

function dosTime(date: number, time: number) {
  if (!date) return undefined;
  const d = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

/** Counts bytes through a stream and aborts past a size or ratio limit. */
function limiter(limit: number, compressed: number) {
  let total = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > limit) throw new Error('解压后的内容超过预览上限。');
      if (total > 16 * 1024 * 1024 && total > compressed * LIMITS.entryRatio) throw new Error('该条目的压缩比异常，已停止解压。');
      controller.enqueue(chunk);
    },
  });
}

async function inflate(blob: Blob, format: 'deflate-raw' | 'gzip', limit: number) {
  if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持流式解压，请更新浏览器。');
  const stream = blob.stream().pipeThrough(new DecompressionStream(format) as unknown as TransformStream<Uint8Array, Uint8Array>).pipeThrough(limiter(limit, blob.size));
  return new Response(stream).blob();
}

const zipMethods: Record<number, string> = { 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 98: 'PPMd', 99: 'AES' };

/** Lists a ZIP archive from its central directory. */
export async function readZip(archive: Blob, root: string): Promise<{ items: Item[]; skipped: number }> {
  const tailSize = Math.min(archive.size, 65_557 + 20);
  const tail = await bytesAt(archive, archive.size - tailSize, archive.size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('这不是有效的 ZIP 压缩包，或文件不完整。');
  let count = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error('ZIP64 压缩包缺少目录定位信息。');
    const record = await bytesAt(archive, u64(tail, loc + 8), u64(tail, loc + 8) + 56);
    if (u32(record, 0) !== 0x06064b50) throw new Error('ZIP64 目录记录损坏。');
    count = u64(record, 32);
    cdSize = u64(record, 40);
    cdOffset = u64(record, 48);
  }
  if (cdSize > 128 * 1024 * 1024 || cdOffset + cdSize > archive.size) throw new Error('压缩包目录异常，无法读取。');
  const cd = await bytesAt(archive, cdOffset, cdOffset + cdSize);
  const items: Item[] = [];
  let skipped = 0;
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    const modified = dosTime(u16(cd, p + 14), u16(cd, p + 12));
    let compressed = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLength = u16(cd, p + 28);
    const extraLength = u16(cd, p + 30);
    const commentLength = u16(cd, p + 32);
    let offset = u32(cd, p + 42);
    let name = decodeName(cd.subarray(p + 46, p + 46 + nameLength), (flags & 0x800) !== 0);
    // Extra fields: ZIP64 sizes/offset and the Info-ZIP Unicode path.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = u16(cd, e);
      const length = u16(cd, e + 2);
      let q = e + 4;
      if (id === 0x0001) {
        if (size === 0xffffffff) (size = u64(cd, q)), (q += 8);
        if (compressed === 0xffffffff) (compressed = u64(cd, q)), (q += 8);
        if (offset === 0xffffffff) offset = u64(cd, q);
      } else if (id === 0x7075 && length > 5) {
        name = new TextDecoder('utf-8').decode(cd.subarray(e + 9, e + 4 + length));
      }
      e += 4 + length;
    }
    p = extraEnd + commentLength;
    if (name.endsWith('/')) continue;
    const path = safeEntryPath(name);
    if (!path) {
      skipped++;
      continue;
    }
    if (items.length >= LIMITS.archiveEntries) {
      skipped += count - n;
      break;
    }
    const encrypted = (flags & 1) !== 0;
    const unavailable = encrypted
      ? '这是加密条目，需要密码，无法在浏览器中打开。'
      : method !== 0 && method !== 8
        ? `该条目使用 ${zipMethods[method] ?? `方法 ${method}`} 压缩，浏览器无法解压。`
        : undefined;
    const fullPath = `${root}/${path}`;
    items.push({
      id: nextId(),
      path: fullPath,
      name: leafName(path),
      size,
      kind: fileKind(path),
      modified,
      unavailable,
      async blob() {
        if (unavailable) throw new Error(unavailable);
        const local = await bytesAt(archive, offset, offset + 30);
        if (u32(local, 0) !== 0x04034b50) throw new Error('压缩包条目头损坏。');
        const start = offset + 30 + u16(local, 26) + u16(local, 28);
        const data = archive.slice(start, start + compressed);
        if (method === 0) return data;
        return inflate(data, 'deflate-raw', Math.min(LIMITS.entryBytes, Math.max(size, 1) * 1.01 + 1024));
      },
    });
  }
  return { items, skipped };
}

// ---------- TAR ----------

interface TarHeader {
  name: string;
  size: number;
  type: string;
  modified?: number;
}

function octal(b: Uint8Array, o: number, n: number) {
  if (b[o]! & 0x80) {
    // GNU base-256 for sizes over 8 GiB.
    let v = 0;
    for (let i = o + 1; i < o + n; i++) v = v * 256 + b[i]!;
    return v;
  }
  const s = new TextDecoder().decode(b.subarray(o, o + n)).replace(/\0.*$/s, '').trim();
  return s ? parseInt(s, 8) : 0;
}
const cString = (b: Uint8Array, o: number, n: number) => {
  const raw = b.subarray(o, o + n);
  const end = raw.indexOf(0);
  return decodeName(end < 0 ? raw : raw.subarray(0, end), false);
};

function tarHeader(b: Uint8Array): TarHeader | null {
  if (b.every((x) => x === 0)) return null;
  let name = cString(b, 0, 100);
  const magic = new TextDecoder().decode(b.subarray(257, 262));
  if (magic === 'ustar') {
    const prefix = cString(b, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
  }
  const mtime = octal(b, 136, 12);
  return { name, size: octal(b, 124, 12), type: String.fromCharCode(b[156] || 48), modified: mtime ? mtime * 1000 : undefined };
}
const paxPath = (text: string) => /(?:^|\n)\d+ path=([^\n]*)/.exec(text)?.[1];

/** Lists an uncompressed TAR by walking its headers; data stays in the Blob. */
export async function readTar(archive: Blob, root: string): Promise<{ items: Item[]; skipped: number }> {
  const items: Item[] = [];
  let skipped = 0;
  let offset = 0;
  let longName: string | undefined;
  while (offset + 512 <= archive.size) {
    const header = tarHeader(await bytesAt(archive, offset, offset + 512));
    if (!header) break;
    const dataStart = offset + 512;
    const next = dataStart + Math.ceil(header.size / 512) * 512;
    if (header.type === 'L' || header.type === 'x') {
      const text = new TextDecoder().decode(await bytesAt(archive, dataStart, dataStart + Math.min(header.size, 65536)));
      longName = header.type === 'L' ? text.replace(/\0.*$/s, '') : (paxPath(text) ?? longName);
    } else if (header.type === '0' || header.type === '7') {
      const path = safeEntryPath(longName ?? header.name);
      longName = undefined;
      if (!path) skipped++;
      else if (items.length >= LIMITS.archiveEntries) skipped++;
      else {
        const data = archive.slice(dataStart, dataStart + header.size);
        items.push({ ...bytesItem(`${root}/${path}`, data, header.modified) });
      }
    } else longName = undefined;
    offset = next;
  }
  return { items, skipped };
}

/** Streams a gzip-compressed TAR once and keeps its members (bounded). */
export async function readTarGz(archive: Blob, root: string): Promise<{ items: Item[]; skipped: number }> {
  if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持流式解压，请更新浏览器。');
  const reader = archive
    .stream()
    .pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
    .pipeThrough(limiter(LIMITS.streamedArchiveBytes, archive.size))
    .getReader();
  const items: Item[] = [];
  let skipped = 0;
  let buffer = new Uint8Array(0);
  let longName: string | undefined;
  let pending: { header: TarHeader; remaining: number; parts: Uint8Array[]; padding: number } | null = null;
  const append = (chunk: Uint8Array) => {
    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer);
    merged.set(chunk, buffer.length);
    buffer = merged;
  };
  let done = false;
  while (!done) {
    const read = await reader.read();
    if (read.value) append(read.value);
    done = read.done;
    for (;;) {
      if (pending) {
        const take = Math.min(pending.remaining, buffer.length);
        if (take) {
          pending.parts.push(buffer.slice(0, take));
          buffer = buffer.subarray(take);
          pending.remaining -= take;
        }
        if (pending.remaining) break;
        if (buffer.length < pending.padding) break;
        buffer = buffer.subarray(pending.padding);
        const { header, parts } = pending;
        pending = null;
        if (header.type === 'L' || header.type === 'x') {
          const text = new TextDecoder().decode(new Blob(parts as BlobPart[]).size < 65536 ? concat(parts) : new Uint8Array());
          longName = header.type === 'L' ? text.replace(/\0.*$/s, '') : (paxPath(text) ?? longName);
        } else if (header.type === '0' || header.type === '7') {
          const path = safeEntryPath(longName ?? header.name);
          longName = undefined;
          if (!path || items.length >= LIMITS.archiveEntries) skipped++;
          else items.push(bytesItem(`${root}/${path}`, new Blob(parts as BlobPart[]), header.modified));
        } else longName = undefined;
        continue;
      }
      if (buffer.length < 512) break;
      const header = tarHeader(buffer.subarray(0, 512));
      buffer = buffer.subarray(512);
      if (!header) {
        done = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      pending = { header, remaining: header.size, parts: [], padding: (512 - (header.size % 512)) % 512 };
    }
  }
  return { items, skipped };
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}

/** A single gzip file (not a TAR): decompressed once, named without `.gz`. */
export async function readGzip(archive: Blob, path: string): Promise<Item> {
  const blob = await inflate(archive, 'gzip', LIMITS.streamedArchiveBytes);
  return bytesItem(path.replace(/\.gz$/i, '') || path, blob);
}

// ---------- RAR ----------

type FileHeaderLike = { name: string; flags: { directory: boolean; encrypted: boolean }; unpSize: number; time: string };

const loadUnrarWasm = async () => {
  const url = (await import('node-unrar-js/esm/js/unrar.wasm?url')).default as string;
  return (await fetch(url)).arrayBuffer();
};

export async function readRar(archive: Blob, root: string, loadWasm: () => Promise<ArrayBuffer> = loadUnrarWasm): Promise<{ items: Item[]; skipped: number }> {
  if (archive.size > LIMITS.rarBytes) throw new Error('RAR 压缩包超过 1 GB，浏览器无法完整载入，请解压后打开文件夹。');
  const [{ createExtractorFromData }, wasmBinary] = await Promise.all([import('node-unrar-js'), loadWasm()]);
  const data = await archive.arrayBuffer();
  const open = () => createExtractorFromData({ wasmBinary, data });
  let headers: FileHeaderLike[];
  try {
    const list = (await open()).getFileList();
    if (list.arcHeader.flags.headerEncrypted) throw new Error('RAR 压缩包的文件名已加密，需要密码才能打开。');
    if (list.arcHeader.flags.volume) throw new Error('这是分卷 RAR 的一部分，请把所有分卷合并或解压后再打开。');
    headers = [...list.fileHeaders];
  } catch (error) {
    throw new Error(error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : rarError(error));
  }
  const items: Item[] = [];
  let skipped = 0;
  for (const header of headers) {
    if (header.flags.directory) continue;
    const path = safeEntryPath(header.name.replace(/\\/g, '/'));
    if (!path || items.length >= LIMITS.archiveEntries) {
      skipped++;
      continue;
    }
    const unavailable = header.flags.encrypted ? '这是加密条目，需要密码，无法在浏览器中打开。' : undefined;
    const modified = Date.parse(header.time) || undefined;
    let cached: Blob | null = null;
    items.push({
      id: nextId(),
      path: `${root}/${path}`,
      name: leafName(path),
      size: header.unpSize,
      kind: fileKind(path),
      modified,
      unavailable,
      async blob() {
        if (unavailable) throw new Error(unavailable);
        if (cached) return cached;
        if (header.unpSize > LIMITS.entryBytes) throw new Error('该条目超过预览上限。');
        try {
          const run = (await open()).extract({ files: [header.name] });
          for (const file of run.files) if (file.extraction) cached = new Blob([file.extraction as BlobPart]);
        } catch (error) {
          throw new Error(rarError(error));
        }
        if (!cached) throw new Error('没有在压缩包中找到该条目。');
        return cached;
      },
    });
  }
  return { items, skipped };
}

function rarError(error: unknown) {
  const reason = (error as { reason?: string })?.reason;
  if (reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD') return '该 RAR 需要密码，无法在浏览器中打开。';
  if (reason === 'ERAR_BAD_ARCHIVE' || reason === 'ERAR_UNKNOWN_FORMAT') return '这不是有效的 RAR 压缩包，或文件已损坏。';
  if (reason === 'ERAR_BAD_DATA') return '压缩包数据校验失败，文件可能已损坏。';
  if (reason === 'ERAR_NO_MEMORY') return '压缩包太大，浏览器内存不足。';
  return '无法读取这个 RAR 压缩包，文件可能已损坏或不完整。';
}

/** The folder an archive's entries appear under: its path without the extension. */
export const archiveRoot = (path: string) => path.replace(/\.(zip|jar|apk|xpi|tar|tgz|rar|tar\.gz)$/i, '');

/** Expands any supported archive into items under `<root>/`. */
export async function expandArchive(item: Item): Promise<{ items: Item[]; skipped: number }> {
  const blob = await item.blob();
  const root = archiveRoot(item.path);
  if (item.kind === 'zip') return readZip(blob, root);
  if (item.kind === 'rar') return readRar(blob, root);
  if (item.kind === 'tar') return /\.(tgz|tar\.gz)$/i.test(item.name) ? readTarGz(blob, root) : readTar(blob, root);
  if (item.kind === 'gzip') return { items: [await readGzip(blob, item.path)], skipped: 0 };
  throw new Error('不支持的压缩格式。');
}
