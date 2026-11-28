import type { DocumentLayout } from '../document-format.js';
import {
  arc,
  area,
  curveMonotoneX,
  pie,
  stack,
  stackOffsetNone,
  stackOrderNone,
  stackOffsetWiggle,
  stackOrderInsideOut,
  type SeriesPoint,
} from 'd3-shape';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { numericCell, xml, type DataTable } from './table.js';

type Chart = Exclude<DocumentLayout['chart'], 'bar' | 'line'>;
const colors = [
  '#237973',
  '#447BC2',
  '#BA684A',
  '#6C63A8',
  '#9E7584',
  '#607747',
  '#A37721',
  '#437E95',
];
const paint = (i: number) => colors[i % colors.length]!;
const short = (s: string, max = 18) =>
  Array.from(s).length <= max
    ? s
    : Array.from(s)
        .slice(0, max - 1)
        .join('') + '…';
const numberText = (n: number) => String(Number(n.toPrecision(8)));
const point = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
const label = (x: number, y: number, s: string, anchor = 'start') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}"><title>${xml(s)}</title>${xml(short(s))}</text>`;

function numeric(table: DataTable, row: number, col: number) {
  const cell = table.rows[row]?.[col];
  const value =
    !table.textCells?.has((row + 1) * table.headers.length + col) && cell != null
      ? numericCell(cell)
      : null;
  if (!value) throw new Error(`第 ${row + 2} 行「${table.headers[col] ?? col + 1}」需要数值。`);
  return value;
}

function seriesData(table: DataTable) {
  if (
    table.headers.length < 2 ||
    table.headers.length > 9 ||
    table.rows.length < 3 ||
    table.rows.length > 80 ||
    table.rows.some((row) => !row[0])
  ) {
    throw new Error('图表需要 3–80 个有名称的分类及 1–8 列数据。');
  }
  const percent = numeric(table, 0, 1).percent;
  const values = table.rows.map((row, i) =>
    row.slice(1).map((_, j) => {
      const x = numeric(table, i, j + 1);
      if (x.percent !== percent || x.value < 0) throw new Error('请统一数值单位，并使用非负数据。');
      return x.value;
    }),
  );
  return { values, percent };
}

function legend(names: string[]) {
  return names
    .map((name, i) => {
      const x = 37 + (i % 4) * 228,
        y = 477 + Math.floor(i / 4) * 28;
      return `<circle cx="${x}" cy="${y - 4}" r="5" fill="${paint(i)}"/>${label(x + 12, y, name)}`;
    })
    .join('');
}

function stream(table: DataTable) {
  const { values, percent } = seriesData(table);
  const keys = table.headers.slice(1).map((_, i) => i);
  const layers = stack<number[], number>()
    .keys(keys)
    .value((row, key) => row[key]!)
    .order(stackOrderInsideOut)
    .offset(stackOffsetWiggle)(values);
  const all = layers.flat();
  const min = Math.min(...all.map((p) => p[0])),
    max = Math.max(...all.map((p) => p[1]));
  const x = (i: number) => 70 + (820 * i) / (values.length - 1);
  const y = (v: number) => 414 - (328 * (v - min)) / (max - min || 1);
  const shape = area<SeriesPoint<number[]>>()
    .curve(curveMonotoneX)
    .x((_, i) => x(i))
    .y0((p) => y(p[0]))
    .y1((p) => y(p[1]));
  const marks = layers.map(
    (layer) =>
      `<path fill="${paint(layer.key)}" fill-opacity=".84" d="${shape(layer) ?? ''}"><title>${xml(table.headers[layer.key + 1]!)}</title></path>`,
  );
  const stride = Math.ceil(values.length / 8);
  table.rows.forEach((row, i) => {
    if (i % stride === 0) marks.push(label(x(i), 448, short(row[0]!, 10), 'middle'));
    marks.push(
      `<rect x="${Math.max(55, x(i) - 8)}" y="84" width="16" height="334" fill="transparent"><title>${xml(
        row[0]! +
          ' · ' +
          values[i]!.map(
            (v, j) =>
              table.headers[j + 1]! +
              ' ' +
              numberText(v * (percent ? 100 : 1)) +
              (percent ? '%' : ''),
          ).join(' · '),
      )}</title></rect>`,
    );
  });
  return marks.join('') + legend(table.headers.slice(1));
}

