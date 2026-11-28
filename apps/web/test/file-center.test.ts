import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync, strToU8, zipSync, unzipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { documentFormatSchema, formatMatchesBody, readPresentation } from '@ai-xiutu/contracts';
import {
  buildTree,
  docxDocument,
  docxFromBlob,
  fileKind,
  odpFromBlob,
  odtFromBlob,
  pptxPresentation,
  readEpub,
  rtfText,
  textDocument,
  LIMITS,
} from '../src/file-center/convert';
import { readGzip, readRar, readTar, readTarGz, readZip, safeEntryPath } from '../src/file-center/archives';
import { imageInfo, readExif } from '../src/file-center/image-info';
import { categoryOf, extensionOf } from '../src/file-center/kinds';
import { columnName, rangeCsv, readSheets } from '../src/file-center/sheet-preview';
import { mergeDocuments, zipSelection } from '../src/file-center/pack';
import { looksLikeText, sniffEncoding } from '../src/file-center/TextViewer';

const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());

test('file kinds cover documents, sheets, slides, images, media, fonts and archives', () => {
  const kinds = Object.fromEntries(
    ['a.docx', 'b.XLSX', 'c.csv', 'd.pptx', 'e.md', 'f.html', 'g.json', 'h.png', 'i.svg', 'j.zip', 'k.pdf', 'l.mp3', 'm.mp4', 'n.bin',
      'o.psd', 'p.tiff', 'q.heic', 'r.epub', 's.odt', 't.odp', 'u.rtf', 'v.rar', 'w.tar.gz', 'x.gz', 'y.woff2', 'z.doc', 'Dockerfile'].map((n) => [n, fileKind(n)]),
  );
  assert.deepEqual(kinds, {
    'a.docx': 'docx', 'b.XLSX': 'sheet', 'c.csv': 'sheet', 'd.pptx': 'pptx', 'e.md': 'markdown', 'f.html': 'html',
    'g.json': 'json', 'h.png': 'image', 'i.svg': 'svg', 'j.zip': 'zip', 'k.pdf': 'pdf', 'l.mp3': 'audio', 'm.mp4': 'video', 'n.bin': 'unknown',
    'o.psd': 'psd', 'p.tiff': 'tiff', 'q.heic': 'heic', 'r.epub': 'epub', 's.odt': 'odt', 't.odp': 'odp', 'u.rtf': 'rtf', 'v.rar': 'rar',
    'w.tar.gz': 'tar', 'x.gz': 'gzip', 'y.woff2': 'font', 'z.doc': 'legacy', Dockerfile: 'code',
  });
  assert.equal(extensionOf('a/b/c.TAR.GZ'), 'tgz');
  assert.equal(categoryOf('psd'), 'images');
  assert.equal(categoryOf('rar'), 'archives');
});

test('Word import keeps headings, lists, tables and run formatting as a valid document', async () => {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } = await import('docx');
  const doc = new Document({
    numbering: { config: [{ reference: 'steps', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'left' }] }] },
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
  for (const draft of [docxDocument('报告.docx', bytes), await docxFromBlob('报告.docx', new Blob([bytes]))]) {
    assert.equal(draft.title, '报告');
    const lines = draft.body.split('\n');
    assert.equal(lines[0], '# 季度报告');
    assert.equal(lines[1], '普通 加粗斜体');
    assert.deepEqual(lines.slice(2, 5), ['1. 第一步', '2. 第二步', '- 要点']);
    assert.ok(draft.body.includes('| 区域 | 销售 |\n| --- | --- |\n| 华东 | 120 |'));
    assert.ok(draft.body.endsWith('删除 & <标记>'));
    assert.ok(documentFormatSchema.safeParse(draft.formatting).success);
    assert.ok(formatMatchesBody(draft.body, draft.formatting!));
    assert.deepEqual(draft.formatting!.paragraphs.find((p) => p.line === 1)!.runs, [{ from: 3, to: 5, bold: true }, { from: 5, to: 7, italic: true }]);
  }
});

