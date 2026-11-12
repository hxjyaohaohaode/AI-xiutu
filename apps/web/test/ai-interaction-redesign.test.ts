import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssistantCandidate } from '@ai-xiutu/contracts';
import type { ImageCapabilities } from '../src/ai/types.ts';
import { CandidateActions } from '../src/ai/CandidateActions.tsx';
import { voiceErrorMessage } from '../src/ai/voice-error.ts';
import { opsModelFields } from '../src/components/ops-model-fields.ts';

const candidate = {
  id: 'candidate-1',
  kind: 'edit',
  decision: 'previewed',
  summary: '提亮阴影',
} as AssistantCandidate;

test('a cancelled preview remains available for a second local preview', () => {
  const html = renderToStaticMarkup(createElement(CandidateActions, {
    candidate, disabled: false, canExecute: true, onDecision() {},
  }));
  assert.match(html, /重新预览/);
  assert.doesNotMatch(html, /disabled/);
  assert.doesNotMatch(html, /已保存新版本/);
});

test('preview controls are adjacent and cannot claim an unwired confirmation', () => {
  const locked = renderToStaticMarkup(createElement(CandidateActions, {
    candidate, disabled: false, canExecute: true, previewing: true, onDecision() {},
  }));
  assert.match(locked, /取消预览/);
  assert.match(locked, /确认调整/);
  assert.equal((locked.match(/disabled/g) ?? []).length, 2);
  const ready = renderToStaticMarkup(createElement(CandidateActions, {
    candidate, disabled: false, canExecute: true, previewing: true,
    onDecision() {}, onConfirm() {}, onCancel() {},
  }));
  assert.doesNotMatch(ready, /disabled/);
});

test('a persisted result has a terminal outcome without another apply control', () => {
  const html = renderToStaticMarkup(createElement(CandidateActions, {
    candidate: { ...candidate, appliedRevisionId: 'revision-1' },
    disabled: false, canExecute: true, onDecision() {},
  }));
  assert.match(html, /已保存新版本/);
  assert.doesNotMatch(html, /<button/);
});

test('microphone device failures have distinct actionable messages', () => {
  assert.match(voiceErrorMessage({ name: 'NotFoundError' }), /未找到麦克风/);
  assert.match(voiceErrorMessage({ name: 'NotAllowedError' }), /允许使用麦克风/);
  assert.match(voiceErrorMessage({ name: 'NotReadableError' }), /被占用或无法启动/);
  assert.match(voiceErrorMessage(new Error('服务点不足')), /服务点不足/);
});

test('operations only expose dimensions, batches and quality for image tasks', () => {
  const text = opsModelFields({ operations: ['edit-plan', 'generate-text'], allowedQualities: ['auto'] });
  assert.equal(text.sizes, false);
  assert.equal(text.outputs, false);
  assert.deepEqual(text.qualities, []);
  const image = opsModelFields(
    { operations: ['generate-image'], allowedQualities: ['auto', 'high'] },
    {
      size: { supported: true, maxDimension: 4096 },
      n: { supported: true, max: 1 },
      quality: { supported: true, values: ['high'] },
    } as ImageCapabilities,
  );
  assert.equal(image.sizes, true);
  assert.equal(image.maxDimension, 4096);
  assert.equal(image.outputs, false);
  assert.deepEqual(image.qualities, ['high']);
});
