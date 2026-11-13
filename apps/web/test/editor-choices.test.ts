import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  BLEND_MODES_V3,
  createAdjustmentRegionV3,
  createColorBlockV3,
  createRecipeV4,
  createRetouchRegionV4,
  parseRecipeV4,
  type PaintStrokeV3,
  type RecipeV4,
} from '@ai-xiutu/editor';
import { ChoiceSelect } from '../src/components/ChoiceSelect.tsx';
import { RubberSegment } from '../src/components/control-motion/RubberSegment.tsx';
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
const { LocalControls } = await import('../src/editor/LocalControls.tsx');
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
  type FitControl = ReactElement<{ label: string; options: { value: string }[]; onChange: (value: 'crop') => void }>;
  let fit: FitControl | undefined;
  function CaptureFit() {
    fit = elements(GeometryControls({ controller })).find(
      (element) => element.type === RubberSegment && (element.props as FitControl['props']).label === '变换后的画幅',
    ) as FitControl | undefined;
    return fit;
  }
  const markup = renderTestMarkup(createElement(CaptureFit));
  assert.ok(fit?.props.onChange);
  assert.deepEqual(fit.props.options.map((option) => option.value), ['contain', 'crop']);
  assert.match(markup, /data-segment-value="contain" aria-pressed="true"/);
  fit.props.onChange('crop');
  assert.deepEqual(recipe, { ...before, transform: { ...before.transform, fit: 'crop' } });
  assert.deepEqual(commits, [['选择变换画幅', true]]);
});

test('the active local scope selector changes the real region or group without rewriting masks or edits', () => {
  const recipe = createRecipeV4({
    regionEdits: [
      createAdjustmentRegionV3({ id: 'one', name: 'Foreground' }),
      createAdjustmentRegionV3({ id: 'two', name: 'Sky' }),
    ],
    regionGroups: [
      {
        id: 'shared',
        name: 'Shared light',
        enabled: true,
        opacity: 0.75,
        color: createColorBlockV3(),
      },
    ],
  });
  const before = structuredClone(recipe);
  let activeRegionId = 'one';
  let activePath: unknown = [2];
  let chosen: unknown;
  const controller = {
    editor: {
      getRecipe: () => recipe,
      get activeRegionId() {
        return activeRegionId;
      },
      setActiveRegionId(id: string) {
        activeRegionId = id;
      },
      setActiveMaskPath(path: unknown) {
        activePath = path;
      },
    },
    apply() {
      assert.fail('Selecting an existing scope must not rewrite the recipe');
    },
  } as unknown as InspectorController;
  const control = readChoice(
    () =>
      LocalControls({
        controller,
        scope: { kind: 'region', id: 'one' },
        pickedColor: '#34372EFF',
        onScope(scope) {
          chosen = scope;
        },
      }),
    '独立局部与编组选择',
  );
  assert.deepEqual(
    control.props.options?.map(({ value }) => value),
    ['region:one', 'region:two', 'group:shared'],
  );
  control.choose('region:two');
  assert.equal(activeRegionId, 'two');
  assert.deepEqual(activePath, []);
  assert.deepEqual(chosen, { kind: 'region', id: 'two' });
  control.choose('group:shared');
  assert.deepEqual(chosen, { kind: 'group', id: 'shared' });
  assert.equal(
    activeRegionId,
    'two',
    'a group keeps the last individual selection for returning to it',
  );
  assert.deepEqual(recipe, before);
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
      brushSettings: { radius: 0.05, feather: 0.65, opacity: 1, mode: 'add' },
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

test('new local names use the creation locale while existing names and accessible action spacing stay intact', async () => {
  const savedName = '径向 / client A {name}';
  try {
    for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
      await setLocale(locale);
      let recipe = createRecipeV4({
        regionEdits: [createAdjustmentRegionV3({ id: 'saved-region', name: savedName })],
      });
      let activeRegionId: string | null = null;
      const commits: string[] = [];
      const controller = {
        editor: {
          getRecipe: () => recipe,
          get activeRegionId() {
            return activeRegionId;
          },
          activeMaskPath: [],
          setActiveRegionId(id: string) {
            activeRegionId = id;
          },
          setActiveMaskPath() {},
        },
        apply(next: RecipeV4, label: string, commit?: boolean) {
          assert.equal(commit, true);
          recipe = parseRecipeV4(next);
          commits.push(label);
          return true;
        },
      } as unknown as InspectorController;
      type ActionProps = ChoiceProps & {
        onClick?: () => void;
        className?: string;
        'aria-label'?: string;
        'data-mask-type'?: string;
        label?: string;
      };
      let controls: ReactElement<ActionProps>[] = [];
      function Capture() {
        const tree = LocalControls({
          controller,
          scope: { kind: 'global' },
          onScope() {},
          pickedColor: '#34372EFF',
        });
        controls = elements(tree) as ReactElement<ActionProps>[];
        // Capture the real owner handlers without rendering unrelated nested tools.
        return null;
      }
      renderTestMarkup(createElement(Capture));
      const add = controls.find(
        (element) =>
          element.type === 'button' && element.props['data-mask-type'] === 'radial' && element.props['aria-label'] === t('径向'),
      );
      assert.ok(add?.props.onClick);
      add.props.onClick();
      const expectedName = `${locale === 'en' ? 'Radial' : locale === 'zh-TW' ? '徑向' : '径向'} 2`;
      assert.equal(recipe.regionEdits[1]?.name, expectedName);
      assert.equal(
        recipe.regionEdits[0]?.name,
        savedName,
        'Creating an item never translates a saved name',
      );
      assert.equal(activeRegionId, recipe.regionEdits[1]?.id);
      assert.equal(commits.length, 1);
      renderTestMarkup(createElement(Capture));
      const names = controls
        .filter((element) => element.props.className === 'object-name')
        .map((element) => Children.toArray(element.props.children)[0]);
      assert.deepEqual(names, [savedName, expectedName]);
      const groupLabel =
        locale === 'en'
          ? `Add ${savedName} to group selection`
          : locale === 'zh-TW'
            ? `將${savedName}加入編組選擇`
            : `将${savedName}加入编组选择`;
      assert.ok(
        controls.some(
          (element) => element.type === 'input' && element.props['aria-label'] === groupLabel,
        ),
      );
      const hideLabel =
        locale === 'en'
          ? `Hide ${expectedName}`
          : locale === 'zh-TW'
            ? `隱藏${expectedName}`
            : `隐藏${expectedName}`;
      assert.ok(controls.some((element) => element.props.label === hideLabel));
      if (locale === 'en') {
        await setLocale('zh-CN');
        renderTestMarkup(createElement(Capture));
        assert.equal(
          recipe.regionEdits[1]?.name,
          'Radial 2',
          'A later language switch must not rename an existing region',
        );
      }
    }
  } finally {
    await setLocale('zh-CN');
  }
});
