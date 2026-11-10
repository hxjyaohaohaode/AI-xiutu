import {
  createColorBlockV3,
  createAdjustmentRegionV3,
  parseEditorRecipe,
  createRetouchRegionV4,
  type LayeredRecipe,
  type RetouchRegionV4,
  type HealingOperationV4,
  type Point,
  type SelectionMaskV3,
  type PaintLayerV3,
  type WarpStrokeV3,
  type AdjustmentRegionV3,
  type OperationOriginV3,
} from '@ai-xiutu/editor';
import { PORTRAIT_TOOLS } from './catalog.js';
import { center, unit, combine, facialMasks, facialMasksV4, polygon } from './geometry.js';
import { validatePortraitAnalysis, copyPortraitData } from './validation.js';
import type { PortraitAnalysis, PortraitTarget, PortraitValues } from './types.js';

const MODULE = 'portrait.basic.v1';
const MODULE_V4 = 'portrait.basic.v2';
const automatic = (moduleId: string | undefined) => moduleId === MODULE || moduleId === MODULE_V4;
function parseLayeredRecipe(input: unknown): LayeredRecipe {
  const parsed = parseEditorRecipe(input);
  if (parsed.schemaVersion !== 3 && parsed.schemaVersion !== 4)
    throw new Error('Portrait primitives require Recipe v3 or v4');
  return parsed;
}
export type MakeupColor = [number, number, number, number];
export interface PortraitApplyOptions {
  makeupColors?: Partial<Record<string, MakeupColor>>;
}
const catalog = new Map(PORTRAIT_TOOLS.map((t) => [t.id, t]));
const skinSpotTools = ['skinShine', 'skinBlemish', 'skinColorSpot'];
type OwnedPrimitive =
  AdjustmentRegionV3 | PaintLayerV3 | WarpStrokeV3 | RetouchRegionV4 | HealingOperationV4;
const sealKeys = [
  'portraitSealVersion',
  'portraitSeal0',
  'portraitSeal1',
  'portraitSeal2',
  'portraitSeal3',
];
const belongsTo = (item: { origin?: OperationOriginV3 }, targetId: string) =>
  automatic(item.origin?.moduleId) && item.origin?.instanceId === targetId;
