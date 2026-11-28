import { strFromU8, unzipSync } from 'fflate';
import {
  documentFormatSchema,
  writePresentation,
  type DocumentFormat,
  type PresentationDoc,
} from '@ai-xiutu/contracts';
import { readZip } from './archives';
import { LIMITS, baseName, codeLanguages, extensionOf, fileKind } from './kinds';

export { LIMITS, baseName, codeLanguages, extensionOf, fileKind, formatBytes, type FileKind } from './kinds';

/**
 * Pure file conversion for the file center. Everything runs in the browser on
 * bytes the user chose; nothing is uploaded until they save the result as a
 * project document. Office packages are read part by part from the archive's
 * central directory, so a 500 MB deck full of media only costs its XML.
 */

export type Parts = Record<string, Uint8Array>;

/** Reads the named parts of a ZIP-based package (DOCX, PPTX, ODF, EPUB) from a Blob. */
export async function zipParts(blob: Blob, wanted: (path: string) => boolean, maxPart = 48 * 1024 * 1024): Promise<Parts> {
  const { items } = await readZip(blob, '');
  const parts: Parts = {};
  for (const item of items) {
    const path = item.path.replace(/^\//, '');
    if (!wanted(path) || item.size > maxPart || item.unavailable) continue;
    parts[path] = new Uint8Array(await (await item.blob()).arrayBuffer());
  }
  return parts;
}
const syncParts = (bytes: Uint8Array, wanted: (path: string) => boolean, maxPart = 48 * 1024 * 1024): Parts =>
  unzipSync(bytes, { filter: (f) => wanted(f.name) && f.originalSize <= maxPart });

/** Paths of a ZIP-based package without reading any part (to count media, find thumbnails). */
export async function zipPaths(blob: Blob) {
  return (await readZip(blob, '')).items.map((i) => i.path.replace(/^\//, ''));
}

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
  index?: number;
}

/** Builds a folder tree from slash-separated paths (zip entries or a picked folder). */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  paths.forEach((path, index) => {
    const parts = path.split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join('/');
      let child = node.children!.find((c) => c.name === part && !!c.children === !isFile);
      if (!child) {
        child = isFile ? { name: part, path: childPath, index } : { name: part, path: childPath, children: [] };
        node.children!.push(child);
      }
      node = child;
    });
  });
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name))
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n));
  return sort(root.children!);
}

export function decodeText(bytes: Uint8Array) {
  // UTF-8 first (with BOM removal); fall back to GB18030 for older Chinese files.
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^﻿/, '');
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('gb18030').decode(bytes);
  } catch {
    return utf8;
  }
}

/** Keeps characters the document store accepts and trims to its size limit. */
export function cleanText(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\u0009\u000a -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .slice(0, LIMITS.textChars);
}

export interface DocumentDraft {
  title: string;
  body: string;
  formatting?: DocumentFormat | null;
  notes: string[];
}

export function textDocument(name: string, bytes: Uint8Array): DocumentDraft {
  const kind = fileKind(name);
  const text = cleanText(decodeText(bytes));
  if (kind === 'code' || kind === 'json') {
    const language = codeLanguages[extensionOf(name)] ?? extensionOf(name);
    const fence = text.includes('```') ? '~~~~' : '```';
    return { title: baseName(name), body: cleanText(`${fence}${language}\n${text}\n${fence}`), notes: [] };
  }
  return { title: baseName(name), body: text, notes: [] };
}

// ---------- Word (.docx) ----------

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

type Run = { text: string; bold?: true; italic?: true; underline?: true; strike?: true };

function docxRuns(paragraphXml: string): Run[] {
  const runs: Run[] = [];
  for (const match of paragraphXml.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
    const xml = match[0];
    const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(xml)?.[1] ?? '';
    const on = (tag: string) => new RegExp(`<w:${tag}(?: w:val="(?:true|1|on|single)")?\\s*/>`).test(props);
    let text = '';
    for (const piece of xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g))
      text += piece[0].startsWith('<w:tab') ? '\t' : piece[0].startsWith('<w:br') ? ' ' : xmlText(piece[1] ?? '');
    if (!text) continue;
    runs.push({
      text,
      ...(on('b') ? { bold: true as const } : {}),
      ...(on('i') ? { italic: true as const } : {}),
      ...(/<w:u w:val="(?!none)/.test(props) ? { underline: true as const } : {}),
      ...(on('strike') ? { strike: true as const } : {}),
    });
  }
  return runs;
}

