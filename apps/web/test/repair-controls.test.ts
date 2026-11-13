import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  createRecipeV4,
  createRetouchRegionV4,
  parseRecipeV4,
  type RecipeV4,
} from '@ai-xiutu/editor';
import { applyPortraitValues } from '@ai-xiutu/portrait';
import { analysis } from '../../../packages/portrait/test/fixtures.ts';
import { RepairControls } from '../src/editor/RepairControls.tsx';
import type { InspectorController } from '../src/editor/advanced-model.ts';
import { renderTestMarkup } from './support/render.ts';

type ControlProps = {
  children?: ReactNode;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  onClick?: () => void;
};
function elements(node: ReactNode): ReactElement<ControlProps>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<ControlProps>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function harness(initial: RecipeV4, activeId: string | null = initial.retouch[0]?.id ?? null) {
  let recipe = initial;
  const commits: { label: string; commit?: boolean }[] = [];
  const editor = {
    getRecipe: () => recipe,
    repairMode: 'retouch',
    activeRepairId: activeId,
    dimensions: { width: 400, height: 500 },
    setActiveRepairId(id: string | null) {
      editor.activeRepairId = id;
    },
    setActiveMaskPath() {},
    setRepairProtection() {},
    setRepairChoosingSource() {},
    setBrushSettings() {},
  };
  const controller: InspectorController = {
    editor: editor as unknown as InspectorController['editor'],
    apply(next, label, commit) {
      recipe = parseRecipeV4(next);
      commits.push({ label, commit });
      return true;
    },
    report(message) {
      assert.fail(message ?? 'Unexpected control error');
    },
  };
  function render() {
    let nodes: ReactElement<ControlProps>[] = [];
    // Render the real selector and capture its handlers without mounting a browser
    // or unrelated mask controls. RepairControls itself has no React hooks.
    function Selector() {
      const tree = RepairControls({ controller });
      nodes = elements(tree);
      return nodes.find((node) => node.props['aria-label'] === '质感算法') ?? tree;
    }
    const markup = renderTestMarkup(createElement(Selector));
    const selector = nodes.find((node) => node.props['aria-label'] === '质感算法');
    return {
      markup,
      algorithms: elements(selector?.props.children),
      click(label: string) {
        const button = nodes.find(
          (node) => node.type === 'button' && node.props.children === label,
        );
        assert.ok(button?.props.onClick, `Missing real control: ${label}`);
        button.props.onClick();
      },
    };
  }
  return { render, commits, recipe: () => recipe };
}

test('a new portrait guided-v4 region has one visibly and accessibly selected algorithm', () => {
  const source = analysis();
  const recipe = applyPortraitValues(createRecipeV4(), source, source.targets[0]!.id, {
    smooth: 25,
    wrinkles: 20,
  });
  assert.equal(recipe.retouch[0]!.algorithm, 'guided-v4');
  const before = structuredClone(recipe);
  const controls = harness(recipe);
  const view = controls.render();
  assert.equal(view.algorithms.length, 6);
  assert.deepEqual(
    view.algorithms.filter((node) => node.props['aria-pressed']).map((node) => node.props.children),
    ['纹理与斑点分离'],
  );
  assert.match(view.markup, /aria-pressed="true">纹理与斑点分离<\/button>/);
  assert.deepEqual(controls.recipe(), before, 'opening the selector must not migrate saved pixels');
  assert.deepEqual(controls.commits, []);
});

test('explicit algorithm changes can return to guided-v3 and preserve other recipe fields', () => {
  const source = analysis();
  const recipe = applyPortraitValues(
    createRecipeV4({ retouch: [createRetouchRegionV4({ id: 'independent-manual' })] }),
    source,
    source.targets[0]!.id,
    { smooth: 25, wrinkles: 20 },
  );
  const target = recipe.retouch.at(-1)!;
  const controls = harness(recipe, target.id);
  const before = structuredClone(recipe);
  for (const [label, algorithm] of [
    ['选区保边与双尺度纹理', 'guided-v2'],
    ['保边美肤', 'guided-v1'],
    ['原版质感', undefined],
    ['细纹与反光分离', 'guided-v3'],
    ['自适应保边磨皮', 'guided-v5'],
    ['纹理与斑点分离', 'guided-v4'],
  ] as const) {
    controls.render().click(label);
    assert.deepEqual(controls.recipe(), {
      ...before,
      retouch: before.retouch.map((item) => {
        if (item.id !== target.id) return item;
        const { algorithm: _previous, ...rest } = item;
        return { ...rest, ...(algorithm ? { algorithm } : {}) };
      }),
    });
    assert.deepEqual(
      controls
        .render()
        .algorithms.filter((node) => node.props['aria-pressed'])
        .map((node) => node.props.children),
      [label],
    );
  }
  assert.deepEqual(controls.recipe(), before);
  assert.deepEqual(
    controls.commits,
    Array.from({ length: 6 }, () => ({ label: '切换质感算法', commit: true })),
  );
});

test('creating a manual retouch region selects guided-v4 explicitly', () => {
  const controls = harness(createRecipeV4());
  controls.render().click('新区域');
  assert.equal(controls.recipe().retouch.length, 1);
  assert.equal(controls.recipe().retouch[0]!.algorithm, 'guided-v4');
  assert.deepEqual(
    controls
      .render()
      .algorithms.filter((node) => node.props['aria-pressed'])
      .map((node) => node.props.children),
    ['纹理与斑点分离'],
  );
  assert.equal(controls.commits.length, 1);
  assert.equal(controls.commits[0]!.commit, true);
});
