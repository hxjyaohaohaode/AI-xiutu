import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile, rm, stat, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { transaction, adjustUnits, reserveUnits } from '@ai-xiutu/db';
import { AssistantJournal, AssistantJournalError } from '../src/assistant/journal.js';
import { collaborationFixture } from './collaboration-fixture.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const code = (value: string) => (error: unknown) =>
  error instanceof AssistantJournalError && error.code === value;
const databaseUrl = process.env.TEST_DATABASE_URL;

test('assistant journal atomically publishes durable, strictly bounded non-secret evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiutu-assistant-journal-'));
  try {
    const journals = Array.from({ length: 4 }, () => new AssistantJournal(directory));
    const entry = {
      kind: 'turn' as const,
      id: randomUUID(),
      sequence: 0,
      inputHash: sha('frozen bounded request'),
    };
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) => journals[index % 4]!.recordDispatch(entry)),
    );
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(results.filter((result) => !result.created).length, 23);
    const name = `dispatch.turn.${entry.id}.0.json`;
    assert.deepEqual(await readdir(directory), [name]);
    const original = await readFile(join(directory, name), 'utf8');
    const record = JSON.parse(original);
    assert.deepEqual(
      Object.keys(record).sort(),
      ['version', 'type', 'kind', 'id', 'sequence', 'inputHash', 'createdAt'].sort(),
    );
    assert.ok(!original.includes('frozen bounded request'));
    if (process.platform !== 'win32')
      assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
    assert.deepEqual(await journals[0]!.recordDispatch(entry), { created: false });
    assert.equal(
      await readFile(join(directory, name), 'utf8'),
      original,
      'retry must not replace first evidence or timestamp',
    );
    await assert.rejects(
      journals[0]!.recordDispatch({ ...entry, inputHash: sha('another request') }),
      code('ASSISTANT_JOURNAL_CONFLICT'),
    );
    assert.equal(await journals[0]!.hasEvidence({ id: entry.id, kind: 'turn' }), true);
    assert.equal(await journals[0]!.hasEvidence({ id: entry.id, kind: 'voice' }), false);
    await journals[0]!.recordDispatch({ ...entry, sequence: 1 });
    const voice = { id: randomUUID(), inputHash: sha('frozen connection request') };
    assert.deepEqual(await journals[0]!.recordConnection(voice), { created: true });
    assert.deepEqual(await journals[1]!.recordConnection(voice), { created: false });
    assert.equal(await journals[0]!.hasEvidence({ id: voice.id, kind: 'voice' }), true);
    assert.equal((await readdir(directory)).length, 3);
    const childEntry = { ...entry, id: randomUUID() };
    const source = `import { AssistantJournal } from ${JSON.stringify(new URL('../src/assistant/journal.ts', import.meta.url).href)};
      const result=await new AssistantJournal(process.argv[1]).recordDispatch(JSON.parse(process.argv[2]));
      process.stdout.write(JSON.stringify(result));`;
    const children = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise<{ created: boolean }>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [
                '--import',
                'tsx',
                '--input-type=module',
                '-e',
                source,
                directory,
                JSON.stringify(childEntry),
              ],
              { stdio: ['ignore', 'pipe', 'pipe'] },
            );
            let output = '',
              error = '';
            child.stdout.on('data', (chunk) => {
              output += String(chunk);
            });
            child.stderr.on('data', (chunk) => {
              error += String(chunk);
            });
            child.on('error', reject);
            child.on('close', (status) => {
              if (status !== 0) reject(new Error(error));
              else {
                try {
                  resolve(JSON.parse(output));
                } catch (failure) {
                  reject(failure);
                }
              }
            });
          }),
      ),
    );
    assert.equal(
      children.filter((result) => result.created).length,
      1,
      'independent processes publish only one send authority',
    );
    assert.equal(children.filter((result) => !result.created).length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('assistant journal refuses traversal, unknown keys, malformed records and symlinks; errors are never absence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiutu-assistant-journal-invalid-'));
  try {
    const journal = new AssistantJournal(directory);
    const entry = { kind: 'turn' as const, id: randomUUID(), sequence: 0, inputHash: sha('input') };
    for (const invalid of [
      { ...entry, id: '../private' },
      { ...entry, sequence: -1 },
      { ...entry, sequence: 2147483648 },
      { ...entry, inputHash: 'not-a-digest' },
      { ...entry, prompt: 'must never be persisted' },
    ])
      await assert.rejects(journal.recordDispatch(invalid));
    await assert.rejects(
      journal.recordConnection({ id: '../private', inputHash: entry.inputHash }),
    );
    assert.deepEqual(await readdir(directory), []);
    const name = `dispatch.turn.${entry.id}.0.json`,
      path = join(directory, name);
    await writeFile(path, '{unfinished');
    await assert.rejects(
      journal.hasEvidence({ id: randomUUID(), kind: 'turn' }),
      code('ASSISTANT_JOURNAL_INVALID'),
    );
    await assert.rejects(journal.recordDispatch(entry), code('ASSISTANT_JOURNAL_INVALID'));
    await writeFile(path, 'x'.repeat(4096));
    await assert.rejects(
      journal.hasEvidence({ id: entry.id, kind: 'turn' }),
      code('ASSISTANT_JOURNAL_INVALID'),
    );
    await rm(path);
    await journal.recordDispatch(entry);
    const valid = await readFile(path, 'utf8');
    await writeFile(path, JSON.stringify({ ...JSON.parse(valid), privateText: 'not allowed' }));
    await assert.rejects(
      journal.hasEvidence({ id: entry.id, kind: 'turn' }),
      code('ASSISTANT_JOURNAL_INVALID'),
    );
    await rm(path);
    const tempName = `.pending-${randomUUID()}.tmp`;
    await writeFile(join(directory, tempName), 'a writer has not published this inode');
    assert.equal(await journal.hasEvidence({ id: entry.id, kind: 'turn' }), false);
    assert.equal(
      await readFile(join(directory, tempName), 'utf8'),
      'a writer has not published this inode',
      'readers do not delete an active writer temporary',
    );
    await writeFile(join(directory, 'unrecognized.txt'), '{}');
    await assert.rejects(
      journal.hasEvidence({ id: entry.id, kind: 'turn' }),
      code('ASSISTANT_JOURNAL_INVALID'),
    );
    await rm(join(directory, 'unrecognized.txt'));
    if (process.platform !== 'win32') {
      const target = join(directory, 'outside-data');
      await writeFile(target, valid);
      await symlink(target, path);
      await assert.rejects(journal.recordDispatch(entry), code('ASSISTANT_JOURNAL_INVALID'));
      await rm(path);
      await rm(target);
      const outside = join(directory, 'outside-directory');
      await mkdir(outside);
      const linked = join(directory, 'linked-directory');
      await symlink(outside, linked);
      await assert.rejects(
        new AssistantJournal(linked).recordDispatch(entry),
        code('ASSISTANT_JOURNAL_INVALID'),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'independent assistant journal detects restored or divergent dispatch and connection markers against actual SQL',
  { skip: !databaseUrl },
  async (t) => {
    const f = await collaborationFixture(databaseUrl!);
    const journal = new AssistantJournal(join(f.directory, 'separate-dispatch-evidence'));
    const turnId = randomUUID(),
      voiceId = randomUUID(),
      turnHash = sha('turn request'),
      voiceHash = sha('voice request');
    const dispatchTurnHash = sha('first exact wire request'),
      dispatchVoiceHash = sha('delegated exact wire request');
    try {
      await transaction(f.db, async (tx) => {
        await adjustUnits(tx, {
          spaceId: f.teamId,
          actorId: f.actors.operator.id,
          units: 100,
          reason: 'isolated journal recovery test',
          idempotencyKey: randomUUID(),
          requestHash: sha(randomUUID()),
        });
        const turnHold = await reserveUnits(tx, {
          spaceId: f.teamId,
          userId: f.actors.owner.id,
          units: 1,
          requestHash: turnHash,
          idempotencyKey: randomUUID(),
        });
        const voiceHold = await reserveUnits(tx, {
          spaceId: f.teamId,
          userId: f.actors.owner.id,
          units: 1,
          requestHash: voiceHash,
          idempotencyKey: randomUUID(),
        });
        await tx.query(
          `INSERT INTO assistant_turns(id,project_id,actor_id,model_id,idempotency_key,request_hash,state,prompt,scope,hold_id)
        VALUES($1,$2,$3,'journal-fixture',$4,$5,'running','never persisted in filesystem','{}',$6)`,
          [turnId, f.projectId, f.actors.owner.id, randomUUID(), turnHash, turnHold.id],
        );
        await tx.query(
          `INSERT INTO voice_sessions(id,project_id,actor_id,model_id,backend_model_id,idempotency_key,request_hash,hold_id,state,config,scope,connection_hash,connect_expires_at)
        VALUES($1,$2,$3,'journal-voice-fixture','journal-fixture',$4,$5,$6,'connecting','{}','{}',$7,clock_timestamp()+interval '60 seconds')`,
          [
            voiceId,
            f.projectId,
            f.actors.owner.id,
            randomUUID(),
            voiceHash,
            voiceHold.id,
            sha(randomUUID()),
          ],
        );
        await tx.query(
          'INSERT INTO assistant_dispatches(turn_id,sequence,input_hash) VALUES($1,0,$2)',
          [turnId, dispatchTurnHash],
        );
        await tx.query(
          'INSERT INTO assistant_dispatches(voice_id,sequence,input_hash) VALUES($1,4,$2)',
          [voiceId, dispatchVoiceHash],
        );
      });
      await t.test(
        'DB markers can safely precede fsync and exact records match both execution families',
        async () => {
          await journal.assertDatabaseMatches(f.db);
          await journal.recordDispatch({
            id: turnId,
            kind: 'turn',
            sequence: 0,
            inputHash: dispatchTurnHash,
          });
          await journal.recordConnection({ id: voiceId, inputHash: voiceHash });
          await journal.recordDispatch({
            id: voiceId,
            kind: 'voice',
            sequence: 4,
            inputHash: dispatchVoiceHash,
          });
          await journal.assertDatabaseMatches(f.db);
        },
      );
      await t.test(
        'lost DB dispatch and mismatched wire hash fail closed without altering the ledger or proof',
        async () => {
          const before = (
            await f.db.query(
              'SELECT count(*)::int AS count FROM ledger_entries WHERE space_id=$1',
              [f.teamId],
            )
          ).rows[0]!.count;
          await f.db.query('DELETE FROM assistant_dispatches WHERE turn_id=$1', [turnId]);
          await assert.rejects(
            journal.assertDatabaseMatches(f.db),
            code('ASSISTANT_RECOVERY_REQUIRED'),
          );
          assert.equal(await journal.hasEvidence({ id: turnId, kind: 'turn' }), true);
          await f.db.query(
            'INSERT INTO assistant_dispatches(turn_id,sequence,input_hash) VALUES($1,0,$2)',
            [turnId, sha('divergent')],
          );
          await assert.rejects(
            journal.assertDatabaseMatches(f.db),
            code('ASSISTANT_RECOVERY_REQUIRED'),
          );
          await f.db.query('UPDATE assistant_dispatches SET input_hash=$2 WHERE turn_id=$1', [
            turnId,
            dispatchTurnHash,
          ]);
          await journal.assertDatabaseMatches(f.db);
          assert.equal(
            (
              await f.db.query(
                'SELECT count(*)::int AS count FROM ledger_entries WHERE space_id=$1',
                [f.teamId],
              )
            ).rows[0]!.count,
            before,
          );
        },
      );
      await t.test(
        'a restored prepared connection or changed frozen request cannot be mistaken for an unused ticket',
        async () => {
          await f.db.query("UPDATE voice_sessions SET state='prepared' WHERE id=$1", [voiceId]);
          await assert.rejects(
            journal.assertDatabaseMatches(f.db),
            code('ASSISTANT_RECOVERY_REQUIRED'),
          );
          await f.db.query(
            "UPDATE voice_sessions SET state='connecting',request_hash=$2 WHERE id=$1",
            [voiceId, sha('changed prepare')],
          );
          await assert.rejects(
            journal.assertDatabaseMatches(f.db),
            code('ASSISTANT_RECOVERY_REQUIRED'),
          );
          await f.db.query(
            "UPDATE voice_sessions SET state='unknown',request_hash=$2 WHERE id=$1",
            [voiceId, voiceHash],
          );
          await journal.assertDatabaseMatches(f.db);
          assert.equal(await journal.hasEvidence({ id: voiceId, kind: 'voice' }), true);
          const absent = randomUUID();
          await journal.recordConnection({ id: absent, inputHash: sha('missing row') });
          await assert.rejects(
            journal.assertDatabaseMatches(f.db),
            code('ASSISTANT_RECOVERY_REQUIRED'),
          );
        },
      );
    } finally {
      await f.close();
    }
  },
);
