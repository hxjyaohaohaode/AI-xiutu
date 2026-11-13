import { useState } from 'react';
import {
  defaultLiveDecisionQuestions, liveDecisionQuestionsSchema, translationLanguages,
  type LiveDelegationOptions, type LiveTranslationOptions,
} from '@ai-xiutu/contracts';
import { t, useLocale } from '../i18n';

export function LiveModeSettings({
  disabled, mode, setMode, delegation, setDelegation, translation, setTranslation, tiers, maxOutputTokens,
}: {
  disabled: boolean;
  mode: 'client' | 'responses' | 'decisions' | 'translation';
  setMode: (mode: 'client' | 'responses' | 'decisions') => void;
  delegation: LiveDelegationOptions;
  setDelegation: (value: LiveDelegationOptions) => void;
  translation: LiveTranslationOptions;
  setTranslation: (value: LiveTranslationOptions) => void;
  tiers: readonly string[];
  maxOutputTokens: number;
}) {
  const locale = useLocale();
  const labels = new Intl.DisplayNames([locale], { type: 'language' });
  const [questionDraft, setQuestionDraft] = useState<string | undefined>();
  const [questionError, setQuestionError] = useState(false);
  if (mode === 'translation') return (
    <div className="voice-provider-options">
      <label>{t('同传目标语言')}
        <select disabled={disabled} value={translation.language}
          onChange={(event) => {
            const language = translationLanguages.find((value) => value === event.target.value);
            if (language) setTranslation({ ...translation, language });
          }}>
          {translationLanguages.map((language) => <option key={language} value={language}>{labels.of(language)} ({language})</option>)}
        </select>
      </label>
      <label className="voice-provider-check">
        <input type="checkbox" disabled={disabled} checked={translation.sourceTranscript ?? false}
          onChange={(event) => setTranslation({ ...translation, sourceTranscript: event.target.checked })} />
        {t('显示原语字幕')}
      </label>
      <label>{t('输入降噪')}
        <select disabled={disabled} value={translation.noiseReduction === null ? 'off' : translation.noiseReduction ?? ''}
          onChange={(event) => {
            const selected = event.target.value;
            setTranslation({ ...translation,
              noiseReduction: selected === 'off' ? null : selected === 'near_field' || selected === 'far_field' ? selected : undefined,
              noiseStrength: undefined,
            });
          }}>
          <option value="">{t('使用官方默认')}</option>
          <option value="off">{t('关闭')}</option>
          <option value="near_field">{t('近场')}</option>
          <option value="far_field">{t('远场')}</option>
        </select>
      </label>
      {!!translation.noiseReduction && (
        <label>{t('降噪强度')}
          <input type="number" min={0} max={1} step="0.05" disabled={disabled} value={translation.noiseStrength ?? 1}
            onChange={(event) => {
              const value = event.target.valueAsNumber;
              if (Number.isFinite(value) && value >= 0 && value <= 1)
                setTranslation({ ...translation, noiseStrength: value });
            }} />
        </label>
      )}
    </div>
  );
  return (
    <div className="voice-provider-options">
      <label>{t('GPT-Live 委派模式')}
        <select disabled={disabled} value={mode} onChange={(event) => {
          const value = event.target.value;
          if (value === 'client' || value === 'responses' || value === 'decisions') setMode(value);
        }}>
          <option value="client">{t('应用委派（修图与素材）')}</option>
          <option value="responses">{t('OpenAI 原生 Responses')}</option>
          <option value="decisions">{t('OpenAI 原生 Decisions')}</option>
        </select>
      </label>
      {delegation.type === 'responses' && (
        <>
          <label>{t('委派模型提示')}
            <textarea rows={2} maxLength={1600} disabled={disabled} value={delegation.prompt ?? ''}
              onChange={(event) => setDelegation({ ...delegation, prompt: event.target.value || undefined })} />
          </label>
          <label>{t('委派服务档位')}
            <select disabled={disabled} value={delegation.serviceTier ?? 'default'}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'auto' || value === 'default' || value === 'flex' || value === 'priority')
                  setDelegation({ ...delegation, serviceTier: value });
              }}>
              {['auto', 'default', ...['flex', 'priority'].filter((tier) => tiers.includes(tier))]
                .map((tier) => <option key={tier}>{tier}</option>)}
            </select>
          </label>
          <label>{t('委派输出 Token 上限')}
            <input type="number" min={16} max={maxOutputTokens} step={1} disabled={disabled}
              value={delegation.maxOutputTokens ?? ''} placeholder={String(maxOutputTokens)}
              onChange={(event) => setDelegation({ ...delegation, maxOutputTokens:
                event.target.value ? event.target.valueAsNumber : undefined })} />
          </label>
        </>
      )}
      {delegation.type === 'decisions' && (
        <>
          <label>{t('Decisions 问题（JSON）')}
            <textarea rows={5} disabled={disabled} maxLength={12000} spellCheck={false}
              value={questionDraft ?? JSON.stringify(delegation.questions, null, 2)}
              onChange={(event) => setQuestionDraft(event.target.value)} />
          </label>
          <button type="button" className="text-button" disabled={disabled || questionDraft === undefined}
            onClick={() => {
              try {
                const questions = liveDecisionQuestionsSchema.parse(JSON.parse(questionDraft ?? ''));
                setDelegation({ type: 'decisions', questions });
                setQuestionError(false);
                setQuestionDraft(undefined);
              } catch { setQuestionError(true); }
            }}>{t('应用问题设置')}</button>
          {questionError && <p role="alert">{t('请检查问题名称、JSON 格式及选项范围。')}</p>}
          {questionDraft !== undefined && <p className="fine-print">{t('点击应用后，下次通话使用新问题。')}</p>}
          <button type="button" className="text-button" disabled={disabled} onClick={() => {
            setDelegation({ type: 'decisions', questions: [...defaultLiveDecisionQuestions] });
            setQuestionDraft(undefined);
            setQuestionError(false);
          }}>{t('恢复示例问题')}</button>
        </>
      )}
    </div>
  );
}
