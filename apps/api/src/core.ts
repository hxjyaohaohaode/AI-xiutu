import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as nativeScrypt,
  timingSafeEqual,
} from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type {} from '@fastify/cookie';
import { z } from 'zod';
import type { Database, Queryable } from '@ai-xiutu/db';
import type { AppConfig } from './config.js';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
export const id = z.uuid();
export const title = z.string().trim().min(1).max(120);
export const reason = z.string().trim().min(3).max(500);
export const role = z.enum(['owner', 'admin', 'editor', 'reviewer', 'viewer']);
export type Role = z.infer<typeof role>;
export interface User {
  id: string;
  phone: string;
  display_name: string;
  status: string;
  is_operator: boolean;
}
declare module 'fastify' {
  interface FastifyRequest {
    currentUser: User | null;
  }
}
export function normalizePhone(value: string): string {
  const phone = value.trim().replace(/[\s()-]/g, '');
  const normalized = /^1[3-9]\d{9}$/.test(phone) ? `+86${phone}` : phone;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized))
    throw new HttpError(400, 'INVALID_PHONE', '请输入有效手机号');
  return normalized;
}
export const phoneSchema = z.string().min(8).max(24).transform(normalizePhone);
export const passwordSchema = z.string().min(10, '密码至少10个字符').max(128);
export const hash = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex');
export const secretHash = (secret: string, input: string) =>
  createHmac('sha256', secret).update(input).digest('hex');
