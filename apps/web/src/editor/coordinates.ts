import { compileEditorCoordinateMap, type EditorRecipe, type Point } from '@ai-xiutu/editor';

/** Everything that changes the relationship between rendered pixels and source pixels. */
export function editorGeometryKey(recipe: EditorRecipe) {
  return JSON.stringify({
    geometry: recipe.geometry,
    transform: recipe.schemaVersion === 3 ? recipe.transform : null,
    warp:
      recipe.schemaVersion === 3 && recipe.warp.enabled && recipe.warp.strokes.length > 0
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
  const mapped = content ? map.toContent(output) : map.toSource(output);
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
