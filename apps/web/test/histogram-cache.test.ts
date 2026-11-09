import assert from 'node:assert/strict';
import test from 'node:test';
import type { RGBAImage } from '@ai-xiutu/editor';
import { sharedHistogram } from '../src/editor/histogram-cache.js';

test('two consumers of the same immutable preview share its exact histogram allocation', () => {
  const image: RGBAImage = {
    width: 3,
    height: 1,
    data: Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0),
  };
  const before = image.data.slice();
  const panel = sharedHistogram(image),
    curve = sharedHistogram(image);
  assert.ok(panel);
  assert.equal(panel, curve);
  assert.equal(panel.red, curve!.red);
  assert.equal(panel.pixelCount, 2);
  assert.equal(panel.red[255], 1);
  assert.equal(panel.red[0], 1);
  assert.equal(panel.green[255], 1);
  assert.equal(panel.blue[0], 2);
  assert.equal(panel.blue[255], 0);
  assert.equal(panel.luminance[54], 1);
  assert.equal(panel.luminance[182], 1);
  assert.deepEqual(image.data, before);
});

test('new frame identity recomputes independently and never returns the preceding frame counts', () => {
  const dark: RGBAImage = { width: 1, height: 1, data: Uint8ClampedArray.of(0, 0, 0, 255) };
  const bright: RGBAImage = { width: 1, height: 1, data: Uint8ClampedArray.of(255, 255, 255, 255) };
  const first = sharedHistogram(dark),
    next = sharedHistogram(bright);
  assert.ok(first && next);
  assert.notEqual(first, next);
  assert.equal(first.luminance[0], 1);
  assert.equal(next.luminance[255], 1);
  assert.equal(next.luminance[0], 0);
  assert.equal(sharedHistogram(dark), first);
  assert.notEqual(sharedHistogram({ ...dark, data: dark.data.slice() }), first);
});

test('absent frames remain absent without creating placeholder counts or mutating a cached result', () => {
  assert.equal(sharedHistogram(null), null);
  const transparent: RGBAImage = {
    width: 1,
    height: 1,
    data: Uint8ClampedArray.of(255, 255, 255, 0),
  };
  const result = sharedHistogram(transparent)!;
  assert.equal(result.pixelCount, 0);
  assert.equal(
    result.red.reduce((a, b) => a + b, 0),
    0,
  );
  assert.ok(Object.isFrozen(result));
  assert.equal(sharedHistogram(null), null);
  assert.equal(sharedHistogram(transparent), result);
});
