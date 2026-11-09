import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipe,
  createRecipeV2,
  createRecipeV3,
  createAdjustmentRegionV2,
  V2_TOOLS,
} from '@ai-xiutu/editor';
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
test('AI legacy adjustment proposals preserve the complete v2 recipe and never gain access to its new fields', () => {
  const base = createRecipeV2({
    levels: { gamma: 1.2 },
    hsl: { blue: { saturation: 12 } },
    detail: { texture: 18 },
    effects: { grain: { amount: 14, seed: 117 } },
    regions: [createAdjustmentRegionV2({ name: '既有局部调整', adjustments: { exposure: 0.5 } })],
  });
  const proposal = parseProposal(
    { summary: '只降低全局对比度', adjustments: { contrast: -20 } },
    base,
  );
  assert.equal(proposal.recipe.schemaVersion, 2);
  assert.deepEqual(proposal.recipe, {
    ...base,
    adjustments: { ...base.adjustments, contrast: -20 },
  });
  assert.deepEqual(base.adjustments.contrast, 0);
  assert.throws(() => parseProposal({ summary: '不可写', adjustments: {}, regions: [] }, base));
  assert.throws(() =>
    parseProposal({ summary: '不可写', adjustments: { 'detail.texture': 20 } }, base),
  );
});
test('new v2 plans expose only registry numeric values, keep the old default protocol byte-for-byte and bound moderation input', () => {
  const endpoint = validateQwenEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1');
  const base = createRecipeV2({
    regions: [createAdjustmentRegionV2({ name: '私有区域名不发给模型' })],
  });
  const legacy = preparePlan(endpoint, 'test-model', '请求', base);
  assert.equal(legacy.body, preparePlan(endpoint, 'test-model', '请求', base, 1).body);
  const prepared = preparePlan(endpoint, 'test-model', '图'.repeat(1500), base, 2);
  const request = JSON.parse(prepared.body);
  const values = JSON.parse(request.messages[1].content);
  assert.equal(values.proposalVersion, 2);
  assert.equal(Object.keys(values.currentParameters).length, V2_TOOLS.length);
  assert.equal(values.currentParameters['levels.gamma'], 1);
  assert.ok(!prepared.body.includes('私有区域名不发给模型'));
  assert.ok(Array.from(prepared.body).length <= 10_000);
  assert.equal(prepared.hash, digest(canonical({ endpoint, body: prepared.body })));
  assert.throws(() => preparePlan(endpoint, 'test-model', '请求', createRecipe(), 2));
});
test('v2 proposals atomically validate joint levels, report actual differences and preserve all regions', () => {
  const base = createRecipeV2({
    levels: { inputBlack: 0.1, inputWhite: 0.4, outputBlack: 0.2, outputWhite: 0.3 },
    regions: [createAdjustmentRegionV2({ name: '已确认区域', adjustments: { exposure: 0.4 } })],
  });
  const proposal = parseProposal(
    {
      summary: '拓展亮度范围、轻微分级',
      adjustments: { contrast: -12 },
      parameters: [
        { path: 'levels.inputBlack', value: 0.5 },
        { path: 'levels.inputWhite', value: 0.9 },
        { path: 'levels.outputBlack', value: 0.6 },
        { path: 'levels.outputWhite', value: 0.8 },
        { path: 'hsl.blue.saturation', value: 18 },
        { path: 'effects.grain.seed', value: 42 },
        { path: 'levels.gamma', value: 1 },
      ],
    },
    base,
    2,
  );
  assert.equal(proposal.proposalVersion, 2);
  assert.equal(proposal.recipe.schemaVersion, 2);
  assert.equal(proposal.parameterChanges?.length, 7, 'unchanged gamma is not a fabricated change');
  assert.deepEqual(
    proposal.parameterChanges?.find((item) => item.path === 'levels.inputBlack'),
    { path: 'levels.inputBlack', label: '输入黑场', before: 0.1, after: 0.5, unit: 'ratio' },
  );
  assert.deepEqual(proposal.recipe.regions, base.regions);
  assert.equal(base.levels.inputBlack, 0.1, 'base is immutable');
});
test('v3 global proposals preserve fine geometry, layers and warp without exposing their private data to the provider', () => {
  const base = createRecipeV3({
    transform: { rotationDegrees: 12.75, scaleX: 1.1 },
    optics: { aberrationRed: 0.75 },
    imageLayers: [
      {
        id: 'layer-one',
        name: 'Private composition name',
        enabled: true,
        opacity: 0.65,
        blendMode: 'soft-light',
        sourceId: 'local:private-layer',
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5,
        rotationDegrees: -6,
        flipX: false,
        flipY: true,
        mask: null,
      },
    ],
    warp: {
      enabled: true,
      strokes: [
        {
          id: 'warp-one',
          mode: 'push',
          from: { x: 0.5, y: 0.5 },
          to: { x: 0.55, y: 0.5 },
          radius: 0.2,
          feather: 0.7,
          strength: -0.25,
        },
      ],
    },
  });
  const prepared = preparePlan(
    validateQwenEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    'test-only-model',
    '稍微减曝光和蓝色饱和度',
    base,
    2,
  );
  assert.equal(prepared.body.includes('Private composition name'), false);
  assert.equal(prepared.body.includes('local:private-layer'), false);
  const result = parseProposal(
    {
      summary: '微调曝光和蓝色',
      adjustments: { exposure: -0.25 },
      parameters: [{ path: 'hsl.blue.saturation', value: -12 }],
    },
    base,
    2,
  );
  assert.equal(result.recipe.schemaVersion, 3);
  if (result.recipe.schemaVersion !== 3) throw new Error('expected v3');
  assert.deepEqual(result.recipe.transform, base.transform);
  assert.deepEqual(result.recipe.imageLayers, base.imageLayers);
  assert.deepEqual(result.recipe.warp, base.warp);
  assert.deepEqual(result.recipe.optics, base.optics);
  assert.equal(result.recipe.adjustments.exposure, -0.25);
  assert.equal(result.recipe.hsl.blue.saturation, -12);
  assert.equal(base.adjustments.exposure, 0);
  assert.throws(() =>
    parseProposal(
      {
        summary: '禁止模型擅改',
        adjustments: {},
        parameters: [{ path: 'transform.rotationDegrees', value: 20 }],
      },
      base,
      2,
    ),
  );
  assert.throws(() =>
    parseProposal(
      { summary: '禁止模型擅改', adjustments: {}, parameters: [], imageLayers: [] },
      base,
      2,
    ),
  );
});
test('v2 whitelist rejects arbitrary paths, duplicates, non-finite numbers, integer violations and invalid final levels', () => {
  const base = createRecipeV2();
  const make = (parameters: unknown) => ({ summary: '请求', adjustments: {}, parameters });
  for (const path of [
    'regions.0.opacity',
    'geometry.rotation',
    '__proto__.polluted',
    'constructor.prototype.x',
    'levels',
    'hsl.red',
  ])
    assert.throws(() => parseProposal(make([{ path, value: 1 }]), base, 2));
  for (const parameters of [
    [
      { path: 'levels.gamma', value: 1.1 },
      { path: 'levels.gamma', value: 1.2 },
    ],
    [{ path: 'levels.gamma', value: Infinity }],
    [{ path: 'levels.gamma', value: Number.NaN }],
    [{ path: 'effects.grain.seed', value: 1.5 }],
    [{ path: 'effects.grain.size', value: 2.2 }],
    [{ path: 'hsl.blue.saturation', value: 101 }],
    [
      { path: 'levels.inputBlack', value: 0.8 },
      { path: 'levels.inputWhite', value: 0.7 },
    ],
    [
      { path: 'levels.outputBlack', value: 0.9 },
      { path: 'levels.outputWhite', value: 0.1 },
    ],
    Array.from({ length: 53 }, () => ({ path: 'levels.gamma', value: 1 })),
  ])
    assert.throws(() => parseProposal(make(parameters), base, 2));
  assert.throws(() => parseProposal({ ...make([]), regions: [] }, base, 2));
  assert.throws(() => parseProposal(make([]), createRecipe(), 2));
  assert.throws(
    () => parseProposal(make([]), base, 1),
    'old protocol never silently accepts the new container',
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
