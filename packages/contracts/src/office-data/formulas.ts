import { numericCell, type DataTable } from './table.js';

export function columnName(index: number) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

export type CellError = {
  error: '#VALUE!' | '#REF!' | '#DIV/0!' | '#NUM!' | '#NAME?' | '#N/A' | '#CYCLE!' | '#LIMIT!';
};
export type CellValue = number | string | boolean | null | CellError;
type Value = CellValue | CellValue[];
type Expr =
  | { kind: 'value'; value: CellValue }
  | { kind: 'cell'; address: string }
  | { kind: 'range'; first: string; last: string }
  | { kind: 'unary'; op: string; input: Expr }
  | { kind: 'binary'; op: string; a: Expr; b: Expr }
  | { kind: 'call'; name: string; args: Expr[] };

const functions = new Set([
  'SUM',
  'AVERAGE',
  'COUNT',
  'COUNTA',
  'MIN',
  'MAX',
  'PRODUCT',
  'ABS',
  'ROUND',
  'ROUNDUP',
  'ROUNDDOWN',
  'SQRT',
  'POWER',
  'MOD',
  'IF',
  'IFERROR',
  'AND',
  'OR',
  'NOT',
  'CONCATENATE',
  'LEFT',
  'RIGHT',
  'LEN',
  'COUNTIF',
  'SUMIF',
  'INDEX',
  'MATCH',
  'VLOOKUP',
  // Statistics, rounding, text and information functions (Excel-compatible names).
  'MEDIAN',
  'STDEV',
  'VAR',
  'LARGE',
  'SMALL',
  'COUNTBLANK',
  'AVERAGEIF',
  'SUMPRODUCT',
  'INT',
  'TRUNC',
  'SIGN',
  'EXP',
  'LN',
  'LOG10',
  'PI',
  'UPPER',
  'LOWER',
  'TRIM',
  'MID',
  'ISNUMBER',
  'ISBLANK',
  'ISTEXT',
  'CHOOSE',
  'TEXTJOIN',
]);
/** Supported spreadsheet functions, for formula help and autocomplete. */
export const spreadsheetFunctions: readonly string[] = [...functions].sort();
const levels = [['=', '<>', '<', '<=', '>', '>='], ['&'], ['+', '-'], ['*', '/'], ['^']];
const tokenPattern =
  /\s*("(?:[^"]|"")*"|\d+(?:\.\d*)?(?:E[+-]?\d+)?|\.\d+(?:E[+-]?\d+)?|\$?[A-Z_][A-Z_0-9.]*\$?\d*|<=|>=|<>|[+\-*/^&%:(),=<>])/iy;
const cellPattern = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/;
const issue = (error: CellError['error']): CellError => ({ error });
const faulty = (value: Value): value is CellError =>
  !!value && typeof value === 'object' && !Array.isArray(value);

class FormulaSyntax extends Error {
  constructor(readonly error: CellError['error']) {
    super(error);
  }
}

