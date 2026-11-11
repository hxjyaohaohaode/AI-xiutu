import type { EditorRecipe } from '@ai-xiutu/editor';
import { additionalRecipeChanges, recipeDifferences } from '../ai/recipeDiff';

export type HistoryDetail = {
  scope: string;
  scopeIsUserName?: boolean;
  label: string;
  before: string | number | boolean;
  after: string | number | boolean;
  unit?: string;
  valuesAreUserText?: boolean;
  presence?: boolean;
};
type Data = Record<string, unknown>;
type Row = Data & { id: string; name?: string };
type Scope = Pick<HistoryDetail, 'scope' | 'scopeIsUserName'>;
const object = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const rows = (value: unknown): Row[] => array(value) as Row[];
const scalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

// JSONB object-key order is not an edit. Ordered masks, control points and layer
// arrays are significant. This is display-only and never normalizes a recipe.
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => equal(v, b[i]))
    );
  const left = object(a),
    right = object(b),
    keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
  );
}

const fieldLabels: Record<string, string> = {
  name: '名称',
  enabled: '启用',
  opacity: '强度',
  blendMode: '混合模式',
  x: '水平位置',
  y: '垂直位置',
  width: '宽度',
  height: '高度',
  rotationDegrees: '旋转',
  rotation: '旋转',
  flipX: '水平翻转',
  flipY: '垂直翻转',
  fit: '画幅模式',
  method: '修复方法',
  radius: '半径',
  patchRadius: '修复块半径',
  searchRadius: '取样范围',
  iterations: '融合迭代',
  texture: '纹理保留',
  smoothing: '平滑',
  uniformity: '匀肤',
  shine: '油光控制',
  speckle: '细小瑕疵',
  fineLines: '细纹',
  chromaSpots: '色斑',
  algorithm: '算法版本',
  feather: '羽化',
  strength: '力度',
  mode: '模式',
  sourceId: '素材',
  groupId: '所属分组',
  type: '类型',
  shape: '形状',
  centerX: '中心 X',
  centerY: '中心 Y',
  radiusX: '横向半径',
  radiusY: '纵向半径',
  startX: '起点 X',
  startY: '起点 Y',
  endX: '终点 X',
  endY: '终点 Y',
  invert: '反向选区',
  operation: '组合方式',
  hue: '色相',
  hueWidth: '色相范围',
  saturationMin: '最低饱和度',
  saturationMax: '最高饱和度',
  luminanceMin: '最低亮度',
  luminanceMax: '最高亮度',
  colored: '彩色颗粒',
  resampling: '采样算法',
  antialias: '边缘平滑',
  smooth: '边缘平滑',
};

/** Detailed immutable history comparisons are evaluated only when the user
 * expands an entry. The live slider/preview path performs no structural walk. */
