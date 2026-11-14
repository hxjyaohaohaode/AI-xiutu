import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defaultAssistantPreferences, assistantPreferencesPatchSchema } from '@ai-xiutu/contracts';
import { transaction, type Database } from '@ai-xiutu/db';
import { hash, HttpError, id, lockActiveSession, lockActiveUser, requireUser } from '../core.js';

type PreferenceRow = {
  version: number; text_model: string; voice_model: string; mode: 'suggest' | 'confirm'; captions: boolean;
};

function prefs(actorId: string, row?: PreferenceRow) {
  return {
    actorId,
    version: row?.version ?? 0,
    value: row ? { textModel: row.text_model, voiceModel: row.voice_model, mode: row.mode, captions: row.captions }
      : defaultAssistantPreferences,
  };
}

export function registerAssistantPreferences(app: FastifyInstance, db: Database) {
  app.get('/v1/me/assistant-preferences', async (req, reply) => {
    const owner = requireUser(req);
    const { rows } = await db.query<PreferenceRow>('SELECT * FROM assistant_preferences WHERE user_id=$1', [owner.id]);
    return reply.header('Cache-Control', 'private, no-store').send(prefs(owner.id, rows[0]));
  });
  app.patch('/v1/me/assistant-preferences', async (req, reply) => {
    const owner = requireUser(req);
    const { actorId, patch, initialize } = z.object({
      actorId: id, patch: assistantPreferencesPatchSchema, initialize: z.boolean().default(false),
    }).strict().parse(req.body);
    if (owner.id !== actorId) throw new HttpError(409, 'SESSION_CHANGED', '账号已改变，请重试。');
    const saved = await transaction(db, async (tx) => {
      await lockActiveUser(tx, owner.id);
      await lockActiveSession(tx, owner.id, hash(req.cookies.xiutu_session ?? ''));
      const values = [actorId, patch.textModel ?? null, patch.voiceModel ?? null, patch.mode ?? null, patch.captions ?? null, initialize];
      const { rows } = await tx.query<PreferenceRow>(
        `INSERT INTO assistant_preferences AS p(user_id,text_model,voice_model,mode,captions)
         VALUES ($1,COALESCE($2,''),COALESCE($3,''),COALESCE($4,'confirm'),COALESCE($5,true))
         ON CONFLICT (user_id) DO UPDATE SET version=p.version+1,
           text_model=COALESCE($2,p.text_model), voice_model=COALESCE($3,p.voice_model),
           mode=COALESCE($4,p.mode), captions=COALESCE($5,p.captions) WHERE NOT $6::boolean
         RETURNING *`, values,
      );
      return prefs(actorId, rows[0] ?? (await tx.query<PreferenceRow>(
        'SELECT * FROM assistant_preferences WHERE user_id=$1', [actorId],
      )).rows[0]);
    });
    return reply.header('Cache-Control', 'private, no-store').send(saved);
  });
}