test('PowerPoint import rebuilds an editable deck with titles and body text', async () => {
  const { default: PptxGen } = await import('pptxgenjs');
  const pptx = new PptxGen();
  const first = pptx.addSlide();
  first.addText('发布计划', { placeholder: 'title', x: 0.5, y: 0.3, w: 9, h: 1 });
  first.addText([{ text: '确认场地' }, { text: '完成样片', options: { breakLine: true } }], { x: 0.5, y: 1.5, w: 9, h: 3 });
  pptx.addSlide().addText('只有正文', { x: 1, y: 1, w: 6, h: 1 });
  const bytes = new Uint8Array((await pptx.write({ outputType: 'uint8array' })) as Uint8Array);
  const deck = readPresentation(pptxPresentation('计划.pptx', bytes).body)!;
  assert.equal(deck.slides.length, 2);
  assert.match(JSON.stringify(deck.slides[0]), /发布计划/);
  assert.match(JSON.stringify(deck.slides[0]), /确认场地/);
});

test('text and code files become documents; code and JSON are fenced with their language', () => {
  assert.equal(textDocument('notes.md', strToU8('\uFEFF# 标题\r\n正文')).body, '# 标题\n正文');
  assert.equal(textDocument('app.ts', strToU8('const a = 1;')).body, '```typescript\nconst a = 1;\n```');
  assert.equal(textDocument('x.json', strToU8('{"a":1}')).body, '```json\n{"a":1}\n```');
  assert.equal(textDocument('x.txt', new Uint8Array([0x41, 0x00, 0x42])).body, 'AB');
});

test('lazy ZIP: listing reads only the directory; stored and deflated entries extract; unsafe paths drop', async () => {
  const big = new Uint8Array(200_000).fill(65);
  const zip = zipSync({
    'docs/readme.md': [strToU8('# hi'), { level: 0 }],
    'docs/big.txt': [big, { level: 9 }],
    'top.txt': strToU8('x'),
    '../escape.txt': strToU8('no'),
    '__MACOSX/docs/._readme.md': strToU8('junk'),
  });
  const { items, skipped } = await readZip(new Blob([zip]), '资料');
  assert.deepEqual(items.map((i) => i.path).sort(), ['资料/docs/big.txt', '资料/docs/readme.md', '资料/top.txt']);
  assert.equal(skipped, 2);
  const readme = items.find((i) => i.name === 'readme.md')!;
  assert.equal(await text(await readme.blob()), '# hi');
  const bigItem = items.find((i) => i.name === 'big.txt')!;
  assert.equal(bigItem.size, 200_000);
  assert.equal((await bigItem.blob()).size, 200_000);
  const tree = buildTree(items.map((e) => e.path));
  assert.deepEqual(tree[0]!.children!.map((n) => n.name), ['docs', 'top.txt']);
  await assert.rejects(readZip(new Blob([strToU8('not a zip')]), 'x'), /ZIP/);
});

test('lazy ZIP: a deflated entry that expands far beyond its compressed size is stopped', async () => {
  // 64 MB of zeros compresses to ~64 KB: a ratio of ~1000, the bomb threshold.
  const bomb = zipSync({ 'zeros.bin': [new Uint8Array(64 * 1024 * 1024), { level: 9 }] });
  const { items } = await readZip(new Blob([bomb]), 'b');
  await assert.rejects(items[0]!.blob(), /压缩比异常|上限/);
});

function tarEntry(name: string, data: Uint8Array, type = '0') {
  const header = new Uint8Array(512);
  header.set(strToU8(name.slice(0, 100)));
  header.set(strToU8(data.length.toString(8).padStart(11, '0') + '\0'), 124);
  header.set(strToU8('14700000000\0'), 136);
  header[156] = type.charCodeAt(0);
  header.set(strToU8('ustar\0' + '00'), 257);
  header.set(strToU8('        '), 148);
  let sum = 0;
  for (const b of header) sum += b;
  header.set(strToU8(sum.toString(8).padStart(6, '0') + '\0 '), 148);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  return [header, padded];
}

