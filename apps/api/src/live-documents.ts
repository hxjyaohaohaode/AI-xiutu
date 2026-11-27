import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emit, transaction, type Database, type Queryable } from '@ai-xiutu/db';
import {
  applyDocumentSteps,
  liveMaxSteps,
  liveWindow,
  type SerializedStep,
} from '@ai-xiutu/contracts/rich-document';
import { assertVersion, hash, HttpError, id, lockProjectMutation, requireUser } from './core.js';
import { documentDto, isOfficeProse, validateDocumentContent } from './document-content.js';

const sequence = z.number().int().min(0).max(2147483647);
const cursor = z
  .object({
    epoch: z.coerce.number().int().positive().max(2147483647).optional(),
    after: z.coerce.number().int().min(0).max(2147483647).optional(),
  })
  .strict()
  .refine((value) => (value.epoch === undefined) === (value.after === undefined));
const mutation = z
  .object({
    epoch: sequence.positive(),
    version: sequence,
    expectedVersion: sequence.positive(),
    clientId: id,
    mutationId: id,
    steps: z.array(z.record(z.string(), z.unknown())).min(1).max(liveMaxSteps),
  })
  .strict();
const route = '/v1/documents/:id/live';

const missing = () => new HttpError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
const stale = () =>
  new HttpError(409, 'DOCUMENT_SYNC_REQUIRED', '共编版本已更新，请先读取最新操作');
async function scope(
  tx: Queryable,
  documentId: string,
  userId: string,
  token: string,
  write: boolean,
) {
  const hint = (await tx.query('SELECT project_id FROM documents WHERE id=$1', [documentId]))
    .rows[0];
  if (!hint) throw missing();
  const project = await lockProjectMutation(tx, hint.project_id, userId, token);
  const doc = (
    await tx.query(
      `SELECT * FROM documents WHERE id=$1 AND project_id=$2
    FOR ${write ? 'UPDATE' : 'SHARE'}`,
      [documentId, project.id],
    )
  ).rows[0];
  if (!doc) throw missing();
  if (!isOfficeProse(doc.body))
    throw new HttpError(409, 'LIVE_DOCUMENT_TYPE', '该文件类型请通过对应的编辑器保存');
  const head = (
    await tx.query(
      'SELECT epoch,step_version FROM document_live_heads WHERE document_id=$1 AND document_version=$2',
      [doc.id, doc.version],
    )
  ).rows[0];
  return {
    project,
    doc,
    epoch: Number(head?.epoch ?? doc.version),
    version: Number(head?.step_version ?? 0),
  };
}