export function historyDetails(before: EditorRecipe, after: EditorRecipe): HistoryDetail[] {
  const details: HistoryDetail[] = [];
  const previous = before as unknown as Data,
    next = after as unknown as Data;
  const global: Scope = { scope: '整张照片' };
  const covered = new Set<string>();
  const push = (
    scope: Scope,
    label: string,
    a: unknown,
    b: unknown,
    extra: Partial<HistoryDetail> = {},
  ) => {
    if (equal(a, b)) return;
    details.push({
      ...scope,
      label,
      before: scalar(a) ? a : '—',
      after: scalar(b) ? b : '—',
      ...extra,
    });
  };
  const fields = (scope: Scope, a: Data, b: Data, keys: string[], prefix = '') => {
    for (const key of keys)
      push(scope, prefix + (fieldLabels[key] ?? key), a[key], b[key], {
        unit:
          key === 'rotation' || key === 'rotationDegrees' || key === 'hue' || key === 'hueWidth'
            ? '°'
            : undefined,
        valuesAreUserText: key === 'name' || key === 'sourceId' || key === 'groupId',
      });
  };
  const points = (scope: Scope, label: string, a: unknown, b: unknown) => {
    if (equal(a, b)) return;
    const from = array(a),
      to = array(b);
    if (from.length !== to.length) push(scope, label + ' · 数量', from.length, to.length);
    const indexes = Array.from({ length: Math.max(from.length, to.length) }, (_, i) => i).filter(
      (i) => !equal(from[i], to[i]),
    );
    // Exact changed coordinates are useful; a long brush path is bounded so a
    // single history entry cannot fill thousands of DOM rows.
    for (const index of indexes.slice(0, 6))
      push(scope, label + ` · ${index + 1}`, pointText(from[index]), pointText(to[index]));
    if (indexes.length > 6)
      details.push({
        ...scope,
        label: label + ' · 其余变化',
        before: '—',
        after: indexes.length - 6,
      });
  };
  const curves = (scope: Scope, a: unknown, b: unknown) => {
    const left = object(a),
      right = object(b);
    for (const channel of ['rgb', 'red', 'green', 'blue']) {
      points(scope, '曲线 ' + channel.toUpperCase(), left[channel], right[channel]);
      push(
        scope,
        '曲线 ' + channel.toUpperCase() + ' · 插值',
        object(left.interpolation)[channel] ?? 'linear',
        object(right.interpolation)[channel] ?? 'linear',
      );
    }
  };
  const colors = (scope: Scope, a: Data, b: Data) => {
    // Reuse the same global baseline on both sides. Otherwise an unrelated
    // global transform would be incorrectly attributed to this local region.
    const left = { ...before, ...a } as EditorRecipe,
      right = { ...before, ...b } as EditorRecipe;
    for (const change of recipeDifferences(left, right))
      details.push({
        ...scope,
        label: change.label,
        before: change.before,
        after: change.after,
        unit: change.unit,
      });
    curves(scope, a.curves, b.curves);
    push(
      scope,
      '彩色颗粒',
      object(object(a.effects).grain).colored,
      object(object(b.effects).grain).colored,
    );
  };
  const strokes = (scope: Scope, a: unknown, b: unknown, prefix: string) => {
    const left = array(a),
      right = array(b);
    if (equal(left, right)) return;
    push(scope, prefix + ' · 数量', left.length, right.length);
    const changed = Array.from({ length: Math.max(left.length, right.length) }, (_, i) => i).filter(
      (i) => !equal(left[i], right[i]),
    );
    for (const i of changed.slice(-8)) {
      const oldStroke = object(left[i]),
        newStroke = object(right[i]);
      const label = `${prefix} ${i + 1} · `;
      if (!left[i] || !right[i])
        details.push({
          ...scope,
          label: `${prefix} ${i + 1}`,
          before: !!left[i],
          after: !!right[i],
          presence: true,
        });
      fields(
        scope,
        oldStroke,
        newStroke,
        ['mode', 'radius', 'feather', 'opacity', 'strength', 'algorithm', 'resampling'],
        label,
      );
      for (const key of ['from', 'to', 'source'] as const)
        push(
          scope,
          label + { from: '起点', to: '终点', source: '取样点' }[key],
          pointText(oldStroke[key]),
          pointText(newStroke[key]),
        );
      push(scope, label + '颜色', colorText(oldStroke.color), colorText(newStroke.color));
      points(scope, label + '路径', oldStroke.points, newStroke.points);
      const samplingA = object(oldStroke.sampling),
        samplingB = object(newStroke.sampling);
      fields(scope, samplingA, samplingB, ['algorithm', 'antialias'], label);
      if (
        !equal(samplingA.pressure, samplingB.pressure) ||
        !equal(samplingA.breaks, samplingB.breaks)
      )
        details.push({ ...scope, label: label + '压力与断点', before: '之前', after: '已更新' });
    }
    if (changed.length > 8)
      details.push({
        ...scope,
        label: prefix + ' · 其余变化',
        before: '—',
        after: changed.length - 8,
      });
  };
  const masks = (scope: Scope, a: unknown, b: unknown, prefix = '选区') => {
    if (equal(a, b)) return;
    const left = object(a),
      right = object(b),
      mark = details.length;
    if (!a || !b)
      details.push({ ...scope, label: prefix, before: !!a, after: !!b, presence: true });
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
      (key) => key in fieldLabels,
    );
    fields(scope, left, right, keys, prefix + ' · ');
    push(scope, prefix + ' · 起点', pointText(left.start), pointText(right.start));
    push(scope, prefix + ' · 终点', pointText(left.end), pointText(right.end));
    points(scope, prefix + ' · 顶点', left.points, right.points);
    strokes(scope, left.strokes, right.strokes, prefix + ' · 笔画');
    const leftChildren = array(left.masks),
      rightChildren = array(right.masks);
    for (let index = 0; index < Math.max(leftChildren.length, rightChildren.length); index++)
      masks(scope, leftChildren[index], rightChildren[index], prefix + ` · ${index + 1}`);
    if (!equal(left.runs, right.runs)) {
      const mass = (value: unknown) => {
        const r = array(value);
        let sum = 0;
        for (let i = 0; i < r.length; i += 2) sum += (Number(r[i]) * Number(r[i + 1])) / 255;
        return sum;
      };
      push(scope, prefix + ' · 覆盖像素', mass(left.runs), mass(right.runs));
      details.push({ ...scope, label: prefix + ' · 蒙版分布', before: '之前', after: '已更新' });
    }
    if (details.length === mark)
      details.push({ ...scope, label: prefix, before: '之前', after: '已更新' });
  };

  for (const change of recipeDifferences(before, after))
    details.push({
      ...global,
      label: change.label,
      before: change.before,
      after: change.after,
      unit: change.unit,
    });
  covered.add('曲线');
  curves(global, previous.curves, next.curves);
  covered.add('构图');
  const aGeometry = object(previous.geometry),
    bGeometry = object(next.geometry);
  fields({ scope: '构图' }, aGeometry, bGeometry, ['rotation', 'flipX', 'flipY']);
  if (!equal(aGeometry.crop, bGeometry.crop)) {
    if (!aGeometry.crop || !bGeometry.crop)
      details.push({
        scope: '构图',
        label: '裁剪',
        before: !!aGeometry.crop,
        after: !!bGeometry.crop,
        presence: true,
      });
    fields({ scope: '裁剪' }, object(aGeometry.crop), object(bGeometry.crop), [
      'x',
      'y',
      'width',
      'height',
    ]);
  }
  covered.add('旧版局部调整');
  const oldLocal = object(previous.local),
    newLocal = object(next.local);
  fields({ scope: '局部' }, oldLocal, newLocal, ['enabled']);
  colors(
    { scope: '局部' },
    { adjustments: oldLocal.adjustments },
    { adjustments: newLocal.adjustments },
  );
  masks({ scope: '局部' }, oldLocal.mask, newLocal.mask);

  const collections = [
    ['regions', '局部', '独立选区与蒙版'],
    ['regionEdits', '局部', '新版局部参数与蒙版'],
    ['regionGroups', '分组', '局部分组与共享参数'],
    ['imageLayers', '图像层', '合成素材、图层顺序与混合'],
    ['paintLayers', '绘制层', '绘制、妆容与克隆图层'],
    ['healing', '修复', '修复范围、来源与纹理融合'],
    ['retouch', '肤质区域', '肤质精修与保护区域'],
  ] as const;
  for (const [key, family, fallback] of collections) {
    if (equal(previous[key], next[key])) continue;
    covered.add(fallback);
    const from = rows(previous[key]),
      to = rows(next[key]);
    const fromIds = from.map((row) => row.id),
      toIds = to.map((row) => row.id);
    if (
      fromIds.length === toIds.length &&
      fromIds.every((id) => toIds.includes(id)) &&
      !equal(fromIds, toIds)
    )
      details.push({
        scope: family,
        label: '图层顺序',
        before: from.map((row) => row.name ?? row.id).join(' · '),
        after: to.map((row) => row.name ?? row.id).join(' · '),
        valuesAreUserText: true,
      });
    for (const id of new Set([...fromIds, ...toIds])) {
      const a = from.find((row) => row.id === id),
        b = to.find((row) => row.id === id);
      const scope: Scope = {
        scope: b?.name ?? a?.name ?? family,
        scopeIsUserName: !!(b?.name ?? a?.name),
      };
      if (!a || !b) {
        details.push({ ...scope, label: family, before: !!a, after: !!b, presence: true });
        continue;
      }
      const mark = details.length;
      fields(scope, a, b, [
        'name',
        'enabled',
        'opacity',
        'blendMode',
        'x',
        'y',
        'width',
        'height',
        'rotationDegrees',
        'flipX',
        'flipY',
        'method',
        'radius',
        'patchRadius',
        'searchRadius',
        'iterations',
        'texture',
        'smoothing',
        'uniformity',
        'shine',
        'speckle',
        'fineLines',
        'chromaSpots',
        'algorithm',
        'sourceId',
        'groupId',
      ]);
      if (a.color || b.color) colors(scope, object(a.color), object(b.color));
      if (a.adjustments || b.adjustments)
        colors(scope, { adjustments: a.adjustments }, { adjustments: b.adjustments });
      masks(scope, a.mask, b.mask);
      masks(scope, a.protection, b.protection, '保护范围');
      push(scope, '取样点', pointText(a.source), pointText(b.source));
      strokes(scope, a.strokes, b.strokes, '笔画');
      if (details.length === mark && !equal(a, b))
        details.push({ ...scope, label: family, before: '之前', after: '已更新' });
    }
  }
  covered.add('液化笔触与背景保护');
  const aWarp = object(previous.warp),
    bWarp = object(next.warp);
  fields({ scope: '液化' }, aWarp, bWarp, ['enabled']);
  strokes({ scope: '液化' }, aWarp.strokes, bWarp.strokes, '笔画');
  masks({ scope: '液化' }, aWarp.protection, bWarp.protection, '保护范围');
  const oldGuards = rows(aWarp.guards),
    newGuards = rows(bWarp.guards);
  for (const id of new Set([...oldGuards, ...newGuards].map((guard) => guard.id)))
    masks(
      { scope: '液化' },
      oldGuards.find((guard) => guard.id === id)?.mask,
      newGuards.find((guard) => guard.id === id)?.mask,
      '笔画保护',
    );
  covered.add('四角投影与自由变换');
  const oldProjective = object(previous.projective),
    newProjective = object(next.projective);
  fields({ scope: '四角投影' }, oldProjective, newProjective, ['enabled', 'fit']);
  points({ scope: '四角投影' }, '角点', oldProjective.corners, newProjective.corners);
  covered.add('颗粒颜色模式');
  push(
    global,
    '彩色颗粒',
    object(object(previous.effects).grain).colored,
    object(object(next.effects).grain).colored,
  );
  covered.add('自由变换画幅模式');
  push(
    { scope: '自由变换' },
    '画幅模式',
    object(previous.transform).fit,
    object(next.transform).fit,
  );
  covered.add('配方版本');
  push(global, '配方版本', before.schemaVersion, after.schemaVersion);
  for (const change of additionalRecipeChanges(before, after))
    if (!covered.has(change))
      details.push({ ...global, label: change, before: '之前', after: '已更新' });
  return details;
}

function pointText(value: unknown): string {
  if (!value) return '—';
  const pair = Array.isArray(value) ? value : [object(value).x, object(value).y];
  return pair.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? `(${pair.join(', ')})`
    : '—';
}
function colorText(value: unknown): string {
  return Array.isArray(value) ? `RGBA(${value.join(', ')})` : '—';
}
