import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  transaction,
  audit,
  ensureMonthlyGrant,
  type Database,
  type Queryable,
} from '@ai-xiutu/db';
import { ProviderError, type SmsAdapter, type OtpPurpose } from '@ai-xiutu/providers';
import type { AppConfig } from './config.js';
import {
  HttpError,
  phoneSchema,
  passwordSchema,
  title,
  hash,
  secretHash,
  hashPassword,
  verifyPassword,
  issueSession,
  lockActiveSession,
  setSessionCookie,
  sessionDto,
  rateLimit,
  requireUser,
  type User,
} from './core.js';

export async function createPersonalSpace(
  tx: Queryable,
  userId: string,
  name: string,
): Promise<void> {
  const space = await tx.query(
    "INSERT INTO spaces(name,kind,owner_id) VALUES($1,'personal',$2) ON CONFLICT(owner_id) WHERE kind='personal' DO NOTHING RETURNING id",
    [`${name}的空间`, userId],
  );
  if (space.rows[0])
    await tx.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'owner')", [
      space.rows[0].id,
      userId,
    ]);
}
const otpInput = z
  .object({ phone: phoneSchema, purpose: z.enum(['register', 'login', 'reset']) })
  .strict();
const code = z.string().regex(/^\d{6}$/, '验证码为6位数字');
export function registerAuth(
  app: FastifyInstance,
  db: Database,
  config: AppConfig,
  sms: SmsAdapter,
): void {
  const keyed = (value: string) => secretHash(config.sessionSecret, `rate:${value}`);
  const phoneKey = (value: string) => secretHash(config.sessionSecret, `otp-phone:${value}`);
  const codeHash = (phone: string, purpose: OtpPurpose, challenge: string, value: string) =>
    secretHash(config.sessionSecret, `otp-code:${phone}:${purpose}:${challenge}:${value}`);
  const authRate = async (req: FastifyRequest, phone: string) => {
    await rateLimit(db, `auth-ip:${keyed(req.ip)}`, 30, 600);
    await rateLimit(db, `auth-phone:${keyed(phone)}`, 10, 600);
  };
  const readUser = async (tx: Queryable, userId: string) =>
    (
      await tx.query(
        'SELECT u.id,u.phone,u.display_name,u.status,EXISTS(SELECT 1 FROM operator_users o WHERE o.user_id=u.id) AS is_operator FROM users u WHERE u.id=$1',
        [userId],
      )
    ).rows[0] as User;
  async function withVerifiedOtp<T>(
    phone: string, purpose: OtpPurpose, value: string,
    complete: (tx: Queryable) => Promise<T>,
  ): Promise<T> {
    const result = await transaction(db, async (tx) => {
      const challenge = (await tx.query(
        "SELECT id,code_hash FROM otp_challenges WHERE phone_key=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND attempts<5 AND state IN ('sent','unknown') ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [phoneKey(phone), purpose],
      )).rows[0];
      if (!challenge) return { verified: false } as const;
      const actual = Buffer.from(codeHash(phone, purpose, challenge.id, value), 'hex');
      const expected = Buffer.from(challenge.code_hash, 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
        // Return normally so failed attempts commit even though the HTTP request is rejected.
        await tx.query('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1', [challenge.id]);
        return { verified: false } as const;
      }
      // A corrected invitation or a rolled-back account write can reuse the same delivered SMS.
      await tx.query('UPDATE otp_challenges SET attempts=attempts+1,consumed_at=clock_timestamp() WHERE id=$1', [challenge.id]);
      try {
        return { verified: true, value: await complete(tx) } as const;
      } catch (error) {
        if (error instanceof HttpError) error.details = { ...error.details, otpConsumed: false };
        throw error; // The business write and the verified challenge roll back together.
      }
    });
    if (!result.verified) throw new HttpError(400, 'OTP_INVALID', '验证码无效、已使用或已过期');
    return result.value;
  }
  app.get('/v1/session', async (req) => sessionDto(db, req.currentUser));
  app.post('/v1/auth/otp', async (req, reply) => {
    const p = otpInput.parse(req.body);
    if (!sms.configured)
      throw new HttpError(503, 'SMS_NOT_CONFIGURED', '短信服务尚未配置，无法发送验证码');
    if (sms.supportsPhone && !sms.supportsPhone(p.phone))
      throw new HttpError(400, 'SMS_PHONE_UNSUPPORTED', '当前短信服务仅支持中国大陆手机号码');
    await rateLimit(db, `sms-ip:${keyed(req.ip)}`, 10, 600);
    await rateLimit(db, `sms-phone:${keyed(p.phone)}`, 5, 3600);
    await rateLimit(db, 'sms-platform', 1000, 86400);
    const rawCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challengeId = randomUUID();
    const shouldSend = await transaction(db, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${phoneKey(p.phone)}`]);
      const recent = await tx.query(
        "SELECT id FROM otp_challenges WHERE phone_key=$1 AND created_at>clock_timestamp()-interval '60 seconds' LIMIT 1",
        [phoneKey(p.phone)],
      );
      if (recent.rowCount)
        throw new HttpError(429, 'OTP_COOLDOWN', '请稍后再申请验证码', { retryAfterSeconds: 60 });
      // Do not branch delivery on account existence: provider failures or timing must not
      // reveal whether another person's phone is registered. Business eligibility is
      // checked only after the caller proves control of the code.
      const applies = true;
      await tx.query(
        'UPDATE otp_challenges SET consumed_at=clock_timestamp() WHERE phone_key=$1 AND purpose=$2 AND consumed_at IS NULL',
        [phoneKey(p.phone), p.purpose],
      );
      await tx.query(
        "INSERT INTO otp_challenges(id,phone_key,purpose,code_hash,state,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes')",
        [
          challengeId,
          phoneKey(p.phone),
          p.purpose,
          codeHash(p.phone, p.purpose, challengeId, rawCode),
          applies ? 'sending' : 'failed',
        ],
      );
      return applies;
    });
    if (shouldSend) {
      try {
        await sms.send({ phone: p.phone, code: rawCode, purpose: p.purpose, expiresMinutes: 10 });
        await db.query("UPDATE otp_challenges SET state='sent' WHERE id=$1", [challengeId]);
      } catch (error) {
        const unknown = error instanceof ProviderError && error.outcome === 'unknown';
        await db.query('UPDATE otp_challenges SET state=$2 WHERE id=$1', [
          challengeId,
          unknown ? 'unknown' : 'failed',
        ]);
        throw new HttpError(
          503,
          unknown ? 'SMS_SEND_UNKNOWN' : 'SMS_UNAVAILABLE',
          unknown ? '发送结果待确认，请留意短信，勿连续重发' : '短信服务暂不可用，请稍后重试',
        );
      }
    }
    return reply
      .code(202)
      .send({ ok: true, message: '若号码符合本次操作条件，验证码已提交发送', expiresIn: 600 });
  });
  app.post('/v1/auth/register', async (req, reply) => {
    const p = z
      .object({
        phone: phoneSchema,
        code,
        password: passwordSchema,
        displayName: title,
        inviteCode: z.string().min(10).max(100).optional(),
      })
      .strict()
      .parse(req.body);
    await authRate(req, p.phone);
    const session = await withVerifiedOtp(p.phone, 'register', p.code, async (tx) => {
      const password = await hashPassword(p.password);
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`register:${p.phone}`]);
      const existing = (await tx.query('SELECT * FROM users WHERE phone=$1 FOR UPDATE', [p.phone]))
        .rows[0];
      if (existing && existing.status !== 'pending')
        throw new HttpError(409, 'REGISTRATION_UNAVAILABLE', '无法完成注册，请使用登录或找回密码');
      const setting = (await tx.query('SELECT registration_mode FROM app_config WHERE id=true'))
        .rows[0]!;
      let invitation: Record<string, any> | undefined;
      if (p.inviteCode) {
        invitation = (
          await tx.query(
            "SELECT * FROM invitations WHERE code_hash=$1 AND kind='registration' AND revoked_at IS NULL AND expires_at>clock_timestamp() AND uses<max_uses FOR UPDATE",
            [hash(p.inviteCode)],
          )
        ).rows[0];
        if (!invitation) throw new HttpError(400, 'INVITE_INVALID', '邀请码无效或已用完');
      }
      if (setting.registration_mode === 'invite' && !existing && !invitation)
        throw new HttpError(400, 'INVITE_REQUIRED', '当前注册需要有效邀请码');
      const row = existing
        ? (
            await tx.query(
              "UPDATE users SET display_name=$2,password_hash=$3,status='active',phone_verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING id",
              [existing.id, p.displayName, password],
            )
          ).rows[0]
        : (
            await tx.query(
              'INSERT INTO users(phone,display_name,password_hash,phone_verified_at) VALUES($1,$2,$3,clock_timestamp()) RETURNING id',
              [p.phone, p.displayName, password],
            )
          ).rows[0];
      if (invitation) {
        await tx.query('UPDATE invitations SET uses=uses+1 WHERE id=$1', [invitation.id]);
        await tx.query('INSERT INTO invitation_uses(invitation_id,user_id) VALUES($1,$2)', [
          invitation.id,
          row!.id,
        ]);
      }
      await createPersonalSpace(tx, row!.id, p.displayName);
      await ensureMonthlyGrant(tx, row!.id);
      const token = await issueSession(tx, row!.id);
      await audit(tx, row!.id, 'account.register', 'user', row!.id, { method: 'sms' });
      return { token, dto: await sessionDto(tx, await readUser(tx, row!.id)) };
    });
    setSessionCookie(reply, config, session.token);
    return reply.code(201).send(session.dto);
  });
  app.post('/v1/auth/login', async (req, reply) => {
    const p = z
      .object({ phone: phoneSchema, password: z.string().max(128) })
      .strict()
      .parse(req.body);
    await authRate(req, p.phone);
    const found = (
      await db.query('SELECT id,password_hash,status FROM users WHERE phone=$1', [p.phone])
    ).rows[0];
    const valid = await verifyPassword(p.password, found?.password_hash ?? null);
    if (!found || !valid || found.status !== 'active')
      throw new HttpError(401, 'INVALID_CREDENTIALS', '手机号或密码不正确，或账号暂不可用');
    const session = await transaction(db, async (tx) => {
      const current = (
        await tx.query(
          "SELECT id FROM users WHERE id=$1 AND status='active' AND password_hash=$2 FOR SHARE",
          [found.id, found.password_hash],
        )
      ).rows[0];
      if (!current) throw new HttpError(401, 'INVALID_CREDENTIALS', '登录信息已更新，请重试');
      const token = await issueSession(tx, found.id);
      return { token, dto: await sessionDto(tx, await readUser(tx, found.id)) };
    });
    setSessionCookie(reply, config, session.token);
    return session.dto;
  });
  app.post('/v1/auth/login-otp', async (req, reply) => {
    const p = z.object({ phone: phoneSchema, code }).strict().parse(req.body);
    await authRate(req, p.phone);
    const session = await withVerifiedOtp(p.phone, 'login', p.code, async (tx) => {
      const found = (
        await tx.query("SELECT id FROM users WHERE phone=$1 AND status='active' FOR SHARE", [
          p.phone,
        ])
      ).rows[0];
      if (!found) throw new HttpError(401, 'INVALID_CREDENTIALS', '无法完成登录');
      const token = await issueSession(tx, found.id);
      return { token, dto: await sessionDto(tx, await readUser(tx, found.id)) };
    });
    setSessionCookie(reply, config, session.token);
    return session.dto;
  });
  app.post('/v1/auth/reset', async (req) => {
    const p = z
      .object({ phone: phoneSchema, code, newPassword: passwordSchema })
      .strict()
      .parse(req.body);
    await authRate(req, p.phone);
    await withVerifiedOtp(p.phone, 'reset', p.code, async (tx) => {
      const password = await hashPassword(p.newPassword);
      const user = (
        await tx.query(
          "UPDATE users SET password_hash=$2,updated_at=clock_timestamp() WHERE phone=$1 AND status='active' RETURNING id",
          [p.phone, password],
        )
      ).rows[0];
      if (!user) throw new HttpError(400, 'RESET_UNAVAILABLE', '无法完成密码重置');
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      await audit(tx, user.id, 'account.password_reset', 'user', user.id);
    });
    return { ok: true };
  });
  app.get('/v1/auth/sessions', async (req, reply) => {
    const user = requireUser(req);
    const tokenHash = hash(req.cookies.xiutu_session ?? '');
    reply.header('Cache-Control', 'private, no-store');
    const row = (await db.query(
      `SELECT current.created_at AS "createdAt",current.expires_at AS "expiresAt",
        (SELECT count(*)::integer FROM sessions other
         WHERE other.user_id=current.user_id AND other.token_hash<>current.token_hash
           AND other.expires_at>clock_timestamp()) AS "otherSessions"
       FROM sessions current JOIN users u ON u.id=current.user_id
       WHERE current.token_hash=$1 AND current.user_id=$2 AND current.expires_at>clock_timestamp()
         AND u.status='active'`,
      [tokenHash, user.id],
    )).rows[0];
    if (!row) throw new HttpError(401, 'AUTH_REQUIRED', '登录已失效，请重新登录');
    return row;
  });
  app.post('/v1/auth/change-password', async (req, reply) => {
    const user = requireUser(req);
    const body = z.object({
      expectedUserId: z.uuid(),
      currentPassword: z.string().min(1).max(128),
      newPassword: passwordSchema,
    }).strict().parse(req.body);
    if (user.id !== body.expectedUserId)
      throw new HttpError(409, 'SESSION_CHANGED', '登录状态已变化，请确认当前账号后继续。');
    await rateLimit(db, `password-change:${keyed(user.id)}`, 5, 600);
    const found = (await db.query(
      "SELECT password_hash FROM users WHERE id=$1 AND status='active'",
      [user.id],
    )).rows[0];
    if (!(await verifyPassword(body.currentPassword, found?.password_hash ?? null)))
      throw new HttpError(400, 'CURRENT_PASSWORD_INVALID', '当前密码不正确');
    if (body.currentPassword === body.newPassword)
      throw new HttpError(400, 'PASSWORD_UNCHANGED', '新密码需要与当前密码不同');
    const newHash = await hashPassword(body.newPassword);
    const priorTokenHash = hash(req.cookies.xiutu_session ?? '');
    const token = await transaction(db, async (tx) => {
      // Acquire the account fence before taking a session lock. Sign-in and
      // changes from another device cannot issue a session from the old hash.
      const current = (await tx.query(
        "SELECT password_hash FROM users WHERE id=$1 AND status='active' FOR UPDATE",
        [user.id],
      )).rows[0];
      await lockActiveSession(tx, user.id, priorTokenHash);
      if (!current || current.password_hash !== found?.password_hash)
        throw new HttpError(409, 'SESSION_CHANGED', '账号已更新，请重新确认当前登录状态');
      await tx.query(
        'UPDATE users SET password_hash=$2,updated_at=clock_timestamp() WHERE id=$1',
        [user.id, newHash],
      );
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      const replacement = await issueSession(tx, user.id);
      await audit(tx, user.id, 'account.password_changed', 'user', user.id);
      return replacement;
    });
    setSessionCookie(reply, config, token);
    return { ok: true };
  });
  app.post('/v1/auth/logout-others', async (req) => {
    const user = requireUser(req);
    const { expectedUserId } = z.object({ expectedUserId: z.uuid() }).strict().parse(req.body);
    if (user.id !== expectedUserId)
      throw new HttpError(409, 'SESSION_CHANGED', '登录状态已变化，请确认当前账号后继续。');
    const tokenHash = hash(req.cookies.xiutu_session ?? '');
    return transaction(db, async (tx) => {
      // Login locks this user before issuing a session. Serialize concurrent revocations as well.
      await tx.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [user.id]);
      await lockActiveSession(tx, user.id, tokenHash);
      const removed = await tx.query(
        'DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2 AND expires_at>clock_timestamp()',
        [user.id, tokenHash],
      );
      const revoked = removed.rowCount ?? 0;
      if (revoked) await audit(tx, user.id, 'account.logout_others', 'user', user.id, { revoked });
      return { revoked };
    });
  });
  app.post('/v1/auth/logout', async (req, reply) => {
    const token = req.cookies.xiutu_session;
    if (token) await db.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]);
    reply.clearCookie('xiutu_session', {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookie,
    });
    return { ok: true };
  });
}
