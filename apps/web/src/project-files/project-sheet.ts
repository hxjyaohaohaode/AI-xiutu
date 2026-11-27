import { delimited, type DataTable } from './content';

export type ProjectSheet = { source: string; filename: string; range: string; table: DataTable };

/** An imported provenance header or a standalone typed sheet is editable as a grid.
 * A prose document containing a Markdown table stays a document. */
export function readProjectSheet(body: string): ProjectSheet | null {
  if (!body.includes('sheet-tsv\n')) return null;
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
    (!row && !value.trim())
  )
    return null;
  const width = table.headers.length;
  const tsv = [table.headers, ...table.rows]
    .map((r, i) =>
      r
        .map((old, j) => {
          const cell = i === row && j === col ? value : old;
          const literal = !i || table.textCells?.has(i * width + j) || /[\t\n\r"]/.test(cell);
          return literal ? '"' + cell.replaceAll('"', '""') + '"' : cell;
        })
        .join('\t'),
    )
    .join('\n');
  let longest = 2;
  for (const m of tsv.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const fence = '`'.repeat(longest + 1);
  const body = sheet.source + fence + 'sheet-tsv\n' + tsv + '\n' + fence;
  return body.length <= 100000 ? body : null;
}
export function columnName(index: number) {
  let n = index + 1,
    text = '';
  while (n > 0) {
    const digit = (n - 1) % 26;
    text = String.fromCharCode(65 + digit) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}
