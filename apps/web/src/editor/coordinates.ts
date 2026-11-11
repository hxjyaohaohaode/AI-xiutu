import { compileEditorCoordinateMap, type EditorRecipe, type Point } from '@ai-xiutu/editor';

/** Off-frame handles are valid; a projective horizon has no finite UI location. */
export function projectOverlayPoint(point: Point, project: (point: Point) => Point): Point | null {
  try {
    const value = project(point);
    return Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
  } catch {
    return null;
  }
}
export function projectOverlayPath(
  points: Point[],
  project: (point: Point) => Point,
): Point[] | null {
  const mapped = points.map((point) => projectOverlayPoint(point, project));
  return mapped.every((point): point is Point => point !== null) ? mapped : null;
}

/** Everything that changes the relationship between rendered pixels and source pixels. */
export function editorGeometryKey(recipe: EditorRecipe, includeWarp = true) {
  return JSON.stringify({
    geometry: recipe.geometry,
    projective: recipe.schemaVersion === 4 ? recipe.projective : null,
    transform: recipe.schemaVersion === 3 || recipe.schemaVersion === 4 ? recipe.transform : null,
    warp:
      includeWarp &&
      (recipe.schemaVersion === 3 || recipe.schemaVersion === 4) &&
      recipe.warp.enabled &&
      recipe.warp.strokes.length > 0
        ? recipe.warp
        : null,
  });
}

export function sourcePointer(
  client: Point,
  frame: { left: number; top: number; width: number; height: number },
  map: ReturnType<typeof compileEditorCoordinateMap>,
  content: boolean,
  bounds: 'strict' | 'clamp' | 'unbounded',
): Point | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  const output = {
    x: (client.x - frame.left) / frame.width,
    y: (client.y - frame.top) / frame.height,
  };
  // The inverse alone can point into a valid original pixel which an earlier
  // crop removed. Test every geometry viewport before evaluating that inverse.
  // This is geometric visibility, not alpha: transparent source pixels can be painted.
  if (bounds === 'strict' && !map.containsOutput(output)) return null;
  let mapped: Point;
  try {
    mapped = content ? map.toContent(output) : map.toSource(output);
  } catch {
    return null;
  }
  if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) return null;
  if (bounds === 'strict') {
    // A contained rotation has transparent corners: these have no source pixel.
    // Reject them instead of silently painting or sampling the nearest edge.
    const outside = (p: Point) => p.x < -1e-9 || p.y < -1e-9 || p.x > 1 + 1e-9 || p.y > 1 + 1e-9;
    if (outside(output) || outside(mapped)) return null;
  }
  return bounds === 'unbounded'
    ? mapped
    : { x: Math.max(0, Math.min(1, mapped.x)), y: Math.max(0, Math.min(1, mapped.y)) };
}
