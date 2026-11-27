import test from 'node:test';
import { textOnly, textTokens } from '../src/context-budget.js';
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
    'RESPONSES_PROFILE_MISMATCH',
  );
  assert.equal(
    modelProfileError('gpt-6.1-terra', {
      ...configured, reasoningEffort: 'medium',
      responses: { reasoningMode: 'pro', serviceTier: 'flex' },
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

test('independent specialists use scoped parallel model calls and return evidence to one synthesis', async () => {
  const events: any[] = [],
    bodies: any[] = [],
    receipts: number[] = [];
  let started = 0;
  let release!: () => void;
  const bothStarted = new Promise<void>((done) => {
    release = done;
  });
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      prompt: '请两位专家复核这张图的色调与构图',
      imageDataUrl: 'data:image/png;base64,Y2FudmFz',
      visualAttachment: { kind: 'sketch', imageDataUrl: 'data:image/png;base64,c2tldGNo' },
      memory: 'private-memory-marker',
      selectedImages: [{ id: 'ref', dataUrl: 'data:image/png;base64,cHJpdmF0ZQ==' }],
      history: [{ role: 'user', content: 'private-history-marker' }],
      async onBranch(event) {
        events.push(event);
      },
      async onReceipt(index) {
        receipts.push(index);
      },
    }),
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      bodies.push(body);
      if (!body.tools) {
        assert.equal(body.model, 'fixture');
        assert.equal(body.store, false);
        assert.deepEqual(
          body.input[0].content.map((part: any) => part.type),
          ['input_text', 'input_image', 'input_text', 'input_image'],
        );
        assert.match(body.input[0].content[2].text, /attachment \(sketch\)/);
        assert.equal(body.input[0].content[3].image_url, 'data:image/png;base64,c2tldGNo');
        assert.doesNotMatch(
          JSON.stringify(body),
          /private-memory-marker|private-history-marker|cHJpdmF0ZQ|search_resources/,
        );
        if (++started === 2) release();
        await bothStarted;
        return response([
          text(body.instructions.includes('framing') ? '边缘应保留' : '高光接近截断'),
        ]);
      }
      if (bodies.length === 1)
        return response([
          tool('consult_specialists', { roles: ['tone-review', 'composition-review'] }),
        ]);
      const merged = body.input.at(-1);
      assert.equal(merged.type, 'function_call_output');
      assert.match(merged.output, /边缘应保留/);
      assert.match(merged.output, /高光接近截断/);
      return response([text('保留左边缘并降低高光。')]);
    },
  );
  assert.equal(result.text, '保留左边缘并降低高光。');
  assert.equal(result.termination, 'completed');
  assert.deepEqual(receipts.sort(), [0, 1, 2, 3]);
  assert.equal(bodies.length, 4);
  assert.deepEqual(
    events.find((event) => event.id === 'specialist-merge' && event.state === 'completed')
      .dependsOn,
    ['tone-review', 'composition-review'],
  );
});

test('a growing tool transcript repacks historical prose and preserves verbatim constraints', async () => {
  const history = [
    { role: 'user' as const, sourceTurnId: 'prior', content: '始终保留原图的长宽比。' },
    {
      role: 'assistant' as const,
      sourceTurnId: 'prior',
      content: '此前的构图分析包含细节。'.repeat(1000),
    },
  ];
  let firstSize = 0;
  await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({ history }),
    async (_url, options) => {
      firstSize = textTokens(JSON.stringify(textOnly(JSON.parse(String(options?.body)))));
      return response([text('完成')]);
    },
  );
  let sends = 0;
  const manifests: string[][] = [];
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    {
      ...settings,
      contextWindowTokens: firstSize + settings.maxOutputTokens + 1024 + 400,
    },
    context({
      history,
      onContext: async (manifest) => {
        manifests.push(manifest.compactedSourceIds);
      },
    }),
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      if (++sends === 1) return response([tool('describe_editor', {})]);
      assert.match(JSON.stringify(body.input), /始终保留原图的长宽比/);
      assert.match(JSON.stringify(body.input), /Earlier assistant response archived/);
      assert.equal(body.input.at(-1).type, 'function_call_output');
      return response([text('已保留原图比例。')]);
    },
  );
  assert.equal(result.termination, 'completed');
  assert.deepEqual(manifests, [[], ['prior']]);
});

