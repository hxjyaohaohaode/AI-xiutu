import { Schema, type Mark, type Node as RichNode } from 'prosemirror-model';
import { Step } from 'prosemirror-transform';
import { readOfficeBlock } from './office-content.js';
import {
  defaultLayout,
  documentAlignments,
  documentColors,
  documentFonts,
  documentHighlightCss,
  documentHighlights,
  documentIndents,
  documentLineSpacing,
  documentScripts,
  isDocumentLink,
  documentFormatSchema,
  documentGaps,
  documentSizes,
  formatMatchesBody,
  splitDocumentRuns,
  withDocumentLayout,
  type DocumentFormat,
  type FormattedRun,
  type ParagraphFormat,
  type TextStyle,
} from './document-format.js';

const values =
  (allowed: readonly unknown[], optional = false) =>
  (value: unknown) => {
    if (!(value === null && optional) && !allowed.includes(value))
      throw new RangeError('Invalid editor attribute');
  };

export const documentSchema = new Schema({
  nodes: {
    doc: { content: '(paragraph | office_block)+' },
    paragraph: {
      content: 'text*',
      group: 'block',
      attrs: {
        align: { default: null, validate: values(documentAlignments, true) },
        after: { default: null, validate: values(documentGaps, true) },
        indent: { default: null, validate: values(documentIndents, true) },
        spacing: { default: null, validate: values(documentLineSpacing, true) },
      },
      parseDOM: [{ tag: 'p' }],
      toDOM(node) {
        const rules = [
          node.attrs.align && 'text-align:' + node.attrs.align,
          node.attrs.after != null && 'margin-block-end:' + node.attrs.after + 'pt',
          node.attrs.indent && 'margin-inline-start:' + node.attrs.indent * 36 + 'pt',
          node.attrs.spacing && 'line-height:' + node.attrs.spacing,
        ].filter(Boolean);
        return ['p', rules.length ? { style: rules.join(';') } : {}, 0];
      },
    },
    office_block: {
      atom: true,
      group: 'block',
      attrs: {
        data: {
          validate(value: unknown) {
            if (typeof value !== 'string' || !readOfficeBlock(value))
              throw new RangeError('Invalid office block');
          },
        },
      },
      toDOM(node) {
        const block = readOfficeBlock(node.attrs.data)!;
        const attrs = {
          class: 'office-embed',
          contenteditable: 'false',
          'data-office-kind': block.kind,
        };
        if (block.kind === 'note') return ['aside', attrs, block.text];
        if (block.kind === 'image')
          return [
            'figure',
            attrs,
            ['img', { src: '/v1/assets/' + block.assetId + '/thumbnail', alt: block.title }],
          ];
        if (block.kind === 'audio')
          return [
            'figure',
            attrs,
            ['figcaption', block.title],
            [
              'audio',
              { controls: 'controls', preload: 'metadata', src: '/v1/office-audio/' + block.id },
            ],
          ];
        if (block.kind === 'reference')
          return [
            'div',
            attrs,
            [
              'button',
              {
                type: 'button',
                'data-office-reference': block.documentId,
                'data-office-version': String(block.version),
              },
              block.title,
            ],
          ];
        return ['figure', attrs, ['figcaption', block.chart.title]];
      },
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0] },
    italic: { toDOM: () => ['em', 0] },
    underline: { toDOM: () => ['u', 0] },
    strike: { toDOM: () => ['s', 0] },
    color: {
      attrs: { value: { validate: values(documentColors) } },
      // data-color lets themes remap display contrast without changing stored values.
      toDOM: (mark) => [
        'span',
        { 'data-color': mark.attrs.value, style: 'color:' + mark.attrs.value },
        0,
      ],
    },
    highlight: {
      attrs: { value: { validate: values(documentHighlights) } },
      toDOM: (mark) => [
        'mark',
        {
          'data-highlight': mark.attrs.value,
          style:
            'background-color:' +
            documentHighlightCss[mark.attrs.value as keyof typeof documentHighlightCss],
        },
        0,
      ],
    },
    script: {
      attrs: { value: { validate: values(documentScripts) } },
      excludes: 'script',
      toDOM: (mark) => [mark.attrs.value === 'super' ? 'sup' : 'sub', 0],
    },
    link: {
      attrs: {
        href: {
          validate(value: unknown) {
            if (!isDocumentLink(value)) throw new RangeError('Invalid link');
          },
        },
      },
      inclusive: false,
      toDOM: (mark) => [
        'a',
        { href: mark.attrs.href, rel: 'noopener noreferrer nofollow', target: '_blank' },
        0,
      ],
    },
    font: {
      attrs: { value: { validate: values(documentFonts) } },
      toDOM: (mark) => ['span', { style: 'font-family:' + mark.attrs.value }, 0],
    },
    size: {
      attrs: { value: { validate: values(documentSizes) } },
      toDOM: (mark) => ['span', { style: 'font-size:' + mark.attrs.value + 'pt' }, 0],
    },
  },
});

