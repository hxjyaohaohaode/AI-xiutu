export type SketchPoint = { x: number; y: number };
export type SketchShape =
  'rectangle' | 'rounded' | 'ellipse' | 'triangle' | 'diamond' | 'line' | 'arrow';
export type SketchIcon = 'star' | 'heart' | 'check' | 'pin' | 'bolt' | 'speech';
export type SketchItem = (
  | { kind: 'stroke'; points: SketchPoint[]; color: string; width: number; erase: boolean }
  | {
      kind: 'shape';
      shape: SketchShape;
      from: SketchPoint;
      to: SketchPoint;
      color: string;
      width: number;
      fill: boolean;
    }
  | { kind: 'text'; at: SketchPoint; text: string; color: string; size: number }
  | { kind: 'icon'; at: SketchPoint; icon: SketchIcon; color: string; size: number }
  | { kind: 'image'; at: SketchPoint; image: HTMLCanvasElement; size: number; name: string }
) & { angle?: number; opacity?: number };

const shortEdge = (context: CanvasRenderingContext2D) =>
  Math.min(context.canvas.width, context.canvas.height);
const pixel = (context: CanvasRenderingContext2D, { x, y }: SketchPoint) => ({
  x: x * context.canvas.width,
  y: y * context.canvas.height,
});
function imageBox(context: CanvasRenderingContext2D, item: Extract<SketchItem, { kind: 'image' }>) {
  const edge = item.size * shortEdge(context);
  const ratio = item.image.width / item.image.height;
  return { width: Math.min(edge, edge * ratio), height: Math.min(edge, edge / ratio) };
}

