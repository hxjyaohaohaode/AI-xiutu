import test from 'node:test';
import assert from 'node:assert/strict';
import { planHistory, ContextBudgetError } from '../src/context-budget.js';
import { streamResponse } from '../src/stream.js';
import { validateAssistantWorkspace } from '@ai-xiutu/contracts';
import { ASSISTANT_TOOLS } from '../src/agent.js';

test('token compaction preserves every original user constraint and a source for archived responses', () => {
  const history = Array.from({ length: 20 }, (_, i) => [
    {
      role: 'user' as const,
      sourceTurnId: `turn-${i}`,
      content: `${i}: 只换背景，不改变人物、衣服、五官、构图。后续任何色调修改也须遵守。`,
    },
    {
      role: 'assistant' as const,
      sourceTurnId: `turn-${i}`,
      content: '这是尚未采纳的助手建议。'.repeat(300),
      candidateTrace: JSON.stringify([
        { id: `choice-${i}`, decision: 'previewed', base_version: i + 1 },
      ]),
    },
  ]).flat();
  const plan = planHistory(history, { user: '颜色再淡一点' }, 0, {
    contextWindowTokens: 8192,
    maxOutputTokens: 1024,
    visualTokenReserve: 4096,
  });
  assert.deepEqual(
    plan.messages.filter((m) => m.role === 'user'),
    history.filter((m) => m.role === 'user'),
  );
  assert.ok(plan.manifest.compactedSourceIds.length > 0);
  assert.equal(plan.manifest.candidateTraceSourceIds.length, 20);
  for (const entry of plan.messages.filter((item) => item.role === 'assistant'))
    assert.equal(
      entry.candidateTrace,
      history.find((item) => item.sourceTurnId === entry.sourceTurnId && item.role === 'assistant')
        ?.candidateTrace,
    );
  assert.ok(plan.manifest.retainedTokens < plan.manifest.originalTokens);
  assert.ok(
    plan.manifest.retainedTokens + plan.manifest.mandatoryTokens + plan.manifest.reservedTokens <=
      8192,
  );
  assert.equal(
    history[1]!.content,
    '这是尚未采纳的助手建议。'.repeat(300),
    'original evidence remains unchanged',
  );
  assert.throws(
    () =>
      planHistory(
        history.filter((m) => m.role === 'user'),
        {},
        2,
        { contextWindowTokens: 8192, maxOutputTokens: 1024, visualTokenReserve: 4096 },
      ),
    ContextBudgetError,
  );
  assert.throws(
    () =>
      planHistory(history, {}, 0, {
        contextWindowTokens: 2200,
        maxOutputTokens: 1024,
        visualTokenReserve: 4096,
      }),
    ContextBudgetError,
  );
});

const packet = (event: unknown) => `data: ${JSON.stringify(event)}\r\n\r\n`;
test('real SSE frames preserve split UTF-8, stream approved text, and require a terminal receipt', async () => {
  const bytes = new TextEncoder().encode(
    packet({ type: 'response.output_text.delta', delta: '保留人物。' }) +
      packet({ type: 'response.output_text.delta', delta: '调整背景。' }) +
      packet({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: '保留人物。调整背景。' }],
            },
          ],
          usage: { output_tokens: 10 },
        },
      }),
  );
  const chunks: string[] = [];
  const result = await streamResponse(
    'https://api.openai.com/v1/responses',
    'fixture-only',
    { stream: true },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'fixture-sse' } },
      ),
    async (text) => {
      chunks.push(text);
    },
  );
  assert.equal(chunks.join(''), '保留人物。调整背景。');
  assert.equal(result.requestId, 'fixture-sse');
  assert.equal(result.data.usage.output_tokens, 10);
  let sends = 0;
  await assert.rejects(
    streamResponse(
      'https://api.openai.com/v1/responses',
      'fixture-only',
      { stream: true },
      async () => {
        sends++;
        return new Response(packet({ type: 'response.output_text.delta', delta: '不完整' }), {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
      async () => {},
    ),
    (error: any) => error.outcome === 'unknown',
  );
  assert.equal(sends, 1, 'interrupted billable requests are never retried');
});

test('generative workspace uses only registered cards, existing candidates and explicit image references', () => {
  const spec = validateAssistantWorkspace(
    {
      title: '选择自然程度',
      sections: [
        { type: 'candidates', title: '比较方案', candidateIndices: [0] },
        { type: 'parameters', title: '参数', candidateIndex: 0 },
        {
          type: 'clarification',
          title: '方向',
          question: '更偏向哪一种？',
          choices: ['温暖', '清冷'],
        },
        { type: 'budget', title: '实际预算' },
      ],
    },
    [{ kind: 'edit' }],
    [],
  );
  assert.equal(spec.sections.length, 4);
  for (const section of [
    { type: 'script', title: 'x', code: 'fetch(secret)' },
    { type: 'candidates', title: 'x', candidateIndices: [5] },
    { type: 'parameters', title: 'x', candidateIndex: 1 },
    { type: 'budget', title: 'x', amount: 0 },
    { type: 'references', title: 'x', assetIds: ['813c4820-e010-4381-98aa-362f1bc8d8cf'] },
  ])
    assert.throws(() =>
      validateAssistantWorkspace({ title: 'invalid', sections: [section] }, [{ kind: 'edit' }], []),
    );
  assert.ok(
    !JSON.stringify(ASSISTANT_TOOLS).includes('"oneOf"'),
    'OpenAI tools must use the supported anyOf subset',
  );
});
