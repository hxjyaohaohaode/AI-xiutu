import { sourceFrameSchema, type SourceFrame } from '@ai-xiutu/contracts';
import { parseSelectionMaskV3 } from '@ai-xiutu/editor';
import type { Point } from '@ai-xiutu/editor';
import type { PortraitAnalysis, PortraitTarget } from './types.js';

/** Provider/worker output is untrusted data. This clone never invokes input accessors. */
export function copyPortraitData(input: unknown): unknown {
  let count = 0;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (++count > 180000 || depth > 16) throw new Error('人像分析结果超出结构预算。');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.length <= 1024) return value;
    if (!value || typeof value !== 'object' || seen.has(value))
      throw new Error('人像分析仅接受有限无环数据。');
    seen.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 32768)
        throw new Error('人像数组无效。');
      if (Reflect.ownKeys(value).length !== value.length + 1)
        throw new Error('人像数组包含额外属性。');
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !('value' in d)) throw new Error('人像数组不可包含访问器或空项。');
        out.push(visit(d.value, depth + 1));
      }
      result = out;
    } else {
      const p = Object.getPrototypeOf(value);
      if (p !== Object.prototype && p !== null) throw new Error('人像结果必须是普通对象。');
      const keys = Reflect.ownKeys(value);
      if (keys.length > 128) throw new Error('人像对象字段过多。');
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(value, key);
        if (
          typeof key !== 'string' ||
          ['__proto__', 'prototype', 'constructor'].includes(key) ||
          !d ||
          !('value' in d)
        )
          throw new Error('人像结果不可含可执行属性。');
        out[key] = visit(d.value, depth + 1);
      }
      result = out;
    }
    seen.delete(value);
    return result;
  };
  return visit(input, 0);
}
function object(
  input: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('人像结构无效。');
  const r = input as Record<string, unknown>;
  for (const key of required) if (!Object.hasOwn(r, key)) throw new Error(`人像结果缺少 ${key}。`);
  for (const key of Object.keys(r))
    if (!required.includes(key) && !optional.includes(key))
      throw new Error(`人像结果含未知字段 ${key}。`);
  return r;
}
function scalar(input: unknown, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max)
    throw new Error('人像数值越界。');
  return input;
}
function readPoint(
  input: unknown,
  landmark = false,
  body = false,
): Point & { z?: number; visibility?: number } {
  const p = object(input, ['x', 'y'], landmark ? ['z', 'visibility'] : []);
  return {
    // Pose models extrapolate unseen legs well beyond a cropped head/shoulder image.
    // Preserve bounded estimates; per-tool availability must still require visible in-frame joints.
    x: scalar(p.x, body ? -8 : landmark ? -1 : 0, body ? 8 : landmark ? 2 : 1),
    y: scalar(p.y, body ? -8 : landmark ? -1 : 0, body ? 8 : landmark ? 2 : 1),
    ...(p.z !== undefined ? { z: scalar(p.z, -10, 10) } : {}),
    ...(p.visibility !== undefined ? { visibility: scalar(p.visibility, 0, 1) } : {}),
  };
}
function array(input: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(input) || input.length < min || input.length > max)
    throw new Error('人像数组数量越界。');
  return input;
}
function string(input: unknown, max: number): string {
  if (typeof input !== 'string' || !input.trim() || input.length > max)
    throw new Error('人像文本字段无效。');
  return input;
}
function readTarget(input: unknown): PortraitTarget {
  const r = object(input, ['id', 'kind', 'label', 'landmarks', 'contours', 'bounds']);
  if (r.kind !== 'face' && r.kind !== 'body') throw new Error('人像目标类别不支持。');
  const id = string(r.id, 80);
  if (!new RegExp(`^${r.kind}-[a-f0-9]{12}-[1-8]$`).test(id)) throw new Error('人像目标标识无效。');
  const landmarks = array(r.landmarks, r.kind === 'face' ? 468 : 33, 512).map((p) =>
    readPoint(p, true, r.kind === 'body'),
  );
  const raw = object(
    r.contours,
    [],
    Object.keys(r.contours && typeof r.contours === 'object' ? r.contours : {}),
  );
  if (Object.keys(raw).length > 24) throw new Error('人像轮廓数量超限。');
  const contours: Record<string, Point[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,47}$/.test(key)) throw new Error('人像轮廓名无效。');
    contours[key] = array(value, 0, 128).map((p) => readPoint(p));
  }
  const b = object(r.bounds, ['x', 'y', 'width', 'height']),
    bounds = {
      x: scalar(b.x, 0, 1),
      y: scalar(b.y, 0, 1),
      width: scalar(b.width, 0.001, 1),
      height: scalar(b.height, 0.001, 1),
    };
  if (bounds.x + bounds.width > 1 + 1e-9 || bounds.y + bounds.height > 1 + 1e-9)
    throw new Error('人像边界超出原图。');
  return { id, kind: r.kind, label: string(r.label, 120), landmarks, contours, bounds };
}
export function validateTarget(input: PortraitTarget): PortraitTarget {
  return readTarget(copyPortraitData(input));
}
export function validatePortraitAnalysis(
  input: unknown,
  expectedFrame?: SourceFrame,
): PortraitAnalysis {
  const r = object(copyPortraitData(input), [
    'schemaVersion',
    'provider',
    'algorithmVersion',
    'frame',
    'targets',
    'segmentation',
    'warnings',
  ]);
  if (r.schemaVersion !== 1) throw new Error('人像分析协议版本不支持。');
  const provider = string(r.provider, 80),
    algorithmVersion = string(r.algorithmVersion, 120);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(provider) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(algorithmVersion)
  )
    throw new Error('人像分析器身份无效。');
  const frame = sourceFrameSchema.parse(r.frame);
  if (frame.width * frame.height > 67_108_864) throw new Error('人像原图尺寸超出预算。');
  if (expectedFrame) {
    const expected = sourceFrameSchema.parse(expectedFrame);
    if (
      frame.width !== expected.width ||
      frame.height !== expected.height ||
      frame.contentHash !== expected.contentHash
    )
      throw new Error('分析结果与当前原图不一致，已拒绝应用。');
  }
  const targets = array(r.targets, 0, 16).map(readTarget),
    ids = new Set<string>();
  for (const target of targets) {
    if (
      !target.id.startsWith(`${target.kind}-${frame.contentHash.slice(0, 12)}-`) ||
      ids.has(target.id)
    )
      throw new Error('人像目标重复或未绑定本次源图。');
    ids.add(target.id);
  }
  let segmentation: PortraitAnalysis['segmentation'] = null;
  if (r.segmentation !== null) {
    const s = object(r.segmentation, ['skin', 'hair', 'background']);
    segmentation = {
      skin: parseSelectionMaskV3(s.skin),
      hair: parseSelectionMaskV3(s.hair),
      background: parseSelectionMaskV3(s.background),
    };
  }
  return {
    schemaVersion: 1,
    provider,
    algorithmVersion,
    frame,
    targets,
    segmentation,
    warnings: array(r.warnings, 0, 20).map((w) => string(w, 500)),
  };
}
