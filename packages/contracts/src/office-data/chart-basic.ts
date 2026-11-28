import { line as lineShape, area as areaShape } from 'd3-shape';
import {
  chartOptions,
  label,
  legend,
  niceTicks,
  numeric,
  paint,
  paintFill,
  plotRight,
  referenceLines,
  seriesAttr,
  short,
  unitText,
  yAxis,
  chartCurve,
} from './chart-common.js';
import { xml, type DataTable } from './table.js';

/**
 * Category charts in native coordinates (plot x 70–R, y 92–414, labels below).
 * Every mark carries data-series for interactive focus and a <title> tooltip.
 */
interface Series {
  name: string;
  values: number[];
  percent: boolean;
}

function categorySeries(table: DataTable, sameUnit = true): Series[] {
  if (table.headers.length < 2 || table.headers.length > 9 || !table.rows.length || table.rows.length > 60)
    throw new Error('图表需要 1–60 个分类及 1–8 列数值。');
  if (table.rows.some((row) => !row[0]?.trim())) throw new Error('每一行的首列需要分类名称。');
  const series = table.headers.slice(1).map((name, j) => {
    const percent = numeric(table, 0, j + 1).percent;
    return {
      name,
      percent,
      values: table.rows.map((_, i) => {
        const n = numeric(table, i, j + 1);
        if (n.percent !== percent) throw new Error(`「${name}」列的数值单位需要一致。`);
        return n.value;
      }),
    };
  });
  if (sameUnit && series.some((s) => s.percent !== series[0]!.percent))
    throw new Error('同一坐标轴的各列需要使用相同单位；不同单位可改用组合图。');
  return series;
}

function axisTitles() {
  const { xTitle, yTitle } = chartOptions();
  return (
    (xTitle ? `<text x="${(70 + plotRight()) / 2}" y="458" text-anchor="middle" class="muted" font-size="13">${xml(xTitle)}</text>` : '') +
    (yTitle
      ? `<text transform="translate(18 253) rotate(-90)" text-anchor="middle" class="muted" font-size="13">${xml(yTitle)}</text>`
      : '')
  );
}

/** Category labels: rotated when crowded so long names never overlap. */
function categoryLabels(names: string[], x: (i: number) => number, y: number) {
  const crowded = names.length > 10 || names.some((n) => Array.from(n).length > Math.max(4, 64 / names.length));
  const stride = Math.max(1, Math.ceil(names.length / 24));
  return names
    .map((name, i) => {
      if (i % stride) return '';
      return crowded
        ? `<text transform="translate(${x(i)} ${y}) rotate(-35)" text-anchor="end" class="muted" font-size="12"><title>${xml(name)}</title>${xml(short(name, 10))}</text>`
        : label(x(i), y, short(name, 12), 'middle', ' class="muted" font-size="12.5"');
    })
    .join('');
}

