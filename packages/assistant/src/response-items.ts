import {
  publicSearchLink,
  type AssistantCitation,
  type AssistantPublicImage,
} from '@ai-xiutu/contracts';
import { z } from 'zod';

export const assistantUsage = z
  .object({
    input_tokens: z.number().int().nonnegative().max(10_000_000).optional(),
    output_tokens: z.number().int().nonnegative().max(10_000_000).optional(),
    total_tokens: z.number().int().nonnegative().max(20_000_000).optional(),
    input_tokens_details: z
      .object({
        cached_tokens: z.number().int().nonnegative().optional(),
        cache_write_tokens: z.number().int().nonnegative().optional(),
        cache_write_tokens_details: z
          .object({
            ttl_30m_tokens: z.number().int().nonnegative(),
            ttl_12h_tokens: z.number().int().nonnegative(),
          })
          .optional(),
      })
      .optional(),
    output_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative() })
      .optional(),
  })
  .refine((value) => value.input_tokens !== undefined || value.output_tokens !== undefined);

const call = z.object({
  type: z.literal('function_call'),
  id: z.string().min(1).max(256).optional(),
  call_id: z.string().regex(/^[\w.:-]{1,256}$/),
  name: z.string().regex(/^[\w-]{1,64}$/),
  arguments: z.string().max(20_000),
  status: z.literal('completed').optional(),
});
const message = z.object({
  type: z.literal('message'),
  id: z.string().min(1).max(256).optional(),
  role: z.literal('assistant').default('assistant'),
  status: z.enum(['completed', 'incomplete']).optional(),
  content: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('output_text'),
          text: z.string().max(20_000),
          annotations: z.array(z.unknown()).max(100).default([]),
        }),
        z.object({ type: z.literal('refusal'), refusal: z.string().max(4000) }),
      ]),
    )
    .max(16),
});
const reasoning = z.object({
  type: z.literal('reasoning'),
  id: z.string().min(1).max(256),
  summary: z
    .array(z.object({ type: z.literal('summary_text'), text: z.string().max(6000) }))
    .max(12),
  encrypted_content: z.string().max(200_000).nullish(),
});

export function readAssistantItems(data: Record<string, unknown>, publicSearch = false) {
  if (
    !['completed', 'incomplete'].includes(String(data.status)) ||
    !Array.isArray(data.output) ||
    data.output.length > 64
  )
    throw new Error('ASSISTANT_INVALID_RESPONSE');
  const calls: z.infer<typeof call>[] = [];
  const input: Record<string, unknown>[] = [];
  const text: string[] = [];
  const summaries: string[] = [];
  const citations: AssistantCitation[] = [];
  const images: AssistantPublicImage[] = [];
  let refused = false;
  let searched = false;
  let incomplete = data.status === 'incomplete';
  for (const raw of data.output) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('ASSISTANT_INVALID_ITEM');
    if (raw.type === 'message') {
      const parsed = message.safeParse(raw);
      if (!parsed.success) {
        if (parsed.error.issues.some((issue) => issue.code === 'too_big'))
          throw new Error('ASSISTANT_OUTPUT_BUDGET');
        throw new Error('ASSISTANT_INVALID_ITEM');
      }
      const item = parsed.data;
      incomplete ||= item.status === 'incomplete';
      for (const part of item.content) {
        if (part.type === 'refusal') {
          refused = true;
          text.push(part.refusal);
          continue;
        }
        text.push(part.text);
        if (publicSearch)
          for (const rawAnnotation of part.annotations) {
            const annotation = z
              .object({ type: z.literal('url_citation'), url: z.string(), title: z.string() })
              .safeParse(rawAnnotation);
            if (!annotation.success) continue;
            const url = publicSearchLink(annotation.data.url);
            if (url && citations.length < 20 && !citations.some((item) => item.url === url))
              citations.push({ url, title: annotation.data.title.slice(0, 300) });
          }
        // URLs and arbitrary provider annotations never become replayed instructions.
        part.annotations = [];
      }
      input.push(item);
    } else if (raw.type === 'function_call' && !publicSearch) {
      if (!incomplete) {
        const item = call.parse(raw);
        calls.push(item);
        input.push(item);
      }
    } else if (raw.type === 'reasoning') {
      const item = reasoning.parse(raw);
      input.push(item);
      summaries.push(...item.summary.map((summary) => summary.text));
    } else if (raw.type === 'web_search_call' && publicSearch) {
      if (raw.status !== 'completed') continue;
      searched = true;
      if (!Array.isArray(raw.results)) continue;
      for (const result of raw.results.slice(0, 20)) {
        if (!result || result.type !== 'image_result' || images.length >= 8) continue;
        const imageUrl = publicSearchLink(result.image_url);
        const sourceUrl = publicSearchLink(result.source_website_url);
        if (imageUrl && sourceUrl && !images.some((item) => item.imageUrl === imageUrl))
          images.push({
            imageUrl,
            sourceUrl,
            caption: typeof result.caption === 'string' ? result.caption.slice(0, 400) : '',
          });
      }
    } else throw new Error('ASSISTANT_INVALID_ITEM');
  }
  return {
    calls,
    input,
    text: text.join('\n'),
    citations,
    images,
    refused,
    incomplete,
    searched,
    reasoningSummary: summaries.join('\n').slice(0, 6000),
  };
}
