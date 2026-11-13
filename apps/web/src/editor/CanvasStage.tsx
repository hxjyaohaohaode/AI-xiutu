import { t } from '../i18n';
import {
  Fragment,
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
  compileSelectionMaskV3,
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
  MAX_V3_PAINT_LAYERS,
  type RGBAImage,
  type EditorRecipe,
  type Geometry,
  type Dimensions,
  type Point,
  type BrushStrokeV2,
} from '@ai-xiutu/editor';
import { Busy, IconButton } from '../components/Ui';
import { CompareReveal } from '../components/CompareReveal';
import { FloatingNotice } from '../components/FloatingNotice';
import { StudioGlyph } from '../components/StudioGlyph';
import { editorGeometryKey, type EditorState, type PreviewQuality } from './useEditor';
import { sourcePointer, projectOverlayPoint, projectOverlayPath } from './coordinates';
import { manualPaintOrigin, paintLayerInMode } from './advanced-model';
import { appendRepairRegion } from './repair-draft';
import { CanvasPointerOwnership, ownedCanvasRollback } from './canvas-gesture';
import { BodyStretchGuides, bodyStretchGuard } from './BodyStretchGuides';
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
import {
  CanvasReviewToggle,
  CanvasReviewPins,
  CanvasReviewCard,
  useCanvasReview,
  type CanvasReviewScope,
} from '../collaboration/CanvasReview';
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
  pending?: EditorRecipe;
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
const zoomStep = 1.08;
function pickImageLayer(
  layers: readonly ImageLayerV3[],
  point: Point,
  dimensions: Dimensions,
  sources: ReadonlyMap<string, RGBAImage>,
  original: RGBAImage | null,
) {
  return layers.slice().reverse().find((layer) => {
    const image = sources.get(layer.sourceId);
    if (!layer.enabled || layer.opacity === 0 || !image) return false;
    const x = (point.x - layer.x - layer.width / 2) * dimensions.width;
    const y = (point.y - layer.y - layer.height / 2) * dimensions.height;
    const angle = layer.rotationDegrees * Math.PI / 180;
    const c = Math.cos(angle), s = Math.sin(angle);
    let u = (x * c + y * s) / (layer.width * dimensions.width) + .5;
    let v = (y * c - x * s) / (layer.height * dimensions.height) + .5;
    if (u < 0 || v < 0 || u > 1 || v > 1) return false;
    if (layer.flipX) u = 1 - u;
    if (layer.flipY) v = 1 - v;
    const pixel = (Math.min(image.height - 1, Math.floor(v * image.height)) * image.width
      + Math.min(image.width - 1, Math.floor(u * image.width))) * 4;
    if (image.data[pixel + 3] === 0) return false;
    return !layer.mask || !original ||
      compileSelectionMaskV3(layer.mask, original, original)(point.x, point.y) > 0;
  });
}