export function barChart(table: DataTable) {
  const R = plotRight();
  const options = chartOptions();
  const series = categorySeries(table);
  const layout = options.layout ?? 'grouped';
  const percentAxis = layout === 'percent' || series[0]!.percent;
  const n = table.rows.length;
  const names = table.rows.map((row) => row[0]!);
  // Stacked extents per category (positives up, negatives down) or 100% shares.
  const sums = names.map((_, i) => series.reduce((a, s) => a + Math.abs(s.values[i]!), 0) || 1);
  const value = (s: Series, i: number) => (layout === 'percent' ? Math.abs(s.values[i]!) / sums[i]! : s.values[i]!);
  let min = 0,
    max = 0;
  names.forEach((_, i) => {
    if (layout === 'grouped')
      series.forEach((s) => {
        min = Math.min(min, value(s, i));
        max = Math.max(max, value(s, i));
      });
    else {
      let up = 0,
        down = 0;
      series.forEach((s) => (value(s, i) >= 0 ? (up += value(s, i)) : (down += value(s, i))));
      min = Math.min(min, down);
      max = Math.max(max, up);
    }
  });
  if (layout === 'percent') max = 1;
  const horizontal = options.orientation === 'horizontal';
  const marks: string[] = [];
  const labels = options.labels && n * (layout === 'grouped' ? series.length : 1) <= 48;
  if (!horizontal) {
    const { y, grid } = yAxis(min, max, 92, 410, percentAxis, { left: options.yTitle ? 84 : 70 });
    const left = options.yTitle ? 84 : 70,
      band = (R - left) / n;
    const groupWidth = band * (options.barWidth ?? (n > 20 ? 0.82 : 0.68));
    const barWidth = layout === 'grouped' ? groupWidth / series.length : groupWidth;
    marks.push(grid);
    names.forEach((name, i) => {
      let up = 0,
        down = 0;
      series.forEach((s, j) => {
        const v = value(s, i);
        let from = 0,
          to = v;
        if (layout !== 'grouped') {
          from = v >= 0 ? up : down;
          to = from + v;
          v >= 0 ? (up = to) : (down = to);
        }
        const x = left + band * i + (band - groupWidth) / 2 + (layout === 'grouped' ? j * barWidth : 0);
        const top = y(Math.max(from, to)),
          height = Math.max(1, Math.abs(y(from) - y(to)));
        const gap = layout === 'grouped' && series.length > 1 ? Math.min(3, barWidth * 0.12) : 0;
        marks.push(
          `<rect${seriesAttr(j)} class="mark" x="${x + gap / 2}" y="${top}" width="${Math.max(1, barWidth - gap)}" height="${height}" rx="${Math.min(options.barRadius ?? 4, barWidth / 2)}" fill="${paintFill(j)}"><title>${xml(name + ' · ' + s.name + ' · ' + unitText(s.values[i]!, s.percent) + (layout === 'percent' ? ' · ' + unitText(v, true) : ''))}</title></rect>`,
        );
        if (labels && (layout === 'grouped' || height > 16))
          marks.push(
            layout === 'grouped'
              ? `<text x="${x + barWidth / 2}" y="${v >= 0 ? top - 5 : top + height + 13}" text-anchor="middle" font-size="11" class="muted">${xml(unitText(v, percentAxis))}</text>`
              : `<text x="${x + barWidth / 2}" y="${top + height / 2 + 4}" text-anchor="middle" font-size="11" class="on">${xml(unitText(v, percentAxis))}</text>`,
          );
      });
    });
    marks.push(categoryLabels(names, (i) => left + band * i + band / 2, 432));
    marks.push(referenceLines(y, series.flatMap((s) => names.map((_, i) => value(s, i))), percentAxis, left, R));
  } else {
    const left = Math.min(220, 40 + Math.max(...names.map((s) => Math.min(14, Array.from(s).length))) * 13);
    const ticks = niceTicks(min, max);
    const lo = Math.min(min, ticks[0]!),
      hi = Math.max(max, ticks.at(-1)!);
    const x = (v: number) => left + ((R - 10 - left) * (v - lo)) / (hi - lo || 1);
    const band = 318 / n,
      groupHeight = band * (options.barWidth ?? 0.7),
      barHeight = layout === 'grouped' ? groupHeight / series.length : groupHeight;
    if (options.grid !== false)
      marks.push(
        ticks
          .map(
            (t) =>
              `<line x1="${x(t)}" x2="${x(t)}" y1="92" y2="410" class="grid"${t === 0 ? '' : ' stroke-dasharray="3 4"'}/>` +
              label(x(t), 430, unitText(t, percentAxis), 'middle', ' class="muted" font-size="12.5"'),
          )
          .join(''),
      );
    names.forEach((name, i) => {
      let up = 0,
        down = 0;
      const rowTop = 92 + band * i + (band - groupHeight) / 2;
      series.forEach((s, j) => {
        const v = value(s, i);
        let from = 0,
          to = v;
        if (layout !== 'grouped') {
          from = v >= 0 ? up : down;
          to = from + v;
          v >= 0 ? (up = to) : (down = to);
        }
        const y = rowTop + (layout === 'grouped' ? j * barHeight : 0);
        const start = x(Math.min(from, to)),
          width = Math.max(1, Math.abs(x(to) - x(from)));
        marks.push(
          `<rect${seriesAttr(j)} class="mark" x="${start}" y="${y}" width="${width}" height="${Math.max(1, barHeight - 1)}" rx="${Math.min(options.barRadius ?? 4, barHeight / 2)}" fill="${paintFill(j)}"><title>${xml(name + ' · ' + s.name + ' · ' + unitText(s.values[i]!, s.percent))}</title></rect>`,
        );
        if (labels && layout === 'grouped')
          marks.push(
            `<text x="${start + width + 5}" y="${y + barHeight / 2 + 4}" font-size="11" class="muted">${xml(unitText(v, percentAxis))}</text>`,
          );
      });
      marks.push(label(left - 10, rowTop + groupHeight / 2 + 4, name, 'end', ' class="muted" font-size="12.5"'));
    });
  }
  return marks.join('') + axisTitles() + (series.length > 1 ? legend(series.map((s) => s.name)) : '');
}

