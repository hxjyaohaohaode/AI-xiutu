import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { SourceFrame } from '@ai-xiutu/contracts';
import {
  createAdjustmentRegionV3,
  createColorBlockV3,
  createRasterMask,
  createRecipeV3,
  createRecipeV4,
  createRetouchRegionV4,
  MAX_V3_REGION_EDITS,
  parseRecipeV4,
  renderEditorRecipe,
  type LayeredRecipe,
} from '@ai-xiutu/editor';
import type { PortraitAnalysis } from '@ai-xiutu/portrait';
import type { InspectorController } from '../src/editor/advanced-model.ts';
import {
  portraitSelectionMatchesSource,
  preparePortraitSelection,
} from '../src/editor/portrait-selection.ts';
import { renderTestMarkup } from './support/render.ts';

// Exercise the actual handler in Node; CSS is verified separately in the browser.
const cssHook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { PortraitControls } = await import('../src/editor/PortraitControls.tsx');
cssHook.deregister();

const frame: SourceFrame = {
  coordinates: 'source-normalized',
  orientation: 'normalized',
  width: 400,
  height: 500,
  contentHash: 'a'.repeat(64),
};
function analysisFixture(): PortraitAnalysis {
  // Synthetic bounded grids test selection wiring, not model recognition quality.
  return {
    schemaVersion: 1,
    provider: 'fixture',
    algorithmVersion: 'fixture-v1',
    frame: { ...frame },
    targets: [],
    segmentation: {
      skin: createRasterMask(2, 2, new Uint8Array([0, 0, 255, 255])),
      hair: createRasterMask(2, 2, new Uint8Array([255, 255, 0, 0])),
      background: createRasterMask(2, 2, new Uint8Array([255, 0, 255, 0])),
    },
    warnings: [],
  };
}

test('hair masks create a neutral independent region while preserving V4 operations and rendered pixels', () => {
  const recipe = createRecipeV4({
    adjustments: { exposure: 0.35 },
    retouch: [createRetouchRegionV4({ id: 'existing-retouch' })],
    regionEdits: [createAdjustmentRegionV3({ id: 'existing-local' })],
  });
  const analysis = analysisFixture(),
    before = structuredClone(recipe);
  const result = preparePortraitSelection(recipe, analysis, frame, 'hair', 'hair-local');
  const region = result.recipe.regionEdits.at(-1)!;
  assert.equal(result.regionId, 'hair-local');
  assert.equal(result.recipe.schemaVersion, 4);
  assert.deepEqual(parseRecipeV4(result.recipe), result.recipe);
  assert.deepEqual({ ...result.recipe, regionEdits: before.regionEdits }, before);
  assert.deepEqual(recipe, before);
  assert.deepEqual(region.mask, analysis.segmentation!.hair);
  assert.notEqual(region.mask, analysis.segmentation!.hair);
  assert.deepEqual(region.color, createColorBlockV3());
  assert.equal(region.enabled, true);
  assert.equal(region.opacity, 1);
  assert.equal(region.groupId, null);
  assert.equal(region.origin, undefined);
  const image = {
    width: 8,
    height: 10,
    data: Uint8ClampedArray.from({ length: 8 * 10 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 19 + 36) % 256,
    ),
  };
  assert.deepEqual(renderEditorRecipe(image, result.recipe), renderEditorRecipe(image, recipe));
});

test('background masks remain editable independent copies and retain the existing V3 schema', () => {
  const recipe = createRecipeV3(),
    analysis = analysisFixture();
  const result = preparePortraitSelection(
    recipe,
    analysis,
    frame,
    'background',
    'background-local',
  );
  assert.equal(result.recipe.schemaVersion, 3);
  const mask = result.recipe.regionEdits[0]!.mask;
  assert.deepEqual(mask, analysis.segmentation!.background);
  mask.invert = true;
  assert.equal(analysis.segmentation!.background.invert, false);
  assert.equal(recipe.regionEdits.length, 0);
});

