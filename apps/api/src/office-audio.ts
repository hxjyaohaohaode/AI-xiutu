import type { FastifyInstance } from 'fastify';
import { transaction, emit, type Database } from '@ai-xiutu/db';
import { z } from 'zod';
import {
  hash,
  HttpError,
  id,
  lockActiveSession,
  lockProjectMutation,
  projectAccess,
  requireUser,
} from './core.js';

const fileLimit = 8 * 1024 * 1024,
  projectLimit = 64 * 1024 * 1024;
type MediaMime = 'audio/wav' | 'audio/mpeg' | 'audio/ogg';
const invalid = () =>
  new HttpError(400, 'OFFICE_AUDIO_INVALID', '请选择 8 MiB 以内的 WAV、MP3 或 Ogg 音频');
const missing = () => new HttpError(404, 'OFFICE_AUDIO_NOT_FOUND', '音频不存在或不可访问');

function wav(buffer: Buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE' ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  )
    return false;
  let format: { block: number } | undefined,
    dataBytes = 0;
  for (let cursor = 12; cursor + 8 <= buffer.length;) {
    const key = buffer.toString('ascii', cursor, cursor + 4),
      length = buffer.readUInt32LE(cursor + 4);
    const start = cursor + 8,
      end = start + length;
    if (end > buffer.length) return false;
    if (key === 'fmt ' && length >= 16) {
      const codec = buffer.readUInt16LE(start),
        channels = buffer.readUInt16LE(start + 2);
      const rate = buffer.readUInt32LE(start + 4),
        block = buffer.readUInt16LE(start + 12);
      const sampleBits = buffer.readUInt16LE(start + 14);
      if (
        (codec !== 1 && codec !== 3) ||
        (channels !== 1 && channels !== 2) ||
        rate < 8000 ||
        rate > 192000 ||
        !(codec === 3 ? [32] : [8, 16, 24, 32]).includes(sampleBits) ||
        block !== (channels * sampleBits) / 8 ||
        buffer.readUInt32LE(start + 8) !== rate * block
      )
        return false;
      format = { block };
    } else if (key === 'data') dataBytes = length;
    cursor = end + (length % 2);
  }
  return !!format && dataBytes > 0 && dataBytes % format.block === 0;
}

function mp3(buffer: Buffer) {
  let start = 0;
  if (buffer.toString('ascii', 0, 3) === 'ID3') {
    if (
      buffer.length < 10 ||
      ![2, 3, 4].includes(buffer[3]!) ||
      buffer.subarray(6, 10).some((byte) => byte >= 128)
    )
      return false;
    start = buffer.subarray(6, 10).reduce((sum, byte) => sum * 128 + byte, 0) + 10;
    if (buffer[3] === 4 && buffer[5]! & 16) start += 10;
  }
  if (start + 96 > buffer.length || buffer[start] !== 0xff) return false;
  const header = buffer[start + 1]!,
    flags = buffer[start + 2]!;
  const version = (header >> 3) & 3,
    layer = (header >> 1) & 3,
    rate = (flags >> 2) & 3,
    bitrate = flags >> 4;
  return (
    (header & 0xe0) === 0xe0 &&
    version !== 1 &&
    layer === 1 &&
    rate < 3 &&
    bitrate > 0 &&
    bitrate < 15
  );
}

