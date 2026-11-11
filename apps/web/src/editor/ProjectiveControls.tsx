import { t } from '../i18n';
import { createRecipeV4, migrateRecipeToV4 } from '@ai-xiutu/editor';
import { ParameterShelf, type ShelfControl } from './ParameterShelf';
import { currentV3, type InspectorController } from './advanced-model';
import { CORNER_LABELS, preProjectiveDimensions, withProjectiveCorner } from './projective-model';

export function ProjectiveControls({ controller }: { controller: InspectorController }) {
  const { editor, apply, report } = controller,
    recipe = currentV3(editor);
  if (recipe.schemaVersion !== 4)
    return (
      <div className="advanced-tool-family">
        <p className="control-note">
          {t('四角投影使用第四代配方。升级保留已有像素语义和历史，可撤销。')}
        </p>
        <button
          className="button button-secondary"
          onClick={() => {
            try {
              apply(migrateRecipeToV4(recipe), t('升级以启用四角变换'), true);
            } catch (e) {
              report(e instanceof Error ? e.message : t('无法升级。'));
            }
          }}
        >
          {t('启用四角自由变换')}
        </button>
      </div>
    );
  const dims = editor.dimensions ?? { width: 1, height: 1 },
    frame = preProjectiveDimensions(dims, recipe);
  const controls: ShelfControl[] = CORNER_LABELS.flatMap((label, i) =>
    (['x', 'y'] as const).map((axis) => ({
      id: `projective-${i}-${axis}`,
      label: t('{corner}{axis}', { corner: t(label), axis: t(axis === 'x' ? '水平' : '垂直') }),
      value: recipe.projective.corners[i]![axis] * (axis === 'x' ? frame.width : frame.height),
      min: -2 * (axis === 'x' ? frame.width : frame.height),
      max: 3 * (axis === 'x' ? frame.width : frame.height),
      step: 0.1,
      unit: 'px',
      onChange(value) {
        const current = currentV3(editor);
        if (current.schemaVersion !== 4) return;
        try {
          apply(
            withProjectiveCorner(
              current,
              i,
              {
                ...current.projective.corners[i]!,
                [axis]: value / (axis === 'x' ? frame.width : frame.height),
              },
              dims,
              editor.pixelBudget,
            ),
            '调整' + label,
          );
        } catch (e) {
          report(e instanceof Error ? e.message : '请保持四角轮廓不交叉。');
        }
      },
    })),
  );
  return (
    <section className="advanced-tool-family" data-motion="projective-controls">
      <p className="control-note">
        {t(
          '拖动照片四角自由调整透视。角点支持方向键 1px、Shift 10px、Alt 0.1px；Esc 取消这一拖动。',
        )}
      </p>
      <ParameterShelf
        controls={controls}
        label={t('四角逐点坐标')}
        onCommit={(name) => editor.commitCurrent(name)}
        onCancel={editor.cancelPreview}
      />
      <div className="tonal-tabs" aria-label={t('四角变换的画幅')}>
        <button
          type="button"
          aria-pressed={recipe.projective.fit === 'contain'}
          onClick={() =>
            apply(
              { ...recipe, projective: { ...recipe.projective, fit: 'contain' } },
              t('容纳四角全部内容'),
              true,
            )
          }
        >
          {t('容纳全部')}
        </button>
        <button
          type="button"
          aria-pressed={recipe.projective.fit === 'crop'}
          onClick={() =>
            apply(
              { ...recipe, projective: { ...recipe.projective, fit: 'crop' } },
              t('保留变换前画幅'),
              true,
            )
          }
        >
          {t('保留画幅')}
        </button>
        <button
          type="button"
          aria-pressed={recipe.projective.enabled}
          onClick={() =>
            apply(
              {
                ...recipe,
                projective: { ...recipe.projective, enabled: !recipe.projective.enabled },
              },
              recipe.projective.enabled ? t('暂时关闭四角变换') : t('启用四角变换'),
              true,
            )
          }
        >
          {recipe.projective.enabled ? t('暂时关闭') : t('启用效果')}
        </button>
      </div>
      <button
        className="text-button"
        onClick={() =>
          apply({ ...recipe, projective: createRecipeV4().projective }, t('重置四角变换'), true)
        }
      >
        {t('恢复四角原位')}
      </button>
    </section>
  );
}
