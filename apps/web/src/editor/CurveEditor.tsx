import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash, ArrowCounterClockwise, BezierCurve } from '@phosphor-icons/react';
import {
  compileCurveFunction,
  smoothCurveSegments,
  withCurve,
  type CurvePoint,
  type Curves,
  type EditorRecipe,
  type CurveChannel,
  type CurveInterpolation,
} from '@ai-xiutu/editor';
import type { EditorState } from './useEditor';
import { IconButton } from '../components/Ui';
import { PrecisionRange } from './PrecisionRange';
import { sharedHistogram } from './histogram-cache';

type Channel = CurveChannel;
type CurveCapture = Pick<
  SVGSVGElement,
  'setPointerCapture' | 'hasPointerCapture' | 'releasePointerCapture'
>;
type CurveGestureContext = {
  sourceIdentity: number;
  channel: Channel;
  recipe: EditorRecipe;
  preview: (recipe: EditorRecipe) => void;
  commit: () => void;
  scopeKey?: string;
  getCurves?: (recipe: EditorRecipe) => Curves;
};
type CurveGesture = {
  pointerId: number;
  index: number;
  sourceIdentity: number;
  channel: Channel;
  base: EditorRecipe;
  lastPreview: EditorRecipe;
  capture: CurveCapture;
  scopeKey?: string;
};
export type CurveScope = {
  key: string;
  label: string;
  getCurves: (recipe: EditorRecipe) => Curves;
  replaceCurves: (recipe: EditorRecipe, curves: Curves) => EditorRecipe;
};

/** One owned pointer transaction. Exported for event-order regression tests without a fake DOM. */
export function createCurveGestureController(context: () => CurveGestureContext) {
  let active: CurveGesture | null = null;
  const compatible = (gesture: CurveGesture, current: CurveGestureContext) =>
    gesture.sourceIdentity === current.sourceIdentity &&
    gesture.channel === current.channel &&
    gesture.scopeKey === current.scopeKey &&
    gesture.lastPreview === current.recipe;
  function finish(mode: 'commit' | 'cancel' | 'discard', pointerId?: number): boolean {
    const gesture = active;
    if (!gesture || (pointerId !== undefined && gesture.pointerId !== pointerId)) return false;
    // Clear ownership before releasing capture: its lost-capture event must not
    // roll back a transaction which has already committed or cancelled.
    active = null;
    try {
      if (gesture.capture.hasPointerCapture(gesture.pointerId))
        gesture.capture.releasePointerCapture(gesture.pointerId);
    } catch {
      // The browser may have removed the source element already.
    }
    const current = context();
    if (compatible(gesture, current)) {
      if (mode === 'cancel') current.preview(gesture.base);
      if (mode === 'commit') current.commit();
    }
    return true;
  }
  return {
    begin(pointerId: number, index: number, capture: CurveCapture): boolean {
      if (active) return false;
      const current = context();
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >=
          (current.getCurves?.(current.recipe) ?? current.recipe.curves)[current.channel].length
      )
        return false;
      active = {
        pointerId,
        index,
        capture,
        sourceIdentity: current.sourceIdentity,
        channel: current.channel,
        base: current.recipe,
        lastPreview: current.recipe,
        scopeKey: current.scopeKey,
      };
      try {
        capture.setPointerCapture(pointerId);
      } catch {
        active = null;
        return false;
      }
      return true;
    },
    current(pointerId: number): Readonly<CurveGesture> | null {
      if (!active || active.pointerId !== pointerId) return null;
      if (!compatible(active, context())) {
        finish('discard');
        return null;
      }
      return active;
    },
    preview(pointerId: number, recipe: EditorRecipe): boolean {
      if (!active || active.pointerId !== pointerId) return false;
      const current = context();
      if (!compatible(active, current)) {
        finish('discard');
        return false;
      }
      // The editor writes this exact object synchronously. A later external
      // commit/preview has a different identity and terminates our ownership.
      active.lastPreview = recipe;
      current.preview(recipe);
      return true;
    },
    commit: (pointerId: number) => finish('commit', pointerId),
    cancel: (pointerId?: number) => finish('cancel', pointerId),
    discard: () => finish('discard'),
  };
}

