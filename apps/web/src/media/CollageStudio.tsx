import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUUpLeft,
  ArrowUUpRight,
  ArrowsClockwise,
  CaretDown,
  Check,
  ImageSquare,
  Pause,
  Play,
  Plus,
  Scissors,
  SlidersHorizontal,
  SpeakerHigh,
  SpeakerSlash,
  Sparkle,
  Trash,
  X,
} from '@phosphor-icons/react';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { Busy, IconButton, InlineError, Modal } from '../components/Ui';
import { StudioGlyph } from '../components/StudioGlyph';
import { downloadBlob } from '../lib/api';
import type { Asset } from '../lib/types';
import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { RubberSegment } from '../components/control-motion';
import { ParameterShelf } from '../editor/ParameterShelf';
import {
  collageFrame,
  collageAccept,
  COLLAGE_MAX_FILE_BYTES,
  COLLAGE_MAX_ITEMS,
  COLLAGE_MAX_TOTAL_BYTES,
  COLLAGE_MAX_TOTAL_PIXELS,
  decodeCollageMedia,
  encodeMotionPhoto,
  groupCollageFiles,
  readCollageAsset,
  type CollageImport,
  type CollageMedia,
} from './collage-media';
import {
  collageGeometry,
  collageExportEdge,
  pointInCollageRect,
  tileImageRect,
  type CollageItem,
  type CollageMode,
  type CollagePoint,
  type CollageScene,
  type CollageTemplate,
} from './collage-layout';
import { collageBlob, collageRecordingType, paintCollage, recordCollage } from './collage-render';
import { personCollageMatte, traceCollageMatte } from './collage-cutout';
import { trackCollageSubject } from './collage-tracking';
import './collage-studio.css';

