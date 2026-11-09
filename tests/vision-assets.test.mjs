import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyVisionAsset, assets } from '../scripts/vision-assets.mjs';

const record = (bytes, format = 'task') => ({
  file: 'fixture',
  bytes: bytes.length,
  format,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
test('model preparation rejects a truncated task even when its bad download hash was recorded', () => {
  const bytes = Buffer.from('PK\x03\x04truncated file without ZIP directory');
  assert.throws(() => verifyVisionAsset(record(bytes), bytes), /Incomplete/);
});
test('model preparation validates length and TFLite magic independently of its hash', () => {
  const good = Buffer.from([8, 0, 0, 0, 84, 70, 76, 51]);
  assert.doesNotThrow(() => verifyVisionAsset(record(good, 'tflite'), good));
  assert.throws(() => verifyVisionAsset({ ...record(good, 'tflite'), bytes: 9 }, good), /length/);
  const bad = Buffer.from('not a model');
  assert.throws(() => verifyVisionAsset(record(bad, 'tflite'), bad), /TFLite/);
  assert.throws(
    () => verifyVisionAsset({ ...record(good, 'tflite'), sha256: '0'.repeat(64) }, good),
    /SHA256/,
  );
});
test('model preparation requires a complete archive directory and exact versioned pose size', () => {
  const bytes = Buffer.alloc(68);
  bytes.writeUInt32LE(0x02014b50, 0);
  bytes.writeUInt32LE(0x06054b50, 46);
  bytes.writeUInt16LE(1, 54);
  bytes.writeUInt16LE(1, 56);
  bytes.writeUInt32LE(46, 58);
  assert.doesNotThrow(() => verifyVisionAsset(record(bytes), bytes));
  bytes.writeUInt32LE(47, 58);
  assert.throws(() => verifyVisionAsset(record(bytes), bytes), /directory/);
  assert.equal(assets.find((a) => a.file === 'pose_landmarker_lite.task').bytes, 5777746);
});
