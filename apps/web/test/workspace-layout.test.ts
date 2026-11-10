import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  boundPanel,
  adaptWorkspaceLayout,
  canvasImageArea,
  defaultPanel,
  floatPanel,
  layoutStorageKey,
  movePanel,
  panelBottomOffset,
  panelBounds,
  panelNeedsPhotoSpace,
  panelOverlayReason,
  panelRectangle,
  parseWorkspaceLayout,
  resizePanel,
  workspaceCanvasInsets,
  workspaceSize,
  type PanelGeometry,
  type Viewport,
} from '../src/workspace/useWorkspaceLayout.ts';

const savedPanel: PanelGeometry = { dock: 'right', x: 700, y: 500, width: 330, height: 600 };
const desktop: Viewport = { width: 1440, height: 900, bucket: 'desktop' };
const phone: Viewport = { width: 390, height: 844, bucket: 'phone' };

test('AI resize, numeric preferences and restored geometry preserve the usable composer minimum', () => {
  for (const view of [phone, desktop]) {
    const minimum = view.bucket === 'phone' ? 224 : 260;
    const requested = { ...defaultPanel('ai', view), height: 1 };
    assert.equal(boundPanel(requested, view, 'ai').height, minimum);
    const resized = resizePanel(defaultPanel('ai', view), 'n', 0, 2000, view, 'ai');
    assert.equal(resized.height, minimum);
    const restored = parseWorkspaceLayout(
      JSON.stringify({
        theme: 'dark',
        panels: { ai: requested, inspector: savedPanel },
      }),
      view,
    );
    assert.equal(restored.panels.ai.height, minimum);
    const collapsed = panelRectangle({ ...restored.panels.ai, presentation: 'collapsed' }, view);
    assert.equal(collapsed.height, 44, 'explicit collapse remains available');
    const keyboard = { ...view, workspaceHeight: 180 };
    const constrained = boundPanel(requested, keyboard, 'ai');
    assert.equal(constrained.height, panelBounds(keyboard, requested.dock, 'ai').maxHeight);
    assert.ok(
      panelRectangle(constrained, keyboard).y + constrained.height <=
        180 - panelBottomOffset(keyboard),
    );
  }
});

test('short phones retain a usable AI composer and scale attached preferences without erasing manual sizes', () => {
  const short: Viewport = { width: 320, height: 568, bucket: 'phone' };
  const panel = defaultPanel('ai', short);
  assert.equal(panel.presentation, 'normal');
  assert.ok(panel.height >= 224, 'header and composer must both fit');
  assert.ok(canvasImageArea(short, workspaceCanvasInsets(panel, short)).height >= 90);
  const saved = {
    theme: 'dark' as const,
    viewport: { height: phone.height },
    panels: {
      inspector: defaultPanel('inspector', phone),
      ai: defaultPanel('ai', phone),
    },
  };
  const smaller = adaptWorkspaceLayout(saved, short);
  assert.ok(smaller.panels.ai.height < 260);
  assert.equal(smaller.panels.ai.width, 320);
  const returned = adaptWorkspaceLayout(smaller, phone);
  assert.ok(Math.abs(returned.panels.ai.height - saved.panels.ai.height) < 1e-8);
  assert.equal(saved.panels.ai.height, 390, 'adapting never mutates stored preferences');
  const keyboard = adaptWorkspaceLayout(saved, { ...phone, workspaceHeight: 450 });
  assert.equal(
    keyboard.viewport?.height,
    phone.height,
    'keyboard constraints do not redefine the saved viewport',
  );
});

test('844×390 restores all dock modes inside the workspace and above the reachable toolbar', () => {
  const view: Viewport = { width: 844, height: 390, bucket: 'tablet' };
  for (const dock of ['left', 'right', 'floating', 'bottom'] as const) {
    const panel = boundPanel({ ...savedPanel, dock }, view);
    const rect = panelRectangle(panel, view);
    assert.ok(rect.y >= 0);
    assert.ok(rect.y + rect.height <= workspaceSize(view).height - panelBottomOffset(view));
    assert.ok(rect.x >= 0 && rect.x + rect.width <= view.width);
  }
});