test('a large requested tool-record page reaches the next model turn without recursive offloading', async () => {
  const source = '修复'.repeat(2600);
  const id = '10f5baf8-141c-41fd-b7e7-6d6730abb786';
  let sends = 0;
  assert.ok(textTokens(source) > 3000);
  const result = await runEditorAgent('fixture', 'fixture', settings, context({
    readToolResult: async (requestedId, offset, limit) => {
      assert.equal(requestedId, id);
      assert.equal(offset, 0);
      assert.equal(limit, 6000);
      return { artifactId: id, total: source.length, content: source };
    },
    storeToolResult: async () => { throw new Error('a bounded page must not create another archive'); },
  }), async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    if (++sends === 1) return response([tool('read_tool_result', { artifactId: id, offset: 0, limit: 6000 })]);
    assert.equal(JSON.parse(body.input.at(-1).output).content, source);
    return response([text('完整分页已收到。')]);
  });
  assert.equal(result.termination, 'completed');
  assert.equal(sends, 2);
});

test('synthesis reserves its dispatch and rejects repeat or late specialist requests', async () => {
  const bodies: any[] = [];
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context(),
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      bodies.push(body);
      if (bodies.length === 1) return response([tool('describe_editor', {})]);
      if (bodies.length === 2)
        return response([
          tool('consult_specialists', { roles: ['tone-review', 'delivery-review'] }),
        ]);
      assert.ok(body.tools);
      assert.match(body.input.at(-1).output, /TOOL_INPUT_OR_ACCESS_REJECTED/);
      return response([text('继续根据现有材料复核。')]);
    },
  );
  assert.equal(result.termination, 'completed');
  assert.equal(bodies.length, 3);
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
test('two replay-only frames terminate with the original reviewable candidate', async () => {
  const call = tool('propose_edit', {
    summary: 'Open the shadows', target: 'global', targetId: null,
    changes: [{ path: 'adjustments.shadows', value: 12 }],
  }, 'replay');
  let requests = 0;
  const result = await runEditorAgent('fixture', 'fixture', settings, context(), async (_url, init) => {
    requests++;
    if (requests === 3) {
      const { input } = JSON.parse(String(init?.body));
      assert.equal(input.filter((item: any) => item.call_id === 'replay').length, 2);
    }
    return response([call]);
  });
  assert.equal(requests, 3);
  assert.equal(result.termination, 'incomplete');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.selectedCandidateIndex, undefined);
});
test('a conflicting tool frame cannot launch a paid child or expose partial work', async () => {
  let requests = 0;
  let invoked = 0;
  await assert.rejects(
    runEditorAgent('fixture', 'fixture', settings, context({
      prompt: 'Draft a slide deck.',
      onTool: () => { invoked++; },
    }), async () => {
      requests++;
      return response([
        tool('delegate_studio_task', { tasks: [{ role: 'office-writer', brief: 'Draft a slide deck.' }] }, 'duplicate'),
        tool('describe_editor', {}, 'duplicate'),
      ]);
    }),
    /ASSISTANT_CALL_ID_CONFLICT/,
  );
  assert.equal(requests, 1);
  assert.equal(invoked, 0);
});

