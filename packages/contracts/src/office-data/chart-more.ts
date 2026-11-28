import { arc } from 'd3-shape';
import {
  chartOptions,
  chartTheme,
  label,
  legend,
  niceTicks,
  numeric,
  paint,
  paintFill,
  seriesAttr,
  short,
  unitText,
} from './chart-common.js';
import { xml, type DataTable } from './table.js';

/** Additional chart kinds, drawn in native coordinates (x 0–960, y 80–470). */

function named(table: DataTable, title: string, min: number, max: number, signed = false) {
  if (table.headers.length < 2 || table.rows.length < min || table.rows.length > max)
    throw new Error(`${title}需要名称列和数值列，${min}–${max} 行。`);
  const percent = numeric(table, 0, 1).percent;
  return {
    percent,
    items: table.rows.map((row, i) => {
      const n = numeric(table, i, 1);
      if (!row[0]?.trim() || n.percent !== percent || (!signed && n.value < 0))
        throw new Error(`第 ${i + 2} 行需要名称和同单位的${signed ? '' : '非负'}数值。`);
      return { name: row[0].trim(), value: n.value };
    }),
  };
}

function column(table: DataTable, col: number) {
  const percent = numeric(table, 0, col).percent;
  return {
    percent,
    values: table.rows.map((_, i) => {
      const n = numeric(table, i, col);
      if (n.percent !== percent) throw new Error(`「${table.headers[col]}」列的数值单位需要一致。`);
      return n.value;
    }),
  };
}

function xAxis(lo: number, hi: number, left: number, right: number, y: number, percent: boolean) {
  const ticks = niceTicks(lo, hi);
  const a = Math.min(lo, ticks[0]!),
    b = Math.max(hi, ticks.at(-1)!);
  const x = (v: number) => left + ((right - left) * (v - a)) / (b - a || 1);
  const grid = chartOptions().grid !== false;
  return {
    x,
    marks: ticks
      .map(
        (t) =>
          (grid ? `<line x1="${x(t)}" x2="${x(t)}" y1="96" y2="${y}" class="grid" stroke-dasharray="3 4"/>` : '') +
          label(x(t), y + 20, unitText(t, percent), 'middle', ' class="muted" font-size="12.5"'),
      )
      .join(''),
  };
}

function yScale(lo: number, hi: number, top: number, bottom: number, left: number, right: number, percent: boolean) {
  const ticks = niceTicks(lo, hi);
  const a = Math.min(lo, ticks[0]!),
    b = Math.max(hi, ticks.at(-1)!);
  const y = (v: number) => bottom - ((bottom - top) * (v - a)) / (b - a || 1);
  const grid = chartOptions().grid !== false;
  return {
    y,
    marks: ticks
      .map(
        (t) =>
          (grid ? `<line x1="${left}" x2="${right}" y1="${y(t)}" y2="${y(t)}" class="grid" stroke-dasharray="3 4"/>` : '') +
          label(left - 8, y(t) + 4, unitText(t, percent), 'end', ' class="muted" font-size="12.5"'),
      )
      .join(''),
  };
}

/** Nightingale rose: equal angles, radius ∝ √value so area matches the value. */
export function roseChart(table: DataTable) {
  const { items, percent } = named(table, '玫瑰图', 3, 24);
  const max = Math.max(...items.map((i) => i.value)) || 1;
  const step = (2 * Math.PI) / items.length;
  const shape = arc<{ s: number; e: number; r: number }>()
    .innerRadius(26)
    .outerRadius((d) => d.r)
    .startAngle((d) => d.s)
    .endAngle((d) => d.e)
    .padAngle(0.012)
    .cornerRadius(3);
  return items
    .map((item, i) => {
      const r = 26 + 168 * Math.sqrt(item.value / max);
      const mid = i * step + step / 2;
      const lx = 480 + Math.sin(mid) * (r + 16),
        ly = 278 - Math.cos(mid) * (r + 16);
      return (
        `<path${seriesAttr(i)} transform="translate(480 278)" d="${shape({ s: i * step, e: (i + 1) * step, r }) ?? ''}" fill="${paint(i)}" fill-opacity=".9"><title>${xml(item.name + ' · ' + unitText(item.value, percent))}</title></path>` +
        label(lx, ly + 4, short(item.name, 8), Math.sin(mid) >= 0 ? 'start' : 'end', ' font-size="12.5"')
      );
    })
    .join('');
}

