import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { ChoiceSelect } from '../src/components/ChoiceSelect.tsx';
import { choicePlacement, findChoice, moveChoice } from '../src/components/choice-model.ts';
import { Modal } from '../src/components/Ui.tsx';
import { StudioGlyph } from '../src/components/StudioGlyph.tsx';
import { reduceMotionSwitch, type MotionSwitchState } from '../src/motion/switch-model.ts';
import { renderTestMarkup } from './support/render.ts';

const options = [
  { value: 'a', label: 'Adobe', disabled: true },
  { value: 'b', label: 'Amber' },
  { value: 'c', label: 'Azure' },
  { value: 'd', label: 'Blue', disabled: true },
] as const;

test('selection navigation wraps enabled choices and handles disappearing options', () => {
  assert.equal(moveChoice(options, -1, 1), 1);
  assert.equal(moveChoice(options, -1, -1), 2);
  assert.equal(moveChoice(options, 2, 1), 1);
  assert.equal(moveChoice(options, 1, -1), 2);
  assert.equal(moveChoice([], 0, 1), -1);
  assert.equal(moveChoice([{ value: 'a', label: 'A', disabled: true }], 0, -1), -1);
});

test('typeahead excludes unavailable models and cycles repeated prefixes', () => {
  assert.equal(findChoice(options, 'a', -1), 1);
  assert.equal(findChoice(options, 'a', 1), 2);
  assert.equal(findChoice(options, 'a', 2), 1);
  assert.equal(findChoice(options, 'AZ', -1), 2);
  assert.equal(findChoice(options, 'Blue', -1), -1);
  assert.equal(findChoice(options, '', 0), -1);
});

test('dropdown placement stays inside narrow and keyboard-reduced visual viewports', () => {
  const phone = choicePlacement(
    { left: 226, right: 310, top: 600, bottom: 640, width: 84 },
    { left: 0, top: 0, width: 320, height: 700 },
  );
  assert.equal(phone.upward, true);
  assert.equal(phone.left, 112);
  assert.equal(phone.width, 200);
  assert.ok(phone.maxHeight <= 320);
  const keyboard = choicePlacement(
    { left: 26, right: 290, top: 350, bottom: 390, width: 264 },
    { left: 0, top: 120, width: 320, height: 300 },
  );
  assert.equal(keyboard.upward, true);
  assert.equal(keyboard.bottom, 76);
  assert.ok(keyboard.maxHeight <= 222);
  const cramped = choicePlacement(
    { left: 2, right: 60, top: 10, bottom: 50, width: 58 },
    { left: 0, top: 0, width: 160, height: 60 },
  );
  assert.equal(cramped.top, 8);
  assert.equal(cramped.maxHeight, 44);
  assert.ok(cramped.left + cramped.width <= 152);
});

test('a seven-option menu uses available space above while a short menu stays beside its trigger', () => {
  const anchor = { left: 20, right: 168, top: 632, bottom: 672, width: 148 };
  const viewport = { left: 0, top: 0, width: 390, height: 846 };
  const seven = choicePlacement(anchor, viewport, 7 * 44 + 10);
  assert.equal(seven.upward, true);
  assert.equal(seven.maxHeight, 318);
  assert.equal(seven.bottom, 220);
  const three = choicePlacement(anchor, viewport, 3 * 44 + 10);
  assert.equal(three.upward, false);
  assert.equal(three.top, 678);
  assert.equal(three.maxHeight, 142);
  const exact = choicePlacement(anchor, viewport, 160);
  assert.equal(exact.upward, false, 'a menu that fits below does not move away from its trigger');
  assert.equal(exact.maxHeight, 160);
});

test('select markup keeps its exact accessible name, controlled value and disabled form semantics', () => {
  let writes = 0;
  const markup = renderTestMarkup(
    createElement(ChoiceSelect, {
      value: 'b',
      options,
      ariaLabel: '助手模型',
      name: 'model',
      disabled: true,
      onValueChange() {
        writes++;
      },
    }),
  );
  assert.match(markup, /role="combobox"/);
  assert.match(markup, /aria-label="助手模型"/);
  assert.match(markup, /aria-expanded="false"/);
  const field = markup.match(/<input[^>]*type="hidden"[^>]*>/)?.[0];
  assert.ok(field);
  assert.match(field, /name="model"/);
  assert.match(field, /disabled=""/);
  assert.match(field, /value="b"/);
  assert.match(markup, />Amber<\/span>/);
  assert.equal(writes, 0, 'rendering a selector cannot silently migrate a saved model');
});

