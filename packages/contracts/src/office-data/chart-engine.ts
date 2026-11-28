import type { DocumentLayout } from '../document-format.js';
import type { OfficeChartOptions } from '../office-content.js';
import { advancedChartBody, type AdvancedChart } from './advanced-chart.js';
import { barChart, comboChart, lineChart } from './chart-basic.js';
import { chartThemeStyles, short, withChartState } from './chart-common.js';
import { numericCell, xml, type DataTable } from './table.js';

export type ChartKind = DocumentLayout['chart'];
export const CHART_WIDTH = 960;
export const CHART_HEIGHT = 540;
const NATIVE_TOP = 80,
  NATIVE_HEIGHT = 390;
const FONT = "'Inter','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',system-ui,sans-serif";

/** Kinds whose value columns are series (legend toggles columns). */
const seriesKinds = new Set<ChartKind>(['bar', 'line', 'area', 'stream', 'radar', 'bar3d', 'combo']);
/** Kinds whose rows are the parts (legend toggles rows). Donut handles its own list. */
const rowKinds = new Set<ChartKind>(['treemap', 'funnel']);
const sortableKinds = new Set<ChartKind>(['bar', 'donut', 'treemap', 'combo']);

/** Which options each kind honours, so the designer only shows meaningful controls. */
export const chartCapabilities: Record<
  ChartKind,
  { layout?: boolean; orientation?: boolean; smooth?: boolean; labels?: boolean; axes?: boolean; hole?: boolean; sort?: boolean }
> = {
  bar: { layout: true, orientation: true, labels: true, axes: true, sort: true },
  line: { smooth: true, labels: true, axes: true },
  combo: { smooth: true, labels: true, axes: true, sort: true },
  area: { layout: true, smooth: true, labels: true },
  stream: {},
  sankey: {},
  radar: {},
  scatter3d: {},
  donut: { hole: true, sort: true },
  heatmap: {},
  treemap: { sort: true },
  funnel: {},
  waterfall: {},
  bar3d: {},
};

/** Data shape each kind needs, shown before the user chooses data or when it fails. */
export const chartDataHints: Record<ChartKind, string> = {
  bar: '首列为分类，其后 1–8 列数值（同一单位）。',
  line: '首列为分类或时间，其后 1–8 列数值。',
  combo: '首列为分类，第 2 列画成柱，其余列画成折线；单位不同时自动启用右轴。',
  area: '首列为时间，其后 1–8 列非负数值，至少 3 行。',
  stream: '首列为时间，其后 1–8 列非负数值，至少 3 行。',
  sankey: '三列：来源、去向、正数流量。',
  radar: '首列为维度（3–16 个），其后 1–8 列非负数值。',
  scatter3d: '四列：名称、X、Y、Z。',
  donut: '两列：名称、正数，2–12 行。',
  heatmap: '首列为行名称，其后 2–16 列数值。',
  treemap: '两列：名称、正数，最多 40 行。',
  funnel: '两列：阶段、正数，按顺序最多 10 步。',
  waterfall: '两列：项目、带正负号的变化值。',
  bar3d: '首列为分类（≤12），其后 1–6 列非负数值。',
};

function retable(table: DataTable, rows: number[], columns: number[]): DataTable {
  const width = columns.length;
  const textCells = new Set<number>();
  if (table.textCells)
    [-1, ...rows].forEach((r, ri) =>
      columns.forEach((c, ci) => {
        if (table.textCells!.has((r + 1) * table.headers.length + c)) textCells.add(ri * width + ci);
      }),
    );
  return {
    ...table,
    headers: columns.map((c) => table.headers[c]!),
    rows: rows.map((r) => columns.map((c) => table.rows[r]![c]!)),
    textCells,
  };
}

export interface ChartSpec {
  title: string;
  kind: ChartKind;
  table: DataTable;
  options?: OfficeChartOptions;
}

