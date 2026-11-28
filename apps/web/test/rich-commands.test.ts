import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState, TextSelection } from 'prosemirror-state';
import { strFromU8, unzipSync } from 'fflate';
import { documentFormatSchema } from '@ai-xiutu/contracts';
import { readRichDocument, validatedRichContent, documentSchema } from '@ai-xiutu/contracts/rich-document';
import {
  blockStyleOf,
  changeIndent,
  clearFormatting,
  continueList,
  documentOutline,
  documentStats,
  findMatches,
  replaceMatches,
  setBlockStyle,
  toggleCheck,
} from '../src/project-files/rich-commands';
import { exportContent } from '../src/project-files/export';

const stateOf = (body: string, from = 1, to = from) => {
  const doc = readRichDocument(body);
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
};
const run = (state: EditorState, command: (s: EditorState, d?: (tr: any) => void) => boolean) => {
  let next = state;
  assert.equal(command(state, (tr) => (next = state.apply(tr))), true);
  return next;
};
const body = (state: EditorState) => validatedRichContent(state.doc).body;

test('block styles are stored as Markdown prefixes, toggle off and renumber ordered lists', () => {
  assert.deepEqual(blockStyleOf('## Title'), { style: 'h2', prefix: '## ' });
  assert.deepEqual(blockStyleOf('- [x] Done'), { style: 'check', prefix: '- [x] ', checked: true });
  assert.equal(blockStyleOf('12. Step').style, 'ordered');
  const all = stateOf('Alpha\nBeta\nGamma', 1, 18);
  const ordered = run(all, setBlockStyle('ordered'));
  assert.equal(body(ordered), '1. Alpha\n2. Beta\n3. Gamma');
  const bullets = run(ordered, setBlockStyle('bullet'));
  assert.equal(body(bullets), '- Alpha\n- Beta\n- Gamma');
  // Applying the active style again returns to normal text.
  assert.equal(body(run(bullets, setBlockStyle('bullet'))), 'Alpha\nBeta\nGamma');
  assert.equal(body(run(stateOf('# Old title'), setBlockStyle('h3'))), '### Old title');
});

test('Enter continues lists, ends an empty item, and checkboxes toggle in place', () => {
  const end = stateOf('1. First', 9);
  const continued = run(end, continueList);
  assert.equal(body(continued), '1. First\n2. ');
  const ended = run(continued, continueList);
  assert.equal(body(ended), '1. First\n');
  assert.equal(continueList(stateOf('Plain', 6)), false);
  const checked = stateOf('- [ ] Buy film');
  let next = checked;
  assert.equal(toggleCheck(checked, 0, (tr) => (next = checked.apply(tr))), true);
  assert.equal(body(next), '- [x] Buy film');
});

test('indent and clear formatting map to validated paragraph attributes and marks', () => {
  const indented = run(run(stateOf('Text'), changeIndent(1)), changeIndent(1));
  const saved = validatedRichContent(indented.doc);
  assert.equal(saved.formatting?.paragraphs[0]?.indent, 2);
  assert.ok(documentFormatSchema.safeParse(saved.formatting).success);
  // Indent is bounded to four levels.
  let deep = indented;
  for (let i = 0; i < 5; i++) if (changeIndent(1)(deep)) deep = run(deep, changeIndent(1));
  assert.equal(deep.doc.firstChild!.attrs.indent, 4);
  const marked = stateOf('Colored', 1, 8);
  const colored = marked.apply(
    marked.tr
      .addMark(1, 8, documentSchema.marks.color!.create({ value: '#B42318' }))
      .addMark(1, 8, documentSchema.marks.strike!.create())
      .addMark(1, 8, documentSchema.marks.link!.create({ href: 'https://example.com/a' })),
  );
  const cleared = validatedRichContent(run(colored, clearFormatting).doc);
  // Links are content, not formatting: they survive clear formatting.
  assert.deepEqual(cleared.formatting?.paragraphs[0]?.runs, [{ from: 0, to: 7, link: 'https://example.com/a' }]);
});

test('find, replace all, outline and CJK-aware word count', () => {
  const doc = readRichDocument('# 项目计划\nAlpha beta alpha\n## 时间表\n摄影 workshop');
  assert.equal(findMatches(doc, 'alpha').length, 2);
  assert.equal(findMatches(doc, 'alpha', true).length, 1);
  const state = EditorState.create({ doc });
  const replaced = state.apply(replaceMatches(state, findMatches(doc, 'alpha'), 'Gamma'));
  assert.equal(validatedRichContent(replaced.doc).body.split('\n')[1], 'Gamma beta Gamma');
  assert.deepEqual(
    documentOutline(doc).map(({ level, text }) => [level, text]),
    [[1, '项目计划'], [2, '时间表']],
  );
  const stats = documentStats(doc);
  // 4 + 3 Latin words; 项目计划(4) + 时间表(3) + 摄影(2) CJK characters, prefixes excluded.
  assert.equal(stats.words, 4 + 3 + 2 + 4);
  assert.equal(stats.paragraphs, 4);
});

test('extended formatting exports as native Word runs, hyperlinks, indent and spacing', async () => {
  const text = 'Visit site now';
  const formatting = {
    version: 1 as const,
    paragraphs: [
      {
        line: 0,
        indent: 1,
        spacing: 1.5,
        runs: [
          { from: 0, to: 5, strike: true as const, color: '#B42318' as const },
          { from: 6, to: 10, link: 'https://example.com/docs' },
          { from: 11, to: 14, highlight: 'yellow' as const, script: 'super' as const },
        ],
      },
    ],
  };
  assert.ok(documentFormatSchema.safeParse(formatting).success);
  assert.equal(
    documentFormatSchema.safeParse({
      ...formatting,
      paragraphs: [{ line: 0, runs: [{ from: 0, to: 5, link: 'javascript:alert(1)' }] }],
    }).success,
    false,
  );
  const file = await exportContent('docx', 'Doc', text, undefined, formatting);
  const xml = strFromU8(unzipSync(new Uint8Array(await file.arrayBuffer()))['word/document.xml']!);
  assert.match(xml, /<w:strike\/>/);
  assert.match(xml, /<w:color w:val="B42318"\/>/);
  assert.match(xml, /<w:hyperlink [^>]*r:id=/);
  assert.match(xml, /<w:highlight w:val="yellow"\/>/);
  assert.match(xml, /<w:vertAlign w:val="superscript"\/>/);
  assert.match(xml, /<w:ind w:left="720"\/>/);
  assert.match(xml, /w:line="360"/);
});