test('a retained closed dialog keeps drafts mounted but is inert and hidden to accessibility', () => {
  const markup = renderTestMarkup(
    createElement(Modal, {
      title: '工作设置',
      open: false,
      keepMounted: true,
      onClose() {},
      children: createElement('textarea', { defaultValue: '尚未提交的内容' }),
    }),
  );
  assert.match(markup, /<dialog[^>]*inert=""[^>]*aria-hidden="true"/);
  assert.match(markup, /尚未提交的内容/);
  assert.doesNotMatch(markup, /<dialog[^>]*\sopen[= >]/);
  const absent = renderTestMarkup(
    createElement(Modal, { title: '工作设置', open: false, onClose() {}, children: '关闭内容' }),
  );
  assert.equal(absent, '');
});

test('view changes discard stale exit completions and let a rapid return re-enter the retained view', () => {
  const initial: MotionSwitchState = { key: 'editor', pendingKey: 'editor', phase: 'idle' };
  const toWorks = reduceMotionSwitch(initial, { type: 'sync', key: 'works', reduced: false });
  assert.deepEqual(toWorks, { key: 'editor', pendingKey: 'works', phase: 'exit' });
  const toDocs = reduceMotionSwitch(toWorks, { type: 'sync', key: 'docs', reduced: false });
  assert.deepEqual(reduceMotionSwitch(toDocs, { type: 'settled', ...toWorks }), toDocs);
  const entered = reduceMotionSwitch(toDocs, { type: 'settled', ...toDocs });
  assert.deepEqual(entered, { key: 'docs', pendingKey: 'docs', phase: 'enter' });
  assert.equal(reduceMotionSwitch(entered, { type: 'settled', ...entered }).phase, 'idle');
  const returned = reduceMotionSwitch(toWorks, { type: 'sync', key: 'editor', reduced: false });
  assert.equal(returned.phase, 'enter');
  assert.equal(returned.pendingKey, 'editor');
  assert.equal(reduceMotionSwitch(returned, { type: 'settled', ...toWorks }), returned);
});

test('reduced motion replaces a pending view immediately and same-key updates remain idle', () => {
  const pending: MotionSwitchState = { key: 'editor', pendingKey: 'works', phase: 'exit' };
  const reduced = reduceMotionSwitch(pending, { type: 'sync', key: 'docs', reduced: true });
  assert.deepEqual(reduced, { key: 'docs', pendingKey: 'docs', phase: 'idle' });
  assert.equal(reduceMotionSwitch(reduced, { type: 'sync', key: 'docs', reduced: false }), reduced);
  assert.equal(reduceMotionSwitch(reduced, { type: 'settled', ...pending }), reduced);
});

test('tool symbols have distinct geometry and decorative or named SVG semantics', () => {
  const repair = renderTestMarkup(createElement(StudioGlyph, { name: 'repair' }));
  const paint = renderTestMarkup(createElement(StudioGlyph, { name: 'paint' }));
  assert.notEqual(repair, paint);
  assert.match(repair, /viewBox="0 0 24 24"/);
  assert.match(repair, /width="20" height="20"/);
  assert.match(repair, /aria-hidden="true"/);
  const named = renderTestMarkup(createElement(StudioGlyph, { name: 'works', title: '作品' }));
  assert.match(named, /role="img"/);
  assert.match(named, /<title[^>]*>作品<\/title>/);
  assert.doesNotMatch(named, /aria-hidden="true"/);
});

function luminance(hex: string) {
  const channels = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

test('both themes preserve readable text and status contrast on their real semantic surfaces', () => {
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  const blocks = [...css.matchAll(/:root\[data-theme='(light|dark)'\]\s*\{([\s\S]*?)\n\}/g)];
  assert.equal(blocks.length, 2);
  for (const [, theme, block] of blocks) {
    const palette = Object.fromEntries(
      [...block!.matchAll(/--color-([\w-]+):\s*(#[a-f\d]{6})/g)].map(([, name, value]) => [
        name,
        value,
      ]),
    );
    for (const [text, background] of [
      ['ink', 'surface'],
      ['muted', 'surface-secondary'],
      ['subtle', 'surface-secondary'],
      ['success', 'success-soft'],
      ['warning', 'warning-soft'],
      ['danger', 'danger-soft'],
      ['info', 'info-soft'],
      ['on-accent', 'accent'],
      ['accent-ink', 'accent-soft'],
    ]) {
      const values = [luminance(palette[text!]!), luminance(palette[background!]!)].sort(
        (a, b) => a - b,
      );
      const contrast = (values[1]! + 0.05) / (values[0]! + 0.05);
      assert.ok(contrast >= 4.5, `${theme} ${text} on ${background}: ${contrast.toFixed(2)}`);
    }
  }
});
