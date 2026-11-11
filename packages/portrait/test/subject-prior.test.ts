import test from 'node:test';
import assert from 'node:assert/strict';
import { anchoredSubjectPrior } from '../src/subject-prior.js';

test('anchored matte rejects remote weak texture while keeping hair and a second person', () => {
  const width = 32,
    height = 24;
  const background = new Float32Array(width * height).fill(0.98);
  const classes = new Uint8Array(background.length);
  const pixel = (x: number, y: number, p: number, kind: number) => {
    background[y * width + x] = p;
    classes[y * width + x] = kind;
    return y * width + x;
  };
  for (let y = 6; y < 18; y++) for (let x = 11; x < 20; x++) pixel(x, y, 0.12, 3);
  const nearHair = pixel(10, 7, 0.7, 1);
  const distantTexture = pixel(1, 1, 0.75, 0);
  const detachedProp = pixel(27, 2, 0.2, 5);
  for (let y = 13; y < 20; y++) for (let x = 25; x < 30; x++) pixel(x, y, 0.18, 4);
  const face = [{ x: 15 / width, y: 10 / height }];
  const refined = anchoredSubjectPrior(background, classes, width, height, face);
  assert.equal(refined[distantTexture], 1);
  assert.equal(refined[detachedProp], 1);
  assert.equal(refined[nearHair], background[nearHair]);
  assert.equal(refined[14 * width + 27], background[14 * width + 27]);
  assert.equal(anchoredSubjectPrior(background, classes, width, height, []), background);
});