function flow(table: DataTable) {
  if (table.headers.length !== 3 || table.rows.length > 160)
    throw new Error('桑基图需要三列：来源、去向和正数流量，最多 160 行。');
  const names = new Set<string>();
  const percent = numeric(table, 0, 2).percent;
  const links = table.rows.map((row, i) => {
    const source = row[0]!.trim(),
      target = row[1]!.trim(),
      { value, percent: unit } = numeric(table, i, 2);
    if (!source || !target || source === target || value <= 0 || unit !== percent)
      throw new Error(`第 ${i + 2} 行须提供不同的来源和去向，以及同单位的正数流量。`);
    names.add(source);
    names.add(target);
    return { source, target, value };
  });
  if (names.size > 45 || !links.length) throw new Error('桑基图需要 2–45 个节点。');
  const input = { nodes: [...names].map((name) => ({ name })), links };
  const layout = sankey<{ name: string }, object>()
    .nodeId((n) => n.name)
    .nodeWidth(14)
    .nodePadding(13)
    .extent([
      [125, 88],
      [830, 486],
    ]);
  let graph: ReturnType<typeof layout>;
  try {
    graph = layout(input);
  } catch {
    throw new Error('节点形成了循环流向，请先拆分循环。');
  }
  const linkPath = sankeyLinkHorizontal<{ name: string }, object>();
  return (
    graph.links
      .map((link) => {
        const from = link.source as (typeof graph.nodes)[number],
          to = link.target as (typeof graph.nodes)[number];
        const value = numberText(link.value * (percent ? 100 : 1)) + (percent ? '%' : '');
        return `<path d="${linkPath(link)}" fill="none" stroke="${paint(from.index!)}" stroke-opacity=".32" stroke-width="${Math.max(1, link.width!)}"><title>${xml(from.name + ' → ' + to.name + ' · ' + value)}</title></path>`;
      })
      .join('') +
    graph.nodes
      .map((n) => {
        const start = n.x0! < 480,
          x = start ? n.x0! - 7 : n.x1! + 7;
        return `<rect x="${n.x0}" y="${n.y0}" width="14" height="${Math.max(n.y1! - n.y0!, 1)}" rx="3" fill="${paint(n.index!)}"/>${label(x, (n.y1! + n.y0!) / 2 + 4, short(n.name, 12), start ? 'end' : 'start')}`;
      })
      .join('')
  );
}

function radar(table: DataTable) {
  const { values, percent } = seriesData(table);
  if (table.rows.length > 16) throw new Error('雷达图最多显示 16 个维度。');
  const max = Math.max(...values.flat()) || 1;
  const xy = (i: number, ratio = 1) => {
    const angle = (i * 2 * Math.PI) / values.length - Math.PI / 2;
    return [480 + 155 * ratio * Math.cos(angle), 255 + 155 * ratio * Math.sin(angle)] as const;
  };
  const polygon = (ratio: number) => values.map((_, i) => point(...xy(i, ratio))).join(' ');
  const grid = [0.25, 0.5, 0.75, 1].map(
    (ratio) =>
      `<polygon points="${polygon(ratio)}" fill="none" stroke="#9aadaa" stroke-opacity=".65"/>${label(
        489,
        xy(0, ratio)[1] - 3,
        numberText(max * ratio * (percent ? 100 : 1)) + (percent ? '%' : ''),
      )}`,
  );
  const axes = table.rows.map((row, i) => {
    const [x, y] = xy(i),
      [tx, ty] = xy(i, 1.19);
    return `<line x1="480" y1="255" x2="${x}" y2="${y}" stroke="#9aadaa" stroke-opacity=".65"/>${label(tx, ty + 5, row[0]!, 'middle')}`;
  });
  const plots = table.headers.slice(1).map((name, i) => {
    const coords = values.map((row, j) => xy(j, row[i]! / max));
    return `<polygon points="${coords.map((p) => point(...p)).join(' ')}" fill="${paint(i)}" fill-opacity=".15" stroke="${paint(i)}" stroke-width="2"><title>${xml(name)}</title></polygon>${coords
      .map(
        ([x, y], j) =>
          `<circle cx="${x}" cy="${y}" r="3.6" fill="${paint(i)}"><title>${xml(table.rows[j]![0]! + ' · ' + table.rows[j]![i + 1]!)}</title></circle>`,
      )
      .join('')}`;
  });
  return [...grid, ...axes, ...plots].join('') + legend(table.headers.slice(1));
}