test('source identity, dimensions and validated mask data must match before a selection can be copied', () => {
  const analysis = analysisFixture(),
    recipe = createRecipeV4();
  for (const other of [null, { ...frame, contentHash: 'b'.repeat(64) }, { ...frame, width: 401 }]) {
    assert.equal(portraitSelectionMatchesSource(analysis, other), false);
    assert.throws(
      () => preparePortraitSelection(recipe, analysis, other, 'hair', 'new'),
      /当前原图/,
    );
  }
  const malformed = analysisFixture();
  (malformed.segmentation!.hair as unknown as { type: string }).type = 'not-a-mask';
  assert.throws(() => preparePortraitSelection(recipe, malformed, frame, 'hair', 'new'));
  assert.equal(recipe.regionEdits.length, 0);
});

test('missing segmentation, exhausted region capacity and duplicate ids never create substitute masks', () => {
  const recipe = createRecipeV4(),
    analysis = analysisFixture();
  assert.throws(
    () =>
      preparePortraitSelection(recipe, { ...analysis, segmentation: null }, frame, 'hair', 'new'),
    /手动建立选区/,
  );
  const full = createRecipeV4({
    regionEdits: Array.from({ length: MAX_V3_REGION_EDITS }, (_, i) =>
      createAdjustmentRegionV3({ id: `region-${i}` }),
    ),
  });
  assert.throws(() => preparePortraitSelection(full, analysis, frame, 'background', 'new'), /达到/);
  const one = createRecipeV4({ regionEdits: [createAdjustmentRegionV3({ id: 'existing' })] });
  assert.throws(
    () => preparePortraitSelection(one, analysis, frame, 'hair', 'existing'),
    /已经存在/,
  );
});

type ElementProps = {
  children?: ReactNode;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
};
function descendants(node: ReactNode): ReactElement<ElementProps>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<ElementProps>(child) ? [child, ...descendants(child.props.children)] : [],
  );
}
function controlFixture({
  accepted = true,
  analysis = analysisFixture(),
  progress = null,
  onCutout,
}: {
  accepted?: boolean;
  analysis?: PortraitAnalysis | null;
  progress?: string | null;
  onCutout?: () => Promise<string>;
} = {}) {
  let recipe: LayeredRecipe = createRecipeV4(),
    identity = 1,
    loading = false;
  const actions: unknown[][] = [];
  let buttons: ReactElement<ElementProps>[] = [];
  const controller = {
    editor: {
      getRecipe: () => recipe,
      getSourceIdentity: () => identity,
      getSourceFrame: () => (loading ? null : frame),
      isLoading: () => loading,
      sourceHash: frame.contentHash,
      portrait: { analysis, activeTargetId: null, progress, error: null },
      setActiveRegionId(id: string) {
        actions.push(['active', id]);
      },
      setActiveMaskPath(path: unknown[]) {
        actions.push(['path', path]);
      },
    },
    apply(next: LayeredRecipe, label: string, commit: boolean) {
      actions.push(['apply', label, commit]);
      if (accepted) recipe = next;
      return accepted;
    },
    report(message: string) {
      actions.push(['error', message]);
    },
  } as unknown as InspectorController;
  function Capture() {
    const tree = PortraitControls({
      controller,
      onCutout,
      onSelectionCreated(id) {
        actions.push(['scope', id]);
      },
    });
    buttons = descendants(tree).filter((element) => element.type === 'button');
    return tree;
  }
  const markup = renderTestMarkup(createElement(Capture));
  function button(label: string) {
    const result = buttons.find((item) =>
      Children.toArray(item.props.children).some(
        (child) => typeof child === 'string' && child.includes(label),
      ),
    );
    assert.ok(result?.props.onClick, `missing real control: ${label}`);
    return result.props;
  }
  return {
    actions,
    markup,
    button,
    getRecipe: () => recipe,
    replaceSource() {
      identity++;
    },
    startLoading() {
      loading = true;
    },
  };
}

test('the real portrait action commits before changing the active mask and local scope', () => {
  const ui = controlFixture();
  assert.equal(ui.button('头发选区').disabled, false);
  ui.button('头发选区').onClick!();
  const id = ui.getRecipe().regionEdits[0]!.id;
  assert.deepEqual(ui.actions, [
    ['apply', '建立头发选区', true],
    ['active', id],
    ['path', []],
    ['scope', id],
  ]);
});

