import type { FileTranscriptionOptions } from '@ai-xiutu/contracts';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { t } from '../i18n';

export function TranscriptionParameters({
  modelId,
  options,
  disabled,
  onChange,
}: {
  modelId: string;
  options: FileTranscriptionOptions;
  disabled: boolean;
  onChange: (options: FileTranscriptionOptions) => void;
}) {
  return (
    <section className="ai-option-section field-grid">
      <label>
        {t('转写语言（ISO 639-1）')}
        <input
          disabled={disabled || Boolean(options.languages?.length)}
          value={options.language ?? ''}
          maxLength={2}
          placeholder="zh"
          onChange={(event) => onChange({ ...options, language: event.target.value || undefined })}
        />
      </label>
      {modelId !== 'gpt-4o-transcribe-diarize' && (
        <label>
          {t('转写提示')}
          <input
            disabled={disabled}
            value={options.prompt ?? ''}
            maxLength={800}
            onChange={(event) => onChange({ ...options, prompt: event.target.value || undefined })}
          />
        </label>
      )}
      <label>
        {t('转写温度（0–1）')}
        <input
          type="number"
          min={0}
          max={1}
          step="any"
          disabled={disabled}
          value={options.temperature ?? ''}
          placeholder="0"
          onChange={(event) =>
            onChange({
              ...options,
              temperature: event.target.value === '' ? undefined : event.target.valueAsNumber,
            })
          }
        />
      </label>
      {modelId === 'gpt-transcribe' && (
        <>
          <label>
            {t('候选语言（用逗号分隔）')}
            <input
              disabled={disabled || Boolean(options.language)}
              defaultValue={options.languages?.join(', ') ?? ''}
              placeholder="zh, en"
              maxLength={64}
              onChange={(event) => {
                const languages = event.target.value
                  .split(/[,，]/)
                  .map((item) => item.trim())
                  .filter(Boolean);
                onChange({ ...options, languages: languages.length ? languages : undefined });
              }}
            />
          </label>
          <label>
            {t('转写关键词（用逗号分隔）')}
            <input
              disabled={disabled}
              defaultValue={options.keywords?.join(', ') ?? ''}
              maxLength={1000}
              onChange={(event) => {
                const keywords = event.target.value
                  .split(/[,，]/)
                  .map((item) => item.trim())
                  .filter(Boolean);
                onChange({ ...options, keywords: keywords.length ? keywords : undefined });
              }}
            />
          </label>
        </>
      )}
      {modelId === 'whisper-1' && (
        <ChoiceSelect
          label={t('转写时间戳')}
          disabled={disabled}
          value={options.timestamps ?? ''}
          onValueChange={(value) => onChange({ ...options, timestamps: value || undefined })}
          options={
            [
              { value: '', label: t('不请求时间戳') },
              { value: 'word', label: t('词级') },
              { value: 'segment', label: t('段级') },
              { value: 'both', label: t('词级与段级') },
            ] as const
          }
        />
      )}
    </section>
  );
}
