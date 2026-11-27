import type { DocumentLayout } from '../document-format.js';
import {
  area,
  curveMonotoneX,
  stack,
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

export function advancedChart(title: string, table: DataTable, chart: Chart) {
  if (
    !table.rows.length ||
    table.rows.length > 256 ||
    table.rows.some((row) => row.length !== table.headers.length)
  )
    throw new Error('请提供列数一致、最多 256 行的有效数据。');
  const drawing = { stream, sankey: flow, radar, scatter3d: scatter }[chart](table);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img"><title>${xml(title)}</title><rect width="960" height="540" fill="#fff"/><g font-family="system-ui,sans-serif" fill="#203735" font-size="14"><text x="36" y="47" font-size="27" font-weight="700">${xml(short(title, 40))}</text>${drawing}</g></svg>`;
}
