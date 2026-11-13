import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV3,
  createRecipeV4,
  createAdjustmentRegionV3,
  renderRecipeV3,
} from '@ai-xiutu/editor';
import {
  applyAssistantProposal,
  applyAssistantSequence,
  runEditorAgent,
  recipeHash,
  RESPONSES_URL,
  type AgentContext,
  PcmResampler,
  voiceAudioEvent,
  voiceStartEvent,
  voiceEndpoint,
  voiceResultEvents,
  normalizeVoiceEvent,
  assistantModelConfigSchema,
  VoiceTranscriptBuffer,
  VOICE_MODELS,
  modelProfileError,
  RESPONSES_MODELS,
  responsesParameters,
} from '../src/index.js';
const settings = assistantModelConfigSchema.parse({
  enabled: true,
  provider: 'openai',
  operations: ['assistant-turn'],
  unitCost: 5,
  imageInput: true,
  webSearch: true,
});

test('OpenAI reasoning validation is model-specific and rejects an unverified production model', () => {
  assert.equal(new Set(RESPONSES_MODELS.map((profile) => profile.id)).size, 47);
  for (const model of ['gpt-6.1-sol', 'gpt-6-astra']) {
    assert.equal(
      modelProfileError(model, { ...settings, reasoningEffort: 'none' }),
      'RESPONSES_PROFILE_MISMATCH',
    );
    assert.equal(modelProfileError(model, { ...settings, reasoningEffort: 'low' }), undefined);
  }
  assert.equal(
    modelProfileError('gpt-6.1-terra', { ...settings, reasoningEffort: 'none' }),
    undefined,
  );
  assert.equal(
    modelProfileError('gpt-5.4-mini-2026-03-17', { ...settings, reasoningEffort: 'xhigh' }),
    undefined,
  );
  assert.equal(
    modelProfileError('gpt-5.4-mini-2026-03-17', { ...settings, reasoningEffort: 'max' }),
    'RESPONSES_PROFILE_MISMATCH',
  );
  assert.equal(modelProfileError('unverified-model', settings), 'RESPONSES_PROFILE_UNKNOWN');
  assert.equal(
    modelProfileError('o3', { ...settings, responses: { reasoningSummary: 'concise' } }),
    'RESPONSES_PROFILE_MISMATCH',
  );
  assert.equal(
    modelProfileError('chat-latest', { ...settings, responses: { temperature: 0.3 } }),
    'RESPONSES_PROFILE_MISMATCH',
  );
  const configured = assistantModelConfigSchema.parse({
    ...settings,
    reasoningEffort: 'none',
    responses: {
      reasoningMode: 'standard',
      verbosity: 'low',
      format: { type: 'json_object' },
      temperature: 0,
      topP: 0.8,
      serviceTier: 'fast',
      transport: 'websocket',
    },
  });
  assert.equal(modelProfileError('gpt-6.1-terra', configured), undefined);
  assert.equal(
    modelProfileError('gpt-6.1-terra', {
      ...configured,
      responses: { ...configured.responses, reasoningMode: 'pro', serviceTier: 'flex' },
    }),
    undefined,
  );
  assert.equal(
    modelProfileError('gpt-6.1-terra', {
      ...configured,
      responses: { serviceTier: 'ultrafast' },
    }),
    'RESPONSES_PROFILE_MISMATCH',
  );
  assert.equal(
    modelProfileError('gpt-4o-mini', { ...settings, responses: { transport: 'websocket' } }),
    undefined,
  );
  assert.deepEqual(responsesParameters(configured), {
    service_tier: 'fast',
    reasoning: { effort: 'none', mode: 'standard' },
    temperature: 0,
    top_p: 0.8,
    text: { verbosity: 'low', format: { type: 'json_object' } },
  });
  let deepSchema: object = { type: 'string' };
  for (let depth = 0; depth < 40; depth++) deepSchema = { items: deepSchema };
  for (const schema of [
    { type: 'object', properties: { answer: deepSchema } },
    { type: 'object', properties: { answer: { $ref: 'https://example.org/schema' } } },
  ])
    assert.equal(
      assistantModelConfigSchema.safeParse({
        ...settings,
        responses: { format: { type: 'json_schema', name: 'answer', schema } },
      }).success,
      false,
    );
});