function scatter(table: DataTable) {
  if (table.headers.length !== 4 || !table.rows.length)
    throw new Error('三维散点图需要四列：名称、X、Y、Z。');
  const vectors = table.rows.map((row, i) => row.slice(1).map((_, j) => numeric(table, i, j + 1)));
  const ranges = [0, 1, 2].map((axis) => {
    const entries = vectors.map((row) => row[axis]!);
    if (entries.some((item) => item.percent !== entries[0]!.percent))
      throw new Error('同一坐标轴的数值单位需要一致。');
    return [
      Math.min(0, ...entries.map((x) => x.value)),
      Math.max(0, ...entries.map((x) => x.value)),
    ] as const;
  });
  const project = ([x = 0, y = 0, z = 0]: number[]) =>
    [455 + 280 * x - 212 * y, 381 + x * 43 + y * 78 - z * 266] as const;
  const line = (a: readonly number[], b: readonly number[], opacity: number) =>
    `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#829a96" opacity="${opacity}"/>`;
  const grid = [0, 0.25, 0.5, 0.75, 1].flatMap((d) => [
    line(project([d, 0]), project([d, 1]), 0.55),
    line(project([0, d]), project([1, d]), 0.55),
  ]);
  const axes = [0, 1, 2].map((axis) => {
    const end = project([0, 1, 2].map((i) => (i === axis ? 1 : 0)));
    const [min, max] = ranges[axis]!;
    const unit = vectors[0]![axis]!.percent ? '%' : '';
    const fmt = (x: number) => numberText(x * (unit ? 100 : 1)) + unit;
    return (
      line(project([]), end, 1) +
      label(
        end[0] + (axis === 1 ? -10 : 10),
        end[1] + 4,
        table.headers[axis + 1]! + ' ' + fmt(min) + ' → ' + fmt(max),
        axis === 1 ? 'end' : 'start',
      )
    );
  });
  const dots = vectors
    .map((row, i) => {
      const norm = row.map(
        (n, j) => (n.value - ranges[j]![0]) / (ranges[j]![1] - ranges[j]![0] || 1),
      );
      return { i, norm, depth: norm[0]! + norm[1]!, p: project(norm) };
    })
    .sort((a, b) => a.depth - b.depth);
  return [
    ...grid,
    ...axes,
    ...dots.map(
      ({ i, norm, p }) =>
        line(project([norm[0]!, norm[1]!, 0]), p, 0.28) +
        `<circle cx="${p[0]}" cy="${p[1]}" r="5.5" fill="#267a77" stroke="#fff" stroke-width="1.2"><title>${xml(table.rows[i]!.join(' · '))}</title></circle>`,
    ),
  ].join('');
}


/** Shared value formatting with the unit of the first value. */
const unitText = (value: number, percent: boolean) =>
  numberText(value * (percent ? 100 : 1)) + (percent ? '%' : '');

