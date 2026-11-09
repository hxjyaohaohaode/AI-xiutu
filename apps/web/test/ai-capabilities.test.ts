import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allowedImageSizes,
  imageBatchError,
  defaultImageOptions,
  imageOptionsError,
  imagePointQuote,
  imageSizeError,
  requestImageOptions,
} from '../src/ai/capabilities.ts';
import type { AIModel, ImageCapabilities } from '../src/ai/types.ts';
const unsupported = { supported: false, reason: '未开放' };
function model(): AIModel {
  const parameterCapabilities: ImageCapabilities = {
    quality: { supported: true, values: ['auto', 'low', 'max'], default: 'auto' },
    background: { supported: true, values: ['auto', 'opaque', 'transparent'], default: 'auto' },
    outputFormat: { supported: true, values: ['png', 'jpeg', 'webp'], default: 'png' },
    outputCompression: {
      supported: true,
      min: 0,
      max: 100,
      default: 100,
      formats: ['jpeg', 'webp'],
    },
    n: { supported: true, min: 1, max: 4, default: 1 },
    complexity: unsupported,
    references: {
      supported: true,
      maxCount: 3,
      maxBytes: 10_000_000,
      allowMask: true,
      allowMarkup: false,
    },
    size: {
      supported: true,
      multipleOf: 16,
      minPixels: 655_360,
      maxPixels: 8_294_400,
      maxDimension: 3840,
      minAspectRatio: 1 / 3,
      maxAspectRatio: 3,
      auto: false,
    },
    inputFidelity: unsupported,
    stream: unsupported,
    partialImages: unsupported,
    svg: unsupported,
    gif: unsupported,
    dependencies: [],
  };
  return {
    id: 'test-image',
    label: '测试模型',
    provider: 'openai',
    operations: ['generate-image'],
    enabled: true,
    minWidth: 64,
    maxWidth: 8192,
    minHeight: 64,
    maxHeight: 8192,
    minPixels: 655_360,
    maxPixels: 8_294_400,
    maxDimension: 3840,
    minAspectRatio: 1 / 3,
    maxAspectRatio: 3,
    parameterCapabilities,
    pricing: {
      unit: 'service-point',
      per: 'image',
      defaultPerImage: 40,
      qualityPerImage: { max: 75 },
    },
  };
}
test('image dimensions use all returned limits, including discrete lists and custom step', () => {
  const m = model();
  assert.equal(imageSizeError(m, 3840, 2160), null);
  assert.ok(imageSizeError(m, 3841, 2160));
  assert.ok(imageSizeError(m, 1537, 1024));
  assert.ok(imageSizeError(m, 3840, 1024));
  assert.ok(imageSizeError(m, 640, 640));
  m.parameterCapabilities!.size.allowedSizes = ['1024x1024', '1536x1024'];
  assert.ok(imageSizeError(m, 3840, 2160));
  assert.deepEqual(allowedImageSizes(m), [
    { width: 1024, height: 1024 },
    { width: 1536, height: 1024 },
  ]);
});
test('platform or operator narrower bounds cannot be bypassed by a provider profile', () => {
  const m = model();
  m.maxPixels = 1_572_864;
  m.maxWidth = 1536;
  m.maxHeight = 1536;
  assert.equal(imageSizeError(m, 1536, 1024), null);
  assert.ok(imageSizeError(m, 1536, 1536));
  assert.ok(imageSizeError(m, 3840, 2160));
  delete m.maxPixels;
  assert.ok(imageSizeError(m, 1024, 1024), 'missing capacity fails closed');
});
test('unsupported fields and PNG compression are absent from outgoing options', () => {
  const m = model(),
    defaults = defaultImageOptions(m);
  assert.deepEqual(requestImageOptions(m, { ...defaults, complexity: 'high' }), {
    quality: 'auto',
    background: 'auto',
    outputFormat: 'png',
    n: 1,
  });
  assert.equal(
    requestImageOptions({ ...m, parameterCapabilities: undefined }, defaults),
    undefined,
  );
  assert.deepEqual(
    requestImageOptions(m, { ...defaults, outputFormat: 'webp', outputCompression: 72 }),
    { quality: 'auto', background: 'auto', outputFormat: 'webp', n: 1, outputCompression: 72 },
  );
});
test('transparent JPEG, excessive outputs and invalid compression are visible failures', () => {
  const m = model(),
    o = defaultImageOptions(m);
  assert.ok(imageOptionsError(m, { ...o, background: 'transparent', outputFormat: 'jpeg' }));
  assert.ok(imageOptionsError(m, { ...o, n: 5 }));
  assert.ok(imageOptionsError(m, { ...o, n: 1.5 }));
  assert.ok(imageOptionsError(m, { ...o, outputFormat: 'webp', outputCompression: 101 }));
  assert.equal(imageOptionsError(m, { ...o, outputFormat: 'webp', outputCompression: 0 }), null);
});
test('displayed service points include quality price and exact output count', () => {
  const m = model();
  assert.equal(imagePointQuote(m, { quality: 'max', n: 3 }), 225);
  assert.equal(imagePointQuote(m, { quality: 'low', n: 2 }), 80);
  assert.equal(imagePointQuote(m, { quality: 'max', n: NaN }), null);
  assert.equal(
    imagePointQuote({ ...m, pricing: undefined, pointsPerPlan: undefined }, { n: 1 }),
    null,
  );
});

test('batch budget includes every selected image and enforces the transaction point cap', () => {
  const m = model();
  m.batchLimits = { maxTotalPixels: 16_777_216, maxTotalBytes: 28_000_000 };
  assert.equal(imageBatchError(m, 3840, 2160, { quality: 'max', n: 2 }), null);
  assert.ok(imageBatchError(m, 3840, 2160, { quality: 'max', n: 3 }));
  m.pricing!.qualityPerImage.max = 50000;
  assert.equal(imageBatchError(m, 1024, 1024, { quality: 'max', n: 2 }), null);
  assert.ok(imageBatchError(m, 1024, 1024, { quality: 'max', n: 3 }));
  delete m.batchLimits;
  assert.ok(imageBatchError(m, 1024, 1024, { quality: 'auto', n: 2 }));
  assert.equal(imageBatchError(m, 1024, 1024, { quality: 'auto', n: 1 }), null);
});
