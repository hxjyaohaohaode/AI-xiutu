import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, audit, emit, type Database } from '@ai-xiutu/db';
import { assetSources } from '@ai-xiutu/contracts';
import {
  id,
  hash,
  requireUser,
  projectAccess,
  spaceRole,
  assetDto,
  assetSourceSql,
  assertVersion,
  HttpError,
} from './core.js';

const timestamp = z.string().max(40).datetime({ offset: true });
const cleanLabel = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]+$/, '不允许控制字符');
const annotationsPatch = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: cleanLabel(200).nullable().optional(),
    tags: z
      .array(cleanLabel(40))
      .max(20)
      .refine((tags) => new Set(tags).size === tags.length, '标签不能重复')
      .optional(),
    capturedAt: timestamp.nullable().optional(),
    location: z
      .object({ label: cleanLabel(200) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'expectedVersion'),
    '至少填写一个更改字段',
  );
const filters = z
  .object({
    spaceId: id.optional(),
    query: z
      .string()
      .trim()
      .max(120)
      .regex(/^[^\u0000-\u001f\u007f]*$/)
      .optional(),
    source: z.enum(assetSources).optional(),
    mime: z.string().max(80).regex(/^image\/[a-z0-9.+-]+$/).optional(),
    groupBy: z.enum(['date', 'project', 'source', 'type']).optional(),
    timeZone: z.string().max(80).refine((zone) => {
      try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; }
      catch { return false; }
    }, '无效的时区').default('UTC'),
    createdFrom: timestamp.optional(),
    createdTo: timestamp.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.createdFrom ||
      !value.createdTo ||
      Date.parse(value.createdFrom) < Date.parse(value.createdTo),
    '开始时间应早于结束时间',
  );
const cursorSchema = z
  .object({ at: timestamp, id, scope: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

export function registerAssetAnnotations(app: FastifyInstance, db: Database): void {
  app.patch('/v1/assets/:id/annotations', async (req) => {
    const actor = requireUser(req);
    const params = z.object({ id }).parse(req.params);
    const body = annotationsPatch.parse(req.body);
    const asset = await transaction(db, async (tx) => {
      const old = (
        await tx.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [
          params.id,
        ])
      ).rows[0];
      if (!old) throw new HttpError(404, 'ASSET_NOT_FOUND', '素材不存在');
      const project = await projectAccess(tx, old.project_id, actor.id, 'edit');
      assertVersion(old.annotation_version, body.expectedVersion);
      const { expectedVersion: _version, ...patch } = body;
      const annotations = { ...old.annotations, ...patch };
      const updated = (
        await tx.query(
          'UPDATE assets SET annotations=$2,annotation_version=annotation_version+1,annotation_updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [params.id, JSON.stringify(annotations)],
        )
      ).rows[0]!;
      // Operator-visible audit carries field names/version, not private labels or location values.
      await audit(tx, actor.id, 'asset.annotations', 'asset', params.id, {
        changedFields: Object.keys(patch),
        version: updated.annotation_version,
      });
      await emit(tx, project.space_id, project.id, 'asset.updated', params.id);
      return assetDto(updated);
    });
    return { asset };
  });

  for (const byProject of [true, false]) {
    app.get(byProject ? '/v1/projects/:id/assets' : '/v1/assets', async (req) => {
      const actor = requireUser(req);
      const query = filters.parse(req.query);
      const projectId = byProject ? z.object({ id }).parse(req.params).id : null;
      if (projectId) {
        const access = await projectAccess(db, projectId, actor.id);
        if (query.spaceId && access.space_id !== query.spaceId)
          throw new HttpError(400, 'SCOPE_MISMATCH', '项目与空间不匹配');
      } else {
        if (!query.spaceId) throw new HttpError(400, 'SPACE_REQUIRED', '请明确选择个人或团队空间');
        await spaceRole(db, query.spaceId, actor.id);
      }
      const scope = hash(
        JSON.stringify({
          actorId: actor.id,
          projectId,
          spaceId: query.spaceId ?? null,
          query: query.query ?? '',
          source: query.source ?? null,
          ...(query.mime ? { mime: query.mime } : {}),
          createdFrom: query.createdFrom ?? null,
          createdTo: query.createdTo ?? null,
        }),
      );
      let cursor: z.infer<typeof cursorSchema> | undefined;
      if (query.cursor) {
        try {
          cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
          );
        } catch {
          throw new HttpError(400, 'INVALID_CURSOR', '分页游标无效');
        }
        if (cursor.scope !== scope)
          throw new HttpError(400, 'CURSOR_SCOPE_MISMATCH', '筛选条件已改变，请从第一页查询');
      }
      const assetScope = `FROM assets a JOIN projects p ON p.id=a.project_id JOIN spaces s ON s.id=p.space_id
         LEFT JOIN memberships m ON m.space_id=s.id AND m.user_id=$1
         WHERE a.deleted_at IS NULL AND p.deleted_at IS NULL
         AND ($2::uuid IS NULL OR p.id=$2) AND ($3::uuid IS NULL OR p.space_id=$3)
         AND (m.user_id IS NOT NULL OR ($2::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM share_grants g WHERE g.project_id=p.id AND g.target_user_id=$1 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND ((g.mode='reference' AND (s.sharing_policy->>'allowReference')::boolean) OR (g.mode='copy' AND (s.sharing_policy->>'allowCopy')::boolean)))))
         AND ($4::text='' OR strpos(lower(a.name||' '||COALESCE(a.annotations->>'title','')||' '||COALESCE(a.annotations->'tags','[]'::jsonb)::text),lower($4))>0
          OR EXISTS(SELECT 1 FROM asset_recognitions r WHERE r.asset_id=a.id AND r.source_hash=a.content_hash AND strpos(lower(r.text_content),lower($4))>0))
         AND ($5::text IS NULL OR (${assetSourceSql})=$5)
         AND ($6::timestamptz IS NULL OR a.created_at >= $6) AND ($7::timestamptz IS NULL OR a.created_at < $7)
         AND ($8::text IS NULL OR a.mime=$8)`;
      const values = [
            actor.id,
            projectId,
            query.spaceId ?? null,
            query.query ?? '',
            query.source ?? null,
            query.createdFrom ?? null,
            query.createdTo ?? null,
            query.mime ?? null,
      ];
      if (query.groupBy) {
        const groupKey = {
          date: "to_char(a.created_at AT TIME ZONE $9::text,'YYYY-MM-DD')",
          project: 'a.project_id::text',
          source: assetSourceSql,
          type: 'a.mime',
        }[query.groupBy];
        const { rows } = await db.query(
          `SELECT ${groupKey} AS key, count(*)::int AS count ${assetScope}
           GROUP BY 1 ORDER BY 1 DESC`,
          query.groupBy === 'date' ? [...values, query.timeZone] : values,
        );
        return { groups: rows };
      }
      // Use the same ACL and filters for folders and their paginated contents.
      const rows = (
        await db.query(
          `SELECT a.*,to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
           ${assetScope} AND ($9::timestamptz IS NULL OR (a.created_at,a.id)<($9::timestamptz,$10::uuid))
           ORDER BY a.created_at DESC,a.id DESC LIMIT $11`,
          [
            ...values,
            cursor?.at ?? null,
            cursor?.id ?? null,
            query.limit + 1,
          ],
        )
      ).rows;
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        assets: page.map(assetDto),
        nextCursor:
          hasMore && last
            ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id, scope })).toString(
                'base64url',
              )
            : null,
      };
    });
  }
}
