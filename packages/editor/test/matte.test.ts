import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRecipeV4,
  createCutoutAlphaPrior,
  createCutoutTrimap,
  createRasterMask,
  linearToSrgb,
  renderCutout,
  renderEditorRecipe,
  parseCutoutSelection,
  srgbToLinear,
  type RGBAImage,
} from '../src/index.js';
import { findMatteAnchors, findVisibleMatteAnchors } from '../src/matte-anchors.js';

test('the first hard boundary blocks farther matte samples in each ray', () => {
  const width = 7;
  const height = 1;
  const image = { width, height, data: new Uint8ClampedArray(width * 4).fill(255) };
  const labels = Float32Array.of(1, 0, 0.5, 0.5, 0.5, 1, 0);
  const rays = findVisibleMatteAnchors(image, labels, labels, 6, {});
  assert.deepEqual([...rays.samples.subarray(0, 2)], [2, 6]);
  image.data[7] = 0;
  const blocked = findVisibleMatteAnchors(image, labels, labels, 6, {});
  assert.deepEqual([...blocked.samples.subarray(0, 2)], [0, 6]);
});

test('native trimaps retain more than 4,096 runs and reject source dimension mismatches', () => {
  const width = 96;
  const height = 64;
  const weights = Uint8Array.from({ length: width * height }, (_, i) => [0, 128, 255][i % 3]!);
  assert.throws(() => createRasterMask(width, height, weights), /run budget/);
  const selection = createCutoutTrimap(width, height, weights);
  assert.equal(selection.runs.length, width * height);
  const image = { width, height, data: new Uint8ClampedArray(weights.length * 4).fill(255) };
  const settings = { selection, algorithm: 'guided-v4', radius: 0, decontaminate: 0 } as const;
  const output = renderCutout(image, settings);
  assert.deepEqual(
    output.data.filter((_, at) => at % 4 === 3),
    new Uint8ClampedArray(weights),
  );
  assert.throws(
    () =>
      renderCutout(image, {
        ...settings,
        selection: { ...selection, width: height, height: width },
      }),
    /dimensions must match/,
  );
  assert.throws(
    () => renderCutout(image, { ...settings, selection: { ...selection, runs: [4, 4] } }),
    /adjacent runs must differ/,
  );
});

test('continuous alpha keeps the full byte range, original alpha, and explicit occluder paint', () => {
  const frame = { width: 5, height: 1 };
  const data = Uint8ClampedArray.from([
    15, 36, 114, 255, 15, 36, 114, 255, 15, 36, 114, 128, 15, 36, 114, 255, 15, 36, 114, 255,
  ]);
  const selection = createCutoutAlphaPrior(frame, frame, Uint8Array.of(0, 1, 128, 254, 255));
  const settings = {
    selection,
    algorithm: 'continuous-alpha-v1',
    radius: 0,
    decontaminate: 0.8,
  } as const;
  const image = { ...frame, data };
  const unpainted = renderCutout(image, settings);
  assert.deepEqual([...unpainted.data.filter((_, at) => at % 4 === 3)], [0, 1, 64, 254, 255]);
  const painted = renderCutout(image, {
    ...settings,
    foreground: createRasterMask(5, 1, Uint8Array.of(255, 0, 0, 0, 0)),
    background: createRasterMask(5, 1, Uint8Array.of(0, 0, 0, 0, 255)),
  });
  assert.deepEqual([...painted.data.subarray(0, 4)], [15, 36, 114, 255]);
  assert.deepEqual([...painted.data.subarray(16, 20)], [0, 0, 0, 0]);
  assert.throws(() => parseCutoutSelection(selection, 'guided-v5'), /requires continuous-alpha/);
  assert.throws(
    () => renderCutout({ ...image, width: 1, height: 5 }, settings),
    /dimensions must match/,
  );
  const unit = createCutoutAlphaPrior(frame, { width: 1, height: 1 }, Uint8Array.of(0));
  assert.throws(
    () => parseCutoutSelection({ ...unit, alpha: 'AB==' }, settings.algorithm),
    /canonical base64/,
  );
  assert.throws(
    () => parseCutoutSelection({ ...unit, alpha: 'AA=\n' }, settings.algorithm),
    /canonical base64/,
  );
});

test('wide exposure range agrees with independent linear-light gains at every one-third stop and keeps alpha', () => {
  const image: RGBAImage = {
    width: 3,
    height: 1,
    data: Uint8ClampedArray.of(14, 48, 95, 255, 129, 205, 250, 164, 0, 100, 255, 255),
  };
  for (let third = -15; third <= 15; third++) {
    const exposure = third / 3;
    const expected = image.data.map((value, at) =>
      at % 4 === 3
        ? value
        : 255 * linearToSrgb(Math.min(1, srgbToLinear(value / 255) * 2 ** exposure)),
    );
    const result = renderEditorRecipe(image, createRecipeV4({ adjustments: { exposure } }));
    for (let at = 0; at < result.data.length; at++)
      assert.ok(Math.abs(result.data[at]! - expected[at]!) <= 1, `${exposure} EV at channel ${at}`);
  }
  assert.throws(() => createRecipeV4({ adjustments: { exposure: 5.001 } }));
});

