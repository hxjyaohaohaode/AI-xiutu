import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CaretRight, FileArchive, Warning, Stack, Eye, EyeSlash, BookOpen, MusicNotes, FolderOpen } from '@phosphor-icons/react';
import { readPresentation } from '@ai-xiutu/contracts';
import { t } from '../i18n';
import type { Item } from './archives';
import {
  decodeText,
  docxFromBlob,
  odpFromBlob,
  odtFromBlob,
  pptxFromBlob,
  readEpub,
  rtfText,
  textDocument,
  cleanText,
  type DocumentDraft,
  type EpubBook,
} from './convert';
import { imageInfo } from './image-info';
import { LIMITS, baseName, formatBytes, mimeOf } from './kinds';
import { MarkdownView } from './MarkdownView';
import { htmlToMarkdown, sandboxedHtml } from './html-to-markdown';
import { Skeleton, shapeFor } from './Skeleton';
import { TextViewer, looksLikeText } from './TextViewer';
import { ZoomStage } from './ZoomStage';
import { SheetViewer, type SheetSelection } from './SheetViewer';
import { parseSheetsInWorker, rangeCsv, type SheetPreview } from './sheet-preview';

const RichDocumentEditor = lazy(() => import('../project-files/RichDocumentEditor').then((m) => ({ default: m.RichDocumentEditor })));
const PresentationEditor = lazy(() => import('../project-files/PresentationEditor').then((m) => ({ default: m.PresentationEditor })));

export type ImportTarget = 'document' | 'sheet' | 'presentation';
export interface ImportPlan {
  as: ImportTarget;
  build: () => Promise<DocumentDraft>;
}
export type Meta = Record<string, string>;
export interface ViewerProps {
  item: Item;
  source: boolean;
  onMeta: (meta: Meta) => void;
  onPlan: (plan: ImportPlan | null) => void;
  onSourceable: (yes: boolean) => void;
  onExpand: () => void;
  onSwipe?: (direction: 1 | -1) => void;
}

function useObjectUrl(blob: Blob | null, type?: string) {
  const url = useMemo(() => (blob ? URL.createObjectURL(type && blob.type !== type ? new Blob([blob], { type }) : blob) : null), [blob, type]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

type Loaded<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [value, setValue] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    setValue({ state: 'loading' });
    load().then(
      (v) => live && setValue({ state: 'ready', value: v }),
      (e) => live && setValue({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function Problem({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div className="fc-problem" role="alert">
      <span className="fc-problem-icon" aria-hidden>
        {icon ?? <Warning size={30} weight="duotone" />}
      </span>
      <p>{t(message)}</p>
    </div>
  );
}

// ---------- Images ----------

const exifLabels: [string, string, (v: string) => string][] = [
  ['taken', '拍摄时间', (v) => v.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')],
  ['fNumber', '光圈', (v) => 'f/' + v],
  ['exposure', '快门', (v) => v + ' s'],
  ['iso', 'ISO', (v) => v],
  ['focalLength', '焦距', (v) => v + ' mm'],
  ['lens', '镜头', (v) => v],
];

async function hasAlpha(blob: Blob) {
  const bitmap = await createImageBitmap(blob, { resizeWidth: 48, resizeHeight: 48 }).catch(() => null);
  if (!bitmap) return false;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, 48, 48).data;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 250) return true;
  return false;
}

function canvasBlobUrl(canvas: HTMLCanvasElement) {
  return new Promise<string>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('无法生成预览图。'))), 'image/png'),
  );
}

interface Picture {
  url: string;
  width: number;
  height: number;
  alpha: boolean;
  scaled?: { width: number; height: number };
  owned: boolean;
}

