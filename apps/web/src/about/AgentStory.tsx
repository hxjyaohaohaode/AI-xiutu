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
  const manualAt = useRef<number | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState(0);
  const [candidate, setCandidate] = useState(0);
  const select = (index: number, manual = true) => {
    if (manual) {
      if (hover.current) clearTimeout(hover.current);
      hover.current = null;
      manualAt.current = window.scrollY;
    }
    selected.current = index;
    setStep(index);
  };
  useEffect(() => {
    const target = root.current;
    if (!target) return;
    const small = window.matchMedia('(max-width: 760px), (max-height: 800px)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (small.matches) return;
      if (
        target.contains(document.activeElement) &&
        document.activeElement?.matches(':focus-visible')
      )
        return;
      if (manualAt.current !== null) {
        if (Math.abs(window.scrollY - manualAt.current) < 80) return;
        manualAt.current = null;
      }
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
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      if (hover.current) clearTimeout(hover.current);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
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
                    onClick={() => setCandidate(index)}
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
