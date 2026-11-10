import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRecipeV4,
  createRasterMask,
  linearToSrgb,
  renderCutout,
  renderEditorRecipe,
  srgbToLinear,
  type RGBAImage,
} from '../src/index.js';

test('wide exposure range agrees with independent linear-light gains at every one-third stop and keeps alpha', () => {
  const image: RGBAImage = { width: 3, height: 1, data: Uint8ClampedArray.of(14, 48, 95, 255, 129, 205, 250, 164, 0, 100, 255, 255) };
  for (let third = -15; third <= 15; third++) {
    const exposure = third / 3;
    const expected = image.data.map((value, at) => at % 4 === 3 ? value : 255 * linearToSrgb(Math.min(1, srgbToLinear(value / 255) * 2 ** exposure)));
    const result = renderEditorRecipe(image, createRecipeV4({ adjustments: { exposure } }));
    for (let at = 0; at < result.data.length; at++) assert.ok(Math.abs(result.data[at]! - expected[at]!) <= 1, `${exposure} EV at channel ${at}`);
  }
  assert.throws(() => createRecipeV4({ adjustments: { exposure: 5.001 } }));
});

test('trimap recovers a known subpixel mixture, preserves hard sides and does not restore transparent alpha', () => {
  const width = 96,
    height = 64;
  const image: RGBAImage = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const confidence = new Uint8Array(width * height);
  const foreground = [212, 41, 72],
    background = [29, 148, 193];
  const mixed = foreground.map(
    (channel, c) =>
      255 *
      linearToSrgb(srgbToLinear(channel / 255) * 0.25 + srgbToLinear(background[c]! / 255) * 0.75),
  );
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      confidence[at] = x < 47 ? 255 : x === 47 ? 128 : 0;
      image.data.set([...(x < 47 ? foreground : x === 47 ? mixed : background), 255], at * 4);
    }
  image.data.set([255, 255, 255, 0], (5 * width + 5) * 4);
  const settings = {
    selection: createRasterMask(width, height, confidence),
    radius: 0.05,
    decontaminate: 1,
  };
  const result = renderCutout(image, settings);
  const at = (x: number, y: number) => (y * width + x) * 4;
  const sample = (x: number, y: number) => [...result.data.subarray(at(x, y), at(x, y) + 4)];
  assert.deepEqual(sample(20, 25), [...foreground, 255]);
  assert.deepEqual(sample(70, 25), [0, 0, 0, 0]);
  assert.deepEqual(sample(5, 5), [0, 0, 0, 0]);
  assert.ok(Math.abs(sample(47, 25)[3]! - 64) < 5);
  assert.ok(sample(47, 25)[0]! > image.data[at(47, 25)]!);
  assert.equal(image.data[at(70, 25) + 3], 255);
  const full = createRasterMask(1, 1, Uint8Array.of(255));
  assert.throws(
    () => renderCutout(image, { ...settings, foreground: full, background: full }),
    /overlap/,
  );
  const stop = new AbortController();
  stop.abort();
  assert.throws(() => renderCutout(image, settings, { signal: stop.signal }), /abort/i);
});
