import { SketchTextEditor, type SketchTextHandle } from './SketchTextEditor';
import { loadSketchFont } from './sketch-typography';
import { t } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  PencilSimple,
  Eraser,
  Trash,
  DownloadSimple,
  Sparkle,
  ImageSquare,
  Cursor,
  TextT,
  FolderOpen,
  CopySimple,
  CaretUp,
  CaretDown,
} from './ControlGlyph';
import { downloadBlob, errorMessage } from '../lib/api';
import { Busy, IconButton, InlineError, Modal } from './Ui';
import { usePresence } from '../motion/usePresence';
import { ColorPicker } from './ColorPicker';
import { useConfirmation } from './ConfirmationDialog';
import { confirmStableScope } from '../lib/confirmation-scope';
import { loadSketchImage, SKETCH_IMAGE_INPUT } from './sketch-images';
import { SketchGlyph } from './SketchGlyph';
import {
  fitSketchText,
  moveSketchItem,
  paintSketchItem,
  resizeSketchItem,
  sketchBounds,
  sketchCorners,
  sketchItemAt,
  sketchResizeCorner,
  sketchTextRuns,
  type SketchCorner,
  type SketchItem,
  type SketchText,
  type SketchPoint,
  type SketchIcon,
  type SketchShape,
} from './sketch-document';

type Tool = 'pencil' | 'erase' | 'select' | 'text' | 'icon' | SketchShape;
const colors = ['#34372e', '#cd6155', '#d9a52d', '#658764', '#527b9b', '#9474a3'];
const filledShapes = new Set<Tool>(['rectangle', 'rounded', 'ellipse', 'triangle', 'diamond']);
const shapeTools = [
  ['rectangle', '矩形'],
  ['rounded', '圆角矩形'],
  ['ellipse', '椭圆'],
  ['triangle', '三角形'],
  ['diamond', '菱形'],
  ['line', '直线'],
  ['arrow', '箭头'],
] as const;
const symbolTools = [
  ['star', '星形'],
  ['heart', '爱心'],
  ['check', '对勾'],
  ['pin', '位置标记'],
  ['bolt', '闪电'],
  ['speech', '对话气泡'],
] as const;

function defaultShape(item: Extract<SketchItem, { kind: 'shape' }>, canvas: HTMLCanvasElement) {
  const width = Math.min(0.46, 96 / canvas.width);
  const height = Math.min(0.46, 76 / canvas.height);
  const x = Math.min(1 - width, Math.max(0, item.from.x - width / 2));
  const y = Math.min(1 - height, Math.max(0, item.from.y - height / 2));
  return { ...item, from: { x, y }, to: { x: x + width, y: y + height } };
}

