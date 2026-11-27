import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { exportContent } from '../src/project-files/export';
import { contentBlocks, numericCell } from '../src/project-files/content';
import { projectCover } from '../src/project-files/cover';

const source = [
  '## 拍摄进展',
  '| 团队 | 净变化 | 完成率 | 备注 |',
  '|---|---|---|---|',
  '| 武汉 | 12 | 51% | 00123 |',
  '| 恩施 | -3 | 37.625% | =SUM(2,3) |',
  '| 上海 | 0 | 0% | 12345678901234567 |',
].join('\n');
async function parts(format: 'xlsx' | 'docx' | 'pptx', text = source) {
  const file = await exportContent(format, '项目进展', text);
  return unzipSync(new Uint8Array(await file.arrayBuffer()));
}

test('editable workbook, charts, and source cells stay linked without changing literal identifiers or treating them as formulas', async () => {
  const files = await parts('xlsx');
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="C3" s="2"><v>0\.37625<\/v>/);
  assert.match(sheet, /<c r="B3" s="0"><v>-3<\/v>/);
  assert.match(sheet, /r="D3" t="inlineStr"[^]*?=SUM\(2,3\)/);
  assert.match(sheet, />00123<\/t>/);
  assert.match(sheet, />12345678901234567<\/t>/);
  assert.doesNotMatch(sheet, /<f>/);
  assert.match(strFromU8(files['xl/charts/chart1.xml']!), /Data1!\$B\$2:\$B\$4/);
  assert.match(strFromU8(files['xl/charts/chart2.xml']!), /Data1!\$C\$2:\$C\$4/);
  const second = await parts('xlsx', source + '\n\n```csv\n分组,总量\nA,7\n```');
  assert.ok(second['xl/worksheets/sheet2.xml']);
});

test('CSV/TSV support quoted newlines and delimiters, preserving, escaping and rejecting invalid data', async () => {
  const csv = '类别,数据,备注\r\n"武汉,东",12,"跨\r\n行 ""原文"""\r\n上海,3,"<tag>"';
  const [block] = contentBlocks(csv);
  assert.ok(block?.kind === 'table');
  assert.deepEqual(block.rows[0], ['武汉,东', '12', '跨\n行 "原文"']);
  const [tsv] = contentBlocks('类别\t值\t空\n甲\t2\t');
  assert.ok(tsv?.kind === 'table');
  assert.deepEqual(tsv.rows[0], ['甲', '2', '']);
  const svg = await (await exportContent('svg', 'A & B', csv)).text();
  assert.match(svg, /A &amp; B/);
  assert.match(svg, /武汉,东/);
  assert.equal(numericCell('000138'), null);
  assert.equal(numericCell('123456789012345666'), null);
  await assert.rejects(exportContent('xlsx', '纯文本', '没有数据'), /表头/);
  await assert.rejects(exportContent('xlsx', '坏行', source + '\n|新行|1|'), /列数/);
  await assert.rejects(exportContent('svg', '缺测', '地方,值\nA,未知'), /完整数值/);
  await assert.rejects(exportContent('xlsx', '超长', '列,备注\n甲,' + '深'.repeat(32768)), /32767/);
});

test('Word contains real paragraphs and a table, PowerPoint contains editable content and an embedded chart workbook', async () => {
  const word = await parts('docx');
  const xml = strFromU8(word['word/document.xml']!);
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /恩施/);
  assert.match(xml, /项目进展/);
  const deck = await parts('pptx');
  assert.ok(
    Object.keys(deck).some((file) => file.startsWith('ppt/embeddings/') && file.endsWith('.xlsx')),
  );
  assert.ok(
    Object.keys(deck).some(
      (file) => file.startsWith('ppt/slides/slide') && strFromU8(deck[file]!).includes('<a:tbl>'),
    ),
  );
});