function niceTicks(min: number, max: number, count = 5) {
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

/** Two-column name/value data (pie-like charts). Values must share one unit. */
function pairs(table: DataTable, name: string, max: number, signed = false) {
  if (table.headers.length !== 2 || table.rows.length < 2 || table.rows.length > max)
    throw new Error(`${name}需要两列（名称、数值），2–${max} 行。`);
  const percent = numeric(table, 0, 1).percent;
  return {
    percent,
    items: table.rows.map((row, i) => {
      const { value, percent: unit } = numeric(table, i, 1);
      if (!row[0]!.trim() || unit !== percent || (!signed && value <= 0))
        throw new Error(`第 ${i + 2} 行需要名称和同单位的${signed ? '' : '正'}数值。`);
      return { name: row[0]!.trim(), value };
    }),
  };
}

function yAxis(min: number, max: number, top: number, bottom: number, percent: boolean) {
  const ticks = niceTicks(min, max);
  const lo = Math.min(min, ticks[0]!), hi = Math.max(max, ticks.at(-1)!);
  const y = (v: number) => bottom - ((bottom - top) * (v - lo)) / (hi - lo || 1);
  const grid = ticks
    .map((t) => `<line x1="70" x2="890" y1="${y(t)}" y2="${y(t)}" stroke="#d6e2df"/>${label(62, y(t) + 4, unitText(t, percent), 'end')}`)
    .join('');
  return { y, grid };
}

function areaChart(table: DataTable) {
  const { values, percent } = seriesData(table);
  const keys = table.headers.slice(1).map((_, i) => i);
  const layers = stack<number[], number>()
    .keys(keys)
    .value((row, key) => row[key]!)
    .order(stackOrderNone)
    .offset(stackOffsetNone)(values);
  const max = Math.max(...layers.flat().map((p) => p[1]));
  const x = (i: number) => 70 + (820 * i) / (values.length - 1);
  const { y, grid } = yAxis(0, max, 86, 414, percent);
  const shape = area<SeriesPoint<number[]>>()
    .curve(curveMonotoneX)
    .x((_, i) => x(i))
    .y0((p) => y(p[0]))
    .y1((p) => y(p[1]));
  const stride = Math.ceil(values.length / 8);
  const ticks = table.rows
    .map((row, i) => (i % stride === 0 ? label(x(i), 440, short(row[0]!, 10), 'middle') : ''))
    .join('');
  const marks = layers
    .map((layer) => `<path fill="${paint(layer.key)}" fill-opacity=".78" stroke="#fff" stroke-width="1" d="${shape(layer) ?? ''}"><title>${xml(table.headers[layer.key + 1]!)}</title></path>`)
    .join('');
  return grid + marks + ticks + legend(table.headers.slice(1));
}

function donut(table: DataTable) {
  const { items, percent } = pairs(table, '环形图', 12);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const slices = pie<{ name: string; value: number }>().value((d) => d.value).sort(null).padAngle(0.012)(items);
  const shape = arc<(typeof slices)[number]>().innerRadius(98).outerRadius(168).cornerRadius(3);
  const marks = slices
    .map((slice, i) => {
      const share = slice.data.value / total;
      const [cx, cy] = shape.centroid(slice);
      const mid = (slice.startAngle + slice.endAngle) / 2;
      const lx = 330 + Math.sin(mid) * 196, ly = 280 - Math.cos(mid) * 196;
      return `<path transform="translate(330 280)" d="${shape(slice) ?? ''}" fill="${paint(i)}"><title>${xml(slice.data.name + ' · ' + unitText(slice.data.value, percent) + ' · ' + numberText(share * 100) + '%')}</title></path>` +
        (share >= 0.04
          ? `<text x="${330 + cx}" y="${284 + cy}" text-anchor="middle" fill="#fff" font-size="13" font-weight="600">${Math.round(share * 100)}%</text>` +
            label(lx, ly + 4, slice.data.name, Math.sin(mid) >= 0 ? 'start' : 'end')
          : '');
    })
    .join('');
  const list = items
    .map((item, i) => `<circle cx="640" cy="${118 + i * 30}" r="6" fill="${paint(i)}"/>${label(654, 123 + i * 30, item.name)}<text x="900" y="${123 + i * 30}" text-anchor="end">${xml(unitText(item.value, percent))}</text>`)
    .join('');
  return marks +
    `<text x="330" y="276" text-anchor="middle" font-size="26" font-weight="700">${xml(unitText(total, percent))}</text><text x="330" y="300" text-anchor="middle" fill="#5b6f6c">合计</text>` +
    list;
}

function heatmap(table: DataTable) {
  if (table.headers.length < 3 || table.headers.length > 17 || table.rows.length < 2 || table.rows.length > 24)
    throw new Error('热力图需要 2–24 行分类与 2–16 列数值。');
  const percent = numeric(table, 0, 1).percent;
  const grid = table.rows.map((_, i) =>
    table.headers.slice(1).map((__, j) => {
      const n = numeric(table, i, j + 1);
      if (n.percent !== percent) throw new Error('请统一热力图的数值单位。');
      return n.value;
    }),
  );
  const flat = grid.flat();
  const lo = Math.min(...flat), hi = Math.max(...flat);
  const diverging = lo < 0 && hi > 0;
  const cols = grid[0]!.length, rows = grid.length;
  const left = 150, top = 92, w = (880 - left) / cols, h = Math.min(56, 340 / rows);
  // Interpolates in sRGB between the palette's teal/neutral/terracotta anchors.
  const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, k) => Math.round(v + (b[k]! - v) * t)).join(',')})`;
  const neutral = [244, 247, 246], teal = [35, 121, 115], warm = [186, 104, 74];
  const color = (v: number) => {
    if (diverging) {
      const m = Math.max(-lo, hi);
      return v >= 0 ? mix(neutral, teal, v / m) : mix(neutral, warm, -v / m);
    }
    return mix(neutral, teal, (v - lo) / (hi - lo || 1));
  };
  const dark = (v: number) => (diverging ? Math.abs(v) / Math.max(-lo, hi) : (v - lo) / (hi - lo || 1)) > 0.55;
  const cells = grid
    .map((row, i) =>
      row
        .map((v, j) => {
          const x = left + j * w, y = top + i * h;
          const text = h >= 18 && w >= 40
            ? `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="12" fill="${dark(v) ? '#fff' : '#203735'}">${xml(unitText(v, percent))}</text>`
            : '';
          return `<rect x="${x}" y="${y}" width="${w - 2}" height="${h - 2}" rx="3" fill="${color(v)}"><title>${xml(table.rows[i]![0]! + ' · ' + table.headers[j + 1]! + ' · ' + unitText(v, percent))}</title></rect>${text}`;
        })
        .join(''),
    )
    .join('');
  const rowLabels = table.rows.map((row, i) => label(left - 8, top + i * h + h / 2 + 4, short(row[0]!, 12), 'end')).join('');
  const colLabels = table.headers.slice(1).map((name, j) => label(left + j * w + w / 2, top - 10, short(name, 10), 'middle')).join('');
  const scaleY = top + rows * h + 26;
  const scale = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const v = diverging ? -Math.max(-lo, hi) + 2 * Math.max(-lo, hi) * t : lo + (hi - lo) * t;
      return `<rect x="${left + t * 300}" y="${scaleY}" width="74" height="10" fill="${color(v)}"/>${label(left + t * 300 + 37, scaleY + 26, unitText(v, percent), 'middle')}`;
    })
    .join('');
  return cells + rowLabels + colLabels + scale;
}

/** Squarified treemap (Bruls, Huizing, van Wijk 2000) inside a fixed rectangle. */
function squarify(values: number[], x: number, y: number, w: number, h: number) {
  const total = values.reduce((a, b) => a + b, 0);
  const scaled = values.map((v, index) => ({ index, area: (v / total) * w * h })).sort((a, b) => b.area - a.area);
  const out: { index: number; x: number; y: number; w: number; h: number }[] = [];
  const worst = (row: { area: number }[], side: number) => {
    const sum = row.reduce((a, r) => a + r.area, 0);
    const max = Math.max(...row.map((r) => r.area)), min = Math.min(...row.map((r) => r.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  let rest = scaled;
  while (rest.length) {
    const side = Math.min(w, h);
    let row = [rest[0]!];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]!], side) <= worst(row, side)) row = [...row, rest[i++]!];
    rest = rest.slice(i);
    const sum = row.reduce((a, r) => a + r.area, 0);
    if (w >= h) {
      const cw = sum / h;
      let cy = y;
      for (const r of row) { out.push({ index: r.index, x, y: cy, w: cw, h: r.area / cw }); cy += r.area / cw; }
      x += cw; w -= cw;
    } else {
      const ch = sum / w;
      let cx = x;
      for (const r of row) { out.push({ index: r.index, x: cx, y, w: r.area / ch, h: ch }); cx += r.area / ch; }
      y += ch; h -= ch;
    }
  }
  return out;
}

function treemap(table: DataTable) {
  const { items, percent } = pairs(table, '矩形树图', 40);
  const total = items.reduce((a, b) => a + b.value, 0);
  return squarify(items.map((item) => item.value), 36, 80, 888, 430)
    .map(({ index, x, y, w, h }) => {
      const item = items[index]!;
      const text = w > 70 && h > 38
        ? `<text x="${x + 10}" y="${y + 22}" fill="#fff" font-weight="600">${xml(short(item.name, Math.max(4, Math.floor(w / 15))))}</text><text x="${x + 10}" y="${y + 40}" fill="#fff" font-size="12" opacity=".9">${xml(unitText(item.value, percent))} · ${Math.round((item.value / total) * 100)}%</text>`
        : '';
      return `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, w - 2)}" height="${Math.max(0, h - 2)}" rx="4" fill="${paint(index)}"><title>${xml(item.name + ' · ' + unitText(item.value, percent))}</title></rect>${text}`;
    })
    .join('');
}

