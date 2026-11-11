import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  BLEND_MODES_V3,
  createRecipeV4,
  createRetouchRegionV4,
  parseRecipeV4,
  type PaintStrokeV3,
  type RecipeV4,
} from '@ai-xiutu/editor';
import { ChoiceSelect } from '../src/components/ChoiceSelect.tsx';
import { GeometryControls } from '../src/editor/GeometryControls.tsx';
import { RepairControls } from '../src/editor/RepairControls.tsx';
import type { InspectorController } from '../src/editor/advanced-model.ts';
import { setLocale, t } from '../src/i18n/index.ts';
import { renderTestMarkup } from './support/render.ts';

// This node test exercises real controls/handlers, not CSS or browser layout.
// LayerControls also imports the shared colour picker stylesheet via Vite.
const cssHook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { BlendPicker, PaintControls } = await import('../src/editor/LayerControls.tsx');
cssHook.deregister();

type ChoiceProps = {
  children?: ReactNode;
  ariaLabel?: string;
  value?: string;
  options?: { value: string; label: string }[];
  onValueChange?: (value: string) => void;
};
function elements(node: ReactNode): ReactElement<ChoiceProps>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<ChoiceProps>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function readChoice(render: () => ReactNode, label: string) {
  let choice: ReactElement<ChoiceProps> | undefined;
  function Capture() {
    const tree = render();
    choice = elements(tree).find(
      (element) => element.type === ChoiceSelect && element.props.ariaLabel === label,
    );
    assert.ok(choice, `Missing real selector: ${label}`);
    return choice;
  }
  const markup = renderTestMarkup(createElement(Capture));
  assert.ok(choice?.props.onValueChange);
  return { props: choice.props, markup, choose: choice.props.onValueChange };
}

test('the transform fit selector commits the actual recipe field and preserves the rest of the recipe', () => {
  let recipe = createRecipeV4();
  const before = structuredClone(recipe);
  const commits: unknown[] = [];
  const controller = {
    editor: {
      getRecipe: () => recipe,
      dimensions: { width: 640, height: 480 },
      geometryMode: 'transform',
      setGeometryMode() {},
    },
    apply(next: RecipeV4, label: string, commit?: boolean) {
      recipe = parseRecipeV4(next);
      commits.push([label, commit]);
      return true;
    },
    report(message: string) {
      assert.fail(message);
    },
  } as unknown as InspectorController;
  const control = readChoice(() => GeometryControls({ controller }), '变换后的画幅');
  assert.deepEqual(
    control.props.options?.map((option) => option.value),
    ['contain', 'crop'],
  );
  control.choose('crop');
  assert.deepEqual(recipe, { ...before, transform: { ...before.transform, fit: 'crop' } });
  assert.deepEqual(commits, [['选择变换画幅', true]]);
});

test('blend selection preserves every registered blend mode without inventing or renaming values', () => {
  let selected = 'normal';
  const control = readChoice(
    () =>
      BlendPicker({
        value: 'normal',
        onChange: (value) => {
          selected = value;
        },
      }),
    '图层混合模式',
  );
  assert.deepEqual(
    control.props.options?.map((option) => option.value),
    [...BLEND_MODES_V3],
  );
  for (const mode of BLEND_MODES_V3) {
    control.choose(mode);
    assert.equal(selected, mode);
  }
});

test('blend labels and stroke counts keep their editing meaning across locales without translating saved layer names', async () => {
  const stroke: PaintStrokeV3 = {
    points: [{ x: 0.25, y: 0.5 }],
    radius: 0.02,
    feather: 0.5,
    opacity: 1,
    mode: 'paint',
    color: [255, 0, 0, 255],
    source: null,
  };
  try {
    for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
      await setLocale(locale);
      const expectedMode = locale === 'en' ? 'Normal' : '正常混合';
      const picker = readChoice(
        () => BlendPicker({ value: 'normal', onChange() {} }),
        t('图层混合模式'),
      );
      assert.equal(
        picker.props.options?.find((option) => option.value === 'normal')?.label,
        expectedMode,
      );
      if (locale === 'en') assert.equal(t('正常'), 'Active', 'account status keeps its own copy');
      for (const count of [0, 1, 2]) {
        const recipe = createRecipeV4({
          paintLayers: [
            {
              id: 'paint-layer',
              name: '正常',
              enabled: true,
              opacity: 1,
              blendMode: 'normal',
              mask: null,
              strokes: Array.from({ length: count }, () => structuredClone(stroke)),
            },
          ],
        });
        const before = structuredClone(recipe);
        const controller = {
          editor: {
            getRecipe: () => recipe,
            activePaintLayerId: 'paint-layer',
            dimensions: { width: 640, height: 480 },
            paintSettings: { ...stroke, pressureSensitive: false, choosingSource: false },
          },
          apply() {
            assert.fail('Rendering translated labels must not rewrite saved layers');
          },
          report(message: string) {
            assert.fail(message);
          },
        } as unknown as InspectorController;
        const html = renderTestMarkup(
          createElement(PaintControls, { controller, pickedColor: '#FF0000FF' }),
        );
        const unit =
          locale === 'en' ? (count === 1 ? 'stroke' : 'strokes') : locale === 'zh-TW' ? '筆' : '笔';
        assert.ok(html.includes(`<small>${count} ${unit} · ${expectedMode}</small>`));
        assert.ok(html.includes('>正常<small>'), 'the saved layer name remains verbatim');
        assert.deepEqual(recipe, before);
      }
    }
  } finally {
    await setLocale('zh-CN');
  }
});

test('changing repair region commits the previous preview before moving the active mask without rewriting recipes', () => {
  const recipe = createRecipeV4({
    retouch: [createRetouchRegionV4({ id: 'first' }), createRetouchRegionV4({ id: 'second' })],
  });
  const before = structuredClone(recipe);
  const actions: unknown[] = [];
  const controller = {
    editor: {
      getRecipe: () => recipe,
      activeRepairId: 'first',
      repairMode: 'retouch',
      dimensions: { width: 640, height: 480 },
      commitCurrent(label: string) {
        actions.push(['commit', label]);
      },
      setActiveRepairId(id: string) {
        actions.push(['active', id]);
      },
      setActiveMaskPath(path: number[]) {
        actions.push(['path', path]);
      },
    },
    apply() {
      assert.fail('Selecting an existing region must not rewrite its recipe');
    },
    report(message: string) {
      assert.fail(message);
    },
  } as unknown as InspectorController;
  const control = readChoice(() => RepairControls({ controller }), '修复区域');
  assert.equal(control.props.value, 'first');
  assert.deepEqual(
    control.props.options?.map((option) => option.value),
    ['first', 'second'],
  );
  control.choose('second');
  assert.deepEqual(actions, [
    ['commit', '完成当前修复'],
    ['active', 'second'],
    ['path', []],
  ]);
  assert.deepEqual(recipe, before);
});
