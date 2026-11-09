import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipe } from '@ai-xiutu/editor';
import {
  canonical,
  validateQwenEndpoint,
  preparePlan,
  parseProposal,
  createQwenProvider,
  digest,
} from '../src/provider.js';

test('endpoint allowlist rejects userinfo, off-region, query and redirect targets', () => {
  for (const url of [
    'http://localhost/compatible-mode/v1',
    'https://evil.example/compatible-mode/v1',
    'https://dashscope.aliyuncs.com.evil.example/compatible-mode/v1',
    'https://user:pass@dashscope.aliyuncs.com/compatible-mode/v1',
    'https://dashscope.aliyuncs.com/compatible-mode/v1?key=x',
    'https://x.us-east-1.maas.aliyuncs.com/compatible-mode/v1',
  ])
    assert.throws(() => validateQwenEndpoint(url));
  assert.match(
    validateQwenEndpoint('https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),
    /chat\/completions$/,
  );
});
test('frozen input hashes include endpoint, exact JSON body and requested adjustments', () => {
  const endpoint = validateQwenEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1');
  const a = preparePlan(endpoint, 'approved-test-model', '降低对比度', createRecipe());
  const b = preparePlan(endpoint, 'approved-test-model', '增加对比度', createRecipe());
  assert.notEqual(a.hash, b.hash);
  assert.equal(a.hash, digest(canonical({ endpoint: a.endpoint, body: a.body })));
  assert.equal(a.body, a.moderationText);
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
});
test('AI proposals cannot call arbitrary tools, overwrite geometry or exceed parameter bounds', () => {
  const base = createRecipe({ adjustments: { exposure: 1 }, geometry: { rotation: 90 } });
  const proposal = parseProposal({ summary: '减少对比度', adjustments: { contrast: -25 } }, base);
  assert.equal(proposal.recipe.adjustments.contrast, -25);
  assert.equal(proposal.recipe.adjustments.exposure, 1);
  assert.equal(proposal.recipe.geometry.rotation, 90);
  assert.throws(() => parseProposal({ summary: 'x', adjustments: { contrast: 999 } }, base));
  assert.throws(() => parseProposal({ summary: 'x', adjustments: { faceLift: 30 } }, base));
  assert.throws(() =>
    parseProposal({ summary: 'x', adjustments: {}, tool: 'delete_project' }, base),
  );
});
test('real HTTP adapter uses bounded JSON, authorization, no redirects and never retries', async () => {
  const seen: RequestInit[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    seen.push(init!);
    return new Response(
      JSON.stringify({
        id: 'vendor-test-id',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({ summary: '建议', adjustments: { brightness: -10 } }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  const prepared = preparePlan(
    validateQwenEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    'test-model',
    '减弱亮度',
    createRecipe(),
  );
  const result = await createQwenProvider('test-only-not-real-key', fetcher).complete(prepared);
  assert.equal(result.requestId, 'vendor-test-id');
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.redirect, 'error');
  assert.equal(
    seen[0]!.body,
    prepared.body,
    'moderated/frozen bytes must be exactly the transmitted payload',
  );
  let attempts = 0;
  await assert.rejects(
    () =>
      createQwenProvider('test-only', async () => {
        attempts++;
        throw new Error('connection reset');
      }).complete(prepared),
    { code: 'AI_TRANSPORT_UNKNOWN' },
  );
  assert.equal(attempts, 1);
});
test('Qwen adapter retains vendor receipt for incomplete responses and rejects a definite error without retry', async () => {
  const prepared = preparePlan(
    validateQwenEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    'test-model',
    '减弱亮度',
    createRecipe(),
  );
  await assert.rejects(
    () =>
      createQwenProvider(
        'test-only',
        async () =>
          new Response(
            JSON.stringify({
              id: 'receipt-known',
              choices: [{ finish_reason: 'length', message: { content: '{}' } }],
            }),
            { status: 200 },
          ),
      ).complete(prepared),
    { code: 'AI_INCOMPLETE_RESPONSE', requestId: 'receipt-known', outcome: 'unknown' },
  );
  await assert.rejects(
    () =>
      createQwenProvider(
        'test-only',
        async () =>
          new Response(JSON.stringify({ error: { code: 'invalid_parameter' } }), {
            status: 400,
            headers: { 'x-request-id': 'rejected-known' },
          }),
      ).complete(prepared),
    { outcome: 'rejected', requestId: 'rejected-known' },
  );
});