export function renderChart({ title, kind, table, options = {} }: ChartSpec) {
  const theme = chartThemeStyles[options.theme ?? 'studio'];
  const hidden = new Set(options.hidden ?? []);
  let rows = table.rows.map((_, i) => i);
  let columns = table.headers.map((_, i) => i);
  let seriesMap: number[] | null = null;
  if (seriesKinds.has(kind) && hidden.size) {
    const values = columns.slice(1).filter((c) => !hidden.has(c - 1) || (kind === 'combo' && c === 1));
    const minimum = kind === 'combo' ? 2 : 1;
    if (values.length >= minimum) {
      columns = [0, ...values];
      seriesMap = values.map((c) => c - 1);
    }
  }
  if (rowKinds.has(kind) && hidden.size) {
    const visible = rows.filter((r) => !hidden.has(r));
    if (visible.length >= 2) {
      rows = visible;
      seriesMap = visible;
    }
  }
  if (sortableKinds.has(kind) && options.sort && options.sort !== 'none') {
    const key = (r: number) => numericCell(table.rows[r]![1] ?? '')?.value ?? 0;
    rows = [...rows].sort((a, b) => (options.sort === 'asc' ? key(a) - key(b) : key(b) - key(a)));
    if (rowKinds.has(kind) && seriesMap) seriesMap = rows;
    else if (rowKinds.has(kind)) seriesMap = rows;
  }
  const prepared = retable(table, rows, columns);
  const palette = (seriesMap ?? (kind === 'donut' ? rows : columns.slice(1).map((c) => c - 1))).map(
    (i) => theme.colors[i % theme.colors.length]!,
  );
  // The donut renderer sees rows in display order; translate hidden rows to that order.
  const drawOptions =
    kind === 'donut' && hidden.size
      ? { ...options, hidden: rows.flatMap((r, i) => (hidden.has(r) ? [i] : [])) }
      : options;
  // Category charts narrow their plot for a right legend; the others are scaled into place.
  const flexible = kind === 'bar' || kind === 'line' || kind === 'combo' || kind === 'area';
  const rightLegend = options.legend === 'right';
  const { value: body, legend } = withChartState(
    {
      theme,
      palette,
      options: drawOptions,
      seriesMap: kind === 'donut' ? rows : seriesMap,
      plotRight: flexible && rightLegend ? 700 : 890,
    },
    () =>
      kind === 'bar'
        ? barChart(prepared)
        : kind === 'line'
          ? lineChart(prepared)
          : kind === 'combo'
            ? comboChart(prepared)
            : advancedChartBody(prepared, kind as AdvancedChart),
  );
  // Legend lists every series (hidden ones dimmed) so a hidden series can be restored.
  let entries = legend;
  if (seriesKinds.has(kind) && legend.length && hidden.size) {
    const names = table.headers.slice(1);
    entries = names.map((name, i) => {
      const shown = legend.find((item) => item.series === i);
      return shown ?? { name, color: theme.colors[i % theme.colors.length]!, series: i, hidden: true, shape: legend[0]!.shape };
    });
  }
  if (rowKinds.has(kind) && (hidden.size || (options.legend && options.legend !== 'none')))
    entries = table.rows.map((row, i) => ({
      name: row[0] ?? '',
      color: theme.colors[i % theme.colors.length]!,
      series: i,
      hidden: hidden.has(i),
      shape: 'dot' as const,
    }));
  const position = entries.length ? (options.legend ?? 'top') : 'none';

  // Header
  const subtitle = options.subtitle?.trim();
  const header =
    `<text x="36" y="46" font-size="26" font-weight="700" letter-spacing="-0.2"><title>${xml(title)}</title>${xml(short(title, 40))}</text>` +
    (subtitle ? `<text x="36" y="72" font-size="15" class="muted">${xml(short(subtitle, 90))}</text>` : '');
  const headerBottom = subtitle ? 90 : 66;

  // Legend layout
  const width = (name: string) =>
    Array.from(short(name, 16)).reduce((w, c) => w + (/[⺀-鿿豈-﫿＀-￯]/.test(c) ? 13.5 : 7.6), 0);
  type Placed = (typeof entries)[number] & { x: number; y: number };
  const placed: Placed[] = [];
  let legendRows = 0;
  if (position === 'top' || position === 'bottom') {
    let x = 36,
      row = 0;
    for (const item of entries) {
      const w = 24 + width(item.name) + 22;
      if (x + w > 924 && x > 36) {
        row++;
        x = 36;
      }
      placed.push({ ...item, x, y: row });
      x += w;
    }
    legendRows = row + 1;
    const base = position === 'top' ? headerBottom + 18 : CHART_HEIGHT - 16 - (legendRows - 1) * 24;
    placed.forEach((item) => (item.y = base + item.y * 24));
  } else if (position === 'right') {
    entries.slice(0, 16).forEach((item, i) => placed.push({ ...item, x: 772, y: headerBottom + 34 + i * 26 }));
  }
  const swatch = (item: Placed) =>
    item.shape === 'line'
      ? `<line x1="${item.x}" x2="${item.x + 16}" y1="${item.y - 4}" y2="${item.y - 4}" stroke="${item.color}" stroke-width="3" stroke-linecap="round"/><circle cx="${item.x + 8}" cy="${item.y - 4}" r="3.2" fill="${item.color}"/>`
      : item.shape === 'bar'
        ? `<rect x="${item.x + 1}" y="${item.y - 10}" width="14" height="12" rx="3" fill="${item.color}"/>`
        : `<circle cx="${item.x + 7}" cy="${item.y - 4}" r="5.5" fill="${item.color}"/>`;
  const legendSvg = placed
    .map(
      (item) =>
        `<g data-legend="${item.series}" class="legend-item"${item.hidden ? ' data-hidden="true" opacity=".38"' : ''}>${swatch(item)}<text x="${item.x + 24}" y="${item.y}" font-size="13.5"${item.hidden ? ' text-decoration="line-through"' : ''}><title>${xml(item.name)}</title>${xml(short(item.name, 16))}</text></g>`,
    )
    .join('');

  // Plot placement: map the native region into what remains.
  const top = headerBottom + (position === 'top' ? legendRows * 24 + 10 : 6);
  const bottom = CHART_HEIGHT - 8 - (position === 'bottom' ? legendRows * 24 + 10 : 0);
  const right = position === 'right' ? 756 : CHART_WIDTH;
  const nativeWidth = flexible && position === 'right' ? right : CHART_WIDTH;
  const scale = Math.min(right / nativeWidth, (bottom - top) / NATIVE_HEIGHT, 1);
  const dx = (right - nativeWidth * scale) / 2,
    dy = top - NATIVE_TOP * scale;
  const style =
    `<style>.grid{stroke:${theme.grid}}.axis{stroke:${theme.axis}}.muted{fill:${theme.muted}}` +
    `.on{fill:${theme.onMark}}.sep{stroke:${theme.background ?? '#FFFFFF'}}text{font-family:${FONT}}</style>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" data-chart-kind="${kind}">` +
    `<title>${xml(title)}</title>${style}` +
    (theme.background ? `<rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="${theme.background}"/>` : '') +
    `<g fill="${theme.ink}" font-size="14" font-family="${FONT.replaceAll("'", '')}">${header}${legendSvg}` +
    `<g class="plot" transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale.toFixed(4)})">${body}</g></g></svg>`
  );
}
