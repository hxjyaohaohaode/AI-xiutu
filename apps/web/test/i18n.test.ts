import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { Children, createElement, isValidElement } from 'react';
import { TOOLS, V2_TOOLS, V3_TOOLS, type SelectionMaskV3 } from '@ai-xiutu/editor';
import { createLocaleStore, type Catalog } from '../src/i18n/store.ts';
import { setLocale, t } from '../src/i18n/index.ts';
import { english } from '../src/i18n/messages-en.ts';
import { traditional } from '../src/i18n/messages-zh-TW.ts';
import { ParameterShelf, type ShelfControl } from '../src/editor/ParameterShelf.tsx';
import { MaskControls } from '../src/editor/MaskControls.tsx';
import type { InspectorController } from '../src/editor/advanced-model.ts';
import { InlineError } from '../src/components/Ui.tsx';
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

test('photo editing terminology keeps parameters and local adjustments distinct from function arguments and locality', () => {
  assert.equal(traditional['局部'], '局部');
  assert.equal(traditional['编辑参数'], '編輯參數');
  assert.equal(traditional['图像参数'], '圖像參數');
  assert.equal(traditional['参数作用范围'], '參數作用範圍');
  for (const [source, message] of Object.entries(traditional)) {
    if (source.includes('参数'))
      assert.ok(!message.includes('引數'), `Image/model setting must use 參數: ${source}`);
    if (source.includes('局部'))
      assert.ok(!message.includes('區域性'), `Local image editing must use 局部: ${source}`);
  }
});

test('the error display translates the known portrait PNG diagnostic and leaves unknown diagnostics intact', async () => {
  const expected = {
    'zh-CN': '人物素材需要透明 PNG 格式。',
    'zh-TW': '人物素材需要透明 PNG 格式。',
    en: 'Portrait cutouts require a transparent PNG.',
  };
  try {
    for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
      await setLocale(locale);
      const known = renderTestMarkup(
        createElement(InlineError, {
          message: '人物素材需要透明 PNG 格式。',
        }),
      );
      assert.ok(known.includes(expected[locale]));
      const unknown = renderTestMarkup(
        createElement(InlineError, {
          message: 'Unrecognized provider diagnostic request-7',
        }),
      );
      assert.ok(unknown.includes('Unrecognized provider diagnostic request-7'));
    }
  } finally {
    await setLocale('zh-CN');
  }
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
      assert.match(slider, /\bdata-step="0.01"/);
      assert.match(slider, /\sstep="any"/);
      assert.match(slider, /value="-0.35"/);
      assert.equal(props.controls[0]!.label, source.label);
      assert.deepEqual(source, original);
    }
    assert.equal(mutations, 0);
  } finally {
    await setLocale('zh-CN');
  }
});

test('polygon coordinates translate as complete labels without changing selection precision', async () => {
  const mask: SelectionMaskV3 = {
    type: 'polygon',
    points: [
      { x: 0.15, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.5, y: 0.85 },
    ],
    feather: 0.1,
    invert: false,
  };
  const before = structuredClone(mask);
  const controller = {
    editor: { dimensions: { width: 1600, height: 1200 }, maskOverlay: false },
    report(message: string) {
      assert.fail(message);
    },
  } as unknown as InspectorController;
  let controls: ShelfControl[] = [];
  function Capture() {
    const tree = MaskControls({
      controller,
      getMask: () => mask,
      path: [],
      onPath() {
        assert.fail('A language presentation must not change the active selection path');
      },
      onChange() {
        assert.fail('A language presentation must not change the saved selection');
      },
    });
    const shelf = Children.toArray(tree.props.children).find(
      (child) => isValidElement(child) && child.type === ParameterShelf,
    );
    assert.ok(isValidElement<{ controls: ShelfControl[] }>(shelf));
    controls = shelf.props.controls;
    return tree;
  }
  const prefixes = { 'zh-CN': '顶点', 'zh-TW': '頂點', en: 'Vertex' };
  try {
    for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
      await setLocale(locale);
      const html = renderTestMarkup(createElement(Capture));
      for (const axis of ['x', 'y'] as const) {
        const expected = `${prefixes[locale]} ${axis.toUpperCase()}`;
        const control = controls.find((item) => item.id === axis)!;
        assert.equal(control.label, expected);
        assert.ok(html.includes(`>${expected}</span>`));
        assert.ok(html.includes(`aria-label="${expected}`));
        assert.deepEqual(
          [control.value, control.min, control.max, control.step],
          [mask.points[0]![axis], 0, 1, 0.0001],
        );
      }
      assert.deepEqual(mask, before);
    }
  } finally {
    await setLocale('zh-CN');
  }
});