test('an office teammate receives only the selected source and returns an editable typed workbook', async () => {
  const prompt = 'Build an Excel work sheet from the approved project document.';
  const requests: any[] = [];
  const result = await runEditorAgent('fixture', 'fixture', settings, context({
    prompt,
    projectDocument: { id: 'source', version: 2, title: 'Metrics', body: 'verified-quantities: 14' },
    memory: 'owner-only-memory',
    history: [{ role: 'user', content: 'older-message' }],
  }), async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (requests.length === 1)
      return response([tool('delegate_studio_task', {
        tasks: [{ role: 'office-writer', brief: prompt }],
      }, 'office')]);
    if (String(body.instructions).includes('delegated office-writer')) {
      assert.deepEqual(body.tools.map((entry: { name: string }) => entry.name), ['draft_project_file']);
      assert.match(JSON.stringify(body.input), /verified-quantities/);
      assert.doesNotMatch(JSON.stringify(body.input), /owner-only-memory|older-message/);
      return response([tool('draft_project_file', {
        title: 'Report', format: 'xlsx', sections: [],
        table: { columns: ['Code', 'Count'], rows: [['001', 14]] },
      }, 'file')]);
    }
    assert.match(JSON.stringify(body.input), /fileIndex/);
    return response([text('The workbook is ready for review.')]);
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(result.files, [{
    title: 'Report', format: 'xlsx', body: '```sheet-tsv\n"Code"\t"Count"\n"001"\t14\n```',
  }]);
  assert.deepEqual(result.candidates, []);
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

test('nested studio delegation renders the child candidate before final reviewed nomination within the original budget', async () => {
  const brief = '把暗部提高一点';
  const tasks = [{ role: 'retoucher', brief }];
  const branches: any[] = [],
    requests: string[] = [];
  const output = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      prompt: brief + '，保留现有构图。',
      imageDataUrl: 'data:image/png;base64,b3JpZw==',
      memory: 'PRIVATE_MEMORY_ONLY',
      history: [{ role: 'user', content: 'PRIVATE_HISTORY_ONLY' }],
      onBranch: async (node) => {
        branches.push(node);
      },
      beforeDispatch: async (_i, _h, m) => {
        requests.push(m.branchId);
      },
      inspectCandidate: async (recipe) => {
        assert.equal(recipe.adjustments.exposure, 0.75);
        return { observation: { delta: 31 }, imageDataUrl: 'data:image/png;base64,ZWRpdA==' };
      },
    }),
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (requests.length === 1) return response([tool('delegate_studio_task', { tasks })]);
      if (requests.length <= 3) {
        const names = body.tools.map((t: any) => t.name);
        assert.doesNotMatch(JSON.stringify(body.input), /PRIVATE_MEMORY_ONLY|PRIVATE_HISTORY_ONLY/);
        assert.ok(
          !names.includes('search_resources') &&
            !names.includes('select_candidate') &&
            !names.includes('draft_generation'),
        );
        if (requests.length === 2) {
          assert.ok(names.includes('delegate_studio_task'));
          return response([tool('delegate_studio_task', { tasks })]);
        }
        assert.ok(!names.includes('delegate_studio_task'));
        return response([
          tool('propose_edit', {
            summary: '提亮暗部',
            target: 'global',
            targetId: null,
            changes: [{ path: 'adjustments.exposure', value: 0.75 }],
          }),
        ]);
      }
      assert.equal(requests.length, 4);
      assert.ok(!body.tools.some((t: any) => t.name === 'delegate_studio_task'));
      const handoff = JSON.parse(
        body.input.find((i: any) => i.type === 'function_call_output').output,
      );
      assert.equal(handoff.tasks[0].child.candidateIndex, 0);
      assert.deepEqual(handoff.observations, [{ candidateIndex: 0, observation: { delta: 31 } }]);
      assert.match(JSON.stringify(body.input.at(-1)), /ZWRpdA==/);
      return response([
        tool('select_candidate', { candidateIndex: 0, reason: '已比对原图与实际编辑预览' }),
      ]);
    },
  );
  assert.equal(output.termination, 'completed');
  assert.equal(output.selectedCandidateIndex, 0);
  assert.deepEqual(output.candidates[0]?.observation, { delta: 31 });
  const workers = branches.filter((b) => b.kind === 'retoucher' && b.state === 'completed');
  assert.equal(workers.length, 2);
  assert.deepEqual(requests, ['root', workers[1].id, workers[0].id, 'root']);
  assert.equal(workers[0].parentId, workers[1].id);
  assert.equal(branches.find((b) => b.kind === 'candidate').parentId, workers[0].id);
});

