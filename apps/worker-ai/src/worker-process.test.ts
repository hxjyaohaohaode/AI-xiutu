import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('worker reports failed dispatch checks to its supervisor and exits cleanly on SIGTERM', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 30_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiutu-worker-exit-'));
  async function run(broken: boolean) {
    const journal = join(root, broken ? 'broken' : 'clean');
    await mkdir(journal);
    if (broken) await writeFile(join(journal, 'invalid.json'), '{}');
    const processHandle = spawn(process.execPath, ['--import', 'tsx', 'apps/worker-ai/src/index.ts'], {
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, AI_JOURNAL_DIR: journal,
        AI_IMAGE_ENABLED: 'false', AI_PLAN_ENABLED: 'false', AI_TEXT_ENABLED: 'false',
        AI_SPEECH_ENABLED: 'false', OPENAI_SPECIALIST_ENABLED: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 12_000,
    });
    const finished = once(processHandle, 'close');
    let stderr = '';
    processHandle.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    if (!broken) processHandle.stdout.once('data', () => processHandle.kill('SIGTERM'));
    const [code, signal] = await finished;
    assert.equal(signal, null);
    return { code, stderr };
  }
  try {
    const failure = await run(true);
    assert.equal(failure.code, 1);
    assert.match(failure.stderr, /worker stopped/i);
    assert.equal((await run(false)).code, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
