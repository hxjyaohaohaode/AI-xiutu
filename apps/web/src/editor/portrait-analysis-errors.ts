export const PORTRAIT_ANALYSIS_TIMEOUT_MESSAGE =
  '人物识别超时，已停止。请重试识别，或继续使用手动局部、绘制与液化。';

const timeoutMessages = new Set([
  'signal timed out',
  'The operation was aborted due to timeout',
  'The operation was aborted due to timeout.',
]);

/** Normalize only a known timeout; keep other diagnostics specific and reviewable. */
export function portraitAnalysisErrorMessage(failure: unknown): string {
  const error =
    typeof failure === 'object' && failure !== null
      ? (failure as { name?: unknown; message?: unknown })
      : null;
  const message = typeof error?.message === 'string' ? error.message : null;
  if (
    error?.name === 'TimeoutError' ||
    (message !== null && timeoutMessages.has(message)) ||
    (typeof failure === 'string' && timeoutMessages.has(failure))
  )
    return PORTRAIT_ANALYSIS_TIMEOUT_MESSAGE;
  return message || '人像分析失败，请使用手动选区。';
}
