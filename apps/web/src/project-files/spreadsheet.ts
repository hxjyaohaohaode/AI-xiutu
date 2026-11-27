import { unzipSync, zipSync } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as XLSX from 'xlsx';
import { delimited, numericCell } from '@ai-xiutu/contracts/office-data';

type Value = { text: string; literal: boolean; formula?: boolean; unreadable?: boolean };
export type ImportedSheet = {
  name: string;
  bounds: string;
  cells: Record<string, Value>;
  hiddenRows: number[];
  hiddenCols: number[];
  merges: XLSX.Range[];
};
export type ImportedWorkbook = { filename: string; sha256: string; sheets: ImportedSheet[] };

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const maxCells = 40000;
const invalidTable = '请选择有表头、至少两列和一行数据的矩形区域。';
const tooLarge = '表格超出本机导入限额，请在源文件中另存所需区域。';
const unsupported = '请选择标准 .xlsx、UTF-8/Unicode CSV 或 TSV 表格。';

function boundedPackage(bytes: Uint8Array) {
  let entries = 0, expanded = 0;
  const names = new Set<string>();
  unzipSync(bytes, { filter(entry) {
    expanded += entry.originalSize;
    if (++entries > 512 || expanded > 16 * 1024 * 1024 || entry.originalSize > 4 * 1024 * 1024)
      throw new Error(tooLarge);
    if (names.has(entry.name) || entry.name.includes('\\') || entry.name.split('/').includes('..'))
      throw new Error(unsupported);
    names.add(entry.name);
    return false;
  } });
  if (!names.has('xl/workbook.xml') || !names.has('[Content_Types].xml') ||
      [...names].some((name) => /(?:^|\/)vbaProject\.bin$/i.test(name))) throw new Error(unsupported);
  // Give the parser a bounded, stored ZIP of XML parts. It never independently
  // inflates embedded attachments or trusts the original compressed package.
  const parts = unzipSync(bytes, { filter: (entry) => /(?:\.xml|\.rels)$/i.test(entry.name) });
  return zipSync(parts, { level: 0 });

}

function decimal(n: number, shift = 0) {
  const [mantissa, exponent = '0'] = Math.abs(n).toString().toLowerCase().split('e');
  const digits = mantissa.replace('.', '');
  const position = mantissa.split('.')[0].length + Number(exponent) + shift;
  let value = position <= 0 ? '0.' + '0'.repeat(-position) + digits
    : position >= digits.length ? digits + '0'.repeat(position - digits.length)
    : digits.slice(0, position) + '.' + digits.slice(position);
  value = value.replace(/^0+(?=\d)/, '');
  return (n < 0 ? '-' : '') + value;
}

function valueOf(cell: XLSX.CellObject): Value {
  if (cell.t === 'e') return { text: cell.w ?? '#ERROR', literal: true, unreadable: true };
  if (cell.t === 'b') return { text: cell.v ? 'TRUE' : 'FALSE', literal: true };
  if (cell.t !== 'n') return { text: String(cell.v ?? ''), literal: true };
  const n = cell.v as number;
  const format = String(cell.z ?? '');
  if (XLSX.SSF.is_date(format) || /^0\d+$/.test(cell.w ?? ''))
    return { text: cell.w ?? String(n), literal: true };
  if (!Number.isFinite(n) || Math.abs(n) >= 1e15)
    return { text: String(n), literal: false, unreadable: true };
  const percent = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '').includes('%');
  const text = decimal(n, percent ? 2 : 0) + (percent ? '%' : '');
  return { text, literal: false, unreadable: !numericCell(text) };
}

function textSheet(filename: string, bytes: Uint8Array): ImportedSheet {
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le'
    : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error(unsupported); }
  if (text.length > 200000) throw new Error(tooLarge);
  const rows = delimited(text.replace(/\r\n?/g, '\n'), /\.tsv$/i.test(filename) ? '\t' : ',');
  if (!rows) throw new Error(invalidTable);
  if (rows.length * rows[0].length > maxCells) throw new Error(tooLarge);
  const cells: ImportedSheet['cells'] = Object.create(null);
  rows.forEach((row, r) => row.forEach((value, c) => {
    cells[XLSX.utils.encode_cell({ r, c })] = { text: value, literal: r === 0 || !numericCell(value) };
  }));
  return { name: filename.replace(/\.[^.]+$/, ''), cells, hiddenRows: [], hiddenCols: [], merges: [],
    bounds: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: rows.length - 1, c: rows[0].length - 1 }) };
}

