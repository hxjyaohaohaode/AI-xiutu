import { useRef, useState } from 'react';
import { Plus, Trash, ArrowCounterClockwise } from '@phosphor-icons/react';
import type { CurvePoint, RecipeV1 } from '@ai-xiutu/editor';
import type { EditorState } from './useEditor';
import { IconButton } from '../components/Ui';

type Channel = keyof RecipeV1['curves'];
const channels: { key: Channel; label: string; color: string }[] = [
  { key: 'rgb', label: 'RGB', color: '#62665c' },
  { key: 'red', label: '红', color: '#d45a4c' },
  { key: 'green', label: '绿', color: '#479878' },
  { key: 'blue', label: '蓝', color: '#518cc9' },
];
export function CurveEditor({ editor }: { editor: EditorState }) {
  const [channel, setChannel] = useState<Channel>('rgb');
  const [selected, setSelected] = useState(1);
  const dragging = useRef<number | null>(null);
  const gestureStart = useRef<RecipeV1 | null>(null);
  const points = editor.recipe.curves[channel];
  const color = channels.find((c) => c.key === channel)!.color;
  const update = (next: CurvePoint[], commit = false) => {
    const recipe = { ...editor.recipe, curves: { ...editor.recipe.curves, [channel]: next } };
    if (commit) editor.commit(recipe, '调整曲线');
    else editor.preview(recipe);
  };
  function changePoint(index: number, x: number, y: number, commit = false) {
    if (index < 0 || index >= points.length || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const next = points.map((p) => [...p] as CurvePoint);
    let nextX = index === 0 ? 0 : index === next.length - 1 ? 1 : next[index]![0];
    if (index > 0 && index < next.length - 1 && x !== next[index]![0]) {
      const left = next[index - 1]![0];
      const right = next[index + 1]![0];
      const current = next[index]![0];
      const margin = Math.min(0.01, (current - left) / 4, (right - current) / 4);
      const proposed = Math.max(left + margin, Math.min(right - margin, x));
      if (proposed > left && proposed < right) nextX = proposed;
    }
    next[index] = [nextX, Math.max(0, Math.min(1, y))];
    update(next, commit);
  }
  function addPoint() {
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
    next.splice(index + 1, 0, [
      (points[index]![0] + points[index + 1]![0]) / 2,
      (points[index]![1] + points[index + 1]![1]) / 2,
    ]);
    setSelected(index + 1);
    update(next, true);
  }
  const active = points[Math.min(selected, points.length - 1)]!;
  return (
    <section className="curve-editor">
      <div className="channel-tabs">
        {channels.map((c) => (
          <button
            key={c.key}
            className={channel === c.key ? 'selected' : ''}
            onClick={() => {
              setChannel(c.key);
              setSelected(0);
            }}
          >
            <i style={{ background: c.color }} />
            {c.label}
          </button>
        ))}
      </div>
      <svg
        className="curve-graph"
        viewBox="0 0 256 256"
        role="img"
        aria-label={`${channels.find((c) => c.key === channel)?.label} 通道曲线。可通过下方数值控制点编辑。`}
        onPointerMove={(e) => {
          if (dragging.current === null) return;
          const bounds = e.currentTarget.getBoundingClientRect();
          changePoint(
            dragging.current,
            (e.clientX - bounds.left) / bounds.width,
            1 - (e.clientY - bounds.top) / bounds.height,
          );
        }}
        onPointerUp={(e) => {
          if (dragging.current === null) return;
          dragging.current = null;
          editor.commitCurrent('调整曲线');
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = null;
          if (gestureStart.current) editor.preview(gestureStart.current);
        }}
      >
        {[0, 64, 128, 192, 256].map((n) => (
          <g key={n}>
            <line x1={n} x2={n} y1="0" y2="256" className="graph-grid" />
            <line y1={n} y2={n} x1="0" x2="256" className="graph-grid" />
          </g>
        ))}
        <line x1="0" y1="256" x2="256" y2="0" stroke="#cecec5" strokeDasharray="4 5" />
        <polyline
          points={points.map((p) => `${p[0] * 256},${(1 - p[1]) * 256}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
        />
        {points.map((p, i) => (
          <g
            key={i}
            onPointerDown={(e) => {
              e.preventDefault();
              gestureStart.current = editor.recipe;
              dragging.current = i;
              setSelected(i);
              e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
            }}
          >
            <circle cx={p[0] * 256} cy={(1 - p[1]) * 256} r="14" fill="transparent" />
            <circle
              cx={p[0] * 256}
              cy={(1 - p[1]) * 256}
              r={selected === i ? 6 : 4.5}
              fill={selected === i ? '#e9b634' : '#fff'}
              stroke={color}
              strokeWidth="2"
            />
          </g>
        ))}
      </svg>
      <label className="curve-point-select">
        选择控制点
        <select
          aria-label="选择曲线控制点"
          value={Math.min(selected, points.length - 1)}
          onChange={(e) => setSelected(Number(e.target.value))}
        >
          {points.map((point, index) => (
            <option key={index} value={index}>
              点 {index + 1} · {Math.round(point[0] * 255)} → {Math.round(point[1] * 255)}
            </option>
          ))}
        </select>
      </label>
      <div className="curve-point-controls">
        <label>
          输入
          <input
            aria-label="控制点输入值"
            type="number"
            min="0"
            max="255"
            value={Math.round(active[0] * 255)}
            disabled={selected === 0 || selected === points.length - 1}
            onChange={(e) =>
              changePoint(
                Math.min(selected, points.length - 1),
                Number(e.target.value) / 255,
                active[1],
                true,
              )
            }
          />
        </label>
        <label>
          输出
          <input
            aria-label="控制点输出值"
            type="number"
            min="0"
            max="255"
            value={Math.round(active[1] * 255)}
            onChange={(e) =>
              changePoint(
                Math.min(selected, points.length - 1),
                active[0],
                Number(e.target.value) / 255,
                true,
              )
            }
          />
        </label>
        <IconButton label="添加曲线控制点" onClick={addPoint} disabled={points.length >= 16}>
          <Plus size={18} />
        </IconButton>
        <IconButton
          label="删除选中的控制点"
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
      <button
        className="text-button"
        onClick={() => {
          setSelected(0);
          update(
            [
              [0, 0],
              [1, 1],
            ],
            true,
          );
        }}
      >
        <ArrowCounterClockwise size={15} />
        重置当前通道
      </button>
      <p className="inspector-note">调整暗部和亮部的映射。选择控制点后可以精确输入。</p>
    </section>
  );
}
