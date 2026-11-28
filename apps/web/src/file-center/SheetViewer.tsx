import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { numericCell } from '@ai-xiutu/contracts/office-data';
import { t } from '../i18n';
import { columnName, type SheetPreview } from './sheet-preview';

/**
 * Excel-style read-only grid: column letters and row numbers stay pinned, the
 * name box and formula bar show the active cell, sheet tabs sit at the bottom
 * and the status bar sums the selection. Only visible cells are rendered, so a
 * sheet with 200 000 rows scrolls smoothly.
 */

const ROW = 26;
const COL = 112;
const HEAD = 46;

export interface SheetSelection {
  sheet: number;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function SheetViewer({
  sheets,
  onSelection,
}: {
  sheets: SheetPreview[];
  onSelection?: (selection: SheetSelection) => void;
}) {
  const [index, setIndex] = useState(0);
  const sheet = sheets[index]!;
  const [sel, setSel] = useState({ r0: 0, c0: 0, r1: 0, c1: 0 });
  const [anchor, setAnchor] = useState({ r: 0, c: 0 });
  const dragging = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, width: 800, height: 500 });
  // Like Excel, empty cells fill the visible area beyond the data.
  const rows = Math.max(sheet.rows.length, Math.ceil(view.height / ROW));
  const cols = Math.max(sheet.columns, Math.ceil((view.width - HEAD) / COL));

  useEffect(() => {
    setSel({ r0: 0, c0: 0, r1: 0, c1: 0 });
    setAnchor({ r: 0, c: 0 });
    scroller.current?.scrollTo(0, 0);
  }, [index]);
  useEffect(() => {
    const r0 = Math.min(sel.r0, sel.r1),
      r1 = Math.max(sel.r0, sel.r1),
      c0 = Math.min(sel.c0, sel.c1),
      c1 = Math.max(sel.c0, sel.c1);
    onSelection?.({ sheet: index, r0, c0, r1, c1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, index]);

  const cellLayer = useRef<HTMLDivElement>(null);
  const colLayer = useRef<HTMLDivElement>(null);
  const rowLayer = useRef<HTMLDivElement>(null);
  // Layers move in the scroll handler itself (before paint) so headers never lag
  // the cells; React only re-renders to change which cells exist.
  const place = (left: number, top: number) => {
    if (cellLayer.current) cellLayer.current.style.transform = `translate(${HEAD - left}px, ${ROW - top}px)`;
    if (colLayer.current) colLayer.current.style.transform = `translateX(${-left}px)`;
    if (rowLayer.current) rowLayer.current.style.transform = `translateY(${-top}px)`;
  };
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    place(el.scrollLeft, el.scrollTop);
    setView({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
  };
  useLayoutEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const firstRow = Math.max(0, Math.floor(view.top / ROW) - 10);
  const lastRow = Math.min(rows - 1, Math.ceil((view.top + view.height) / ROW) + 10);
  const firstCol = Math.max(0, Math.floor(view.left / COL) - 3);
  const lastCol = Math.min(cols - 1, Math.ceil((view.left + view.width) / COL) + 3);
  const lo = { r: Math.min(sel.r0, sel.r1), c: Math.min(sel.c0, sel.c1) };
  const hi = { r: Math.max(sel.r0, sel.r1), c: Math.max(sel.c0, sel.c1) };
  const inSel = (r: number, c: number) => r >= lo.r && r <= hi.r && c >= lo.c && c <= hi.c;

  const stats = useMemo(() => {
    let count = 0,
      numbers = 0,
      sum = 0;
    const cells = (hi.r - lo.r + 1) * (hi.c - lo.c + 1);
    if (cells > 2_000_000) return null;
    for (let r = lo.r; r <= hi.r; r++)
      for (let c = lo.c; c <= hi.c; c++) {
        const v = sheet.rows[r]?.[c] ?? '';
        if (!v) continue;
        count++;
        const n = numericCell(v.replace(/,/g, ''));
        if (n) {
          numbers++;
          sum += n.value;
        }
      }
    return { count, numbers, sum };
  }, [sheet, lo.r, lo.c, hi.r, hi.c]);

  const pick = (r: number, c: number, extend: boolean) => {
    if (extend) setSel({ r0: anchor.r, c0: anchor.c, r1: r, c1: c });
    else {
      setAnchor({ r, c });
      setSel({ r0: r, c0: c, r1: r, c1: c });
    }
  };
  const move = (dr: number, dc: number, extend: boolean) => {
    const r = Math.max(0, Math.min(rows - 1, (extend ? sel.r1 : anchor.r) + dr));
    const c = Math.max(0, Math.min(cols - 1, (extend ? sel.c1 : anchor.c) + dc));
    pick(r, c, extend);
    const el = scroller.current;
    if (!el) return;
    if (r * ROW < el.scrollTop) el.scrollTop = r * ROW;
    if ((r + 1) * ROW > el.scrollTop + el.clientHeight - ROW) el.scrollTop = (r + 2) * ROW - el.clientHeight;
    if (c * COL < el.scrollLeft) el.scrollLeft = c * COL;
    if ((c + 1) * COL > el.scrollLeft + el.clientWidth - HEAD) el.scrollLeft = (c + 1) * COL - el.clientWidth + HEAD;
  };
  const activeValue = sheet.rows[anchor.r]?.[anchor.c] ?? '';
  const format = (n: number) => (Math.abs(n) >= 1e15 ? n.toExponential(4) : Number(n.toFixed(6)).toLocaleString());

  const cells = [];
  for (let r = firstRow; r <= lastRow; r++)
    for (let c = firstCol; c <= lastCol; c++) {
      const v = sheet.rows[r]?.[c] ?? '';
      const numeric = !!v && numericCell(v.replace(/,/g, '')) !== null;
      cells.push(
        <div
          key={r + ':' + c}
          className={'fc-cell' + (inSel(r, c) ? ' is-sel' : '') + (r === anchor.r && c === anchor.c ? ' is-active' : '') + (numeric ? ' is-num' : '') + (r === 0 ? ' is-head' : '')}
          style={{ top: r * ROW, left: c * COL }}
          onPointerDown={(e) => {
            dragging.current = true;
            pick(r, c, e.shiftKey);
          }}
          onPointerEnter={() => dragging.current && setSel((s) => ({ ...s, r1: r, c1: c }))}
          title={v.length > 14 ? v : undefined}
        >
          {v}
        </div>,
      );
    }

  return (
    <div className="fc-sheet" onPointerUp={() => (dragging.current = false)} onPointerLeave={() => (dragging.current = false)}>
      <div className="fc-formula">
        <output className="fc-namebox" aria-label={t('名称框')}>
          {columnName(lo.c)}
          {lo.r + 1}
          {(hi.r !== lo.r || hi.c !== lo.c) && `:${columnName(hi.c)}${hi.r + 1}`}
        </output>
        <span className="fc-fx" aria-hidden>
          ƒx
        </span>
        <output className="fc-formula-value" aria-label={t('单元格内容')}>
          {activeValue}
        </output>
      </div>
      <div
        ref={scroller}
        className="fc-grid"
        tabIndex={0}
        role="grid"
        aria-label={sheet.name}
        aria-rowcount={rows}
        aria-colcount={cols}
        onScroll={measure}
        onKeyDown={(e) => {
          const step: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [1, 0], Tab: [0, 1] };
          const d = step[e.key];
          if (!d) return;
          e.preventDefault();
          const jump = e.ctrlKey || e.metaKey;
          move(jump ? d[0] * rows : d[0], jump ? d[1] * cols : d[1], e.shiftKey);
        }}
      >
        <div className="fc-grid-fixed">
          <div ref={cellLayer} className="fc-cells" style={{ transform: `translate(${HEAD - view.left}px, ${ROW - view.top}px)` }}>
            {cells}
          </div>
          <div ref={colLayer} className="fc-col-heads" style={{ transform: `translateX(${-view.left}px)` }}>
            {Array.from({ length: lastCol - firstCol + 1 }, (_, i) => firstCol + i).map((c) => (
              <div key={c} className={'fc-col-head' + (c >= lo.c && c <= hi.c ? ' is-on' : '')} style={{ left: HEAD + c * COL }}>
                {columnName(c)}
              </div>
            ))}
          </div>
          <div ref={rowLayer} className="fc-row-heads" style={{ transform: `translateY(${-view.top}px)` }}>
            {Array.from({ length: lastRow - firstRow + 1 }, (_, i) => firstRow + i).map((r) => (
              <div key={r} className={'fc-row-head' + (r >= lo.r && r <= hi.r ? ' is-on' : '')} style={{ top: ROW + r * ROW }}>
                {r + 1}
              </div>
            ))}
          </div>
          <div className="fc-corner" aria-hidden />
        </div>
        <div className="fc-grid-size" style={{ width: cols * COL + HEAD, height: (rows + 1) * ROW }} />
      </div>
      <div className="fc-sheet-foot">
        <div className="fc-tabs" role="tablist" aria-label={t('工作表')}>
          {sheets.map((s, i) => (
            <button key={s.name + i} type="button" role="tab" aria-selected={i === index} onClick={() => setIndex(i)}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="fc-sheet-status" aria-live="polite">
          {sheet.totalRows && <span className="fc-warn">{t('共 {v0} 行，预览前 {v1} 行', { v0: sheet.totalRows.toLocaleString(), v1: sheet.rows.length.toLocaleString() })}</span>}
          {stats && stats.count > 1 && <span>{t('计数')} {stats.count.toLocaleString()}</span>}
          {stats && stats.numbers > 1 && (
            <>
              <span>{t('求和')} {format(stats.sum)}</span>
              <span>{t('平均值')} {format(stats.sum / stats.numbers)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