/** Scatter (two numeric columns) or bubble (an optional third column sets the area). */
export function scatterChart(table: DataTable) {
  if (table.headers.length < 3 || table.rows.length < 2 || table.rows.length > 256)
    throw new Error('散点图需要名称、X、Y 三列（可选第四列为气泡大小），2–256 行。');
  const xs = column(table, 1),
    ys = column(table, 2);
  const sizes = table.headers.length >= 4 ? column(table, 3) : null;
  const options = chartOptions();
  const x = xAxis(Math.min(...xs.values), Math.max(...xs.values), 90, 880, 430, xs.percent);
  const y = yScale(Math.min(...ys.values), Math.max(...ys.values), 96, 430, 90, 880, ys.percent);
  const maxSize = sizes ? Math.max(...sizes.values.map(Math.abs)) || 1 : 1;
  const dots = table.rows
    .map((row, i) => {
      const r = sizes ? 4 + 24 * Math.sqrt(Math.abs(sizes.values[i]!) / maxSize) : 6;
      const cx = x.x(xs.values[i]!),
        cy = y.y(ys.values[i]!);
      const tip = [row[0], table.headers[1] + ' ' + unitText(xs.values[i]!, xs.percent), table.headers[2] + ' ' + unitText(ys.values[i]!, ys.percent)];
      if (sizes) tip.push(table.headers[3] + ' ' + unitText(sizes.values[i]!, sizes.percent));
      return (
        `<circle${seriesAttr(0)} class="mark sep" cx="${cx}" cy="${cy}" r="${r}" fill="${paint(sizes ? i : 0)}" fill-opacity="${sizes ? 0.62 : 0.8}" stroke-width="1.2"><title>${xml(tip.join(' · '))}</title></circle>` +
        (options.labels ? label(cx + r + 4, cy + 4, short(row[0] ?? '', 10), 'start', ' font-size="11.5" class="muted"') : '')
      );
    })
    .join('');
  return (
    x.marks +
    y.marks +
    dots +
    `<text x="485" y="466" text-anchor="middle" class="muted" font-size="13">${xml(options.xTitle || table.headers[1]!)}</text>` +
    `<text transform="translate(26 263) rotate(-90)" text-anchor="middle" class="muted" font-size="13">${xml(options.yTitle || table.headers[2]!)}</text>`
  );
}

/** One to four gauges: the value of each row against the configured maximum. */
export function gaugeChart(table: DataTable) {
  const { items, percent } = named(table, '仪表盘', 1, 4);
  const options = chartOptions();
  const top = options.gaugeMax ?? (percent ? 1 : niceTicks(0, Math.max(...items.map((i) => i.value)) * 1.15).at(-1)!);
  const count = items.length,
    width = 900 / count,
    radius = Math.min(150, width / 2 - 24);
  const track = arc<{ e: number }>()
    .innerRadius(radius * 0.74)
    .outerRadius(radius)
    .startAngle(-Math.PI / 2)
    .endAngle((d) => d.e)
    .cornerRadius(radius * 0.13);
  return items
    .map((item, i) => {
      const cx = 30 + width * i + width / 2,
        cy = 360;
      const share = Math.max(0, Math.min(1, item.value / top));
      return (
        `<g transform="translate(${cx} ${cy})"><path d="${track({ e: Math.PI / 2 }) ?? ''}" class="gauge-track" fill="${chartTheme().grid}"/>` +
        `<path${seriesAttr(i)} d="${track({ e: -Math.PI / 2 + Math.PI * share }) ?? ''}" fill="${paintFill(i)}"><title>${xml(item.name + ' · ' + unitText(item.value, percent) + ' / ' + unitText(top, percent))}</title></path></g>` +
        `<text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="${Math.round(radius * 0.32)}" font-weight="700">${xml(unitText(item.value, percent))}</text>` +
        `<text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="15" class="muted">${xml(short(item.name, 16))}</text>` +
        label(cx - radius * 0.87, cy + 22, unitText(0, percent), 'middle', ' class="muted" font-size="12"') +
        label(cx + radius * 0.87, cy + 22, unitText(top, percent), 'middle', ' class="muted" font-size="12"')
      );
    })
    .join('');
}

function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q,
    base = Math.floor(pos);
  return sorted[base]! + (sorted[Math.min(base + 1, sorted.length - 1)]! - sorted[base]!) * (pos - base);
}