function detect(buffer: Buffer): MediaMime | null {
  if (wav(buffer)) return 'audio/wav';
  if (
    buffer.length >= 64 &&
    buffer.toString('ascii', 0, 4) === 'OggS' &&
    buffer[4] === 0 &&
    (buffer[5]! & 2) !== 0
  ) {
    const offset = 27 + buffer[26]!;
    if (
      buffer.toString('ascii', offset, offset + 8) === 'OpusHead' ||
      (buffer[offset] === 1 && buffer.toString('ascii', offset + 1, offset + 7) === 'vorbis')
    )
      return 'audio/ogg';
  }
  return mp3(buffer) ? 'audio/mpeg' : null;
}
const fields = 'id,name,mime,bytes,created_at AS "createdAt"';
export function registerOfficeAudio(app: FastifyInstance, db: Database) {
  app.get('/v1/projects/:id/office-audio', async (req, reply) => {
    const actor = requireUser(req),
      { id: projectId } = z.object({ id }).parse(req.params);
    reply.header('Cache-Control', 'private, no-store');
    return transaction(db, async (tx) => {
      await lockActiveSession(tx, actor.id, hash(req.cookies.xiutu_session ?? ''));
      await projectAccess(tx, projectId, actor.id);
      return {
        files: (
          await tx.query(
            'SELECT ' +
              fields +
              ' FROM office_audio WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100',
            [projectId],
          )
        ).rows,
      };
    });
  });
  app.post(
    '/v1/projects/:id/office-audio',
    { bodyLimit: fileLimit + 16384 },
    async (req, reply) => {
      const actor = requireUser(req),
        { id: projectId } = z.object({ id }).parse(req.params);
      await projectAccess(db, projectId, actor.id, 'edit');
      const file = await req.file({ limits: { files: 1, parts: 1, fileSize: fileLimit + 1 } });
      if (!file) throw invalid();
      const bytes = await file.toBuffer();
      if (!bytes.length || bytes.length > fileLimit || file.file.truncated) throw invalid();
      const mime = detect(bytes);
      if (!mime) throw invalid();
      const name =
        file.filename
          .replace(/[\/\\\x00-\x1f]/g, '_')
          .trim()
          .slice(0, 120) || '音频';
      const digest = hash(bytes);
      const saved = await transaction(db, async (tx) => {
        const project = await lockProjectMutation(
          tx,
          projectId,
          actor.id,
          hash(req.cookies.xiutu_session ?? ''),
        );
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['office-audio:' + projectId]);
        const found = (
          await tx.query(
            'SELECT ' + fields + ' FROM office_audio WHERE project_id=$1 AND sha256=$2',
            [projectId, digest],
          )
        ).rows[0];
        if (found) return { file: found, reused: true };
        const used = (
          await tx.query(
            'SELECT COALESCE(sum(bytes),0) AS used FROM office_audio WHERE project_id=$1',
            [projectId],
          )
        ).rows[0]!;
        if (Number(used.used) + bytes.length > projectLimit)
          throw new HttpError(409, 'OFFICE_AUDIO_CAPACITY', '项目音频已达到 64 MiB 上限');
        const row = (
          await tx.query(
            'INSERT INTO office_audio(project_id,author_id,name,mime,sha256,bytes,contents) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ' +
              fields,
            [projectId, actor.id, name, mime, digest, bytes.length, bytes],
          )
        ).rows[0]!;
        await emit(tx, project.space_id, projectId, 'document.audio_added', row.id);
        return { file: row, reused: false };
      });
      return reply.code(saved.reused ? 200 : 201).send(saved);
    },
  );
  app.get('/v1/office-audio/:id', async (req, reply) => {
    const actor = requireUser(req),
      { id: fileId } = z.object({ id }).parse(req.params);
    const row = await transaction(db, async (tx) => {
      const hint = (await tx.query('SELECT project_id FROM office_audio WHERE id=$1', [fileId]))
        .rows[0];
      if (!hint) throw missing();
      await lockActiveSession(tx, actor.id, hash(req.cookies.xiutu_session ?? ''));
      await projectAccess(tx, hint.project_id, actor.id);
      const media = (
        await tx.query(
          'SELECT mime,bytes,contents FROM office_audio WHERE id=$1 AND project_id=$2',
          [fileId, hint.project_id],
        )
      ).rows[0];
      if (!media) throw missing();
      return media as { mime: MediaMime; bytes: number; contents: Buffer };
    });
    reply
      .type(row.mime)
      .header('Cache-Control', 'private, no-store')
      .header('Accept-Ranges', 'bytes')
      .header('X-Content-Type-Options', 'nosniff');
    if (req.headers.range) {
      const part = /^bytes=(\d{0,12})-(\d{0,12})$/.exec(req.headers.range);
      const valid = part && (part[1] || part[2]);
      const start = valid && (part[1] ? Number(part[1]) : Math.max(0, row.bytes - Number(part[2])));
      const end = part?.[1] && part[2] ? Math.min(row.bytes - 1, Number(part[2])) : row.bytes - 1;
      if (typeof start !== 'number' || start >= row.bytes || end < start)
        return reply
          .code(416)
          .header('Content-Range', 'bytes */' + row.bytes)
          .send();
      return reply
        .code(206)
        .header('Content-Range', 'bytes ' + start + '-' + end + '/' + row.bytes)
        .send(row.contents.subarray(start, end + 1));
    }
    return reply.send(row.contents);
  });
}