function headingLevel(paragraphXml: string, styles: Map<string, number>) {
  const style = /<w:pStyle w:val="([^"]+)"/.exec(paragraphXml)?.[1];
  if (!style) return 0;
  if (styles.has(style)) return styles.get(style)!;
  const m = /^(?:Heading|heading|标题)\s*([1-6])$/.exec(style);
  if (m) return Number(m[1]);
  return /^Title$/i.test(style) ? 1 : 0;
}

/**
 * Converts a .docx to a document: headings, bulleted/numbered paragraphs, tables
 * (as Markdown tables), and bold/italic/underline/strikethrough runs. Images,
 * comments, tracked changes and complex layout are listed as notes.
 */
const docxWanted = (path: string) => /^word\/(document|styles|numbering)\.xml$/.test(path);
export function docxDocument(name: string, bytes: Uint8Array): DocumentDraft {
  const files = syncParts(bytes, (p) => docxWanted(p) || p.startsWith('word/media/'));
  return docxFromParts(name, files, Object.keys(files).filter((f) => f.startsWith('word/media/')).length);
}
export async function docxFromBlob(name: string, blob: Blob): Promise<DocumentDraft> {
  const [files, paths] = await Promise.all([zipParts(blob, docxWanted), zipPaths(blob)]);
  return docxFromParts(name, files, paths.filter((f) => f.startsWith('word/media/')).length);
}
function docxFromParts(name: string, files: Parts, images: number): DocumentDraft {
  const documentXml = files['word/document.xml'];
  if (!documentXml) throw new Error('这不是有效的 Word 文档。');
  const xml = strFromU8(documentXml);
  const styles = new Map<string, number>();
  const stylesXml = files['word/styles.xml'] ? strFromU8(files['word/styles.xml']) : '';
  for (const s of stylesXml.matchAll(/<w:style [^>]*w:styleId="([^"]+)"[\s\S]*?<\/w:style>/g)) {
    const level = /<w:name w:val="(?:heading|Heading) ([1-6])"/.exec(s[0])?.[1];
    if (level) styles.set(s[1]!, Number(level));
  }
  // numId → whether level 0 is a numbered (not bulleted) format.
  const numberingXml = files['word/numbering.xml'] ? strFromU8(files['word/numbering.xml']) : '';
  const abstractNumbered = new Map<string, boolean>();
  for (const a of numberingXml.matchAll(/<w:abstractNum [^>]*w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g)) {
    const format = /<w:lvl w:ilvl="0"[\s\S]*?<w:numFmt w:val="([^"]+)"/.exec(a[0])?.[1] ?? 'bullet';
    abstractNumbered.set(a[1]!, format !== 'bullet' && format !== 'none');
  }
  const numbered = new Map<string, boolean>();
  for (const n of numberingXml.matchAll(/<w:num w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g))
    numbered.set(n[1]!, abstractNumbered.get(n[2]!) ?? false);
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? '';
  const lines: string[] = [];
  const paragraphs: DocumentFormat['paragraphs'] = [];
  const notes: string[] = [];
  if (images) notes.push(`文档中有 ${images} 张图片未导入，可另存后作为项目图片插入。`);
  let ordered = 0;
  const pushParagraph = (prefix: string, runs: Run[]) => {
    const line = lines.length;
    let cursor = prefix.length;
    const formatted: DocumentFormat['paragraphs'][number]['runs'] = [];
    for (const run of runs) {
      const from = cursor,
        to = cursor + run.text.length;
      cursor = to;
      const style = { ...(run.bold ? { bold: true as const } : {}), ...(run.italic ? { italic: true as const } : {}), ...(run.underline ? { underline: true as const } : {}), ...(run.strike ? { strike: true as const } : {}) };
      if (Object.keys(style).length && to > from) formatted.push({ from, to, ...style });
    }
    lines.push(prefix + runs.map((r) => r.text).join(''));
    if (formatted.length && paragraphs.length < 2000) paragraphs.push({ line, runs: formatted.slice(0, 200) });
  };
  for (const block of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const chunk = block[0];
    if (chunk.startsWith('<w:tbl>')) {
      const rows = [...chunk.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((row) =>
        [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) =>
          docxRuns(cell[0]).map((r) => r.text).join('').replace(/\|/g, '｜').trim(),
        ),
      );
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
        if (lines.length && lines.at(-1) !== '') lines.push('');
        lines.push('| ' + pad(rows[0]!).join(' | ') + ' |', '| ' + Array(width).fill('---').join(' | ') + ' |');
        for (const row of rows.slice(1)) lines.push('| ' + pad(row).join(' | ') + ' |');
        lines.push('');
      }
      ordered = 0;
      continue;
    }
    const runs = docxRuns(chunk);
    const level = headingLevel(chunk, styles);
    const list = /<w:numPr>/.test(chunk);
    const isNumbered = list && numbered.get(/<w:numId w:val="(\d+)"/.exec(chunk)?.[1] ?? '') === true;
    if (!runs.length) {
      lines.push('');
      ordered = 0;
      continue;
    }
    if (level) pushParagraph('#'.repeat(level) + ' ', runs);
    else if (list) pushParagraph(isNumbered ? `${++ordered}. ` : '- ', runs);
    else {
      ordered = 0;
      pushParagraph('', runs);
    }
  }
  while (lines.length && lines.at(-1) === '') lines.pop();
  const text = lines.join('\n');
  if (text.length > LIMITS.textChars) throw new Error('Word 文档超过 100000 字符，请拆分后导入。');
  const formatting = paragraphs.length ? { version: 1 as const, paragraphs } : null;
  return {
    title: baseName(name),
    body: text,
    formatting: formatting && documentFormatSchema.safeParse(formatting).success ? formatting : null,
    notes,
  };
}

