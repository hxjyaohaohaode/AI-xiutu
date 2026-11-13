import {
  OPENAI_AUDIO_CHAT_FORMATS,
  OPENAI_AUDIO_CHAT_VOICES,
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_SPEECH_FORMATS,
  openAISpeechVoices,
  type OpenAISpecialistOperation,
} from '@ai-xiutu/contracts';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { t } from '../i18n';

export const specialistTaskLabels = {
  speak: 'AI 朗读',
  'audio-chat': '音频问答',
  'web-search': '联网搜索',
  embed: '文本向量',
  'translate-audio': '语音翻译',
} satisfies Record<OpenAISpecialistOperation, string>;

export function specialistDefaults(
  operation: OpenAISpecialistOperation,
): Record<string, string | number> {
  if (operation === 'speak') return { voice: 'alloy', format: 'mp3' };
  if (operation === 'audio-chat') return { output: 'audio', voice: 'alloy', format: 'wav' };
  if (operation === 'web-search') return { size: 'medium' };
  if (operation === 'translate-audio') return { language: 'en' };
  return { encoding: 'float' };
}

export function SpecialistOptions({
  operation,
  modelId,
  disabled,
  values,
  onChange,
}: {
  operation: OpenAISpecialistOperation;
  modelId: string;
  disabled: boolean;
  values: Record<string, string | number>;
  onChange: (values: Record<string, string | number>) => void;
}) {
  const update = (key: string, value: string | number | undefined) => {
    const next = { ...values };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const choose = (key: string, label: string, valuesList: readonly string[]) => (
    <ChoiceSelect
      label={t(label)}
      value={String(values[key] ?? valuesList[0])}
      onValueChange={(value) => update(key, value)}
      disabled={disabled}
      options={valuesList.map((value) => ({ value, label: value }))}
    />
  );
  const numeric = (
    key: string,
    label: string,
    min: number,
    max: number,
    step: string,
    fallback: number,
  ) => (
    <label>
      {t(label)}
      <input
        type="number"
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={values[key] ?? ''}
        placeholder={String(fallback)}
        onChange={(event) =>
          update(key, event.target.value ? event.target.valueAsNumber : undefined)
        }
      />
    </label>
  );
  const input = (key: string, label: string, maxLength: number, placeholder?: string) => (
    <label>
      {t(label)}
      <input
        value={values[key] ?? ''}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );
  const dimensions =
    OPENAI_EMBEDDING_DIMENSIONS[modelId as keyof typeof OPENAI_EMBEDDING_DIMENSIONS];
  return (
    <section className="ai-option-section field-grid">
      {operation === 'speak' && (
        <>
          {choose('voice', '音色', openAISpeechVoices(modelId))}
          {choose('format', '音频格式', OPENAI_SPEECH_FORMATS)}
          {numeric('speed', '朗读速度（0.25–4）', 0.25, 4, 'any', 1)}
          {!modelId.startsWith('tts-1') && input('instructions', '朗读风格提示', 600)}
        </>
      )}
      {operation === 'audio-chat' && (
        <>
          {choose('output', '音频问答输出', ['text', 'audio'])}
          {values.output === 'audio' && choose('voice', '音色', OPENAI_AUDIO_CHAT_VOICES)}
          {values.output === 'audio' && choose('format', '音频格式', OPENAI_AUDIO_CHAT_FORMATS)}
          {numeric('maxCompletionTokens', '每次响应的输出预算', 16, 2048, '1', 512)}
        </>
      )}
      {operation === 'web-search' && (
        <>
          {choose('size', '搜索上下文规模', ['low', 'medium', 'high'])}
          {input('city', '搜索城市', 100)}
          {input('country', '搜索国家代码', 2, 'US')}
          {input('region', '搜索地区', 100)}
          {input('timezone', '搜索时区', 60, 'America/Los_Angeles')}
        </>
      )}
      {operation === 'embed' && (
        <>
          {choose('encoding', '向量输出编码', ['float', 'base64'])}
          {dimensions &&
            modelId !== 'text-embedding-ada-002' &&
            numeric('dimensions', '向量维数', 1, dimensions, '1', dimensions)}
        </>
      )}
      {operation === 'translate-audio' && input('language', '翻译目标语言（ISO 639-1）', 2, 'en')}
    </section>
  );
}