function ownedPrimitives(recipe: LayeredRecipe, targetId: string): OwnedPrimitive[] {
  return [
    ...recipe.regionEdits,
    ...recipe.paintLayers,
    ...recipe.warp.strokes,
    ...(recipe.schemaVersion === 4 ? [...recipe.healing, ...recipe.retouch] : []),
  ].filter((item) => belongsTo(item, targetId));
}
/** A deterministic accidental-edit checksum, not an authorization or cryptographic signature. */
function targetSeal(recipe: LayeredRecipe, targetId: string): number[] {
  const withoutSeal = (item: OwnedPrimitive) => ({
    ...item,
    origin: {
      ...item.origin!,
      parameters: Object.fromEntries(
        Object.entries(item.origin!.parameters ?? {}).filter(([key]) => !sealKeys.includes(key)),
      ),
    },
  });
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, v]) => [key, stable(v)]),
      );
    return value;
  };
  const text = JSON.stringify(
    stable({
      regions: recipe.regionEdits.filter((i) => belongsTo(i, targetId)).map(withoutSeal),
      paints: recipe.paintLayers.filter((i) => belongsTo(i, targetId)).map(withoutSeal),
      warps: recipe.warp.strokes.filter((i) => belongsTo(i, targetId)).map(withoutSeal),
      ...(recipe.schemaVersion === 4 && recipe.retouch.some((i) => belongsTo(i, targetId))
        ? { retouch: recipe.retouch.filter((i) => belongsTo(i, targetId)).map(withoutSeal) }
        : {}),
      ...(recipe.schemaVersion === 4 && recipe.healing.some((i) => belongsTo(i, targetId))
        ? { healing: recipe.healing.filter((i) => belongsTo(i, targetId)).map(withoutSeal) }
        : {}),
    }),
  );
  let first = 0x811c9dc5,
    second = 5381;
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i), 0x01000193);
    second = Math.imul(second, 33) ^ text.charCodeAt(i);
  }
  return [first & 0xffff, first >>> 16, second & 0xffff, second >>> 16];
}
function assertAutomaticPrimitivesIntact(recipe: LayeredRecipe, targetId: string) {
  const items = ownedPrimitives(recipe, targetId);
  if (!items.length) return;
  const checksum = targetSeal(recipe, targetId);
  if (
    items.some((item) => {
      const p = item.origin!.parameters;
      return p?.portraitSealVersion !== 1 || checksum.some((v, i) => p[`portraitSeal${i}`] !== v);
    })
  )
    throw new Error(
      '该人物的自动图层已被手动修改，或缺少精修校验标记。请先“转为独立精修”，再新增自动效果，避免覆盖已有修改。',
    );
}
function sealAutomaticPrimitives(recipe: LayeredRecipe, targetId: string): LayeredRecipe {
  const checksum = targetSeal(recipe, targetId);
  for (const item of ownedPrimitives(recipe, targetId))
    item.origin!.parameters = {
      ...item.origin!.parameters,
      portraitSealVersion: 1,
      ...Object.fromEntries(checksum.map((n, i) => [`portraitSeal${i}`, n])),
    };
  return parseLayeredRecipe(recipe);
}
/** Existing primitives retain their position relative to manual layers during slider updates. */
function replaceOwned<T extends OwnedPrimitive>(
  existing: T[],
  created: T[],
  targetId: string,
): T[] {
  const remaining = new Map(created.map((item) => [item.id, item]));
  const merged: T[] = [];
  for (const item of existing) {
    if (!belongsTo(item, targetId)) merged.push(item);
    else {
      const next = remaining.get(item.id);
      if (next) {
        merged.push(next);
        remaining.delete(item.id);
      }
    }
  }
  return [...merged, ...remaining.values()];
}
/** Freeze a whole semantic target into independent editable primitives without changing any pixels. */
export function detachPortraitTarget<T extends LayeredRecipe>(recipeInput: T, targetId: string): T {
  const recipe = parseLayeredRecipe(recipeInput),
    ids = new Set(
      [
        ...recipe.regionEdits,
        ...recipe.paintLayers,
        ...recipe.imageLayers,
        ...recipe.warp.strokes,
        ...(recipe.schemaVersion === 4 ? [...recipe.healing, ...recipe.retouch] : []),
      ].map((item) => item.id),
    );
  const detach = <T extends { id: string; origin?: OperationOriginV3 }>(item: T): T => {
    if (!automatic(item.origin?.moduleId) || item.origin?.instanceId !== targetId) return item;
    const prefix = `manual-${item.id.slice(0, 100)}`;
    let n = 1;
    while (ids.has(`${prefix}-${n}`)) n++;
    const id = `${prefix}-${n}`;
    ids.add(id);
    return { ...item, id, origin: { ...item.origin, moduleId: 'portrait.manual.v1' } };
  };
  return parseLayeredRecipe({
    ...recipe,
    regionEdits: recipe.regionEdits.map(detach),
    paintLayers: recipe.paintLayers.map(detach),
    warp: { ...recipe.warp, strokes: recipe.warp.strokes.map(detach) },
    ...(recipe.schemaVersion === 4
      ? { healing: recipe.healing.map(detach), retouch: recipe.retouch.map(detach) }
      : {}),
  }) as T;
}
export function portraitValues(recipe: LayeredRecipe, targetId: string): PortraitValues {
  const safe = parseLayeredRecipe(recipe),
    values: PortraitValues = {};
  for (const item of ownedPrimitives(safe, targetId)) {
    if (!automatic(item.origin?.moduleId) || item.origin?.instanceId !== targetId) continue;
    for (const [key, value] of Object.entries(item.origin.parameters ?? {})) {
      const tool = catalog.get(key);
      if (tool && value >= tool.min && value <= tool.max) values[key] = value;
    }
  }
  return values;
}
export function portraitMakeupColors(
  recipe: LayeredRecipe,
  targetId: string,
): Partial<Record<string, MakeupColor>> {
  const result: Partial<Record<string, MakeupColor>> = {};
  for (const layer of parseLayeredRecipe(recipe).paintLayers) {
    const origin = layer.origin;
    if (
      !automatic(origin?.moduleId) ||
      origin?.instanceId !== targetId ||
      catalog.get(origin.parameterId)?.group !== 'makeup'
    )
      continue;
    const p = origin.parameters;
    if (
      p &&
      ['makeupR', 'makeupG', 'makeupB', 'makeupA'].every(
        (k) => p[k] !== undefined && p[k]! >= 0 && p[k]! <= 255 && Number.isInteger(p[k]),
      )
    )
      result[origin.parameterId] = [p.makeupR!, p.makeupG!, p.makeupB!, p.makeupA!];
    else if (layer.strokes[0]) result[origin.parameterId] = [...layer.strokes[0].color];
  }
  return result;
}
const bounded = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
function validateValues(input: PortraitValues, kind: PortraitTarget['kind']): PortraitValues {
  const copied = copyPortraitData(input);
  if (!copied || typeof copied !== 'object' || Array.isArray(copied))
    throw new Error('人像参数必须是普通键值对象。');
  const values: PortraitValues = {};
  for (const [key, n] of Object.entries(copied)) {
    const tool = catalog.get(key);
    if (
      !tool ||
      tool.target !== kind ||
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < tool.min ||
      n > tool.max
    )
      throw new Error(`人像参数 ${key} 超出已注册范围。`);
    values[key] = n;
  }
  return values;
}
function validateColor(input: unknown): MakeupColor {
  const color = copyPortraitData(input);
  if (
    !Array.isArray(color) ||
    color.length !== 4 ||
    color.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255)
  )
    throw new Error('妆容颜色必须是有效RGBA8。');
  return [...color] as MakeupColor;
}
const bodyRequirements: Record<string, number[]> = {
  headSize: [7, 8, 11, 12],
  neckLength: [7, 8, 11, 12],
  neckWidth: [7, 8, 11, 12],
  shoulders: [11, 12],
  arms: [11, 12, 13, 14, 15, 16],
  waist: [11, 12, 23, 24],
  hips: [11, 12, 23, 24],
  legLength: [11, 12, 23, 24, 25, 26, 27, 28],
  legs: [11, 12, 23, 24, 25, 26, 27, 28],
  height: [11, 12, 23, 24, 25, 26, 27, 28],
};
export interface PortraitToolAvailability {
  id: string;
  available: boolean;
  reason: string | null;
}
export function portraitToolAvailability(
  analysis: PortraitAnalysis,
  targetId: string,
  schemaVersion: 3 | 4 = 4,
): PortraitToolAvailability[] {
  if (schemaVersion !== 3 && schemaVersion !== 4) throw new Error('未支持的人像配方版本。');
  const safe = validatePortraitAnalysis(analysis),
    target = safe.targets.find((t) => t.id === targetId);
  if (!target) throw new Error('人物不属于当前分析结果。');
  return PORTRAIT_TOOLS.filter((t) => t.target === target.kind).map((tool) => {
    let reason: string | null = null;
    if (schemaVersion === 3 && skinSpotTools.includes(tool.id)) {
      reason = '该参数需要 V4 人像配方。';
    } else if (schemaVersion === 4 && tool.id === 'neckLength') {
      reason =
        '自动颈长暂不可用：耳肩锚点不足以保护面部与肩膀，尚未实现头颈分区和受约束网格。可使用手动液化并设置保护区。';
    } else if (target.kind === 'body') {
      const required = bodyRequirements[tool.id] ?? [];
      if (
        required.some(
          (i) =>
            !target.landmarks[i] ||
            (target.landmarks[i]!.visibility ?? 0) < 0.5 ||
            target.landmarks[i]!.x < 0 ||
            target.landmarks[i]!.x > 1 ||
            target.landmarks[i]!.y < 0 ||
            target.landmarks[i]!.y > 1,
        )
      )
        reason = '该操作所需身体关键点不可见，请手动液化或换图。';
    } else if (
      ['oval', 'leftEye', 'rightEye', 'leftBrow', 'rightBrow', 'lips'].some(
        (k) => (target.contours[k]?.length ?? 0) < 3,
      )
    )
      reason = '面部轮廓不完整；请重新分析或使用手动区域。';
    return { id: tool.id, available: reason === null, reason };
  });
}
/** Compile semantic controls into ordinary deterministic V3 primitives, replacing this target's prior operations. */
export function applyPortraitValues<T extends LayeredRecipe>(
  recipeInput: T,
  analysisInput: PortraitAnalysis,
  targetId: string,
  input: PortraitValues,
  color: MakeupColor = [178, 66, 86, 255],
  options: PortraitApplyOptions = {},
): T {
  const recipe = parseLayeredRecipe(recipeInput),
    analysis = validatePortraitAnalysis(analysisInput);
  const found = analysis.targets.find((t) => t.id === targetId);
  if (!found) throw new Error('人物已不在当前分析结果中，请重新选择。');
  const target: PortraitTarget = found,
    values = validateValues(input, target.kind),
    defaultColor = validateColor(color);
  assertAutomaticPrimitivesIntact(recipe, targetId);
  const unavailable = portraitToolAvailability(analysis, targetId, recipe.schemaVersion).find(
    (t) => !t.available && (values[t.id] ?? 0) !== 0,
  );
  if (unavailable) throw new Error(unavailable.reason!);
  const makeupColors = portraitMakeupColors(recipe, targetId);
  const requested = copyPortraitData(options);
  if (
    !requested ||
    typeof requested !== 'object' ||
    Array.isArray(requested) ||
    Object.keys(requested).some((k) => k !== 'makeupColors')
  )
    throw new Error('人像选项无效。');
  const requestedColors = (requested as Record<string, unknown>).makeupColors;
  if (requestedColors !== undefined) {
    if (!requestedColors || typeof requestedColors !== 'object' || Array.isArray(requestedColors))
      throw new Error('妆容颜色选项必须是普通键值对象。');
    for (const [key, shade] of Object.entries(requestedColors)) {
      if (catalog.get(key)?.group !== 'makeup' || !shade) throw new Error('未注册的妆容颜色字段。');
      makeupColors[key] = validateColor(shade);
    }
  }
  const provenance = (
    parameterId: string,
    value: number,
    shade?: MakeupColor,
  ): OperationOriginV3 => ({
    moduleId: recipe.schemaVersion === 4 ? MODULE_V4 : MODULE,
    instanceId: target.id,
    parameterId,
    value,
    parameters: {
      ...values,
      ...(shade
        ? { makeupR: shade[0], makeupG: shade[1], makeupB: shade[2], makeupA: shade[3] }
        : {}),
    },
  });
  const prefix = `p-${target.id}-`,
    owned = (item: { origin?: OperationOriginV3 }) =>
      automatic(item.origin?.moduleId) && item.origin?.instanceId === target.id;
  if (Object.values(values).every((n) => n === 0)) {
    return parseLayeredRecipe({
      ...recipe,
      regionEdits: recipe.regionEdits.filter((i) => !owned(i)),
      paintLayers: recipe.paintLayers.filter((i) => !owned(i)),
      warp: { ...recipe.warp, strokes: recipe.warp.strokes.filter((i) => !owned(i)) },
      ...(recipe.schemaVersion === 4
        ? {
            healing: recipe.healing.filter((i) => !owned(i)),
            retouch: recipe.retouch.filter((i) => !owned(i)),
          }
        : {}),
    }) as T;
  }
  const regions: AdjustmentRegionV3[] = [],
    paints: PaintLayerV3[] = [],
    warps: WarpStrokeV3[] = [],
    retouches: RetouchRegionV4[] = [],
    value = (id: string) => (values[id] ?? 0) / 100;
  const useFlowWarp =
    recipe.schemaVersion === 4 &&
    (!recipe.warp.strokes.some((s) => belongsTo(s, targetId)) ||
      recipe.warp.strokes.some((s) => belongsTo(s, targetId) && s.algorithm === 'flow-v1'));
  const dims = analysis.frame,
    short = Math.min(dims.width, dims.height);
  const px = (p: Point) => ({ x: p.x * dims.width, y: p.y * dims.height });
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const add = (p: Point, x: number, y: number) => ({
    x: p.x + x / dims.width,
    y: p.y + y / dims.height,
  });
  function region(
    id: string,
    name: string,
    mask: SelectionMaskV3,
    block: ReturnType<typeof createColorBlockV3>,
  ) {
    regions.push({
      ...createAdjustmentRegionV3({
        id: prefix + id,
        name: `${target.label} · ${name}`,
        mask,
        color: block,
      }),
      origin: provenance(id, values[id] ?? 0),
    });
  }
  function warp(
    id: string,
    mode: WarpStrokeV3['mode'],
    from: Point,
    to: Point,
    radius: number,
    strength: number,
  ) {
    if (Math.abs(strength) < 1e-8) return;
    warps.push({
      id: prefix + id,
      ...(useFlowWarp ? { algorithm: 'flow-v1' as const } : {}),
      mode,
      from: { x: unit(from.x), y: unit(from.y) },
      to: { x: unit(to.x), y: unit(to.y) },
      radius: bounded(radius, 0.00001, 0.75),
      feather: 0.7,
      strength: bounded(strength, -1, 1),
      origin: provenance(id.replace(/-\d+$/, ''), strength * 100),
    });
  }
  function push(id: string, p: Point, dxPx: number, dyPx: number, r: number, strength: number) {
    warp(id, 'push', p, add(p, dxPx, dyPx), r, strength);
  }
  if (target.kind === 'face') {
    const masks =
        recipe.schemaVersion === 4
          ? facialMasksV4(target, analysis.segmentation?.skin ?? null, dims)
          : facialMasks(target, analysis.segmentation?.skin ?? null),
      skin = createColorBlockV3();
    skin.adjustments.soften = value('smooth') * 75;
    skin.adjustments.exposure = value('skinLight') * 0.7;
    skin.adjustments.temperature = value('skinWarmth') * 35;
    skin.adjustments.tint = value('complexion') * 14;
    skin.adjustments.vibrance = value('complexion') * 12;
    skin.detail.texture = bounded(value('texture') * 70 - value('wrinkles') * 65, -100, 100);
    skin.detail.clarity = -value('even') * 20;
    skin.optics.denoiseChroma = value('even') * 60;
    if (recipe.schemaVersion === 4) {
      // Versioned dedicated signal operators replace the old shared texture/soften approximation.
      skin.adjustments.soften = 0;
      skin.detail.texture = 0;
      skin.detail.clarity = 0;
      skin.optics.denoiseChroma = 0;
      if (['smooth', 'texture', 'wrinkles', 'even', ...skinSpotTools].some((key) => value(key) !== 0)) {
        const previous = recipe.retouch.find((item) => item.id === prefix + 'skin-retouch' && belongsTo(item, targetId));
        const useSpotControls = skinSpotTools.some((key) => value(key) !== 0);
        const algorithm =
          previous?.algorithm ??
          (ownedPrimitives(recipe, targetId).length === 0 ? 'guided-v4' : undefined);
        const radius = Math.max(0.000001, Math.min(0.1,
          Math.min(target.bounds.width * dims.width, target.bounds.height * dims.height) * 0.025 / short));
        const spot = {
          shine: values.skinShine ?? 0,
          speckle: values.skinBlemish ?? 0,
          chromaSpots: values.skinColorSpot ?? 0,
        };
        retouches.push(
          createRetouchRegionV4({
            id: prefix + 'skin-retouch',
            name: `${target.label} · 皮肤质感`,
            origin: provenance('skin-retouch', 0),
            // Existing automatic targets retain their saved pixel algorithm;
            // a new target opts into the versioned guided implementation.
            ...(algorithm ? { algorithm } : {}),
            mask: masks.skin,
            radius,
            smoothing: values.smooth ?? 0,
            texture: values.texture ?? 0,
            uniformity: values.even ?? 0,
            fineLines: values.wrinkles ?? 0,
            ...(algorithm === 'guided-v4' && useSpotControls ? spot : {}),
          }),
        );
        if (algorithm !== 'guided-v4' && useSpotControls) {
          retouches.push(createRetouchRegionV4({ id: prefix + 'skin-spots', name: `${target.label} · 局部色斑与反光`,
            origin: provenance('skin-spots', 0), algorithm: 'guided-v4', mask: masks.skin, radius, ...spot }));
        }
      }
    }
    if (
      ['smooth', 'skinLight', 'skinWarmth', 'complexion', 'texture', 'wrinkles', 'even'].some(
        (k) => value(k) !== 0,
      )
    )
      region('skin', '皮肤', masks.skin, skin);
    const le = center(target.contours.leftEye!),
      re = center(target.contours.rightEye!),
      lips = center(target.contours.lips!);
    let left = le.x < re.x ? le : re,
      right = le.x < re.x ? re : le;
    const delta = { x: (right.x - left.x) * dims.width, y: (right.y - left.y) * dims.height },
      length = Math.hypot(delta.x, delta.y);
    if (length < 2) throw new Error('双眼间距过小，无法稳定确定面部方向。');
    let ux = delta.x / length,
      uy = delta.y / length,
      vx = -uy,
      vy = ux;
    // Mouth position orients the face's vertical axis, including sideways/upside-down portraits.
    const eyeMid = mid(le, re);
    if ((lips.x - eyeMid.x) * dims.width * vx + (lips.y - eyeMid.y) * dims.height * vy < 0) {
      [left, right] = [right, left];
      ux = -ux;
      uy = -uy;
      vx = -vx;
      vy = -vy;
    }
    const centerPoint = center(target.contours.oval!),
      centerPx = px(centerPoint),
      positions = target.contours.oval!.map((p) => {
        const q = px(p);
        return {
          u: (q.x - centerPx.x) * ux + (q.y - centerPx.y) * uy,
          v: (q.x - centerPx.x) * vx + (q.y - centerPx.y) * vy,
        };
      });
    const minU = Math.min(...positions.map((p) => p.u)),
      maxU = Math.max(...positions.map((p) => p.u)),
      minV = Math.min(...positions.map((p) => p.v)),
      maxV = Math.max(...positions.map((p) => p.v)),
      fw = maxU - minU,
      fh = maxV - minV;
    const c = add(
      centerPoint,
      (ux * (minU + maxU)) / 2 + (vx * (minV + maxV)) / 2,
      (uy * (minU + maxU)) / 2 + (vy * (minV + maxV)) / 2,
    );
    const anchor = (x: number, y: number) =>
        add(c, ux * fw * x + vx * fh * y, uy * fw * x + vy * fh * y),
      axisOffset = (p: Point, h: number, v: number) => add(p, ux * h + vx * v, uy * h + vy * v);
    const oval = (p: Point, rx: number, ry: number, feather = 0.6): SelectionMaskV3 =>
      polygon(
        Array.from({ length: 20 }, (_, i) =>
          axisOffset(p, Math.cos((i * Math.PI) / 10) * rx, Math.sin((i * Math.PI) / 10) * ry),
        ),
        (Math.min(rx, ry) * feather) / short,
      );
    const eyeMasks = [le, re].map((p) =>
      oval(axisOffset(p, 0, fh * 0.065), fw * 0.18, fh * 0.055, 0.8),
    );
    if (value('underEye'))
      region(
        'underEye',
        '眼下明暗',
        combine('union', eyeMasks),
        createColorBlockV3({ adjustments: { exposure: value('underEye') * 0.6 } }),
      );
    if (value('eyeLight'))
      region(
        'eyeLight',
        '眼部',
        masks.eyes,
        createColorBlockV3({
          adjustments: {
            exposure: value('eyeLight') * 0.4,
            sharpness: Math.max(0, value('eyeLight')) * 30,
          },
        }),
      );
    if (value('browDetail'))
      region(
        'browDetail',
        '眉毛',
        masks.brows,
        createColorBlockV3({
          adjustments: { contrast: value('browDetail') * 35 },
          detail: { texture: value('browDetail') * 45 },
        }),
      );
    const nose = target.landmarks[1]!;
    if (value('sculpt'))
      region(
        'sculpt',
        '鼻梁光影',
        oval(axisOffset(nose, 0, -fh * 0.12), fw * 0.1, fh * 0.22, 0.9),
        createColorBlockV3({ adjustments: { exposure: value('sculpt') * 0.5 } }),
      );
    const radius = fw / short;
    const bilateral = (id: string, y: number, x: number, r: number) => {
      for (const side of [-1, 1]) {
        const p = anchor(side * x, y);
        push(
          `${id}-${side === -1 ? 0 : 1}`,
          p,
          -side * ux * fw * 0.13,
          -side * uy * fw * 0.13,
          radius * r,
          value(id),
        );
      }
    };
    bilateral('faceSlim', 0.1, 0.42, 0.4);
    bilateral('faceNarrow', 0, 0.43, 0.3);
    bilateral('vFace', 0.3, 0.28, 0.3);
    bilateral('cheekbones', 0.03, 0.4, 0.2);
    // Blend the jaw into the cheek/chin instead of concentrating a large shift
    // inside a small disc, which creates an unnatural S-shaped contour.
    bilateral('jaw', 0.29, 0.34, useFlowWarp ? 0.38 : 0.22);
    warp('faceSmall', 'pinch', c, c, radius * 0.6, value('faceSmall') * 0.35);
    for (const [i, side] of [-1, 1].entries()) {
      const p = anchor(side * 0.43, -0.23);
      warp(`temples-${i}`, 'bulge', p, p, radius * 0.2, value('temples') * 0.3);
    }
    push('chin', anchor(0, 0.47), vx * fh * 0.12, vy * fh * 0.12, radius * 0.28, value('chin'));
    push(
      'forehead',
      anchor(0, -0.42),
      -vx * fh * 0.1,
      -vy * fh * 0.1,
      radius * 0.38,
      value('forehead'),
    );
    for (const [i, p] of [left, right].entries()) {
      warp(`eyeSize-${i}`, 'bulge', p, p, radius * 0.17, value('eyeSize') * 0.35);
      push(
        `eyeSpacing-${i}`,
        p,
        (i ? 1 : -1) * ux * fw * 0.08,
        (i ? 1 : -1) * uy * fw * 0.08,
        radius * 0.18,
        value('eyeSpacing'),
      );
      warp(
        `eyeRotate-${i}`,
        'twirl',
        p,
        p,
        radius * 0.18,
        value('eyeRotate') * (i ? 1 : -1) * 0.18,
      );
    }
    for (const [i, side] of [-1, 1].entries()) {
      const p = axisOffset(nose, side * fw * 0.1, 0);
      push(
        `noseWidth-${i}`,
        p,
        -side * ux * fw * 0.055,
        -side * uy * fw * 0.055,
        radius * 0.14,
        value('noseWidth'),
      );
    }
    push('noseTip', nose, vx * fh * 0.05, vy * fh * 0.05, radius * 0.12, value('noseTip'));
    push('noseLength', nose, vx * fh * 0.09, vy * fh * 0.09, radius * 0.22, value('noseLength'));
    warp('lipSize', 'bulge', lips, lips, radius * 0.23, value('lipSize') * 0.35);
    const lipAxis = target.contours
      .lips!.slice()
      .sort((a, b) => (a.x - b.x) * dims.width * ux + (a.y - b.y) * dims.height * uy);
    for (const [i, p] of [lipAxis[0]!, lipAxis.at(-1)!].entries())
      push(`smile-${i}`, p, -vx * fh * 0.05, -vy * fh * 0.05, radius * 0.12, value('smile'));
    for (const [i, key] of ['leftBrow', 'rightBrow'].entries()) {
      const p = center(target.contours[key]!);
      for (const [j, side] of [-1, 1].entries())
        push(
          `browThickness-${i * 2 + j}`,
          axisOffset(p, 0, side * fh * 0.012),
          side * vx * fh * 0.014,
          side * vy * fh * 0.014,
          radius * 0.1,
          value('browThickness') * 0.8,
        );
    }
    const cheekPoints = [anchor(-0.28, 0.1), anchor(0.28, 0.1)];
    const makeupMasks: Record<string, SelectionMaskV3> = {
      lipstick: masks.lips,
      browColor: masks.brows,
      blush: combine(
        'union',
        cheekPoints.map((p) => oval(p, fw * 0.18, fh * 0.12, 0.85)),
      ),
      contour: combine(
        'union',
        [-1, 1].map((s) => oval(anchor(s * 0.4, 0.22), fw * 0.11, fh * 0.25, 0.9)),
      ),
      highlight: combine('union', [
        oval(axisOffset(nose, 0, -fh * 0.1), fw * 0.055, fh * 0.14, 0.8),
        ...cheekPoints.map((p) => oval(axisOffset(p, 0, -fh * 0.08), fw * 0.13, fh * 0.06, 0.85)),
      ]),
      eyeshadow: combine(
        'union',
        [left, right].map((p) => oval(axisOffset(p, 0, -fh * 0.035), fw * 0.14, fh * 0.045, 0.75)),
      ),
      underEyeMakeup: combine('union', eyeMasks),
    };
    for (const tool of PORTRAIT_TOOLS.filter((t) => t.group === 'makeup')) {
      if (!value(tool.id)) continue;
      const fallback: MakeupColor = ['highlight', 'underEyeMakeup'].includes(tool.id)
          ? [247, 234, 216, defaultColor[3]]
          : tool.id === 'contour'
            ? [104, 75, 63, defaultColor[3]]
            : defaultColor,
        shade = makeupColors[tool.id] ?? fallback;
      const fillPoints =
        dims.width >= dims.height
          ? [
              { x: 0, y: 0.5 },
              { x: 1, y: 0.5 },
            ]
          : [
              { x: 0.5, y: 0 },
              { x: 0.5, y: 1 },
            ];
      paints.push({
        id: prefix + tool.id,
        name: `${target.label} · ${tool.label}`,
        enabled: true,
        opacity: value(tool.id) * 0.65,
        blendMode: ['highlight', 'underEyeMakeup', 'contour'].includes(tool.id)
          ? 'soft-light'
          : tool.id === 'browColor'
            ? 'multiply'
            : 'color',
        mask: makeupMasks[tool.id]!,
        origin: provenance(tool.id, values[tool.id]!, shade),
        strokes: [
          {
            points: fillPoints,
            radius: 0.5,
            feather: 0,
            opacity: 1,
            mode: 'paint',
            color: shade,
            source: null,
          },
        ],
      });
    }
  } else {
    const lm = target.landmarks,
      p = (i: number): Point => lm[i]!;
    const sL = p(11),
      sR = p(12),
      shoulder = mid(sL, sR),
      shoulderPx = px(shoulder),
      shoulderSize = Math.hypot((sL.x - sR.x) * dims.width, (sL.y - sR.y) * dims.height) / short;
    const fullBody = ['waist', 'hips', 'legLength', 'legs', 'height'].some((k) => value(k) !== 0);
    const hip = fullBody ? mid(p(23), p(24)) : null;
    const vertical = hip
        ? { x: (hip.x - shoulder.x) * dims.width, y: (hip.y - shoulder.y) * dims.height }
        : { x: 0, y: 1 },
      length = Math.hypot(vertical.x, vertical.y) || 1,
      vx = vertical.x / length,
      vy = vertical.y / length;
    const bodyHeight = target.bounds.height * dims.height;
    if (value('headSize')) {
      const head = mid(p(7), p(8));
      warp('headSize', 'bulge', head, head, shoulderSize * 0.46, -value('headSize') * 0.35);
    }
    if (value('neckLength') || value('neckWidth')) {
      const ear = mid(p(7), p(8)),
        neck = mid(ear, shoulder),
        d = { x: (ear.x - shoulder.x) * dims.width, y: (ear.y - shoulder.y) * dims.height },
        len = Math.hypot(d.x, d.y) || 1;
      if (value('neckLength'))
        push(
          'neckLength',
          neck,
          (d.x / len) * len * 0.25,
          (d.y / len) * len * 0.25,
          shoulderSize * 0.4,
          value('neckLength'),
        );
      if (value('neckWidth'))
        warp('neckWidth', 'pinch', neck, neck, shoulderSize * 0.25, value('neckWidth') * 0.3);
    }
    if (value('shoulders'))
      for (const [i, s] of [sL, sR].entries()) {
        const q = px(s);
        push(
          `shoulders-${i}`,
          s,
          (shoulderPx.x - q.x) * 0.3,
          (shoulderPx.y - q.y) * 0.3,
          shoulderSize * 0.32,
          value('shoulders'),
        );
      }
    if (value('waist') && hip) {
      const waist = mid(shoulder, hip);
      warp('waist', 'pinch', waist, waist, shoulderSize * 0.5, value('waist') * 0.35);
    }
    if (value('hips') && hip)
      warp('hips', 'bulge', hip, hip, shoulderSize * 0.5, value('hips') * 0.35);
    if (value('arms'))
      for (const [i, [a, b]] of [
        [11, 13],
        [13, 15],
        [12, 14],
        [14, 16],
      ].entries()) {
        const m = mid(p(a!), p(b!));
        warp(`arms-${i}`, 'pinch', m, m, shoulderSize * 0.24, value('arms') * 0.35);
      }
    if (value('legs'))
      for (const [i, [a, b]] of [
        [23, 25],
        [25, 27],
        [24, 26],
        [26, 28],
      ].entries()) {
        const m = mid(p(a!), p(b!));
        warp(`legs-${i}`, 'pinch', m, m, shoulderSize * 0.3, value('legs') * 0.35);
      }
    if (value('legLength'))
      for (const [i, k] of [25, 26, 27, 28].entries())
        push(
          `legLength-${i}`,
          p(k),
          vx * bodyHeight * (i < 2 ? 0.03 : 0.06),
          vy * bodyHeight * (i < 2 ? 0.03 : 0.06),
          shoulderSize * 0.42,
          value('legLength'),
        );
    if (value('height'))
      for (const [i, k] of [23, 24, 25, 26, 27, 28].entries())
        push(
          `height-${i}`,
          p(k),
          vx * bodyHeight * (0.02 + Math.floor(i / 2) * 0.02),
          vy * bodyHeight * (0.02 + Math.floor(i / 2) * 0.02),
          shoulderSize * 0.45,
          value('height'),
        );
  }
  return sealAutomaticPrimitives(
    parseLayeredRecipe({
      ...recipe,
      regionEdits: replaceOwned(recipe.regionEdits, regions, targetId),
      ...(recipe.schemaVersion === 4
        ? { retouch: replaceOwned(recipe.retouch, retouches, targetId) }
        : {}),
      paintLayers: replaceOwned(recipe.paintLayers, paints, targetId),
      warp: {
        ...recipe.warp,
        enabled: recipe.warp.enabled || warps.length > 0,
        strokes: replaceOwned(recipe.warp.strokes, warps, targetId),
      },
    }),
    targetId,
  ) as T;
}
