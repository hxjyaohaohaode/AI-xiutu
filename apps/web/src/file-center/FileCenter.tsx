import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  X,
  UploadSimple,
  FolderOpen,
  FolderSimple,
  CaretRight,
  FileText,
  FileDoc,
  FileXls,
  FilePpt,
  FilePdf,
  FileImage,
  FileHtml,
  FileCode,
  FileZip,
  FileAudio,
  FileVideo,
  File as FileIcon,
  DownloadSimple,
  ArrowSquareIn,
  Code,
  Eye,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
} from '@phosphor-icons/react';
import { readPresentation } from '@ai-xiutu/contracts';
import { readProjectSheet } from '@ai-xiutu/contracts/office-data';
import { t } from '../i18n';
import {
  buildTree,
  decodeText,
  docxDocument,
  fileKind,
  formatBytes,
  pptxPresentation,
  readZip,
  textDocument,
  baseName,
  LIMITS,
  type DocumentDraft,
  type FileKind,
  type TreeNode,
} from './convert';
import { MarkdownView } from './MarkdownView';
import { htmlToMarkdown, sandboxedHtml } from './html-to-markdown';
import './file-center.css';

const RichDocumentEditor = lazy(() => import('../project-files/RichDocumentEditor').then((m) => ({ default: m.RichDocumentEditor })));
const PresentationEditor = lazy(() => import('../project-files/PresentationEditor').then((m) => ({ default: m.PresentationEditor })));
const ProjectSheetEditor = lazy(() => import('../project-files/ProjectSheetEditor').then((m) => ({ default: m.ProjectSheetEditor })));

/** One previewable item: a picked file, a file inside a picked folder, or a zip entry. */
interface Item {
  path: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

const kindIcons: Record<FileKind, typeof FileText> = {
  image: FileImage, svg: FileImage, markdown: FileText, text: FileText, code: FileCode, html: FileHtml,
  docx: FileDoc, sheet: FileXls, pptx: FilePpt, pdf: FilePdf, audio: FileAudio, video: FileVideo, zip: FileZip, unknown: FileIcon,
};
const kindLabels: Record<FileKind, string> = {
  image: '图片', svg: 'SVG 矢量图', markdown: 'Markdown', text: '纯文本', code: '代码', html: '网页', docx: 'Word 文档',
  sheet: '表格', pptx: '演示文稿', pdf: 'PDF', audio: '音频', video: '视频', zip: '压缩包', unknown: '其他文件',
};
const mimes: Partial<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', mp4: 'video/mp4', webm: 'video/webm',
  mov: 'video/quicktime', m4v: 'video/mp4',
};
const mimeOf = (name: string) => mimes[/\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''] ?? 'application/octet-stream';

function useObjectUrl(bytes: Uint8Array | null, name: string) {
  const url = useMemo(() => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(name) })) : null), [bytes, name]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

function ImagePreview({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const url = useObjectUrl(bytes, name);
  const [info, setInfo] = useState<{ w: number; h: number; alpha: boolean } | null>(null);
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit');
  return (
    <div className="fc-image">
      <div className="fc-image-tools">
        {info && (
          <span>
            {info.w} × {info.h}
            {info.alpha && <em>{t('含透明区域')}</em>}
          </span>
        )}
        <button type="button" onClick={() => setZoom(zoom === 'fit' ? 'actual' : 'fit')} aria-label={t(zoom === 'fit' ? '实际大小' : '适应窗口')}>
          {zoom === 'fit' ? <MagnifyingGlassPlus size={16} /> : <MagnifyingGlassMinus size={16} />}
          {t(zoom === 'fit' ? '实际大小' : '适应窗口')}
        </button>
      </div>
      <div className={'fc-checker fc-zoom-' + zoom}>
        {url && (
          <img
            src={url}
            alt={name}
            onLoad={(e) => {
              const img = e.currentTarget;
              let alpha = false;
              try {
                // Sample a downscaled copy for any transparent pixel (shown over the checkerboard).
                const canvas = document.createElement('canvas');
                canvas.width = Math.min(128, img.naturalWidth || 1);
                canvas.height = Math.min(128, img.naturalHeight || 1);
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                const data = ctx?.getImageData(0, 0, canvas.width, canvas.height).data;
                if (data) for (let i = 3; i < data.length; i += 4) if (data[i]! < 250) { alpha = true; break; }
              } catch {
                /* SVG or tainted canvas: leave alpha unknown. */
              }
              setInfo({ w: img.naturalWidth, h: img.naturalHeight, alpha });
            }}
          />
        )}
      </div>
    </div>
  );
}

function CodeView({ text }: { text: string }) {
  const lines = text.split('\n');
  const shown = lines.slice(0, 5000);
  return (
    <pre className="fc-code">
      {shown.map((line, i) => (
        <span key={i} className="fc-line">
          <i aria-hidden>{i + 1}</i>
          {line || ' '}
        </span>
      ))}
      {lines.length > shown.length && <span className="fc-more">{t('仅显示前 {v0} 行', { v0: shown.length })}</span>}
    </pre>
  );
}

type Prepared =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; bytes: Uint8Array; text?: string; draft?: DocumentDraft; sheet?: { title: string; body: string }; importAs?: 'document' | 'sheet' | 'presentation' };

