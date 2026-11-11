import { z } from 'zod';

export const assetSources = ['upload', 'generated', 'sketch', 'derived', 'unknown'] as const;
export type AssetSource = (typeof assetSources)[number];

const assetId = z.string().uuid();
const raster = z.number().int().min(1).max(8192);
const offset = z.number().int().min(0).max(8191);
const unit = z.number().min(0).max(1);
const byte = z.number().int().min(0).max(255);
const input = z.object({ requestId: assetId, name: z.string().trim().min(1).max(120) });

export const cutoutRequest = input
  .extend({
    kind: z.literal('cutout'),
    sourceAssetId: assetId,
    settings: z
      .object({
        algorithm: z.enum(['ray-v1', 'guided-v2']).optional(),
        selection: z.unknown().refine((value) => value !== undefined),
        foreground: z.unknown().optional(),
        background: z.unknown().optional(),
        radius: z.number().min(0).max(0.05).default(0.015),
        decontaminate: unit.default(0.8),
      })
      .strict(),
  })
  .strict();

export const collageRequest = input
  .extend({
    kind: z.literal('collage'),
    width: raster,
    height: raster,
    background: z.tuple([byte, byte, byte, byte]),
    cells: z
      .array(
        z
          .object({
            assetId,
            left: offset,
            top: offset,
            width: raster,
            height: raster,
            fit: z.enum(['contain', 'cover']),
            focalX: unit.default(0.5),
            focalY: unit.default(0.5),
          })
          .strict(),
      )
      .min(2)
      .max(12),
  })
  .strict()
  .refine(
    (body) =>
      body.cells.every(
        (cell) => cell.left + cell.width <= body.width && cell.top + cell.height <= body.height,
      ),
    '拼图单元超出画布',
  );

export const restorationSettings = z
  .object({
    algorithm: z.literal('photo-restore-v1'),
    luminanceNoise: z.number().min(0).max(100),
    chromaNoise: z.number().min(0).max(100),
    motion: z
      .object({
        length: z.number().min(0).max(31),
        angle: z.number().min(-180).max(180),
        iterations: z.number().int().min(1).max(12),
        strength: unit,
      })
      .strict(),
    selection: z.unknown().optional(),
    protection: z.unknown().optional(),
  })
  .strict();
export const restorationRequest = input
  .extend({
    kind: z.literal('restoration'),
    sourceAssetId: assetId,
    settings: restorationSettings,
  })
  .strict();
export const derivedAssetRequest = z.discriminatedUnion('kind', [
  cutoutRequest,
  collageRequest,
  restorationRequest,
]);
export type DerivedAssetRequest = z.infer<typeof derivedAssetRequest>;
export type CollageRequest = z.infer<typeof collageRequest>;

export const recognitionRequest = z
  .object({
    language: z.enum(['eng', 'chi_sim', 'eng+chi_sim']).default('eng+chi_sim'),
    layout: z.enum(['auto', 'block', 'sparse', 'table']).default('auto'),
  })
  .strict();
export type RecognitionRequest = z.infer<typeof recognitionRequest>;
export type RecognizedWord = {
  text: string;
  confidence: number;
  box: { left: number; top: number; width: number; height: number };
  line: string;
};
export interface AssetRecognition {
  id: string;
  sourceHash: string;
  engine: string;
  preprocessing: 'original' | 'contrast-resampled';
  language: RecognitionRequest['language'];
  layout: RecognitionRequest['layout'];
  width: number;
  height: number;
  words: RecognizedWord[];
  text: string;
  table: { columns: number; rows: (string | null)[][] } | null;
  createdAt: string;
}

export const animationEditRequest = input
  .extend({
    frames: z.array(z.number().int().min(0).max(119)).min(2).max(120).optional(),
    delay: z.array(z.number().int().min(20).max(60_000).multipleOf(10)).min(2).max(120).optional(),
    loop: z.number().int().min(0).max(65_535).optional(),
    recipe: z.unknown().optional(),
  })
  .strict();
export type AnimationEditRequest = z.infer<typeof animationEditRequest>;
export interface AnimationDescriptor {
  width: number;
  height: number;
  frames: number;
  delay: number[];
  loop: number;
  format: 'gif';
  byteLength: number;
}