test('RGB guided matte refines downsampled fine strands and crossing occlusion with an independent linear composite ground truth', () => {
  const width = 256,
    height = 192;
  const truth = new Uint8Array(width * height),
    prior = new Uint8Array(width * height);
  const image: RGBAImage = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // Wispy edge with alternating isolated strands and a diagonal occluder.
      const edge = 117 + 10 * Math.sin(y / 12);
      const strand = x > edge && x < edge + 25 && Math.abs(((y + x * 0.13) % 8) - 4) < 0.85;
      const cover = y > 97 && y < 105 && x > 55;
      const alpha = cover ? 0 : Math.min(1, Math.max(0, edge - x + 0.5 + (strand ? 25 : 0)));
      const i = y * width + x;
      truth[i] = alpha * 255;
      prior[i] =
        (cover ? Math.max(0, (Math.abs(y - 101) - 1) / 5) : 1) *
        Math.min(1, Math.max(0, (edge + 7 - x) / 14)) *
        255;
      // Two chromatic colors with close luminance make scalar edge guidance insufficient.
      const fg = [0.03, 0.17, 0.06],
        bg = [0.32, 0.09, 0.21];
      for (let c = 0; c < 3; c++)
        image.data[i * 4 + c] = 255 * linearToSrgb(fg[c]! * alpha + bg[c]! * (1 - alpha));
      image.data[i * 4 + 3] = 255;
    }
  const selection = createRasterMask(width, height, prior);
  const settings = { selection, radius: 0.05, decontaminate: 0 };
  const baseline = renderCutout(image, { ...settings, algorithm: 'ray-v1' });
  const result = renderCutout(image, { ...settings, algorithm: 'guided-v2' });
  let before = 0,
    after = 0;
  for (let i = 0; i < truth.length; i++) {
    before += Math.abs(baseline.data[i * 4 + 3]! - truth[i]!);
    after += Math.abs(result.data[i * 4 + 3]! - truth[i]!);
    if (result.data[i * 4 + 3])
      for (let c = 0; c < 3; c++) assert.equal(result.data[i * 4 + c], image.data[i * 4 + c]);
  }
  assert.ok(after < before, `alpha SAD ${before} -> ${after}`);
  for (let i = 0; i < prior.length; i++) {
    if (prior[i]! <= 8)
      assert.equal(
        result.data[i * 4 + 3],
        0,
        'confident semantic background cannot become a new hair',
      );
    if (prior[i]! >= 247)
      assert.equal(result.data[i * 4 + 3], 255, 'confident semantic foreground is retained');
  }
  assert.deepEqual(renderCutout(image, { ...settings, algorithm: 'guided-v2' }), result);
});

test('guided matte respects explicit trimap paint, non-opaque sources, empty/full selections and cancellation', () => {
  const width = 17,
    height = 9,
    data = new Uint8ClampedArray(width * height * 4).fill(127);
  const source: RGBAImage = { width, height, data };
  const full = createRasterMask(1, 1, Uint8Array.of(255)),
    empty = createRasterMask(1, 1, Uint8Array.of(0));
  const settings = {
    algorithm: 'guided-v2' as const,
    selection: full,
    radius: 0.05,
    decontaminate: 1,
  };
  assert.deepEqual(renderCutout(source, settings).data, data);
  assert.ok(renderCutout(source, { ...settings, selection: empty }).data.every((v) => v === 0));
  assert.deepEqual(
    renderCutout(source, { ...settings, selection: empty, foreground: full }).data,
    data,
  );
  assert.ok(renderCutout(source, { ...settings, background: full }).data.every((v) => v === 0));
  const stop = new AbortController();
  stop.abort();
  assert.throws(() => renderCutout(source, settings, { signal: stop.signal }), /abort/i);
});

test('matte anchors follow a strand around a corner and stop at confirmed occlusion', () => {
  const width = 64,
    height = 48,
    data = new Uint8ClampedArray(width * height * 4).fill(255),
    labels = new Float32Array(width * height),
    at = (x: number, y: number) => y * width + x;
  const image = { width, height, data };
  for (let x = 10; x <= 20; x++) labels[at(x, 20)] = 0.5;
  for (let y = 10; y < 20; y++) labels[at(20, y)] = 0.5;
  labels[at(20, 10)] = 1;
  const target = at(10, 20);
  assert.equal(findMatteAnchors(image, labels, 24, {})[1][target], at(20, 10));
  labels[at(20, 17)] = 0;
  assert.equal(findMatteAnchors(image, labels, 24, {})[1][target], -1);
  const coverage = Uint8Array.from(labels, (label) => Math.round(label * 255));
  const excluded = new Uint8Array(labels.length);
  excluded[target] = 255;
  const output = renderCutout(image, {
    algorithm: 'guided-v4',
    selection: createRasterMask(width, height, coverage),
    background: createRasterMask(width, height, excluded),
    radius: 0.05,
    decontaminate: 1,
  });
  assert.equal(output.data[target * 4 + 3], 0);
  assert.equal(output.data[at(20, 10) * 4 + 3], 255);
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
