import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { collaborationFixture } from './collaboration-fixture.js';

const database = process.env.TEST_DATABASE_URL;
test(
  'support receipts are private and verified operator grants settle a personal account once',
  { skip: !database },
  async () => {
    const image = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    const f = await collaborationFixture(database!, { supportQr: image });
    try {
      for (const path of ['/v1/support', '/v1/support/wechat-qr'])
        assert.equal((await f.app.inject(path)).statusCode, 401);
      const catalog = await f.call('GET', '/v1/support');
      assert.equal(catalog.statusCode, 200);
      const info = catalog.json();
      assert.deepEqual(
        info.tiers.map((tier: { cents: number; points: number }) => [tier.cents, tier.points]),
        [
          [199, 20],
          [999, 100],
          [1999, 200],
          [4999, 500],
          [9999, 1000],
          [14999, 1500],
        ],
      );
      const qr = await f.call('GET', info.qrUrl);
      assert.deepEqual(qr.rawPayload, image);
      assert.equal(qr.headers['cache-control'], 'private, no-store');
      const phone = '139' + randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0');
      await f.db.query('UPDATE users SET phone=$2 WHERE id=$1', [f.actors.owner.id, `+86${phone}`]);
      const formatted = encodeURIComponent(`+86 ${phone.slice(0, 3)}-${phone.slice(3)}`);
      const search = `/v1/ops/users?query=${formatted}`;
      assert.equal((await f.call('GET', search)).statusCode, 403);
      assert.deepEqual(
        (await f.call('GET', search, undefined, 'operator'))
          .json()
          .users.map((user: { id: string }) => user.id),
        [f.actors.owner.id],
      );
      const before = (await f.call('GET', '/v1/me/entitlements')).json();
      const data = {
        userId: f.actors.owner.id,
        cents: 999,
        expectedPoints: 100,
        reference: randomUUID(),
      };
      const path = '/v1/ops/support-grants';
      assert.equal((await f.call('POST', path, data)).statusCode, 403);
      assert.equal(
        (await f.call('POST', path, { ...data, expectedPoints: 1000 }, 'operator')).statusCode,
        409,
      );
      const concurrent = await Promise.all(
        [data, { ...data, reference: data.reference.toUpperCase() }].map((input) =>
          f.call('POST', path, input, 'operator'),
        ),
      );
      assert.deepEqual(
        concurrent.map((reply) => reply.statusCode),
        [200, 200],
      );
      const receipts = concurrent.map((reply) => reply.json());
      assert.equal(receipts[0].adjustmentId, receipts[1].adjustmentId);
      assert.deepEqual(receipts.map((receipt) => receipt.replayed).sort(), [false, true]);
      assert.equal(
        (await f.call('POST', path, { ...data, userId: f.actors.editor.id }, 'operator'))
          .statusCode,
        409,
      );
      const after = (await f.call('GET', '/v1/me/entitlements')).json();
      assert.equal(after.available, before.available + 100);
      assert.equal(after.purchasedAvailable, before.purchasedAvailable);
      assert.equal(after.lots.filter((lot: { kind: string }) => lot.kind === 'gift').length, 1);
      assert.equal(
        (
          await f.call(
            'GET',
            `/v1/me/entitlements?spaceId=${f.actors.owner.spaceId}`,
            undefined,
            'editor',
          )
        ).statusCode,
        403,
      );
      await f.db.query('UPDATE users SET phone_verified_at=NULL WHERE id=$1', [f.actors.editor.id]);
      assert.equal(
        (
          await f.call(
            'POST',
            path,
            { ...data, userId: f.actors.editor.id, reference: randomUUID() },
            'operator',
          )
        ).statusCode,
        409,
      );

      const settingsPath = '/v1/ops/support';
      assert.equal((await f.call('GET', settingsPath)).statusCode, 403);
      const old = (await f.call('GET', settingsPath, undefined, 'operator')).json();
      assert.equal(old.qrSource, 'deployment');
      const upload = (bytes: Buffer, actor: 'owner' | 'operator', version: number) => {
        const boundary = 'xiutu-test-' + randomUUID();
        const payload = Buffer.concat([
          Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="support.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'),
          bytes, Buffer.from('\r\n--' + boundary + '--\r\n'),
        ]);
        return f.app.inject({
          method: 'PUT', url: settingsPath + '/qr?expectedVersion=' + version, payload,
          headers: { origin: f.origin, cookie: f.actors[actor].cookie, 'content-type': 'multipart/form-data; boundary=' + boundary },
        });
      };
      const nextImage = await sharp({ create: { width: 80, height: 72, channels: 3, background: '#fff' } }).jpeg().toBuffer();
      assert.equal((await upload(nextImage, 'owner', old.version)).statusCode, 403);
      assert.equal((await upload(Buffer.from('invalid image'), 'operator', old.version)).statusCode, 400);
      const uploaded = await upload(nextImage, 'operator', old.version);
      assert.equal(uploaded.statusCode, 200, uploaded.body);
      assert.equal(uploaded.json().qrSource, 'upload');
      const nowQr = await f.call('GET', info.qrUrl);
      assert.equal((await sharp(nowQr.rawPayload).metadata()).width, 80);
      const plan = { enabled: false, tiers: [{ cents: 999, points: 125 }] };
      assert.equal((await f.call('PATCH', settingsPath, { ...plan, expectedVersion: old.version }, 'operator')).statusCode, 409);
      const updated = await f.call('PATCH', settingsPath, { ...plan, expectedVersion: uploaded.json().version }, 'operator');
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal((await f.call('GET', info.qrUrl)).statusCode, 404);
      assert.equal((await f.call('GET', '/v1/support')).json().tiers[0].points, 125);
      assert.equal((await f.call('POST', path, { ...data, expectedVersion: old.version }, 'operator')).json().replayed, true);
      const freshReference = { ...data, reference: randomUUID() };
      assert.equal((await f.call('POST', path, freshReference, 'operator')).json().error.code, 'SUPPORT_TIER_CHANGED');
      const settled = await f.call('POST', path, {
        ...freshReference, expectedVersion: updated.json().version, expectedPoints: 125,
      }, 'operator');
      assert.equal(settled.statusCode, 200, settled.body);
      assert.equal(settled.json().points, 125);
      await f.db.query('UPDATE site_support_config SET qr_png=NULL,tiers=NULL,enabled=true,version=version+1');
    } finally {
      await f.close();
    }
  },
);
