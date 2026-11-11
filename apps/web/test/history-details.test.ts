import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRecipeV3,
  createRecipeV4,
  createAdjustmentRegionV3,
  createRetouchRegionV4,
  createHealingOperationV4,
} from '@ai-xiutu/editor';
import { historyDetails } from '../src/editor/history-details.ts';
import { historyText } from '../src/editor/history-copy.ts';
import { setLocale } from '../src/i18n/index.ts';

test('history shows signed numeric changes in their own scope and never rewrites the recipe', () => {
  const before = createRecipeV3({
    regionEdits: [createAdjustmentRegionV3({ id: 'face', name: 'Sky' })],
  });
  const after = structuredClone(before);
  after.transform.rotationDegrees = -3.21;
  after.adjustments.exposure = -0.01;
  after.regionEdits[0]!.color.adjustments.exposure = 0.25;
  const snapshot = structuredClone(after);
  const changes = historyDetails(before, after);
  assert.equal(changes.length, 3);
  assert.deepEqual(
    changes
      .filter((item) => item.scope === 'Sky')
      .map((item) => [item.before, item.after, item.unit]),
    [[0, 0.25, 'EV']],
  );
  assert.ok(
    changes.some((item) => item.scope === '整张照片' && item.after === -3.21 && item.unit === '°'),
  );
  assert.ok(changes.some((item) => item.scope === '整张照片' && item.after === -0.01));
  assert.deepEqual(after, snapshot);
  assert.equal(before.regionEdits[0]!.color.adjustments.exposure, 0);
});

test('history compares curve tuples, interpolation and equal-length edited control points', () => {
  const before = createRecipeV3();
  before.curves.rgb = [
    [0, 0],
    [0.5, 0.5],
    [1, 1],
  ];
  const after = structuredClone(before);
  after.curves.rgb[1] = [0.48, 0.62];
  after.curves.interpolation = { rgb: 'pchip-v1' };
  const changes = historyDetails(before, after);
  assert.deepEqual(
    changes.map((item) => [item.label, item.before, item.after]),
    [
      ['曲线 RGB · 2', '(0.5, 0.5)', '(0.48, 0.62)'],
      ['曲线 RGB · 插值', 'linear', 'pchip-v1'],
    ],
  );
});

test('history reveals a rotated mask and a moved linear endpoint without a generic update label', () => {
  const before = createRecipeV3({
    regionEdits: [
      createAdjustmentRegionV3({
        id: 'face',
        name: 'My selection',
        mask: {
          type: 'radial',
          centerX: 0.4,
          centerY: 0.4,
          radiusX: 0.2,
          radiusY: 0.3,
          feather: 0.5,
          invert: false,
          rotationDegrees: 0,
          shape: 'ellipse',
        },
      }),
    ],
  });
  const after = structuredClone(before);
  if (after.regionEdits[0]!.mask.type === 'radial') {
    after.regionEdits[0]!.mask.rotationDegrees = -17.5;
    after.regionEdits[0]!.mask.shape = 'diamond';
  }
  const changes = historyDetails(before, after);
  assert.deepEqual(
    changes.map((item) => [item.label, item.before, item.after]),
    [
      ['选区 · 旋转', 0, -17.5],
      ['选区 · 形状', 'ellipse', 'diamond'],
    ],
  );
  const linearBefore = createRecipeV3({
    regionEdits: [
      createAdjustmentRegionV3({
        mask: {
          type: 'linear',
          start: { x: 0.1, y: 0.2 },
          end: { x: 0.8, y: 0.9 },
          smooth: true,
          invert: false,
        },
      }),
    ],
  });
  const linearAfter = structuredClone(linearBefore);
  if (linearAfter.regionEdits[0]!.mask.type === 'linear')
    linearAfter.regionEdits[0]!.mask.end.x = 0.6;
  assert.deepEqual(
    historyDetails(linearBefore, linearAfter).map((item) => [item.label, item.before, item.after]),
    [['选区 · 终点', '(0.8, 0.9)', '(0.6, 0.9)']],
  );
});

