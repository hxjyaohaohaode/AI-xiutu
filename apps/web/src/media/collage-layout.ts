export type CollagePoint = { x: number; y: number };
export type CollageTracker = (frame: CanvasImageSource) => CollagePoint;
export type CollageRect = CollagePoint & { width: number; height: number };
export type CollageMode = 'layout' | 'vertical' | 'horizontal';
export type CollageTemplate =
  | 'grid'
  | 'rows'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'columns'
  | 'triptych'
  | 'mosaic'
  | 'journal'
  | 'poster'
  | 'contact';
export type CollageItem = {
  id: string;
  width: number;
  height: number;
  panX: number;
  panY: number;
  zoom: number;
  subject?: {
    points?: CollagePoint[];
    matte: HTMLCanvasElement;
    track?: CollageTracker;
    offsetX: number;
    offsetY: number;
    scale: number;
    only: boolean;
  };
};
export type CollageScene = {
  items: CollageItem[];
  mode: CollageMode;
  template: CollageTemplate;
  ratio: number;
  gap: number;
  background: string;
};

function grid(count: number, area: CollageRect): CollageRect[] {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const columnsInRow = Math.min(columns, count - row * columns);
    const width = area.width / columnsInRow;
    const height = area.height / rows;
    return {
      x: area.x + (index % columns) * width,
      y: area.y + row * height,
      width,
      height,
    };
  });
}
function strip(count: number, area: CollageRect, direction: 'x' | 'y'): CollageRect[] {
  const size = direction === 'x' ? 'width' : 'height';
  const extent = area[size] / count;
  return Array.from({ length: count }, (_, index) => ({
    ...area,
    [direction]: area[direction] + extent * index,
    [size]: extent,
  }));
}

export function templateCells(count: number, template: CollageTemplate): CollageRect[] {
  const full = { x: 0, y: 0, width: 1, height: 1 };
  if (count < 2) return grid(count, full);
  switch (template) {
    case 'rows':
      return strip(count, full, 'y');
    case 'columns':
      return strip(count, full, 'x');
    case 'top':
      return [{ ...full, height: 0.6 }, ...grid(count - 1, { ...full, y: 0.6, height: 0.4 })];
    case 'bottom':
      return [{ ...full, y: 0.38, height: 0.62 }, ...grid(count - 1, { ...full, height: 0.38 })];
    case 'left':
      return [
        { ...full, width: 0.62 },
        ...strip(count - 1, { ...full, x: 0.62, width: 0.38 }, 'y'),
      ];
    case 'right':
      return [
        { ...full, x: 0.36, width: 0.64 },
        ...strip(count - 1, { ...full, width: 0.36 }, 'y'),
      ];
    case 'triptych': {
      const left = Math.floor((count - 1) / 2);
      return [
        { x: 0.26, y: 0, width: 0.48, height: 1 },
        ...strip(left, { ...full, width: 0.26 }, 'y'),
        ...strip(count - left - 1, { ...full, x: 0.74, width: 0.26 }, 'y'),
      ];
    }
    case 'mosaic': {
      const columns = Math.ceil(count / 2);
      return [
        ...strip(columns, { ...full, height: 0.46 }, 'x'),
        ...strip(count - columns, { ...full, y: 0.46, height: 0.54 }, 'x'),
      ];
    }
    case 'journal':
      return [
        { x: 0.05, y: 0.05, width: 0.57, height: 0.9 },
        ...strip(count - 1, { x: 0.65, y: 0.05, width: 0.3, height: 0.9 }, 'y'),
      ];
    case 'poster':
      return [
        { x: 0.07, y: 0.06, width: 0.86, height: 0.64 },
        ...strip(count - 1, { x: 0.07, y: 0.73, width: 0.86, height: 0.2 }, 'x'),
      ];
    case 'contact':
      return grid(count, { x: 0.055, y: 0.06, width: 0.89, height: 0.88 });
    default:
      return grid(count, full);
  }
}

export function collageGeometry(scene: CollageScene, maxEdge: number, even = false) {
  const sizes = scene.items.map((item) =>
    scene.mode === 'vertical' ? item.height / item.width : item.width / item.height,
  );
  const sum = sizes.reduce((total, size) => total + size, 0);
  const ratio =
    scene.mode === 'vertical'
      ? 1 / (sum || 1)
      : scene.mode === 'horizontal'
        ? sum || 1
        : scene.ratio;
  const round = (value: number) =>
    even ? Math.max(2, Math.round(value / 2) * 2) : Math.max(1, Math.round(value));
  const width = round(maxEdge * Math.min(1, ratio));
  const height = round(maxEdge * Math.min(1, 1 / ratio));
  const gap = Math.min(width, height) * scene.gap;
  let start = 0;
  const normalized =
    scene.mode === 'layout'
      ? templateCells(scene.items.length, scene.template)
      : sizes.map((size) => {
          const position = start;
          const fraction = size / sum;
          start += fraction;
          return scene.mode === 'vertical'
            ? { x: 0, y: position, width: 1, height: fraction }
            : { x: position, y: 0, width: fraction, height: 1 };
        });
  const cells = normalized.map((cell) => {
    const inset = Math.min(gap / 2, cell.width * width * 0.3, cell.height * height * 0.3);
    return {
      x: cell.x * width + inset,
      y: cell.y * height + inset,
      width: cell.width * width - inset * 2,
      height: cell.height * height - inset * 2,
    };
  });
  return { width, height, cells };
}

export function tileImageRect(item: CollageItem, cell: CollageRect, contain = false): CollageRect {
  const horizontal = cell.width / item.width;
  const vertical = cell.height / item.height;
  const scale =
    (contain ? Math.min(horizontal, vertical) : Math.max(horizontal, vertical)) * item.zoom;
  const width = item.width * scale,
    height = item.height * scale;
  return {
    x: cell.x + ((cell.width - width) * (1 - item.panX)) / 2,
    y: cell.y + ((cell.height - height) * (1 - item.panY)) / 2,
    width,
    height,
  };
}

export function pointInCollageRect(point: CollagePoint, rect: CollageRect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}
