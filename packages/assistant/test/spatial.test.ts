import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  createRecipeV3,
  createRecipeV4,
  createAdjustmentRegionV3,
  createRetouchRegionV4,
  createHealingOperationV4,
  compileSelectionMaskV3,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
import {
  applyAssistantRetouch,
  applyAssistantHealing,
  applyAssistantSequence,
  describeEditor,
  recipeHash,
  runEditorAgent,
  assistantModelConfigSchema,
  ASSISTANT_TOOLS,
  ASSISTANT_TOOL_NAMES,
} from '../src/index.js';

const mask: SelectionMaskV3 = {
  type: 'radial',
  centerX: 0.5,
  centerY: 0.5,
  radiusX: 0.22,
  radiusY: 0.24,
  feather: 0.3,
  invert: false,
};
const protection: SelectionMaskV3 = {
  ...mask,
  centerX: 0.43,
  radiusX: 0.07,
  radiusY: 0.3,
  feather: 0,
};
const base = () =>
  createRecipeV4({
    regionEdits: [createAdjustmentRegionV3({ id: 'blemish', name: '手动小选区', mask })],
    retouch: [createRetouchRegionV4({ id: 'manual', name: '受保护的选区', mask, protection })],
  });
const retouch = () => ({
  summary: '只调整已经圈选的区域并保留保护区',
  name: '局部质感',
  operationId: null,
  selection: { collection: 'retouch', id: 'manual' },
  protectedSelection: null,
  opacity: 0.8,
  radius: 0.06,
  smoothing: 70,
  texture: 8,
  uniformity: 30,
  shine: 20,
  speckle: 50,
  fineLines: 15,
});
const healing = (method = 'diffusion') => ({
  summary: '修复已圈选的小瑕疵',
  name: '小瑕疵',
  operationId: null,
  selection: { collection: 'regionEdits', id: 'blemish' },
  protectedSelection: null,
  opacity: 1,
  method,
  searchRadius: 0.5,
  iterations: 64,
  texture: 0.7,
  patchRadius: method === 'exemplar-v1' ? 2 : null,
});
function image() {
  const width = 53,
    height = 41,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      data.set([130 + ((x * 7 + y * 3) % 35), 95 + ((x * 5 + y * 7) % 25), 80 + (x % 12), 255], at);
      if (x === 26 && y === 20) data.set([12, 15, 10, 255], at);
      if (x < 3) data.set([255, 0, 255, 0], at);
    }
  return { width, height, data };
}
test('retouch candidates retain exact source masks/protection, edit actual pixels and leave excluded bytes intact', () => {
  const original = base(),
    hash = recipeHash(original),
    input = image(),
    bytes = input.data.slice();
  const candidate = applyAssistantRetouch(original, retouch());
  assert.equal(candidate.recipe.schemaVersion, 4);
  if (candidate.recipe.schemaVersion !== 4) throw new Error('v4');
  const operation = candidate.recipe.retouch[1]!;
  assert.equal(operation.algorithm, 'guided-v4');
  assert.deepEqual(operation.mask, mask);
  assert.deepEqual(operation.protection, protection);
  assert.deepEqual(candidate.recipe.retouch[0], original.retouch[0]);
  assert.deepEqual(candidate.recipe.warp, original.warp);
  const actual = renderEditorRecipe(input, candidate.recipe),
    baseline = renderEditorRecipe(input, original);
  assert.deepEqual(renderEditorRecipeTiled(input, candidate.recipe, { tileSize: 17 }), actual);
  const selected = compileSelectionMaskV3(mask, input),
    locked = compileSelectionMaskV3(protection, input);
  let changed = 0;
  for (let y = 0; y < input.height; y++)
    for (let x = 0; x < input.width; x++) {
      const at = (y * input.width + x) * 4,
        px = (x + 0.5) / input.width,
        py = (y + 0.5) / input.height;
      if (selected(px, py) === 0 || locked(px, py) === 1 || input.data[at + 3] === 0)
        assert.deepEqual(actual.data.subarray(at, at + 4), baseline.data.subarray(at, at + 4));
      else if (actual.data[at] !== baseline.data[at]) changed++;
      assert.equal(actual.data[at + 3], input.data[at + 3]);
    }
  assert.ok(changed > 10);
  assert.deepEqual(input.data, bytes);
  assert.equal(recipeHash(original), hash);
  assert.deepEqual(
    applyAssistantRetouch(original, retouch()),
    candidate,
    'stable independent operation id',
  );
  assert.ok(
    describeEditor(original).spatialSelections.some((r) => r.id === 'manual' && r.hasProtection),
  );
});

