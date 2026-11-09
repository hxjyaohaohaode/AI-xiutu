import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRecipe,
  createRecipeV2,
  createRecipeV3,
  createAdjustmentRegionV3,
  createAdjustmentRegionV2,
  parseEditorRecipe,
} from '@ai-xiutu/editor';
import { additionalRecipeChanges, recipeDifferences } from '../src/ai/recipeDiff.ts';
test('v2 AI confirmation includes advanced changes alongside legacy exposure', () => {
  const before = createRecipeV2(),
    after = createRecipeV2();
  after.adjustments.exposure = 0.4;
  after.levels.gamma = 1.18;
  after.hsl.red.hue = 5;
  const changes = recipeDifferences(before, after);
  assert.equal(changes.length, 3);
  assert.deepEqual(changes.map((item) => item.path).sort(), [
    'adjustments.exposure',
    'hsl.red.hue',
    'levels.gamma',
  ]);
  assert.equal(changes.find((item) => item.path === 'levels.gamma')?.before, 1);
  assert.equal(changes.find((item) => item.path === 'hsl.red.hue')?.after, 5);
});

test('v3 confirmation lists inherited color/effects and new optical/transform parameters', () => {
  const before = createRecipeV3(),
    after = createRecipeV3();
  after.levels.inputBlack = 0.07;
  after.hsl.blue.lightness = -12.5;
  after.grading.shadows.hue = 218;
  after.effects.grain.amount = 16;
  after.detail.texture = -7;
  after.optics.denoiseChroma = 25;
  after.transform.rotationDegrees = -3.21;
  const changes = recipeDifferences(before, after);
  assert.deepEqual(changes.map((change) => change.path).sort(), [
    'detail.texture',
    'effects.grain.amount',
    'grading.shadows.hue',
    'hsl.blue.lightness',
    'levels.inputBlack',
    'optics.denoiseChroma',
    'transform.rotationDegrees',
  ]);
  assert.equal(changes.find((change) => change.path === 'hsl.blue.lightness')?.after, -12.5);
  assert.equal(changes.find((change) => change.path === 'transform.rotationDegrees')?.unit, '°');
  // Diff display does not normalize or rewrite the candidate being confirmed.
  assert.equal(after.transform.rotationDegrees, -3.21);
  assert.equal(before.levels.inputBlack, 0);
});

test('v3 retained masks, groups, paint, composition and warp changes are explicitly disclosed', () => {
  const before = createRecipeV3(),
    after = createRecipeV3();
  after.regionEdits = [createAdjustmentRegionV3({ id: 'face-1', name: '人物一' })];
  after.regionGroups = [
    {
      id: 'group-1',
      name: '组一',
      enabled: true,
      opacity: 0.8,
      color: after.regionEdits[0]!.color,
    },
  ];
  after.paintLayers = [
    {
      id: 'paint-1',
      name: '妆容',
      enabled: true,
      opacity: 1,
      blendMode: 'soft-light',
      mask: null,
      strokes: [],
    },
  ];
  after.imageLayers = [
    {
      id: 'image-1',
      sourceId: 'source-1',
      name: '素材',
      enabled: true,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotationDegrees: 0,
      flipX: false,
      flipY: false,
      mask: null,
    },
  ];
  after.warp.strokes = [
    {
      id: 'warp-1',
      mode: 'push',
      from: { x: 0.4, y: 0.5 },
      to: { x: 0.5, y: 0.5 },
      radius: 0.2,
      feather: 0.5,
      strength: 0.3,
    },
  ];
  after.effects.grain.colored = true;
  after.transform.fit = 'crop';
  assert.deepEqual(additionalRecipeChanges(before, after), [
    '新版局部参数与蒙版',
    '局部分组与共享参数',
    '合成素材、图层顺序与混合',
    '绘制、妆容与克隆图层',
    '液化笔触与背景保护',
    '颗粒颜色模式',
    '自由变换画幅模式',
  ]);
});

test('non-numeric review ignores object key order but preserves ordered-layer and curve differences', () => {
  const before = createRecipeV3();
  before.paintLayers = ['first', 'second'].map((id) => ({
    id,
    name: id,
    enabled: true,
    opacity: 1,
    blendMode: 'normal',
    mask: null,
    strokes: [],
  }));
  const after = structuredClone(before);
  after.geometry = Object.fromEntries(
    Object.entries(after.geometry).reverse(),
  ) as typeof after.geometry;
  after.paintLayers = after.paintLayers.map(
    (layer) => Object.fromEntries(Object.entries(layer).reverse()) as typeof layer,
  );
  assert.deepEqual(additionalRecipeChanges(before, after), []);
  after.paintLayers.reverse();
  after.curves.rgb = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.7 },
    { x: 1, y: 1 },
  ];
  assert.deepEqual(additionalRecipeChanges(before, after), ['曲线', '绘制、妆容与克隆图层']);
  assert.deepEqual(
    before.paintLayers.map((layer) => layer.id),
    ['first', 'second'],
  );
});
test('equal JSONB-style reordered recipes do not create false numeric changes', () => {
  const before = createRecipeV2();
  const after = parseEditorRecipe(Object.fromEntries(Object.entries(before).reverse()));
  assert.deepEqual(recipeDifferences(before, after), []);
});
test('legacy candidates remain legacy and non-numeric replacements are explicitly named', () => {
  const before = createRecipe(),
    after = createRecipe();
  after.adjustments.contrast = 8;
  assert.deepEqual(
    recipeDifferences(before, after).map((item) => item.path),
    ['adjustments.contrast'],
  );
  const first = createRecipeV2(),
    second = createRecipeV2();
  second.geometry.rotation = 90;
  second.regions = [createAdjustmentRegionV2({ id: 'one', name: '一区' })];
  assert.deepEqual(additionalRecipeChanges(first, second), ['构图', '独立选区与蒙版']);
  assert.equal(before.schemaVersion, 1);
  assert.equal(after.schemaVersion, 1);
});
