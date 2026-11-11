import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderTestMarkup } from './support/render.ts';
import {
  ExportDialog,
  prepareBoundImageExport,
  type ImageExportCheckpoint,
} from '../src/components/ProjectDialogs.tsx';
import type { EditorState } from '../src/editor/useEditor.ts';
import { setLocale } from '../src/i18n/index.ts';

// This SSR check verifies action availability, not CSS layout. Browser QA owns styling.
const stylesheetLoader = registerHooks({
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    return next(url, context);
  },
});
const { DeliveryView } = await import('../src/components/WorkspaceViews.tsx');
stylesheetLoader.deregister();

function deferred() {
  let resolve!: (blob: Blob) => void;
  let reject!: (failure: Error) => void;
  const promise = new Promise<Blob>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function checkpoint(): ImageExportCheckpoint<Readonly<{ exposure: number }>> {
  return {
    context: 1,
    source: 12,
    recipe: Object.freeze({ exposure: 0.25 }),
    live: true,
    sourcePending: false,
  };
}

test('unchanged image export prepares the encoded bytes with the captured source filename', async () => {
  const state = checkpoint();
  const encoding = deferred();
  const allocated: Blob[] = [];
  const pending = prepareBoundImageExport(
    () => state,
    () => encoding.promise,
    '照片A-编辑.png',
    (blob) => {
      allocated.push(blob);
      return 'blob:A';
    },
  );
  assert.equal(allocated.length, 0, 'no URL before encoding completes');
  const blob = new Blob(['pixels-from-A'], { type: 'image/png' });
  encoding.resolve(blob);
  assert.deepEqual(await pending, { url: 'blob:A', name: '照片A-编辑.png', bytes: blob.size });
  assert.deepEqual(allocated, [blob]);
});

test('source, recipe, generation, loading and unmount changes discard a late export before URL allocation', async (t) => {
  const changes: {
    name: string;
    change: (state: ReturnType<typeof checkpoint>) => ReturnType<typeof checkpoint>;
  }[] = [
    { name: 'new source with the identical recipe', change: (state) => ({ ...state, source: 13 }) },
    {
      name: 'changed adjustments on the same source',
      change: (state) => ({ ...state, recipe: Object.freeze({ exposure: -0.6 }) }),
    },
    {
      name: 'replacement recipe object even when values happen to match',
      change: (state) => ({ ...state, recipe: Object.freeze({ ...state.recipe }) }),
    },
    { name: 'new request generation', change: (state) => ({ ...state, context: 2 }) },
    { name: 'pending source replacement', change: (state) => ({ ...state, sourcePending: true }) },
    { name: 'unmounted owner', change: (state) => ({ ...state, live: false }) },
  ];
  for (const { name, change } of changes)
    await t.test(name, async () => {
      let state = checkpoint();
      const encoding = deferred();
      let allocated = 0;
      const pending = prepareBoundImageExport(
        () => state,
        () => encoding.promise,
        '照片A-编辑.png',
        () => {
          allocated += 1;
          return 'blob:stale';
        },
      );
      state = change(state);
      encoding.resolve(new Blob(['pixels-from-A']));
      assert.equal(await pending, null);
      assert.equal(allocated, 0, 'obsolete pixels must never become a download URL');
    });
});

test('a slower superseded export cannot replace the newer source result', async () => {
  let state = checkpoint();
  const first = deferred();
  const second = deferred();
  const allocated: string[] = [];
  const oldResult = prepareBoundImageExport(
    () => state,
    () => first.promise,
    '照片A-编辑.png',
    () => {
      allocated.push('A');
      return 'blob:A';
    },
  );
  state = { ...state, context: 2, source: 13 };
  const newResult = prepareBoundImageExport(
    () => state,
    () => second.promise,
    '照片B-编辑.png',
    () => {
      allocated.push('B');
      return 'blob:B';
    },
  );
  const pixelsB = new Blob(['new pixels']);
  second.resolve(pixelsB);
  assert.deepEqual(await newResult, {
    url: 'blob:B',
    name: '照片B-编辑.png',
    bytes: pixelsB.size,
  });
  first.resolve(new Blob(['old pixels']));
  assert.equal(await oldResult, null);
  assert.deepEqual(allocated, ['B']);
});

test('an already unavailable export does not start encoding', async () => {
  for (const state of [
    { ...checkpoint(), live: false },
    { ...checkpoint(), sourcePending: true },
  ]) {
    let encodings = 0;
    const result = await prepareBoundImageExport(
      () => state,
      async () => {
        encodings += 1;
        return new Blob();
      },
      'blocked.png',
      () => assert.fail('blocked export must not allocate a URL'),
    );
    assert.equal(result, null);
    assert.equal(encodings, 0);
  }
});

test('codec failures remain actionable only for the current request owner', async () => {
  let state = checkpoint();
  const failure = new Error('codec unavailable');
  await assert.rejects(
    prepareBoundImageExport(
      () => state,
      async () => {
        throw failure;
      },
      'current.png',
      () => assert.fail('failure must not allocate a URL'),
    ),
    (error) => error === failure,
  );
  const encoding = deferred();
  const pending = prepareBoundImageExport(
    () => state,
    () => encoding.promise,
    'old.png',
    () => assert.fail('obsolete failure must not allocate a URL'),
  );
  state = { ...state, live: false, context: 2 };
  encoding.reject(failure);
  assert.equal(await pending, null);
});

test('delivery disables image and recipe actions during decode or pending cloud source lookup', () => {
  for (const [loading, sourcePending, disabled] of [
    [false, false, false],
    [true, false, true],
    [false, true, true],
  ]) {
    const editor = {
      file: new File(['image'], 'A.png', { type: 'image/png' }),
      loading,
      exportRecipe: () => undefined,
    } as unknown as EditorState;
    const markup = renderTestMarkup(
      createElement(DeliveryView, {
        editor,
        artwork: null,
        sourcePending,
        onExport: () => undefined,
        onRecipeImport: () => undefined,
      }),
    );
    const buttons = [...markup.matchAll(/<button\b([^>]*)>/g)];
    assert.equal(buttons.length, 3);
    for (const button of buttons)
      assert.equal(
        /\bdisabled=/.test(button[1]!),
        disabled,
        'all delivery actions share the source gate',
      );
  }
});

test('the export summary preserves the actual source filename and download suffix in every language', async () => {
  const editor = {
    file: new File(['image'], '保存.png', { type: 'image/png' }),
    loading: false,
    recipe: Object.freeze({ exposure: 0.25 }),
  } as unknown as EditorState;
  try {
    for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
      await setLocale(locale);
      const markup = renderTestMarkup(
        createElement(ExportDialog, {
          editor,
          sourcePending: false,
          onClose() {},
          onSuccess() {},
        }),
      );
      const summary = markup.match(/<div class="export-summary">([\s\S]*?)<\/div>/)?.[1];
      assert.ok(summary);
      assert.match(summary, /<strong>保存-编辑\.png<\/strong>/);
      assert.equal(editor.file?.name, '保存.png');
    }
  } finally {
    await setLocale('zh-CN');
  }
});
