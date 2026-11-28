import { z } from 'zod';
import { documentFonts, officeCharts } from './document-format.js';

export const slideSize = { width: 1600, height: 900 } as const;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const elementId = z.uuid();
const box = z.object({
  id: elementId,
  x: z.number().int().min(0).max(slideSize.width),
  y: z.number().int().min(0).max(slideSize.height),
  width: z.number().int().min(36).max(slideSize.width),
  height: z.number().int().min(30).max(slideSize.height),
  rotation: z.number().int().min(-180).max(180),
});
export const chartThemes = [
  'studio',
  'ocean',
  'sunset',
  'forest',
  'mono',
  'midnight',
  // Appended: older snapshots keep their names.
  'aurora',
  'candy',
  'earth',
  'corporate',
] as const;
export const chartNumberFormats = ['auto', 'thousands', 'compact', 'plain'] as const;
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const shortText = (max: number) => z.string().max(max).regex(/^[^<>\u0000-\u001f]*$/);
export const chartLegendPositions = ['top', 'bottom', 'right', 'none'] as const;
export const chartLayouts = ['grouped', 'stacked', 'percent'] as const;
/** linear: straight segments; smooth: monotone (never overshoots the data); step: value holds until the next category. */
export const chartCurves = ['linear', 'smooth', 'step'] as const;
/** auto: staggered fade, bars grow, lines draw in; fade: opacity only; none: static. Screen only, never exported. */
export const chartAnimations = ['auto', 'fade', 'none'] as const;
/**
 * Presentation options saved with a chart. Every field is optional so older
 * snapshots render unchanged; values are bounded and never contain markup.
 */
export const officeChartOptionsSchema = z
  .object({
    subtitle: z.string().max(160).optional(),
    theme: z.enum(chartThemes).optional(),
    legend: z.enum(chartLegendPositions).optional(),
    labels: z.boolean().optional(),
    grid: z.boolean().optional(),
    smooth: z.boolean().optional(),
    layout: z.enum(chartLayouts).optional(),
    orientation: z.enum(['vertical', 'horizontal']).optional(),
    sort: z.enum(['none', 'asc', 'desc']).optional(),
    decimals: z.number().int().min(0).max(4).optional(),
    xTitle: z.string().max(60).optional(),
    yTitle: z.string().max(60).optional(),
    hole: z.number().min(0).max(0.85).optional(),
    hidden: z.array(z.number().int().min(0).max(255)).max(64).optional(),
    // v3: finer control. All optional; absent values keep the v2 rendering.
    colors: z.array(hexColor).max(16).optional(),
    titleAlign: z.enum(['left', 'center']).optional(),
    background: z.enum(['theme', 'white', 'transparent']).optional(),
    numberFormat: z.enum(chartNumberFormats).optional(),
    prefix: shortText(8).optional(),
    suffix: shortText(8).optional(),
    axisMin: z.number().finite().optional(),
    axisMax: z.number().finite().optional(),
    referenceLine: z.number().finite().optional(),
    referenceLabel: shortText(40).optional(),
    average: z.boolean().optional(),
    barRadius: z.number().int().min(0).max(16).optional(),
    barWidth: z.number().min(0.2).max(1).optional(),
    lineWidth: z.number().min(1).max(8).optional(),
    markers: z.boolean().optional(),
    gradient: z.boolean().optional(),
    gaugeMax: z.number().positive().finite().optional(),
    bins: z.number().int().min(3).max(40).optional(),
    // v4: line shape and on-screen entrance. `curve` wins over the legacy `smooth`.
    curve: z.enum(chartCurves).optional(),
    animation: z.enum(chartAnimations).optional(),
  })
  .strict()
  .refine((o) => o.axisMin === undefined || o.axisMax === undefined || o.axisMin < o.axisMax, {
    message: 'axisMin must be below axisMax',
  });
