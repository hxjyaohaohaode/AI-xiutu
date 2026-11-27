import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { createMaskedOutput } from '../src/masked-output.js';

test('an aligned masked edit preserves opaque source pixels and feathers RGBA boundaries', async () => {
  const png = (rgba: number[]) => sharp(Buffer.from(rgba), { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer();
  const original = await png(Array(4).fill([100, 40, 200, 255]).flat());
  const generated = await png(Array(4).fill([200, 80, 100, 128]).flat());
  const mask = await png([255, 0, 128, 255].flatMap((a) => [0, 0, 0, a]));
  const apply = await createMaskedOutput(original, mask, 4, 1, 4);
  const bytes = await sharp(await apply(generated)).raw().toBuffer();
  assert.deepEqual([...bytes], [100,40,200,255, 200,80,100,128, 133,53,167,192, 100,40,200,255]);
  const incorrect = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'white' } }).png().toBuffer();
  await assert.rejects(apply(incorrect), /COORDINATES/);
});
