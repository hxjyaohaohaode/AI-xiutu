import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { readPresentation, writePresentation } from '@ai-xiutu/contracts';
import { exportContent } from '../src/project-files/export';
import {
  editProjectCell,
  emptyProjectSheet,
  readProjectSheet,
} from '@ai-xiutu/contracts/office-data';
import { calculateSheet, calculatedTable } from '@ai-xiutu/contracts/office-data';
import { chartSvg } from '@ai-xiutu/contracts/office-data';
import { blankPresentation, newBox } from '../src/project-files/presentation-model';

test('typed worksheet recalculates dependent cells and exports editable Excel formulas', async () => {
  let body = emptyProjectSheet(['Category', 'Revenue', 'Result']);
  const set = (row: number, column: number, text: string) => {
    const next = editProjectCell(readProjectSheet(body)!, row, column, text);
    assert.ok(next);
    body = next;
  };
  set(1, 0, 'repeat');
  set(1, 1, '12');
  set(2, 1, '8');
  set(1, 2, '=SUM($B$2:B3)');
  set(2, 2, '=IF(C2>0,C2*15%,0)');
  set(3, 2, '=IFERROR(1/0,"check ""denominator""")');
  set(4, 2, '=COUNTIF(B2:B3,">=8")');
  set(5, 2, '=INDEX(B2:C3,2,1)');
  set(6, 2, '=MATCH(8,B2:B3,0)');
  set(7, 2, "'" + '=WEBSERVICE("https://example.invalid")');
  const current = () => readProjectSheet(body)!.table;
  assert.deepEqual(
    [...calculateSheet(current()).values()].map((entry) => entry.value),
    [20, 3, 'check "denominator"', 2, 8, 2],
  );
  set(2, 1, '18');
  assert.equal(calculatedTable(current()).rows[1]![2], '4.5');
  const file = await exportContent('xlsx', 'Metrics', body);
  const sheet = strFromU8(
    unzipSync(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml']!,
  );
  assert.match(sheet, /r="C2" t="n"><f>SUM\(\$B\$2:B3\)<\/f><v>30<\/v>/);
  assert.match(sheet, /r="C3" t="n"><f>IF\(C2&gt;0,C2\*15%,0\)<\/f><v>4\.5<\/v>/);
  assert.match(sheet, /r="C8" t="inlineStr".*?=WEBSERVICE/);
  assert.doesNotMatch(sheet, /<f>WEBSERVICE/);
  set(1, 2, '=C3');
  assert.deepEqual(calculateSheet(current()).get('C2')!.value, { error: '#CYCLE!' });
  set(1, 2, '=WEBSERVICE("https://example.invalid")');
  assert.equal(calculateSheet(current()).get('C2')!.supported, false);
  await assert.rejects(() => exportContent('xlsx', 'Metrics', body), /C2/);
});

test('advanced charts render escaped measured data and reject incompatible inputs', () => {
  const main = {
    kind: 'table' as const,
    line: 0,
    headers: ['Period', 'A', 'B'],
    rows: [
      ['One', '12', '15'],
      ['Two', '9', '11'],
      ['<script>', '10', '14'],
    ],
  };
  assert.match(chartSvg('Stream', [main], 'stream'), /<path data-series="0" fill=/);
  assert.match(chartSvg('Radar', [main], 'radar'), /<polygon/);
  assert.doesNotMatch(chartSvg('Radar', [main], 'radar'), /<script>/);
  const flow = {
    ...main,
    headers: ['From', 'To', 'Amount'],
    rows: [
      ['A', 'B', '4'],
      ['B', 'C', '4'],
    ],
  };
  assert.match(chartSvg('Flow', [flow], 'sankey'), /A → B · 4/);
  assert.throws(
    () => chartSvg('Cycle', [{ ...flow, rows: [...flow.rows, ['C', 'A', '2']] }], 'sankey'),
    /循环/,
  );
  const scatter = { ...main, headers: ['Name', 'X', 'Y', 'Z'], rows: [['First', '2', '5', '7']] };
  assert.match(chartSvg('XYZ', [scatter], 'scatter3d'), /First · 2 · 5 · 7/);
  assert.throws(
    () =>
      chartSvg('Bad', [{ ...main, rows: [['One', '0', '10%'], ...main.rows.slice(1)] }], 'stream'),
    /单位/,
  );
});

test('slide objects serialise as editable text and geometry in PPTX rather than page images', async () => {
  const deck = blankPresentation('Opening');
  deck.slides[0]!.elements.push({
    ...newBox(360, 146),
    x: 120,
    y: 54,
    rotation: 27,
    kind: 'text',
    text: 'Editable heading',
    color: '#26453F',
    font: 'Arial',
    size: 32,
    bold: true,
    align: 'left',
  });
  deck.slides[0]!.elements.push({
    ...newBox(250, 200),
    kind: 'shape',
    shape: 'ellipse',
    color: '#81BFAF',
  });
  const body = writePresentation(deck);
  assert.ok(body);
  assert.deepEqual(readPresentation(body), deck);
  const file = await exportContent('pptx', 'Canvas', body);
  const payload = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const slide = strFromU8(payload['ppt/slides/slide1.xml']!);
  assert.match(slide, /Editable heading/);
  assert.match(slide, /x="914400" y="411480"/);
  assert.match(slide, /rot="1620000"/);
  assert.match(slide, /prst="ellipse"/);
  assert.doesNotMatch(slide, /<p:pic>/);
  deck.slides[0]!.elements[0]!.x = 1590;
  assert.equal(writePresentation(deck), null);
});

test('extended chart kinds validate their data shape and escape every label', () => {
  const table = (headers: string[], rows: string[][]) => ({ kind: 'table' as const, line: 0, headers, rows });
  const series = table(['Month', 'North', 'South'], [['Jan', '12', '7'], ['Feb', '15', '9'], ['<b>Mar</b>', '11', '13']]);
  const share = table(['Channel', 'Users'], [['Search', '420'], ['Social', '260'], ['<img>', '120']]);
  const area = chartSvg('Area', [series], 'area');
  assert.match(area, /<path data-series="0" fill=/);
  assert.doesNotMatch(area, /<b>Mar/);
  const donut = chartSvg('Share', [share], 'donut');
  assert.match(donut, /Search · 420 · 52\.5%/);
  assert.match(donut, />800</); // centre total
  assert.doesNotMatch(donut, /<img>/);
  assert.throws(() => chartSvg('Bad', [table(['A', 'B'], [['x', '-1'], ['y', '2']])], 'donut'), /正/);
  const heat = chartSvg('Heat', [table(['Day', 'AM', 'PM'], [['Mon', '-3', '4'], ['Tue', '2', '-1']])], 'heatmap');
  assert.match(heat, /Mon · AM · -3/);
  const tree = chartSvg('Tree', [share], 'treemap');
  assert.equal(tree.match(/<rect data-series=/g)!.length, 3); // one tile per item
  const funnel = chartSvg('Funnel', [table(['Stage', 'Count'], [['Visit', '1000'], ['Signup', '250'], ['Pay', '50']])], 'funnel');
  assert.match(funnel, /Pay · 50 · 较上一步 20%/);
  const fall = chartSvg('Delta', [table(['Item', 'Change'], [['Start', '100'], ['Cost', '-30'], ['Bonus', '5']])], 'waterfall');
  assert.match(fall, /Cost · -30/);
  assert.match(fall, /合计 · 75/);
  const bars = chartSvg('3D', [series], 'bar3d');
  assert.match(bars, /Feb · South · 9/);
  assert.throws(() => chartSvg('Wide', [table(['A', ...'BCDEFGH'.split('')], [['x', ...Array(7).fill('1')], ['y', ...Array(7).fill('1')], ['z', ...Array(7).fill('1')]])], 'bar3d'), /最多/);
});

test('chart options: themes, hidden series, sorting, combo dual axis and legend placement', async () => {
  const { renderChart } = await import('@ai-xiutu/contracts/office-data');
  const { officeChartSnapshotSchema } = await import('@ai-xiutu/contracts');
  const table = (headers: string[], rows: string[][]) => ({ kind: 'table' as const, line: 0, headers, rows });
  const sales = table(['Month', 'North', 'South', 'West'], [['Jan', '12', '7', '3'], ['Feb', '15', '9', '4'], ['Mar', '11', '13', '6']]);
  // Hidden series disappear from marks but stay in the legend (dimmed) so they can be restored.
  const hidden = renderChart({ title: 'Sales', kind: 'bar', table: sales, options: { hidden: [1] } });
  assert.doesNotMatch(hidden, /data-series="1"/);
  assert.match(hidden, /data-legend="1" class="legend-item" data-hidden="true"/);
  assert.match(hidden, /data-series="2"[^>]*fill="#BA684A"/); // keeps its original colour
  // Themes change background and palette; stacked bars carry every series.
  const midnight = renderChart({ title: 'Sales', kind: 'bar', table: sales, options: { theme: 'midnight', layout: 'stacked' } });
  assert.match(midnight, /<rect width="960" height="540" fill="#111827"\/>/);
  assert.match(midnight, /fill="#5EEAD4"/);
  // Sorting reorders categories by the first value column.
  const sorted = renderChart({ title: 'S', kind: 'bar', table: sales, options: { sort: 'desc', orientation: 'horizontal' } });
  assert.ok(sorted.indexOf('<title>Feb</title>') < sorted.indexOf('<title>Jan</title>'));
  // Combo: first column as columns, percentage lines on a right axis.
  const combo = renderChart({
    title: 'Revenue',
    kind: 'combo',
    table: table(['Month', 'Revenue', 'Margin'], [['Jan', '120', '30%'], ['Feb', '160', '34%'], ['Mar', '150', '31%']]),
    options: { labels: true },
  });
  assert.match(combo, /Feb · Margin · 34%/);
  assert.match(combo, /text-anchor="start" class="muted" font-size="12.5"><title>\d+%<\/title>/); // right axis ticks
  // Right legend narrows category plots instead of shrinking text.
  const right = renderChart({ title: 'S', kind: 'line', table: sales, options: { legend: 'right' } });
  assert.match(right, /scale\(1\.0000\)/);
  assert.match(right, /<g data-legend="0" class="legend-item"><line x1="772"/);
  // Subtitle, labels and decimals are escaped and formatted.
  const labelled = renderChart({ title: 'T', kind: 'line', table: sales, options: { subtitle: '<b>units</b>', labels: true, decimals: 1 } });
  assert.match(labelled, /&lt;b&gt;units&lt;\/b&gt;/);
  assert.match(labelled, />12\.0</);
  // Options are validated with the snapshot.
  const base = { title: 'X', kind: 'bar', headers: ['A', 'B'], rows: [['a', '1']] };
  assert.equal(officeChartSnapshotSchema.safeParse({ ...base, options: { theme: 'neon' } }).success, false);
  assert.equal(officeChartSnapshotSchema.safeParse({ ...base, options: { subtitle: 'ok', hidden: [0] } }).success, true);
  assert.equal(officeChartSnapshotSchema.safeParse({ ...base, options: { onclick: 'x' } }).success, false);
});

test('chart v3: ten new kinds render escaped data and enforce their data shapes', async () => {
  const { renderChart } = await import('@ai-xiutu/contracts/office-data');
  const table = (headers: string[], rows: string[][]) => ({ kind: 'table' as const, line: 0, headers, rows });
  const parts = table(['Name', 'Value'], [['<a>', '40'], ['B', '30'], ['C', '20'], ['D', '10']]);
  const render = (kind: string, data: ReturnType<typeof table>, options = {}) =>
    renderChart({ title: 'T', kind: kind as never, table: data, options });
  for (const kind of ['pie', 'rose', 'lollipop', 'radialbar']) {
    const svg = render(kind, parts);
    assert.match(svg, new RegExp(`data-chart-kind="${kind}"`));
    assert.doesNotMatch(svg, /<a>/);
  }
  // Part-based kinds colour each row differently.
  assert.match(render('rose', parts), /fill="#447BC2"/);
  assert.match(render('gauge', table(['K', 'V'], [['Done', '78%']])), /78%/);
  assert.match(render('gauge', table(['K', 'V'], [['Units', '30']]), { gaugeMax: 40 }), /Units · 30 \/ 40/);
  const samples = table(['#', 'A', 'B'], Array.from({ length: 12 }, (_, i) => [String(i), String(10 + i), String(i % 2 ? 50 : 5)]));
  assert.match(render('boxplot', samples), /中位数/);
  const histogram = render('histogram', samples, { bins: 4 });
  assert.match(histogram, /10 – 12|10 – 15/);
  assert.match(render('scatter', table(['N', 'X', 'Y', 'S'], [['p', '1', '2', '3'], ['q', '4', '5', '6']])), /p · X 1 · Y 2 · S 3/);
  assert.match(render('dumbbell', table(['D', 'Old', 'New'], [['x', '1', '3'], ['y', '2', '2']])), /差值 2/);
  assert.match(render('pyramid', table(['Age', 'M', 'F'], [['0-9', '5', '4'], ['10-19', '6', '7']])), /0-9 · F 4/);
  assert.throws(() => render('pyramid', table(['Age', 'M', 'F'], [['0-9', '-5', '4'], ['1', '1', '1']])), /非负/);
  assert.throws(() => render('boxplot', table(['#', 'A'], [['1', '1'], ['2', '2']])), /至少 5/);
});

test('chart v3 options: number formats, prefixes, custom colours, reference lines and backgrounds', async () => {
  const { renderChart } = await import('@ai-xiutu/contracts/office-data');
  const { officeChartOptionsSchema } = await import('@ai-xiutu/contracts');
  const sales = { kind: 'table' as const, line: 0, headers: ['M', 'Revenue'], rows: [['Jan', '25000'], ['Feb', '36000'], ['Mar', '125000000']] };
  const svg = renderChart({
    title: 'S',
    kind: 'bar',
    table: sales,
    options: { numberFormat: 'compact', prefix: '¥', colors: ['#AA0000'], referenceLine: 30000, referenceLabel: '目标', average: true, gradient: true, titleAlign: 'center', background: 'transparent' },
  });
  assert.match(svg, /Jan · Revenue · ¥2\.5万/);
  assert.match(svg, /¥1\.25亿/);
  assert.match(svg, /<linearGradient id="gAA0000"/);
  assert.match(svg, /fill="url\(#gAA0000\)"/);
  assert.match(svg, />目标 ¥3万</);
  assert.match(svg, />平均 /);
  assert.match(svg, /x="480" y="46" text-anchor="middle"/);
  assert.doesNotMatch(svg, /<rect width="960" height="540"/); // transparent background
  const thousands = renderChart({ title: 'S', kind: 'line', table: sales, options: { numberFormat: 'thousands', suffix: ' 元', axisMax: 200000000 } });
  assert.match(thousands, /25,000 元/);
  // Strict validation: markup in prefixes, invalid colours and inverted ranges are rejected.
  assert.equal(officeChartOptionsSchema.safeParse({ prefix: '<b>' }).success, false);
  assert.equal(officeChartOptionsSchema.safeParse({ colors: ['red'] }).success, false);
  assert.equal(officeChartOptionsSchema.safeParse({ axisMin: 5, axisMax: 1 }).success, false);
  assert.equal(officeChartOptionsSchema.safeParse({ theme: 'aurora', barRadius: 8, lineWidth: 3 }).success, true);
});