export type OfficeChartOptions = z.infer<typeof officeChartOptionsSchema>;
export const officeChartSnapshotSchema = z
  .object({
    title: z.string().min(1).max(120),
    kind: z.enum(officeCharts),
    options: officeChartOptionsSchema.optional(),
    headers: z.array(z.string().max(512)).min(2).max(16),
    rows: z
      .array(z.array(z.string().max(512)).min(2).max(16))
      .min(1)
      .max(256),
    textCells: z.array(z.number().int().min(0).max(4111)).max(4096).optional(),
    source: z
      .object({ documentId: elementId, version: z.number().int().positive() })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.rows.every((row) => row.length === value.headers.length) &&
      (value.textCells ?? []).every(
        (index) => index < (value.rows.length + 1) * value.headers.length,
      ),
    { message: 'The chart has inconsistent rows' },
  );
const slideElement = z.discriminatedUnion('kind', [
  box
    .extend({
      kind: z.literal('text'),
      text: z.string().max(5000),
      color,
      font: z.enum(documentFonts),
      size: z.number().int().min(8).max(106),
      bold: z.boolean(),
      align: z.enum(['left', 'center', 'right']),
    })
    .strict(),
  box.extend({ kind: z.literal('shape'), shape: z.enum(['rectangle', 'ellipse']), color }).strict(),
  box.extend({ kind: z.literal('image'), assetId: elementId, alt: z.string().max(250) }).strict(),
  box.extend({ kind: z.literal('chart'), chart: officeChartSnapshotSchema }).strict(),
]);
export const presentationSchema = z
  .object({
    version: z.literal(1),
    slides: z
      .array(
        z
          .object({
            id: elementId,
            name: z.string().max(120),
            background: color,
            elements: z.array(slideElement).max(64),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((deck, ctx) => {
    const ids = new Set<string>();
    for (const slide of deck.slides) {
      if (ids.has(slide.id)) {
        ctx.addIssue({ code: 'custom', message: 'Duplicate slide ID' });
        return;
      }
      ids.add(slide.id);
      for (const element of slide.elements) {
        if (
          ids.has(element.id) ||
          element.x + element.width > slideSize.width ||
          element.y + element.height > slideSize.height
        ) {
          ctx.addIssue({ code: 'custom', message: 'Invalid element identity or frame' });
          return;
        }
        ids.add(element.id);
      }
    }
  });
export type PresentationDoc = z.infer<typeof presentationSchema>;
export type PresentationSlide = PresentationDoc['slides'][number];
export type SlideElement = PresentationSlide['elements'][number];
export type OfficeChartSnapshot = z.infer<typeof officeChartSnapshotSchema>;

const officeBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), text: z.string().trim().min(1).max(2500) }).strict(),
  z.object({ kind: z.literal('image'), assetId: elementId, title: z.string().max(250) }).strict(),
  z.object({ kind: z.literal('audio'), id: elementId, title: z.string().max(250) }).strict(),
  z
    .object({
      kind: z.literal('reference'),
      documentId: elementId,
      version: z.number().int().positive(),
      title: z.string().max(120),
    })
    .strict(),
  z.object({ kind: z.literal('chart'), chart: officeChartSnapshotSchema }).strict(),
]);
export type OfficeBlock = z.infer<typeof officeBlockSchema>;
export const officeBlockPrefix = '[[office:';
export function readOfficeBlock(line: string): OfficeBlock | null {
  if (!line.startsWith(officeBlockPrefix) || !line.endsWith(']]') || line.length > 80000)
    return null;
  try {
    const parsed = officeBlockSchema.safeParse(
      JSON.parse(line.slice(officeBlockPrefix.length, -2)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function writeOfficeBlock(block: OfficeBlock) {
  return officeBlockPrefix + JSON.stringify(officeBlockSchema.parse(block)) + ']]';
}

const deckHeader = '```office-deck-v1\n';
const deckEnd = '\n```';
export const isPresentationBody = (body: string) => body.startsWith(deckHeader);
export function readPresentation(body: string): PresentationDoc | null {
  if (!isPresentationBody(body) || !body.endsWith(deckEnd) || body.length > 100000) return null;
  try {
    const result = presentationSchema.safeParse(
      JSON.parse(body.slice(deckHeader.length, -deckEnd.length)),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function writePresentation(presentation: PresentationDoc): string | null {
  if (!presentationSchema.safeParse(presentation).success) return null;
  const body = deckHeader + JSON.stringify(presentation) + deckEnd;
  return body.length <= 100000 ? body : null;
}
