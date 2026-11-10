import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { parseEditorRecipe } from '@ai-xiutu/editor';
import type { Database, Queryable } from '@ai-xiutu/db';
import type { AssistantContext, AssistantScope } from '@ai-xiutu/contracts';
import type { ImageModerator, TextModerator } from '@ai-xiutu/providers';
import { HttpError, id, lockActiveSession, projectAccess } from '../core.js';
import type { LocalPrivateStorage } from '../storage.js';

export async function assistantAccess(db: Queryable, actorId: string, projectId: string) {
  const permission = await projectAccess(db, projectId, actorId, 'edit');
  const member = await db.query(
    `SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.space_id=$2 AND u.status='active' AND u.phone_verified_at IS NOT NULL`,
    [actorId, permission.space_id],
  );
  if (!member.rowCount)
    throw new HttpError(403, 'ASSISTANT_MEMBERSHIP_REQUIRED', 'AI 需要已验证的当前空间成员身份');
  return permission;
}
/** Transaction-only authorization fence. Lock order is user → sorted spaces →
 * sorted projects → memberships/assets → paid row → hold. Membership mutations
 * take the space lock first; recovery only takes paid rows/holds. A revocation
 * therefore commits either before admission/dispatch/publication or after it. */
export async function lockedAssistantAccess(
  tx: Queryable,
  actorId: string,
  projectId: string,
  scope?: AssistantScope,
  authHash?: string,
) {
  const permission = await assistantAccess(tx, actorId, projectId);
  const user = await tx.query(
    "SELECT id FROM users WHERE id=$1 AND status='active' AND phone_verified_at IS NOT NULL FOR SHARE",
    [actorId],
  );
  if (!user.rowCount)
    throw new HttpError(403, 'ASSISTANT_MEMBERSHIP_REQUIRED', '账号当前不可使用 AI');
  if (authHash) await lockActiveSession(tx, actorId, authHash);
  const spaces = [...new Set([permission.space_id, ...(scope?.spaceIds ?? [])])].sort();
  await tx.query('SELECT id FROM spaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [spaces]);
  const referenceIds = scope?.referenceAssetIds ?? [];
  const sources = referenceIds.length
    ? (await tx.query('SELECT project_id FROM assets WHERE id=ANY($1::uuid[])', [referenceIds]))
        .rows
    : [];
  const projects = [...new Set([projectId, ...sources.map((source) => source.project_id)])].sort();
  await tx.query('SELECT id FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [
    projects,
  ]);
  await tx.query(
    'SELECT space_id FROM memberships WHERE user_id=$1 AND space_id=ANY($2::uuid[]) ORDER BY space_id FOR SHARE',
    [actorId, spaces],
  );
  if (referenceIds.length)
    await tx.query('SELECT id FROM assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [
      referenceIds,
    ]);
  const current = await assistantAccess(tx, actorId, projectId);
  if (scope) await validateScope(tx, actorId, scope);
  return current;
}
export async function validateScope(db: Queryable, actorId: string, scope: AssistantScope) {
  if (
    new Set(scope.spaceIds).size !== scope.spaceIds.length ||
    new Set(scope.referenceAssetIds).size !== scope.referenceAssetIds.length
  )
    throw new HttpError(400, 'DUPLICATE_SCOPE', '素材范围重复');
  if (scope.spaceIds.length) {
    const found = await db.query(
      'SELECT space_id FROM memberships WHERE user_id=$1 AND space_id=ANY($2::uuid[])',
      [actorId, scope.spaceIds],
    );
    if (found.rowCount !== scope.spaceIds.length)
      throw new HttpError(403, 'RESOURCE_SCOPE_FORBIDDEN', '只能搜索自己仍是成员的空间');
  }
  await validateReferences(db, actorId, scope.referenceAssetIds, scope.spaceIds);
}
/** Combine permissions required by retained history, without expanding the tools'
 * current search scope. This is internal data and can exceed one turn's UI limits. */