test('continuous panel sizes are bounded by available pixels, not a 330px product ceiling', () => {
  const requested = { ...savedPanel, width: 1001, height: 683 };
  const panel = boundPanel(requested, desktop);
  assert.equal(panel.width, 1001);
  assert.equal(panel.height, 683);
  assert.equal(boundPanel({ ...panel, width: 1002, height: 684 }, desktop).width, 1002);
  const maximum = boundPanel({ ...requested, width: 1e9, height: 1e9 }, desktop);
  assert.equal(maximum.width, 1424);
  assert.equal(maximum.height, 740);
});

test('phone floating width and positions remain adjustable while an attached sheet follows viewport width', () => {
  const value = boundPanel(
    { ...savedPanel, dock: 'floating', x: 19, y: 63, width: 271, height: 510 },
    phone,
  );
  assert.equal(value.dock, 'floating');
  assert.equal(value.width, 271);
  assert.equal(value.height, 510);
  assert.equal(value.x, 19);
  assert.equal(value.y, 63);
  assert.equal(boundPanel({ ...value, dock: 'left' }, phone).dock, 'left');
  assert.equal(boundPanel({ ...value, dock: 'bottom' }, phone).width, phone.width);
  assert.equal(boundPanel({ ...value, dock: 'bottom' }, { ...phone, width: 430 }).width, 430);
});

test('a very large docked panel never automatically covers the photo; explicit overlay remains available', () => {
  const normal = defaultPanel('inspector', phone);
  assert.equal(panelOverlayReason(normal, phone), null);
  assert.ok(workspaceCanvasInsets(normal, phone).bottom > panelBottomOffset(phone));
  const tall = boundPanel({ ...normal, height: 690 }, phone);
  assert.equal(tall.height, 690);
  assert.equal(panelOverlayReason(tall, phone), null);
  assert.equal(panelNeedsPhotoSpace(tall, phone), true);
  assert.deepEqual(workspaceCanvasInsets(tall, phone), { left: 0, right: 0, bottom: 760 });
  const wide = boundPanel({ ...savedPanel, width: 1300 }, desktop);
  assert.equal(panelOverlayReason(wide, desktop), null);
  assert.equal(panelNeedsPhotoSpace(wide, desktop), true);
  assert.equal(workspaceCanvasInsets(wide, desktop).right, 1316);
  const explicit = { ...tall, composition: 'overlay' as const };
  assert.equal(panelOverlayReason(explicit, phone), 'user');
  assert.deepEqual(workspaceCanvasInsets(explicit, phone), { left: 0, right: 0, bottom: 62 });
  assert.equal(panelNeedsPhotoSpace(explicit, phone), false);
});

test('a 339px saved phone sheet preserves the complete exclusion area at both 320×700 and 390×844', () => {
  const requested: PanelGeometry = {
    ...defaultPanel('inspector', phone),
    width: 368,
    height: 339,
  };
  const smaller: Viewport = { width: 320, height: 700, bucket: 'phone' };
  const narrowed = boundPanel(requested, smaller);
  assert.equal(narrowed.width, 320);
  assert.equal(narrowed.height, 339, 'a crowded layout must not secretly cap manual height');
  // A sheet is now attached directly to the tool rail. Chrome and fit padding
  // still count against actual photo pixels; resizing never silently overlays.
  assert.deepEqual(canvasImageArea(smaller, { left: 0, right: 0, bottom: 409 }), {
    width: 296,
    height: 114,
  });
  assert.equal(panelOverlayReason(narrowed, smaller), null);
  assert.equal(panelNeedsPhotoSpace(narrowed, smaller), true);
  const safeInsets = workspaceCanvasInsets(narrowed, smaller);
  assert.deepEqual(safeInsets, { left: 0, right: 0, bottom: 409 });
  assert.deepEqual(canvasImageArea(smaller, safeInsets), { width: 296, height: 114 });
  assert.ok(
    workspaceSize(smaller).height - safeInsets.bottom < panelRectangle(narrowed, smaller).y,
  );

  const larger = boundPanel(requested, phone);
  assert.equal(panelOverlayReason(larger, phone), null);
  assert.equal(panelNeedsPhotoSpace(larger, phone), false);
  assert.deepEqual(workspaceCanvasInsets(larger, phone), { left: 0, right: 0, bottom: 409 });
  assert.deepEqual(canvasImageArea(phone, workspaceCanvasInsets(larger, phone)), {
    width: 366,
    height: 258,
  });
  assert.equal(requested.width, 368);
  assert.equal(requested.height, 339);
});

