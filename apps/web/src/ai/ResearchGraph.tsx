import { useEffect, useState } from 'react';
import type { AssistantBranchEvent } from '@ai-xiutu/contracts';
import { api } from '../lib/api';

type Branch = Omit<AssistantBranchEvent, 'state'> & {
  state: AssistantBranchEvent['state'] | 'interrupted';
};
const name = {
  root: '编辑 Agent',
  web: '公开来源',
  cloud: '授权素材',
  canvas: '实际画面',
  merge: '汇合',
};
const state = { running: '进行中', completed: '完成', failed: '未完成', interrupted: '已中断' };
export function ResearchGraph({
  turnId,
  live,
  running,
}: {
  turnId?: string;
  live: AssistantBranchEvent[];
  running: boolean;
}) {
  const [data, setData] = useState<{ turnId: string; running: boolean; branches: Branch[] } | null>(
    null,
  );
  useEffect(() => {
    if (!turnId) return;
    const controller = new AbortController();
    void api<{ branches: Branch[] }>(`/assistant-turns/${encodeURIComponent(turnId)}/branches`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setData({ turnId, running, branches: result.branches });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [turnId, running]);
  const stored = data && data.turnId === turnId && data.running === running ? data.branches : null;
  const branches: Branch[] = running && live.length ? live : (stored ?? live);
  const root = branches.find((branch) => branch.kind === 'root');
  const children = branches.filter((branch) => branch.kind !== 'root' && branch.kind !== 'merge');
  if (!root || !children.length) return null;
  const merges = branches.filter((branch) => branch.kind === 'merge');
  return (
    <details className="assistant-research-graph" open={running || undefined}>
      <summary>研究分工 · {state[root.state]}</summary>
      <ul aria-label="任务分支">
        {children.map((branch) => (
          <li key={branch.id}>
            <span>{name[branch.kind]}</span> · {state[branch.state]}
            {branch.resultCount !== undefined && <small> · {branch.resultCount} 项证据</small>}
          </li>
        ))}
      </ul>
      {merges.map((branch) => (
        <p key={branch.id}>
          ↳ {branch.dependsOn.length} 个分支汇合 · {state[branch.state]}
        </p>
      ))}
    </details>
  );
}