test('studio siblings produce separate edit and generation actions with isolated capabilities and exact current references', async () => {
  const source = 'b5426dfa-7fbf-4659-b4fd-d3b5358f0000';
  const privateId = '025c23b3-9aa3-4140-9c0d-d8bc39e52511';
  const branchIds: string[] = [],
    stored: string[] = [];
  let running = 0;
  let release!: () => void;
  const both = new Promise<void>((r) => {
    release = r;
  });
  const prompt = '提高曝光；生成海报';
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      prompt,
      selectedReferenceIds: [source],
      priorResourceCards: [
        { assetId: privateId, name: 'private-resource', sourceTurnId: privateId },
      ],
      beforeDispatch: async (_i, _hash, m) => {
        branchIds.push(m.branchId);
      },
      validateReferenceIds: async (refs) => assert.deepEqual(refs, [source]),
      storeToolResult: async (_id, data) => {
        stored.push(data);
        return source;
      },
    }),
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.instructions.includes('You are a delegated')) {
        if (++running === 2) release();
        await both;
        const names = body.tools.map((x: any) => x.name);
        assert.ok(!names.includes('delegate_studio_task'));
        assert.doesNotMatch(JSON.stringify(body.input), new RegExp(privateId));
        if (names.includes('draft_generation')) {
          assert.deepEqual(names, ['draft_generation']);
          assert.match(JSON.stringify(body.input), new RegExp(source));
          return response([
            tool('draft_generation', {
              summary: '生成活动海报',
              prompt: '竖版自然色的活动海报',
              referenceAssetIds: [source],
            }),
          ]);
        }
        assert.doesNotMatch(JSON.stringify(body.input), new RegExp(source));
        return response([
          tool('propose_edit', {
            summary: '提亮照片',
            target: 'global',
            targetId: null,
            changes: [{ path: 'adjustments.exposure', value: 0.5 }],
          }),
        ]);
      }
      if (branchIds.length === 1)
        return response([
          tool('delegate_studio_task', {
            tasks: [
              { role: 'retoucher', brief: '提高曝光' },
              { role: 'image-designer', brief: '生成海报' },
            ],
          }),
        ]);
      const handoff = JSON.parse(body.input.at(-1).output);
      assert.equal(handoff.tasks.length, 2);
      assert.notEqual(handoff.tasks[0].candidateIndex, handoff.tasks[1].candidateIndex);
      return response([text('两个候选可供使用。')]);
    },
  );
  assert.equal(result.termination, 'completed');
  assert.equal(result.candidates.find((c) => c.kind === 'edit')?.recipe?.adjustments.exposure, 0.5);
  assert.deepEqual(
    result.candidates.find((c) => c.kind === 'generation')?.generationEvidence?.references,
    [{ assetId: source, from: 'selected' }],
  );
  assert.ok(result.toolRecords?.some((r) => r.tool === 'delegate_studio_task'));
  assert.equal(stored.length, 1);
  assert.equal(branchIds.length, 4);
});

