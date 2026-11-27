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
  assert.match(chartSvg('Stream', [main], 'stream'), /<path fill=/);
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
