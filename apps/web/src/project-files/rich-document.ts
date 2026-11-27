import { splitRuns } from './office-layout';
import { Schema, type Mark, type Node as RichNode } from 'prosemirror-model';
import {
  type DocumentFormat,
  type FormattedRun,
  type ParagraphFormat,
  type TextStyle,
} from '@ai-xiutu/contracts';

export const documentSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'text*',
      group: 'block',
      attrs: { align: { default: null }, after: { default: null } },
      parseDOM: [{ tag: 'p' }],
      toDOM(node) {
        const rules = [
          node.attrs.align && 'text-align:' + node.attrs.align,
          node.attrs.after != null && 'margin-block-end:' + node.attrs.after + 'pt',
        ].filter(Boolean);
        return ['p', rules.length ? { style: rules.join(';') } : {}, 0];
      },
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0] },
    italic: { toDOM: () => ['em', 0] },
    underline: { toDOM: () => ['u', 0] },
    font: {
      attrs: { value: {} },
      toDOM: (mark) => ['span', { style: 'font-family:' + mark.attrs.value }, 0],
    },
    size: {
      attrs: { value: {} },
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
    ...(style.font ? [m.font!.create({ value: style.font })] : []),
    ...(style.size ? [m.size!.create({ value: style.size })] : []),
  ];
}

export function readRichDocument(body: string, formatting?: DocumentFormat | null) {
  const styles = new Map(formatting?.paragraphs.map((p) => [p.line, p]));
  const children = body.split(/\r\n?|\n/).map((text, line) => {
    const p = styles.get(line);
    return documentSchema.nodes.paragraph!.create(
      { align: p?.align ?? null, after: p?.after ?? null },
      splitRuns(text, p?.runs).map((r) => documentSchema.text(r.text, marks(r.style))),
    );
  });
  return documentSchema.nodes.doc!.create(null, children);
}

export function writeRichDocument(doc: RichNode) {
  const lines: string[] = [],
    paragraphs: ParagraphFormat[] = [];
  doc.forEach((node, _, line) => {
    lines.push(node.textContent);
    const p: ParagraphFormat = { line, runs: [] };
    if (node.attrs.align) p.align = node.attrs.align;
    if (node.attrs.after != null) p.after = node.attrs.after;
    node.forEach((text, from) => {
      if (!text.marks.length) return;
      const r: FormattedRun = { from, to: from + text.nodeSize };
      for (const mark of text.marks) {
        const name = mark.type.name;
        if (name === 'bold' || name === 'italic' || name === 'underline') r[name] = true;
        else if (name === 'font' || name === 'size') r[name] = mark.attrs.value;
      }
      p.runs.push(r);
    });
    if (p.align || p.after != null || p.runs.length) paragraphs.push(p);
  });
  return {
    body: lines.join('\n'),
    formatting: paragraphs.length ? { version: 1 as const, paragraphs } : null,
  };
}
