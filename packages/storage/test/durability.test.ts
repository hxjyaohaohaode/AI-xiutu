import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncStorageDirectory } from '../src/durability.js';

test('directory flushing validates the target and never masks missing paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiutu-durability-'));
  try {
    await syncStorageDirectory(directory);
    await assert.rejects(syncStorageDirectory(join(directory, 'missing')), { code: 'ENOENT' });
    await writeFile(join(directory, 'file'), 'test');
    await assert.rejects(
      syncStorageDirectory(join(directory, 'file')),
      /STORAGE_DIRECTORY_INVALID/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
