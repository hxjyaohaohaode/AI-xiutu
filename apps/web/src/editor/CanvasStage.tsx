import { t } from '../i18n';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  UploadSimple,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  CornersOut,
  CornersIn,
  Eye,
  PencilSimple,
  Hand,
  Eyedropper,
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowsOutCardinal,
  DotsThree,
} from '../components/ControlGlyph';
import {
  getEditorOutputDimensions,
  compileProjectiveTransformV4,
  type RecipeV4,
  compileEditorCoordinateMap,
  parseEditorRecipe,
  pixelCrop,
  parseSelectionMaskV3,
  radialMaskFrameV3,
  type PaintStrokeV3,
  type WarpStrokeV3,
  type ImageLayerV3,
  type SelectionMaskV3,
  parseSelectionMask,
  MAX_BRUSH_STROKES,
  MAX_BRUSH_POINTS_PER_STROKE,
  MAX_BRUSH_POINTS_PER_MASK,
  MAX_TOTAL_BRUSH_POINTS,
  type RGBAImage,
  type EditorRecipe,
  type Geometry,
  type Dimensions,
  type Point,
  type BrushStrokeV2,
} from '@ai-xiutu/editor';
import { Busy, IconButton, InlineError } from '../components/Ui';
import { StudioGlyph } from '../components/StudioGlyph';
import { editorGeometryKey, type EditorState, type PreviewQuality } from './useEditor';
import { sourcePointer, projectOverlayPoint, projectOverlayPath } from './coordinates';
import { appendRepairRegion } from './repair-draft';
import { CanvasPointerOwnership, ownedCanvasRollback } from './canvas-gesture';
import {
  appendFreehandPoints,
  pointerPathSamples,
  startFreehandPath,
  type FreehandPathState,
} from './freehand';
import { secureUuid } from '../lib/uuid';
import type { ToolGroup } from './ToolInspector';
import {
  brushPointAtSource,
  clamp,
  moveCropHandle,
  replaceSelectionMask,
  replaceMaskAtPath,
  maskAtPath,
  sampleSourcePreview,
} from './precision';
import { useStagePreviews } from './useStagePreviews';
import {
  CORNER_LABELS,
  preProjectiveDimensions,
  projectiveDisplayPoint,
  projectivePointer,
  withProjectiveCorner,
} from './projective-model';
import type { CollaborationState } from '../collaboration/useCollaboration';
import { CollaborationOverlay } from '../collaboration/CollaborationOverlay';
import './editor-controls.css';
import { StudioWelcome } from '../workspace/StudioWelcome';
import { studioText } from '../workspace/studio-copy';
import {
  polygonCenter,
  polygonRotationDelta,
  rotatePolygon,
  translatePolygon,
} from './selection-transform';

export function PixelCanvas({
  image,
  className = '',
}: {
  image: RGBAImage | null;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (!image || !ref.current) return;
    if (ref.current.width !== image.width) ref.current.width = image.width;
    if (ref.current.height !== image.height) ref.current.height = image.height;
    ref.current
      .getContext('2d')
      ?.putImageData(
        new ImageData(
          new Uint8ClampedArray(
            image.data.buffer as ArrayBuffer,
            image.data.byteOffset,
            image.data.byteLength,
          ),
          image.width,
          image.height,
        ),
        0,
        0,
      );
  }, [image]);
  return <canvas ref={ref} className={className} aria-label={t('照片编辑预览')} />;
}
function MaskPreview({
  mask,
  dimensions,
  source,
  recipe,
  ratio,
  opacity,
  automatic,
  contentSpace,
}: {
  mask: SelectionMaskV3;
  dimensions: Dimensions;
  source: RGBAImage;
  recipe: EditorRecipe;
  ratio: number;
  opacity: number;
  automatic: boolean;
  contentSpace: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null),
    sequence = useRef(0),
    busy = useRef(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  const key = JSON.stringify({ mask, dimensions, recipe, ratio, opacity, contentSpace });
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
      recipe,
      ratio,
      opacity,
      contentSpace,
    };
    pump();
  }, [key, source]);
  return (
    <canvas
      ref={ref}
      className="selection-preview"
      data-preview-mode={automatic ? 'locate' : 'inspect'}
      aria-hidden
    />
  );
}
function editPointerBounds(kind: string) {
  if (kind === 'paint' || kind === 'brush' || kind === 'warp') return 'strict';
  if (
    kind.startsWith('image-') ||
    kind.endsWith('-rotation') ||
    kind === 'polygon-rotate' ||
    kind.startsWith('radius')
  )
    return 'unbounded';
  return 'clamp';
}

function selectionRotation(center: Point, start: Point, end: Point, dimensions: Dimensions) {
  const vector = (point: Point) => ({
    x: (point.x - center.x) * dimensions.width,
    y: (point.y - center.y) * dimensions.height,
  });
  const a = vector(start),
    b = vector(end);
  if (Math.hypot(a.x, a.y) < 1 || Math.hypot(b.x, b.y) < 1) return null;
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}

type EditGesture = {
  pointer: number;
  kind: string;
  quality: PreviewQuality;
  base: EditorRecipe;
  rollback?: EditorRecipe;
  lastPreview: EditorRecipe;
  mask?: SelectionMaskV3;
  paint?: PaintStrokeV3;
  paintLayerId?: string;
  warp?: WarpStrokeV3;
  warpPointer?: {
    axis: 'free' | 'horizontal' | 'vertical';
    x: number;
    y: number;
    strength: number;
  };
  imageLayer?: ImageLayerV3;
  newRepair?: { mode: 'healing' | 'retouch'; id: string };
  projective?: {
    index: number;
    rect: { left: number; top: number; width: number; height: number };
    dimensions: Dimensions;
  };
  start: Point;
  identity: number;
  points?: Point[];
  path?: FreehandPathState;
  stroke?: BrushStrokeV2;
};
const isTyping = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));

const MIN_CANVAS_ZOOM = 0.25;
const MAX_CANVAS_ZOOM = 128;
const fittedCamera = { zoom: 1, pan: { x: 0, y: 0 } };

