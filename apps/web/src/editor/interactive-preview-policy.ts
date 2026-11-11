import type { EditorRecipe } from '@ai-xiutu/editor';
import { INTERACTIVE_PREVIEW_PIXELS } from './previewBudget';

export type PreviewFamily = 'color' | 'detail' | 'geometry' | 'warp' | 'spatial';
export const MAX_INTERACTIVE_SOURCE_PIXELS = 262_144;

/** Display budgets only. Every frame still runs the reference recipe pipeline. */
export const INTERACTIVE_POLICY = Object.freeze({
  idleMs: 800,
  slowMs: 48,
  severeMs: 96,
  fastMs: 18,
  slowFrames: 2,
  fastFrames: 4,
  recoveryCooldownMs: 240,
  budgets: {
    color: { minimum: 32_768, initial: INTERACTIVE_PREVIEW_PIXELS, maximum: 131_072 },
    detail: { minimum: 65_536, initial: INTERACTIVE_PREVIEW_PIXELS, maximum: 131_072 },
    geometry: { minimum: 131_072, initial: INTERACTIVE_PREVIEW_PIXELS, maximum: 262_144 },
    warp: { minimum: 65_536, initial: INTERACTIVE_PREVIEW_PIXELS, maximum: 262_144 },
    spatial: { minimum: 65_536, initial: INTERACTIVE_PREVIEW_PIXELS, maximum: 262_144 },
  },
});

type Data = Record<string, unknown>;
const data = (value: unknown): Data => (value && typeof value === 'object' ? (value as Data) : {});
function colorBlocks(recipe: EditorRecipe): Data[] {
  const blocks = [data(recipe), data(recipe.local)];
  if (recipe.schemaVersion !== 1) blocks.push(...recipe.regions.map(data));
  if (recipe.schemaVersion === 3 || recipe.schemaVersion === 4)
    blocks.push(
      ...recipe.regionEdits.map((item) => data(item.color)),
      ...recipe.regionGroups.map((item) => data(item.color)),
    );
  return blocks;
}

/** Classify the actual changed data, so existing expensive stages do not label
 * every later exposure adjustment as another warp/repair operation. The walk
 * is bounded; a large changed brush is conservatively treated as spatial. */
export function previewFamily(
  previous: EditorRecipe | null,
  next: EditorRecipe,
  fallback: PreviewFamily = 'color',
): PreviewFamily {
  if (!previous || previous.schemaVersion !== next.schemaVersion) {
    if (
      (next.schemaVersion === 3 || next.schemaVersion === 4) &&
      next.warp.enabled &&
      next.warp.strokes.length
    )
      return 'warp';
    if (next.schemaVersion === 4 && (next.healing.length || next.retouch.length)) return 'spatial';
    return 'color';
  }
  let remaining = 16_384;
  const same = (a: unknown, b: unknown): boolean => {
    if (--remaining < 0) return false;
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
      return true;
    }
    if (Array.isArray(b)) return false;
    const left = data(a),
      right = data(b),
      keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
    );
  };
  const before = data(previous),
    after = data(next);
  if (['geometry', 'transform', 'projective'].some((key) => !same(before[key], after[key])))
    return 'geometry';
  const left = colorBlocks(previous),
    right = colorBlocks(next);
  if (left.length !== right.length) return 'spatial';
  for (let i = 0; i < left.length; i++) {
    const a = left[i]!,
      b = right[i]!;
    if (
      !same(data(a.adjustments).sharpness, data(b.adjustments).sharpness) ||
      !same(data(a.adjustments).soften, data(b.adjustments).soften) ||
      !same(a.detail, b.detail) ||
      !same(a.optics, b.optics) ||
      !same(data(a.effects).grain, data(b.effects).grain)
    )
      return 'detail';
    if (
      ['adjustments', 'curves', 'levels', 'hsl', 'grading', 'effects'].some(
        (key) => !same(a[key], b[key]),
      )
    )
      return 'color';
  }
  if (!same(before.warp, after.warp)) return 'warp';
  if (
    [
      'healing',
      'retouch',
      'paintLayers',
      'imageLayers',
      'regions',
      'regionEdits',
      'regionGroups',
      'local',
    ].some((key) => !same(before[key], after[key]))
  )
    return 'spatial';
  return fallback;
}

export type PreviewFramePlan = Readonly<{
  family: PreviewFamily;
  pixels: number;
  startedAt: number;
}>;

/** Hysteresis prevents oscillation; a previous operation or stale completion
 * cannot permanently reduce the next tool's resolution. Idle is measured from
 * the last completion, not from its start, so a slow frame is not mistaken for rest. */
export class InteractivePreviewPolicy {
  private family: PreviewFamily | null = null;
  private pixels = INTERACTIVE_PREVIEW_PIXELS;
  private endedAt: number | null = null;
  private adaptedAt = -Infinity;
  private fast = 0;
  private slow = 0;
  private active: PreviewFramePlan | null = null;

  reset() {
    this.family = null;
    this.pixels = INTERACTIVE_PREVIEW_PIXELS;
    this.endedAt = null;
    this.adaptedAt = -Infinity;
    this.fast = this.slow = 0;
    this.active = null;
  }

  begin(family: PreviewFamily, now: number): PreviewFramePlan {
    const budget = INTERACTIVE_POLICY.budgets[family];
    if (
      this.family !== family ||
      this.endedAt === null ||
      now - this.endedAt >= INTERACTIVE_POLICY.idleMs ||
      now < this.endedAt
    ) {
      this.pixels = budget.initial;
      this.fast = this.slow = 0;
      this.adaptedAt = now;
    }
    this.family = family;
    this.active = Object.freeze({ family, pixels: this.pixels, startedAt: now });
    return this.active;
  }

  complete(frame: PreviewFramePlan, elapsedMs: number, endedAt: number) {
    if (
      this.active !== frame ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs < 0 ||
      !Number.isFinite(endedAt) ||
      endedAt < frame.startedAt
    )
      return;
    this.active = null;
    this.endedAt = endedAt;
    const budget = INTERACTIVE_POLICY.budgets[frame.family];
    this.slow = elapsedMs > INTERACTIVE_POLICY.slowMs ? this.slow + 1 : 0;
    this.fast = elapsedMs < INTERACTIVE_POLICY.fastMs ? this.fast + 1 : 0;
    if (elapsedMs > INTERACTIVE_POLICY.severeMs || this.slow >= INTERACTIVE_POLICY.slowFrames) {
      this.pixels = Math.max(budget.minimum, this.pixels / 2);
      this.fast = this.slow = 0;
      this.adaptedAt = endedAt;
    } else if (
      this.fast >= INTERACTIVE_POLICY.fastFrames &&
      endedAt - this.adaptedAt >= INTERACTIVE_POLICY.recoveryCooldownMs
    ) {
      this.pixels = Math.min(budget.maximum, this.pixels * 2);
      this.fast = this.slow = 0;
      this.adaptedAt = endedAt;
    }
  }
}
