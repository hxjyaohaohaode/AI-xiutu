import { delimited, type DataTable } from './table.js';
import { columnName } from './formulas.js';
export { columnName } from './formulas.js';

const formulaPrefix = '> Formulas v1 ';

export type ProjectSheet = { source: string; filename: string; range: string; table: DataTable };

/** An imported provenance header or a standalone typed sheet is editable as a grid.
 * A prose document containing a Markdown table stays a document. */
export function readProjectSheet(body: string): ProjectSheet | null {
  if (!body.includes('sheet-tsv\n')) return null;
  let formulas: Record<string, string> | undefined;
  if (body.startsWith(formulaPrefix)) {
    const end = body.indexOf('\n\n');
    if (end < 0) return null;
    try {
      const parsed = JSON.parse(body.slice(formulaPrefix.length, end));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const entries = Object.entries(parsed);
      if (
        entries.length > 1024 ||
        entries.some(
          ([address, value]) =>
            !/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(address) ||
            typeof value !== 'string' ||
            value.length > 1024 ||
            !value.startsWith('='),
        )
      )
        return null;
      formulas = Object.fromEntries(entries as [string, string][]);
      body = body.slice(end + 2);
    } catch {
      return null;
    }
  }
  const header =
    /^> ("(?:[^"\\]|\\.)*") · ("(?:[^"\\]|\\.)*")!([A-Z]+[1-9]\d*:[A-Z]+[1-9]\d*)\n> SHA-256 [a-f0-9]{64}\n(?:> [0-9]+ cached formula value\(s\)\n)?\n/.exec(
      body,
    );
  const rest = header ? body.slice(header[0].length) : body;
  const open = /^(`{3,})sheet-tsv\n/.exec(rest);
  if (!open || !rest.endsWith('\n' + open[1])) return null;
  const literals = new Set<number>();
  const rows = delimited(rest.slice(open[0].length, -open[1]!.length - 1), '\t', literals);
  if (!rows) return null;
  if (formulas) {
    const addresses = new Set(Object.keys(formulas));
    for (let r = 1; addresses.size && r < rows.length; r++)
      for (let c = 0; c < rows[0]!.length; c++) addresses.delete(columnName(c) + (r + 1));
    if (addresses.size) return null;
  }
  try {
    return {
      filename: header ? JSON.parse(header[1]!) : '',
      range: header ? JSON.parse(header[2]!) + '!' + header[3] : '',
      source: header?.[0] ?? '',
      table: {
        kind: 'table',
        line: 0,
        headers: rows[0]!,
        rows: rows.slice(1),
        textCells: literals,
        ...(formulas ? { formulas } : {}),
      },
    };
  } catch {
    return null;
  }
}

export function editProjectCell(sheet: ProjectSheet, row: number, col: number, value: string) {
  const { table } = sheet;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row > table.rows.length ||
    col < 0 ||
    col >= table.headers.length ||
    value.length > 32767 ||
    (!row && !value.trim())
  )
    return null;
  const cells = [table.headers, ...table.rows].map((r) => [...r]);
  const text = new Set(table.textCells);
  const formulas = { ...table.formulas };
  const address = columnName(col) + (row + 1),
    index = row * table.headers.length + col;
  const expression = row > 0 && value.startsWith('=');
  if (
    expression &&
    (value.length > 1024 || (!formulas[address] && Object.keys(formulas).length >= 1024))
  )
    return null;
  if (expression) formulas[address] = value;
  else delete formulas[address];
  const literal = row > 0 && value.startsWith("'");
  if (literal) text.add(index);
  else if (expression || table.formulas?.[address]) text.delete(index);
  cells[row]![col] = expression ? '' : literal ? value.slice(1) : value;
  return storeSheet(sheet.source, cells, text, formulas);
}

function storeSheet(
  source: string,
  cells: string[][],
  text: ReadonlySet<number>,
  formulas: Record<string, string>,
) {
  const tsv = cells
    .map((row, r) =>
      row
        .map((value, c) =>
          !r || text.has(r * row.length + c) || /[\t\r\n"]/.test(value)
            ? '"' + value.replaceAll('"', '""') + '"'
            : value,
        )
        .join('\t'),
    )
    .join('\n');
  let longest = 2;
  const tick = String.fromCharCode(96);
  for (const m of tsv.matchAll(new RegExp(tick + '+', 'g')))
    longest = Math.max(longest, m[0].length);
  const fence = tick.repeat(longest + 1);
  const metadata = Object.keys(formulas).length
    ? formulaPrefix + JSON.stringify(formulas) + '\n\n'
    : '';
  const body = metadata + source + fence + 'sheet-tsv\n' + tsv + '\n' + fence;
  return body.length <= 100000 ? body : null;
}

export function emptyProjectSheet(headers: string[]) {
  return storeSheet(
    '',
    [headers, ...Array.from({ length: 8 }, () => headers.map(() => ''))],
    new Set(),
    {},
  )!;
}

export function expandProjectSheet(
  sheet: ProjectSheet,
  dimension: 'row' | 'column',
  label: string,
) {
  const { table } = sheet,
    width = table.headers.length;
  const cells = [table.headers, ...table.rows].map((row) => [...row]);
  const text = new Set<number>();
  if (dimension === 'row') {
    if (cells.length >= 1000 || (cells.length + 1) * width > 40000) return null;
    cells.push(Array<string>(width).fill(''));
    table.textCells?.forEach((index) => text.add(index));
  } else {
    if (width >= 256 || cells.length * (width + 1) > 40000) return null;
    cells.forEach((row, r) => row.push(r ? '' : label));
    table.textCells?.forEach((index) =>
      text.add(Math.floor(index / width) * (width + 1) + (index % width)),
    );
  }
  return storeSheet(sheet.source, cells, text, { ...table.formulas });
}
