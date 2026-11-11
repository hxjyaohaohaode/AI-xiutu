import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { PanelNavigation, type PanelSection } from '../src/workspace/PanelNavigation.tsx';
import { renderTestMarkup } from './support/render.ts';

type Props = Record<string, any>;
function descendants(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...descendants(child.props.children)] : [],
  );
}

test('actual context buttons and arrow keys dispatch one matching local action', () => {
  const selected: PanelSection[] = [];
  let nodes: ReactElement<Props>[] = [];
  function Capture() {
    const tree = PanelNavigation({
      selected: 'assistant',
      items: (['adjustments', 'assistant', 'collaboration', 'history'] as const).map((id) => ({
        id,
        label: id,
        icon: null,
        onSelect: () => selected.push(id),
      })),
    });
    nodes = descendants(tree);
    return tree;
  }
  renderTestMarkup(createElement(Capture));
  const buttons = nodes.filter((node) => node.type === 'button');
  assert.equal(buttons.length, 4);
  assert.deepEqual(
    buttons.map((button) => button.props['aria-pressed']),
    [false, true, false, false],
  );
  buttons[2]!.props.onClick({ detail: 1 });
  assert.deepEqual(selected, ['collaboration']);
  const focused: number[] = [];
  const targets = buttons.map((_, i) => ({ focus: () => focused.push(i) }));
  const nav = nodes.find((node) => node.type === 'nav')!;
  const press = (key: string, index: number) =>
    nav.props.onKeyDown({
      key,
      target: targets[index],
      currentTarget: { querySelectorAll: () => targets },
      preventDefault() {},
    });
  press('ArrowRight', 1);
  press('End', 2);
  press('ArrowRight', 3);
  press('Home', 2);
  assert.deepEqual(focused, [2, 3, 0, 0]);
  assert.deepEqual(selected, [
    'collaboration',
    'collaboration',
    'history',
    'adjustments',
    'adjustments',
  ]);
});
