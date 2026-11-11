import { t, useLocale } from '../i18n';
import { useEffect, useState } from 'react';
import {
  CaretDown,
  CheckCircle,
  GitMerge,
  Globe,
  Images,
  PencilSimple,
  Scan,
  TreeStructure,
  WarningCircle,
  CircleNotch,
  PauseCircle,
} from '@phosphor-icons/react';
import type { AssistantBranchEvent } from '@ai-xiutu/contracts';
import { api } from '../lib/api';
import { MotionDetails } from '../motion/Presence';
import {
  branchNames as name,
  branchStates as state,
  isResearchBranch as isBranch,
  mergeResearchBranches,
  researchDisplayState,
  type ResearchBranch as Branch,
} from './research-graph-model';
const icon = {
  root: TreeStructure,
  web: Globe,
  cloud: Images,
  canvas: Scan,
  merge: GitMerge,
  candidate: PencilSimple,
  'pixel-review': Scan,
  nomination: CheckCircle,
};
export function ResearchGraph({
  turnId,
  live,
  running,
}: {
  turnId?: string;
  live: AssistantBranchEvent[];
  running: boolean;
}) {
  const locale = useLocale();
  const copy =
    locale === 'en'
      ? {
          complete: 'completed',
          provider: 'Model execution',
          server: 'Workspace operation',
          waiting: 'Dependency not yet received',
          detail: 'Task details',
        }
      : locale === 'zh-TW'
        ? {
            complete: '項已完成',
            provider: '模型執行',
            server: '工作區操作',
            waiting: '依據尚未同步',
            detail: '任務詳情',
          }
        : {
            complete: '项已完成',
            provider: '模型执行',
            server: '工作区操作',
            waiting: '依据尚未同步',
            detail: '任务详情',
          };
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
          result.branches.length > 48 ||
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
  const stored = data && data.turnId === turnId ? data.branches : [];
  const fresh = !!data && data.turnId === turnId && data.running === running;
  const liveBranches = live.filter(isBranch);
  const branches = mergeResearchBranches(stored, liveBranches, running || !fresh);
  const root = branches.find((branch) => branch.kind === 'root');
  const children = branches.filter((branch) => branch.kind !== 'root' && branch.kind !== 'merge');
  if (!root || !children.length) return null;
  const merges = branches.filter((branch) => branch.kind === 'merge');
  const isEditing = children.some((branch) =>
    ['candidate', 'pixel-review', 'nomination'].includes(branch.kind),
  );
  const status = (branch: Branch) => state[researchDisplayState(branch, running, fresh)];
  const completed = children.filter((branch) => branch.state === 'completed').length;
  const StatusIcon = ({ branch }: { branch: Branch }) => {
    const displayed = researchDisplayState(branch, running, fresh);
    const Status =
      displayed === 'completed'
        ? CheckCircle
        : displayed === 'failed'
          ? WarningCircle
          : displayed === 'running'
            ? CircleNotch
            : PauseCircle;
    return <Status className="research-status-icon" size={15} data-state={displayed} aria-hidden />;
  };
  return (
    <MotionDetails
      key={turnId}
      className="assistant-research-graph research-paths"
      defaultOpen={running}
    >
      <summary>
        <TreeStructure size={16} aria-hidden="true" />
        <span>{t(isEditing ? '编辑任务进度' : '研究分工')}</span>
        <small data-state={researchDisplayState(root, running, fresh)}>{t(status(root))}</small>
        <CaretDown className="assistant-research-chevron" size={14} aria-hidden="true" />
      </summary>
      <div className="assistant-research-content">
        <p className="research-completion" aria-live="polite">
          <strong>
            {completed}
            <span> / {children.length}</span>
          </strong>
          <span>{copy.complete}</span>
        </p>
        <ul aria-label={t('任务分支')}>
          {children.map((branch, index) => {
            const Icon = icon[branch.kind];
            const dependencies = branch.dependsOn.flatMap((id) => {
              const dependency = branches.find((entry) => entry.id === id);
              const position = children.findIndex((entry) => entry.id === id);
              return dependency
                ? [`${position >= 0 ? `${position + 1}. ` : ''}${t(name[dependency.kind])}`]
                : [copy.waiting];
            });
            return (
              <li key={branch.id} data-state={researchDisplayState(branch, running, fresh)}>
                <MotionDetails className="research-task">
                  <summary
                    aria-label={`${index + 1}. ${t(name[branch.kind])} · ${t(status(branch))} · ${copy.detail}`}
                  >
                    <span className="research-task-icon">
                      <Icon size={17} aria-hidden />
                    </span>
                    <span className="research-task-heading">
                      <strong>{t(name[branch.kind])}</strong>
                      <small>
                        {branch.resultCount !== undefined &&
                        ['web', 'cloud', 'canvas'].includes(branch.kind)
                          ? `${branch.resultCount} ${t('项证据')}`
                          : branch.execution === 'provider'
                            ? copy.provider
                            : copy.server}
                      </small>
                    </span>
                    <span className="research-task-state">
                      <StatusIcon branch={branch} />
                      <span>{t(status(branch))}</span>
                    </span>
                    <CaretDown className="research-task-chevron" size={12} aria-hidden />
                  </summary>
                  <div className="research-task-detail">
                    <p>{branch.execution === 'provider' ? copy.provider : copy.server}</p>
                    {dependencies.length > 0 && (
                      <p>
                        {t('依据 {v0}', { v0: dependencies.join(locale === 'en' ? ', ' : '、') })}
                      </p>
                    )}
                  </div>
                </MotionDetails>
              </li>
            );
          })}
        </ul>
        {merges.map((branch) => (
          <p className="assistant-research-merge" key={branch.id}>
            <GitMerge size={16} aria-hidden="true" />
            <span>
              {branch.dependsOn.length} {t('个分支汇合')}
            </span>
            <small data-state={researchDisplayState(branch, running, fresh)}>
              <StatusIcon branch={branch} />
              {t(status(branch))}
            </small>
          </p>
        ))}
        {failedTurn === turnId && (
          <p className="assistant-research-retry" role="status">
            <span>{t('进度暂未同步，已保留最近记录。')}</span>
            <button type="button" onClick={() => setReload((old) => old + 1)}>
              {t('刷新进度')}
            </button>
          </p>
        )}
      </div>
    </MotionDetails>
  );
}
