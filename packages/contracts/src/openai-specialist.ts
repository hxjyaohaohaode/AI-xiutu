import { z } from 'zod';
import { OPENAI_TRANSLATION_MODEL } from './openai-live.js';

export const OPENAI_SPEECH_IDS = [
  'gpt-4o-mini-tts',
  'gpt-4o-mini-tts-2025-03-20',
  'gpt-4o-mini-tts-2025-12-15',
  'tts-1',
  'tts-1-1106',
  'tts-1-hd',
  'tts-1-hd-1106',
] as const;
export const OPENAI_AUDIO_CHAT_IDS = [
  'gpt-audio-1.5',
  'gpt-audio',
  'gpt-audio-2025-08-28',
  'gpt-audio-mini',
  'gpt-audio-mini-2025-12-15',
] as const;
export const OPENAI_SEARCH_IDS = ['gpt-5-search-api', 'gpt-5-search-api-2025-10-14'] as const;
export const OPENAI_EMBEDDING_DIMENSIONS = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
} as const;
export const OPENAI_TRANSLATION_ID = OPENAI_TRANSLATION_MODEL;
export const OPENAI_SPECIALIST_OPERATIONS = [
  'speak',
  'audio-chat',
  'web-search',
  'embed',
  'translate-audio',
] as const;
export type OpenAISpecialistOperation = (typeof OPENAI_SPECIALIST_OPERATIONS)[number];
export const OPENAI_SPECIALIST_MODELS = {
  speak: OPENAI_SPEECH_IDS,
  'audio-chat': OPENAI_AUDIO_CHAT_IDS,
  'web-search': OPENAI_SEARCH_IDS,
  embed: Object.keys(OPENAI_EMBEDDING_DIMENSIONS),
  'translate-audio': [OPENAI_TRANSLATION_ID],
} as const;

export const OPENAI_LEGACY_SPEECH_VOICES = [
  'alloy',
  'ash',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
] as const;
export const OPENAI_SPEECH_VOICES = [
  ...OPENAI_LEGACY_SPEECH_VOICES,
  'ballad',
  'verse',
  'marin',
  'cedar',
] as const;
export const OPENAI_AUDIO_CHAT_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;
export const OPENAI_SPEECH_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const;
export const OPENAI_AUDIO_CHAT_FORMATS = ['wav', 'aac', 'mp3', 'flac', 'opus', 'pcm16'] as const;
const optionText = z.string().trim().min(1).max(600);
export const openAISpeechOptionsSchema = z
  .object({
    voice: z.enum(OPENAI_SPEECH_VOICES),
    format: z.enum(OPENAI_SPEECH_FORMATS).default('mp3'),
    speed: z.number().min(0.25).max(4).optional(),
    instructions: optionText.optional(),
  })
  .strict();
export const openAIAudioChatOptionsSchema = z
  .object({
    voice: z.enum(OPENAI_AUDIO_CHAT_VOICES).default('alloy'),
    format: z.enum(OPENAI_AUDIO_CHAT_FORMATS).default('wav'),
    output: z.enum(['text', 'audio']).default('audio'),
    maxCompletionTokens: z.number().int().min(16).max(2048).default(512),
  })
  .strict();
export const openAISearchOptionsSchema = z
  .object({
    size: z.enum(['low', 'medium', 'high']).default('medium'),
    location: z
      .object({
        city: z.string().trim().min(1).max(100).optional(),
        country: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional(),
        region: z.string().trim().min(1).max(100).optional(),
        timezone: z
          .string()
          .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/)
          .max(60)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const openAIEmbeddingOptionsSchema = z
  .object({
    dimensions: z.number().int().min(1).max(3072).optional(),
    encoding: z.enum(['float', 'base64']).default('float'),
  })
  .strict();
export const openAITranslationOptionsSchema = z
  .object({
    language: z.string().regex(/^[a-z]{2}$/),
  })
  .strict();

export function openAISpeechVoices(id: string): readonly string[] {
  return id.startsWith('tts-1') ? OPENAI_LEGACY_SPEECH_VOICES : OPENAI_SPEECH_VOICES;
}
