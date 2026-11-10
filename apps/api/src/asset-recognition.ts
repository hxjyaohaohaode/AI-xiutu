import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import sharp from 'sharp';
import {
  recognitionRequest,
  type AssetRecognition,
  type RecognizedWord,
} from '@ai-xiutu/contracts';
import { emit, transaction, type Database } from '@ai-xiutu/db';
import {
  hash,
  HttpError,
  id,
  lockProjectMutation,
  projectAccess,
  rateLimit,
  requireUser,
} from './core.js';
import { findProcessAsset, verifiedAssetBytes } from './asset-processing.js';
import type { LocalPrivateStorage } from './storage.js';

const maxPixels = 8_388_608;
const maxWords = 2500;
const maxText = 48_000;
const timeout = 18_000;
let running = false;
let languages: Promise<{ engine: string; languages: string[] } | null> | undefined;

function native(args: string[], input?: Buffer, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'tesseract',
      args,
      {
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        signal,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TESSDATA_PREFIX: process.env.TESSDATA_PREFIX,
          OMP_THREAD_LIMIT: '1',
        },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

function runtime() {
  return (languages ??= Promise.all([native(['--version']), native(['--list-langs'])])
    .then(async ([version, list]) => {
      const match = /^tesseract\s+([\w.-]{1,60})/m.exec(version);
      if (!match) return null;
      const supported = list
        .split(/\r?\n/)
        .filter((lang) => ['eng', 'chi_sim'].includes(lang))
        .sort();
      const dataDirectory =
        /^Available languages in "([^"]+)"/m.exec(list)?.[1] ?? process.env.TESSDATA_PREFIX;
      const models = dataDirectory
        ? await Promise.all(
            supported.map(async (language) => {
              const weights = await readFile(join(dataDirectory, `${language}.traineddata`)).catch(
                () => null,
              );
              return `${language}:${weights ? hash(weights) : 'unknown'}`;
            }),
          )
        : supported;
      return {
        engine: `tesseract-${match[1]}-tsv-v3-${hash(models.join('|')).slice(0, 12)}`,
        languages: supported,
      };
    })
    .catch(() => null));
}

const appendWord = (before: string, next: string) =>
  before + (/\p{Script=Han}$/u.test(before) && /^\p{Script=Han}/u.test(next) ? '' : ' ') + next;

export function readTesseractWords(tsv: string, width: number, height: number): RecognizedWord[] {
  const words: RecognizedWord[] = [];
  for (const row of tsv.split(/\r?\n/)) {
    const fields = row.split('\t');
    if (fields.length < 12 || fields[0] !== '5') continue;
    const [left, top, w, h] = fields.slice(6, 10).map(Number);
    const confidence = Number(fields[10]);
    const text = fields
      .slice(11)
      .join(' ')
      .trim()
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 250);
    const groups = fields.slice(1, 5).map(Number);
    if (
      !text ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 100 ||
      !groups.every((value) => Number.isSafeInteger(value) && value >= 0) ||
      left === undefined ||
      top === undefined ||
      w === undefined ||
      h === undefined ||
      ![left, top, w, h].every(Number.isSafeInteger) ||
      left < 0 ||
      top < 0 ||
      w <= 0 ||
      h <= 0 ||
      left + w > width ||
      top + h > height
    )
      continue;
    words.push({
      text,
      confidence,
      box: { left, top, width: w, height: h },
      line: groups.join('.'),
    });
    if (words.length > maxWords)
      throw new HttpError(413, 'OCR_RESULT_BUDGET', '识别结果过长，请按区域分段处理');
  }
  return words;
}

function quality(words: RecognizedWord[]) {
  let chars = 0;
  let certainty = 0;
  for (const word of words) {
    const length = Array.from(word.text).length;
    chars += length;
    certainty += word.confidence * length;
  }
  return { chars, confidence: chars ? certainty / chars : 0 };
}

