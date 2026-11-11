import { t } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
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
} from '@phosphor-icons/react';
import { downloadBlob, errorMessage } from '../lib/api';
import { Busy, IconButton, InlineError, Modal } from './Ui';
import { usePresence } from '../motion/usePresence';
import { ColorPicker } from './ColorPicker';
import { useConfirmation } from './ConfirmationDialog';
import { confirmStableScope } from '../lib/confirmation-scope';
import { decodeImageSource } from '../editor/imageSources';
import {
  moveSketchItem,
  paintSketchItem,
  sketchBounds,
  sketchItemAt,
  type SketchItem,
  type SketchPoint,
  type SketchIcon,
  type SketchShape,
} from './sketch-document';

type Tool = 'pencil' | 'erase' | 'select' | 'text' | 'icon' | SketchShape;
const colors = ['#34372e', '#cd6155', '#d9a52d', '#658764', '#527b9b', '#9474a3'];

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
  const [areaSize, setAreaSize] = useState({ width: 600, height: 400 });
  const active = useRef<SketchItem | null>(null);
  const moving = useRef<{ index: number; start: SketchPoint; item: SketchItem } | null>(null);
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
  const [textValue, setTextValue] = useState('');
  const [symbol, setSymbol] = useState<SketchIcon>('star');
  const [filled, setFilled] = useState(false);
  const erase = tool === 'erase';
  const selected = selection === null ? null : items[selection];
  const [ratio, setRatio] = useState('square');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmation = useConfirmation();
  const mounted = useRef(false);
  const locked = useRef(false);
  const latest = useRef({ items, history, cursor, ratio, busy, onClose, onUse, onReference });
  latest.current = { items, history, cursor, ratio, busy, onClose, onUse, onReference };
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
    ratio: latest.current.ratio,
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
      !latest.current.items.length ||
      (await confirmDrawing(
        '草图还在当前绘画窗口中。确认已下载或不再需要后，再关闭吗？',
        '关闭草图',
        true,
      ))
    );
  }
  async function changeRatio(value: string) {
    if (locked.current || latest.current.busy || pointer.current !== null) return;
    if (
      latest.current.items.length &&
      !(await confirmDrawing('切换画幅会按比例重新排布已有元素，继续吗？', '切换画幅'))
    )
      return;
    if (mounted.current && !locked.current) setRatio(value);
  }
  async function clearDrawing() {
    if (await confirmDrawing('清空画布？已下载的草图不会改变。', '清空草图', true)) {
      commitItems([]);
      setSelection(null);
    }
  }
  const dimensions =
    ratio === 'landscape' ? [1536, 1024] : ratio === 'portrait' ? [1024, 1536] : [1024, 1024];
  const fit = Math.max(
    0.01,
    Math.min((areaSize.width - 24) / dimensions[0]!, (areaSize.height - 24) / dimensions[1]!),
  );
  useEffect(() => {
    const area = drawingArea.current;
    if (!area) return;
    const update = () => setAreaSize({ width: area.clientWidth, height: area.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(area);
    update();
    return () => observer.disconnect();
  }, []);

  function commitItems(next: SketchItem[]) {
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
      paintSketchItem(moving.current?.index === i ? moving.current.item : item, context),
    );
    if (active.current && !moving.current) paintSketchItem(active.current, context);
    const item = moving.current?.item ?? (tool === 'select' ? selected : null);
    if (!item || active.current) return;
    const box = sketchBounds(context, item);
    context.save();
    context.strokeStyle = '#447bc9';
    context.lineWidth = 2 / fit;
    context.setLineDash([5 / fit, 4 / fit]);
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.restore();
  }
  useEffect(() => {
    redraw();
  }, [items, ratio, selection, tool, fit]);
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
  async function insertImage(read: () => File | Promise<File>) {
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
      const { preview, file } = await decodeImageSource(await read());
      if (!mounted.current || latest.current.items !== previous) return;
      const image = document.createElement('canvas');
      image.width = preview.width;
      image.height = preview.height;
      const context = image.getContext('2d');
      if (!context) throw new Error(t('无法打开草图素材'));
      context.putImageData(
        new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height),
        0,
        0,
      );
      commitItems([
        ...previous,
        { kind: 'image', at: { x: 0.25, y: 0.25 }, image, size: 0.5, name: file.name },
      ]);
      setSelection(previous.length);
      setTool('select');
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
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
    } else if (
      item &&
      (item.kind !== 'shape' ||
        Math.hypot(item.to.x - item.from.x, item.to.y - item.from.y) > 0.002)
    )
      commitItems([...previous, item]);
    redraw();
  }
  async function getFile() {
    if (!canvas.current) throw new Error('草图画布暂不可用。');
    const output = document.createElement('canvas');
    output.width = canvas.current.width;
    output.height = canvas.current.height;
    const context = output.getContext('2d');
    if (!context) throw new Error('无法导出这张草图。');
    for (const item of latest.current.items) paintSketchItem(item, context);
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, output.width, output.height);
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
    locked.current = true;
    const drawing = latest.current;
    const isCurrent = () =>
      mounted.current &&
      latest.current.items === drawing.items &&
      latest.current.cursor === drawing.cursor &&
      latest.current.ratio === drawing.ratio;
    setBusy(true);
    setError(null);
    try {
      const file = await getFile();
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
        onClose={onClose}
        canClose={canCloseDrawing}
        wide
        className="drawing-modal"
      >
        <div className="drawing-toolbar" data-motion="drawing-tools">
          <div className="drawing-tools">
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
              onClick={() => {
                setSelection(null);
                setCursor((v) => Math.max(0, v - 1));
              }}
            >
              <ArrowCounterClockwise size={20} />
            </IconButton>
            <IconButton
              label={t('重做草图操作')}
              disabled={busy || cursor >= history.length - 1}
              onClick={() => {
                setSelection(null);
                setCursor((v) => Math.min(history.length - 1, v + 1));
              }}
            >
              <ArrowClockwise size={20} />
            </IconButton>
          </div>
          <ChoiceSelect
            ariaLabel={t('草图画幅')}
            className="drawing-ratio"
            size="compact"
            value={ratio}
            disabled={busy}
            onValueChange={(value) => {
              void changeRatio(value);
            }}
            options={[
              { value: 'square', label: t('1:1 方形') },
              { value: 'landscape', label: t('3:2 横向') },
              { value: 'portrait', label: t('2:3 竖向') },
            ]}
          />
          <IconButton
            label={t('清空草图')}
            disabled={busy || !items.length}
            onClick={() => {
              void clearDrawing();
            }}
          >
            <Trash size={20} />
          </IconButton>
        </div>
        <div className="drawing-toolbar">
          <ChoiceSelect
            ariaLabel={t('草图添加元素')}
            size="compact"
            value={tool}
            disabled={busy}
            onValueChange={(value) => setTool(value as Tool)}
            options={[
              { value: 'pencil', label: t('铅笔') },
              { value: 'erase', label: t('橡皮擦') },
              { value: 'select', label: t('选择草图元素') },
              { value: 'rectangle', label: t('矩形') },
              { value: 'ellipse', label: t('椭圆') },
              { value: 'line', label: t('直线') },
              { value: 'arrow', label: t('箭头') },
              { value: 'text', label: t('文字') },
              { value: 'icon', label: t('图标') },
            ]}
          />
          {!!projectImages?.length && readProjectImage && (
            <ChoiceSelect
              ariaLabel={t('添加项目图片到草图')}
              size="compact"
              value=""
              disabled={busy}
              placeholder={t('项目图片')}
              options={projectImages.map(({ id, name }) => ({ value: id, label: name }))}
              onValueChange={(id) => void insertImage(() => readProjectImage(id))}
            />
          )}
          <div className="drawing-tools">
            <IconButton
              label={t('添加本地图片到草图')}
              disabled={busy}
              onClick={() => imageInput.current?.click()}
            >
              <ImageSquare size={20} />
            </IconButton>
            {readCurrentImage && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void insertImage(readCurrentImage)}
              >
                {t('添加当前画布')}
              </button>
            )}
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void insertImage(() => file);
              }}
            />
            {tool === 'select' && selected && (
              <IconButton
                label={t('删除选中元素')}
                disabled={busy}
                onClick={() => {
                  commitItems(items.filter((_, i) => i !== selection));
                  setSelection(null);
                }}
              >
                <Trash size={20} />
              </IconButton>
            )}
          </div>
        </div>
        {(tool === 'text' || (tool === 'select' && selected?.kind === 'text')) && (
          <div className="drawing-controls">
            <TextT size={20} />
            <textarea
              aria-label={t('草图文字')}
              rows={1}
              maxLength={160}
              value={textValue}
              placeholder={t('输入文字')}
              disabled={busy}
              onChange={(event) => setTextValue(event.currentTarget.value)}
            />
            {tool === 'select' && selected?.kind === 'text' && (
              <button
                className="text-button"
                disabled={busy || !textValue.trim() || textValue.trim() === selected.text}
                onClick={() => patchSelected({ ...selected, text: textValue.trim() })}
              >
                {t('更新文字')}
              </button>
            )}
          </div>
        )}
        {tool === 'icon' && (
          <ChoiceSelect
            ariaLabel={t('草图图标')}
            size="compact"
            value={symbol}
            onValueChange={(value) => setSymbol(value as SketchIcon)}
            options={[
              { value: 'star', label: t('星形') },
              { value: 'heart', label: t('爱心') },
              { value: 'check', label: t('对勾') },
            ]}
          />
        )}
        {(tool === 'rectangle' || tool === 'ellipse') && (
          <label className="drawing-width">
            <input
              type="checkbox"
              checked={filled}
              onChange={(event) => setFilled(event.currentTarget.checked)}
            />
            {t('填充形状')}
          </label>
        )}
        <div className="drawing-controls" data-motion="drawing-colors">
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
              {t('色谱')}
            </button>
          </div>
          {tool !== 'select' && (
            <label className="drawing-width">
              {tool === 'text' || tool === 'icon' ? t('大小') : erase ? t('橡皮') : t('笔触')}
              <input
                type="range"
                min="1"
                max="70"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
              <span>{width}</span>
            </label>
          )}
          {tool === 'select' && selected?.kind === 'image' && (
            <label className="drawing-width">
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
                }}
                label={t('笔触颜色')}
              />
            </div>
          )}
        </div>
        <div ref={drawingArea} className={`drawing-surface ${ratio}`}>
          <canvas
            ref={canvas}
            width={dimensions[0]}
            height={dimensions[1]}
            style={{ width: dimensions[0]! * fit, height: dimensions[1]! * fit }}
            aria-label={t('草图画布，使用鼠标、手指或触控笔绘画')}
            onPointerDown={(event) => {
              if (busy || locked.current || pointer.current !== null || event.button !== 0) return;
              const target = event.currentTarget,
                context = target.getContext('2d');
              if (!context) return;
              const at = position(event, target.getBoundingClientRect());
              if (tool === 'select') {
                const index = sketchItemAt(context, items, at);
                const item = items[index];
                setSelection(item ? index : null);
                if (!item) return;
                if (item.kind === 'text') setTextValue(item.text);
                moving.current = { index, start: at, item };
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
              if (tool === 'text' || tool === 'icon') {
                const text = textValue.trim();
                if (tool === 'text' && !text) {
                  setError(t('请输入草图文字'));
                  return;
                }
                const size = 12 + width * 2;
                commitItems([
                  ...items,
                  tool === 'text'
                    ? { kind: 'text', at, text, color, size }
                    : { kind: 'icon', at, icon: symbol, color, size },
                ]);
                setError(null);
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
                move.item =
                  Math.hypot(offset.x, offset.y) < 0.0008
                    ? items[move.index]!
                    : moveSketchItem(items[move.index]!, offset);
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
        </div>
        <div className="drawing-meta">
          <span>
            {dimensions[0]} × {dimensions[1]} {t('· 白底 PNG')}
          </span>
          <span>{t('{v0} 个元素', { v0: items.length })}</span>
        </div>
        <InlineError message={error} />
        <div className="drawing-actions">
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void useDrawing('download')}
          >
            <DownloadSimple size={17} />
            {t('下载草图')}
          </button>
          <button
            className="button button-secondary"
            disabled={busy || !items.length}
            onClick={() => void useDrawing('local')}
          >
            <ImageSquare size={17} />
            {t('放进编辑器')}
          </button>
          <button
            className="button button-primary"
            disabled={busy || !items.length}
            onClick={() => void useDrawing('reference')}
          >
            {busy ? (
              <Busy />
            ) : (
              <>
                <Sparkle size={17} />
                {t('作为生图参考')}
              </>
            )}
          </button>
        </div>
      </Modal>
      {confirmation.dialog}
    </>
  );
}