test('TAR, TAR.GZ and GZ: headers, GNU long names, pax paths and gzip streaming', async () => {
  const long = 'deep/' + 'x'.repeat(120) + '.txt';
  const tar = new Blob([
    ...tarEntry('a/hello.txt', strToU8('hello')),
    ...tarEntry('././@LongLink', strToU8(long + '\0'), 'L'),
    ...tarEntry('truncated', strToU8('long')),
    ...tarEntry('pax', strToU8('27 path=b/pax-name.md\n'), 'x'),
    ...tarEntry('ignored', strToU8('# pax')),
    ...tarEntry('../evil', strToU8('no')),
    new Uint8Array(1024),
  ] as BlobPart[]);
  const plain = await readTar(tar, 'pkg');
  assert.deepEqual(plain.items.map((i) => i.path), ['pkg/a/hello.txt', 'pkg/' + long, 'pkg/b/pax-name.md']);
  assert.equal(plain.skipped, 1);
  assert.equal(await text(await plain.items[0]!.blob()), 'hello');
  assert.equal(plain.items[0]!.modified, 0o14700000000 * 1000);
  const gz = await readTarGz(new Blob([gzipSync(new Uint8Array(await tar.arrayBuffer()))]), 'pkg');
  assert.deepEqual(gz.items.map((i) => i.path), plain.items.map((i) => i.path));
  assert.equal(await text(await gz.items[2]!.blob()), '# pax');
  const single = await readGzip(new Blob([gzipSync(strToU8('log line'))]), 'logs/app.log.gz');
  assert.equal(single.path, 'logs/app.log');
  assert.equal(single.kind, 'text');
  assert.equal(await text(await single.blob()), 'log line');
});

// A RAR 4 archive with stored (uncompressed) members, built byte by byte.
function crc32(bytes: Uint8Array) {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function rarBlock(type: number, flags: number, body: number[]) {
  const size = 7 + body.length;
  const rest = [type, flags & 255, flags >> 8, size & 255, size >> 8, ...body];
  const crc = crc32(new Uint8Array(rest)) & 0xffff;
  return [crc & 255, crc >> 8, ...rest];
}
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
function storedRar(files: [string, string][]) {
  const out: number[] = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, ...rarBlock(0x73, 0, [0, 0, 0, 0, 0, 0])];
  for (const [name, content] of files) {
    const data = [...strToU8(content)];
    const nameBytes = [...strToU8(name)];
    const body = [...le32(data.length), ...le32(data.length), 2, ...le32(crc32(new Uint8Array(data))), ...le32(0x5a210000), 20, 0x30, nameBytes.length & 255, nameBytes.length >> 8, ...le32(0x20), ...nameBytes];
    out.push(...rarBlock(0x74, 0x8000 | (/[^\x00-\x7f]/.test(name) ? 0x200 : 0), body), ...data);
  }
  out.push(...rarBlock(0x7b, 0x4000, []));
  return new Uint8Array(out);
}

