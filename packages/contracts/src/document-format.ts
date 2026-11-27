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
export const officeSizes = [10, 11.5, 12, 14, 16, 18] as const;
export const officeSpacing = [1, 1.15, 1.5, 2] as const;
export const officeCharts = ['bar', 'line'] as const;
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
      if (p.line <= lastLine || (!p.align && p.after === undefined && !p.runs.length)) {
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
        p.runs.length === other.runs.length &&
        p.runs.every((r, j) => {
          const o = other.runs[j]!;
          return (
            r.from === o.from &&
            r.to === o.to &&
            r.bold === o.bold &&
            r.italic === o.italic &&
            r.underline === o.underline &&
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
