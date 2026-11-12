import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { StatusMark, type StatusMarkState } from '../components/StatusMark';
import { StudioGlyph } from '../components/StudioGlyph';
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

/** #111's compact line and optional trace, driven solely by public execution events. */
export function ExecutionStatus({
  label,
  state,
  events,
}: {
  label: string;
  state: StatusMarkState;
  events: readonly PublicExecutionEvent[];
}) {
  if (!label && !events.length) return null;
  const latest = events.at(-1);
  const summary = label || (latest ? `${t(latest.label)} · ${stateLabel(latest.state)}` : '');
  const line = (
    <>
      <StatusMark state={state} size="small" />
      <span aria-live="polite">{summary}</span>
    </>
  );
  if (!events.length) return <div className="ai-execution-line">{line}</div>;
  return (
    <MotionDetails className="ai-execution-trace">
      <summary aria-label={`${t('最近执行记录')}: ${summary}`}>
        {line}
        <StudioGlyph name="chevron" size={13} />
      </summary>
      <ol aria-label={t('最近执行记录')}>
        {events.map((event) => (
          <li key={`${event.runId}:${event.id}`}>
            <StatusMark state={event.state} size="small" />
            <span>{t(event.label)}</span>
            <small>{stateLabel(event.state)}</small>
          </li>
        ))}
      </ol>
    </MotionDetails>
  );
}