test('RAR: lists and extracts members through the UnRAR WebAssembly build', async () => {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('node-unrar-js/esm/js/unrar.wasm');
  const wasm = async () => {
    const b = readFileSync(wasmPath);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const rar = storedRar([
    ['notes/readme.md', '# RAR 内容'],
    ['data.csv', 'a,b\n1,2'],
  ]);
  const { items } = await readRar(new Blob([rar]), 'pack', wasm);
  assert.deepEqual(items.map((i) => i.path), ['pack/notes/readme.md', 'pack/data.csv']);
  assert.equal(items[0]!.kind, 'markdown');
  assert.equal(await text(await items[0]!.blob()), '# RAR 内容');
  assert.equal(await text(await items[1]!.blob()), 'a,b\n1,2');
  await assert.rejects(readRar(new Blob([strToU8('Rar!garbage')]), 'x', wasm), /RAR/);
});

test('entry paths: absolute, drive-letter, backslash and parent segments are refused', () => {
  for (const bad of ['/etc/passwd', 'C:/win.ini', 'a\\b.txt', 'a/../../b', '__MACOSX/x', 'a/._meta', '']) assert.equal(safeEntryPath(bad), null, bad);
  assert.equal(safeEntryPath('./a//b/c.txt'), 'a/b/c.txt');
});

test('image headers give dimensions before decoding; EXIF reports camera fields', () => {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x2e, 0xe0, 0, 0, 0x1f, 0x40]);
  assert.deepEqual(imageInfo(png), { width: 12000, height: 8000, format: 'PNG' });
  const gif = new Uint8Array(26);
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
  assert.deepEqual(imageInfo(gif), { width: 320, height: 240, format: 'GIF' });
  const webp = new Uint8Array(30);
  webp.set(strToU8('RIFF\0\0\0\0WEBPVP8X'));
  webp.set([0xff, 0x0f, 0, 0x7f, 0x0b, 0], 24);
  assert.deepEqual(imageInfo(webp), { width: 4096, height: 2944, format: 'WebP' });
  // Big-endian TIFF/EXIF block: Make="Cam", Orientation=6, then a JPEG with SOF0 3000×2000.
  const exif = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 2, 0x01, 0x0f, 0, 2, 0, 0, 0, 4, 0x43, 0x61, 0x6d, 0, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.deepEqual(readExif(new Uint8Array(exif)), { make: 'Cam', orientation: '6' });
  const app1 = [0xff, 0xe1, 0, exif.length + 8, ...strToU8('Exif\0\0'), ...exif];
  const sof = [0xff, 0xc0, 0, 17, 8, 0x07, 0xd0, 0x0b, 0xb8, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const jpeg = new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9]);
  const info = imageInfo(jpeg)!;
  assert.equal(info.format, 'JPEG');
  // Orientation 6 rotates 90°, so the display size swaps.
  assert.deepEqual([info.width, info.height], [2000, 3000]);
  assert.equal(info.exif?.make, 'Cam');
});

test('RTF: paragraphs, code-page escapes and Unicode; formatting groups are skipped', () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg936{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue0;}\f0 \'d6\'d0\'ce\'c4\par Hello {\b bold}\tab end\par \u8364?euro{\*\generator Word;}}`;
  assert.equal(rtfText(rtf), '中文\nHello bold\tend\n€euro');
});

test('OpenDocument text and presentation import headings, lists, tables and slides', async () => {
  const odt = zipSync({
    mimetype: strToU8('application/vnd.oasis.opendocument.text'),
    'content.xml': strToU8(
      '<office:document-content><office:body><office:text>' +
        '<text:h text:outline-level="1">标题</text:h><text:p>正文<text:s text:c="2"/>空格</text:p>' +
        '<text:list><text:list-item><text:p>一</text:p></text:list-item><text:list-item><text:p>二</text:p></text:list-item></text:list>' +
        '<table:table><table:table-row><table:table-cell><text:p>A</text:p></table:table-cell><table:table-cell><text:p>B</text:p></table:table-cell></table:table-row>' +
        '<table:table-row><table:table-cell><text:p>1</text:p></table:table-cell><table:table-cell><text:p>2</text:p></table:table-cell></table:table-row></table:table>' +
        '</office:text></office:body></office:document-content>',
    ),
  });
  const doc = await odtFromBlob('说明.odt', new Blob([odt]));
  assert.equal(doc.body, '# 标题\n正文  空格\n- 一\n- 二\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
  const odp = zipSync({
    'content.xml': strToU8(
      '<office:presentation><draw:page draw:name="p1"><draw:frame presentation:class="title"><draw:text-box><text:p>开场</text:p></draw:text-box></draw:frame>' +
        '<draw:frame presentation:class="outline"><draw:text-box><text:p>要点 A</text:p><text:p>要点 B</text:p></draw:text-box></draw:frame></draw:page></office:presentation>',
    ),
  });
  const deck = readPresentation((await odpFromBlob('会.odp', new Blob([odp]))).body)!;
  assert.equal(deck.slides.length, 1);
  assert.match(JSON.stringify(deck.slides[0]), /开场/);
  assert.match(JSON.stringify(deck.slides[0]), /要点 A/);
});

test('EPUB: spine order, navigation titles and images inlined as data URLs', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const epub = zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>'),
    'OEBPS/book.opf': strToU8(
      '<package><metadata><dc:title>小书</dc:title><dc:creator>作者</dc:creator></metadata><manifest>' +
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
        '<item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="img" href="img/a.png" media-type="image/png"/></manifest>' +
        '<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    ),
    'OEBPS/nav.xhtml': strToU8('<nav><ol><li><a href="text/c1.xhtml">第一章 开始</a></li><li><a href="text/c2.xhtml#x">第二章</a></li></ol></nav>'),
    'OEBPS/text/c1.xhtml': strToU8('<html><body><h1>开始</h1><img src="../img/a.png"/></body></html>'),
    'OEBPS/text/c2.xhtml': strToU8('<html><body><p>二</p></body></html>'),
    'OEBPS/img/a.png': png,
  });
  const book = await readEpub(new Blob([epub]));
  assert.equal(book.title, '小书');
  assert.equal(book.author, '作者');
  assert.deepEqual(book.chapters.map((c) => c.title), ['第一章 开始', '第二章']);
  const html = await book.chapter(book.chapters[0]!.href);
  assert.match(html, /src="data:image\/png;base64,iVBORw=="/);
});