function funnel(table: DataTable) {
  const { items, percent } = pairs(table, '漏斗图', 10);
  const first = items[0]!.value;
  const max = Math.max(...items.map((item) => item.value));
  const step = 400 / items.length;
  const width = (v: number) => 120 + (520 * v) / max;
  return items
    .map((item, i) => {
      const top = 84 + i * step, wTop = width(item.value), wBottom = width(items[i + 1]?.value ?? item.value * 0.82);
      const points = [[480 - wTop / 2, top], [480 + wTop / 2, top], [480 + wBottom / 2, top + step - 6], [480 - wBottom / 2, top + step - 6]];
      const prev = i ? ' · 较上一步 ' + numberText((item.value / items[i - 1]!.value) * 100) + '%' : '';
      return `<polygon points="${points.map(([px, py]) => point(px!, py!)).join(' ')}" fill="${paint(i)}"><title>${xml(item.name + ' · ' + unitText(item.value, percent) + prev)}</title></polygon>` +
        `<text x="480" y="${top + step / 2 + 2}" text-anchor="middle" fill="#fff" font-weight="600">${xml(unitText(item.value, percent))}</text>` +
        label(480 - wTop / 2 - 14, top + step / 2 + 2, item.name, 'end') +
        `<text x="${480 + wTop / 2 + 14}" y="${top + step / 2 + 2}" fill="#5b6f6c">${numberText((item.value / first) * 100)}%</text>`;
    })
    .join('');
}

