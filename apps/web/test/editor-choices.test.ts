import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  BLEND_MODES_V3,
  createRecipeV4,
  createRetouchRegionV4,
  parseRecipeV4,
  type RecipeV4,
} from '@ai-xiutu/editor';
import { ChoiceSelect } from '../src/components/ChoiceSelect.tsx';
import { GeometryControls } from '../src/editor/GeometryControls.tsx';
import { RepairControls } from '../src/editor/RepairControls.tsx';
import type { InspectorController } from '../src/editor/advanced-model.ts';
import { renderTestMarkup } from './support/render.ts';

// This node test exercises real controls/handlers, not CSS or browser layout.
// LayerControls also imports the shared colour picker stylesheet via Vite.
const cssHook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { BlendPicker } = await import('../src/editor/LayerControls.tsx');
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