async function prepare(item: Item): Promise<Prepared> {
  if (item.size > LIMITS.previewBytes) return { kind: 'error', message: `文件超过 ${formatBytes(LIMITS.previewBytes)}，无法预览。` };
  const bytes = await item.read();
  const kind = fileKind(item.path);
  const name = item.path.split('/').pop() ?? item.path;
  try {
    if (kind === 'markdown' || kind === 'text' || kind === 'code')
      return { kind: 'ready', bytes, text: decodeText(bytes), draft: textDocument(name, bytes), importAs: 'document' };
    if (kind === 'html') {
      const html = decodeText(bytes);
      const converted = htmlToMarkdown(html);
      return { kind: 'ready', bytes, text: html, draft: { title: converted.title || baseName(name), body: converted.body, notes: ['网页中的脚本、样式、表单和媒体不会导入。'] }, importAs: 'document' };
    }
    if (kind === 'docx') return { kind: 'ready', bytes, draft: docxDocument(name, bytes), importAs: 'document' };
    if (kind === 'pptx') return { kind: 'ready', bytes, draft: pptxPresentation(name, bytes), importAs: 'presentation' };
    if (kind === 'sheet') {
      const { importSpreadsheet, selectSpreadsheetRange } = await import('../project-files/spreadsheet');
      const book = importSpreadsheet(name, bytes);
      const first = book.sheets[0];
      if (!first) throw new Error('表格中没有可读取的数据。');
      const selection = selectSpreadsheetRange(book, first, first.bounds);
      return { kind: 'ready', bytes, sheet: { title: selection.title, body: selection.body }, importAs: 'sheet' };
    }
    return { kind: 'ready', bytes };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

function Preview({ item, onImport }: { item: Item; onImport?: (draft: DocumentDraft) => Promise<boolean> }) {
  const [state, setState] = useState<Prepared>({ kind: 'loading' });
  const [source, setSource] = useState(false);
  const [importing, setImporting] = useState(false);
  const kind = fileKind(item.path);
  const name = item.path.split('/').pop() ?? item.path;
  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    setSource(false);
    prepare(item).then((next) => live && setState(next), (error) => live && setState({ kind: 'error', message: String(error) }));
    return () => {
      live = false;
    };
  }, [item]);
  const ready = state.kind === 'ready' ? state : null;
  const url = useObjectUrl(ready && (kind === 'pdf' || kind === 'audio' || kind === 'video' || kind === 'unknown' || kind === 'svg') ? ready.bytes : null, name);
  const Icon = kindIcons[kind];
  function download() {
    if (!ready) return;
    const href = URL.createObjectURL(new Blob([ready.bytes as BlobPart], { type: mimeOf(name) }));
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 30_000);
  }
  async function save() {
    if (!ready || !onImport) return;
    const draft = ready.sheet ? { ...ready.sheet, notes: [] } : ready.draft;
    if (!draft) return;
    setImporting(true);
    try {
      await onImport(draft);
    } finally {
      setImporting(false);
    }
  }
  let body: ReactNode = null;
  if (state.kind === 'loading') body = <p className="fc-status" role="status">{t('读取中')}</p>;
  else if (state.kind === 'error') body = <p className="fc-status fc-error" role="alert">{t(state.message)}</p>;
  else if (kind === 'image') body = <ImagePreview bytes={state.bytes} name={name} />;
  else if (kind === 'svg') body = <div className="fc-checker fc-zoom-fit">{url && <img src={url} alt={name} />}</div>;
  else if (kind === 'markdown') body = source ? <CodeView text={state.text ?? ''} /> : <div className="fc-paper"><MarkdownView text={state.text ?? ''} /></div>;
  else if (kind === 'text' || kind === 'code') body = <CodeView text={state.text ?? ''} />;
  else if (kind === 'html')
    body = source ? <CodeView text={state.text ?? ''} /> : (
      <iframe className="fc-frame" title={name} sandbox="" referrerPolicy="no-referrer" srcDoc={sandboxedHtml(state.text ?? '')} />
    );
  else if (kind === 'docx' && state.draft)
    body = (
      <div className="fc-paper fc-rich">
        <RichDocumentEditor body={state.draft.body} formatting={state.draft.formatting} readOnly onChange={() => false} />
      </div>
    );
  else if (kind === 'pptx' && state.draft) {
    const deck = readPresentation(state.draft.body);
    body = deck && <PresentationEditor document={deck} projectId="" sources={[]} readOnly onChange={() => false} />;
  } else if (kind === 'sheet' && state.sheet) {
    const sheet = readProjectSheet(state.sheet.body);
    body = sheet && (
      <ProjectSheetEditor sheet={sheet} title={state.sheet.title} readOnly onChange={() => false} onSource={() => {}} chart="bar" onChart={() => false} />
    );
  } else if (kind === 'pdf') body = url && <iframe className="fc-frame" title={name} src={url} />;
  else if (kind === 'audio') body = url && <div className="fc-media"><audio controls src={url} /></div>;
  else if (kind === 'video') body = url && <div className="fc-media"><video controls src={url} /></div>;
  else
    body = (
      <div className="fc-unknown">
        <Icon size={56} weight="thin" aria-hidden />
        <p>{t('此类型无法直接预览，可以下载原件。')}</p>
      </div>
    );
  const importLabel = ready?.importAs === 'sheet' ? '保存为工作表' : ready?.importAs === 'presentation' ? '保存为演示' : '保存为项目文档';
  return (
    <section className="fc-preview" aria-label={name}>
      <header className="fc-preview-head">
        <span className={'fc-badge fc-kind-' + kind}>
          <Icon size={18} weight="duotone" aria-hidden />
        </span>
        <div className="fc-title">
          <strong title={item.path}>{name}</strong>
          <small>
            {t(kindLabels[kind])} · {formatBytes(item.size)}
            {item.path.includes('/') && ' · ' + item.path.split('/').slice(0, -1).join(' / ')}
          </small>
        </div>
        <div className="fc-actions">
          {(kind === 'markdown' || kind === 'html') && ready && (
            <button type="button" className="fc-ghost" onClick={() => setSource(!source)} aria-pressed={source}>
              {source ? <Eye size={16} /> : <Code size={16} />}
              {t(source ? '预览' : '源码')}
            </button>
          )}
          {ready && (
            <button type="button" className="fc-ghost" onClick={download}>
              <DownloadSimple size={16} />
              {t('下载')}
            </button>
          )}
          {ready?.importAs && onImport && (
            <button type="button" className="fc-primary" disabled={importing} onClick={() => void save()}>
              <ArrowSquareIn size={16} />
              {t(importLabel)}
            </button>
          )}
        </div>
      </header>
      {ready?.draft?.notes.length ? <p className="fc-note">{ready.draft.notes.map((n) => t(n)).join(' ')}</p> : null}
      <div className="fc-stage">
        <Suspense fallback={<p className="fc-status" role="status">{t('读取中')}</p>}>{body}</Suspense>
      </div>
    </section>
  );
}

