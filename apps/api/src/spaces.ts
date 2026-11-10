import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, audit, emit, type Database } from '@ai-xiutu/db';
import {
  HttpError,
  id,
  title,
  role,
  requireUser,
  spaceRole,
  spacesFor,
  hash,
  opaqueToken,
  maskPhone,
} from './core.js';

const invitedRole = z.enum(['admin', 'editor', 'reviewer', 'viewer']);
export function registerSpaces(app: FastifyInstance, db: Database): void {
  app.get('/v1/spaces', async (req) => ({ spaces: await spacesFor(db, requireUser(req).id) }));
  app.post('/v1/spaces', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ name: title }).strict().parse(req.body);
    const space = await transaction(db, async (tx) => {
      await tx.query("SELECT set_config('ai_xiutu.membership_actor',$1,true)", [user.id]);
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
      const count = await tx.query(
        "SELECT count(*) FROM spaces WHERE owner_id=$1 AND kind='team'",
        [user.id],
      );
      if (Number(count.rows[0]!.count) >= 20)
        throw new HttpError(409, 'SPACE_LIMIT', '最多创建20个团队空间');
      const { rows } = await tx.query(
        "INSERT INTO spaces(name,kind,owner_id) VALUES($1,'team',$2) RETURNING id,name,kind",
        [p.name, user.id],
      );
      const created = rows[0]!;
      await tx.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'owner')", [
        created.id,
        user.id,
      ]);
      await tx.query('INSERT INTO quota_wallets(space_id) VALUES($1)', [created.id]);
      await audit(tx, user.id, 'space.create', 'space', created.id);
      return { ...created, role: 'owner' };
    });
    return reply.code(201).send({ space });
  });
  app.get('/v1/spaces/:id/members', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await spaceRole(db, p.id, user.id);
    const { rows } = await db.query(
      'SELECT u.id AS "userId",u.display_name AS "displayName",u.phone,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.space_id=$1 ORDER BY m.created_at',
      [p.id],
    );
    return {
      members: rows.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        phoneMasked: maskPhone(r.phone),
        role: r.role,
      })),
    };
  });
  app.post('/v1/spaces/:id/invitations', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({
        role: invitedRole,
        expiresInDays: z.number().int().min(1).max(30).default(7),
        maxUses: z.number().int().min(1).max(20).default(1),
      })
      .strict()
      .parse(req.body);
    const code = opaqueToken();
    const invitation = await transaction(db, async (tx) => {
      const space = (await tx.query('SELECT kind FROM spaces WHERE id=$1 FOR UPDATE', [p.id]))
        .rows[0];
      const current = await spaceRole(tx, p.id, user.id, ['owner', 'admin']);
      if (current !== 'owner' && body.role === 'admin')
        throw new HttpError(403, 'ROLE_FORBIDDEN', '仅所有者可邀请管理员');
      if (!space) throw new HttpError(404, 'SPACE_NOT_FOUND', '空间不存在');
      if (space.kind === 'personal')
        throw new HttpError(400, 'PERSONAL_SPACE_PRIVATE', '个人空间不能添加成员，请创建团队');
      const row = (
        await tx.query(
          `INSERT INTO invitations(code_hash,kind,space_id,role,max_uses,expires_at,created_by) VALUES($1,'space',$2,$3,$4,clock_timestamp()+($5::text||' days')::interval,$6) RETURNING id,role,expires_at AS "expiresAt",max_uses AS "maxUses"`,
          [hash(code), p.id, body.role, body.maxUses, body.expiresInDays, user.id],
        )
      ).rows[0]!;
      await audit(tx, user.id, 'invitation.create', 'space', p.id, {
        role: body.role,
        maxUses: body.maxUses,
      });
      return { ...row, code };
    });
    return reply.code(201).send({ invitation });
  });
  app.post('/v1/invitations/accept', async (req) => {
    const user = requireUser(req);
    const p = z
      .object({ code: z.string().min(20).max(100) })
      .strict()
      .parse(req.body);
    const space = await transaction(db, async (tx) => {
      await tx.query("SELECT set_config('ai_xiutu.membership_actor',$1,true)", [user.id]);
      const hint = (
        await tx.query("SELECT space_id FROM invitations WHERE code_hash=$1 AND kind='space'", [
          hash(p.code),
        ])
      ).rows[0];
      if (!hint) throw new HttpError(400, 'INVITE_INVALID', '邀请无效或已过期');
      await tx.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [hint.space_id]);
      const invitation = (
        await tx.query(
          "SELECT * FROM invitations WHERE code_hash=$1 AND kind='space' AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE",
          [hash(p.code)],
        )
      ).rows[0];
      if (!invitation) throw new HttpError(400, 'INVITE_INVALID', '邀请无效或已过期');
      const existing = (
        await tx.query('SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2', [
          invitation.space_id,
          user.id,
        ])
      ).rows[0];
      if (existing)
        return {
          ...(await tx.query('SELECT id,name,kind FROM spaces WHERE id=$1', [invitation.space_id]))
            .rows[0],
          role: existing.role,
        };
      if (invitation.uses >= invitation.max_uses)
        throw new HttpError(400, 'INVITE_INVALID', '邀请已用完');
      const inviter = (
        await tx.query(
          "SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2 AND role IN ('owner','admin')",
          [invitation.space_id, invitation.created_by],
        )
      ).rows[0];
      if (!inviter || (invitation.role === 'admin' && inviter.role !== 'owner'))
        throw new HttpError(400, 'INVITE_INVALID', '邀请人的权限已变化');
      await tx.query('INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,$3)', [
        invitation.space_id,
        user.id,
        invitation.role,
      ]);
      await tx.query('UPDATE invitations SET uses=uses+1 WHERE id=$1', [invitation.id]);
      await tx.query('INSERT INTO invitation_uses(invitation_id,user_id) VALUES($1,$2)', [
        invitation.id,
        user.id,
      ]);
      await audit(tx, user.id, 'invitation.accept', 'space', invitation.space_id);
      await emit(tx, invitation.space_id, null, 'membership.changed', user.id);
      return {
        ...(await tx.query('SELECT id,name,kind FROM spaces WHERE id=$1', [invitation.space_id]))
          .rows[0],
        role: invitation.role,
      };
    });
    return { space };
  });
  app.delete('/v1/spaces/:id/invitations/:invitationId', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id, invitationId: id }).parse(req.params);
    await transaction(db, async (tx) => {
      await spaceRole(tx, p.id, user.id, ['owner', 'admin']);
      await tx.query(
        'UPDATE invitations SET revoked_at=clock_timestamp() WHERE id=$1 AND space_id=$2',
        [p.invitationId, p.id],
      );
      await audit(tx, user.id, 'invitation.revoke', 'invitation', p.invitationId);
    });
    return { ok: true };
  });
  for (const method of ['PATCH', 'DELETE'] as const)
    app.route({
      method,
      url: '/v1/spaces/:id/members/:userId',
      handler: async (req) => {
        const user = requireUser(req);
        const p = z.object({ id, userId: id }).parse(req.params);
        const next =
          method === 'PATCH' ? z.object({ role: invitedRole }).strict().parse(req.body).role : null;
        await transaction(db, async (tx) => {
          await tx.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [p.id]);
          await tx.query("SELECT set_config('ai_xiutu.membership_actor',$1,true)", [user.id]);
          const leaving = method === 'DELETE' && p.userId === user.id;
          const acting = await spaceRole(
            tx,
            p.id,
            user.id,
            leaving ? ['owner', 'admin', 'editor', 'reviewer', 'viewer'] : ['owner', 'admin'],
          );
          const target = (
            await tx.query(
              'SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2 FOR UPDATE',
              [p.id, p.userId],
            )
          ).rows[0];
          if (!target) throw new HttpError(404, 'MEMBER_NOT_FOUND', '成员不存在');
          if (
            target.role === 'owner' ||
            (!leaving && acting !== 'owner' && (target.role === 'admin' || next === 'admin'))
          )
            throw new HttpError(403, 'ROLE_FORBIDDEN', '不能修改此成员角色');
          if (next)
            await tx.query('UPDATE memberships SET role=$3 WHERE space_id=$1 AND user_id=$2', [
              p.id,
              p.userId,
              next,
            ]);
          else
            await tx.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
              p.id,
              p.userId,
            ]);
          await tx.query(
            'UPDATE invitations SET revoked_at=clock_timestamp() WHERE space_id=$1 AND created_by=$2 AND revoked_at IS NULL',
            [p.id, p.userId],
          );
          if (method === 'DELETE')
            await tx.query(
              'UPDATE share_grants SET revoked_at=clock_timestamp() WHERE target_user_id=$1 AND project_id IN (SELECT id FROM projects WHERE space_id=$2) AND revoked_at IS NULL',
              [p.userId, p.id],
            );
          await audit(
            tx,
            user.id,
            method === 'PATCH' ? 'membership.role' : 'membership.remove',
            'space',
            p.id,
            { targetUserId: p.userId, role: next },
          );
          await emit(tx, p.id, null, 'membership.changed', p.userId);
        });
        return { ok: true };
      },
    });
  app.post('/v1/spaces/:id/transfer-owner', async (req) => {
    const actor = requireUser(req),
      params = z.object({ id }).parse(req.params);
    const body = z.object({ targetUserId: id, expectedOwnerId: id }).strict().parse(req.body);
    await transaction(db, async (tx) => {
      const space = (await tx.query('SELECT * FROM spaces WHERE id=$1 FOR UPDATE', [params.id]))
        .rows[0];
      await spaceRole(tx, params.id, actor.id, ['owner']);
      if (!space || space.kind !== 'team')
        throw new HttpError(400, 'TEAM_REQUIRED', '仅团队空间可交接所有权');
      if (space.owner_id !== body.expectedOwnerId || space.owner_id !== actor.id)
        throw new HttpError(409, 'OWNER_CHANGED', '空间所有者已改变，请刷新');
      if (body.targetUserId === actor.id)
        throw new HttpError(400, 'OWNER_UNCHANGED', '请选择另一位现有成员');
      const target = (
        await tx.query(
          `SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.space_id=$1 AND m.user_id=$2 AND u.status='active' FOR UPDATE OF m`,
          [params.id, body.targetUserId],
        )
      ).rows[0];
      if (!target) throw new HttpError(400, 'MEMBER_REQUIRED', '新所有者须是当前有效成员');
      await tx.query("SELECT set_config('ai_xiutu.membership_actor',$1,true)", [actor.id]);
      await tx.query("UPDATE memberships SET role='admin' WHERE space_id=$1 AND user_id=$2", [
        params.id,
        actor.id,
      ]);
      await tx.query("UPDATE memberships SET role='owner' WHERE space_id=$1 AND user_id=$2", [
        params.id,
        body.targetUserId,
      ]);
      await tx.query('UPDATE spaces SET owner_id=$2 WHERE id=$1', [params.id, body.targetUserId]);
      await tx.query(
        'UPDATE invitations SET revoked_at=clock_timestamp() WHERE space_id=$1 AND created_by=$2 AND revoked_at IS NULL',
        [params.id, actor.id],
      );
      await audit(tx, actor.id, 'space.owner.transfer', 'space', params.id, {
        previousOwnerId: actor.id,
        ownerId: body.targetUserId,
      });
      await emit(tx, params.id, null, 'membership.changed', body.targetUserId);
    });
    return { ok: true, ownerId: body.targetUserId };
  });
  app.get('/v1/spaces/:id/activity', async (req) => {
    const actor = requireUser(req),
      params = z.object({ id }).parse(req.params);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z
          .string()
          .regex(/^\d{1,19}$/)
          .refine((s) => BigInt(s) <= 9223372036854775807n)
          .optional(),
      })
      .strict()
      .parse(req.query);
    await spaceRole(db, params.id, actor.id);
    const rows = (
      await db.query(
        `SELECT a.id::text,a.kind,a.actor_id AS "actorId",u.display_name AS "actorName",
      a.target_user_id AS "targetUserId",t.display_name AS "targetName",a.previous_role AS "previousRole",a.role,a.created_at AS "createdAt"
      FROM membership_activity a LEFT JOIN users u ON u.id=a.actor_id JOIN users t ON t.id=a.target_user_id
      WHERE a.space_id=$1 AND ($2::bigint IS NULL OR a.id<$2)
      AND EXISTS(SELECT 1 FROM memberships m WHERE m.space_id=a.space_id AND m.user_id=$3)
      ORDER BY a.id DESC LIMIT $4`,
        [params.id, query.cursor ?? null, actor.id, query.limit + 1],
      )
    ).rows;
    const page = rows.slice(0, query.limit);
    return { activities: page, nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });
}