const channels: { key: Channel; label: string; color: string }[] = [
  { key: 'rgb', label: 'RGB', color: 'var(--ink)' },
  { key: 'red', label: '红', color: '#d45a4c' },
  { key: 'green', label: '绿', color: '#479878' },
  { key: 'blue', label: '蓝', color: '#518cc9' },
];

const identityCurve = (): CurvePoint[] => [
  [0, 0],
  [1, 1],
];
const coordinate = (value: number) => Number((value * 255).toFixed(2));

function curveHistory(
  editor: EditorState,
  scope: CurveScope | undefined,
  channel: Channel,
  next: Curves,
  action?: string,
) {
  const previous = editor.history[editor.historyIndex]?.recipe ?? editor.getRecipe();
  const before = (scope?.getCurves(previous) ?? previous.curves)[channel];
  const after = next[channel];
  const target = `${scope?.label ?? t('全局')} · ${t(channels.find((c) => c.key === channel)!.label)}`;
  if (action) return `${target} · ${action}`;
  const changed = after.findIndex((p, i) => before[i]?.[0] !== p[0] || before[i]?.[1] !== p[1]);
  if (after.length === before.length && changed >= 0) {
    const format = (p: CurvePoint) => `(${coordinate(p[0])}, ${coordinate(p[1])})`;
    return `${target} · ${t('点 {v0}', { v0: changed + 1 })} ${format(before[changed]!)} → ${format(after[changed]!)}`;
  }
  return `${target} · ${t('控制点')} ${before.length} → ${after.length}`;
}

