import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import type { EditorRecipe } from '@ai-xiutu/editor';
import { useEditor, type EditorState } from '../src/editor/useEditor.ts';
import { renderTestMarkup } from './support/render.ts';

/** Exercise the actual callback/ref transaction. SSR does not start workers or
 * effects; the browser suite separately verifies real preview dispatch/paint. */
function captureEditor(): EditorState {
  let editor: EditorState | undefined;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    value: { matchMedia: () => ({ matches: false }) },
    configurable: true,
  });
  function Capture() {
    editor = useEditor();
    return null;
  }
  try {
    renderTestMarkup(createElement(Capture));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
  assert.ok(editor);
  return editor;
}

function withExposure(recipe: EditorRecipe, exposure: number): EditorRecipe {
  return { ...recipe, adjustments: { ...recipe.adjustments, exposure } };
}

test('an unchanged parameter commit retains recipe identity instead of scheduling another preview', () => {
  const editor = captureEditor();
  const initial = editor.getRecipe();
  editor.commitCurrent('切换参数');
  assert.equal(editor.getRecipe(), initial, 'React must keep the same recipe dependency');
  editor.commit(structuredClone(initial), '重复确认');
  assert.equal(editor.getRecipe(), initial, 'equivalent normalized input is also a no-op');
  editor.undo();
  assert.equal(editor.getRecipe(), initial, 'no history entry was appended');
});

test('a pending preview commits once, settles through replacement and keeps redo after a no-op', () => {
  const editor = captureEditor();
  const initial = editor.getRecipe();
  const preview = withExposure(initial, -0.35);
  editor.preview(preview);
  assert.equal(editor.getRecipe(), preview);
  editor.commitCurrent('曝光');
  const committed = editor.getRecipe();
  assert.notEqual(committed, preview, 'commit still triggers the immediate settled render');
  assert.deepEqual(committed, preview);
  editor.undo();
  assert.deepEqual(editor.getRecipe(), initial);
  const undoState = editor.getRecipe();
  editor.commitCurrent('切换参数');
  assert.equal(editor.getRecipe(), undoState);
  editor.redo();
  assert.deepEqual(editor.getRecipe(), preview, 'parameter navigation does not truncate redo');
  editor.undo();
  assert.deepEqual(editor.getRecipe(), initial, 'only one edit was committed');
});

test('an interactive preview returning to the committed values still settles without duplicate history', () => {
  const editor = captureEditor();
  const initial = editor.getRecipe();
  editor.commit(withExposure(initial, 0.25), '曝光');
  const committed = editor.getRecipe();
  editor.preview(withExposure(committed, 0.5));
  const returned = structuredClone(committed);
  editor.preview(returned);
  editor.commitCurrent('曝光');
  assert.notEqual(editor.getRecipe(), returned, 'the pending fast preview must be settled');
  assert.deepEqual(editor.getRecipe(), committed);
  editor.undo();
  assert.deepEqual(editor.getRecipe(), initial, 'returning to the same values adds no history');
});

test('explicitly committing the history recipe restores a different draft and preserves undo', () => {
  const editor = captureEditor();
  const initial = editor.getRecipe();
  editor.commit(withExposure(initial, 0.25), '曝光');
  const committed = editor.getRecipe();
  editor.preview(withExposure(committed, 0.75));
  editor.commit(committed, '恢复');
  assert.deepEqual(editor.getRecipe(), committed);
  editor.undo();
  assert.deepEqual(editor.getRecipe(), initial);
  editor.redo();
  assert.deepEqual(editor.getRecipe(), committed);
});

test('cancel and pending-preview undo retain the previous immutable history snapshots', () => {
  const editor = captureEditor();
  const initial = editor.getRecipe();
  const initialSnapshot = structuredClone(initial);
  editor.commit(withExposure(initial, 0.25), '曝光');
  const committed = editor.getRecipe();
  const committedSnapshot = structuredClone(committed);
  editor.preview(withExposure(committed, 0.9));
  editor.cancelPreview();
  assert.equal(editor.getRecipe(), committed);
  editor.commitCurrent('切换参数');
  assert.equal(editor.getRecipe(), committed);
  editor.preview(withExposure(committed, -0.9));
  editor.undo();
  assert.equal(editor.getRecipe(), committed, 'first undo discards the uncommitted preview');
  editor.undo();
  assert.equal(editor.getRecipe(), initial, 'second undo visits the prior committed recipe');
  assert.deepEqual(initial, initialSnapshot);
  assert.deepEqual(committed, committedSnapshot);
});

test('no-op optimization never skips recipe validation or replaces the current state on invalid input', () => {
  const editor = captureEditor();
  const initial = editor.getRecipe();
  assert.throws(() => editor.commit(withExposure(initial, Number.POSITIVE_INFINITY)));
  assert.equal(editor.getRecipe(), initial);
});