test('fresh phone defaults reserve photo pixels without beginning in overlay', () => {
  for (const view of [
    { width: 320, height: 700, bucket: 'phone' as const },
    { width: 320, height: 700, bucket: 'phone' as const, workspaceHeight: 626 },
    phone,
  ]) {
    for (const id of ['inspector', 'ai'] as const) {
      const panel = defaultPanel(id, view);
      assert.equal(panelOverlayReason(panel, view), null, `${view.width}/${id}`);
      assert.equal(panelNeedsPhotoSpace(panel, view), false, `${view.width}/${id}`);
      const photo = canvasImageArea(view, workspaceCanvasInsets(panel, view));
      assert.ok(photo.height >= 160, `${view.width}/${id}: ${photo.height}px photo height`);
      assert.ok(photo.width >= 296);
    }
  }
  assert.equal(
    defaultPanel('inspector', { width: 320, height: 700, bucket: 'phone' }).height,
    284.24,
  );
  assert.equal(defaultPanel('ai', { width: 320, height: 700, bucket: 'phone' }).height, 293);
  assert.equal(defaultPanel('inspector', phone).height, 300);
  assert.equal(defaultPanel('ai', phone).height, 390);
});

test('low-room guidance uses actual fit space without changing composition or limiting manual sizes', () => {
  const view: Viewport = { width: 320, height: 700, bucket: 'phone' };
  const panel = defaultPanel('inspector', view);
  assert.equal(panelNeedsPhotoSpace({ ...panel, height: 293 }, view), false);
  assert.equal(panelNeedsPhotoSpace({ ...panel, height: 294 }, view), true);
  assert.equal(panelOverlayReason({ ...panel, height: 294 }, view), null);
  const enlarged = resizePanel({ ...panel, height: 293 }, 'n', 0, -46, view);
  assert.equal(enlarged.height, 339);
  assert.equal(panelNeedsPhotoSpace(enlarged, view), true);
  assert.equal(panelOverlayReason(enlarged, view), null);
  assert.equal(
    panelNeedsPhotoSpace(resizePanel(enlarged, 'n', 0, 46, view), view),
    false,
    'shrinking clears low-room guidance without any sticky composition change',
  );
  assert.deepEqual(workspaceCanvasInsets(enlarged, view, true), { left: 0, right: 0, bottom: 0 });
});

test('side docks and short windows deduct their own viewport chrome and fit padding', () => {
  assert.equal(panelNeedsPhotoSpace({ ...savedPanel, width: 1184 }, desktop), false);
  assert.equal(panelNeedsPhotoSpace({ ...savedPanel, width: 1185 }, desktop), true);
  const short: Viewport = { width: 844, height: 390, bucket: 'tablet' };
  assert.deepEqual(canvasImageArea(short, { left: 0, right: 360, bottom: 58 }), {
    width: 448,
    height: 194,
  });
  assert.equal(panelOverlayReason(defaultPanel('inspector', short), short), null);
  const keyboard: Viewport = { ...phone, workspaceHeight: 250 };
  assert.equal(
    panelNeedsPhotoSpace(defaultPanel('inspector', keyboard), keyboard),
    true,
    'keyboard compression offers collapse without claiming the covered pixels are visible',
  );
  assert.equal(panelOverlayReason(defaultPanel('inspector', keyboard), keyboard), null);
});