export function lineChart(table: DataTable) {
  const R = plotRight();
  const options = chartOptions();
  const series = categorySeries(table);
  const n = table.rows.length;
  const all = series.flatMap((s) => s.values);
  const left = options.yTitle ? 84 : 70;
  const { y, grid, lo } = yAxis(Math.min(0, ...all), Math.max(...all), 92, 410, series[0]!.percent, { left });
  const x = (i: number) => (n === 1 ? (left + R) / 2 : left + 16 + ((R - left - 32) * i) / (n - 1));
  const curve = chartCurve();
  const path = lineShape<number>()
    .curve(curve)
    .x((_, i) => x(i))
    .y((v) => y(v));
  const fill = areaShape<number>()
    .curve(curve)
    .x((_, i) => x(i))
    .y0(y(Math.max(0, lo)))
    .y1((v) => y(v));
  const width = options.lineWidth ?? 2.6;
  const marks = series
    .map((s, j) => {
      const markers = options.markers !== false && n <= 40;
      return (
        `<g${seriesAttr(j)} class="mark">` +
        (series.length === 1 || options.gradient
          ? `<path d="${fill(s.values) ?? ''}" fill="${paintFill(j)}" fill-opacity="${options.gradient ? 0.35 : 0.08}"/>`
          : '') +
        `<path d="${path(s.values) ?? ''}" class="trace" pathLength="1" fill="none" stroke="${paint(j)}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>` +
        s.values
          .map(
            (v, i) =>
              (markers
                ? `<circle cx="${x(i)}" cy="${y(v)}" r="${Math.max(3, width + 1.4)}" fill="${paint(j)}" class="sep" stroke-width="1.6"><title>${xml(table.rows[i]![0]! + ' · ' + s.name + ' · ' + unitText(v, s.percent))}</title></circle>`
                : '') +
              (options.labels && n <= 24
                ? `<text x="${x(i)}" y="${y(v) - 9}" text-anchor="middle" font-size="11" class="muted">${xml(unitText(v, s.percent))}</text>`
                : ''),
          )
          .join('') +
        '</g>'
      );
    })
    .join('');
  // Full-height hover columns give a tooltip with every series at that category.
  const tips = table.rows
    .map(
      (row, i) =>
        `<rect x="${Math.max(left, x(i) - (n > 1 ? (x(1) - x(0)) / 2 : 40))}" y="92" width="${Math.min(R, x(i) + (n > 1 ? (x(1) - x(0)) / 2 : 40)) - Math.max(left, x(i) - (n > 1 ? (x(1) - x(0)) / 2 : 40))}" height="318" fill="transparent"><title>${xml(
          row[0]! + ' · ' + series.map((s) => s.name + ' ' + unitText(s.values[i]!, s.percent)).join(' · '),
        )}</title></rect>`,
    )
    .join('');
  return (
    grid +
    marks +
    referenceLines(y, all, series[0]!.percent, left, R) +
    categoryLabels(table.rows.map((row) => row[0]!), x, 432) +
    tips +
    axisTitles() +
    (series.length > 1 ? legend(series.map((s) => s.name), series.map(() => 'line')) : '')
  );
}