test('invalid assignments do not dispatch; workers cannot purchase, read private history or use hidden references', async () => {
  const hidden = '8d61ffb8-fb84-4772-bafb-1eb98ee1393b';
  const run = async (scenario: 'forged' | 'wrong-tool' | 'private-reference' | 'stop') => {
    let calls = 0,
      stop = false;
    const execution = runEditorAgent(
      'fixture',
      'fixture',
      settings,
      context({
        prompt: '生成一张海报',
        priorResourceCards: [{ assetId: hidden, name: 'private-resource', sourceTurnId: hidden }],
        assertAccess: async () => {
          if (stop) throw Error('REVOKED');
        },
        validateReferenceIds: async () => {
          throw Error('worker reached unauthorized reference validation');
        },
      }),
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        calls++;
        if (calls === 1)
          return response([
            tool('delegate_studio_task', {
              tasks: [
                {
                  role: 'image-designer',
                  brief: scenario === 'forged' ? 'private memory copied here' : '生成一张海报',
                },
              ],
            }),
          ]);
        if (body.instructions.includes('You are a delegated')) {
          if (scenario === 'stop') stop = true;
          assert.doesNotMatch(JSON.stringify(body.input[0]), new RegExp(hidden));
          if (scenario === 'private-reference')
            return response([
              tool('draft_generation', {
                summary: '海报',
                prompt: '竖版',
                referenceAssetIds: [hidden],
              }),
            ]);
          return response([tool('read_history', { sourceTurnId: hidden, offset: 0, limit: 6000 })]);
        }
        return response([text('没有生成可用候选。')]);
      },
    );
    if (scenario === 'stop') await assert.rejects(execution, /REVOKED/);
    else assert.deepEqual((await execution).candidates, []);
    assert.equal(calls, scenario === 'forged' || scenario === 'stop' ? 2 : scenario === 'wrong-tool' ? 3 : 4);
  };
  for (const scenario of ['forged', 'wrong-tool', 'private-reference', 'stop'] as const)
    await run(scenario);
});

test('a studio worker uses an informational MCP tool and continues in the same branch before handing its edit back', async () => {
  const ids: string[] = [];
  const prompt = '检查当前编辑器后将曝光降低半档。';
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      prompt,
      beforeDispatch: async (_i, _h, meta) => {
        ids.push(meta.branchId);
      },
    }),
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const names = body.tools.map((v: any) => v.name);
      if (ids.length === 1)
        return response([
          tool('delegate_studio_task', { tasks: [{ role: 'retoucher', brief: prompt }] }),
        ]);
      if (ids.length === 2) {
        assert.ok(names.includes('describe_editor'));
        const spec = body.tools.find((v: any) => v.name === 'delegate_studio_task').parameters
          .properties.tasks;
        assert.deepEqual(spec.items.properties.role.enum, ['retoucher']);
        assert.equal(spec.maxItems, 1);
        return response([tool('describe_editor', {}, 'lookup')]);
      }
      if (ids.length === 3) {
        assert.ok(!names.includes('describe_editor') && !names.includes('delegate_studio_task'));
        const registry = JSON.parse(body.input.at(-1).output);
        assert.ok(
          registry.parameters.some(
            (p: any) => p.path === 'adjustments.exposure' && p.current === 0,
          ),
        );
        return response([
          tool(
            'propose_edit',
            {
              summary: '降低半档',
              target: 'global',
              targetId: null,
              changes: [{ path: 'adjustments.exposure', value: -0.5 }],
            },
            'prepare',
          ),
        ]);
      }
      return response([text('已准备曝光候选。')]);
    },
  );
  assert.equal(result.candidates[0]?.recipe?.adjustments.exposure, -0.5);
  assert.equal(result.termination, 'completed');
  assert.equal(ids.length, 4);
  assert.equal(ids[1], ids[2]);
  assert.notEqual(ids[1], 'root');
});