test('composed creative edits preserve their immutable base and accumulate ordered steps', () => {
  const base = createRecipeV4();
  const before = recipeHash(base);
  const candidate = applyAssistantSequence(base, {
    summary: '低曝光、柔和曲线和竖向裁切',
    steps: [
      {
        type: 'adjust',
        summary: '调整曝光',
        target: 'global',
        targetId: null,
        changes: [{ path: 'adjustments.exposure', value: -1 }],
      },
      {
        type: 'adjust',
        summary: '保留颜色',
        target: 'global',
        targetId: null,
        changes: [{ path: 'adjustments.saturation', value: 20 }],
      },
      {
        type: 'curve',
        summary: '柔和暗部',
        channel: 'rgb',
        points: [
          { x: 0, y: 0.05 },
          { x: 1, y: 0.95 },
        ],
      },
      {
        type: 'geometry',
        crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
        rotation: 0,
        flipX: false,
        flipY: false,
      },
    ],
  });
  assert.equal(recipeHash(base), before);
  assert.equal(candidate.recipe.adjustments.exposure, -1);
  assert.equal(candidate.recipe.adjustments.saturation, 20);
  assert.deepEqual(candidate.recipe.curves.rgb, [
    [0, 0.05],
    [1, 0.95],
  ]);
  assert.equal(candidate.recipe.geometry.crop?.width, 0.5);
  assert.throws(() =>
    applyAssistantSequence(base, {
      summary: 'invalid',
      steps: [
        {
          type: 'geometry',
          crop: { x: 0.9, y: 0, width: 0.5, height: 1 },
          rotation: 0,
          flipX: false,
          flipY: false,
        },
      ],
    }),
  );
  assert.throws(() =>
    applyAssistantSequence(base, {
      summary: 'invalid',
      steps: [
        {
          type: 'adjust',
          summary: 'bad',
          target: 'global',
          targetId: null,
          changes: [{ path: '__proto__.bad', value: 1 }],
        },
      ],
    }),
  );
});
function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    prompt: '把这张图调得自然一点',
    recipe: createRecipeV4(),
    allowWebSearch: false,
    async assertAccess() {},
    async moderate() {},
    async search() {
      return { resources: [] };
    },
    async validateReferenceIds() {},
    ...overrides,
  };
}
function response(output: unknown[], extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ status: 'completed', output, usage: { output_tokens: 10 }, ...extra }),
    { headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-request' } },
  );
}
function text(value: string, annotations: unknown[] = []) {
  return {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: value, annotations }],
  };
}
function tool(name: string, args: unknown, callId = name) {
  return { type: 'function_call', name, call_id: callId, arguments: JSON.stringify(args) };
}

