import { assistantTurnPrice, responseFormatSchema, type AssistantResponsePricing, type AssistantResponseTuning } from '@ai-xiutu/contracts';
import { z } from 'zod';
import {
  RESPONSES_REASONING,
  RESPONSES_SERVICE_TIERS,
  RESPONSES_SUMMARIES,
  responsesModel,
  OPENAI_TRANSLATION_MODEL,
  REALTIME_REASONING,
  realtimeOptionsSchema,
  liveOptionsSchema,
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

export {
  REALTIME_REASONING, CALL_TRANSCRIPTION_MODELS, realtimeOptionsSchema, liveOptionsSchema,
  type RealtimeOptions, type LiveOptions,
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

export const responsesOptionsSchema = z
  .object({
    reasoningMode: z.enum(['standard', 'pro']).optional(),
    reasoningSummary: z.enum(RESPONSES_SUMMARIES).optional(),
    verbosity: z.enum(['low', 'medium', 'high']).optional(),
    format: responseFormatSchema.optional(),
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
    responseTierUnits: z.partialRecord(z.enum(RESPONSES_SERVICE_TIERS), z.number().int().min(1).max(100_000)).optional(),
    responseProExtraUnits: z.number().int().min(1).max(100_000).optional(),
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
    options?.reasoningMode !== 'pro' && (model?.sampling === 'always' ||
    (model?.sampling === 'without-reasoning' && effectiveEffort === 'none'));
  if (
    model &&
    (settings.contextWindowTokens > model.contextWindowTokens ||
      (model.maxInputTokens !== undefined &&
        settings.contextWindowTokens - settings.maxOutputTokens > model.maxInputTokens) ||
      settings.maxOutputTokens > model.maxOutputTokens ||
      (settings.reasoningEffort && !model.reasoning.includes(settings.reasoningEffort)) ||
      (options?.reasoningMode && !model.reasoningMode) ||
      (options?.reasoningMode === 'pro' && effectiveEffort === 'none') ||
      (settings.responseProExtraUnits !== undefined && !model.reasoningMode) ||
      Object.keys(settings.responseTierUnits ?? {}).some((tier) =>
        !model.tiers.some((value) => value === tier)) ||
      (options?.reasoningSummary && !model.summaries.includes(options.reasoningSummary)) ||
      (options?.verbosity && !model.verbosity) ||
      (options?.format?.type === 'json_schema' && !model.structuredOutputs) ||
      (options?.format?.type === 'json_object' && !model.jsonObject) ||
      ((options?.temperature !== undefined || options?.topP !== undefined) && !sampling) ||
      (options?.serviceTier && !model.tiers.includes(options.serviceTier)))
  )
    return 'RESPONSES_PROFILE_MISMATCH';
}

export function responseDefaults(config: AssistantModelConfig): AssistantResponseTuning {
  const { reasoningEffort, maxOutputTokens, responses } = config;
  const { transport: _transport, ...overrides } = responses ?? {};
  return { ...overrides, effort: reasoningEffort, maxOutputTokens };
}
export function responsePricing(config: AssistantModelConfig): AssistantResponsePricing {
  return {
    defaultTier: config.responses?.serviceTier ?? 'default',
    tierUnits: config.responseTierUnits ?? {},
    proExtraUnits: config.responseProExtraUnits,
  };
}
export function tuneAssistantTurn(id: string, base: AssistantModelConfig, tuning?: AssistantResponseTuning, allowTest = false) {
  if (!tuning) return { config: base, units: assistantTurnPrice(base.unitCost, responsePricing(base), {})! };
  const { maxOutputTokens, effort, ...options } = tuning;
  const config = assistantModelConfigSchema.parse({
    ...base,
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    responses: { ...base.responses, ...options },
  });
  // A model may have sampling defaults for effort=none. Suppress those inherited
  // defaults if the user explicitly switches to a reasoning mode.
  const profile = responsesModel(id);
  const canSample = config.responses?.reasoningMode !== 'pro' &&
    (profile?.sampling === 'always' ||
      (profile?.sampling === 'without-reasoning' && (config.reasoningEffort ?? profile.defaultEffort) === 'none'));
  if (!canSample && config.responses) {
    if (tuning.temperature === undefined) delete config.responses.temperature;
    if (tuning.topP === undefined) delete config.responses.topP;
  }
  const units = assistantTurnPrice(base.unitCost, responsePricing(base), tuning, responseDefaults(base));
  if (units === null || (maxOutputTokens !== undefined && maxOutputTokens > base.maxOutputTokens) ||
      modelProfileError(id, config, allowTest)) return null;
  return { config, units };
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