test('all three healing methods compose with crop/turn and preserve manual edits and protection', () => {
  const original = base(),
    input = image(),
    bytes = input.data.slice();
  original.retouch[0]!.mask = { ...mask, radiusX: 0.09, radiusY: 0.12 };
  original.retouch[0]!.protection = { ...protection, centerX: 0.46, radiusX: 0.02 };
  const selected = compileSelectionMaskV3(original.retouch[0]!.mask, input);
  for (const method of ['diffusion', 'patch-poisson', 'exemplar-v1']) {
    const proposal = { ...healing(method), selection: { collection: 'retouch', id: 'manual' } };
    const candidate = applyAssistantHealing(original, proposal);
    assert.ok(candidate.recipe.schemaVersion === 4);
    if (candidate.recipe.schemaVersion !== 4) throw new Error('v4');
    assert.deepEqual(candidate.recipe.healing[0]!.protection, original.retouch[0]!.protection);
    const result = renderEditorRecipe(input, candidate.recipe);
    assert.notDeepEqual(result.data, input.data);
    for (let y = 0; y < input.height; y++)
      for (let x = 0; x < input.width; x++) {
        if (selected((x + 0.5) / input.width, (y + 0.5) / input.height) !== 0) continue;
        const at = (y * input.width + x) * 4;
        assert.deepEqual(result.data.subarray(at, at + 4), input.data.subarray(at, at + 4));
      }
    const geometry = {
      crop: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 },
      rotation: 90 as const,
      flipX: true,
      flipY: false,
    };
    const combined = applyAssistantSequence(original, {
      summary: '受保护的小修复及构图',
      steps: [
        { type: 'healing', ...proposal },
        { type: 'geometry', ...geometry },
      ],
    });
    candidate.recipe.geometry = geometry;
    assert.deepEqual(
      renderEditorRecipe(input, combined.recipe),
      renderEditorRecipe(input, candidate.recipe),
    );
    assert.deepEqual(
      renderEditorRecipe(input, combined.recipe),
      renderEditorRecipeTiled(input, combined.recipe, { tileSize: 17 }),
    );
  }
  assert.deepEqual(input.data, bytes);
});

test('existing manual strength can decrease to neutral without stacking, losing donors or replacing portrait-owned work', () => {
  const original = base();
  original.retouch[0]!.smoothing = 90;
  const hash = recipeHash(original);
  const updated = applyAssistantRetouch(original, {
    ...retouch(),
    operationId: 'manual',
    smoothing: 15,
  });
  assert.ok(updated.recipe.schemaVersion === 4);
  if (updated.recipe.schemaVersion !== 4) throw new Error('v4');
  assert.equal(updated.recipe.retouch.length, 1);
  assert.equal(updated.recipe.retouch[0]!.smoothing, 15);
  assert.ok(
    !Object.hasOwn(updated.recipe.retouch[0]!, 'algorithm'),
    'updating a saved legacy operation preserves its algorithm',
  );
  assert.deepEqual(updated.recipe.retouch[0]!.protection, protection);
  assert.ok(updated.changes.some((change) => change.before === 90 && change.after === 15));
  const neutral = applyAssistantRetouch(original, {
    ...retouch(),
    operationId: 'manual',
    smoothing: 0,
    texture: 0,
    uniformity: 0,
    shine: 0,
    speckle: 0,
    fineLines: 0,
  });
  assert.deepEqual(renderEditorRecipe(image(), neutral.recipe), image());
  assert.equal(recipeHash(original), hash);
  original.healing.push(
    createHealingOperationV4({ id: 'donor', source: { x: 0.8, y: 0.1 }, protection }),
  );
  const repaired = applyAssistantHealing(original, {
    ...healing('patch-poisson'),
    operationId: 'donor',
    opacity: 0.25,
  });
  assert.ok(repaired.recipe.schemaVersion === 4);
  if (repaired.recipe.schemaVersion !== 4) throw new Error('v4');
  assert.equal(repaired.recipe.healing.length, 1);
  assert.deepEqual(repaired.recipe.healing[0]!.source, original.healing[0]!.source);
  assert.deepEqual(repaired.recipe.healing[0]!.protection, protection);
  const automatic = {
    moduleId: 'portrait.basic.v2',
    instanceId: 'face-1',
    parameterId: 'smooth',
    value: 90,
    parameters: { smooth: 90 },
  };
  original.retouch[0]!.origin = automatic;
  original.healing[0]!.origin = automatic;
  assert.throws(
    () => applyAssistantRetouch(original, { ...retouch(), operationId: 'manual' }),
    /OWNED/,
  );
  assert.throws(
    () => applyAssistantHealing(original, { ...healing(), operationId: 'donor' }),
    /OWNED/,
  );
  assert.throws(
    () => applyAssistantRetouch(original, { ...retouch(), operationId: 'absent' }),
    /NOT_FOUND/,
  );
  assert.throws(
    () => applyAssistantHealing(original, { ...healing(), operationId: 'absent' }),
    /NOT_FOUND/,
  );
});