const initialScene: CollageScene = {
  items: [],
  mode: 'layout',
  template: 'grid',
  ratio: 3 / 4,
  gap: 0.006,
  background: '#ffffff',
};
const PNG_MAX_PIXELS = 16_777_216;
const pngEdgeLimit = (scene: CollageScene) => (scene.mode === 'layout' ? 4096 : 8192);
const ratioChoices = [
  ['3:4', 3 / 4],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['4:5', 4 / 5],
  ['5:4', 5 / 4],
  ['2:3', 2 / 3],
  ['3:2', 3 / 2],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['5:7', 5 / 7],
  ['7:5', 7 / 5],
  ['1.91:1', 1.91],
  ['2.39:1', 2.39],
  ['A4', 210 / 297],
  ['A4 ↔', 297 / 210],
] as const;
const templates: { id: CollageTemplate; label: string; min?: number }[] = [
  { id: 'grid', label: '均匀网格' },
  { id: 'top', label: '上方主图' },
  { id: 'left', label: '左侧主图' },
  { id: 'right', label: '右侧主图' },
  { id: 'bottom', label: '下方主图' },
  { id: 'rows', label: '等分横幅' },
  { id: 'poster', label: '海报留白' },
  { id: 'journal', label: '杂志跨页' },
  { id: 'instant', label: '拍立得边框' },
  { id: 'film', label: '胶片条带' },
  { id: 'contact', label: '留边网格' },
  { id: 'diptych', label: '留白对页' },
  { id: 'columns', label: '竖幅并排', min: 3 },
  { id: 'triptych', label: '居中主图', min: 3 },
  { id: 'wide-lead', label: '横幅与双栏', min: 3 },
  { id: 'mosaic', label: '错落拼贴', min: 4 },
  { id: 'three-plus-one', label: '三格与横幅', min: 4 },
  { id: 'two-up', label: '双主图', min: 4 },
];
const errors: Record<string, string> = {
  COLLAGE_FORMAT: '请选择支持的照片、GIF 或视频文件。',
  COLLAGE_FILE_LIMIT: '单个文件最多 48 MB。',
  COLLAGE_PAIR: '请选择原始实况照片，或同时选中分开的照片和视频。',
  COLLAGE_DECODE: '浏览器无法解码这份素材。',
  COLLAGE_FRAME_LIMIT: '素材的分辨率或帧数超出拼图上限。',
  COLLAGE_ANIMATION_UNAVAILABLE: '此浏览器无法解码该动图。',
  COLLAGE_MOTION_EXPORT: '此浏览器无法录制所选的动态格式。',
  COLLAGE_RENDER: '拼图渲染失败。',
  COLLAGE_SUBJECT: '未能分离人像，请沿主体描边。',
  COLLAGE_LIMIT: '最多 12 项素材，本次编辑的文件总量最多 160 MB。',
  COLLAGE_PIXEL_BUDGET: '当前拼图和撤销历史中的素材合计超过 9600 万像素。',
  COLLAGE_FETCH: '无法读取这份项目素材。',
  COLLAGE_PLAY: '无法播放这份动态素材。',
  COLLAGE_REPLACE: '要替换的素材已变化，请重新选择。',
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
type SceneHistory = { past: CollageScene[]; present: CollageScene; future: CollageScene[] };
type BusyKind = 'import' | 'subject' | 'export';
type SaveKind = 'png' | 'insert' | 'video' | 'motion';
type MaskDraft = { id: string; points: CollagePoint[] };
type Drag = {
  pointer: number;
  start: CollagePoint;
  item: CollageItem;
  base: CollageScene;
  subject: boolean;
  panSpan: CollagePoint;
};

function patchItem(
  scene: CollageScene,
  id: string,
  transform: (item: CollageItem) => CollageItem,
): CollageScene {
  return { ...scene, items: scene.items.map((item) => (item.id === id ? transform(item) : item)) };
}

export function CollageStudio({
  active,
  onClose,
  onUse,
  insertLimits,
  onCurrent,
  importRequest,
  onImportConsumed,
  onGenerate,
  exportHost,
  assets = [],
}: {
  active: boolean;
  onClose: () => void;
  onUse: (file: File, signal: AbortSignal) => Promise<boolean>;
  insertLimits: { maxPixels: number; maxDimension: number };
  onCurrent?: () => Promise<File>;
  importRequest: CollageImport | null;
  onImportConsumed: (request: CollageImport) => void;
  onGenerate: (draft: {
    selectedId?: string;
    canAppend: boolean;
    capture?: () => Promise<File>;
  }) => void;
  exportHost: HTMLElement | null;
  assets?: readonly Asset[];
}) {
  const [history, setHistory] = useState<SceneHistory>({
    past: [],
    present: initialScene,
    future: [],
  });
  const [draft, setDraft] = useState<CollageScene | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [mask, setMask] = useState<MaskDraft | null>(null);
  const [moveSubject, setMoveSubject] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false);
  const [seconds, setSeconds] = useState('3');
  const [customRatio, setCustomRatio] = useState<{ width: string; height: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState<BusyKind | null>(null);
  const [error, setError] = useState('');
  const resources = useRef(new Map<string, CollageMedia>());
  const lifetime = useRef<AbortController | null>(null);
  const operation = useRef<AbortController | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scratch = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pairInput = useRef<HTMLInputElement>(null);
  const replacementInput = useRef<HTMLInputElement>(null);
  const replacementTarget = useRef<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const maskPointer = useRef<number | null>(null);
  const dragDraft = useRef<CollageScene | null>(null);
  const precisionDraft = useRef<CollageScene | null>(null);
  const scene = draft ?? history.present;
  const selected = scene.items.find((item) => item.id === selectedId) ?? scene.items[0];
  const currentMedia = selected ? resources.current.get(selected.id) : undefined;
  const moving = scene.items.some((item) => {
    const entry = resources.current.get(item.id);
    return entry && entry.kind !== 'photo';
  });
  const maskItem = mask && scene.items.find((item) => item.id === mask.id);
  const preview: CollageScene = maskItem
    ? {
        ...initialScene,
        ratio: maskItem.width / maskItem.height,
        gap: 0,
        items: [{ ...maskItem, panX: 0, panY: 0, zoom: 1, subject: undefined }],
      }
    : scene;
  const geometry = collageGeometry(preview, 960);
  const selectedIndex = scene.items.findIndex((item) => item.id === selected?.id);
  const cell = !mask && selectedIndex >= 0 ? geometry.cells[selectedIndex] : null;

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const media = resources.current;
    return () => {
      controller.abort();
      operation.current?.abort();
      media.forEach((item) => item.dispose());
      media.clear();
    };
  }, []);
  useEffect(() => {
    if (!active) {
      operation.current?.abort();
      stopPlayback();
      return;
    }
    if (busy || !importRequest) return;
    // Let the mount commit settle before starting I/O. Suspense can replay this effect.
    const queued = window.setTimeout(() => {
      const onSettled = () => onImportConsumed(importRequest);
      if ('files' in importRequest)
        void importFiles(async () => importRequest.files, { onSettled });
      else if ('capture' in importRequest)
        void importFiles(async () => [await importRequest.capture()], { onSettled });
      else
        void importFiles(async (signal) => [await readCollageAsset(importRequest.asset, signal)], {
          replaceId: importRequest.replaceId,
          onSettled,
        });
    }, 0);
    return () => window.clearTimeout(queued);
  }, [active, busy, importRequest]);
  useEffect(() => {
    const retained = new Set(
      [...history.past, history.present, ...history.future].flatMap((step) =>
        step.items.map((item) => item.id),
      ),
    );
    for (const [id, item] of resources.current)
      if (!retained.has(id)) {
        item.dispose();
        resources.current.delete(id);
      }
  }, [history]);
  useEffect(() => {
    if (!active || !canvas.current || !scratch.current) return;
    let frame = 0;
    const render = (now: number) => {
      try {
        if (playing)
          preview.items.forEach(({ id }) => resources.current.get(id)?.animation?.advance(now));
        paintCollage(
          canvas.current!,
          scratch.current!,
          preview,
          resources.current,
          960,
          playing && !mask,
        );
        if (playing) frame = requestAnimationFrame(render);
      } catch (reason) {
        stopPlayback();
        message(reason);
      }
    };
    render(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [active, scene, playing, mask]);

  function commit(next: CollageScene) {
    precisionDraft.current = null;
    setDraft(null);
    setHistory((previous) =>
      next === previous.present
        ? previous
        : {
            past: [...previous.past, previous.present].slice(-24),
            present: next,
            future: [],
          },
    );
  }
  function undo(redo = false) {
    stopPlayback();
    precisionDraft.current = null;
    setDraft(null);
    setHistory((previous) => {
      if (redo && previous.future.length)
        return {
          past: [...previous.past, previous.present],
          present: previous.future[0]!,
          future: previous.future.slice(1),
        };
      if (!redo && previous.past.length)
        return {
          past: previous.past.slice(0, -1),
          present: previous.past.at(-1)!,
          future: [previous.present, ...previous.future],
        };
      return previous;
    });
  }
  function stopPlayback() {
    resources.current.forEach((item) => {
      item.video?.pause();
      item.animation?.pause();
    });
    setPlaying(false);
  }
  function updateAudio(audible: boolean, id: string) {
    resources.current.forEach((item) => {
      if (item.video) item.video.muted = !audible || item.id !== id;
    });
  }
  function play() {
    if (playing) return stopPlayback();
    updateAudio(sound, selected?.id ?? '');
    setPlaying(true);
    void Promise.all(scene.items.map(({ id }) => resources.current.get(id)?.video?.play())).catch(
      () => {
        stopPlayback();
        setError(t(errors.COLLAGE_PLAY!));
      },
    );
  }
  function message(reason: unknown) {
    if (reason instanceof DOMException && reason.name === 'AbortError') return;
    const key = reason instanceof Error ? reason.message : '';
    setError(t(errors[key] ?? errors.COLLAGE_RENDER!));
  }
  function start(kind: BusyKind) {
    if (operation.current || lifetime.current?.signal.aborted) return null;
    const controller = new AbortController();
    operation.current = controller;
    stopPlayback();
    setError('');
    setBusy(kind);
    return controller;
  }
  function finish(controller: AbortController) {
    if (operation.current !== controller) return;
    operation.current = null;
    if (!lifetime.current?.signal.aborted) setBusy(null);
  }
  async function importFiles(
    getFiles: (signal: AbortSignal) => Promise<File[]>,
    {
      explicitPair = false,
      replaceId,
      onSettled,
    }: { explicitPair?: boolean; replaceId?: string; onSettled?: () => void } = {},
  ) {
    const task = start('import');
    if (!task) return;
    const staged: CollageMedia[] = [];
    try {
      const files = await getFiles(task.signal);
      task.signal.throwIfAborted();
      if (!files.length) return;
      const inputs = groupCollageFiles(files, explicitPair);
      const base = history.present;
      const replacement = replaceId ? base.items.find(({ id }) => id === replaceId) : undefined;
      if (replaceId && (!replacement || inputs.length !== 1)) throw new Error('COLLAGE_REPLACE');
      const retained = [...resources.current.values()];
      const retainedBytes = retained.reduce((sum, item) => sum + item.bytes, 0);
      if (
        base.items.length + inputs.length - Number(!!replacement) > COLLAGE_MAX_ITEMS ||
        retainedBytes + files.reduce((sum, file) => sum + file.size, 0) > COLLAGE_MAX_TOTAL_BYTES
      )
        throw new Error('COLLAGE_LIMIT');
      let pixels = retained.reduce((sum, item) => sum + item.width * item.height, 0);
      for (const item of inputs) {
        const decoded = await decodeCollageMedia(item, task.signal);
        staged.push(decoded);
        pixels += decoded.width * decoded.height;
        if (pixels > COLLAGE_MAX_TOTAL_PIXELS) throw new Error('COLLAGE_PIXEL_BUDGET');
      }
      task.signal.throwIfAborted();
      staged.forEach((item) => resources.current.set(item.id, item));
      const items: CollageItem[] = staged.map(({ id, width, height }) => ({
        id,
        width,
        height,
        zoom: 1,
        panX: 0,
        panY: 0,
      }));
      const wasEmpty = base.items.length === 0;
      // The replacement owns its pixels. Subject mattes and motion tracking
      // refer to the old source, so only the tile framing can be carried over.
      const nextItems = replacement
        ? base.items.map((item) =>
            item.id === replacement.id
              ? { ...items[0]!, panX: item.panX, panY: item.panY, zoom: item.zoom }
              : item,
          )
        : [...base.items, ...items];
      commit({
        ...base,
        ratio:
          wasEmpty && items.length === 1
            ? items[0]!.width / items[0]!.height
            : wasEmpty
              ? initialScene.ratio
              : base.ratio,
        items: nextItems,
      });
      setSelectedId(items.at(-1)!.id);
      setMask(null);
      setMoveSubject(false);
    } catch (reason) {
      staged.forEach((item) => item.dispose());
      if (!task.signal.aborted) message(reason);
    } finally {
      if (!task.signal.aborted) onSettled?.();
      finish(task);
    }
  }
  function addProjectAsset(assetId: string) {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    void importFiles(async (signal) => [await readCollageAsset(asset, signal)]);
  }
  function generateMaterial() {
    const frozen = history.present;
    const media = new Map(frozen.items.map(({ id }) => [id, resources.current.get(id)!]));
    onGenerate({
      selectedId: selected?.id,
      canAppend: frozen.items.length < COLLAGE_MAX_ITEMS,
      capture: frozen.items.length
        ? async () => {
            lifetime.current?.signal.throwIfAborted();
            const output = document.createElement('canvas');
            paintCollage(output, document.createElement('canvas'), frozen, media, 1536);
            const png = await collageBlob(output, 'image/png');
            lifetime.current?.signal.throwIfAborted();
            return new File([png], 'collage-reference.png', { type: 'image/png' });
          }
        : undefined,
    });
  }
  function updateSelected(transform: (item: CollageItem) => CollageItem) {
    if (selected) commit(patchItem(history.present, selected.id, transform));
  }
  function adjustTile(transform: (item: CollageItem) => CollageItem) {
    if (!selected) return;
    const next = patchItem(precisionDraft.current ?? history.present, selected.id, transform);
    precisionDraft.current = next;
    setDraft(next);
  }
  function reorder(direction: number) {
    const items = [...history.present.items];
    const index = items.findIndex((item) => item.id === selected?.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next]!, items[index]!];
    commit({ ...history.present, items });
  }
  function moveForeground(direction: 'up' | 'down') {
    if (!selected?.subject) return;
    const orders = scene.items.flatMap((item, index) => item.subject ? [item.subject.order ?? index] : []);
    const extreme = direction === 'up' ? Math.max(...orders) + 1 : Math.min(...orders) - 1;
    updateSelected((item) => ({ ...item, subject: { ...item.subject!, order: extreme } }));
  }
  function beginMask() {
    if (!selected) return;
    stopPlayback();
    setMask({ id: selected.id, points: selected.subject?.points ?? [] });
  }
  function finishMask() {
    if (!mask || !maskItem || mask.points.length < 3) return;
    const source = resources.current.get(mask.id);
    if (!source) return;
    const matte = traceCollageMatte(maskItem.width, maskItem.height, mask.points);
    const track =
      source.kind === 'photo' ? undefined : trackCollageSubject(collageFrame(source, false), matte);
    commit(
      patchItem(history.present, mask.id, (item) => ({
        ...item,
        subject: {
          ...item.subject,
          points: mask.points,
          matte,
          track,
          scale: item.subject?.scale ?? 1,
          offsetX: item.subject?.offsetX ?? 0,
          offsetY: item.subject?.offsetY ?? 0,
          only: item.subject?.only ?? false,
        },
      })),
    );
    setMask(null);
    setMoveSubject(true);
  }
  async function autoPerson() {
    if (!selected || !currentMedia) return;
    const task = start('subject');
    if (!task) return;
    try {
      const reference = collageFrame(currentMedia, false);
      const matte = await personCollageMatte(
        reference,
        selected.width,
        selected.height,
        task.signal,
      );
      task.signal.throwIfAborted();
      updateSelected((item) => ({
        ...item,
        subject: {
          ...item.subject,
          points: undefined,
          matte,
          track: currentMedia.kind === 'photo' ? undefined : trackCollageSubject(reference, matte),
          scale: item.subject?.scale ?? 1,
          offsetX: item.subject?.offsetX ?? 0,
          offsetY: item.subject?.offsetY ?? 0,
          only: item.subject?.only ?? false,
        },
      }));
      setMoveSubject(true);
    } catch (reason) {
      if (!task.signal.aborted) message(reason);
    } finally {
      finish(task);
    }
  }
  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.x) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.y) / rect.height, 0, 1),
    };
  }
  function addMaskPoint(point: CollagePoint) {
    setMask((current) => {
      if (!current || current.points.length >= 720) return current;
      const last = current.points.at(-1);
      if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.0015) return current;
      return { ...current, points: [...current.points, point] };
    });
  }
  function startPointer(event: PointerEvent<HTMLCanvasElement>) {
    if (busy || event.button !== 0 || !scene.items.length) return;
    const point = canvasPoint(event);
    if (mask) {
      maskPointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      addMaskPoint(point);
      return;
    }
    const subject = moveSubject && !!selected?.subject;
    const index = geometry.cells.findIndex((entry) =>
      pointInCollageRect(
        {
          x: point.x * geometry.width,
          y: point.y * geometry.height,
        },
        entry,
      ),
    );
    const item = subject ? selected : scene.items[index];
    if (!item) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(item.id);
    const target = geometry.cells[index];
    const image = target && tileImageRect(item, target, scene.mode !== 'layout');
    const panSpan =
      target && image
        ? {
            x: (image.width - target.width) / (2 * geometry.width),
            y: (image.height - target.height) / (2 * geometry.height),
          }
        : { x: 0, y: 0 };
    drag.current = {
      pointer: event.pointerId,
      start: point,
      item,
      base: history.present,
      subject,
      panSpan,
    };
  }
  function movePointer(event: PointerEvent<HTMLCanvasElement>) {
    const point = canvasPoint(event);
    if (mask && maskPointer.current === event.pointerId) return addMaskPoint(point);
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = point.x - current.start.x,
      dy = point.y - current.start.y;
    if (!dx && !dy && !dragDraft.current) return;
    const next = patchItem(current.base, current.item.id, (item) =>
      current.subject && item.subject
        ? {
            ...item,
            subject: {
              ...item.subject,
              offsetX: clamp(item.subject.offsetX + dx, -1, 1),
              offsetY: clamp(item.subject.offsetY + dy, -1, 1),
            },
          }
        : {
            ...item,
            panX:
              Math.abs(current.panSpan.x) > 1e-9
                ? clamp(item.panX + dx / current.panSpan.x, -1, 1)
                : item.panX,
            panY:
              Math.abs(current.panSpan.y) > 1e-9
                ? clamp(item.panY + dy / current.panSpan.y, -1, 1)
                : item.panY,
          },
    );
    dragDraft.current = next;
    setDraft(next);
  }
  function endPointer(event: PointerEvent<HTMLCanvasElement>, cancelled: boolean) {
    if (maskPointer.current === event.pointerId) maskPointer.current = null;
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    const next = dragDraft.current;
    dragDraft.current = null;
    if (next && !cancelled) commit(next);
    else setDraft(null);
  }
  async function save(kind: SaveKind) {
    if (!scene.items.length) return;
    const task = start('export');
    if (!task) return;
    setProgress(0);
    try {
      if (kind === 'png' || kind === 'insert') {
        const output = document.createElement('canvas'),
          buffer = document.createElement('canvas');
        const inserting = kind === 'insert';
        const limit = inserting ? Math.min(insertLimits.maxDimension, 4096) : pngEdgeLimit(scene);
        const pixels = inserting ? insertLimits.maxPixels : PNG_MAX_PIXELS;
        const edge = collageExportEdge(scene, limit, pixels);
        paintCollage(output, buffer, scene, resources.current, edge);
        const png = await collageBlob(output, 'image/png');
        task.signal.throwIfAborted();
        if (kind === 'insert') {
          const applied = await onUse(
            new File([png], 'collage.png', { type: 'image/png' }),
            task.signal,
          );
          if (applied && !task.signal.aborted) onClose();
        } else downloadBlob(png, 'collage.png');
      } else {
        const { video, poster } = await recordCollage({
          scene,
          media: new Map(scene.items.map(({ id }) => [id, resources.current.get(id)!])),
          seconds: Number(seconds),
          mp4Only: kind === 'motion',
          signal: task.signal,
          onProgress: setProgress,
        });
        if (kind === 'motion') {
          const file = await encodeMotionPhoto(poster!, video);
          task.signal.throwIfAborted();
          downloadBlob(file, 'collageMP.jpg');
        } else downloadBlob(video, video.type === 'video/mp4' ? 'collage.mp4' : 'collage.webm');
      }
    } catch (reason) {
      if (!task.signal.aborted) message(reason);
    } finally {
      finish(task);
    }
  }

  const aspect = geometry.width / geometry.height;
  const outputFrame = collageGeometry(
    scene,
    collageExportEdge(scene, pngEdgeLimit(scene), PNG_MAX_PIXELS),
  );
  const outputCell = outputFrame.cells[selectedIndex];
  const outputImage =
    selected && outputCell && tileImageRect(selected, outputCell, scene.mode !== 'layout');
  const editingSubject = moveSubject ? selected?.subject : undefined;
  const positionControls =
    selected && outputCell && outputImage
      ? (['x', 'y'] as const).map((axis) => {
          const horizontal = axis === 'x';
          const dimension = horizontal ? 'width' : 'height';
          const pan = horizontal ? 'panX' : 'panY';
          const offset = horizontal ? 'offsetX' : 'offsetY';
          const extent = editingSubject
            ? outputFrame[dimension]
            : (outputImage[dimension] - outputCell[dimension]) / 2;
          return {
            id: 'collage-position-' + axis,
            glyph: horizontal ? 'positionX' : 'positionY',
            label: t(horizontal ? '水平位置' : '垂直位置'),
            value: (editingSubject?.[offset] ?? selected[pan]) * extent,
            min: -Math.abs(extent),
            max: Math.abs(extent),
            step: 0.1,
            neutral: 0,
            unit: 'px',
            disabled: Math.abs(extent) < 0.05,
            onChange: (value: number) =>
              adjustTile((item) =>
                editingSubject && item.subject
                  ? {
                      ...item,
                      subject: { ...item.subject, [offset]: clamp(value / extent, -1, 1) },
                    }
                  : { ...item, [pan]: clamp(value / extent, -1, 1) },
              ),
          };
        })
      : [];
  const customAspect = customRatio ? Number(customRatio.width) / Number(customRatio.height) : 0;
  const customAspectValid = customAspect >= 1 / 20 && customAspect <= 20;
  const sourceOptions = [
    { value: 'local', label: t('本地照片、实况或动图') },
    { value: 'pair', label: t('导入分开的实况文件') },
    ...(onCurrent ? [{ value: 'canvas', label: t('当前画布') }] : []),
    ...assets.map((item) => ({ value: 'asset:' + item.id, label: item.name })),
  ];
  const saveOptions: { value: SaveKind; label: string }[] = [
    { value: 'png', label: t('下载 PNG') },
    { value: 'insert', label: t('放进编辑器') },
  ];
  if (moving && collageRecordingType())
    saveOptions.push({ value: 'video', label: t('导出动态视频') });
  if (moving && collageRecordingType(true))
    saveOptions.push({ value: 'motion', label: t('导出实况照片') });
  return (
    <section
      className="collage-studio"
      data-empty={!scene.items.length}
      aria-label={t('拼图')}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 'z' &&
          !busy &&
          !mask &&
          !(event.target instanceof HTMLInputElement)
        ) {
          event.preventDefault();
          undo(event.shiftKey);
        }
      }}
    >
      {active &&
        exportHost &&
        createPortal(
          <ChoiceSelect<SaveKind | ''>
            size="compact"
            className="collage-save"
            ariaLabel={t('保存拼图')}
            placeholder={t('导出')}
            value=""
            options={saveOptions}
            disabled={!selected || !!mask || !!busy}
            onValueChange={(kind) => {
              if (kind) void save(kind);
            }}
          />,
          exportHost,
        )}
      <canvas ref={scratch} hidden aria-hidden="true" />
      <input
        ref={input}
        type="file"
        multiple
        accept={collageAccept}
        hidden
        data-testid="collage-files"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          void importFiles(async () => files);
        }}
      />
      <input
        ref={pairInput}
        type="file"
        multiple
        accept={collageAccept}
        hidden
        data-testid="collage-pair"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          void importFiles(async () => files, { explicitPair: true });
        }}
      />
      <input
        ref={replacementInput}
        type="file"
        multiple
        accept={collageAccept}
        hidden
        data-testid="collage-replace-file"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          const replaceId = replacementTarget.current;
          event.currentTarget.value = '';
          replacementTarget.current = null;
          if (replaceId) void importFiles(async () => files, { replaceId });
        }}
      />
      <div
        className="collage-stage"
        data-mask={!!mask}
        style={{ '--collage-aspect': aspect } as CSSProperties}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          const files = [...event.dataTransfer.files];
          void importFiles(async () => files);
        }}
      >
        <div className="collage-picture" hidden={!scene.items.length}>
          <canvas
            ref={canvas}
            aria-label={t('拼图预览')}
            role="img"
            onPointerDown={startPointer}
            onPointerMove={movePointer}
            onPointerUp={(event) => endPointer(event, false)}
            onPointerCancel={(event) => endPointer(event, true)}
            onLostPointerCapture={(event) => endPointer(event, true)}
          />
          <svg
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            className="collage-outline"
            aria-hidden="true"
          >
            {cell && <rect x={cell.x} y={cell.y} width={cell.width} height={cell.height} />}
            {mask && (
              <polyline
                points={mask.points
                  .map(({ x, y }) => `${x * geometry.width},${y * geometry.height}`)
                  .join(' ')}
              />
            )}
            {mask?.points.map(
              ({ x, y }, index) =>
                index % 8 === 0 && (
                  <circle key={index} cx={x * geometry.width} cy={y * geometry.height} r={3} />
                ),
            )}
          </svg>
        </div>
        {!scene.items.length && (
          <button
            className="button button-primary"
            onClick={() => input.current?.click()}
            disabled={!!busy}
          >
            <Plus size={18} /> {t('添加照片或实况')}
          </button>
        )}
        {moving && !mask && (
          <div className="collage-playback">
            <IconButton
              label={t(playing ? '暂停实况' : '播放实况')}
              disabled={!!busy}
              onClick={play}
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </IconButton>
            {currentMedia?.video && (
              <IconButton
                label={t(sound ? '关闭原声' : '播放原声')}
                disabled={!!busy}
                aria-pressed={sound}
                onClick={() => {
                  setSound(!sound);
                  updateAudio(!sound, currentMedia.id);
                }}
              >
                {sound ? <SpeakerHigh size={18} /> : <SpeakerSlash size={18} />}
              </IconButton>
            )}
          </div>
        )}
      </div>
      <aside className="collage-inspector" aria-label={t('拼图工具')}>
        {(error || busy || currentMedia?.usingVideoCover) && (
          <div className="collage-feedback">
            {error ? (
              <div className="collage-error">
                <InlineError message={error} />
                <IconButton label={t('关闭')} onClick={() => setError('')}>
                  <X size={15} />
                </IconButton>
              </div>
            ) : busy ? (
              <div className="collage-status" role="status">
                <Busy
                  label={t(
                    busy === 'export'
                      ? '正在导出'
                      : busy === 'subject'
                        ? '正在分离主体'
                        : '正在读取图片',
                  )}
                />
                {busy === 'export' && (
                  <progress value={progress} max={100} aria-label={t('导出进度')} />
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    if (busy === 'import' && importRequest) onImportConsumed(importRequest);
                    operation.current?.abort();
                  }}
                >
                  {t('取消')}
                </button>
              </div>
            ) : (
              <p className="collage-format-note" role="status">
                {t('封面无法解码，已显示实况视频帧。')}
              </p>
            )}
          </div>
        )}
        {mask ? (
          <div className="collage-actions collage-mask-actions">
            <IconButton label={t('取消')} onClick={() => setMask(null)}>
              <X size={19} />
            </IconButton>
            <IconButton
              label={t('撤销描边')}
              disabled={!mask.points.length}
              onClick={() => setMask({ ...mask, points: mask.points.slice(0, -1) })}
            >
              <ArrowUUpLeft size={19} />
            </IconButton>
            <button
              className="button button-primary"
              disabled={mask.points.length < 3}
              onClick={finishMask}
            >
              <Check size={17} /> {t('应用抠图')}
            </button>
          </div>
        ) : (
          <div className="collage-controls" inert={!!busy}>
            <div className="collage-actions collage-source-tools">
              {selected && (
                <IconButton label={t('添加照片或实况')} onClick={() => input.current?.click()}>
                  <Plus size={19} />
                </IconButton>
              )}
              <ChoiceSelect
                size="compact"
                ariaLabel={t('添加素材')}
                placeholder={t('素材')}
                value=""
                options={sourceOptions}
                onValueChange={(value) => {
                  if (value === 'local') input.current?.click();
                  else if (value === 'pair') pairInput.current?.click();
                  else if (value === 'canvas' && onCurrent)
                    void importFiles(async () => [await onCurrent()]);
                  else if (value.startsWith('asset:')) addProjectAsset(value.slice(6));
                }}
              />
              <IconButton label={t('AI 生成素材')} onClick={generateMaterial}>
                <Sparkle size={17} />
              </IconButton>
              {selected && (
                <IconButton label={t('编辑抠图轮廓')} onClick={beginMask}>
                  <Scissors size={17} />
                </IconButton>
              )}
              <span className="collage-actions-spacer" />
              <IconButton label={t('撤销')} disabled={!history.past.length} onClick={() => undo()}>
                <ArrowUUpLeft size={18} />
              </IconButton>
              <IconButton
                label={t('重做')}
                disabled={!history.future.length}
                onClick={() => undo(true)}
              >
                <ArrowUUpRight size={18} />
              </IconButton>
            </div>
            {selected && (
              <>
                <RubberSegment<CollageMode>
                  label={t('拼图方式')}
                  value={scene.mode}
                  onChange={(mode) => commit({ ...scene, mode })}
                  options={[
                    {
                      value: 'layout',
                      label: t('模板'),
                      icon: <StudioGlyph name="collage" size={16} />,
                    },
                    { value: 'vertical', label: t('长拼图') },
                    { value: 'horizontal', label: t('横拼图') },
                  ]}
                />
                {scene.mode === 'layout' && (
                  <>
                    <div className="collage-ratio-rail" role="group" aria-label={t('画幅比例')}>
                      {ratioChoices.map(([label, ratio]) => (
                        <button
                          type="button"
                          key={label}
                          aria-pressed={scene.ratio === ratio}
                          onClick={() => commit({ ...scene, ratio })}
                        >
                          <CollageRatioGlyph ratio={ratio} />
                          <span>{label}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-label={t('自定比例')}
                        title={t('自定比例')}
                        onClick={() =>
                          setCustomRatio({
                            width: String(geometry.width),
                            height: String(geometry.height),
                          })
                        }
                      >
                        <SlidersHorizontal size={19} />
                        <span>{t('自定')}</span>
                      </button>
                    </div>
                    <div className="collage-template-rail" role="group" aria-label={t('拼图模板')}>
                      {templates
                        .filter(({ min = 2 }) => scene.items.length >= min)
                        .map(({ id, label }) => {
                          const frame = collageGeometry({ ...scene, template: id }, 42);
                          return (
                            <button
                              type="button"
                              key={id}
                              aria-label={t(label)}
                              title={t(label)}
                              aria-pressed={scene.template === id}
                              onClick={() => commit({ ...scene, template: id })}
                            >
                              <svg viewBox={`0 0 ${frame.width} ${frame.height}`} aria-hidden="true">
                                <rect
                                  className="collage-template-frame"
                                  x={0}
                                  y={0}
                                  width={frame.width}
                                  height={frame.height}
                                  rx={1.5}
                                />
                                {frame.cells.map(({ x, y, width, height }, i) => (
                                  <rect
                                    key={i}
                                    x={x + 0.5}
                                    y={y + 0.5}
                                    width={Math.max(0, width - 1)}
                                    height={Math.max(0, height - 1)}
                                    rx={0.65}
                                  />
                                ))}
                              </svg>
                            </button>
                          );
                        })}
                    </div>
                  </>
                )}
                <MotionDetails className="collage-tile-settings">
                  <summary>
                    <SlidersHorizontal size={16} /> {t('拼图素材')} <CaretDown size={12} />
                  </summary>
                  <div className="collage-item-rail" role="group" aria-label={t('拼图素材')}>
                    {scene.items.map((item, index) => {
                      const entry = resources.current.get(item.id);
                      return (
                        <button
                          type="button"
                          key={item.id}
                          aria-pressed={selected.id === item.id}
                          title={entry?.name}
                          onClick={() => {
                            setSelectedId(item.id);
                            setMoveSubject(false);
                            updateAudio(sound, item.id);
                          }}
                        >
                          {entry?.kind === 'photo' ? <ImageSquare size={16} /> : <Play size={16} />}
                          {index + 1} <span>{entry?.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="collage-actions">
                    <IconButton
                      label={t('替换素材')}
                      onClick={() => {
                        replacementTarget.current = selected.id;
                        replacementInput.current?.click();
                      }}
                    >
                      <ArrowsClockwise size={17} />
                    </IconButton>
                    <IconButton
                      label={t('向前移动素材')}
                      disabled={selectedIndex <= 0}
                      onClick={() => reorder(-1)}
                    >
                      <ArrowLeft size={17} />
                    </IconButton>
                    <IconButton
                      label={t('向后移动素材')}
                      disabled={selectedIndex >= scene.items.length - 1}
                      onClick={() => reorder(1)}
                    >
                      <ArrowRight size={17} />
                    </IconButton>
                    <IconButton
                      label={t('移除素材')}
                      onClick={() => {
                        stopPlayback();
                        commit({
                          ...history.present,
                          items: history.present.items.filter((item) => item.id !== selected.id),
                        });
                      }}
                    >
                      <Trash size={17} />
                    </IconButton>
                    <button type="button" className="text-button" onClick={beginMask}>
                      <Scissors size={16} /> {t('手动抠图')}
                    </button>
                    <button type="button" className="text-button" onClick={() => void autoPerson()}>
                      {t('人像抠图')}
                    </button>
                  </div>
                  {selected.subject && (
                    <div className="collage-actions">
                      <button
                        type="button"
                        className="text-button"
                        aria-pressed={moveSubject}
                        onClick={() => setMoveSubject(!moveSubject)}
                      >
                        {t('移动出圈主体')}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        aria-pressed={selected.subject.only}
                        onClick={() =>
                          updateSelected((item) => ({
                            ...item,
                            subject: { ...item.subject!, only: !item.subject!.only },
                          }))
                        }
                      >
                        {t('仅保留主体')}
                      </button>
                      <IconButton
                        label={t('前景置顶')}
                        disabled={scene.items.filter((item) => item.subject).length < 2}
                        onClick={() => moveForeground('up')}
                      >
                        <ArrowUp size={16} />
                      </IconButton>
                      <IconButton
                        label={t('前景置底')}
                        disabled={scene.items.filter((item) => item.subject).length < 2}
                        onClick={() => moveForeground('down')}
                      >
                        <ArrowDown size={16} />
                      </IconButton>
                      <IconButton
                        label={t('移除抠图')}
                        onClick={() => updateSelected((item) => ({ ...item, subject: undefined }))}
                      >
                        <X size={16} />
                      </IconButton>
                    </div>
                  )}
                  <div className="collage-actions">
                    <label>
                      {t('背景')}{' '}
                      <input
                        type="color"
                        value={scene.background === 'transparent' ? '#ffffff' : scene.background}
                        onChange={(event) =>
                          commit({ ...history.present, background: event.target.value })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      aria-pressed={scene.background === 'transparent'}
                      onClick={() =>
                        commit({
                          ...history.present,
                          background: scene.background === 'transparent' ? '#ffffff' : 'transparent',
                        })
                      }
                    >
                      {t('透明背景')}
                    </button>
                    <ChoiceSelect
                      size="compact"
                      ariaLabel={t('间距')}
                      value={String(scene.gap)}
                      options={[
                        { value: '0', label: '0' },
                        { value: '0.006', label: '1×' },
                        { value: '0.016', label: '2×' },
                        { value: '0.035', label: '4×' },
                      ]}
                      onValueChange={(gap) => commit({ ...history.present, gap: Number(gap) })}
                    />
                    {moving && (
                      <ChoiceSelect
                        size="compact"
                        ariaLabel={t('动态时长')}
                        value={seconds}
                        options={['3', '5', '8'].map((value) => ({ value, label: value + ' s' }))}
                        onValueChange={setSeconds}
                      />
                    )}
                  </div>
                  <ParameterShelf
                    key={selected.id + (editingSubject ? ':subject' : ':tile')}
                    label={t(editingSubject ? '主体' : '素材')}
                    onCommit={() => {
                      if (precisionDraft.current) commit(precisionDraft.current);
                    }}
                    onCancel={() => {
                      precisionDraft.current = null;
                      setDraft(null);
                    }}
                    controls={[
                      {
                        id: 'collage-scale',
                        glyph: 'diameter',
                        label: t(editingSubject ? '主体大小' : '素材缩放'),
                        value: (editingSubject?.scale ?? selected.zoom) * 100,
                        min: 25,
                        max: 400,
                        step: 0.1,
                        neutral: 100,
                        unit: '%',
                        onChange: (value) =>
                          adjustTile((item) =>
                            editingSubject && item.subject
                              ? { ...item, subject: { ...item.subject, scale: value / 100 } }
                              : { ...item, zoom: value / 100 },
                          ),
                      },
                      ...(editingSubject
                      ? [{
                          id: 'collage-feather',
                          glyph: 'feather' as const,
                          label: t('边缘羽化'),
                          value: editingSubject.feather ?? 0,
                          min: 0,
                          max: Math.min(32, Math.min(selected.width, selected.height) / 8),
                          step: 0.1,
                          neutral: 0,
                          unit: 'px',
                          onChange: (value: number) =>
                            adjustTile((item) => ({
                              ...item,
                              subject: { ...item.subject!, feather: value },
                            })),
                        }]
                      : []),
                    ...positionControls,
                    ]}
                  />
                </MotionDetails>
              </>
            )}
          </div>
        )}
      </aside>
      {active && customRatio && (
        <Modal title={t('自定比例')} onClose={() => setCustomRatio(null)}>
          <form
            className="collage-custom-ratio"
            onSubmit={(event) => {
              event.preventDefault();
              if (!customAspectValid) return;
              commit({ ...history.present, ratio: customAspect });
              setCustomRatio(null);
            }}
          >
            <label>
              {t('宽度')}
              <input
                required
                type="number"
                min="1"
                max="20000"
                value={customRatio.width}
                onChange={(event) =>
                  setCustomRatio({ ...customRatio, width: event.currentTarget.value })
                }
              />
            </label>
            <label>
              {t('高度')}
              <input
                required
                type="number"
                min="1"
                max="20000"
                value={customRatio.height}
                onChange={(event) =>
                  setCustomRatio({ ...customRatio, height: event.currentTarget.value })
                }
              />
            </label>
            <button className="button button-primary" disabled={!customAspectValid}>
              {t('应用')}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function CollageRatioGlyph({ ratio }: { ratio: number }) {
  const outlineWidth = Math.min(26, 20 * ratio);
  const outlineHeight = outlineWidth / ratio;
  return (
    <svg width="29" height="23" viewBox="0 0 29 23" aria-hidden="true">
      <rect
        x={(29 - outlineWidth) / 2}
        y={(23 - outlineHeight) / 2}
        width={outlineWidth}
        height={outlineHeight}
        rx="2.5"
      />
    </svg>
  );
}
