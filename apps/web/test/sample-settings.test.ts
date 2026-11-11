import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRecipeV4, type RGBAImage } from '@ai-xiutu/editor';
import { createSampleRecipe } from '../src/about/sample.ts';
import {
  samplePreset,
  resolveSampleSettings,
  changeSampleParameter,
  SAMPLE_PARAMETER_LIMITS,
  type SampleParameter,
} from '../src/about/sample-settings.ts';

const keys = Object.keys(SAMPLE_PARAMETER_LIMITS) as SampleParameter[];
test('each study preset updates all eight visible values as one complete snapshot', () => {
  const natural = samplePreset('natural');
  const vivid = samplePreset('vivid');
  const soft = samplePreset('soft');
  for (const key of keys) {
    assert.notEqual(natural[key], vivid[key], `${key} changes with Vivid`);
    assert.notEqual(natural[key], soft[key], `${key} changes with Soft`);
    assert.equal(typeof natural[key], 'number');
  }
  vivid.exposure = 1;
  assert.equal(samplePreset('vivid').exposure, 0.18);
});

test('manual adjustment removes preset selection without changing the other seven actual values', () => {
  const vivid = samplePreset('vivid');
  const next = changeSampleParameter(vivid, 'exposure', 0.37);
  assert.equal(next.preset, 'custom');
  assert.equal(next.exposure, 0.37);
  for (const key of keys.filter((key) => key !== 'exposure')) assert.equal(next[key], vivid[key]);
  const recipe = createSampleRecipe(next);
  assert.equal(recipe.adjustments.contrast, vivid.contrast);
  assert.equal(recipe.adjustments.saturation, vivid.saturation);
  assert.equal(recipe.detail.clarity, vivid.clarity);
  assert.equal(recipe.adjustments.exposure, 0.37);
});

test('legacy sample entries resolve missing fields while explicit zero overrides a named preset', () => {
  const old = resolveSampleSettings({
    warmth: 18,
    exposure: 0.1,
    preset: 'soft',
    sampleId: 'coast',
  });
  assert.equal(old.warmth, 18);
  assert.equal(old.exposure, 0.1);
  assert.equal(old.sampleId, 'coast');
  assert.equal(typeof old.clarity, 'number');
  const explicit = createSampleRecipe({
    ...samplePreset('vivid'),
    contrast: 0,
    saturation: 0,
    clarity: 0,
  });
  assert.equal(explicit.adjustments.contrast, 0);
  assert.equal(explicit.adjustments.saturation, 0);
  assert.equal(explicit.detail.clarity, 0);
});

test('study controls clamp and quantize finite ranges, including hundredth-EV precision', () => {
  const base = samplePreset('natural');
  assert.equal(changeSampleParameter(base, 'exposure', 0.337).exposure, 0.34);
  assert.equal(changeSampleParameter(base, 'exposure', 12).exposure, 2);
  assert.equal(changeSampleParameter(base, 'shadows', -200).shadows, -100);
  assert.equal(changeSampleParameter(base, 'clarity', Number.NaN).clarity, base.clarity);
});

test('every visible adjustment changes real editor pixels without modifying the source buffer', () => {
  const width = 40,
    height = 30;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      data[index] = Math.round((x / (width - 1)) * 255);
      data[index + 1] = Math.round((y / (height - 1)) * 255);
      data[index + 2] = ((x + y) % 3) * 100;
      data[index + 3] = 255;
    }
  const source: RGBAImage = { width, height, data };
  const unchanged = new Uint8ClampedArray(data);
  const base = resolveSampleSettings({ preset: 'custom', warmth: 0, exposure: 0 });
  const neutral = renderRecipeV4(source, createSampleRecipe(base));
  for (const key of keys) {
    const settings = changeSampleParameter(base, key, key === 'exposure' ? 0.35 : 30);
    const result = renderRecipeV4(source, createSampleRecipe(settings));
    assert.notDeepEqual(
      result.data,
      neutral.data,
      `${key} must affect the pixels, not only a label`,
    );
    assert.equal(result.width, width);
    assert.equal(result.height, height);
  }
  assert.deepEqual(data, unchanged);
});
