import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import * as React from 'react';
import type { AIModel, ImageCapabilities } from '../src/ai/types.ts';
import { renderTestMarkup } from './support/render.ts';

const stylesheetLoader = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: 'export {};', shortCircuit: true }
      : next(url, context);
  },
});
const { ImageParameters } = await import('../src/ai/ImageParameters.tsx');
const { PanelSettingsPage } = await import('../src/ai/PanelSettingsPage.tsx');
const { AuthPanel } = await import('../src/components/AuthPanel.tsx');
stylesheetLoader.deregister();

const unavailable = { supported: false, reason: '服务未开放此参数' };
const capabilities: ImageCapabilities = {
  quality: { supported: true, values: ['auto', 'low', 'high'], default: 'auto' },
  background: { supported: true, values: ['auto', 'opaque', 'transparent'], default: 'auto' },
  outputFormat: { supported: true, values: ['png', 'jpeg', 'webp'], default: 'png' },
  outputCompression: { supported: true, min: 0, max: 100, default: 100, formats: ['jpeg', 'webp'] },
  n: { supported: true, min: 1, max: 4, default: 1 },
  complexity: unavailable,
  references: {
    supported: true,
    maxCount: 4,
    maxBytes: 10_000_000,
    allowMask: true,
    allowMarkup: false,
  },
  size: {
    supported: true,
    multipleOf: 16,
    minPixels: 655360,
    maxPixels: 8294400,
    maxDimension: 3840,
    minAspectRatio: 1 / 3,
    maxAspectRatio: 3,
    auto: false,
  },
  inputFidelity: unavailable,
  stream: unavailable,
  partialImages: unavailable,
  svg: unavailable,
  gif: unavailable,
  dependencies: [],
};
const model: AIModel = {
  id: 'configured-gpt-image',
  label: 'Configured image model',
  enabled: true,
  provider: 'openai',
  parameterCapabilities: capabilities,
};
const empty = () => {};
const parameters = (selected: AIModel, disabled = false) =>
  renderTestMarkup(
    React.createElement(ImageParameters, {
      model: selected,
      width: 1024,
      height: 1024,
      options: { quality: 'auto', outputFormat: 'png', n: 1 },
      disabled,
      onSize: empty,
      onOptions: empty,
    }),
  );

test('primary model settings use the actual quality list and platform output cap', () => {
  const html = parameters(model);
  assert.match(html, /aria-label="质量"/);
  assert.match(html, />自动<|>自动<\/button>/);
  assert.match(html, /aria-label="输出数量"[^>]*max="4"/);
  assert.doesNotMatch(html, />超高<|>最高<|aria-label="复杂度"|aria-label="编码质量"/);
  const extended = parameters({
    ...model,
    parameterCapabilities: {
      ...capabilities,
      quality: { supported: true, values: ['auto', 'low', 'xhigh', 'max'] },
      n: { supported: true, min: 1, max: 2 },
    },
  });
  assert.match(extended, />超高</);
  assert.match(extended, />最高</);
  assert.match(extended, /aria-label="输出数量"[^>]*max="2"/);
});

test('unavailable parameter families create no enabled controls or empty advanced section', () => {
  const html = parameters({
    ...model,
    parameterCapabilities: {
      ...capabilities,
      quality: unavailable,
      background: unavailable,
      outputFormat: unavailable,
      outputCompression: unavailable,
      n: unavailable,
    },
  });
  assert.doesNotMatch(html, /aria-label="质量"|aria-label="输出数量"|>更多参数</);
  assert.match(html, />模型详情</);
});

test('unknown job input lock disables each primary control while settings remain inspectable', () => {
  const html = parameters(model, true);
  const controls = [...html.matchAll(/<(button|input)\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(
    controls
      .filter((tag) => !tag.includes('progressive-trigger'))
      .every((tag) => tag.includes('disabled=""')),
  );
  assert.match(html, /aria-expanded="false"/);
});

test('panel settings remain in the same section owner and hidden settings cannot receive focus', () => {
  const html = renderTestMarkup(
    React.createElement(PanelSettingsPage, {
      title: '任务设置',
      open: false,
      onClose: empty,
      children: React.createElement('button', {}, '参数'),
    }),
  );
  assert.match(html, /<section[^>]*aria-label="任务设置"[^>]*hidden=""[^>]*inert=""/);
  assert.doesNotMatch(html, /<dialog/);
  assert.match(html, /aria-label="返回对话"/);
});

test('default account entry is a password sign-in page with an explicit registration choice', () => {
  const html = renderTestMarkup(
    React.createElement(AuthPanel, { config: null, onSession: empty, onClose: empty }),
  );
  assert.match(html, /account-auth-password/);
  assert.match(html, /aria-label="登录已有账号"[^>]*aria-pressed="true"/);
  assert.match(html, />创建新账号</);
  assert.match(html, /autoComplete="current-password"|autocomplete="current-password"/);
  assert.doesNotMatch(html, /<dialog|data-testid="auth-display-name"/);
});
