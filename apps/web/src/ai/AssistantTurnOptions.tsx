
import { useState } from 'react';
import { ArrowCounterClockwise, Check, SlidersHorizontal } from '@phosphor-icons/react';
import {
  responseFormatSchema, type AssistantResponsePricing, type AssistantResponseTuning,
} from '@ai-xiutu/contracts';
import { t } from '../i18n';
import './assistant-turn-options.css';

export type TextModelProfile = {
  reasoning: readonly NonNullable<AssistantResponseTuning['effort']>[];
  defaultEffort?: NonNullable<AssistantResponseTuning['effort']>;
  reasoningMode?: boolean;
  summaries?: readonly NonNullable<AssistantResponseTuning['reasoningSummary']>[];
  verbosity?: boolean;
  sampling?: 'none' | 'always' | 'without-reasoning';
  structuredOutputs?: boolean;
  jsonObject?: boolean;
  streaming?: boolean;
  tiers?: readonly NonNullable<AssistantResponseTuning['serviceTier']>[];
  deprecated?: boolean;
};

const starter = { type: 'object', properties: { answer: { type: 'string' } },
  required: ['answer'], additionalProperties: false };
type SchemaFormat = Extract<NonNullable<AssistantResponseTuning['format']>, { type: 'json_schema' }>;
const effortLabel = {
  none: '不推理', minimal: '最少', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高',
};
export function AssistantTurnOptions({ profile, defaults, price, maxOutputTokens, label, value,
  disabled, onChange, onSchemaValid, onClose,
}: {
  profile: TextModelProfile;
  defaults?: AssistantResponseTuning;
  price?: AssistantResponsePricing;
  maxOutputTokens: number;
  label: string;
  value: AssistantResponseTuning;
  disabled: boolean;
  onChange: (value: AssistantResponseTuning) => void;
  onSchemaValid: (valid: boolean) => void;
  onClose: () => void;
}) {
  const appliedEffort = value.effort ?? defaults?.effort ?? profile.defaultEffort;
  const appliedMode = value.reasoningMode ?? defaults?.reasoningMode;
  const sampling = appliedMode !== 'pro' &&
    (profile.sampling === 'always' || (profile.sampling === 'without-reasoning' && appliedEffort === 'none'));
  const schemaValue = value.format?.type === 'json_schema' ? value.format :
    defaults?.format?.type === 'json_schema' ? defaults.format : null;
  const [schemaText, setSchemaText] = useState(() => JSON.stringify(schemaValue?.schema ?? starter, null, 2));
  const [schemaName, setSchemaName] = useState(schemaValue?.name ?? 'response');
  const [strict, setStrict] = useState(schemaValue?.strict ?? true);
  const [schemaError, setSchemaError] = useState(false);
  const formatType = value.format?.type ?? defaults?.format?.type ?? 'text';
  const tierChoices = (profile.tiers ?? []).filter((tier) => tier === price?.defaultTier || price?.tierUnits[tier] !== undefined);
  const update = <K extends keyof AssistantResponseTuning>(key: K, next?: AssistantResponseTuning[K]) => {
    const result = { ...value, [key]: next };
    if (next === undefined) delete result[key];
    if (key === 'effort') {
      if (next !== 'none' && profile.sampling === 'without-reasoning') {
        delete result.temperature;
        delete result.topP;
      }
      if (next === 'none' && appliedMode === 'pro') result.reasoningMode = 'standard';
    }
    if (key === 'reasoningMode' && next === 'pro') {
      delete result.temperature;
      delete result.topP;
    }
    onChange(result);
  };
  function updateSchema(name: string, raw: string, isStrict: boolean) {
    setSchemaName(name);
    setSchemaText(raw);
    setStrict(isStrict);
    let format: SchemaFormat | undefined;
    try {
      const parsed = responseFormatSchema.safeParse({ type: 'json_schema', name, schema: JSON.parse(raw), strict: isStrict });
      if (parsed.success && parsed.data.type === 'json_schema') format = parsed.data;
    } catch { /* Form shows the validation message below. */ }
    setSchemaError(!format);
    onSchemaValid(!!format);
    if (format) update('format', format);
  }
  const select = <T extends string>(name: string, current: T | undefined, initial: string,
    choices: readonly T[], set: (item: T | undefined) => void, display = (item: T): string => item) => (
    <label>{t(name)}
      <select value={current ?? ''} disabled={disabled}
        onChange={(event) => set(choices.find((item) => item === event.target.value))}>
        <option value="">{t('默认')} · {initial}</option>
        {choices.map((item) => <option value={item} key={item}>{display(item)}</option>)}
      </select>
    </label>
  );
  return (
    <section className="assistant-turn-options" aria-label={t('本轮模型参数')} tabIndex={-1}>
      <header>
        <SlidersHorizontal size={17} />
        <div><strong>{t('本轮模型参数')}</strong><small>{label}</small></div>
        <button type="button" className="icon-button" aria-label={t('恢复本轮默认参数')} disabled={disabled}
          onClick={() => { onChange({}); setSchemaError(false); onSchemaValid(true);
            const schema = defaults?.format?.type === 'json_schema' ? defaults.format : undefined;
            setSchemaText(JSON.stringify(schema?.schema ?? starter, null, 2));
            setSchemaName(schema?.name ?? 'response'); setStrict(schema?.strict ?? true); }}>
          <ArrowCounterClockwise size={15} />
        </button>
        <button type="button" className="text-button" aria-label={t('完成参数设置')} disabled={schemaError} onClick={onClose}>
          <Check size={16} />
        </button>
      </header>
      <div className="assistant-turn-fields">
        {!!profile.reasoning.length && select('本轮推理档位', value.effort, appliedEffort ? t(effortLabel[defaults?.effort ?? profile.defaultEffort ?? appliedEffort]) : '—',
          profile.reasoning, (item) => update('effort', item), (item) => t(effortLabel[item]))}
        {profile.verbosity && select('回答详细度', value.verbosity, defaults?.verbosity ?? 'medium',
          ['low', 'medium', 'high'] as const, (item) => update('verbosity', item))}
        {profile.reasoningMode && (price?.proExtraUnits !== undefined || defaults?.reasoningMode === 'pro') &&
          select('推理模式', value.reasoningMode, defaults?.reasoningMode ?? 'standard',
            appliedEffort === 'none' ? ['standard'] as const : ['standard', 'pro'] as const,
            (item) => update('reasoningMode', item),
            (item) => item === 'pro' && defaults?.reasoningMode !== 'pro' ? 'pro +' + price?.proExtraUnits + ' ' + t('点') : item)}
        {!!profile.summaries?.length && appliedEffort !== 'none' &&
          select('模型推理摘要', value.reasoningSummary, defaults?.reasoningSummary ?? t('不请求摘要'),
            profile.summaries, (item) => update('reasoningSummary', item))}
        {tierChoices.length > 1 && select('OpenAI 服务档位', value.serviceTier, price?.defaultTier ?? 'default',
          tierChoices, (item) => update('serviceTier', item),
          (item) => price?.tierUnits[item] !== undefined ? item + ' · ' + price.tierUnits[item] + ' ' + t('点') : item)}
        {maxOutputTokens > 256 && <label>{t('最多输出 Token')}
          <input type="number" min={256} max={maxOutputTokens} step={1} disabled={disabled}
            placeholder={String(maxOutputTokens)} value={value.maxOutputTokens ?? ''}
            onChange={(event) => update('maxOutputTokens', event.target.value === '' ? undefined : Number(event.target.value))} />
        </label>}
        {(profile.jsonObject || profile.structuredOutputs) && select('输出格式', value.format?.type,
          defaults?.format?.type ?? 'text',
          ['text', ...(profile.jsonObject ? ['json_object' as const] : []), ...(profile.structuredOutputs ? ['json_schema' as const] : [])] as const,
          (item) => {
            if (item === 'json_schema') updateSchema(schemaName, schemaText, strict);
            else { setSchemaError(false); onSchemaValid(true); update('format', item ? { type: item } : undefined); }
          })}
        {sampling && (['temperature', 'topP'] as const).map((key) => <label key={key}>
          {t(key === 'temperature' ? '采样温度（0–2）' : '核采样 top_p（0–1）')}
          <input type="number" min={0} max={key === 'temperature' ? 2 : 1} step="any"
            placeholder={String(defaults?.[key] ?? 1)} value={value[key] ?? ''} disabled={disabled}
            onChange={(event) => update(key, event.target.value === '' ? undefined : Number(event.target.value))} />
        </label>)}
        {formatType === 'json_schema' && <div className="assistant-turn-schema">
          <label>{t('JSON Schema 名称')}<input value={schemaName} maxLength={64} disabled={disabled}
            onChange={(event) => updateSchema(event.target.value, schemaText, strict)} /></label>
          <label>JSON Schema<textarea value={schemaText} maxLength={12000} rows={5} disabled={disabled}
            onChange={(event) => updateSchema(schemaName, event.target.value, strict)} /></label>
          <label className="assistant-schema-strict"><input type="checkbox" checked={strict} disabled={disabled}
            onChange={(event) => updateSchema(schemaName, schemaText, event.target.checked)} /> {t('严格遵循 JSON Schema')}</label>
          {schemaError && <small role="alert">{t('请输入根类型为 object 的有效 JSON Schema。')}</small>}
        </div>}
      </div>
    </section>
  );
}
