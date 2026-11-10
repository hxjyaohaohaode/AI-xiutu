import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, emit, transaction, type Database, type Queryable } from '@ai-xiutu/db';
import { parseEditorRecipe } from '@ai-xiutu/editor';
import {
  collaborationLimits as limits,
  collaborationTargetSchema,
  collaborationHeartbeatSchema,
  collaborationLeaseProofSchema,
  collaborationCommandSchema,
  collaborationPreviewSchema,
  type CollaborationTarget,
  type SourceBounds,
} from '@ai-xiutu/contracts';
import { id, hash, HttpError, requireUser, artworkDto, revisionDto, assetDto } from './core.js';
import { appendArtworkRevision } from './revision-commands.js';
import { validateRecipeReferences } from './recipe-references.js';
import {
  operationTarget,
  targetKey,
  targetBounds,
  targetsConflict,
  applyCollaborationOperation,
  assertRebasable,
} from './collaboration-operations.js';

const prefix = '/v1/artworks/:id/collaboration';
const notifications = new EventEmitter();
notifications.setMaxListeners(500);
const wake = (roomId: string) => notifications.emit(roomId);
const milliseconds = (value: Date | string) => new Date(value).getTime();
const json = (value: unknown) => JSON.stringify(value);
const sequenceCursor = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((s) => BigInt(s) <= 9223372036854775807n, '游标超出范围');
const sessionDto = (row: Record<string, any>) => ({
  id: row.id,
  artworkId: row.artwork_id,
  userId: row.user_id,
  displayName: row.display_name,
  cursor: row.cursor,
  tool: row.tool,
  selection: row.selection,
  sequence: Number(row.sequence),
  expiresAt: row.expires_at,
});
const leaseDto = (row: Record<string, any>) => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  displayName: row.display_name,
  target: row.target,
  fence: String(row.fence),
  expiresAt: row.expires_at,
  bounds: row.bounds,
});
const previewDto = (row: Record<string, any>) => ({
  leaseId: row.lease_id,
  sessionId: row.session_id,
  userId: row.user_id,
  sequence: Number(row.sequence),
  baseVersion: row.base_version,
  operation: row.operation,
  expiresAt: row.expires_at,
});

/** Check active session and current membership for every bounded poll iteration.
 * Lock membership before artwork, so revocation cannot race an accepted command. */
