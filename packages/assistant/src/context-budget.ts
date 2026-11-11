import { getEncoding } from 'js-tiktoken';

let encoder: ReturnType<typeof getEncoding> | undefined;
/** Text estimate using the explicit o200k vocabulary; visual usage is reserved separately. */
export function textTokens(text: string): number {
  encoder ??= getEncoding('o200k_base');
  return encoder.encode(text, [], []).length;
}
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  sourceTurnId?: string;
  candidateTrace?: string;
}
export interface ContextBudget {
  contextWindowTokens: number;
  maxOutputTokens: number;
  visualTokenReserve: number;
}
export function historyContent(item: HistoryMessage) {
  return item.candidateTrace
    ? `${item.content}\nCandidate decisions at admission: ${item.candidateTrace}`
    : item.content;
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
  const compacted: string[] = [];
  for (let i = 0; i < messages.length && tokens > available; i++) {
    const item = messages[i]!;
    if (item.role !== 'assistant') continue;
    const before = sizes[i]!;
    // The archive pointer replaces the whole assistant message. It is not a
    // generated summary and never pretends a missing visual result was observed.
    const replacement = `[Earlier assistant response archived${item.sourceTurnId ? `; read_history sourceTurnId=${item.sourceTurnId}` : ''}. Original user instructions immediately above remain authoritative.]`;
    const after = size({ ...item, content: replacement });
    if (after >= before) continue;
    item.content = replacement;
    tokens += after - before;
    if (item.sourceTurnId) compacted.push(item.sourceTurnId);
  }
  if (tokens > available) throw new ContextBudgetError('CONTEXT_CONSTRAINT_BUDGET');
  return {
    messages,
    manifest: {
      strategy: 'verbatim-user/candidate-trace/archive-assistant-v2',
      tokenizer: 'o200k_base',
      originalTokens,
      retainedTokens: tokens,
      mandatoryTokens,
      reservedTokens: reserved,
      contextWindowTokens: budget.contextWindowTokens,
      compactedSourceIds: compacted,
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
