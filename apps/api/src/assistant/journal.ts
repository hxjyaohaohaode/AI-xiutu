import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, lstat, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { Queryable } from '@ai-xiutu/db';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const identity = z.object({ id: uuid, kind: z.enum(['turn', 'voice']) }).strict();
const dispatchInput = identity
  .extend({ sequence: z.number().int().min(0).max(2147483647), inputHash: digest })
  .strict();
const connectionInput = z.object({ id: uuid, inputHash: digest }).strict();
const stamped = { version: z.literal(1), createdAt: z.string().datetime() };
const recordSchema = z.discriminatedUnion('type', [
  dispatchInput.extend({ ...stamped, type: z.literal('dispatch') }).strict(),
  connectionInput
    .extend({ ...stamped, type: z.literal('connection'), kind: z.literal('voice') })
    .strict(),
]);
type JournalRecord = z.infer<typeof recordSchema>;
export type AssistantDispatchEvidence = z.infer<typeof dispatchInput>;
export type AssistantConnectionEvidence = z.infer<typeof connectionInput>;
export type AssistantJournalCode =
  | 'ASSISTANT_JOURNAL_INVALID'
  | 'ASSISTANT_JOURNAL_CONFLICT'
  | 'ASSISTANT_JOURNAL_UNAVAILABLE'
  | 'ASSISTANT_RECOVERY_REQUIRED';
export class AssistantJournalError extends Error {
  constructor(public readonly code: AssistantJournalCode) {
    super(code);
  }
}
const MAX_RECORD_BYTES = 2048;
const temporaryName =
  /^\.pending-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const nameOf = (record: JournalRecord) =>
  record.type === 'connection'
    ? `connection.voice.${record.id}.json`
    : `dispatch.${record.kind}.${record.id}.${record.sequence}.json`;
const comparable = (record: JournalRecord) =>
  record.type === 'connection'
    ? `${record.type}:${record.id}:${record.inputHash}`
    : `${record.type}:${record.kind}:${record.id}:${record.sequence}:${record.inputHash}`;
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Independent of a PostgreSQL backup, but not an independent disaster-recovery
 * service. The operator must retain this directory with the private media volume.
 * It contains identifiers and hashes only, never prompts, images, audio or keys.
 *
 * Send order: commit the DB marker -> await record* -> require created=true ->
 * recheck paid-row state and permissions -> send once. A successful journal retry
 * is evidence of a possible prior send, NOT permission to replay that send.
 */
