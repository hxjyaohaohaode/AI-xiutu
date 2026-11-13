import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createAiService } from '@ai-xiutu/ai';
import { createOpenAISpecialists } from '@ai-xiutu/multimodal';
import { adjustUnits, transaction } from '@ai-xiutu/db';
import { collaborationFixture } from './collaboration-fixture.js';
import { buildApp } from '../src/app.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'specialist audio is quoted, moderated, stored against space quota and served only to verified members',
  { skip: !databaseUrl },
  async () => {
    const f = await collaborationFixture(databaseUrl!);
    const modelId = 'gpt-4o-mini-tts';
    const label = `QA ${randomUUID()}`;
    const prior = (
      await f.db.query('SELECT config,version FROM model_configs WHERE id=$1', [modelId])
    ).rows[0];
    const env = {
      OPENAI_API_KEY: 'injected-fixture',
      OPENAI_SPECIALIST_ENABLED: 'true',
      AI_JOURNAL_DIR: join(f.directory, 'dispatch'),
      STORAGE_DIR: f.directory,
    };
    const reviewed: string[] = [];
    let calls = 0;
    const wav = Buffer.alloc(46);
    wav.write('RIFF', 0);
    wav.write('WAVE', 8);
    const provider = createOpenAISpecialists(env, async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/audio/speech');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: modelId,
        input: 'Read aloud.',
        voice: 'marin',
        response_format: 'wav',
        speed: 0.25,
      });
      assert.equal(reviewed.length, 1);
      assert.match(reviewed[0]!, /Read aloud/);
      return new Response(wav, {
        headers: { 'content-type': 'audio/wav', 'x-request-id': 'speech-test' },
      });
    });
    const ai = createAiService(f.db, env, {
      openAISpecialists: provider,
      moderator: {
        configured: true,
        async check(value) {
          reviewed.push(value);
          return {
            decision: 'passed',
            inputHash: createHash('sha256').update(value).digest('hex'),
            requestId: 'review-test',
          };
        },
      },
    });
    const app = await buildApp({
      db: f.db,
      config: f.config,
      aiService: ai,
      sms: {
        configured: false,
        async send() {
          throw new Error('No SMS expected');
        },
      },
    });
    const call = (
      method: 'GET' | 'POST' | 'PUT',
      url: string,
      actor: keyof typeof f.actors,
      payload?: Record<string, unknown>,
    ) =>
      app.inject({
        method,
        url,
        headers: { origin: f.origin, cookie: f.actors[actor].cookie },
        payload,
      });
    try {
      await transaction(f.db, (tx) =>
        adjustUnits(tx, {
          spaceId: f.teamId,
          actorId: f.actors.operator.id,
          units: 5,
          reason: 'Fixture credits',
          idempotencyKey: randomUUID(),
          requestHash: 'fixture',
        }),
      );
      const enabled = await call('PUT', `/v1/ops/models/${modelId}`, 'operator', {
        expectedVersion: prior?.version ?? 0,
        label,
        provider: 'openai',
        operations: ['speak'],
        enabled: true,
        minWidth: 64,
        maxWidth: 4096,
        minHeight: 64,
        maxHeight: 4096,
        maxOutputs: 1,
        unitCost: 3,
        allowedQualities: ['auto'],
        reason: 'Fixture model configuration',
      });
      assert.ok([200, 201].includes(enabled.statusCode), enabled.body);
      const before = (
        await f.db.query('SELECT retained_bytes FROM space_storage_accounts WHERE space_id=$1', [
          f.teamId,
        ])
      ).rows[0];
      const endpoint = `/v1/projects/${f.projectId}/ai-jobs`;
      const body = {
        operation: 'speak',
        modelId,
        prompt: 'Read aloud.',
        idempotencyKey: randomUUID(),
        options: { voice: 'marin', format: 'wav', speed: 0.25 },
      };
      assert.equal(
        (
          await call('POST', endpoint, 'owner', {
            ...body,
            options: { ...body.options, speed: 4.01 },
          })
        ).statusCode,
        400,
      );
      assert.equal(calls, 0);
      const queued = await call('POST', endpoint, 'owner', body);
      assert.equal(queued.statusCode, 202, queued.body);
      const { id, reservedUnits } = queued.json().job;
      assert.equal(reservedUnits, 3);
      assert.equal((await call('POST', endpoint, 'owner', body)).json().job.id, id);
      assert.equal(await ai.runOnce(), true);
      assert.equal(calls, 1);
      const path = `/v1/ai-jobs/${id}/audio`;
      const audio = await call('GET', path, 'viewer');
      assert.equal(audio.statusCode, 200, audio.body);
      assert.equal(audio.headers['cache-control'], 'private, no-store');
      assert.deepEqual(audio.rawPayload, wav);
      assert.equal((await call('GET', path, 'operator')).statusCode, 404);
      const after = (
        await f.db.query('SELECT retained_bytes FROM space_storage_accounts WHERE space_id=$1', [
          f.teamId,
        ])
      ).rows[0];
      assert.equal(Number(after.retained_bytes) - Number(before.retained_bytes), wav.length);
      const job = (
        await f.db.query(
          'SELECT j.state,h.state hold FROM ai_jobs j JOIN quota_holds h ON h.id=j.hold_id WHERE j.id=$1',
          [id],
        )
      ).rows[0];
      assert.deepEqual(job, { state: 'completed', hold: 'settled' });
    } finally {
      await app.close();
      if (prior)
        await f.db.query(
          "UPDATE model_configs SET config=$2,version=$3 WHERE id=$1 AND config->>'label'=$4",
          [modelId, JSON.stringify(prior.config), prior.version, label],
        );
      else
        await f.db.query("DELETE FROM model_configs WHERE id=$1 AND config->>'label'=$2", [
          modelId,
          label,
        ]);
      await f.close();
    }
  },
);