function waterfall(table: DataTable) {
  const { items, percent } = pairs(table, '瀑布图', 24, true);
  let running = 0;
  const bars = items.map((item) => {
    const start = running;
    running += item.value;
    return { ...item, start, end: running };
  });
  const values = [0, running, ...bars.flatMap((b) => [b.start, b.end])];
  const { y, grid } = yAxis(Math.min(...values), Math.max(...values), 86, 414, percent);
  const count = bars.length + 1, band = 820 / count, w = band * 0.62;
  const x = (i: number) => 70 + band * i + (band - w) / 2;
  const marks = bars
    .map((b, i) => {
      const top = y(Math.max(b.start, b.end)), height = Math.max(1, Math.abs(y(b.start) - y(b.end)));
      const fill = b.value >= 0 ? '#237973' : '#BA684A';
      const connector = `<line x1="${x(i) + w}" x2="${x(i + 1)}" y1="${y(b.end)}" y2="${y(b.end)}" stroke="#829a96" stroke-dasharray="3 3"/>`;
      return `<rect x="${x(i)}" y="${top}" width="${w}" height="${height}" rx="2" fill="${fill}"><title>${xml(b.name + ' · ' + (b.value >= 0 ? '+' : '') + unitText(b.value, percent))}</title></rect>${connector}` +
        `<text x="${x(i) + w / 2}" y="${top - 6}" text-anchor="middle" font-size="12">${xml((b.value >= 0 ? '+' : '') + unitText(b.value, percent))}</text>` +
        label(x(i) + w / 2, 440, short(b.name, 8), 'middle');
    })
    .join('');
  const totalTop = y(Math.max(0, running)), totalHeight = Math.max(1, Math.abs(y(0) - y(running)));
  return grid + marks +
    `<rect x="${x(bars.length)}" y="${totalTop}" width="${w}" height="${totalHeight}" rx="2" fill="#447BC2"><title>合计 · ${xml(unitText(running, percent))}</title></rect>` +
    `<text x="${x(bars.length) + w / 2}" y="${totalTop - 6}" text-anchor="middle" font-size="12" font-weight="700">${xml(unitText(running, percent))}</text>` +
    label(x(bars.length) + w / 2, 440, '合计', 'middle') +
    `<line x1="70" x2="890" y1="${y(0)}" y2="${y(0)}" stroke="#203735" stroke-opacity=".5"/>`;
}

