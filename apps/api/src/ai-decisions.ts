import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  aiResultDecisionSchema,
  type AiResultDecision,
  type AiResultDecisionRequest,
} from '@ai-xiutu/contracts';
import {
  createRecipeV4,
  migrateRecipeToV3,
  parseEditorRecipe,
  MAX_V3_IMAGE_LAYERS,
  MAX_V3_PIXELS,
} from '@ai-xiutu/editor';
import { canonical, digest } from '@ai-xiutu/ai';
import { transaction, audit, emit, type Database, type Queryable } from '@ai-xiutu/db';
import {
  id,
  requireUser,
  projectAccess,
  assertVersion,
  HttpError,
  hash,
  lockProjectMutation,
} from './core.js';
import {
  appendArtworkRevision,
  createArtworkBranch,
  requireSourceAsset,
} from './revision-commands.js';

const decisionDto = (row: Record<string, any>): AiResultDecision => ({
  id: row.id,
  jobId: row.job_id,
  projectId: row.project_id,
  actorId: row.actor_id,
  action: row.action,
  outputIndex: row.output_index ?? null,
  targetArtworkId: row.target_artwork_id ?? null,
  revisionId: row.revision_id ?? null,
  documentId: row.document_id ?? null,
  documentVersion: row.document_version ?? null,
  reason: row.reason ?? null,
  contentEdited: row.content_edited ?? false,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
});
const documentDto = (row: Record<string, any>) => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  body: row.body,
  version: row.version,
  authorId: row.author_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
async function imageOutput(tx: Queryable, job: Record<string, any>, index: number) {
  const output = job.output;
  if (output?.kind !== 'image')
    throw new HttpError(400, 'RESULT_KIND_MISMATCH', '此操作需要已完成的图像结果');
  const images: Record<string, any>[] = Array.isArray(output.images) ? output.images : [output];
  const selected = images.find((image, offset) => (image.index ?? offset) === index);
  if (!selected || !id.safeParse(selected.assetId).success)
    throw new HttpError(400, 'RESULT_INDEX_INVALID', '没有对应的生成图片');
  const asset = await requireSourceAsset(tx, job.project_id, selected.assetId);
  if (asset.provenance?.kind !== 'ai-generated' || asset.provenance?.jobId !== job.id)
    throw new HttpError(409, 'RESULT_SOURCE_MISMATCH', '生成结果与素材来源不匹配');
  return asset;
}
async function lockedArtwork(tx: Queryable, projectId: string, artworkId: string, version: number) {
  const artwork = (
    await tx.query('SELECT * FROM artworks WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR UPDATE', [
      artworkId,
      projectId,
    ])
  ).rows[0];
  if (!artwork) throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不存在或不属于当前项目');
  assertVersion(artwork.head_version, version);
  return artwork;
}