function Tree({ nodes, items, selected, onSelect, depth = 0 }: { nodes: TreeNode[]; items: Item[]; selected: number; onSelect: (i: number) => void; depth?: number }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  return (
    <ul className="fc-tree" role={depth ? 'group' : 'tree'}>
      {nodes.map((node) => {
        if (node.children) {
          const open = !closed.has(node.path);
          return (
            <li key={node.path} role="treeitem" aria-expanded={open}>
              <button type="button" className="fc-node fc-folder" style={{ paddingInlineStart: 8 + depth * 14 }}
                onClick={() => setClosed((c) => { const n = new Set(c); if (n.has(node.path)) n.delete(node.path); else n.add(node.path); return n; })}>
                <CaretRight size={12} className={open ? 'fc-open' : ''} aria-hidden />
                <FolderSimple size={16} weight="duotone" aria-hidden />
                <span>{node.name}</span>
              </button>
              {open && <Tree nodes={node.children} items={items} selected={selected} onSelect={onSelect} depth={depth + 1} />}
            </li>
          );
        }
        const Icon = kindIcons[fileKind(node.name)];
        return (
          <li key={node.path} role="treeitem" aria-selected={selected === node.index}>
            <button type="button" className="fc-node" style={{ paddingInlineStart: 22 + depth * 14 }} onClick={() => onSelect(node.index!)}>
              <Icon size={16} weight="duotone" aria-hidden />
              <span title={node.path}>{node.name}</span>
              <small>{formatBytes(items[node.index!]!.size)}</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * File center: open files, folders and zip archives, preview them in place
 * (documents, sheets, slides, Markdown, web pages, code, PDF, images including
 * transparency, audio and video) and save supported ones as project documents.
 * All reading happens locally in the browser.
 */
export function FileCenter({ onClose, onImport }: { onClose: () => void; onImport?: (draft: DocumentDraft) => Promise<boolean> }) {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  async function open(files: File[], folder = false) {
    setError('');
    const next: Item[] = [];
    let skipped = 0;
    for (const file of files) {
      const path = (folder && (file as File & { webkitRelativePath?: string }).webkitRelativePath) || file.name;
      if (fileKind(file.name) === 'zip' && file.size <= LIMITS.previewBytes) {
        try {
          const archive = readZip(new Uint8Array(await file.arrayBuffer()));
          skipped += archive.skipped;
          const root = file.name.replace(/\.zip$/i, '');
          for (const entry of archive.entries)
            next.push({ path: `${root}/${entry.path}`, size: entry.bytes.length, read: async () => entry.bytes });
          continue;
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
          continue;
        }
      }
      next.push({ path, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) });
    }
    if (skipped) setError(`有 ${skipped} 个超大或异常压缩的文件未展开。`);
    if (next.length > LIMITS.zipEntries) next.length = LIMITS.zipEntries;
    setItems(next);
    setSelected(0);
  }
  const tree = useMemo(() => buildTree(items.map((item) => item.path)), [items]);
  const multi = items.length > 1 || items.some((item) => item.path.includes('/'));
  return (
    <div className="fc-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={'fc-dialog' + (multi ? ' fc-multi' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={t('文件中心')}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void open([...e.dataTransfer.files]);
        }}
      >
        <header className="fc-head">
          <h2>{t('文件中心')}</h2>
          <div className="fc-head-actions">
            <button type="button" className="fc-ghost" onClick={() => filePicker.current?.click()}>
              <UploadSimple size={16} />
              {t('打开文件')}
            </button>
            <button type="button" className="fc-ghost" onClick={() => folderPicker.current?.click()}>
              <FolderOpen size={16} />
              {t('打开文件夹')}
            </button>
            <button type="button" className="fc-close" aria-label={t('关闭')} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <input ref={filePicker} type="file" multiple hidden aria-label={t('打开文件')}
            onChange={(e) => { void open([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <input ref={folderPicker} type="file" multiple hidden aria-label={t('打开文件夹')}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => { void open([...(e.target.files ?? [])], true); e.target.value = ''; }} />
        </header>
        {error && <p className="fc-banner" role="alert">{t(error)}</p>}
        {!items.length ? (
          <div className={'fc-drop' + (dragging ? ' fc-dragging' : '')}>
            <div className="fc-drop-icon" aria-hidden>
              <UploadSimple size={34} weight="duotone" />
            </div>
            <h3>{t('拖入文件、文件夹或压缩包')}</h3>
            <p>{t('在浏览器中直接预览，文件不会上传；需要时可保存为项目文档、工作表或演示。')}</p>
            <div className="fc-drop-actions">
              <button type="button" className="fc-primary" onClick={() => filePicker.current?.click()}>
                <UploadSimple size={16} />
                {t('选择文件')}
              </button>
              <button type="button" className="fc-ghost" onClick={() => folderPicker.current?.click()}>
                <FolderOpen size={16} />
                {t('选择文件夹')}
              </button>
            </div>
            <ul className="fc-formats" aria-label={t('支持的格式')}>
              {['Word', 'Excel / CSV', 'PowerPoint', 'PDF', 'Markdown', 'HTML', 'TXT', t('代码'), 'PNG / JPG / WebP', 'SVG', t('音频 / 视频'), 'ZIP'].map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="fc-body">
            {multi && (
              <nav className="fc-side" aria-label={t('文件列表')}>
                <Tree nodes={tree} items={items} selected={selected} onSelect={setSelected} />
              </nav>
            )}
            {items[selected] && <Preview key={items[selected]!.path + selected} item={items[selected]!} onImport={onImport} />}
          </div>
        )}
        {dragging && items.length > 0 && <div className="fc-drop-overlay">{t('松开以打开')}</div>}
      </div>
    </div>
  );
}
