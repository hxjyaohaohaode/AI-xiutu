import { z } from 'zod';

export const OPENAI_TRANSLATION_MODEL = 'gpt-realtime-translate';
export const OPENAI_DECISIONS_MODEL = 'gpt-6-luna';
export const translationLanguages = [
  'af', 'ar', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es',
  'et', 'fa', 'fi', 'fil', 'fr', 'gl', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id',
  'is', 'it', 'iw', 'ja', 'kk', 'kn', 'ko', 'lt', 'lv', 'mi', 'mk', 'ml', 'mr',
  'ms', 'ne', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta',
  'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'yue', 'zh', 'zh-cn', 'zh-tw',
] as const;
export const liveTranslationSchema = z.object({
  language: z.enum(translationLanguages),
  sourceTranscript: z.boolean().default(false),
  noiseReduction: z.enum(['near_field', 'far_field']).nullable().optional(),
  noiseStrength: z.number().min(0).max(1).optional(),
}).strict().refine(
  (value) => value.noiseStrength === undefined || Boolean(value.noiseReduction),
  'Noise suppression strength requires an enabled input filter',
);
export type LiveTranslationOptions = z.input<typeof liveTranslationSchema>;

const name = z.string().trim().min(1).max(80);
const instructions = z.string().trim().min(1).max(1600);
export const liveDecisionQuestionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('predicate'), name, instructions }).strict(),
  z.object({ type: z.literal('choice'), name, instructions,
    choices: z.array(z.object({ value: name, description: instructions.optional() }).strict())
      .min(2).max(20).refine((items) => new Set(items.map((item) => item.value)).size === items.length),
  }).strict(),
  z.object({ type: z.literal('score'), name, instructions,
    levels: z.array(z.object({ label: name, description: instructions.optional() }).strict())
      .min(2).max(10).refine((items) => new Set(items.map((item) => item.label)).size === items.length),
  }).strict(),
]);
export const liveDecisionQuestionsSchema = z.array(liveDecisionQuestionSchema)
  .min(1).max(400)
  .refine((items) => new Set(items.map((item) => item.name)).size === items.length)
  .refine((items) => JSON.stringify(items).length <= 8000, 'Application text budget');
export type LiveDecisionQuestion = z.infer<typeof liveDecisionQuestionSchema>;
export const liveDelegationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('client') }).strict(),
  z.object({
    type: z.literal('responses'),
    prompt: instructions.optional(),
    maxOutputTokens: z.number().int().min(16).max(8192).optional(),
    serviceTier: z.enum(['auto', 'default', 'flex', 'priority']).optional(),
  }).strict(),
  z.object({
    type: z.literal('decisions'),
    questions: liveDecisionQuestionsSchema,
  }).strict(),
]);
export type LiveDelegationOptions = z.infer<typeof liveDelegationSchema>;
export const defaultLiveDecisionQuestions: readonly LiveDecisionQuestion[] = [{
  type: 'choice',
  name: 'intent',
  instructions: 'Classify the latest request as an image edit, image generation, or a general question.',
  choices: [{ value: 'edit' }, { value: 'generate' }, { value: 'general' }],
}];