// ---------- PowerPoint (.pptx) ----------

const slideWanted = (path: string) => /^ppt\/slides\/slide\d+\.xml$/.test(path);
export function pptxSlides(bytes: Uint8Array) {
  return slidesFromParts(syncParts(bytes, slideWanted, 8 * 1024 * 1024));
}
function slidesFromParts(files: Parts): { title: string; lines: string[] }[] {
  return Object.keys(files)
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
    .map((path) => {
      const xml = strFromU8(files[path]!);
      const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((sp) => ({
        title: /<p:ph type="(?:title|ctrTitle)"/.test(sp[0]),
        paragraphs: [...sp[0].matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
          .map((p) => [...p[1]!.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => xmlText(t[1]!)).join(''))
          .filter((t) => t.trim()),
      }));
      const titleShape = shapes.find((s) => s.title) ?? shapes.find((s) => s.paragraphs.length);
      const title = titleShape?.paragraphs.join(' ') ?? '';
      const lines = shapes.filter((s) => s !== titleShape).flatMap((s) => s.paragraphs);
      return { title, lines };
    });
}

/** Rebuilds a .pptx as an editable deck: one title and one body text box per slide. */
export function pptxPresentation(name: string, bytes: Uint8Array): DocumentDraft {
  return deckDraft(name, pptxSlides(bytes), ['已导入每页标题与文字；图片、图表和动画需在编辑器中重新添加。']);
}
export async function pptxFromBlob(name: string, blob: Blob): Promise<DocumentDraft> {
  return deckDraft(name, slidesFromParts(await zipParts(blob, slideWanted, 8 * 1024 * 1024)), ['已导入每页标题与文字；图片、图表和动画需在编辑器中重新添加。']);
}
/** Builds an editable deck: one title and one body text box per slide (max 50). */
export function deckDraft(name: string, all: { title: string; lines: string[] }[], notes: string[]): DocumentDraft {
  const slides = all.slice(0, 50);
  if (!slides.length) throw new Error('没有在演示文稿中找到幻灯片。');
  const box = (y: number, height: number, text: string, size: number, bold: boolean) => ({
    id: crypto.randomUUID(), kind: 'text' as const, x: 100, y, width: 1400, height, rotation: 0,
    text: text.slice(0, 5000), color: '#1F2937', font: 'Aptos' as const, size, bold, align: 'left' as const,
  });
  const deck: PresentationDoc = {
    version: 1,
    slides: slides.map((slide, i) => ({
      id: crypto.randomUUID(),
      name: (slide.title || `幻灯片 ${i + 1}`).slice(0, 120),
      background: '#FFFFFF',
      elements: [
        box(70, 140, slide.title || `幻灯片 ${i + 1}`, 48, true),
        ...(slide.lines.length ? [box(240, 600, slide.lines.map((l) => '• ' + l).join('\n'), 28, false)] : []),
      ],
    })),
  };
  const body = writePresentation(deck);
  if (!body) throw new Error('演示文稿内容超出可编辑范围。');
  if (all.length > 50) notes = [...notes, `共 ${all.length} 页，已导入前 50 页。`];
  return { title: baseName(name), body, notes };
}

// ---------- OpenDocument (.odt / .odp) ----------

function odfText(xml: string) {
  return xmlText(
    xml
      .replace(/<text:s(?: text:c="(\d+)")?\s*\/>/g, (_, n) => ' '.repeat(Number(n ?? 1)))
      .replace(/<text:tab\s*\/>/g, '\t')
      .replace(/<text:line-break\s*\/>/g, ' ')
      .replace(/<text:note\b[\s\S]*?<\/text:note>/g, '')
      .replace(/<[^>]+>/g, ''),
  );
}

/** OpenDocument text: headings by outline level, list items, tables and paragraphs. */
export async function odtFromBlob(name: string, blob: Blob): Promise<DocumentDraft> {
  const parts = await zipParts(blob, (p) => p === 'content.xml');
  if (!parts['content.xml']) throw new Error('这不是有效的 OpenDocument 文本。');
  const xml = /<office:text[^>]*>([\s\S]*)<\/office:text>/.exec(strFromU8(parts['content.xml']))?.[1] ?? '';
  const lines: string[] = [];
  const blocks = /<text:h\b([^>]*)>([\s\S]*?)<\/text:h>|<text:list\b[^>]*>([\s\S]*?)<\/text:list>|<table:table\b[^>]*>([\s\S]*?)<\/table:table>|<text:p\b[^>]*>([\s\S]*?)<\/text:p>|<text:p\b[^>]*\/>/g;
  for (const m of xml.matchAll(blocks)) {
    if (m[2] !== undefined) {
      const level = Math.min(6, Math.max(1, Number(/text:outline-level="(\d)"/.exec(m[1] ?? '')?.[1] ?? 1)));
      lines.push('#'.repeat(level) + ' ' + odfText(m[2]).trim());
    } else if (m[3] !== undefined) {
      for (const item of m[3].matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)) lines.push('- ' + odfText(item[1]!).trim());
    } else if (m[4] !== undefined) {
      const rows = [...m[4].matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)].map((row) =>
        [...row[1]!.matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>|<table:table-cell\b[^>]*\/>/g)].map((c) =>
          odfText(c[1] ?? '').replace(/\|/g, '｜').trim(),
        ),
      );
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
        lines.push('', '| ' + pad(rows[0]!).join(' | ') + ' |', '| ' + Array(width).fill('---').join(' | ') + ' |');
        for (const row of rows.slice(1)) lines.push('| ' + pad(row).join(' | ') + ' |');
        lines.push('');
      }
    } else lines.push(odfText(m[5] ?? ''));
  }
  const body = cleanText(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
  return { title: baseName(name), body, notes: lines.join('\n').length > LIMITS.textChars ? ['内容超过 100000 字符，已截断。'] : [] };
}