function ImageViewer({ item, blob, onMeta, onSwipe }: { item: Item; blob: Blob; onMeta: (m: Meta) => void; onSwipe?: (d: 1 | -1) => void }) {
  const loaded = useLoad<Picture>(async () => {
    const head = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
    const info = imageInfo(head);
    const meta: Meta = {};
    if (info) {
      meta['尺寸'] = `${info.width} × ${info.height}`;
      meta['像素'] = `${((info.width * info.height) / 1e6).toFixed(1)} MP`;
      meta['格式'] = info.format;
      if (info.exif) {
        const camera = [info.exif.make, info.exif.model].filter(Boolean).join(' ');
        if (camera) meta['相机'] = camera;
        for (const [key, label, show] of exifLabels) if (info.exif[key]) meta[label] = show(info.exif[key]!);
      }
    }
    onMeta(meta);
    const mime = item.kind === 'svg' ? 'image/svg+xml' : mimeOf(item.name);
    if (info && info.width * info.height > LIMITS.imagePixels && item.kind !== 'svg') {
      // Decode once at screen size; a full-size bitmap would exceed browser canvas limits.
      const side = 4096;
      const scale = Math.min(1, side / Math.max(info.width, info.height));
      const bitmap = await createImageBitmap(blob, { resizeWidth: Math.round(info.width * scale), resizeQuality: 'high' });
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      const url = await canvasBlobUrl(canvas);
      return { url, width: canvas.width, height: canvas.height, alpha: false, scaled: { width: info.width, height: info.height }, owned: true };
    }
    const url = URL.createObjectURL(blob.type === mime ? blob : new Blob([blob], { type: mime }));
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error(
        item.kind === 'heic'
          ? '当前浏览器无法解码 HEIC 照片（Safari 可以）。可下载原件，或在手机相册中导出为 JPEG 后打开。'
          : '图片无法解码，文件可能已损坏或使用了浏览器不支持的编码。',
      );
    }
    const width = img.naturalWidth || info?.width || 1;
    const height = img.naturalHeight || info?.height || 1;
    if (!info) onMeta({ 尺寸: `${width} × ${height}` });
    const alpha = /png|webp|gif|avif|icon|svg/.test(mime) ? await hasAlpha(blob).catch(() => false) : false;
    return { url, width, height, alpha, owned: true };
  }, [blob]);
  useEffect(() => () => void (loaded.state === 'ready' && URL.revokeObjectURL(loaded.value.url)), [loaded]);
  if (loaded.state === 'loading') return <Skeleton shape="image" />;
  if (loaded.state === 'error') return <Problem message={loaded.message} />;
  const pic = loaded.value;
  return (
    <div className="fc-image">
      {(pic.alpha || pic.scaled) && (
        <div className="fc-image-chips">
          {pic.alpha && <span className="fc-chip">{t('含透明区域')}</span>}
          {pic.scaled && (
            <span className="fc-chip fc-chip-warn">
              {t('原图 {v0} × {v1}，已按屏幕尺寸解码显示', { v0: pic.scaled.width, v1: pic.scaled.height })}
            </span>
          )}
        </div>
      )}
      <ZoomStage natural={{ width: pic.width, height: pic.height }} checker={pic.alpha} onSwipe={onSwipe}>
        <img src={pic.url} alt={item.name} draggable={false} />
      </ZoomStage>
    </div>
  );
}

// ---------- Photoshop ----------

interface PsdLayer {
  name: string;
  hidden: boolean;
  opacity: number;
  blend: string;
  depth: number;
  group: boolean;
}
const colorModes: Record<number, string> = { 0: '位图', 1: '灰度', 2: '索引颜色', 3: 'RGB', 4: 'CMYK', 7: '多通道', 8: '双色调', 9: 'Lab' };