test('320px quick photo view preserves the requested 339px panel and keeps fitted images above it', () => {
  const view: Viewport = { width: 320, height: 700, bucket: 'phone' };
  const normal = boundPanel({ ...defaultPanel('inspector', view), height: 339 }, view);
  const before = structuredClone(normal);
  const collapsed = { ...normal, presentation: 'collapsed' as const };
  const restored = { ...collapsed, presentation: 'normal' as const };
  assert.equal(panelRectangle(collapsed, view).height, 44);
  assert.equal(collapsed.height, 339);
  assert.deepEqual(workspaceCanvasInsets(collapsed, view), { left: 0, right: 0, bottom: 114 });
  assert.deepEqual(canvasImageArea(view, workspaceCanvasInsets(collapsed, view)), {
    width: 296,
    height: 409,
  });
  assert.deepEqual(panelRectangle(restored, view), panelRectangle(normal, view));
  assert.deepEqual(normal, before);

  // Match the real phone viewport's 51px top / 48px bottom chrome and centered
  // contain fit. A larger fit box is useful only if the actual photo does not
  // intersect the visible panel. This catches the previous automatic-overlay bug.
  for (const panel of [defaultPanel('inspector', view), normal, collapsed, restored]) {
    const inset = workspaceCanvasInsets(panel, view);
    const area = canvasImageArea(view, inset);
    const viewportHeight = workspaceSize(view).height - inset.bottom - 51 - 48;
    const panelTop = panelRectangle(panel, view).y;
    assert.ok(area.height > 0);
    for (const aspect of [3 / 2, 2 / 3, 1, 16 / 9]) {
      const photoHeight = Math.min(area.height, area.width / aspect);
      const photoTop = 51 + (viewportHeight - photoHeight) / 2;
      assert.ok(photoTop >= 51);
      assert.ok(
        photoTop + photoHeight < panelTop,
        `${panel.presentation}/${aspect} intersects panel`,
      );
    }
  }
});

test('measured banners and keyboard space constrain panels without overwriting their saved rectangle', () => {
  const short: Viewport = { ...phone, workspaceHeight: 250 };
  const panel = boundPanel({ ...savedPanel, dock: 'floating' }, short);
  const rect = panelRectangle(panel, short);
  assert.ok(rect.y + rect.height + panelBottomOffset(short) <= 250);
  assert.ok(panel.height < 180);
  assert.equal(savedPanel.height, 600);
  const restored = boundPanel(savedPanel, desktop);
  assert.equal(restored.height, 600);
});

test('maximize and collapse are derived display modes with an exact normal-size return path', () => {
  const normal = boundPanel({ dock: 'floating', x: 125, y: 41, width: 417, height: 390 }, desktop);
  const original = structuredClone(normal);
  const maximized = { ...normal, presentation: 'maximized' as const };
  const maxRect = panelRectangle(maximized, desktop);
  assert.equal(maxRect.width, panelBounds(desktop).maxWidth);
  assert.equal(maxRect.height, panelBounds(desktop).maxHeight);
  assert.deepEqual(normal, original);
  assert.deepEqual(panelRectangle({ ...maximized, presentation: 'normal' }, desktop), {
    x: 125,
    y: 41,
    width: 417,
    height: 390,
  });
  const collapsed = { ...normal, presentation: 'collapsed' as const };
  assert.equal(panelRectangle(collapsed, desktop).height, 44);
  assert.equal(collapsed.height, 390);
  assert.equal(workspaceCanvasInsets(collapsed, desktop).right, 0);
});

test('undocking preserves the visible origin and keyboard movement supports one pixel', () => {
  for (const dock of ['left', 'right', 'bottom'] as const) {
    const value = boundPanel({ ...savedPanel, dock }, desktop);
    const visible = panelRectangle(value, desktop);
    const floating = floatPanel(value, desktop);
    assert.equal(floating.x, visible.x);
    assert.equal(floating.y, visible.y);
    assert.equal(floating.width, visible.width);
  }
  const floating = { ...savedPanel, dock: 'floating' as const, x: 100, y: 20, height: 350 };
  const moved = movePanel(floating, 1, 1, desktop);
  assert.equal(moved.x, 101);
  assert.equal(moved.y, 21);
});