async function access(
  tx: Queryable,
  roomId: string,
  actorId: string,
  authHash: string,
  editing: boolean,
  lock: boolean,
) {
  const room = (
    await tx.query(
      `SELECT a.*,p.space_id,p.deleted_at FROM artworks a JOIN projects p ON p.id=a.project_id
    WHERE a.id=$1 AND p.deleted_at IS NULL`,
      [roomId],
    )
  ).rows[0];
  if (!room) throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不存在或项目已删除');
  const member = (
    await tx.query(
      `SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.space_id=$1 AND m.user_id=$2 AND u.status='active'
    AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=$3 AND s.user_id=$2 AND s.expires_at>clock_timestamp())
    ${lock ? 'FOR SHARE OF m' : ''}`,
      [room.space_id, actorId, authHash],
    )
  ).rows[0];
  if (!member) throw new HttpError(403, 'COLLABORATION_FORBIDDEN', '空间成员权限或登录状态已改变');
  if (editing && !['owner', 'admin', 'editor'].includes(member.role))
    throw new HttpError(403, 'PROJECT_FORBIDDEN', '当前角色不能编辑作品');
  if (lock) {
    const current = (await tx.query('SELECT * FROM artworks WHERE id=$1 FOR UPDATE', [roomId]))
      .rows[0]!;
    return { ...current, space_id: room.space_id, role: member.role };
  }
  return { ...room, role: member.role };
}
async function roomEvent(
  tx: Queryable,
  roomId: string,
  type: string,
  actorId: string | null,
  payload: Record<string, unknown>,
) {
  return String(
    (
      await tx.query('SELECT collaboration_emit($1,$2,$3,$4::jsonb) AS cursor', [
        roomId,
        type,
        actorId,
        json(payload),
      ])
    ).rows[0]!.cursor,
  );
}
async function cleanup(tx: Queryable, roomId: string) {
  const sessions = await tx.query(
    `DELETE FROM collaboration_sessions c WHERE c.artwork_id=$1 AND (
      c.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=c.auth_session_hash AND s.expires_at>clock_timestamp() AND u.status='active')) RETURNING id`,
    [roomId],
  );
  const leases = await tx.query(
    'DELETE FROM collaboration_leases WHERE artwork_id=$1 AND expires_at<=clock_timestamp() RETURNING id',
    [roomId],
  );
  const previews = await tx.query(
    `DELETE FROM collaboration_previews p USING collaboration_leases l
    WHERE p.lease_id=l.id AND l.artwork_id=$1 AND p.expires_at<=clock_timestamp() RETURNING p.lease_id`,
    [roomId],
  );
  if (sessions.rowCount || leases.rowCount || previews.rowCount)
    await roomEvent(tx, roomId, 'presence.changed', null, {
      reason: 'expired',
      sessions: sessions.rowCount,
      leases: leases.rowCount,
      previews: previews.rowCount,
    });
}
async function requireSession(
  tx: Queryable,
  roomId: string,
  sessionId: string,
  actorId: string,
  authHash: string,
) {
  const row = (
    await tx.query(
      `SELECT c.*,u.display_name FROM collaboration_sessions c JOIN users u ON u.id=c.user_id
    WHERE c.id=$1 AND c.artwork_id=$2 AND c.user_id=$3 AND c.auth_session_hash=$4 AND c.expires_at>clock_timestamp()`,
      [sessionId, roomId, actorId, authHash],
    )
  ).rows[0];
  if (!row) throw new HttpError(409, 'SESSION_EXPIRED', '协作会话已失效，请重新加入并恢复本地草稿');
  return row;
}
async function activeLeases(tx: Queryable, roomId: string) {
  return (
    await tx.query(
      `SELECT l.*,s.user_id,u.display_name FROM collaboration_leases l JOIN collaboration_sessions s ON s.id=l.session_id
    JOIN users u ON u.id=s.user_id WHERE l.artwork_id=$1 AND l.expires_at>clock_timestamp() AND s.expires_at>clock_timestamp()
    ORDER BY l.fence`,
      [roomId],
    )
  ).rows;
}
function assertNoConflict(
  active: Record<string, any>[],
  target: CollaborationTarget,
  bounds: SourceBounds | null,
  skipId?: string,
) {
  const blocked = active.filter(
    (l) => l.id !== skipId && targetsConflict(target, bounds, l.target, l.bounds),
  );
  if (blocked.length)
    throw new HttpError(409, 'LEASE_CONFLICT', '此工具或源图范围正在由其他编辑操作使用', {
      leases: blocked.map(leaseDto),
    });
}
async function currentRecipe(tx: Queryable, room: Record<string, any>) {
  const revision = (
    await tx.query(
      'SELECT r.*,rs.asset_id FROM revisions r JOIN revision_sources rs ON rs.revision_id=r.id WHERE r.id=$1',
      [room.head_revision_id],
    )
  ).rows[0];
  const asset = (
    await tx.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL', [room.asset_id])
  ).rows[0];
  if (!revision || !asset)
    throw new HttpError(409, 'SOURCE_UNAVAILABLE', '当前作品的原图或版本不可用');
  return { revision, asset, recipe: parseEditorRecipe(revision.recipe) };
}
async function requireLease(
  tx: Queryable,
  roomId: string,
  actorId: string,
  authHash: string,
  proof: { sessionId: string; leaseId: string; fence: string },
) {
  await requireSession(tx, roomId, proof.sessionId, actorId, authHash);
  const leases = await activeLeases(tx, roomId);
  const lease = leases.find(
    (item) =>
      item.id === proof.leaseId &&
      item.session_id === proof.sessionId &&
      String(item.fence) === proof.fence,
  );
  if (!lease) throw new HttpError(409, 'LEASE_EXPIRED', '编辑租约已失效，请刷新后重新取得编辑权');
  return { lease, leases };
}
async function proveOperation(
  tx: Queryable,
  room: Record<string, any>,
  body: z.infer<typeof collaborationPreviewSchema> | z.infer<typeof collaborationCommandSchema>,
  actorId: string,
  authHash: string,
) {
  const { lease, leases } = await requireLease(tx, room.id, actorId, authHash, body);
  const target = operationTarget(body.operation);
  if (lease.target.kind !== 'document' && targetKey(lease.target) !== targetKey(target))
    throw new HttpError(409, 'LEASE_SCOPE_MISMATCH', '提交内容超出了租约授予的编辑对象');
  const { recipe, asset } = await currentRecipe(tx, room);
  if (body.baseVersion !== room.head_version) {
    const base = (
      await tx.query(
        `SELECT r.recipe,rs.asset_id FROM revisions r JOIN revision_sources rs ON rs.revision_id=r.id
      WHERE r.artwork_id=$1 AND r.version=$2`,
        [room.id, body.baseVersion],
      )
    ).rows[0];
    if (!base || base.asset_id !== room.asset_id)
      throw new HttpError(409, 'VERSION_CONFLICT', '底图或版本已变化，请重新查看作品');
    assertRebasable(parseEditorRecipe(base.recipe), recipe, body.operation);
  }
  const candidate = applyCollaborationOperation(recipe, body.operation);
  await validateRecipeReferences(tx, room.project_id, candidate);
  const bounds = targetBounds(candidate, lease.target, asset.width, asset.height);
  // Moving/expanding a local mask cannot escape the acquired support into someone else's lease.
  assertNoConflict(leases, lease.target, bounds, lease.id);
  await tx.query('UPDATE collaboration_leases SET bounds=$2::jsonb WHERE id=$1', [
    lease.id,
    bounds ? json(bounds) : null,
  ]);
  return { candidate, lease, asset, rebased: body.baseVersion !== room.head_version };
}

