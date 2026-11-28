import * as XLSX from 'xlsx';
import { decodeText } from './convert';
import { LIMITS } from './kinds';

/**
 * Read-only workbook preview: every visible sheet as rows of display text
 * (the formatted value Excel shows), parsed with a row cap so a 200 MB export
 * opens in seconds. Saving into the project still goes through the strict
 * importer on the range the user selects.
 */
export interface SheetPreview {
  name: string;
  rows: string[][];
  columns: number;
  /** Rows in the source sheet when more were present than were read. */
  totalRows?: number;
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
}

const maxColumns = 1024;

export function readSheets(name: string, bytes: Uint8Array, maxRows = LIMITS.sheetRows): SheetPreview[] {
  const lower = name.toLowerCase();
  const options = { dense: true, sheetRows: maxRows + 1, cellText: true, cellDates: false, cellFormula: false, cellStyles: false, cellHTML: false } as const;
  let book: XLSX.WorkBook;
  if (/\.(csv|tsv)$/.test(lower)) {
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : '';
    const text = utf16 ? new TextDecoder(utf16).decode(bytes) : decodeText(bytes);
    book = XLSX.read(text, { ...options, type: 'string', raw: true, ...(lower.endsWith('.tsv') ? { FS: '\t' } : {}) });
  } else book = XLSX.read(bytes, { ...options, type: 'array' });
  const visible = book.SheetNames.filter((_, i) => !book.Workbook?.Sheets?.[i]?.Hidden);
  return visible.slice(0, 64).map((sheetName) => {
    const sheet = book.Sheets[sheetName]!;
    const rows = (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true }) as unknown[][])
      .slice(0, maxRows)
      .map((row) => row.slice(0, maxColumns).map((v) => (v == null ? '' : String(v))));
    while (rows.length && rows[rows.length - 1]!.every((v) => !v)) rows.pop();
    const full = sheet['!fullref'] ? XLSX.utils.decode_range(sheet['!fullref']) : null;
    const totalRows = full && full.e.r + 1 > rows.length ? full.e.r + 1 : undefined;
    return {
      name: sheetName,
      rows,
      columns: Math.min(maxColumns, rows.reduce((n, r) => Math.max(n, r.length), 0)),
      ...(totalRows ? { totalRows } : {}),
      merges: (sheet['!merges'] ?? []).slice(0, 2000),
    };
  });
}

/** Excel column letters: 0 → A, 26 → AA. */
export function columnName(index: number) {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** CSV for a selected rectangle (quoted where needed), used to save part of a large sheet. */
export function rangeCsv(rows: string[][], r0: number, c0: number, r1: number, c1: number) {
  const out: string[] = [];
  for (let r = r0; r <= r1; r++) {
    const cells: string[] = [];
    for (let c = c0; c <= c1; c++) {
      const v = rows[r]?.[c] ?? '';
      cells.push(/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
    }
    out.push(cells.join(','));
  }
  return out.join('\n');
}

/** Parses in a Web Worker so the page stays responsive on large workbooks. */
export async function parseSheetsInWorker(name: string, blob: Blob): Promise<SheetPreview[]> {
  if (blob.size > LIMITS.sheetBytes) throw new Error('表格超过 300 MB，无法在浏览器中预览。');
  const buffer = await blob.arrayBuffer();
  if (typeof Worker === 'undefined') return readSheets(name, new Uint8Array(buffer));
  const worker = new Worker(new URL('./sheet-worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<SheetPreview[]>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ ok: true; sheets: SheetPreview[] } | { ok: false; message: string }>) =>
        event.data.ok ? resolve(event.data.sheets) : reject(new Error(event.data.message));
      worker.onerror = (event) => reject(new Error(event.message || '表格解析失败。'));
      worker.postMessage({ name, buffer }, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}
