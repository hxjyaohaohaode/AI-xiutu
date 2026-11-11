import assert from 'node:assert/strict';
import test from 'node:test';
import { createRasterMask, renderCutout } from '@ai-xiutu/editor';
import { fusePortraitCutoutPrior } from '../src/index.js';

test('matte fusion preserves supported soft edges, fills opaque holes and suppresses distant false foreground', () => {
  const frame = { width: 64, height: 48 };
  const { width, height } = frame;
  const subject = new Uint8Array(width * height);
  const model = new Float32Array(width * height);
  for (let y = 6; y < 40; y++) {
    for (let x = 18; x <= 31; x++) subject[y * width + x] = model[y * width + x] = 1;
    model[y * width + 32] = 0.4;
    model.fill(1, y * width + 45, y * width + 61);
  }
  model[19 * width + 24] = 0;
  const mask = createRasterMask(
    width,
    height,
    subject.map((value) => value * 255),
  );
  const selection = fusePortraitCutoutPrior(model, frame, mask, frame);
  assert.ok(selection);
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const output = renderCutout(
    { ...frame, data: rgba },
    {
      algorithm: 'continuous-alpha-v1',
      selection,
      radius: 0,
      decontaminate: 0,
    },
  );
  const alphaAt = (x: number, y: number) => output.data[4 * (y * width + x) + 3];
  assert.equal(alphaAt(24, 19), 255);
  assert.equal(alphaAt(32, 19), 102);
  assert.equal(alphaAt(46, 19), 0);
});