function marks(style: TextStyle): Mark[] {
  const m = documentSchema.marks;
  return [
    ...(style.bold ? [m.bold!.create()] : []),
    ...(style.italic ? [m.italic!.create()] : []),
    ...(style.underline ? [m.underline!.create()] : []),
    ...(style.strike ? [m.strike!.create()] : []),
    ...(style.color ? [m.color!.create({ value: style.color })] : []),
    ...(style.highlight ? [m.highlight!.create({ value: style.highlight })] : []),
    ...(style.script ? [m.script!.create({ value: style.script })] : []),
    ...(style.link ? [m.link!.create({ href: style.link })] : []),
    ...(style.font ? [m.font!.create({ value: style.font })] : []),
    ...(style.size ? [m.size!.create({ value: style.size })] : []),
  ];
}

export function readRichDocument(body: string, formatting?: DocumentFormat | null) {
  const styles = new Map(formatting?.paragraphs.map((p) => [p.line, p]));
  const children = body.split(/\r\n?|\n/).map((text, line) => {
    if (readOfficeBlock(text)) return documentSchema.nodes.office_block!.create({ data: text });
    const p = styles.get(line);
    return documentSchema.nodes.paragraph!.create(
      {
        align: p?.align ?? null,
        after: p?.after ?? null,
        indent: p?.indent ?? null,
        spacing: p?.spacing ?? null,
      },
      splitDocumentRuns(text, p?.runs).map((r) => documentSchema.text(r.text, marks(r.style))),
    );
  });
  return documentSchema.nodes.doc!.create(null, children);
}

export const documentMaxBody = 100000;
export const liveMaxSteps = 32;
export const liveWindow = 512;
export type SerializedStep = Record<string, unknown>;
const steps = new Set(['replace', 'replaceAround', 'addMark', 'removeMark', 'attr']);
export const restoreDocumentStep = (step: SerializedStep) => Step.fromJSON(documentSchema, step);

export function validatedRichContent(doc: RichNode, formatting?: DocumentFormat | null) {
  doc.check();
  const { body, formatting: runs } = writeRichDocument(doc);
  const style = withDocumentLayout(runs, formatting?.layout ?? defaultLayout);
  if (
    body.length > documentMaxBody ||
    /[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(body) ||
    (style &&
      (!documentFormatSchema.safeParse(style).success || !formatMatchesBody(body, style))) ||
    !doc.eq(readRichDocument(body, style))
  )
    throw new RangeError('Invalid document content');
  return { body, formatting: style };
}

export function applyDocumentSteps(
  body: string,
  formatting: DocumentFormat | null,
  updates: SerializedStep[],
) {
  if (!updates.length || updates.length > liveMaxSteps) throw new RangeError('Invalid step count');
  let doc = readRichDocument(body, formatting);
  for (const update of updates) {
    if (
      !steps.has(String(update.stepType)) ||
      ['from', 'to', 'gapFrom', 'gapTo', 'insert', 'pos'].some(
        (key) =>
          Object.hasOwn(update, key) && (!Number.isInteger(update[key]) || Number(update[key]) < 0),
      )
    )
      throw new RangeError('Invalid editor step');
    const applied = restoreDocumentStep(update).apply(doc);
    if (applied.failed || !applied.doc) throw new RangeError('Editor step does not apply');
    doc = applied.doc;
    if (doc.content.size > documentMaxBody * 2 + 2)
      throw new RangeError('Document size exceeds limit');
  }
  return validatedRichContent(doc, formatting);
}

export function writeRichDocument(doc: RichNode) {
  const lines: string[] = [],
    paragraphs: ParagraphFormat[] = [];
  doc.forEach((node, _, line) => {
    if (node.type.name === 'office_block') {
      lines.push(node.attrs.data);
      return;
    }
    lines.push(node.textContent);
    const p: ParagraphFormat = { line, runs: [] };
    if (node.attrs.align) p.align = node.attrs.align;
    if (node.attrs.after != null) p.after = node.attrs.after;
    if (node.attrs.indent != null) p.indent = node.attrs.indent;
    if (node.attrs.spacing != null) p.spacing = node.attrs.spacing;
    node.forEach((text, from) => {
      if (!text.marks.length) return;
      const r: FormattedRun = { from, to: from + text.nodeSize };
      for (const mark of text.marks) {
        const name = mark.type.name;
        if (name === 'bold' || name === 'italic' || name === 'underline' || name === 'strike')
          r[name] = true;
        else if (name === 'link') r.link = mark.attrs.href;
        else if (
          name === 'font' ||
          name === 'size' ||
          name === 'color' ||
          name === 'highlight' ||
          name === 'script'
        )
          (r as Record<string, unknown>)[name] = mark.attrs.value;
      }
      p.runs.push(r);
    });
    if (p.align || p.after != null || p.indent != null || p.spacing != null || p.runs.length)
      paragraphs.push(p);
  });
  return {
    body: lines.join('\n'),
    formatting: paragraphs.length ? { version: 1 as const, paragraphs } : null,
  };
}