test('v4 history exposes actual retouch, repair and projective edits', () => {
  const before = createRecipeV4({
    retouch: [createRetouchRegionV4({ id: 'skin', name: 'Skin', algorithm: 'guided-v4' })],
    healing: [createHealingOperationV4({ id: 'repair', name: 'Repair' })],
  });
  const after = structuredClone(before);
  after.retouch[0]!.smoothing = 0.37;
  after.retouch[0]!.chromaSpots = 0.2;
  after.healing[0]!.source = { x: 0.125, y: 0.375 };
  after.healing[0]!.iterations = 120;
  after.projective.corners[0].x = 0.04;
  const changes = historyDetails(before, after);
  assert.ok(
    changes.some((item) => item.scope === 'Skin' && item.label === '平滑' && item.after === 0.37),
  );
  assert.ok(
    changes.some((item) => item.scope === 'Skin' && item.label === '色斑' && item.after === 0.2),
  );
  assert.ok(
    changes.some(
      (item) =>
        item.scope === 'Repair' && item.label === '取样点' && item.after === '(0.125, 0.375)',
    ),
  );
  assert.ok(
    changes.some(
      (item) =>
        item.scope === 'Repair' &&
        item.label === '融合迭代' &&
        item.before === 96 &&
        item.after === 120,
    ),
  );
  assert.ok(
    changes.some(
      (item) =>
        item.scope === '四角投影' && item.label === '角点 · 1' && item.after === '(0.04, 0)',
    ),
  );
});

test('JSONB key order is ignored; paint order, removal and unchanged-count strokes are not', () => {
  const before = createRecipeV3({
    paintLayers: ['first', 'second'].map((id) => ({
      id,
      name: id,
      enabled: true,
      opacity: 1,
      blendMode: 'normal',
      mask: null,
      strokes: [],
    })),
  });
  const reordered = Object.fromEntries(Object.entries(before).reverse()) as typeof before;
  assert.deepEqual(historyDetails(before, reordered), []);
  const after = structuredClone(before);
  after.paintLayers.reverse();
  assert.deepEqual(
    historyDetails(before, after).map((item) => [item.label, item.before, item.after]),
    [['图层顺序', 'first · second', 'second · first']],
  );
  after.paintLayers.pop();
  assert.ok(
    historyDetails(before, after).some(
      (item) =>
        item.scope === 'first' && item.presence && item.before === true && item.after === false,
    ),
  );
  const warped = createRecipeV3({
    warp: {
      enabled: true,
      protection: null,
      strokes: [
        {
          id: 'move',
          mode: 'push',
          from: { x: 0.3, y: 0.4 },
          to: { x: 0.4, y: 0.4 },
          radius: 0.1,
          feather: 0.5,
          strength: 0.2,
        },
      ],
    },
  });
  const moved = structuredClone(warped);
  moved.warp.strokes[0]!.strength = -0.35;
  moved.warp.strokes[0]!.to.x = 0.6;
  const changes = historyDetails(warped, moved);
  assert.ok(
    changes.some(
      (item) => item.label === '笔画 1 · 力度' && item.before === 0.2 && item.after === -0.35,
    ),
  );
  assert.ok(changes.some((item) => item.label === '笔画 1 · 终点' && item.after === '(0.6, 0.4)'));
  assert.equal(
    changes.some((item) => item.label === '笔画 · 数量'),
    false,
  );
});

test('new history labels support all three locales without translating user names', async () => {
  try {
    await setLocale('en');
    assert.equal(historyText('笔画 2 · 路径 · 3'), 'Stroke 2 · Path · 3');
    assert.equal(historyText('曲线 RGB · 插值'), 'Curve RGB · Interpolation');
    assert.equal(historyText('保护范围 · 旋转'), 'Protected area · Rotation');
    await setLocale('zh-TW');
    assert.equal(historyText('保护范围 · 旋转'), '保護範圍 · 旋轉');
    await setLocale('zh-CN');
    assert.equal(historyText('ellipse'), '椭圆');
  } finally {
    await setLocale('zh-CN');
  }
});