test('parallel research isolates literal public inputs, joins scoped evidence and records dispatch purposes', async () => {
  const observed: any[] = [],
    phases: any[] = [],
    purposes: string[] = [];
  let publicRequests = 0;
  let opened!: () => void;
  const allPublic = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const timeout = AbortSignal.timeout(3000);
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      prompt: '私人项目提示，不可发给公开检索分支',
      imageDataUrl: 'data:image/png;base64,AA==',
      allowWebSearch: true,
      publicSearch: { query: 'public one', kind: 'text' },
      research: [
        { kind: 'web', query: 'public two', resultKind: 'text' },
        { kind: 'cloud', query: 'private-asset', limit: 2 },
        { kind: 'canvas' },
      ],
      async search(query) {
        assert.equal(query, 'private-asset');
        return { resources: [] };
      },
      async inspectCandidate() {
        return { observation: { changedPixels: 17 }, imageDataUrl: 'data:image/png;base64,AA==' };
      },
      async onBranch(value) {
        phases.push(value);
      },
      async beforeDispatch(_index, _hash, meta) {
        purposes.push(meta.purpose);
      },
    }),
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      observed.push(body);
      if (typeof body.input === 'string') {
        assert.match(body.input, /^public (one|two)$/);
        assert.doesNotMatch(JSON.stringify(body), /private-asset|私人项目|base64/);
        if (++publicRequests === 2) opened();
        await Promise.race([
          allPublic,
          new Promise<void>((_, reject) =>
            timeout.addEventListener('abort', () => reject(timeout.reason), { once: true }),
          ),
        ]);
        return response([
          { type: 'web_search_call', status: 'completed' },
          text('公开结果', [
            {
              type: 'url_citation',
              url: `https://example.org/${body.input.split(' ')[1]}`,
              title: '公用来源',
            },
          ]),
        ]);
      }
      assert.equal(publicRequests, 2);
      assert.match(JSON.stringify(body.input), /private-asset/);
      assert.match(JSON.stringify(body.input), /changedPixels/);
      return response([text('三类来源已核对。')]);
    },
  );
  assert.equal(observed.length, 3);
  assert.deepEqual(purposes, ['web-search', 'web-search', 'research-merge']);
  assert.equal(result.citations.length, 2);
  const join = phases.find((phase) => phase.kind === 'merge' && phase.state === 'completed');
  assert.equal(join.dependsOn.length, 4);
  assert.equal(phases.at(-1).kind, 'root');
  assert.equal(phases.at(-1).state, 'completed');
});

test('model-delegated private search is scoped and cannot start a public request', async () => {
  let sent = 0;
  const nodes: string[] = [];
  await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      allowWebSearch: false,
      async onBranch(node) {
        if (node.state === 'completed') nodes.push(node.kind);
      },
    }),
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.ok(Array.isArray(body.input));
      return ++sent === 1
        ? response([
            tool('delegate_research', {
              queries: [{ query: 'scoped', limit: 2 }],
              inspectCanvas: false,
            }),
          ])
        : response([text('已汇总素材。')]);
    },
  );
  assert.deepEqual(nodes, ['cloud', 'merge', 'root']);
});

test('candidate inspection feeds real returned images into a later round before nomination and refinement', async () => {
  const bodies: any[] = [],
    inspected: number[] = [];
  const proposal = (value: number, id: string) =>
    tool(
      'propose_edit',
      {
        summary: '保留纹理，校正曝光',
        target: 'global',
        targetId: null,
        changes: [{ path: 'adjustments.exposure', value }],
      },
      id,
    );
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      imageDataUrl: 'data:image/png;base64,AA==',
      executionMode: 'auto',
      async inspectCandidate(recipe) {
        inspected.push(recipe.adjustments.exposure);
        return { observation: { changedPixels: 30 }, imageDataUrl: 'data:image/jpeg;base64,AQ==' };
      },
    }),
    async (_url, options) => {
      bodies.push(JSON.parse(String(options?.body)));
      if (bodies.length === 1)
        return response([
          proposal(-2, 'first'),
          tool('inspect_candidate', { candidateIndex: 0 }, 'inspect-first'),
          tool('select_candidate', { candidateIndex: 0, reason: '提前判断' }, 'too-early'),
        ]);
      if (bodies.length === 2)
        return response([
          proposal(-0.5, 'refined'),
          tool('inspect_candidate', { candidateIndex: 1 }, 'inspect-refined'),
        ]);
      if (bodies.length === 3)
        return response([
          tool('select_candidate', { candidateIndex: 1, reason: '观察后的第二个方案更自然' }),
        ]);
      return response([text('已对照候选画面，选定第二种曝光。')]);
    },
  );
  assert.deepEqual(inspected, [-2, -0.5]);
  assert.equal(result.selectedCandidateIndex, 1);
  assert.equal(result.candidates[1]!.recipe!.adjustments.exposure, -0.5);
  assert.deepEqual(
    result.candidates.map((c) => c.observation),
    [{ changedPixels: 30 }, { changedPixels: 30 }],
  );
  assert.match(
    bodies[1].input.find((i: any) => i.call_id === 'too-early' && i.type === 'function_call_output')
      .output,
    /REJECTED/,
  );
  const countImages = (body: any) =>
    body.input.flatMap((i: any) => i.content ?? []).filter((c: any) => c.type === 'input_image')
      .length;
  assert.deepEqual(bodies.map(countImages), [1, 2, 3, 3]);
  const nextInput = bodies[1].input;
  assert.equal(nextInput.at(-1).content[1].image_url, 'data:image/jpeg;base64,AQ==');
  assert.ok(nextInput.slice(0, -1).some((i: any) => i.type === 'function_call_output'));
});

