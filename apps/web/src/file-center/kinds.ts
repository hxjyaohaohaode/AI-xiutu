/**
 * File-type registry for the file center: what a file is, how it is grouped
 * (Drive-style filters), its MIME type and the per-kind size budget that is
 * shown before anything is decoded.
 */

export type FileKind =
  | 'image'
  | 'svg'
  | 'psd'
  | 'tiff'
  | 'heic'
  | 'markdown'
  | 'text'
  | 'rtf'
  | 'code'
  | 'json'
  | 'html'
  | 'epub'
  | 'docx'
  | 'odt'
  | 'sheet'
  | 'pptx'
  | 'odp'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'font'
  | 'zip'
  | 'tar'
  | 'gzip'
  | 'rar'
  | 'sevenzip'
  | 'legacy'
  | 'unknown';

const extensionKinds: Record<string, FileKind> = {
  png: 'image', apng: 'image', jpg: 'image', jpeg: 'image', jfif: 'image', gif: 'image', webp: 'image', avif: 'image',
  bmp: 'image', ico: 'image', cur: 'image',
  svg: 'svg',
  psd: 'psd', psb: 'psd',
  tif: 'tiff', tiff: 'tiff', dng: 'tiff',
  heic: 'heic', heif: 'heic',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  txt: 'text', log: 'text', text: 'text', srt: 'text', vtt: 'text', nfo: 'text',
  rtf: 'rtf',
  js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code', css: 'code', scss: 'code', less: 'code',
  py: 'code', java: 'code', kt: 'code', swift: 'code', c: 'code', h: 'code', cpp: 'code', hpp: 'code', cs: 'code',
  go: 'code', rs: 'code', rb: 'code', php: 'code', sh: 'code', bat: 'code', ps1: 'code', sql: 'code', xml: 'code',
  yaml: 'code', yml: 'code', toml: 'code', ini: 'code', env: 'code', vue: 'code', svelte: 'code', lua: 'code', r: 'code',
  dart: 'code', gradle: 'code', dockerfile: 'code', makefile: 'code',
  json: 'json', jsonl: 'json', geojson: 'json', ipynb: 'json',
  html: 'html', htm: 'html', xhtml: 'html',
  epub: 'epub',
  docx: 'docx', docm: 'docx', dotx: 'docx',
  odt: 'odt',
  xlsx: 'sheet', xlsm: 'sheet', xlsb: 'sheet', xls: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'sheet',
  pptx: 'pptx', pptm: 'pptx', potx: 'pptx',
  odp: 'odp',
  pdf: 'pdf',
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio', weba: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video', mkv: 'video',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
  zip: 'zip', jar: 'zip', apk: 'zip', xpi: 'zip',
  tar: 'tar', tgz: 'tar',
  gz: 'gzip',
  rar: 'rar',
  '7z': 'sevenzip',
  doc: 'legacy', ppt: 'legacy', pps: 'legacy', wps: 'legacy', et: 'legacy', dps: 'legacy',
};

export const codeLanguages: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', py: 'python',
  rb: 'ruby', sh: 'bash', yml: 'yaml', md: 'markdown', kt: 'kotlin', cs: 'csharp', rs: 'rust', ps1: 'powershell',
};

export const extensionOf = (name: string) => {
  const leaf = (name.split('/').pop() ?? name).toLowerCase();
  if (leaf === 'dockerfile' || leaf === 'makefile') return leaf;
  if (/\.tar\.gz$/.test(leaf)) return 'tgz';
  return /\.([a-z0-9]{1,8})$/.exec(leaf)?.[1] ?? '';
};
export const fileKind = (name: string): FileKind => extensionKinds[extensionOf(name)] ?? 'unknown';
export const leafName = (path: string) => path.split('/').filter(Boolean).pop() ?? path;
export const baseName = (name: string) => leafName(name).replace(/\.tar\.gz$/i, '').replace(/\.[^.]+$/, '').slice(0, 120) || '未命名';