function PsdViewer({ item, blob, onMeta, onSwipe }: { item: Item; blob: Blob; onMeta: (m: Meta) => void; onSwipe?: (d: 1 | -1) => void }) {
  const [showLayers, setShowLayers] = useState(true);
  const loaded = useLoad(async () => {
    if (blob.size > LIMITS.psdBytes) throw new Error('Photoshop 文件超过 1 GB，浏览器无法完整载入。');
    const { readPsd } = await import('ag-psd');
    const psd = readPsd(await blob.arrayBuffer(), { skipLayerImageData: true, skipThumbnail: true });
    const layers: PsdLayer[] = [];
    const walk = (children: typeof psd.children, depth: number) => {
      for (const layer of [...(children ?? [])].reverse()) {
        layers.push({ name: layer.name || t('未命名图层'), hidden: !!layer.hidden, opacity: Math.round((layer.opacity ?? 1) * 100), blend: layer.blendMode ?? 'normal', depth, group: !!layer.children });
        if (layer.children) walk(layer.children, depth + 1);
      }
    };
    walk(psd.children, 0);
    onMeta({
      尺寸: `${psd.width} × ${psd.height}`,
      颜色模式: colorModes[psd.colorMode ?? 3] ?? String(psd.colorMode),
      位深: `${psd.bitsPerChannel ?? 8} bit`,
      图层: String(layers.length),
    });
    if (!psd.canvas) throw new Error('该文件没有保存合成图像。请在 Photoshop 的“文件处理”设置中开启“最大兼容 PSD 和 PSB 文件”后重新保存。');
    return { url: await canvasBlobUrl(psd.canvas as HTMLCanvasElement), width: psd.width, height: psd.height, layers };
  }, [blob]);
  useEffect(() => () => void (loaded.state === 'ready' && URL.revokeObjectURL(loaded.value.url)), [loaded]);
  if (loaded.state === 'loading') return <Skeleton shape="image" label="正在解析图层" />;
  if (loaded.state === 'error') return <Problem message={loaded.message} />;
  const v = loaded.value;
  return (
    <div className={'fc-split' + (showLayers ? ' with-side' : '')}>
      <div className="fc-image">
        <ZoomStage natural={{ width: v.width, height: v.height }} checker onSwipe={onSwipe}>
          <img src={v.url} alt={item.name} draggable={false} />
        </ZoomStage>
      </div>
      <aside className="fc-layers" aria-label={t('图层')}>
        <button type="button" className="fc-layers-toggle" aria-expanded={showLayers} onClick={() => setShowLayers(!showLayers)}>
          <Stack size={16} weight="duotone" />
          {t('图层')} <small>{v.layers.length}</small>
        </button>
        {showLayers && (
          <ol>
            {v.layers.map((layer, i) => (
              <li key={i} style={{ paddingInlineStart: 10 + layer.depth * 14 }} className={layer.hidden ? 'is-hidden' : ''}>
                {layer.hidden ? <EyeSlash size={14} aria-label={t('隐藏')} /> : <Eye size={14} aria-label={t('可见')} />}
                {layer.group && <FolderOpen size={14} weight="duotone" aria-hidden />}
                <span>{layer.name}</span>
                {layer.opacity < 100 && <small>{layer.opacity}%</small>}
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}

// ---------- TIFF ----------

function TiffViewer({ item, blob, onMeta, onSwipe }: { item: Item; blob: Blob; onMeta: (m: Meta) => void; onSwipe?: (d: 1 | -1) => void }) {
  const loaded = useLoad(async () => {
    if (blob.size > LIMITS.tiffBytes) throw new Error('TIFF 文件超过 400 MB，浏览器无法完整解码。');
    const mod = await import('utif2');
    const UTIF = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const buffer = await blob.arrayBuffer();
    const pages = UTIF.decode(buffer);
    const page = pages[0];
    if (!page) throw new Error('没有在文件中找到图像。');
    UTIF.decodeImage(buffer, page);
    const width = page.width as number,
      height = page.height as number;
    if (!width || !height || width * height > 120_000_000) throw new Error('TIFF 图像过大或不受支持。');
    const rgba = UTIF.toRGBA8(page);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels.set(rgba.subarray(0, pixels.length));
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
    onMeta({ 尺寸: `${width} × ${height}`, 页数: String(pages.length) });
    return { url: await canvasBlobUrl(canvas), width, height };
  }, [blob]);
  useEffect(() => () => void (loaded.state === 'ready' && URL.revokeObjectURL(loaded.value.url)), [loaded]);
  if (loaded.state === 'loading') return <Skeleton shape="image" />;
  if (loaded.state === 'error') return <Problem message={loaded.message} />;
  return (
    <div className="fc-image">
      <ZoomStage natural={loaded.value} onSwipe={onSwipe}>
        <img src={loaded.value.url} alt={item.name} draggable={false} />
      </ZoomStage>
    </div>
  );
}

// ---------- Documents ----------

function DocumentViewer({ item, blob, onMeta, onPlan }: { item: Item; blob: Blob; onMeta: (m: Meta) => void; onPlan: (p: ImportPlan | null) => void }) {
  const loaded = useLoad<DocumentDraft>(async () => {
    if (item.kind === 'docx') return docxFromBlob(item.name, blob);
    if (item.kind === 'odt') return odtFromBlob(item.name, blob);
    const text = rtfText(decodeText(new Uint8Array(await blob.slice(0, 64 * 1024 * 1024).arrayBuffer())));
    return { title: baseName(item.name), body: cleanText(text), notes: text.length > LIMITS.textChars ? ['内容超过 100000 字符，已截断。'] : [] };
  }, [blob]);
  useEffect(() => {
    if (loaded.state !== 'ready') return onPlan(null);
    const draft = loaded.value;
    const words = draft.body.replace(/\s+/g, '').length;
    onMeta({ 字数: words.toLocaleString(), 段落: String(draft.body.split('\n').filter((l) => l.trim()).length) });
    onPlan({ as: 'document', build: async () => draft });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  if (loaded.state === 'loading') return <Skeleton shape="page" />;
  if (loaded.state === 'error') return <Problem message={loaded.message} />;
  return (
    <div className="fc-scroll">
      {loaded.value.notes.length > 0 && <p className="fc-note">{loaded.value.notes.map((n) => t(n)).join(' ')}</p>}
      <div className="fc-paper fc-rich">
        <Suspense fallback={<Skeleton shape="page" />}>
          <RichDocumentEditor body={loaded.value.body} formatting={loaded.value.formatting} readOnly onChange={() => false} />
        </Suspense>
      </div>
    </div>
  );
}

function DeckViewer({ item, blob, onMeta, onPlan }: { item: Item; blob: Blob; onMeta: (m: Meta) => void; onPlan: (p: ImportPlan | null) => void }) {
  const loaded = useLoad(() => (item.kind === 'odp' ? odpFromBlob(item.name, blob) : pptxFromBlob(item.name, blob)), [blob]);
  const deck = loaded.state === 'ready' ? readPresentation(loaded.value.body) : null;
  useEffect(() => {
    if (loaded.state !== 'ready') return onPlan(null);
    onMeta({ 幻灯片: String(deck?.slides.length ?? 0) });
    onPlan({ as: 'presentation', build: async () => loaded.value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  if (loaded.state === 'loading') return <Skeleton shape="deck" />;
  if (loaded.state === 'error') return <Problem message={loaded.message} />;
  return (
    <div className="fc-scroll fc-deck">
      <p className="fc-note">{loaded.value.notes.map((n) => t(n)).join(' ')}</p>
      <Suspense fallback={<Skeleton shape="deck" />}>
        {deck && <PresentationEditor document={deck} projectId="" sources={[]} readOnly onChange={() => false} />}
      </Suspense>
    </div>
  );
}

/**
 * Largest top-left block that fits the project worksheet limits: 40 000 cells,
 * 256 columns and the document store's 100 000 characters (with headroom for quoting).
 */
function defaultRange(sheet: SheetPreview) {
  const c1 = Math.min(sheet.columns, 256) - 1;
  let r1 = 0;
  let chars = 0;
  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]!;
    let length = c1 + 1;
    for (let c = 0; c <= c1; c++) length += (row[c]?.length ?? 0) + 2;
    if ((r + 1) * (c1 + 1) > 40_000 || chars + length > 90_000) break;
    chars += length;
    r1 = r;
  }
  return { r0: 0, c0: 0, r1, c1 };
}

function SheetPanel({ item, blob, onMeta, onPlan }: { item: Item; blob: Blob; onMeta: (m: Meta) => void; onPlan: (p: ImportPlan | null) => void }) {
  const loaded = useLoad(() => parseSheetsInWorker(item.name, blob), [blob]);
  const [selection, setSelection] = useState<SheetSelection | null>(null);
  useEffect(() => {
    if (loaded.state !== 'ready') return onPlan(null);
    const sheets = loaded.value;
    const first = sheets[0];
    onMeta({ 工作表: String(sheets.length), ...(first ? { 行列: `${(first.totalRows ?? first.rows.length).toLocaleString()} × ${first.columns}` } : {}) });
    onPlan({
      as: 'sheet',
      build: async () => {
        const sheet = sheets[selection?.sheet ?? 0];
        if (!sheet || !sheet.rows.length) throw new Error('表格中没有可读取的数据。');
        const single = !selection || (selection.r0 === selection.r1 && selection.c0 === selection.c1);
        const range = single ? defaultRange(sheet) : selection!;
        if (range.c1 === range.c0) throw new Error('请至少选择两列（含表头）再保存为工作表。');
        const cells = (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
        if (cells > 40_000 || range.c1 - range.c0 + 1 > 256) throw new Error('所选区域超过 40000 个单元格或 256 列，请缩小选择范围。');
        const { importSpreadsheet, selectSpreadsheetRange } = await import('../project-files/spreadsheet');
        // A selection below the first row keeps the header row, as Excel's "format as table" does.
        const header = range.r0 > 0 ? rangeCsv(sheet.rows, 0, range.c0, 0, range.c1) + '\n' : '';
        const csv = header + rangeCsv(sheet.rows, range.r0, range.c0, range.r1, range.c1);
        const book = importSpreadsheet(`${baseName(item.name)}.csv`, new TextEncoder().encode(csv));
        const imported = book.sheets[0]!;
        const picked = selectSpreadsheetRange(book, imported, imported.bounds);
        const notes = single && (sheet.rows.length - 1 > range.r1 || sheet.columns - 1 > range.c1) ? ['表格较大，已保存左上角符合工作表限额的区域；也可以先框选需要的区域。'] : [];
        return { title: `${baseName(item.name)}${sheets.length > 1 ? ' · ' + sheet.name : ''}`, body: picked.body, notes };
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selection]);
  if (loaded.state === 'loading') return <Skeleton shape="grid" label="正在解析表格" />;
  if (loaded.state === 'error') return <Problem message={loaded.message} />;
  if (!loaded.value.length) return <Problem message="表格中没有可读取的数据。" />;
  return <SheetViewer sheets={loaded.value} onSelection={setSelection} />;
}

function EpubViewer({ blob, onMeta, onPlan }: { blob: Blob; onMeta: (m: Meta) => void; onPlan: (p: ImportPlan | null) => void }) {
  const book = useLoad<EpubBook>(() => readEpub(blob), [blob]);
  const [index, setIndex] = useState(0);
  const chapter = useLoad<string>(async () => (book.state === 'ready' && book.value.chapters[index] ? book.value.chapter(book.value.chapters[index]!.href) : ''), [book, index]);
  useEffect(() => {
    if (book.state !== 'ready') return onPlan(null);
    const b = book.value;
    onMeta({ ...(b.title ? { 书名: b.title } : {}), ...(b.author ? { 作者: b.author } : {}), 章节: String(b.chapters.length) });
    onPlan({
      as: 'document',
      build: async () => {
        let body = '';
        for (const c of b.chapters) {
          if (body.length >= LIMITS.textChars) break;
          const md = htmlToMarkdown(await b.chapter(c.href)).body;
          body += (body ? '\n\n' : '') + `# ${c.title}\n${md}`;
        }
        const notes = body.length > LIMITS.textChars ? ['电子书超过 100000 字符，已导入前面的章节。'] : [];
        return { title: b.title || '电子书', body: cleanText(body), notes };
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);
  if (book.state === 'loading') return <Skeleton shape="page" label="正在打开电子书" />;
  if (book.state === 'error') return <Problem message={book.message} />;
  const b = book.value;
  return (
    <div className="fc-split with-side fc-epub">
      <div className="fc-epub-page">
        {chapter.state === 'ready' ? (
          <iframe className="fc-frame" title={b.chapters[index]?.title ?? ''} sandbox="" referrerPolicy="no-referrer" srcDoc={sandboxedHtml(chapter.value)} />
        ) : chapter.state === 'error' ? (
          <Problem message={chapter.message} />
        ) : (
          <Skeleton shape="page" />
        )}
        <div className="fc-epub-nav">
          <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            {t('上一章')}
          </button>
          <span>
            {index + 1} / {b.chapters.length}
          </span>
          <button type="button" disabled={index >= b.chapters.length - 1} onClick={() => setIndex(index + 1)}>
            {t('下一章')}
          </button>
        </div>
      </div>
      <nav className="fc-layers fc-toc" aria-label={t('目录')}>
        <div className="fc-layers-toggle">
          <BookOpen size={16} weight="duotone" />
          {t('目录')}
        </div>
        <ol>
          {b.chapters.map((c, i) => (
            <li key={c.href + i}>
              <button type="button" aria-current={i === index ? 'true' : undefined} onClick={() => setIndex(i)}>
                {c.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}

// ---------- JSON ----------

function JsonNode({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const label = name !== undefined && <span className="tk-key">{name}: </span>;
  if (value === null || typeof value !== 'object')
    return (
      <div className="fc-json-leaf" style={{ paddingInlineStart: depth * 16 + 18 }}>
        {label}
        <span className={typeof value === 'string' ? 'tk-s' : typeof value === 'number' ? 'tk-n' : 'tk-k'}>
          {typeof value === 'string' ? JSON.stringify(value.length > 400 ? value.slice(0, 400) + '…' : value) : String(value)}
        </span>
      </div>
    );
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  const shown = entries.slice(0, 500);
  return (
    <div>
      <button type="button" className="fc-json-branch" style={{ paddingInlineStart: depth * 16 }} aria-expanded={open} onClick={() => setOpen(!open)}>
        <CaretRight size={12} className={open ? 'fc-open' : ''} aria-hidden />
        {label}
        <span className="fc-json-count">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open && shown.map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} />)}
      {open && entries.length > shown.length && (
        <div className="fc-json-leaf fc-muted" style={{ paddingInlineStart: (depth + 1) * 16 + 18 }}>
          {t('还有 {v0} 项未显示', { v0: entries.length - shown.length })}
        </div>
      )}
    </div>
  );
}

function JsonViewer({ item, blob, source, onMeta }: { item: Item; blob: Blob; source: boolean; onMeta: (m: Meta) => void }) {
  const parsed = useLoad<unknown>(async () => {
    if (blob.size > LIMITS.jsonTreeBytes) throw new Error('large');
    const text = decodeText(new Uint8Array(await blob.arrayBuffer()));
    if (/\.jsonl$/i.test(item.name)) return text.split('\n').filter((l) => l.trim()).slice(0, 5000).map((l) => JSON.parse(l));
    return JSON.parse(text);
  }, [blob]);
  if (source || parsed.state === 'error') return (
    <>
      {parsed.state === 'error' && parsed.message !== 'large' && <p className="fc-note fc-note-warn">{t('JSON 解析失败，显示原文。')}</p>}
      <TextViewer blob={blob} code onMeta={onMeta} />
    </>
  );
  if (parsed.state === 'loading') return <Skeleton shape="code" />;
  return (
    <div className="fc-scroll">
      <div className="fc-json">
        <JsonNode value={parsed.value} depth={0} />
      </div>
    </div>
  );
}

// ---------- Fonts ----------

let fontSequence = 0;
function FontViewer({ item, blob, onMeta }: { item: Item; blob: Blob; onMeta: (m: Meta) => void }) {
  const [family] = useState(() => `fc-font-${++fontSequence}`);
  const loaded = useLoad(async () => {
    if (blob.size > LIMITS.fontBytes) throw new Error('字体文件超过 64 MB。');
    const face = new FontFace(family, await blob.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    onMeta({ 字形: item.name.split('.').pop()!.toUpperCase() });
    return face;
  }, [blob]);
  useEffect(() => () => void (loaded.state === 'ready' && document.fonts.delete(loaded.value)), [loaded]);
  if (loaded.state === 'loading') return <Skeleton shape="image" />;
  if (loaded.state === 'error') return <Problem message={loaded.state === 'error' && /字体/.test(loaded.message) ? loaded.message : '字体无法载入，文件可能已损坏。'} />;
  return (
    <div className="fc-scroll">
      <div className="fc-font" style={{ fontFamily: `"${family}"` }}>
        <p className="fc-font-hero">Aa 永 字</p>
        {[64, 40, 28, 20, 14].map((size) => (
          <p key={size} style={{ fontSize: size }}>
            <small>{size}</small>
            {size >= 40 ? '天地玄黄 宇宙洪荒' : '天地玄黄，宇宙洪荒。The quick brown fox jumps over the lazy dog. 0123456789'}
          </p>
        ))}
        <p className="fc-font-glyphs">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !@#$%&amp;*()[]{'{}'}，。、；：？！“”《》</p>
      </div>
    </div>
  );
}

// ---------- Media ----------

function MediaViewer({ item, blob, onMeta }: { item: Item; blob: Blob; onMeta: (m: Meta) => void }) {
  const url = useObjectUrl(blob, mimeOf(item.name));
  const [failed, setFailed] = useState(false);
  if (!url) return <Skeleton shape="media" />;
  const report = (el: HTMLMediaElement) => {
    const minutes = Math.floor(el.duration / 60),
      seconds = Math.round(el.duration % 60);
    const meta: Meta = Number.isFinite(el.duration) ? { 时长: `${minutes}:${String(seconds).padStart(2, '0')}` } : {};
    if (el instanceof HTMLVideoElement && el.videoWidth) meta['分辨率'] = `${el.videoWidth} × ${el.videoHeight}`;
    onMeta(meta);
  };
  if (failed) return <Problem message="浏览器无法播放这个文件的编码，可以下载后用本机播放器打开。" />;
  return item.kind === 'video' ? (
    <div className="fc-media">
      <video controls playsInline preload="metadata" src={url} onLoadedMetadata={(e) => report(e.currentTarget)} onError={() => setFailed(true)} />
    </div>
  ) : (
    <div className="fc-media">
      <div className="fc-audio">
        <span className="fc-audio-art" aria-hidden>
          <MusicNotes size={44} weight="duotone" />
        </span>
        <strong>{baseName(item.name)}</strong>
        <audio controls preload="metadata" src={url} onLoadedMetadata={(e) => report(e.currentTarget)} onError={() => setFailed(true)} />
      </div>
    </div>
  );
}

// ---------- Dispatcher ----------

function hexDump(bytes: Uint8Array) {
  const lines: string[] = [];
  for (let o = 0; o < bytes.length; o += 16) {
    const row = bytes.subarray(o, o + 16);
    lines.push(
      o.toString(16).padStart(6, '0') + '  ' +
        [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(48) + '  ' +
        [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join(''),
    );
  }
  return lines.join('\n');
}

function Unknown({ item, blob, onMeta, onPlan }: { item: Item; blob: Blob; onMeta: (m: Meta) => void; onPlan: (p: ImportPlan | null) => void }) {
  const head = useLoad(async () => new Uint8Array(await blob.slice(0, 4096).arrayBuffer()), [blob]);
  if (head.state !== 'ready') return <Skeleton shape="code" />;
  if (looksLikeText(head.value)) return <TextLike item={item} blob={blob} code={false} onMeta={onMeta} onPlan={onPlan} />;
  return (
    <div className="fc-scroll">
      <Problem message={item.kind === 'legacy' ? '这是旧版二进制 Office 格式（.doc / .ppt / WPS）。请在 Office 或 WPS 中另存为 .docx / .pptx / .xlsx 后打开，也可以下载原件。' : '此类型无法直接预览，下面是文件开头的字节，可以下载原件。'} />
      <pre className="fc-hex" aria-label={t('文件开头的字节')}>{hexDump(head.value.subarray(0, 512))}</pre>
    </div>
  );
}

function TextLike({ item, blob, code, onMeta, onPlan }: { item: Item; blob: Blob; code: boolean; onMeta: (m: Meta) => void; onPlan: (p: ImportPlan | null) => void }) {
  useEffect(() => {
    onPlan({
      as: 'document',
      build: async () => {
        const draft = textDocument(item.name, new Uint8Array(await blob.slice(0, LIMITS.textChars * 4).arrayBuffer()));
        return blob.size > LIMITS.textChars ? { ...draft, notes: ['文件较大，已导入开头的 100000 个字符。'] } : draft;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);
  return <TextViewer blob={blob} code={code} onMeta={onMeta} />;
}

function MarkupViewer({ item, blob, source, onMeta, onPlan }: { item: Item; blob: Blob; source: boolean; onMeta: (m: Meta) => void; onPlan: (p: ImportPlan | null) => void }) {
  const tooBig = blob.size > 8 * 1024 * 1024;
  const text = useLoad(async () => (tooBig ? '' : decodeText(new Uint8Array(await blob.arrayBuffer()))), [blob]);
  useEffect(() => {
    if (text.state !== 'ready') return;
    if (item.kind === 'html') {
      onPlan({
        as: 'document',
        build: async () => {
          const converted = htmlToMarkdown(text.value || decodeText(new Uint8Array(await blob.slice(0, 8 * 1024 * 1024).arrayBuffer())));
          return { title: converted.title || baseName(item.name), body: converted.body, notes: ['网页中的脚本、样式、表单和媒体不会导入。'] };
        },
      });
    } else
      onPlan({
        as: 'document',
        build: async () => textDocument(item.name, new Uint8Array(await blob.slice(0, LIMITS.textChars * 4).arrayBuffer())),
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  if (source || tooBig) return <TextViewer blob={blob} code onMeta={onMeta} />;
  if (text.state === 'loading') return <Skeleton shape="page" />;
  if (text.state === 'error') return <Problem message={text.message} />;
  return item.kind === 'html' ? (
    <iframe className="fc-frame fc-frame-page" title={item.name} sandbox="" referrerPolicy="no-referrer" srcDoc={sandboxedHtml(text.value)} />
  ) : (
    <div className="fc-scroll">
      <div className="fc-paper">
        <MarkdownView text={text.value} />
      </div>
    </div>
  );
}

function ArchiveSummary({ item, onExpand }: { item: Item; onExpand: () => void }) {
  if (item.kind === 'sevenzip')
    return <Problem icon={<FileArchive size={30} weight="duotone" />} message="浏览器暂不支持解压 7z。请先在本机解压，再用“打开文件夹”浏览。" />;
  return (
    <div className="fc-problem">
      <span className="fc-problem-icon" aria-hidden>
        <FileArchive size={30} weight="duotone" />
      </span>
      <p>{t('这是压缩包，展开后可以逐个预览其中的文件。')}</p>
      <button type="button" className="fc-primary" onClick={onExpand}>
        <FolderOpen size={16} />
        {t('展开压缩包')}
      </button>
    </div>
  );
}

export function Viewer(props: ViewerProps) {
  const { item, source, onMeta, onPlan, onSourceable, onExpand, onSwipe } = props;
  const blob = useLoad(() => item.blob(), [item]);
  useEffect(() => {
    onSourceable(item.kind === 'markdown' || item.kind === 'html' || item.kind === 'json');
    onPlan(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  if (item.unavailable) return <Problem message={item.unavailable} />;
  if (blob.state === 'loading')
    return <Skeleton shape={shapeFor(item.kind)} label={item.size > 64 * 1024 * 1024 ? t('正在解压 {v0}', { v0: formatBytes(item.size) }) : '读取中'} />;
  if (blob.state === 'error') return <Problem message={blob.message} />;
  const b = blob.value;
  switch (item.kind) {
    case 'image':
    case 'svg':
    case 'heic':
      return <ImageViewer item={item} blob={b} onMeta={onMeta} onSwipe={onSwipe} />;
    case 'psd':
      return <PsdViewer item={item} blob={b} onMeta={onMeta} onSwipe={onSwipe} />;
    case 'tiff':
      return <TiffViewer item={item} blob={b} onMeta={onMeta} onSwipe={onSwipe} />;
    case 'docx':
    case 'odt':
    case 'rtf':
      return <DocumentViewer item={item} blob={b} onMeta={onMeta} onPlan={onPlan} />;
    case 'pptx':
    case 'odp':
      return <DeckViewer item={item} blob={b} onMeta={onMeta} onPlan={onPlan} />;
    case 'sheet':
      return <SheetPanel item={item} blob={b} onMeta={onMeta} onPlan={onPlan} />;
    case 'epub':
      return <EpubViewer blob={b} onMeta={onMeta} onPlan={onPlan} />;
    case 'markdown':
    case 'html':
      return <MarkupViewer item={item} blob={b} source={source} onMeta={onMeta} onPlan={onPlan} />;
    case 'json':
      return <JsonViewer item={item} blob={b} source={source} onMeta={onMeta} />;
    case 'text':
    case 'code':
      return <TextLike item={item} blob={b} code={item.kind === 'code'} onMeta={onMeta} onPlan={onPlan} />;
    case 'pdf':
      return <PdfFrame item={item} blob={b} />;
    case 'audio':
    case 'video':
      return <MediaViewer item={item} blob={b} onMeta={onMeta} />;
    case 'font':
      return <FontViewer item={item} blob={b} onMeta={onMeta} />;
    case 'zip':
    case 'tar':
    case 'gzip':
    case 'rar':
    case 'sevenzip':
      return <ArchiveSummary item={item} onExpand={onExpand} />;
    default:
      return <Unknown item={item} blob={b} onMeta={onMeta} onPlan={onPlan} />;
  }
}

function PdfFrame({ item, blob }: { item: Item; blob: Blob }) {
  const url = useObjectUrl(blob, 'application/pdf');
  return url ? <iframe className="fc-frame fc-frame-page" title={item.name} src={url} /> : <Skeleton shape="page" />;
}