/** Box plot per value column: quartiles, Tukey whiskers (1.5 × IQR) and outliers. */
export function boxplotChart(table: DataTable) {
  if (table.headers.length < 2 || table.headers.length > 9 || table.rows.length < 5 || table.rows.length > 256)
    throw new Error('箱线图需要每列至少 5 个观测值（每个数值列为一组，最多 8 组）。');
  const groups = table.headers.slice(1).map((name, j) => ({ name, ...column(table, j + 1) }));
  if (groups.some((g) => g.percent !== groups[0]!.percent)) throw new Error('各组数值单位需要一致。');
  const all = groups.flatMap((g) => g.values);
  const scale = yScale(Math.min(...all), Math.max(...all), 96, 420, 80, 890, groups[0]!.percent);
  const band = 810 / groups.length;
  const marks = groups.map((g, j) => {
    const v = [...g.values].sort((a, b) => a - b);
    const q1 = quantile(v, 0.25),
      med = quantile(v, 0.5),
      q3 = quantile(v, 0.75),
      iqr = q3 - q1;
    const low = v.find((n) => n >= q1 - 1.5 * iqr)!,
      high = [...v].reverse().find((n) => n <= q3 + 1.5 * iqr)!;
    const cx = 80 + band * j + band / 2,
      w = Math.min(90, band * 0.45);
    const fmt = (n: number) => unitText(n, g.percent);
    const tip = `${g.name} · 中位数 ${fmt(med)} · 四分位 ${fmt(q1)}–${fmt(q3)} · 范围 ${fmt(low)}–${fmt(high)}`;
    const outliers = v
      .filter((n) => n < low || n > high)
      .map((n) => `<circle cx="${cx}" cy="${scale.y(n)}" r="3.5" fill="none" stroke="${paint(j)}" stroke-width="1.5"><title>${xml(g.name + ' · 离群值 ' + fmt(n))}</title></circle>`)
      .join('');
    return (
      `<g${seriesAttr(j)} class="mark"><title>${xml(tip)}</title>` +
      `<line x1="${cx}" x2="${cx}" y1="${scale.y(high)}" y2="${scale.y(q3)}" stroke="${paint(j)}" stroke-width="1.6"/>` +
      `<line x1="${cx}" x2="${cx}" y1="${scale.y(q1)}" y2="${scale.y(low)}" stroke="${paint(j)}" stroke-width="1.6"/>` +
      `<line x1="${cx - w / 4}" x2="${cx + w / 4}" y1="${scale.y(high)}" y2="${scale.y(high)}" stroke="${paint(j)}" stroke-width="1.6"/>` +
      `<line x1="${cx - w / 4}" x2="${cx + w / 4}" y1="${scale.y(low)}" y2="${scale.y(low)}" stroke="${paint(j)}" stroke-width="1.6"/>` +
      `<rect x="${cx - w / 2}" y="${scale.y(q3)}" width="${w}" height="${Math.max(1, scale.y(q1) - scale.y(q3))}" rx="4" fill="${paint(j)}" fill-opacity=".22" stroke="${paint(j)}" stroke-width="1.6"/>` +
      `<line x1="${cx - w / 2}" x2="${cx + w / 2}" y1="${scale.y(med)}" y2="${scale.y(med)}" stroke="${paint(j)}" stroke-width="3"/></g>` +
      outliers +
      label(cx, 444, short(g.name, 10), 'middle', ' class="muted" font-size="12.5"')
    );
  });
  return scale.marks + marks.join('');
}

