import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { TOOLS, V2_TOOLS, V3_TOOLS } from '@ai-xiutu/editor';
import { createLocaleStore, type Catalog } from '../src/i18n/store.ts';
import { setLocale, t } from '../src/i18n/index.ts';
import { english } from '../src/i18n/messages-en.ts';
import { traditional } from '../src/i18n/messages-zh-TW.ts';
import { ParameterShelf } from '../src/editor/ParameterShelf.tsx';
import { renderTestMarkup } from './support/render.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('source locale needs no catalog, preload deduplicates and never switches the active language', async () => {
  const englishLoad = deferred<Catalog>();
  let loads = 0;
  const store = createLocaleStore(() => {
    loads++;
    return englishLoad.promise;
  });
  assert.equal(await store.setLocale('zh-CN'), true);
  assert.equal(loads, 0);
  const first = store.preload('en');
  const second = store.preload('en');
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(loads, 1);
  assert.deepEqual(store.getState(), { locale: 'zh-CN', pending: null, failed: null });
  englishLoad.resolve({ 保存: 'Save' });
  await first;
  assert.equal(store.getLocale(), 'zh-CN');
  assert.equal(await store.setLocale('en'), true);
  assert.equal(loads, 1);
  assert.equal(store.translate('保存', store.getLocale()), 'Save');
});

test('a late catalog cannot override newer intent or persist the wrong preference', async () => {
  const en = deferred<Catalog>();
  const tw = deferred<Catalog>();
  const commits: string[] = [];
  const store = createLocaleStore(
    (locale) => (locale === 'en' ? en.promise : tw.promise),
    (locale) => commits.push(locale),
  );
  const first = store.setLocale('en');
  const second = store.setLocale('zh-TW');
  assert.equal(store.getLocale(), 'zh-CN', 'copy remains consistent while the next catalog loads');
  tw.resolve({ 保存: '儲存' });
  assert.equal(await second, true);
  en.resolve({ 保存: 'Save' });
  assert.equal(await first, false);
  assert.deepEqual(commits, ['zh-TW']);
  assert.equal(store.translate('保存', store.getLocale()), '儲存');
});

test('returning to the loaded language cancels an in-flight switch without publishing stale copy', async () => {
  const en = deferred<Catalog>();
  const store = createLocaleStore(() => en.promise);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications++;
  });
  const oldRequest = store.setLocale('en');
  assert.equal(await store.setLocale('zh-CN'), true);
  en.resolve({ 曝光: 'Exposure' });
  assert.equal(await oldRequest, false);
  assert.equal(store.getLocale(), 'zh-CN');
  assert.equal(notifications, 2, 'only pending and cancellation publish');
  unsubscribe();
  await store.setLocale('en');
  assert.equal(notifications, 2);
});

test('failed language loads keep the current copy, report failure, and support a fresh retry', async () => {
  let attempt = 0;
  const commits: string[] = [];
  const store = createLocaleStore(
    async () => {
      if (++attempt === 1) throw new Error('chunk unavailable');
      return { 保存: 'Save' };
    },
    (locale) => commits.push(locale),
  );
  await assert.rejects(store.setLocale('en'), /chunk unavailable/);
  assert.deepEqual(store.getState(), { locale: 'zh-CN', pending: null, failed: 'en' });
  assert.deepEqual(commits, []);
  assert.equal(store.translate('保存', store.getLocale()), '保存');
  assert.equal(await store.setLocale('en'), true);
  assert.deepEqual(store.getState(), { locale: 'en', pending: null, failed: null });
  assert.equal(attempt, 2);
});

test('a superseded download failure cannot replace a successful language choice with an old error', async () => {
  const stale = deferred<Catalog>();
  const store = createLocaleStore((locale) =>
    locale === 'en' ? stale.promise : Promise.resolve({ 保存: '儲存' }),
  );
  const oldRequest = store.setLocale('en');
  await store.setLocale('zh-TW');
  stale.reject(new Error('stale chunk failed'));
  assert.equal(await oldRequest, false);
  assert.deepEqual(store.getState(), { locale: 'zh-TW', pending: null, failed: null });
});