/**
 * Combination chart: the first value column as columns on the left axis, the
 * remaining columns as lines. Lines move to a right axis when their unit
 * differs or their magnitude would flatten against the columns.
 */
export function comboChart(table: DataTable) {
  const R = plotRight();
  const options = chartOptions();
  if (table.headers.length < 3) throw new Error('组合图需要分类列及至少两列数值（首列为柱，其余为折线）。');
  const series = categorySeries(table, false);
  const [bars, ...lines] = series as [Series, ...Series[]];
  const n = table.rows.length;
  const barMax = Math.max(...bars.values.map(Math.abs)) || 1;
  const lineValues = lines.flatMap((s) => s.values);
  const lineMax = Math.max(...lineValues.map(Math.abs)) || 1;
  const dual =
    lines.some((s) => s.percent !== bars.percent) || lineMax / barMax > 4 || barMax / lineMax > 4;
  if (dual && lines.some((s) => s.percent !== lines[0]!.percent))
    throw new Error('组合图的折线需要使用同一单位。');
  const left = options.yTitle ? 84 : 70,
    right = dual ? R - 30 : R;
  const leftAxis = yAxis(Math.min(0, ...bars.values, ...(dual ? [] : lineValues)), Math.max(...bars.values, ...(dual ? [] : lineValues)), 92, 410, bars.percent, { left, right });
  const rightAxis = dual
    ? yAxis(Math.min(0, ...lineValues), Math.max(...lineValues), 92, 410, lines[0]!.percent, { left, right, side: 'right', lines: false })
    : leftAxis;
  const band = (right - left) / n,
    barWidth = band * (options.barWidth ?? 0.56);
  const cx = (i: number) => left + band * i + band / 2;
  const marks: string[] = [leftAxis.grid, dual ? rightAxis.grid : ''];
  bars.values.forEach((v, i) => {
    const top = leftAxis.y(Math.max(0, v)),
      height = Math.max(1, Math.abs(leftAxis.y(0) - leftAxis.y(v)));
    marks.push(
      `<rect${seriesAttr(0)} class="mark" x="${cx(i) - barWidth / 2}" y="${top}" width="${barWidth}" height="${height}" rx="${Math.min(options.barRadius ?? 4, barWidth / 2)}" fill="${paintFill(0)}" fill-opacity=".88"><title>${xml(table.rows[i]![0]! + ' · ' + bars.name + ' · ' + unitText(v, bars.percent))}</title></rect>`,
    );
    // Inside the column top so the line series never collides with the labels.
    if (options.labels && n <= 24 && height > 22)
      marks.push(
        `<text x="${cx(i)}" y="${top + 16}" text-anchor="middle" font-size="11" class="on">${xml(unitText(v, bars.percent))}</text>`,
      );
  });
  const curve = chartCurve();
  lines.forEach((s, k) => {
    const j = k + 1;
    const path = lineShape<number>()
      .curve(curve)
      .x((_, i) => cx(i))
      .y((v) => rightAxis.y(v));
    marks.push(
      `<g${seriesAttr(j)} class="mark"><path d="${path(s.values) ?? ''}" class="trace" pathLength="1" fill="none" stroke="${paint(j)}" stroke-width="${options.lineWidth ?? 2.6}" stroke-linejoin="round"/>` +
        s.values
          .map(
            (v, i) =>
              options.markers === false
                ? ''
                : `<circle cx="${cx(i)}" cy="${rightAxis.y(v)}" r="${Math.max(3, (options.lineWidth ?? 2.6) + 1.4)}" fill="${paint(j)}" class="sep" stroke-width="1.6"><title>${xml(table.rows[i]![0]! + ' · ' + s.name + ' · ' + unitText(v, s.percent))}</title></circle>`,
          )
          .join('') +
        '</g>',
    );
  });
  marks.push(categoryLabels(table.rows.map((row) => row[0]!), cx, 432));
  marks.push(referenceLines(leftAxis.y, bars.values, bars.percent, left, right));
  return (
    marks.join('') +
    axisTitles() +
    legend(
      series.map((s) => s.name),
      series.map((_, i) => (i === 0 ? 'bar' : 'line')),
    )
  );
}
