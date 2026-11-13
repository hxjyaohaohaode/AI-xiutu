import {
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_SPECIALIST_MODELS,
  openAIAudioChatOptionsSchema,
  openAIEmbeddingOptionsSchema,
  openAISearchOptionsSchema,
  openAISpeechOptionsSchema,
  openAISpeechVoices,
  openAITranslationOptionsSchema,
  publicSearchLink,
  type OpenAISpecialistOperation,
} from '@ai-xiutu/contracts';
import { postBinary, postJson, record, reject, token, unknown } from './http.js';
import { translateOpenAIAudio } from './openai-translation.js';
import { validateWav } from './wav.js';

const base = 'https://api.openai.com/v1';
export const OPENAI_SPECIALIST_AUDIO_BYTES = 4_500_000;
const mimeByFormat = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'application/octet-stream',
  pcm16: 'application/octet-stream',
} as const;
type AudioFormat = keyof typeof mimeByFormat;
type Input = {
  model: string;
  operation: OpenAISpecialistOperation;
  prompt: string;
  wav?: Uint8Array;
  options?: unknown;
};
type Result = {
  requestId: string;
  usage?: Record<string, unknown>;
  text?: string;
  audio?: { bytes: Buffer; mime: string; format: AudioFormat };
  embedding?: number[] | string;
  citations?: { url: string; title: string }[];
};