test('a rejected apply leaves the active mask and panel scope unchanged', () => {
  const ui = controlFixture({ accepted: false });
  ui.button('背景选区').onClick!();
  assert.deepEqual(ui.actions, [['apply', '建立背景选区', true]]);
  assert.equal(ui.getRecipe().regionEdits.length, 0);
});

test('retained action callbacks reject source changes and pending loads before applying masks', () => {
  for (const change of ['replaceSource', 'startLoading'] as const) {
    const ui = controlFixture();
    ui[change]();
    ui.button('头发选区').onClick!();
    assert.equal(ui.actions.length, 1);
    assert.equal(ui.actions[0]![0], 'error');
    assert.match(String(ui.actions[0]![1]), /原图已经切换/);
    assert.equal(ui.getRecipe().regionEdits.length, 0);
  }
});

test('missing model output and an unfinished analysis keep both selection controls unavailable', () => {
  const missing = controlFixture({ analysis: { ...analysisFixture(), segmentation: null } });
  assert.equal(missing.button('头发选区').disabled, true);
  assert.equal(missing.button('背景选区').disabled, true);
  assert.match(missing.markup, /这次分析未提供头发或背景范围/);
  const busy = controlFixture({ progress: '识别中' });
  assert.equal(busy.button('头发选区').disabled, true);
  busy.button('头发选区').onClick!();
  assert.deepEqual(busy.actions, [['error', '请等待这次识别完成，再建立选区。']]);
});

test('the merged cutout action requires the current source and real subject segmentation', async () => {
  let calls = 0;
  const analysis = analysisFixture();
  analysis.segmentation!.subject = createRasterMask(2, 2, new Uint8Array([255, 220, 20, 0]));
  for (const change of ['replaceSource', 'startLoading'] as const) {
    const ui = controlFixture({
      analysis,
      onCutout: async () => {
        calls++;
        return '已创建';
      },
    });
    const button = ui.button('从原图提取人物素材');
    assert.equal(button.disabled, false);
    ui[change]();
    await button.onClick!();
    assert.equal(calls, 0);
    assert.match(String(ui.actions[0]?.[1]), /当前原图/);
  }
  const unsupported = controlFixture({
    onCutout: async () => {
      calls++;
      return '已创建';
    },
  });
  assert.doesNotMatch(unsupported.markup, /从原图提取人物素材/);
});

test('cutout dispatch is single-flight and a rejected result releases the lock without changing masks', async () => {
  let calls = 0;
  let reject!: (error: Error) => void;
  const pending = new Promise<string>((_resolve, failure) => {
    reject = failure;
  });
  const analysis = analysisFixture();
  analysis.segmentation!.subject = createRasterMask(2, 2, new Uint8Array([255, 220, 20, 0]));
  const ui = controlFixture({
    analysis,
    onCutout: () => {
      calls++;
      return calls === 1 ? pending : Promise.resolve('已创建');
    },
  });
  const button = ui.button('从原图提取人物素材');
  const first = button.onClick!();
  await button.onClick!();
  assert.equal(calls, 1);
  reject(new Error('需要重新确认素材'));
  await first;
  assert.deepEqual(ui.actions, [['error', '需要重新确认素材']]);
  assert.equal(ui.getRecipe().regionEdits.length, 0);
  await button.onClick!();
  assert.equal(calls, 2);
});

test('a previous photo cutout failure cannot replace the new photo status', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<string>((_resolve, failure) => {
    reject = failure;
  });
  const analysis = analysisFixture();
  analysis.segmentation!.subject = createRasterMask(2, 2, new Uint8Array([255, 220, 20, 0]));
  const ui = controlFixture({ analysis, onCutout: () => pending });
  const running = ui.button('从原图提取人物素材').onClick!();
  ui.replaceSource();
  reject(new Error('上一张图的迟到失败'));
  await running;
  assert.deepEqual(ui.actions, []);
});
