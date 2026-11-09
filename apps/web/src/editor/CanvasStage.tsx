import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import {
  Plus,
  UploadSimple,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  CornersOut,
  Eye,
  PencilSimple,
  Hand,
  Eyedropper,
  ArrowCounterClockwise,
  ArrowClockwise,
} from '@phosphor-icons/react';
import {
  getOutputDimensions,
  mapOutputToSource,
  mapSourceToOutput,
  parseSelectionMask,
  MAX_BRUSH_STROKES,
  MAX_BRUSH_POINTS_PER_STROKE,
  MAX_BRUSH_POINTS_PER_MASK,
  MAX_TOTAL_BRUSH_POINTS,
  type RGBAImage,
  type EditorRecipe,
  type SelectionMaskV2,
  type Geometry,
  type Dimensions,
  type Point,
  type BrushStrokeV2,
} from '@ai-xiutu/editor';
import { Busy, IconButton, InlineError } from '../components/Ui';
import type { EditorState } from './useEditor';
import type { ToolGroup } from './ToolInspector';
import {
  brushPointAtSource,
  clamp,
  cropFromPixels,
  replaceSelectionMask,
  sampleSourcePreview,
} from './precision';
import { useStagePreviews } from './useStagePreviews';
import './editor-controls.css';

export function PixelCanvas({
  image,
  className = '',
}: {
  image: RGBAImage | null;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!image || !ref.current) return;
    ref.current.width = image.width;
    ref.current.height = image.height;
    ref.current
      .getContext('2d')
      ?.putImageData(
        new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
        0,
        0,
      );
  }, [image]);
  return <canvas ref={ref} className={className} aria-label="照片编辑预览" />;
}
function MaskPreview({
  mask,
  dimensions,
  source,
  geometry,
  ratio,
  opacity,
}: {
  mask: SelectionMaskV2;
  dimensions: Dimensions;
  source: RGBAImage;
  geometry: Geometry;
  ratio: number;
  opacity: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null),
    sequence = useRef(0),
    busy = useRef(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  const key = JSON.stringify({ mask, dimensions, geometry, ratio, opacity });
  function pump() {
    if (!busy.current && pending.current && worker.current) {
      busy.current = true;
      const message = pending.current;
      pending.current = null;
      worker.current.postMessage(message);
    }
  }
  useEffect(() => {
    const w = new Worker(new URL('./selection.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (
      event: MessageEvent<{
        id: number;
        width: number;
        height: number;
        pixels: Uint8ClampedArray;
        error?: boolean;
      }>,
    ) => {
      busy.current = false;
      const result = event.data,
        canvas = ref.current;
      if (result.id === sequence.current && canvas) {
        if (result.error) {
          canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        } else {
          canvas.width = result.width;
          canvas.height = result.height;
          canvas
            .getContext('2d')
            ?.putImageData(
              new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height),
              0,
              0,
            );
        }
      }
      pump();
    };
    w.onerror = () => {
      busy.current = false;
      pending.current = null;
    };
    return () => {
      w.terminate();
      worker.current = null;
      busy.current = false;
    };
  }, []);
  useEffect(() => {
    worker.current?.postMessage({ type: 'source', source });
  }, [source]);
  useEffect(() => {
    pending.current = {
      type: 'mask',
      id: ++sequence.current,
      mask,
      dimensions,
      geometry,
      ratio,
      opacity,
    };
    pump();
  }, [key, source]);
  return <canvas ref={ref} className="selection-preview" aria-hidden />;
}
type EditGesture = {
  pointer: number;
  kind: string;
  base: EditorRecipe;
  lastPreview: EditorRecipe;
  mask?: SelectionMaskV2;
  start: Point;
  identity: number;
  points?: Point[];
  stroke?: BrushStrokeV2;
};
const isTyping = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));