export function CurveEditor({ editor, scope }: { editor: EditorState; scope?: CurveScope }) {
  const [channel, setChannel] = useState<Channel>('rgb');
  const [selected, setSelected] = useState(1);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const gestures = useRef<ReturnType<typeof createCurveGestureController> | null>(null);
  if (!gestures.current)
    gestures.current = createCurveGestureController(() => ({
      sourceIdentity: editorRef.current.getSourceIdentity(),
      channel: channelRef.current,
      recipe: editorRef.current.getRecipe(),
      preview: editorRef.current.preview,
      commit: () => {
        const current = editorRef.current;
        const selectedScope = scopeRef.current;
        const recipe = current.getRecipe();
        current.commitCurrent(
          curveHistory(
            current,
            selectedScope,
            channelRef.current,
            selectedScope?.getCurves(recipe) ?? recipe.curves,
          ),
        );
      },
      scopeKey: scopeRef.current?.key,
      getCurves: scopeRef.current?.getCurves,
    }));
  const sourceIdentity = editor.getSourceIdentity();
  useEffect(() => {
    // Do not restore the preceding source's recipe into a newly loaded image.
    gestures.current?.discard();
  }, [sourceIdentity, channel, scope?.key]);
  useEffect(() => {
    const blur = () => gestures.current?.cancel();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gestures.current?.cancel()) event.preventDefault();
    };
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', escape);
      gestures.current?.cancel();
    };
  }, []);
  const curves = scope?.getCurves(editor.recipe) ?? editor.recipe.curves;
  const points = curves[channel];
  const mode = curves.interpolation?.[channel] ?? 'linear';
  const color = channels.find((c) => c.key === channel)!.color;
  const writeCurves = (next: Curves, commit = false, pointerId?: number, label?: string) => {
    const current = editor.getRecipe();
    const currentScope = scopeRef.current;
    const recipe = currentScope?.replaceCurves(current, next) ?? { ...current, curves: next };
    if (pointerId !== undefined) gestures.current?.preview(pointerId, recipe);
    else if (commit)
      editor.commit(recipe, label ?? curveHistory(editor, currentScope, channel, next));
    else editor.preview(recipe);
  };
  const update = (
    next: CurvePoint[],
    commit = false,
    pointerId?: number,
    interpolation: CurveInterpolation = 'pchip-v1',
    action?: string,
  ) => {
    const current = editor.getRecipe();
    const currentScope = scopeRef.current;
    const updated = withCurve(
      currentScope?.getCurves(current) ?? current.curves,
      channel,
      next,
      interpolation,
    );
    writeCurves(
      updated,
      commit,
      pointerId,
      action ? curveHistory(editor, currentScope, channel, updated, action) : undefined,
    );
  };
  const commitPoint = () => {
    const recipe = editor.getRecipe();
    editor.commitCurrent(
      curveHistory(editor, scope, channel, scope?.getCurves(recipe) ?? recipe.curves),
    );
  };
  function changePoint(index: number, x: number, y: number, commit = false, pointerId?: number) {
    const current = editor.getRecipe();
    const currentPoints = (scopeRef.current?.getCurves(current) ?? current.curves)[channel];
    if (index < 0 || index >= currentPoints.length || !Number.isFinite(x) || !Number.isFinite(y))
      return;
    const next = currentPoints.map((p) => [...p] as CurvePoint);
    let nextX = index === 0 ? 0 : index === next.length - 1 ? 1 : next[index]![0];
    if (index > 0 && index < next.length - 1 && x !== next[index]![0]) {
      const left = next[index - 1]![0];
      const right = next[index + 1]![0];
      const current = next[index]![0];
      const margin = Math.min(0.01, (current - left) / 4, (right - current) / 4);
      const proposed = Math.max(left + margin, Math.min(right - margin, x));
      if (proposed > left && proposed < right) nextX = proposed;
    }
    const nextY = Math.max(0, Math.min(1, y));
    if (nextX === currentPoints[index]![0] && nextY === currentPoints[index]![1]) return;
    next[index] = [nextX, nextY];
    update(next, commit, pointerId);
  }
  function addPoint(at?: CurvePoint) {
    if (at && points.length < 16) {
      const x = Math.max(0.000001, Math.min(0.999999, at[0]));
      if (points.some((point) => Math.abs(point[0] - x) < 0.000001)) return;
      const index = points.findIndex((point) => point[0] > x);
      const next = points.map((point) => [...point] as CurvePoint);
      next.splice(index, 0, [x, Math.max(0, Math.min(1, at[1]))]);
      setSelected(index);
      update(next, true);
      return;
    }
    let gap = 0,
      index = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const size = points[i + 1]![0] - points[i]![0];
      if (size > gap) {
        gap = size;
        index = i;
      }
    }
    if (gap < 0.025 || points.length >= 16) return;
    const next = points.map((p) => [...p] as CurvePoint);
    const x = (points[index]![0] + points[index + 1]![0]) / 2;
    next.splice(index + 1, 0, [x, compileCurveFunction(points, mode)(x)]);
    setSelected(index + 1);
    update(next, true);
  }
  const active = points[Math.min(selected, points.length - 1)]!;
  const activeReset =
    points.length !== 2 || points[0]![1] !== 0 || points[1]![1] !== 1 || mode !== 'linear';
  const canReset =
    activeReset ||
    channels.some(
      ({ key }) =>
        curves[key].length !== 2 ||
        curves[key][0]![1] !== 0 ||
        curves[key][1]![1] !== 1 ||
        curves.interpolation?.[key],
    );
  const graph = useMemo(() => {
    const start = `M0 ${(1 - points[0]![1]) * 256}`;
    if (mode === 'linear')
      return (
        start +
        points
          .slice(1)
          .map(([x, y]) => ` L${x * 256} ${(1 - y) * 256}`)
          .join('')
      );
    return (
      start +
      smoothCurveSegments(points)
        .map(
          ({ x, width, first, second, to }) =>
            ` C${(x + width / 3) * 256} ${(1 - first) * 256} ${(x + (width * 2) / 3) * 256} ${(1 - second) * 256} ${(x + width) * 256} ${(1 - to) * 256}`,
        )
        .join('')
    );
  }, [mode, points]);
  const histogram = useMemo(() => sharedHistogram(editor.rendered), [editor.rendered]);
  const distribution = histogram
    ? channel === 'rgb'
      ? histogram.luminance
      : histogram[channel]
    : null;
  const maximum = distribution ? Math.max(1, ...Array.from(distribution)) : 1;
  const histogramPath = distribution
    ? `M0 256 ${Array.from(distribution, (count, x) => `L${x} ${256 - (count / maximum) * 220}`).join(' ')} L256 256Z`
    : '';
  return (
    <section className="curve-editor refined-curve" data-motion="curve-controls">
      <div className="channel-tabs" role="tablist" aria-label={t('曲线通道')}>
        {channels.map((c) => (
          <button
            key={c.key}
            className={channel === c.key ? 'selected' : ''}
            role="tab"
            aria-selected={channel === c.key}
            onClick={() => {
              gestures.current?.cancel();
              channelRef.current = c.key;
              setChannel(c.key);
              setSelected(0);
            }}
          >
            <i style={{ background: c.color }} />
            {t(c.label)}
          </button>
        ))}
      </div>
      <div className="curve-point-controls">
        <IconButton
          label={t('平滑当前通道')}
          disabled={mode !== 'linear' || points.length < 3}
          onClick={() => update(points, true, undefined, 'pchip-v1', t('平滑曲线'))}
        >
          <BezierCurve size={18} />
        </IconButton>
        <IconButton
          label={t('重置当前通道')}
          disabled={!activeReset}
          onClick={() => {
            setSelected(0);
            update(identityCurve(), true, undefined, 'linear', t('重置曲线'));
          }}
        >
          <ArrowCounterClockwise size={18} />
        </IconButton>
        <button
          className="text-button"
          disabled={!canReset}
          onClick={() => {
            setSelected(0);
            writeCurves(
              {
                rgb: identityCurve(),
                red: identityCurve(),
                green: identityCurve(),
                blue: identityCurve(),
              },
              true,
              undefined,
              `${scope?.label ?? t('全局')} · ${t('重置全部曲线')}`,
            );
          }}
        >
          {t('重置全部曲线')}
        </button>
      </div>
      <svg
        className="curve-graph"
        viewBox="0 0 256 256"
        role="img"
        aria-label={t('{v0} 通道曲线。可通过下方数值控制点编辑。', {
          v0: t(channels.find((c) => c.key === channel)?.label ?? ''),
        })}
        onDoubleClick={(event) => {
          if ((event.target as Element).closest('[data-curve-point]')) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          addPoint([
            (event.clientX - bounds.left) / bounds.width,
            1 - (event.clientY - bounds.top) / bounds.height,
          ]);
        }}
        onPointerMove={(e) => {
          const gesture = gestures.current?.current(e.pointerId);
          if (!gesture) return;
          if ((e.buttons & 1) === 0) {
            gestures.current?.cancel(e.pointerId);
            return;
          }
          const bounds = e.currentTarget.getBoundingClientRect();
          if (bounds.width <= 0 || bounds.height <= 0) return;
          changePoint(
            gesture.index,
            (e.clientX - bounds.left) / bounds.width,
            1 - (e.clientY - bounds.top) / bounds.height,
            false,
            e.pointerId,
          );
        }}
        onPointerUp={(e) => {
          gestures.current?.commit(e.pointerId);
        }}
        onPointerCancel={(e) => gestures.current?.cancel(e.pointerId)}
        onLostPointerCapture={(e) => gestures.current?.cancel(e.pointerId)}
      >
        {histogramPath && <path d={histogramPath} fill={color} opacity=".1" />}
        {[0, 64, 128, 192, 256].map((n) => (
          <g key={n}>
            <line x1={n} x2={n} y1="0" y2="256" className="graph-grid" />
            <line y1={n} y2={n} x1="0" x2="256" className="graph-grid" />
          </g>
        ))}
        <line x1="0" y1="256" x2="256" y2="0" stroke="var(--line-strong)" strokeDasharray="4 5" />
        <path
          data-curve-interpolation={mode}
          d={graph}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
        />
        {points.map((p, i) => (
          <g
            key={i}
            data-curve-point={i}
            role="button"
            tabIndex={0}
            aria-label={t('曲线控制点 {v0}，输入 {v1}，输出 {v2}', {
              v0: i + 1,
              v1: Number((p[0] * 255).toFixed(2)),
              v2: Number((p[1] * 255).toFixed(2)),
            })}
            onFocus={() => setSelected(i)}
            onKeyDown={(event) => {
              const step = (event.altKey ? 0.1 : event.shiftKey ? 10 : 1) / 255;
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                changePoint(
                  i,
                  p[0] +
                    (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
                  p[1] + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
                );
              } else if (
                (event.key === 'Delete' || event.key === 'Backspace') &&
                i > 0 &&
                i < points.length - 1
              ) {
                event.preventDefault();
                update(
                  points.filter((_, index) => index !== i),
                  true,
                );
                setSelected(Math.max(0, i - 1));
              } else if (event.key === 'Escape') {
                event.preventDefault();
                if (!gestures.current?.cancel()) editor.cancelPreview();
              }
            }}
            onKeyUp={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
                commitPoint();
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const svg = e.currentTarget.ownerSVGElement;
              if (!svg || !gestures.current?.begin(e.pointerId, i, svg)) return;
              e.preventDefault();
              setSelected(i);
            }}
          >
            <circle cx={p[0] * 256} cy={(1 - p[1]) * 256} r="14" fill="transparent" />
            <circle
              cx={p[0] * 256}
              cy={(1 - p[1]) * 256}
              r={selected === i ? 6 : 4.5}
              fill={selected === i ? 'var(--accent)' : 'var(--surface-raised)'}
              stroke={color}
              strokeWidth="2"
            />
          </g>
        ))}
      </svg>
      <label className="curve-point-select">
        {t('选择控制点')}
        <ChoiceSelect
          ariaLabel={t('选择曲线控制点')}
          size="compact"
          value={String(Math.min(selected, points.length - 1))}
          onValueChange={(value) => setSelected(Number(value))}
          options={points.map((point, index) => ({
            value: String(index),
            label: t('点 {v0} · {v1} → {v2}', {
              v0: index + 1,
              v1: Math.round(point[0] * 255),
              v2: Math.round(point[1] * 255),
            }),
          }))}
        />
      </label>
      <PrecisionRange
        label={t('控制点输入值')}
        value={active[0] * 255}
        min={0}
        max={255}
        step={0.1}
        disabled={selected === 0 || selected >= points.length - 1}
        onChange={(value) =>
          changePoint(Math.min(selected, points.length - 1), value / 255, active[1])
        }
        onCommit={commitPoint}
        onCancel={editor.cancelPreview}
      />
      <PrecisionRange
        label={t('控制点输出值')}
        value={active[1] * 255}
        min={0}
        max={255}
        step={0.1}
        onChange={(value) =>
          changePoint(Math.min(selected, points.length - 1), active[0], value / 255)
        }
        onCommit={commitPoint}
        onCancel={editor.cancelPreview}
      />
      <div className="curve-point-controls">
        <small>
          {points.length} {t('/ 16 个控制点')}
        </small>
        <IconButton
          label={t('添加曲线控制点')}
          onClick={() => addPoint()}
          disabled={points.length >= 16}
        >
          <Plus size={18} />
        </IconButton>
        <IconButton
          label={t('删除选中的控制点')}
          disabled={selected === 0 || selected >= points.length - 1}
          onClick={() => {
            update(
              points.filter((_, i) => i !== selected),
              true,
            );
            setSelected(0);
          }}
        >
          <Trash size={18} />
        </IconButton>
      </div>
      <MotionDetails className="editor-section">
        <summary>
          <span>{t('曲线起点')}</span>
          <small>{t('应用于当前通道')}</small>
        </summary>
        <div className="curve-preset-list">
          {(
            [
              [
                t('自然对比'),
                [
                  [0, 0],
                  [0.25, 0.19],
                  [0.75, 0.81],
                  [1, 1],
                ],
              ],
              [
                t('柔和对比'),
                [
                  [0, 0],
                  [0.25, 0.3],
                  [0.75, 0.7],
                  [1, 1],
                ],
              ],
              [
                t('抬黑'),
                [
                  [0, 0.12],
                  [0.35, 0.37],
                  [1, 1],
                ],
              ],
              [
                t('反相'),
                [
                  [0, 1],
                  [1, 0],
                ],
              ],
            ] as [string, CurvePoint[]][]
          ).map(([name, curve]) => (
            <button
              key={name}
              onClick={() => {
                setSelected(0);
                update(curve, true, undefined, 'pchip-v1', name);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </MotionDetails>
    </section>
  );
}
