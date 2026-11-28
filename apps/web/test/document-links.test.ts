import assert from 'node:assert/strict';
import test from 'node:test';
import {
  documentFontCss,
  documentLinkTarget,
  isDocumentLink,
  documentFormatSchema,
  officeChartOptionsSchema,
} from '@ai-xiutu/contracts';
import { chartSvg } from '@ai-xiutu/contracts/office-data';
import { documentSchema } from '@ai-xiutu/contracts/rich-document';

const id = '123e4567-e89b-12d3-a456-426614174000';

test('internal links: headings and project documents, never scripts or relative paths', () => {
  assert.deepEqual(documentLinkTarget('#下周 计划'), { kind: 'heading', heading: '下周 计划' });
  assert.deepEqual(documentLinkTarget('doc:' + id), { kind: 'document', id });
  assert.deepEqual(documentLinkTarget('doc:' + id.toUpperCase() + '#目标'), { kind: 'document', id, heading: '目标' });
  assert.deepEqual(documentLinkTarget('mailto:a@b.c'), { kind: 'external', href: 'mailto:a@b.c' });
  for (const bad of ['javascript:alert(1)', '#', '#a<b>', 'doc:../x', 'doc:' + id + '#', '/relative', 'data:text/html,x', '#' + 'x'.repeat(201)])
    assert.equal(isDocumentLink(bad), false, bad);
});

test('internal links render without href so hash routing is never hijacked', () => {
  const type = documentSchema.marks.link!;
  const spec = (href: string) => JSON.stringify(type.spec.toDOM!(type.create({ href }), true));
  assert.equal(spec('#目标'), JSON.stringify(['a', { 'data-doc-link': '#目标', class: 'doc-xref', role: 'link', tabindex: '0' }, 0]));
  assert.doesNotMatch(spec('doc:' + id), /href/);
  assert.match(spec('https://example.com/'), /"href":"https:\/\/example.com\/".*"target":"_blank"/);
  // Stored formatting accepts the values the editor produces.
  const parsed = documentFormatSchema.safeParse({
    version: 1,
    paragraphs: [{ line: 0, runs: [{ from: 0, to: 2, link: 'doc:' + id + '#目标' }] }],
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(documentFormatSchema.safeParse({
    version: 1,
    paragraphs: [{ line: 0, runs: [{ from: 0, to: 2, link: 'javascript:x' }] }],
  }).success, false);
});

test('document fonts carry a same-class fallback stack', () => {
  assert.match(documentFontCss('KaiTi'), /^"KaiTi", .*KaiTi.*serif$/);
  assert.match(documentFontCss('Consolas'), /monospace$/);
  assert.match(documentFontCss('PingFang SC'), /sans-serif$/);
  assert.equal(documentFontCss('Comic Sans" ; x'), documentFontCss('Aptos'));
});

test('chart curve option: step and linear differ from smooth, smooth stays the area default', () => {
  const t = { name: 'T', headers: ['月', '收入', '成本'], rows: [['1', '3', '2'], ['2', '7', '4'], ['3', '4', '5'], ['4', '9', '6']] };
  const path = (svg: string) => /class="trace" pathLength="1"[^>]*/.test(svg) && svg.match(/<path d="([^"]+)" class="trace"/)![1]!;
  const linear = path(chartSvg('L', [t as never], 'line', { curve: 'linear' }));
  const smooth = path(chartSvg('L', [t as never], 'line', { curve: 'smooth' }));
  const step = path(chartSvg('L', [t as never], 'line', { curve: 'step' }));
  assert.ok(linear && smooth && step);
  assert.doesNotMatch(linear as string, /C/);
  assert.match(smooth as string, /C/);
  assert.notEqual(step, linear);
  // `curve` overrides the legacy flag; absent options keep the old output.
  assert.equal(path(chartSvg('L', [t as never], 'line', { smooth: true, curve: 'linear' })), linear);
  assert.equal(path(chartSvg('L', [t as never], 'line', {})), linear);
  assert.ok(officeChartOptionsSchema.safeParse({ curve: 'step', animation: 'fade' }).success);
  assert.equal(officeChartOptionsSchema.safeParse({ curve: 'bezier' }).success, false);
  assert.equal(officeChartOptionsSchema.safeParse({ animation: 'spin' }).success, false);
});
