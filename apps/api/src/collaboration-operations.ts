import { isDeepStrictEqual } from 'node:util';
import {
  getEditorParameter,
  getSelectionBoundsV3,
  setEditorParameter,
  parseEditorRecipe,
  withCurve,
  type EditorRecipe,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
import type {
  CollaborationOperation,
  CollaborationTarget,
  SourceBounds,
} from '@ai-xiutu/contracts';
import { HttpError } from './core.js';

const full: SourceBounds = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const box = (x0: number, y0: number, x1: number, y1: number): SourceBounds => ({
  x: clamp(x0),
  y: clamp(y0),
  width: Math.max(0, clamp(x1) - clamp(x0)),
  height: Math.max(0, clamp(y1) - clamp(y0)),
});
function union(items: SourceBounds[]): SourceBounds {
  if (!items.length) return { x: 0, y: 0, width: 0, height: 0 };
  return box(
    Math.min(...items.map((a) => a.x)),
    Math.min(...items.map((a) => a.y)),
    Math.max(...items.map((a) => a.x + a.width)),
    Math.max(...items.map((a) => a.y + a.height)),
  );
}
function pointsBounds(
  points: { x: number; y: number }[],
  radiusX = 0,
  radiusY = radiusX,
): SourceBounds {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  return box(
    Math.min(...points.map((a) => a.x)) - radiusX,
    Math.min(...points.map((a) => a.y)) - radiusY,
    Math.max(...points.map((a) => a.x)) + radiusX,
    Math.max(...points.map((a) => a.y)) + radiusY,
  );
}
/** Conservative support. Global/inverse/colour masks intentionally lock the
 * whole source; we never infer unproven empty pixels from a low-resolution preview. */
export function maskBounds(mask: SelectionMaskV3, width: number, height: number): SourceBounds {
  const bounds = getSelectionBoundsV3(mask, { width, height });
  if (!bounds.width || !bounds.height) return bounds;
  // Two polygon edges can touch on the center of the same source pixel.
  // Lock the full cells whose centers the mask might write.
  const epsilon = 1e-8;
  return box(
    Math.ceil(bounds.x * width - 0.5 - epsilon) / width,
    Math.ceil(bounds.y * height - 0.5 - epsilon) / height,
    (Math.floor((bounds.x + bounds.width) * width - 0.5 + epsilon) + 1) / width,
    (Math.floor((bounds.y + bounds.height) * height - 0.5 + epsilon) + 1) / height,
  );
}
export function boundsOverlap(a: SourceBounds, b: SourceBounds): boolean {
  return (
    a.width > 0 &&
    a.height > 0 &&
    b.width > 0 &&
    b.height > 0 &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
export function targetKey(target: CollaborationTarget): string {
  return target.kind === 'document'
    ? 'document'
    : target.kind === 'region'
      ? `${target.collection}:${target.id}`
      : `${target.kind}:${target.id}`;
}
export function targetsConflict(
  a: CollaborationTarget,
  ab: SourceBounds | null,
  b: CollaborationTarget,
  bb: SourceBounds | null,
): boolean {
  return (
    a.kind === 'document' ||
    b.kind === 'document' ||
    targetKey(a) === targetKey(b) ||
    Boolean(ab && bb && boundsOverlap(ab, bb))
  );
}
function collection(recipe: EditorRecipe, name: string): Record<string, any>[] {
  const value = (recipe as unknown as Record<string, unknown>)[name];
  if (!Array.isArray(value)) throw new HttpError(400, 'TARGET_UNAVAILABLE', '当前配方没有此集合');
  return value;
}
function node(recipe: EditorRecipe, name: string, id: string): Record<string, any> {
  const found = collection(recipe, name).find((item) => item.id === id);
  if (!found) throw new HttpError(409, 'TARGET_NOT_FOUND', '编辑对象已改变或不在当前作品中');
  return found;
}
export function operationTarget(operation: CollaborationOperation): CollaborationTarget {
  switch (operation.type) {
    case 'replace-recipe':
      return { kind: 'document' };
    case 'set-parameter':
      return { kind: 'parameter', id: operation.path };
    case 'set-curve':
      return { kind: 'curve', id: operation.channel };
    case 'replace-node': {
      if (operation.collection === 'regions' || operation.collection === 'regionEdits')
        return { kind: 'region', collection: operation.collection, id: operation.id };
      return {
        kind:
          operation.collection === 'regionGroups'
            ? 'region-group'
            : operation.collection === 'imageLayers'
              ? 'image-layer'
              : 'paint-layer',
        id: operation.id,
      };
    }
  }
}
export function readTarget(recipe: EditorRecipe, target: CollaborationTarget): unknown {
  switch (target.kind) {
    case 'document':
      return recipe;
    case 'parameter': {
      // Geometry/transform affects every coordinate, and needs document exclusivity.
      if (target.id.startsWith('transform.') || target.id.startsWith('geometry.'))
        throw new HttpError(400, 'DOCUMENT_LEASE_REQUIRED', '构图与空间变换需要整幅作品租约');
      return getEditorParameter(recipe, target.id);
    }
    case 'curve':
      return {
        points: recipe.curves[target.id],
        interpolation: recipe.curves.interpolation?.[target.id],
      };
    case 'region':
      return node(recipe, target.collection, target.id);
    case 'region-group':
      return node(recipe, 'regionGroups', target.id);
    case 'image-layer':
      return node(recipe, 'imageLayers', target.id);
    case 'paint-layer':
      return node(recipe, 'paintLayers', target.id);
  }
}
export function targetBounds(
  recipe: EditorRecipe,
  target: CollaborationTarget,
  width: number,
  height: number,
): SourceBounds | null {
  const value = readTarget(recipe, target) as Record<string, any>;
  if (target.kind === 'document') return full;
  if (target.kind === 'parameter' || target.kind === 'curve') return null;
  if (target.kind === 'region') return maskBounds(value.mask, width, height);
  if (target.kind === 'region-group')
    return union(
      collection(recipe, 'regionEdits')
        .filter((r) => r.groupId === target.id)
        .map((r) => maskBounds(r.mask, width, height)),
    );
  if (target.kind === 'paint-layer') {
    const strokes = (
      value.strokes as {
        points: { x: number; y: number }[];
        radius: number;
        sampling?: { antialias: boolean };
      }[]
    ).map((s) => {
      const radius =
        s.radius * Math.min(width, height) + (s.sampling?.antialias ? Math.SQRT1_2 : 0);
      return pointsBounds(s.points, radius / width, radius / height);
    });
    return value.mask ? maskBounds(value.mask, width, height) : union(strokes);
  }
  // Rotated image-layer AABB in source space; source aspect affects rotation.
  const angle = (value.rotationDegrees * Math.PI) / 180;
  const w =
    Math.abs(value.width * Math.cos(angle)) +
    Math.abs(((value.height * height) / width) * Math.sin(angle));
  const h =
    Math.abs(value.height * Math.cos(angle)) +
    Math.abs(((value.width * width) / height) * Math.sin(angle));
  return box(
    value.x + value.width / 2 - w / 2,
    value.y + value.height / 2 - h / 2,
    value.x + value.width / 2 + w / 2,
    value.y + value.height / 2 + h / 2,
  );
}
export function applyCollaborationOperation(
  current: EditorRecipe,
  operation: CollaborationOperation,
): EditorRecipe {
  if (operation.type === 'replace-recipe') return parseEditorRecipe(operation.recipe);
  const target = operationTarget(operation);
  readTarget(current, target);
  if (operation.type === 'set-parameter')
    return setEditorParameter(current, operation.path, operation.value);
  const next = structuredClone(current);
  if (operation.type === 'set-curve')
    next.curves = withCurve(
      next.curves,
      operation.channel,
      operation.points,
      operation.interpolation,
    );
  else {
    if (operation.value.id !== operation.id)
      throw new HttpError(400, 'TARGET_ID_MISMATCH', '不能在局部命令中更换对象标识');
    const old = node(next, operation.collection, operation.id);
    if (operation.collection === 'regionEdits' && old.groupId !== operation.value.groupId)
      throw new HttpError(400, 'DOCUMENT_LEASE_REQUIRED', '修改局部分组关系需要整幅作品租约');
    const items = collection(next, operation.collection);
    items[items.findIndex((item) => item.id === operation.id)] = operation.value;
  }
  return parseEditorRecipe(next);
}
/** Compare authoritative persisted targets; never trust a client-provided hash. */
export function assertRebasable(
  base: EditorRecipe,
  current: EditorRecipe,
  operation: CollaborationOperation,
): void {
  if (
    base.schemaVersion !== current.schemaVersion ||
    operation.type === 'replace-recipe' ||
    !isDeepStrictEqual(
      readTarget(base, operationTarget(operation)),
      readTarget(current, operationTarget(operation)),
    )
  )
    throw new HttpError(409, 'VERSION_CONFLICT', '同一编辑对象已有更新，请比较最新版本后重新编辑');
  // Per-object replay is only safe while topology and geometry remain unchanged.
  const original = base as unknown as Record<string, unknown>,
    latest = current as unknown as Record<string, unknown>;
  if (
    !isDeepStrictEqual(base.geometry, current.geometry) ||
    ['transform', 'warp', 'projective', 'healing', 'retouch'].some(
      (field) => !isDeepStrictEqual(original[field], latest[field]),
    )
  )
    throw new HttpError(409, 'VERSION_CONFLICT', '构图或形变已改变，请载入最新版本后重新编辑');
}