export type Category = 'all' | 'documents' | 'sheets' | 'slides' | 'images' | 'media' | 'archives' | 'code' | 'fonts' | 'other';
export const categories: Category[] = ['all', 'documents', 'sheets', 'slides', 'images', 'media', 'archives', 'code', 'fonts', 'other'];
export const categoryLabels: Record<Category, string> = {
  all: '全部', documents: '文档', sheets: '表格', slides: '演示', images: '图片', media: '音视频',
  archives: '压缩包', code: '代码与数据', fonts: '字体', other: '其他',
};
const kindCategory: Record<FileKind, Exclude<Category, 'all'>> = {
  image: 'images', svg: 'images', psd: 'images', tiff: 'images', heic: 'images',
  markdown: 'documents', text: 'documents', rtf: 'documents', html: 'documents', epub: 'documents', docx: 'documents',
  odt: 'documents', pdf: 'documents', legacy: 'documents',
  code: 'code', json: 'code',
  sheet: 'sheets',
  pptx: 'slides', odp: 'slides',
  audio: 'media', video: 'media',
  font: 'fonts',
  zip: 'archives', tar: 'archives', gzip: 'archives', rar: 'archives', sevenzip: 'archives',
  unknown: 'other',
};
export const categoryOf = (kind: FileKind) => kindCategory[kind];
export const isArchive = (kind: FileKind) => kind === 'zip' || kind === 'tar' || kind === 'gzip' || kind === 'rar';

export const kindLabels: Record<FileKind, string> = {
  image: '图片', svg: 'SVG 矢量图', psd: 'Photoshop 文档', tiff: 'TIFF 图像', heic: 'HEIC 照片', markdown: 'Markdown',
  text: '纯文本', rtf: 'RTF 文档', code: '代码', json: 'JSON 数据', html: '网页', epub: 'EPUB 电子书', docx: 'Word 文档',
  odt: 'OpenDocument 文本', sheet: '表格', pptx: '演示文稿', odp: 'OpenDocument 演示', pdf: 'PDF', audio: '音频',
  video: '视频', font: '字体', zip: 'ZIP 压缩包', tar: 'TAR 归档', gzip: 'GZIP 压缩文件', rar: 'RAR 压缩包',
  sevenzip: '7z 压缩包', legacy: '旧版 Office 文档', unknown: '其他文件',
};

const mimes: Record<string, string> = {
  png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', cur: 'image/x-icon', svg: 'image/svg+xml',
  heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', weba: 'audio/webm',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg', mkv: 'video/x-matroska',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', json: 'application/json',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', zip: 'application/zip',
};
export const mimeOf = (name: string) => mimes[extensionOf(name)] ?? 'application/octet-stream';

const MB = 1024 * 1024;
/**
 * Bytes a previewer will hold in memory at once. Streams (PDF, audio, video,
 * images, stored archive entries) are not copied and have no cap beyond the
 * browser's own; parsers that need the whole file do.
 */
export const LIMITS = {
  /** Text is read in windows; this is one window. */
  textWindow: 4 * MB,
  /** Documents saved into the project (the document store's own limit). */
  textChars: 100_000,
  sheetBytes: 300 * MB,
  sheetRows: 200_000,
  psdBytes: 1024 * MB,
  tiffBytes: 400 * MB,
  rarBytes: 1024 * MB,
  jsonTreeBytes: 24 * MB,
  fontBytes: 64 * MB,
  /** Uncompressed bytes kept from a streamed archive (.tar.gz, .gz). */
  streamedArchiveBytes: 1024 * MB,
  archiveEntries: 20_000,
  /** One extracted entry of a deflated zip, and the ratio that marks a bomb. */
  entryBytes: 2048 * MB,
  entryRatio: 1000,
  /** Images larger than this many pixels are shown from a downscaled decode. */
  imagePixels: 64_000_000,
  /** Thumbnails are generated only for files below this size. */
  thumbBytes: 120 * MB,
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