test('parallel editing workers keep stable candidate order, scope their inputs and tools, and reserve root synthesis', async () => {
  const selected = '11111111-1111-4111-8111-111111111111';
  const hidden = '22222222-2222-4222-8222-222222222222';
  const bodies: any[] = [];
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context({
      prompt: '两位助手分别准备调色方案与再生图草案',
      memory: 'private-memory-marker',
      history: [{ role: 'user', content: 'private-history-marker' }],
      selectedReferenceIds: [selected],
      selectedImages: [{ id: selected, dataUrl: 'data:image/png;base64,U0VDUkVU' }],
      priorResourceCards: [{ assetId: hidden, sourceTurnId: 'previous', name: 'private-card' }],
      async validateReferenceIds(ids) {
        assert.deepEqual(ids, [selected]);
      },
    }),
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      bodies.push(body);
      if (!body.instructions.startsWith('You are a delegated')) {
        if (bodies.length === 1)
          return response([tool('delegate_studio_task', { tasks: [{role: 'colorist', brief: '调色'}, {role: 'image-designer', brief: '再生图'}] })]);
        assert.equal(
          body.tools.some((item: any) => item.name === 'delegate_studio_task'),
          false,
        );
        const merged = JSON.parse(body.input.at(-1).output).tasks;
        assert.deepEqual(
          merged.map((item: any) => [item.role, item.candidateIndex]),
          [
            ['colorist', 0],
            ['image-designer', 1],
          ],
        );
        return response([text('两项候选已准备好。')]);
      }
      assert.doesNotMatch(
        JSON.stringify(body),
        /private-memory-marker|private-history-marker|private-card|U0VDUkVU|22222222/,
      );
      if (body.instructions.startsWith('You are a delegated colorist')) {
        assert.deepEqual(
          body.tools.map((item: any) => item.name),
          ['propose_edit'],
        );
        await started;
        return response([
          tool('propose_edit', {
            summary: '曝光',
            target: 'global',
            targetId: null,
            changes: [{ path: 'adjustments.exposure', value: 0.5 }],
          }),
        ]);
      }
      assert.deepEqual(
        body.tools.map((item: any) => item.name),
        ['draft_generation'],
      );
      release();
      return response([
        tool('draft_generation', {
          summary: '再生图草案',
          prompt: '保留轮廓',
          referenceAssetIds: [selected],
        }),
      ]);
    },
  );
  assert.equal(bodies.length, 4);
  assert.equal(result.termination, 'completed');
  assert.equal(result.candidates[0]?.recipe?.adjustments.exposure, 0.5);
  assert.deepEqual(result.candidates[1]?.generationEvidence?.references, [
    { assetId: selected, from: 'selected' },
  ]);
});

test('an editing leaf cannot redelegate, write a document or read private library references', async () => {
  const withheldReference = '11111111-1111-4111-8111-111111111111';
  for (const [role, attempted] of [
    ['colorist', tool('delegate_studio_task', { tasks: [{role:'editing-lead', brief:'自然'}] })],
    ['colorist', tool('save_document', { body: 'draft' })],
    [
      'image-designer',
      tool('draft_generation', {
        summary: '变化',
        prompt: '保留色彩',
        referenceAssetIds: [withheldReference],
      }),
    ],
  ] as const) {
    let requests = 0;
    const result = await runEditorAgent(
      'fixture',
      'fixture',
      settings,
      context({
        priorResourceCards: [
          { assetId: withheldReference, sourceTurnId: 'prior', name: 'history only' },
        ],
      }),
      async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        if (++requests === 1) return response([tool('delegate_studio_task', { tasks: [{role, brief:'自然'}] })]);
        if (body.instructions.startsWith('You are a delegated')) return response([attempted]);
        assert.equal(JSON.parse(body.input.at(-1).output).tasks[0].status, 'unavailable');
        return response([text('没有可用候选。')]);
      },
    );
    assert.equal(requests, role === 'image-designer' ? 4 : 3);
    assert.deepEqual(result.candidates, []);
  }
});

test('renumbered team calls reuse the original handoff without another paid worker or duplicate candidate', async () => {
  let requests = 0;
  const team = { tasks: [{role:'colorist', brief:'自然'}] };
  const result = await runEditorAgent(
    'fixture',
    'fixture',
    settings,
    context(),
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      if (++requests === 1)
        return response([
          tool('delegate_studio_task', team, 'team-1'),
          tool('delegate_studio_task', team, 'team-2'),
        ]);
      if (requests === 2)
        return response([
          tool('propose_edit', {
            summary: '降曝光',
            target: 'global',
            targetId: null,
            changes: [{ path: 'adjustments.exposure', value: -0.5 }],
          }),
        ]);
      const outputs = body.input.filter((entry: any) => entry.type === 'function_call_output');
      assert.deepEqual(
        outputs.map((entry: any) => entry.call_id),
        ['team-1', 'team-2'],
      );
      assert.equal(outputs[0].output, outputs[1].output);
      return response([text('已准备候选。')]);
    },
  );
  assert.equal(requests, 3);
  assert.equal(result.candidates.length, 1);
});
