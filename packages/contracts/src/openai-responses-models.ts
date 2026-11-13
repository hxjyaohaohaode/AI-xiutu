import { responseEfforts } from './assistant.js';

export const RESPONSES_REASONING = responseEfforts;
export const RESPONSES_SERVICE_TIERS = [
  'default',
  'fast',
  'priority',
  'ultrafast',
  'flex',
] as const;
export const RESPONSES_SUMMARIES = ['auto', 'detailed', 'concise'] as const;
export const RESPONSES_VERIFIED_AT = '2026-11-13';
export const RESPONSES_SOURCES = [
  'https://developers.openai.com/api/reference/resources/responses/methods/create',
  'https://developers.openai.com/api/docs/guides/reasoning',
  'https://developers.openai.com/api/docs/guides/latest-model',
  'https://developers.openai.com/api/docs/guides/websocket-mode',
  'https://developers.openai.com/api/docs/guides/fast-mode',
  'https://developers.openai.com/api/docs/guides/ultrafast-mode',
  'https://developers.openai.com/api/docs/deprecations',
] as const;

type Effort = (typeof RESPONSES_REASONING)[number];
type Tier = (typeof RESPONSES_SERVICE_TIERS)[number];
type Profile = {
  contextWindowTokens: number;
  maxInputTokens?: number;
  maxOutputTokens: number;
  imageInput: boolean;
  reasoning: readonly Effort[];
  defaultEffort?: Effort;
  reasoningMode?: boolean;
  verbosity?: boolean;
  sampling: 'always' | 'without-reasoning' | 'none';
  structuredOutputs: boolean;
  jsonObject?: boolean;
  streaming: boolean;
  longRunning?: boolean;
  tiers: readonly Tier[];
  deprecated?: boolean;
};

const standard = ['default'] as const;
const fast = ['default', 'fast', 'priority'] as const;
const standardFlex = ['default', 'flex'] as const;
const fastFlex = [...fast, 'flex'] as const;
const fastUltra = [...fastFlex, 'ultrafast'] as const;
const lowToHigh = ['low', 'medium', 'high'] as const;
const lowToXhigh = [...lowToHigh, 'xhigh'] as const;
const lowToMax = [...lowToXhigh, 'max'] as const;
const proEffort = ['medium', 'high', 'xhigh'] as const;
const gpt5: Profile = {
  contextWindowTokens: 400_000,
  maxOutputTokens: 128_000,
  imageInput: true,
  reasoning: ['minimal', ...lowToHigh],
  defaultEffort: 'medium',
  verbosity: true,
  sampling: 'none',
  structuredOutputs: true,
  streaming: true,
  tiers: fastFlex,
  deprecated: true,
};
const gpt52: Profile = {
  ...gpt5,
  reasoning: ['none', ...lowToXhigh],
  defaultEffort: 'none',
  sampling: 'without-reasoning',
  deprecated: false,
};
const gpt54: Profile = { ...gpt52, contextWindowTokens: 1_050_000 };
const gpt56: Profile = {
  ...gpt54,
  reasoning: ['none', ...lowToMax],
  defaultEffort: 'medium',
  reasoningMode: true,
};
const gpt6: Profile = { ...gpt56, tiers: fastFlex };
const gpt6Required: Profile = {
  ...gpt6,
  reasoning: lowToMax,
  sampling: 'none',
  tiers: fastUltra,
};
const pro: Profile = {
  ...gpt54,
  reasoning: proEffort,
  defaultEffort: 'medium',
  verbosity: false,
  sampling: 'none',
  structuredOutputs: true,
  jsonObject: true,
  longRunning: true,
  tiers: standard,
};
const gpt41: Profile = {
  ...gpt5,
  contextWindowTokens: 1_047_576,
  maxOutputTokens: 32_768,
  reasoning: [],
  defaultEffort: undefined,
  verbosity: false,
  sampling: 'always',
  tiers: fast,
};
const gpt4o: Profile = { ...gpt41, contextWindowTokens: 128_000, maxOutputTokens: 16_384 };

