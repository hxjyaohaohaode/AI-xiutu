import { strFromU8, unzipSync } from 'fflate';
import {
  documentFormatSchema,
  writePresentation,
  type DocumentFormat,
  type PresentationDoc,
} from '@ai-xiutu/contracts';

/**
 * Pure file conversion for the file center. Everything runs in the browser on
 * bytes the user chose; nothing is uploaded until they save the result as a
 * project document. Archive reading is bounded so a crafted zip cannot exhaust
 * memory (entry count, per-file and total uncompressed size, compression ratio).
 */

export type FileKind =
  | 'image'
  | 'svg'
  | 'markdown'
  | 'text'
  | 'code'
  | 'html'
  | 'docx'
  | 'sheet'
  | 'pptx'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'zip'
  | 'unknown';

const extensionKinds: Record<string, FileKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', ico: 'image',
  svg: 'svg',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  txt: 'text', log: 'text', text: 'text', rtf: 'text',
  json: 'code', js: 'code', mjs: 'code', ts: 'code', tsx: 'code', jsx: 'code', css: 'code', scss: 'code',
  py: 'code', java: 'code', c: 'code', h: 'code', cpp: 'code', hpp: 'code', go: 'code', rs: 'code',
  rb: 'code', php: 'code', sh: 'code', sql: 'code', xml: 'code', yaml: 'code', yml: 'code', toml: 'code', ini: 'code',
  html: 'html', htm: 'html',
  docx: 'docx',
  xlsx: 'sheet', xls: 'sheet', xlsm: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet',
  pptx: 'pptx',
  pdf: 'pdf',
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  zip: 'zip',
};
export const codeLanguages: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', py: 'python', rb: 'ruby',
  sh: 'bash', yml: 'yaml', md: 'markdown',
};

export const extensionOf = (name: string) => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? '';
export const fileKind = (name: string): FileKind => extensionKinds[extensionOf(name)] ?? 'unknown';
export const baseName = (name: string) => (name.split('/').pop() ?? name).replace(/\.[^.]+$/, '').slice(0, 120) || '未命名';

export const LIMITS = {
  previewBytes: 64 * 1024 * 1024,
  zipEntries: 2000,
  zipEntryBytes: 64 * 1024 * 1024,
  zipTotalBytes: 256 * 1024 * 1024,
  zipRatio: 200,
  textChars: 100_000,
};

export interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

/** Lists and extracts a zip within the limits; directories are implied by paths. */
export function readZip(bytes: Uint8Array): { entries: ArchiveEntry[]; skipped: number } {
  let total = 0,
    count = 0,
    skipped = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      const unsafe = file.name.includes('..') || file.name.startsWith('/') || file.name.endsWith('/');
      if (unsafe) return false;
      if (++count > LIMITS.zipEntries) throw new Error(`压缩包超过 ${LIMITS.zipEntries} 个文件，无法预览。`);
      const ratio = file.size ? file.originalSize / file.size : 1;
      if (file.originalSize > LIMITS.zipEntryBytes || ratio > LIMITS.zipRatio) {
        skipped++;
        return false;
      }
      total += file.originalSize;
      if (total > LIMITS.zipTotalBytes) throw new Error('压缩包解压后过大，无法预览。');
      return true;
    },
  });
  const entries = Object.entries(files)
    .filter(([path]) => !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(path))
    .map(([path, data]) => ({ path, bytes: data }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { entries, skipped };
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
  if (kind === 'code') {
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
export function docxDocument(name: string, bytes: Uint8Array): DocumentDraft {
  const files = unzipSync(bytes, { filter: (f) => /^word\/(document|styles|numbering)\.xml$|^word\/media\//.test(f.name) && f.originalSize < 32 * 1024 * 1024 });
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
  const images = Object.keys(files).filter((f) => f.startsWith('word/media/')).length;
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

export function pptxSlides(bytes: Uint8Array): { title: string; lines: string[] }[] {
  const files = unzipSync(bytes, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) && f.originalSize < 8 * 1024 * 1024 });
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
  const slides = pptxSlides(bytes).slice(0, 50);
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
  const notes = ['已导入每页标题与文字；图片、图表和动画需在编辑器中重新添加。'];
  return { title: baseName(name), body, notes };
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
