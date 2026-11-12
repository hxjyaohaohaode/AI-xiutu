import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { defaultPanel, type PanelGeometry, type Viewport } from '../src/workspace/panelGeometry.ts';
import { renderTestMarkup } from './support/render.ts';

const stylesheetLoader = registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return next(url, context);
  },
});
const { FloatingPanel } = await import('../src/workspace/FloatingPanel.tsx');
stylesheetLoader.deregister();

type Props = Record<string, any>;
function descendants(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...descendants(child.props.children)] : [],
  );
}
function capturePanel(
  view: Viewport,
  geometry: PanelGeometry,
  extra: Partial<Parameters<typeof FloatingPanel>[0]> = {},
) {
  const writes: PanelGeometry[] = [];
  let nodes: ReactElement<Props>[] = [];
  function Capture() {
    const tree = FloatingPanel({
      title: '色彩',
      label: '可移动编辑面板',
      viewport: view,
      geometry,
      onGeometry: (next) => writes.push(next),
      onClose: () => {},
      children: null,
      ...extra,
    });
    nodes = descendants(tree);
    return tree;
  }
  renderTestMarkup(createElement(Capture));
  return {
    writes,
    nodes,
    control(predicate: (props: Props) => boolean): Props {
      const element = nodes.find((node) => predicate(node.props));
      assert.ok(element);
      return element.props;
    },
  };
}

test('the same panel content can become a full collaboration page without inherited collapse or resize controls', () => {
  const view: Viewport = { width: 1440, height: 960, bucket: 'desktop', workspaceHeight: 866 };
  const geometry = { ...defaultPanel('inspector', view), presentation: 'collapsed' as const };
  const ui = capturePanel(view, geometry, {
    displayMode: 'page',
    identity: 'collaboration',
    open: true,
    children: createElement('textarea', { defaultValue: 'Unsaved discussion draft' }),
  });
  const surface = ui.control((props) => props['data-panel-id'] === 'collaboration');
  assert.equal(surface['aria-hidden'], false);
  assert.equal(surface['data-presentation'], 'normal');
  assert.equal(ui.control((props) => props.className === 'panel-content').hidden, false);
  assert.equal(
    ui.nodes.some((node) => node.props.className === 'panel-drag-header'),
    false,
  );
  assert.equal(
    ui.nodes.some((node) => node.props.role === 'separator'),
    false,
  );
  assert.equal(
    ui.control((props) => props.defaultValue === 'Unsaved discussion draft').defaultValue,
    'Unsaved discussion draft',
  );
  assert.equal(ui.writes.length, 0, 'changing presentation does not rewrite stored panel geometry');
});

test('closing a visited panel makes its retained draft inert, while Back invokes only its supplied context action', () => {
  const view: Viewport = { width: 1440, height: 960, bucket: 'desktop', workspaceHeight: 866 };
  let backs = 0,
    closes = 0;
  const hidden = capturePanel(view, defaultPanel('inspector', view), {
    open: false,
    onBack: () => backs++,
    onClose: () => closes++,
    backLabel: 'Back to all tools',
    children: createElement('input', { defaultValue: 'Unsent prompt' }),
  });
  assert.equal(hidden.control((props) => props['data-panel-id'] === 'inspector').inert, true);
  assert.equal(
    hidden.control((props) => props.defaultValue === 'Unsent prompt').defaultValue,
    'Unsent prompt',
  );
  hidden.control((props) => props.label === 'Back to all tools').onClick();
  assert.equal(backs, 1);
  assert.equal(closes, 0);
  assert.equal(hidden.writes.length, 0);
});
function withFrames(run: (flush: () => void) => void) {
  const previousRequest = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const previousCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    },
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (frame: number) => frames.delete(frame),
  });
  try {
    run(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  } finally {
    if (previousRequest)
      Object.defineProperty(globalThis, 'requestAnimationFrame', previousRequest);
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    if (previousCancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', previousCancel);
    else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
  }
}

test('the actual phone Edit button restores useful height even when normal is already selected', () => {
  const view: Viewport = {
    width: 390,
    height: 844,
    bucket: 'phone',
    workspaceHeight: 759.8542,
    toolShelfHeight: 64,
  };
  for (const presentation of ['normal', 'maximized', 'collapsed'] as const) {
    const geometry = { ...defaultPanel('inspector', view), height: 112, presentation };
    const ui = capturePanel(view, geometry);
    ui.control((props) => props['aria-label'] === '恢复参数，保留当前调整').onClick();
    assert.equal(ui.writes.length, 1);
    assert.equal(ui.writes[0]!.presentation, 'normal');
    assert.ok(ui.writes[0]!.height >= 280 && ui.writes[0]!.height <= 300);
    assert.equal(geometry.height, 112);
  }
});

test('queued desktop resize, pointer release and cancel cannot write into a changed phone viewport', () => {
  // Replay the real component callbacks and RAF queue. SSR does not assert DOM
  // layout or effects; the supplied viewport object represents the current owner.
  for (const completion of ['frame', 'release', 'cancel'] as const) {
    withFrames((flush) => {
      const view: Viewport = { width: 1440, height: 960, bucket: 'desktop', workspaceHeight: 866 };
      const geometry: PanelGeometry = {
        dock: 'floating',
        x: 1060,
        y: 8,
        width: 344,
        height: 736,
        presentation: 'normal',
      };
      const ui = capturePanel(view, geometry);
      const edge = ui.control((props) => props.className?.includes('resize-se'));
      let captured = false;
      const target = {
        closest: () => null,
        setPointerCapture: () => {
          captured = true;
        },
        hasPointerCapture: () => captured,
        releasePointerCapture: () => {
          captured = false;
        },
      };
      const event = {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: 1404,
        clientY: 838,
        target,
        currentTarget: target,
        preventDefault() {},
      };
      edge.onPointerDown(event);
      edge.onPointerMove({ ...event, clientY: 620 });
      assert.equal(ui.writes.length, 1, 'the resize is queued until its animation frame');
      Object.assign(view, {
        width: 390,
        height: 844,
        bucket: 'phone',
        workspaceHeight: 759.8542,
        toolShelfHeight: 64,
      });
      if (completion === 'frame') flush();
      if (completion === 'release') edge.onPointerUp(event);
      else edge.onPointerCancel(event);
      flush();
      assert.equal(
        ui.writes.length,
        1,
        `${completion} cannot publish or roll back into the new viewport`,
      );
      assert.equal(captured, false);
    });
  }
});

test('a same-viewport resize flushes its last precise value and can still cancel to the original', () => {
  for (const cancel of [false, true]) {
    withFrames((flush) => {
      const view: Viewport = { width: 1440, height: 960, bucket: 'desktop', workspaceHeight: 866 };
      const geometry: PanelGeometry = {
        dock: 'floating',
        x: 1060,
        y: 8,
        width: 344,
        height: 736,
        presentation: 'normal',
      };
      const ui = capturePanel(view, geometry);
      const edge = ui.control((props) => props.className?.includes('resize-se'));
      const target = {
        closest: () => null,
        setPointerCapture() {},
        hasPointerCapture: () => false,
      };
      const event = {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: 1404,
        clientY: 838,
        target,
        currentTarget: target,
        preventDefault() {},
      };
      edge.onPointerDown(event);
      edge.onPointerMove({ ...event, clientY: 620 });
      if (cancel) edge.onPointerCancel(event);
      else edge.onPointerUp(event);
      flush();
      assert.equal(ui.writes.length, 2);
      assert.equal(ui.writes[1]!.height, cancel ? 736 : 518);
    });
  }
});
