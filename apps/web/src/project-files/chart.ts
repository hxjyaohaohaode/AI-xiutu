import { chartSeries, xml, type DataTable } from './content';

export function chartSvg(title: string, tables: DataTable[]) {
  const plots = tables.flatMap((table) => chartSeries(table).map((series) => ({ table, series })));
  if (!plots.length) throw new Error('图表需要首列为类别、其后至少一列为完整数值的数据。');
  const entries = plots.reduce((sum, plot) => sum + plot.table.rows.length, 0);
  if (entries > 200) throw new Error('图表超过 200 个数据点，请选择 Excel 或缩小数据范围。');
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
    table.rows.forEach((row, index) => {
      const end = x(series.values[index]);
      const label = row[series.column];
      marks.push(`<g><title>${xml(row[0])} · ${xml(series.name)} · ${xml(label)}</title>
        <text x="36" y="${top + 5}">${xml(compact(row[0], 15))}</text>
        <rect x="${Math.min(axis, end)}" y="${top - 8}" width="${Math.abs(axis - end)}" height="16" rx="3" fill="${series.values[index] < 0 ? '#B45B44' : '#267A77'}"/>
        <line x1="${axis}" y1="${top - 13}" x2="${axis}" y2="${top + 13}" stroke="#829594"/>
        <text x="926" y="${top + 5}" text-anchor="end">${xml(label)}</text></g>`);
      top += 32;
    });
    top += 30;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${top}" viewBox="0 0 960 ${top}" role="img"><title>${xml(title)}</title><rect width="960" height="${top}" fill="#fff"/><g font-family="system-ui,sans-serif" fill="#203735" font-size="14"><text x="36" y="45" font-size="26" font-weight="700">${xml(compact(title, 30))}</text>${marks.join('')}</g></svg>`;
}