export function registerLiveDocuments(app: FastifyInstance, db: Database) {
  app.get(route, async (req, reply) => {
    const actor = requireUser(req),
      { id: documentId } = z.object({ id }).parse(req.params);
    const from = cursor.parse(req.query);
    reply.header('Cache-Control', 'private, no-store');
    return transaction(db, async (tx) => {
      const { doc, epoch, version } = await scope(
        tx,
        documentId,
        actor.id,
        hash(req.cookies.xiutu_session ?? ''),
        false,
      );
      const snapshot = { kind: 'snapshot', document: documentDto(doc), epoch, version } as const;
      if (
        from.epoch !== epoch ||
        from.after === undefined ||
        from.after > version ||
        version - from.after > liveWindow
      )
        return snapshot;
      let delivered = from.after;
      let remainingBytes = 384 * 1024;
      const steps: SerializedStep[] = [],
        clients: string[] = [];
      if (delivered < version) {
        const batches = (
          await tx.query(
            `SELECT step_from,step_to,actor_id,client_id,steps,octet_length(steps::text) AS bytes
             FROM document_live_batches
            WHERE document_id=$1 AND epoch=$2 AND step_to>$3
            ORDER BY step_from LIMIT 32`,
            [documentId, epoch, delivered],
          )
        ).rows;
        for (const batch of batches) {
          if (
            batch.step_from > delivered ||
            !Array.isArray(batch.steps) ||
            batch.steps.length !== batch.step_to - batch.step_from
          )
            return snapshot;
          if (steps.length && (remainingBytes < batch.bytes || steps.length >= 96)) break;
          const updates = batch.steps.slice(delivered - batch.step_from);
          steps.push(...updates);
          clients.push(...updates.map(() => batch.actor_id + '/' + batch.client_id));
          remainingBytes -= batch.bytes;
          delivered = batch.step_to;
        }
        if (delivered === from.after) return snapshot;
      }
      return {
        kind: 'steps',
        epoch,
        version: delivered,
        documentVersion: doc.version,
        updatedAt: doc.updated_at,
        steps,
        clients,
        more: delivered < version,
      } as const;
    });
  });
  app.post(route, { bodyLimit: 512 * 1024 }, async (req, reply) => {
    const actor = requireUser(req),
      { id: documentId } = z.object({ id }).parse(req.params);
    const changed = mutation.parse(req.body);
    const fingerprint = hash(
      JSON.stringify([changed.epoch, changed.version, changed.expectedVersion, changed.steps]),
    );
    reply.header('Cache-Control', 'private, no-store');
    return transaction(db, async (tx) => {
      const { project, doc, epoch, version } = await scope(
        tx,
        documentId,
        actor.id,
        hash(req.cookies.xiutu_session ?? ''),
        true,
      );
      if (changed.epoch !== epoch) throw stale();
      const previous = (
        await tx.query(
          `SELECT request_hash,step_to FROM document_live_batches
        WHERE document_id=$1 AND epoch=$2 AND actor_id=$3 AND client_id=$4 AND mutation_id=$5`,
          [documentId, epoch, actor.id, changed.clientId, changed.mutationId],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== fingerprint)
          throw new HttpError(409, 'DOCUMENT_MUTATION_REUSED', '此操作编号已对应其他内容');
        return { epoch, acceptedThrough: previous.step_to };
      }
      if (changed.version !== version) throw stale();
      assertVersion(doc.version, changed.expectedVersion);
      const next = sequence.safeParse(version + changed.steps.length);
      if (!next.success)
        throw new HttpError(409, 'DOCUMENT_SYNC_LIMIT', '此共编记录已达到版本上限');
      let content;
      try {
        content = applyDocumentSteps(doc.body, doc.formatting ?? null, changed.steps);
      } catch {
        throw new HttpError(400, 'DOCUMENT_STEP_INVALID', '操作超出文档范围或排版不受支持');
      }
      if (!isOfficeProse(content.body))
        throw new HttpError(400, 'DOCUMENT_FILE_TYPE_CHANGED', '共编过程中不能改变文件类型');
      await validateDocumentContent(tx, project.id, content.body);
      const updated = (
        await tx.query(
          `UPDATE documents SET body=$2,formatting=$3,version=version+1,updated_at=clock_timestamp()
        WHERE id=$1 RETURNING version`,
          [documentId, content.body, content.formatting],
        )
      ).rows[0]!;
      await tx.query(
        `INSERT INTO document_versions(document_id,version,title,body,author_id,formatting)
        VALUES($1,$2,$3,$4,$5,$6)`,
        [documentId, updated.version, doc.title, content.body, actor.id, content.formatting],
      );
      await tx.query(
        `INSERT INTO document_live_heads(document_id,epoch,document_version,step_version) VALUES($1,$2,$3,$4)
        ON CONFLICT(document_id) DO UPDATE SET epoch=excluded.epoch,document_version=excluded.document_version,
        step_version=excluded.step_version`,
        [documentId, epoch, updated.version, next.data],
      );
      await tx.query(
        `INSERT INTO document_live_batches(document_id,epoch,step_from,step_to,actor_id,client_id,mutation_id,request_hash,steps)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          documentId,
          epoch,
          version,
          next.data,
          actor.id,
          changed.clientId,
          changed.mutationId,
          fingerprint,
          JSON.stringify(changed.steps),
        ],
      );
      await tx.query(
        `DELETE FROM document_live_batches WHERE document_id=$1 AND
        (epoch<>$2 OR step_to<=$3)`,
        [documentId, epoch, next.data - liveWindow],
      );
      await emit(tx, project.space_id, project.id, 'document.updated', documentId);
      return { epoch, acceptedThrough: next.data };
    });
  });
}
