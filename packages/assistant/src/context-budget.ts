import { get_encoding } from 'tiktoken';

let encoder: ReturnType<typeof get_encoding> | undefined;
/** Text estimate using the explicit o200k vocabulary; visual usage is reserved separately. */
export function textTokens(text: string): number {
  encoder ??= get_encoding('o200k_base');
  // User and tool strings can contain literal model control markers. Count
  // these as ordinary text, including when budgeting previously saved turns.
  return encoder.encode_ordinary(text).length;
}
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  sourceTurnId?: string;
  candidateTrace?: string;
  recordTools?: string[];
}
export interface ContextBudget {
  contextWindowTokens: number;
  maxOutputTokens: number;
  visualTokenReserve: number;
}
export function historyContent(item: HistoryMessage) {
  const parts = [item.content];
  if (item.candidateTrace) parts.push(`Candidate decisions at admission: ${item.candidateTrace}`);
  if (item.sourceTurnId && item.recordTools?.length)
    parts.push(`Saved tool records (${item.recordTools.join(', ')}); read_history sourceTurnId=${item.sourceTurnId} to locate the original results.`);
  return parts.join('\n');
}
export class ContextBudgetError extends Error {
  constructor(public readonly code: string) {
    super(
      '上下文预算不足以保留当前要求和原始编辑约束，请提高模型上下文预算或明确整理要求后开启新会话',
    );
  }
}
export function textOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(textOnly);
  if (!value || typeof value !== 'object') return value;
  if ((value as any).type === 'input_image')
    return { type: 'input_image', image: '[reserved separately]' };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, textOnly(item)]));
}
/** Compacts model prose first. User instructions stay verbatim, in order, with
 * provenance. Exhaustion stops admission instead of silently dropping constraints. */
export function planHistory(
  history: HistoryMessage[],
  mandatory: unknown,
  images: number,
  budget: ContextBudget,
) {
  const reserved = budget.maxOutputTokens + images * budget.visualTokenReserve + 1024;
  const mandatoryTokens = textTokens(JSON.stringify(textOnly(mandatory)));
  const available = budget.contextWindowTokens - reserved - mandatoryTokens;
  if (available < 0) throw new ContextBudgetError('CONTEXT_INPUT_BUDGET');
  const messages = history.map((item) => ({ ...item }));
  const size = (item: HistoryMessage) => textTokens(historyContent(item)) + 12;
  // Tokenization is appreciably more expensive than JSON traversal. Each
  // immutable historical message needs one count, even when many are archived.
  const sizes = messages.map(size);
  const originalTokens = sizes.reduce((sum, count) => sum + count, 0);
  let tokens = originalTokens;
  const compacted = new Map<number, { pointer: string; original: number; tier: 'excerpt' | 'archive' }>();
  for (let i = 0; i < messages.length && tokens > available; i++) {
    const item = messages[i]!;
    if (item.role !== 'assistant') continue;
    const before = sizes[i]!;
    const pointer = `[Earlier assistant response archived${item.sourceTurnId ? `; read_history sourceTurnId=${item.sourceTurnId}` : ''}. Current requirements and permissions govern new actions.]`;
    const codepoints = Array.from(item.content);
    const excerpt = codepoints.length > 260
      ? codepoints.slice(0, 85).join('') + ' … ' + codepoints.slice(-125).join('') : '';
    const replacement = excerpt ? pointer + '\nHistorical excerpt (reference only): ' + JSON.stringify(excerpt) : pointer;
    const after = size({ ...item, content: replacement });
    if (after >= before) continue;
    item.content = replacement;
    tokens += after - before;
    sizes[i] = after;
    compacted.set(i, { pointer, original: before, tier: excerpt ? 'excerpt' : 'archive' });
  }
  for (const [i, record] of compacted) {
    if (tokens <= available) break;
    if (record.tier === 'archive') continue;
    messages[i]!.content = record.pointer;
    const after = size(messages[i]!);
    tokens += after - sizes[i]!;
    sizes[i] = after;
    record.tier = 'archive';
  }
  if (tokens > available) throw new ContextBudgetError('CONTEXT_CONSTRAINT_BUDGET');
  return {
    messages,
    manifest: {
      strategy: 'verbatim-user/candidate-trace/excerpt-then-archive-v3',
      tokenizer: 'o200k_base',
      originalTokens,
      retainedTokens: tokens,
      mandatoryTokens,
      reservedTokens: reserved,
      contextWindowTokens: budget.contextWindowTokens,
      compactedSourceIds: [...compacted.keys()].flatMap(i => messages[i]!.sourceTurnId ?? []),
      compaction: [...compacted].map(([i, record]) => ({
        sourceTurnId: messages[i]!.sourceTurnId ?? null, tier: record.tier,
        originalTokens: record.original, retainedTokens: sizes[i]!,
      })),
      candidateTraceSourceIds: history.flatMap((item) =>
        item.sourceTurnId && item.candidateTrace ? [item.sourceTurnId] : [],
      ),
      sourceTurnIds: [
        ...new Set(history.flatMap((item) => (item.sourceTurnId ? [item.sourceTurnId] : []))),
      ],
      preservesAllUserInstructions: true,
      visualTokensAreReservation: true,
    },
  };
}
