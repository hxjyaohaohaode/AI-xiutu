import { mkdir, open, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Database } from '@ai-xiutu/db';
import { syncStorageDirectory } from '@ai-xiutu/storage';

/** Separate from PostgreSQL backups. A pilot journal, not independent disaster recovery. */
export class DispatchJournal {
  readonly directory: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
  }
  /** The caller holds the job row while deciding whether cancellation is safe.
   * A restored queued row may already have been dispatched outside the backup.
   * Malformed or mismatched evidence fails closed, never counts as absence. */
  async hasDispatch(jobId: string, inputHash: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error('AI_JOURNAL_INVALID');
    const filename = join(this.directory, `${jobId}.json`);
    try {
      if ((await stat(filename)).size > 2048) throw new Error('AI_JOURNAL_INVALID');
      const record = JSON.parse(await readFile(filename, 'utf8')) as {
        version?: number;
        jobId?: string;
        inputHash?: string;
      };
      if (record?.version !== 1 || record.jobId !== jobId || typeof record.inputHash !== 'string')
        throw new Error('AI_JOURNAL_INVALID');
      if (record.inputHash !== inputHash) throw new Error('AI_RECOVERY_REQUIRED');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  async start(jobId: string, inputHash: string): Promise<boolean> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let file;
    try {
      file = await open(join(this.directory, `${jobId}.json`), 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
    try {
      await file.writeFile(
        JSON.stringify({ version: 1, jobId, inputHash, dispatchedAt: new Date().toISOString() }),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await syncStorageDirectory(this.directory);
    return true;
  }
  /** A restored DB missing even one external dispatch stops all new external work. */
  async assertDatabaseMatches(db: Database): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entries = (await readdir(this.directory)).filter((name) => name.endsWith('.json'));
    for (let offset = 0; offset < entries.length; offset += 48) {
      const records = await Promise.all(
        entries.slice(offset, offset + 48).map(async (name) => {
          const filename = join(this.directory, name);
          if ((await stat(filename)).size > 2048) throw new Error('AI_JOURNAL_INVALID');
          const record: unknown = JSON.parse(await readFile(filename, 'utf8'));
          const r = record as { version?: number; jobId?: string; inputHash?: string };
          if (
            r.version !== 1 ||
            !r.jobId ||
            !r.inputHash ||
            name !== `${r.jobId}.json` ||
            !/^[0-9a-f-]{36}$/.test(r.jobId)
          )
            throw new Error('AI_JOURNAL_INVALID');
          return r as { jobId: string; inputHash: string };
        }),
      );
      const found = await db.query('SELECT id,input_hash FROM ai_jobs WHERE id=ANY($1::uuid[])', [
        records.map((record) => record.jobId),
      ]);
      const hashes = new Map(found.rows.map((row) => [row.id, row.input_hash]));
      for (const record of records)
        if (hashes.get(record.jobId) !== record.inputHash) throw new Error('AI_RECOVERY_REQUIRED');
    }
  }
}
