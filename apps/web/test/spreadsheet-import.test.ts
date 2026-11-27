import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { importSpreadsheet, selectSpreadsheetRange } from '../src/project-files/spreadsheet';
import { exportContent } from '../src/project-files/export';
import { contentBlocks } from '../src/project-files/content';

const original = readFileSync(new URL('../../../scripts/qa/fixtures/project-data.xlsx', import.meta.url));
const imported = importSpreadsheet('项目.xlsx', original);
const file = imported.sheets[1]!;
test('openpyxl workbook imports visible ranges, dates, stored formulas and padded identifiers', async () => {
  assert.deepEqual(imported.sheets.map((s) => s.name), ['说明', '源数据']);
  const source = selectSpreadsheetRange(imported, file, 'A1:C3');
  assert.equal(imported.sha256, createHash('sha256').update(original).digest('hex'));
  assert.ok(source.body.includes(imported.sha256));
  assert.equal(source.title, '项目 · 源数据');
  assert.match(source.body, /"源数据"!A1:C3/);
  assert.doesNotMatch(source.body, /PRIVATE_FIXTURE_MARKER|假设|不可见/);
  assert.deepEqual(source.preview, [['城市','数量','完成率'],['武汉','12','50%'],['恩施','-3','37.625%']]);
  const stored = selectSpreadsheetRange(imported, file, 'D1:E3');
  assert.equal(stored.formulas, 2);
  assert.deepEqual(stored.preview.slice(1), [['00123', '0'], ['12345678901234567', '-15']]);
  assert.doesNotMatch(stored.body, /B2-B2|B3\*5/);
  const values = selectSpreadsheetRange(imported, file, 'G1:I3');
  assert.deepEqual(values.preview[1], ['2026-11-27', '00042', '12']);
  const parts = unzipSync(new Uint8Array(await (await exportContent('xlsx', values.title, values.body)).arrayBuffer()));
  const xml = strFromU8(parts['xl/worksheets/sheet1.xml']!);
  for (const cell of ['2026-11-27','00042','12','=字面']) assert.ok(xml.includes('>' + cell + '</t>'));
  assert.equal(Object.keys(parts).filter((name) => name.startsWith('xl/charts/')).length, 0);
  assert.doesNotMatch(xml, /<f(?: |>)/);
});

test('ranges reject hidden rows, columns, merged cells and formulas without an actual cached result', () => {
  for (const [range, message] of [['A1:C5', /隐藏/], ['H1:J3', /隐藏/], ['E1:F3', /缓存/],
    ['A0:C2', /矩形/], ['C3:A1', /矩形/], ['K1:L3', /合并/]] as const)
    assert.throws(() => selectSpreadsheetRange(imported, file, range), message);
  assert.throws(() => importSpreadsheet('old.xls', original), /\.xlsx/);
  assert.throws(() => importSpreadsheet('empty.csv', new Uint8Array()), /限额/);
});

test('CSV and UTF-16 TSV preserve Unicode and quoted records through the project table format', () => {
  const csv = '名称,值,原文\r\n"地,区",50%,"引号""和\r\n换行"\r\n编号,0,00042';
  const csvBook = importSpreadsheet('报表.csv', new TextEncoder().encode(csv));
  const range = selectSpreadsheetRange(csvBook, csvBook.sheets[0]!, 'A1:C3');
  const table = contentBlocks(range.body, true).find((b) => b.kind === 'table');
  assert.deepEqual(table?.rows, [['地,区','50%','引号"和\n换行'],['编号','0','00042']]);
  const tsv = importSpreadsheet('数字.tsv', Buffer.from('\uFEFF城市\t数量\r\n武汉\t12', 'utf16le'));
  assert.deepEqual(selectSpreadsheetRange(tsv, tsv.sheets[0]!, 'A1:B2').preview[1], ['武汉','12']);
  const multiline = importSpreadsheet('header.csv', new TextEncoder().encode('"header\nline",col\na,7'));
  const snapshot = selectSpreadsheetRange(multiline, multiline.sheets[0]!, 'A1:B2');
  assert.deepEqual(contentBlocks(snapshot.body, true).find((b) => b.kind === 'table')?.headers, ['header\nline','col']);
  assert.throws(() => importSpreadsheet('invalid.csv', new Uint8Array([255,255,255])), /UTF-8/);
});

test('a shared-string Excel workbook preserves rich text, cached results and source identifiers', () => {
  const bytes = readFileSync(new URL('../../../scripts/qa/fixtures/shared-strings.xlsx', import.meta.url));
  const book = importSpreadsheet('shared.xlsx', bytes);
  const source = selectSpreadsheetRange(book, book.sheets[0]!, 'A1:C3');
  assert.deepEqual(source.preview, [['名称', '件数', '显示编号'], ['读书', '3', '00001'], ['报表', '-4', '00421']]);
  assert.equal(source.formulas, 1);
});

test('worksheet edits preserve selected workbook provenance, cached text types and literal punctuation', async () => {
  const {readProjectSheet,editProjectCell,columnName}=await import('../src/project-files/project-sheet');
  const source=selectSpreadsheetRange(imported,file,'A1:C3').body;
  const sheet=readProjectSheet(source)!;
  assert.equal(sheet.range,file.name+'!A1:C3');
  assert.equal(columnName(26),'AA');
  assert.equal(editProjectCell(sheet,0,1,''),null);
  const changed=editProjectCell(sheet,1,1,'-')!;
  const step=editProjectCell(readProjectSheet(changed)!,1,1,'-3.25')!;
  const parsed=readProjectSheet(step)!;
  assert.equal(parsed.source,sheet.source);
  assert.equal(parsed.table.textCells?.has(4),false);
  assert.equal(parsed.table.rows[0]![1],'-3.25');
  const altered=editProjectCell(parsed,1,0,'00123\t"note"\n信息');
  assert.equal(readProjectSheet(altered!)!.table.rows[0]![0],'00123\t"note"\n信息');
  const txt=editProjectCell(parsed,1,0,'00123')!;
  assert.ok(readProjectSheet(txt)!.table.textCells?.has(3));
});