export async function odpFromBlob(name: string, blob: Blob): Promise<DocumentDraft> {
  const parts = await zipParts(blob, (p) => p === 'content.xml');
  if (!parts['content.xml']) throw new Error('这不是有效的 OpenDocument 演示。');
  const xml = strFromU8(parts['content.xml']);
  const slides = [...xml.matchAll(/<draw:page\b[^>]*>([\s\S]*?)<\/draw:page>/g)].map((page) => {
    const frames = [...page[1]!.matchAll(/<draw:frame\b([^>]*)>([\s\S]*?)<\/draw:frame>/g)].map((f) => ({
      title: /presentation:class="title"/.test(f[1]!),
      lines: [...f[2]!.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map((p) => odfText(p[1]!).trim()).filter(Boolean),
    }));
    const titleFrame = frames.find((f) => f.title) ?? frames.find((f) => f.lines.length);
    return { title: titleFrame?.lines.join(' ') ?? '', lines: frames.filter((f) => f !== titleFrame).flatMap((f) => f.lines) };
  });
  if (!slides.length) throw new Error('没有在演示文稿中找到幻灯片。');
  return deckDraft(name, slides, ['已导入每页标题与文字；图片和动画需在编辑器中重新添加。']);
}

// ---------- RTF ----------

/** Plain text from RTF: paragraphs, tabs, \uN and \'hh escapes (code page aware). */
export function rtfText(source: string): string {
  const codePage = Number(/\\ansicpg(\d+)/.exec(source)?.[1] ?? 1252);
  const encoding = codePage === 936 ? 'gb18030' : codePage === 950 ? 'big5' : codePage === 932 ? 'shift_jis' : codePage === 65001 ? 'utf-8' : 'windows-1252';
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding);
  } catch {
    decoder = new TextDecoder('windows-1252');
  }
  const skipDestinations = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|footnote|themedata|datastore|latentstyles|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|mmathPr)$/;
  let out = '';
  let bytes: number[] = [];
  const flush = () => {
    if (bytes.length) out += decoder.decode(new Uint8Array(bytes));
    bytes = [];
  };
  const stack: { skip: boolean; uc: number }[] = [{ skip: false, uc: 1 }];
  let pendingSkip = 0;
  for (let i = 0; i < source.length; i++) {
    const top = stack[stack.length - 1]!;
    const ch = source[i]!;
    if (ch === '{') {
      flush();
      stack.push({ ...top });
      continue;
    }
    if (ch === '}') {
      flush();
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (ch === '\\') {
      const next = source[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        flush();
        if (!top.skip) out += next;
        i++;
        continue;
      }
      if (next === "'") {
        const hex = parseInt(source.slice(i + 2, i + 4), 16);
        i += 3;
        if (pendingSkip) {
          pendingSkip--;
          continue;
        }
        if (!top.skip && !Number.isNaN(hex)) bytes.push(hex);
        continue;
      }
      if (next === '*') {
        top.skip = true;
        i++;
        continue;
      }
      const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(source.slice(i + 1, i + 46));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      const word = m[1]!;
      const arg = m[2] === undefined ? undefined : Number(m[2]);
      flush();
      if (skipDestinations.test(word)) top.skip = true;
      else if (word === 'uc') top.uc = arg ?? 1;
      else if (top.skip) continue;
      else if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') out += '\n';
      else if (word === 'tab') out += '\t';
      else if (word === 'u' && arg !== undefined) {
        out += String.fromCharCode(arg < 0 ? arg + 65536 : arg);
        pendingSkip = top.uc;
      } else if (word === 'emdash') out += '—';
      else if (word === 'endash') out += '–';
      else if (word === 'bullet') out += '•';
      else if (word === 'lquote' || word === 'rquote') out += word === 'lquote' ? '‘' : '’';
      else if (word === 'ldblquote' || word === 'rdblquote') out += word === 'ldblquote' ? '“' : '”';
      continue;
    }
    if (ch === '\r' || ch === '\n') continue;
    if (pendingSkip) {
      pendingSkip--;
      continue;
    }
    flush();
    if (!top.skip) out += ch;
  }
  flush();
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- EPUB ----------

export interface EpubChapter {
  href: string;
  title: string;
}
export interface EpubBook {
  title: string;
  author: string;
  chapters: EpubChapter[];
  /** Chapter XHTML with images inlined as data: URLs (bounded). */
  chapter(href: string): Promise<string>;
}

const resolvePath = (base: string, href: string) => {
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '').concat(decodeURIComponent(href.split('#')[0]!)).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
};

