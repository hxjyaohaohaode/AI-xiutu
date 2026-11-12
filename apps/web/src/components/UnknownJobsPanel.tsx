import { t } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import { InlineError } from './Ui';
import { CheckControl } from './CheckControl';
import { StatusMark } from './StatusMark';
import { FeatureSkeleton } from './DeferredFeature';
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
    [loading, setLoading] = useState(true),
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
    setData(null);
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
    <section
      className="surface ops-section unknown-jobs"
      aria-label={t('生成任务核验')}
      data-read-state={loading ? 'loading' : data ? 'ready' : 'error'}
    >
      <h2>{t('待核验的生成任务')}</h2>
      <p className="form-hint">
        {t(
          '这些请求的供应商结果尚未确认，预占额度保留。先核对供应商回执，再决定结算或释放；核验不会重新调用模型。',
        )}
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
          {t('任务编号')}
          <input
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            placeholder={t('完整任务 UUID')}
          />
        </label>
        <label>
          {t('账号编号')}
          <input
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
            placeholder={t('完整账号 UUID')}
          />
        </label>
        <label>
          {t('任务类型')}
          <ChoiceSelect
            ariaLabel={t('待核验任务类型')}
            value={operation}
            onValueChange={setOperation}
            options={[
              { value: '', label: t('全部类型') },
              ...Object.entries(operations).map(([value, label]) => ({ value, label: t(label) })),
            ]}
          />
        </label>
        <button type="submit" disabled={busy || loading}>
          {t('查询任务')}
        </button>
      </form>
      {error && <InlineError message={error} />}
      {error && !loading && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => setEpoch((value) => value + 1)}
        >
          {t('重新读取')}
        </button>
      )}
      {success && (
        <p role="status">
          <StatusMark state="done" size="small" label={t(success)} />
        </p>
      )}
      {loading ? (
        <FeatureSkeleton profile="table" label={t('读取待核验任务')} compact />
      ) : data ? (
        <>
          {data?.jobs.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('任务 / 账号')}</th>
                    <th>{t('类型 / 模型')}</th>
                    <th>{t('预占点数')}</th>
                    <th>{t('供应商回执 / 状态')}</th>
                    <th>{t('时间')}</th>
                    <th>{t('操作')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((job) => (
                    <tr key={job.id}>
                      <td data-label={t('任务 / 账号')}>
                        <code>{job.id}</code>
                        <small>{job.actorId}</small>
                      </td>
                      <td data-label={t('类型 / 模型')}>
                        {t(operations[job.operation] ?? job.operation)}
                        <small>{job.modelId}</small>
                      </td>
                      <td data-label={t('预占点数')}>{job.heldUnits}</td>
                      <td data-label={t('供应商回执 / 状态')}>
                        {job.providerRequestId ?? t('尚未取得回执')}
                        <small>{job.errorCode}</small>
                      </td>
                      <td data-label={t('时间')}>{formatDate(job.createdAt)}</td>
                      <td data-label={t('操作')}>
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
                          {t('核验此任务')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{t('当前筛选下没有待核验任务。')}</p>
          )}
          <nav aria-label={t('待核验任务分页')}>
            <button
              disabled={!previous.length || busy}
              onClick={() => {
                setCursor(previous.at(-1) ?? null);
                setPrevious((value) => value.slice(0, -1));
              }}
            >
              {t('上一页')}
            </button>
            <span>
              {t('第')}
              {previous.length + 1} {t('页')}
            </span>
            <button
              disabled={!data?.nextCursor || busy}
              onClick={() => {
                setPrevious((value) => [...value, cursor]);
                setCursor(data!.nextCursor);
              }}
            >
              {t('下一页')}
            </button>
          </nav>
          {data && !data.resolutionAvailable && (
            <p className="form-hint">{t('当前服务未配置任务核验执行器，可查看记录。')}</p>
          )}
        </>
      ) : null}
      {selected && (
        <form
          className="unknown-job-resolution"
          onSubmit={(event) => {
            event.preventDefault();
            void resolve();
          }}
        >
          <h3>
            {t('核验任务')}
            {selected.id}
          </h3>
          <fieldset disabled={busy}>
            <label>
              {t('核验结论')}
              <ChoiceSelect
                ariaLabel={t('任务核验结论')}
                value={resolution}
                disabled={busy}
                onValueChange={(value) => {
                  setResolution(value);
                  setReviewed(false);
                }}
                options={[
                  { value: 'settle', label: t('结算预占额度'), description: t('供应商已计费') },
                  { value: 'release', label: t('释放预占额度'), description: t('证据确认未计费') },
                ]}
              />
            </label>
            <label>
              {t('证据编号')}
              <input
                value={evidence}
                minLength={3}
                maxLength={200}
                required
                onChange={(event) => {
                  setEvidence(event.target.value);
                  setReviewed(false);
                }}
                placeholder={t('供应商工单、账单或请求核验编号')}
              />
            </label>
            <label>
              {t('核验说明')}
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
            <CheckControl
              className="check-row"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              label={
                <>
                  {t('已核对该请求与证据，确认处理')}
                  {selected.heldUnits} {t('点预占额度')}
                </>
              }
            />
            <button
              type="submit"
              disabled={!reviewed || reason.trim().length < 10 || evidence.trim().length < 3}
            >
              {t('提交核验结论')}
            </button>
            <button type="button" onClick={() => setSelected(null)}>
              {t('取消')}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