test('interpolation preserves user text, wire identifiers, and unknown errors verbatim', async () => {
  const store = createLocaleStore(async () => ({ '打开{name}': 'Open {name}', 保存: 'Save' }));
  await store.setLocale('en');
  assert.equal(store.translate('打开{name}', 'en', { name: '保存' }), 'Open 保存');
  assert.equal(store.translate('custom-model/保存.png', 'en'), 'custom-model/保存.png');
  assert.equal(
    store.translate('Provider failed with request 8e42', 'en'),
    'Provider failed with request 8e42',
  );
  for (const identifier of ['__proto__', 'constructor', 'toString'])
    assert.equal(store.translate(identifier, 'en'), identifier);
  assert.equal(store.translate('打开{name}', 'en'), 'Open {name}');
  assert.equal(store.translate('打开{name}', 'en', { name: '{name}' }), 'Open {name}');
});

test('catalogs preserve every interpolation slot and cover each numeric tool label and explanation', () => {
  const slots = (value: string) =>
    [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
  for (const [locale, catalog] of Object.entries({ en: english, 'zh-TW': traditional })) {
    for (const [source, message] of Object.entries(catalog))
      assert.deepEqual(slots(message), slots(source), `${locale}: ${source}`);
    for (const tool of [...TOOLS, ...V2_TOOLS, ...V3_TOOLS]) {
      assert.ok(catalog[tool.label], `${locale} label: ${tool.label}`);
      assert.ok(catalog[tool.description], `${locale} explanation: ${tool.label}`);
    }
  }
});

test('Traditional interface actions use the same Taiwan terminology as the introduction', () => {
  assert.equal(traditional['保存'], '儲存');
  assert.equal(traditional['导出'], '匯出');
  assert.equal(traditional['项目'], '專案');
  assert.equal(traditional['本地编辑'], '本機編輯');
  assert.equal(traditional['用户'], '使用者');
  assert.equal(traditional['画笔'], '筆刷');
  assert.equal(traditional['保存版本'], '儲存版本');
});

test('declared application-copy literals have both English and Traditional Chinese translations', () => {
  const directory = fileURLToPath(new URL('../src', import.meta.url));
  const missing: string[] = [];
  function inspectDirectory(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'i18n' && entry.name !== 'about') inspectDirectory(filename);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = ts.createSourceFile(
        filename,
        readFileSync(filename, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      function inspectCopy(node: ts.Node) {
        if (ts.isStringLiteral(node) && /\p{Script=Han}/u.test(node.text)) {
          for (const [locale, catalog] of Object.entries({ en: english, 'zh-TW': traditional }))
            if (!Object.hasOwn(catalog, node.text))
              missing.push(`${locale}: ${path.relative(directory, filename)}: ${node.text}`);
        }
        ts.forEachChild(node, inspectCopy);
      }
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === 't' &&
          node.arguments[0]
        )
          inspectCopy(node.arguments[0]);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  inspectDirectory(directory);
  assert.deepEqual(missing, []);
});

test('real parameter controls keep range values and handlers across all three language presentations', async () => {
  const source = TOOLS.find((tool) => tool.id === 'exposure')!;
  const original = structuredClone(source);
  let mutations = 0;
  const props = {
    label: '影调',
    controls: [
      {
        id: source.id,
        label: source.label,
        description: source.description,
        value: -0.35,
        min: -8,
        max: 8,
        step: 0.01,
        unit: 'EV',
        onChange() {
          mutations++;
        },
      },
    ],
  };
  try {
    for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
      await setLocale(locale);
      const html = renderTestMarkup(createElement(ParameterShelf, props));
      const slider = html.match(/<input[^>]+type="range"[^>]*>/)?.[0];
      assert.ok(slider);
      assert.ok(slider.includes(`aria-label="${t(source.label)}"`));
      assert.match(slider, /min="-8"/);
      assert.match(slider, /max="8"/);
      assert.match(slider, /step="0.01"/);
      assert.match(slider, /value="-0.35"/);
      assert.equal(props.controls[0]!.label, source.label);
      assert.deepEqual(source, original);
    }
    assert.equal(mutations, 0);
  } finally {
    await setLocale('zh-CN');
  }
});