export function DrawingBoard({
  onClose,
  onUse,
  onReference,
  initialColor = '#34372EFF',
  readCurrentImage,
  projectImages,
  readProjectImage,
}: {
  onClose: () => void;
  onUse: (file: File) => Promise<boolean>;
  onReference: (file: File) => boolean | Promise<boolean>;
  initialColor?: string;
  readCurrentImage?: () => Promise<File>;
  projectImages?: { id: string; name: string }[];
  readProjectImage?: (id: string) => Promise<File>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawingArea = useRef<HTMLDivElement>(null);
  const strokeBase = useRef<HTMLCanvasElement | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [areaSize, setAreaSize] = useState({ width: 1, height: 1 });
  const active = useRef<SketchItem | null>(null);
  const moving = useRef<{
    index: number;
    start: SketchPoint;
    original: SketchItem;
    item: SketchItem;
    corner?: SketchCorner;
  } | null>(null);
  const pointer = useRef<number | null>(null);
  const [history, setHistory] = useState<SketchItem[][]>([[]]);
  const [cursor, setCursor] = useState(0);
  const items = history[cursor]!;
  const [color, setColor] = useState(initialColor);
  const [showColor, setShowColor] = useState(false);
  const colorPresence = usePresence(showColor, 'color-picker');
  const [width, setWidth] = useState(5);
  const [tool, setTool] = useState<Tool>('pencil');
  const [selection, setSelection] = useState<number | null>(null);
  const [textEdit, setTextEdit] = useState<{ item: SketchText; index: number | null } | null>(null);
  const textField = useRef<SketchTextHandle>(null);
  const [symbol, setSymbol] = useState<SketchIcon>('star');
  const [filled, setFilled] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const erase = tool === 'erase';
  const selected = selection === null ? null : items[selection];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmation = useConfirmation();
  const mounted = useRef(false);
  const locked = useRef(false);
  const latest = useRef({
    items,
    history,
    cursor,
    transparent,
    busy,
    onClose,
    onUse,
    onReference,
  });
  latest.current = {
    items,
    history,
    cursor,
    transparent,
    busy,
    onClose,
    onUse,
    onReference,
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const readDrawing = () => ({
    mounted: mounted.current,
    items: latest.current.items,
    cursor: latest.current.cursor,
    transparent: latest.current.transparent,
    busy: latest.current.busy,
    locked: locked.current,
    pointer: pointer.current,
  });
  async function confirmDrawing(description: string, confirmLabel: string, danger = false) {
    if (!mounted.current || locked.current || latest.current.busy || pointer.current !== null)
      return false;
    const outcome = await confirmStableScope(readDrawing, () =>
      confirmation.confirm({
        description,
        confirmLabel,
        tone: danger ? 'danger' : 'default',
      }),
    );
    if (outcome === 'changed' && mounted.current)
      setError('草图状态已经变化，请检查当前内容后重试。');
    return outcome === 'confirmed';
  }
  async function canCloseDrawing() {
    if (!mounted.current || locked.current || latest.current.busy || pointer.current !== null)
      return false;
    return (
      (!latest.current.items.length && !textField.current?.read().text.trim()) ||
      (await confirmDrawing(
        '草图还在当前绘画窗口中。确认已下载或不再需要后，再关闭吗？',
        '关闭草图',
        true,
      ))
    );
  }
  async function clearDrawing() {
    if (await confirmDrawing('清空画布？已下载的草图不会改变。', '清空草图', true)) {
      setTextEdit(null);
      commitItems([]);
      setSelection(null);
    }
  }
  useLayoutEffect(() => {
    const area = drawingArea.current;
    if (!area) return;
    let frame = 0;
    const update = () => {
      const width = area.clientWidth;
      const height = area.clientHeight;
      if (!width || !height) return;
      setAreaSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(area);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  function commitItems(next: SketchItem[]) {
    if (pointer.current !== null) return;
    const previous = latest.current;
    const states = [...previous.history.slice(0, previous.cursor + 1), next].slice(-80);
    latest.current = { ...previous, items: next, history: states, cursor: states.length - 1 };
    setHistory(states);
    setCursor(states.length - 1);
  }
  function redraw() {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    latest.current.items.forEach((item, i) =>
      textEdit?.index !== i && paintSketchItem(moving.current?.index === i ? moving.current.item : item, context),
    );
    if (active.current && !moving.current) paintSketchItem(active.current, context);
    const item = moving.current?.item ?? (tool === 'select' ? selected : null);
    if (!item || active.current) return;
    const box = sketchBounds(context, item);
    context.save();
    context.strokeStyle = '#447bc9';
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.setLineDash([]);
    context.fillStyle = '#fff';
    for (const corner of sketchCorners) {
      const x = box.x + corner.x * box.width - 4;
      const y = box.y + corner.y * box.height - 4;
      context.fillRect(x, y, 8, 8);
      context.strokeRect(x, y, 8, 8);
    }
    context.restore();
  }
  useLayoutEffect(() => {
    redraw();
    // The canvas needs repainting when a newly selected webfont finishes loading.
    document.fonts.addEventListener('loadingdone', redraw);
    return () => document.fonts.removeEventListener('loadingdone', redraw);
  }, [items, areaSize, selection, tool, textEdit]);
  function position(
    event: Pick<PointerEvent, 'clientX' | 'clientY'>,
    bounds: DOMRect,
  ): SketchPoint {
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }
  function patchSelected(item: SketchItem) {
    if (selection === null || locked.current || pointer.current !== null) return;
    commitItems(items.map((existing, i) => (i === selection ? item : existing)));
  }
  function selectItem(index: number, item: SketchItem) {
    setSelection(index);
    if ('color' in item) setColor(item.color);
    setTool('select');
  }
  function stepHistory(offset: -1 | 1) {
    if (locked.current || pointer.current !== null) return;
    setTextEdit(null);
    setSelection(null);
    setCursor((value) => Math.min(history.length - 1, Math.max(0, value + offset)));
  }
  function deleteSelection() {
    if (selection === null || locked.current || pointer.current !== null) return;
    commitItems(items.filter((_, i) => i !== selection));
    setSelection(null);
  }
  async function insertImage(read: () => File | Promise<File>, at = { x: 0.25, y: 0.25 }) {
    const previous = latest.current.items;
    if (locked.current || pointer.current !== null || previous.length >= 300) return;
    const used = new Set(
      latest.current.history.flatMap((state) =>
        state.flatMap((item) => (item.kind === 'image' ? [item.image] : [])),
      ),
    );
    if (used.size >= 12) {
      setError(t('草图已达到图片预算。'));
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const file = await read();
      const image = await loadSketchImage(file);
      if (!mounted.current || latest.current.items !== previous) return;
      commitItems([...previous, { kind: 'image', at, image, size: 0.5, name: file.name }]);
      setSelection(previous.length);
      setTool('select');
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function reorder(offset: number) {
    if (selection === null || locked.current || pointer.current !== null) return;
    const next = selection + offset;
    if (next < 0 || next >= items.length) return;
    const result = [...items];
    [result[selection], result[next]] = [result[next]!, result[selection]!];
    commitItems(result);
    setSelection(next);
  }
  function finish(event: PointerEvent<HTMLCanvasElement>, cancel = false) {
    if (pointer.current !== event.pointerId) return;
    const item = active.current;
    const move = moving.current;
    active.current = null;
    moving.current = null;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel || (!item && !move)) {
      redraw();
      return;
    }
    const previous = latest.current.items;
    if (move) {
      if (move.item !== previous[move.index])
        commitItems(previous.map((value, i) => (i === move.index ? move.item : value)));
    } else if (item?.kind === 'shape') {
      const target = event.currentTarget;
      item.to = position(event, target.getBoundingClientRect());
      const distance = Math.hypot(
        (item.to.x - item.from.x) * target.width,
        (item.to.y - item.from.y) * target.height,
      );
      const shape = distance < 4 ? defaultShape(item, target) : item;
      commitItems([...previous, shape]);
      selectItem(previous.length, shape);
    } else if (item) commitItems([...previous, item]);
    redraw();
  }
  function finishText() {
    if (!textEdit) return;
    const item = textField.current?.read();
    setTextEdit(null);
    if (!item?.text.trim()) return;
    const previous = latest.current.items;
    const context = canvas.current?.getContext('2d');
    const fitted = context ? fitSketchText(context, item) : item;
    const index = textEdit.index ?? previous.length;
    const next = textEdit.index === null
      ? [...previous, fitted]
      : previous.map((value, position) => position === index ? fitted : value);
    commitItems(next);
    selectItem(index, fitted);
  }
  async function getFile(drawing: typeof latest.current) {
    if (!canvas.current) throw new Error('草图画布暂不可用。');
    const { width, height } = canvas.current;
    await Promise.all(drawing.items.flatMap((item) => item.kind === 'text'
      ? sketchTextRuns(item).map(({ text, style }) => loadSketchFont(style.family, style.size, style.weight, style.italic, text))
      : []));
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d');
    if (!context) throw new Error('无法导出这张草图。');
    for (const item of drawing.items) paintSketchItem(item, context);
    if (!drawing.transparent) {
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#fff';
      context.fillRect(0, 0, output.width, output.height);
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('草图导出失败。'))),
        'image/png',
      ),
    );
    output.width = 1;
    output.height = 1;
    return new File([blob], `草图-${new Date().toISOString().slice(0, 10)}.png`, {
      type: 'image/png',
    });
  }
  async function useDrawing(action: 'download' | 'local' | 'reference') {
    if (!mounted.current || locked.current || pointer.current !== null) return;
    finishText();
    locked.current = true;
    const drawing = latest.current;
    const isCurrent = () =>
      mounted.current &&
      latest.current.items === drawing.items &&
      latest.current.cursor === drawing.cursor &&
      latest.current.transparent === drawing.transparent;
    setBusy(true);
    setError(null);
    try {
      const file = await getFile(drawing);
      if (!isCurrent()) return;
      if (action === 'download') downloadBlob(file, file.name);
      else if (action === 'local') {
        if ((await latest.current.onUse(file)) && isCurrent()) latest.current.onClose();
      } else {
        if ((await latest.current.onReference(file)) && isCurrent()) latest.current.onClose();
      }
    } catch (e) {
      if (isCurrent()) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Modal
        title={t('草图')}
        hideTitle
        onClose={onClose}
        canClose={canCloseDrawing}
        wide
        className="drawing-modal"
      >
        <div className="drawing-tool-area">
          <div className="drawing-toolbar drawing-primary-toolbar" data-motion="drawing-tools">
            <div className="drawing-tools drawing-mode-tools">
              <IconButton
                label={t('铅笔')}
                aria-pressed={tool === 'pencil'}
                className={tool === 'pencil' ? 'selected' : ''}
                onClick={() => setTool('pencil')}
              >
                <PencilSimple size={21} />
              </IconButton>
              <IconButton
                label={t('橡皮擦')}
                aria-pressed={erase}
                className={erase ? 'selected' : ''}
                onClick={() => setTool('erase')}
              >
                <Eraser size={21} />
              </IconButton>
              <IconButton
                label={t('选择草图元素')}
                aria-pressed={tool === 'select'}
                className={tool === 'select' ? 'selected' : ''}
                onClick={() => setTool('select')}
              >
                <Cursor size={20} />
              </IconButton>
              <span className="toolbar-separator" />
              <IconButton
                label={t('撤销草图操作')}
                disabled={busy || !cursor}
                onClick={() => stepHistory(-1)}
              >
                <ArrowCounterClockwise size={20} />
              </IconButton>
              <IconButton
                label={t('重做草图操作')}
                disabled={busy || cursor >= history.length - 1}
                onClick={() => stepHistory(1)}
              >
                <ArrowClockwise size={20} />
              </IconButton>
            </div>
            <IconButton
              className="drawing-clear"
              label={t('清空草图')}
              disabled={busy || !items.length}
              onClick={() => {
                void clearDrawing();
              }}
            >
              <Trash size={20} />
            </IconButton>
          </div>
          <div className="drawing-toolbar drawing-element-toolbar">
            <div className="drawing-shape-rail" role="group" aria-label={t('草图添加元素')}>
              {shapeTools.map(([shape, label]) => (
                <IconButton
                  key={shape}
                  label={t(label)}
                  disabled={busy}
                  aria-pressed={tool === shape}
                  onClick={() => setTool(shape)}
                >
                  <SketchGlyph name={shape} />
                </IconButton>
              ))}
              <IconButton
                label={t('文字')}
                data-action="sketch-text"
                aria-pressed={tool === 'text'}
                disabled={busy}
                onClick={() => setTool('text')}
              >
                <TextT size={21} />
              </IconButton>
              <IconButton
                label={t('图标')}
                aria-pressed={tool === 'icon'}
                disabled={busy}
                onClick={() => setTool('icon')}
              >
                <SketchGlyph name="star" />
              </IconButton>
            </div>
            {!!projectImages?.length && readProjectImage && (
              <ChoiceSelect
                className="drawing-project-choice"
                ariaLabel={t('添加项目图片到草图')}
                size="compact"
                value=""
                disabled={busy}
                placeholder={t('项目图片')}
                options={projectImages.map(({ id, name }) => ({ value: id, label: name }))}
                onValueChange={(id) => void insertImage(() => readProjectImage(id))}
              />
            )}
            <div className="drawing-tools drawing-object-actions">
              <IconButton
                label={t('添加本地图片到草图')}
                disabled={busy}
                onClick={() => imageInput.current?.click()}
              >
                <FolderOpen size={20} />
              </IconButton>
              {readCurrentImage && (
                <button
                  className="text-button drawing-insert-current"
                  aria-label={t('添加当前画布')}
                  disabled={busy}
                  onClick={() => void insertImage(readCurrentImage)}
                >
                  <ImageSquare size={18} />
                  <span>{t('添加当前画布')}</span>
                </button>
              )}
              <input
                ref={imageInput}
                type="file"
                accept={SKETCH_IMAGE_INPUT}
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void insertImage(() => file);
                }}
              />
              {tool === 'select' && selected && (
                <>
                  <IconButton
                    label={t('复制草图元素')}
                    disabled={busy || items.length >= 300}
                    onClick={() => {
                      commitItems([...items, moveSketchItem(selected, { x: 0.025, y: 0.025 })]);
                      setSelection(items.length);
                    }}
                  >
                    <CopySimple size={18} />
                  </IconButton>
                  <IconButton
                    label={t('上移草图图层')}
                    disabled={busy || selection === items.length - 1}
                    onClick={() => reorder(1)}
                  >
                    <CaretUp size={18} />
                  </IconButton>
                  <IconButton
                    label={t('下移草图图层')}
                    disabled={busy || selection === 0}
                    onClick={() => reorder(-1)}
                  >
                    <CaretDown size={18} />
                  </IconButton>
                  <IconButton label={t('删除选中元素')} disabled={busy} onClick={deleteSelection}>
                    <Trash size={20} />
                  </IconButton>
                </>
              )}
            </div>
          </div>
          {tool === 'icon' && (
            <div className="drawing-shape-rail" role="group" aria-label={t('草图图标')}>
              {symbolTools.map(([icon, label]) => (
                <IconButton
                  key={icon}
                  label={t(label)}
                  aria-pressed={symbol === icon}
                  disabled={busy}
                  onClick={() => setSymbol(icon)}
                >
                  <SketchGlyph name={icon} />
                </IconButton>
              ))}
            </div>
          )}
          <div
            className="drawing-controls drawing-appearance-controls"
            data-motion="drawing-colors"
          >
            <div className="drawing-switches">
              <IconButton
                label={t('透明背景')}
                aria-pressed={transparent}
                disabled={busy}
                onClick={() => setTransparent(!transparent)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
                  <path d="M4 4h8v8H4zm8 8h8v8h-8z" fill="currentColor" stroke="none" />
                </svg>
              </IconButton>
              {(filledShapes.has(tool) ||
                (tool === 'select' &&
                  selected?.kind === 'shape' &&
                  filledShapes.has(selected.shape))) && (
                <IconButton
                  label={t('填充形状')}
                  aria-pressed={
                    tool === 'select' && selected?.kind === 'shape' ? selected.fill : filled
                  }
                  disabled={busy}
                  onClick={() => {
                    if (tool === 'select' && selected?.kind === 'shape')
                      patchSelected({ ...selected, fill: !selected.fill });
                    else setFilled(!filled);
                  }}
                >
                  <SketchGlyph name="fill" />
                </IconButton>
              )}
            </div>
            <div className="drawing-colors" aria-label={t('快捷笔触颜色')}>
              {colors.map((value) => (
                <button
                  key={value}
                  style={{ '--swatch': value } as React.CSSProperties}
                  aria-label={t('颜色 {v0}', { v0: value })}
                  aria-pressed={value === color.slice(0, 7) && !erase}
                  className={value === color.slice(0, 7) && !erase ? 'selected' : ''}
                  onClick={() => {
                    setColor(value);
                    if (erase) setTool('pencil');
                    if (tool === 'select' && selected && 'color' in selected)
                      patchSelected({ ...selected, color: value });
                  }}
                />
              ))}
              <button
                className="full-palette-trigger"
                aria-expanded={showColor}
                aria-label={t('打开完整颜色选择器')}
                onClick={() => setShowColor(!showColor)}
              >
                <span style={{ background: color }} />
                <span className="drawing-palette-label">{t('色谱')}</span>
                <CaretDown size={12} />
              </button>
            </div>
            {tool !== 'select' && (
              <label className="drawing-width drawing-brush-width" style={{ '--sketch-width-progress': (width / 70 * 100) + '%' } as React.CSSProperties}>
                {tool === 'text' || tool === 'icon' ? t('大小') : erase ? t('橡皮') : t('笔触')}
                <input
                  type="range"
                  aria-label={t(tool === 'text' || tool === 'icon' ? '大小' : '笔触粗细')}
                  min="1"
                  max="70"
                  value={width}
                  disabled={busy}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
                <span>{width}</span>
              </label>
            )}
            {tool === 'select' && selected && (
              <div className="drawing-tools drawing-selection-controls">
                <label className="drawing-width drawing-number-field">
                  {t('角度')}
                  <input
                    type="number"
                    aria-label={t('草图元素角度')}
                    min="-180"
                    max="180"
                    step="1"
                    key={`angle-${selection}-${selected.angle ?? 0}`}
                    defaultValue={selected.angle ?? 0}
                    onBlur={(event) => {
                      const n = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(n) && n !== (selected.angle ?? 0))
                        patchSelected({ ...selected, angle: Math.max(-180, Math.min(180, n)) });
                    }}
                  />
                </label>
                <label className="drawing-width drawing-number-field">
                  {t('透明度')}
                  <input
                    type="number"
                    aria-label={t('草图元素不透明度')}
                    min="0"
                    max="100"
                    step="1"
                    key={`opacity-${selection}-${selected.opacity ?? 1}`}
                    defaultValue={Math.round((selected.opacity ?? 1) * 100)}
                    onBlur={(event) => {
                      const n = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(n) && n / 100 !== (selected.opacity ?? 1))
                        patchSelected({ ...selected, opacity: Math.max(0, Math.min(1, n / 100)) });
                    }}
                  />
                </label>
                {selected.kind === 'image' && (
                  <label className="drawing-width drawing-image-size">
                    {t('大小')}
                    <input
                      aria-label={t('图片大小')}
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.01"
                      value={selected.size}
                      disabled={busy}
                      onChange={(event) =>
                        patchSelected({ ...selected, size: Number(event.currentTarget.value) })
                      }
                    />
                  </label>
                )}
              </div>
            )}
            {colorPresence.present && (
              <div
                className="drawing-color-popover"
                data-motion="color-picker"
                data-motion-state={colorPresence.phase}
                inert={!showColor}
                aria-hidden={!showColor}
              >
                <div className="popover-heading">
                  <strong>{t('完整颜色')}</strong>
                  <button className="text-button" onClick={() => setShowColor(false)}>
                    {t('完成')}
                  </button>
                </div>
                <ColorPicker
                  value={color}
                  onChange={(value) => {
                    setColor(value);
                    if (erase) setTool('pencil');
                    if (tool === 'select' && selected && 'color' in selected)
                      patchSelected({ ...selected, color: value });
                  }}
                  label={t('笔触颜色')}
                />
              </div>
            )}
          </div>
          <InlineError message={error} />
        </div>
        <div
          ref={drawingArea}
          className={`drawing-surface${transparent ? ' transparent-sketch' : ''}`}
        >
          <canvas
            ref={canvas}
            width={areaSize.width}
            height={areaSize.height}
            data-tool={tool}
            aria-label={t('草图画布，使用鼠标、手指或触控笔绘画')}
            tabIndex={0}
            onDoubleClick={(event) => {
              if (tool !== 'select' || busy || textEdit) return;
              const target = event.currentTarget;
              const context = target.getContext('2d');
              if (!context) return;
              const index = sketchItemAt(context, items, position(event, target.getBoundingClientRect()));
              const item = items[index];
              if (item?.kind === 'text') setTextEdit({ item, index });
            }}
            onKeyDown={(event) => {
              if (busy || pointer.current !== null) return;
              const key = event.key.toLowerCase();
              if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(key)) {
                event.preventDefault();
                event.stopPropagation();
                stepHistory(key === 'y' || event.shiftKey ? 1 : -1);
              } else if (selected && (event.key === 'Delete' || event.key === 'Backspace')) {
                event.preventDefault();
                deleteSelection();
              } else if (selected?.kind === 'text' && selection !== null && event.key === 'Enter') {
                event.preventDefault();
                setTextEdit({ item: selected, index: selection });
              } else if (selected && tool === 'select') {
                const direction = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                }[event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'];
                if (!direction) return;
                event.preventDefault();
                const step = event.shiftKey ? 10 : 1;
                patchSelected(
                  moveSketchItem(selected, {
                    x: (direction[0]! * step) / areaSize.width,
                    y: (direction[1]! * step) / areaSize.height,
                  }),
                );
              }
            }}
            onPaste={(event) => {
              const file = Array.from(event.clipboardData.files).find((item) =>
                item.type.startsWith('image/'),
              );
              if (!file) return;
              event.preventDefault();
              void insertImage(() => file);
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) event.preventDefault();
            }}
            onDrop={(event) => {
              const file = event.dataTransfer.files[0];
              if (!file) return;
              event.preventDefault();
              const point = position(event, event.currentTarget.getBoundingClientRect());
              void insertImage(() => file, {
                x: Math.max(0, Math.min(0.8, point.x)),
                y: Math.max(0, Math.min(0.8, point.y)),
              });
            }}
            onPointerDown={(event) => {
              if (busy || locked.current || pointer.current !== null || event.button !== 0) return;
              const target = event.currentTarget,
                context = target.getContext('2d');
              if (!context) return;
              target.focus({ preventScroll: true });
              const at = position(event, target.getBoundingClientRect());
              if (textEdit) { finishText(); return; }
              if (tool === 'select') {
                const corner = selected
                  ? sketchResizeCorner(
                      context,
                      selected,
                      at,
                      event.pointerType === 'touch' ? 18 : 11,
                    )
                  : undefined;
                const index =
                  corner && selection !== null ? selection : sketchItemAt(context, items, at);
                const item = items[index];
                if (!item) {
                  setSelection(null);
                  return;
                }
                selectItem(index, item);
                moving.current = { index, start: at, original: item, item, corner };
                pointer.current = event.pointerId;
                target.setPointerCapture(event.pointerId);
                event.preventDefault();
                return;
              }
              if (
                items.length >= 300 ||
                items.reduce(
                  (sum, item) => sum + (item.kind === 'stroke' ? item.points.length : 0),
                  0,
                ) >= 50000
              ) {
                setError(t('这张草图已达到本地笔画预算，请先下载或放入编辑器，再开始新草图。'));
                return;
              }
              event.preventDefault();
              if (tool === 'text') {
                const textAt = {
                  x: Math.min(at.x, 1 - 106 / target.width),
                  y: Math.min(at.y, 1 - 34 / target.height),
                };
                setTextEdit({ item: { kind: 'text', at: { x: Math.max(0, textAt.x), y: Math.max(0, textAt.y) },
                  text: '', color, size: Math.max(16, 12 + width * 2) }, index: null });
                setError(null);
                return;
              }
              if (tool === 'icon') {
                const item: SketchItem = { kind: 'icon', at, icon: symbol, color, size: 12 + width * 2 };
                commitItems([...items, item]);
                selectItem(items.length, item);
                return;
              }
              const base = strokeBase.current ?? document.createElement('canvas');
              base.width = target.width;
              base.height = target.height;
              base.getContext('2d')?.drawImage(target, 0, 0);
              strokeBase.current = base;
              pointer.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              active.current =
                tool === 'pencil' || tool === 'erase'
                  ? { kind: 'stroke', points: [at], color, width, erase }
                  : { kind: 'shape', shape: tool, from: at, to: at, color, width, fill: filled };
              paintSketchItem(active.current, context);
            }}
            onPointerMove={(event) => {
              if (pointer.current !== event.pointerId) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const move = moving.current,
                item = active.current;
              if (move) {
                const at = position(event, bounds);
                const offset = { x: at.x - move.start.x, y: at.y - move.start.y };
                const context = event.currentTarget.getContext('2d');
                move.item =
                  Math.hypot(offset.x, offset.y) < 0.0008
                    ? move.original
                    : move.corner && context
                      ? resizeSketchItem(context, move.original, move.corner, offset)
                      : moveSketchItem(move.original, offset);
                redraw();
                return;
              }
              if (!item) return;
              if (item.kind === 'shape') item.to = position(event, bounds);
              if (item.kind === 'stroke') {
                const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
                for (const sample of [...samples, event]) {
                  if (item.points.length >= 4000) {
                    finish(event);
                    return;
                  }
                  const point = position(sample, bounds),
                    previous = item.points.at(-1)!;
                  if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.0008)
                    item.points.push(point);
                }
              }
              const context = canvas.current?.getContext('2d');
              if (context && strokeBase.current) {
                context.clearRect(0, 0, context.canvas.width, context.canvas.height);
                context.drawImage(strokeBase.current, 0, 0);
                paintSketchItem(item, context);
              }
            }}
            onPointerUp={(event) => finish(event)}
            onPointerCancel={(event) => finish(event, true)}
            onLostPointerCapture={(event) => finish(event, true)}
          />
          {textEdit && <SketchTextEditor item={textEdit.item} ref={textField} onDone={finishText}
            onCancel={() => { setTextEdit(null); canvas.current?.focus({ preventScroll: true }); }} />}
        </div>
        <div className="drawing-actions">
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void useDrawing('download')}
          >
            <DownloadSimple size={17} />
            <span>{t('下载')}</span>
          </button>
          <button
            className="button button-secondary"
            disabled={busy || (!items.length && !textEdit)}
            onClick={() => void useDrawing('local')}
          >
            <ImageSquare size={17} />
            {t('放进编辑器')}
          </button>
          <button
            className="button button-primary"
            disabled={busy || (!items.length && !textEdit)}
            onClick={() => void useDrawing('reference')}
          >
            {busy ? (
              <Busy />
            ) : (
              <>
                <Sparkle size={17} />
                {t('发给 AI')}
              </>
            )}
          </button>
        </div>
      </Modal>
      {confirmation.dialog}
    </>
  );
}