export function CanvasStage({
  editor,
  group,
  onImport,
  onAI: _onAI,
  onDraw,
  comparing,
  setComparing,
  sampling = false,
  onSample,
}: {
  editor: EditorState;
  group: ToolGroup;
  onImport: (file?: File) => void;
  onAI: () => void;
  onDraw: () => void;
  comparing: boolean;
  setComparing: (value: boolean) => void;
  sampling?: boolean;
  onSample?: (color: string) => void;
}) {
  const [dragging, setDragging] = useState(false),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [space, setSpace] = useState(false),
    [handMode, setHandMode] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{
    x: number;
    y: number;
    rgba: number[];
    source: boolean;
  } | null>(null);
  const viewport = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLDivElement>(null);
  const editGesture = useRef<EditGesture | null>(null);
  const suppressClick = useRef(false);
  const panGesture = useRef<{ pointer: number; x: number; y: number; start: typeof pan } | null>(
    null,
  );
  const pointerPositions = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const recipe = editor.recipe,
    source = editor.originalPreview,
    dimensions = editor.dimensions;
  const previews = useStagePreviews(source, recipe, group === 'crop');
  const image = comparing
    ? previews.compare
    : group === 'crop'
      ? (previews.crop ?? null)
      : editor.rendered;
  const viewGeometry: Geometry =
    group === 'crop' && !comparing ? { ...recipe.geometry, crop: null } : recipe.geometry;
  const region =
    recipe.schemaVersion === 2
      ? recipe.regions.find((item) => item.id === editor.activeRegionId)
      : null;
  const mask = region?.mask ?? recipe.local.mask;
  const samplingSource = (group === 'local' || group === 'beauty') && mask.type === 'color-range';
  const hasSelection = Boolean(region || recipe.local.enabled);
  const geometryReady =
    group === 'crop' || editor.renderedGeometryKey === JSON.stringify(recipe.geometry);
  const editingSelection =
    (group === 'local' || group === 'beauty') &&
    hasSelection &&
    geometryReady &&
    !comparing &&
    !sampling &&
    !space &&
    !handMode;
  const output = dimensions ? getOutputDimensions(dimensions, recipe.geometry) : null;
  const scale = image
    ? Math.max(
        0.0001,
        Math.min((bounds.width - 24) / image.width, (bounds.height - 24) / image.height),
      )
    : 1;
  const display = image
    ? { width: Math.max(1, image.width * scale), height: Math.max(1, image.height * scale) }
    : { width: 1, height: 1 };
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setNotice(null);
    setInspected(null);
    editGesture.current = null;
    pointerPositions.current.clear();
    pinch.current = null;
  }, [editor.file]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.code === 'Space' &&
        !isTyping(event.target) &&
        !(event.target instanceof Element && event.target.closest('button,a'))
      ) {
        event.preventDefault();
        setSpace(true);
      }
      if (event.key === 'Escape' && editGesture.current) {
        if (ownsEdit(editGesture.current)) editor.preview(editGesture.current.base);
        editGesture.current = null;
        setNotice(null);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpace(false);
    };
    const blur = () => {
      setSpace(false);
      panGesture.current = null;
      pinch.current = null;
      pointerPositions.current.clear();
      if (editGesture.current) {
        if (ownsEdit(editGesture.current)) editor.preview(editGesture.current.base);
        editGesture.current = null;
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [editor.preview]);
  useEffect(() => {
    if (zoom === 1) setPan({ x: 0, y: 0 });
    else setPan((value) => boundedPan(value, zoom));
  }, [zoom, bounds.width, bounds.height, display.width, display.height]);
  useEffect(() => {
    if (editGesture.current && ownsEdit(editGesture.current))
      editor.preview(editGesture.current.base);
    editGesture.current = null;
    setNotice(null);
  }, [group, editor.activeRegionId]);
  function fit() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }
  function boundedPan(value: typeof pan, z = zoom) {
    const x = Math.max(0, (display.width * z - bounds.width) / 2 + 20),
      y = Math.max(0, (display.height * z - bounds.height) / 2 + 20);
    return { x: clamp(value.x, -x, x), y: clamp(value.y, -y, y) };
  }
  function toSource(clientX: number, clientY: number): Point {
    const rect = frame.current!.getBoundingClientRect();
    return mapOutputToSource(
      {
        x: clamp((clientX - rect.left) / rect.width),
        y: clamp((clientY - rect.top) / rect.height),
      },
      dimensions!,
      viewGeometry,
    );
  }
  function toDisplay(point: Point): Point {
    return dimensions ? mapSourceToOutput(point, dimensions, viewGeometry) : point;
  }
  function ownsEdit(state: EditGesture) {
    return (
      state.identity === editor.getSourceIdentity() && state.lastPreview === editor.getRecipe()
    );
  }
  function previewEdit(state: EditGesture, next: EditorRecipe) {
    state.lastPreview = next;
    editor.preview(next);
  }
  function beginEdit(event: PointerEvent, kind: string) {
    if (
      editGesture.current ||
      !dimensions ||
      !geometryReady ||
      !frame.current ||
      comparing ||
      sampling ||
      event.button !== 0 ||
      space ||
      handMode
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = true;
    frame.current.setPointerCapture(event.pointerId);
    const rawPoint = toSource(event.clientX, event.clientY);
    const point =
      kind === 'brush'
        ? brushPointAtSource(rawPoint, dimensions, editor.brushSettings.radius)
        : rawPoint;
    const state: EditGesture = {
      pointer: event.pointerId,
      kind,
      base: recipe,
      lastPreview: recipe,
      mask,
      start: point,
      identity: editor.getSourceIdentity(),
    };
    if (kind === 'brush' && mask.type === 'brush') {
      const localPoints = mask.strokes.reduce((n, stroke) => n + stroke.points.length, 0);
      const allPoints =
        recipe.schemaVersion === 2
          ? recipe.regions.reduce(
              (n, item) =>
                n +
                (item.mask.type === 'brush'
                  ? item.mask.strokes.reduce((m, stroke) => m + stroke.points.length, 0)
                  : 0),
              0,
            )
          : 0;
      if (
        mask.strokes.length >= MAX_BRUSH_STROKES ||
        localPoints >= MAX_BRUSH_POINTS_PER_MASK ||
        allPoints >= MAX_TOTAL_BRUSH_POINTS
      ) {
        setNotice('当前笔刷记录已达安全预算。可删除旧笔触或建立新作品；不会静默丢弃笔触。');
        return;
      }
      state.points = [point];
      state.stroke = { ...editor.brushSettings, points: state.points };
      previewEdit(
        state,
        replaceSelectionMask(recipe, editor.activeRegionId, {
          ...mask,
          strokes: [...mask.strokes, state.stroke],
        }),
      );
    }
    editGesture.current = state;
    setNotice(null);
  }
  function moveEdit(event: PointerEvent<HTMLDivElement>) {
    const state = editGesture.current;
    if (!state || state.pointer !== event.pointerId || !dimensions || !geometryReady) return;
    if (!ownsEdit(state)) {
      editGesture.current = null;
      return;
    }
    if ((event.buttons & 1) === 0) {
      endEdit(event, true);
      return;
    }
    const rawPoint = toSource(event.clientX, event.clientY);
    const point =
      state.kind === 'brush' && state.stroke
        ? brushPointAtSource(rawPoint, dimensions, state.stroke.radius)
        : rawPoint;
    if (state.kind.startsWith('crop-')) {
      const old = state.base.geometry.crop ?? { x: 0, y: 0, width: 1, height: 1 };
      let x = old.x * dimensions.width,
        y = old.y * dimensions.height,
        right = (old.x + old.width) * dimensions.width,
        bottom = (old.y + old.height) * dimensions.height;
      const deltaX = (point.x - state.start.x) * dimensions.width,
        deltaY = (point.y - state.start.y) * dimensions.height;
      const handle = state.kind.slice(5);
      if (handle === 'move') {
        const w = right - x,
          h = bottom - y;
        x = clamp(x + deltaX, 0, dimensions.width - w);
        y = clamp(y + deltaY, 0, dimensions.height - h);
        right = x + w;
        bottom = y + h;
      } else {
        if (handle.includes('w')) x = clamp(point.x * dimensions.width, 0, right - 1);
        if (handle.includes('e'))
          right = clamp(point.x * dimensions.width, x + 1, dimensions.width);
        if (handle.includes('n')) y = clamp(point.y * dimensions.height, 0, bottom - 1);
        if (handle.includes('s'))
          bottom = clamp(point.y * dimensions.height, y + 1, dimensions.height);
      }
      previewEdit(state, {
        ...state.base,
        geometry: {
          ...state.base.geometry,
          crop: cropFromPixels(dimensions, { x, y, width: right - x, height: bottom - y }),
        },
      });
      return;
    }
    const original = state.mask;
    if (!original) return;
    let next: SelectionMaskV2 = original;
    if (original.type === 'radial') {
      if (state.kind === 'center')
        next = {
          ...original,
          centerX: clamp(original.centerX + point.x - state.start.x),
          centerY: clamp(original.centerY + point.y - state.start.y),
        };
      if (state.kind === 'radiusX')
        next = { ...original, radiusX: clamp(Math.abs(point.x - original.centerX), 0.0001, 1) };
      if (state.kind === 'radiusY')
        next = { ...original, radiusY: clamp(Math.abs(point.y - original.centerY), 0.0001, 1) };
    } else if (original.type === 'linear') {
      next = {
        ...original,
        [state.kind === 'linear-start' ? 'start' : 'end']: { x: clamp(point.x), y: clamp(point.y) },
      };
      if (
        next.type === 'linear' &&
        Math.hypot(next.end.x - next.start.x, next.end.y - next.start.y) < 0.0001
      )
        return;
    } else if (original.type === 'polygon' && state.kind.startsWith('polygon-')) {
      const index = Number(state.kind.slice(8));
      next = {
        ...original,
        points: original.points.map((p, i) =>
          i === index ? { x: clamp(point.x), y: clamp(point.y) } : p,
        ),
      };
    } else if (original.type === 'brush' && state.points && state.stroke) {
      const previous = state.points.at(-1)!;
      if (
        Math.hypot(
          (point.x - previous.x) * dimensions.width,
          (point.y - previous.y) * dimensions.height,
        ) <
        Math.max(
          1,
          (editor.brushSettings.radius * Math.min(dimensions.width, dimensions.height)) / 8,
        )
      )
        return;
      const localPoints = original.strokes.reduce((n, s) => n + s.points.length, 0);
      const allPoints =
        state.base.schemaVersion === 2
          ? state.base.regions.reduce(
              (n, item) =>
                n +
                (item.mask.type === 'brush'
                  ? item.mask.strokes.reduce((m, s) => m + s.points.length, 0)
                  : 0),
              0,
            )
          : 0;
      if (
        state.points.length >= MAX_BRUSH_POINTS_PER_STROKE ||
        localPoints + state.points.length >= MAX_BRUSH_POINTS_PER_MASK ||
        allPoints + state.points.length >= MAX_TOTAL_BRUSH_POINTS
      ) {
        setNotice('这笔已达到采样预算，请松开后继续下一笔；已画部分保留。');
        return;
      }
      state.points.push(point);
      next = {
        ...original,
        strokes: [...original.strokes, { ...state.stroke, points: [...state.points] }],
      };
    }
    try {
      parseSelectionMask(next);
    } catch {
      setNotice('请保留三个非共线轮廓点；已保留上一个有效形状。');
      return;
    }
    previewEdit(state, replaceSelectionMask(state.base, editor.activeRegionId, next));
  }
  function endEdit(event: PointerEvent<HTMLDivElement>, cancel = false) {
    const state = editGesture.current;
    if (!state || state.pointer !== event.pointerId) return;
    editGesture.current = null;
    if (ownsEdit(state)) {
      if (cancel) editor.preview(state.base);
      else
        editor.commitCurrent(
          state.kind.startsWith('crop-')
            ? '手动构图'
            : state.kind === 'brush'
              ? '绘制局部笔触'
              : '直接调整选区',
        );
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function sampleAt(clientX: number, clientY: number) {
    if (!image || !frame.current) return;
    if (!geometryReady) {
      setNotice('构图预览正在更新，请就绪后再取色。');
      return;
    }
    if (samplingSource && source && dimensions) {
      const picked = sampleSourcePreview(source, toSource(clientX, clientY));
      setInspected({ ...picked, source: true });
      if (sampling && onSample)
        onSample(
          '#' +
            picked.rgba
              .map((v) => v.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase(),
        );
      return;
    }
    const rect = frame.current.getBoundingClientRect(),
      x = clamp(Math.floor(((clientX - rect.left) / rect.width) * image.width), 0, image.width - 1),
      y = clamp(
        Math.floor(((clientY - rect.top) / rect.height) * image.height),
        0,
        image.height - 1,
      ),
      index = (y * image.width + x) * 4;
    const rgba = Array.from(image.data.subarray(index, index + 4));
    setInspected({ x, y, rgba, source: false });
    if (sampling && onSample)
      onSample(
        '#' +
          rgba
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase(),
      );
  }
  function addPolygonPoint(event: React.MouseEvent) {
    if (!editingSelection || mask.type !== 'polygon' || mask.points.length >= 64 || !dimensions)
      return;
    const p = toSource(event.clientX, event.clientY);
    let nearest = 0,
      distance = Infinity;
    mask.points.forEach((a, i) => {
      const b = mask.points[(i + 1) % mask.points.length]!,
        vx = (b.x - a.x) * dimensions.width,
        vy = (b.y - a.y) * dimensions.height;
      const t = clamp(
        ((p.x - a.x) * dimensions.width * vx + (p.y - a.y) * dimensions.height * vy) /
          Math.max(1e-12, vx * vx + vy * vy),
      );
      const d = Math.hypot(
        (p.x - a.x - (b.x - a.x) * t) * dimensions.width,
        (p.y - a.y - (b.y - a.y) * t) * dimensions.height,
      );
      if (d < distance) {
        distance = d;
        nearest = i;
      }
    });
    const points = [...mask.points];
    points.splice(nearest + 1, 0, p);
    const nextMask = { ...mask, points };
    try {
      parseSelectionMask(nextMask);
      editor.commit(
        replaceSelectionMask(recipe, editor.activeRegionId, nextMask),
        '添加轮廓控制点',
      );
    } catch {
      setNotice('这个控制点无法形成有效轮廓，原选区已保留。');
    }
  }
  function handle(point: Point, label: string, kind: string) {
    const p = toDisplay(point);
    return (
      <button
        key={kind}
        className={`image-handle ${kind.startsWith('crop') ? 'crop-handle' : ''}`}
        aria-label={label}
        title={label}
        style={{
          left: `${p.x * 100}%`,
          top: `${p.y * 100}%`,
          transform: `translate(-50%,-50%) scale(${1 / zoom})`,
        }}
        onPointerDown={(event) => beginEdit(event, kind)}
      >
        <i />
      </button>
    );
  }
  const prevent = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const crop = recipe.geometry.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const corners = [
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.width, y: crop.y },
    { x: crop.x + crop.width, y: crop.y + crop.height },
    { x: crop.x, y: crop.y + crop.height },
  ].map(toDisplay);
  const cropBounds = {
    x: Math.min(...corners.map((p) => p.x)),
    y: Math.min(...corners.map((p) => p.y)),
    width: Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x)),
    height: Math.max(...corners.map((p) => p.y)) - Math.min(...corners.map((p) => p.y)),
  };
  const center = mask.type === 'radial' ? toDisplay({ x: mask.centerX, y: mask.centerY }) : null;
  const rx =
    mask.type === 'radial' && center
      ? Math.max(
          Math.abs(toDisplay({ x: mask.centerX + mask.radiusX, y: mask.centerY }).x - center.x),
          Math.abs(toDisplay({ x: mask.centerX, y: mask.centerY + mask.radiusY }).x - center.x),
        )
      : 0;
  const ry =
    mask.type === 'radial' && center
      ? Math.max(
          Math.abs(toDisplay({ x: mask.centerX + mask.radiusX, y: mask.centerY }).y - center.y),
          Math.abs(toDisplay({ x: mask.centerX, y: mask.centerY + mask.radiusY }).y - center.y),
        )
      : 0;
  return (
    <main
      className={`canvas-stage content-first ${dragging ? 'is-dragging' : ''} ${editor.file ? 'has-image' : ''}`}
      onDragOver={(event) => {
        prevent(event);
        setDragging(true);
      }}
      onDragLeave={(event) => {
        prevent(event);
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        prevent(event);
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) onImport(file);
      }}
    >
      <div className="canvas-file-info" data-motion="canvas-file-info">
        {editor.file && (
          <>
            <span>{editor.file.name}</span>
            <small>
              {output?.width} × {output?.height}
            </small>
            {editor.rendering && <Busy label="更新预览" />}
          </>
        )}
      </div>
      <div className="canvas-error">
        <InlineError message={editor.error ?? previews.error ?? notice} />
      </div>
      <div
        className={`image-viewport ${editingSelection ? 'placement-mode' : ''} ${zoom > 1 || handMode || space ? 'can-pan' : ''} ${sampling ? 'sampling' : ''}`}
        ref={viewport}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setZoom((value) => clamp(value * Math.exp(-event.deltaY * 0.005), 0.02, 128));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          if (editingSelection || (group === 'crop' && !space && !handMode)) return;
          pointerPositions.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointerPositions.current.size === 2) {
            const values = [...pointerPositions.current.values()];
            pinch.current = {
              distance: Math.hypot(values[0]!.x - values[1]!.x, values[0]!.y - values[1]!.y),
              zoom,
            };
            panGesture.current = null;
          } else if (zoom > 1 || space || handMode)
            panGesture.current = {
              pointer: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              start: pan,
            };
          else return;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (pointerPositions.current.has(event.pointerId))
            pointerPositions.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pinch.current && pointerPositions.current.size === 2) {
            const points = [...pointerPositions.current.values()];
            const distance = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
            setZoom(
              clamp(
                (pinch.current.zoom * distance) / Math.max(1, pinch.current.distance),
                0.02,
                128,
              ),
            );
            return;
          }
          const current = panGesture.current;
          if (current?.pointer === event.pointerId)
            setPan(
              boundedPan({
                x: current.start.x + event.clientX - current.x,
                y: current.start.y + event.clientY - current.y,
              }),
            );
        }}
        onPointerUp={(event) => {
          pointerPositions.current.delete(event.pointerId);
          pinch.current = null;
          panGesture.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          pointerPositions.current.delete(event.pointerId);
          pinch.current = null;
          panGesture.current = null;
        }}
      >
        {!editor.file ? (
          <div className="import-state minimal-import">
            <span className="import-outline" aria-hidden>
              <Plus size={32} weight="light" />
            </span>
            <h1>打开图片，开始创作</h1>
            <p>画面留给你，工具随需要展开。</p>
            <div className="import-actions">
              <button className="button button-primary" onClick={() => onImport()}>
                <Plus size={18} />
                选择图片
              </button>
              <button className="button button-secondary" onClick={onDraw}>
                <PencilSimple size={18} />
                画一张草图
              </button>
            </div>
            <small>拖入图片也可以 · 导入不会自动上传</small>
          </div>
        ) : image ? (
          <div
            className="image-frame"
            ref={frame}
            style={{
              width: display.width,
              height: display.height,
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
            onPointerDown={(event) => {
              if (editingSelection && mask.type === 'brush') beginEdit(event, 'brush');
            }}
            onPointerMove={moveEdit}
            onPointerUp={(event) => endEdit(event)}
            onPointerCancel={(event) => endEdit(event, true)}
            onLostPointerCapture={(event) => endEdit(event, true)}
            onDoubleClick={addPolygonPoint}
            onClick={(event) => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              if ((event.target as Element).closest('.image-handle') || comparing) return;
              if (sampling) {
                sampleAt(event.clientX, event.clientY);
                return;
              }
              if (editingSelection && mask.type === 'radial' && dimensions) {
                const point = toSource(event.clientX, event.clientY);
                editor.commit(
                  replaceSelectionMask(recipe, editor.activeRegionId, {
                    ...mask,
                    centerX: clamp(point.x),
                    centerY: clamp(point.y),
                  }),
                  '定位径向选区',
                );
              }
            }}
          >
            <PixelCanvas image={image} />
            {editingSelection && editor.maskOverlay && source && dimensions && (
              <MaskPreview
                mask={mask}
                source={source}
                dimensions={dimensions}
                geometry={viewGeometry}
                ratio={image.width / image.height}
                opacity={region?.opacity ?? 1}
              />
            )}
            {editingSelection && (
              <>
                <svg
                  className="mask-overlay"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  {mask.type === 'radial' && center && (
                    <ellipse
                      cx={center.x * 100}
                      cy={center.y * 100}
                      rx={rx * 100}
                      ry={ry * 100}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={0.2 / zoom}
                      strokeDasharray={`${1 / zoom} ${0.7 / zoom}`}
                    />
                  )}
                  {mask.type === 'linear' && (
                    <line
                      x1={toDisplay(mask.start).x * 100}
                      y1={toDisplay(mask.start).y * 100}
                      x2={toDisplay(mask.end).x * 100}
                      y2={toDisplay(mask.end).y * 100}
                      stroke="#fff"
                      strokeWidth={0.35 / zoom}
                    />
                  )}
                  {mask.type === 'polygon' && (
                    <polygon
                      points={mask.points
                        .map((point) => {
                          const p = toDisplay(point);
                          return `${p.x * 100},${p.y * 100}`;
                        })
                        .join(' ')}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={0.25 / zoom}
                    />
                  )}
                </svg>
                {mask.type === 'radial' && (
                  <>
                    {handle({ x: mask.centerX, y: mask.centerY }, '拖动选区中心', 'center')}
                    {handle(
                      { x: mask.centerX + mask.radiusX, y: mask.centerY },
                      '拖动横向半径',
                      'radiusX',
                    )}
                    {handle(
                      { x: mask.centerX, y: mask.centerY + mask.radiusY },
                      '拖动纵向半径',
                      'radiusY',
                    )}
                  </>
                )}
                {mask.type === 'linear' && (
                  <>
                    {handle(mask.start, '拖动渐变起点', 'linear-start')}
                    {handle(mask.end, '拖动渐变终点', 'linear-end')}
                  </>
                )}
                {mask.type === 'polygon' &&
                  mask.points.map((point, index) =>
                    handle(point, `拖动多边形点 ${index + 1}`, `polygon-${index}`),
                  )}
              </>
            )}
            {group === 'crop' && !comparing && (
              <>
                <svg
                  className="crop-overlay"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path
                    d={`M0 0H100V100H0Z M${cropBounds.x * 100} ${cropBounds.y * 100}h${cropBounds.width * 100}v${cropBounds.height * 100}h${-cropBounds.width * 100}Z`}
                    fill="#10121688"
                    fillRule="evenodd"
                  />
                  <rect
                    x={cropBounds.x * 100}
                    y={cropBounds.y * 100}
                    width={cropBounds.width * 100}
                    height={cropBounds.height * 100}
                    fill="none"
                    stroke="white"
                    strokeWidth={0.25 / zoom}
                  />
                  {[1, 2].map((n) => (
                    <g key={n} opacity=".5">
                      <line
                        x1={(cropBounds.x + (cropBounds.width * n) / 3) * 100}
                        x2={(cropBounds.x + (cropBounds.width * n) / 3) * 100}
                        y1={cropBounds.y * 100}
                        y2={(cropBounds.y + cropBounds.height) * 100}
                        stroke="white"
                        strokeWidth={0.1 / zoom}
                      />
                      <line
                        x1={cropBounds.x * 100}
                        x2={(cropBounds.x + cropBounds.width) * 100}
                        y1={(cropBounds.y + (cropBounds.height * n) / 3) * 100}
                        y2={(cropBounds.y + (cropBounds.height * n) / 3) * 100}
                        stroke="white"
                        strokeWidth={0.1 / zoom}
                      />
                    </g>
                  ))}
                </svg>
                {(
                  [
                    ['nw', 0, 0],
                    ['n', 0.5, 0],
                    ['ne', 1, 0],
                    ['e', 1, 0.5],
                    ['se', 1, 1],
                    ['s', 0.5, 1],
                    ['sw', 0, 1],
                    ['w', 0, 0.5],
                    ['move', 0.5, 0.5],
                  ] as [string, number, number][]
                ).map(([kind, x, y]) =>
                  handle(
                    { x: crop.x + crop.width * x, y: crop.y + crop.height * y },
                    kind === 'move' ? '拖动裁切区域' : `调整裁切 ${kind}`,
                    `crop-${kind}`,
                  ),
                )}
              </>
            )}
            {comparing && (
              <span
                className="original-label"
                style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'left top' }}
              >
                原图 · 同一构图
              </span>
            )}
          </div>
        ) : (
          <Busy label={comparing ? '准备同一构图的原图…' : '准备完整构图预览…'} />
        )}
      </div>
      {editor.file && (
        <>
          <div className="canvas-view-controls" data-motion="canvas-toolbar">
            <IconButton label="撤销本次编辑" disabled={!editor.canUndo} onClick={editor.undo}>
              <ArrowCounterClockwise size={17} />
            </IconButton>
            <IconButton label="重做本次编辑" disabled={!editor.canRedo} onClick={editor.redo}>
              <ArrowClockwise size={17} />
            </IconButton>
            <button
              className={`compare-press ${comparing ? 'active' : ''}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setComparing(true);
              }}
              onPointerUp={() => setComparing(false)}
              onPointerCancel={() => setComparing(false)}
              onLostPointerCapture={() => setComparing(false)}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  setComparing(true);
                }
              }}
              onKeyUp={() => setComparing(false)}
              onBlur={() => setComparing(false)}
            >
              <Eye size={17} />
              <span>按住对比</span>
            </button>
            <IconButton
              label="缩小预览"
              disabled={zoom <= 0.02}
              onClick={() => setZoom(clamp(zoom / 1.25, 0.02, 128))}
            >
              <MagnifyingGlassMinus size={18} />
            </IconButton>
            <button className="zoom-fit" onClick={fit} title="点击完整显示图片">
              {zoom === 1 ? '适应' : `${Math.round(scale * zoom * 100)}%`}
            </button>
            <IconButton
              label="放大预览"
              disabled={zoom >= 128}
              onClick={() => setZoom(clamp(zoom * 1.25, 0.02, 128))}
            >
              <MagnifyingGlassPlus size={18} />
            </IconButton>
            <IconButton label="完整显示整张图片" onClick={fit}>
              <CornersOut size={18} />
            </IconButton>
            <button
              className="pixel-scale-button"
              title="一个预览像素对应一个CSS像素，不把缩小预览当原图"
              onClick={() => {
                setZoom(clamp(1 / scale, 0.02, 128));
                setPan({ x: 0, y: 0 });
              }}
            >
              1:1
            </button>
            <button
              className={`canvas-hand-mode ${handMode ? 'active' : ''}`}
              aria-label="拖动画面模式"
              aria-pressed={handMode}
              onClick={() => setHandMode(!handMode)}
            >
              <Hand size={17} />
            </button>
          </div>
          {sampling ? (
            <div className="canvas-context-hint" data-motion="sample-hint">
              <Eyedropper size={14} />
              {samplingSource ? '点击画面，从未调色原图预览选择颜色' : '点击画面，读取当前显示颜色'}
            </div>
          ) : editingSelection ? (
            <div className="canvas-context-hint" data-motion="selection-hint">
              {mask.type === 'brush'
                ? '直接涂抹选区 · 空格 / 手形工具平移'
                : mask.type === 'radial'
                  ? '点选中心 · 拖动白点改变范围'
                  : mask.type === 'linear'
                    ? '拖动两端调整渐变方向与范围'
                    : mask.type === 'polygon'
                      ? '拖动轮廓点 · 双击添加点'
                      : '连续颜色范围 · 参照未调整原图'}
            </div>
          ) : group === 'crop' ? (
            <div className="canvas-context-hint" data-motion="crop-hint">
              拖动边缘自由裁切 · 中间白点移动范围
            </div>
          ) : null}
          {inspected && (
            <output className="pixel-readout">
              {inspected.source ? '原图预览' : '显示预览'} ({inspected.x},{inspected.y}) · RGBA{' '}
              {inspected.rgba.join(' / ')}
              <button aria-label="收起像素读数" onClick={() => setInspected(null)}>
                ×
              </button>
            </output>
          )}
          {image && zoom !== 1 && (
            <span className="preview-resolution">
              预览 {image.width}×{image.height} · 导出 {output?.width}×{output?.height}
            </span>
          )}
        </>
      )}
      {editor.loading && (
        <div className="stage-loading" role="status">
          <Busy label="正在准备图片…" />
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <UploadSimple size={35} />
          <strong>松开，打开这张图片</strong>
          <span>先在本地处理</span>
        </div>
      )}
    </main>
  );
}