test('extra protection adds an exclusion, unsupported references/algorithms/values fail without mutating the base', () => {
  const original = base(),
    hash = recipeHash(original);
  const allProtected = applyAssistantRetouch(original, {
    ...retouch(),
    protectedSelection: { collection: 'regionEdits', id: 'blemish' },
  });
  const input = image();
  // Feathered outer coverage is partial protection. The centre is fully protected.
  const output = renderEditorRecipe(input, allProtected.recipe);
  const at = (20 * input.width + 26) * 4;
  assert.deepEqual(output.data.subarray(at, at + 4), input.data.subarray(at, at + 4));
  for (const invalid of [
    { ...retouch(), selection: { collection: 'regionEdits', id: 'missing' } },
    { ...retouch(), selection: { collection: 'imageLayers', id: 'other' } },
    { ...retouch(), smoothing: 101 },
    { ...retouch(), radius: 0 },
    { ...retouch(), algorithm: 'remote-neural' },
    { ...retouch(), mask },
    { ...retouch(), opacity: 0 },
    { ...retouch(), smoothing: 0, texture: 0, uniformity: 0, shine: 0, speckle: 0, fineLines: 0 },
  ])
    assert.throws(() => applyAssistantRetouch(original, invalid));
  assert.throws(() => applyAssistantRetouch(createRecipeV3(), retouch()), /REQUIRES_V4/);
  assert.throws(
    () => applyAssistantHealing(original, { ...healing(), patchRadius: 2 }),
    /NOT_APPLICABLE/,
  );
  assert.throws(
    () => applyAssistantHealing(original, { ...healing('exemplar-v1'), iterations: 1 }),
    /iterations/,
  );
  assert.throws(() =>
    applyAssistantHealing(original, { ...healing(), source: { x: 0.1, y: 0.2 } }),
  );
  assert.throws(() => applyAssistantHealing(original, { ...healing(), iterations: 1.5 }));
  assert.equal(recipeHash(original), hash);
  assert.deepEqual(
    new Set(ASSISTANT_TOOLS.map((tool) => tool.name)),
    new Set(ASSISTANT_TOOL_NAMES),
  );
});

test('spatial tools enter the existing candidate render, later visual selection and bounded retry-free tool loop', async () => {
  const source = image(),
    original = base(),
    hash = recipeHash(original),
    bodies: any[] = [];
  const call = (name: string, args: unknown) => ({
    type: 'function_call',
    name,
    call_id: name,
    arguments: JSON.stringify(args),
  });
  const makeResponse = (output: unknown[]) =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output,
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
      {
        headers: { 'content-type': 'application/json', 'x-request-id': 'local-spatial-fixture' },
      },
    );
  const settings = assistantModelConfigSchema.parse({
    enabled: true,
    provider: 'openai',
    operations: ['assistant-turn'],
    unitCost: 5,
    imageInput: true,
  });
  const result = await runEditorAgent(
    'injected-no-network',
    'fixture',
    settings,
    {
      prompt: '只处理已圈选的小瑕疵，保留受保护的部分',
      recipe: original,
      executionMode: 'auto',
      imageDataUrl: `data:image/png;base64,${await sharp(Buffer.from(source.data), {
        raw: { width: source.width, height: source.height, channels: 4 },
      })
        .png()
        .toBuffer()
        .then((buffer) => buffer.toString('base64'))}`,
      allowWebSearch: false,
      async assertAccess() {},
      async moderate() {},
      async search() {
        return {};
      },
      async validateReferenceIds() {},
      async inspectCandidate(recipe) {
        const actual = renderEditorRecipe(source, recipe);
        assert.notDeepEqual(actual.data, source.data);
        return {
          observation: { actualPixelCount: actual.width * actual.height },
          imageDataUrl: `data:image/png;base64,${await sharp(Buffer.from(actual.data), {
            raw: { width: actual.width, height: actual.height, channels: 4 },
          })
            .png()
            .toBuffer()
            .then((buffer) => buffer.toString('base64'))}`,
        };
      },
    },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (bodies.length === 1)
        return makeResponse([
          call('propose_healing', healing()),
          call('inspect_candidate', { candidateIndex: 0 }),
        ]);
      if (bodies.length === 2) {
        assert.equal(
          body.input
            .flatMap((item: any) => item.content ?? [])
            .filter((item: any) => item.type === 'input_image').length,
          2,
        );
        return makeResponse([
          call('select_candidate', {
            candidateIndex: 0,
            reason: '仅已圈选区域发生修复，需用户继续核对细节',
          }),
        ]);
      }
      return makeResponse([
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '候选已检查，等待应用的授权校验。' }],
        },
      ]);
    },
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.selectedCandidateIndex, 0);
  assert.equal(bodies.length, 3);
  assert.equal(recipeHash(original), hash);
  assert.ok(result.candidates[0]!.observation);
});
