export type DataTable = {
  kind: 'table';
  line: number;
  headers: string[];
  rows: string[][];
  textCells?: Set<number>;
  formulas?: Readonly<Record<string, string>>;
};

// Accept rectangular CSV/TSV with a header, including quoted delimiters and newlines.
export function delimited(
  text: string,
  delimiter: string,
  textCells?: Set<number>,
): string[][] | null {
  const rows: string[][] = [];
  let ordinal = 0;
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === undefined) return null;
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === delimiter) {
      row.push(field);
      if (closed) textCells?.add(ordinal);
      ordinal++;
      field = '';
      closed = false;
    } else if (char === '\n' || char === undefined) {
      row.push(field);
      if (closed) textCells?.add(ordinal);
      ordinal++;
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
      closed = false;
    } else if (closed) return null;
    else if (char === '"' && field === '') quoted = true;
    else if (char === '"') return null;
    else field += char;
  }
  const headers = rows[0];
  const width = headers?.length ?? 0;
  return rows.length >= 2 &&
    width >= 2 &&
    width <= 256 &&
    headers?.every((header) => header.trim()) &&
    rows.every((values) => values.length === width)
    ? rows
    : null;
}

export function numericCell(source: string): { value: number; percent: boolean } | null {
  // Excel has 15 significant decimal digits. Preserve identifiers and higher precision as text.
  const text = source;
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?%?$/.test(text)) return null;
  const digits = text.replace(/[-.%]/g, '').replace(/^0+/, '');
  if (digits.length > 15) return null;
  const percent = text.endsWith('%');
  const value = Number(percent ? text.slice(0, -1) : text) / (percent ? 100 : 1);
  return Number.isFinite(value) && (value !== 0 || !digits) ? { value, percent } : null;
}

export function usedChartTable(table: DataTable): DataTable {
  let count = table.rows.length;
  while (count > 0 && table.rows[count - 1]!.every((value) => !value.trim())) count--;
  if (count === table.rows.length) return table;
  const end = (count + 1) * table.headers.length;
  return {
    ...table,
    rows: table.rows.slice(0, count),
    textCells: table.textCells && new Set([...table.textCells].filter((index) => index < end)),
  };
}

export function chartSeries(table: DataTable) {
  // Each value series gets its own axis so counts and percentages are never mixed.
  if (!table.rows.length) return [];
  return table.headers.slice(1).flatMap((name, index) => {
    const column = index + 1;
    const numbers = table.rows.map((row, r) =>
      table.textCells?.has((r + 1) * table.headers.length + column)
        ? null
        : numericCell(row[column] ?? ''),
    );
    const percent = numbers.find((item) => item !== null)?.percent;
    if (percent === undefined || numbers.some((item) => !item || item.percent !== percent))
      return [];
    return [{ name, column, percent, values: numbers.map((item) => item!.value) }];
  });
}

export function xml(value: string) {
  return value
    .replace(/[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
