import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { documentFormatSchema, formatMatchesBody, readPresentation } from '@ai-xiutu/contracts';
import {
  buildTree,
  docxDocument,
  fileKind,
  pptxPresentation,
  readZip,
  textDocument,
  LIMITS,
} from '../src/file-center/convert';

test('file kinds cover documents, sheets, slides, markup, code, media and archives', () => {
  const kinds = Object.fromEntries(
    ['a.docx', 'b.XLSX', 'c.csv', 'd.pptx', 'e.md', 'f.html', 'g.json', 'h.png', 'i.svg', 'j.zip', 'k.pdf', 'l.mp3', 'm.mp4', 'n.bin'].map(
      (n) => [n, fileKind(n)],
    ),
  );
  assert.deepEqual(kinds, {
    'a.docx': 'docx', 'b.XLSX': 'sheet', 'c.csv': 'sheet', 'd.pptx': 'pptx', 'e.md': 'markdown', 'f.html': 'html',
    'g.json': 'code', 'h.png': 'image', 'i.svg': 'svg', 'j.zip': 'zip', 'k.pdf': 'pdf', 'l.mp3': 'audio', 'm.mp4': 'video', 'n.bin': 'unknown',
  });
});

test('Word import keeps headings, lists, tables and run formatting as a valid document', async () => {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } = await import('docx');
  const doc = new Document({
    numbering: {
      config: [{ reference: 'steps', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'left' }] }],
    },
    sections: [
      {
        children: [
          new Paragraph({ text: '季度报告', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun('普通 '), new TextRun({ text: '加粗', bold: true }), new TextRun({ text: '斜体', italics: true })] }),
          new Paragraph({ text: '第一步', numbering: { reference: 'steps', level: 0 } }),
          new Paragraph({ text: '第二步', numbering: { reference: 'steps', level: 0 } }),
          new Paragraph({ text: '要点', bullet: { level: 0 } }),
          new Table({
            rows: [
              new TableRow({ children: ['区域', '销售'].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
              new TableRow({ children: ['华东', '120'].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
            ],
          }),
          new Paragraph({ children: [new TextRun({ text: '删除 & <标记>', strike: true })] }),
        ],
      },
    ],
  });
  const bytes = new Uint8Array(await Packer.toBuffer(doc));
  const draft = docxDocument('报告.docx', bytes);
  assert.equal(draft.title, '报告');
  const lines = draft.body.split('\n');
  assert.equal(lines[0], '# 季度报告');
  assert.equal(lines[1], '普通 加粗斜体');
  assert.deepEqual(lines.slice(2, 5), ['1. 第一步', '2. 第二步', '- 要点']);
  assert.ok(draft.body.includes('| 区域 | 销售 |\n| --- | --- |\n| 华东 | 120 |'));
  assert.ok(draft.body.endsWith('删除 & <标记>'));
  assert.ok(draft.formatting);
  assert.ok(documentFormatSchema.safeParse(draft.formatting).success);
  assert.ok(formatMatchesBody(draft.body, draft.formatting!));
  const runs = draft.formatting!.paragraphs.find((p) => p.line === 1)!.runs;
  assert.deepEqual(runs, [{ from: 3, to: 5, bold: true }, { from: 5, to: 7, italic: true }]);
});

test('PowerPoint import rebuilds an editable deck with titles and body text', async () => {
  const { default: PptxGen } = await import('pptxgenjs');
  const pptx = new PptxGen();
  const first = pptx.addSlide();
  first.addText('发布计划', { placeholder: 'title', x: 0.5, y: 0.3, w: 9, h: 1 });
  first.addText([{ text: '确认场地' }, { text: '完成样片', options: { breakLine: true } }], { x: 0.5, y: 1.5, w: 9, h: 3 });
  pptx.addSlide().addText('只有正文', { x: 1, y: 1, w: 6, h: 1 });
  const bytes = new Uint8Array((await pptx.write({ outputType: 'uint8array' })) as Uint8Array);
  const draft = pptxPresentation('计划.pptx', bytes);
  const deck = readPresentation(draft.body)!;
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0]!.elements[0]!.kind, 'text');
  assert.match(JSON.stringify(deck.slides[0]), /发布计划/);
  assert.match(JSON.stringify(deck.slides[0]), /确认场地/);
});

test('text and code files become documents; code is fenced with its language', () => {
  const md = textDocument('notes.md', strToU8('﻿# 标题\r\n正文'));
  assert.equal(md.body, '# 标题\n正文');
  const code = textDocument('app.ts', strToU8('const a = 1;'));
  assert.equal(code.body, '```typescript\nconst a = 1;\n```');
  assert.equal(textDocument('x.txt', new Uint8Array([0x41, 0x00, 0x42])).body, 'AB');
});

test('archives: bounded extraction, unsafe paths dropped, tree built from folders', () => {
  const zip = zipSync({
    'docs/readme.md': strToU8('# hi'),
    'docs/img/a.png': new Uint8Array([1, 2, 3]),
    'top.txt': strToU8('x'),
    '../escape.txt': strToU8('no'),
    '__MACOSX/docs/._readme.md': strToU8('junk'),
    'bomb.txt': [new Uint8Array(LIMITS.zipEntryBytes + 1), { level: 9 }],
  });
  const { entries, skipped } = readZip(zip);
  assert.deepEqual(entries.map((e) => e.path), ['docs/img/a.png', 'docs/readme.md', 'top.txt']);
  assert.equal(skipped, 1);
  const tree = buildTree(entries.map((e) => e.path));
  assert.deepEqual(tree.map((n) => n.name), ['docs', 'top.txt']);
  assert.deepEqual(tree[0]!.children!.map((n) => n.name), ['img', 'readme.md']);
});