test('candidate inspection respects sharing and caps three local renders per turn', async () => {
  for (const shared of [false, true]) {
    let inspections = 0,
      rounds = 0;
    const result = await runEditorAgent(
      'fixture',
      'fixture',
      settings,
      context({
        ...(shared ? { imageDataUrl: 'data:image/png;base64,AA==' } : {}),
        async inspectCandidate() {
          inspections++;
          return { observation: {}, imageDataUrl: 'data:image/png;base64,AA==' };
        },
      }),
      async () =>
        ++rounds === 1
          ? response([
              tool('propose_edit', {
                summary: '微调',
                target: 'global',
                targetId: null,
                changes: [{ path: 'adjustments.exposure', value: 0.2 }],
              }),
              ...[0, 1, 2, 3].map((i) =>
                tool('inspect_candidate', { candidateIndex: 0 }, `inspect-${i}`),
              ),
            ])
          : response([text('完成有限预览。')]),
    );
    assert.equal(inspections, shared ? 3 : 0);
    assert.equal(result.candidates[0]!.observation !== undefined, shared);
    assert.equal(result.selectedCandidateIndex, undefined);
  }
});
test('memory suggestions require exact user evidence and remain drafts for explicit confirmation', async () => {
  for (const valid of [true, false]) {
    let calls = 0;
    const result = await runEditorAgent(
      'fixture-not-a-key',
      'fixture-response',
      settings,
      context({ prompt: '以后人像都要保留雀斑与自然肤质。' }),
      async () =>
        ++calls === 1
          ? response([
              tool('suggest_memory', {
                scope: 'project',
                category: 'constraint',
                title: '自然人像',
                content: '保留雀斑与自然肤质',
                evidence: valid ? '保留雀斑与自然肤质' : '这是从参考图片推测的习惯',
              }),
            ])
          : response([text('请先检查要求及生效范围，再决定是否记住。')]),
    );
    assert.equal(result.memorySuggestions.length, valid ? 1 : 0);
    assert.equal(result.candidates.length, 0, 'remembering must not become an image action');
  }
});

