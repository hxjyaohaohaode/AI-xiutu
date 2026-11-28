import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  X,
  UploadSimple,
  FolderOpen,
  FolderSimple,
  CaretRight,
  CaretLeft,
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
  Info,
  SquaresFour,
  ListBullets,
  MagnifyingGlass,
  ArrowLeft,
  CheckSquare,
  Square,
  Stack,
  PencilSimple,
  BookOpen,
  TextAa,
  Books,
  ImageSquare,
  FileArchive,
  ChartBar,
  Presentation,
  MusicNotes,
  BracketsCurly,
} from '@phosphor-icons/react';
import { t } from '../i18n';
import { archiveRoot, expandArchive, fileItem, type Item } from './archives';
import { buildTree, type DocumentDraft, type TreeNode } from './convert';
import {
  categories,
  categoryLabels,
  categoryOf,
  formatBytes,
  isArchive,
  kindLabels,
  mimeOf,
  type Category,
  type FileKind,
} from './kinds';
import { droppedItems, mergeable, mergeDocuments, zipSelection } from './pack';
import { useThumb, clearThumbs } from './thumbs';
import { Viewer, type ImportPlan, type Meta } from './Viewers';
import './file-center.css';

const kindIcons: Record<FileKind, typeof FileText> = {
  image: FileImage, svg: FileImage, psd: FileImage, tiff: FileImage, heic: FileImage, markdown: FileText, text: FileText,
  rtf: FileDoc, code: FileCode, json: BracketsCurly, html: FileHtml, epub: BookOpen, docx: FileDoc, odt: FileDoc, sheet: FileXls,
  pptx: FilePpt, odp: FilePpt, pdf: FilePdf, audio: FileAudio, video: FileVideo, font: TextAa, zip: FileZip, tar: FileZip,
  gzip: FileZip, rar: FileZip, sevenzip: FileZip, legacy: FileDoc, unknown: FileIcon,
};
const categoryIcons: Record<Category, typeof FileText> = {
  all: Stack, documents: FileText, sheets: ChartBar, slides: Presentation, images: ImageSquare, media: MusicNotes,
  archives: FileArchive, code: FileCode, fonts: TextAa, other: FileIcon,
};
const formatGroups: [Category, string[]][] = [
  ['documents', ['Word', 'PDF', 'Markdown', 'TXT', 'RTF', 'HTML', 'EPUB', 'ODT']],
  ['sheets', ['Excel', 'CSV', 'TSV', 'ODS']],
  ['slides', ['PowerPoint', 'ODP']],
  ['images', ['PNG', 'JPG', 'WebP', 'GIF', 'SVG', 'PSD', 'TIFF', 'HEIC']],
  ['media', ['MP4', 'MOV', 'WebM', 'MP3', 'WAV', 'FLAC']],
  ['archives', ['ZIP', 'RAR', 'TAR', 'GZ']],
  ['code', ['JSON', 'JS / TS', 'Python', 'SQL', 'YAML']],
  ['fonts', ['TTF', 'OTF', 'WOFF']],
];
const importLabels = { document: '保存为项目文档', sheet: '保存为工作表', presentation: '保存为演示' } as const;
type SortKey = 'name' | 'size' | 'kind' | 'modified';

function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private mode: preference stays for this session only. */
  }
}

