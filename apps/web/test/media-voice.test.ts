import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { visibleTiles, zoomAround } from '../src/media/tile-layout.js';
import { PcmResampler } from '@ai-xiutu/assistant';
import { createRecipeV4 } from '@ai-xiutu/editor';
import { additionalRecipeChanges, recipeDifferences } from '../src/ai/recipeDiff.js';
test('200MP tile viewport requests only visible levels and crops one-pixel overlaps', () => {
  const source = { width: 20000, height: 10000, tileSize: 512, levels: 16, overlap: 1 };
  const fit = visibleTiles(source, { x: 0, y: 100, zoom: 0.04 }, { width: 800, height: 600 });
  assert.ok(fit.length > 0 && fit.length < 20);
  assert.ok(fit.every((tile) => tile.level < 15));
  const pixels = visibleTiles(
    source,
    { x: -10000, y: -5000, zoom: 1 },
    { width: 800, height: 600 },
  );
  assert.ok(pixels.length <= 9);
  assert.ok(pixels.every((tile) => tile.level === 15 && tile.imageLeft === -1));
  assert.deepEqual(
    visibleTiles(source, { x: 10000, y: 10000, zoom: 1 }, { width: 800, height: 600 }),
    [],
  );
  const view = { x: -30, y: -50, zoom: 0.5 },
    point = { x: 321, y: 220 };
  const zoom = zoomAround(view, point, 1.2);
  assert.ok(Math.abs((point.x - view.x) / view.zoom - (point.x - zoom.x) / zoom.zoom) < 1e-10);
});
test('actual microphone worklet emits streaming little-endian PCM and clears buffers on mute', () => {
  const emitted: ArrayBuffer[] = [];
  let Worklet: any;
  class Processor {
    port = {
      postMessage(buffer: ArrayBuffer) {
        emitted.push(buffer);
      },
      onmessage: null as any,
    };
  }
  const context = vm.createContext({
    AudioWorkletProcessor: Processor,
    sampleRate: 44100,
    registerProcessor: (name: string, value: any) => {
      assert.equal(name, 'editor-microphone');
      Worklet = value;
    },
    ArrayBuffer,
    DataView,
    Float32Array,
    Math,
    Array,
  });
  vm.runInContext(
    readFileSync(new URL('../src/ai/capture-worklet.js', import.meta.url), 'utf8'),
    context,
  );
  const capture = new Worklet();
  const source = Float32Array.from(
    { length: 44100 },
    (_, i) => 0.5 * Math.sin((i / 44100) * Math.PI * 880),
  );
  for (let i = 0; i < source.length; i += 128) capture.process([[source.slice(i, i + 128)]]);
  assert.ok(emitted.length >= 49);
  assert.ok(emitted.every((frame) => frame.byteLength === 960));
  const reference = new PcmResampler(44100).push(source);
  const actual = emitted.flatMap((buffer) => {
    const v = new DataView(buffer);
    return Array.from({ length: v.byteLength / 2 }, (_, i) => v.getInt16(i * 2, true));
  });
  assert.deepEqual(actual, Array.from(reference.slice(0, actual.length)));
  const count = emitted.length;
  capture.port.onmessage({ data: { muted: true } });
  capture.process([[source]]);
  assert.equal(emitted.length, count);
  capture.port.onmessage({ data: { muted: false } });
  capture.process([[source.slice(0, 1000)]]);
  assert.ok(emitted.length > count);
});
test('V4 AI preview reports projective, healing and retouch instead of hiding new structural changes', () => {
  const before = createRecipeV4(),
    after = createRecipeV4();
  after.projective.enabled = true;
  after.projective.corners[0] = [0.1, 0.1];
  after.adjustments.exposure = -1;
  assert.ok(additionalRecipeChanges(before, after).some((label) => label.includes('四角')));
  assert.ok(
    recipeDifferences(before, after).some(
      (item) => item.path === 'adjustments.exposure' && item.after === -1,
    ),
  );
});