function parse(source: string): Expr {
  if (!source.startsWith('=') || source.length > 1024) throw new FormulaSyntax('#LIMIT!');
  const text = source.slice(1).trim();
  const tokens: string[] = [];
  tokenPattern.lastIndex = 0;
  while (tokenPattern.lastIndex < text.length) {
    const token = tokenPattern.exec(text)?.[1];
    if (!token) throw new FormulaSyntax('#VALUE!');
    tokens.push(token[0] === '"' ? token : token.toUpperCase());
    if (tokens.length > 256) throw new FormulaSyntax('#LIMIT!');
  }
  let index = 0;
  const match = (token: string) => {
    if (tokens[index] !== token) return false;
    index++;
    return true;
  };
  const expect = (token: string) => {
    if (!match(token)) throw new FormulaSyntax('#VALUE!');
  };
  function atom(): Expr {
    if (match('(')) {
      const value = binary(0);
      expect(')');
      return value;
    }
    const value = tokens[index++];
    if (!value) throw new FormulaSyntax('#VALUE!');
    if (value.startsWith('"'))
      return { kind: 'value', value: value.slice(1, -1).replaceAll('""', '"') };
    if (/^[0-9.]/.test(value))
      return {
        kind: 'value',
        value: Number.isFinite(Number(value)) ? Number(value) : issue('#NUM!'),
      };
    if (value === 'TRUE' || value === 'FALSE') return { kind: 'value', value: value === 'TRUE' };
    if (match('(')) {
      if (!functions.has(value)) throw new FormulaSyntax('#NAME?');
      const args: Expr[] = [];
      if (!match(')')) {
        do args.push(binary(0));
        while (match(','));
        expect(')');
      }
      return { kind: 'call', name: value, args };
    }
    if (!cellPattern.test(value)) throw new FormulaSyntax('#NAME?');
    const address = value.replaceAll('$', '');
    if (!match(':')) return { kind: 'cell', address };
    const last = tokens[index++];
    if (!last || !cellPattern.test(last)) throw new FormulaSyntax('#REF!');
    return { kind: 'range', first: address, last: last.replaceAll('$', '') };
  }
  function unary(): Expr {
    const op = tokens[index];
    if (op !== '+' && op !== '-') return atom();
    index++;
    return { kind: 'unary', op, input: unary() };
  }
  function binary(level: number): Expr {
    if (level === levels.length) {
      let value = unary();
      while (match('%')) value = { kind: 'unary', op: '%', input: value };
      return value;
    }
    let a = binary(level + 1);
    while (levels[level]!.includes(tokens[index]!)) {
      const op = tokens[index++]!;
      a = { kind: 'binary', op, a, b: binary(level + 1) };
    }
    return a;
  }
  const expr = binary(0);
  if (index !== tokens.length) throw new FormulaSyntax('#VALUE!');
  return expr;
}

function coordinate(address: string): [number, number] | null {
  const match = cellPattern.exec(address);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]!) col = col * 26 + ch.charCodeAt(0) - 64;
  return [Number(match[2]) - 1, col - 1];
}

const scalar = (value: Value): CellValue => (Array.isArray(value) ? issue('#VALUE!') : value);
const display = (value: CellValue): string =>
  value === null
    ? ''
    : faulty(value)
      ? value.error
      : typeof value === 'boolean'
        ? value
          ? 'TRUE'
          : 'FALSE'
        : String(value);
const asNumber = (value: CellValue): number | CellError => {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return Number(value);
  return typeof value === 'string' ? (numericCell(value.trim())?.value ?? issue('#VALUE!')) : value;
};
const finalNumber = (n: number): CellValue =>
  Number.isFinite(n) ? Number(n.toPrecision(15)) : issue('#NUM!');
const truth = (value: CellValue) =>
  typeof value === 'string' ? value.toUpperCase() === 'TRUE' : Boolean(value);
function same(a: CellValue, b: CellValue) {
  return typeof a === 'string' && typeof b === 'string'
    ? a.toUpperCase() === b.toUpperCase()
    : a === b;
}
function compare(a: CellValue, b: CellValue, op: string) {
  const rank = (v: CellValue) => (typeof v === 'boolean' ? 2 : typeof v === 'string' ? 1 : 0);
  const left = a === null ? (typeof b === 'string' ? '' : 0) : a;
  const right = b === null ? (typeof a === 'string' ? '' : 0) : b;
  const order =
    rank(left) === rank(right)
      ? same(left, right)
        ? 0
        : (
              typeof left === 'string' && typeof right === 'string'
                ? left.toUpperCase() < right.toUpperCase()
                : Number(left) < Number(right)
            )
          ? -1
          : 1
      : rank(left) - rank(right);
  switch (op) {
    case '=':
      return order === 0;
    case '<>':
      return order !== 0;
    case '<':
      return order < 0;
    case '>':
      return order > 0;
    case '<=':
      return order <= 0;
    default:
      return order >= 0;
  }
}

export type CalculatedCell = { formula: string; supported: boolean; value: CellValue };