function download(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: mimeOf(name) }));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const dateText = (ms?: number) => (ms ? new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function Card({ item, index, checked, onOpen, onCheck }: { item: Item; index: number; checked: boolean; onOpen: () => void; onCheck: (shift: boolean) => void }) {
  const { ref, url } = useThumb(item);
  const Icon = kindIcons[item.kind];
  return (
    <div className={'fc-card' + (checked ? ' is-checked' : '')} style={{ ['--i' as string]: Math.min(index, 14) } as CSSProperties} role="listitem">
      <button type="button" className="fc-card-open" onClick={onOpen} aria-label={item.name}>
        <div ref={ref} className={'fc-thumb fc-kind-' + item.kind + (url ? ' has-image' : '')}>
          {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <Icon size={40} weight="duotone" aria-hidden />}
          {item.kind === 'video' && url && <span className="fc-thumb-play" aria-hidden />}
        </div>
        <span className="fc-card-name" title={item.path}>
          {item.name}
        </span>
        <small>
          {t(kindLabels[item.kind])} · {formatBytes(item.size)}
        </small>
      </button>
      <button
        type="button"
        className="fc-check"
        role="checkbox"
        aria-checked={checked}
        aria-label={t('选择 {v0}', { v0: item.name })}
        onClick={(e) => onCheck(e.shiftKey)}
      >
        {checked ? <CheckSquare size={20} weight="fill" /> : <Square size={20} />}
      </button>
    </div>
  );
}

function Row({ item, checked, onOpen, onCheck, showPath }: { item: Item; checked: boolean; onOpen: () => void; onCheck: (shift: boolean) => void; showPath: boolean }) {
  const Icon = kindIcons[item.kind];
  return (
    <div className={'fc-row' + (checked ? ' is-checked' : '')} role="row">
      <span role="gridcell">
        <button type="button" className="fc-check" role="checkbox" aria-checked={checked} aria-label={t('选择 {v0}', { v0: item.name })} onClick={(e) => onCheck(e.shiftKey)}>
          {checked ? <CheckSquare size={18} weight="fill" /> : <Square size={18} />}
        </button>
      </span>
      <span role="gridcell" className="fc-row-name">
        <button type="button" onClick={onOpen}>
          <span className={'fc-row-icon fc-kind-' + item.kind}>
            <Icon size={18} weight="duotone" aria-hidden />
          </span>
          <span>
            <strong title={item.path}>{item.name}</strong>
            {showPath && dirOf(item.path) && <small>{dirOf(item.path).split('/').join(' / ')}</small>}
          </span>
        </button>
      </span>
      <span role="gridcell" className="fc-row-kind">{t(kindLabels[item.kind])}</span>
      <span role="gridcell" className="fc-row-size">{formatBytes(item.size)}</span>
      <span role="gridcell" className="fc-row-date">{dateText(item.modified)}</span>
    </div>
  );
}

function FolderTree({ nodes, folder, onFolder, depth = 0 }: { nodes: TreeNode[]; folder: string; onFolder: (path: string) => void; depth?: number }) {
  const folders = nodes.filter((n) => n.children);
  if (!folders.length) return null;
  return (
    <ul className="fc-tree" role={depth ? 'group' : 'tree'}>
      {folders.map((node) => {
        const open = folder === node.path || folder.startsWith(node.path + '/');
        return (
          <li key={node.path} role="treeitem" aria-expanded={open} aria-selected={folder === node.path}>
            <button type="button" className="fc-node" style={{ paddingInlineStart: 10 + depth * 14 }} onClick={() => onFolder(node.path)}>
              <CaretRight size={11} className={open ? 'fc-open' : ''} aria-hidden />
              <FolderSimple size={16} weight={folder === node.path ? 'fill' : 'duotone'} aria-hidden />
              <span>{node.name}</span>
            </button>
            {open && <FolderTree nodes={node.children!} folder={folder} onFolder={onFolder} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * File center: open files, folders and archives (ZIP, RAR, TAR, GZ), browse them
 * like a drive (categories, folders, search, sort, grid or list), preview each
 * in place with previous/next, and turn them into project documents, sheets or
 * decks, or open photos in the editor. Files are read locally and lazily; large
 * archives and media are never loaded whole just to be listed.
 */
export function FileCenter({
  onClose,
  onImport,
  onEditImage,
}: {
  onClose: () => void;
  onImport?: (draft: DocumentDraft) => Promise<boolean>;
  /** Opens a photo in the image editor (the regular upload pipeline, with its size limits). */
  onEditImage?: (file: File) => Promise<boolean>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState(() => readPref('fc-view', 'grid', ['grid', 'list'] as const));
  const [category, setCategory] = useState<Category>('all');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const lastChecked = useRef<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [meta, setMeta] = useState<Meta>({});
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [sourceable, setSourceable] = useState(false);
  const [source, setSource] = useState(false);
  const [details, setDetails] = useState(() => readPref('fc-details', 'closed', ['open', 'closed'] as const) === 'open');
  const [working, setWorking] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearThumbs(), []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);

  async function expandAll(list: Item[]) {
    const out: Item[] = [];
    let skipped = 0;
    for (const item of list) {
      if (!isArchive(item.kind) || item.unavailable) {
        out.push(item);
        continue;
      }
      try {
        setBusy(t('正在读取 {v0}', { v0: item.name }));
        const archive = await expandArchive(item);
        skipped += archive.skipped;
        out.push(...archive.items);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        out.push(item);
      }
    }
    setBusy('');
    if (skipped) setError(`有 ${skipped} 个路径不安全或超出数量上限的条目未展开。`);
    return out;
  }

  async function open(list: Item[]) {
    setError('');
    if (!list.length) return;
    const next = await expandAll(list);
    setItems(next);
    setChecked(new Set());
    setCategory('all');
    setQuery('');
    setFolder('');
    setViewing(next.length === 1 ? next[0]!.id : null);
  }

  async function expandNested(item: Item) {
    const extra = await expandAll([item]);
    if (extra.length === 1 && extra[0] === item) return;
    setItems((current) => current.flatMap((i) => (i.id === item.id ? extra : [i])));
    setViewing(null);
    setFolder(item.kind === 'gzip' ? dirOf(item.path) : archiveRoot(item.path));
  }

  const tree = useMemo(() => buildTree(items.map((i) => i.path)), [items]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(categories.map((k) => [k, 0])) as Record<Category, number>;
    for (const item of items) {
      c.all++;
      c[categoryOf(item.kind)]++;
    }
    return c;
  }, [items]);
  const flat = category !== 'all' || !!query.trim();
  const needle = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => {
    const list = items.filter((item) => {
      if (category !== 'all' && categoryOf(item.kind) !== category) return false;
      if (needle && !item.path.toLocaleLowerCase().includes(needle)) return false;
      if (!flat && dirOf(item.path) !== folder) return false;
      return true;
    });
    const value = (i: Item) => (sort.key === 'size' ? i.size : sort.key === 'modified' ? i.modified ?? 0 : sort.key === 'kind' ? kindLabels[i.kind] : i.name);
    return list.sort((a, b) => {
      const x = value(a),
        y = value(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    });
  }, [items, category, needle, flat, folder, sort]);
  const subfolders = useMemo(() => {
    if (flat) return [];
    const prefix = folder ? folder + '/' : '';
    const names = new Map<string, number>();
    for (const item of items)
      if (item.path.startsWith(prefix)) {
        const rest = item.path.slice(prefix.length);
        if (rest.includes('/')) {
          const name = rest.slice(0, rest.indexOf('/'));
          names.set(name, (names.get(name) ?? 0) + 1);
        }
      }
    return [...names].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [items, folder, flat]);

  const current = viewing ? items.find((i) => i.id === viewing) ?? null : null;
  const position = current ? visible.findIndex((i) => i.id === current.id) : -1;
  const navList = position >= 0 ? visible : items;
  const navIndex = current ? navList.findIndex((i) => i.id === current.id) : -1;
  function go(step: 1 | -1) {
    if (navIndex < 0 || navList.length < 2) return;
    setDirection(step);
    setViewing(navList[(navIndex + step + navList.length) % navList.length]!.id);
  }
  useEffect(() => {
    setMeta({});
    setPlan(null);
    setSource(false);
    setError('');
  }, [viewing]);

  function check(item: Item, shift: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (shift && lastChecked.current) {
        const a = visible.findIndex((i) => i.id === lastChecked.current),
          b = visible.findIndex((i) => i.id === item.id);
        if (a >= 0 && b >= 0) for (const i of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(i.id);
      } else if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    lastChecked.current = item.id;
  }
  const selection = items.filter((i) => checked.has(i.id));

  async function run(task: () => Promise<void>) {
    setWorking(true);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  }
  const importDraft = (draft: DocumentDraft) =>
    run(async () => {
      if (onImport && (await onImport(draft))) onClose();
    });

  const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(target.tagName) || !!target.closest('[role="grid"]'));

  const Icon = current ? kindIcons[current.kind] : FileIcon;
  const browsing = items.length > 1 || (items.length === 1 && !current);

  return (
    <div className="fc-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        tabIndex={-1}
        className={'fc-dialog' + (items.length ? ' has-items' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={t('文件中心')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (current && browsing) setViewing(null);
            else onClose();
          } else if (current && !isTyping(e.target) && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
            e.preventDefault();
            go(e.key === 'ArrowRight' ? 1 : -1);
          }
        }}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return;
          e.preventDefault();
          setDragging(false);
          void droppedItems(e.dataTransfer).then(open, (cause) => setError(String(cause)));
        }}
      >
        <header className="fc-head">
          <div className="fc-head-title">
            <h2>{t('文件中心')}</h2>
            {items.length > 0 && <small>{t('{v0} 个文件', { v0: items.length })}</small>}
          </div>
          {items.length > 1 && (
            <label className="fc-search">
              <MagnifyingGlass size={16} aria-hidden />
              <input type="search" value={query} placeholder={t('搜索文件名或路径')} aria-label={t('搜索文件')} onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
          <div className="fc-head-actions">
            <button type="button" className="fc-ghost" onClick={() => filePicker.current?.click()}>
              <UploadSimple size={16} />
              <span>{t('打开文件')}</span>
            </button>
            <button type="button" className="fc-ghost" onClick={() => folderPicker.current?.click()}>
              <FolderOpen size={16} />
              <span>{t('打开文件夹')}</span>
            </button>
            <button type="button" className="fc-close" aria-label={t('关闭')} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <input ref={filePicker} type="file" multiple hidden aria-label={t('打开文件')}
            onChange={(e) => { void open([...(e.target.files ?? [])].map((f) => fileItem(f))); e.target.value = ''; }} />
          <input ref={folderPicker} type="file" multiple hidden aria-label={t('打开文件夹')}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => {
              void open([...(e.target.files ?? [])].map((f) => fileItem(f, (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)));
              e.target.value = '';
            }} />
        </header>
        {(error || busy) && (
          <p className={'fc-banner' + (busy && !error ? ' is-busy' : '')} role={error ? 'alert' : 'status'}>
            {error ? t(error) : busy}
            {error && (
              <button type="button" aria-label={t('关闭提示')} onClick={() => setError('')}>
                <X size={14} />
              </button>
            )}
          </p>
        )}

        {!items.length ? (
          <div className={'fc-drop' + (dragging ? ' fc-dragging' : '')}>
            <div className="fc-drop-icon" aria-hidden>
              <Books size={38} weight="duotone" />
            </div>
            <h3>{busy ? t('正在整理文件') : t('拖入文件、文件夹或压缩包')}</h3>
            <p>{t('文件只在这台设备的浏览器里读取，不会上传；大文件和压缩包按需读取，可以直接浏览数 GB 的资料。')}</p>
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
            <ul className="fc-format-groups" aria-label={t('支持的格式')}>
              {formatGroups.map(([group, names]) => {
                const GroupIcon = categoryIcons[group];
                return (
                  <li key={group} className={'fc-group-' + group}>
                    <span className="fc-group-icon" aria-hidden>
                      <GroupIcon size={18} weight="duotone" />
                    </span>
                    <strong>{t(categoryLabels[group])}</strong>
                    <small>{names.join(' · ')}</small>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className={'fc-body' + (browsing ? ' is-browsing' : '')}>
            {browsing && (
              <nav className="fc-rail" aria-label={t('分类')}>
                <ul className="fc-cats">
                  {categories
                    .filter((c) => c === 'all' || counts[c])
                    .map((c) => {
                      const CatIcon = categoryIcons[c];
                      return (
                        <li key={c}>
                          <button type="button" aria-pressed={category === c} onClick={() => { setCategory(c); setViewing(null); }}>
                            <CatIcon size={17} weight={category === c ? 'fill' : 'duotone'} aria-hidden />
                            <span>{t(categoryLabels[c])}</span>
                            <small>{counts[c]}</small>
                          </button>
                        </li>
                      );
                    })}
                </ul>
                {tree.some((n) => n.children) && (
                  <div className="fc-rail-tree">
                    <h3>{t('文件夹')}</h3>
                    <button type="button" className="fc-node" aria-pressed={!folder && !flat} onClick={() => { setFolder(''); setCategory('all'); setQuery(''); }}>
                      <Stack size={16} weight="duotone" aria-hidden />
                      <span>{t('全部文件')}</span>
                    </button>
                    <FolderTree nodes={tree} folder={flat ? '\u0000' : folder} onFolder={(p) => { setFolder(p); setCategory('all'); setQuery(''); setViewing(null); }} />
                  </div>
                )}
              </nav>
            )}
            {browsing && (
              <section className="fc-main" aria-label={t('文件')}>
                <div className="fc-toolbar">
                  {checked.size ? (
                    <div className="fc-selection" role="toolbar" aria-label={t('所选文件')}>
                      <button type="button" className="fc-icon" aria-label={t('清除选择')} onClick={() => setChecked(new Set())}>
                        <X size={16} />
                      </button>
                      <strong>{t('已选 {v0} 项', { v0: checked.size })}</strong>
                      {onImport && selection.some(mergeable) && (
                        <button type="button" className="fc-ghost" disabled={working}
                          onClick={() => void run(async () => { const draft = await mergeDocuments(selection, t('合并的资料')); if (await onImport(draft)) onClose(); })}>
                          <Stack size={16} />
                          {t('合并为一份文档')}
                        </button>
                      )}
                      <button type="button" className="fc-ghost" disabled={working} onClick={() => void run(async () => download(await zipSelection(selection), t('所选文件') + '.zip'))}>
                        <FileArchive size={16} />
                        {t('打包下载')}
                      </button>
                    </div>
                  ) : (
                    <nav className="fc-crumbs" aria-label={t('位置')}>
                      {flat ? (
                        <span>
                          {query.trim() ? t('“{v0}”的搜索结果', { v0: query.trim() }) : t(categoryLabels[category])}
                          <small>{visible.length}</small>
                        </span>
                      ) : (
                        <>
                          <button type="button" onClick={() => setFolder('')} aria-current={!folder ? 'page' : undefined}>
                            {t('全部文件')}
                          </button>
                          {folder.split('/').filter(Boolean).map((part, i, all) => (
                            <span key={i} className="fc-crumb">
                              <CaretRight size={12} aria-hidden />
                              <button type="button" aria-current={i === all.length - 1 ? 'page' : undefined} onClick={() => setFolder(all.slice(0, i + 1).join('/'))}>
                                {part}
                              </button>
                            </span>
                          ))}
                        </>
                      )}
                    </nav>
                  )}
                  <div className="fc-toolbar-end">
                    <button type="button" className="fc-icon" aria-label={t(visible.length && visible.every((i) => checked.has(i.id)) ? '取消全选' : '全选')}
                      onClick={() => setChecked(visible.every((i) => checked.has(i.id)) ? new Set() : new Set(visible.map((i) => i.id)))}>
                      {visible.length && visible.every((i) => checked.has(i.id)) ? <CheckSquare size={18} weight="fill" /> : <CheckSquare size={18} />}
                    </button>
                    <label className="fc-sort">
                      <span className="fc-visually-hidden">{t('排序')}</span>
                      <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort({ key: key as SortKey, dir: Number(dir) as 1 | -1 }); }}>
                        <option value="name:1">{t('名称 A→Z')}</option>
                        <option value="name:-1">{t('名称 Z→A')}</option>
                        <option value="modified:-1">{t('最近修改')}</option>
                        <option value="size:-1">{t('从大到小')}</option>
                        <option value="size:1">{t('从小到大')}</option>
                        <option value="kind:1">{t('按类型')}</option>
                      </select>
                    </label>
                    <div className="fc-seg" role="radiogroup" aria-label={t('视图')}>
                      <button type="button" role="radio" aria-checked={mode === 'grid'} aria-label={t('网格')} onClick={() => { setMode('grid'); writePref('fc-view', 'grid'); }}>
                        <SquaresFour size={16} />
                      </button>
                      <button type="button" role="radio" aria-checked={mode === 'list'} aria-label={t('列表')} onClick={() => { setMode('list'); writePref('fc-view', 'list'); }}>
                        <ListBullets size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="fc-files" key={`${folder}|${category}|${mode}`}>
                  {!visible.length && !subfolders.length ? (
                    <div className="fc-empty">
                      <MagnifyingGlass size={30} weight="duotone" aria-hidden />
                      <p>{query.trim() ? t('没有匹配的文件，换个关键词试试。') : t('这里没有文件。')}</p>
                    </div>
                  ) : mode === 'grid' ? (
                    <div className="fc-grid-cards" role="list">
                      {subfolders.map(([name, count], i) => (
                        <div key={name} className="fc-card fc-folder-card" style={{ ['--i' as string]: Math.min(i, 14) } as CSSProperties} role="listitem">
                          <button type="button" className="fc-card-open" onClick={() => setFolder(folder ? `${folder}/${name}` : name)}>
                            <div className="fc-thumb fc-thumb-folder">
                              <FolderSimple size={46} weight="duotone" aria-hidden />
                            </div>
                            <span className="fc-card-name">{name}</span>
                            <small>{t('{v0} 个文件', { v0: count })}</small>
                          </button>
                        </div>
                      ))}
                      {visible.map((item, i) => (
                        <Card key={item.id} item={item} index={i + subfolders.length} checked={checked.has(item.id)}
                          onOpen={() => { setDirection(1); setViewing(item.id); }} onCheck={(shift) => check(item, shift)} />
                      ))}
                    </div>
                  ) : (
                    <div className="fc-list" role="grid" aria-label={t('文件列表')}>
                      <div className="fc-row fc-row-head" role="row">
                        <span role="columnheader" />
                        {(['name', 'kind', 'size', 'modified'] as SortKey[]).map((key) => (
                          <span key={key} role="columnheader" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                            <button type="button" onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : key === 'name' || key === 'kind' ? 1 : -1 })}>
                              {t({ name: '名称', kind: '类型', size: '大小', modified: '修改时间' }[key])}
                            </button>
                          </span>
                        ))}
                      </div>
                      {subfolders.map(([name, count]) => (
                        <div key={name} className="fc-row" role="row">
                          <span role="gridcell" />
                          <span role="gridcell" className="fc-row-name">
                            <button type="button" onClick={() => setFolder(folder ? `${folder}/${name}` : name)}>
                              <span className="fc-row-icon fc-kind-folder">
                                <FolderSimple size={18} weight="duotone" aria-hidden />
                              </span>
                              <span>
                                <strong>{name}</strong>
                              </span>
                            </button>
                          </span>
                          <span role="gridcell" className="fc-row-kind">{t('文件夹')}</span>
                          <span role="gridcell" className="fc-row-size">{t('{v0} 个文件', { v0: count })}</span>
                          <span role="gridcell" className="fc-row-date" />
                        </div>
                      ))}
                      {visible.map((item) => (
                        <Row key={item.id} item={item} checked={checked.has(item.id)} showPath={flat}
                          onOpen={() => { setDirection(1); setViewing(item.id); }} onCheck={(shift) => check(item, shift)} />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {current && (
              <section className={'fc-viewer' + (browsing ? ' is-overlay' : '') + (details ? ' with-details' : '')} aria-label={current.name}>
                <header className="fc-viewer-head">
                  {browsing && (
                    <button type="button" className="fc-icon" aria-label={t('返回文件列表')} onClick={() => setViewing(null)}>
                      <ArrowLeft size={18} />
                    </button>
                  )}
                  <span className={'fc-badge fc-kind-' + current.kind}>
                    <Icon size={18} weight="duotone" aria-hidden />
                  </span>
                  <div className="fc-title">
                    <strong title={current.path}>{current.name}</strong>
                    <small>
                      {t(kindLabels[current.kind])} · {formatBytes(current.size)}
                      {navList.length > 1 && navIndex >= 0 && <> · {navIndex + 1} / {navList.length}</>}
                    </small>
                  </div>
                  {navList.length > 1 && (
                    <div className="fc-stepper" role="group" aria-label={t('切换文件')}>
                      <button type="button" className="fc-icon" aria-label={t('上一个文件')} onClick={() => go(-1)}>
                        <CaretLeft size={16} />
                      </button>
                      <button type="button" className="fc-icon" aria-label={t('下一个文件')} onClick={() => go(1)}>
                        <CaretRight size={16} />
                      </button>
                    </div>
                  )}
                  <div className="fc-actions">
                    {sourceable && (
                      <button type="button" className="fc-ghost" onClick={() => setSource(!source)} aria-pressed={source}>
                        {source ? <Eye size={16} /> : <Code size={16} />}
                        <span>{t(source ? '预览' : '源码')}</span>
                      </button>
                    )}
                    <button type="button" className="fc-ghost" aria-pressed={details} onClick={() => { setDetails(!details); writePref('fc-details', details ? 'closed' : 'open'); }}>
                      <Info size={16} />
                      <span>{t('详情')}</span>
                    </button>
                    {!current.unavailable && (
                      <button type="button" className="fc-ghost" onClick={() => void run(async () => download(await current.blob(), current.name))}>
                        <DownloadSimple size={16} />
                        <span>{t('下载')}</span>
                      </button>
                    )}
                    {onEditImage && current.kind === 'image' && !current.unavailable && (
                      <button type="button" className={plan ? 'fc-ghost' : 'fc-primary'} disabled={working}
                        onClick={() => void run(async () => {
                          const blob = await current.blob();
                          if (await onEditImage(new File([blob], current.name, { type: mimeOf(current.name), lastModified: current.modified ?? Date.now() }))) onClose();
                        })}>
                        <PencilSimple size={16} />
                        <span>{t('在修图中打开')}</span>
                      </button>
                    )}
                    {plan && onImport && (
                      <button type="button" className="fc-primary" disabled={working} onClick={() => void run(async () => importDraft(await plan.build()))}>
                        <ArrowSquareIn size={16} />
                        <span>{t(importLabels[plan.as])}</span>
                      </button>
                    )}
                  </div>
                </header>
                <div className="fc-viewer-body">
                  <div className="fc-stage">
                    <div key={current.id} className={'fc-swap ' + (direction === 1 ? 'from-next' : 'from-prev')}>
                      <Viewer
                        item={current}
                        source={source}
                        onMeta={(m) => setMeta((prev) => ({ ...prev, ...m }))}
                        onPlan={setPlan}
                        onSourceable={setSourceable}
                        onExpand={() => void expandNested(current)}
                        onSwipe={navList.length > 1 ? go : undefined}
                      />
                    </div>
                    {navList.length > 1 && ['image', 'svg', 'psd', 'tiff', 'heic'].includes(current.kind) && (
                      <>
                        <button type="button" className="fc-nav fc-nav-prev" aria-label={t('上一个文件')} onClick={() => go(-1)}>
                          <CaretLeft size={20} weight="bold" />
                        </button>
                        <button type="button" className="fc-nav fc-nav-next" aria-label={t('下一个文件')} onClick={() => go(1)}>
                          <CaretRight size={20} weight="bold" />
                        </button>
                      </>
                    )}
                  </div>
                  {details && (
                    <aside className="fc-details" aria-label={t('详情')}>
                      <h3>{t('详情')}</h3>
                      <dl>
                        <dt>{t('类型')}</dt>
                        <dd>{t(kindLabels[current.kind])}</dd>
                        <dt>{t('大小')}</dt>
                        <dd>{formatBytes(current.size)} <small>({current.size.toLocaleString()} B)</small></dd>
                        {dirOf(current.path) && (
                          <>
                            <dt>{t('位置')}</dt>
                            <dd>{dirOf(current.path).split('/').join(' / ')}</dd>
                          </>
                        )}
                        {current.modified && (
                          <>
                            <dt>{t('修改时间')}</dt>
                            <dd>{dateText(current.modified)}</dd>
                          </>
                        )}
                        {Object.entries(meta).map(([k, v]) => (
                          <div key={k} className="fc-dl-row">
                            <dt>{t(k)}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="fc-details-note">{t('文件在本机读取，保存到项目前不会上传。')}</p>
                    </aside>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
        {dragging && <div className="fc-drop-overlay">{t('松开以打开')}</div>}
      </div>
    </div>
  );
}
