import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { collaborationFixture } from './collaboration-fixture.js';

const database = process.env.TEST_DATABASE_URL;

test(
  'public catalogs and session-bound usage expose their documented HTTP responses',
  { skip: !database },
  async () => {
    const f = await collaborationFixture(database!);
    try {
      const publicConfig = await f.app.inject('/v1/public-config');
      assert.equal(publicConfig.statusCode, 200);
      assert.equal(typeof publicConfig.json().brand.name, 'string');
      assert.ok(publicConfig.json().limits.maxPixels > 0);
      const models = await f.app.inject('/v1/models');
      assert.equal(models.statusCode, 200);
      assert.ok(Array.isArray(models.json().models));
      assert.equal(models.json().executionEnabled, false);
      const capabilities = await f.app.inject('/v1/asset-processing/capabilities');
      assert.equal(capabilities.statusCode, 200);
      assert.deepEqual(capabilities.json().animation.formats, ['gif']);
      assert.ok(capabilities.json().recognition.maxPixels > 0);
      for (const route of ['/v1/assistant/models', '/v1/usage/model-prices', '/v1/me/usage'])
        assert.equal((await f.app.inject(route)).statusCode, 401);
      const assistant = (await f.call('GET', '/v1/assistant/models')).json();
      assert.equal(typeof assistant.ready, 'boolean');
      assert.ok(Array.isArray(assistant.models));
      const prices = (await f.call('GET', '/v1/usage/model-prices')).json();
      assert.equal(prices.currency, 'USD');
      assert.equal(prices.basis, 'published-estimate');
      assert.ok(prices.prices.length > 0);
      assert.equal((await f.call('GET', '/v1/me/entitlements')).statusCode, 200);
      const usage = await f.call('GET', '/v1/me/usage');
      assert.equal(usage.statusCode, 200, usage.body);
      assert.ok(usage.json().entries.some(({ kind }: { kind: string }) => kind === 'grant'));
      assert.equal(
        (await f.call('GET', `/v1/me/usage?spaceId=${f.actors.editor.spaceId}`)).statusCode,
        403,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'team and project read, edit and removal endpoints use the current scoped role',
  { skip: !database },
  async () => {
    const f = await collaborationFixture(database!);
    try {
      const team = `/v1/spaces/${f.teamId}`;
      const project = `/v1/projects/${f.projectId}`;
      assert.equal((await f.app.inject('/v1/spaces')).statusCode, 401);
      assert.ok(
        (await f.call('GET', '/v1/spaces', undefined, 'viewer'))
          .json()
          .spaces.some(({ id }: { id: string }) => id === f.teamId),
      );
      assert.ok(
        !(await f.call('GET', '/v1/spaces', undefined, 'outsider'))
          .json()
          .spaces.some(({ id }: { id: string }) => id === f.teamId),
      );
      assert.equal(
        (await f.call('GET', `/v1/projects?spaceId=${f.teamId}`, undefined, 'outsider')).statusCode,
        403,
      );
      const projects = (
        await f.call('GET', `/v1/projects?spaceId=${f.teamId}`, undefined, 'viewer')
      ).json().projects;
      assert.deepEqual(
        projects.map(({ id }: { id: string }) => id),
        [f.projectId],
      );
      const projectEdit = {
        title: 'Review the graded project',
        description: 'The source remains immutable.',
        expectedVersion: projects[0].version,
      };
      assert.equal((await f.call('PATCH', project, projectEdit, 'viewer')).statusCode, 403);
      const updated = await f.call('PATCH', project, projectEdit, 'editor');
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal(updated.json().project.version, projectEdit.expectedVersion + 1);
      assert.equal(updated.json().project.description, projectEdit.description);
      assert.equal((await f.call('PATCH', project, projectEdit, 'editor')).statusCode, 409);
      assert.equal(
        (await f.call('GET', project, undefined, 'viewer')).json().project.title,
        projectEdit.title,
      );
      const artwork = `/v1/artworks/${f.artwork.artwork.id}`;
      const before = (await f.call('GET', artwork)).json();
      const rename = { title: 'Portrait for review', expectedVersion: before.artwork.headVersion };
      assert.equal((await f.call('PATCH', artwork, rename, 'viewer')).statusCode, 403);
      const renamed = await f.call('PATCH', artwork, rename, 'editor');
      assert.equal(renamed.statusCode, 200, renamed.body);
      assert.equal(renamed.json().artwork.title, rename.title);
      assert.equal(renamed.json().artwork.headVersion, rename.expectedVersion + 1);
      assert.deepEqual(renamed.json().revision.recipe, before.revision.recipe);
      const retry = await f.call('PATCH', artwork, rename, 'editor');
      assert.equal(retry.statusCode, 200, retry.body);
      assert.equal(retry.json().replayed, true);
      assert.equal(retry.json().revision.id, renamed.json().revision.id);
      assert.equal(
        (await f.call('PATCH', artwork, { ...rename, title: 'Stale rename' }, 'editor')).statusCode,
        409,
      );
      assert.equal((await f.call('GET', `${team}/members`, undefined, 'outsider')).statusCode, 403);
      const members = (await f.call('GET', `${team}/members`, undefined, 'viewer')).json().members;
      assert.equal(members.length, 3);
      assert.ok(members.every((member: object) => 'phoneMasked' in member && !('phone' in member)));
      assert.equal(
        (await f.call('GET', `${team}/sharing-policy`, undefined, 'outsider')).statusCode,
        403,
      );
      const policy = (await f.call('GET', `${team}/sharing-policy`, undefined, 'viewer')).json()
        .policy;
      assert.equal(typeof policy.allowReference, 'boolean');
      assert.equal((await f.call('GET', `${project}/grants`, undefined, 'viewer')).statusCode, 403);
      assert.deepEqual((await f.call('GET', `${project}/grants`)).json().grants, []);

      const comments = `${project}/comments`;
      const note = await f.call('POST', comments, { body: 'Check the crop' });
      assert.equal(note.statusCode, 201);
      const comment = `/v1/comments/${note.json().comment.id}`;
      assert.equal((await f.call('PATCH', comment, { resolved: true }, 'viewer')).statusCode, 403);
      assert.equal((await f.call('PATCH', comment, { resolved: true }, 'editor')).statusCode, 200);
      const task = await f.call('POST', `${project}/tasks`, { title: 'Compare the exports' });
      const doc = await f.call('POST', `${project}/documents`, {
        title: 'Editing notes',
        body: 'Retain the original',
      });
      assert.equal(task.statusCode, 201, task.body);
      assert.equal(doc.statusCode, 201, doc.body);
      for (const kind of ['comments', 'tasks', 'documents'])
        assert.equal(
          (await f.call('GET', `${project}/${kind}`, undefined, 'outsider')).statusCode,
          404,
        );
      assert.equal(
        (await f.call('GET', comments, undefined, 'viewer')).json().comments[0].resolved,
        true,
      );
      assert.equal(
        (await f.call('GET', `${project}/tasks`, undefined, 'viewer')).json().tasks[0].id,
        task.json().task.id,
      );
      assert.equal(
        (await f.call('GET', `${project}/documents`, undefined, 'viewer')).json().documents[0].id,
        doc.json().document.id,
      );

      const invited = await f.call('POST', `${team}/invitations`, { role: 'viewer' });
      assert.equal(invited.statusCode, 201);
      const invitation = invited.json().invitation;
      const revoke = `${team}/invitations/${invitation.id}`;
      assert.equal((await f.call('DELETE', revoke, undefined, 'editor')).statusCode, 403);
      assert.equal((await f.call('DELETE', revoke)).statusCode, 200);
      const denied = await f.call(
        'POST',
        '/v1/invitations/accept',
        { code: invitation.code },
        'outsider',
      );
      assert.equal(denied.statusCode, 400);
      assert.equal(denied.json().error.code, 'INVITE_INVALID');
      const role = `${team}/members/${f.actors.editor.id}`;
      assert.equal((await f.call('PATCH', role, { role: 'viewer' }, 'editor')).statusCode, 403);
      assert.equal((await f.call('PATCH', role, { role: 'viewer' })).statusCode, 200);
      assert.equal(
        (await f.call('POST', `${project}/documents`, { title: 'Unauthorized edit' }, 'editor'))
          .statusCode,
        403,
      );
      assert.equal((await f.call('DELETE', project, undefined, 'editor')).statusCode, 403);
      assert.equal((await f.call('DELETE', project)).statusCode, 200);
      assert.equal((await f.call('GET', project)).statusCode, 404);
      assert.deepEqual(
        (await f.call('GET', `/v1/projects?spaceId=${f.teamId}`)).json().projects,
        [],
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'operations HTTP authorizes configuration, publishes only an approved logo and audits mutations',
  { skip: !database },
  async () => {
    const f = await collaborationFixture(database!);
    const modelId = `fixture-${randomUUID()}`;
    const originalBrand = (await f.db.query('SELECT brand FROM app_config WHERE id=true')).rows[0]!
      .brand;
    let inviteId: string | undefined;
    try {
      for (const route of ['config', 'models', 'plans', 'audit']) {
        assert.equal((await f.call('GET', `/v1/ops/${route}`, undefined, 'owner')).statusCode, 403);
        assert.equal(
          (await f.call('GET', `/v1/ops/${route}`, undefined, 'operator')).statusCode,
          200,
        );
      }
      const absentLogo = await f.app.inject('/v1/public-logo');
      if (!originalBrand.logoAssetId) assert.equal(absentLogo.statusCode, 404);
      const brand = (logoAssetId: string) => ({ ...originalBrand, logoAssetId });
      const reason = 'Scoped contract fixture';
      const forbiddenLogo = await f.call(
        'PATCH',
        '/v1/ops/config',
        { brand: brand(f.assetId), reason },
        'operator',
      );
      assert.equal(forbiddenLogo.statusCode, 404);
      const created = await f.call(
        'POST',
        '/v1/projects',
        { spaceId: f.actors.operator.spaceId, title: 'Brand source' },
        'operator',
      );
      assert.equal(created.statusCode, 201);
      const projectId = created.json().project.id;
      const logo = randomUUID();
      await f.db.query(
        `INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by)
       SELECT $1,$2,'fixture logo.png',storage_key,mime,width,height,bytes,content_hash,$3 FROM assets WHERE id=$4`,
        [logo, projectId, f.actors.operator.id, f.assetId],
      );
      assert.equal(
        (await f.call('PATCH', '/v1/ops/config', { brand: brand(logo), reason }, 'owner'))
          .statusCode,
        403,
      );
      const saved = await f.call(
        'PATCH',
        '/v1/ops/config',
        { brand: brand(logo), reason },
        'operator',
      );
      assert.equal(saved.statusCode, 200, saved.body);
      assert.equal(saved.json().brand.logoUrl, '/v1/public-logo');
      const published = await f.app.inject('/v1/public-logo');
      assert.equal(published.statusCode, 200);
      assert.equal(published.headers['content-type'], 'image/png');
      assert.deepEqual(
        published.rawPayload,
        (await f.call('GET', `/v1/assets/${logo}/file`, undefined, 'operator')).rawPayload,
      );

      const payload = {
        label: 'Disabled fixture model',
        provider: 'qwen',
        operations: ['edit-plan'],
        enabled: false,
        minWidth: 64,
        maxWidth: 1024,
        minHeight: 64,
        maxHeight: 1024,
        maxOutputs: 1,
        unitCost: 1,
        allowedQualities: ['auto'],
        reason,
      };
      const endpoint = `/v1/ops/models/${modelId}`;
      assert.equal((await f.call('PUT', endpoint, payload, 'owner')).statusCode, 403);
      const invalid = await f.call(
        'PUT',
        endpoint,
        { ...payload, operations: ['generate-image'] },
        'operator',
      );
      assert.equal(invalid.statusCode, 400);
      const model = await f.call('PUT', endpoint, payload, 'operator');
      assert.equal(model.statusCode, 200, model.body);
      assert.equal(model.json().model.version, 1);
      const changed = await f.call('PUT', endpoint, { ...payload, unitCost: 2 }, 'operator');
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(changed.json().model.version, 2);
      const publicModels = (await f.app.inject('/v1/models')).json().models;
      assert.ok(!publicModels.some(({ id }: { id: string }) => id === modelId));
      assert.equal(
        (await f.call('POST', '/v1/ops/registration-invites', { reason }, 'owner')).statusCode,
        403,
      );
      const invited = await f.call('POST', '/v1/ops/registration-invites', { reason }, 'operator');
      assert.equal(invited.statusCode, 201, invited.body);
      inviteId = invited.json().invitation.id;
      const log = (await f.call('GET', '/v1/ops/audit', undefined, 'operator')).json().entries;
      assert.ok(
        log.some(
          ({ action, targetId }: { action: string; targetId: string }) =>
            action === 'operator.model_config' && targetId === modelId,
        ),
      );
      const resolve = `/v1/ops/ai-jobs/${randomUUID()}/resolve`;
      assert.equal((await f.call('POST', resolve, {}, 'owner')).statusCode, 403);
      const disabled = await f.call('POST', resolve, {}, 'operator');
      assert.equal(disabled.statusCode, 503);
      assert.equal(disabled.json().error.code, 'AI_EXECUTION_DISABLED');
    } finally {
      await f.db.query('UPDATE app_config SET brand=$1 WHERE id=true', [
        JSON.stringify(originalBrand),
      ]);
      await f.db.query('DELETE FROM model_configs WHERE id=$1', [modelId]);
      if (inviteId) await f.db.query('DELETE FROM invitations WHERE id=$1', [inviteId]);
      await f.close();
    }
  },
);