export function calculateSheet(table: DataTable): ReadonlyMap<string, CalculatedCell> {
  const cells = [table.headers, ...table.rows],
    width = table.headers.length;
  const result = new Map<string, CalculatedCell>();
  const active = new Set<string>();
  let work = 100_000;
  let depth = 0;
  function spend(n = 1) {
    work -= n;
    if (work < 0) throw new FormulaSyntax('#LIMIT!');
  }
  function read(address: string): CellValue {
    spend();
    const pos = coordinate(address);
    if (!pos || pos[0] >= cells.length || pos[1] >= width) return issue('#REF!');
    const formula = table.formulas?.[address];
    if (!formula) {
      const value = cells[pos[0]]![pos[1]]!;
      if (value === '') return null;
      return !pos[0] || table.textCells?.has(pos[0] * width + pos[1])
        ? value
        : (numericCell(value)?.value ?? value);
    }
    const previous = result.get(address);
    if (previous) return previous.value;
    if (active.has(address)) return issue('#CYCLE!');
    if (active.size >= 128) return issue('#LIMIT!');
    active.add(address);
    let supported = false,
      value: CellValue;
    try {
      const expr = parse(formula);
      supported = true;
      value = scalar(evaluate(expr));
    } catch (cause) {
      if (!(cause instanceof FormulaSyntax)) throw cause;
      value = issue(cause.error);
    } finally {
      active.delete(address);
    }
    result.set(address, { formula, supported, value });
    return value;
  }
  function range(first: string, last: string): Value {
    const [r1, c1] = coordinate(first)!,
      [r2, c2] = coordinate(last)!;
    if (Math.max(r1, r2) >= cells.length || Math.max(c1, c2) >= width) return issue('#REF!');
    const count = (Math.abs(r1 - r2) + 1) * (Math.abs(c1 - c2) + 1);
    spend(count);
    const values: CellValue[] = [];
    for (let row = Math.min(r1, r2); row <= Math.max(r1, r2); row++)
      for (let col = Math.min(c1, c2); col <= Math.max(c1, c2); col++)
        values.push(read(columnName(col) + (row + 1)));
    return values;
  }
  function evaluate(expr: Expr): Value {
    if (depth >= 256) return issue('#LIMIT!');
    depth++;
    try {
      return evaluateNode(expr);
    } finally {
      depth--;
    }
  }
  function evaluateNode(expr: Expr): Value {
    spend();
    if (expr.kind === 'value') return expr.value;
    if (expr.kind === 'cell') return read(expr.address);
    if (expr.kind === 'range') return range(expr.first, expr.last);
    if (expr.kind === 'call') return call(expr.name, expr.args);
    if (expr.kind === 'unary') {
      const n = asNumber(scalar(evaluate(expr.input)));
      return faulty(n) ? n : finalNumber(expr.op === '%' ? n / 100 : expr.op === '-' ? -n : n);
    }
    const a = scalar(evaluate(expr.a)),
      b = scalar(evaluate(expr.b));
    if (faulty(a)) return a;
    if (faulty(b)) return b;
    if (levels[0]!.includes(expr.op)) return compare(a, b, expr.op);
    if (expr.op === '&') return boundedText(display(a) + display(b));
    const x = asNumber(a),
      y = asNumber(b);
    if (faulty(x)) return x;
    if (faulty(y)) return y;
    if (expr.op === '/' && y === 0) return issue('#DIV/0!');
    return finalNumber(
      expr.op === '+'
        ? x + y
        : expr.op === '-'
          ? x - y
          : expr.op === '*'
            ? x * y
            : expr.op === '/'
              ? x / y
              : x ** y,
    );
  }
  function boundedText(s: string): CellValue {
    spend(Math.ceil(s.length / 16));
    return s.length > 32767 ? issue('#LIMIT!') : s;
  }
  function call(name: string, args: Expr[]): Value {
    if (name === 'IF' || name === 'IFERROR') {
      if (args.length < 2 || args.length > (name === 'IF' ? 3 : 2)) return issue('#VALUE!');
      const a = scalar(evaluate(args[0]!));
      if (name === 'IFERROR') return faulty(a) && a.error !== '#CYCLE!' ? evaluate(args[1]!) : a;
      if (faulty(a)) return a;
      return truth(a) ? evaluate(args[1]!) : args[2] ? evaluate(args[2]) : false;
    }
    if (name === 'CHOOSE') {
      if (args.length < 2) return issue('#VALUE!');
      const pick = asNumber(scalar(evaluate(args[0]!)));
      if (faulty(pick)) return pick;
      const index = Math.trunc(pick);
      return index >= 1 && index < args.length ? evaluate(args[index]!) : issue('#VALUE!');
    }
    if (name === 'ISNUMBER' || name === 'ISBLANK' || name === 'ISTEXT') {
      if (args.length !== 1) return issue('#VALUE!');
      const v = scalar(evaluate(args[0]!));
      return name === 'ISNUMBER' ? typeof v === 'number' : name === 'ISBLANK' ? v === null : typeof v === 'string';
    }
    if (name === 'PI') return args.length ? issue('#VALUE!') : Math.PI;
    if (name === 'COUNTBLANK') {
      if (args.length !== 1) return issue('#VALUE!');
      const v = evaluate(args[0]!);
      return (Array.isArray(v) ? v : [v]).filter((item) => item === null || item === '').length;
    }
    const values = args.map(evaluate);
    const all = values.flat();
    const error = all.find(faulty);
    if (error) return error;
    const nums = all.filter((v): v is number => typeof v === 'number');
    const one = scalar(values[0] ?? null),
      two = scalar(values[1] ?? null);
    const list = (v: Value = null) => (Array.isArray(v) ? v : [v]);
    const sum = (numbers: number[]) => numbers.reduce((s, n) => s + n, 0);
    switch (name) {
      case 'SUM':
        return finalNumber(sum(nums));
      case 'COUNT':
        return nums.length;
      case 'COUNTA':
        return all.filter((v) => v !== null).length;
      case 'AVERAGE':
        return nums.length ? finalNumber(sum(nums) / nums.length) : issue('#DIV/0!');
      case 'MIN':
        return nums.length ? Math.min(...nums) : 0;
      case 'MAX':
        return nums.length ? Math.max(...nums) : 0;
      case 'PRODUCT':
        return nums.length ? finalNumber(nums.reduce((p, n) => p * n, 1)) : 0;
      case 'AND':
        return all.length > 0 && all.every(truth);
      case 'OR':
        return all.some(truth);
      case 'NOT':
        return values.length === 1 ? !truth(one) : issue('#VALUE!');
      case 'CONCATENATE':
        return boundedText(all.map(display).join(''));
      case 'LEN':
        return values.length === 1 ? display(one).length : issue('#VALUE!');
      case 'COUNTIF':
      case 'SUMIF': {
        if (values.length < 2 || values.length > (name === 'COUNTIF' ? 2 : 3))
          return issue('#VALUE!');
        const data = list(values[0]),
          amounts = list(values[2] ?? values[0]);
        if (data.length !== amounts.length || faulty(two)) return issue('#VALUE!');
        const terms = typeof two === 'string' ? /^(<=|>=|<>|[<>=])(.*)$/.exec(two) : null;
        const needle = terms ? (numericCell(terms[2]!)?.value ?? terms[2]!) : two;
        let total = 0;
        data.forEach((v, i) => {
          if (compare(v, needle, terms?.[1] ?? '=')) {
            const amount = amounts[i];
            total += name === 'COUNTIF' ? 1 : typeof amount === 'number' ? amount : 0;
          }
        });
        return finalNumber(total);
      }
      case 'MEDIAN': {
        if (!nums.length) return issue('#NUM!');
        const sorted = [...nums].sort((a, b) => a - b),
          mid = sorted.length >> 1;
        return finalNumber(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
      }
      case 'STDEV':
      case 'VAR': {
        // Sample statistics, as Excel's STDEV/VAR.
        if (nums.length < 2) return issue('#DIV/0!');
        const mean = sum(nums) / nums.length;
        const variance = sum(nums.map((n) => (n - mean) ** 2)) / (nums.length - 1);
        return finalNumber(name === 'VAR' ? variance : Math.sqrt(variance));
      }
      case 'LARGE':
      case 'SMALL': {
        if (values.length !== 2 || typeof two !== 'number') return issue('#VALUE!');
        const data = list(values[0]).filter((v): v is number => typeof v === 'number');
        const k = Math.trunc(two);
        if (k < 1 || k > data.length) return issue('#NUM!');
        const sorted = data.sort((a, b) => (name === 'LARGE' ? b - a : a - b));
        return sorted[k - 1]!;
      }
      case 'AVERAGEIF': {
        if (values.length < 2 || values.length > 3) return issue('#VALUE!');
        const data = list(values[0]),
          amounts = list(values[2] ?? values[0]);
        if (data.length !== amounts.length || faulty(two)) return issue('#VALUE!');
        const terms = typeof two === 'string' ? /^(<=|>=|<>|[<>=])(.*)$/.exec(two) : null;
        const needle = terms ? (numericCell(terms[2]!)?.value ?? terms[2]!) : two;
        let total = 0,
          count = 0;
        data.forEach((v, i) => {
          const amount = amounts[i];
          if (compare(v, needle, terms?.[1] ?? '=') && typeof amount === 'number') {
            total += amount;
            count++;
          }
        });
        return count ? finalNumber(total / count) : issue('#DIV/0!');
      }
      case 'SUMPRODUCT': {
        const arrays = values.map(list);
        if (!arrays.length || arrays.some((a) => a.length !== arrays[0]!.length)) return issue('#VALUE!');
        let total = 0;
        for (let i = 0; i < arrays[0]!.length; i++)
          total += arrays.reduce((p, a) => p * (typeof a[i] === 'number' ? (a[i] as number) : 0), 1);
        return finalNumber(total);
      }
      case 'UPPER':
      case 'LOWER':
      case 'TRIM':
        if (values.length !== 1) return issue('#VALUE!');
        return name === 'UPPER'
          ? display(one).toUpperCase()
          : name === 'LOWER'
            ? display(one).toLowerCase()
            : display(one).trim().replace(/ {2,}/g, ' ');
      case 'MID': {
        const start = asNumber(two),
          length = asNumber(scalar(values[2] ?? null));
        if (values.length !== 3 || faulty(start) || faulty(length) || start < 1 || length < 0) return issue('#VALUE!');
        return Array.from(display(one)).slice(Math.trunc(start) - 1, Math.trunc(start) - 1 + Math.trunc(length)).join('');
      }
      case 'TEXTJOIN': {
        if (values.length < 3) return issue('#VALUE!');
        const skip = truth(two);
        const parts = values.slice(2).flatMap(list).filter((v) => !(skip && (v === null || v === '')));
        return boundedText(parts.map(display).join(display(one)));
      }
      case 'MATCH': {
        if (values.length !== 3 || values[2] !== 0) return issue('#VALUE!');
        const i = list(values[1]).findIndex((v) => same(one, v));
        return i < 0 ? issue('#N/A') : i + 1;
      }
      case 'INDEX':
      case 'VLOOKUP': {
        const shape = args[name === 'INDEX' ? 0 : 1];
        const items = list(values[name === 'INDEX' ? 0 : 1]);
        if (!shape || shape.kind !== 'range') return issue('#VALUE!');
        const [r1, c1] = coordinate(shape.first)!,
          [r2, c2] = coordinate(shape.last)!;
        const cols = Math.abs(c1 - c2) + 1,
          rows = Math.abs(r1 - r2) + 1;
        if (name === 'INDEX' && (values.length < 2 || values.length > 3)) return issue('#VALUE!');
        if (name === 'VLOOKUP' && (values.length !== 4 || (values[3] !== false && values[3] !== 0)))
          return issue('#VALUE!');
        const col = values[2] ?? 1;
        if (typeof col !== 'number' || !Number.isInteger(col) || col < 1 || col > cols)
          return issue('#REF!');
        if (name === 'INDEX')
          return typeof two === 'number' && Number.isInteger(two) && two >= 1 && two <= rows
            ? items[(two - 1) * cols + col - 1]!
            : issue('#REF!');
        for (let i = 0; i < rows; i++)
          if (same(items[i * cols]!, one)) return items[i * cols + col - 1]!;
        return issue('#N/A');
      }
    }
    const x = asNumber(one),
      y = asNumber(two);
    if (name === 'LEFT' || name === 'RIGHT') {
      const length = values.length === 1 ? 1 : y;
      if (values.length < 1 || values.length > 2 || faulty(length) || length < 0)
        return issue('#VALUE!');
      return name === 'LEFT'
        ? display(one).slice(0, Math.trunc(length))
        : length < 1
          ? ''
          : display(one).slice(-Math.trunc(length));
    }
    if (faulty(x)) return x;
    if (faulty(y)) return y;
    if (name === 'ABS' || name === 'SQRT')
      return values.length === 1
        ? finalNumber(name === 'ABS' ? Math.abs(x) : Math.sqrt(x))
        : issue('#VALUE!');
    if (name === 'INT' || name === 'SIGN' || name === 'EXP' || name === 'LN' || name === 'LOG10') {
      if (values.length !== 1) return issue('#VALUE!');
      if ((name === 'LN' || name === 'LOG10') && x <= 0) return issue('#NUM!');
      return finalNumber(
        name === 'INT' ? Math.floor(x) : name === 'SIGN' ? Math.sign(x) : name === 'EXP' ? Math.exp(x) : name === 'LN' ? Math.log(x) : Math.log10(x),
      );
    }
    if (name === 'TRUNC') {
      if (values.length < 1 || values.length > 2) return issue('#VALUE!');
      const digits = values.length === 2 ? Math.trunc(y) : 0;
      const scale = 10 ** digits;
      return finalNumber(Math.trunc(x * scale) / scale);
    }
    if (values.length !== 2) return issue('#VALUE!');
    if (name === 'POWER') return finalNumber(x ** y);
    if (name === 'MOD') return y === 0 ? issue('#DIV/0!') : finalNumber(x - y * Math.floor(x / y));
    const scale = 10 ** Math.trunc(y),
      magnitude = Math.abs(x) * scale;
    if (!scale || !Number.isFinite(magnitude)) return issue('#NUM!');
    const rounded =
      name === 'ROUNDUP'
        ? Math.ceil(magnitude)
        : name === 'ROUNDDOWN'
          ? Math.floor(magnitude)
          : Math.floor(magnitude + 0.5 + Math.abs(magnitude) * Number.EPSILON);
    return finalNumber((Math.sign(x) * rounded) / scale);
  }
  for (const [address, formula] of Object.entries(table.formulas ?? {})) {
    try {
      read(address);
    } catch (cause) {
      if (!(cause instanceof FormulaSyntax)) throw cause;
      result.set(address, { formula, supported: false, value: issue(cause.error) });
    }
  }
  return result;
}

export function calculatedCellText(value: CellValue) {
  return display(value);
}

export function calculatedTable(table: DataTable, results = calculateSheet(table)): DataTable {
  if (!results.size) return table;
  const width = table.headers.length;
  const textCells = new Set(table.textCells);
  return {
    ...table,
    textCells,
    rows: table.rows.map((row, i) =>
      row.map((text, j) => {
        const result = results.get(columnName(j) + (i + 2));
        if (!result) return text;
        if (typeof result.value === 'number') textCells.delete((i + 1) * width + j);
        else textCells.add((i + 1) * width + j);
        return display(result.value);
      }),
    ),
  };
}
