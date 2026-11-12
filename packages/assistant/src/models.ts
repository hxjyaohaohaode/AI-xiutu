import { z } from 'zod';

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
] as const;
export const RESPONSES_REASONING = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export const REALTIME_REASONING = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const gpt6 = {
  contextWindowTokens: 1_050_000,
  maxOutputTokens: 128_000,
  imageInput: true,
  reasoning: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
} as const;
const gpt54 = {
  contextWindowTokens: 400_000,
  maxOutputTokens: 128_000,
  imageInput: true,
  reasoning: ['none', 'low', 'medium', 'high', 'xhigh'],
} as const;
export const RESPONSES_MODELS = Object.freeze(
  [
    { id: 'gpt-6.1-sol', ...gpt6, reasoning: ['low', 'medium', 'high', 'xhigh', 'max'] as const },
    { id: 'gpt-6.1-terra', ...gpt6 },
    { id: 'gpt-6-astra', ...gpt6 },
    { id: 'gpt-6-sol', ...gpt6 },
    { id: 'gpt-6-luna', ...gpt6 },
    { id: 'gpt-5.4-mini', ...gpt54 },
    { id: 'gpt-5.4-nano', ...gpt54 },
  ].map((model) => ({
    ...model,
    source: `https://developers.openai.com/api/docs/models/${model.id}`,
  })),
);

export const VOICE_MODELS = Object.freeze([
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
    id: 'gpt-realtime-mini',
    protocol: 'realtime' as const,
    label: 'GPT-Realtime mini',
    imageInput: true,
    fullDuplex: false,
    voices: REALTIME_VOICES,
    reasoning: [],
  },
]);
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
    voiceReasoningEffort: z.enum(REALTIME_REASONING).optional(),
  })
  .strict();
export type AssistantModelConfig = z.infer<typeof assistantModelConfigSchema>;
export function modelProfileError(id: string, settings: AssistantModelConfig) {
  const voice = VOICE_MODELS.find((model) => model.id === id);
  if (
    settings.operations.includes('realtime-voice') &&
    (!voice ||
      (settings.voiceReasoningEffort &&
        !(voice.reasoning as readonly string[]).includes(settings.voiceReasoningEffort)))
  )
    return 'VOICE_PROFILE_MISMATCH';
  if (!settings.operations.includes('assistant-turn')) return;
  if (voice) return 'RESPONSES_PROFILE_MISMATCH';
  const model = RESPONSES_MODELS.find((entry) => entry.id === id);
  if (
    model &&
    (settings.contextWindowTokens > model.contextWindowTokens ||
      settings.maxOutputTokens > model.maxOutputTokens ||
      (settings.reasoningEffort &&
        !(model.reasoning as readonly string[]).includes(settings.reasoningEffort)))
  )
    return 'RESPONSES_PROFILE_MISMATCH';
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
export const VOICE_VERIFIED_AT = '2026-11-11';
export const VOICE_DOCS = [
  'https://developers.openai.com/api/docs/models/gpt-live-1',
  'https://developers.openai.com/api/docs/guides/live-delegation',
  'https://developers.openai.com/api/docs/guides/voice-websockets',
  'https://developers.openai.com/api/docs/guides/realtime-conversations',
  'https://developers.openai.com/api/docs/guides/live-conversations',
  'https://developers.openai.com/api/reference/resources/realtime/client-events',
] as const;