function reprojectWords(
  words: RecognizedWord[],
  preview: { width: number; height: number },
  source: { width: number; height: number },
) {
  const sx = source.width / preview.width,
    sy = source.height / preview.height;
  return words.map((word) => {
    const box = word.box;
    const left = Math.floor(box.left * sx),
      top = Math.floor(box.top * sy);
    const right = Math.min(source.width, Math.ceil((box.left + box.width) * sx));
    const bottom = Math.min(source.height, Math.ceil((box.top + box.height) * sy));
    return { ...word, box: { left, top, width: right - left, height: bottom - top } };
  });
}

/** Infer consistent columns only when separate gaps recur across rows. Otherwise keep the word geometry. */
export function inferOcrTable(words: RecognizedWord[]): AssetRecognition['table'] {
  if (words.length < 4) return null;
  const used = words.filter((word) => word.confidence >= 35);
  const sizes = used.map((word) => word.box.height).sort((a, b) => a - b);
  const typical = sizes[Math.floor(sizes.length / 2)];
  if (!typical) return null;
  const lines: { y: number; words: RecognizedWord[] }[] = [];
  for (const word of [...used].sort(
    (a, b) => a.box.top + a.box.height / 2 - b.box.top - b.box.height / 2,
  )) {
    const y = word.box.top + word.box.height / 2;
    const current = lines.at(-1);
    if (current && y - current.y <= typical * 0.48) current.words.push(word);
    else lines.push({ y, words: [word] });
  }
  const cells = lines.map(({ words }) => {
    const row: { left: number; right: number; text: string }[] = [];
    for (const word of words.sort((a, b) => a.box.left - b.box.left)) {
      const end = word.box.left + word.box.width;
      const previous = row.at(-1);
      if (previous && word.box.left - previous.right < typical * 0.85) {
        previous.text = appendWord(previous.text, word.text);
        previous.right = Math.max(previous.right, end);
      } else row.push({ left: word.box.left, right: end, text: word.text });
    }
    return row;
  });
  const substantial = cells.filter((row) => row.length >= 2);
  if (substantial.length < 2 || substantial.length < cells.length / 2 || cells.length > 100)
    return null;
  const anchors: { x: number; count: number; lastRow: number }[] = [];
  substantial.forEach((row, index) =>
    row.forEach(({ left }) => {
      const found = anchors.find(
        (entry) => Math.abs(entry.x - left) <= typical * 1.1 && entry.lastRow !== index,
      );
      if (found) {
        found.x = (found.x * found.count + left) / (found.count + 1);
        found.count++;
        found.lastRow = index;
      } else anchors.push({ x: left, count: 1, lastRow: index });
    }),
  );
  const columns = anchors
    .filter((entry) => entry.count >= Math.max(2, substantial.length / 2))
    .sort((a, b) => a.x - b.x);
  if (columns.length < 2 || columns.length > 20) return null;
  const output: (string | null)[][] = [];
  for (const row of cells) {
    const result: (string | null)[] = Array(columns.length).fill(null);
    for (const cell of row) {
      const at = columns.findIndex((column) => Math.abs(column.x - cell.left) <= typical * 1.1);
      if (at < 0 || result[at] !== null) return null;
      result[at] = cell.text;
    }
    output.push(result);
  }
  return { columns: columns.length, rows: output };
}

function dto(row: Record<string, any>): AssetRecognition {
  return {
    id: row.id,
    sourceHash: row.source_hash,
    engine: row.engine,
    preprocessing: row.preprocessing,
    language: row.language,
    layout: row.layout,
    width: row.width,
    height: row.height,
    words: row.words,
    text: row.text_content,
    table: row.table_result,
    createdAt: row.created_at.toISOString(),
  };
}