async function snapshot(
  db: Database,
  roomId: string,
  actorId: string,
  authHash: string,
  after: string,
  knownVersion?: number,
) {
  return transaction(db, async (tx) => {
    const room = await access(tx, roomId, actorId, authHash, false, true);
    await cleanup(tx, roomId);
    const currentCursor = String(
      (await tx.query('SELECT collaboration_cursor FROM artworks WHERE id=$1', [roomId])).rows[0]!
        .collaboration_cursor,
    );
    const minCursor = (
      await tx.query(
        'SELECT min(seq)::text AS value FROM collaboration_events WHERE artwork_id=$1',
        [roomId],
      )
    ).rows[0]!.value;
    const resetRequired =
      BigInt(after) > BigInt(currentCursor) ||
      (minCursor !== null && BigInt(after) < BigInt(minCursor) - 1n);
    const events = (
      await tx.query(
        `SELECT seq::text AS cursor,type,actor_id AS "actorId",payload,created_at AS "createdAt"
      FROM collaboration_events WHERE artwork_id=$1 AND seq>$2 ORDER BY seq LIMIT $3`,
        [roomId, resetRequired ? currentCursor : after, limits.eventPageSize + 1],
      )
    ).rows;
    const page = events.slice(0, limits.eventPageSize);
    const includeRecipe = resetRequired || knownVersion !== room.head_version;
    const revision = includeRecipe
      ? (
          await tx.query(
            'SELECT r.*,rs.asset_id FROM revisions r JOIN revision_sources rs ON rs.revision_id=r.id WHERE r.id=$1',
            [room.head_revision_id],
          )
        ).rows[0]
      : null;
    const asset = (
      await tx.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL', [room.asset_id])
    ).rows[0];
    if ((includeRecipe && !revision) || !asset)
      throw new HttpError(409, 'SOURCE_UNAVAILABLE', '当前作品的原图或版本不可用');
    const presences = (
      await tx.query(
        `SELECT c.*,u.display_name FROM collaboration_sessions c JOIN users u ON u.id=c.user_id
      WHERE c.artwork_id=$1 AND c.expires_at>clock_timestamp() ORDER BY c.created_at`,
        [roomId],
      )
    ).rows.map(sessionDto);
    const leases = (await activeLeases(tx, roomId)).map(leaseDto);
    const previews = (
      await tx.query(
        `SELECT p.*,l.session_id,c.user_id FROM collaboration_previews p
      JOIN collaboration_leases l ON l.id=p.lease_id JOIN collaboration_sessions c ON c.id=l.session_id
      WHERE l.artwork_id=$1 AND p.expires_at>clock_timestamp() AND l.expires_at>clock_timestamp() AND c.expires_at>clock_timestamp()`,
        [roomId],
      )
    ).rows.map(previewDto);
    return {
      protocolVersion: 1 as const,
      cursor: events.length > limits.eventPageSize ? String(page.at(-1)!.cursor) : currentCursor,
      resetRequired,
      hasMore: events.length > limits.eventPageSize,
      events: page,
      snapshot: {
        artwork: artworkDto(room),
        revision: revision ? revisionDto(revision) : null,
        asset: assetDto(asset),
        presences,
        leases,
        previews,
        limits,
        serverTime: new Date().toISOString(),
      },
    };
  });
}
function waitForRoom(roomId: string, signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      notifications.off(roomId, done);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    notifications.once(roomId, done);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}

