import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import { Busy, InlineError } from './Ui';
import './unknown-jobs.css';

interface Job {
  id: string;
  actorId: string;
  projectId: string;
  modelId: string;
  operation: string;
  providerRequestId: string | null;
  errorCode: string | null;
  heldUnits: number;
  createdAt: string;
}
interface Page {
  jobs: Job[];
  nextCursor: string | null;
  resolutionAvailable: boolean;
}
const operations: Record<string, string> = {
  'edit-plan': '参数建议',
  'generate-image': '图片生成',
  'generate-text': '文案生成',
  transcribe: '语音转写',
};
export function UnknownJobsPanel() {
  const [jobId, setJobId] = useState(''),
    [actorId, setActorId] = useState(''),
    [operation, setOperation] = useState('');
  const [filter, setFilter] = useState(''),
    [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]);
  const [data, setData] = useState<Page | null>(null),
    [loading, setLoading] = useState(false),
    [epoch, setEpoch] = useState(0);
  const [selected, setSelected] = useState<Job | null>(null),
    [resolution, setResolution] = useState<'settle' | 'release'>('settle');
  const [reason, setReason] = useState(''),
    [evidence, setEvidence] = useState(''),
    [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState('');
  const submitting = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const query = new URLSearchParams(filter);
    if (cursor) query.set('cursor', cursor);
    void api<Page>(`/ops/ai-jobs/unknown?${query}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filter, cursor, epoch]);
  async function resolve() {
    if (
      !selected ||
      !reviewed ||
      busy ||
      submitting.current ||
      reason.trim().length < 10 ||
      evidence.trim().length < 3
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      await api(
        `/ops/ai-jobs/${selected.id}/resolve`,
        jsonRequest('POST', { resolution, reason, evidenceRef: evidence }),
      );
      if (!alive.current) return;
      setSelected(null);
      setSuccess(
        resolution === 'settle'
          ? '已按核验证据结算，记录已写入账本与审计。'
          : '已按核验证据释放预占，记录已写入账本与审计。',
      );
      setCursor(null);
      setPrevious([]);
      setEpoch((value) => value + 1);
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="surface ops-section unknown-jobs" aria-label="生成任务核验">
      <h2>待核验的生成任务</h2>
      <p className="form-hint">
        这些请求的供应商结果尚未确认，预占额度保留。先核对供应商回执，再决定结算或释放；核验不会重新调用模型。
      </p>
      <form
        className="unknown-job-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const query = new URLSearchParams();
          if (jobId.trim()) query.set('jobId', jobId.trim());
          if (actorId.trim()) query.set('actorId', actorId.trim());
          if (operation) query.set('operation', operation);
          setCursor(null);
          setPrevious([]);
          setFilter(query.toString());
          setEpoch((value) => value + 1);
        }}
      >
        <label>
          任务编号
          <input
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            placeholder="完整任务 UUID"
          />
        </label>
        <label>
          账号编号
          <input
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
            placeholder="完整账号 UUID"
          />
        </label>
        <label>
          任务类型
          <select value={operation} onChange={(event) => setOperation(event.target.value)}>
            <option value="">全部类型</option>
            {Object.entries(operations).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || loading}>
          查询任务
        </button>
      </form>
      {error && <InlineError message={error} />}
      {success && <p role="status">{success}</p>}
      {loading ? (
        <Busy label="读取待核验任务" />
      ) : (
        <>
          {data?.jobs.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>任务 / 账号</th>
                    <th>类型 / 模型</th>
                    <th>预占点数</th>
                    <th>供应商回执 / 状态</th>
                    <th>时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <code>{job.id}</code>
                        <small>{job.actorId}</small>
                      </td>
                      <td>
                        {operations[job.operation] ?? job.operation}
                        <small>{job.modelId}</small>
                      </td>
                      <td>{job.heldUnits}</td>
                      <td>
                        {job.providerRequestId ?? '尚未取得回执'}
                        <small>{job.errorCode}</small>
                      </td>
                      <td>{formatDate(job.createdAt)}</td>
                      <td>
                        <button
                          disabled={busy || !data.resolutionAvailable}
                          onClick={() => {
                            setSelected(job);
                            setReason('');
                            setEvidence('');
                            setReviewed(false);
                            setSuccess('');
                          }}
                        >
                          核验此任务
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>当前筛选下没有待核验任务。</p>
          )}
          <nav aria-label="待核验任务分页">
            <button
              disabled={!previous.length || busy}
              onClick={() => {
                setCursor(previous.at(-1) ?? null);
                setPrevious((value) => value.slice(0, -1));
              }}
            >
              上一页
            </button>
            <span>第 {previous.length + 1} 页</span>
            <button
              disabled={!data?.nextCursor || busy}
              onClick={() => {
                setPrevious((value) => [...value, cursor]);
                setCursor(data!.nextCursor);
              }}
            >
              下一页
            </button>
          </nav>
          {data && !data.resolutionAvailable && (
            <p className="form-hint">当前服务未配置任务核验执行器，可查看记录。</p>
          )}
        </>
      )}
      {selected && (
        <form
          className="unknown-job-resolution"
          onSubmit={(event) => {
            event.preventDefault();
            void resolve();
          }}
        >
          <h3>核验任务 {selected.id}</h3>
          <fieldset disabled={busy}>
            <label>
              核验结论
              <select
                value={resolution}
                onChange={(event) => {
                  setResolution(event.target.value as 'settle' | 'release');
                  setReviewed(false);
                }}
              >
                <option value="settle">供应商已计费：结算预占额度</option>
                <option value="release">证据确认未计费：释放预占额度</option>
              </select>
            </label>
            <label>
              证据编号
              <input
                value={evidence}
                minLength={3}
                maxLength={200}
                required
                onChange={(event) => {
                  setEvidence(event.target.value);
                  setReviewed(false);
                }}
                placeholder="供应商工单、账单或请求核验编号"
              />
            </label>
            <label>
              核验说明
              <textarea
                value={reason}
                minLength={10}
                maxLength={1000}
                required
                rows={3}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReviewed(false);
                }}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              已核对该请求与证据，确认处理 {selected.heldUnits} 点预占额度
            </label>
            <button
              type="submit"
              disabled={!reviewed || reason.trim().length < 10 || evidence.trim().length < 3}
            >
              提交核验结论
            </button>
            <button type="button" onClick={() => setSelected(null)}>
              取消
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