test('floating west/north resize holds the opposite edge through minimum size and viewport limits', () => {
  const original = boundPanel(
    { ...savedPanel, dock: 'floating', x: 150, y: 80, width: 400, height: 400 },
    desktop,
  );
  for (const dx of [-10000, -43, 0, 117, 10000]) {
    const next = resizePanel(original, 'w', dx, 0, desktop);
    assert.equal(next.x + next.width, original.x + original.width);
  }
  for (const dy of [-10000, -23, 0, 87, 10000]) {
    const next = resizePanel(original, 'n', 0, dy, desktop);
    assert.equal(next.y + next.height, original.y + original.height);
  }
  const east = resizePanel(original, 'e', 10000, 0, desktop);
  assert.equal(east.x, original.x);
  assert.ok(east.x + east.width <= desktop.width - 8);
});

test('bottom sheets resize symmetrically in width and retain their bottom anchor in height', () => {
  const original = boundPanel({ ...savedPanel, dock: 'bottom', width: 600, height: 300 }, desktop);
  const wider = resizePanel(original, 'e', 31, 0, desktop);
  assert.equal(wider.width, 662);
  const rect = panelRectangle(wider, desktop);
  assert.equal(rect.x + rect.width / 2, desktop.width / 2);
  const taller = resizePanel(original, 'n', 0, -27, desktop);
  assert.equal(taller.height, 327);
  assert.equal(
    panelRectangle(taller, desktop).y + taller.height,
    panelRectangle(original, desktop).y + original.height,
  );
});

test('resizing across six actual QA sizes keeps every edge accessible', () => {
  const views: Viewport[] = [
    { width: 320, height: 700, bucket: 'phone' },
    phone,
    { width: 768, height: 1024, bucket: 'tablet' },
    { width: 844, height: 390, bucket: 'tablet' },
    { width: 1024, height: 768, bucket: 'tablet' },
    desktop,
  ];
  for (const view of views)
    for (const dock of ['floating', 'left', 'right', 'bottom'] as const) {
      const original = boundPanel({ ...savedPanel, dock }, view);
      for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const)
        for (const delta of [-10000, -1, 1, 10000]) {
          const next = resizePanel(original, edge, delta, delta, view);
          const rect = panelRectangle(next, view),
            body = workspaceSize(view);
          assert.ok([rect.x, rect.y, rect.width, rect.height].every(Number.isFinite));
          assert.ok(rect.x >= 0 && rect.y >= 0, `${view.width}/${dock}/${edge}`);
          assert.ok(rect.x + rect.width <= body.width, `${view.width}/${dock}/${edge}`);
          assert.ok(
            rect.y + rect.height <= body.height - panelBottomOffset(view),
            `${view.width}/${dock}/${edge}`,
          );
        }
    }
});

test('layout parsing repairs unavailable display modes and rejects corrupt old preferences', () => {
  const good = JSON.stringify({
    theme: 'dark',
    panels: { inspector: savedPanel, ai: { ...savedPanel, presentation: 'invalid' } },
  });
  const parsed = parseWorkspaceLayout(good, desktop);
  assert.equal(parsed.theme, 'dark');
  assert.equal(parsed.panels.ai.presentation, 'normal');
  assert.equal(parsed.panels.ai.composition, 'reflow');
  for (const raw of [
    null,
    '{',
    '{}',
    JSON.stringify({
      theme: 'dark',
      panels: { inspector: { ...savedPanel, width: null }, ai: savedPanel },
    }),
  ]) {
    const fallback = parseWorkspaceLayout(raw, desktop);
    assert.equal(fallback.theme, 'light');
    assert.ok(Number.isFinite(fallback.panels.inspector.width));
  }
  assert.notEqual(
    layoutStorageKey({ width: 1024, height: 768, bucket: 'tablet' }),
    layoutStorageKey({ width: 768, height: 1024, bucket: 'tablet' }),
  );
});