// Exact public model IDs and snapshots. Snapshots retain their own wire ID.
const definitions: readonly (readonly [string, Profile, ...string[]])[] = [
  ['gpt-6-astra', gpt6Required],
  ['gpt-6.1-sol', gpt6Required],
  ['gpt-6.1-terra', gpt6],
  ['gpt-6-luna', gpt6],
  ['gpt-6-sol', gpt6],
  ['gpt-5.6-sol', gpt56],
  ['gpt-5.6-terra', gpt56],
  ['gpt-5.6-luna', gpt56],
  ['gpt-5.5', { ...gpt54, defaultEffort: 'medium' }, 'gpt-5.5-2026-04-23'],
  ['gpt-5.5-pro', { ...pro, defaultEffort: 'high' }, 'gpt-5.5-pro-2026-04-23'],
  ['gpt-5.4', gpt54, 'gpt-5.4-2026-03-05'],
  ['gpt-5.4-mini', gpt52, 'gpt-5.4-mini-2026-03-17'],
  ['gpt-5.4-nano', { ...gpt52, tiers: standardFlex, deprecated: true }, 'gpt-5.4-nano-2026-03-17'],
  ['gpt-5.4-pro', pro, 'gpt-5.4-pro-2026-03-05'],
  [
    'gpt-5.3-codex',
    {
      ...gpt52,
      reasoning: lowToXhigh,
      defaultEffort: 'medium',
      sampling: 'none',
      tiers: fast,
      deprecated: true,
    },
  ],
  ['gpt-5.2', gpt52, 'gpt-5.2-2025-12-11'],
  [
    'gpt-5.2-pro',
    { ...pro, contextWindowTokens: 400_000, tiers: standardFlex },
    'gpt-5.2-pro-2025-12-11',
  ],
  [
    'gpt-5.1',
    { ...gpt52, reasoning: ['none', ...lowToHigh], deprecated: true },
    'gpt-5.1-2025-11-13',
  ],
  ['gpt-5', gpt5, 'gpt-5-2025-08-07'],
  ['gpt-5-mini', gpt5, 'gpt-5-mini-2025-08-07'],
  ['gpt-5-nano', { ...gpt5, tiers: standardFlex }, 'gpt-5-nano-2025-08-07'],
  [
    'gpt-5-pro',
    {
      ...pro,
      contextWindowTokens: 400_000,
      maxOutputTokens: 272_000,
      reasoning: ['high'],
      defaultEffort: 'high',
      deprecated: true,
    },
    'gpt-5-pro-2025-10-06',
  ],
  [
    'o3',
    {
      ...gpt5,
      contextWindowTokens: 200_000,
      maxOutputTokens: 100_000,
      reasoning: lowToHigh,
      verbosity: false,
    },
    'o3-2025-04-16',
  ],
  [
    'chat-latest',
    {
      ...gpt52,
      maxInputTokens: 272_000,
      reasoning: [],
      defaultEffort: 'medium',
      verbosity: false,
      sampling: 'none',
      tiers: standard,
    },
  ],
  ['gpt-4.1', gpt41, 'gpt-4.1-2025-04-14'],
  ['gpt-4.1-mini', gpt41, 'gpt-4.1-mini-2025-04-14'],
  ['gpt-4o', gpt4o, 'gpt-4o-2024-11-20', 'gpt-4o-2024-08-06'],
  ['gpt-4o-mini', gpt4o, 'gpt-4o-mini-2024-07-18'],
];

export const RESPONSES_MODELS = Object.freeze(
  definitions.flatMap(([baseModel, profile, ...snapshots]) =>
    [baseModel, ...snapshots].map((id) => ({
      ...profile,
      id,
      baseModel,
      source: `https://developers.openai.com/api/docs/models/${baseModel}`,
      jsonObject: profile.jsonObject ?? true,
      summaries: RESPONSES_SUMMARIES.filter(
        (value) => profile.reasoning.length && (value !== 'concise' || baseModel !== 'o3'),
      ),
    })),
  ),
);

export function responsesModel(id: string) {
  return RESPONSES_MODELS.find((model) => model.id === id);
}