test('assistant candidates use exact shared ranges, signed values and immutable V4 bases', () => {
  const base = createRecipeV4();
  const before = recipeHash(base);
  const result = applyAssistantProposal(base, {
    summary: '降低曝光',
    target: 'global',
    targetId: null,
    changes: [{ path: 'adjustments.exposure', value: -2 }],
  });
  assert.equal(result.recipe.adjustments.exposure, -2);
  assert.equal(recipeHash(base), before);
  assert.equal(result.recipe.schemaVersion, 4);
  assert.equal(result.changes[0]?.before, 0);
  for (const change of [
    { path: '__proto__.polluted', value: 1 },
    { path: 'adjustments.exposure', value: Infinity },
    { path: 'adjustments.exposure', value: 1000 },
    { path: 'assetId', value: 2 },
  ])
    assert.throws(() =>
      applyAssistantProposal(base, {
        summary: 'bad',
        target: 'global',
        targetId: null,
        changes: [change],
      }),
    );
  assert.equal(({} as any).polluted, undefined);
  assert.throws(() =>
    applyAssistantProposal(base, {
      summary: 'bad',
      target: 'global',
      targetId: 'x',
      changes: [{ path: 'adjustments.exposure', value: 1 }],
    }),
  );
  assert.throws(() =>
    applyAssistantProposal(base, {
      summary: 'bad',
      target: 'global',
      targetId: null,
      changes: [
        { path: 'adjustments.exposure', value: 1 },
        { path: 'adjustments.exposure', value: 2 },
      ],
    }),
  );
});
test('local AI changes affect only their selected region and actual rendered pixels', () => {
  const base = createRecipeV3({
    regionEdits: [
      createAdjustmentRegionV3({
        id: 'left',
        mask: {
          type: 'radial',
          centerX: 0.2,
          centerY: 0.5,
          radiusX: 0.2,
          radiusY: 0.4,
          feather: 0,
          invert: false,
        },
      }),
    ],
  });
  const proposed = applyAssistantProposal(base, {
    summary: '左侧提亮',
    target: 'region',
    targetId: 'left',
    changes: [{ path: 'adjustments.exposure', value: 1 }],
  }).recipe;
  const image = { width: 20, height: 10, data: new Uint8ClampedArray(20 * 10 * 4).fill(100) };
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  const a = renderRecipeV3(image, base),
    b = renderRecipeV3(image, proposed as any);
  assert.ok(b.data[(5 * 20 + 4) * 4]! > a.data[(5 * 20 + 4) * 4]!);
  assert.equal(b.data[(5 * 20 + 18) * 4], a.data[(5 * 20 + 18) * 4]);
  assert.equal(base.regionEdits[0]!.color.adjustments.exposure, 0);
  assert.throws(() =>
    applyAssistantProposal(base, {
      summary: 'bad',
      target: 'region',
      targetId: 'missing',
      changes: [{ path: 'adjustments.exposure', value: 1 }],
    }),
  );
});
test('Responses workflow invokes tools, keeps independently selected image model untouched, and cites sources', async () => {
  const bodies: any[] = [];
  const dispatch: number[] = [];
  const receipts: number[] = [];
  let n = 0;
  const result = await runEditorAgent(
    'fixture-not-a-key',
    'fixture-response',
    settings,
    context({
      allowWebSearch: true,
      publicSearch: { query: 'public studio reference', kind: 'text' },
      imageDataUrl: 'data:image/jpeg;base64,AA==',
      beforeDispatch: async (index) => {
        dispatch.push(index);
      },
      onReceipt: async (index) => {
        receipts.push(index);
      },
    }),
    async (url, init) => {
      assert.equal(String(url), RESPONSES_URL);
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      assert.equal(body.store, false);
      assert.equal(init?.redirect, 'error');
      if (n++ === 0)
        return response([
          { type: 'web_search_call', status: 'completed' },
          text('光线参考', [
            { type: 'url_citation', url: 'https://example.org/research', title: '研究资料' },
            { type: 'url_citation', url: 'javascript:alert(1)', title: 'bad' },
            { type: 'url_citation', url: 'https://secret:token@example.org/', title: 'bad' },
          ]),
        ]);
      if (n === 2)
        return response([
          tool('describe_editor', {}),
          tool('propose_edit', {
            summary: '降低高光',
            target: 'global',
            targetId: null,
            changes: [{ path: 'adjustments.highlights', value: -30 }],
          }),
          tool('draft_generation', {
            summary: '海报草案',
            prompt: '保留主角，添加雨夜背景',
            referenceAssetIds: [],
          }),
        ]);
      return response([
        text('候选已准备，请确认后应用。', [
          { type: 'url_citation', url: 'https://example.org/research', title: '研究资料' },
          { url: 'javascript:alert(1)', title: 'bad' },
          { url: 'https://secret:token@example.org/', title: 'bad' },
        ]),
      ]);
    },
  );
  assert.deepEqual(dispatch, [0, 1, 2]);
  assert.deepEqual(receipts, [0, 1, 2]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0]?.kind, 'edit');
  assert.equal(result.candidates[1]?.kind, 'generation');
  assert.equal(result.citations.length, 1);
  assert.ok(bodies[0].tools.some((item: any) => item.type === 'web_search'));
  assert.equal(bodies[0].input, 'public studio reference');
  assert.ok(!JSON.stringify(bodies[0]).includes('data:image'));
  assert.ok(bodies[1].input[0].content.some((item: any) => item.type === 'input_image'));
  assert.ok(!bodies[1].tools.some((item: any) => item.type === 'web_search'));
  assert.ok(bodies[2].input.some((item: any) => item.type === 'function_call_output'));
  assert.ok(!('modelId' in result.candidates[1]!));
});
test('without image/search consent neither is sent; unsupported arbitrary tools produce no mutations', async () => {
  let count = 0;
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context(),
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.ok(!body.tools.some((item: any) => item.type === 'web_search'));
      assert.ok(!JSON.stringify(body.input).includes('input_image'));
      return count++ === 0
        ? response([tool('execute_shell', { command: 'rm -rf x' })])
        : response([text('不能执行该操作。')]);
    },
  );
  assert.equal(result.candidates.length, 0);
});
test('tool arguments, joint curve constraints and foreign references fail closed', async () => {
  let count = 0;
  let checked = false;
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      validateReferenceIds: async () => {
        checked = true;
        throw new Error('forbidden');
      },
    }),
    async () =>
      count++ === 0
        ? response([
            tool('propose_curve', {
              summary: 'invalid',
              channel: 'rgb',
              points: [
                { x: 0, y: 0 },
                { x: 0, y: 1 },
                { x: 1, y: 1 },
              ],
            }),
            tool('draft_generation', {
              summary: 'private',
              prompt: 'use private',
              referenceAssetIds: ['11111111-1111-4111-8111-111111111111'],
            }),
          ])
        : response([text('请重新选择参数或素材。')]),
  );
  assert.ok(checked);
  assert.equal(result.candidates.length, 0);
});
test('repeated tool IDs cannot duplicate candidates and conflicting IDs fail', async () => {
  const call = tool(
    'propose_edit',
    {
      summary: '提亮',
      target: 'global',
      targetId: null,
      changes: [{ path: 'adjustments.exposure', value: 1 }],
    },
    'once',
  );
  let n = 0;
  const result = await runEditorAgent('fixture', 'fixture', settings, context(), async () =>
    n++ < 2 ? response([call]) : response([text('完成候选')]),
  );
  assert.equal(result.candidates.length, 1);
  n = 0;
  await assert.rejects(
    runEditorAgent('fixture', 'fixture', settings, context(), async () =>
      response([n++ === 0 ? call : tool('describe_editor', {}, 'once')]),
    ),
    /CALL_ID_CONFLICT/,
  );
});
test('output moderation covers all text, not just first chunk; revocation stops subsequent dispatch', async () => {
  const seen: string[] = [];
  const long = '普通文字'.repeat(3000) + '末尾审核标记';
  await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      moderate: async (value) => {
        seen.push(value);
      },
    }),
    async () => response([text(long)]),
  );
  assert.ok(seen.some((value) => value.endsWith('末尾审核标记')));
  let revoked = false,
    calls = 0;
  await assert.rejects(
    runEditorAgent(
      'fixture',
      'fixture',
      settings,
      context({
        assertAccess: async () => {
          if (revoked) throw new Error('REVOKED');
        },
      }),
      async () => {
        calls++;
        revoked = true;
        return response([tool('describe_editor', {})]);
      },
    ),
    /REVOKED/,
  );
  assert.equal(calls, 1);
});
test('incomplete/invalid envelopes and bounded failures do not pretend success', async () => {
  await assert.rejects(
    runEditorAgent(
      'fixture',
      'fixture',
      settings,
      context(),
      async () => new Response('{invalid', { headers: { 'content-type': 'application/json' } }),
    ),
    /不确定/,
  );
  await assert.rejects(
    runEditorAgent('fixture', 'fixture', settings, context(), async () =>
      response([text('x'.repeat(20_001))]),
    ),
    /OUTPUT_BUDGET/,
  );
});
test('Live and Realtime are distinct protocols; client cannot choose endpoint or oversized PCM', () => {
  assert.equal(voiceEndpoint('gpt-live-1'), 'wss://api.openai.com/v1/live/sessions');
  assert.match(voiceEndpoint('gpt-realtime-2.1'), /\/realtime\?model=gpt-realtime-2.1$/);
  assert.throws(() => voiceEndpoint('https://attacker.invalid'));
  const live = voiceStartEvent('gpt-live-1', 'marin', 2048) as any,
    realtime = voiceStartEvent('gpt-realtime-2.1', 'cedar', 8192) as any;
  assert.equal(live.type, 'session.start');
  assert.equal(live.session.store, false);
  assert.equal(live.session.delegation.type, 'client');
  assert.equal(realtime.type, 'session.update');
  assert.equal(realtime.session.max_output_tokens, 4096);
  assert.throws(() => voiceStartEvent('gpt-live-1', 'unverified-voice', 100));
  const pcm = Buffer.alloc(960).toString('base64');
  assert.equal(voiceAudioEvent('gpt-live-1', pcm).type, 'session.input_audio.append');
  assert.equal(voiceAudioEvent('gpt-realtime', pcm).type, 'input_audio_buffer.append');
  assert.throws(() => voiceAudioEvent('gpt-live-1', Buffer.alloc(9601).toString('base64')));
  assert.throws(() => voiceAudioEvent('gpt-live-1', 'AA=='));
  assert.equal(
    (voiceResultEvents('gpt-live-1', 'typed_1', '中文'.repeat(1000))[0] as any).delegation_id,
    null,
  );
  assert.ok(
    Buffer.byteLength(
      (voiceResultEvents('gpt-live-1', 'delegation-1', '中文'.repeat(1000))[0] as any).content,
    ) <= 450,
  );
  assert.equal(
    normalizeVoiceEvent({ type: 'session.updated', session: { api_key: 'private' } }),
    null,
  );
});
test('PCM conversion preserves packet-boundary continuity at 44.1, 48, 96 and 24 kHz', () => {
  for (const rate of [24000, 44100, 48000, 96000]) {
    const samples = Float32Array.from(
      { length: rate },
      (_, index) => 0.7 * Math.sin((index / rate) * 2 * Math.PI * 440),
    );
    const whole = new PcmResampler(rate).push(samples),
      converter = new PcmResampler(rate);
    const chunks: number[] = [];
    for (let index = 0; index < samples.length; index += 137)
      chunks.push(...converter.push(samples.slice(index, index + 137)));
    assert.ok(Math.abs(whole.length - 24000) <= 2);
    assert.equal(chunks.length, whole.length);
    assert.ok(chunks.every((value, index) => Math.abs(value - whole[index]!) <= 1));
  }
  assert.throws(() => new PcmResampler(48000, 0));
});