function normalizeAudio(bytes: Buffer, format: AudioFormat, requestId: string) {
  const prefix = bytes.subarray(0, 4).toString('ascii');
  if (
    bytes.length < 2 ||
    bytes.length > OPENAI_SPECIALIST_AUDIO_BYTES ||
    ((format === 'pcm' || format === 'pcm16') && bytes.length % 2 !== 0) ||
    (format === 'wav' &&
      (prefix !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WAVE')) ||
    (format === 'opus' && prefix !== 'OggS') ||
    (format === 'flac' && prefix !== 'fLaC') ||
    (format === 'aac' &&
      !(
        (bytes[0] === 0xff && (bytes[1]! & 0xf0) === 0xf0) ||
        bytes.subarray(4, 8).toString('ascii') === 'ftyp'
      )) ||
    (format === 'mp3' &&
      !prefix.startsWith('ID3') &&
      !(bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0))
  )
    unknown('OPENAI_AUDIO_INVALID', requestId);
  return { bytes, mime: mimeByFormat[format], format };
}
function decodeAudio(value: unknown, format: AudioFormat, requestId: string) {
  if (typeof value !== 'string' || value.length > Math.ceil(OPENAI_SPECIALIST_AUDIO_BYTES / 3) * 4)
    unknown('OPENAI_AUDIO_INVALID', requestId);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) unknown('OPENAI_AUDIO_INVALID', requestId);
  return normalizeAudio(bytes, format, requestId);
}
function specialistRequest(input: Input) {
  const { model, operation, prompt, wav } = input;
  if (!(OPENAI_SPECIALIST_MODELS[operation] as readonly string[]).includes(model))
    reject('OPENAI_SPECIALIST_PROFILE_MISMATCH');
  if (operation === 'translate-audio') {
    if (!wav || prompt) reject('OPENAI_TRANSLATION_INPUT_INVALID');
    validateWav(wav);
    return { operation, body: openAITranslationOptionsSchema.parse(input.options) } as const;
  }
  if (!prompt.trim() || prompt.length > 4096 || (wav && operation !== 'audio-chat'))
    reject('OPENAI_SPECIALIST_INPUT_INVALID');
  switch (operation) {
    case 'speak': {
      const options = openAISpeechOptionsSchema.parse(input.options);
      if (
        !openAISpeechVoices(model).includes(options.voice) ||
        (model.startsWith('tts-1') && options.instructions)
      )
        reject('OPENAI_SPEECH_OPTIONS_UNSUPPORTED');
      return {
        operation,
        format: options.format,
        body: {
          model,
          input: prompt,
          voice: options.voice,
          response_format: options.format,
          ...(options.speed !== undefined ? { speed: options.speed } : {}),
          ...(options.instructions ? { instructions: options.instructions } : {}),
        },
      } as const;
    }
    case 'embed': {
      const options = openAIEmbeddingOptionsSchema.parse(input.options ?? {});
      const limit = OPENAI_EMBEDDING_DIMENSIONS[model as keyof typeof OPENAI_EMBEDDING_DIMENSIONS];
      if (
        options.dimensions !== undefined &&
        (model === 'text-embedding-ada-002' || options.dimensions > limit)
      )
        reject('OPENAI_EMBEDDING_DIMENSIONS_UNSUPPORTED');
      return {
        operation,
        size: options.dimensions ?? limit,
        encoding: options.encoding,
        body: {
          model,
          input: prompt,
          encoding_format: options.encoding,
          ...(options.dimensions ? { dimensions: options.dimensions } : {}),
        },
      } as const;
    }
    case 'web-search': {
      const options = openAISearchOptionsSchema.parse(input.options ?? {});
      return {
        operation,
        body: {
          model,
          store: false,
          messages: [{ role: 'user', content: prompt }],
          web_search_options: {
            search_context_size: options.size,
            ...(options.location && Object.keys(options.location).length
              ? { user_location: { type: 'approximate', approximate: options.location } }
              : {}),
          },
        },
      } as const;
    }
    case 'audio-chat': {
      const options = openAIAudioChatOptionsSchema.parse(input.options ?? {});
      if (options.output === 'text' && !wav) reject('OPENAI_AUDIO_CHAT_REQUIRES_AUDIO');
      if (wav) validateWav(wav);
      const content = wav
        ? [
            { type: 'text', text: prompt },
            {
              type: 'input_audio',
              input_audio: { data: Buffer.from(wav).toString('base64'), format: 'wav' },
            },
          ]
        : prompt;
      return {
        operation,
        format: options.format,
        output: options.output,
        body: {
          model,
          store: false,
          max_completion_tokens: options.maxCompletionTokens,
          messages: [{ role: 'user', content }],
          modalities: options.output === 'audio' ? ['text', 'audio'] : ['text'],
          ...(options.output === 'audio'
            ? { audio: { voice: options.voice, format: options.format } }
            : {}),
        },
      } as const;
    }
  }
}

export function createOpenAISpecialists(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
) {
  const key = token(env.OPENAI_API_KEY);
  const proxy = env.ASSISTANT_EGRESS_PROXY?.trim();
  if (proxy && env.OPENAI_SPECIALIST_ENABLED === 'true') {
    const parsed = new URL(proxy);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      reject('OPENAI_SPECIALIST_PROXY_INVALID');
  }
  const configured = env.OPENAI_SPECIALIST_ENABLED === 'true' && Boolean(key);
  return {
    configured,
    validate: specialistRequest,
    async run(input: Input): Promise<Result> {
      if (!configured) reject('OPENAI_SPECIALIST_DISABLED');
      const request = specialistRequest(input);
      if (request.operation === 'speak') {
        const { bytes, requestId } = await postBinary(
          base + '/audio/speech',
          key,
          request.body,
          OPENAI_SPECIALIST_AUDIO_BYTES,
          60_000,
          fetcher,
        );
        return { requestId, audio: normalizeAudio(bytes, request.format, requestId) };
      }
      if (request.operation === 'translate-audio') {
        const translated = await translateOpenAIAudio(
          key,
          input.wav!,
          request.body.language,
          proxy,
        );
        const wav = Buffer.alloc(44 + translated.bytes.length);
        wav.write('RIFF', 0);
        wav.writeUInt32LE(wav.length - 8, 4);
        wav.write('WAVEfmt ', 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(24_000, 24);
        wav.writeUInt32LE(48_000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write('data', 36);
        wav.writeUInt32LE(translated.bytes.length, 40);
        translated.bytes.copy(wav, 44);
        return {
          requestId: translated.requestId,
          text: translated.text,
          audio: normalizeAudio(wav, 'wav', translated.requestId),
        };
      }
      const { data, requestId } = await postJson(
        base + (request.operation === 'embed' ? '/embeddings' : '/chat/completions'),
        key,
        request.body,
        6_500_000,
        100_000,
        fetcher,
      );
      const usage = record(data.usage)
        ? Object.fromEntries(
            Object.entries(data.usage).filter(
              ([field, value]) =>
                ['prompt_tokens', 'completion_tokens', 'total_tokens'].includes(field) &&
                Number.isSafeInteger(value) &&
                Number(value) >= 0,
            ),
          )
        : undefined;
      if (request.operation === 'embed') {
        const item =
          Array.isArray(data.data) && data.data.length === 1 && record(data.data[0])
            ? data.data[0]
            : undefined;
        const embedding = item?.embedding;
        if (request.encoding === 'float') {
          if (
            !Array.isArray(embedding) ||
            embedding.length !== request.size ||
            embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
          )
            unknown('OPENAI_EMBEDDING_INVALID', requestId);
        } else if (
          typeof embedding !== 'string' ||
          embedding.length > 16_384 ||
          Buffer.from(embedding, 'base64').length !== request.size * 4 ||
          Buffer.from(embedding, 'base64').toString('base64') !== embedding
        )
          unknown('OPENAI_EMBEDDING_INVALID', requestId);
        return { requestId, usage, embedding };
      }
      const choice =
        Array.isArray(data.choices) && data.choices.length === 1 && record(data.choices[0])
          ? data.choices[0]
          : undefined;
      const message = choice && record(choice.message) ? choice.message : undefined;
      if (!message || !['stop', 'length'].includes(String(choice?.finish_reason)))
        unknown('OPENAI_CHAT_INVALID', requestId);
      const audioResult = record(message.audio) ? message.audio : null;
      const rawText = audioResult?.transcript ?? message.content ?? message.refusal;
      const text = typeof rawText === 'string' && rawText.length <= 9000 ? rawText : '';
      if (!text.trim()) unknown('OPENAI_CHAT_INVALID', requestId);
      const citations = Array.isArray(message.annotations)
        ? message.annotations.slice(0, 20).flatMap((value) => {
            if (!record(value) || value.type !== 'url_citation' || !record(value.url_citation))
              return [];
            const url = publicSearchLink(value.url_citation.url);
            const title =
              typeof value.url_citation.title === 'string'
                ? value.url_citation.title.slice(0, 200)
                : '';
            return url && title ? [{ url, title }] : [];
          })
        : [];
      return {
        requestId,
        usage,
        text,
        citations,
        ...(request.operation === 'audio-chat' && request.output === 'audio'
          ? { audio: decodeAudio(audioResult?.data, request.format, requestId) }
          : {}),
      };
    },
  };
}
