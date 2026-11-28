import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ChartLine,
  Image,
  Plus,
  SquaresFour,
  TextT,
} from '@phosphor-icons/react';
import {
  documentFonts,
  slideSize,
  writePresentation,
  type OfficeChartSnapshot,
  type PresentationDoc,
  type PresentationSlide,
  type SlideElement,
} from '@ai-xiutu/contracts';
import type { Asset, ProjectDocument } from '../lib/types';
import { api, errorMessage } from '../lib/api';
import { t, useLocale } from '../i18n';
import {
  chartDataUrl,
  officeDataTable,
  snapshotSvg,
  snapshotTable,
  type DataTable,
} from '@ai-xiutu/contracts/office-data';
import { blankSlide, fitBox, newBox, snapBox } from './presentation-model';

const ChartDesigner = lazy(() => import('./ChartDesigner').then((m) => ({ default: m.ChartDesigner })));
import './presentation-editor.css';

const percent = (value: number, extent: number) => String((100 * value) / extent) + '%';
const position = (item: SlideElement): CSSProperties => ({
  left: percent(item.x, slideSize.width),
  top: percent(item.y, slideSize.height),
  width: percent(item.width, slideSize.width),
  height: percent(item.height, slideSize.height),
});

function elementName(element: SlideElement) {
  if (element.kind === 'text') return element.text.slice(0, 80) || t('文字');
  if (element.kind === 'image') return element.alt;
  if (element.kind === 'chart') return element.chart.title;
  return t(element.shape === 'ellipse' ? '椭圆' : '矩形');
}

function SlideContent({ element }: { element: SlideElement }) {
  const image = useMemo(() => {
    if (element.kind !== 'chart') return null;
    try {
      return chartDataUrl(snapshotSvg(element.chart));
    } catch {
      return null;
    }
  }, [element]);
  const rotation = { transform: 'rotate(' + element.rotation + 'deg)' };
  if (element.kind === 'chart')
    return image ? (
      <img draggable={false} src={image} alt={element.chart.title} style={rotation} />
    ) : (
      <span role="status">{t('图表数据不可用')}</span>
    );
  if (element.kind === 'image')
    return (
      <img
        draggable={false}
        src={'/v1/assets/' + element.assetId + '/file'}
        alt={element.alt}
        style={rotation}
      />
    );
  if (element.kind === 'shape')
    return (
      <span
        className="slide-shape"
        style={{
          ...rotation,
          backgroundColor: element.color,
          borderRadius: element.shape === 'ellipse' ? '50%' : 0,
        }}
      />
    );
  return (
    <span
      className="slide-text"
      style={{
        ...rotation,
        color: element.color,
        fontFamily: element.font,
        fontWeight: element.bold ? 700 : 400,
        fontSize: percent(element.size, 960).replace('%', 'cqw'),
        textAlign: element.align,
      }}
    >
      {element.text}
    </span>
  );
}