export function CanvasStage({
  editor,
  statusContainer,
  collaboration,
  group,
  onImport,
  onAI,
  onDraw,
  accountState,
  onSignIn,
  onRegister,
  comparing,
  setComparing,
  sampling = false,
  onSample,
}: {
  editor: EditorState;
  statusContainer: HTMLElement | null;
  collaboration?: CollaborationState;
  group: ToolGroup;
  onImport: (files?: File[]) => void;
  onAI: () => void;
  onDraw: () => void;
  accountState?: 'loading' | 'guest' | 'signed-in';
  onSignIn?: () => void;
  onRegister?: () => void;
  comparing: boolean;
  setComparing: (value: boolean) => void;
  sampling?: boolean;
  onSample?: (color: string) => void;
}) {
  const [dragging, setDragging] = useState(false),
    [camera, setCamera] = useState(fittedCamera),
    [bounds, setBounds] = useState({ width: 1, height: 1 });
  const { zoom, pan } = camera;
  const [space, setSpace] = useState(false),
    [handMode, setHandMode] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [viewToolsOpen, setViewToolsOpen] = useState(false);
  const viewToolsId = useId();
  const viewToolbar = useRef<HTMLDivElement>(null);
  const viewToolsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!viewToolsOpen) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (!viewToolbar.current?.contains(event.target as Node)) setViewToolsOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [viewToolsOpen]);
  const [selectionPulse, setSelectionPulse] = useState(false);
  const [selectionHeld, setSelectionHeld] = useState(false);
  const [selectionManipulating, setSelectionManipulating] = useState(false);
  const [projectiveFrame, setProjectiveFrame] = useState<{
    scale: number;
    center: Point;
    dimensions: Dimensions;
  } | null>(null);
  const [inspected, setInspected] = useState<{
    x: number;
    y: number;
    rgba: number[];
    source: boolean;
  } | null>(null);
  const viewport = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLDivElement>(null);
  const editGesture = useRef<EditGesture | null>(null);
  const pointerOwnership = useRef(new CanvasPointerOwnership());
  const suppressClick = useRef(false);
  const panGesture = useRef<{ pointer: number; x: number; y: number; start: typeof pan } | null>(
    null,
  );
  const pointerPositions = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; camera: typeof camera; center: Point } | null>(null);
  const wheelAction = useRef<(event: WheelEvent) => void>(() => {});
  const brushFootprint = useRef<SVGPathElement>(null);
  const recipe = editor.recipe,
    source = editor.originalPreview,
    dimensions = editor.dimensions;
  const cropEditing = group === 'crop' && editor.geometryMode === 'crop';
  const projectiveEditing =
    group === 'crop' && editor.geometryMode === 'projective' && recipe.schemaVersion === 4;
  const contentSpace =
    group === 'repair' || group === 'local' || group === 'composite' || group === 'paint';
  const previews = useStagePreviews(
    source,
    dimensions,
    recipe,
    cropEditing,
    editor.layerImages,
    collaboration?.remotePreview ?? null,
    editor.liveFrame !== null,
  );
  const liveFrame =
    !comparing &&
    !cropEditing &&
    !previews.remote &&
    (group !== 'liquify' || editor.liveFrame?.quality === 'warp')
      ? editor.liveFrame
      : null;
  const image = comparing
    ? previews.compare
    : cropEditing
      ? (previews.crop ?? null)
      : (previews.remote ?? liveFrame?.image ?? editor.rendered);
  const viewGeometry: Geometry =
    cropEditing && !comparing ? { ...recipe.geometry, crop: null } : recipe.geometry;
  const localViewRecipe: EditorRecipe = { ...recipe, geometry: viewGeometry };
  const viewRecipe =
    previews.remote && collaboration?.remotePreview && !cropEditing && !comparing
      ? collaboration.remotePreview
      : localViewRecipe;
  const liveGeometry = liveFrame ? editorGeometryKey(liveFrame.recipe) : null;
  const layoutRecipe = !comparing && cropEditing ? viewRecipe : liveFrame?.recipe;
  const layoutGeometry = layoutRecipe ? editorGeometryKey(layoutRecipe) : null;
  const referenceSize = useMemo(() => {
    if (!source || !layoutRecipe) return null;
    try {
      return getEditorOutputDimensions(source, layoutRecipe);
    } catch {
      return null;
    }
  }, [source, layoutGeometry]);
  // Resolution can change while a stroke is still collecting points. Keep its
  // CSS frame in the same geometry rather than the live raster's rounded ratio.
  const frameRaster =
    liveGeometry && liveGeometry === editor.renderedGeometryKey
      ? (editor.rendered ?? referenceSize ?? image)
      : (referenceSize ?? image);
  const coordinateMap = useMemo(() => {
    try {
      return dimensions
        ? compileEditorCoordinateMap(dimensions, viewRecipe, source ?? undefined)
        : null;
    } catch {
      return null;
    }
  }, [dimensions, JSON.stringify(viewRecipe), source]);
  const protecting =
    (recipe.schemaVersion === 3 || recipe.schemaVersion === 4) &&
    group === 'liquify' &&
    editor.warpSettings.protecting;
  const region =
    recipe.schemaVersion === 3 || recipe.schemaVersion === 4
      ? recipe.regionEdits.find((item) => item.id === editor.activeRegionId)
      : recipe.schemaVersion === 2
        ? recipe.regions.find((item) => item.id === editor.activeRegionId)
        : null;
  const repair =
    group === 'repair' && recipe.schemaVersion === 4
      ? recipe[editor.repairMode].find((item) => item.id === editor.activeRepairId)
      : null;
  const startRepair =
    group === 'repair' &&
    recipe.schemaVersion === 4 &&
    !repair &&
    !editor.repairProtection &&
    !editor.repairChoosingSource;
  const fullMask = repair
    ? editor.repairProtection
      ? (repair.protection ?? { type: 'brush' as const, strokes: [], invert: false })
      : repair.mask
    : protecting && (recipe.schemaVersion === 3 || recipe.schemaVersion === 4)
      ? (recipe.warp.protection ?? { type: 'brush' as const, strokes: [], invert: false })
      : (region?.mask ?? recipe.local.mask);
  const mask = maskAtPath(fullMask, editor.activeMaskPath);
  const samplingSource = (group === 'local' || group === 'beauty') && mask.type === 'color-range';
  const hasSelection = Boolean(repair || protecting || region || recipe.local.enabled);
  const geometryReady =
    Boolean(coordinateMap) &&
    (!previews.remote || editorGeometryKey(viewRecipe) === editorGeometryKey(recipe)) &&
    (cropEditing || (liveGeometry ?? editor.renderedGeometryKey) === editorGeometryKey(recipe));
  const editingSelection =
    (group === 'local' ||
      (group === 'repair' && !!repair && !editor.repairChoosingSource) ||
      (group === 'beauty' && recipe.schemaVersion !== 3 && recipe.schemaVersion !== 4) ||
      protecting) &&
    hasSelection &&
    geometryReady &&
    !comparing &&
    !sampling &&
    !space &&
    !handMode;
  const defaultRepairBrush = dimensions
    ? Math.min(0.012, 12 / Math.min(dimensions.width, dimensions.height))
    : 0;
  const footprintRadius =
    group === 'liquify' && !protecting
      ? editor.warpSettings.radius
      : group === 'paint' && !editor.paintSettings.automaticMakeup
        ? editor.paintSettings.radius
        : startRepair || (editingSelection && mask.type === 'brush')
          ? startRepair
            ? defaultRepairBrush
            : editor.brushSettings.radius
          : 0;
  const selectionContext = [
    group,
    editor.getSourceIdentity(),
    editor.activeRegionId,
    editor.activeRepairId,
    editor.repairMode,
    editor.repairProtection,
    editor.activeMaskPath.join('.'),
    mask.type,
    mask.type === 'radial' ? (mask.shape ?? 'ellipse') : '',
    protecting,
    hasSelection,
  ].join(':');
  useEffect(() => {
    setSelectionHeld(false);
    setSelectionManipulating(false);
    const available = editingSelection;
    setSelectionPulse(available);
    if (!available) return;
    // Locate a newly selected area once. Color/strength changes do not restart
    // the tint, so the photograph remains clear while judging the result.
    const timer = window.setTimeout(() => setSelectionPulse(false), 1000);
    return () => window.clearTimeout(timer);
  }, [selectionContext, editingSelection]);
  const selectionVisible =
    editor.maskOverlay || selectionPulse || selectionHeld || selectionManipulating;
  const output = useMemo(() => {
    try {
      return dimensions ? getEditorOutputDimensions(dimensions, recipe) : null;
    } catch {
      return null;
    }
  }, [dimensions, recipe]);
  const scale = frameRaster
    ? Math.max(
        0.0001,
        Math.min(
          (bounds.width - 24) / frameRaster.width,
          (bounds.height - 24) / frameRaster.height,
        ),
      )
    : 1;
  const fittedDisplay = frameRaster
    ? {
        width: Math.max(1, frameRaster.width * scale),
        height: Math.max(1, frameRaster.height * scale),
      }
    : { width: 1, height: 1 };
  // Keep one destination coordinate frame throughout a corner gesture. Contain-fit
  // output bounds may grow on each render; moving its origin must not move the grip.
  const visibleRecipe = liveFrame?.recipe ?? editor.renderedRecipe;
  const renderedProjective = visibleRecipe?.schemaVersion === 4 ? visibleRecipe : null;
  const renderedProjection =
    projectiveFrame && renderedProjective
      ? compileProjectiveTransformV4(projectiveFrame.dimensions, renderedProjective.projective)
      : null;
  const display =
    renderedProjection && projectiveFrame
      ? {
          width: renderedProjection.dimensions.width * projectiveFrame.scale,
          height: renderedProjection.dimensions.height * projectiveFrame.scale,
        }
      : fittedDisplay;
  const projectiveOffset =
    renderedProjection && projectiveFrame
      ? {
          x:
            (renderedProjection.origin.x +
              renderedProjection.dimensions.width / 2 -
              projectiveFrame.center.x) *
            projectiveFrame.scale *
            zoom,
          y:
            (renderedProjection.origin.y +
              renderedProjection.dimensions.height / 2 -
              projectiveFrame.center.y) *
            projectiveFrame.scale *
            zoom,
        }
      : { x: 0, y: 0 };
  useEffect(() => {
    setProjectiveFrame(null);
    setCamera(fittedCamera);
    setNotice(null);
    setInspected(null);
    editGesture.current = null;
    pointerOwnership.current.reset();
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
    const element = viewport.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => wheelAction.current(event);
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);
  useEffect(() => {
    if (group !== 'liquify' || !editor.renderedRecipe) return;
    const settled = editor.renderedRecipe;
    const timer = window.setTimeout(() => editor.prepareWarpPreview(settled), 65);
    return () => window.clearTimeout(timer);
  }, [group, editor.renderedRecipe, editor.prepareWarpPreview]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      // A retained editor behind the public introduction must not consume page keys.
      if (!viewport.current || viewport.current.closest('[hidden], [inert]')) return;
      if (
        event.code === 'Space' &&
        !isTyping(event.target) &&
        !(event.target instanceof Element && event.target.closest('button,a'))
      ) {
        event.preventDefault();
        setSpace(true);
      }
      if (event.key === 'Escape' && editGesture.current) {
        if (ownsEdit(editGesture.current))
          editor.preview(
            editGesture.current.rollback ?? editGesture.current.base,
            editGesture.current.quality,
          );
        editGesture.current = null;
        setSelectionManipulating(false);
        setSelectionHeld(false);
        setProjectiveFrame(null);
        setNotice(null);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpace(false);
    };
    const blur = () => {
      setSpace(false);
      setSelectionHeld(false);
      setSelectionManipulating(false);
      pointerOwnership.current.reset();
      panGesture.current = null;
      pinch.current = null;
      pointerPositions.current.clear();
      if (editGesture.current) {
        if (ownsEdit(editGesture.current))
          editor.preview(
            editGesture.current.rollback ?? editGesture.current.base,
            editGesture.current.quality,
          );
        editGesture.current = null;
        setProjectiveFrame(null);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    // A lost capture can deliver the eventual release outside the viewport.
    // The viewport handles its own releases before bubbling can be stopped.
    const outsideRelease = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node) || !viewport.current?.contains(event.target))
        pointerOwnership.current.up(event.pointerId);
    };
    window.addEventListener('pointerup', outsideRelease);
    window.addEventListener('pointercancel', outsideRelease);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerup', outsideRelease);
      window.removeEventListener('pointercancel', outsideRelease);
    };
  }, [editor.preview]);
  useEffect(() => {
    if (projectiveFrame) return;
    setCamera((current) => {
      const next = boundedPan(current.pan, current.zoom);
      return next.x === current.pan.x && next.y === current.pan.y
        ? current
        : { ...current, pan: next };
    });
  }, [bounds.width, bounds.height, display.width, display.height, projectiveFrame]);
  useEffect(() => {
    if (editGesture.current && ownsEdit(editGesture.current))
      editor.preview(
        editGesture.current.rollback ?? editGesture.current.base,
        editGesture.current.quality,
      );
    editGesture.current = null;
    setSelectionManipulating(false);
    setProjectiveFrame(null);
    setNotice(null);
  }, [
    group,
    editor.geometryMode,
    editor.activeRepairId,
    editor.repairMode,
    editor.repairProtection,
    editor.activeRegionId,
    JSON.stringify(editor.activeMaskPath),
    protecting,
  ]);
  function fit() {
    setCamera(fittedCamera);
  }
  function boundedPan(value: typeof pan, z = zoom) {
    const x = Math.max(0, (display.width * z - bounds.width) / 2),
      y = Math.max(0, (display.height * z - bounds.height) / 2);
    return { x: clamp(value.x, -x, x), y: clamp(value.y, -y, y) };
  }
  function viewportPoint(clientX: number, clientY: number): Point {
    const rect = viewport.current?.getBoundingClientRect();
    return rect
      ? { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) }
      : { x: 0, y: 0 };
  }
  function zoomedCamera(base: typeof camera, next: number, anchor: Point, destination = anchor) {
    const zoom = clamp(next, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM);
    const factor = zoom / base.zoom;
    return {
      zoom,
      pan: boundedPan(
        {
          x: destination.x - (anchor.x - base.pan.x) * factor,
          y: destination.y - (anchor.y - base.pan.y) * factor,
        },
        zoom,
      ),
    };
  }
  function zoomBy(factor: number, anchor = { x: 0, y: 0 }) {
    if (editGesture.current || projectiveFrame) return;
    setCamera((current) => zoomedCamera(current, current.zoom * factor, anchor));
  }
  wheelAction.current = (event) => {
    if (!image || !event.deltaY || isTyping(event.target)) return;
    event.preventDefault();
    const pixels =
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
    zoomBy(
      Math.exp(-clamp(pixels, -200, 200) * 0.003),
      viewportPoint(event.clientX, event.clientY),
    );
  };
  function toSource(
    clientX: number,
    clientY: number,
    content = contentSpace,
    bounds: 'strict' | 'clamp' | 'unbounded' = 'clamp',
  ): Point | null {
    if (!frame.current || !coordinateMap) return null;
    return sourcePointer(
      { x: clientX, y: clientY },
      frame.current.getBoundingClientRect(),
      coordinateMap,
      content,
      bounds,
    );
  }
  function toDisplay(point: Point): Point | null {
    if (!coordinateMap) return point;
    return contentSpace ? coordinateMap.toContentOutput(point) : coordinateMap.toOutput(point);
  }
  function updateBrushFootprint(event: PointerEvent<HTMLDivElement>) {
    const outline = brushFootprint.current;
    if (!outline || !dimensions) return;
    const point =
      geometryReady &&
      !space &&
      !handMode &&
      !comparing &&
      !sampling &&
      (event.pointerType !== 'touch' || (event.buttons & 1) !== 0)
        ? toSource(event.clientX, event.clientY, contentSpace, 'strict')
        : null;
    if (!point) {
      outline.removeAttribute('d');
      return;
    }
    const center = brushPointAtSource(point, dimensions, footprintRadius);
    const radius = footprintRadius * Math.min(dimensions.width, dimensions.height);
    const points = projectOverlayPath(
      Array.from({ length: 24 }, (_, i) => {
        const angle = (i / 24) * Math.PI * 2;
        return {
          x: center.x + (Math.cos(angle) * radius) / dimensions.width,
          y: center.y + (Math.sin(angle) * radius) / dimensions.height,
        };
      }),
      toDisplay,
    );
    if (points)
      outline.setAttribute('d', `M${points.map((p) => `${p.x * 100} ${p.y * 100}`).join('L')}Z`);
    else outline.removeAttribute('d');
  }
  function overlayPolygon(points: Point[]): string | undefined {
    return projectOverlayPath(points, toDisplay)
      ?.map((p) => `${p.x * 100},${p.y * 100}`)
      .join(' ');
  }
  function replaceMask(
    value: EditorRecipe,
    next: SelectionMaskV3,
    newRepair?: EditGesture['newRepair'],
  ) {
    if (newRepair && value.schemaVersion === 4)
      return {
        ...value,
        [newRepair.mode]: value[newRepair.mode].map((item) =>
          item.id === newRepair.id ? { ...item, mask: next } : item,
        ),
      };
    if (group === 'repair' && value.schemaVersion === 4 && repair) {
      const key = editor.repairProtection ? 'protection' : 'mask';
      return {
        ...value,
        [editor.repairMode]: value[editor.repairMode].map((item) =>
          item.id === repair.id
            ? { ...item, [key]: replaceMaskAtPath(item[key] ?? next, editor.activeMaskPath, next) }
            : item,
        ),
      } as EditorRecipe;
    }
    return replaceSelectionMask(
      value,
      editor.activeRegionId,
      next,
      editor.activeMaskPath,
      protecting,
    );
  }

  function ownsEdit(state: EditGesture) {
    return (
      state.identity === editor.getSourceIdentity() && state.lastPreview === editor.getRecipe()
    );
  }
  function nextCrop(base: EditorRecipe, handle: string, delta: Point, keepRatio: boolean) {
    const original = pixelCrop(dimensions!, base.geometry);
    const orientedRatio = editor.cropRatio;
    const ratio = orientedRatio
      ? base.geometry.rotation % 180 === 0
        ? orientedRatio
        : 1 / orientedRatio
      : keepRatio
        ? original.width / original.height
        : null;
    return {
      ...base,
      geometry: {
        ...base.geometry,
        crop: moveCropHandle(
          dimensions!,
          { ...original, x: original.left, y: original.top },
          handle,
          delta,
          ratio,
        ),
      },
    };
  }
  function previewEdit(state: EditGesture, next: EditorRecipe) {
    try {
      parseEditorRecipe(next);
      state.lastPreview = next;
      editor.preview(next, state.quality);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '本次调整超出安全范围，已保留上一个有效状态。',
      );
    }
  }
  function beginEdit(event: PointerEvent, kind: string) {
    if (
      editGesture.current ||
      !pointerOwnership.current.canStart(event.pointerId) ||
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
    const isProjective = kind.startsWith('projective-') && recipe.schemaVersion === 4;
    const rawPoint = isProjective
      ? projectivePointer(
          { x: event.clientX, y: event.clientY },
          frame.current.getBoundingClientRect(),
          preProjectiveDimensions(dimensions, recipe as RecipeV4),
          recipe as RecipeV4,
        )
      : toSource(event.clientX, event.clientY, contentSpace, editPointerBounds(kind));
    if (!rawPoint) {
      setNotice('这里没有可编辑的源像素，请在图片内容上落笔。');
      return;
    }
    let newId: string | undefined;
    if (
      kind === 'warp' ||
      (kind === 'brush' && startRepair) ||
      (kind === 'paint' &&
        (recipe.schemaVersion === 3 || recipe.schemaVersion === 4) &&
        !recipe.paintLayers.some((layer) => layer.id === editor.activePaintLayerId))
    ) {
      try {
        newId = secureUuid();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '无法建立安全的编辑标识。');
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = true;
    frame.current.setPointerCapture(event.pointerId);
    const brushSettings =
      startRepair && kind === 'brush'
        ? { radius: defaultRepairBrush, feather: 0.25, opacity: 1, mode: 'add' as const }
        : editor.brushSettings;
    const point =
      kind === 'brush' ||
      (kind === 'paint' &&
        !(editor.paintSettings.mode === 'paint' && editor.paintSettings.material))
        ? brushPointAtSource(
            rawPoint,
            dimensions,
            kind === 'paint' ? editor.paintSettings.radius : brushSettings.radius,
          )
        : rawPoint;
    const state: EditGesture = {
      pointer: event.pointerId,
      kind,
      quality:
        kind === 'warp'
          ? 'warp'
          : group === 'repair' || kind === 'paint' || kind === 'brush'
            ? 'full'
            : 'fast',
      base: recipe,
      lastPreview: recipe,
      mask,
      start: point,
      identity: editor.getSourceIdentity(),
    };
    if (kind === 'brush' && startRepair && recipe.schemaVersion === 4) {
      state.newRepair = { mode: editor.repairMode, id: newId! };
      state.base = appendRepairRegion(recipe, state.newRepair.mode, state.newRepair.id);
      state.rollback = recipe;
      state.mask = { type: 'brush', strokes: [], invert: false };
    }
    if (isProjective && recipe.schemaVersion === 4) {
      const preDimensions = preProjectiveDimensions(dimensions, recipe);
      const projection = compileProjectiveTransformV4(preDimensions, recipe.projective);
      state.projective = {
        index: Number(kind.slice(11)),
        rect: frame.current.getBoundingClientRect(),
        dimensions: preDimensions,
      };
      setProjectiveFrame({
        scale: fittedDisplay.width / projection.dimensions.width,
        dimensions: preDimensions,
        center: {
          x: projection.origin.x + projection.dimensions.width / 2,
          y: projection.origin.y + projection.dimensions.height / 2,
        },
      });
    }
    if (kind.startsWith('image-') && (recipe.schemaVersion === 3 || recipe.schemaVersion === 4)) {
      state.imageLayer = recipe.imageLayers.find((layer) => layer.id === editor.activeImageLayerId);
      if (!state.imageLayer) return;
    }
    if (kind === 'paint' && (recipe.schemaVersion === 3 || recipe.schemaVersion === 4)) {
      const settings = editor.paintSettings;
      const material = settings.mode === 'paint' ? settings.material : undefined;
      if (settings.mode === 'clone' && (settings.choosingSource || !settings.source)) {
        editor.setPaintSettings({ ...settings, source: point, choosingSource: false });
        setNotice('克隆来源已选，下一笔开始绘制。');
        return;
      }
      let layer = recipe.paintLayers.find((l) => l.id === editor.activePaintLayerId);
      let base = recipe;
      if (!layer) {
        layer = {
          id: newId!,
          name: material ? t('妆容') : '手动绘制',
          enabled: true,
          opacity: 1,
          blendMode: 'normal',
          mask: null,
          strokes: [],
        };
        base = { ...recipe, paintLayers: [...recipe.paintLayers, layer] };
        editor.setActivePaintLayerId(layer.id);
      }
      state.points = [point];
      const pressure =
        settings.pressureSensitive &&
        event.pointerType === 'pen' &&
        settings.radius * Math.min(dimensions.width, dimensions.height) > 0.5 + 1e-8;
      state.path = startFreehandPath(event.nativeEvent, pressure);
      state.paintLayerId = layer.id;
      state.paint = {
        mode: settings.mode,
        radius: settings.radius,
        feather: settings.feather,
        opacity: settings.opacity,
        color: settings.color,
        ...(material ? { material } : {}),
        source: settings.mode === 'clone' ? settings.source : null,
        points: state.points,
        ...(pressure || material
          ? {
              sampling: {
                algorithm: 'swept-v1',
                pressure: state.path.pressures,
                breaks: [],
                antialias: true,
              },
            }
          : {}),
      };
      // Keep the original recipe for rollback; retain a new empty layer in the stroke's base.
      state.rollback = recipe;
      state.base = base;
      state.lastPreview = recipe;
      previewEdit(state, {
        ...base,
        paintLayers: base.paintLayers.map((l) =>
          l.id === layer!.id ? { ...l, strokes: [...l.strokes, state.paint!] } : l,
        ),
      });
    }
    if (kind === 'warp' && (recipe.schemaVersion === 3 || recipe.schemaVersion === 4)) {
      const settings = editor.warpSettings;
      const region = recipe.regionEdits.find(
        (item) => item.id === settings.regionId && item.enabled,
      );
      let guardId: string | undefined;
      if (settings.regionId && !region) {
        frame.current.releasePointerCapture(event.pointerId);
        setNotice(t('拉伸范围已变化，请重新选择。'));
        return;
      }
      if (region) {
        const mask = { ...region.mask, invert: !region.mask.invert };
        const existing = recipe.warp.guards ?? [];
        const stored = existing.find(
          (guard) => JSON.stringify(guard.mask) === JSON.stringify(mask),
        );
        guardId = stored?.id ?? 'scope-' + newId;
        if (!stored) {
          const used = new Set(recipe.warp.strokes.map((stroke) => stroke.guardId));
          const guards = existing.filter((guard) => used.has(guard.id));
          if (guards.length >= 8) {
            frame.current.releasePointerCapture(event.pointerId);
            setNotice(t('液化范围已达上限，请删除不用的笔画。'));
            return;
          }
          state.rollback = recipe;
          state.base = {
            ...recipe,
            warp: { ...recipe.warp, guards: [...guards, { id: guardId, mask }] },
          };
        }
      }
      const strength = settings.mode === 'restore' ? settings.restoreStrength : settings.strength;
      const pressure =
        event.pointerType === 'pen' && event.pressure > 0 ? 0.25 + 0.75 * event.pressure : 1;
      state.warpPointer = {
        axis: settings.axis ?? 'free',
        x: event.clientX,
        y: event.clientY,
        strength,
      };
      state.warp = {
        id: newId!,
        ...(guardId ? { guardId } : {}),
        ...(editor.warpSettings.mode === 'restore'
          ? { algorithm: 'restore-v1' as const, resampling: 'bounded-cubic-v1' as const }
          : recipe.schemaVersion === 4
            ? { algorithm: 'flow-v2' as const, resampling: 'bounded-cubic-v1' as const }
            : {}),
        mode: editor.warpSettings.mode,
        from: point,
        to: point,
        radius: editor.warpSettings.radius,
        feather: editor.warpSettings.feather,
        strength: strength * pressure,
      };
      if (state.warp.mode !== 'push') {
        const base = state.base as typeof recipe;
        previewEdit(state, {
          ...base,
          warp: {
            ...base.warp,
            enabled: true,
            strokes: [...recipe.warp.strokes, state.warp],
          },
        });
      }
    }
    const brush = state.mask;
    if (kind === 'brush' && brush?.type === 'brush') {
      const localPoints = brush.strokes.reduce((n, stroke) => n + stroke.points.length, 0);
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
        brush.strokes.length >= MAX_BRUSH_STROKES ||
        localPoints >= MAX_BRUSH_POINTS_PER_MASK ||
        allPoints >= MAX_TOTAL_BRUSH_POINTS
      ) {
        setNotice('当前笔刷记录已达安全预算。可删除旧笔触或建立新作品；不会静默丢弃笔触。');
        return;
      }
      state.points = [point];
      state.path = startFreehandPath(event.nativeEvent, false);
      state.stroke = { ...brushSettings, points: state.points };
      previewEdit(
        state,
        replaceMask(
          state.base,
          {
            ...brush,
            strokes: [...brush.strokes, state.stroke],
          },
          state.newRepair,
        ),
      );
    }
    editGesture.current = state;
    setSelectionManipulating(
      kind === 'brush' ||
        kind === 'center' ||
        kind === 'radial-rotation' ||
        kind.startsWith('radius') ||
        kind.startsWith('linear-') ||
        kind.startsWith('polygon-'),
    );
    setNotice(null);
  }
  function moveEdit(event: PointerEvent<HTMLDivElement>, terminal = false) {
    const state = editGesture.current;
    if (
      !state ||
      state.pointer !== event.pointerId ||
      !dimensions ||
      (!geometryReady && state.kind !== 'warp' && !state.projective)
    )
      return;
    if (!ownsEdit(state)) {
      editGesture.current = null;
      setSelectionManipulating(false);
      setProjectiveFrame(null);
      return;
    }
    if (!terminal && (event.buttons & 1) === 0) {
      endEdit(event, true);
      return;
    }
    if ((state.kind === 'paint' || state.kind === 'brush') && state.points) {
      const painting = state.kind === 'paint';
      const stroke = painting ? state.paint : state.stroke;
      if (!stroke) return;
      const originalMask = state.mask;
      const localPoints =
        !painting && originalMask?.type === 'brush'
          ? originalMask.strokes.reduce((n, item) => n + item.points.length, 0)
          : 0;
      const allPoints =
        !painting && state.base.schemaVersion === 2
          ? state.base.regions.reduce(
              (n, item) =>
                n +
                (item.mask.type === 'brush'
                  ? item.mask.strokes.reduce((m, item) => m + item.points.length, 0)
                  : 0),
              0,
            )
          : 0;
      const limit = painting
        ? 1024
        : Math.min(
            MAX_BRUSH_POINTS_PER_STROKE,
            MAX_BRUSH_POINTS_PER_MASK - localPoints,
            MAX_TOTAL_BRUSH_POINTS - allPoints,
          );
      const sampled = appendFreehandPoints(
        state.points,
        pointerPathSamples(event.nativeEvent),
        (sample) => {
          const point = toSource(sample.clientX, sample.clientY, contentSpace, 'strict');
          return point && !state.paint?.material
            ? brushPointAtSource(point, dimensions, stroke.radius)
            : point;
        },
        dimensions,
        Math.max(
          painting ? 0.5 : 1,
          (stroke.radius * Math.min(dimensions.width, dimensions.height)) / 8,
        ),
        limit,
        terminal,
        state.path,
      );
      if (
        !painting &&
        originalMask?.type === 'brush' &&
        originalMask.strokes.length + (sampled.path?.breaks.length ?? 0) + 1 > MAX_BRUSH_STROKES
      ) {
        setNotice('已达蒙版笔划上限；已画部分保留。');
        return;
      }
      state.path = sampled.path;
      if (sampled.limitReached) setNotice('本笔已达采样预算，请松开后继续下一笔；已画部分保留。');
      if (!sampled.changed) return;
      state.points = sampled.points;
      if (
        painting &&
        state.paint &&
        (state.base.schemaVersion === 3 || state.base.schemaVersion === 4)
      ) {
        previewEdit(state, {
          ...state.base,
          paintLayers: state.base.paintLayers.map((layer) =>
            layer.id === state.paintLayerId
              ? {
                  ...layer,
                  strokes: [
                    ...layer.strokes,
                    {
                      ...state.paint!,
                      points: sampled.points,
                      ...(state.path &&
                      (state.paint!.material ||
                        state.path.pressureSensitive ||
                        state.path.breaks.length)
                        ? {
                            sampling: {
                              algorithm: 'swept-v1' as const,
                              pressure: state.path.pressures,
                              breaks: state.path.breaks,
                              antialias: !!state.paint!.material || state.path.pressureSensitive,
                            },
                          }
                        : {}),
                    },
                  ],
                }
              : layer,
          ),
        });
      } else if (originalMask?.type === 'brush' && state.stroke) {
        previewEdit(
          state,
          replaceMask(
            state.base,
            {
              ...originalMask,
              strokes: [
                ...originalMask.strokes,
                ...[0, ...(state.path?.breaks ?? [])].map((start, index) => ({
                  ...state.stroke!,
                  points: sampled.points.slice(start, state.path?.breaks[index]),
                })),
              ],
            },
            state.newRepair,
          ),
        );
      }
      return;
    }
    if (state.projective && state.base.schemaVersion === 4) {
      try {
        const point = projectivePointer(
          { x: event.clientX, y: event.clientY },
          state.projective.rect,
          state.projective.dimensions,
          state.base,
        );
        previewEdit(
          state,
          withProjectiveCorner(
            state.base,
            state.projective.index,
            point,
            dimensions,
            editor.pixelBudget,
          ),
        );
        setNotice(null);
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : '请保持四角不交叉；已保留上一个有效形状。',
        );
      }
      return;
    }
    const rawPoint = toSource(
      state.warpPointer?.axis === 'vertical' && state.warp?.mode === 'push'
        ? state.warpPointer.x
        : event.clientX,
      state.warpPointer?.axis === 'horizontal' && state.warp?.mode === 'push'
        ? state.warpPointer.y
        : event.clientY,
      contentSpace,
      editPointerBounds(state.kind),
    );
    if (!rawPoint) return;
    const point =
      state.kind === 'brush' && state.stroke
        ? brushPointAtSource(rawPoint, dimensions, state.stroke.radius)
        : rawPoint;
    if (
      state.kind.startsWith('image-') &&
      state.imageLayer &&
      (state.base.schemaVersion === 3 || state.base.schemaVersion === 4)
    ) {
      const layer = state.imageLayer,
        cx = layer.x + layer.width / 2,
        cy = layer.y + layer.height / 2;
      let next = { ...layer };
      if (state.kind === 'image-move')
        next = {
          ...layer,
          x: clamp(layer.x + point.x - state.start.x, -2, 2),
          y: clamp(layer.y + point.y - state.start.y, -2, 2),
        };
      else if (state.kind === 'image-rotate') {
        const angle = (p: Point) =>
          Math.atan2((p.y - cy) * dimensions.height, (p.x - cx) * dimensions.width);
        const degrees =
          layer.rotationDegrees + ((angle(point) - angle(state.start)) * 180) / Math.PI;
        next.rotationDegrees = ((degrees + 540) % 360) - 180;
      } else {
        const angle = (-layer.rotationDegrees * Math.PI) / 180,
          dx = (point.x - cx) * dimensions.width,
          dy = (point.y - cy) * dimensions.height;
        const w = clamp(
          (2 * Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle))) / dimensions.width,
          0.001,
          4,
        );
        const h = clamp(
          (2 * Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle))) / dimensions.height,
          0.001,
          4,
        );
        next = {
          ...layer,
          x: clamp(cx - w / 2, -2, 2),
          y: clamp(cy - h / 2, -2, 2),
          width: w,
          height: h,
        };
      }
      previewEdit(state, {
        ...state.base,
        imageLayers: state.base.imageLayers.map((item) => (item.id === layer.id ? next : item)),
      });
      return;
    }
    if (
      state.kind === 'warp' &&
      state.warp &&
      (state.base.schemaVersion === 3 || state.base.schemaVersion === 4)
    ) {
      const pressure =
        event.pointerType === 'pen' && event.pressure > 0 ? 0.25 + 0.75 * event.pressure : null;
      const stroke = {
        ...state.warp,
        to: point,
        strength:
          pressure && state.warpPointer
            ? state.warpPointer.strength * pressure
            : state.warp.strength,
      };
      state.warp = stroke;
      previewEdit(state, {
        ...state.base,
        warp: { ...state.base.warp, enabled: true, strokes: [...state.base.warp.strokes, stroke] },
      });
      return;
    }
    if (state.kind.startsWith('crop-')) {
      previewEdit(
        state,
        nextCrop(
          state.base,
          state.kind.slice(5),
          {
            x: (point.x - state.start.x) * dimensions.width,
            y: (point.y - state.start.y) * dimensions.height,
          },
          event.shiftKey,
        ),
      );
      return;
    }
    const original = state.mask;
    if (!original) return;
    let next: SelectionMaskV3 = original;
    if (original.type === 'radial') {
      if (state.kind === 'center')
        next = {
          ...original,
          centerX: clamp(original.centerX + point.x - state.start.x),
          centerY: clamp(original.centerY + point.y - state.start.y),
        };
      if (state.kind === 'radiusX' || state.kind === 'radiusY') {
        const local = radialMaskFrameV3(original, dimensions).local(point);
        const axis = state.kind === 'radiusX' ? local.x : local.y;
        next = {
          ...original,
          [state.kind]: clamp(Math.abs(axis) * original[state.kind], 0.0001, 1),
        };
      }
      if (state.kind === 'radial-rotation') {
        const delta = selectionRotation(
          { x: original.centerX, y: original.centerY },
          state.start,
          point,
          dimensions,
        );
        if (delta === null) return;
        const angle = (original.rotationDegrees ?? 0) + (delta * 180) / Math.PI;
        next = { ...original, rotationDegrees: ((angle + 540) % 360) - 180 };
      }
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
      if (state.kind === 'polygon-move') {
        next = translatePolygon(original, point.x - state.start.x, point.y - state.start.y);
      } else if (state.kind === 'polygon-rotate') {
        const degrees = polygonRotationDelta(
          state.start,
          point,
          polygonCenter(original.points),
          dimensions,
        );
        const rotated = rotatePolygon(original, degrees, dimensions);
        if (!rotated) {
          setNotice(studioText('rotateBounds'));
          return;
        }
        setNotice(null);
        next = rotated;
      } else {
        const index = Number(state.kind.slice(8));
        next = {
          ...original,
          points: original.points.map((p, i) =>
            i === index ? { x: clamp(point.x), y: clamp(point.y) } : p,
          ),
        };
      }
    }
    try {
      parseSelectionMaskV3(next);
    } catch {
      setNotice('请保留三个非共线轮廓点；已保留上一个有效形状。');
      return;
    }
    previewEdit(state, replaceMask(state.base, next));
  }
  function endEdit(event: PointerEvent<HTMLDivElement>, cancel = false) {
    const state = editGesture.current;
    if (!state || state.pointer !== event.pointerId) return;
    if (!cancel && (state.kind === 'paint' || state.kind === 'brush' || state.kind === 'warp'))
      moveEdit(event, true);
    editGesture.current = null;
    setSelectionManipulating(false);
    setProjectiveFrame(null);
    if (ownsEdit(state)) {
      if (cancel) editor.preview(state.rollback ?? state.base, state.quality);
      else {
        editor.commitCurrent(
          state.kind.startsWith('projective-')
            ? '四角自由变换'
            : state.kind.startsWith('crop-')
              ? '手动构图'
              : state.kind.startsWith('image-')
                ? '移动合成图层'
                : state.kind === 'paint'
                  ? '手动绘制'
                  : state.kind === 'warp'
                    ? state.warp?.mode === 'restore'
                      ? '局部恢复液化'
                      : '手动液化'
                    : state.kind === 'brush'
                      ? '绘制局部笔触'
                      : '直接调整选区',
        );
        if (state.newRepair && state.stroke && state.lastPreview !== state.rollback) {
          editor.setActiveRepairId(state.newRepair.id);
          editor.setActiveMaskPath([]);
          editor.setBrushSettings({
            radius: state.stroke.radius,
            feather: state.stroke.feather,
            mode: state.stroke.mode,
            opacity: state.stroke.opacity,
          });
        }
      }
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
      const point = toSource(clientX, clientY, true, 'strict');
      if (!point) {
        setNotice('透明扩展区域没有对应源像素，请在图片内容上取色。');
        return;
      }
      const picked = sampleSourcePreview(source, point);
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
    if (!p) return;
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
      editor.commit(replaceMask(recipe, nextMask), '添加轮廓控制点');
    } catch {
      setNotice('这个控制点无法形成有效轮廓，原选区已保留。');
    }
  }
  function handle(point: Point, label: string, kind: string) {
    const p = projectOverlayPoint(point, toDisplay);
    if (!p) return null;
    return (
      <button
        key={kind}
        className={`image-handle ${kind.startsWith('crop') ? 'crop-handle' : ''} ${kind === 'polygon-rotate' || kind === 'polygon-move' || kind === 'radial-rotation' ? 'selection-transform-handle' : ''}`}
        data-handle={kind}
        aria-label={label}
        title={label}
        style={{
          left: `${p.x * 100}%`,
          top: `${p.y * 100}%`,
          transform: `translate(-50%,-50%) scale(${1 / zoom})`,
        }}
        onPointerDown={(event) => beginEdit(event, kind)}
        onKeyDown={(event) => {
          if (
            (!editingSelection && !kind.startsWith('crop-')) ||
            !dimensions ||
            editGesture.current ||
            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
          )
            return;
          const amount = event.altKey ? 0.1 : event.shiftKey ? 10 : 1;
          if (kind.startsWith('crop-') && coordinateMap) {
            const step = event.shiftKey ? 10 : 1;
            const target = {
              x:
                p.x +
                (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) /
                  coordinateMap.dimensions.width,
              y:
                p.y +
                (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) /
                  coordinateMap.dimensions.height,
            };
            event.preventDefault();
            event.stopPropagation();
            try {
              const targetSource = coordinateMap.toSource(target);
              editor.commit(
                nextCrop(
                  editor.getRecipe(),
                  kind.slice(5),
                  {
                    x: (targetSource.x - point.x) * dimensions.width,
                    y: (targetSource.y - point.y) * dimensions.height,
                  },
                  false,
                ),
                t('微调裁切'),
              );
            } catch (failure) {
              setNotice(failure instanceof Error ? failure.message : t('已保留当前裁切'));
            }
            return;
          }
          const dx =
            (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0) /
            dimensions.width;
          const dy =
            (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0) /
            dimensions.height;
          let next = mask;
          if (mask.type === 'polygon' && kind.startsWith('polygon-')) {
            if (kind === 'polygon-move') next = translatePolygon(mask, dx, dy);
            else if (kind === 'polygon-rotate') {
              const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
              const rotated = rotatePolygon(
                mask,
                direction * (event.altKey ? 0.1 : event.shiftKey ? 15 : 1),
                dimensions,
              );
              if (!rotated) {
                event.preventDefault();
                event.stopPropagation();
                setNotice(studioText('rotateBounds'));
                return;
              }
              next = rotated;
            } else {
              const index = Number(kind.slice(8));
              next = {
                ...mask,
                points: mask.points.map((p, i) =>
                  i === index ? { x: clamp(p.x + dx), y: clamp(p.y + dy) } : p,
                ),
              };
            }
          } else if (mask.type === 'radial') {
            if (kind === 'center')
              next = {
                ...mask,
                centerX: clamp(mask.centerX + dx),
                centerY: clamp(mask.centerY + dy),
              };
            else if (kind === 'radiusX' || kind === 'radiusY') {
              const radial = radialMaskFrameV3(mask, dimensions);
              const point = radial.point(kind === 'radiusX' ? 1 : 0, kind === 'radiusY' ? 1 : 0);
              const local = radial.local({ x: point.x + dx, y: point.y + dy });
              const axis = kind === 'radiusX' ? local.x : local.y;
              next = { ...mask, [kind]: clamp(Math.abs(axis) * mask[kind], 0.0001, 1) };
            } else if (kind === 'radial-rotation') {
              const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
              const angle =
                (mask.rotationDegrees ?? 0) +
                direction * (event.altKey ? 0.1 : event.shiftKey ? 15 : 1);
              next = { ...mask, rotationDegrees: ((angle + 540) % 360) - 180 };
            } else return;
          } else if (mask.type === 'linear' && kind.startsWith('linear-')) {
            const key = kind === 'linear-start' ? 'start' : 'end';
            next = { ...mask, [key]: { x: clamp(mask[key].x + dx), y: clamp(mask[key].y + dy) } };
          } else return;
          event.preventDefault();
          event.stopPropagation();
          try {
            parseSelectionMaskV3(next);
            editor.commit(replaceMask(editor.getRecipe(), next), t('直接调整选区'));
            setNotice(null);
          } catch {
            setNotice(t('请保留三个非共线轮廓点；已保留上一个有效形状。'));
          }
        }}
      >
        {kind === 'polygon-rotate' || kind === 'radial-rotation' ? (
          <ArrowClockwise size={15} />
        ) : kind === 'polygon-move' ? (
          <ArrowsOutCardinal size={15} />
        ) : (
          <i />
        )}
      </button>
    );
  }
  const prevent = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const crop = recipe.geometry.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const guide = editor.cropGuide;
  const guidePositions =
    guide === 'thirds'
      ? [1 / 3, 2 / 3]
      : guide === 'golden'
        ? [(3 - Math.sqrt(5)) / 2, (Math.sqrt(5) - 1) / 2]
        : guide === 'center'
          ? [0.5]
          : [];
  const guides =
    guide === 'diagonal'
      ? [
          [
            { x: crop.x, y: crop.y },
            { x: crop.x + crop.width, y: crop.y + crop.height },
          ],
          [
            { x: crop.x + crop.width, y: crop.y },
            { x: crop.x, y: crop.y + crop.height },
          ],
        ]
      : guidePositions.flatMap((n) => [
          [
            { x: crop.x + crop.width * n, y: crop.y },
            { x: crop.x + crop.width * n, y: crop.y + crop.height },
          ],
          [
            { x: crop.x, y: crop.y + crop.height * n },
            { x: crop.x + crop.width, y: crop.y + crop.height * n },
          ],
        ]);
  const corners = projectOverlayPath(
    [
      { x: crop.x, y: crop.y },
      { x: crop.x + crop.width, y: crop.y },
      { x: crop.x + crop.width, y: crop.y + crop.height },
      { x: crop.x, y: crop.y + crop.height },
    ],
    toDisplay,
  );
  const radial = dimensions && mask.type === 'radial' ? radialMaskFrameV3(mask, dimensions) : null;
  const radialOutline =
    mask.type !== 'radial'
      ? []
      : mask.shape === 'rectangle'
        ? [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]
        : mask.shape === 'diamond'
          ? [
              [0, -1],
              [1, 0],
              [0, 1],
              [-1, 0],
            ]
          : Array.from({ length: 64 }, (_, i) => {
              const angle = (i / 64) * Math.PI * 2;
              return [Math.cos(angle), Math.sin(angle)];
            });
  const hasOutline = mask.type === 'radial' || mask.type === 'polygon' || mask.type === 'linear';
  const showOutline = hasOutline && selectionVisible;
  const canRotateRadial =
    (recipe.schemaVersion === 3 || recipe.schemaVersion === 4) &&
    Boolean(region || repair || protecting);
  const linearEnds =
    mask.type === 'linear' ? projectOverlayPath([mask.start, mask.end], toDisplay) : null;
  const imageLayer =
    recipe.schemaVersion === 3 || recipe.schemaVersion === 4
      ? recipe.imageLayers.find((layer) => layer.id === editor.activeImageLayerId)
      : null;
  const layerPoint = (x: number, y: number): Point => {
    if (!imageLayer || !dimensions) return { x: 0, y: 0 };
    const cx = imageLayer.x + imageLayer.width / 2,
      cy = imageLayer.y + imageLayer.height / 2;
    const dx = (x - 0.5) * imageLayer.width * dimensions.width,
      dy = (y - 0.5) * imageLayer.height * dimensions.height;
    const r = (imageLayer.rotationDegrees * Math.PI) / 180;
    return {
      x: cx + (dx * Math.cos(r) - dy * Math.sin(r)) / dimensions.width,
      y: cy + (dx * Math.sin(r) + dy * Math.cos(r)) / dimensions.height,
    };
  };
  return (
    <main
      className={`canvas-stage content-first ${dragging ? 'is-dragging' : ''} ${editor.file ? 'has-image' : ''}`}
      aria-busy={
        editor.loading ||
        editor.rendering ||
        Boolean(editor.file && !editor.error && editor.renderedRecipe !== editor.recipe)
      }
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
        const files = [...event.dataTransfer.files];
        if (files.length) onImport(files);
      }}
    >
      <div className="canvas-file-info" data-motion="canvas-file-info">
        {editor.file && (
          <>
            <span>{editor.file.name}</span>
            <small>
              {output?.width} × {output?.height}
            </small>
            {editor.rendering && !liveFrame && <Busy label={t('更新预览')} />}
          </>
        )}
      </div>
      {previews.remote && (
        <div className="collaboration-preview-note">{t('队员调整预览 · 尚未保存为版本')}</div>
      )}
      {editingSelection && (
        <button
          type="button"
          className="canvas-selection-peek"
          aria-label={studioText('holdMask')}
          title={studioText('holdMask')}
          aria-pressed={selectionHeld}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setSelectionHeld(true);
          }}
          onPointerUp={() => setSelectionHeld(false)}
          onPointerCancel={() => setSelectionHeld(false)}
          onLostPointerCapture={() => setSelectionHeld(false)}
          onKeyDown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            setSelectionHeld(true);
          }}
          onKeyUp={() => setSelectionHeld(false)}
          onBlur={() => setSelectionHeld(false)}
        >
          <Eye size={16} />
          <span>{studioText('mask')}</span>
        </button>
      )}
      {statusContainer &&
        createPortal(
          <div className="canvas-error">
            <InlineError message={editor.error ?? previews.error ?? notice} />
          </div>,
          statusContainer,
        )}
      <div
        className={`image-viewport ${editingSelection ? 'placement-mode' : ''} ${zoom > 1 || handMode || space ? 'can-pan' : ''} ${sampling ? 'sampling' : ''}`}
        ref={viewport}
        tabIndex={image ? 0 : undefined}
        aria-label={image ? t('图像画布') : undefined}
        onKeyDown={(event) => {
          if (
            !image ||
            event.target !== event.currentTarget ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            editGesture.current
          )
            return;
          if (event.key === '+' || event.key === '=') zoomBy(1.25);
          else if (event.key === '-' || event.key === '_') zoomBy(0.8);
          else if (event.key === '0') fit();
          else return;
          event.preventDefault();
        }}
        onPointerDownCapture={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          const state = editGesture.current;
          const decision = pointerOwnership.current.down(event.pointerId, state?.pointer ?? null);
          if (decision === 'allow') return;
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = true;
          if (decision === 'cancel-edit' && state) {
            // Invalidate first: releasing capture may synchronously run a lost-capture handler.
            editGesture.current = null;
            setSelectionManipulating(false);
            setProjectiveFrame(null);
            const rollback = ownedCanvasRollback(
              state,
              editor.getSourceIdentity(),
              editor.getRecipe(),
            );
            if (rollback) editor.preview(rollback, state.quality);
            pointerPositions.current.clear();
            panGesture.current = null;
            pinch.current = null;
            setNotice(
              t('检测到第二触点，本笔已取消。松开全部触点后再继续；移动画面可先选择抓手。'),
            );
            // Route both releases back to the viewport while keeping the whole
            // gesture suppressed. Neither pointer becomes a navigation gesture.
            if (frame.current?.hasPointerCapture(state.pointer))
              frame.current.releasePointerCapture(state.pointer);
            try {
              event.currentTarget.setPointerCapture(state.pointer);
            } catch {
              // The original pointer may already have been released by the UA.
              pointerOwnership.current.up(state.pointer);
            }
          }
          if (pointerOwnership.current.blocked) {
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              pointerOwnership.current.up(event.pointerId);
            }
          }
        }}
        onPointerMoveCapture={(event) => {
          const cursor = toSource(event.clientX, event.clientY, false, 'strict');
          collaboration?.setCursor(cursor);
          if (!pointerOwnership.current.blocked) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerLeave={() => collaboration?.setCursor(null)}
        onPointerUpCapture={(event) => {
          if (!pointerOwnership.current.up(event.pointerId)) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancelCapture={(event) => {
          if (!pointerOwnership.current.up(event.pointerId)) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          if (
            !image ||
            editGesture.current ||
            (editingSelection && !handMode && !space) ||
            (group === 'crop' && !space && !handMode)
          )
            return;
          pointerPositions.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointerPositions.current.size === 2) {
            const [a, b] = [...pointerPositions.current.values()] as [Point, Point];
            pinch.current = {
              distance: Math.hypot(a.x - b.x, a.y - b.y),
              camera,
              center: viewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2),
            };
            panGesture.current = null;
          } else if (zoom > 1 || space || handMode || event.button === 1)
            panGesture.current = {
              pointer: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              start: pan,
            };
          else if (event.pointerType !== 'touch') return;
          if (event.button === 1) event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (pointerPositions.current.has(event.pointerId))
            pointerPositions.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const twoFingers = pinch.current;
          if (twoFingers && pointerPositions.current.size === 2) {
            const [a, b] = [...pointerPositions.current.values()] as [Point, Point];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            setCamera(
              zoomedCamera(
                twoFingers.camera,
                (twoFingers.camera.zoom * distance) / Math.max(1, twoFingers.distance),
                twoFingers.center,
                viewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2),
              ),
            );
            return;
          }
          const current = panGesture.current;
          if (current?.pointer === event.pointerId)
            setCamera((view) => ({
              ...view,
              pan: boundedPan(
                {
                  x: current.start.x + event.clientX - current.x,
                  y: current.start.y + event.clientY - current.y,
                },
                view.zoom,
              ),
            }));
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
          <StudioWelcome
            onImport={() => onImport()}
            onDraw={onDraw}
            onAI={onAI}
            accountState={accountState}
            onSignIn={onSignIn}
            onRegister={onRegister}
          />
        ) : image ? (
          <div
            className="image-frame"
            ref={frame}
            style={{
              width: display.width,
              height: display.height,
              transform: `translate(${pan.x + projectiveOffset.x}px,${pan.y + projectiveOffset.y}px) scale(${zoom})`,
            }}
            onPointerDown={(event) => {
              updateBrushFootprint(event);
              if (
                group === 'repair' &&
                recipe.schemaVersion === 4 &&
                editor.repairChoosingSource &&
                editor.repairMode === 'healing' &&
                repair
              ) {
                const point = geometryReady
                  ? toSource(event.clientX, event.clientY, true, 'strict')
                  : null;
                if (point) {
                  editor.commit(
                    {
                      ...recipe,
                      healing: recipe.healing.map((item) =>
                        item.id === repair.id ? { ...item, source: point } : item,
                      ),
                    },
                    t('选择修复来源'),
                  );
                  editor.setRepairChoosingSource(false);
                  event.preventDefault();
                  event.stopPropagation();
                }
              } else if (
                group === 'paint' &&
                !editor.paintSettings.automaticMakeup &&
                (recipe.schemaVersion === 3 || recipe.schemaVersion === 4)
              )
                beginEdit(event, 'paint');
              else if (
                group === 'liquify' &&
                !protecting &&
                (recipe.schemaVersion === 3 || recipe.schemaVersion === 4)
              )
                beginEdit(event, 'warp');
              else if (startRepair || (editingSelection && mask.type === 'brush'))
                beginEdit(event, 'brush');
            }}
            onPointerMove={(event) => {
              updateBrushFootprint(event);
              moveEdit(event);
            }}
            onPointerLeave={() => brushFootprint.current?.removeAttribute('d')}
            onPointerUp={(event) => {
              updateBrushFootprint(event);
              endEdit(event);
            }}
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
                if (!point) return;
                editor.commit(
                  replaceMask(recipe, {
                    ...mask,
                    centerX: clamp(point.x),
                    centerY: clamp(point.y),
                  }),
                  t('定位径向选区'),
                );
              }
            }}
          >
            <PixelCanvas image={image} />
            {collaboration?.snapshot && (
              <CollaborationOverlay
                snapshot={collaboration.snapshot}
                sessionId={collaboration.session?.id ?? null}
                toDisplay={(point) => coordinateMap?.toOutput(point) ?? point}
                toContentDisplay={coordinateMap?.toContentOutput}
                zoom={zoom}
              />
            )}

            {footprintRadius > 0 && (
              <svg
                className="brush-footprint"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path ref={brushFootprint} vectorEffect="non-scaling-stroke" />
              </svg>
            )}
            {editingSelection &&
              (editor.maskOverlay ||
                selectionHeld ||
                selectionManipulating ||
                (selectionPulse && !hasOutline)) &&
              source &&
              dimensions && (
                <MaskPreview
                  mask={mask}
                  source={source}
                  dimensions={dimensions}
                  recipe={viewRecipe}
                  ratio={display.width / display.height}
                  opacity={region?.opacity ?? 1}
                  contentSpace={contentSpace}
                  automatic={!editor.maskOverlay && !selectionHeld && !selectionManipulating}
                />
              )}
            {editingSelection && (
              <>
                {showOutline && (
                  <svg
                    className="mask-overlay"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    {radial && (
                      <polygon
                        points={overlayPolygon(radialOutline.map(([x, y]) => radial.point(x!, y!)))}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={0.2 / zoom}
                        strokeDasharray={`${1 / zoom} ${0.7 / zoom}`}
                      />
                    )}
                    {mask.type === 'linear' && linearEnds && (
                      <line
                        x1={linearEnds[0]!.x * 100}
                        y1={linearEnds[0]!.y * 100}
                        x2={linearEnds[1]!.x * 100}
                        y2={linearEnds[1]!.y * 100}
                        stroke="#fff"
                        strokeWidth={0.35 / zoom}
                      />
                    )}
                    {mask.type === 'polygon' && (
                      <polygon
                        points={overlayPolygon(mask.points)}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={0.25 / zoom}
                      />
                    )}
                  </svg>
                )}
                {radial && (
                  <>
                    {handle(radial.point(0, 0), t('拖动选区中心'), 'center')}
                    {handle(radial.point(1, 0), t('拖动横向半径'), 'radiusX')}
                    {handle(radial.point(0, 1), t('拖动纵向半径'), 'radiusY')}
                    {canRotateRadial &&
                      handle(radial.point(0, -1), t('拖动旋转选区'), 'radial-rotation')}
                  </>
                )}
                {mask.type === 'linear' && (
                  <>
                    {handle(mask.start, t('拖动渐变起点'), 'linear-start')}
                    {handle(mask.end, t('拖动渐变终点'), 'linear-end')}
                  </>
                )}
                {mask.type === 'polygon' &&
                  mask.points.map((point, index) =>
                    handle(point, t('拖动多边形点 {v0}', { v0: index + 1 }), `polygon-${index}`),
                  )}
                {mask.type === 'polygon' && (
                  <>
                    {handle(polygonCenter(mask.points), studioText('moveMask'), 'polygon-move')}
                    {handle(
                      {
                        x: polygonCenter(mask.points).x,
                        y: Math.max(
                          0.015,
                          Math.min(...mask.points.map((point) => point.y)) - 0.075,
                        ),
                      },
                      studioText('rotateMask'),
                      'polygon-rotate',
                    )}
                  </>
                )}
              </>
            )}
            {group === 'composite' && imageLayer?.enabled && !comparing && geometryReady && (
              <>
                <svg className="composite-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polygon
                    points={overlayPolygon(
                      [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 1],
                      ].map(([x, y]) => layerPoint(x!, y!)),
                    )}
                    fill="transparent"
                    stroke="white"
                    strokeWidth={0.2 / zoom}
                    onPointerDown={(event) => beginEdit(event, 'image-move')}
                  />
                </svg>
                {(
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                  ] as const
                ).map(([x, y], i) =>
                  handle(
                    layerPoint(x, y),
                    t('缩放合成素材 {v0}（中心固定）', { v0: i + 1 }),
                    `image-resize-${i}`,
                  ),
                )}
                {handle(layerPoint(0.5, -0.08), t('旋转合成素材'), 'image-rotate')}
                {handle(layerPoint(0.5, 0.5), t('移动合成素材'), 'image-move')}
              </>
            )}
            {projectiveEditing &&
              recipe.schemaVersion === 4 &&
              !comparing &&
              (!previews.remote || geometryReady) &&
              dimensions &&
              renderedProjective &&
              (() => {
                const preDimensions = preProjectiveDimensions(dimensions, recipe);
                const points = recipe.projective.corners.map((point) =>
                  projectiveDisplayPoint(point, preDimensions, renderedProjective),
                );
                return (
                  <>
                    <svg
                      className="projective-overlay"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden
                    >
                      <polygon
                        points={points
                          .map((point) => `${point.x * 100},${point.y * 100}`)
                          .join(' ')}
                        fill="none"
                        stroke="white"
                        strokeWidth={0.23 / zoom}
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    {points.map((point, index) => (
                      <button
                        key={index}
                        className="image-handle projective-handle"
                        aria-label={t('{v0}透视控制点', { v0: t(CORNER_LABELS[index]) })}
                        title={t('{v0} · 方向键微调，Alt 0.1px，Shift 10px', {
                          v0: t(CORNER_LABELS[index]),
                        })}
                        style={{
                          left: `${point.x * 100}%`,
                          top: `${point.y * 100}%`,
                          transform: `translate(-50%,-50%) scale(${1 / zoom})`,
                        }}
                        onPointerDown={(event) => beginEdit(event, `projective-${index}`)}
                        onKeyDown={(event) => {
                          if (
                            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                              event.key,
                            ) ||
                            editGesture.current
                          )
                            return;
                          event.preventDefault();
                          event.stopPropagation();
                          const current = editor.getRecipe();
                          if (current.schemaVersion !== 4) return;
                          const d = preProjectiveDimensions(dimensions, current),
                            amount = event.altKey ? 0.1 : event.shiftKey ? 10 : 1;
                          const corner = { ...current.projective.corners[index]! };
                          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                            corner.x += (event.key === 'ArrowLeft' ? -amount : amount) / d.width;
                          else corner.y += (event.key === 'ArrowUp' ? -amount : amount) / d.height;
                          try {
                            editor.commit(
                              withProjectiveCorner(
                                current,
                                index,
                                corner,
                                dimensions,
                                editor.pixelBudget,
                              ),
                              t('微调{v0}', { v0: t(CORNER_LABELS[index]) }),
                            );
                            setNotice(null);
                          } catch (error) {
                            setNotice(
                              error instanceof Error
                                ? error.message
                                : t('这会使四角交叉，已保留原形。'),
                            );
                          }
                        }}
                      >
                        <i />
                      </button>
                    ))}
                  </>
                );
              })()}
            {cropEditing && !comparing && corners && (
              <>
                <svg
                  className="crop-overlay"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path
                    d={`M0 0H100V100H0Z M${corners.map((p) => `${p.x * 100} ${p.y * 100}`).join('L')}Z`}
                    fill="#10121688"
                    fillRule="evenodd"
                  />
                  <polygon
                    points={corners.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                    fill="none"
                    stroke="white"
                    strokeWidth="1.2"
                    vectorEffect="non-scaling-stroke"
                  />
                  {guides.map(([a, b], i) => {
                    const p = projectOverlayPoint(a!, toDisplay),
                      q = projectOverlayPoint(b!, toDisplay);
                    if (!p || !q) return null;
                    return (
                      <line
                        key={i}
                        x1={p.x * 100}
                        y1={p.y * 100}
                        x2={q.x * 100}
                        y2={q.y * 100}
                        stroke="white"
                        opacity=".65"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
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
                    kind === 'move' ? t('拖动裁切区域') : t('调整裁切 {v0}', { v0: kind }),
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
                {t('原图 · 同一构图')}
              </span>
            )}
          </div>
        ) : (
          <Busy label={comparing ? t('准备同一构图的原图…') : t('准备完整构图预览…')} />
        )}
      </div>
      {editor.file && (
        <>
          <div
            ref={viewToolbar}
            className="canvas-view-controls"
            data-motion="canvas-toolbar"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && viewToolsOpen) {
                event.preventDefault();
                event.stopPropagation();
                setViewToolsOpen(false);
                viewToolsButton.current?.focus({ preventScroll: true });
              }
            }}
            onBlurCapture={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget)
              )
                setViewToolsOpen(false);
            }}
          >
            <IconButton label={t('撤销本次编辑')} disabled={!editor.canUndo} onClick={editor.undo}>
              <ArrowCounterClockwise size={17} />
            </IconButton>
            <IconButton label={t('重做本次编辑')} disabled={!editor.canRedo} onClick={editor.redo}>
              <ArrowClockwise size={17} />
            </IconButton>
            <button
              className={`compare-press ${comparing ? 'active' : ''}`}
              aria-label={t('按住对比')}
              aria-pressed={comparing}
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
              <StudioGlyph name="compare" size={17} />
              <span>{t('按住对比')}</span>
            </button>
            <button
              type="button"
              className="zoom-fit"
              data-fitted={zoom === 1 || undefined}
              aria-label={zoom === 1 ? t('适应') : t('点击完整显示图片')}
              title={t('点击完整显示图片')}
              onClick={fit}
            >
              <CornersIn className="zoom-fit-glyph" size={17} />
              <span>{zoom === 1 ? t('适应') : `${Math.round(scale * zoom * 100)}%`}</span>
            </button>
            <button
              ref={viewToolsButton}
              type="button"
              className="canvas-tools-trigger"
              aria-label={t('画布工具')}
              aria-expanded={viewToolsOpen}
              aria-controls={viewToolsId}
              onClick={() => setViewToolsOpen(!viewToolsOpen)}
            >
              <DotsThree size={20} />
            </button>
            <div
              id={viewToolsId}
              className="canvas-secondary-controls"
              data-open={viewToolsOpen || undefined}
              role="group"
              aria-label={t('画布工具')}
            >
              <IconButton
                label={t('缩小预览')}
                disabled={zoom <= MIN_CANVAS_ZOOM}
                onClick={() => zoomBy(0.8)}
              >
                <MagnifyingGlassMinus size={18} />
              </IconButton>
              <IconButton
                label={t('放大预览')}
                disabled={zoom >= MAX_CANVAS_ZOOM}
                onClick={() => zoomBy(1.25)}
              >
                <MagnifyingGlassPlus size={18} />
              </IconButton>
              <button
                className="pixel-scale-button"
                title={t('一个预览像素对应一个CSS像素，不把缩小预览当原图')}
                onClick={() => setCamera(zoomedCamera(fittedCamera, 1 / scale, { x: 0, y: 0 }))}
              >
                1:1
              </button>
              <button
                className={`canvas-hand-mode ${handMode ? 'active' : ''}`}
                aria-label={t('拖动画面模式')}
                aria-pressed={handMode}
                onClick={() => {
                  setHandMode(!handMode);
                  setViewToolsOpen(false);
                }}
              >
                <Hand size={18} />
              </button>
              <button
                type="button"
                className="canvas-touch-action"
                aria-label={t('打开另一张图片')}
                onClick={() => {
                  setViewToolsOpen(false);
                  onImport();
                }}
              >
                <Plus size={18} />
                <span>{t('打开图片')}</span>
              </button>
              <button
                type="button"
                className="canvas-touch-action"
                data-action="open-sketch"
                aria-label={t('打开草图板')}
                onClick={() => {
                  setViewToolsOpen(false);
                  onDraw();
                }}
              >
                <PencilSimple size={18} />
                <span>{t('草图')}</span>
              </button>
              <small className="canvas-touch-caption">
                {output?.width} × {output?.height}
              </small>
            </div>
          </div>
          {sampling ? (
            <div className="canvas-context-hint" data-motion="sample-hint">
              <Eyedropper size={14} />
              {samplingSource
                ? t('点击画面，从未调色原图预览选择颜色')
                : t('点击画面，读取当前显示颜色')}
            </div>
          ) : editingSelection ? (
            <div className="canvas-context-hint" data-motion="selection-hint">
              {mask.type === 'brush'
                ? t('直接涂抹选区 · 空格 / 手形工具平移')
                : mask.type === 'radial'
                  ? t('点选中心 · 拖动白点改变范围')
                  : mask.type === 'linear'
                    ? t('拖动两端调整渐变方向与范围')
                    : mask.type === 'polygon'
                      ? studioText('polygonHint')
                      : t('连续颜色范围 · 参照未调整原图')}
            </div>
          ) : group === 'crop' ? (
            <div className="canvas-context-hint" data-motion="crop-hint">
              {t('拖动边缘自由裁切 · 中间白点移动范围')}
            </div>
          ) : null}
          {inspected && (
            <output className="pixel-readout">
              {inspected.source ? t('原图预览') : t('显示预览')} ({inspected.x},{inspected.y}) ·
              RGBA {inspected.rgba.join(' / ')}
              <button aria-label={t('收起像素读数')} onClick={() => setInspected(null)}>
                ×
              </button>
            </output>
          )}
          {image && zoom !== 1 && (
            <span className="preview-resolution">
              {t('预览')}
              {image.width}×{image.height} {t('· 导出')}
              {output?.width}×{output?.height}
            </span>
          )}
        </>
      )}
      {editor.loading && (
        <div className="stage-loading" role="status">
          <Busy label={t('正在准备图片…')} />
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <UploadSimple size={35} />
          <strong>{t('松开，打开这张图片')}</strong>
          <span>{t('先在本地处理')}</span>
        </div>
      )}
    </main>
  );
}