test('voice profiles expose only per-model voices and transcript chunks preserve ordinary sentences', () => {
  for (const model of VOICE_MODELS)
    for (const voice of model.voices)
      assert.doesNotThrow(() => voiceStartEvent(model.id, voice, 1024));
  assert.throws(() => voiceStartEvent('gpt-realtime-2.1', 'quartz', 1024));
  const transcript = new VoiceTranscriptBuffer();
  transcript.push({
    type: 'transcript',
    role: 'user',
    text: '把照片',
    delta: true,
    startMs: 0,
    endMs: 100,
  });
  transcript.push({
    type: 'transcript',
    role: 'user',
    text: '调亮一点',
    delta: true,
    startMs: 100,
    endMs: 600,
  });
  assert.equal(transcript.toString(), 'user: 把照片调亮一点');
  transcript.push({
    type: 'transcript',
    role: 'assistant',
    text: '好的',
    delta: true,
    itemId: 'reply',
  });
  transcript.push({
    type: 'transcript',
    role: 'assistant',
    text: '，我建议提高曝光。',
    delta: true,
    itemId: 'reply',
  });
  transcript.push({
    type: 'transcript',
    role: 'assistant',
    text: '我建议提高曝光。',
    delta: false,
    itemId: 'reply',
  });
  assert.equal(transcript.toString(), 'user: 把照片调亮一点\nassistant: 我建议提高曝光。');
  transcript.push({
    type: 'transcript',
    role: 'user',
    text: '保留高光',
    delta: true,
    startMs: 3000,
    endMs: 4000,
  });
  assert.ok(transcript.toString().endsWith('\nuser: 保留高光'));
  transcript.clear();
  assert.equal(transcript.toString(), '');
});
