import {
  compileProjectiveTransformV4,
  getEditorOutputDimensions,
  mapProjectiveOutputToCornerFrame,
  parseRecipeV4,
  type Dimensions,
  type Point,
  type RecipeV4,
} from '@ai-xiutu/editor';
export const CORNER_LABELS = ['左上角', '右上角', '右下角', '左下角'] as const;
export function preProjectiveDimensions(dimensions: Dimensions, recipe: RecipeV4) {
  return getEditorOutputDimensions(dimensions, {
    ...recipe,
    projective: { ...recipe.projective, enabled: false },
  });
}
export function withProjectiveCorner(
  recipe: RecipeV4,
  index: number,
  point: Point,
  dimensions: Dimensions,
  budget = 16_777_216,
) {
  if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error('变换角点不存在。');
  const next = parseRecipeV4({
    ...recipe,
    projective: {
      ...recipe.projective,
      enabled: true,
      corners: recipe.projective.corners.map((p, i) => (i === index ? point : p)),
    },
  });
  let output: Dimensions;
  try {
    output = getEditorOutputDimensions(dimensions, next);
  } catch (e) {
    if (e instanceof Error && /budget|pixels|dimension/i.test(e.message))
      throw new Error('这个四角变换超出当前画幅预算，请缩小范围或保留画幅。');
    throw e;
  }
  if (output.width * output.height > Math.min(budget, 16_777_216))
    throw new Error('这个四角变换会超过当前画幅预算，请缩小范围或保留画幅。');
  return next;
}
export function projectivePointer(
  point: Point,
  rect: { left: number; top: number; width: number; height: number },
  dimensions: Dimensions,
  recipe: RecipeV4,
): Point {
  if (rect.width <= 0 || rect.height <= 0) throw new Error('画布尚未准备好。');
  const mapped = mapProjectiveOutputToCornerFrame(
    { x: (point.x - rect.left) / rect.width, y: (point.y - rect.top) / rect.height },
    dimensions,
    recipe.projective,
  );
  return { x: Math.min(3, Math.max(-2, mapped.x)), y: Math.min(3, Math.max(-2, mapped.y)) };
}
export function projectiveDisplayPoint(point: Point, dimensions: Dimensions, rendered: RecipeV4) {
  const context = compileProjectiveTransformV4(dimensions, rendered.projective);
  return {
    x: (point.x * dimensions.width - context.origin.x) / context.dimensions.width,
    y: (point.y * dimensions.height - context.origin.y) / context.dimensions.height,
  };
}
