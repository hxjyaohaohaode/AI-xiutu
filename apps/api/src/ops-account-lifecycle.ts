import type { FastifyInstance } from 'fastify';
import { audit, emit, transaction, type Database, type Queryable } from '@ai-xiutu/db';
import { z } from 'zod';
import { hash, HttpError, id, lockActiveSession, reason, requireOperator } from './core.js';

async function lockAccountManager(tx: Queryable, actor: string, token: string) {
  const authorized = await tx.query(
    "SELECT o.user_id FROM operator_users o JOIN users u ON u.id=o.user_id WHERE u.id=$1 AND u.status='active' AND o.manages_accounts FOR SHARE OF u,o",
    [actor],
  );
  if (!authorized.rowCount)
    throw new HttpError(403, 'ACCOUNT_MANAGER_REQUIRED', '此操作需要账号管理员权限');
  await lockActiveSession(tx, actor, hash(token));
}

async function lockTarget(tx: Queryable, actor: string, target: string) {
  if (actor === target)
    throw new HttpError(403, 'ACCOUNT_MANAGER_PROTECTED', '不能修改自己的运营权限或注销账号');
  const protectedAccount = await tx.query(
    'SELECT 1 FROM operator_users WHERE user_id=$1 AND manages_accounts',
    [target],
  );
  if (protectedAccount.rowCount)
    throw new HttpError(403, 'ACCOUNT_MANAGER_PROTECTED', '账号管理员受保护');
  const row = (await tx.query(
    'SELECT id,status,phone_verified_at FROM users WHERE id=$1 FOR UPDATE',
    [target],
  )).rows[0];
  if (!row) throw new HttpError(404, 'USER_NOT_FOUND', '账号不存在');
  const access = (await tx.query(
    'SELECT manages_accounts FROM operator_users WHERE user_id=$1 FOR UPDATE',
    [target],
  )).rows[0];
  if (access?.manages_accounts)
    throw new HttpError(403, 'ACCOUNT_MANAGER_PROTECTED', '账号管理员受保护');
  return { ...row, isOperator: Boolean(access) };
}

export function registerAccountLifecycle(app: FastifyInstance, db: Database) {
  app.put('/v1/ops/users/:id/role', async (req) => {
    const actor = requireOperator(req);
    const target = z.object({ id }).parse(req.params).id;
    const roles = z.enum(['user', 'operator']);
    const body = z.object({ role: roles, expectedRole: roles, reason }).strict().parse(req.body);
    return transaction(db, async (tx) => {
      await lockAccountManager(tx, actor.id, req.cookies.xiutu_session ?? '');
      const account = await lockTarget(tx, actor.id, target);
      if (account.status === 'closed')
        throw new HttpError(409, 'ACCOUNT_CLOSED', '账号已注销，无法更改权限');
      const currentRole = account.isOperator ? 'operator' : 'user';
      if (currentRole === body.role) return { ok: true, role: currentRole };
      if (currentRole !== body.expectedRole)
        throw new HttpError(409, 'ACCOUNT_ROLE_CHANGED', '账号权限已变化，请刷新后重试');
      if (body.role === 'operator') {
        if (account.status !== 'active' || !account.phone_verified_at)
          throw new HttpError(409, 'VERIFICATION_REQUIRED', '运营账号须已启用并完成手机号验证');
        await tx.query('INSERT INTO operator_users(user_id) VALUES($1)', [target]);
      } else {
        await tx.query('DELETE FROM operator_users WHERE user_id=$1', [target]);
      }
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [target]);
      await audit(tx, actor.id, 'operator.user_role', 'user', target, {
        from: currentRole,
        to: body.role,
        reason: body.reason,
      });
      return { ok: true, role: body.role };
    });
  });

  app.post('/v1/ops/users/:id/close', async (req) => {
    const actor = requireOperator(req);
    const target = z.object({ id }).parse(req.params).id;
    const body = z.object({ reason }).strict().parse(req.body);
    return transaction(db, async (tx) => {
      await lockAccountManager(tx, actor.id, req.cookies.xiutu_session ?? '');
      const account = await lockTarget(tx, actor.id, target);
      if (account.status === 'closed') return { ok: true };
      if (account.isOperator)
        throw new HttpError(409, 'OPERATOR_PROTECTED', '请先撤回账号的运营权限');
      const blockers = (await tx.query(
        `SELECT EXISTS(SELECT 1 FROM spaces WHERE owner_id=$1 AND kind='team') AS owns_team,
          EXISTS(
            SELECT 1 FROM quota_holds WHERE user_id=$1 AND state IN ('held','unknown')
            UNION ALL SELECT 1 FROM media_import_jobs WHERE actor_id=$1 AND state IN ('uploading','processing')
          ) AS pending_work`,
        [target],
      )).rows[0];
      if (blockers.owns_team)
        throw new HttpError(409, 'ACCOUNT_OWNS_TEAMS', '请先交接该账号拥有的团队空间');
      if (blockers.pending_work)
        throw new HttpError(409, 'ACCOUNT_WORK_PENDING', '请等待账号的处理中任务结算或完成核验');
      await tx.query(
        "UPDATE users SET status='closed',phone='closed:'||id::text,display_name='已注销用户',password_hash=NULL,phone_verified_at=NULL,updated_at=clock_timestamp() WHERE id=$1",
        [target],
      );
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [target]);
      await tx.query("SELECT set_config('ai_xiutu.membership_actor',$1,true)", [actor.id]);
      const memberships = await tx.query(
        "DELETE FROM memberships m USING spaces s WHERE s.id=m.space_id AND s.kind='team' AND m.user_id=$1 RETURNING m.space_id",
        [target],
      );
      for (const membership of memberships.rows)
        await emit(tx, membership.space_id, null, 'membership.changed', target);
      await tx.query(
        'UPDATE invitations SET revoked_at=clock_timestamp() WHERE created_by=$1 AND revoked_at IS NULL',
        [target],
      );
      await tx.query(
        'UPDATE share_grants SET revoked_at=clock_timestamp() WHERE (target_user_id=$1 OR created_by=$1) AND revoked_at IS NULL',
        [target],
      );
      await tx.query(
        'UPDATE assistant_grants SET revoked_at=clock_timestamp() WHERE actor_id=$1 AND revoked_at IS NULL',
        [target],
      );
      await tx.query('DELETE FROM resource_memories WHERE user_id=$1', [target]);
      await audit(tx, actor.id, 'operator.user_close', 'user', target, {
        from: account.status,
        reason: body.reason,
      });
      return { ok: true };
    });
  });
}
