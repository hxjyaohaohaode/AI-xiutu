import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { MediaDescriptorV1, MediaGradeRevision, MediaPrecisionInput } from '@ai-xiutu/media';
import {
  NEUTRAL_PRECISION_EDIT,
  PRECISION_EDIT_CONTROLS,
  type PrecisionEdit,
} from '@ai-xiutu/editor';
import { Minus, Plus, ArrowsOutSimple, DownloadSimple } from '@phosphor-icons/react';
import { api, errorMessage, jsonRequest, ApiError } from '../lib/api';
import { InlineError, IconButton } from '../components/Ui';
import { PrecisionRange } from '../editor/PrecisionRange';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { nativePreviewWindow, visibleTiles, zoomAround, type TileView } from './tile-layout';
import { useMasterPreview } from './useMasterPreview';
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
    precisionEditing?: {
      algorithm: string;
      master16: boolean;
      floatAvailable: boolean;
      sourceSha256: string;
      maxPixels: number;
      maxLinearPixels?: number;
      previewMaxEdge?: number;
      canSave?: boolean;
      currentGrade?: MediaGradeRevision | null;
    };
  };
}
type PrecisionFormat = 'png16' | 'tiff16' | 'exr32';
export function MediaSourceViewer({ assetId }: { assetId: string }) {
  const [record, setRecord] = useState<MediaRecord | null>(null),
    [error, setError] = useState<string | null>(null),
    [exporting, setExporting] = useState(false);
  const [size, setSize] = useState({ width: 400, height: 280 }),
    [view, setView] = useState<TileView>({ x: 0, y: 0, zoom: 1 });
  const [edit, setEdit] = useState<PrecisionEdit>({ ...NEUTRAL_PRECISION_EDIT });
  const [precisionInput, setPrecisionInput] = useState<MediaPrecisionInput>('master16');
  const [outputFormat, setOutputFormat] = useState<PrecisionFormat>('png16');
  const [grading, setGrading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gradeVersion, setGradeVersion] = useState(0);
  const [grades, setGrades] = useState<MediaGradeRevision[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [revisionChoice, setRevisionChoice] = useState('');
  const [loadingGrades, setLoadingGrades] = useState(false);
  const [conflict, setConflict] = useState(false);
  const exportRequest = useRef<AbortController | null>(null);
  const assetSession = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; view: TileView } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    assetSession.current = controller;
    setRecord(null);
    setError(null);
    setEdit({ ...NEUTRAL_PRECISION_EDIT });
    setOutputFormat('png16');
    setPrecisionInput('master16');
    setExporting(false);
    setGrading(false);
    setSaving(false);
    setGradeVersion(0);
    setGrades([]);
    setNextBefore(null);
    setRevisionChoice('');
    setLoadingGrades(false);
    setConflict(false);
    api<MediaRecord>(`/assets/${assetId}/media`, { signal: controller.signal })
      .then((record) => {
        if (controller.signal.aborted) return;
        setRecord(record);
        const precision = record.editor.precisionEditing;
        const saved = precision?.currentGrade;
        const input =
          saved?.precisionInput ?? (precision?.floatAvailable ? 'linear-master' : 'master16');
        setPrecisionInput(input);
        if (input === 'linear-master' && precision?.floatAvailable) setOutputFormat('exr32');
        if (saved) {
          setEdit(saved.edit);
          setGradeVersion(saved.version);
          setRevisionChoice(String(saved.version));
          setGrades([saved]);
        } else if (
          input === 'linear-master' &&
          record.descriptor.original.sampleEncoding !== 'sensor-raw'
        )
          setEdit({ ...NEUTRAL_PRECISION_EDIT, toneMap: 'reinhard' });
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(errorMessage(e));
      });
    return () => {
      controller.abort();
      exportRequest.current?.abort();
      exportRequest.current = null;
    };
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
  const precision = record?.editor.precisionEditing;
  const maxGradePixels =
    precisionInput === 'linear-master' ? precision?.maxLinearPixels : precision?.maxPixels;
  const canEdit = !!(
    precision?.master16 &&
    descriptor &&
    precision.algorithm === NEUTRAL_PRECISION_EDIT.algorithm &&
    (precisionInput === 'master16' || precision.floatAvailable) &&
    descriptor.master.width * descriptor.master.height <= (maxGradePixels ?? precision.maxPixels)
  );
  const maxEdge = precision?.previewMaxEdge;
  const region =
    descriptor && maxEdge ? nativePreviewWindow(descriptor.master, view, size, maxEdge) : undefined;
  const wantsGrade = grading && canEdit;
  const previewBody =
    precision?.master16 && maxEdge && (region || wantsGrade)
      ? JSON.stringify({
          expectedSourceSha256: precision.sourceSha256,
          precisionInput: wantsGrade ? precisionInput : 'master16',
          precisionEdit: wantsGrade ? edit : undefined,
          maxEdge: region ? maxEdge : Math.min(maxEdge, 1536),
          region,
        })
      : null;
  const preview = useMasterPreview(assetId, previewBody, !exporting);
  const previewRegion = preview.frame?.region ?? descriptor?.master;
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
  function loadRevision(revision: MediaGradeRevision) {
    setRevisionChoice(String(revision.version));
    setEdit(revision.edit);
    setPrecisionInput(revision.precisionInput);
    if (revision.precisionInput === 'master16') setOutputFormat('png16');
  }
  async function loadGrades(before?: number, reload = false) {
    const signal = assetSession.current?.signal;
    if (!signal || signal.aborted || loadingGrades) return;
    setLoadingGrades(true);
    try {
      const result = await api<{ grades: MediaGradeRevision[]; nextBeforeVersion: number | null }>(
        `/assets/${assetId}/media/grades${before ? `?beforeVersion=${before}` : ''}`,
        { signal },
      );
      if (signal.aborted) return;
      setGrades((current) => (before ? [...current, ...result.grades] : result.grades));
      setNextBefore(result.nextBeforeVersion);
      if (reload && result.grades[0]) {
        loadRevision(result.grades[0]);
        setGradeVersion(result.grades[0].version);
        setConflict(false);
        setError(null);
      }
    } catch (error) {
      if (!signal.aborted) setError(errorMessage(error));
    } finally {
      if (!signal.aborted) setLoadingGrades(false);
    }
  }
  async function saveGrade() {
    const signal = assetSession.current?.signal;
    if (!signal || signal.aborted || saving || !precision?.canSave || !canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const { grade } = await api<{ grade: MediaGradeRevision }>(
        `/assets/${assetId}/media/grades`,
        {
          ...jsonRequest('POST', {
            expectedVersion: gradeVersion,
            expectedSourceSha256: precision.sourceSha256,
            precisionInput,
            precisionEdit: edit,
          }),
          signal,
        },
      );
      if (signal.aborted) return;
      setGradeVersion(grade.version);
      setRevisionChoice(String(grade.version));
      setGrades((current) => [grade, ...current]);
      setConflict(false);
    } catch (error) {
      if (!signal.aborted) {
        setConflict(error instanceof ApiError && error.code === 'VERSION_CONFLICT');
        setError(errorMessage(error));
      }
    } finally {
      if (!signal.aborted) setSaving(false);
    }
  }
  async function exportMaster(format: PrecisionFormat, adjustment?: PrecisionEdit) {
    if (exportRequest.current || (adjustment && (!canEdit || !precision))) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setExporting(true);
    setError(null);
    try {
      const { downloadId } = await api<{ downloadId: string }>(`/assets/${assetId}/media/export`, {
        ...jsonRequest('POST', {
          format,
          delivery: 'attachment',
          ...(adjustment && precision
            ? {
                precisionEdit: adjustment,
                precisionInput,
                expectedSourceSha256: precision.sourceSha256,
              }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        const link = document.createElement('a');
        link.href = `/v1/assets/${assetId}/media/exports/${encodeURIComponent(downloadId)}`;
        link.download = '';
        link.referrerPolicy = 'no-referrer';
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (exportRequest.current === controller) {
        exportRequest.current = null;
        setExporting(false);
      }
    }
  }
  return (
    <section
      className="media-source"
      aria-label={t('原件与母版')}
      data-motion="media-detail"
      data-grading={grading ? 'true' : undefined}
    >
      <div className="media-zoom-tools">
        <strong>{t('原件细节')}</strong>
        <span>{(view.zoom * 100).toFixed(view.zoom < 0.1 ? 1 : 0)}%</span>
        <IconButton label={t('缩小源图')} onClick={() => zoomTo(view.zoom / 1.5)}>
          <Minus size={16} />
        </IconButton>
        <IconButton label={t('放大源图')} onClick={() => zoomTo(view.zoom * 1.5)}>
          <Plus size={16} />
        </IconButton>
        <button className="text-button" onClick={() => zoomTo(1)}>
          1:1
        </button>
        <IconButton label={t('源图适合窗口')} onClick={fit}>
          <ArrowsOutSimple size={16} />
        </IconButton>
      </div>
      <div
        className="media-tile-viewport"
        data-media-preview={
          preview.pending
            ? 'pending'
            : preview.failed
              ? 'failed'
              : preview.frame
                ? 'ready'
                : 'source'
        }
        ref={root}
        tabIndex={0}
        role="img"
        aria-label={t('分级源图预览，拖动移动，滚轮或按钮缩放')}
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
        {(!preview.frame || preview.frame.region) &&
          (tiles ? (
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
                  onError={() => setError(t('部分图块未能读取，请检查连接或项目权限。'))}
                />
              </div>
            ))
          ) : (
            <img
              className="media-fallback"
              src={`/v1/assets/${assetId}/file`}
              alt={t('编辑代理图')}
            />
          ))}
        {preview.frame && previewRegion && (
          <div
            className="media-tile media-precision-frame"
            data-native-window={preview.frame.region ? 'true' : undefined}
            style={{
              left: view.x + ('left' in previewRegion ? previewRegion.left : 0) * view.zoom,
              top: view.y + ('top' in previewRegion ? previewRegion.top : 0) * view.zoom,
              width: previewRegion.width * view.zoom,
              height: previewRegion.height * view.zoom,
            }}
          >
            <img draggable={false} alt="" src={preview.frame.url} />
          </div>
        )}
      </div>
      {(preview.pending || preview.failed) && (
        <small role="status">{t(preview.failed ? '母版预览未能更新' : '正在更新母版预览')}</small>
      )}
      {descriptor && (
        <>
          {canEdit ? (
            <details
              className="editor-section"
              open={grading}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setGrading(open);
                if (open && gradeVersion) void loadGrades();
              }}
            >
              <summary>{t('母版高位深调色')}</summary>
              {PRECISION_EDIT_CONTROLS.map(({ key, label, minimum, maximum, step, unit }) => (
                <PrecisionRange
                  key={key}
                  label={t(label)}
                  min={minimum}
                  max={maximum}
                  step={step}
                  value={edit[key]}
                  unit={unit}
                  disabled={exporting || saving}
                  onChange={(value) => {
                    setRevisionChoice('');
                    setEdit((current) => ({ ...current, [key]: value }));
                  }}
                />
              ))}
              <ChoiceSelect
                ariaLabel={t('高光色调映射')}
                value={edit.toneMap}
                disabled={exporting || saving}
                options={[
                  { value: 'none', label: t('保留线性高光') },
                  { value: 'reinhard', label: t('压缩高光 Reinhard') },
                ]}
                onValueChange={(value) => {
                  setRevisionChoice('');
                  setEdit((current) => ({
                    ...current,
                    toneMap: value === 'reinhard' ? value : 'none',
                  }));
                }}
              />
              <div className="media-downloads">
                <button
                  className="text-button"
                  disabled={exporting || saving}
                  onClick={() => {
                    setRevisionChoice('');
                    setEdit({
                      ...NEUTRAL_PRECISION_EDIT,
                      toneMap:
                        precisionInput === 'linear-master' &&
                        descriptor.original.sampleEncoding !== 'sensor-raw'
                          ? 'reinhard'
                          : 'none',
                    });
                  }}
                >
                  {t('重置')}
                </button>
                <ChoiceSelect
                  ariaLabel={t('母版输出格式')}
                  value={outputFormat}
                  disabled={exporting}
                  options={[
                    { value: 'png16', label: 'PNG 16-bit' },
                    { value: 'tiff16', label: 'TIFF 16-bit' },
                    ...(precisionInput === 'linear-master'
                      ? [{ value: 'exr32', label: 'EXR 32-bit HDR' }]
                      : []),
                  ]}
                  onValueChange={(value) => setOutputFormat(value as PrecisionFormat)}
                />
                <button
                  className="button button-secondary"
                  disabled={exporting}
                  onClick={() => void exportMaster(outputFormat, edit)}
                >
                  {exporting ? t('正在转换') : t('导出调色母版')}
                </button>
              </div>
              <div className="media-downloads">
                {grades.length > 0 && (
                  <ChoiceSelect
                    ariaLabel={t('母版调色版本')}
                    value={revisionChoice}
                    disabled={saving || exporting || loadingGrades}
                    options={[
                      { value: '', label: t('当前调色') },
                      ...grades.map(({ version }) => ({
                        value: String(version),
                        label: t('版本 {v0}', { v0: version }),
                      })),
                    ]}
                    onValueChange={(value) => {
                      const selected = grades.find((grade) => String(grade.version) === value);
                      if (selected) loadRevision(selected);
                    }}
                  />
                )}
                {nextBefore !== null && (
                  <button
                    className="text-button"
                    disabled={loadingGrades || saving}
                    onClick={() => void loadGrades(nextBefore)}
                  >
                    {t('加载较早版本')}
                  </button>
                )}
                {precision?.canSave && (
                  <button
                    className="button button-secondary"
                    disabled={
                      saving || exporting || conflict || revisionChoice === String(gradeVersion)
                    }
                    onClick={() => void saveGrade()}
                  >
                    {t(saving ? '正在保存' : '保存母版调色版本')}
                  </button>
                )}
                {conflict && (
                  <button
                    className="text-button"
                    disabled={loadingGrades}
                    onClick={() => void loadGrades(undefined, true)}
                  >
                    {t('载入最新调色版本')}
                  </button>
                )}
              </div>
            </details>
          ) : (
            precision?.master16 && (
              <p className="control-note">
                {t('母版调色上限 {v0} 百万像素', {
                  v0: ((maxGradePixels ?? precision.maxPixels) / 1e6).toFixed(1),
                })}
              </p>
            )
          )}
          <div className="media-downloads">
            <a className="text-button" href={record!.downloads.original}>
              <DownloadSimple size={16} />
              {t('原件')}
            </a>
            <a className="text-button" href={record!.downloads.master}>
              {t('16 位 TIFF 母版')}
            </a>
            {record!.downloads.linearMaster && (
              <a className="text-button" href={record!.downloads.linearMaster}>
                {t('32 位线性 EXR 母版')}
              </a>
            )}
            <button
              className="text-button"
              disabled={exporting}
              onClick={() => void exportMaster('png16')}
            >
              {exporting ? t('正在转换') : t('母版转 16 位 PNG')}
            </button>
          </div>
          <details className="editor-section media-information">
            <summary>{t('文件信息')}</summary>
            <dl className="media-facts">
              <div>
                <dt>{t('原件')}</dt>
                <dd>
                  {descriptor.original.width} × {descriptor.original.height} ·{' '}
                  {descriptor.original.bitDepth} {t('位 ·')}
                  {descriptor.original.colorSpace}
                </dd>
              </div>
              <div>
                <dt>{t('母版')}</dt>
                <dd>
                  {descriptor.master.bitDepth} {t('位')}
                  {descriptor.master.colorSpace} · TIFF
                </dd>
              </div>
              <div>
                <dt>{t('工作预览')}</dt>
                <dd>
                  {descriptor.proxy.width} × {descriptor.proxy.height} {t('· 8 位 sRGB')}
                </dd>
              </div>
              <div>
                <dt>{t('色彩档案')}</dt>
                <dd>
                  {descriptor.original.hasIcc === null
                    ? t('原件档案未解析，原编码已保留')
                    : descriptor.original.hasIcc
                      ? t('原件保留 ICC；母版转换至 sRGB')
                      : t('原件无嵌入 ICC，见转换说明')}
                </dd>
              </div>
            </dl>
            <p className="control-note">
              {t(
                '图块用于检查源图细节；这里下载的是原件或母版，不包含编辑器的代理图修改。HDR 原件保留，工作母版与图块采用 SDR。',
              )}
            </p>
            {descriptor.warnings.map((warning, i) => (
              <p className="control-note" key={i}>
                {t(warning)}
              </p>
            ))}
          </details>
        </>
      )}
      <InlineError message={error} />
    </section>
  );
}
