import test from 'node:test';
import assert from 'node:assert/strict';
import { collaborationFixture } from './collaboration-fixture.js';

const database = process.env.TEST_DATABASE_URL;
test('assistant preferences sync by actor and concurrent changes merge only the fields written', { skip: !database }, async () => {
  const f = await collaborationFixture(database!);
  const endpoint = '/v1/me/assistant-preferences';
  const actorId = f.actors.owner.id;
  try {
    const initial = await f.call('GET', endpoint);
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.json().version, 0);
    const rejected = await f.call('PATCH', endpoint, { actorId, patch: { mode: 'suggest' } }, 'operator');
    assert.equal(rejected.statusCode, 409);
    const invalid = await f.call('PATCH', endpoint, { actorId, patch: { mode: 'auto' } });
    assert.equal(invalid.statusCode, 400);
    const writes = await Promise.all([
      f.call('PATCH', endpoint, { actorId, patch: { textModel: 'gpt-5.4-mini', mode: 'suggest' } }),
      f.call('PATCH', endpoint, { actorId, patch: { captions: false, voiceModel: 'gpt-live-1' } }),
    ]);
    for (const write of writes) assert.equal(write.statusCode, 200, write.body);
    const staleImport = await f.call('PATCH', endpoint, { actorId, initialize: true, patch: { captions: true } });
    assert.equal(staleImport.statusCode, 200, staleImport.body);
    const current = await f.call('GET', endpoint);
    assert.equal(current.headers['cache-control'], 'private, no-store');
    assert.deepEqual(current.json(), {
      actorId, version: 2, value: { textModel: 'gpt-5.4-mini', voiceModel: 'gpt-live-1', mode: 'suggest', captions: false },
    });
    const other = await f.call('GET', endpoint, undefined, 'operator');
    assert.equal(other.json().version, 0);
    assert.equal(other.json().actorId, f.actors.operator.id);
  } finally {
    await f.close();
  }
});
