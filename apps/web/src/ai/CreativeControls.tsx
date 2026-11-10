import type { AssistantGrant, CreativeBrief } from '@ai-xiutu/contracts';

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
      <details className="assistant-context">
        <summary>创作方向 · {value.brief.feeling || '用自己的话描述感觉'}</summary>
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
            <label>
              变化程度
              <select
                value={value.brief.strength}
                onChange={(e) => brief({ strength: e.target.value as CreativeBrief['strength'] })}
              >
                <option value="subtle">轻微自然</option>
                <option value="balanced">适度调整</option>
                <option value="bold">大胆创作</option>
              </select>
            </label>
            <label>
              参考图主要用于
              <select
                value={value.brief.referenceIntent}
                onChange={(e) =>
                  brief({ referenceIntent: e.target.value as CreativeBrief['referenceIntent'] })
                }
              >
                <option value="style">借鉴风格</option>
                <option value="subject">保留主体</option>
                <option value="composition">借鉴构图</option>
                <option value="all">整体参考</option>
              </select>
            </label>
          </div>
        </fieldset>
      </details>
      <details className="assistant-context">
        <summary>
          执行方式 ·{' '}
          {{ suggest: '只建议', confirm: '预览确认', auto: '预算内自动执行' }[value.mode]}
        </summary>
        <fieldset disabled={disabled || !!grant} className="creative-fields">
          <label>
            AI 可以做到哪一步
            <select
              value={value.mode}
              onChange={(e) =>
                onChange({ ...value, mode: e.target.value as CreativeSettings['mode'] })
              }
            >
              <option value="suggest">只建议，保持当前图片</option>
              <option value="confirm">预览确认后执行</option>
              <option value="auto">在授权范围与预算内执行</option>
            </select>
          </label>
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
            : '模型调用消耗服务点。修改图片前保留候选与对比；授权到期或停止后不再继续操作。'}
        </p>
      </details>
    </div>
  );
}
