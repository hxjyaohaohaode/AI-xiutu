import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createDatabase, transaction } from '@ai-xiutu/db';
import { createRecipeV3, createAdjustmentRegionV3 } from '@ai-xiutu/editor';
import type { AssistantDependencies } from '../src/assistant/index.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { LocalPrivateStorage } from '../src/storage.js';
import { createArtworkBranch } from '../src/revision-commands.js';
import { hash } from '../src/core.js';

export async function collaborationFixture(
  databaseUrl: string,
  options: { assistant?: AssistantDependencies } = {},
) {
  const db = createDatabase(databaseUrl),
    directory = await mkdtemp(join(tmpdir(), 'xiutu-v4-sql-'));
  const origin = 'http://v4.test';
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: 'isolated-v4-fixture-not-production-credentials',
    STORAGE_DIR: directory,
    APP_ORIGIN: origin,
    NODE_ENV: 'test',
  });
  const app = await buildApp({
    db,
    config,
    assistant: options.assistant,
    sms: {
      configured: false,
      async send() {
        throw new Error('No live SMS');
      },
    },
  });
  await app.ready();
  const storage = new LocalPrivateStorage(config);
  await storage.initialize();
  const stored = await storage.storeGenerated(
    await sharp({ create: { width: 64, height: 48, channels: 4, background: '#559988' } })
      .png()
      .toBuffer(),
  );
  const users = ['owner', 'editor', 'viewer', 'outsider', 'operator'] as const;
  const actors = {} as Record<
    (typeof users)[number],
    { id: string; spaceId: string; cookie: string; tokenHash: string }
  >;
  const teamId = randomUUID(),
    projectId = randomUUID(),
    privateProjectId = randomUUID(),
    assetId = randomUUID(),
    privateAssetId = randomUUID();
  const recipe = createRecipeV3({
    regionEdits: [0.2, 0.8].map((x, i) =>
      createAdjustmentRegionV3({
        id: i ? 'right' : 'left',
        mask: {
          type: 'radial',
          centerX: x,
          centerY: 0.5,
          radiusX: 0.15,
          radiusY: 0.2,
          feather: 0.4,
          invert: false,
        },
      }),
    ),
  });
  let artwork: Awaited<ReturnType<typeof createArtworkBranch>>;
  await transaction(db, async (tx) => {
    for (const name of users) {
      const userId = randomUUID(),
        spaceId = randomUUID(),
        token = randomBytes(32).toString('base64url');
      actors[name] = {
        id: userId,
        spaceId,
        cookie: `xiutu_session=${token}`,
        tokenHash: hash(token),
      };
      await tx.query(
        'INSERT INTO users(id,phone,display_name,phone_verified_at) VALUES($1,$2,$3,now())',
        [userId, `test-${userId}`, name],
      );
      await tx.query("INSERT INTO spaces(id,name,kind,owner_id) VALUES($1,$2,'personal',$3)", [
        spaceId,
        name,
        userId,
      ]);
      await tx.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'owner')", [
        spaceId,
        userId,
      ]);
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
        [hash(token), userId],
      );
    }
    await tx.query('INSERT INTO operator_users(user_id) VALUES($1)', [actors.operator.id]);
    await tx.query("INSERT INTO spaces(id,name,kind,owner_id) VALUES($1,'V4 team','team',$2)", [
      teamId,
      actors.owner.id,
    ]);
    for (const name of ['owner', 'editor', 'viewer'] as const)
      await tx.query('INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,$3)', [
        teamId,
        actors[name].id,
        name,
      ]);
    for (const [pid, sid] of [
      [projectId, teamId],
      [privateProjectId, actors.owner.spaceId],
    ]) {
      await tx.query(
        "INSERT INTO projects(id,space_id,title,created_by) VALUES($1,$2,'V4 project',$3)",
        [pid, sid, actors.owner.id],
      );
    }
    for (const [aid, pid] of [
      [assetId, projectId],
      [privateAssetId, privateProjectId],
    ]) {
      await tx.query(
        `INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,provenance,created_by)
        VALUES($1,$2,'resource photo.png',$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [
          aid,
          pid,
          stored.key,
          stored.mime,
          stored.width,
          stored.height,
          stored.bytes,
          stored.hash,
          JSON.stringify({ kind: 'uploaded', declaredSource: 'upload' }),
          actors.owner.id,
        ],
      );
    }
    artwork = await createArtworkBranch(tx, {
      projectId,
      actorId: actors.owner.id,
      assetId,
      recipe,
      title: 'Collaborative portrait',
      label: 'original',
    });
  });
  const address = `127.0.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const call = (method: any, url: string, body?: unknown, actor: keyof typeof actors = 'owner') =>
    app.inject({
      method,
      url,
      remoteAddress: address,
      headers: { origin, cookie: actors[actor].cookie },
      ...(body === undefined ? {} : { payload: body as any }),
    });
  const close = async () => {
    await app.close();
    await db.end();
    await rm(directory, { recursive: true, force: true });
  };
  return {
    db,
    app,
    call,
    close,
    config,
    directory,
    storage,
    origin,
    actors,
    teamId,
    projectId,
    privateProjectId,
    assetId,
    privateAssetId,
    recipe,
    artwork: artwork!,
  };
}
