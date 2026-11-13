import { postJson, record, reject, token, unknown } from './http.js';
import {
  fileTranscriptionOptionsSchema,
  supportsFileTranscriptionOptions,
} from '@ai-xiutu/contracts';
import type { SpeechProvider, SpeechSegment, SpeechTimestamp } from './types.js';
import { validateWav } from './wav.js';

export const OPENAI_FILE_TRANSCRIPTION_MODELS = [
  'gpt-transcribe',
  'gpt-4o-transcribe',
  'gpt-4o-transcribe-diarize',
  'gpt-4o-mini-transcribe',
  'gpt-4o-mini-transcribe-2025-03-20',
  'gpt-4o-mini-transcribe-2025-12-15',
  'whisper-1',
] as const;
export const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

export function createOpenAIFileTranscriber(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): SpeechProvider {
  const key = token(env.OPENAI_API_KEY);
  const raw = env.OPENAI_TRANSCRIPTION_MODELS ?? '';
  if (raw.length > 1024) reject('OPENAI_TRANSCRIPTION_CONFIG_INVALID');
  const models = Object.freeze(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if (
    new Set(models).size !== models.length ||
    models.some((id) => !(OPENAI_FILE_TRANSCRIPTION_MODELS as readonly string[]).includes(id))
  )
    reject('OPENAI_TRANSCRIPTION_CONFIG_INVALID');
  const configured = Boolean(key && models.length);
  return {
    configured,
    models,
    async transcribe({ model, wav, options }) {
      if (!configured || !models.includes(model)) reject('OPENAI_TRANSCRIPTION_MODEL_NOT_ENABLED');
      validateWav(wav);
      const checked = fileTranscriptionOptionsSchema.safeParse(options ?? {});
      if (!checked.success || !supportsFileTranscriptionOptions(model, checked.data))
        reject('OPENAI_TRANSCRIPTION_OPTIONS_UNSUPPORTED');
      const { language, languages, keywords, prompt, temperature, timestamps } = checked.data;
      const diarize = model === 'gpt-4o-transcribe-diarize';
      const form = new FormData();
      form.set('model', model);
      form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'input.wav');
      form.set('response_format', diarize ? 'diarized_json' : timestamps ? 'verbose_json' : 'json');
      if (diarize) form.set('chunking_strategy', 'auto');
      if (language) form.set('language', language);
      if (prompt) form.set('prompt', prompt);
      if (temperature !== undefined) form.set('temperature', String(temperature));
      for (const hint of languages ?? []) form.append('languages[]', hint);
      for (const keyword of keywords ?? []) form.append('keywords[]', keyword);
      const granularities =
        timestamps === 'both' ? (['word', 'segment'] as const) : timestamps ? [timestamps] : [];
      for (const granularity of granularities)
        form.append('timestamp_granularities[]', granularity);
      const { data, requestId } = await postJson(
        OPENAI_TRANSCRIPTIONS_URL,
        key,
        form,
        131_072,
        60_000,
        fetcher,
      );
      if (typeof data.text !== 'string' || data.text.length > 8000 || data.error)
        unknown('OPENAI_TRANSCRIPTION_INVALID', requestId);
      const segments: SpeechSegment[] = [];
      if (diarize) {
        if (!Array.isArray(data.segments) || data.segments.length > 80)
          unknown('OPENAI_TRANSCRIPTION_INVALID', requestId);
        for (const item of data.segments) {
          if (
            !record(item) ||
            typeof item.speaker !== 'string' ||
            !/^[\w -]{1,64}$/.test(item.speaker) ||
            typeof item.start !== 'number' ||
            typeof item.end !== 'number' ||
            item.start < 0 ||
            item.end < item.start ||
            item.end > 35 ||
            typeof item.text !== 'string' ||
            item.text.length > 8000
          )
            unknown('OPENAI_TRANSCRIPTION_INVALID', requestId);
          segments.push({
            speaker: item.speaker,
            start: item.start,
            end: item.end,
            text: item.text,
          });
        }
      }
      const timed: NonNullable<Awaited<ReturnType<SpeechProvider['transcribe']>>['timestamps']> =
        {};
      for (const granularity of granularities) {
        const entries = data[granularity === 'word' ? 'words' : 'segments'];
        if (!Array.isArray(entries) || entries.length > 500)
          unknown('OPENAI_TRANSCRIPTION_INVALID', requestId);
        timed[granularity] = entries.map((entry): SpeechTimestamp => {
          const text = record(entry) ? entry[granularity === 'word' ? 'word' : 'text'] : undefined;
          if (
            !record(entry) ||
            typeof text !== 'string' ||
            text.length > 2000 ||
            typeof entry.start !== 'number' ||
            typeof entry.end !== 'number' ||
            !Number.isFinite(entry.start) ||
            !Number.isFinite(entry.end) ||
            entry.start < 0 ||
            entry.end < entry.start ||
            entry.end > 35
          )
            unknown('OPENAI_TRANSCRIPTION_INVALID', requestId);
          return { start: entry.start, end: entry.end, text };
        });
      }
      const usage = record(data.usage)
        ? Object.fromEntries(
            ['seconds', 'input_tokens', 'output_tokens', 'total_tokens'].flatMap((field) => {
              const value = (data.usage as Record<string, unknown>)[field];
              return typeof value === 'number' && Number.isFinite(value) && value >= 0
                ? [[field, value]]
                : [];
            }),
          )
        : undefined;
      return {
        text: data.text,
        requestId,
        ...(diarize ? { segments } : {}),
        ...(timestamps ? { timestamps: timed } : {}),
        ...(usage ? { usage } : {}),
      };
    },
  };
}
