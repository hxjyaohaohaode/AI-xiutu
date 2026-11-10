import { MotionDetails } from '../motion/Presence';
import type { AssistantGrant, CreativeBrief } from '@ai-xiutu/contracts';
import { ChoiceSelect } from '../components/ChoiceSelect';

export interface CreativeSettings {
  mode: 'suggest' | 'confirm' | 'auto';
  unitLimit: number;
  stepLimit: number;
  brief: CreativeBrief;
}
export const initialCreativeSettings = (): CreativeSettings => ({
  mode: 'confirm',
  unitLimit: 100,
  stepLimit: 12,
  brief: {
    feeling: '',
    purpose: '',
    preserve: '人物特征、自然肤质、原有主体',
    avoid: '过度磨皮、假白、肢体变形、无关文字和水印',
    strength: 'balanced',
    referenceIntent: 'style',
  },
});
export function CreativeControls({
  value,
  onChange,
  disabled,
  grant,
  onAuthorize,
  onRevoke,
}: {
  value: CreativeSettings;
  onChange: (value: CreativeSettings) => void;
  disabled: boolean;
  grant: AssistantGrant | null;
  onAuthorize: () => void;
  onRevoke: () => void;
}) {
  const brief = (patch: Partial<CreativeBrief>) =>
    onChange({ ...value, brief: { ...value.brief, ...patch } });
  return (
    <div className="creative-controls">
      <MotionDetails className="assistant-context">
        <summary>创作方向{value.brief.feeling ? ` · ${value.brief.feeling}` : ''}</summary>
        <fieldset disabled={disabled} className="creative-fields">
          <label>
            想要的感觉
            <textarea
              maxLength={1200}
              rows={2}
              value={value.brief.feeling}
              placeholder="例如：有午后电影的感觉，温暖安静，皮肤还是像本人"
              onChange={(e) => brief({ feeling: e.target.value })}
            />
          </label>
          <label>
            用途
            <input
              maxLength={300}
              value={value.brief.purpose}
              placeholder="头像、旅行记录、商品展示……"
              onChange={(e) => brief({ purpose: e.target.value })}
            />
          </label>
          <label>
            一定保留
            <input
              maxLength={800}
              value={value.brief.preserve}
              onChange={(e) => brief({ preserve: e.target.value })}
            />
          </label>
          <label>
            避免出现
            <input
              maxLength={800}
              value={value.brief.avoid}
              onChange={(e) => brief({ avoid: e.target.value })}
            />
          </label>
          <div className="creative-pair">
            <ChoiceSelect
              label="变化程度"
              value={value.brief.strength}
              disabled={disabled}
              onValueChange={(strength) =>
                brief({ strength: strength as CreativeBrief['strength'] })
              }
              options={[
                { value: 'subtle', label: '轻微自然' },
                { value: 'balanced', label: '适度调整' },
                { value: 'bold', label: '大胆创作' },
              ]}
            />
            <ChoiceSelect
              label="参考图主要用于"
              value={value.brief.referenceIntent}
              disabled={disabled}
              onValueChange={(referenceIntent) =>
                brief({ referenceIntent: referenceIntent as CreativeBrief['referenceIntent'] })
              }
              options={[
                { value: 'style', label: '借鉴风格' },
                { value: 'subject', label: '保留主体' },
                { value: 'composition', label: '借鉴构图' },
                { value: 'all', label: '整体参考' },
              ]}
            />
          </div>
        </fieldset>
      </MotionDetails>
      <MotionDetails className="assistant-context">
        <summary>
          执行方式 ·{' '}
          {{ suggest: '只建议', confirm: '预览确认', auto: '预算内自动执行' }[value.mode]}
        </summary>
        <fieldset disabled={disabled || !!grant} className="creative-fields">
          <ChoiceSelect
            label="AI 可以做到哪一步"
            value={value.mode}
            disabled={disabled || !!grant}
            onValueChange={(mode) => onChange({ ...value, mode: mode as CreativeSettings['mode'] })}
            options={[
              { value: 'suggest', label: '只建议', description: '提供建议，保持当前图片' },
              { value: 'confirm', label: '预览确认', description: '确认候选后再修改图片' },
              {
                value: 'auto',
                label: '预算内自动执行',
                description: '需要明确授权范围、点数和操作次数',
              },
            ]}
          />
          {value.mode === 'auto' && (
            <div className="creative-pair">
              <label>
                本次最多服务点
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={value.unitLimit}
                  onChange={(e) => onChange({ ...value, unitLimit: Number(e.target.value) })}
                />
              </label>
              <label>
                最多操作次数
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={value.stepLimit}
                  onChange={(e) => onChange({ ...value, stepLimit: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
        </fieldset>
        {grant ? (
          <div className="creative-grant" role="status">
            <span>
              已使用 {grant.usedUnits} / {grant.unitLimit} 点 · {grant.usedSteps} /{' '}
              {grant.stepLimit} 次
            </span>
            <button type="button" onClick={onRevoke}>
              停止授权
            </button>
          </div>
        ) : value.mode === 'auto' ? (
          <button
            className="button button-primary"
            type="button"
            disabled={disabled}
            onClick={onAuthorize}
          >
            授权当前项目，30 分钟内有效
          </button>
        ) : null}
        <p className="creative-explanation">
          {value.mode === 'auto'
            ? '参数候选会自动保存为新版本，可从历史恢复。生图仍需选择模型与规格，费用计入本次预算；超过范围、版本冲突或结果未知时停止。'
            : value.mode === 'suggest'
              ? '只提供建议，不执行图片修改。模型调用仍会使用服务点。'
              : '先查看候选，确认后进入编辑器。模型调用使用服务点。'}
        </p>
      </MotionDetails>
    </div>
  );
}
