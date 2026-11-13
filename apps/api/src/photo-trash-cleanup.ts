import { lockAssetStorageKeys, transaction, type Database, type Queryable } from '@ai-xiutu/db';
import type { FastifyInstance } from 'fastify';
import { photoTrashRetention } from './photo-trash.js';
import type { LocalPrivateStorage } from './storage.js';

const due = `deleted_at <= clock_timestamp() - ${photoTrashRetention}`;
type StorageKind = 'canonical' | 'original' | 'animation';

async function lockRemovalKey(tx: Queryable, kind: StorageKind, key: string) {
  if (kind === 'canonical') return lockAssetStorageKeys(tx, [key]);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `photo-storage-cleanup:${kind}:${key}`,
  ]);
}

async function queueRemoval(tx: Queryable, kind: StorageKind, key: string) {
  await tx.query(
    'INSERT INTO photo_storage_cleanup(kind,storage_key) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [kind, key],
  );
}

async function finalizeAsset(db: Database) {
  return transaction(db, async (tx) => {
    const asset = (await tx.query(
      `SELECT a.id,a.storage_key,a.bytes,p.space_id,m.object_id,g.storage_name,g.bytes AS animation_bytes
       FROM assets a JOIN projects p ON p.id=a.project_id
       LEFT JOIN media_sources m ON m.asset_id=a.id AND m.released_at IS NULL
       LEFT JOIN animation_assets g ON g.asset_id=a.id
       WHERE a.purged_at IS NULL AND a.trash_token IS NOT NULL AND a.${due}
       ORDER BY a.deleted_at,a.trash_token LIMIT 1 FOR UPDATE OF a SKIP LOCKED`,
    )).rows[0];
    if (!asset) return false;
    if (asset.object_id) {
      // Copy and original publication use this same object fence.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `media-object:${asset.object_id}`,
      ]);
      await tx.query('UPDATE media_sources SET released_at=clock_timestamp() WHERE asset_id=$1 AND released_at IS NULL', [asset.id]);
      const original = await tx.query(
        `UPDATE media_objects o SET purged_at=clock_timestamp()
         WHERE o.id=$1 AND o.purged_at IS NULL AND NOT EXISTS (
           SELECT 1 FROM media_sources m WHERE m.object_id=o.id AND m.released_at IS NULL
         ) RETURNING o.id`,
        [asset.object_id],
      );
      if (original.rowCount) await queueRemoval(tx, 'original', asset.object_id);
    }
    // Serialize enqueue and dequeue for shared keys even when two copies expire together.
    await lockRemovalKey(tx, 'canonical', asset.storage_key);
    if (asset.storage_name) await lockRemovalKey(tx, 'animation', asset.storage_name);
    await tx.query(
      `UPDATE space_storage_accounts
       SET retained_bytes=retained_bytes-$2::bigint-$3::bigint,retained_assets=retained_assets-1,
           updated_at=clock_timestamp() WHERE space_id=$1`,
      [asset.space_id, asset.bytes, asset.animation_bytes ?? 0],
    );
    await tx.query('UPDATE assets SET purged_at=clock_timestamp() WHERE id=$1', [asset.id]);
    await tx.query('DELETE FROM resource_memories WHERE asset_id=$1', [asset.id]);
    await queueRemoval(tx, 'canonical', asset.storage_key);
    if (asset.storage_name) await queueRemoval(tx, 'animation', asset.storage_name);
    return true;
  });
}

async function removeQueuedBytes(db: Database, storage: LocalPrivateStorage) {
  return transaction(db, async (tx) => {
    const item = (await tx.query(
      `SELECT kind,storage_key FROM photo_storage_cleanup WHERE retry_at<=clock_timestamp()
       ORDER BY retry_at,kind,storage_key LIMIT 1`,
    )).rows[0];
    if (!item) return false;
    const kind = item.kind as StorageKind;
    const key = String(item.storage_key);
    await lockRemovalKey(tx, kind, key);
    const current = await tx.query(
      'SELECT 1 FROM photo_storage_cleanup WHERE kind=$1 AND storage_key=$2 AND retry_at<=clock_timestamp() FOR UPDATE',
      [kind, key],
    );
    if (!current.rowCount) return true;
    const references = kind === 'canonical'
      ? await tx.query('SELECT 1 FROM assets WHERE storage_key=$1 AND purged_at IS NULL LIMIT 1', [key])
      : kind === 'animation'
        ? await tx.query(
            `SELECT 1 FROM animation_assets g JOIN assets a ON a.id=g.asset_id
             WHERE g.storage_name=$1 AND a.purged_at IS NULL LIMIT 1`, [key],
          )
        : await tx.query(
            `SELECT 1 FROM media_objects WHERE id=$1 AND purged_at IS NULL
             UNION ALL SELECT 1 FROM media_sources WHERE object_id=$1 AND released_at IS NULL LIMIT 1`, [key],
          );
    try {
      if (!references.rowCount) await storage.purgePhotoFile(kind, key);
    } catch {
      // Once expiry is committed, filesystem errors must be retried without reopening the item.
      await tx.query(
        "UPDATE photo_storage_cleanup SET retry_at=clock_timestamp()+interval '1 minute' WHERE kind=$1 AND storage_key=$2",
        [kind, key],
      );
      return true;
    }
    await tx.query('DELETE FROM photo_storage_cleanup WHERE kind=$1 AND storage_key=$2', [kind, key]);
    return true;
  });
}

export async function sweepPhotoTrash(db: Database, storage: LocalPrivateStorage) {
  // The database clock is authoritative. These row locks also serialize expiry with restoration.
  await db.query(
    `UPDATE artworks SET purged_at=clock_timestamp()
     WHERE id IN (
       SELECT id FROM artworks WHERE purged_at IS NULL AND ${due}
       ORDER BY deleted_at,trash_token LIMIT 100 FOR UPDATE SKIP LOCKED
     )`,
  );
  for (let index = 0; index < 50 && await finalizeAsset(db); index += 1) { /* bounded batch */ }
  // An unlink must never happen before the corresponding retention transaction commits.
  for (let index = 0; index < 100 && await removeQueuedBytes(db, storage); index += 1) { /* bounded batch */ }
}

export function startPhotoTrashCleanup(app: FastifyInstance, db: Database, storage: LocalPrivateStorage) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | undefined;
  function tick() {
    if (!pending) {
      pending = sweepPhotoTrash(db, storage)
        .catch(() => { process.stderr.write('Photo recycle-bin maintenance will retry.\n'); })
        .finally(() => { pending = undefined; });
    }
  }
  app.addHook('onListen', () => {
    tick();
    timer = setInterval(tick, 30_000);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await pending;
  });
}
