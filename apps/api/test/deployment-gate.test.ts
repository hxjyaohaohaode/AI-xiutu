import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createDatabase } from '@ai-xiutu/db';
import { createDeploymentGate } from '@ai-xiutu/storage';
import { buildApp } from '../src/app.js';

test('candidate process holds shared storage until promotion and skips I/O after promotion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiutu-release-gate-'));
  try {
    const marker = join(root, '.xiutu-schema-upgrade');
    await writeFile(marker, 'test');
    const held = createDeploymentGate(root);
    assert.equal(held(), true);
    await unlink(marker);
    assert.equal(held(), false);
    // Operators create the next gate only after stopping writers. A surviving
    // old process must never independently transition into a different upgrade.
    await writeFile(marker, 'next');
    assert.equal(held(), false);
    assert.equal(createDeploymentGate(root)(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('held candidate serves real probes and rejects writes and voice upgrades until commit',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'xiutu-held-api-'));
    const marker = join(root, '.xiutu-schema-upgrade');
    await writeFile(marker, 'test');
    const databaseUrl = process.env.TEST_DATABASE_URL!;
    const db = createDatabase(databaseUrl);
    const app = await buildApp({ db, config: {
      databaseUrl, storageDir: root, sessionSecret: 'x'.repeat(64), secureCookie: false,
      host: '127.0.0.1', port: 0, origins: ['http://localhost'], maxPixels: 1_000_000, maxUploadBytes: 1_000_000,
    } });
    try {
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      for (const url of ['/health', '/v1/session', '/v1/public-config', '/v1/media-capabilities', '/v1/modules']) {
        assert.equal((await app.inject({ url })).statusCode, 200, url);
      }
      assert.equal((await app.inject({ url: '/v1/projects' })).statusCode, 401);
      const blocked = await app.inject({ method: 'POST', url: '/v1/projects' });
      assert.equal(blocked.statusCode, 503);
      assert.equal(blocked.headers['retry-after'], '5');
      assert.equal(blocked.json().error.code, 'DEPLOYMENT_IN_PROGRESS');
      const wsReply = await new Promise<string>((resolve, reject) => {
        const sock = createConnection(Number(new URL(origin).port), '127.0.0.1');
        let data = '';
        sock.setTimeout(5000, () => sock.destroy(new Error('upgrade did not respond')));
        sock.on('error', reject);
        sock.on('connect', () => sock.write('GET /v1/voice-sessions/test/stream HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
        sock.on('data', (bytes) => { data += bytes; });
        sock.on('end', () => resolve(data));
      });
      assert.match(wsReply, /HTTP\/1\.1 503/);
      await unlink(marker);
      assert.equal((await app.inject({ method: 'POST', url: '/v1/projects' })).statusCode, 403);
    } finally {
      await app.close();
      await db.end();
      await rm(root, { recursive: true, force: true });
    }
  });
