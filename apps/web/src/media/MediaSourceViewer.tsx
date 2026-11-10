import { useEffect, useRef, useState } from 'react';
import type { MediaDescriptorV1 } from '@ai-xiutu/media';
import { Minus, Plus, ArrowsOutSimple, DownloadSimple } from '@phosphor-icons/react';
import { api, errorMessage, jsonRequest, downloadBlob, ApiError } from '../lib/api';
import { InlineError, IconButton } from '../components/Ui';
import { visibleTiles, zoomAround, type TileView } from './tile-layout';
import './media.css';
export interface MediaRecord {
  descriptor: MediaDescriptorV1;
  downloads: {
    original: string;
    master: string;
    linearMaster?: string | null;
    tiles: string | null;
  };
  editor: {
    bitDepth: number;
    colorSpace: string;
    proxy: boolean;
    masterExportIncludesRecipe: boolean;
  };
}
export function MediaSourceViewer({ assetId }: { assetId: string }) {
  const [record, setRecord] = useState<MediaRecord | null>(null),
    [error, setError] = useState<string | null>(null),
    [exporting, setExporting] = useState(false);
  const [size, setSize] = useState({ width: 400, height: 280 }),
    [view, setView] = useState<TileView>({ x: 0, y: 0, zoom: 1 });
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; view: TileView } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRecord(null);
    setError(null);
    api<MediaRecord>(`/assets/${assetId}/media`, { signal: controller.signal })
      .then(setRecord)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [assetId]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  function fit() {
    if (!record) return;
    const image = record.descriptor.master;
    const zoom = Math.min(size.width / image.width, size.height / image.height);
    setView({
      zoom,
      x: (size.width - image.width * zoom) / 2,
      y: (size.height - image.height * zoom) / 2,
    });
  }
  useEffect(fit, [record, size]);
  const descriptor = record?.descriptor,
    tiles = descriptor?.tiles;
  const tileList =
    descriptor && tiles ? visibleTiles({ ...descriptor.master, ...tiles }, view, size) : [];
  useEffect(() => {
    const element = root.current;
    if (!element || !descriptor) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = element.getBoundingClientRect();
      const minimum =
        Math.min(size.width / descriptor.master.width, size.height / descriptor.master.height) / 2;
      setView((old) =>
        zoomAround(
          old,
          { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
          Math.max(
            minimum,
            Math.min(8, old.zoom * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002)),
          ),
        ),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [descriptor, size]);
  const zoomTo = (zoom: number) => {
    if (!descriptor) return;
    const min =
      Math.min(size.width / descriptor.master.width, size.height / descriptor.master.height) / 2;
    setView((old) =>
      zoomAround(old, { x: size.width / 2, y: size.height / 2 }, Math.max(min, Math.min(8, zoom))),
    );
  };
  async function exportMaster(format: 'png16' | 'tiff16' | 'jpeg' | 'webp') {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const response = await fetch(`/v1/assets/${assetId}/media/export`, {
        ...jsonRequest('POST', { format }),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new ApiError(
          data?.error?.code ?? 'EXPORT_FAILED',
          data?.error?.message ?? '转换未完成',
          response.status,
        );
      }
      const length = Number(response.headers.get('content-length') ?? 0);
      const budget = size.width < 600 ? 128 * 1024 ** 2 : 512 * 1024 ** 2;
      if (length > budget || !response.body) {
        await response.body?.cancel();
        throw new Error('转换结果超过本设备下载预算，请直接下载母版或原件。');
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array<ArrayBuffer>[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > budget) {
          await reader.cancel();
          throw new Error('转换结果超过本设备下载预算，请直接下载母版或原件。');
        }
        chunks.push(new Uint8Array(chunk.value));
      }
      downloadBlob(
        new Blob(chunks, {
          type: response.headers.get('content-type') ?? 'application/octet-stream',
        }),
        `${assetId}-master.${format === 'png16' ? 'png' : format === 'tiff16' ? 'tiff' : format}`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="media-source" aria-label="原件与母版" data-motion="media-detail">
      <div className="media-zoom-tools">
        <strong>原件细节</strong>
        <span>{(view.zoom * 100).toFixed(view.zoom < 0.1 ? 1 : 0)}%</span>
        <IconButton label="缩小源图" onClick={() => zoomTo(view.zoom / 1.5)}>
          <Minus size={16} />
        </IconButton>
        <IconButton label="放大源图" onClick={() => zoomTo(view.zoom * 1.5)}>
          <Plus size={16} />
        </IconButton>
        <button className="text-button" onClick={() => zoomTo(1)}>
          1:1
        </button>
        <IconButton label="源图适合窗口" onClick={fit}>
          <ArrowsOutSimple size={16} />
        </IconButton>
      </div>
      <div
        className="media-tile-viewport"
        ref={root}
        tabIndex={0}
        role="img"
        aria-label="分级源图预览，拖动移动，滚轮或按钮缩放"
        onKeyDown={(event) => {
          const steps: Record<string, [number, number]> = {
            ArrowLeft: [40, 0],
            ArrowRight: [-40, 0],
            ArrowUp: [0, 40],
            ArrowDown: [0, -40],
          };
          if (steps[event.key]) {
            event.preventDefault();
            const [x, y] = steps[event.key]!;
            setView((old) => ({ ...old, x: old.x + x, y: old.y + y }));
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, view };
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setView({
              ...drag.current.view,
              x: drag.current.view.x + event.clientX - drag.current.x,
              y: drag.current.view.y + event.clientY - drag.current.y,
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {tiles ? (
          tileList.map((tile) => (
            <div
              key={tile.key}
              className="media-tile"
              style={{ left: tile.left, top: tile.top, width: tile.width, height: tile.height }}
            >
              <img
                draggable={false}
                alt=""
                src={`/v1/assets/${assetId}/media/tiles_files/${tile.key}.${tiles.format}`}
                style={{
                  left: tile.imageLeft,
                  top: tile.imageTop,
                  width: tile.imageWidth,
                  height: tile.imageHeight,
                }}
                onError={() => setError('部分图块未能读取，请检查连接或项目权限。')}
              />
            </div>
          ))
        ) : (
          <img className="media-fallback" src={`/v1/assets/${assetId}/file`} alt="编辑代理图" />
        )}
      </div>
      {descriptor && (
        <>
          <dl className="media-facts">
            <div>
              <dt>原件</dt>
              <dd>
                {descriptor.original.width} × {descriptor.original.height} ·{' '}
                {descriptor.original.bitDepth} 位 · {descriptor.original.colorSpace}
              </dd>
            </div>
            <div>
              <dt>母版</dt>
              <dd>
                {descriptor.master.bitDepth} 位 {descriptor.master.colorSpace} · TIFF
              </dd>
            </div>
            <div>
              <dt>工作预览</dt>
              <dd>
                {descriptor.proxy.width} × {descriptor.proxy.height} · 8 位 sRGB
              </dd>
            </div>
            <div>
              <dt>色彩档案</dt>
              <dd>
                {descriptor.original.hasIcc === null
                  ? '原件档案未解析，原编码已保留'
                  : descriptor.original.hasIcc
                    ? '原件保留 ICC；母版转换至 sRGB'
                    : '原件无嵌入 ICC，见转换说明'}
              </dd>
            </div>
          </dl>
          <p className="control-note">
            图块用于检查源图细节；这里下载的是原件或母版，不包含编辑器的代理图修改。HDR
            原件保留，工作母版与图块采用 SDR。
          </p>
          {descriptor.warnings.map((warning, i) => (
            <p className="control-note" key={i}>
              {warning}
            </p>
          ))}
          <div className="media-downloads">
            <a className="text-button" href={record!.downloads.original}>
              <DownloadSimple size={16} />
              原件
            </a>
            <a className="text-button" href={record!.downloads.master}>
              16 位 TIFF 母版
            </a>
            {record!.downloads.linearMaster && (
              <a className="text-button" href={record!.downloads.linearMaster}>
                32 位线性 EXR 母版
              </a>
            )}
            <button
              className="text-button"
              disabled={exporting}
              onClick={() => void exportMaster('png16')}
            >
              {exporting ? '正在转换' : '母版转 16 位 PNG'}
            </button>
          </div>
        </>
      )}
      <InlineError message={error} />
    </section>
  );
}
