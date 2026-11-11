import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PORTRAIT_ANALYSIS_TIMEOUT_MESSAGE,
  portraitAnalysisErrorMessage,
} from '../src/editor/portrait-analysis-errors.ts';

test('portrait resource timeouts retain a readable recovery state across worker serialization', () => {
  const timeout = new DOMException('signal timed out', 'TimeoutError');
  assert.equal(portraitAnalysisErrorMessage(timeout), PORTRAIT_ANALYSIS_TIMEOUT_MESSAGE);
  const wireMessage = structuredClone({ error: portraitAnalysisErrorMessage(timeout) });
  assert.equal(
    portraitAnalysisErrorMessage(new Error(wireMessage.error)),
    PORTRAIT_ANALYSIS_TIMEOUT_MESSAGE,
  );
  for (const raw of [
    new Error('signal timed out'),
    new DOMException('The operation was aborted due to timeout.', 'TimeoutError'),
    { name: 'TimeoutError', message: 'Browser-specific timeout wording' },
    'signal timed out',
  ])
    assert.equal(portraitAnalysisErrorMessage(raw), PORTRAIT_ANALYSIS_TIMEOUT_MESSAGE);
});

test('portrait timeout presentation preserves cancellation, validation and unknown diagnostics', () => {
  for (const failure of [
    new DOMException('The operation was aborted', 'AbortError'),
    new Error('人像模型资源版本与当前程序不一致。'),
    new Error('Missing resolved model asset /vision/face_landmarker.task'),
    new Error('A different timeout setting is invalid'),
  ])
    assert.equal(portraitAnalysisErrorMessage(failure), failure.message);
  assert.equal(portraitAnalysisErrorMessage(undefined), '人像分析失败，请使用手动选区。');
});