export function PresentationPreview({ document }: { document: PresentationDoc }) {
  const [page, setPage] = useState(0);
  const slide = document.slides[Math.min(page, document.slides.length - 1)]!;
  return (
    <section className="presentation-preview" aria-label={t('演示预览')}>
      <div className="slide-canvas" style={{ backgroundColor: slide.background }}>
        {slide.elements.map((element) => (
          <div className="slide-object" key={element.id} style={position(element)}>
            <SlideContent element={element} />
          </div>
        ))}
      </div>
      {document.slides.length > 1 && (
        <select
          aria-label={t('幻灯片')}
          value={page}
          onChange={(e) => setPage(e.target.selectedIndex)}
        >
          {document.slides.map((item, i) => (
            <option key={item.id} value={i}>
              {item.name || t('幻灯片') + ' ' + (i + 1)}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}

type Gesture = {
  pointer: number;
  item: SlideElement;
  x: number;
  y: number;
  scale: number;
  type: 'move' | 'resize';
};
type Preview = { element: SlideElement; x?: number; y?: number };
export function PresentationEditor({
  document,
  projectId,
  sources,
  readOnly,
  onChange,
}: {
  document: PresentationDoc;
  projectId: string;
  sources: ProjectDocument[];
  readOnly: boolean;
  onChange: (value: string) => boolean;
}) {
  useLocale();
  const [pageId, setPageId] = useState(document.slides[0]!.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [insert, setInsert] = useState<'image' | 'chart' | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState('');
  const [sourceId, setSourceId] = useState('');
  // Chart designer: insert from a data document, or edit the selected chart element.
  const [designer, setDesigner] = useState<
    | { mode: 'insert'; table: DataTable; source: ProjectDocument }
    | { mode: 'edit'; elementId: string; chart: OfficeChartSnapshot }
    | null
  >(null);
  const [error, setError] = useState('');
  const [resourceLoading, setResourceLoading] = useState(false);
  const binding = useRef<Gesture | null>(null),
    lastPointer = useRef<Preview | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const undoStack = useRef<PresentationDoc[]>([]),
    redoStack = useRef<PresentationDoc[]>([]);
  const slide = document.slides.find((item) => item.id === pageId) ?? document.slides[0]!;
  const selected = slide.elements.find((item) => item.id === selectedId);

  useEffect(() => {
    if (insert !== 'image') return;
    const controller = new AbortController();
    setResourceLoading(true);
    api<{ assets: Asset[] }>('/projects/' + projectId, { signal: controller.signal })
      .then(({ assets }) => {
        if (!controller.signal.aborted) setAssets(assets);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setResourceLoading(false);
      });
    return () => controller.abort();
  }, [projectId, insert]);
  useEffect(() => {
    window.addEventListener('blur', cancelGesture);
    return () => window.removeEventListener('blur', cancelGesture);
  }, []);

  function store(next: PresentationDoc) {
    const body = writePresentation(next);
    if (!body || !onChange(body)) {
      setError(t('演示内容超过保存范围。'));
      return false;
    }
    setError('');
    return true;
  }
  function commit(next: PresentationDoc) {
    if (readOnly || !store(next)) return false;
    undoStack.current = [...undoStack.current.slice(-31), document];
    redoStack.current = [];
    return true;
  }
  function stepHistory(direction: 'undo' | 'redo') {
    const stack = direction === 'undo' ? undoStack.current : redoStack.current;
    const target = direction === 'undo' ? redoStack.current : undoStack.current;
    const next = stack.at(-1);
    if (readOnly || !next || !store(next)) return;
    stack.pop();
    target.push(document);
    setSelectedId(null);
  }
  function updateSlide(value: PresentationSlide) {
    return commit({
      version: 1,
      slides: document.slides.map((item) => (item.id === slide.id ? value : item)),
    });
  }
  function setElement(element: SlideElement) {
    updateSlide({
      ...slide,
      elements: slide.elements.map((item) => (item.id === element.id ? fitBox(element) : item)),
    });
  }
  function addElement(element: SlideElement) {
    if (updateSlide({ ...slide, elements: [...slide.elements, element] })) {
      setSelectedId(element.id);
      setInsert(null);
    }
  }
  function addPage(copy = false) {
    const next = blankSlide(t('幻灯片') + ' ' + (document.slides.length + 1));
    if (copy) {
      next.background = slide.background;
      next.elements = slide.elements.map((item) => ({ ...item, id: crypto.randomUUID() }));
    }
    const slides = [...document.slides];
    slides.splice(slides.indexOf(slide) + 1, 0, next);
    if (commit({ version: 1, slides })) {
      setPageId(next.id);
      setSelectedId(null);
    }
  }
  function removePage() {
    if (document.slides.length === 1) return;
    const index = document.slides.indexOf(slide);
    const slides = document.slides.filter((item) => item.id !== slide.id);
    if (commit({ version: 1, slides })) {
      setPageId(slides[Math.max(0, index - 1)]!.id);
      setSelectedId(null);
    }
  }
  function movePage(direction: number) {
    const slides = [...document.slides],
      i = slides.indexOf(slide),
      j = i + direction;
    if (!slides[j]) return;
    [slides[i], slides[j]] = [slides[j]!, slides[i]!];
    commit({ version: 1, slides });
  }
  function removeElement(id: string) {
    if (updateSlide({ ...slide, elements: slide.elements.filter((item) => item.id !== id) }))
      setSelectedId(null);
  }
  function moveElement(direction: number) {
    const elements = [...slide.elements],
      i = elements.findIndex((item) => item.id === selectedId),
      j = i + direction;
    if (i < 0 || !elements[j]) return;
    [elements[i], elements[j]] = [elements[j]!, elements[i]!];
    updateSlide({ ...slide, elements });
  }
  function startGesture(
    event: PointerEvent<HTMLButtonElement>,
    item: SlideElement,
    type: Gesture['type'],
  ) {
    if (event.button !== 0 || binding.current) return;
    setSelectedId(item.id);
    if (readOnly || !stage.current) return;
    const width = stage.current.getBoundingClientRect().width;
    if (!width) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    binding.current = {
      pointer: event.pointerId,
      item,
      x: event.clientX,
      y: event.clientY,
      scale: slideSize.width / width,
      type,
    };
  }
  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const state = binding.current;
    if (!state || event.pointerId !== state.pointer) return;
    const dx = (event.clientX - state.x) * state.scale,
      dy = (event.clientY - state.y) * state.scale;
    if (!lastPointer.current && Math.hypot(dx, dy) < 3 * state.scale) return;
    const item = state.item;
    const next =
      state.type === 'move'
        ? snapBox(
            fitBox({ ...item, x: item.x + dx, y: item.y + dy }),
            slide.elements,
            6 * state.scale,
          )
        : {
            element: fitBox({
              ...item,
              width: Math.min(item.width + dx, slideSize.width - item.x),
              height: Math.min(item.height + dy, slideSize.height - item.y),
            }),
          };
    lastPointer.current = next;
    setPreview(next);
  }
  function cancelGesture() {
    binding.current = null;
    lastPointer.current = null;
    setPreview(null);
  }
  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== binding.current?.pointer) return;
    const end = lastPointer.current;
    cancelGesture();
    if (end) setElement(end.element);
  }
  function press(event: KeyboardEvent<HTMLButtonElement>, element: SlideElement) {
    if (event.key === 'Escape') {
      cancelGesture();
      setSelectedId(null);
      return;
    }
    if (readOnly) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeElement(element.id);
      return;
    }
    const axes = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    } as const;
    const arrow = axes[event.key as keyof typeof axes];
    if (arrow) {
      event.preventDefault();
      const n = event.shiftKey ? 10 : 1;
      setSelectedId(element.id);
      setElement({ ...element, x: element.x + arrow[0] * n, y: element.y + arrow[1] * n });
    }
  }
  function insertSelected() {
    if (insert === 'image') {
      const asset = assets.find((item) => item.id === assetId);
      if (!asset) return;
      addElement({ ...newBox(620, 410), kind: 'image', assetId, alt: asset.name.slice(0, 250) });
    } else {
      const source = sources.find((item) => item.id === sourceId);
      if (!source) return;
      const table = officeDataTable(source.body);
      if (!table) {
        setError(t('请选择包含一张数据表的文档或工作表。'));
        return;
      }
      setDesigner({ mode: 'insert', table, source });
    }
  }

  return (
    <section className="presentation-editor" aria-label={t('演示编辑器')}>
      {!readOnly && (
        <div className="office-toolbar" role="group" aria-label={t('演示排版工具')}>
          <button type="button" onClick={() => addPage()}>
            <Plus size={17} />
            {t('添加幻灯片')}
          </button>
          <button
            type="button"
            onClick={() =>
              addElement({
                ...newBox(580, 120),
                kind: 'text',
                text: t('文字'),
                color: '#253C37',
                font: documentFonts[0],
                size: 32,
                bold: false,
                align: 'left',
              })
            }
          >
            <TextT size={17} />
            {t('插入文字')}
          </button>
          <button
            type="button"
            onClick={() =>
              addElement({
                ...newBox(360, 220),
                kind: 'shape',
                shape: 'rectangle',
                color: '#438E83',
              })
            }
          >
            <SquaresFour size={17} />
            {t('插入形状')}
          </button>
          <button
            type="button"
            aria-expanded={insert === 'image'}
            onClick={() => setInsert(insert === 'image' ? null : 'image')}
          >
            <Image size={17} />
            {t('项目图片')}
          </button>
          <button
            type="button"
            aria-expanded={insert === 'chart'}
            onClick={() => setInsert(insert === 'chart' ? null : 'chart')}
          >
            <ChartLine size={17} />
            {t('插入图表')}
          </button>
          <button
            type="button"
            aria-label={t('撤销')}
            onClick={() => stepHistory('undo')}
            disabled={!undoStack.current.length}
          >
            <ArrowCounterClockwise size={17} />
          </button>
          <button
            type="button"
            aria-label={t('重做')}
            onClick={() => stepHistory('redo')}
            disabled={!redoStack.current.length}
          >
            <ArrowClockwise size={17} />
          </button>
          {slide.elements.length > 0 && (
            <select
              className="slide-layers"
              aria-label={t('画布图层')}
              value={selected?.id ?? ''}
              onChange={(event) => setSelectedId(event.target.value || null)}
            >
              <option value="">{t('画布图层')}</option>
              {slide.elements
                .map((item, index) => (
                  <option key={item.id} value={item.id}>
                    {index + 1} · {elementName(item).replace(/\s+/g, ' ')}
                  </option>
                ))
                .reverse()}
            </select>
          )}
        </div>
      )}
      {insert && !readOnly && (
        <div className="slide-insert">
          {insert === 'image' ? (
            <select
              aria-label={t('选择项目图片')}
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
            >
              <option value="">{t(resourceLoading ? '读取中' : '选择项目图片')}</option>
              {assets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <select
                aria-label={t('选择数据文档')}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">{t('选择数据文档')}</option>
                {sources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </>
          )}
          <button
            className="button button-secondary"
            type="button"
            disabled={insert === 'image' ? !assetId : !sourceId}
            onClick={insertSelected}
          >
            {t(insert === 'chart' ? '设计图表' : '插入')}
          </button>
        </div>
      )}
      <div className="slide-workspace">
        <nav className="slide-page-strip" aria-label={t('幻灯片列表')}>
          {document.slides.map((item, i) => (
            <button
              type="button"
              key={item.id}
              aria-current={slide.id === item.id ? 'page' : undefined}
              onClick={() => {
                cancelGesture();
                setPageId(item.id);
                setSelectedId(null);
              }}
            >
              <span>{i + 1}</span>
              {item.name || t('幻灯片')}
            </button>
          ))}
        </nav>
        <div
          className="slide-canvas"
          ref={stage}
          aria-label={t('幻灯片画布')}
          style={{ backgroundColor: slide.background }}
          onPointerDown={(e) => {
            if (e.target === stage.current) setSelectedId(null);
          }}
          onPointerMove={movePointer}
          onPointerUp={finishPointer}
          onPointerCancel={cancelGesture}
          onLostPointerCapture={cancelGesture}
        >
          {slide.elements.map((original) => {
            const element = preview?.element.id === original.id ? preview.element : original;
            const active = selectedId === element.id;
            const name = elementName(element);
            return (
              <div
                key={element.id}
                className="slide-object"
                style={position(element)}
                data-selected={active}
              >
                <button
                  type="button"
                  className="slide-select-object"
                  aria-label={name}
                  aria-pressed={active}
                  onClick={() => setSelectedId(element.id)}
                  onKeyDown={(event) => press(event, element)}
                  onPointerDown={(event) => startGesture(event, original, 'move')}
                >
                  <SlideContent element={element} />
                </button>
                {active && !readOnly && (
                  <button
                    type="button"
                    className="slide-resize"
                    aria-label={t('拖动调整大小')}
                    onPointerDown={(event) => startGesture(event, original, 'resize')}
                  />
                )}
              </div>
            );
          })}
          {preview?.x !== undefined && (
            <div
              className="slide-guide vertical"
              style={{ left: percent(preview.x, slideSize.width) }}
            />
          )}
          {preview?.y !== undefined && (
            <div
              className="slide-guide horizontal"
              style={{ top: percent(preview.y, slideSize.height) }}
            />
          )}
        </div>
      </div>
      {!readOnly &&
        (selected ? (
          <div className="slide-inspector">
            {selected.kind === 'text' && (
              <>
                <label className="slide-object-text">
                  {t('文字')}
                  <textarea
                    aria-label={t('幻灯片文字')}
                    value={selected.text}
                    rows={2}
                    maxLength={5000}
                    onChange={(e) => setElement({ ...selected, text: e.target.value })}
                  />
                </label>
                <label>
                  {t('字体')}
                  <select
                    value={selected.font}
                    onChange={(e) =>
                      setElement({ ...selected, font: documentFonts[e.target.selectedIndex]! })
                    }
                  >
                    {documentFonts.map((font) => (
                      <option key={font}>{font}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('字号')}
                  <input
                    type="number"
                    min={8}
                    max={106}
                    value={selected.size}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber;
                      if (n >= 8 && n <= 106) setElement({ ...selected, size: Math.round(n) });
                    }}
                  />
                </label>
                <label>
                  {t('粗体')}
                  <input
                    type="checkbox"
                    checked={selected.bold}
                    onChange={(e) => setElement({ ...selected, bold: e.target.checked })}
                  />
                </label>
                <label>
                  {t('对齐')}
                  <select
                    value={selected.align}
                    onChange={(e) =>
                      setElement({
                        ...selected,
                        align: (['left', 'center', 'right'] as const)[e.target.selectedIndex]!,
                      })
                    }
                  >
                    <option value="left">{t('左对齐')}</option>
                    <option value="center">{t('居中对齐')}</option>
                    <option value="right">{t('右对齐')}</option>
                  </select>
                </label>
              </>
            )}
            {selected.kind === 'shape' && (
              <label>
                {t('形状')}
                <select
                  value={selected.shape}
                  onChange={(e) =>
                    setElement({
                      ...selected,
                      shape: e.target.selectedIndex ? 'ellipse' : 'rectangle',
                    })
                  }
                >
                  <option value="rectangle">{t('矩形')}</option>
                  <option value="ellipse">{t('椭圆')}</option>
                </select>
              </label>
            )}
            {selected.kind === 'chart' && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setDesigner({ mode: 'edit', elementId: selected.id, chart: selected.chart })}
              >
                {t('编辑图表')}
              </button>
            )}
            {(selected.kind === 'text' || selected.kind === 'shape') && (
              <label>
                {t('颜色')}
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => setElement({ ...selected, color: e.target.value })}
                />
              </label>
            )}
            {(
              [
                ['x', 'X'],
                ['y', 'Y'],
                ['width', '宽度'],
                ['height', '高度'],
                ['rotation', '旋转'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {t(label)}
                <input
                  aria-label={t(label)}
                  type="number"
                  value={selected[key]}
                  onChange={(e) => {
                    if (Number.isFinite(e.target.valueAsNumber))
                      setElement({ ...selected, [key]: e.target.valueAsNumber });
                  }}
                />
              </label>
            ))}
            <button type="button" className="text-button" onClick={() => moveElement(1)}>
              {t('上移一层')}
            </button>
            <button type="button" className="text-button" onClick={() => moveElement(-1)}>
              {t('下移一层')}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                addElement(
                  fitBox({
                    ...selected,
                    id: crypto.randomUUID(),
                    x: selected.x + 24,
                    y: selected.y + 24,
                  }),
                )
              }
            >
              {t('复制元素')}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => removeElement(selected.id)}
            >
              {t('删除元素')}
            </button>
          </div>
        ) : (
          <div className="slide-inspector">
            <label>
              {t('页面名称')}
              <input
                maxLength={120}
                value={slide.name}
                onChange={(e) => updateSlide({ ...slide, name: e.target.value })}
              />
            </label>
            <label>
              {t('页面背景')}
              <input
                type="color"
                value={slide.background}
                onChange={(e) => updateSlide({ ...slide, background: e.target.value })}
              />
            </label>
            <button type="button" className="text-button" onClick={() => addPage(true)}>
              {t('复制当前页')}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={document.slides[0] === slide}
              onClick={() => movePage(-1)}
            >
              {t('前移当前页')}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={document.slides.at(-1) === slide}
              onClick={() => movePage(1)}
            >
              {t('后移当前页')}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={document.slides.length === 1}
              onClick={removePage}
            >
              {t('删除当前页')}
            </button>
          </div>
        ))}
      {error && <p role="alert">{error}</p>}
      {designer && (
        <Suspense fallback={null}>
          <ChartDesigner
            table={designer.mode === 'insert' ? designer.table : snapshotTable(designer.chart)}
            initial={
              designer.mode === 'insert'
                ? { title: designer.source.title.slice(0, 120) || t('图表'), kind: 'bar' }
                : designer.chart
            }
            source={
              designer.mode === 'insert'
                ? { documentId: designer.source.id, version: designer.source.version }
                : designer.chart.source
            }
            confirmLabel={designer.mode === 'insert' ? '插入到幻灯片' : '保存图表'}
            onCancel={() => setDesigner(null)}
            onConfirm={(chart) => {
              if (designer.mode === 'insert') addElement({ ...newBox(850, 478), kind: 'chart', chart });
              else {
                const element = slide.elements.find((item) => item.id === designer.elementId);
                if (element?.kind === 'chart') setElement({ ...element, chart });
              }
              setDesigner(null);
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
