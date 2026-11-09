import { useEffect, useRef, useState, type DragEvent } from 'react';
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
} from '@phosphor-icons/react';
import {
  getOutputDimensions,
  mapOutputToSource,
  mapSourceToOutput,
  type RGBAImage,
} from '@ai-xiutu/editor';
import { Busy, IconButton, InlineError } from '../components/Ui';
import type { EditorState } from './useEditor';
import type { ToolGroup } from './ToolInspector';

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
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    pointer: number;
    x: number;
    y: number;
    start: typeof pan;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [editor.file]);
  useEffect(() => {
    if (!viewport.current) return;
    const element = viewport.current;
    const observer = new ResizeObserver(() => {
      setBounds({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setBounds({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);
  const prevent = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const source = editor.originalPreview;
  const mask = editor.recipe.local.mask;
  const image = comparing ? editor.originalPreview : editor.rendered;
  const center = source
    ? mapSourceToOutput({ x: mask.centerX, y: mask.centerY }, source, editor.recipe.geometry)
    : { x: 0.5, y: 0.5 };
  const edgeX = source
    ? mapSourceToOutput(
        { x: mask.centerX + mask.radiusX, y: mask.centerY },
        source,
        editor.recipe.geometry,
      )
    : { x: 0.7, y: 0.5 };
  const edgeY = source
    ? mapSourceToOutput(
        { x: mask.centerX, y: mask.centerY + mask.radiusY },
        source,
        editor.recipe.geometry,
      )
    : { x: 0.5, y: 0.7 };
  const rx = Math.max(Math.abs(edgeX.x - center.x), Math.abs(edgeY.x - center.x));
  const ry = Math.max(Math.abs(edgeX.y - center.y), Math.abs(edgeY.y - center.y));
  const output = editor.dimensions
    ? getOutputDimensions(editor.dimensions, editor.recipe.geometry)
    : null;
  const scale = image
    ? Math.min((bounds.width - 24) / image.width, (bounds.height - 24) / image.height)
    : 1;
  const display = image
    ? { width: Math.max(1, image.width * scale), height: Math.max(1, image.height * scale) }
    : { width: 1, height: 1 };
  useEffect(() => {
    if (zoom === 1) setPan({ x: 0, y: 0 });
  }, [zoom, bounds.width, bounds.height]);
  function fit() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

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
      <div className="canvas-file-info">
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
        <InlineError message={editor.error} />
      </div>
      <div
        className={`image-viewport ${group === 'local' ? 'placement-mode' : ''} ${zoom > 1 ? 'can-pan' : ''} ${sampling ? 'sampling' : ''}`}
        ref={viewport}
        onPointerDown={(event) => {
          if (zoom <= 1 || group === 'local' || sampling || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            start: pan,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const current = gesture.current;
          if (!current || current.pointer !== event.pointerId) return;
          const dx = event.clientX - current.x;
          const dy = event.clientY - current.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
          const maxX = Math.max(0, (display.width * zoom - bounds.width) / 2 + 20);
          const maxY = Math.max(0, (display.height * zoom - bounds.height) / 2 + 20);
          setPan({
            x: Math.max(-maxX, Math.min(maxX, current.start.x + dx)),
            y: Math.max(-maxY, Math.min(maxY, current.start.y + dy)),
          });
        }}
        onPointerUp={(event) => {
          if (gesture.current?.pointer === event.pointerId) {
            gesture.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
      >
        {!editor.file ? (
          <div className="import-state minimal-import">
            <span className="import-outline" aria-hidden>
              <Plus size={32} weight="light" />
            </span>
            <h1>打开图片，开始创作</h1>
            <p>画面在这里，工具按需出现。</p>
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
            <small>也可以直接拖入 · 导入不会自动上传</small>
          </div>
        ) : (
          <div
            className="image-frame"
            ref={frame}
            style={{
              width: display.width,
              height: display.height,
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
            onClick={(event) => {
              if (comparing || !source || !frame.current) return;
              const rect = frame.current.getBoundingClientRect();
              const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
              const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
              if (sampling && editor.rendered && onSample) {
                const index =
                  (Math.min(editor.rendered.height - 1, Math.floor(y * editor.rendered.height)) *
                    editor.rendered.width +
                    Math.min(editor.rendered.width - 1, Math.floor(x * editor.rendered.width))) *
                  4;
                onSample(
                  '#' +
                    Array.from(editor.rendered.data.subarray(index, index + 4), (value) =>
                      value.toString(16).padStart(2, '0'),
                    )
                      .join('')
                      .toUpperCase(),
                );
                return;
              }
              if (group !== 'local') return;
              const point = mapOutputToSource({ x, y }, source, editor.recipe.geometry);
              editor.commit(
                {
                  ...editor.recipe,
                  local: {
                    ...editor.recipe.local,
                    enabled: true,
                    mask: {
                      ...mask,
                      centerX: Math.max(0, Math.min(1, point.x)),
                      centerY: Math.max(0, Math.min(1, point.y)),
                    },
                  },
                },
                '定位局部选区',
              );
            }}
          >
            <PixelCanvas image={image} />
            {!comparing && group === 'local' && editor.recipe.local.enabled && (
              <svg
                className="mask-overlay"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
              >
                <ellipse
                  cx={center.x * 100}
                  cy={center.y * 100}
                  rx={rx * 100}
                  ry={ry * 100}
                  fill="#f2bf3815"
                  stroke="#f4c43d"
                  strokeWidth=".3"
                  strokeDasharray="1 1"
                />
                <circle
                  cx={center.x * 100}
                  cy={center.y * 100}
                  r=".7"
                  fill="#fff"
                  stroke="#282c24"
                  strokeWidth=".2"
                />
              </svg>
            )}
            {comparing && <span className="original-label">原图</span>}
          </div>
        )}
      </div>
      {editor.file && (
        <div className="canvas-view-controls">
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
            <span>按住看原图</span>
          </button>
          <span className="control-separator" />
          <IconButton
            label="缩小画面"
            disabled={zoom <= 0.5}
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
          >
            <MagnifyingGlassMinus size={18} />
          </IconButton>
          <button className="zoom-fit" onClick={fit} title="适合当前可用画布">
            {zoom === 1 ? '适应' : `${Math.round(zoom * 100)}%`}
          </button>
          <IconButton
            label="放大画面，放大后可拖动"
            disabled={zoom >= 4}
            onClick={() => setZoom(Math.min(4, zoom + 0.25))}
          >
            <MagnifyingGlassPlus size={18} />
          </IconButton>
          <IconButton label="完整显示整张图片" onClick={fit}>
            <CornersOut size={18} />
          </IconButton>
          {sampling ? (
            <span className="canvas-mode-label">
              <Eyedropper size={14} />
              点画面取色
            </span>
          ) : zoom > 1 ? (
            <span className="canvas-mode-label">
              <Hand size={14} />
              拖动画面
            </span>
          ) : null}
        </div>
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
