import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readThemePreference } from '../src/workspace/useStudioTheme.ts';
import {
  defaultWorkspaceLayout,
  layoutStorageKey,
  type Viewport,
} from '../src/workspace/useWorkspaceLayout.ts';

const desktop: Viewport = { width: 1440, height: 960, bucket: 'desktop' };
const tablet: Viewport = { width: 768, height: 1024, bucket: 'tablet' };
const phone: Viewport = { width: 390, height: 844, bucket: 'phone' };
const legacy = (view: Viewport, theme: 'light' | 'dark') =>
  JSON.stringify({ ...defaultWorkspaceLayout(view), theme });

function withStore(values: Record<string, string>, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => values[key] ?? null },
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('public theme keeps the explicit preference across layout buckets before studio mounts', () => {
  for (const preference of ['light', 'dark', 'system'] as const) {
    withStore(
      {
        'image-workspace:theme': preference,
        [layoutStorageKey(desktop)]: legacy(desktop, preference === 'light' ? 'dark' : 'light'),
      },
      () => {
        for (const view of [desktop, tablet, phone])
          assert.equal(readThemePreference(view), preference);
      },
    );
  }
});

test('public theme shares valid v8 and desktop/tablet legacy migration with the studio', () => {
  for (const view of [desktop, tablet, phone]) {
    withStore({ [layoutStorageKey(view)]: legacy(view, 'dark') }, () =>
      assert.equal(readThemePreference(view), 'dark'),
    );
  }
  for (const version of [7, 6, 5, 4, 3]) {
    for (const view of [desktop, tablet]) {
      const key =
        version === 3
          ? `image-workspace:v3:${view.bucket}`
          : `image-workspace:v${version}:${view.bucket}:${view.width > view.height ? 'landscape' : 'portrait'}`;
      withStore({ [key]: legacy(view, 'dark') }, () =>
        assert.equal(readThemePreference(view), 'dark'),
      );
    }
  }
});

test('theme migration preserves phone isolation and rejects partial or corrupt layouts', () => {
  withStore({ 'image-workspace:v7:phone:portrait': legacy(phone, 'dark') }, () =>
    assert.equal(readThemePreference(phone), 'light'),
  );
  for (const invalid of ['{', '{}', '{"theme":"dark"}']) {
    withStore(
      {
        'image-workspace:theme': 'invalid',
        [layoutStorageKey(desktop)]: invalid,
        'image-workspace:v7:desktop:landscape': legacy(desktop, 'dark'),
      },
      () => assert.equal(readThemePreference(desktop), 'light'),
    );
  }
  withStore(
    { 'image-workspace:theme': 'invalid', [layoutStorageKey(tablet)]: legacy(tablet, 'dark') },
    () => assert.equal(readThemePreference(tablet), 'dark'),
  );
});

test('unavailable preference storage does not block the public page', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('Storage is unavailable');
    },
  });
  try {
    assert.equal(readThemePreference(desktop), 'light');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