export function mergeAssistantScopes(
  current: AssistantScope,
  prior: AssistantScope[],
): AssistantScope {
  return {
    ...current,
    spaceIds: [...new Set([current, ...prior].flatMap((scope) => scope.spaceIds))].sort(),
    referenceAssetIds: [
      ...new Set([current, ...prior].flatMap((scope) => scope.referenceAssetIds)),
    ].sort(),
  };
}
export async function validateReferences(
  db: Queryable,
  actorId: string,
  ids: string[],
  spaceIds: string[],
) {
  if (!ids.length) return;
  const unique = [...new Set(ids)];
  const found = await db.query(
    `SELECT a.id FROM assets a JOIN projects p ON p.id=a.project_id JOIN memberships m ON m.space_id=p.space_id WHERE a.id=ANY($1::uuid[]) AND m.user_id=$2 AND p.space_id=ANY($3::uuid[]) AND a.deleted_at IS NULL AND p.deleted_at IS NULL`,
    [unique, actorId, spaceIds],
  );
  if (found.rowCount !== unique.length)
    throw new HttpError(403, 'REFERENCE_FORBIDDEN', '参考图不在获准的素材范围内');
}
export async function validateContext(
  db: Queryable,
  actorId: string,
  projectId: string,
  context?: AssistantContext,
  lock = false,
): Promise<AssistantContext | undefined> {
  if (!context) return undefined;
  const permission = await assistantAccess(db, actorId, projectId);
  const found = await db.query(
    `SELECT a.asset_id,a.head_version FROM artworks a JOIN assets s ON s.id=a.asset_id
    WHERE a.id=$1 AND a.project_id=$2 AND s.project_id=a.project_id AND s.deleted_at IS NULL` +
      (lock ? ' FOR NO KEY UPDATE OF a FOR SHARE OF s' : ''),
    [context.artworkId, permission.id],
  );
  if (!found.rows[0] || found.rows[0].asset_id !== context.assetId)
    throw new HttpError(404, 'CONTEXT_NOT_FOUND', '当前图片已变化或无权引用');
  if (found.rows[0].head_version !== context.expectedVersion)
    throw new HttpError(409, 'CONTEXT_VERSION_CONFLICT', '图片已被更新，请同步后重新共享画面');
  const recipe = parseEditorRecipe(context.recipe);
  if ('imageLayers' in recipe && recipe.imageLayers.length) {
    const sourceIds = [...new Set(recipe.imageLayers.map((item) => item.sourceId))];
    if (sourceIds.some((sourceId) => !id.safeParse(sourceId).success))
      throw new HttpError(409, 'LOCAL_LAYERS_NOT_SAVED', '请先上传合成图层');
    const sources = await db.query(
      'SELECT id FROM assets WHERE id=ANY($1::uuid[]) AND project_id=$2 AND deleted_at IS NULL ORDER BY id' +
        (lock ? ' FOR SHARE' : ''),
      [sourceIds, projectId],
    );
    if (sources.rowCount !== sourceIds.length)
      throw new HttpError(403, 'LAYER_SCOPE_FORBIDDEN', '合成图层不属于当前项目');
  }
  return { ...context, recipe };
}
export function retainedContext(context?: AssistantContext) {
  if (!context) return {};
  const { imageDataUrl, ...rest } = context;
  return {
    ...rest,
    imageShared: Boolean(imageDataUrl),
    imageHash: imageDataUrl ? createHash('sha256').update(imageDataUrl).digest('hex') : null,
  };
}
export async function moderateText(moderator: TextModerator, text: string) {
  const max = 9000;
  for (let index = 0; index < text.length; index += max) {
    const chunk = text.slice(index, index + max);
    const result = await moderator.check(chunk);
    if (
      result.decision !== 'passed' ||
      result.inputHash !== createHash('sha256').update(chunk).digest('hex')
    )
      throw new HttpError(422, 'ASSISTANT_REVIEW_REQUIRED', '内容需审核，未执行此请求');
  }
}
export async function normalizeSharedImage(
  dataUrl: string,
  moderator: ImageModerator,
): Promise<string> {
  const content = dataUrl.split(',')[1] ?? '';
  const data = Buffer.from(content, 'base64');
  if (data.length > 1_100_000 || data.toString('base64') !== content)
    throw new HttpError(400, 'SNAPSHOT_SIZE', '共享画面过大');
  let preview: Buffer;
  try {
    const image = sharp(data, { limitInputPixels: 4_194_304, animated: true, failOn: 'warning' });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) !== 1 || !['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
      throw new HttpError(415, 'SNAPSHOT_FORMAT', '共享画面必须为单张 JPEG、PNG 或 WebP');
    if (metadata.width * metadata.height > 4_194_304)
      throw new HttpError(413, 'SNAPSHOT_PIXEL_BUDGET', '共享画面超出像素预算');
    preview = await image
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message))
      throw new HttpError(413, 'SNAPSHOT_PIXEL_BUDGET', '共享画面超出像素预算');
    throw new HttpError(415, 'SNAPSHOT_FORMAT', '共享画面无法安全解码');
  }
  const result = await moderator.check(preview, 'image/jpeg');
  if (
    result.decision !== 'passed' ||
    result.inputHash !== createHash('sha256').update(preview).digest('hex')
  )
    throw new HttpError(422, 'IMAGE_REVIEW_REQUIRED', '共享画面需审核');
  return `data:image/jpeg;base64,${preview.toString('base64')}`;
}
export async function searchAssistantResources(
  db: Database,
  actorId: string,
  scope: AssistantScope,
  query: string,
  limit: number,
) {
  await validateScope(db, actorId, scope);
  if (!scope.spaceIds.length) return { resources: [], reason: '用户尚未选择个人或团队素材范围' };
  const escaped = (value: string) => value.replace(/[\\%_]/g, '\\$&');
  const words = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `%${escaped(word)}%`);
  const found = await db.query(
    `SELECT a.id,a.name,a.width,a.height,a.annotations,a.created_at,p.id AS project_id,p.title AS project_title,p.space_id,s.name AS space_name,s.kind
    FROM assets a JOIN projects p ON p.id=a.project_id JOIN spaces s ON s.id=p.space_id JOIN memberships m ON m.space_id=s.id
    WHERE m.user_id=$1 AND s.id=ANY($2::uuid[]) AND a.deleted_at IS NULL AND p.deleted_at IS NULL
    AND (a.name || ' ' || COALESCE(a.annotations->>'title','') || ' ' || COALESCE(a.annotations->>'tags','')) ILIKE ALL($3::text[])
    ORDER BY CASE WHEN $4<>'' AND a.name ILIKE $4 THEN 0
                  WHEN $4<>'' AND COALESCE(a.annotations->>'title','') ILIKE $4 THEN 1
                  WHEN $4<>'' AND a.name ILIKE '%'||$4||'%' THEN 2 ELSE 3 END,
             a.created_at DESC,a.id LIMIT $5`,
    [actorId, scope.spaceIds, words, escaped(query.trim()), limit],
  );
  return {
    resources: found.rows.map((item) => ({
      id: item.id,
      name: item.name,
      width: item.width,
      height: item.height,
      projectId: item.project_id,
      projectTitle: item.project_title,
      spaceId: item.space_id,
      spaceName: item.space_name,
      title: item.annotations?.title ?? '',
      tags: item.annotations?.tags ?? [],
      selectedForImageInput: scope.referenceAssetIds.includes(item.id),
    })),
  };
}
export async function selectedReferenceImages(
  db: Database,
  storage: LocalPrivateStorage,
  actorId: string,
  scope: AssistantScope,
  moderator: ImageModerator,
) {
  await validateReferences(db, actorId, scope.referenceAssetIds, scope.spaceIds);
  const images: { id: string; dataUrl: string }[] = [];
  for (const id of scope.referenceAssetIds) {
    const row = (
      await db.query(
        'SELECT storage_key,content_hash,bytes FROM assets WHERE id=$1 AND deleted_at IS NULL',
        [id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'REFERENCE_REMOVED', '素材已移除');
    // The path comes exclusively from immutable server storage, never a model URL.
    const data = await storage.readBytes(row.storage_key, 64 * 1024 * 1024);
    if (
      data.byteLength !== Number(row.bytes) ||
      createHash('sha256').update(data).digest('hex') !== row.content_hash
    )
      throw new HttpError(409, 'REFERENCE_SOURCE_CHANGED', '参考图内容与素材摘要不一致');
    const preview = await sharp(data, { limitInputPixels: 40_000_000 })
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    images.push({
      id,
      dataUrl: await normalizeSharedImage(
        `data:image/jpeg;base64,${preview.toString('base64')}`,
        moderator,
      ),
    });
  }
  return images;
}
