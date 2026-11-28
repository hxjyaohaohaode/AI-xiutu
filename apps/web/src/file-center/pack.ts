import { Zip, ZipPassThrough } from 'fflate';
import type { Item } from './archives';
import { fileItem } from './archives';
import { cleanText, docxFromBlob, odtFromBlob, readEpub, rtfText, decodeText, textDocument, type DocumentDraft } from './convert';
import { htmlToMarkdown } from './html-to-markdown';
import { LIMITS, baseName } from './kinds';

/**
 * Folder drops, packing a selection into one .zip download, and merging
 * several files into one project document — the "collect everything in one
 * place" flow of a notes app, built from files that are already open.
 */

type Entry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string };
type FileEntry = Entry & { file: (ok: (f: File) => void, fail: (e: unknown) => void) => void };
type DirEntry = Entry & { createReader: () => { readEntries: (ok: (e: Entry[]) => void, fail: (e: unknown) => void) => void } };

/** Expands dropped folders (DataTransferItem entries) into files with relative paths. */
export async function droppedItems(transfer: DataTransfer): Promise<Item[]> {
  const entries: Entry[] = [];
  for (const i of [...transfer.items]) {
    const entry = (i as unknown as { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (!entries.length) return [...transfer.files].map((f) => fileItem(f));
  const out: Item[] = [];
  const walk = async (entry: Entry): Promise<void> => {
    if (out.length >= LIMITS.archiveEntries) return;
    if (entry.isFile) {
      const file = await new Promise<File>((ok, fail) => (entry as FileEntry).file(ok, fail));
      out.push(fileItem(file, entry.fullPath.replace(/^\//, '')));
    } else if (entry.isDirectory) {
      const reader = (entry as DirEntry).createReader();
      // readEntries returns batches (about 100) until an empty batch.
      for (;;) {
        const batch = await new Promise<Entry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

/** Streams the selection into a stored (uncompressed) zip; media is already compressed. */
export async function zipSelection(items: Item[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let failure: unknown;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else parts.push(chunk);
  });
  const used = new Set<string>();
  for (const item of items) {
    if (item.unavailable) continue;
    let name = item.path;
    for (let n = 2; used.has(name); n++) name = item.path.replace(/(\.[^./]+)?$/, ` (${n})$1`);
    used.add(name);
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    const reader = (await item.blob()).stream().getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      entry.push(value);
    }
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}

export const mergeable = (item: Item) =>
  !item.unavailable && ['markdown', 'text', 'code', 'json', 'html', 'docx', 'odt', 'rtf', 'epub'].includes(item.kind);

async function asText(item: Item): Promise<string> {
  const blob = await item.blob();
  if (item.kind === 'docx') return (await docxFromBlob(item.name, blob)).body;
  if (item.kind === 'odt') return (await odtFromBlob(item.name, blob)).body;
  if (item.kind === 'rtf') return rtfText(decodeText(new Uint8Array(await blob.slice(0, 16 * 1024 * 1024).arrayBuffer())));
  if (item.kind === 'html') return htmlToMarkdown(decodeText(new Uint8Array(await blob.slice(0, 8 * 1024 * 1024).arrayBuffer()))).body;
  if (item.kind === 'epub') {
    const book = await readEpub(blob);
    let body = '';
    for (const c of book.chapters) {
      if (body.length > LIMITS.textChars) break;
      body += `\n\n## ${c.title}\n` + htmlToMarkdown(await book.chapter(c.href)).body;
    }
    return body.trim();
  }
  return textDocument(item.name, new Uint8Array(await blob.slice(0, LIMITS.textChars * 4).arrayBuffer())).body;
}

/** One document with a level-1 heading per source file, in the order given. */
export async function mergeDocuments(items: Item[], title: string): Promise<DocumentDraft> {
  const sections: string[] = [];
  const notes: string[] = [];
  let length = 0;
  for (const item of items.filter(mergeable)) {
    if (length >= LIMITS.textChars) {
      notes.push('合并后的内容超过 100000 字符，后面的文件未合并。');
      break;
    }
    const text = (await asText(item)).replace(/^#\s/gm, '## ');
    const section = `# ${baseName(item.name)}\n${text}`;
    sections.push(section);
    length += section.length + 2;
  }
  if (!sections.length) throw new Error('所选文件中没有可以合并的文档。');
  const skipped = items.length - items.filter(mergeable).length;
  if (skipped) notes.push(`有 ${skipped} 个文件不是文本类文档，未合并。`);
  return { title, body: cleanText(sections.join('\n\n')), notes };
}