test('sheet preview: every visible sheet as display text, row cap and Excel column names', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['区域', '销售'], ['华东', 1200.5], ['华南', 980]]), '一月');
  const hidden = XLSX.utils.aoa_to_sheet([['x']]);
  XLSX.utils.book_append_sheet(book, hidden, '隐藏');
  book.Workbook = { Sheets: [{}, { Hidden: 1 }] };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(Array.from({ length: 50 }, (_, i) => [i])), '长表');
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  const sheets = readSheets('a.xlsx', bytes, 20);
  assert.deepEqual(sheets.map((s) => s.name), ['一月', '长表']);
  assert.deepEqual(sheets[0]!.rows, [['区域', '销售'], ['华东', '1200.5'], ['华南', '980']]);
  assert.equal(sheets[1]!.rows.length, 20);
  assert.equal(sheets[1]!.totalRows, 50);
  // GB18030 CSV, the default for spreadsheets exported on Chinese Windows.
  const gbk = new Uint8Array([0xc7, 0xf8, 0xd3, 0xf2, 0x2c, 0xca, 0xfd, 0x0a, 0xb6, 0xab, 0x2c, 0x31]);
  assert.deepEqual(readSheets('gb.csv', gbk)[0]!.rows, [['区域', '数'], ['东', '1']]);
  assert.deepEqual([columnName(0), columnName(25), columnName(26), columnName(701), columnName(702)], ['A', 'Z', 'AA', 'ZZ', 'AAA']);
  assert.equal(rangeCsv([['a', 'b,c'], ['"q"', '']], 0, 0, 1, 1), 'a,"b,c"\n"""q""",');
});

test('merge and pack: one document per selection, and a zip of the originals', async () => {
  const { items } = await readZip(new Blob([zipSync({ 'a.md': strToU8('# 第一\n内容'), 'b.txt': strToU8('第二'), 'c.png': new Uint8Array([1, 2]) })]), 'z');
  const draft = await mergeDocuments(items, '合并');
  assert.equal(draft.body, '# a\n## 第一\n内容\n\n# b\n第二');
  assert.deepEqual(draft.notes, ['有 1 个文件不是文本类文档，未合并。']);
  const zip = unzipSync(new Uint8Array(await (await zipSelection(items)).arrayBuffer()));
  assert.deepEqual(Object.keys(zip).sort(), ['z/a.md', 'z/b.txt', 'z/c.png']);
  assert.deepEqual([...zip['z/c.png']!], [1, 2]);
});

test('text viewer helpers: encoding sniffing (split UTF-8 tail, GB18030) and binary detection', async () => {
  const utf8 = strToU8('中文');
  assert.equal(await sniffEncoding(utf8.subarray(0, 5)), 'utf-8');
  assert.equal(await sniffEncoding(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x41])), 'gb18030');
  assert.equal(await sniffEncoding(new Uint8Array([0xff, 0xfe, 0x41, 0])), 'utf-16le');
  assert.equal(looksLikeText(strToU8('plain\ttext\n')), true);
  assert.equal(looksLikeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])), false);
  assert.ok(LIMITS.textWindow >= 1024 * 1024);
});
