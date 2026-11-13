import { z } from 'zod';
import {
  RESPONSES_REASONING,
  RESPONSES_SERVICE_TIERS,
  RESPONSES_SUMMARIES,
  responsesModel,
  OPENAI_TRANSLATION_MODEL,
} from '@ai-xiutu/contracts';

export {
  RESPONSES_MODELS,
  RESPONSES_REASONING,
  RESPONSES_SERVICE_TIERS,
  RESPONSES_SOURCES,
  RESPONSES_SUMMARIES,
  RESPONSES_VERIFIED_AT,
  responsesModel,
} from '@ai-xiutu/contracts';

export const REALTIME_VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
] as const;
export const LIVE_VOICES = [
  ...REALTIME_VOICES,
  'quartz',
  'ripple',
  'vesper',
  'willow',
  'stone',
  'gleam',
  'meridian',
  'bossa',
  'tempo',
  'beacon',
  'delta',
  'cinder',
  'nuri',
  'juni',
  'flitz',
  'brise',
  'sillage',
  'nira',
  'harema',
  'shida',
  'noeul',
  'calandria',
  'compas',
  'destello',
  'halo',
  'hornero',
  'luciernaga',
  'pearl',
] as const;
export const REALTIME_REASONING = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export const CALL_TRANSCRIPTION_MODELS = [
  'gpt-transcribe',
  'gpt-live-transcribe',
  'gpt-realtime-whisper',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'gpt-4o-mini-transcribe-2025-03-20',
  'gpt-4o-mini-transcribe-2025-12-15',
  'whisper-1',
] as const;
export const realtimeOptionsSchema = z
  .object({
    transcriptionModel: z.enum(CALL_TRANSCRIPTION_MODELS).optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    prompt: z.string().trim().min(1).max(800).optional(),
    delay: z.enum(REALTIME_REASONING).optional(),
    noiseReduction: z.enum(['near_field', 'far_field']).nullable().optional(),
    outputSpeed: z.number().min(0.25).max(1.5).optional(),
    turnDetection: z
      .discriminatedUnion('type', [
        z
          .object({
            type: z.literal('server_vad'),
            threshold: z.number().min(0).max(1).optional(),
            prefixPaddingMs: z.number().int().min(0).max(3000).optional(),
            silenceDurationMs: z.number().int().min(100).max(3000).optional(),
          })
          .strict(),
        z
          .object({
            type: z.literal('semantic_vad'),
            eagerness: z.enum(['auto', 'low', 'medium', 'high']).optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine(
    (options) =>
      options.transcriptionModel === 'gpt-realtime-whisper' ? !options.prompt : !options.delay,
    'Transcription delay is available only with Realtime Whisper, which does not accept a prompt',
  );
export const liveOptionsSchema = z
  .object({
    prompt: z.string().trim().min(1).max(1200).optional(),
    opening: z
      .string()
      .trim()
      .min(1)
      .refine((value) => new TextEncoder().encode(value).length <= 350)
      .optional(),
    acknowledgementDelayMs: z.number().int().min(0).max(800).optional(),
  })
  .strict();
export type RealtimeOptions = z.infer<typeof realtimeOptionsSchema>;
export type LiveOptions = z.infer<typeof liveOptionsSchema>;

export const VOICE_MODELS = Object.freeze([
  {
    id: OPENAI_TRANSLATION_MODEL,
    protocol: 'translation' as const,
    label: 'GPT-Realtime Translate',
    imageInput: false,
    fullDuplex: false,
    voices: [],
    reasoning: [],
  },
  {
    id: 'gpt-live-1',
    protocol: 'live' as const,
    label: 'GPT-Live 1',
    imageInput: false,
    fullDuplex: true,
    voices: LIVE_VOICES,
    reasoning: [],
  },
  {
    id: 'gpt-realtime-2.1',
    protocol: 'realtime' as const,
    label: 'GPT-Realtime 2.1',
    imageInput: true,
    fullDuplex: false,
    voices: REALTIME_VOICES,
    reasoning: REALTIME_REASONING,
  },
  {
    id: 'gpt-realtime-2.1-mini',
    protocol: 'realtime' as const,
    label: 'GPT-Realtime 2.1 mini',
    imageInput: true,
    fullDuplex: false,
    voices: REALTIME_VOICES,
    reasoning: REALTIME_REASONING,
  },
  {
    id: 'gpt-realtime-2',
    protocol: 'realtime' as const,
    label: 'GPT-Realtime 2',
    imageInput: true,
    fullDuplex: false,
    voices: REALTIME_VOICES,
    reasoning: REALTIME_REASONING,
  },
  {
    id: 'gpt-realtime-1.5',
    protocol: 'realtime' as const,
    label: 'GPT-Realtime 1.5',
    imageInput: true,
    fullDuplex: false,
    voices: REALTIME_VOICES,
    reasoning: [],
  },
  {
    id: 'gpt-realtime',
    protocol: 'realtime' as const,
    label: 'GPT-Realtime',
    imageInput: true,
    fullDuplex: false,
    voices: REALTIME_VOICES,
    reasoning: [],
  },
  {
    id: 'gpt-realtime-2025-08-28',
    protocol: 'realtime' as const,
    label: 'GPT-Realtime · 2025-08-28',
    imageInput: true,
    fullDuplex: false,
    voices: REALTIME_VOICES,
    reasoning: [],
  },
  {
    id: 'gpt-realtime-mini',
    protocol: 'realtime' as const,
    label: 'GPT-Realtime mini',
    imageInput: true,
    fullDuplex: false,
    voices: REALTIME_VOICES,
    reasoning: [],
  },
  {
    id: 'gpt-realtime-mini-2025-12-15',
    protocol: 'realtime' as const,
    label: 'GPT-Realtime mini · 2025-12-15',
    imageInput: true,
    fullDuplex: false,
    voices: REALTIME_VOICES,
    reasoning: [],
  },
]);

const jsonSchema = z.record(z.string(), z.unknown()).refine((value) => {
  // Only bounded JSON data crosses to the provider. The application never
  // evaluates schema code or resolves external references.
  if (value.type !== 'object') return false;
  function bounded(node: unknown, depth: number): boolean {
    if (depth > 16) return false;
    if (Array.isArray(node)) return node.every((item) => bounded(item, depth + 1));
    if (!node || typeof node !== 'object') return true;
    return Object.entries(node).every(([key, item]) =>
      key === '$ref'
        ? typeof item === 'string' && (item === '#' || item.startsWith('#/'))
        : bounded(item, depth + 1),
    );
  }
  return bounded(value, 0) && JSON.stringify(value).length <= 12_000;
}, 'Use a bounded object JSON Schema with local references');

export const responsesOptionsSchema = z
  .object({
    reasoningMode: z.enum(['standard', 'pro']).optional(),
    reasoningSummary: z.enum(RESPONSES_SUMMARIES).optional(),
    verbosity: z.enum(['low', 'medium', 'high']).optional(),
    format: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('text') }).strict(),
        z.object({ type: z.literal('json_object') }).strict(),
        z
          .object({
            type: z.literal('json_schema'),
            name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
            schema: jsonSchema,
            strict: z.boolean().default(true),
          })
          .strict(),
      ])
      .optional(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    serviceTier: z.enum(RESPONSES_SERVICE_TIERS).optional(),
    transport: z.enum(['http', 'websocket']).optional(),
  })
  .strict();
export type ResponsesOptions = z.infer<typeof responsesOptionsSchema>;

export function assistantEgressProxy(raw: string | undefined) {
  const value = raw?.trim();
  if (!value) return undefined;
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  )
    throw new Error('ASSISTANT_PROXY_CONFIG_INVALID');
  return value;
}
export const assistantModelConfigSchema = z
  .object({
    enabled: z.boolean(),
    label: z.string().max(120).optional(),
    provider: z.literal('openai'),
    operations: z.array(z.string()).max(20),
    unitCost: z.number().int().min(1).max(100_000),
    // Application budget, not a claim about the upstream model's maximum.
    maxSeconds: z.number().int().min(30).max(600).default(180),
    maxDelegations: z.number().int().min(1).max(20).default(6),
    maxOutputTokens: z.number().int().min(256).max(8192).default(2048),
    contextWindowTokens: z.number().int().min(8192).max(2_000_000).default(32768),
    visualTokenReserve: z.number().int().min(1024).max(32768).default(4096),
    imageInput: z.boolean().default(false),
    webSearch: z.boolean().default(false),
    webImageSearch: z.boolean().optional(),
    reasoningEffort: z.enum(RESPONSES_REASONING).optional(),
    responses: responsesOptionsSchema.optional(),
    voiceReasoningEffort: z.enum(REALTIME_REASONING).optional(),
    realtime: realtimeOptionsSchema.optional(),
    live: liveOptionsSchema.optional(),
  })
  .strict();
export type AssistantModelConfig = z.infer<typeof assistantModelConfigSchema>;
export function modelProfileError(
  id: string,
  settings: AssistantModelConfig,
  allowTestModel = false,
) {
  const voice = VOICE_MODELS.find((model) => model.id === id);
  if (
    settings.operations.includes('realtime-voice') &&
    (!voice ||
      settings.responses ||
      (settings.live && voice.protocol !== 'live') ||
      (settings.realtime && voice.protocol !== 'realtime') ||
      (voice.protocol === 'translation' && (settings.imageInput || settings.webSearch)) ||
      (settings.voiceReasoningEffort &&
        !(voice.reasoning as readonly string[]).includes(settings.voiceReasoningEffort)))
  )
    return 'VOICE_PROFILE_MISMATCH';
  if (!settings.operations.includes('assistant-turn')) return;
  if (voice || settings.live || settings.realtime) return 'RESPONSES_PROFILE_MISMATCH';
  const model = responsesModel(id);
  if (!model && !allowTestModel) return 'RESPONSES_PROFILE_UNKNOWN';
  const options = settings.responses;
  const effectiveEffort = settings.reasoningEffort ?? model?.defaultEffort;
  const sampling =
    model?.sampling === 'always' ||
    (model?.sampling === 'without-reasoning' && effectiveEffort === 'none');
  if (
    model &&
    (settings.contextWindowTokens > model.contextWindowTokens ||
      (model.maxInputTokens !== undefined &&
        settings.contextWindowTokens - settings.maxOutputTokens > model.maxInputTokens) ||
      settings.maxOutputTokens > model.maxOutputTokens ||
      (settings.reasoningEffort && !model.reasoning.includes(settings.reasoningEffort)) ||
      (options?.reasoningMode && !model.reasoningMode) ||
      (options?.reasoningSummary && !model.summaries.includes(options.reasoningSummary)) ||
      (options?.verbosity && !model.verbosity) ||
      (options?.format?.type === 'json_schema' && !model.structuredOutputs) ||
      (options?.format?.type === 'json_object' && !model.jsonObject) ||
      ((options?.temperature !== undefined || options?.topP !== undefined) && !sampling) ||
      (options?.serviceTier && !model.tiers.includes(options.serviceTier)))
  )
    return 'RESPONSES_PROFILE_MISMATCH';
}

export function responsesParameters(config: AssistantModelConfig, includeText = true) {
  const { responses, reasoningEffort } = config;
  const { reasoningMode, reasoningSummary, verbosity, format, temperature, topP, serviceTier } =
    responses ?? {};
  return {
    service_tier: serviceTier ?? 'default',
    ...(reasoningEffort || reasoningMode || reasoningSummary
      ? {
          reasoning: {
            ...(reasoningEffort ? { effort: reasoningEffort } : {}),
            ...(reasoningMode ? { mode: reasoningMode } : {}),
            ...(reasoningSummary ? { summary: reasoningSummary } : {}),
          },
        }
      : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(includeText && (verbosity || format)
      ? { text: { ...(verbosity ? { verbosity } : {}), ...(format ? { format } : {}) } }
      : {}),
  };
}
export function voiceModel(id: string) {
  const found = VOICE_MODELS.find((model) => model.id === id);
  if (!found) throw new Error('UNSUPPORTED_VOICE_MODEL');
  return found;
}
export const ASSISTANT_TOOL_NAMES = [
  'inspect_candidate',
  'propose_scene_balance',
  'select_candidate',
  'suggest_memory',
  'compose_workspace',
  'read_history',
  'read_tool_result',
  'search_resources',
  'delegate_research',
  'describe_editor',
  'propose_edit',
  'propose_curve',
  'propose_sequence',
  'propose_retouch',
  'propose_healing',
  'draft_generation',
] as const;
export const VOICE_VERIFIED_AT = '2026-11-13';
export const VOICE_DOCS = [
  'https://developers.openai.com/api/docs/models/gpt-live-1',
  'https://developers.openai.com/api/docs/guides/live-delegation',
  'https://developers.openai.com/api/docs/guides/voice-websockets',
  'https://developers.openai.com/api/docs/guides/realtime-conversations',
  'https://developers.openai.com/api/docs/guides/live-conversations',
  'https://developers.openai.com/api/reference/resources/realtime/client-events',
] as const;
