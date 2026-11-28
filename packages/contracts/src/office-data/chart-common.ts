import type { OfficeChartOptions } from '../office-content.js';
import { numericCell, xml, type DataTable } from './table.js';

/**
 * Shared chart style state. Rendering is synchronous, so a render installs its
 * theme, palette and options here, draws, and restores the previous state.
 * Renderers draw in a fixed native space (x 0–960, y 80–460); the frame in
 * chart-engine.ts maps that region into the space left by title and legend.
 */
export interface ChartTheme {
  colors: readonly string[];
  ink: string;
  muted: string;
  grid: string;
  axis: string;
  background: string | null;
  onMark: string;
}

export const chartThemeStyles: Record<NonNullable<OfficeChartOptions['theme']>, ChartTheme> = {
  // The original studio palette, kept as the default for existing charts.
  studio: {
    colors: ['#237973', '#447BC2', '#BA684A', '#6C63A8', '#9E7584', '#607747', '#A37721', '#437E95'],
    ink: '#203735',
    muted: '#5B6F6C',
    grid: '#DCE5E3',
    axis: '#8FA3A0',
    background: '#FFFFFF',
    onMark: '#FFFFFF',
  },
  ocean: {
    colors: ['#1D4E89', '#2F80C0', '#00A6A6', '#5FC2BA', '#7A8CC6', '#3D5A80', '#98C1D9', '#2B6F77'],
    ink: '#14213D',
    muted: '#56627A',
    grid: '#DFE6EF',
    axis: '#93A1B5',
    background: '#FFFFFF',
    onMark: '#FFFFFF',
  },
  sunset: {
    colors: ['#C2410C', '#E07A3F', '#D9A13B', '#B5476B', '#8F3B76', '#E35D6A', '#9C6644', '#5B5F97'],
    ink: '#3B1F17',
    muted: '#7A5A50',
    grid: '#F0E2DA',
    axis: '#C2A79B',
    background: '#FFFCFA',
    onMark: '#FFFFFF',
  },
  forest: {
    colors: ['#2D6A4F', '#52A06F', '#95B46A', '#B08D57', '#6B8F71', '#40798C', '#C9A227', '#7F5539'],
    ink: '#1F2D24',
    muted: '#56665B',
    grid: '#DFE8E0',
    axis: '#97A89B',
    background: '#FFFFFF',
    onMark: '#FFFFFF',
  },
  mono: {
    colors: ['#1F2937', '#4B5563', '#6B7280', '#9CA3AF', '#374151', '#111827', '#D1D5DB', '#525252'],
    ink: '#111827',
    muted: '#6B7280',
    grid: '#E5E7EB',
    axis: '#9CA3AF',
    background: '#FFFFFF',
    onMark: '#FFFFFF',
  },
  midnight: {
    colors: ['#5EEAD4', '#93C5FD', '#FDBA74', '#C4B5FD', '#F9A8D4', '#BEF264', '#FCD34D', '#67E8F9'],
    ink: '#E5E7EB',
    muted: '#9CA3AF',
    grid: '#2B3542',
    axis: '#4B5563',
    background: '#111827',
    onMark: '#0B1220',
  },
};

interface State {
  theme: ChartTheme;
  palette: readonly string[];
  options: OfficeChartOptions;
  /** Original series/row index of each rendered series after hiding (legend identity). */
  seriesMap: readonly number[] | null;
  /** Right edge of the plot in native space (narrower when the legend sits on the right). */
  plotRight?: number;
  legend: { name: string; color: string; series: number; hidden: boolean; shape: 'dot' | 'bar' | 'line' }[];
}
let state: State = {
  theme: chartThemeStyles.studio,
  palette: chartThemeStyles.studio.colors,
  options: {},
  seriesMap: null,
  legend: [],
};

export function withChartState<T>(next: Omit<State, 'legend'>, draw: () => T): { value: T; legend: State['legend'] } {
  const previous = state;
  state = { ...next, legend: [] };
  try {
    const value = draw();
    return { value, legend: state.legend };
  } finally {
    state = previous;
  }
}

