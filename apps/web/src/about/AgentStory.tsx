import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChatCircleDots,
  CirclesThreePlus,
  GitBranch,
  SlidersHorizontal,
  Sparkle,
} from '@phosphor-icons/react';
import { EditorialImage } from './AboutArt';
import type { EditorialCopy } from './editorial-copy';

const stepIcons = [ChatCircleDots, CirclesThreePlus, SlidersHorizontal, GitBranch];

/** Stepper's single controlled stage, with spatial changes large enough to read while scrolling. */
export function AgentStory({ copy: c, onOpen }: { copy: EditorialCopy; onOpen: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const selected = useRef(0);
  const manualSelection = useRef(false);
  const manualTravel = useRef(0);
  const clearPanIntent = useRef<(() => void) | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState(0);
  const [candidate, setCandidate] = useState(0);
  const select = (index: number, manual = true) => {
    if (manual) {
      if (hover.current) clearTimeout(hover.current);
      hover.current = null;
      manualSelection.current = true;
      manualTravel.current = 0;
      clearPanIntent.current?.();
    }
    selected.current = index;
    setStep(index);
  };
  useEffect(() => {
    const target = root.current;
    if (!target) return;
    const small = window.matchMedia('(max-width: 760px), (max-height: 800px)');
    let frame = 0;
    type PanIntent = {
      kind: 'touch' | 'pen';
      id: number;
      x: number;
      y: number;
      scrollStart: number;
      vertical: boolean;
      ended: boolean;
    };
    let pan: PanIntent | null = null;
    let panIdle = 0;
    let penContact: number | null = null;
    const clearPan = () => {
      pan = null;
      window.clearTimeout(panIdle);
      panIdle = 0;
    };
    clearPanIntent.current = clearPan;
    const awaitPanEnd = () => {
      const current = pan;
      window.clearTimeout(panIdle);
      if (current?.ended)
        panIdle = window.setTimeout(() => {
          if (pan === current) {
            consumePanTravel();
            clearPan();
            schedule();
          }
        }, 200);
    };
    const consumePanTravel = () => {
      if (pan?.vertical && Math.abs(window.scrollY - pan.scrollStart) >= 80) {
        manualSelection.current = false;
        clearPan();
      }
    };
    const update = () => {
      frame = 0;
      consumePanTravel();
      if (small.matches) return;
      if (
        target.contains(document.activeElement) &&
        document.activeElement?.matches(':focus-visible')
      )
        return;
      // Native focus/scroll anchoring must not discard a candidate selection.
      // Explicit wheel, page or native pan intent hands control back to the story.
      if (manualSelection.current) return;
      const rect = target.getBoundingClientRect();
      const position = Math.max(
        0,
        Math.min(
          3.999,
          ((80 - rect.top) / Math.max(1, target.offsetHeight - window.innerHeight)) * 4,
        ),
      );
      const next = Math.floor(position);
      if (
        next !== selected.current &&
        (next > selected.current ? position > next + 0.05 : position < next + 0.95)
      )
        select(next, false);
    };
    const schedule = () => {
      if (pan?.ended) awaitPanEnd();
      if (!frame) frame = requestAnimationFrame(update);
    };
    const wheel = (event: WheelEvent) => {
      clearPan();
      penContact = null;
      if (!manualSelection.current) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      manualTravel.current += Math.abs(event.deltaY) * scale;
      if (manualTravel.current >= 80) manualSelection.current = false;
    };
    const pageKey = (event: KeyboardEvent) => {
      clearPan();
      penContact = null;
      if (
        event.target instanceof Element &&
        event.target.closest('a,button,input,select,textarea,[contenteditable="true"]')
      )
        return;
      if (['PageDown', 'PageUp', 'Home', 'End', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key))
        manualSelection.current = false;
    };
    const outsidePointer = (event: PointerEvent) => {
      clearPan();
      const inside = event.target instanceof Node && target.contains(event.target);
      penContact = inside && event.pointerType === 'pen' ? event.pointerId : null;
      if (!inside) manualSelection.current = false;
      else if (manualSelection.current && event.pointerType === 'pen' && event.isPrimary)
        pan = {
          kind: 'pen',
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          scrollStart: window.scrollY,
          vertical: false,
          ended: false,
        };
    };
    const movePan = (x: number, y: number) => {
      if (!pan) return;
      const dx = Math.abs(x - pan.x);
      const dy = Math.abs(y - pan.y);
      if (dy >= 8 && dy > dx) pan.vertical = true;
      schedule();
    };
    const touchStart = (event: TouchEvent) => {
      clearPan();
      if (
        !manualSelection.current ||
        event.touches.length !== 1 ||
        !(event.target instanceof Node) ||
        !target.contains(event.target)
      )
        return;
      const touch = event.touches[0]!;
      pan = {
        kind: 'touch',
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        scrollStart: window.scrollY,
        vertical: false,
        ended: false,
      };
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        clearPan();
        return;
      }
      if (pan?.kind !== 'touch') return;
      const touch = event.touches[0]!;
      if (touch.identifier === pan.id) movePan(touch.clientX, touch.clientY);
    };
    const endPan = () => {
      if (!pan?.vertical) {
        clearPan();
        return;
      }
      pan.ended = true;
      schedule();
    };
    const penMove = (event: PointerEvent) => {
      if (pan?.kind === 'pen' && pan.id === event.pointerId) movePan(event.clientX, event.clientY);
    };
    const penEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'pen' || penContact !== event.pointerId) return;
      penContact = null;
      if (event.type === 'pointercancel' && manualSelection.current) {
        // The browser may take over a pen pan before delivering its first move.
        // Only subsequent actual page travel can release the selected stage.
        clearPan();
        pan = {
          kind: 'pen',
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          scrollStart: window.scrollY,
          vertical: true,
          ended: true,
        };
        schedule();
      } else endPan();
    };
    const scrollEnd = () => {
      if (pan?.ended) {
        consumePanTravel();
        clearPan();
        schedule();
      }
    };
    const resize = () => {
      clearPan();
      penContact = null;
      schedule();
    };
    const cancelPan = () => {
      clearPan();
      penContact = null;
    };
    const visibility = () => {
      if (document.hidden) cancelPan();
    };
    const touchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0 && pan?.kind === 'touch') endPan();
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scrollend', scrollEnd, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('keydown', pageKey);
    window.addEventListener('pointerdown', outsidePointer, { passive: true });
    window.addEventListener('pointermove', penMove, { passive: true });
    window.addEventListener('pointerup', penEnd, { passive: true });
    window.addEventListener('pointercancel', penEnd, { passive: true });
    window.addEventListener('touchstart', touchStart, { passive: true });
    window.addEventListener('touchmove', touchMove, { passive: true });
    window.addEventListener('touchend', touchEnd, { passive: true });
    window.addEventListener('touchcancel', cancelPan, { passive: true });
    window.addEventListener('blur', cancelPan);
    document.addEventListener('visibilitychange', visibility);
    update();
    return () => {
      cancelAnimationFrame(frame);
      cancelPan();
      clearPanIntent.current = null;
      if (hover.current) clearTimeout(hover.current);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('scrollend', scrollEnd);
      window.removeEventListener('resize', resize);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', pageKey);
      window.removeEventListener('pointerdown', outsidePointer);
      window.removeEventListener('pointermove', penMove);
      window.removeEventListener('pointerup', penEnd);
      window.removeEventListener('pointercancel', penEnd);
      window.removeEventListener('touchstart', touchStart);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', touchEnd);
      window.removeEventListener('touchcancel', cancelPan);
      window.removeEventListener('blur', cancelPan);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const ActiveIcon = stepIcons[step]!;
  return (
    <div className="agent-story" ref={root} data-step={step}>
      <div className="agent-story-sticky">
        <div className="agent-visual" data-step={step} data-candidate={candidate}>
          <div className="agent-visual-top">
            <Sparkle size={22} weight="light" />
            <span>Agent</span>
            <span>{c.demo}</span>
          </div>
          <div className="agent-visual-canvas">
            <div className="agent-photo-source">
              <EditorialImage name="agent-night" alt={c.agentSteps[0]!.detail} />
              <span>{c.source}</span>
            </div>
            <svg className="agent-flow-lines" viewBox="0 0 620 500" fill="none" aria-hidden="true">
              <path d="M164 195C164 312 470 126 470 270S300 370 300 438" />
              <path
                className="agent-flow-progress"
                d="M164 195C164 312 470 126 470 270S300 370 300 438"
                pathLength="1"
                style={{ strokeDasharray: 1, strokeDashoffset: 1 - (step + 1) / 4 }}
              />
            </svg>
            <div className="agent-prompt">
              <ChatCircleDots size={18} />
              <p>{c.agentSteps[0]!.detail}</p>
            </div>
            <div className="agent-tools" aria-hidden={step < 1}>
              {[
                ['EV', '+0.20', 62],
                ['SH', '+14', 64],
                ['HI', '−10', 40],
              ].map(([key, value, position], index) => (
                <div
                  key={key}
                  style={
                    {
                      '--item-index': index,
                      '--parameter-position': `${position}%`,
                    } as CSSProperties
                  }
                >
                  <span>{key}</span>
                  <i />
                  <output>{value}</output>
                </div>
              ))}
            </div>
            <div className="agent-candidates" aria-hidden={step < 2} inert={step < 2}>
              {[c.candidateA, c.candidateB].map((name, index) => (
                <div key={name} className="agent-candidate" data-selected={candidate === index}>
                  <EditorialImage name={`agent-candidate-${index}`} alt={name} />
                  <button
                    type="button"
                    aria-pressed={candidate === index}
                    onFocus={() => select(Math.max(2, selected.current))}
                    onClick={() => {
                      select(Math.max(2, selected.current));
                      setCandidate(index);
                    }}
                  >
                    <span>{name}</span>
                    {candidate === index && <Check size={14} />}
                  </button>
                </div>
              ))}
            </div>
            <div className="agent-decision" aria-hidden={step < 3}>
              <Check size={20} />
              <span>{c.agentSteps[3]!.detail}</span>
            </div>
            <div className="agent-active-mark">
              <ActiveIcon size={20} />
              <span>{c.agentSteps[step]!.short}</span>
            </div>
          </div>
          <div className="agent-visual-footer">
            <span>{c.agentSteps[step]!.detail}</span>
            <b>
              0{step + 1}
              <small> / 04</small>
            </b>
          </div>
        </div>
        <div className="agent-story-copy">
          <ol className="agent-steps" aria-label={c.agentLabel}>
            {c.agentSteps.map((item, index) => (
              <li key={item.title} data-active={step === index} data-complete={step > index}>
                <button
                  type="button"
                  aria-pressed={step === index}
                  onClick={() => select(index)}
                  onFocus={() => select(index)}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'mouse') return;
                    if (hover.current) clearTimeout(hover.current);
                    hover.current = setTimeout(() => {
                      hover.current = null;
                      select(index);
                    }, 150);
                  }}
                  onPointerLeave={() => {
                    if (hover.current) clearTimeout(hover.current);
                    hover.current = null;
                  }}
                >
                  <span className="agent-step-index">
                    {step > index ? <Check size={15} /> : `0${index + 1}`}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="agent-controls">
            <button
              type="button"
              aria-label={c.previous}
              disabled={step === 0}
              onClick={() => select(step - 1)}
            >
              <ArrowLeft size={19} />
            </button>
            <span>0{step + 1} / 04</span>
            <button
              type="button"
              aria-label={c.next}
              disabled={step === 3}
              onClick={() => select(step + 1)}
            >
              <ArrowRight size={19} />
            </button>
            <button className="agent-open" type="button" onClick={onOpen}>
              {c.agentOpen}
              <ArrowUpRight size={16} />
            </button>
          </div>
          <p className="about-caption">{c.agentCaption}</p>
        </div>
      </div>
    </div>
  );
}