export function registerAiDecisions(app: FastifyInstance, db: Database): void {
  app.get('/v1/ai-jobs/:id/decisions', async (req) => {
    const user = requireUser(req);
    const params = z.object({ id }).parse(req.params);
    const job = (await db.query('SELECT project_id FROM ai_jobs WHERE id=$1', [params.id])).rows[0];
    if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', '任务不存在');
    await projectAccess(db, job.project_id, user.id);
    const rows = (
      await db.query(
        'SELECT * FROM ai_result_decisions WHERE job_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
        [params.id],
      )
    ).rows;
    return { decisions: rows.map(decisionDto) };
  });
  app.post('/v1/ai-jobs/:id/decisions', async (req, reply) => {
    const user = requireUser(req);
    const params = z.object({ id }).parse(req.params);
    const body = aiResultDecisionSchema.parse(req.body);
    const requestHash = digest(canonical({ jobId: params.id, body }));
    const result = await transaction(db, async (tx) => {
      const hint = (await tx.query('SELECT project_id FROM ai_jobs WHERE id=$1', [params.id]))
        .rows[0];
      if (!hint) throw new HttpError(404, 'JOB_NOT_FOUND', '任务不存在');
      const project = await lockProjectMutation(
        tx,
        hint.project_id,
        user.id,
        hash(req.cookies.xiutu_session ?? ''),
      );
      const job = (await tx.query('SELECT * FROM ai_jobs WHERE id=$1 FOR SHARE', [params.id]))
        .rows[0];
      if (!job || job.project_id !== project.id)
        throw new HttpError(404, 'JOB_NOT_FOUND', '任务不存在');
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `ai-decision:${user.id}:${body.idempotencyKey}`,
      ]);
      const prior = (
        await tx.query(
          'SELECT * FROM ai_result_decisions WHERE actor_id=$1 AND idempotency_key=$2',
          [user.id, body.idempotencyKey],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '此操作标识已用于其他决定');
        return { decision: decisionDto(prior), ...prior.response, replayed: true };
      }
      if (job.state !== 'completed' || !job.output)
        throw new HttpError(409, 'RESULT_NOT_READY', '任务尚无已审核完成的结果');
      const output = job.output;
      const decisionId = randomUUID();
      let response: Record<string, any> = {};
      let outputIndex: number | null = null;
      let targetArtworkId: string | null = null;
      let revisionId: string | null = null;
      let documentId: string | null = null;
      let documentVersion: number | null = null;
      let contentEdited = false;
      if (body.action === 'reject') {
        if (output.kind === 'image') {
          outputIndex = body.outputIndex ?? 0;
          await imageOutput(tx, job, outputIndex);
        } else if (body.outputIndex !== undefined) {
          throw new HttpError(400, 'RESULT_INDEX_INVALID', '文字或参数建议没有图像序号');
        }
        // A rejected completed result is still a real billable provider outcome.
        // No quota hold, ledger entry, source asset or job state changes here.
      } else if (body.action === 'fork' || body.action === 'replace') {
        let assetId: string;
        let recipe;
        if (output.kind === 'image') {
          outputIndex = body.outputIndex ?? 0;
          const asset = await imageOutput(tx, job, outputIndex);
          assetId = asset.id;
          recipe = createRecipeV4();
        } else if (body.action === 'fork' && output.kind === 'edit-plan') {
          if (body.outputIndex !== undefined)
            throw new HttpError(400, 'RESULT_INDEX_INVALID', '参数建议没有图像序号');
          const source = (
            await tx.query(
              'SELECT s.asset_id FROM revisions r JOIN revision_sources s ON s.revision_id=r.id JOIN artworks a ON a.id=r.artwork_id WHERE r.artwork_id=$1 AND r.version=$2 AND a.project_id=$3 AND a.deleted_at IS NULL FOR SHARE OF a',
              [output.artworkId, output.baseVersion, job.project_id],
            )
          ).rows[0];
          if (!source || output.inputHash !== job.input_hash)
            throw new HttpError(409, 'RESULT_SOURCE_MISMATCH', '建议与来源版本不匹配');
          assetId = source.asset_id;
          recipe = parseEditorRecipe(output.recipe);
        } else throw new HttpError(400, 'RESULT_KIND_MISMATCH', '该结果不能作为图片分支或替换来源');
        if (body.action === 'fork') {
          response = await createArtworkBranch(tx, {
            projectId: project.id,
            actorId: user.id,
            assetId,
            recipe,
            title: body.title ?? 'AI 结果分支',
            label: '明确采纳 AI 结果为新分支',
            origin: { kind: 'ai-fork', operationId: decisionId },
          });
          await emit(tx, project.space_id, project.id, 'artwork.created', response.artwork.id);
        } else {
          const artwork = await lockedArtwork(
            tx,
            project.id,
            body.targetArtworkId,
            body.expectedVersion,
          );
          response = await appendArtworkRevision(tx, {
            artwork,
            actorId: user.id,
            assetId,
            recipe,
            label: '明确采纳 AI 图像替换当前来源',
            origin: { kind: 'ai-replace', operationId: decisionId },
          });
          await emit(tx, project.space_id, project.id, 'artwork.revised', artwork.id);
        }
        targetArtworkId = response.artwork.id;
        revisionId = response.revision.id;
      } else if (body.action === 'layer') {
        outputIndex = body.outputIndex;
        const candidate = await imageOutput(tx, job, outputIndex);
        const artwork = await lockedArtwork(
          tx,
          project.id,
          body.targetArtworkId,
          body.expectedVersion,
        );
        const source = await requireSourceAsset(tx, project.id, artwork.asset_id);
        const head = (
          await tx.query('SELECT recipe FROM revisions WHERE id=$1 AND artwork_id=$2', [
            artwork.head_revision_id,
            artwork.id,
          ])
        ).rows[0];
        if (!head) throw new HttpError(409, 'SOURCE_UNAVAILABLE', '当前作品版本不可用');
        const originalRecipe = parseEditorRecipe(head.recipe);
        const recipe =
          originalRecipe.schemaVersion >= 3 && 'imageLayers' in originalRecipe
            ? originalRecipe
            : migrateRecipeToV3(originalRecipe);
        if (recipe.imageLayers.length >= MAX_V3_IMAGE_LAYERS)
          throw new HttpError(409, 'LAYER_LIMIT', '当前合成图层已达到预算，请先整理图层再采用');
        if (source.width * source.height > MAX_V3_PIXELS)
          throw new HttpError(
            409,
            'LAYER_PIXEL_LIMIT',
            '当前底图超出 v3 合成像素预算，请先明确准备较小副本',
          );
        const referenceIds = [
          ...new Set([
            ...recipe.imageLayers.map((layer) => layer.sourceId),
            candidate.id as string,
          ]),
        ];
        const references = (
          await tx.query(
            'SELECT id,width,height FROM assets WHERE id=ANY($1::uuid[]) AND project_id=$2 AND deleted_at IS NULL ORDER BY id FOR SHARE',
            [referenceIds, project.id],
          )
        ).rows;
        if (references.length !== referenceIds.length)
          throw new HttpError(409, 'SOURCE_UNAVAILABLE', '作品引用的合成素材已不可用');
        if (references.reduce((sum, item) => sum + item.width * item.height, 0) > MAX_V3_PIXELS)
          throw new HttpError(
            409,
            'LAYER_PIXEL_LIMIT',
            '合成素材总像素超出当前渲染预算，请先整理素材',
          );
        const contain = Math.min(source.width / candidate.width, source.height / candidate.height);
        const width = (candidate.width * contain) / source.width;
        const height = (candidate.height * contain) / source.height;
        recipe.imageLayers.push({
          id: randomUUID(),
          sourceId: candidate.id,
          name: `AI 候选图 ${outputIndex + 1}`,
          enabled: true,
          opacity: 1,
          blendMode: 'normal',
          x: (1 - width) / 2,
          y: (1 - height) / 2,
          width,
          height,
          rotationDegrees: 0,
          flipX: false,
          flipY: false,
          mask: null,
          origin: {
            moduleId: 'ai',
            instanceId: job.id,
            parameterId: 'candidate-layer',
            value: 1,
            parameters: { outputIndex },
          },
        });
        response = await appendArtworkRevision(tx, {
          artwork,
          actorId: user.id,
          assetId: source.id,
          recipe: parseEditorRecipe(recipe),
          label: '明确采纳 AI 候选为独立合成图层',
          origin: { kind: 'ai-layer', operationId: decisionId },
        });
        targetArtworkId = artwork.id;
        revisionId = response.revision.id;
        await emit(tx, project.space_id, project.id, 'artwork.revised', artwork.id);
      } else if (body.action === 'apply-plan') {
        if (
          output.kind !== 'edit-plan' ||
          output.artworkId !== body.targetArtworkId ||
          output.baseVersion !== body.expectedVersion ||
          output.inputHash !== job.input_hash
        )
          throw new HttpError(
            409,
            'RESULT_SOURCE_MISMATCH',
            '建议只能应用于其原始作品版本，请先对比或另存分支',
          );
        const artwork = await lockedArtwork(
          tx,
          project.id,
          body.targetArtworkId,
          body.expectedVersion,
        );
        response = await appendArtworkRevision(tx, {
          artwork,
          actorId: user.id,
          assetId: artwork.asset_id,
          recipe: parseEditorRecipe(output.recipe),
          label: '明确采纳 AI 参数建议',
          origin: { kind: 'ai-parameters', operationId: decisionId },
        });
        targetArtworkId = artwork.id;
        revisionId = response.revision.id;
        await emit(tx, project.space_id, project.id, 'artwork.revised', artwork.id);
      } else if (body.action === 'save-text') {
        if (output.kind !== 'text')
          throw new HttpError(400, 'RESULT_KIND_MISMATCH', '此操作需要文本生成结果');
        const content = z
          .object({ title: z.string().trim().min(1).max(120), body: z.string().max(100000) })
          .parse({ title: body.title ?? output.title, body: body.body ?? output.body });
        contentEdited = content.title !== output.title || content.body !== output.body;
        let document: Record<string, any>;
        if (body.targetDocumentId) {
          const current = (
            await tx.query('SELECT * FROM documents WHERE id=$1 AND project_id=$2 FOR UPDATE', [
              body.targetDocumentId,
              project.id,
            ])
          ).rows[0];
          if (!current) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '文档不属于此项目');
          assertVersion(current.version, body.expectedDocumentVersion!);
          document = (
            await tx.query(
              'UPDATE documents SET title=$2,body=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
              [current.id, content.title, content.body],
            )
          ).rows[0]!;
        } else {
          document = (
            await tx.query(
              'INSERT INTO documents(project_id,title,body,author_id) VALUES($1,$2,$3,$4) RETURNING *',
              [project.id, content.title, content.body, user.id],
            )
          ).rows[0]!;
        }
        await tx.query(
          'INSERT INTO document_versions(document_id,version,title,body,author_id) VALUES($1,$2,$3,$4,$5)',
          [document.id, document.version, content.title, content.body, user.id],
        );
        documentId = document.id;
        documentVersion = document.version;
        response = { document: documentDto(document) };
        await emit(
          tx,
          project.space_id,
          project.id,
          body.targetDocumentId ? 'document.updated' : 'document.created',
          document.id,
        );
      }
      const record = (
        await tx.query(
          'INSERT INTO ai_result_decisions(id,job_id,project_id,actor_id,idempotency_key,request_hash,action,output_index,target_artwork_id,revision_id,document_id,document_version,reason,response,content_edited) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',
          [
            decisionId,
            job.id,
            project.id,
            user.id,
            body.idempotencyKey,
            requestHash,
            body.action,
            outputIndex,
            targetArtworkId,
            revisionId,
            documentId,
            documentVersion,
            body.reason ?? null,
            JSON.stringify(response),
            contentEdited,
          ],
        )
      ).rows[0]!;
      await audit(tx, user.id, `ai.result.${body.action}`, 'ai-result-decision', decisionId, {
        jobId: job.id,
        projectId: project.id,
        outputIndex,
        targetArtworkId,
        revisionId,
        documentId,
        documentVersion,
        contentEdited,
      });
      await emit(tx, project.space_id, project.id, 'ai.result-decided', job.id);
      return { decision: decisionDto(record), ...response, replayed: false };
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
}