export const chartTheme = () => state.theme;
export const plotRight = () => state.plotRight ?? 890;
export const chartOptions = () => state.options;
export const paint = (i: number) => state.palette[i % state.palette.length]!;
/** data-series attribute for interactive focus/toggle, using the original index. */
export const seriesAttr = (i: number) => ` data-series="${state.seriesMap?.[i] ?? i}"`;
/** Marks a renderer-owned legend row (e.g. the donut list) as a toggle for series i. */
export const legendAttr = (i: number) => ` data-legend="${state.seriesMap?.[i] ?? i}"`;

export const short = (s: string, max = 18) =>
  Array.from(s).length <= max
    ? s
    : Array.from(s)
        .slice(0, max - 1)
        .join('') + '…';
export const numberText = (n: number) => String(Number(n.toPrecision(8)));
export const point = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
export const label = (x: number, y: number, s: string, anchor = 'start', extra = '') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}"${extra}><title>${xml(s)}</title>${xml(short(s))}</text>`;

/** Display formatting with the user's decimals and digit grouping; percent keeps its unit. */
export function unitText(value: number, percent: boolean) {
  const decimals = state.options.decimals;
  const shown = value * (percent ? 100 : 1);
  const text =
    decimals === undefined
      ? Math.abs(shown) >= 10000
        ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(shown)
        : numberText(shown)
      : new Intl.NumberFormat('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(shown);
  return text + (percent ? '%' : '');
}

export function niceTicks(min: number, max: number, count = 5) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => m >= raw)!;
  const ticks: number[] = [];
  const last = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.floor(min / step + 1e-9) * step; v <= last + step * 1e-9; v += step)
    ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

export function numeric(table: DataTable, row: number, col: number) {
  const cell = table.rows[row]?.[col];
  const value =
    !table.textCells?.has((row + 1) * table.headers.length + col) && cell != null
      ? numericCell(cell)
      : null;
  if (!value) throw new Error(`第 ${row + 2} 行「${table.headers[col] ?? col + 1}」需要数值。`);
  return value;
}

/** Records legend entries for the frame; renderers keep their native coordinates. */
export function legend(names: string[], shapes?: ('dot' | 'bar' | 'line')[]) {
  names.forEach((name, i) =>
    state.legend.push({
      name,
      color: paint(i),
      series: state.seriesMap?.[i] ?? i,
      hidden: false,
      shape: shapes?.[i] ?? 'dot',
    }),
  );
  return '';
}

/** Horizontal gridlines and value labels for a vertical value axis. */
export function yAxis(
  min: number,
  max: number,
  top: number,
  bottom: number,
  percent: boolean,
  options: { left?: number; right?: number; side?: 'left' | 'right'; lines?: boolean } = {},
) {
  const left = options.left ?? 70,
    right = options.right ?? plotRight();
  const ticks = niceTicks(min, max);
  const lo = Math.min(min, ticks[0]!),
    hi = Math.max(max, ticks.at(-1)!);
  const y = (v: number) => bottom - ((bottom - top) * (v - lo)) / (hi - lo || 1);
  const showGrid = state.options.grid !== false && options.lines !== false;
  const grid = ticks
    .map(
      (t) =>
        (showGrid
          ? `<line x1="${left}" x2="${right}" y1="${y(t)}" y2="${y(t)}" class="grid"${t === 0 ? '' : ' stroke-dasharray="3 4"'}/>`
          : '') +
        (options.side === 'right'
          ? label(right + 8, y(t) + 4, unitText(t, percent), 'start', ' class="muted" font-size="12.5"')
          : label(left - 8, y(t) + 4, unitText(t, percent), 'end', ' class="muted" font-size="12.5"')),
    )
    .join('');
  return { y, grid, lo, hi };
}

export const svgAttr = (value: string) => xml(value);