export function paintSketchItem(item: SketchItem, context: CanvasRenderingContext2D) {
  context.save();
  context.globalAlpha = item.opacity ?? 1;
  if (item.angle) {
    const box = flatSketchBounds(context, item);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    context.translate(x, y);
    context.rotate((item.angle * Math.PI) / 180);
    context.translate(-x, -y);
  }
  if ('color' in item) context.strokeStyle = context.fillStyle = item.color;
  context.lineCap = context.lineJoin = 'round';
  if (item.kind === 'stroke') {
    const first = pixel(context, item.points[0]!);
    context.globalCompositeOperation = item.erase ? 'destination-out' : 'source-over';
    context.lineWidth = item.width;
    context.beginPath();
    if (item.points.length === 1) {
      context.arc(first.x, first.y, item.width / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(first.x, first.y);
      for (let i = 1; i < item.points.length; i++) {
        const p = pixel(context, item.points[i]!);
        context.lineTo(p.x, p.y);
      }
      context.stroke();
    }
  } else if (item.kind === 'shape') {
    const a = pixel(context, item.from),
      b = pixel(context, item.to);
    const w = Math.abs(b.x - a.x),
      h = Math.abs(b.y - a.y);
    context.lineWidth = item.width;
    context.beginPath();
    const x = Math.min(a.x, b.x),
      y = Math.min(a.y, b.y);
    if (item.shape === 'rectangle') context.rect(x, y, w, h);
    else if (item.shape === 'rounded') context.roundRect(x, y, w, h, Math.min(w, h) / 6);
    else if (item.shape === 'ellipse')
      context.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
    else if (item.shape === 'triangle' || item.shape === 'diamond') {
      context.moveTo(x + w / 2, y);
      context.lineTo(x + w, y + (item.shape === 'diamond' ? h / 2 : h));
      if (item.shape === 'diamond') context.lineTo(x + w / 2, y + h);
      context.lineTo(x, y + (item.shape === 'diamond' ? h / 2 : h));
      context.closePath();
    } else {
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      if (item.shape === 'arrow') {
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const head = Math.min(Math.hypot(w, h) * 0.4, item.width * 2 + 24);
        context.lineTo(
          b.x - Math.cos(angle - Math.PI / 6) * head,
          b.y - Math.sin(angle - Math.PI / 6) * head,
        );
        context.moveTo(b.x, b.y);
        context.lineTo(
          b.x - Math.cos(angle + Math.PI / 6) * head,
          b.y - Math.sin(angle + Math.PI / 6) * head,
        );
      }
    }
    if (item.fill && item.shape !== 'line' && item.shape !== 'arrow') context.fill();
    else context.stroke();
  } else {
    const at = pixel(context, item.at);
    if (item.kind === 'image') {
      const { width, height } = imageBox(context, item);
      context.drawImage(item.image, at.x, at.y, width, height);
    } else if (item.kind === 'text') {
      context.font = `600 ${item.size}px system-ui, sans-serif`;
      context.textBaseline = 'top';
      const lineHeight = item.size * 1.2;
      item.text
        .split('\n')
        .forEach((line, i) =>
          context.fillText(line, at.x, at.y + i * lineHeight, context.canvas.width * 0.9),
        );
    } else {
      context.translate(at.x, at.y);
      context.scale(item.size, item.size);
      context.beginPath();
      if (item.icon === 'check') {
        context.moveTo(0.12, 0.52);
        context.lineTo(0.39, 0.79);
        context.lineTo(0.9, 0.19);
        context.lineWidth = 0.12;
        context.stroke();
      } else if (item.icon === 'heart') {
        context.moveTo(0.5, 0.92);
        context.bezierCurveTo(0.42, 0.79, 0.03, 0.57, 0.03, 0.31);
        context.bezierCurveTo(0.03, 0.06, 0.34, 0.01, 0.5, 0.24);
        context.bezierCurveTo(0.66, 0.01, 0.97, 0.06, 0.97, 0.31);
        context.bezierCurveTo(0.97, 0.57, 0.58, 0.79, 0.5, 0.92);
        context.fill();
      } else if (item.icon === 'pin') {
        context.moveTo(0.5, 0.94);
        context.bezierCurveTo(0.2, 0.64, 0.11, 0.53, 0.11, 0.37);
        context.arc(0.5, 0.37, 0.39, Math.PI, 2 * Math.PI);
        context.bezierCurveTo(0.89, 0.53, 0.8, 0.64, 0.5, 0.94);
        context.moveTo(0.64, 0.37);
        context.arc(0.5, 0.37, 0.14, 0, 2 * Math.PI);
        context.fill('evenodd');
      } else if (item.icon === 'bolt') {
        for (const [x, y] of [
          [0.54, 0.04],
          [0.16, 0.55],
          [0.46, 0.55],
          [0.38, 0.96],
          [0.84, 0.38],
          [0.54, 0.38],
        ])
          context.lineTo(x!, y!);
        context.closePath();
        context.fill();
      } else if (item.icon === 'speech') {
        context.roundRect(0.04, 0.12, 0.92, 0.64, 0.18);
        context.moveTo(0.25, 0.66);
        context.lineTo(0.19, 0.94);
        context.lineTo(0.55, 0.69);
        context.closePath();
        context.fill();
      } else {
        for (let i = 0; i < 10; i++) {
          const angle = (i * Math.PI) / 5 - Math.PI / 2,
            r = i % 2 ? 0.22 : 0.48;
          context.lineTo(0.5 + r * Math.cos(angle), 0.5 + r * Math.sin(angle));
        }
        context.closePath();
        context.fill();
      }
    }
  }
  context.restore();
}

function flatSketchBounds(context: CanvasRenderingContext2D, item: SketchItem) {
  if (item.kind === 'stroke' || item.kind === 'shape') {
    const points = item.kind === 'stroke' ? item.points : [item.from, item.to];
    const r = item.width / 2 + 2;
    const x = points.map((p) => p.x * context.canvas.width),
      y = points.map((p) => p.y * context.canvas.height);
    const left = Math.min(...x) - r,
      top = Math.min(...y) - r;
    return { x: left, y: top, width: Math.max(...x) + r - left, height: Math.max(...y) + r - top };
  }
  const at = pixel(context, item.at);
  if (item.kind === 'image') return { ...at, ...imageBox(context, item) };
  if (item.kind === 'icon') return { ...at, width: item.size, height: item.size };
  context.save();
  context.font = `600 ${item.size}px system-ui, sans-serif`;
  const lines = item.text.split('\n');
  const width = Math.min(
    context.canvas.width * 0.9,
    Math.max(...lines.map((line) => context.measureText(line).width)),
  );
  context.restore();
  return { ...at, width, height: lines.length * item.size * 1.2 };
}

export function sketchBounds(context: CanvasRenderingContext2D, item: SketchItem) {
  const box = flatSketchBounds(context, item);
  if (!item.angle) return box;
  const angle = (item.angle * Math.PI) / 180;
  const width = box.width * Math.abs(Math.cos(angle)) + box.height * Math.abs(Math.sin(angle));
  const height = box.width * Math.abs(Math.sin(angle)) + box.height * Math.abs(Math.cos(angle));
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

export function sketchItemAt(
  context: CanvasRenderingContext2D,
  items: readonly SketchItem[],
  point: SketchPoint,
) {
  const p = pixel(context, point);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'stroke' && item.erase) continue;
    const box = sketchBounds(context, item);
    if (
      p.x >= box.x - 5 &&
      p.y >= box.y - 5 &&
      p.x <= box.x + box.width + 5 &&
      p.y <= box.y + box.height + 5
    )
      return i;
  }
  return -1;
}

