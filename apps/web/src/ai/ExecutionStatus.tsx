import { Check, Pause, WarningCircle } from '@phosphor-icons/react';
import { t } from '../i18n';
import type { StatusMarkState } from '../components/StatusMark';
import ThoughtLine, { type ThoughtLineStep } from '../components/react-bits/ThoughtLine';
import LatticeLoader from '../components/react-bits/LatticeLoader';
import type { PublicExecutionEvent } from './execution-events';
import './interaction-v2.css';

const stateLabel = (state: StatusMarkState) =>
  ({
    pending: t('正在核对'),
    running: t('进行中'),
    done: t('已完成'),
    failed: t('未通过检查'),
    cancelled: t('已停止'),
    unknown: t('结果待核验'),
  })[state];

export function AssistantActivity({ label, color = 'var(--muted)' }: { label: string; color?: string }) {
  return <LatticeLoader className="ai-execution-line" pattern="sweep" grid={4} shape="round"
    label={label} color={color} cellSize={3} gap={1.5} fontSize={12} />;
}

/** Fold public tool receipts into the turn's status. Streaming text is rendered separately. */
export function ExecutionStatus({
  label,
  doneLabel,
  state,
  events,
}: {
  label: string;
  doneLabel: string;
  state: StatusMarkState;
  events: readonly PublicExecutionEvent[];
}) {
  const steps: ThoughtLineStep[] = [];
  const labelsById = new Map(events.map((event) => [event.id, event.label]));
  for (const event of events) {
    if (event.label === '本轮执行') continue;
    const step: ThoughtLineStep = {
      id: event.id,
      text: `${t(event.label)} · ${stateLabel(event.state)}`,
      state: event.state,
    };
    const previous = steps.at(-1);
    if (
      previous?.state === 'running' &&
      labelsById.get(previous.id) === event.label &&
      event.state !== 'running'
    )
      steps[steps.length - 1] = { ...step, id: previous.id };
    else steps.push(step);
  }
  const glyph = state === 'done' ? <Check /> : state === 'cancelled' ? <Pause />
    : state === 'failed' || state === 'unknown' ? <WarningCircle /> : 'sparkle';
  return <ThoughtLine className="ai-execution-trace" label={label} doneLabel={doneLabel}
    working={state === 'pending' || state === 'running'} glyph={glyph}
    glyphColor={state === 'done' ? 'var(--success)' : state === 'failed' ? 'var(--danger)' : 'var(--accent-ink)'}
    color="var(--ink)" fontSize={13} collapsible={steps.length > 0} steps={steps} />;
}
