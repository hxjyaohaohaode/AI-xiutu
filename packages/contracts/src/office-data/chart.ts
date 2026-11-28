import type { DocumentLayout } from '../document-format.js';
import type { OfficeChartSnapshot } from '../office-content.js';
import { chartSeries, usedChartTable, xml, type DataTable } from './table.js';
import { advancedChart } from './advanced-chart.js';

export const chartNames: Record<DocumentLayout['chart'], string> = {
  bar: '条形图',
  line: '折线图',
  stream: '河流图',
  sankey: '桑基图',
  radar: '雷达图',
  scatter3d: '三维散点图',
  area: '堆叠面积图',
  donut: '环形图',
  heatmap: '热力图',
  treemap: '矩形树图',
  funnel: '漏斗图',
  waterfall: '瀑布图',
  bar3d: '三维柱状图',
};

export function snapshotTable(chart: OfficeChartSnapshot): DataTable {
  return {
    kind: 'table',
    line: 0,
    headers: chart.headers,
    rows: chart.rows,
    textCells: new Set(chart.textCells),
  };
}

export function snapshotSvg(chart: OfficeChartSnapshot) {
  return chartSvg(chart.title, [snapshotTable(chart)], chart.kind);
}

export const chartDataUrl = (svg: string) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

export function chartSvg(
  title: string,
  source: DataTable[],
  chart: DocumentLayout['chart'] = 'bar',
) {
  const tables = source.map(usedChartTable);
  if (chart !== 'bar' && chart !== 'line') {
    if (tables.length !== 1) throw new Error('该图表需要一张结构完整的数据表。');
    return advancedChart(title, tables[0]!, chart);
  }
  const plots = tables.flatMap((table) => chartSeries(table).map((series) => ({ table, series })));
  if (!plots.length) throw new Error('图表需要首列为类别、其后至少一列为完整数值的数据。');
  const entries = plots.reduce((sum, plot) => sum + plot.table.rows.length, 0);
  if (entries > 200) throw new Error('图表超过 200 个数据点，请选择 Excel 或缩小数据范围。');
  const labelLength = plots.reduce(
    (total, { table, series }) =>
      total +
      series.name.length * (1 + table.rows.length) +
      table.rows.reduce((sum, row) => sum + (row[0]?.length ?? 0), 0),
    0,
  );
  if (labelLength > 1_000_000) throw new Error('图表标签过长，请缩短分类或列标题后导出。');
  const compact = (label: string, limit: number) => {
    const points = Array.from(label);
    return points.length > limit ? points.slice(0, limit - 1).join('') + '…' : label;
  };
  let top = 92;
  const marks: string[] = [];
  for (const { table, series } of plots) {
    const min = Math.min(0, ...series.values);
    const max = Math.max(0, ...series.values);
    const span = max - min || 1;
    const x = (value: number) => 246 + 515 * ((value - min) / span);
    const axis = x(0);
    marks.push(
      `<text x="36" y="${top}" font-size="19" font-weight="600"><title>${xml(series.name)}</title>${xml(compact(series.name, 46))}</text>`,
    );
    top += 34;
    if (chart === 'line') {
      const pointX = (i: number) =>
        100 + (table.rows.length === 1 ? 410 : (i * 800) / (table.rows.length - 1));
      const pointY = (value: number) => top + 150 - (142 * (value - min)) / span;
      const points = series.values.map((value, i) => `${pointX(i)},${pointY(value)}`);
      marks.push(
        `<line x1="100" x2="900" y1="${pointY(0)}" y2="${pointY(0)}" stroke="#829594"/><polyline points="${points.join(' ')}" fill="none" stroke="#267A77" stroke-width="2.5"/>`,
      );
      const stride = Math.max(1, Math.ceil(table.rows.length / 8));
      const format = (v: number) =>
        series.percent ? Number((v * 100).toPrecision(4)) + '%' : String(Number(v.toPrecision(4)));
      marks.push(
        `<text x="90" y="${pointY(max) + 5}" text-anchor="end">${xml(format(max))}</text>`,
      );
      if (max !== min)
        marks.push(
          `<text x="90" y="${pointY(min) + 5}" text-anchor="end">${xml(format(min))}</text>`,
        );
      table.rows.forEach((row, i) => {
        marks.push(
          `<circle cx="${pointX(i)}" cy="${pointY(series.values[i]!)}" r="4" fill="#267A77"><title>${xml(row[0] ?? '')} · ${xml(row[series.column]!)}</title></circle>`,
        );
        if (i % stride === 0)
          marks.push(
            `<text x="${pointX(i)}" y="${top + 175}" text-anchor="middle">${xml(compact(row[0] ?? '', 6))}</text>`,
          );
      });
      top += 220;
      continue;
    }
    table.rows.forEach((row, index) => {
      const value = series.values[index]!;
      const end = x(value);
      const label = row[series.column]!;
      marks.push(`<g><title>${xml(row[0] ?? '')} · ${xml(series.name)} · ${xml(label)}</title>
        <text x="36" y="${top + 5}">${xml(compact(row[0] ?? '', 15))}</text>
        <rect x="${Math.min(axis, end)}" y="${top - 8}" width="${Math.abs(axis - end)}" height="16" rx="3" fill="${value < 0 ? '#B45B44' : '#267A77'}"/>
        <line x1="${axis}" y1="${top - 13}" x2="${axis}" y2="${top + 13}" stroke="#829594"/>
        <text x="926" y="${top + 5}" text-anchor="end">${xml(label)}</text></g>`);
      top += 32;
    });
    top += 30;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${top}" viewBox="0 0 960 ${top}" role="img"><title>${xml(title)}</title><rect width="960" height="${top}" fill="#fff"/><g font-family="system-ui,sans-serif" fill="#203735" font-size="14"><text x="36" y="45" font-size="26" font-weight="700">${xml(compact(title, 30))}</text>${marks.join('')}</g></svg>`;
}
