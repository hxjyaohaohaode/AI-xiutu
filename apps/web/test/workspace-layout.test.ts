import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  boundPanel,
  panelBottomOffset,
  type PanelGeometry,
} from '../src/workspace/useWorkspaceLayout.ts';

const savedPanel: PanelGeometry = {
  dock: 'right',
  x: 700,
  y: 500,
  width: 330,
  height: 600,
};

test('844×390 restored docked and floating panels leave the observed toolbar clear', () => {
  const view = { width: 844, height: 390, bucket: 'tablet' as const };
  const observedToolbarTop = 336;
  for (const dock of ['left', 'right', 'floating'] as const) {
    const panel = boundPanel({ ...savedPanel, dock }, view);
    const top = 60 + (dock === 'floating' ? panel.y : 12);
    assert.ok(top + panel.height <= observedToolbarTop - 8);
    assert.ok(panel.height > 0);
  }
  const bottom = boundPanel({ ...savedPanel, dock: 'bottom' }, view);
  assert.ok(view.height - panelBottomOffset(view) <= observedToolbarTop - 8);
  assert.ok(bottom.height <= 150, 'bottom sheet must also leave room for the image');
});

test('short viewports lower the minimum panel height instead of forcing overflow', () => {
  const view = { width: 844, height: 240, bucket: 'tablet' as const };
  const panel = boundPanel(savedPanel, view);
  assert.ok(panel.height < 180);
  assert.ok(60 + 12 + panel.height <= view.height - panelBottomOffset(view));
});

test('phone panels keep a visible image area and remain above their toolbar', () => {
  const view = { width: 390, height: 390, bucket: 'phone' as const };
  const panel = boundPanel(savedPanel, view);
  assert.equal(panel.dock, 'bottom');
  assert.ok(panel.height > 0);
  assert.ok(54 + panel.height + panelBottomOffset(view) + 140 <= view.height);
});