export function registerRealtimeCollaboration(app: FastifyInstance, db: Database): void {
  const pollsByUser = new Map<string, number>();
  let activePolls = 0;
  app.get(prefix, async (req, reply) => {
    const actor = requireUser(req),
      roomId = z.object({ id }).parse(req.params).id;
    const query = z
      .object({
        after: sequenceCursor.default('0'),
        knownVersion: z.coerce.number().int().positive().optional(),
        waitMs: z.coerce.number().int().min(0).max(limits.maxWaitMs).default(0),
      })
      .strict()
      .parse(req.query);
    const authHash = hash(req.cookies.xiutu_session!);
    const actorPolls = pollsByUser.get(actor.id) ?? 0;
    if (actorPolls >= limits.maxPollsPerUser || activePolls >= limits.maxPollsPerInstance)
      throw new HttpError(
        429,
        'COLLABORATION_POLL_LIMIT',
        '协作订阅过多，请关闭不用的窗口并稍后重连',
        { retryAfterMs: 1000 },
      );
    pollsByUser.set(actor.id, actorPolls + 1);
    activePolls++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    req.raw.once('aborted', abort);
    try {
      const until = Date.now() + query.waitMs;
      do {
        const response = await snapshot(
          db,
          roomId,
          actor.id,
          authHash,
          query.after,
          query.knownVersion,
        );
        if (
          response.resetRequired ||
          response.events.length ||
          Date.now() >= until ||
          controller.signal.aborted
        )
          return response;
        // Local mutations wake immediately. Other processes (including worker/old save) are
        // observed within this bounded interval; no required dedicated LISTEN connection.
        await waitForRoom(
          roomId,
          controller.signal,
          Math.min(limits.pollIntervalMs, until - Date.now()),
        );
      } while (!controller.signal.aborted);
      throw new HttpError(499, 'CLIENT_CLOSED', '连接已取消');
    } finally {
      reply.raw.off('close', abort);
      req.raw.off('aborted', abort);
      activePolls--;
      const remaining = (pollsByUser.get(actor.id) ?? 1) - 1;
      if (remaining) pollsByUser.set(actor.id, remaining);
      else pollsByUser.delete(actor.id);
    }
  });

  app.post(`${prefix}/sessions`, async (req, reply) => {
    const actor = requireUser(req),
      roomId = z.object({ id }).parse(req.params).id;
    const body = z.object({ clientId: id }).strict().parse(req.body),
      authHash = hash(req.cookies.xiutu_session!);
    const session = await transaction(db, async (tx) => {
      await access(tx, roomId, actor.id, authHash, false, true);
      await cleanup(tx, roomId);
      const prior = (
        await tx.query(
          'SELECT id FROM collaboration_sessions WHERE artwork_id=$1 AND user_id=$2 AND client_id=$3',
          [roomId, actor.id, body.clientId],
        )
      ).rows[0];
      const count = (
        await tx.query(
          'SELECT count(*) AS total,count(*) FILTER (WHERE user_id=$2) AS own FROM collaboration_sessions WHERE artwork_id=$1',
          [roomId, actor.id],
        )
      ).rows[0]!;
      if (
        !prior &&
        (Number(count.total) >= limits.maxSessionsPerArtwork ||
          Number(count.own) >= limits.maxSessionsPerUser)
      )
        throw new HttpError(429, 'ROOM_FULL', '此作品的协作会话数量已达上限，请关闭不用的窗口');
      const row = (
        await tx.query(
          `INSERT INTO collaboration_sessions(artwork_id,user_id,client_id,auth_session_hash,expires_at)
        VALUES($1,$2,$3,$4,clock_timestamp()+interval '60 seconds') ON CONFLICT(artwork_id,user_id,client_id)
        DO UPDATE SET auth_session_hash=$4,expires_at=clock_timestamp()+interval '60 seconds' RETURNING *`,
          [roomId, actor.id, body.clientId, authHash],
        )
      ).rows[0]!;
      await roomEvent(tx, roomId, 'presence.changed', actor.id, {
        sessionId: row.id,
        reason: 'joined',
      });
      return sessionDto({ ...row, display_name: actor.display_name });
    });
    wake(roomId);
    return reply
      .code(201)
      .send({ session, ...(await snapshot(db, roomId, actor.id, authHash, '0')) });
  });
  app.patch(`${prefix}/sessions/:sessionId`, async (req) => {
    const actor = requireUser(req),
      params = z.object({ id, sessionId: id }).parse(req.params);
    const body = collaborationHeartbeatSchema.parse(req.body),
      authHash = hash(req.cookies.xiutu_session!);
    const result = await transaction(db, async (tx) => {
      await access(tx, params.id, actor.id, authHash, false, true);
      const current = await requireSession(tx, params.id, params.sessionId, actor.id, authHash);
      if (body.sequence <= Number(current.sequence))
        return { session: sessionDto(current), accepted: false, reason: 'STALE_SEQUENCE' };
      if (Date.now() - milliseconds(current.last_presence_at) < limits.presenceMinimumIntervalMs)
        return {
          session: sessionDto(current),
          accepted: false,
          reason: 'THROTTLED',
          retryAfterMs: limits.presenceMinimumIntervalMs,
        };
      const row = (
        await tx.query(
          `UPDATE collaboration_sessions SET sequence=$2,cursor=$3::jsonb,tool=$4,selection=$5::jsonb,
        expires_at=clock_timestamp()+interval '60 seconds',last_presence_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [
            params.sessionId,
            body.sequence,
            json(body.cursor === undefined ? current.cursor : body.cursor),
            body.tool === undefined ? current.tool : body.tool,
            json(body.selection === undefined ? current.selection : body.selection),
          ],
        )
      ).rows[0]!;
      await roomEvent(tx, params.id, 'presence.changed', actor.id, {
        sessionId: row.id,
        reason: 'heartbeat',
      });
      return { session: sessionDto({ ...row, display_name: actor.display_name }), accepted: true };
    });
    wake(params.id);
    return result;
  });
  app.delete(`${prefix}/sessions/:sessionId`, async (req) => {
    const actor = requireUser(req),
      params = z.object({ id, sessionId: id }).parse(req.params),
      authHash = hash(req.cookies.xiutu_session!);
    await transaction(db, async (tx) => {
      await access(tx, params.id, actor.id, authHash, false, true);
      const removed = await tx.query(
        'DELETE FROM collaboration_sessions WHERE id=$1 AND artwork_id=$2 AND user_id=$3 AND auth_session_hash=$4 RETURNING id',
        [params.sessionId, params.id, actor.id, authHash],
      );
      if (removed.rowCount)
        await roomEvent(tx, params.id, 'presence.changed', actor.id, {
          sessionId: params.sessionId,
          reason: 'left',
        });
    });
    wake(params.id);
    return { ok: true };
  });
  app.post(`${prefix}/leases`, async (req, reply) => {
    const actor = requireUser(req),
      roomId = z.object({ id }).parse(req.params).id,
      authHash = hash(req.cookies.xiutu_session!);
    const body = z
      .object({ sessionId: id, target: collaborationTargetSchema })
      .strict()
      .parse(req.body);
    const result = await transaction(db, async (tx) => {
      const room = await access(tx, roomId, actor.id, authHash, true, true);
      await cleanup(tx, roomId);
      await requireSession(tx, roomId, body.sessionId, actor.id, authHash);
      const { recipe, asset } = await currentRecipe(tx, room);
      const bounds = targetBounds(recipe, body.target, asset.width, asset.height);
      const active = await activeLeases(tx, roomId);
      const existing = active.find(
        (l) => l.session_id === body.sessionId && targetKey(l.target) === targetKey(body.target),
      );
      if (existing) return { lease: leaseDto(existing), replayed: true };
      if (
        active.length >= 24 ||
        active.filter((l) => l.session_id === body.sessionId).length >= limits.maxLeasesPerSession
      )
        throw new HttpError(429, 'LEASE_LIMIT', '编辑租约已达上限，请先完成或取消当前操作');
      assertNoConflict(active, body.target, bounds);
      const row = (
        await tx.query(
          `INSERT INTO collaboration_leases(artwork_id,session_id,target,bounds,expires_at)
        VALUES($1,$2,$3::jsonb,$4::jsonb,clock_timestamp()+interval '30 seconds') RETURNING *`,
          [roomId, body.sessionId, json(body.target), bounds ? json(bounds) : null],
        )
      ).rows[0]!;
      await roomEvent(tx, roomId, 'lease.changed', actor.id, {
        leaseId: row.id,
        reason: 'acquired',
      });
      return {
        lease: leaseDto({ ...row, user_id: actor.id, display_name: actor.display_name }),
        replayed: false,
      };
    });
    wake(roomId);
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
  for (const method of ['PATCH', 'DELETE'] as const)
    app.route({
      method,
      url: `${prefix}/leases/:leaseId`,
      handler: async (req) => {
        const actor = requireUser(req),
          params = z.object({ id, leaseId: id }).parse(req.params),
          authHash = hash(req.cookies.xiutu_session!);
        const proof = collaborationLeaseProofSchema.parse(req.body);
        const result = await transaction(db, async (tx) => {
          await access(tx, params.id, actor.id, authHash, true, true);
          if (method === 'DELETE') {
            await requireSession(tx, params.id, proof.sessionId, actor.id, authHash);
            const exists = (
              await tx.query('SELECT id FROM collaboration_leases WHERE id=$1', [params.leaseId])
            ).rowCount;
            if (!exists) return { ok: true, replayed: true };
          }
          const { lease } = await requireLease(tx, params.id, actor.id, authHash, {
            ...proof,
            leaseId: params.leaseId,
          });
          if (method === 'DELETE')
            await tx.query('DELETE FROM collaboration_leases WHERE id=$1', [lease.id]);
          else {
            const updated = (
              await tx.query(
                "UPDATE collaboration_leases SET expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1 RETURNING expires_at",
                [lease.id],
              )
            ).rows[0]!;
            lease.expires_at = updated.expires_at;
            await tx.query(
              'UPDATE collaboration_previews SET expires_at=$2 WHERE lease_id=$1 AND expires_at>clock_timestamp()',
              [lease.id, lease.expires_at],
            );
          }
          await roomEvent(tx, params.id, 'lease.changed', actor.id, {
            leaseId: lease.id,
            reason: method === 'DELETE' ? 'released' : 'renewed',
          });
          return method === 'DELETE' ? { ok: true } : { lease: leaseDto(lease) };
        });
        wake(params.id);
        return result;
      },
    });
  app.post(`${prefix}/previews`, async (req) => {
    const actor = requireUser(req),
      roomId = z.object({ id }).parse(req.params).id,
      authHash = hash(req.cookies.xiutu_session!);
    const body = collaborationPreviewSchema.parse(req.body);
    if (Buffer.byteLength(json(body.operation)) > limits.maxPreviewBytes)
      throw new HttpError(
        413,
        'PREVIEW_TOO_LARGE',
        '临时预览过大，请减少笔画批次；完整保存使用提交接口',
      );
    const result = await transaction(db, async (tx) => {
      const room = await access(tx, roomId, actor.id, authHash, true, true);
      await requireLease(tx, roomId, actor.id, authHash, body);
      const previous = (
        await tx.query('SELECT * FROM collaboration_previews WHERE lease_id=$1', [body.leaseId])
      ).rows[0];
      if (previous && body.sequence <= Number(previous.sequence))
        return { accepted: false, reason: 'STALE_SEQUENCE' };
      if (
        previous &&
        Date.now() - milliseconds(previous.updated_at) < limits.previewMinimumIntervalMs
      )
        return {
          accepted: false,
          reason: 'THROTTLED',
          retryAfterMs: limits.previewMinimumIntervalMs,
        };
      await proveOperation(tx, room, body, actor.id, authHash);
      const total = Number(
        (
          await tx.query(
            `SELECT COALESCE(sum(octet_length(p.operation::text)),0) AS bytes FROM collaboration_previews p
        JOIN collaboration_leases l ON l.id=p.lease_id WHERE l.artwork_id=$1 AND p.lease_id<>$2`,
            [roomId, body.leaseId],
          )
        ).rows[0]!.bytes,
      );
      if (total + Buffer.byteLength(json(body.operation)) > 524_288)
        throw new HttpError(
          429,
          'PREVIEW_BUDGET',
          '当前作品的临时预览预算已满，请先提交或取消其他操作',
        );
      await tx.query(
        `INSERT INTO collaboration_previews(lease_id,sequence,base_version,operation,expires_at)
        SELECT id,$2,$3,$4::jsonb,expires_at FROM collaboration_leases WHERE id=$1
        ON CONFLICT(lease_id) DO UPDATE SET sequence=$2,base_version=$3,operation=$4::jsonb,expires_at=EXCLUDED.expires_at,updated_at=clock_timestamp()`,
        [body.leaseId, body.sequence, body.baseVersion, json(body.operation)],
      );
      const cursor = await roomEvent(tx, roomId, 'preview.changed', actor.id, {
        leaseId: body.leaseId,
        sequence: body.sequence,
      });
      return { accepted: true, cursor };
    });
    wake(roomId);
    return result;
  });
  app.delete(`${prefix}/previews`, async (req) => {
    const actor = requireUser(req),
      roomId = z.object({ id }).parse(req.params).id,
      authHash = hash(req.cookies.xiutu_session!);
    const proof = collaborationLeaseProofSchema.extend({ leaseId: id }).parse(req.body);
    await transaction(db, async (tx) => {
      await access(tx, roomId, actor.id, authHash, true, true);
      await requireLease(tx, roomId, actor.id, authHash, proof);
      const removed = await tx.query(
        'DELETE FROM collaboration_previews WHERE lease_id=$1 RETURNING lease_id',
        [proof.leaseId],
      );
      if (removed.rowCount)
        await roomEvent(tx, roomId, 'preview.changed', actor.id, {
          leaseId: proof.leaseId,
          reason: 'cancelled',
        });
    });
    wake(roomId);
    return { ok: true };
  });
  app.post(`${prefix}/commands`, async (req, reply) => {
    const actor = requireUser(req),
      roomId = z.object({ id }).parse(req.params).id,
      authHash = hash(req.cookies.xiutu_session!);
    const body = collaborationCommandSchema.parse(req.body),
      requestHash = hash(json({ roomId, body }));
    const result = await transaction(db, async (tx) => {
      const room = await access(tx, roomId, actor.id, authHash, true, true);
      // This global actor/key lock also prevents the same key racing across two artworks.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `collaboration-command:${actor.id}:${body.idempotencyKey}`,
      ]);
      const prior = (
        await tx.query(
          'SELECT * FROM collaboration_commands WHERE actor_id=$1 AND idempotency_key=$2',
          [actor.id, body.idempotencyKey],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '此提交键已用于另一项编辑');
        return { ...prior.response, replayed: true };
      }
      const { candidate, rebased } = await proveOperation(tx, room, body, actor.id, authHash);
      await tx.query(
        `SELECT set_config('ai_xiutu.collaboration_session',$1,true),set_config('ai_xiutu.collaboration_lease',$2,true),
        set_config('ai_xiutu.collaboration_fence',$3,true)`,
        [body.sessionId, body.leaseId, body.fence],
      );
      const saved = await appendArtworkRevision(tx, {
        artwork: room,
        actorId: actor.id,
        recipe: candidate,
        assetId: room.asset_id,
        label: `协作 · ${body.operation.type}`,
      });
      await tx.query('DELETE FROM collaboration_previews WHERE lease_id=$1', [body.leaseId]);
      const cursor = String(
        (await tx.query('SELECT collaboration_cursor FROM artworks WHERE id=$1', [roomId])).rows[0]!
          .collaboration_cursor,
      );
      const response = { ...saved, cursor, rebased, replayed: false };
      await tx.query(
        'INSERT INTO collaboration_commands(actor_id,idempotency_key,artwork_id,request_hash,response) VALUES($1,$2,$3,$4,$5::jsonb)',
        [actor.id, body.idempotencyKey, roomId, requestHash, json(response)],
      );
      await audit(tx, actor.id, 'collaboration.commit', 'artwork', roomId, {
        commandId: body.idempotencyKey,
        baseVersion: body.baseVersion,
        version: saved.revision.version,
        target: operationTarget(body.operation),
        rebased,
      });
      await emit(tx, room.space_id, room.project_id, 'artwork.updated', roomId);
      return response;
    });
    wake(roomId);
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
}
