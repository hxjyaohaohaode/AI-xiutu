import type { LiveOptions, RealtimeOptions } from '@ai-xiutu/assistant/models';
import { t } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';

export function VoiceModelOptions({
  protocol,
  live,
  realtime,
  models,
  disabled,
  onLive,
  onRealtime,
}: {
  protocol: string;
  live: LiveOptions;
  realtime: RealtimeOptions;
  models: string[];
  disabled: boolean;
  onLive: (options: LiveOptions) => void;
  onRealtime: (options: RealtimeOptions) => void;
}) {
  const select = (
    label: string,
    value: string,
    values: string[],
    update: (value: string) => void,
    fallback: string,
  ) => (
    <label>
      {t(label)}
      <ChoiceSelect
        ariaLabel={t(label)}
        value={value}
        disabled={disabled}
        onValueChange={update}
        options={[
          { value: '', label: t(fallback) },
          ...values.map((value) => ({ value, label: value })),
        ]}
      />
    </label>
  );
  const numeric = (
    label: string,
    value: number | undefined,
    min: number,
    max: number,
    step: number,
    fallback: number,
    update: (value: number | undefined) => void,
  ) => (
    <label>
      {t(label)}
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={String(fallback)}
        disabled={disabled}
        onChange={(event) =>
          update(event.target.value === '' ? undefined : Number(event.target.value))
        }
      />
    </label>
  );
  if (protocol === 'live')
    return (
      <>
        <label>
          {t('语音风格提示')}
          <textarea
            value={live.prompt ?? ''}
            maxLength={1200}
            rows={3}
            disabled={disabled}
            onChange={(event) => onLive({ ...live, prompt: event.target.value || undefined })}
          />
        </label>
        <label>
          {t('开场白')}
          <input
            value={live.opening ?? ''}
            maxLength={350}
            disabled={disabled}
            onChange={(event) => {
              event.target.setCustomValidity(
                new TextEncoder().encode(event.target.value).length > 350
                  ? t('请缩短开场白。')
                  : '',
              );
              onLive({ ...live, opening: event.target.value || undefined });
            }}
          />
        </label>
        {numeric('委派应答延迟（毫秒）', live.acknowledgementDelayMs, 0, 800, 1, 0, (value) =>
          onLive({ ...live, acknowledgementDelayMs: value }),
        )}
      </>
    );
  const vad = realtime.turnDetection;
  const whisper = realtime.transcriptionModel === 'gpt-realtime-whisper';
  return (
    <>
      {select(
        '通话转写模型',
        realtime.transcriptionModel ?? '',
        models,
        (value) => {
          const transcriptionModel = (value || undefined) as RealtimeOptions['transcriptionModel'];
          onRealtime({
            ...realtime,
            transcriptionModel,
            prompt: transcriptionModel === 'gpt-realtime-whisper' ? undefined : realtime.prompt,
            delay: transcriptionModel === 'gpt-realtime-whisper' ? realtime.delay : undefined,
          });
        },
        '默认 gpt-4o-mini-transcribe',
      )}
      <label>
        {t('转写语言（ISO 639-1）')}
        <input
          value={realtime.language ?? ''}
          pattern="[a-z]{2}"
          maxLength={2}
          placeholder="zh"
          disabled={disabled}
          onChange={(event) =>
            onRealtime({ ...realtime, language: event.target.value || undefined })
          }
        />
      </label>
      {!whisper && (
        <label>
          {t('转写提示')}
          <input
            value={realtime.prompt ?? ''}
            maxLength={800}
            disabled={disabled}
            onChange={(event) =>
              onRealtime({ ...realtime, prompt: event.target.value || undefined })
            }
          />
        </label>
      )}
      {whisper &&
        select(
          '转写延迟档位',
          realtime.delay ?? '',
          ['minimal', 'low', 'medium', 'high', 'xhigh'],
          (value) =>
            onRealtime({ ...realtime, delay: (value || undefined) as RealtimeOptions['delay'] }),
          '使用官方默认',
        )}
      {select(
        '输入降噪',
        realtime.noiseReduction === null ? 'off' : (realtime.noiseReduction ?? ''),
        ['off', 'near_field', 'far_field'],
        (value) =>
          onRealtime({
            ...realtime,
            noiseReduction:
              value === 'off' ? null : ((value || undefined) as RealtimeOptions['noiseReduction']),
          }),
        '使用官方默认',
      )}
      {numeric('语速倍率（0.25–1.5）', realtime.outputSpeed, 0.25, 1.5, 0.01, 1, (value) =>
        onRealtime({ ...realtime, outputSpeed: value }),
      )}
      {select(
        '语音轮次检测',
        vad?.type ?? '',
        ['server_vad', 'semantic_vad'],
        (value) =>
          onRealtime({
            ...realtime,
            turnDetection:
              value === 'semantic_vad'
                ? { type: value }
                : value === 'server_vad'
                  ? { type: value }
                  : undefined,
          }),
        '默认 server_vad',
      )}
      {vad?.type === 'semantic_vad' ? (
        select(
          '语义判停积极度',
          vad.eagerness ?? '',
          ['auto', 'low', 'medium', 'high'],
          (value) =>
            onRealtime({
              ...realtime,
              turnDetection: { ...vad, eagerness: (value || undefined) as typeof vad.eagerness },
            }),
          '默认 auto',
        )
      ) : (
        <>
          {numeric('语音触发阈值（0–1）', vad?.threshold, 0, 1, 0.01, 0.5, (value) =>
            onRealtime({
              ...realtime,
              turnDetection: { ...vad, type: 'server_vad', threshold: value },
            }),
          )}
          {numeric('语音前置缓冲（毫秒）', vad?.prefixPaddingMs, 0, 3000, 1, 300, (value) =>
            onRealtime({
              ...realtime,
              turnDetection: { ...vad, type: 'server_vad', prefixPaddingMs: value },
            }),
          )}
          {numeric('判停静音时长（毫秒）', vad?.silenceDurationMs, 100, 3000, 1, 600, (value) =>
            onRealtime({
              ...realtime,
              turnDetection: { ...vad, type: 'server_vad', silenceDurationMs: value },
            }),
          )}
        </>
      )}
    </>
  );
}
