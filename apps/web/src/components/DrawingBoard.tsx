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
} from '@phosphor-icons/react';
import { downloadBlob, errorMessage } from '../lib/api';
import { Busy, IconButton, InlineError, Modal } from './Ui';
import { usePresence } from '../motion/usePresence';
import { ColorPicker } from './ColorPicker';
import { useConfirmation } from './ConfirmationDialog';
import { confirmStableScope } from '../lib/confirmation-scope';

type Point = { x: number; y: number };
type Stroke = { points: Point[]; color: string; width: number; erase: boolean };
const colors = ['#34372e', '#cd6155', '#d9a52d', '#658764', '#527b9b', '#9474a3'];

export function DrawingBoard({
  onClose,
  onUse,
  onReference,
  initialColor = '#34372EFF',
}: {
  onClose: () => void;
  onUse: (file: File) => Promise<boolean>;
  onReference: (file: File) => boolean | Promise<boolean>;
  initialColor?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawingArea = useRef<HTMLDivElement>(null);
  const strokeBase = useRef<HTMLCanvasElement | null>(null);
  const [areaSize, setAreaSize] = useState({ width: 600, height: 400 });
  const active = useRef<Stroke | null>(null);
  const pointer = useRef<number | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [cursor, setCursor] = useState(0);
  const [color, setColor] = useState(initialColor);
  const [showColor, setShowColor] = useState(false);
  const colorPresence = usePresence(showColor, 'color-picker');
  const [width, setWidth] = useState(5);
  const [erase, setErase] = useState(false);
  const [ratio, setRatio] = useState('square');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmation = useConfirmation();
  const mounted = useRef(false);
  const locked = useRef(false);
  const latest = useRef({ strokes, cursor, ratio, busy, onClose, onUse, onReference });
  latest.current = { strokes, cursor, ratio, busy, onClose, onUse, onReference };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const readDrawing = () => ({
    mounted: mounted.current,
    strokes: latest.current.strokes,
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
      !latest.current.cursor ||
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
      latest.current.cursor &&
      !(await confirmDrawing('切换画幅会按比例重新排布已有笔画，继续吗？', '切换画幅'))
    )
      return;
    if (mounted.current && !locked.current) setRatio(value);
  }
  async function clearDrawing() {
    if (await confirmDrawing('清空画布？已下载的草图不会改变。', '清空草图', true)) {
      setStrokes([]);
      setCursor(0);
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

  function paint(stroke: Stroke, context: CanvasRenderingContext2D) {
    const first = stroke.points[0];
    if (!first) return;
    context.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(first.x * context.canvas.width, first.y * context.canvas.height);
    if (stroke.points.length === 1) {
      context.arc(
        first.x * context.canvas.width,
        first.y * context.canvas.height,
        stroke.width / 2,
        0,
        Math.PI * 2,
      );
      context.fill();
    } else {
      for (const point of stroke.points.slice(1))
        context.lineTo(point.x * context.canvas.width, point.y * context.canvas.height);
      context.stroke();
    }
    context.globalCompositeOperation = 'source-over';
  }
  function redraw(includeActive = false) {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    for (const stroke of strokes.slice(0, cursor)) paint(stroke, context);
    if (includeActive && active.current) paint(active.current, context);
  }
  useEffect(() => {
    redraw();
  }, [strokes, cursor, ratio]);
  function position(event: PointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }
  function finish(event: PointerEvent<HTMLCanvasElement>, cancel = false) {
    if (pointer.current !== event.pointerId || !active.current) return;
    const stroke = active.current;
    active.current = null;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) {
      redraw();
      return;
    }
    const next = [...strokes.slice(0, cursor), stroke];
    setStrokes(next);
    setCursor(next.length);
  }
  async function getFile() {
    if (!canvas.current) throw new Error('草图画布暂不可用。');
    const output = document.createElement('canvas');
    output.width = canvas.current.width;
    output.height = canvas.current.height;
    const context = output.getContext('2d');
    if (!context) throw new Error('无法导出这张草图。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(canvas.current, 0, 0);
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
      latest.current.strokes === drawing.strokes &&
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
        title="草图"
        subtitle="先画构图，确认提交后才上传参考图。"
        onClose={onClose}
        canClose={canCloseDrawing}
        wide
        className="drawing-modal"
      >
        <div className="drawing-toolbar" data-motion="drawing-tools">
          <div className="drawing-tools">
            <IconButton
              label="铅笔"
              aria-pressed={!erase}
              className={!erase ? 'selected' : ''}
              onClick={() => setErase(false)}
            >
              <PencilSimple size={21} />
            </IconButton>
            <IconButton
              label="橡皮擦"
              aria-pressed={erase}
              className={erase ? 'selected' : ''}
              onClick={() => setErase(true)}
            >
              <Eraser size={21} />
            </IconButton>
            <span className="toolbar-separator" />
            <IconButton
              label="撤销草图笔画"
              disabled={busy || !cursor}
              onClick={() => setCursor((v) => v - 1)}
            >
              <ArrowCounterClockwise size={20} />
            </IconButton>
            <IconButton
              label="重做草图笔画"
              disabled={busy || cursor >= strokes.length}
              onClick={() => setCursor((v) => v + 1)}
            >
              <ArrowClockwise size={20} />
            </IconButton>
          </div>
          <ChoiceSelect
            ariaLabel="草图画幅"
            className="drawing-ratio"
            size="compact"
            value={ratio}
            disabled={busy}
            onValueChange={(value) => {
              void changeRatio(value);
            }}
            options={[
              { value: 'square', label: '1:1 方形' },
              { value: 'landscape', label: '3:2 横向' },
              { value: 'portrait', label: '2:3 竖向' },
            ]}
          />
          <IconButton
            label="清空草图"
            disabled={busy || !cursor}
            onClick={() => {
              void clearDrawing();
            }}
          >
            <Trash size={20} />
          </IconButton>
        </div>
        <div className="drawing-controls" data-motion="drawing-colors">
          <div className="drawing-colors" aria-label="快捷笔触颜色">
            {colors.map((value) => (
              <button
                key={value}
                style={{ '--swatch': value } as React.CSSProperties}
                aria-label={`颜色 ${value}`}
                aria-pressed={value === color.slice(0, 7) && !erase}
                className={value === color.slice(0, 7) && !erase ? 'selected' : ''}
                onClick={() => {
                  setColor(value);
                  setErase(false);
                }}
              />
            ))}
            <button
              className="full-palette-trigger"
              aria-expanded={showColor}
              aria-label="打开完整颜色选择器"
              onClick={() => setShowColor(!showColor)}
            >
              <span style={{ background: color }} />
              色谱
            </button>
          </div>
          <label className="drawing-width">
            {erase ? '橡皮' : '笔触'}
            <input
              type="range"
              min="1"
              max="70"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
            <span>{width}</span>
          </label>
          {colorPresence.present && (
            <div
              className="drawing-color-popover"
              data-motion="color-picker"
              data-motion-state={colorPresence.phase}
              inert={!showColor}
              aria-hidden={!showColor}
            >
              <div className="popover-heading">
                <strong>完整颜色</strong>
                <button className="text-button" onClick={() => setShowColor(false)}>
                  完成
                </button>
              </div>
              <ColorPicker
                value={color}
                onChange={(value) => {
                  setColor(value);
                  setErase(false);
                }}
                label="笔触颜色"
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
            aria-label="草图画布，使用鼠标、手指或触控笔绘画"
            onPointerDown={(event) => {
              if (busy || locked.current || pointer.current !== null || event.button !== 0) return;
              if (
                cursor >= 300 ||
                strokes.slice(0, cursor).reduce((sum, stroke) => sum + stroke.points.length, 0) >=
                  50000
              ) {
                setError('这张草图已达到本地笔画预算，请先下载或放入编辑器，再开始新草图。');
                return;
              }
              event.preventDefault();
              const base = strokeBase.current ?? document.createElement('canvas');
              base.width = event.currentTarget.width;
              base.height = event.currentTarget.height;
              base.getContext('2d')?.drawImage(event.currentTarget, 0, 0);
              strokeBase.current = base;
              pointer.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              active.current = { points: [position(event)], color, width, erase };
              redraw(true);
            }}
            onPointerMove={(event) => {
              if (pointer.current !== event.pointerId || !active.current) return;
              if (active.current.points.length >= 4000) {
                finish(event);
                return;
              }
              const point = position(event);
              const previous = active.current.points.at(-1)!;
              if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0008) return;
              active.current.points.push(point);
              const context = canvas.current?.getContext('2d');
              if (context && strokeBase.current) {
                context.clearRect(0, 0, context.canvas.width, context.canvas.height);
                context.drawImage(strokeBase.current, 0, 0);
                paint(active.current, context);
              }
            }}
            onPointerUp={(event) => finish(event)}
            onPointerCancel={(event) => finish(event, true)}
            onLostPointerCapture={(event) => finish(event, true)}
          />
        </div>
        <div className="drawing-meta">
          <span>
            {dimensions[0]} × {dimensions[1]} · 白底 PNG
          </span>
          <span>{cursor} 条笔画 · 支持鼠标与触控</span>
        </div>
        <InlineError message={error} />
        <div className="drawing-actions">
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => void useDrawing('download')}
          >
            <DownloadSimple size={17} />
            下载草图
          </button>
          <button
            className="button button-secondary"
            disabled={busy || !cursor}
            onClick={() => void useDrawing('local')}
          >
            <ImageSquare size={17} />
            放进编辑器
          </button>
          <button
            className="button button-primary"
            disabled={busy || !cursor}
            onClick={() => void useDrawing('reference')}
          >
            {busy ? (
              <Busy />
            ) : (
              <>
                <Sparkle size={17} />
                作为生图参考
              </>
            )}
          </button>
        </div>
      </Modal>
      {confirmation.dialog}
    </>
  );
}