export class AssistantJournal {
  readonly directory: string;
  private initialized: Promise<void> | undefined;
  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  private async directoryReady(): Promise<void> {
    this.initialized ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const created = await lstat(this.directory);
      if (!created.isDirectory() || created.isSymbolicLink())
        throw new AssistantJournalError('ASSISTANT_JOURNAL_INVALID');
      // Another process may just have created this path and not synced it yet.
      // Flush all ancestors once per instance, without relying on mkdir's winner.
      for (let path = this.directory; ; path = dirname(path)) {
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (dirname(path) === path) break;
      }
    })().catch((error: unknown) => {
      this.initialized = undefined;
      throw error;
    });
    await this.initialized;
    const status = await lstat(this.directory);
    if (!status.isDirectory() || status.isSymbolicLink())
      throw new AssistantJournalError('ASSISTANT_JOURNAL_INVALID');
  }

  private async syncDirectory(): Promise<void> {
    const handle = await open(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async read(name: string): Promise<JournalRecord> {
    // Names come from this directory, never a caller. Validate even during a scan
    // so malformed evidence cannot disappear by being renamed to another suffix.
    if (
      !/^(connection\.voice\.[0-9a-f-]{36}|dispatch\.(turn|voice)\.[0-9a-f-]{36}\.\d{1,10})\.json$/.test(
        name,
      )
    )
      throw new AssistantJournalError('ASSISTANT_JOURNAL_INVALID');
    let handle;
    try {
      handle = await open(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const status = await handle.stat();
      if (!status.isFile() || status.size < 2 || status.size > MAX_RECORD_BYTES)
        throw new AssistantJournalError('ASSISTANT_JOURNAL_INVALID');
      const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== status.size || bytesRead > MAX_RECORD_BYTES)
        throw new AssistantJournalError('ASSISTANT_JOURNAL_INVALID');
      const record = recordSchema.parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
      if (nameOf(record) !== name) throw new AssistantJournalError('ASSISTANT_JOURNAL_INVALID');
      return record;
    } catch (error) {
      if (isMissing(error) || error instanceof AssistantJournalError) throw error;
      throw new AssistantJournalError('ASSISTANT_JOURNAL_INVALID');
    } finally {
      await handle?.close();
    }
  }

  private async append(record: JournalRecord): Promise<{ created: boolean }> {
    await this.directoryReady();
    const name = nameOf(record);
    try {
      const existing = await this.read(name);
      if (comparable(existing) !== comparable(record))
        throw new AssistantJournalError('ASSISTANT_JOURNAL_CONFLICT');
      await this.syncDirectory();
      return { created: false };
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const temporary = join(this.directory, `.pending-${randomUUID()}.tmp`);
    let handle;
    try {
      // A new exclusive inode is fully synced before it becomes visible under
      // its deterministic name. link() cannot overwrite another process's proof.
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(record));
      await handle.sync();
      await handle.close();
      handle = undefined;
      let created = true;
      try {
        await link(temporary, join(this.directory, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await this.read(name);
        if (comparable(existing) !== comparable(record))
          throw new AssistantJournalError('ASSISTANT_JOURNAL_CONFLICT');
        created = false;
      }
      await unlink(temporary);
      await this.syncDirectory();
      return { created };
    } catch (error) {
      if (error instanceof AssistantJournalError) throw error;
      throw new AssistantJournalError('ASSISTANT_JOURNAL_UNAVAILABLE');
    } finally {
      await handle?.close();
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  async recordDispatch(input: AssistantDispatchEvidence): Promise<{ created: boolean }> {
    const checked = dispatchInput.parse(input);
    return this.append({
      ...checked,
      version: 1,
      type: 'dispatch',
      createdAt: new Date().toISOString(),
    });
  }

  async recordConnection(input: AssistantConnectionEvidence): Promise<{ created: boolean }> {
    const checked = connectionInput.parse(input);
    return this.append({
      ...checked,
      version: 1,
      type: 'connection',
      kind: 'voice',
      createdAt: new Date().toISOString(),
    });
  }

  private async names(): Promise<string[]> {
    await this.directoryReady();
    const names = await readdir(this.directory);
    // Unpublished temporary files cannot have granted permission to send. They
    // may belong to an active writer, so readers never remove or interpret them.
    return names.filter((name) => !temporaryName.test(name)).sort();
  }

  /** Recovery uses the filesystem even if a restored DB lost its dispatch row.
   * Errors are deliberately not converted to 'no evidence'. */
  async hasEvidence(input: { id: string; kind: 'turn' | 'voice' }): Promise<boolean> {
    const checked = identity.parse(input);
    let found = false;
    for (const name of await this.names()) {
      const record = await this.read(name);
      if (record.id === checked.id && record.kind === checked.kind) found = true;
    }
    return found;
  }

  /** Published filesystem evidence must have a matching durable DB marker.
   * The reverse is intentionally allowed: a DB marker can precede a failed
   * fsync, and does not by itself prove an external request was sent. */
  async assertDatabaseMatches(db: Queryable): Promise<void> {
    const names = await this.names();
    for (let offset = 0; offset < names.length; offset += 48) {
      const records = await Promise.all(
        names.slice(offset, offset + 48).map((name) => this.read(name)),
      );
      const dispatches = records.filter((record) => record.type === 'dispatch');
      const connections = records.filter((record) => record.type === 'connection');
      if (dispatches.length) {
        const rows = (
          await db.query(
            `SELECT turn_id,voice_id,sequence,input_hash FROM assistant_dispatches
          WHERE turn_id=ANY($1::uuid[]) OR voice_id=ANY($2::uuid[])`,
            [
              [
                ...new Set(
                  dispatches.filter((record) => record.kind === 'turn').map((record) => record.id),
                ),
              ],
              [
                ...new Set(
                  dispatches.filter((record) => record.kind === 'voice').map((record) => record.id),
                ),
              ],
            ],
          )
        ).rows;
        const markers = new Map(
          rows.map((row) => [
            `${row.turn_id ? 'turn' : 'voice'}:${row.turn_id ?? row.voice_id}:${row.sequence}`,
            row.input_hash,
          ]),
        );
        for (const record of dispatches) {
          if (markers.get(`${record.kind}:${record.id}:${record.sequence}`) !== record.inputHash)
            throw new AssistantJournalError('ASSISTANT_RECOVERY_REQUIRED');
        }
      }
      if (connections.length) {
        const rows = (
          await db.query(
            'SELECT id,request_hash,state FROM voice_sessions WHERE id=ANY($1::uuid[])',
            [connections.map((record) => record.id)],
          )
        ).rows;
        const markers = new Map(rows.map((row) => [row.id, row]));
        for (const record of connections) {
          const marker = markers.get(record.id);
          if (!marker || marker.request_hash !== record.inputHash || marker.state === 'prepared')
            throw new AssistantJournalError('ASSISTANT_RECOVERY_REQUIRED');
        }
      }
    }
  }
}