/** Histogram of the first value column (Sturges' rule unless bins are set). */
export function histogramChart(table: DataTable) {
  if (table.headers.length < 2 || table.rows.length < 5 || table.rows.length > 5000)
    throw new Error('直方图需要一列至少 5 个数值。');
  const { values, percent } = column(table, 1);
  const options = chartOptions();
  // Snap bin edges to round numbers (1/2/2.5/5 × 10ⁿ) so labels read cleanly.
  const target = options.bins ?? Math.min(30, Math.ceil(Math.log2(values.length) + 1));
  const min = Math.min(...values),
    max = Math.max(...values);
  const raw = (max - min) / target || 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const width = [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => m >= raw * 0.999)!;
  const lo = Math.floor(min / width) * width;
  const bins = Math.max(1, Math.ceil((max - lo) / width + 1e-9));
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / width))]!++;
  const scale = yScale(0, Math.max(...counts), 96, 420, 80, 890, false);
  const step = 810 / bins;
  const bars = counts
    .map((count, i) => {
      const from = lo + width * i;
      const top = scale.y(count);
      return (
        `<rect${seriesAttr(0)} class="mark" x="${80 + step * i + 1}" y="${top}" width="${Math.max(1, step - 2)}" height="${Math.max(0, 420 - top)}" rx="${Math.min(options.barRadius ?? 3, step / 4)}" fill="${paintFill(0)}"><title>${xml(unitText(from, percent) + ' – ' + unitText(from + width, percent) + ' · ' + count)}</title></rect>` +
        (options.labels && count ? `<text x="${80 + step * i + step / 2}" y="${top - 5}" text-anchor="middle" font-size="11" class="muted">${count}</text>` : '')
      );
    })
    .join('');
  const ticks = Array.from({ length: bins + 1 }, (_, i) => i)
    .filter((i) => bins <= 12 || i % Math.ceil(bins / 12) === 0)
    .map((i) => label(80 + step * i, 440, unitText(lo + width * i, percent), 'middle', ' class="muted" font-size="12"'))
    .join('');
  return scale.marks + bars + ticks + `<text x="485" y="466" text-anchor="middle" class="muted" font-size="13">${xml(options.xTitle || table.headers[1]!)}</text>`;
}

/** Lollipop: a light stem and a dot per category, horizontal for long names. */
export function lollipopChart(table: DataTable) {
  const { items, percent } = named(table, '棒棒糖图', 2, 30, true);
  const left = Math.min(220, 40 + Math.max(...items.map((i) => Math.min(14, Array.from(i.name).length))) * 13);
  const x = xAxis(Math.min(0, ...items.map((i) => i.value)), Math.max(...items.map((i) => i.value)), left, 870, 420, percent);
  const band = 318 / items.length;
  return (
    x.marks +
    items
      .map((item, i) => {
        const cy = 100 + band * i + band / 2;
        return (
          `<g${seriesAttr(0)} class="mark"><title>${xml(item.name + ' · ' + unitText(item.value, percent))}</title>` +
          `<line x1="${x.x(0)}" x2="${x.x(item.value)}" y1="${cy}" y2="${cy}" stroke="${paint(0)}" stroke-opacity=".45" stroke-width="${chartOptions().lineWidth ?? 2.4}"/>` +
          `<circle cx="${x.x(item.value)}" cy="${cy}" r="${Math.min(9, band / 2.6)}" fill="${paint(0)}"/></g>` +
          label(left - 10, cy + 4, item.name, 'end', ' class="muted" font-size="12.5"') +
          (chartOptions().labels ? `<text x="${x.x(item.value) + 14}" y="${cy + 4}" font-size="11.5" class="muted">${xml(unitText(item.value, percent))}</text>` : '')
        );
      })
      .join('')
  );
}

/** Radial bars: one ring per category; a full 270° sweep is the largest value. */
export function radialBarChart(table: DataTable) {
  const { items, percent } = named(table, '径向柱图', 2, 10);
  const max = Math.max(...items.map((i) => i.value)) || 1;
  const outer = 190,
    ring = Math.min(26, 150 / items.length);
  return items
    .map((item, i) => {
      const r1 = outer - i * (ring + 4),
        r0 = r1 - ring;
      const end = (Math.PI * 1.5 * item.value) / max;
      const shape = arc<{ e: number }>()
        .innerRadius(r0)
        .outerRadius(r1)
        .startAngle(0)
        .endAngle((d) => d.e)
        .cornerRadius(ring / 2);
      return (
        `<path d="${shape({ e: Math.PI * 1.5 }) ?? ''}" transform="translate(480 278)" fill="${chartTheme().grid}" fill-opacity=".7"/>` +
        `<path${seriesAttr(i)} class="mark-arc" d="${shape({ e: end }) ?? ''}" transform="translate(480 278)" fill="${paint(i)}"><title>${xml(item.name + ' · ' + unitText(item.value, percent))}</title></path>` +
        label(472, 278 - (r0 + r1) / 2 + 4, short(item.name, 10) + '  ' + unitText(item.value, percent), 'end', ' font-size="12"')
      );
    })
    .join('');
}

