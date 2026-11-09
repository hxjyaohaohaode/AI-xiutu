import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ModuleRegistry,
  createBuiltinRegistry,
  aiResultDecisionSchema,
  commandEnvelopeSchema,
  sourceFrameSchema,
  assetCopyRequestSchema,
  type ModuleManifest,
} from '../src/index.js';

function manifest(id = 'custom', dependsOn: string[] = []): ModuleManifest {
  return {
    protocolVersion: 1,
    id,
    label: '自定义处理',
    version: '1.0.0',
    dependsOn,
    capabilities: [
      {
        id: `${id}.run`,
        label: '处理',
        implementation: 'implemented',
        execution: 'browser',
        permission: 'local',
        inputs: ['recipe'],
        outputs: ['recipe'],
        requires: [],
        confirmation: 'preview',
        persistence: 'revision',
        limitations: [],
      },
    ],
  };
}
test('module registry rejects duplicates, missing dependencies and cycles without executing code', () => {
  const duplicate = new ModuleRegistry().register(manifest());
  assert.throws(() => duplicate.register(manifest()), /Duplicate module/);
  const bad = manifest();
  bad.capabilities.push({ ...bad.capabilities[0]! });
  assert.throws(() => new ModuleRegistry().register(bad), /Duplicate capability/);
  assert.throws(
    () => new ModuleRegistry().register(manifest('custom', ['absent'])).seal(),
    /Missing module/,
  );
  assert.throws(
    () =>
      new ModuleRegistry()
        .register(manifest('a', ['b']))
        .register(manifest('b', ['a']))
        .seal(),
    /Cyclic module/,
  );
  assert.throws(() =>
    new ModuleRegistry().register({ ...manifest(), entryUrl: 'https://evil.invalid/code.js' }),
  );
  const wrongNamespace = manifest();
  wrongNamespace.capabilities[0]!.id = 'foreign.run';
  assert.throws(() => new ModuleRegistry().register(wrongNamespace), /namespace/);
});
test('asset copy contract accepts only a destination and stable request key, never caller ownership or bytes', () => {
  const request = { targetProjectId: randomUUID(), idempotencyKey: randomUUID() };
  assert.deepEqual(assetCopyRequestSchema.parse(request), request);
  for (const extra of [
    { actorId: randomUUID() },
    { storageKey: 'private' },
    { provenance: { kind: 'ai-generated' } },
    { allowCopy: true },
  ]) {
    assert.equal(assetCopyRequestSchema.safeParse({ ...request, ...extra }).success, false);
  }
  assert.equal(
    assetCopyRequestSchema.safeParse({ ...request, idempotencyKey: 'a-lost-response' }).success,
    false,
  );
});
test('sealed registry isolates caller data, resolves explicit gates and cannot pretend a contract has an executor', () => {
  const raw = manifest();
  const registry = new ModuleRegistry().register(raw).seal();
  raw.capabilities[0]!.label = 'changed';
  const list = registry.list();
  list[0]!.capabilities[0]!.label = 'also changed';
  assert.equal(registry.resolve('custom.run').label, '处理');
  assert.equal(registry.resolve('custom.run').runtime, 'available');
  assert.throws(() => registry.register(manifest('another')), /sealed/);
  assert.throws(() => registry.resolve('not.available'), /Unknown capability/);
  const builtin = createBuiltinRegistry();
  assert.equal(builtin.resolve('ai.image').runtime, 'unconfigured');
  assert.equal(
    builtin.resolve('ai.image', { 'generate-image': { available: true, reason: null } }).runtime,
    'available',
  );
  assert.equal(
    builtin.resolve('operations.payment', { payment: { available: true, reason: null } }).runtime,
    'unsupported',
  );
  assert.equal(builtin.resolve('portrait.analysis').runtime, 'unconfigured');
  assert.ok(builtin.discover().length >= 10);
});
test('decision schema keeps kind-specific fields, CAS and idempotency explicit', () => {
  const key = randomUUID();
  const art = randomUUID();
  const replacement = aiResultDecisionSchema.parse({
    protocolVersion: 1,
    idempotencyKey: key,
    action: 'replace',
    targetArtworkId: art,
    expectedVersion: 3,
  });
  assert.equal(replacement.action, 'replace');
  assert.ok('outputIndex' in replacement);
  assert.equal(replacement.outputIndex, 0);
  const layer = aiResultDecisionSchema.parse({
    protocolVersion: 1,
    idempotencyKey: key,
    action: 'layer',
    targetArtworkId: art,
    expectedVersion: 3,
  });
  assert.equal(layer.action, 'layer');
  assert.ok('outputIndex' in layer);
  assert.equal(layer.outputIndex, 0);
  for (const body of [
    { protocolVersion: 2, idempotencyKey: key, action: 'reject' },
    { protocolVersion: 1, idempotencyKey: key, action: 'replace', targetArtworkId: art },
    { protocolVersion: 1, idempotencyKey: key, action: 'layer', targetArtworkId: art },
    { protocolVersion: 1, idempotencyKey: key, action: 'reject', refund: true },
    { protocolVersion: 1, idempotencyKey: key, action: 'fork', outputIndex: -1 },
    { protocolVersion: 1, idempotencyKey: key, action: 'save-text', targetDocumentId: art },
    { protocolVersion: 1, idempotencyKey: key, action: 'save-text', expectedDocumentVersion: 2 },
  ])
    assert.equal(aiResultDecisionSchema.safeParse(body).success, false);
  assert.equal(
    aiResultDecisionSchema.safeParse({
      protocolVersion: 1,
      idempotencyKey: key,
      action: 'save-text',
      targetDocumentId: art,
      expectedDocumentVersion: 2,
    }).success,
    true,
  );
});
test('shared source frame binds analysis to normalized pixels and command envelope carries no actor authority', () => {
  const frame = {
    coordinates: 'source-normalized',
    contentHash: 'a'.repeat(64),
    width: 1024,
    height: 768,
    orientation: 'normalized',
  };
  assert.equal(sourceFrameSchema.safeParse(frame).success, true);
  assert.equal(sourceFrameSchema.safeParse({ ...frame, orientation: 'exif-6' }).success, false);
  assert.equal(sourceFrameSchema.safeParse({ ...frame, contentHash: 'unbound' }).success, false);
  const command = {
    protocolVersion: 1,
    commandId: 'history.result-decision',
    idempotencyKey: randomUUID(),
    projectId: randomUUID(),
    expectedVersion: 2,
    payload: {},
  };
  assert.equal(commandEnvelopeSchema.safeParse(command).success, true);
  assert.equal(
    commandEnvelopeSchema.safeParse({ ...command, actorId: randomUUID() }).success,
    false,
  );
  assert.equal(
    commandEnvelopeSchema.safeParse({ ...command, commandId: '__proto__.run' }).success,
    false,
  );
});
