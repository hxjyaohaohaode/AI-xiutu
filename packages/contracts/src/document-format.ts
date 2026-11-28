import { z } from 'zod';

export const documentFonts = [
  'Aptos',
  'Arial',
  'Georgia',
  'Courier New',
  'Microsoft YaHei',
  'SimSun',
] as const;
export const documentSizes = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const;
export const documentGaps = [0, 6, 12, 18] as const;
export const documentAlignments = ['left', 'center', 'right', 'justify'] as const;
/** Text colors: an accessible fixed palette (contrast ≥ 4.5:1 on white). */
export const documentColors = [
  '#1F2937',
  '#6B7280',
  '#B42318',
  '#B54708',
  '#027A48',
  '#175CD3',
  '#6941C6',
  '#C11574',
] as const;
/** Highlight names match the Word highlight set so DOCX export is lossless. */
export const documentHighlights = ['yellow', 'green', 'cyan', 'magenta', 'lightGray'] as const;
export const documentHighlightCss: Record<(typeof documentHighlights)[number], string> = {
  yellow: '#FEF3B5',
  green: '#D1FADF',
  cyan: '#CFF9FE',
  magenta: '#FCE7F6',
  lightGray: '#EAECF0',
};
export const documentScripts = ['super', 'sub'] as const;
/** Paragraph indent levels (0.5 inch / 36pt each) and per-paragraph line spacing. */
export const documentIndents = [1, 2, 3, 4] as const;
export const documentLineSpacing = [1, 1.15, 1.5, 2] as const;
/** Only web and mail links. Script, data and relative URLs are rejected. */
export const documentLinkPattern = /^(?:https:\/\/|http:\/\/|mailto:)[^\s<>"'\u0000-\u001f]{1,2000}$/;
export const isDocumentLink = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 2048 && documentLinkPattern.test(value);
export const officeSizes = [10, 11.5, 12, 14, 16, 18] as const;
export const officeSpacing = [1, 1.15, 1.5, 2] as const;
export const officeCharts = [
  'bar',
  'line',
  'stream',
  'sankey',
  'radar',
  'scatter3d',
  // Appended only: persisted documents index into this list by value, never by position.
  'area',
  'donut',
  'heatmap',
  'treemap',
  'funnel',
  'waterfall',
  'bar3d',
  'combo',
  'pie',
  'rose',
  'scatter',
  'gauge',
  'boxplot',
  'histogram',
  'lollipop',
  'radialbar',
  'dumbbell',
  'pyramid',
] as const;
const pageLayout = z
  .object({
    font: z.enum(documentFonts),
    size: z.union(officeSizes.map((n) => z.literal(n))),
    line: z.union(officeSpacing.map((n) => z.literal(n))),
    align: z.enum(documentAlignments),
    chart: z.enum(officeCharts),
  })
  .strict();
export type DocumentLayout = z.infer<typeof pageLayout>;
export const defaultLayout: DocumentLayout = {
  font: 'Aptos',
  size: 11.5,
  line: 1.15,
  align: 'left',
  chart: 'bar',
};
function sameLayout(a: DocumentLayout = defaultLayout, b: DocumentLayout = defaultLayout) {
  return (
    a.font === b.font &&
    a.size === b.size &&
    a.line === b.line &&
    a.align === b.align &&
    a.chart === b.chart
  );
}
export function withDocumentLayout(
  format: DocumentFormat | null | undefined,
  layout: DocumentLayout,
): DocumentFormat | null {
  const paragraphs = format?.paragraphs ?? [];
  if (sameLayout(layout, defaultLayout))
    return paragraphs.length ? { version: 1, paragraphs } : null;
  return { version: 1, paragraphs, layout };
}
const style = z
  .object({
    bold: z.literal(true).optional(),
    italic: z.literal(true).optional(),
    underline: z.literal(true).optional(),
    strike: z.literal(true).optional(),
    color: z.enum(documentColors).optional(),
    highlight: z.enum(documentHighlights).optional(),
    script: z.enum(documentScripts).optional(),
    link: z.string().max(2048).refine(isDocumentLink).optional(),
    font: z.enum(documentFonts).optional(),
    size: z
      .number()
      .int()
      .refine((n) => documentSizes.some((s) => s === n))
      .optional(),
  })
  .strict();
const run = style.extend({ from: z.number().int().nonnegative(), to: z.number().int().positive() });
const paragraph = z
  .object({
    line: z.number().int().nonnegative(),
    align: z.enum(documentAlignments).optional(),
    after: z
      .number()
      .int()
      .refine((n) => documentGaps.some((s) => s === n))
      .optional(),
    indent: z
      .number()
      .int()
      .refine((n) => documentIndents.some((s) => s === n))
      .optional(),
    spacing: z
      .number()
      .refine((n) => documentLineSpacing.some((s) => s === n))
      .optional(),
    runs: z.array(run).max(2048),
  })
  .strict();
export const documentFormatSchema = z
  .object({
    version: z.literal(1),
    paragraphs: z.array(paragraph).max(2048),
    layout: pageLayout.optional(),
  })
  .strict()
  .superRefine((format, ctx) => {
    let totalRuns = 0,
      lastLine = -1;
    for (const p of format.paragraphs) {
      totalRuns += p.runs.length;
      if (
        p.line <= lastLine ||
        (!p.align && p.after === undefined && !p.indent && !p.spacing && !p.runs.length)
      ) {
        ctx.addIssue({ code: 'custom', message: 'Invalid paragraph format' });
        return;
      }
      lastLine = p.line;
      let lastEnd = 0;
      for (const r of p.runs) {
        if (r.from < lastEnd || r.from >= r.to || Object.keys(r).length < 3) {
          ctx.addIssue({ code: 'custom', message: 'Invalid format range' });
          return;
        }
        lastEnd = r.to;
      }
    }
    if ((!format.paragraphs.length && !format.layout) || totalRuns > 4096)
      ctx.addIssue({ code: 'custom', message: 'Invalid format size' });
  });
export type DocumentFormat = z.infer<typeof documentFormatSchema>;
export type ParagraphFormat = DocumentFormat['paragraphs'][number];
export type TextStyle = z.infer<typeof style>;
export type FormattedRun = z.infer<typeof run>;
export type DocumentFont = (typeof documentFonts)[number];

/** Unstyled gaps are deliberately absent from persistent format ranges. */
export function splitDocumentRuns(text: string, ranges: FormattedRun[] = [], from = 0) {
  const out: { text: string; style: TextStyle }[] = [];
  const until = from + text.length;
  let cursor = from;
  for (const { from: first, to: last, ...style } of ranges) {
    if (first >= until) break;
    if (last <= from) continue;
    const a = Math.max(from, first), b = Math.min(until, last);
    if (a > cursor) out.push({ text: text.slice(cursor - from, a - from), style: {} });
    out.push({ text: text.slice(a - from, b - from), style });
    cursor = b;
  }
  if (cursor < until) out.push({ text: text.slice(cursor - from), style: {} });
  return out;
}

export function formatMatchesBody(body: string, format: DocumentFormat): boolean {
  const lines = body.split(/\r\n?|\n/);
  const splitsSurrogate = (s: string, i: number) =>
    i > 0 &&
    i < s.length &&
    /[\uD800-\uDBFF]/.test(s.charAt(i - 1)) &&
    /[\uDC00-\uDFFF]/.test(s.charAt(i));
  return format.paragraphs.every((p) => {
    const s = lines[p.line];
    return (
      s !== undefined &&
      p.runs.every(
        (r) => r.to <= s.length && !splitsSurrogate(s, r.from) && !splitsSurrogate(s, r.to),
      )
    );
  });
}

export function sameDocumentFormat(a?: DocumentFormat | null, b?: DocumentFormat | null): boolean {
  if (a === b || (!a && !b)) return true;
  // PostgreSQL jsonb canonicalizes object keys. Compare schema-ordered values.
  return (
    !!a &&
    !!b &&
    sameLayout(a.layout, b.layout) &&
    a.paragraphs.length === b.paragraphs.length &&
    a.paragraphs.every((p, i) => {
      const other = b.paragraphs[i]!;
      return (
        p.line === other.line &&
        p.align === other.align &&
        p.after === other.after &&
        p.indent === other.indent &&
        p.spacing === other.spacing &&
        p.runs.length === other.runs.length &&
        p.runs.every((r, j) => {
          const o = other.runs[j]!;
          return (
            r.from === o.from &&
            r.to === o.to &&
            r.bold === o.bold &&
            r.italic === o.italic &&
            r.underline === o.underline &&
            r.strike === o.strike &&
            r.color === o.color &&
            r.highlight === o.highlight &&
            r.script === o.script &&
            r.link === o.link &&
            r.font === o.font &&
            r.size === o.size
          );
        })
      );
    })
  );
}

/** A plain-text writer has no selection mapping. Retain only demonstrably unchanged paragraphs. */
export function rebaseDocumentFormat(
  before: string,
  after: string,
  format?: DocumentFormat | null,
): DocumentFormat | null {
  if (!format || before === after) return format ?? null;
  const a = before.split(/\r\n?|\n/),
    b = after.split(/\r\n?|\n/);
  let front = 0,
    back = 0;
  while (front < Math.min(a.length, b.length) && a[front] === b[front]) front++;
  while (
    back < Math.min(a.length, b.length) - front &&
    a[a.length - back - 1] === b[b.length - back - 1]
  )
    back++;
  const paragraphs = format.paragraphs.flatMap((p) =>
    p.line < front
      ? [p]
      : p.line >= a.length - back
        ? [{ ...p, line: p.line + b.length - a.length }]
        : [],
  );
  return withDocumentLayout({ version: 1, paragraphs }, format.layout ?? defaultLayout);
}
