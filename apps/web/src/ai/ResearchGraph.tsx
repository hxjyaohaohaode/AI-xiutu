import { useEffect, useState } from 'react';
import { CaretDown, GitMerge, Globe, Images, Scan, TreeStructure } from '@phosphor-icons/react';
import type { AssistantBranchEvent } from '@ai-xiutu/contracts';
import { api } from '../lib/api';
import { MotionDetails } from '../motion/Presence';

type Branch = Omit<AssistantBranchEvent, 'state'> & {
  state: AssistantBranchEvent['state'] | 'interrupted';
};
const name = {
  root: '编辑助手',
  web: '公开来源',
  cloud: '授权素材',
  canvas: '实际画面',
  merge: '汇合',
};
const state = { running: '进行中', completed: '完成', failed: '未完成', interrupted: '已中断' };
const icon = { root: TreeStructure, web: Globe, cloud: Images, canvas: Scan, merge: GitMerge };
function isBranch(value: unknown): value is Branch {
  if (!value || typeof value !== 'object') return false;
  const branch = value as Branch;
  return (
    typeof branch.id === 'string' &&
    branch.id.length > 0 &&
    branch.id.length <= 128 &&
    (branch.parentId === null || typeof branch.parentId === 'string') &&
    Array.isArray(branch.dependsOn) &&
    branch.dependsOn.every((id) => typeof id === 'string') &&
    Object.hasOwn(name, branch.kind) &&
    Object.hasOwn(state, branch.state) &&
    ['provider', 'server'].includes(branch.execution) &&
    (branch.resultCount === undefined ||
      (Number.isInteger(branch.resultCount) && branch.resultCount >= 0))
  );
}
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
  const [failedTurn, setFailedTurn] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!turnId) return;
    const controller = new AbortController();
    setFailedTurn(null);
    void api<{ turnId: string; branches: Branch[] }>(
      `/assistant-turns/${encodeURIComponent(turnId)}/branches`,
      {
        signal: controller.signal,
      },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          result.turnId !== turnId ||
          !Array.isArray(result.branches) ||
          result.branches.length > 40 ||
          !result.branches.every(isBranch)
        )
          throw new Error('Invalid research graph');
        setData({ turnId, running, branches: result.branches });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailedTurn(turnId);
      });
    return () => controller.abort();
  }, [turnId, running, reload]);
  const stored = data && data.turnId === turnId && data.running === running ? data.branches : null;
  const liveBranches = live.filter(isBranch);
  const branches: Branch[] =
    running && liveBranches.length ? liveBranches : (stored ?? liveBranches);
  const root = branches.find((branch) => branch.kind === 'root');
  const children = branches.filter((branch) => branch.kind !== 'root' && branch.kind !== 'merge');
  if (!root || !children.length) return null;
  const merges = branches.filter((branch) => branch.kind === 'merge');
  const status = (branch: Branch) =>
    branch.state === 'running' && !running && !stored ? '待同步' : state[branch.state];
  return (
    <MotionDetails key={turnId} className="assistant-research-graph" defaultOpen={running}>
      <summary>
        <TreeStructure size={16} aria-hidden="true" />
        <span>研究分工</span>
        <small data-state={root.state}>{status(root)}</small>
        <CaretDown className="assistant-research-chevron" size={14} aria-hidden="true" />
      </summary>
      <div className="assistant-research-content">
        <ul aria-label="任务分支">
          {children.map((branch) => {
            const Icon = icon[branch.kind];
            return (
              <li key={branch.id}>
                <Icon size={16} aria-hidden="true" />
                <span>{name[branch.kind]}</span>
                <small data-state={branch.state}>{status(branch)}</small>
                {branch.resultCount !== undefined && (
                  <span className="assistant-research-count">{branch.resultCount} 项证据</span>
                )}
              </li>
            );
          })}
        </ul>
        {merges.map((branch) => (
          <p className="assistant-research-merge" key={branch.id}>
            <GitMerge size={16} aria-hidden="true" />
            <span>{branch.dependsOn.length} 个分支汇合</span>
            <small data-state={branch.state}>{status(branch)}</small>
          </p>
        ))}
        {failedTurn === turnId && (
          <p className="assistant-research-retry" role="status">
            <span>进度暂未同步，已保留最近记录。</span>
            <button type="button" onClick={() => setReload((old) => old + 1)}>
              刷新进度
            </button>
          </p>
        )}
      </div>
    </MotionDetails>
  );
}