export function registerAssetRecognition(
  app: FastifyInstance,
  db: Database,
  storage: LocalPrivateStorage,
) {
  app.get('/v1/asset-processing/capabilities', async () => {
    const ocr = await runtime();
    return {
      recognition: { engine: ocr?.engine ?? null, languages: ocr?.languages ?? [], maxPixels },
      animation: {
        formats: ['gif'],
        maxFrames: 120,
        maxFramePixels: 2_097_152,
        maxTotalPixels: 12_582_912,
        maxBytes: 16 * 1024 * 1024,
      },
    };
  });
  async function access(req: FastifyRequest, permission: 'read' | 'edit') {
    const user = requireUser(req);
    const asset = await findProcessAsset(db, z.object({ id }).parse(req.params).id);
    await projectAccess(db, asset.project_id, user.id, permission);
    return { user, asset };
  }
  app.get('/v1/assets/:id/recognitions', async (req, reply) => {
    const { asset } = await access(req, 'read');
    const rows = (
      await db.query(
        'SELECT * FROM asset_recognitions WHERE asset_id=$1 AND source_hash=$2 ORDER BY created_at DESC,id DESC LIMIT 12',
        [asset.id, asset.content_hash],
      )
    ).rows;
    return reply.header('Cache-Control', 'private, no-store').send({ recognitions: rows.map(dto) });
  });
  app.delete('/v1/assets/:id/recognitions/:recognitionId', async (req) => {
    const { user, asset } = await access(req, 'edit');
    const { recognitionId } = z.object({ recognitionId: id }).parse(req.params);
    await transaction(db, async (tx) => {
      const project = await lockProjectMutation(
        tx,
        asset.project_id,
        user.id,
        hash(req.cookies.xiutu_session ?? ''),
      );
      if (
        !(
          await tx.query('DELETE FROM asset_recognitions WHERE asset_id=$1 AND id=$2', [
            asset.id,
            recognitionId,
          ])
        ).rowCount
      )
        throw new HttpError(404, 'RECOGNITION_NOT_FOUND', '识别结果不存在');
      await emit(tx, project.space_id, project.id, 'asset.updated', asset.id);
    });
    return { ok: true };
  });
  app.post('/v1/assets/:id/recognitions', async (req, reply) => {
    const { user, asset } = await access(req, 'edit');
    const body = recognitionRequest.parse(req.body);
    await rateLimit(db, `asset-ocr:${user.id}`, 12, 60);
    if (asset.width * asset.height > maxPixels)
      throw new HttpError(413, 'OCR_RASTER_BUDGET', '识别图片超过当前像素预算');
    const ocr = await runtime();
    if (!ocr || body.language.split('+').some((language) => !ocr.languages.includes(language)))
      throw new HttpError(503, 'OCR_UNAVAILABLE', '此服务未配置所选语言的 OCR 识别包');
    const key = [asset.id, asset.content_hash, ocr.engine, body.language, body.layout];
    const current = (
      await db.query(
        'SELECT * FROM asset_recognitions WHERE asset_id=$1 AND source_hash=$2 AND engine=$3 AND language=$4 AND layout=$5',
        key,
      )
    ).rows[0];
    if (current)
      return reply
        .header('Cache-Control', 'private, no-store')
        .send({ recognition: dto(current), reused: true });
    if (running) throw new HttpError(503, 'OCR_BUSY', '识别正在处理其他图片');
    running = true;
    const cancel = new AbortController();
    const stop = () => cancel.abort();
    req.raw.once('aborted', stop);
    req.raw.socket.once('close', stop);
    let words: RecognizedWord[];
    let preprocessing: AssetRecognition['preprocessing'] = 'original';
    const deadline = Date.now() + timeout;
    try {
      const bytes = await verifiedAssetBytes(storage, asset);
      const image = sharp(bytes, { limitInputPixels: maxPixels, failOn: 'warning' });
      const metadata = await image.metadata();
      if (
        metadata.format !== 'png' ||
        metadata.width !== asset.width ||
        metadata.height !== asset.height
      )
        throw new HttpError(409, 'OCR_SOURCE_CHANGED', '图片与素材来源记录不一致');
      const grayscale = image.flatten({ background: '#ffffff' }).grayscale();
      const png = await grayscale.clone().png().toBuffer();
      const psm = body.layout === 'auto' ? '3' : body.layout === 'block' ? '6' : '11';
      const args = [
        'stdin',
        'stdout',
        '-l',
        body.language,
        '--oem',
        '1',
        '--psm',
        psm,
        '-c',
        'tessedit_create_tsv=1',
      ];
      const tsv = await native(args, png, cancel.signal).catch(() => {
        throw new HttpError(422, 'OCR_FAILED', '文字识别中止或未能完成');
      });
      words = readTesseractWords(tsv, asset.width, asset.height);
      const baseQuality = quality(words);
      const heights = words.map((word) => word.box.height).sort((a, b) => a - b);
      const typical = heights[Math.floor(heights.length / 2)] ?? 0;
      if (baseQuality.confidence < 79 && typical >= 40 && Date.now() < deadline - 1500) {
        const width = Math.max(1, Math.round(asset.width * 0.68));
        const resized = await grayscale
          .clone()
          .resize({ width })
          .threshold(155)
          .png()
          .toBuffer({ resolveWithObject: true });
        const signal = AbortSignal.any([
          cancel.signal,
          AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        ]);
        const fallback = await native(args, resized.data, signal).catch(() => null);
        if (fallback) {
          const candidate = readTesseractWords(fallback, resized.info.width, resized.info.height);
          const improved = quality(candidate);
          if (
            improved.chars >= baseQuality.chars * 0.72 &&
            improved.confidence >= baseQuality.confidence + 6
          ) {
            words = reprojectWords(candidate, resized.info, asset);
            preprocessing = 'contrast-resampled';
          }
        }
      }
      if (cancel.signal.aborted) throw new HttpError(408, 'OCR_CANCELLED', '文字识别已取消');
    } finally {
      req.raw.off('aborted', stop);
      req.raw.socket.off('close', stop);
      running = false;
    }
    const lines = new Map<string, string[]>();
    for (const word of words) {
      const line = lines.get(word.line) ?? [];
      line.push(word.text);
      lines.set(word.line, line);
    }
    const text = [...lines.values()].map((line) => line.reduce(appendWord)).join('\n');
    if (text.length > maxText)
      throw new HttpError(413, 'OCR_RESULT_BUDGET', '识别文本过长，请按区域分段处理');
    const table = body.layout === 'table' ? inferOcrTable(words) : null;
    const result = await transaction(db, async (tx) => {
      const project = await lockProjectMutation(
        tx,
        asset.project_id,
        user.id,
        hash(req.cookies.xiutu_session ?? ''),
      );
      if (
        !(
          await tx.query(
            'SELECT id FROM assets WHERE id=$1 AND content_hash=$2 AND deleted_at IS NULL FOR SHARE',
            key.slice(0, 2),
          )
        ).rowCount
      )
        throw new HttpError(409, 'OCR_SOURCE_CHANGED', '识别期间来源素材已改变');
      const row = (
        await tx.query(
          `INSERT INTO asset_recognitions(asset_id,source_hash,engine,language,layout,width,height,text_content,words,table_result,created_by,preprocessing)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(asset_id,source_hash,engine,language,layout) DO NOTHING RETURNING *`,
          [
            ...key,
            asset.width,
            asset.height,
            text,
            JSON.stringify(words),
            table ? JSON.stringify(table) : null,
            user.id,
            preprocessing,
          ],
        )
      ).rows[0];
      if (!row) {
        const existing = (
          await tx.query(
            'SELECT * FROM asset_recognitions WHERE asset_id=$1 AND source_hash=$2 AND engine=$3 AND language=$4 AND layout=$5',
            key,
          )
        ).rows[0];
        return { recognition: dto(existing!), reused: true };
      }
      await emit(tx, project.space_id, project.id, 'asset.updated', asset.id);
      return { recognition: dto(row), reused: false };
    });
    return reply
      .code(result.reused ? 200 : 201)
      .header('Cache-Control', 'private, no-store')
      .send(result);
  });
}
