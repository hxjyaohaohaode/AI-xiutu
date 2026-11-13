import type { ResponsesOptions, responsesModel } from '@ai-xiutu/assistant/models';
import { t } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';
import { CheckControl } from './CheckControl';

export function ResponsesModelOptions({
  profile,
  effort,
  value,
  disabled,
  onChange,
}: {
  profile: NonNullable<ReturnType<typeof responsesModel>>;
  effort?: string;
  value?: ResponsesOptions;
  disabled: boolean;
  onChange: (value: ResponsesOptions) => void;
}) {
  const options = value ?? {};
  const format = options.format?.type ?? '';
  const sampling =
    profile.sampling === 'always' ||
    (profile.sampling === 'without-reasoning' && (effort ?? profile.defaultEffort) === 'none');
  const schema = options.format?.type === 'json_schema' ? options.format : null;
  const update = <K extends keyof ResponsesOptions>(name: K, value: ResponsesOptions[K]) => {
    const next = { ...options, [name]: value };
    if (value === undefined) delete next[name];
    onChange(next);
  };
  const select = (
    label: string,
    current: string | undefined,
    choices: readonly string[],
    change: (value: string) => void,
    defaultLabel = '使用官方默认',
  ) => (
    <label>
      {t(label)}
      <ChoiceSelect
        ariaLabel={t(label)}
        disabled={disabled}
        value={current ?? ''}
        onValueChange={change}
        options={[
          { value: '', label: t(defaultLabel) },
          ...choices.map((value) => ({ value, label: value })),
        ]}
      />
    </label>
  );
  return (
    <>
      {profile.reasoningMode &&
        select(
          '推理模式',
          options.reasoningMode,
          ['standard', 'pro'],
          (value) =>
            update('reasoningMode', (value || undefined) as ResponsesOptions['reasoningMode']),
          '默认 standard',
        )}
      {profile.verbosity &&
        select(
          '回答详细度',
          options.verbosity,
          ['low', 'medium', 'high'],
          (value) => update('verbosity', (value || undefined) as ResponsesOptions['verbosity']),
          '默认 medium',
        )}
      {!!profile.summaries.length &&
        select(
          '模型推理摘要',
          options.reasoningSummary,
          profile.summaries,
          (value) =>
            update(
              'reasoningSummary',
              (value || undefined) as ResponsesOptions['reasoningSummary'],
            ),
          '不请求摘要',
        )}
      {select(
        '输出格式',
        format,
        [
          'text',
          ...(profile.jsonObject ? ['json_object'] : []),
          ...(profile.structuredOutputs ? ['json_schema'] : []),
        ],
        (value) => {
          if (value === 'json_schema')
            update('format', {
              type: 'json_schema',
              name: 'response',
              strict: true,
              schema: {
                type: 'object',
                properties: { answer: { type: 'string' } },
                required: ['answer'],
                additionalProperties: false,
              },
            });
          else
            update(
              'format',
              value === 'text' || value === 'json_object' ? { type: value } : undefined,
            );
        },
        '默认 text',
      )}
      {schema && (
        <>
          <label>
            {t('JSON Schema 名称')}
            <input
              disabled={disabled}
              required
              maxLength={64}
              pattern="[A-Za-z0-9_\-]+"
              value={schema.name}
              onChange={(event) => update('format', { ...schema, name: event.target.value })}
            />
          </label>
          <label className="response-schema-field">
            {t('JSON Schema')}
            <textarea
              key={profile.id}
              required
              disabled={disabled}
              defaultValue={JSON.stringify(schema.schema, null, 2)}
              maxLength={12000}
              rows={6}
              onChange={(event) => {
                const input = event.currentTarget;
                try {
                  const parsed: unknown = JSON.parse(input.value);
                  if (
                    !parsed ||
                    typeof parsed !== 'object' ||
                    Array.isArray(parsed) ||
                    !('type' in parsed) ||
                    parsed.type !== 'object'
                  )
                    throw new Error('Expected an object schema');
                  update('format', { ...schema, schema: parsed as Record<string, unknown> });
                  input.setCustomValidity('');
                } catch {
                  input.setCustomValidity(t('请输入根类型为 object 的有效 JSON Schema。'));
                }
              }}
            />
          </label>
          <CheckControl
            className="response-schema-strict"
            disabled={disabled}
            checked={schema.strict}
            label={t('严格遵循 JSON Schema')}
            onChange={(event) => update('format', { ...schema, strict: event.target.checked })}
          />
        </>
      )}
      {sampling &&
        (['temperature', 'topP'] as const).map((key) => (
          <label key={key}>
            {key === 'temperature' ? t('采样温度（0–2）') : t('核采样 top_p（0–1）')}
            <input
              type="number"
              min={0}
              max={key === 'temperature' ? 2 : 1}
              step="any"
              disabled={disabled}
              value={options[key] ?? ''}
              placeholder="1"
              onChange={(event) =>
                update(key, event.target.value === '' ? undefined : Number(event.target.value))
              }
            />
          </label>
        ))}
      {profile.tiers.length > 1 &&
        select(
          'OpenAI 服务档位',
          options.serviceTier,
          profile.tiers.filter((value) => value !== 'default'),
          (value) => update('serviceTier', (value || undefined) as ResponsesOptions['serviceTier']),
          'Standard',
        )}
      {select(
        'Responses 传输',
        options.transport,
        ['http', 'websocket'],
        (value) => update('transport', (value || undefined) as ResponsesOptions['transport']),
        '默认 HTTP',
      )}
    </>
  );
}
