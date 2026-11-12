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

test('matte fusion clears connected background through a narrow gap and preserves distinct hair', () => {
  const frame = { width: 64, height: 48 };
  const { width, height } = frame;
  const subject = new Uint8Array(width * height);
  const model = new Float32Array(width * height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const paint = (at: number, red: number, green: number, blue: number) =>
    rgba.set([red, green, blue, 255], at * 4);
  for (let at = 0; at < model.length; at++) paint(at, 107, 167, 212);
  for (let y = 6; y < 40; y++) {
    for (const x of [17, 18, 19, 20, 21, 29, 30, 31, 32, 33]) {
      const at = y * width + x;
      subject[at] = 255;
      paint(at, 210, 131, 96);
    }
    model.fill(1, y * width + 17, y * width + 34);
    const hair = y * width + 16;
    model[hair] = 0.4;
    paint(hair, 129, 105, 74);
  }
  const mask = createRasterMask(width, height, subject);
  const prior = fusePortraitCutoutPrior(model, frame, mask, frame, rgba);
  assert.ok(prior);
  const output = renderCutout(
    { ...frame, data: rgba },
    { algorithm: 'continuous-alpha-v1', selection: prior, radius: 0, decontaminate: 0 },
  );
  const alphaAt = (x: number, y: number) => output.data[(y * width + x) * 4 + 3]!;
  assert.ok(alphaAt(25, 10) < 13);
  assert.equal(alphaAt(16, 22), 102);
  assert.equal(alphaAt(29, 10), 255);
});
