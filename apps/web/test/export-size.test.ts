import assert from 'node:assert/strict';
import test from 'node:test';
import { fitExportDimensions, resizeForExport } from '../src/editor/export-size.ts';

test('export preserves the oriented aspect, never enlarges and handles thin crops', () => {
  assert.deepEqual(fitExportDimensions({ width: 3024, height: 4032 }, 2048), { width: 1536, height: 2048 });
  assert.deepEqual(fitExportDimensions({ width: 1, height: 4000 }, 1080), { width: 1, height: 1080 });
  assert.throws(() => fitExportDimensions({ width: 4, height: 3 }, 0));
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([5, 6, 7, 255]) };
  assert.equal(resizeForExport(source, 1080), source);
});

test('resampling weights fractional coverage and transparency without contaminating cutout edges', () => {
  const source = { width: 3, height: 1, data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0,
  ]) };
  const result = resizeForExport(source, 2);
  assert.deepEqual([...result.data], [170, 85, 0, 255, 0, 255, 0, 85]);
  assert.deepEqual([...source.data.slice(-4)], [0, 0, 255, 0]);
});