export type SketchCorner = { x: 0 | 1; y: 0 | 1 };

export const sketchCorners: readonly SketchCorner[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function sketchResizeCorner(
  context: CanvasRenderingContext2D,
  item: SketchItem,
  point: SketchPoint,
  hitRadius: number,
) {
  const box = sketchBounds(context, item);
  const position = pixel(context, point);
  let nearest: SketchCorner | undefined;
  let distance = hitRadius;
  for (const corner of sketchCorners) {
    const next = Math.hypot(
      box.x + box.width * corner.x - position.x,
      box.y + box.height * corner.y - position.y,
    );
    if (next <= distance) {
      nearest = corner;
      distance = next;
    }
  }
  return nearest;
}

/** Scale around the opposite visible corner while preserving the item's angle. */
export function resizeSketchItem(
  context: CanvasRenderingContext2D,
  item: SketchItem,
  corner: SketchCorner,
  offset: SketchPoint,
): SketchItem {
  const box = sketchBounds(context, item);
  const x = box.width * (2 * corner.x - 1);
  const y = box.height * (2 * corner.y - 1);
  const movement = pixel(context, offset);
  const scale = Math.max(
    0.12,
    Math.min(8, 1 + (movement.x * x + movement.y * y) / Math.max(1, x * x + y * y)),
  );
  if (Math.abs(1 - scale) < 0.001) return item;
  const anchor = {
    x: (box.x + box.width * (1 - corner.x)) / context.canvas.width,
    y: (box.y + box.height * (1 - corner.y)) / context.canvas.height,
  };
  const stretch = (point: SketchPoint) => ({
    x: anchor.x + (point.x - anchor.x) * scale,
    y: anchor.y + (point.y - anchor.y) * scale,
  });
  if (item.kind === 'stroke')
    return { ...item, points: item.points.map(stretch), width: Math.max(1, item.width * scale) };
  if (item.kind === 'shape')
    return {
      ...item,
      from: stretch(item.from),
      to: stretch(item.to),
      width: Math.max(1, item.width * scale),
    };
  return { ...item, at: stretch(item.at), size: item.size * scale };
}

export function moveSketchItem(item: SketchItem, offset: SketchPoint): SketchItem {
  const move = (p: SketchPoint) => ({ x: p.x + offset.x, y: p.y + offset.y });
  if (item.kind === 'stroke') return { ...item, points: item.points.map(move) };
  if (item.kind === 'shape') return { ...item, from: move(item.from), to: move(item.to) };
  return { ...item, at: move(item.at) };
}
