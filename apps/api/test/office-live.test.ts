import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeOfficeBlock } from '@ai-xiutu/contracts';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const insert = (position: number, text: string) => ({
  stepType: 'replace',
  from: position,
  to: position,
  slice: { content: [{ type: 'text', text }] },
});

test(
  'live document applies authorized steps exactly once and returns the full version trail',
  { skip: !databaseUrl },
  async (t) => {
    const f = await collaborationFixture(databaseUrl!);
    t.after(() => f.close());
    const created = await f.call('POST', '/v1/projects/' + f.projectId + '/documents', {
      title: 'Office',
      body: 'abc',
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().document.id,
      route = '/v1/documents/' + id + '/live';
    const first = {
      epoch: 1,
      version: 0,
      expectedVersion: 1,
      clientId: randomUUID(),
      mutationId: randomUUID(),
      steps: [insert(2, 'OWNER')],
    };
    const editor = {
      ...first,
      clientId: randomUUID(),
      mutationId: randomUUID(),
      steps: [insert(3, 'PEER')],
    };
    assert.equal((await f.call('GET', route, undefined, 'editor')).json().document.body, 'abc');
    const original = await f.call('POST', route, first);
    assert.equal(original.statusCode, 200, original.body);
    assert.deepEqual((await f.call('POST', route, first)).json(), original.json());
    assert.equal(
      (await f.call('POST', route, { ...first, steps: [insert(1, 'different')] })).statusCode,
      409,
    );
    const raced = await f.call('POST', route, editor, 'editor');
    assert.equal(raced.json().error.code, 'DOCUMENT_SYNC_REQUIRED');
    const delta = await f.call('GET', route + '?epoch=1&after=0', undefined, 'editor');
    assert.equal(delta.statusCode, 200, delta.body);
    assert.deepEqual(delta.json().steps, first.steps);
    assert.deepEqual(delta.json().clients, [f.actors.owner.id + '/' + first.clientId]);
    const rebased = { ...editor, version: 1, expectedVersion: 2, steps: [insert(8, 'PEER')] };
    assert.equal((await f.call('POST', route, rebased, 'editor')).statusCode, 200);
    const head = await f.call('GET', route);
    assert.equal(head.json().document.body, 'aOWNERbPEERc');
    assert.equal(head.json().document.version, 3);
    assert.equal(
      (await f.call('GET', '/v1/documents/' + id + '/versions/2')).json().document.body,
      'aOWNERbc',
    );
    for (const actor of ['outsider', 'viewer', 'operator'] as const) {
      const denied = await f.call('GET', route + '?epoch=1&after=0', undefined, actor);
      assert.ok([403, 404].includes(denied.statusCode));
      assert.doesNotMatch(denied.body, /OWNER|PEER/);
    }
    const invalid = {
      ...rebased,
      version: 2,
      expectedVersion: 3,
      mutationId: randomUUID(),
      steps: [
        {
          stepType: 'addMark',
          from: 1,
          to: 2,
          mark: { type: 'font', attrs: { value: 'x;url(...)' } },
        },
      ],
    };
    assert.equal((await f.call('POST', route, invalid, 'editor')).statusCode, 400);
    await f.call('PATCH', '/v1/documents/' + id, { expectedVersion: 3, body: 'Restored' });
    const reset = await f.call('GET', route + '?epoch=1&after=2');
    assert.equal(reset.json().kind, 'snapshot');
    assert.equal(reset.json().epoch, 4);
    assert.equal(reset.json().document.body, 'Restored');
    assert.equal((await f.call('POST', route, rebased, 'editor')).statusCode, 409);
    const reference = writeOfficeBlock({
      kind: 'reference',
      documentId: randomUUID(),
      version: 1,
      title: 'Foreign',
    });
    const foreign = await f.call('PATCH', '/v1/documents/' + id, {
      expectedVersion: 4,
      body: reference,
    });
    assert.equal(foreign.json().error.code, 'OFFICE_CHART_SOURCE_UNAVAILABLE');
  },
);