test('presentation cover embeds the explicitly captured local canvas without fetching external pictures', async () => {
  const { default: sharp } = await import('sharp');
  const jpeg = await sharp({
    create: { width: 72, height: 48, channels: 3, background: '#397855' },
  })
    .jpeg()
    .toBuffer();
  const deck = await exportContent(
    'pptx',
    '作品',
    '## 交付\n保留原图比例。',
    'data:image/jpeg;base64,' + jpeg.toString('base64'),
  );
  const archive = unzipSync(new Uint8Array(await deck.arrayBuffer()));
  const pictures = Object.keys(archive).filter((name) => /^ppt\/media\/.+\.jpe?g$/.test(name));
  assert.equal(pictures.length, 1);
  assert.deepEqual(Buffer.from(archive[pictures[0]]!), jpeg);
  await assert.rejects(
    exportContent('pptx', '无效图片', '正文', 'https://example.invalid/photo.jpg'),
    /编码/,
  );
});

test('export preserves literal pipes and significant whitespace and rejects unrepresentable source characters', async () => {
  const data = 'label | value\n---|---\nfirst|ends in \\|\nsecond\\\\|literal backslash before separator';
  const [table] = contentBlocks(data, true);
  assert.ok(table?.kind === 'table');
  assert.deepEqual(table.rows, [['first', 'ends in |'], ['second\\', 'literal backslash before separator']]);
  const files = await parts('xlsx', 'label,value\nA," 12 "\nB," 007 "');
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<c r="B2" t="inlineStr"[^>]*><is><t xml:space="preserve"> 12 <\/t>/);
  assert.match(sheet, /<c r="B3" t="inlineStr"[^>]*><is><t xml:space="preserve"> 007 <\/t>/);
  await assert.rejects(exportContent('xlsx', '项目', 'label,value\nA,12\u000013'), /不支持的字符/);
  await assert.rejects(exportContent('docx', 'A\u0000B', '正文'), /不支持的字符/);
});

test('a cover requires the current project artwork and base, including after capture and before download', async () => {
  const initial = {
    actor: 'user', epoch: 1, navigation: 2, source: 3, recipe: {},
    project: 'A', artwork: { id: 'art', projectId: 'A', assetId: 'asset', headVersion: 1 },
    base: { id: 'asset', projectId: 'A' },
  };
  let current = initial;
  const read = () => current;
  assert.equal(projectCover('B', read, async () => 'jpeg'), undefined);
  current = { ...initial, base: { ...initial.base, id: 'other' } };
  assert.equal(projectCover('A', read, async () => 'jpeg'), undefined);
  current = { ...initial, base: { ...initial.base, projectId: 'B' } };
  assert.equal(projectCover('A', read, async () => 'jpeg'), undefined);
  current = initial;
  const moved = projectCover('A', read, async () => {
    current = { ...initial, navigation: 3 };
    return 'jpeg';
  });
  await assert.rejects(moved!(), /画面已变化/);
  current = initial;
  const result = await projectCover('A', read, async () => 'jpeg')!();
  assert.equal(result.imageDataUrl, 'jpeg');
  result.assertCurrent();
  for (const change of [{ project: 'B' }, { actor: 'another' }, { epoch: 2 }, { source: 4 },
    { recipe: {} }, { artwork: { ...initial.artwork, headVersion: 2 } }]) {
    current = { ...initial, ...change };
    assert.throws(result.assertCurrent, /画面已变化/);
  }
});

test('Office and SVG stop oversized table and chart expansions before allocating the file', async () => {
  const cells = (width: number, rows: number) => [
    Array.from({ length: width }, (_, i) => 'C' + i).join(','),
    ...Array.from({ length: rows }, () => 'x' + ','.repeat(width - 1)),
  ].join('\n');
  await assert.rejects(exportContent('docx', '数据', cells(40, 150)), /6000/);
  await assert.rejects(exportContent('xlsx', '数据', cells(80, 500)), /40000/);
  const width = 50;
  const longLabels = Array.from({ length: width + 1 }, (_, i) => 'C' + i).join(',') +
    '\n' + '类'.repeat(20001) + ',1'.repeat(width);
  await assert.rejects(exportContent('xlsx', '数据', longLabels), /Excel 图表数据过大/);
  await assert.rejects(exportContent('svg', '数据', longLabels), /图表标签过长/);
  await assert.rejects(exportContent('pptx', '数据', '分类,' + '列'.repeat(101) + '\n甲,1'), /表格过宽/);
});