export const opaqueToken = () => randomBytes(32).toString('base64url');
const scrypt = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    nativeScrypt(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt-v1$${salt.toString('hex')}$${key.toString('hex')}`;
}
const dummySalt = Buffer.from('6baed303a21ec95dec6a5edfce3fe7cd', 'hex');
export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const parts = encoded?.split('$');
  const valid =
    parts?.length === 3 &&
    parts[0] === 'scrypt-v1' &&
    /^[a-f0-9]{32}$/.test(parts[1] ?? '') &&
    /^[a-f0-9]{128}$/.test(parts[2] ?? '');
  const salt = valid ? Buffer.from(parts![1]!, 'hex') : dummySalt;
  const actual = await scrypt(password, salt);
  const expected = valid ? Buffer.from(parts![2]!, 'hex') : Buffer.alloc(64);
  return timingSafeEqual(actual, expected) && Boolean(valid);
}
export const maskPhone = (phone: string) =>
  phone.length > 7 ? `${phone.slice(0, 3)}••••${phone.slice(-4)}` : '••••';
export const userDto = (user: User) => ({
  id: user.id,
  displayName: user.display_name,
  phoneMasked: maskPhone(user.phone),
  status: user.status,
  isOperator: user.is_operator,
});
export function requireUser(req: FastifyRequest): User {
  if (!req.currentUser) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录');
  return req.currentUser;
}
export function requireOperator(req: FastifyRequest): User {
  const user = requireUser(req);
  if (!user.is_operator) throw new HttpError(403, 'OPERATOR_REQUIRED', '此操作需要平台运营权限');
  return user;
}
export async function spacesFor(db: Queryable, userId: string) {
  return (
    await db.query(
      'SELECT s.id,s.name,s.kind,m.role FROM spaces s JOIN memberships m ON m.space_id=s.id WHERE m.user_id=$1 ORDER BY s.kind,s.created_at',
      [userId],
    )
  ).rows;
}
export async function sessionDto(db: Queryable, user: User | null) {
  return { user: user ? userDto(user) : null, spaces: user ? await spacesFor(db, user.id) : [] };
}
export async function issueSession(
  tx: Queryable,
  userId: string,
  reply: FastifyReply,
  config: AppConfig,
): Promise<void> {
  const token = opaqueToken();
  await tx.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '14 days')",
    [hash(token), userId],
  );
  reply.setCookie('xiutu_session', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookie,
    maxAge: 14 * 86400,
  });
}
export async function rateLimit(
  db: Database,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  const { rows } = await db.query(
    `WITH t AS (SELECT floor(extract(epoch from clock_timestamp())/$2)::bigint AS bucket)
    INSERT INTO rate_buckets(key,window_start,hits,expires_at) SELECT $1,bucket,1,clock_timestamp()+($2::text||' seconds')::interval*2 FROM t
    ON CONFLICT(key,window_start) DO UPDATE SET hits=rate_buckets.hits+1 RETURNING hits`,
    [key, windowSeconds],
  );
  if (Number(rows[0]!.hits) > max)
    throw new HttpError(429, 'RATE_LIMITED', '操作过于频繁，请稍后重试', {
      retryAfterSeconds: windowSeconds,
    });
}
export async function spaceRole(
  tx: Queryable,
  spaceId: string,
  userId: string,
  allowed: Role[] = ['owner', 'admin', 'editor', 'reviewer', 'viewer'],
): Promise<Role> {
  const { rows } = await tx.query('SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2', [
    spaceId,
    userId,
  ]);
  const found = rows[0]?.role as Role | undefined;
  if (!found || !allowed.includes(found))
    throw new HttpError(403, 'SPACE_FORBIDDEN', '没有此空间的操作权限');
  return found;
}
export interface ProjectAccess {
  id: string;
  space_id: string;
  title: string;
  description: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  role: Role;
}
export async function projectAccess(
  tx: Queryable,
  projectId: string,
  userId: string,
  permission: 'read' | 'comment' | 'edit' | 'admin' = 'read',
): Promise<ProjectAccess> {
  const { rows } = await tx.query(
    `SELECT p.*,m.role,
    EXISTS(SELECT 1 FROM share_grants g WHERE g.project_id=p.id AND g.target_user_id=$2 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
      AND ((g.mode='reference' AND (s.sharing_policy->>'allowReference')::boolean) OR (g.mode='copy' AND (s.sharing_policy->>'allowCopy')::boolean))) AS shared
    FROM projects p JOIN spaces s ON s.id=p.space_id LEFT JOIN memberships m ON m.space_id=p.space_id AND m.user_id=$2
    WHERE p.id=$1 AND p.deleted_at IS NULL`,
    [projectId, userId],
  );
  const found = rows[0];
  if (!found || (!found.role && !found.shared))
    throw new HttpError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问');
  const currentRole = (found.role ?? 'reviewer') as Role;
  const permitted =
    permission === 'read' ||
    (permission === 'comment' && currentRole !== 'viewer') ||
    (permission === 'edit' && ['owner', 'admin', 'editor'].includes(currentRole)) ||
    (permission === 'admin' && ['owner', 'admin'].includes(currentRole));
  if (!permitted) throw new HttpError(403, 'PROJECT_FORBIDDEN', '没有此项目的操作权限');
  return { ...found, role: currentRole } as ProjectAccess;
}
/** Transaction-only gate. A session, membership or project mutation commits on
 * one side of this fence. Take it before artwork, decision and asset locks. */
export async function lockProjectMutation(
  tx: Queryable,
  projectId: string,
  actorId: string,
  authHash?: string,
  permission: 'edit' | 'admin' = 'edit',
) {
  const hint = await projectAccess(tx, projectId, actorId, permission);
  const active = await tx.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE", [
    actorId,
  ]);
  if (!active.rowCount) throw new HttpError(401, 'AUTH_REQUIRED', '登录已失效，请重新登录');
  if (authHash !== undefined) await lockActiveSession(tx, actorId, authHash);
  await tx.query('SELECT id FROM spaces WHERE id=$1 FOR SHARE', [hint.space_id]);
  await tx.query('SELECT id FROM projects WHERE id=$1 FOR SHARE', [projectId]);
  await tx.query('SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2 FOR SHARE', [
    hint.space_id,
    actorId,
  ]);
  return projectAccess(tx, projectId, actorId, permission);
}
export async function lockActiveSession(tx: Queryable, actorId: string, authHash: string) {
  const session = await tx.query(
    'SELECT token_hash FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>clock_timestamp() FOR SHARE',
    [authHash, actorId],
  );
  if (!session.rowCount) throw new HttpError(401, 'AUTH_REQUIRED', '登录已失效，请重新登录');
}
export const projectDto = (p: ProjectAccess) => ({
  id: p.id,
  spaceId: p.space_id,
  title: p.title,
  description: p.description,
  version: p.version,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
  role: p.role,
});
export const assetDto = (a: Record<string, any>) => ({
  id: a.id,
  projectId: a.project_id,
  name: a.name,
  mime: a.mime,
  width: a.width,
  height: a.height,
  bytes: Number(a.bytes),
  url: `/v1/assets/${a.id}/file`,
  thumbnailUrl: `/v1/assets/${a.id}/thumbnail`,
  provenance: a.provenance ?? {},
  source:
    a.provenance?.kind === 'ai-generated'
      ? 'generated'
      : a.provenance?.kind === 'uploaded' || a.provenance?.kind === 'media-import'
        ? a.provenance.declaredSource === 'sketch'
          ? 'sketch'
          : 'upload'
        : 'unknown',
  annotations: {
    title: a.annotations?.title ?? null,
    tags: a.annotations?.tags ?? [],
    capturedAt: a.annotations?.capturedAt ?? null,
    location: a.annotations?.location ?? null,
  },
  annotationVersion: a.annotation_version ?? 1,
  annotationUpdatedAt: a.annotation_updated_at ?? null,
  createdAt: a.created_at,
});
export const artworkDto = (a: Record<string, any>) => ({
  id: a.id,
  projectId: a.project_id,
  assetId: a.asset_id,
  title: a.title,
  headVersion: a.head_version,
  headRevisionId: a.head_revision_id,
  createdAt: a.created_at,
  updatedAt: a.updated_at,
});
export const revisionDto = (r: Record<string, any>) => ({
  id: r.id,
  artworkId: r.artwork_id,
  assetId: r.asset_id,
  version: r.version,
  parentId: r.parent_id,
  recipe: r.recipe,
  label: r.label,
  authorId: r.author_id,
  createdAt: r.created_at,
  ...(r.origin_kind
    ? { origin: { kind: r.origin_kind, sourceRevisionId: r.source_revision_id ?? null } }
    : {}),
});
export function assertVersion(actual: number, expected: number): void {
  if (actual !== expected)
    throw new HttpError(409, 'VERSION_CONFLICT', '版本已更新，请比较后再保存', {
      currentVersion: actual,
    });
}
