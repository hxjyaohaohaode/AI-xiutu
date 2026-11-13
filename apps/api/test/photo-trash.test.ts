import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PHOTO_TRASH_MS, type PhotoTrashEntry } from '@ai-xiutu/contracts';
import { transaction } from '@ai-xiutu/db';
import { sweepPhotoTrash } from '../src/photo-trash-cleanup.js';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('photo trash enforces project access and the 48-hour deadline and reclaims unshared files', {
  skip: !databaseUrl,
}, async () => {
  const f = await collaborationFixture(databaseUrl!);
  const work = f.artwork.artwork;
  const branch = '/v1/artworks/' + work.id;
  const workDelete = branch + '?expectedVersion=' + work.headVersion;
  const sourceDelete = '/v1/assets/' + f.assetId;
  const privateDelete = '/v1/assets/' + f.privateAssetId;
  const list = '/v1/photo-trash';
  const restore = (item: PhotoTrashEntry, actor: 'owner' | 'editor' | 'viewer' | 'outsider' = 'owner') =>
    f.call('POST', `${list}/${item.kind}/${item.id}/restore`, { token: item.token }, actor);
  async function trash(route: string) {
    const response = await f.call('DELETE', route);
    assert.equal(response.statusCode, 200, response.body);
    const item = response.json().item as PhotoTrashEntry;
    assert.equal(Date.parse(item.expiresAt) - Date.parse(item.deletedAt), PHOTO_TRASH_MS);
    return item;
  }
  async function expire(item: PhotoTrashEntry) {
    const table = item.kind === 'asset' ? 'assets' : 'artworks';
    await f.db.query(`UPDATE ${table} SET deleted_at=clock_timestamp()-interval '49 hours' WHERE id=$1`, [item.id]);
  }
  try {
    assert.equal((await f.call('DELETE', branch + '?expectedVersion=2')).statusCode, 409);
    assert.equal((await f.call('DELETE', workDelete, undefined, 'viewer')).statusCode, 403);
    assert.equal((await f.call('DELETE', workDelete, undefined, 'outsider')).statusCode, 404);
    const joinRoom = await f.call('POST', branch + '/collaboration/sessions', { clientId: randomUUID() }, 'editor');
    assert.equal(joinRoom.statusCode, 201, joinRoom.body);
    const session = joinRoom.json().session;
    const acquire = await f.call('POST', branch + '/collaboration/leases',
      { sessionId: session.id, target: { kind: 'document' } }, 'editor');
    assert.equal(acquire.statusCode, 201, acquire.body);
    assert.equal((await f.call('DELETE', workDelete)).json().error.code, 'COLLABORATION_LOCKED');
    await f.call('DELETE', branch + '/collaboration/sessions/' + session.id, undefined, 'editor');

    const removedWork = await trash(workDelete);
    const removedPrivate = await trash(privateDelete);
    assert.equal((await f.call('DELETE', workDelete)).json().item.token, removedWork.token);
    assert.equal((await f.call('GET', branch)).statusCode, 404);
    assert.equal((await f.call('GET', branch + '/revisions')).statusCode, 404);
    assert.equal((await f.call('GET', branch + '/revisions/' + f.artwork.revision.id + '/render-info')).statusCode, 404);
    assert.equal((await f.call('GET', branch + '/collaboration')).statusCode, 404);
    assert.equal((await f.call('GET', '/v1/projects/' + f.projectId)).json().artworks.length, 0);
    assert.equal((await f.call('GET', sourceDelete + '/file')).statusCode, 200);
    assert.equal((await f.call('DELETE', sourceDelete)).json().error.code, 'ASSET_IN_USE');
    assert.equal((await f.call('GET', privateDelete + '/file')).statusCode, 404);
    assert.equal((await f.call('GET', '/v1/resources')).json().resources.length, 1);
    const first = (await f.call('GET', list + '?limit=1')).json();
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor);
    const second = (await f.call('GET', list + '?limit=1&cursor=' + first.nextCursor)).json();
    assert.equal(second.items.length, 1);
    assert.notEqual(second.items[0].token, first.items[0].token);
    assert.deepEqual((await f.call('GET', list, undefined, 'editor')).json().items.map((item: PhotoTrashEntry) => item.id), [work.id]);
    for (const actor of ['viewer', 'outsider', 'operator'] as const)
      assert.deepEqual((await f.call('GET', list, undefined, actor)).json().items, []);
    assert.equal((await restore(removedWork, 'viewer')).statusCode, 403);
    assert.equal((await restore(removedPrivate, 'editor')).statusCode, 404);
    assert.equal((await restore(removedWork, 'editor')).statusCode, 200);
    const restoredWork = (await f.call('GET', branch)).json();
    assert.equal(restoredWork.artwork.headVersion, work.headVersion);
    assert.equal(restoredWork.revision.id, f.artwork.revision.id);

    const storageRow = (await f.db.query('SELECT storage_key,bytes FROM assets WHERE id=$1', [f.assetId])).rows[0]!;
    await f.storage.thumbnail(storageRow.storage_key);
    const sharedPath = f.storage.path(storageRow.storage_key);
    await expire(removedPrivate);
    assert.equal((await restore(removedPrivate)).statusCode, 410);
    assert.equal((await f.call('GET', list)).json().items.length, 0);
    await sweepPhotoTrash(f.db, f.storage);
    await access(sharedPath);
    assert.equal((await f.call('GET', sourceDelete + '/thumbnail')).statusCode, 200);
    const privateStorage = (await f.call('GET', `/v1/spaces/${f.actors.owner.spaceId}/storage`)).json().storage;
    assert.equal(privateStorage.retainedAssets, 0);
    assert.equal(privateStorage.retainedBytes, 0);

    const later = await trash(workDelete);
    assert.notEqual(later.token, removedWork.token);
    assert.equal((await restore(removedWork)).statusCode, 409);
    await expire(later);
    await sweepPhotoTrash(f.db, f.storage);
    assert.equal((await restore(later)).statusCode, 410);
    assert.equal((await f.db.query('SELECT id FROM revisions WHERE id=$1', [f.artwork.revision.id])).rowCount, 1);

    const gif = randomUUID();
    const original = randomUUID();
    const gifPath = join(f.directory, 'animation-v1', gif + '.gif');
    const originalPath = join(f.directory, 'media-v1', original);
    await mkdir(join(f.directory, 'animation-v1'), { recursive: true });
    await mkdir(originalPath, { recursive: true });
    await writeFile(gifPath, Buffer.alloc(12));
    await writeFile(join(originalPath, 'source'), Buffer.alloc(17));
    await transaction(f.db, async (tx) => {
      await tx.query(
        `INSERT INTO media_import_jobs(id,project_id,actor_id,idempotency_key,request_hash,name,expected_bytes,state,asset_id)
         VALUES($1,$2,$3,$4,'test','fixture',17,'ready',$5)`,
        [original, f.projectId, f.actors.owner.id, randomUUID(), f.assetId],
      );
      await tx.query("INSERT INTO media_objects(id,descriptor,retained_bytes) VALUES($1,'{}',17)", [original]);
      await tx.query('INSERT INTO media_sources(asset_id,object_id,retained_bytes) VALUES($1,$2,17)', [f.assetId, original]);
      await tx.query("INSERT INTO animation_assets(asset_id,storage_name,content_hash,bytes,descriptor) VALUES($1,$2,$3,12,'{}')",
        [f.assetId, gif, 'a'.repeat(64)]);
    });
    const originalTrash = await trash(sourceDelete);
    await expire(originalTrash);
    await Promise.all([sweepPhotoTrash(f.db, f.storage), sweepPhotoTrash(f.db, f.storage)]);
    for (const path of [sharedPath, gifPath, originalPath])
      await assert.rejects(access(path), { code: 'ENOENT' });
    const teamStorage = (await f.call('GET', `/v1/spaces/${f.teamId}/storage`)).json().storage;
    assert.equal(teamStorage.retainedBytes, 0);
    assert.equal(teamStorage.retainedAssets, 0);
    assert.equal((await restore(originalTrash)).statusCode, 410);
    assert.equal((await f.db.query('SELECT id FROM revisions WHERE id=$1', [f.artwork.revision.id])).rowCount, 1);
  } finally {
    await f.close();
  }
});
