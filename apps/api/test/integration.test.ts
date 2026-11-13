import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createRecipe } from '@ai-xiutu/editor';
import {
  createDatabase,
  transaction,
  ensureMonthlyGrant,
  getEntitlements,
  reserveUnits,
  releaseHold,
  settleHold,
  markUnknownHold,
} from '@ai-xiutu/db';
import { type SmsAdapter } from '@ai-xiutu/providers';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hash, secretHash } from '../src/core.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'persistent API security, collaboration, quota and private media integration',
  { skip: !databaseUrl },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'xiutu-api-'));
    const db = createDatabase(databaseUrl!);
    const codes = new Map<string, string>();
    const sms: SmsAdapter = {
      configured: true,
      async send(p) {
        codes.set(`${p.phone}:${p.purpose}`, p.code);
        return { requestId: randomUUID() };
      },
    };
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: databaseUrl!,
      SESSION_SECRET: 'test-only-random-purpose-secret-2026-11-api',
      APP_ORIGIN: 'http://localhost:5173',
      STORAGE_DIR: directory,
      TRUST_PROXY_HOPS: '0',
    });
    const app = await buildApp({ db, config, sms });
    await app.ready();
    const origin = 'http://localhost:5173';
    // Rate buckets are durable by design. Each independent run owns an address,
    // while recreated apps in this run keep that address to exercise persistence.
    const peerAddress = `fd00:${randomUUID().replaceAll('-', '').match(/.{4}/g)!.slice(0, 7).join(':')}`;
    const call = (
      method: any,
      url: string,
      body?: unknown,
      cookie?: string,
      headers: Record<string, string> = {},
    ) =>
      app.inject({
        method,
        url,
        remoteAddress: peerAddress,
        headers: { origin, ...(cookie ? { cookie } : {}), ...headers },
        ...(body === undefined ? {} : { payload: body as any }),
      });
    const makePhone = () => `+86139${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    const register = async (name: string) => {
      const phone = makePhone();
      const otp = await call('POST', '/v1/auth/otp', { phone, purpose: 'register' });
      assert.equal(otp.statusCode, 202, otp.body);
      assert.equal('code' in otp.json(), false);
      const response = await call('POST', '/v1/auth/register', {
        phone,
        code: codes.get(`${phone}:register`),
        password: 'A-secure-test-passphrase-2026',
        displayName: name,
      });
      assert.equal(response.statusCode, 201, response.body);
      const raw = String(response.headers['set-cookie']);
      assert.match(raw, /HttpOnly/i);
      assert.match(raw, /SameSite=Strict/i);
      const cookie = raw.split(';')[0]!;
      const result = response.json();
      return {
        phone,
        cookie,
        userId: result.user.id as string,
        spaceId: result.spaces.find((s: any) => s.kind === 'personal').id as string,
      };
    };
    let owner: Awaited<ReturnType<typeof register>>,
      viewer: Awaited<ReturnType<typeof register>>,
      operator: Awaited<ReturnType<typeof register>>;
    let projectId = '',
      artworkId = '',
      assetId = '',
      teamId = '',
      teamProjectId = '';
    try {
      await t.test('strict Origin and real unavailable SMS gate', async () => {
        const r = await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { phone: '+8613800000000', password: 'x' },
        });
        assert.equal(r.statusCode, 403);
        assert.equal(r.json().error.code, 'ORIGIN_FORBIDDEN');
        const other = await buildApp({
          db,
          config,
          sms: {
            configured: false,
            async send() {
              throw new Error('must never send');
            },
          },
        });
        const unavailable = await other.inject({
          method: 'POST',
          url: '/v1/auth/otp',
          headers: { origin },
          payload: { phone: makePhone(), purpose: 'register' },
        });
        assert.equal(unavailable.statusCode, 503);
        assert.equal(unavailable.json().error.code, 'SMS_NOT_CONFIGURED');
        await other.close();
      });
      await t.test(
        'SMS registration, hashed sessions and invalid OTP attempt persistence',
        async () => {
          const phone = makePhone();
          await call('POST', '/v1/auth/otp', { phone, purpose: 'register' });
          const actual = codes.get(`${phone}:register`)!;
          const wrong = String((Number(actual) + 1) % 1_000_000).padStart(6, '0');
          const failed = await call('POST', '/v1/auth/register', {
            phone,
            code: wrong,
            password: 'A-secure-test-passphrase-2026',
            displayName: 'OTP fixture',
          });
          assert.equal(failed.statusCode, 400);
          const key = secretHash(config.sessionSecret, `otp-phone:${phone}`);
          assert.equal(
            (await db.query('SELECT attempts FROM otp_challenges WHERE phone_key=$1', [key]))
              .rows[0]!.attempts,
            1,
          );
          owner = await register('Owner fixture');
          viewer = await register('Viewer fixture');
          operator = await register('Operator fixture');
          await db.query('INSERT INTO operator_users(user_id) VALUES($1)', [operator.userId]);
          const token = owner.cookie.split('=')[1]!;
          const row = (
            await db.query('SELECT token_hash FROM sessions WHERE user_id=$1', [owner.userId])
          ).rows[0]!;
          assert.equal(row.token_hash, hash(token));
          assert.notEqual(row.token_hash, token);
          const session = await call('GET', '/v1/session', undefined, owner.cookie);
          assert.equal(session.json().user.id, owner.userId);
          assert.equal('phone' in session.json().user, false);
          const password = (
            await db.query('SELECT password_hash FROM users WHERE id=$1', [owner.userId])
          ).rows[0]!.password_hash;
          assert.match(password, /^scrypt-v1\$/);
          assert.equal(password.includes('passphrase'), false);
        },
      );
      await t.test(
        'private project ACL excludes platform operator; team roles are real',
        async () => {
          const created = await call(
            'POST',
            '/v1/projects',
            { spaceId: owner.spaceId, title: 'Private test' },
            owner.cookie,
          );
          assert.equal(created.statusCode, 201, created.body);
          projectId = created.json().project.id;
          assert.equal(
            (await call('GET', `/v1/projects/${projectId}`, undefined, operator.cookie)).statusCode,
            404,
          );
          assert.equal(
            (await call('GET', `/v1/projects/${projectId}`, undefined, viewer.cookie)).statusCode,
            404,
          );
          const team = await call('POST', '/v1/spaces', { name: 'Team fixture' }, owner.cookie);
          assert.equal(team.statusCode, 201, team.body);
          teamId = team.json().space.id;
          const inv = await call(
            'POST',
            `/v1/spaces/${teamId}/invitations`,
            { role: 'viewer' },
            owner.cookie,
          );
          assert.equal(inv.statusCode, 201, inv.body);
          const accept = await call(
            'POST',
            '/v1/invitations/accept',
            { code: inv.json().invitation.code },
            viewer.cookie,
          );
          assert.equal(accept.statusCode, 200, accept.body);
          const again = await call(
            'POST',
            '/v1/invitations/accept',
            { code: inv.json().invitation.code },
            viewer.cookie,
          );
          assert.equal(again.statusCode, 200);
          const tp = await call(
            'POST',
            '/v1/projects',
            { spaceId: teamId, title: 'Team project' },
            owner.cookie,
          );
          teamProjectId = tp.json().project.id;
          assert.equal(
            (await call('GET', `/v1/projects/${teamProjectId}`, undefined, viewer.cookie))
              .statusCode,
            200,
          );
          assert.equal(
            (
              await call(
                'POST',
                `/v1/projects/${teamProjectId}/comments`,
                { body: 'viewer may not write' },
                viewer.cookie,
              )
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await call(
                'PATCH',
                `/v1/projects/${teamProjectId}`,
                { expectedVersion: 1, title: 'overwrite' },
                viewer.cookie,
              )
            ).statusCode,
            403,
          );
          const eq = await call(
            'GET',
            `/v1/me/entitlements?spaceId=${teamId}`,
            undefined,
            owner.cookie,
          );
          assert.equal(eq.json().available, 0);
        },
      );
      await t.test(
        'bounded image decoding, EXIF removal and authenticated file access',
        async () => {
          const png = await sharp({
            create: { width: 64, height: 80, channels: 3, background: '#abc' },
          })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toBuffer();
          const boundary = 'xiutu' + randomUUID();
          const payload = Buffer.concat([
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
            ),
            png,
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ]);
          const response = await call(
            'POST',
            `/v1/projects/${projectId}/assets`,
            payload,
            owner.cookie,
            { 'content-type': `multipart/form-data; boundary=${boundary}` },
          );
          assert.equal(response.statusCode, 201, response.body);
          assetId = response.json().asset.id;
          assert.equal(response.json().asset.width, 80);
          assert.equal(response.json().asset.height, 64);
          assert.equal(response.json().asset.thumbnailUrl, `/v1/assets/${assetId}/thumbnail`);
          assert.equal((await call('GET', `/v1/assets/${assetId}/file`)).statusCode, 401);
          assert.equal(
            (await call('GET', `/v1/assets/${assetId}/file`, undefined, operator.cookie))
              .statusCode,
            404,
          );
          const image = await call('GET', `/v1/assets/${assetId}/file`, undefined, owner.cookie);
          assert.equal(image.statusCode, 200);
          const meta = await sharp(image.rawPayload).metadata();
          assert.equal(meta.format, 'png');
          assert.equal(meta.exif, undefined);
          assert.equal(meta.orientation, undefined);
          assert.equal((await call('GET', `/v1/assets/${assetId}/thumbnail`)).statusCode, 401);
          assert.equal(
            (await call('GET', `/v1/assets/${assetId}/thumbnail`, undefined, operator.cookie))
              .statusCode,
            404,
          );
          const thumb = await call(
            'GET',
            `/v1/assets/${assetId}/thumbnail`,
            undefined,
            owner.cookie,
          );
          assert.equal(thumb.statusCode, 200, thumb.body);
          const thumbMeta = await sharp(thumb.rawPayload).metadata();
          assert.equal(thumbMeta.format, 'webp');
          assert.equal(thumbMeta.width, 80);
          assert.equal(thumbMeta.height, 64);
          assert.match(String(thumb.headers['cache-control']), /no-store/);
          const bad = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.png"\r\nContent-Type: image/png\r\n\r\n<svg><script>alert(1)</script></svg>\r\n--${boundary}--\r\n`,
          );
          const rejected = await call(
            'POST',
            `/v1/projects/${projectId}/assets`,
            bad,
            owner.cookie,
            { 'content-type': `multipart/form-data; boundary=${boundary}` },
          );
          assert.ok([400, 415].includes(rejected.statusCode), rejected.body);
        },
      );
      await t.test('complete recipe validation, immutable revisions and CAS conflict', async () => {
        const created = await call(
          'POST',
          `/v1/projects/${projectId}/artworks`,
          { assetId, title: 'Artwork', recipe: createRecipe() },
          owner.cookie,
        );
        assert.equal(created.statusCode, 201, created.body);
        artworkId = created.json().artwork.id;
        const recipe = createRecipe();
        recipe.adjustments.exposure = 1;
        const first = await call(
          'POST',
          `/v1/artworks/${artworkId}/revisions`,
          { expectedVersion: 1, recipe, label: 'Exposure' },
          owner.cookie,
        );
        assert.equal(first.statusCode, 201, first.body);
        assert.equal(first.json().artwork.headVersion, 2);
        const stale = await call(
          'POST',
          `/v1/artworks/${artworkId}/revisions`,
          { expectedVersion: 1, recipe },
          owner.cookie,
        );
        assert.equal(stale.statusCode, 409);
        assert.equal(stale.json().error.code, 'VERSION_CONFLICT');
        const invalid = await call(
          'POST',
          `/v1/artworks/${artworkId}/revisions`,
          { expectedVersion: 2, recipe: { ...recipe, malicious: 'unknown' } },
          owner.cookie,
        );
        assert.equal(invalid.statusCode, 400);
        const revisions = await call(
          'GET',
          `/v1/artworks/${artworkId}/revisions`,
          undefined,
          owner.cookie,
        );
        assert.equal(revisions.json().revisions.length, 2);
        await assert.rejects(
          db.query("UPDATE revisions SET label='tampered' WHERE artwork_id=$1", [artworkId]),
          /immutable/,
        );
        assert.equal(
          (await call('DELETE', `/v1/assets/${assetId}`, undefined, owner.cookie)).statusCode,
          409,
        );
      });
      await t.test(
        'comments anchor to exact revision; tasks/documents use durable CAS',
        async () => {
          const revisions = (
            await call('GET', `/v1/artworks/${artworkId}/revisions`, undefined, owner.cookie)
          ).json().revisions;
          const c = await call(
            'POST',
            `/v1/projects/${projectId}/comments`,
            {
              body: 'Check this area',
              artworkId,
              revisionId: revisions[0].id,
              anchor: { x: 0.3, y: 0.4 },
            },
            owner.cookie,
          );
          assert.equal(c.statusCode, 201, c.body);
          const task = await call(
            'POST',
            `/v1/projects/${projectId}/tasks`,
            { title: 'Inspect exposure', assigneeId: owner.userId },
            owner.cookie,
          );
          assert.equal(task.statusCode, 201, task.body);
          const taskId = task.json().task.id;
          assert.equal(
            (
              await call(
                'PATCH',
                `/v1/tasks/${taskId}`,
                { expectedVersion: 1, status: 'doing' },
                owner.cookie,
              )
            ).statusCode,
            200,
          );
          assert.equal(
            (
              await call(
                'PATCH',
                `/v1/tasks/${taskId}`,
                { expectedVersion: 1, status: 'done' },
                owner.cookie,
              )
            ).statusCode,
            409,
          );
          const doc = await call(
            'POST',
            `/v1/projects/${projectId}/documents`,
            { title: 'Requirements', body: 'Original note' },
            owner.cookie,
          );
          assert.equal(doc.statusCode, 201, doc.body);
          const docId = doc.json().document.id;
          assert.equal(
            (
              await call(
                'PATCH',
                `/v1/documents/${docId}`,
                { expectedVersion: 1, body: 'Confirmed note' },
                owner.cookie,
              )
            ).statusCode,
            200,
          );
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM document_versions WHERE document_id=$1',
                [docId],
              )
            ).rows[0]!.n,
            2,
          );
          const events = await call(
            'GET',
            `/v1/events?spaceId=${owner.spaceId}&after=0`,
            undefined,
            owner.cookie,
          );
          assert.equal(events.statusCode, 200);
          assert.ok(events.json().events.length > 0);
          assert.equal(
            (
              await call(
                'GET',
                `/v1/events?spaceId=${owner.spaceId}&after=0`,
                undefined,
                operator.cookie,
              )
            ).statusCode,
            403,
          );
        },
      );
      await t.test(
        'independent reference/copy policies, revocation and personal-team copy idempotency',
        async () => {
          const policy = {
            allowReference: false,
            allowCopy: true,
            maxActiveGrants: 2,
            maxCopyAssets: 10,
          };
          assert.equal(
            (await call('PUT', `/v1/spaces/${owner.spaceId}/sharing-policy`, policy, owner.cookie))
              .statusCode,
            200,
          );
          assert.equal(
            (
              await call(
                'POST',
                `/v1/projects/${projectId}/grants`,
                { targetPhone: viewer.phone, mode: 'reference' },
                owner.cookie,
              )
            ).statusCode,
            403,
          );
          const grant = await call(
            'POST',
            `/v1/projects/${projectId}/grants`,
            { targetPhone: viewer.phone, mode: 'copy' },
            owner.cookie,
          );
          assert.equal(grant.statusCode, 201, grant.body);
          assert.equal(
            (await call('GET', `/v1/projects/${projectId}`, undefined, viewer.cookie)).statusCode,
            200,
          );
          const copied = await call('POST', `/v1/projects/${projectId}/copy`, {}, viewer.cookie);
          assert.equal(copied.statusCode, 201, copied.body);
          const copyId = copied.json().project.id;
          await call(
            'DELETE',
            `/v1/projects/${projectId}/grants/${grant.json().grant.id}`,
            undefined,
            owner.cookie,
          );
          assert.equal(
            (await call('GET', `/v1/projects/${projectId}`, undefined, viewer.cookie)).statusCode,
            404,
          );
          assert.equal(
            (await call('GET', `/v1/projects/${copyId}`, undefined, viewer.cookie)).statusCode,
            200,
          );
          const payload = { targetSpaceId: teamId, idempotencyKey: randomUUID() };
          const ownCopy = await call(
            'POST',
            `/v1/projects/${projectId}/copy`,
            payload,
            owner.cookie,
          );
          assert.equal(ownCopy.statusCode, 201, ownCopy.body);
          assert.equal(ownCopy.json().project.spaceId, teamId);
          const replay = await call(
            'POST',
            `/v1/projects/${projectId}/copy`,
            payload,
            owner.cookie,
          );
          assert.equal(replay.json().project.id, ownCopy.json().project.id);
        },
      );
      await t.test(
        'admin records and audited quota adjustment never grant private project access',
        async () => {
          assert.equal(
            (await call('GET', '/v1/ops/users', undefined, owner.cookie)).statusCode,
            403,
          );
          const users = await call(
            'GET',
            `/v1/ops/users?query=${encodeURIComponent(owner.phone)}`,
            undefined,
            operator.cookie,
          );
          assert.equal(users.statusCode, 200, users.body);
          const [listed] = users.json().users;
          assert.equal(users.json().users.length, 1);
          assert.equal(listed.id, owner.userId);
          assert.match(listed.phoneMasked, /••••/);
          assert.equal('phone' in listed, false);
          assert.equal(
            (await call('GET', '/v1/ops/overview', undefined, operator.cookie)).statusCode,
            200,
          );
          assert.equal(
            (
              await call(
                'GET',
                `/v1/ops/users/${owner.userId}/entitlements`,
                undefined,
                owner.cookie,
              )
            ).statusCode,
            403,
          );
          const accountQuota = await call(
            'GET',
            `/v1/ops/users/${owner.userId}/entitlements`,
            undefined,
            operator.cookie,
          );
          assert.equal(accountQuota.statusCode, 200, accountQuota.body);
          assert.ok(accountQuota.json().spaces.some((s: any) => s.id === owner.spaceId));
          assert.ok(accountQuota.json().spaces.some((s: any) => s.id === teamId));
          assert.equal(accountQuota.json().user.phone, undefined);
          assert.equal(accountQuota.body.includes(projectId), false);
          const receiptId = `fixture-receipt-${randomUUID()}`;
          const jobId = await transaction(db, async (tx) => {
            const hold = await reserveUnits(tx, {
              spaceId: owner.spaceId,
              userId: owner.userId,
              idempotencyKey: `receipt-${randomUUID()}`,
              requestHash: hash('receipt fixture'),
              units: 5,
            });
            await markUnknownHold(tx, hold.id);
            return (
              await tx.query(
                "INSERT INTO ai_jobs(project_id,actor_id,model_id,input_hash,state,hold_id,operation,provider_request_id,input) VALUES($1,$2,'fixture-image-model',$3,'unknown',$4,'generate-image',$5,$6) RETURNING id",
                [
                  projectId,
                  owner.userId,
                  hash('receipt fixture'),
                  hold.id,
                  receiptId,
                  JSON.stringify({ prompt: 'private fixture text must stay private' }),
                ],
              )
            ).rows[0]!.id;
          });
          assert.equal(
            (await call('GET', '/v1/ops/ai-jobs/unknown', undefined, owner.cookie)).statusCode,
            403,
          );
          const unknownJobs = await call(
            'GET',
            `/v1/ops/ai-jobs/unknown?jobId=${jobId}`,
            undefined,
            operator.cookie,
          );
          assert.equal(unknownJobs.statusCode, 200);
          const receipt = unknownJobs.json().jobs.find((j: any) => j.id === jobId);
          assert.equal(receipt.providerRequestId, receiptId);
          assert.equal(receipt.operation, 'generate-image');
          assert.equal(receipt.heldUnits, 5);
          assert.equal(unknownJobs.body.includes('private fixture text'), false);
          assert.equal(receipt.input, undefined);
          const page = await call(
            'GET',
            '/v1/ops/ai-jobs/unknown?limit=1',
            undefined,
            operator.cookie,
          );
          assert.equal(page.json().jobs.length, 1);
          if (page.json().nextCursor) {
            const second = await call(
              'GET',
              `/v1/ops/ai-jobs/unknown?limit=1&cursor=${page.json().nextCursor}`,
              undefined,
              operator.cookie,
            );
            assert.equal(second.statusCode, 200, second.body);
            assert.notEqual(second.json().jobs[0].id, page.json().jobs[0].id);
            const changedScope = await call(
              'GET',
              `/v1/ops/ai-jobs/unknown?jobId=${jobId}&cursor=${page.json().nextCursor}`,
              undefined,
              operator.cookie,
            );
            assert.equal(changedScope.statusCode, 400);
          }
          const body = {
            spaceId: viewer.spaceId,
            units: 50,
            reason: 'Integration corrective gift',
            idempotencyKey: randomUUID(),
          };
          const first = await call('POST', '/v1/ops/adjustments', body, operator.cookie);
          assert.equal(first.statusCode, 200, first.body);
          const again = await call('POST', '/v1/ops/adjustments', body, operator.cookie);
          assert.equal(again.json().entitlements.available, first.json().entitlements.available);
          const conflict = await call(
            'POST',
            '/v1/ops/adjustments',
            { ...body, units: 100 },
            operator.cookie,
          );
          assert.equal(conflict.statusCode, 409);
          const plan = await call(
            'POST',
            '/v1/ops/plans',
            {
              name: 'Test catalog',
              units: 1000,
              priceCents: 990,
              active: false,
              reason: 'Catalog test',
            },
            operator.cookie,
          );
          assert.equal(plan.statusCode, 201, plan.body);
          const version = await call(
            'PATCH',
            `/v1/ops/plans/${plan.json().plan.id}`,
            {
              name: 'Next catalog',
              units: 2000,
              priceCents: 1990,
              active: false,
              expectedVersion: plan.json().plan.version,
              reason: 'New version test',
            },
            operator.cookie,
          );
          assert.equal(version.statusCode, 200, version.body);
          assert.equal(version.json().plan.version, 2);
          const stale = await call(
            'PATCH',
            `/v1/ops/plans/${plan.json().plan.id}`,
            {
              name: 'Stale catalog',
              units: 1,
              priceCents: 100,
              active: true,
              expectedVersion: 1,
              reason: 'Stale version test',
            },
            operator.cookie,
          );
          assert.equal(stale.statusCode, 409);
          assert.equal(stale.json().error.code, 'PLAN_VERSION_CHANGED');
          const pendingPhone = makePhone();
          const pending = await call(
            'POST',
            '/v1/ops/users',
            { phone: pendingPhone, displayName: 'Pending fixture', reason: 'Explicit invitation' },
            operator.cookie,
          );
          assert.equal(pending.statusCode, 201);
          assert.equal(pending.json().user.status, 'pending');
          const noSpace = await call(
            'GET',
            `/v1/ops/users/${pending.json().user.id}/entitlements`,
            undefined,
            operator.cookie,
          );
          assert.equal(noSpace.statusCode, 200);
          assert.deepEqual(noSpace.json().spaces, []);
          assert.equal(
            (
              await call(
                'PATCH',
                `/v1/ops/users/${pending.json().user.id}`,
                { status: 'active', reason: 'Attempted bypass' },
                operator.cookie,
              )
            ).statusCode,
            409,
          );
          assert.equal(
            (
              await call(
                'PATCH',
                `/v1/ops/users/${pending.json().user.id}`,
                { status: 'banned', reason: 'Pause invitation' },
                operator.cookie,
              )
            ).statusCode,
            200,
          );
          const restored = await call(
            'PATCH',
            `/v1/ops/users/${pending.json().user.id}`,
            { status: 'active', reason: 'Restore invitation' },
            operator.cookie,
          );
          assert.equal(restored.statusCode, 200);
          assert.equal(restored.json().user.status, 'pending');
          assert.equal(
            (
              await db.query('SELECT phone_verified_at FROM users WHERE id=$1', [
                pending.json().user.id,
              ])
            ).rows[0]!.phone_verified_at,
            null,
          );
          await call('POST', '/v1/auth/otp', { phone: pendingPhone, purpose: 'register' });
          const activated = await call('POST', '/v1/auth/register', {
            phone: pendingPhone,
            code: codes.get(`${pendingPhone}:register`),
            password: 'New-verified-passphrase-2026',
            displayName: 'Verified invitation',
          });
          assert.equal(activated.statusCode, 201, activated.body);
          assert.equal(activated.json().user.id, pending.json().user.id);
          assert.equal(activated.json().spaces.filter((s: any) => s.kind === 'personal').length, 1);
          await assert.rejects(
            db.query('UPDATE ledger_entries SET units=999 WHERE space_id=$1', [viewer.spaceId]),
            /immutable/,
          );
          await assert.rejects(
            db.query("UPDATE plan_versions SET name='tampered' WHERE plan_id=$1", [
              plan.json().plan.id,
            ]),
            /immutable/,
          );
        },
      );
      await t.test(
        'period uniqueness, concurrent reservations and expired unknown release conserve lots',
        async () => {
          const account = await register('Wallet fixture');
          await Promise.all(
            Array.from({ length: 4 }, () =>
              transaction(db, (tx) => ensureMonthlyGrant(tx, account.userId)),
            ),
          );
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM quota_grants WHERE subject_id=$1', [
                account.userId,
              ])
            ).rows[0]!.n,
            1,
          );
          const reservations = await Promise.allSettled(
            [1, 2].map((n) =>
              transaction(db, (tx) =>
                reserveUnits(tx, {
                  spaceId: account.spaceId,
                  userId: account.userId,
                  idempotencyKey: `fixture-${n}-${randomUUID()}`,
                  requestHash: hash(`hold-${n}`),
                  units: 150,
                }),
              ),
            ),
          );
          assert.equal(reservations.filter((r) => r.status === 'fulfilled').length, 1);
          const success = reservations.find((r) => r.status === 'fulfilled')!;
          assert.equal(success.status, 'fulfilled');
          if (success.status !== 'fulfilled') return;
          const hold = success.value;
          await transaction(db, (tx) => markUnknownHold(tx, hold.id));
          await db.query(
            "UPDATE quota_lots SET expires_at=clock_timestamp()-interval '1 second' WHERE space_id=$1 AND kind='free'",
            [account.spaceId],
          );
          const before = await transaction(db, (tx) => getEntitlements(tx, account.spaceId));
          assert.equal(before.held, 150);
          assert.equal(before.available, 0);
          await transaction(db, (tx) => releaseHold(tx, hold.id));
          await transaction(db, (tx) => releaseHold(tx, hold.id));
          const after = await transaction(db, (tx) => getEntitlements(tx, account.spaceId));
          assert.equal(after.available, 0);
          assert.equal(after.held, 0);
          assert.equal(after.usage.expired, 200);
          await assert.rejects(
            transaction(db, (tx) => settleHold(tx, hold.id)),
            /另一结果/,
          );
          const gifts = (
            await db.query(
              "INSERT INTO quota_lots(space_id,kind,source_key,total_units,available,expires_at) VALUES($1,'gift',$2,20,20,clock_timestamp()+interval '1 day'),($1,'gift',$3,20,20,clock_timestamp()+interval '2 days') RETURNING id",
              [account.spaceId, `gift-a:${randomUUID()}`, `gift-b:${randomUUID()}`],
            )
          ).rows;
          const mixed = await transaction(db, (tx) =>
            reserveUnits(tx, {
              spaceId: account.spaceId,
              userId: account.userId,
              idempotencyKey: `mixed-${randomUUID()}`,
              requestHash: hash('mixed-lot-release'),
              units: 40,
            }),
          );
          await transaction(db, (tx) => markUnknownHold(tx, mixed.id));
          await db.query(
            "UPDATE quota_lots SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [gifts[0]!.id],
          );
          await transaction(db, (tx) => releaseHold(tx, mixed.id));
          await transaction(db, (tx) => releaseHold(tx, mixed.id));
          const returned = await transaction(db, (tx) => getEntitlements(tx, account.spaceId));
          assert.equal(returned.available, 20);
          assert.equal(returned.held, 0);
          assert.equal(returned.usage.expired, 220);
          for (const lot of returned.lots)
            assert.equal(
              lot.totalUnits,
              lot.available + lot.held + lot.spent + lot.expired + lot.revoked,
            );
        },
      );
      await t.test(
        'unconfigured AI cannot fabricate a job and revoked team members lose read access',
        async () => {
          const denied = await call(
            'POST',
            `/v1/projects/${projectId}/ai-jobs`,
            { prompt: 'test', modelId: 'none', idempotencyKey: randomUUID() },
            owner.cookie,
          );
          assert.equal(denied.statusCode, 503);
          const removal = await call(
            'DELETE',
            `/v1/spaces/${teamId}/members/${viewer.userId}`,
            undefined,
            owner.cookie,
          );
          assert.equal(removal.statusCode, 200, removal.body);
          assert.equal(
            (await call('GET', `/v1/projects/${teamProjectId}`, undefined, viewer.cookie))
              .statusCode,
            404,
          );
        },
      );
      await t.test('login OTP creates one session and password reset revokes it', async () => {
        const key = secretHash(config.sessionSecret, `otp-phone:${owner.phone}`);
        const ageChallenges = () =>
          db.query(
            "UPDATE otp_challenges SET created_at=clock_timestamp()-interval '2 minutes' WHERE phone_key=$1",
            [key],
          );
        await ageChallenges();
        const login = await call('POST', '/v1/auth/otp', { phone: owner.phone, purpose: 'login' });
        assert.equal(login.statusCode, 202, login.body);
        assert.equal('code' in login.json(), false);
        const credentials = { phone: owner.phone, code: codes.get(`${owner.phone}:login`)! };
        const loggedIn = await call('POST', '/v1/auth/login-otp', credentials);
        assert.equal(loggedIn.statusCode, 200, loggedIn.body);
        const cookie = String(loggedIn.headers['set-cookie']).split(';')[0]!;
        assert.equal(
          (await call('GET', '/v1/session', undefined, cookie)).json().user.id,
          owner.userId,
        );
        assert.equal((await call('POST', '/v1/auth/login-otp', credentials)).statusCode, 400);
        await ageChallenges();
        const otp = await call('POST', '/v1/auth/otp', { phone: owner.phone, purpose: 'reset' });
        assert.equal(otp.statusCode, 202, otp.body);
        const code = codes.get(`${owner.phone}:reset`)!;
        assert.equal(
          (await call('POST', '/v1/auth/login-otp', { phone: owner.phone, code })).statusCode,
          400,
        );
        assert.equal(
          (
            await call('POST', '/v1/auth/reset', {
              phone: owner.phone,
              code,
              newPassword: 'New-secure-passphrase-2026',
            })
          ).statusCode,
          200,
        );
        assert.equal((await call('GET', '/v1/session', undefined, owner.cookie)).json().user, null);
        assert.equal((await call('GET', '/v1/session', undefined, cookie)).json().user, null);
        const old = await call('POST', '/v1/auth/login', {
          phone: owner.phone,
          password: 'A-secure-test-passphrase-2026',
        });
        assert.equal(old.statusCode, 401);
        const next = await call('POST', '/v1/auth/login', {
          phone: owner.phone,
          password: 'New-secure-passphrase-2026',
        });
        assert.equal(next.statusCode, 200, next.body);
      });
      await t.test(
        'SQL rate limits survive app recreation and untrusted XFF cannot replace peer IP',
        async () => {
          const phone = makePhone();
          for (let i = 0; i < 10; i++)
            assert.equal(
              (await call('POST', '/v1/auth/login', { phone, password: 'invalid' })).statusCode,
              401,
            );
          const restarted = await buildApp({ db, config, sms });
          try {
            const blocked = await restarted.inject({
              method: 'POST',
              url: '/v1/auth/login',
              remoteAddress: peerAddress,
              headers: { origin },
              payload: { phone, password: 'invalid' },
            });
            assert.equal(blocked.statusCode, 429);
            assert.equal(blocked.json().error.code, 'RATE_LIMITED');
          } finally {
            await restarted.close();
          }
          // Request address cannot be supplied by an untrusted forwarded header in the default deployment.
          const before = (
            await db.query("SELECT key FROM rate_buckets WHERE key LIKE 'write-ip:%'")
          ).rows.map((r) => r.key);
          await call('POST', '/v1/auth/logout', undefined, undefined, {
            'x-forwarded-for': '198.51.100.35',
          });
          const after = (
            await db.query("SELECT key FROM rate_buckets WHERE key LIKE 'write-ip:%'")
          ).rows.map((r) => r.key);
          assert.deepEqual(after.sort(), before.sort());
        },
      );
      await t.test('exactly one trusted proxy hop uses the nearest forwarded address', async () => {
        const proxied = await buildApp({ db, config: { ...config, trustProxyHops: 1 }, sms });
        try {
          const response = await proxied.inject({
            method: 'POST',
            url: '/v1/auth/logout',
            remoteAddress: '10.0.0.8',
            headers: { origin, 'x-forwarded-for': '198.51.100.35, 203.0.113.9' },
          });
          assert.equal(response.statusCode, 200);
          assert.ok(
            (
              await db.query('SELECT key FROM rate_buckets WHERE key=$1', [
                `write-ip:${hash('203.0.113.9')}`,
              ])
            ).rowCount,
          );
          assert.equal(
            (
              await db.query('SELECT key FROM rate_buckets WHERE key=$1', [
                `write-ip:${hash('198.51.100.35')}`,
              ])
            ).rowCount,
            0,
          );
        } finally {
          await proxied.close();
        }
      });
    } finally {
      await app.close();
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