export function CanvasStage({
  editor,
  statusContainer,
  collaboration,
  reviewScope,
  onHistory,
  historyOpen = false,
  makeupPaint = false,
  group,
  toolOverlayRef,
  portraitWarp,
  onImport,
  onAI,
  onCollage,
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
  reviewScope?: CanvasReviewScope;
  onHistory: () => void;
  historyOpen?: boolean;
  makeupPaint?: boolean;
  group: ToolGroup;
  toolOverlayRef?: (element: HTMLDivElement | null) => void;
  portraitWarp?: boolean;
  onImport: (files?: File[]) => void;
  onAI: () => void;
  onCollage: () => void;
  onDraw: () => void;
  accountState?: 'loading' | 'guest' | 'signed-in';
  onSignIn?: () => void;
  onRegister?: () => void;
  comparing: boolean;
  setComparing: (value: boolean) => void;
  sampling?: boolean;
  onSample?: (color: string) => void;
}) {
  const review = useCanvasReview(reviewScope);
  const [dragging, setDragging] = useState(false),
    [camera, setCamera] = useState(fittedCamera),
    [bounds, setBounds] = useState({ width: 1, height: 1, offsetX: 0, offsetY: 0 });
  const { zoom, pan } = camera;
  const [space, setSpace] = useState(false),
    [handMode, setHandMode] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [viewToolsOpen, setViewToolsOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [split, setSplit] = useState(50);
  const splitToggle = useRef<HTMLButtonElement>(null);
  const comparePressStart = useRef(0);
  const comparePressTimer = useRef(0);
  const focusSplit = useRef(false);
  const comparisonSlider = useRef<HTMLInputElement>(null);
  function releaseComparison() {
    window.clearTimeout(comparePressTimer.current);
    setComparing(false);
  }
  useEffect(() => () => window.clearTimeout(comparePressTimer.current), []);
  function closeSplit() {
    setSplitOpen(false);
    splitToggle.current?.focus({ preventScroll: true });
  }
  useEffect(() => setSplitOpen(false), [editor.file, group]);
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
  const lastFaceFocus = useRef<typeof editor.portrait.faceFocus>(null);
  const brushFootprint = useRef<SVGPathElement>(null);
  const gestureTrail = useRef<SVGPathElement>(null);
  const warpTrail = useRef<Point[]>([]);
  const gestureFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(gestureFrame.current), []);
  const recipe = editor.recipe,
    source = editor.originalPreview,
    dimensions = editor.dimensions;
  const cropEditing = group === 'crop' && editor.geometryMode === 'crop';
  const splitActive = splitOpen && !cropEditing;
  const inspectingOriginal = comparing || splitActive;
  const bodyRange = portraitWarp && editor.warpSettings.axis === 'vertical' && !editor.warpSettings.protecting
    ? editor.warpSettings.verticalRange
    : undefined;
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
    editor.isInteractive,
    inspectingOriginal,
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
  const compareFrame = splitActive && !comparing && !previews.remote &&
    editor.renderedRecipe === recipe && image && previews.compare &&
    image.width === previews.compare.width && image.height === previews.compare.height
    ? previews.compare
    : null;
  useEffect(() => {
    if (compareFrame && focusSplit.current) {
      comparisonSlider.current?.focus({ preventScroll: true });
      focusSplit.current = false;
    }
  }, [compareFrame]);
  const viewGeometry: Geometry =
    cropEditing && !comparing ? { ...recipe.geometry, crop: null } : recipe.geometry;
  const localViewRecipe: EditorRecipe = { ...recipe, geometry: viewGeometry };
  const viewRecipe =
    previews.remote && collaboration?.remotePreview && !cropEditing && !comparing
      ? collaboration.remotePreview
      : localViewRecipe;
  const recipeGeometry = editorGeometryKey(recipe, false);
  const liveGeometry = liveFrame ? editorGeometryKey(liveFrame.recipe, false) : null;
  const settledGeometry = editor.renderedRecipe
    ? editorGeometryKey(editor.renderedRecipe, false)
    : null;
  const layoutRecipe = !comparing && cropEditing ? viewRecipe : liveFrame?.recipe;
  const layoutGeometry = layoutRecipe ? editorGeometryKey(layoutRecipe, false) : null;
  const referenceSize = useMemo(() => {
    if (!dimensions || !layoutRecipe) return null;
    try {
      return getEditorOutputDimensions(dimensions, layoutRecipe);
    } catch {
      return null;
    }
  }, [dimensions, layoutGeometry]);
  // Resolution can change while a stroke is still collecting points. Keep its
  // CSS frame in the same geometry rather than the live raster's rounded ratio.
  const frameRaster =
    liveGeometry && liveGeometry === settledGeometry
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
  }, [dimensions, editorGeometryKey(viewRecipe), source]);
  const portraitTargets =
    group === 'beauty' &&
    editor.portrait.showLandmarks &&
    !inspectingOriginal &&
    !previews.remote &&
    editor.portrait.analysis?.frame.contentHash === editor.getSourceFrame()?.contentHash
      ? (editor.portrait.analysis?.targets.filter((target) => target.kind === 'face') ?? [])
      : [];
  const activeFace =
    portraitTargets.find((target) => target.id === editor.portrait.activeTargetId) ??
    portraitTargets[0];
  const shownPortraitRecipe = liveFrame?.recipe ?? editor.renderedRecipe;
  const portraitMap = useMemo(() => {
    if (!activeFace || !dimensions || !shownPortraitRecipe) return null;
    try {
      return compileEditorCoordinateMap(dimensions, shownPortraitRecipe, source ?? undefined);
    } catch {
      return null;
    }
  }, [activeFace, dimensions, shownPortraitRecipe, source]);
  const projectFace = (point: Point) => portraitMap?.toContentOutput(point) ?? null;
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
    (!previews.remote || editorGeometryKey(viewRecipe, false) === recipeGeometry) &&
    (cropEditing || liveGeometry === recipeGeometry || settledGeometry === recipeGeometry);
  const editingSelection =
    (group === 'local' ||
      (group === 'repair' && !!repair && !editor.repairChoosingSource) ||
      (group === 'beauty' && recipe.schemaVersion !== 3 && recipe.schemaVersion !== 4) ||
      protecting) &&
    hasSelection &&
    geometryReady &&
    !inspectingOriginal &&
    !sampling &&
    !space &&
    !handMode;
  const defaultRepairBrush = dimensions
    ? Math.min(0.012, 12 / Math.min(dimensions.width, dimensions.height))
    : 0;
  const warpRadius = dimensions
    ? Math.min(
        editor.warpSettings.radius,
        0.325,
        800 / Math.min(dimensions.width, dimensions.height),
      )
    : editor.warpSettings.radius;
  const footprintRadius =
    group === 'liquify' && !protecting
      ? warpRadius
      : group === 'paint' && (!makeupPaint || !editor.paintSettings.automaticMakeup)
        ? editor.paintSettings.radius
        : startRepair || (editingSelection && mask.type === 'brush')
          ? editor.brushSettings.radius
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
  }, [dimensions, recipeGeometry]);
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
    setInspected(null);
  }, [group]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const style = window.getComputedStyle(element);
      const top = Number.parseFloat(style.paddingTop);
      const bottom = Number.parseFloat(style.paddingBottom);
      const left = Number.parseFloat(style.paddingLeft);
      const right = Number.parseFloat(style.paddingRight);
      setBounds({
        width: element.clientWidth - left - right,
        height: element.clientHeight - top - bottom,
        offsetX: (left - right) / 2,
        offsetY: (top - bottom) / 2,
      });
    };
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
    cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = 0;
    gestureTrail.current?.removeAttribute('d');
    setHandMode(false);
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
    // Keep enough of the image on screen to grab it again, including at Fit.
    const x = Math.max(Math.min(120, bounds.width * 0.18), (display.width * z - bounds.width) / 2);
    const y = Math.max(
      Math.min(120, bounds.height * 0.18),
      (display.height * z - bounds.height) / 2,
    );
    return { x: clamp(value.x, -x, x), y: clamp(value.y, -y, y) };
  }
  function viewportPoint(clientX: number, clientY: number): Point {
    const rect = viewport.current?.getBoundingClientRect();
    return rect
      ? {
          x: clientX - (rect.left + rect.width / 2 + bounds.offsetX),
          y: clientY - (rect.top + rect.height / 2 + bounds.offsetY),
        }
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
  useEffect(() => {
    const request = editor.portrait.faceFocus;
    if (
      !request ||
      lastFaceFocus.current === request ||
      group !== 'beauty' ||
      !geometryReady ||
      !coordinateMap
    )
      return;
    const face = editor.portrait.analysis?.targets.find(
      (target) => target.id === request.id && target.kind === 'face',
    );
    if (
      !face ||
      editor.portrait.analysis?.frame.contentHash !== editor.getSourceFrame()?.contentHash
    )
      return;
    const b = face.bounds;
    const points = projectOverlayPath(
      [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x, y: b.y + b.height },
        { x: b.x + b.width, y: b.y + b.height },
      ],
      coordinateMap.toContentOutput,
    );
    if (!points || fittedDisplay.width <= 0 || fittedDisplay.height <= 0) return;
    const xs = points.map(({ x }) => x),
      ys = points.map(({ y }) => y);
    const left = Math.min(...xs),
      right = Math.max(...xs);
    const top = Math.min(...ys),
      bottom = Math.max(...ys);
    if (right <= 0 || bottom <= 0 || left >= 1 || top >= 1) return;
    const ratio = Math.min(
      (bounds.width * 0.64) / Math.max(1, fittedDisplay.width * (right - left)),
      (bounds.height * 0.62) / Math.max(1, fittedDisplay.height * (bottom - top)),
    );
    const nextZoom = clamp(ratio, 1, 8);
    lastFaceFocus.current = request;
    setCamera({
      zoom: nextZoom,
      pan: boundedPan(
        {
          x: (0.5 - (left + right) / 2) * fittedDisplay.width * nextZoom,
          y: (0.5 - (top + bottom) / 2) * fittedDisplay.height * nextZoom,
        },
        nextZoom,
      ),
    });
  }, [
    editor.portrait.faceFocus,
    group,
    geometryReady,
    coordinateMap,
    fittedDisplay.width,
    fittedDisplay.height,
  ]);
  function zoomBy(factor: number, anchor = { x: 0, y: 0 }) {
    if (editGesture.current || projectiveFrame) return;
    setCamera((current) => zoomedCamera(current, current.zoom * factor, anchor));
  }
  wheelAction.current = (event) => {
    if (
      !image || isTyping(event.target) || editGesture.current || projectiveFrame ||
      (event.target instanceof Element && event.target.closest('.makeup-canvas-palette'))
    ) return;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
    if (
      zoom > 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.deltaX || event.shiftKey || space || handMode)
    ) {
      event.preventDefault();
      const dx = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
      setCamera((current) => ({
        ...current,
        pan: boundedPan(
          {
            x: current.pan.x - dx * units,
            y: current.pan.y - dy * units,
          },
          current.zoom,
        ),
      }));
    } else if (event.deltaY) {
      event.preventDefault();
      zoomBy(
        Math.exp(-clamp(event.deltaY * units, -200, 200) * 0.003),
        viewportPoint(event.clientX, event.clientY),
      );
    }
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
  function overlayPolygon(
    points: Point[],
    project: (point: Point) => Point | null = toDisplay,
  ): string | undefined {
    return projectOverlayPath(points, project)
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
  function flushEdit(state: EditGesture) {
    const next = state.pending;
    state.pending = undefined;
    if (!next || !ownsEdit(state)) return;
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
  function previewEdit(state: EditGesture, next: EditorRecipe) {
    state.pending = next;
    if (gestureFrame.current) return;
    gestureFrame.current = requestAnimationFrame(() => {
      gestureFrame.current = 0;
      if (editGesture.current === state) flushEdit(state);
    });
  }
  function drawGestureTrail(state: EditGesture) {
    const trail = gestureTrail.current;
    if (!trail) return;
    const points = state.points ?? (state.warp ? warpTrail.current : []);
    const projected = projectOverlayPath(points, toDisplay);
    if (!projected?.length) return;
    const path = projected.map(({ x, y }, i) => (i ? 'L' : 'M') + x * 100 + ' ' + y * 100);
    if (path.length === 1) path.push('l.001 .001');
    trail.setAttribute('d', path.join(' '));
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
    if (kind === 'warp' && bodyRange && (rawPoint.y < bodyRange.top || rawPoint.y > bodyRange.bottom))
      return;
    const paintLayers = kind === 'paint' && (recipe.schemaVersion === 3 || recipe.schemaVersion === 4)
      ? recipe.paintLayers.filter((layer) => paintLayerInMode(layer, makeupPaint))
      : [];
    const paintLayer = paintLayers.find((layer) => layer.id === editor.activePaintLayerId) ?? paintLayers.at(-1);
    if (kind === 'paint' && !paintLayer && (recipe.schemaVersion === 3 || recipe.schemaVersion === 4) &&
        recipe.paintLayers.length >= MAX_V3_PAINT_LAYERS) {
      setNotice(t('已达设备处理上限'));
      return;
    }
    let newId: string | undefined;
    if (
      kind === 'warp' ||
      (kind === 'brush' && startRepair) ||
      (kind === 'paint' && !paintLayer)
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
        ? { ...editor.brushSettings, mode: 'add' as const }
        : editor.brushSettings;
    const point =
      kind === 'brush' ||
      (kind === 'paint' &&
        !(makeupPaint && editor.paintSettings.mode === 'paint' && editor.paintSettings.material))
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
      const material = makeupPaint && settings.mode === 'paint' ? settings.material : undefined;
      if (settings.mode === 'clone' && (settings.choosingSource || !settings.source)) {
        editor.setPaintSettings({ ...settings, source: point, choosingSource: false });
        setNotice('克隆来源已选，下一笔开始绘制。');
        return;
      }
      let layer = paintLayer;
      let base = recipe;
      if (!layer) {
        layer = {
          id: newId!,
          name: t(makeupPaint ? '妆容' : '手动绘制'),
          origin: manualPaintOrigin(newId!, makeupPaint),
          enabled: true,
          opacity: 1,
          blendMode: 'normal',
          mask: null,
          strokes: [],
        };
        base = { ...recipe, paintLayers: [...recipe.paintLayers, layer] };
      }
      if (editor.activePaintLayerId !== layer.id) editor.setActivePaintLayerId(layer.id);
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
      const mask = bodyRange
        ? bodyStretchGuard(bodyRange)
        : region && { ...region.mask, invert: !region.mask.invert };
      if (mask) {
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
        radius: warpRadius,
        feather: editor.warpSettings.feather,
        strength: strength * pressure,
      };
      warpTrail.current = [point];
      drawGestureTrail(state);
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
    drawGestureTrail(state);
    setSelectionManipulating(
      kind === 'brush' ||
        kind === 'center' ||
        kind === 'radial-rotation' ||
        kind === 'radial-corner' ||
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
      drawGestureTrail(state);
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
      if (bodyRange && stroke.mode === 'push' &&
        state.lastPreview === (state.rollback ?? state.base) && !state.pending &&
        (stroke.strength === 0 || (stroke.from.x === point.x && stroke.from.y === point.y)))
        return;
      state.warp = stroke;
      if (warpTrail.current.length < 512) warpTrail.current.push(point);
      drawGestureTrail(state);
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
      if (state.kind === 'radial-corner') {
        const local = radialMaskFrameV3(original, dimensions).local(point);
        next = { ...original, radiusX: clamp(Math.abs(local.x) * original.radiusX, 0.0001, 1),
          radiusY: clamp(Math.abs(local.y) * original.radiusY, 0.0001, 1) };
      }
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
    if (!cancel) flushEdit(state);
    editGesture.current = null;
    cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = 0;
    gestureTrail.current?.removeAttribute('d');
    warpTrail.current = [];
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
          if (event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
          const amount = event.altKey ? 0.1 : event.shiftKey ? 10 : 1;
          const direction = {
            x: Number(event.key === 'ArrowRight') - Number(event.key === 'ArrowLeft'),
            y: Number(event.key === 'ArrowDown') - Number(event.key === 'ArrowUp'),
          };
          if (kind.startsWith('crop-') && coordinateMap) {
            const step = event.shiftKey ? 10 : 1;
            const target = {
              x: p.x + (direction.x * step) / coordinateMap.dimensions.width,
              y: p.y + (direction.y * step) / coordinateMap.dimensions.height,
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
                  event.shiftKey && kind !== 'crop-move',
                ),
                t('微调裁切'),
              );
            } catch (failure) {
              setNotice(failure instanceof Error ? failure.message : t('已保留当前裁切'));
            }
            return;
          }
          let dx = (direction.x * amount) / dimensions.width;
          let dy = (direction.y * amount) / dimensions.height;
          if (coordinateMap) {
            try {
              const nudged = {
                x: p.x + (direction.x * amount) / coordinateMap.dimensions.width,
                y: p.y + (direction.y * amount) / coordinateMap.dimensions.height,
              };
              const next = contentSpace
                ? coordinateMap.toContent(nudged)
                : coordinateMap.toSource(nudged);
              dx = next.x - point.x;
              dy = next.y - point.y;
            } catch {
              return;
            }
          }
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
  const showOutline = hasOutline && (!editor.hasUncommittedPreview || selectionVisible);
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
  const frameTransform = `translate(${pan.x + projectiveOffset.x}px,${pan.y + projectiveOffset.y}px) scale(${zoom})`;
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
          <FloatingNotice message={editor.error ?? previews.error ?? notice} />,
          statusContainer,
        )}
      <div
        className={`image-viewport ${editingSelection ? 'placement-mode' : ''} ${zoom > 1 || handMode || space ? 'can-pan' : ''} ${sampling ? 'sampling' : ''}`}
        ref={viewport}
        tabIndex={image ? 0 : undefined}
        aria-label={image ? t('图像画布') : undefined}
        aria-keyshortcuts={image ? '+ - 0 ArrowUp ArrowDown ArrowLeft ArrowRight' : undefined}
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
          if (event.key === '+' || event.key === '=') zoomBy(zoomStep);
          else if (event.key === '-' || event.key === '_') zoomBy(1 / zoomStep);
          else if (event.key === '0') fit();
          else if ((handMode || zoom > 1) && /^Arrow/.test(event.key)) {
            const step = event.shiftKey ? 80 : 16;
            const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
            const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
            setCamera((current) => ({
              ...current,
              pan: boundedPan({ x: current.pan.x + dx, y: current.pan.y + dy }, current.zoom),
            }));
          } else return;
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
            gestureTrail.current?.removeAttribute('d');
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
              (event.target as Element).closest('.compare-reveal-input, .body-stretch-handle') ||
            review.placing ||
            editGesture.current ||
            (editingSelection && !handMode && !space) ||
            (group === 'composite' && event.button === 0 && !handMode && !space &&
              event.pointerType !== 'touch' && (event.target as Element).closest('.image-frame')) ||
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
            onCollage={onCollage}
            accountState={accountState}
            onSignIn={onSignIn}
            onRegister={onRegister}
          />
        ) : image ? (
          <div
            className="image-frame"
            data-review-placing={review.placing || undefined}
            data-split-compare={splitActive || undefined}
            ref={frame}
            style={{
              width: display.width,
              height: display.height,
              transform: frameTransform,
            }}
            onPointerDown={(event) => {
              if (inspectingOriginal || review.placing || handMode || space || sampling || event.button !== 0) return;
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
                (!makeupPaint || !editor.paintSettings.automaticMakeup) &&
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
              if ((event.target as Element).closest('.image-handle') || inspectingOriginal) return;
              if (review.placing) {
                const point = toSource(event.clientX, event.clientY, false, 'strict');
                if (point) review.pick(point);
                return;
              }
              if (sampling) {
                sampleAt(event.clientX, event.clientY);
                return;
              }
              if (portraitTargets.length > 1 && geometryReady && !handMode && !space) {
                const frameRect = frame.current?.getBoundingClientRect();
                const point =
                  frameRect &&
                  portraitMap &&
                  sourcePointer(
                    { x: event.clientX, y: event.clientY },
                    frameRect,
                    portraitMap,
                    true,
                    'strict',
                  );
                if (!point) return;
                const hit = portraitTargets
                  .filter(
                    ({ bounds: b }) =>
                      point.x >= b.x &&
                      point.x <= b.x + b.width &&
                      point.y >= b.y &&
                      point.y <= b.y + b.height,
                  )
                  .sort(
                    (a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height,
                  )[0];
                if (hit && hit.id !== activeFace?.id) {
                  editor.commitCurrent(t('完成人物调节'));
                  editor.portrait.setTarget(hit.id);
                }
                return;
              }
              if (group === 'composite' && !handMode && !space && dimensions && 'imageLayers' in recipe) {
                const point = toSource(event.clientX, event.clientY, true, 'strict');
                if (!point) return;
                const selected = pickImageLayer(recipe.imageLayers, point, dimensions, editor.layerImages, source);
                if (selected) editor.setActiveImageLayerId(selected.id);
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
            {activeFace && geometryReady && (
              <svg
                className="portrait-landmark-overlay"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label={t('显示人脸关键点')}
                role="img"
              >
                {Object.entries(activeFace.contours).map(([name, outline]) => (
                  <polygon
                    key={name}
                    points={overlayPolygon(outline, projectFace)}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                <path
                  d={activeFace.landmarks
                    .flatMap((point) => {
                      const p = projectOverlayPoint(point, projectFace);
                      return p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
                        ? ['M' + p.x * 100 + ' ' + p.y * 100 + 'h0.001']
                        : [];
                    })
                    .join(' ')}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
            {portraitTargets.length > 1 &&
              geometryReady &&
              portraitTargets.map((target, index) => {
                const b = target.bounds;
                const point = projectOverlayPoint({ x: b.x + b.width / 2, y: b.y }, projectFace);
                if (!point || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
                return (
                  <button
                    key={target.id}
                    type="button"
                    className="portrait-face-pin"
                    aria-label={t('选择人物 {v0}', { v0: index + 1 })}
                    aria-pressed={target.id === activeFace?.id}
                    style={{
                      left: point.x * 100 + '%',
                      top: point.y * 100 + '%',
                      transform: 'translate(-50%, -55%) scale(' + 1 / zoom + ')',
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      editor.commitCurrent(t('完成人物调节'));
                      editor.portrait.setTarget(target.id);
                    }}
                  >
                    {index + 1}
                  </button>
                );
              })}
            {!comparing && (
              <CanvasReviewPins
                review={review}
                map={(point) => coordinateMap?.toOutput(point) ?? point}
                zoom={zoom}
              />
            )}
            {collaboration?.snapshot && (
                return;
              }
            {bodyRange && geometryReady && !inspectingOriginal && !sampling && !review.placing && !handMode && !space && (
              <BodyStretchGuides
                range={bodyRange}
                zoom={zoom}
                toDisplay={toDisplay}
                toSource={toSource}
                onChange={(verticalRange) => editor.setWarpSettings((current) => ({ ...current, verticalRange }))}
              />
            )}
            {!inspectingOriginal && <CanvasReviewPins review={review} map={(point) => coordinateMap?.toOutput(point) ?? point} zoom={zoom} />}
            {collaboration?.snapshot && !inspectingOriginal && (
              <CollaborationOverlay
                snapshot={collaboration.snapshot}
                sessionId={collaboration.session?.id ?? null}
                toDisplay={(point) => coordinateMap?.toOutput(point) ?? point}
                toContentDisplay={coordinateMap?.toContentOutput}
                zoom={zoom}
              />
            )}

            {footprintRadius > 0 && !inspectingOriginal && (
              <svg
                className="brush-footprint"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  ref={gestureTrail}
                  className="canvas-gesture-trail"
                  vectorEffect="non-scaling-stroke"
                />
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
                    {radial && <polygon
                      points={overlayPolygon([radial.point(-1, -1), radial.point(1, -1), radial.point(1, 1), radial.point(-1, 1)])}
                      fill="none" stroke="white" strokeWidth={1} opacity={0.75} vectorEffect="non-scaling-stroke"
                    />}
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
                        strokeWidth={1.35}
                        strokeDasharray="5 4"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {mask.type === 'polygon' && (
                      <polygon
                        points={overlayPolygon(mask.points)}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={0.25 / zoom}
                        strokeDasharray={'6 4'}
                      />
                    )}
                  </svg>
                )}
                {radial && !review.open && (
                  <>
                    {handle(radial.point(0, 0), t('拖动选区中心'), 'center')}
                    {handle(radial.point(1, 0), t('拖动横向半径'), 'radiusX')}
                    {handle(radial.point(0, 1), t('拖动纵向半径'), 'radiusY')}
                    {([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([x, y]) => (
                      <Fragment key={`${x}:${y}`}>{handle(radial.point(x, y), t('缩放选区'), 'radial-corner')}</Fragment>
                    ))}
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
            {group === 'composite' && imageLayer?.enabled && !inspectingOriginal && geometryReady && (
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
                    fill="none"
                    stroke="white"
                    strokeWidth={0.2 / zoom}
                    pointerEvents="stroke"
                    onPointerDown={(event) => { if (!review.placing) beginEdit(event, 'image-move'); }}
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
            {compareFrame && (
              <CompareReveal
                before={compareFrame}
                value={split}
                onChange={setSplit}
                onClose={closeSplit}
                inputRef={comparisonSlider}
              />
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
        {editor.file && toolOverlayRef && (
          <div
            className="canvas-tool-overlay"
            ref={toolOverlayRef}
            style={{
              '--canvas-photo-width': `${fittedDisplay.width}px`,
              '--canvas-photo-height': `${fittedDisplay.height}px`,
              '--canvas-center-y': `${bounds.offsetY}px`,
            } as React.CSSProperties}
            onPointerDown={(event) => event.stopPropagation()}
          />
        )}
      </div>
      {editor.file && (
        <>
          <CanvasReviewCard review={review} frameTransform={frameTransform} />
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
            <CanvasReviewToggle review={review} onOpen={() => setHandMode(false)} />
            <IconButton label={t('撤销本次编辑')} disabled={!editor.canUndo} onClick={editor.undo}>
              <ArrowCounterClockwise size={17} />
            </IconButton>
            <IconButton label={t('重做本次编辑')} disabled={!editor.canRedo} onClick={editor.redo}>
              <ArrowClockwise size={17} />
            </IconButton>
            <button
              type="button"
              className={`compare-press ${comparing ? 'active' : ''}`}
              aria-label={t('按住对比')}
              ref={splitToggle}
              aria-pressed={inspectingOriginal}
              title={t('点击滑动对比，按住查看原图')}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                comparePressStart.current = performance.now();
                window.clearTimeout(comparePressTimer.current);
                comparePressTimer.current = window.setTimeout(() => setComparing(true), 230);
              }}
              onPointerUp={releaseComparison}
              onClick={(event) => {
                if (cropEditing) return;
                if (event.detail && performance.now() - comparePressStart.current > 260) return;
                focusSplit.current = !splitOpen && event.detail === 0;
                setSplitOpen(!splitOpen);
              }}
              onPointerCancel={releaseComparison}
              onLostPointerCapture={releaseComparison}
              onKeyDown={(event) => {
                if (event.key === ' ') {
                  event.preventDefault();
                  setComparing(true);
                }
              }}
              onKeyUp={(event) => {
                if (event.key === ' ') {
                  event.preventDefault();
                  setComparing(false);
                }
              }}
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
            <IconButton
              label={t('编辑记录')}
              className="canvas-history-trigger"
              data-action="open-history"
              aria-pressed={historyOpen}
              onClick={onHistory}
            >
              <StudioGlyph name="history" size={17} />
            </IconButton>
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
                onClick={() => zoomBy(1 / zoomStep)}
              >
                <MagnifyingGlassMinus size={18} />
              </IconButton>
              <IconButton
                label={t('放大预览')}
                disabled={zoom >= MAX_CANVAS_ZOOM}
                onClick={() => zoomBy(zoomStep)}
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
              <button
                type="button"
                className="canvas-touch-action"
                data-action="open-collage"
                aria-label={t('拼图')}
                onClick={() => {
                  setViewToolsOpen(false);
                  onCollage();
                }}
              >
                <StudioGlyph name="collage" size={18} />
                <span>{t('拼图')}</span>
              </button>
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
        </>
      )}
      {editor.loading && (
        <div className="stage-loading" role="status">
          <img className="studio-import-activity" src="/import-activity.svg" alt="" />
          <span>{t('正在准备图片…')}</span>
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
