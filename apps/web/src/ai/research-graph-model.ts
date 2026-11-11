import type { AssistantBranchEvent } from '@ai-xiutu/contracts';

export type ResearchBranch = Omit<AssistantBranchEvent, 'state'> & {
  state: AssistantBranchEvent['state'] | 'interrupted';
};
export const branchNames = {
  root: '编辑助手',
  web: '公开来源',
  cloud: '授权素材',
  canvas: '实际画面',
  merge: '汇合',
  candidate: '准备编辑候选',
  'pixel-review': '复核候选像素',
  nomination: '推荐候选',
} as const;
export const branchStates = {
  running: '进行中',
  completed: '完成',
  failed: '未完成',
  interrupted: '已中断',
  syncing: '待同步',
} as const;

export function isResearchBranch(value: unknown): value is ResearchBranch {
  if (!value || typeof value !== 'object') return false;
  const branch = value as ResearchBranch;
  return (
    typeof branch.id === 'string' &&
    branch.id.length > 0 &&
    branch.id.length <= 128 &&
    (branch.parentId === null || typeof branch.parentId === 'string') &&
    Array.isArray(branch.dependsOn) &&
    branch.dependsOn.length <= 48 &&
    branch.dependsOn.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128) &&
    Object.hasOwn(branchNames, branch.kind) &&
    ['running', 'completed', 'failed', 'interrupted'].includes(branch.state) &&
    ['provider', 'server'].includes(branch.execution) &&
    (branch.resultCount === undefined ||
      (Number.isInteger(branch.resultCount) && branch.resultCount >= 0))
  );
}

/** SSE can resume after a snapshot. A partial live update must not remove its dependencies. */
export function mergeResearchBranches(
  stored: readonly ResearchBranch[],
  live: readonly ResearchBranch[],
  liveWins: boolean,
): ResearchBranch[] {
  const nodes = new Map<string, ResearchBranch>();
  for (const branch of liveWins ? [...stored, ...live] : [...live, ...stored])
    nodes.set(branch.id, branch);
  return [...nodes.values()].slice(0, 48);
}

export function researchDisplayState(branch: ResearchBranch, running: boolean, fresh: boolean) {
  return branch.state === 'running' && !running && !fresh ? 'syncing' : branch.state;
}
