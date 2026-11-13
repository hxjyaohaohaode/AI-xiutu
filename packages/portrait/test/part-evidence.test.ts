import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compileSelectionMaskV3,
  compileWarpFieldV3,
  createRasterMask,
  createRecipeV4,
  type Point,
} from '@ai-xiutu/editor';
import {
  analyzeFacePixels,
  applyPortraitValues,
  measureBodySections,
  PRECISE_PORTRAIT_ANALYSIS,
  portraitToolAvailability,
  validatePortraitAnalysis,
} from '../src/index.js';
import { toothArch } from '../src/part-evidence.js';
import { analysis, bodyTarget, faceTarget, frame } from './fixtures.js';

const center = (points: Point[]) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});
function paint(parts: (x: number, y: number) => number[]) {
  const { width, height } = frame;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.set([...parts((x + 0.5) / width, (y + 0.5) / height), 255], (y * width + x) * 4);
  return { width, height, data };
}
test('tooth selection follows connected enamel and rejects a bright tongue or isolated reflection', () => {
  const target = faceTarget(),
    mouth = center(target.contours.innerLips!);
  const picture = (mode: 'teeth' | 'tongue' | 'reflection') =>
    paint((x, y) => {
      const dx = (x - mouth.x) / 0.045,
        dy = (y - mouth.y) / 0.008;
      if (dx * dx + dy * dy > 1) return [143, 59, 55];
      if (mode === 'teeth' && Math.abs(dx) < 0.78 && dy >= -0.79 && dy <= 0.13)
        return [205, 194, 172];
      if (mode === 'tongue' && dy >= 0 && Math.abs(dx) < 0.77) return [218, 104, 116];
      if (mode === 'reflection' && Math.abs(dx) < 0.048 && Math.abs(dy) < 0.22)
        return [241, 239, 235];
      return [45, 28, 29];
    });
  const m = toothArch(picture('teeth'), target);
  assert.ok(m);
  const weight = compileSelectionMaskV3(m, frame);
  assert.ok(weight(mouth.x, mouth.y - 0.0025) > 0.7);
  assert.equal(weight(mouth.x, mouth.y + 0.019), 0);
  assert.equal(toothArch(picture('tongue'), target), undefined);
  assert.equal(toothArch(picture('reflection'), target), undefined);
});

test('a visible pupil needs a dark core enclosed by the original aperture', () => {
  const target = faceTarget();
  const ids = [468, 473];
  const centers = ids.map((i) => target.landmarks[i]!);
  const image = paint((x, y) => {
    const r = Math.min(
      ...centers.map((p) => Math.hypot((x - p.x) * frame.width, (y - p.y) * frame.height)),
    );
    return r < 1.7 ? [30, 29, 25] : r < 4.25 ? [108, 110, 90] : [193, 175, 167];
  });
  const result = analyzeFacePixels(image, target);
  assert.equal(result.contours.leftPupil?.length, 2);
  assert.equal(result.contours.rightPupil?.length, 2);
  const uniform = analyzeFacePixels(
    paint(() => [95, 88, 85]),
    target,
  );
  assert.equal(uniform.contours.leftPupil, undefined);
  assert.equal(uniform.contours.rightPupil, undefined);
  target.contours = { ...target.contours, ...result.contours };
  const input = { ...analysis([target]), algorithmVersion: PRECISE_PORTRAIT_ANALYSIS };
  const available = portraitToolAvailability(input, target.id).find(({ id }) => id === 'pupilSize');
  assert.equal(available?.available, true);
  const w = applyPortraitValues(createRecipeV4(), input, target.id, { pupilSize: 80 }).warp;
  assert.ok(w.strokes[0]?.anchors?.some((p) => p.mode === 'bulge'));
});

function bodyFixture() {
  const target = bodyTarget();
  for (const [i, x, y] of [
    [29, 0.42, 0.947],
    [30, 0.58, 0.947],
    [31, 0.424, 0.961],
    [32, 0.576, 0.961],
  ])
    target.landmarks[i!] = { x: x!, y: y!, visibility: 1 };
  const sample = ({ x, y }: Point) =>
    Number(
      (y >= 0.218 && y <= 0.605 && Math.abs(x - 0.5) < (y < 0.33 ? 0.161 : 0.126)) ||
        (y >= 0.565 && y < 0.968 && Math.min(Math.abs(x - 0.42), Math.abs(x - 0.58)) < 0.05) ||
        (y >= 0.06 && y <= 0.165 && Math.abs(x - 0.5) < 0.065),
    );
  const pixels = Uint8Array.from(
    { length: 40 * 50 },
    (_, i) =>
      255 *
      sample({
        x: ((i % 40) + 0.5) / 40,
        y: (Math.floor(i / 40) + 0.5) / 50,
      }),
  );
  target.bodyMask = createRasterMask(40, 50, pixels);
  target.bodySupport = createRasterMask(
    40,
    50,
    Uint8Array.from(pixels, (v, i) =>
      Math.max(v, pixels[i - 1] ?? 0, pixels[i + 1] ?? 0, pixels[i - 40] ?? 0, pixels[i + 40] ?? 0),
    ),
    false,
    { sampling: 'bilinear-v1' },
  );
  target.contours = measureBodySections(target, frame, sample, () => 0);
  return { target, sample };
}
test('body resizing uses independent silhouette sections and keeps the floor and background fixed', () => {
  const { target, sample } = bodyFixture();
  const input = validatePortraitAnalysis({
    ...analysis([target]),
    algorithmVersion: PRECISE_PORTRAIT_ANALYSIS,
  });
  const options = portraitToolAvailability(input, target.id);
  for (const id of ['waist', 'hips', 'legs', 'legLength', 'height'])
    assert.equal(options.find((tool) => tool.id === id)?.available, true, id);
  const neutral = createRecipeV4();
  const render = (amount: number) => {
    const edit = applyPortraitValues(neutral, input, target.id, {
      waist: amount,
      legLength: amount,
    });
    assert.equal(edit.warp.strokes.length, 1);
    return compileWarpFieldV3(edit.warp, frame);
  };
  const a = render(80),
    b = render(-80);
  const center = target.contours.pelvisBand![3]!;
  assert.ok(a(center).y > center.y && b(center).y < center.y);
  const p = { x: 0.04, y: 0.65 };
  assert.deepEqual(a(p), p);
  for (const p of target.contours.footPins!) {
    const q = a(p);
    assert.ok(Math.hypot((p.x - q.x) * frame.width, (p.y - q.y) * frame.height) < 0.43);
  }
  const occluded = bodyFixture().target;
  occluded.landmarks[27]!.visibility = 0.2;
  occluded.contours = measureBodySections(occluded, frame, sample, (p) =>
    p.x < 0.5 && p.y >= 0.32 ? 1 : 0,
  );
  const blocked = portraitToolAvailability({ ...input, targets: [occluded] }, occluded.id);
  assert.equal(blocked.find(({ id }) => id === 'legLength')?.available, false);
  assert.equal(blocked.find(({ id }) => id === 'waist')?.available, false);
});
