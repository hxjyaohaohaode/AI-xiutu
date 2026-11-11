import type { MediaPrecisionWindow } from '@ai-xiutu/media';

export interface TileView {
  x: number;
  y: number;
  zoom: number;
}
export function nativePreviewWindow(
  source: { width: number; height: number },
  view: TileView,
  viewport: { width: number; height: number },
  maxEdge: number,
): MediaPrecisionWindow | undefined {
  if (view.zoom < 0.75) return undefined;
  const left = Math.max(0, Math.floor(-view.x / view.zoom));
  const top = Math.max(0, Math.floor(-view.y / view.zoom));
  const right = Math.min(source.width, Math.ceil((viewport.width - view.x) / view.zoom));
  const bottom = Math.min(source.height, Math.ceil((viewport.height - view.y) / view.zoom));
  const width = right - left,
    height = bottom - top;
  if (width < 1 || height < 1 || width > maxEdge || height > maxEdge) return undefined;
  return { left, top, width, height };
}
export function visibleTiles(
  source: { width: number; height: number; tileSize: number; levels: number; overlap?: number },
  view: TileView,
  viewport: { width: number; height: number },
) {
  if (
    ![
      source.width,
      source.height,
      source.tileSize,
      source.levels,
      view.x,
      view.y,
      view.zoom,
      viewport.width,
      viewport.height,
    ].every(Number.isFinite) ||
    view.zoom <= 0 ||
    source.tileSize < 1 ||
    source.levels < 1
  )
    return [];
  const maxLevel = source.levels - 1;
  const level = Math.max(0, Math.min(maxLevel, maxLevel + Math.ceil(Math.log2(view.zoom))));
  const downscale = 2 ** (maxLevel - level),
    zoom = view.zoom * downscale;
  const width = Math.ceil(source.width / downscale),
    height = Math.ceil(source.height / downscale),
    size = source.tileSize;
  const firstX = Math.max(0, Math.floor(-view.x / (size * zoom))),
    firstY = Math.max(0, Math.floor(-view.y / (size * zoom)));
  const lastX = Math.min(
      Math.ceil(width / size) - 1,
      Math.floor((viewport.width - view.x) / (size * zoom)),
    ),
    lastY = Math.min(
      Math.ceil(height / size) - 1,
      Math.floor((viewport.height - view.y) / (size * zoom)),
    );
  const result = [];
  const overlap = source.overlap ?? 1;
  for (let y = firstY; y <= lastY && result.length < 256; y++)
    for (let x = firstX; x <= lastX && result.length < 256; x++) {
      const w = Math.min(size, width - x * size),
        h = Math.min(size, height - y * size);
      const left = x ? overlap : 0,
        top = y ? overlap : 0;
      const right = x * size + w < width ? overlap : 0,
        bottom = y * size + h < height ? overlap : 0;
      result.push({
        key: `${level}/${x}_${y}`,
        level,
        x,
        y,
        left: view.x + x * size * zoom,
        top: view.y + y * size * zoom,
        width: w * zoom,
        height: h * zoom,
        imageLeft: -left * zoom,
        imageTop: -top * zoom,
        imageWidth: (w + left + right) * zoom,
        imageHeight: (h + top + bottom) * zoom,
      });
    }
  return result;
}
export function zoomAround(
  view: TileView,
  point: { x: number; y: number },
  nextZoom: number,
): TileView {
  if (!Number.isFinite(nextZoom) || nextZoom <= 0 || view.zoom <= 0) return view;
  return {
    zoom: nextZoom,
    x: point.x - ((point.x - view.x) / view.zoom) * nextZoom,
    y: point.y - ((point.y - view.y) / view.zoom) * nextZoom,
  };
}
