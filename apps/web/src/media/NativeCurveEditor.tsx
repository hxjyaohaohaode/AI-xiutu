import { useEffect, useId, useRef, useState } from 'react';
import { Plus, Trash, ArrowCounterClockwise } from '@phosphor-icons/react';
import type { CurvePoint } from '@ai-xiutu/editor';
import { t } from '../i18n';
import { IconButton } from '../components/Ui';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { PrecisionRange } from '../editor/PrecisionRange';
import { addNativeCurvePoint, moveNativeCurvePoint, nativeCurveInputBounds, nativeCurveOutput } from './native-grade-model';

type Drag = { pointerId: number; index: number; base: CurvePoint[]; last: string; svg: SVGSVGElement; restore: () => void };

export function NativeCurveEditor({
  points, minEv, maxEv, maxPoints, color, disabled, onChange, onReset, onCancel,
}: {
  points: CurvePoint[];
  minEv: number;
  maxEv: number;
  maxPoints: number;
  color: string;
  disabled: boolean;
  onChange: (points: CurvePoint[]) => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  const clipId = useId();
  const [selected, setSelected] = useState(0);
  const gesture = useRef<Drag | null>(null);
  const numberRestore = useRef<(() => void) | null>(null);
  const current = useRef({ points, disabled, onChange });
  current.current = { points, disabled, onChange };
  const index = Math.min(selected, points.length - 1);
  const point = points[index]!;
  const inputBounds = nativeCurveInputBounds(points, index, minEv, maxEv);
  const span = maxEv - minEv;
  const coordinate = (value: number) => (value - minEv) / span * 256;
  const pixel = ([x, y]: CurvePoint) => coordinate(x) + ',' + (256 - coordinate(y));
  const graphPoints: CurvePoint[] = [
    [minEv, nativeCurveOutput(points, minEv)], ...points, [maxEv, nativeCurveOutput(points, maxEv)],
  ];
  function publish(next: CurvePoint[]) {
    current.current = { ...current.current, points: next };
    current.current.onChange(next);
  }
  function finish(cancel = false) {
    const drag = gesture.current;
    if (!drag) return;
    gesture.current = null;
    if (cancel && JSON.stringify(current.current.points) === drag.last) drag.restore();
    try {
      if (drag.svg.hasPointerCapture(drag.pointerId)) drag.svg.releasePointerCapture(drag.pointerId);
    } catch { /* The source may have closed while captured. */ }
  }
  const cancel = useRef(() => finish(true));
  cancel.current = () => finish(true);
  useEffect(() => {
    const blur = () => cancel.current();
    const visibility = () => { if (document.visibilityState !== 'visible') blur(); };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      gesture.current = null;
    };
  }, []);
  useEffect(() => {
    if (disabled) cancel.current();
    else if (gesture.current && JSON.stringify(points) !== gesture.current.last) finish();
  }, [points, disabled]);
  const eventPoint = (svg: SVGSVGElement, clientX: number, clientY: number): CurvePoint | null => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const location = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return Number.isFinite(location.x) && Number.isFinite(location.y)
      ? [minEv + location.x / 256 * span, minEv + (1 - location.y / 256) * span] : null;
  };
  function addMiddle() {
    let widest = 0;
    for (let at = 1; at < points.length - 1; at++)
      if (points[at + 1]![0] - points[at]![0] > points[widest + 1]![0] - points[widest]![0]) widest = at;
    const x = (points[widest]![0] + points[widest + 1]![0]) / 2;
    const next = addNativeCurvePoint(points, [x, nativeCurveOutput(points, x)], maxPoints, minEv, maxEv);
    setSelected(next.index);
    publish(next.points);
  }
  return (
    <div className="native-curve-editor">
      <div className="native-curve-legend"><span>{t('输出')} EV</span><span>0 EV = 0.18</span></div>
      <svg
        className="native-curve-plot"
        viewBox="-8 -8 272 272"
        role="group"
        tabIndex={disabled ? -1 : 0}
        aria-label={t('场景线性曲线')}
        data-native-curve
        onPointerDown={(event) => {
          if (disabled || !event.isPrimary || event.button !== 0 || gesture.current) return;
          const location = eventPoint(event.currentTarget, event.clientX, event.clientY);
          if (!location) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          const target = (event.target as Element).closest<SVGElement>('[data-curve-point]');
          let at = target ? Number(target.dataset.curvePoint) : -1;
          let next = points;
          if (at < 0) {
            const added = addNativeCurvePoint(points, location, maxPoints, minEv, maxEv);
            next = added.points;
            at = added.index;
            if (next === points && points.length >= maxPoints) return;
          }
          gesture.current = { pointerId: event.pointerId, index: at, base: points, last: JSON.stringify(next), svg: event.currentTarget, restore: onCancel };
          event.currentTarget.setPointerCapture(event.pointerId);
          setSelected(at);
          if (next !== points) publish(next);
        }}
        onPointerMove={(event) => {
          const drag = gesture.current;
          if (!drag || drag.pointerId !== event.pointerId || disabled) return;
          const location = eventPoint(event.currentTarget, event.clientX, event.clientY);
          if (!location) return;
          const next = moveNativeCurvePoint(current.current.points, drag.index, location, minEv, maxEv);
          drag.last = JSON.stringify(next);
          publish(next);
        }}
        onPointerUp={(event) => { if (gesture.current?.pointerId === event.pointerId) finish(); }}
        onPointerCancel={(event) => { if (gesture.current?.pointerId === event.pointerId) finish(true); }}
        onLostPointerCapture={(event) => { if (gesture.current?.pointerId === event.pointerId) finish(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); finish(true); }
          if (!disabled && event.target === event.currentTarget) {
            const amount = event.altKey ? .01 : event.shiftKey ? 1 : .1;
            const moves: Record<string, CurvePoint> = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, amount], ArrowDown: [0, -amount] };
            const move = moves[event.key];
            if (move) {
              event.preventDefault();
              publish(moveNativeCurvePoint(points, index, [point[0] + move[0], point[1] + move[1]], minEv, maxEv));
            }
          }
        }}
      >
        <defs><clipPath id={clipId}><rect width="256" height="256" /></clipPath></defs>
        <rect className="native-curve-paper" width="256" height="256" rx="3" />
        {[0, 64, 128, 192, 256].map((at) => <path key={at} className="native-curve-grid" d={'M' + at + ' 0V256M0 ' + at + 'H256'} />)}
        <path className="native-curve-identity" d="M0 256 256 0" />
        <polyline points={graphPoints.map(pixel).join(' ')} clipPath={'url(#' + clipId + ')'} fill="none" stroke={color} strokeWidth="2" />
        {points.map(([x, y], at) => (
          <g key={at} data-curve-point={at}>
            <circle
              cx={coordinate(x)} cy={256 - coordinate(y)} r="12"
              fill="transparent" role="button" tabIndex={at === index && !disabled ? 0 : -1}
              aria-label={t('点 {v0}', { v0: at + 1 }) + ' · ' + x.toFixed(2) + ' → ' + y.toFixed(2) + ' EV'}
              aria-disabled={disabled}
              onFocus={() => setSelected(at)}
              onKeyDown={(event) => {
                if (disabled) return;
                const amount = event.altKey ? .01 : event.shiftKey ? 1 : .1;
                const moves: Record<string, CurvePoint> = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, amount], ArrowDown: [0, -amount] };
                const move = moves[event.key];
                if (move) {
                  event.preventDefault();
                  publish(moveNativeCurvePoint(points, at, [x + move[0], y + move[1]], minEv, maxEv));
                } else if ((event.key === 'Delete' || event.key === 'Backspace') && points.length > 2) {
                  event.preventDefault();
                  publish(points.filter((_, candidate) => candidate !== at));
                  setSelected(Math.max(0, at - 1));
                }
              }}
            />
            <circle className="native-curve-knot" cx={coordinate(x)} cy={256 - coordinate(y)} r={at === index ? 4.5 : 3.2} fill={at === index ? color : 'var(--surface)'} stroke={color} strokeWidth="1.5" pointerEvents="none" />
          </g>
        ))}
      </svg>
      <div className="native-curve-legend"><span>{minEv} EV</span><span>{t('输入')} EV</span><span>+{maxEv} EV</span></div>
      <div className="native-curve-actions">
        <ChoiceSelect
          ariaLabel={t('控制点')} value={String(index)} disabled={disabled}
          options={points.map((_, at) => ({ value: String(at), label: t('点 {v0}', { v0: at + 1 }) }))}
          onValueChange={(value) => setSelected(Number(value))}
        />
        <IconButton label={t('添加控制点')} disabled={disabled || points.length >= maxPoints} onClick={addMiddle}><Plus size={16} /></IconButton>
        <IconButton label={t('删除控制点')} disabled={disabled || points.length <= 2} onClick={() => {
          publish(points.filter((_, at) => at !== index));
          setSelected(Math.max(0, index - 1));
        }}><Trash size={16} /></IconButton>
        <IconButton label={t('重置曲线')} disabled={disabled} onClick={onReset}><ArrowCounterClockwise size={16} /></IconButton>
      </div>
      <div className="native-curve-coordinates">
        <PrecisionRange label={t('输入')} unit="EV" value={point[0]} step={inputBounds.step}
          min={inputBounds.minimum} max={inputBounds.maximum}
          disabled={disabled || !inputBounds.editable}
          description={!inputBounds.editable ? t('相邻控制点过近') : undefined}
          onChange={(value) => { numberRestore.current ??= onCancel; publish(moveNativeCurvePoint(points, index, [value, point[1]], minEv, maxEv)); }}
          onCommit={() => { numberRestore.current = null; }}
          onCancel={() => { const restore = numberRestore.current; numberRestore.current = null; restore?.(); }} />
        <PrecisionRange label={t('输出')} unit="EV" value={point[1]} step={.01} min={minEv} max={maxEv}
          disabled={disabled}
          onChange={(value) => { numberRestore.current ??= onCancel; publish(moveNativeCurvePoint(points, index, [point[0], value], minEv, maxEv)); }}
          onCommit={() => { numberRestore.current = null; }}
          onCancel={() => { const restore = numberRestore.current; numberRestore.current = null; restore?.(); }} />
      </div>
    </div>
  );
}
