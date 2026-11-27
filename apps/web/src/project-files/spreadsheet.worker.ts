import { importSpreadsheet, selectSpreadsheetRange, type ImportedWorkbook } from './spreadsheet';
type Request = { name: string; bytes: ArrayBuffer } | { sheet: number; range: string; ticket: number };

let book: ImportedWorkbook | undefined;
self.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    if ('bytes' in data) {
      book = importSpreadsheet(data.name, new Uint8Array(data.bytes));
      self.postMessage({ sheets: book.sheets.map(({ name, bounds }) => ({ name, bounds })) });
    } else if (book && book.sheets[data.sheet]) {
      self.postMessage({ ticket: data.ticket, selection: selectSpreadsheetRange(book, book.sheets[data.sheet]!, data.range) });
    }
  } catch (error) {
    const message = error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '无法读取表格文件。';
    self.postMessage({ ticket: 'ticket' in data ? data.ticket : undefined, error: message });
  }
};
