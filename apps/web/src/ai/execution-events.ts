import type { StatusMarkState } from '../components/StatusMark';
import type { RunEvent } from './turnStream';

const toolNames: Readonly<Record<string, string>> = {
  describe_editor: '读取编辑参数',
  search_resources: '检索素材',
  delegate_research: '并行查找素材与检查画面',
  public_search: '检索公开来源',
  propose_sequence: '组合编辑步骤',
  propose_retouch: '准备局部质感候选',
  propose_healing: '准备局部修复候选',
  propose_edit: '准备参数候选',
  propose_scene_balance: '按画面亮度准备调色候选',
  propose_curve: '准备曲线',
  draft_generation: '整理生图要求',
  inspect_candidate: '渲染并检查真实候选图像',
  select_candidate: '确定本轮编辑方案',
  read_history: '回查原文',
  read_tool_result: '读取工具结果',
};
export const executionToolLabel = (name: unknown) =>
  typeof name === 'string' ? (toolNames[name] ?? '处理工具结果') : '处理工具结果';

export interface PublicExecutionEvent {
  id: string;
  runId: string;
  label: string;
  state: StatusMarkState;
}

/** Only public execution receipts, never text deltas, internal reasoning or a timer. */
export function publicExecutionEvent(event: RunEvent): PublicExecutionEvent | null {
  const toolState: Readonly<Record<string, StatusMarkState>> = {
    'tool.running': 'running',
    'tool.completed': 'done',
    'tool.failed': 'failed',
  };
  const runState: Readonly<Record<string, StatusMarkState>> = {
    'run.stopping': 'pending',
    'run.completed': 'done',
    'run.failed': 'failed',
    'run.unknown': 'unknown',
    'run.stopped': 'cancelled',
  };
  if (toolState[event.type])
    return {
      id: event.id,
      runId: event.runId,
      label: executionToolLabel(event.payload.name),
      state: toolState[event.type]!,
    };
  if (runState[event.type])
    return {
      id: event.id,
      runId: event.runId,
      label: '本轮执行',
      state: runState[event.type]!,
    };
  return null;
}

export function appendPublicExecutionEvent(
  events: readonly PublicExecutionEvent[],
  event: RunEvent,
) {
  const item = publicExecutionEvent(event);
  if (!item) return events;
  const current = events.filter((previous) => previous.runId === item.runId);
  if (current.some((previous) => previous.id === item.id)) return events;
  return [...current, item].slice(-24);
}