export function importSpreadsheet(filename: string, bytes: Uint8Array): ImportedWorkbook {
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES) throw new Error(tooLarge);
  const source = { filename, sha256: bytesToHex(sha256(bytes)) };
  if (/\.(csv|tsv)$/i.test(filename)) return { ...source, sheets: [textSheet(filename, bytes)] };
  if (!/\.xlsx$/i.test(filename)) throw new Error(unsupported);
  const archive = boundedPackage(bytes);
  const options = { type: 'array' as const, cellStyles: true, cellNF: true, cellText: true, cellHTML: false,
    cellFormula: true, sheetStubs: true, dense: false, WTF: true };
  const metadata = XLSX.read(archive, { ...options, sheets: [] });
  const names = metadata.SheetNames.filter((_, i) => !metadata.Workbook?.Sheets?.[i]?.Hidden);
  if (!names.length || names.length > 32) throw new Error(tooLarge);
  const book = XLSX.read(archive, { ...options, sheets: names });
  let cellCount = 0;
  let cachedBook: XLSX.WorkBook | undefined;
  const sheets = names.flatMap((name) => {
    const sheet = book.Sheets[name];
    if (!sheet || (sheet['!type'] && sheet['!type'] !== 'sheet')) return [];
    const cells: ImportedSheet['cells'] = Object.create(null);
    const bounds = { s: { r: Infinity, c: Infinity }, e: { r: 0, c: 0 } };
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue;
      const cell: XLSX.CellObject = sheet[address];
      const formula = cell.f !== undefined || cell.F !== undefined;
      if (cell.t === 'z' && !formula) continue;
      if (++cellCount > maxCells) throw new Error(tooLarge);
      const { r, c } = XLSX.utils.decode_cell(address);
      bounds.s.r = Math.min(bounds.s.r, r); bounds.s.c = Math.min(bounds.s.c, c);
      bounds.e.r = Math.max(bounds.e.r, r); bounds.e.c = Math.max(bounds.e.c, c);
      if (formula) {
        // With formula parsing enabled, SheetJS can synthesize 0 for an absent <v>.
        // Reading the same sheet without formulas distinguishes a real stored zero.
        cachedBook ??= XLSX.read(archive, { ...options, sheets: names, cellFormula: false });
        const value: XLSX.CellObject | undefined = cachedBook.Sheets[name]?.[address];
        cells[address] = value && value.t !== 'z' && value.v !== undefined
          ? { ...valueOf(value), formula: true } : { text: '', literal: true, unreadable: true, formula: true };
      } else cells[address] = valueOf(cell);
    }
    if (!Number.isFinite(bounds.s.r)) return [];
    const hidden = (items?: ({ hidden?: boolean } | undefined)[]) =>
      Object.keys(items ?? {}).filter((k) => items?.[Number(k)]?.hidden).map(Number);
    return [{ name, cells, bounds: XLSX.utils.encode_range(bounds), hiddenRows: hidden(sheet['!rows']),
      hiddenCols: hidden(sheet['!cols']), merges: sheet['!merges'] ?? [] }];
  });
  if (!sheets.length) throw new Error(invalidTable);
  return { ...source, sheets };
}

export function selectSpreadsheetRange(workbook: ImportedWorkbook, sheet: ImportedSheet, input: string) {
  const ref = input.trim().toUpperCase().replace(/\$/g, '');
  if (!/^[A-Z]{1,3}[1-9]\d{0,6}:[A-Z]{1,3}[1-9]\d{0,6}$/.test(ref)) throw new Error(invalidTable);
  const range = XLSX.utils.decode_range(ref), bounds = XLSX.utils.decode_range(sheet.bounds);
  const width = range.e.c - range.s.c + 1, height = range.e.r - range.s.r + 1;
  if (width < 2 || height < 2 || width > 256 || width * height > maxCells ||
      range.s.r < bounds.s.r || range.s.c < bounds.s.c || range.e.r > bounds.e.r || range.e.c > bounds.e.c)
    throw new Error(invalidTable);
  if (sheet.hiddenRows.some((r) => r >= range.s.r && r <= range.e.r) ||
      sheet.hiddenCols.some((c) => c >= range.s.c && c <= range.e.c))
    throw new Error('所选区域含隐藏行或列，请选择可见数据区域。');
  if (sheet.merges.some((m) => m.s.r <= range.e.r && m.e.r >= range.s.r && m.s.c <= range.e.c && m.e.c >= range.s.c))
    throw new Error('所选区域含合并单元格，请选择矩形明细表。');
  const lines: string[] = [], preview: string[][] = [];
  let formulas = 0, length = 0;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const values: string[] = [], sample: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const value = sheet.cells[XLSX.utils.encode_cell({ r, c })] ?? { text: '', literal: true };
      if (value.unreadable) throw new Error('区域内含缺少缓存的公式、错误值或超精度数字，请重新计算或将编号存为文本。');
      if (/[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value.text))
        throw new Error('内容包含文件格式不支持的字符，请清理后导出。');
      if (r === range.s.r && !value.text.trim()) throw new Error(invalidTable);
      if (value.formula) formulas++;
      values.push(value.literal || r === range.s.r ? '"' + value.text.replace(/"/g, '""') + '"' : value.text);
      if (r - range.s.r < 4 && c - range.s.c < 5) sample.push(value.text);
    }
    const line = values.join('\t');
    length += line.length + 1;
    if (length > 100000) throw new Error('内容超过 100000 字符，请分段导出。');
    lines.push(line);
    if (sample.length) preview.push(sample);
  }
  const data = lines.join('\n');
  const longest = data.match(/`+/g)?.reduce((n, part) => Math.max(n, part.length), 2) ?? 2;
  const fence = '`'.repeat(longest + 1);
  const name = workbook.filename.replace(/\.[^.]*$/, '').trim() || sheet.name || '文档';
  const title = (name + (workbook.sheets.length > 1 ? ' · ' + sheet.name : '')).slice(0, 120).replace(/[\uD800-\uDBFF]$/, '');
  const body = '> ' + JSON.stringify(workbook.filename) + ' · ' + JSON.stringify(sheet.name) + '!' + ref + '\n> SHA-256 ' + workbook.sha256 +
    (formulas ? '\n> ' + formulas + ' cached formula value(s)' : '') + '\n\n' + fence + 'sheet-tsv\n' + data + '\n' + fence;
  if (body.length > 100000) throw new Error('内容超过 100000 字符，请分段导出。');
  return { title, body, preview, formulas, rows: height, columns: width };
}
