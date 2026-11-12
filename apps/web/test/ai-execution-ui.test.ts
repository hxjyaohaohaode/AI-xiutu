import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { appendPublicExecutionEvent, publicExecutionEvent } from '../src/ai/execution-events.ts';
import type { RunEvent } from '../src/ai/turnStream.ts';
import { renderTestMarkup } from './support/render.ts';

const styles = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: 'export {};', shortCircuit: true }
      : next(url, context);
  },
});
const { ComposerAction } = await import('../src/ai/ComposerAction.tsx');
styles.deregister();
const event = (
  type: string,
  id = '1',
  runId = 'run-1',
  payload: Record<string, unknown> = { name: 'search_resources' },
): RunEvent => ({ type, id, runId, payload, createdAt: '2026-11-12T06:00:00Z' });

test('the visible stop is a non-submit action and unresolved admission remains disabled', () => {
  const stop = renderTestMarkup(
    createElement(ComposerAction, { state: 'stop', label: 'Stop', disabled: false, onStop() {} }),
  );
  assert.match(stop, /type="button"/);
  assert.match(stop, /data-action="stop"/);
  assert.doesNotMatch(stop, /disabled=""/);
  const waiting = renderTestMarkup(
    createElement(ComposerAction, { state: 'waiting', label: 'Sending', disabled: true }),
  );
  assert.match(waiting, /disabled=""/);
  assert.match(waiting, /data-action="waiting"/);
  assert.doesNotMatch(waiting, /data-action="stop"/);
  const unwired = renderTestMarkup(
    createElement(ComposerAction, { state: 'stop', label: 'Pending', disabled: false }),
  );
  assert.match(unwired, /data-action="waiting"/);
  assert.match(unwired, /disabled=""/);
});

test('the execution trace never invents completion from text, elapsed time or unknown results', () => {
  assert.equal(
    publicExecutionEvent(event('text.delta', '1', 'run-1', { delta: 'private model text' })),
    null,
  );
  assert.equal(
    publicExecutionEvent(event('estimated-progress', '1', 'run-1', { progress: 0.9 })),
    null,
  );
  assert.equal(publicExecutionEvent(event('run.unknown'))?.state, 'unknown');
  assert.equal(publicExecutionEvent(event('run.failed'))?.state, 'failed');
  assert.equal(publicExecutionEvent(event('tool.completed'))?.label, '检索素材');
  assert.equal(
    publicExecutionEvent(event('tool.running', '1', 'run-1', { name: '<internal-payload>' }))
      ?.label,
    '处理工具结果',
  );
});

test('public trace keeps real independent step outcomes and does not leak them into another run', () => {
  let events = appendPublicExecutionEvent([], event('tool.running'));
  events = appendPublicExecutionEvent(events, event('tool.failed', '2'));
  events = appendPublicExecutionEvent(events, event('run.unknown', '3'));
  assert.deepEqual(
    events.map((item) => item.state),
    ['running', 'failed', 'unknown'],
  );
  const replay = appendPublicExecutionEvent(events, event('run.unknown', '3'));
  assert.equal(replay, events);
  const next = appendPublicExecutionEvent(events, event('tool.running', '1', 'run-2'));
  assert.equal(next.length, 1);
  assert.equal(next[0]?.runId, 'run-2');
});