function pairSeries(table: DataTable, title: string) {
  if (table.headers.length !== 3 || table.rows.length < 2 || table.rows.length > 30)
    throw new Error(`${title}需要三列：分类与两列可比较的数值，2–30 行。`);
  const a = column(table, 1),
    b = column(table, 2);
  if (a.percent !== b.percent) throw new Error('两列数值的单位需要一致。');
  return { a, b, percent: a.percent, names: table.rows.map((row) => row[0] ?? '') };
}

/** Dumbbell: two values per category joined by a line (before/after, plan/actual). */
export function dumbbellChart(table: DataTable) {
  const { a, b, percent, names } = pairSeries(table, '哑铃图');
  const left = Math.min(220, 40 + Math.max(...names.map((n) => Math.min(14, Array.from(n).length))) * 13);
  const all = [...a.values, ...b.values];
  const x = xAxis(Math.min(...all), Math.max(...all), left, 870, 420, percent);
  const band = 318 / names.length;
  return (
    x.marks +
    names
      .map((name, i) => {
        const cy = 100 + band * i + band / 2,
          r = Math.min(8, band / 2.8);
        const va = a.values[i]!,
          vb = b.values[i]!;
        return (
          `<line x1="${x.x(va)}" x2="${x.x(vb)}" y1="${cy}" y2="${cy}" class="axis" stroke-width="3" stroke-linecap="round"/>` +
          `<circle${seriesAttr(0)} cx="${x.x(va)}" cy="${cy}" r="${r}" fill="${paint(0)}"><title>${xml(name + ' · ' + table.headers[1] + ' ' + unitText(va, percent))}</title></circle>` +
          `<circle${seriesAttr(1)} cx="${x.x(vb)}" cy="${cy}" r="${r}" fill="${paint(1)}"><title>${xml(name + ' · ' + table.headers[2] + ' ' + unitText(vb, percent) + ' · 差值 ' + unitText(vb - va, percent))}</title></circle>` +
          label(left - 10, cy + 4, name, 'end', ' class="muted" font-size="12.5"')
        );
      })
      .join('') +
    legend([table.headers[1]!, table.headers[2]!])
  );
}

/** Population-style pyramid: two series mirrored around a centre axis. */
export function pyramidChart(table: DataTable) {
  const { a, b, percent, names } = pairSeries(table, '金字塔图');
  if ([...a.values, ...b.values].some((v) => v < 0)) throw new Error('金字塔图需要非负数值。');
  const max = Math.max(...a.values, ...b.values) || 1;
  const centre = 480,
    half = 330,
    gap = 46;
  const band = 318 / names.length,
    h = band * 0.74;
  const radius = Math.min(chartOptions().barRadius ?? 3, h / 3);
  return (
    names
      .map((name, i) => {
        const y = 100 + band * i + (band - h) / 2;
        const wa = (half * a.values[i]!) / max,
          wb = (half * b.values[i]!) / max;
        return (
          `<rect${seriesAttr(0)} class="mark" x="${centre - gap / 2 - wa}" y="${y}" width="${Math.max(1, wa)}" height="${h}" rx="${radius}" fill="${paintFill(0)}"><title>${xml(name + ' · ' + table.headers[1] + ' ' + unitText(a.values[i]!, percent))}</title></rect>` +
          `<rect${seriesAttr(1)} class="mark" x="${centre + gap / 2}" y="${y}" width="${Math.max(1, wb)}" height="${h}" rx="${radius}" fill="${paintFill(1)}"><title>${xml(name + ' · ' + table.headers[2] + ' ' + unitText(b.values[i]!, percent))}</title></rect>` +
          `<text x="${centre}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="12" class="muted">${xml(short(name, 6))}</text>` +
          (chartOptions().labels
            ? `<text x="${centre - gap / 2 - wa - 6}" y="${y + h / 2 + 4}" text-anchor="end" font-size="11" class="muted">${xml(unitText(a.values[i]!, percent))}</text>` +
              `<text x="${centre + gap / 2 + wb + 6}" y="${y + h / 2 + 4}" font-size="11" class="muted">${xml(unitText(b.values[i]!, percent))}</text>`
            : '')
        );
      })
      .join('') +
    `<text x="${centre - gap / 2 - 4}" y="440" text-anchor="end" font-size="13" font-weight="600">${xml(table.headers[1]!)}</text>` +
    `<text x="${centre + gap / 2 + 4}" y="440" font-size="13" font-weight="600">${xml(table.headers[2]!)}</text>` +
    legend([table.headers[1]!, table.headers[2]!])
  );
}