export async function readEpub(blob: Blob): Promise<EpubBook> {
  const { items } = await readZip(blob, '');
  const byPath = new Map(items.map((i) => [i.path.replace(/^\//, ''), i]));
  const text = async (path: string) => {
    const item = byPath.get(path);
    if (!item || item.size > 16 * 1024 * 1024) throw new Error('电子书缺少必要的文件：' + path);
    return decodeText(new Uint8Array(await (await item.blob()).arrayBuffer()));
  };
  const container = await text('META-INF/container.xml');
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath) throw new Error('这不是有效的 EPUB 电子书。');
  const opf = await text(opfPath);
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const m of opf.matchAll(/<item\b([^>]*)\/?>/g)) {
    const attr = (n: string) => new RegExp(`${n}="([^"]*)"`).exec(m[1]!)?.[1] ?? '';
    manifest.set(attr('id'), { href: resolvePath(opfPath, attr('href')), type: attr('media-type'), props: attr('properties') });
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => manifest.get(m[1]!)).filter((x): x is NonNullable<typeof x> => !!x && /html/.test(x.type));
  // Table of contents: EPUB 3 nav document, else EPUB 2 NCX.
  const titles = new Map<string, string>();
  const nav = [...manifest.values()].find((m) => m.props.split(' ').includes('nav'));
  const ncx = [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
  try {
    if (nav) {
      const doc = await text(nav.href);
      for (const a of doc.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        const path = resolvePath(nav.href, a[1]!);
        if (!titles.has(path)) titles.set(path, xmlText(a[2]!.replace(/<[^>]+>/g, '')).trim());
      }
    } else if (ncx) {
      const doc = await text(ncx.href);
      for (const p of doc.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*src="([^"]+)"/g)) {
        const path = resolvePath(ncx.href, p[2]!);
        if (!titles.has(path)) titles.set(path, xmlText(p[1]!).trim());
      }
    }
  } catch {
    /* A broken table of contents still leaves the spine readable. */
  }
  const meta = (tag: string) => xmlText(new RegExp(`<dc:${tag}\\b[^>]*>([\\s\\S]*?)</dc:${tag}>`).exec(opf)?.[1] ?? '').trim();
  const types: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  return {
    title: meta('title'),
    author: meta('creator'),
    chapters: spine.map((s, i) => ({ href: s.href, title: titles.get(s.href) || `第 ${i + 1} 部分` })),
    async chapter(href) {
      let html = await text(href);
      let budget = 24 * 1024 * 1024;
      const sources = [...new Set([...html.matchAll(/(?:src|xlink:href)="([^"]+)"/g)].map((m) => m[1]!))];
      for (const src of sources) {
        if (/^(?:data:|https?:)/.test(src)) continue;
        const item = byPath.get(resolvePath(href, src));
        const type = types[extensionOf(src)];
        if (!item || !type || item.size > budget) continue;
        budget -= item.size;
        const bytes = new Uint8Array(await (await item.blob()).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        html = html.split(`"${src}"`).join(`"data:${type};base64,${btoa(binary)}"`);
      }
      return html;
    },
  };
}

// ---------- Thumbnails embedded in office packages ----------

/** The preview image Office/LibreOffice store inside the package, if any. */
export async function packageThumbnail(blob: Blob): Promise<Blob | null> {
  const { items } = await readZip(blob, '');
  const thumb = items.find((i) => /^\/?(docProps\/thumbnail\.(jpeg|jpg|png)|Thumbnails\/thumbnail\.png)$/i.test(i.path));
  if (!thumb || thumb.size > 4 * 1024 * 1024) return null;
  const data = await thumb.blob();
  return new Blob([data], { type: /png$/i.test(thumb.path) ? 'image/png' : 'image/jpeg' });
}
