import { useMemo, useState } from 'react';
import { ArrowClockwise, ArrowCounterClockwise, CaretDown } from '../components/ControlGlyph';
import { formatNumber, t } from '../i18n';
import { recipeDifferences } from '../ai/recipeDiff';
import { interactionText } from '../workspace/interaction-copy';
import { historyDetails } from './history-details';
import { historyText } from './history-copy';
import type { EditorState } from './useEditor';

function formatValue(
  value: string | number | boolean,
  unit = '',
  userText = false,
  presence = false,
) {
  if (typeof value === 'boolean')
    return presence ? historyText(value ? '存在' : '无') : interactionText(value ? 'on' : 'off');
  return typeof value === 'number'
    ? `${formatNumber(value, { maximumFractionDigits: 4 })}${unit}`
    : userText
      ? value
      : historyText(value);
}

export function HistoryPanel({ editor }: { editor: EditorState }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const summaries = useMemo(
    () =>
      editor.history.map((item, index) =>
        index ? recipeDifferences(editor.history[index - 1]!.recipe, item.recipe) : [],
      ),
    [editor.history],
  );
  const detailed = useMemo(
    () =>
      expanded !== null && expanded > 0 && editor.history[expanded]
        ? historyDetails(editor.history[expanded - 1]!.recipe, editor.history[expanded]!.recipe)
        : [],
    [editor.history, expanded],
  );
  return (
    <section className="advanced-tool-family" data-motion="advanced-history">
      <div className="advanced-row history-actions">
        <button className="text-button" disabled={!editor.canUndo} onClick={editor.undo}>
          <ArrowCounterClockwise size={17} />
          {t('撤销本次编辑')}
        </button>
        <button className="text-button" disabled={!editor.canRedo} onClick={editor.redo}>
          <ArrowClockwise size={17} />
          {t('重做本次编辑')}
        </button>
      </div>
      <ol className="advanced-history-list detailed-history-list">
        {editor.history.map((item, index) => {
          const changes = summaries[index] ?? [];
          return (
            <li key={index} data-selected={index === editor.historyIndex}>
              <div className="history-entry-row">
                <button
                  className="history-restore"
                  onClick={() => editor.commit(item.recipe, t('从本地记录恢复：') + item.label)}
                  disabled={index === editor.historyIndex}
                >
                  <span className="history-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="history-entry-copy">
                    <strong>{t(item.label)}</strong>
                    {changes.length > 0 && (
                      <small>
                        {changes
                          .slice(0, 2)
                          .map(
                            (change) =>
                              `${t(change.label)} ${formatValue(change.before, change.unit)} → ${formatValue(change.after, change.unit)}`,
                          )
                          .join(' · ')}
                      </small>
                    )}
                    {index === 0 && <small>{interactionText('originalState')}</small>}
                  </span>
                  {index === editor.historyIndex && (
                    <small className="history-current">{t('当前')}</small>
                  )}
                </button>
                {index > 0 && (
                  <button
                    type="button"
                    className="history-expand"
                    aria-expanded={expanded === index}
                    aria-label={interactionText('historyDetails') + ' · ' + t(item.label)}
                    onClick={() => setExpanded(expanded === index ? null : index)}
                  >
                    <CaretDown size={15} />
                  </button>
                )}
              </div>
              {expanded === index && (
                <dl className="history-change-details">
                  {detailed.length ? (
                    detailed.map((detail, i) => (
                      <div key={i}>
                        <dt>
                          <span>
                            {detail.scopeIsUserName ? detail.scope : historyText(detail.scope)}
                          </span>
                          {historyText(detail.label)}
                        </dt>
                        <dd>
                          <span>
                            {formatValue(
                              detail.before,
                              detail.unit,
                              detail.valuesAreUserText,
                              detail.presence,
                            )}
                          </span>
                          <i aria-hidden>→</i>
                          <strong>
                            {formatValue(
                              detail.after,
                              detail.unit,
                              detail.valuesAreUserText,
                              detail.presence,
                            )}
                          </strong>
                        </dd>
                      </div>
                    ))
                  ) : (
                    <div>
                      <dt className="sr-only">{interactionText('historyDetails')}</dt>
                      <dd>{interactionText('noParameterChanges')}</dd>
                    </div>
                  )}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