/** Oblique 3D column chart: categories on X, value columns recede in depth, value as height. */
function bar3d(table: DataTable) {
  const { values, percent } = seriesData(table);
  if (table.rows.length > 12 || values[0]!.length > 6) throw new Error('三维柱状图最多 12 个分类、6 个系列。');
  const nx = values.length, ny = values[0]!.length;
  const ticks = niceTicks(0, Math.max(...values.flat()) || 1, 4);
  const top = ticks.at(-1)!;
  const depthX = Math.min(34, 150 / ny), depthY = depthX * 0.62;
  const cell = (700 - ny * depthX) / nx;
  const left = 110, floorY = 430, maxH = 270;
  const at = (gx: number, gy: number, v: number) =>
    [left + gx * cell + gy * depthX, floorY - gy * depthY - (maxH * v) / top] as const;
  const rgb = (hex: string) => [16, 8, 0].map((sh) => (parseInt(hex.slice(1), 16) >> sh) & 255);
  const mixTo = (hex: string, target: number, t: number) =>
    `rgb(${rgb(hex).map((c) => Math.round(c + (target - c) * t)).join(',')})`;
  const poly = (pts: (readonly [number, number])[], fill: string) =>
    `<polygon points="${pts.map((p) => point(...p)).join(' ')}" fill="${fill}"/>`;
  // Back wall and floor with value gridlines.
  const wall = ticks
    .map((t) => {
      const a = at(0, ny, t), b = at(nx, ny, t), c = at(0, 0, t);
      return `<line x1="${c[0]}" y1="${c[1]}" x2="${a[0]}" y2="${a[1]}" stroke="#d6e2df"/><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#d6e2df"/>${label(c[0] - 8, c[1] + 4, unitText(t, percent), 'end')}`;
    })
    .join('');
  const floor = poly([at(0, 0, 0), at(nx, 0, 0), at(nx, ny, 0), at(0, ny, 0)], '#f1f5f4');
  const bars: string[] = [];
  // Painter's order: farthest series first, then left to right within a series.
  for (let gy = ny - 1; gy >= 0; gy--)
    for (let gx = 0; gx < nx; gx++) {
      const v = values[gx]![gy]!, base = paint(gy);
      const x0 = gx + 0.18, x1 = gx + 0.66, d0 = gy + 0.15, d1 = gy + 0.75;
      const p = (x: number, d: number, h: number) => at(x, d, h);
      bars.push(
        `<g><title>${xml(table.rows[gx]![0]! + ' · ' + table.headers[gy + 1]! + ' · ' + unitText(v, percent))}</title>` +
          poly([p(x0, d0, 0), p(x1, d0, 0), p(x1, d0, v), p(x0, d0, v)], base) +
          poly([p(x1, d0, 0), p(x1, d1, 0), p(x1, d1, v), p(x1, d0, v)], mixTo(base, 0, 0.28)) +
          poly([p(x0, d0, v), p(x1, d0, v), p(x1, d1, v), p(x0, d1, v)], mixTo(base, 255, 0.32)) +
          '</g>',
      );
    }
  const labels = table.rows
    .map((row, gx) => {
      const p = at(gx + 0.5, 0, 0);
      return label(p[0], p[1] + 22, short(row[0]!, 8), 'middle');
    })
    .join('');
  return floor + wall + bars.join('') + labels + legend(table.headers.slice(1));
}

export function advancedChart(title: string, table: DataTable, chart: Chart) {
  if (
    !table.rows.length ||
    table.rows.length > 256 ||
    table.rows.some((row) => row.length !== table.headers.length)
  )
    throw new Error('请提供列数一致、最多 256 行的有效数据。');
  const drawing = {
    stream,
    sankey: flow,
    radar,
    scatter3d: scatter,
    area: areaChart,
    donut,
    heatmap,
    treemap,
    funnel,
    waterfall,
    bar3d,
  }[chart](table);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img"><title>${xml(title)}</title><rect width="960" height="540" fill="#fff"/><g font-family="system-ui,sans-serif" fill="#203735" font-size="14"><text x="36" y="47" font-size="27" font-weight="700">${xml(short(title, 40))}</text>${drawing}</g></svg>`;
}
