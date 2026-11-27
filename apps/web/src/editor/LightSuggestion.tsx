import { useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import {
  measureSceneTone, sceneBalanceChanges, sceneBalanceStrategies,
  type EditorRecipe, type SceneBalanceStrategy,
} from '@ai-xiutu/editor';
import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import type { EditorState } from './useEditor';

const strategies: Record<SceneBalanceStrategy, string> = {
  balanced: '平衡明暗',
  'open-shadows': '展开暗部',
  'retain-highlights': '保护亮部',
  'preserve-night': '保留夜景',
};
const controlLabel = { exposure: '曝光', shadows: '阴影', highlights: '高光' } as const;

export function LightSuggestion({
  editor,
  apply,
}: {
  editor: EditorState;
  apply: (recipe: EditorRecipe, label: string) => void;
}) {
  const [strategy, setStrategy] = useState<SceneBalanceStrategy>('balanced');
  const [plan, setPlan] = useState<{
    recipe: EditorRecipe;
    source: number;
    changes: ReturnType<typeof sceneBalanceChanges>;
  } | null>(null);
  const ready = editor.rendered && !editor.rendering && !editor.isLoading() &&
    !editor.hasUncommittedPreview && !editor.isInteractive && editor.renderedRecipe === editor.recipe;
  const currentPlan = ready && plan?.recipe === editor.recipe &&
    plan.source === editor.getSourceIdentity() ? plan : null;

  function inspect() {
    const base = editor.getRecipe();
    if (!ready || !editor.rendered || editor.renderedRecipe !== base || editor.isLoading()) return;
    const stride = Math.ceil(editor.rendered.width * editor.rendered.height / 65_536);
    const tone = measureSceneTone(editor.rendered, stride);
    const changes = sceneBalanceChanges(base.adjustments, tone, strategy, 0.75);
    setPlan({ recipe: base, source: editor.getSourceIdentity(), changes });
  }

  function commit() {
    if (!currentPlan || !currentPlan.changes.length || editor.isLoading() ||
      currentPlan.recipe !== editor.getRecipe() || currentPlan.source !== editor.getSourceIdentity())
      return;
    const adjustments = { ...currentPlan.recipe.adjustments };
    for (const { id, value } of currentPlan.changes) adjustments[id] = value;
    apply({ ...currentPlan.recipe, adjustments }, t('应用光线建议'));
    setPlan(null);
  }

  return (
    <MotionDetails className="advanced-disclosure editor-light-suggestion">
      <summary><Sparkle size={16} aria-hidden />{t('光线建议')}</summary>
      <div className="editor-light-options">
        <select
          aria-label={t('光线方向')}
          value={strategy}
          onChange={event => {
            setStrategy(event.target.value as SceneBalanceStrategy);
            setPlan(null);
          }}
        >
          {sceneBalanceStrategies.map(value => <option key={value} value={value}>{t(strategies[value])}</option>)}
        </select>
        <button className="button button-secondary" type="button" disabled={!ready} onClick={inspect}>
          {t('分析当前画面')}
        </button>
      </div>
      {currentPlan && (currentPlan.changes.length ? (
        <div className="editor-light-result">
          <ul aria-label={t('建议参数')}>
            {currentPlan.changes.map(({ id, value }) => (
              <li key={id}>
                {t(controlLabel[id])} <strong>{currentPlan.recipe.adjustments[id]} → {value}{id === 'exposure' ? ' EV' : ''}</strong>
              </li>
            ))}
          </ul>
          <button type="button" className="button button-primary" onClick={commit}>{t('应用光线建议')}</button>
        </div>
      ) : <p role="status">{t('当前画面无需这项调整。')}</p>)}
    </MotionDetails>
  );
}
