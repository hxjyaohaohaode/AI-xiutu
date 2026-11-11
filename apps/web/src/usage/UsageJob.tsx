import { t, useLocale, formatNumber } from '../i18n';
import { useMemo, useState } from 'react';
import { ArrowClockwise, ArrowsSplit, Coins, Receipt, Stack } from '@phosphor-icons/react';
import type { PricingSnapshot, ProviderStage, UsageJobDetail } from '@ai-xiutu/contracts';
import { errorMessage, formatDate } from '../lib/api';
import { Busy, InlineError, Modal } from '../components/Ui';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { MotionDetails } from '../motion/Presence';
import { pointText, usageOperationName } from './model';
import { useUsageResource } from './useUsageResource';
import {
  assertPublishedPrices,
  assertUsageJobScope,
  groupProviderStages,
  holdStatusLabels,
  jobStatusLabels,
  meterLabels,
  meterUnit,
  publicPriceSource,
  publishedRateText,
  recordedCount,
  stagePurposeLabels,
  stageStatusLabels,
  summarizeProviderStages,
  usageJobEndpoint,
  usdText,
  type PublishedPrices,
  type UsageJobTarget,
} from './providerBilling';

function PriceSource({ snapshot }: { snapshot: PricingSnapshot | null }) {
  if (!snapshot) return <span>{t('派发时的适用费率未记录')}</span>;
  const source = publicPriceSource(snapshot.source);
  return (
    <span className="usage-price-source">
      {source ? (
        <a href={source} target="_blank" rel="noreferrer">
          {snapshot.version}
        </a>
      ) : (
        snapshot.version
      )}
      <span>{t('标准档 · USD')}</span>
    </span>
  );
}
function StageCard({ stage, index }: { stage: ProviderStage; index: number }) {
  const title = t(stagePurposeLabels[stage.purpose] ?? stage.purpose);
  return (
    <MotionDetails className="usage-stage">
      <summary>
        <span className="usage-stage-order" aria-hidden>
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="usage-stage-name">
          <strong>{title}</strong>
          <code title={stage.modelId}>{stage.modelId}</code>
          {stage.branchId && <small>{t('分支 {v0}', { v0: stage.branchId })}</small>}
        </span>
        <span className="usage-stage-result">
          <span className="usage-receipt-status" data-status={stage.status}>
            {t(stageStatusLabels[stage.status] ?? stage.status)}
          </span>
          <strong>
            {recordedCount(stage.totals.total) !== null
              ? `${pointText(stage.totals.total)} token`
              : stage.purpose === 'live-duration'
                ? t('按时长计量')
                : t('token 未记录')}
          </strong>
          <small>
            {stage.estimatedNanoUsd === null
              ? t('费用未知')
              : t('{v0}{v1}', {
                  v0: stage.estimateComplete ? '' : t('已知部分 '),
                  v1: usdText(stage.estimatedNanoUsd),
                })}
          </small>
        </span>
      </summary>
      <div className="usage-stage-body">
        {stage.purpose !== 'live-duration' && (
          <dl className="usage-token-totals">
            <div>
              <dt>{t('输入 token')}</dt>
              <dd>{pointText(recordedCount(stage.totals.input))}</dd>
            </div>
            <div>
              <dt>{t('输出 token')}</dt>
              <dd>{pointText(recordedCount(stage.totals.output))}</dd>
            </div>
            <div>
              <dt>{t('回执总量')}</dt>
              <dd>{pointText(recordedCount(stage.totals.total))}</dd>
            </div>
          </dl>
        )}
        {stage.meters.length ? (
          <div
            className="usage-meter-scroll"
            role="region"
            aria-label={t('{v0}计量项', { v0: title })}
            tabIndex={0}
          >
            <table className="usage-meter-table">
              <caption>{t('回执计量项')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('计量项')}</th>
                  <th scope="col">{t('数量')}</th>
                  <th scope="col">{t('派发时费率')}</th>
                  <th scope="col">{t('公开估算 / USD')}</th>
                </tr>
              </thead>
              <tbody>
                {stage.meters.map((meter) => (
                  <tr key={meter.meter}>
                    <th scope="row">{t(meterLabels[meter.meter] ?? meter.meter)}</th>
                    <td>
                      {pointText(recordedCount(meter.quantity))}
                      <small>{meterUnit(meter.meter)}</small>
                    </td>
                    <td>{publishedRateText(meter.rate)}</td>
                    <td>{usdText(meter.estimatedNanoUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="usage-empty-copy">
            {stage.status === 'pending'
              ? t('任务仍在处理，可稍后刷新读取回执。')
              : t('这个阶段尚无可展示的计量项。')}
          </p>
        )}
        {!stage.estimateComplete && (
          <p className="usage-footnote">
            {t('计量项、回执或适用费率不完整，已知部分不代表最终费用。')}
          </p>
        )}
        <dl className="usage-stage-meta">
          <div>
            <dt>{t('模型标识')}</dt>
            <dd>
              <code>{stage.modelId}</code>
            </dd>
          </div>
          <div>
            <dt>{t('派发时间')}</dt>
            <dd>{stage.dispatchedAt ? formatDate(stage.dispatchedAt) : t('未记录')}</dd>
          </div>
          <div>
            <dt>{t('回执时间')}</dt>
            <dd>{stage.receivedAt ? formatDate(stage.receivedAt) : t('未记录')}</dd>
          </div>
          <div>
            <dt>{t('调用标识')}</dt>
            <dd>
              <code>{stage.stageId}</code>
            </dd>
          </div>
          <div>
            <dt>{t('费率版本')}</dt>
            <dd>
              <PriceSource snapshot={stage.pricing} />
            </dd>
          </div>
        </dl>
      </div>
    </MotionDetails>
  );
}

/** Counts describe only the returned provider receipts; local research nodes have no token stage. */
export function UsageJobContent({ detail }: { detail: UsageJobDetail }) {
  useLocale();
  const [branch, setBranch] = useState('*');
  const summary = useMemo(() => summarizeProviderStages(detail.stages), [detail.stages]);
  const groups = useMemo(() => groupProviderStages(detail.stages), [detail.stages]);
  const branchKey = (id: string | null) => (id === null ? 'main' : `branch:${id}`);
  const selected = groups.some((group) => branchKey(group.branchId) === branch) ? branch : '*';
  const visible = detail.stages.filter(
    (stage) => selected === '*' || branchKey(stage.branchId) === selected,
  );
  return (
    <div className="usage-job-content">
      <div className="usage-job-heading">
        <div>
          <span className="usage-eyebrow">{usageOperationName(detail.operation)}</span>
          <h3>{detail.modelId}</h3>
        </div>
        <span
          className="usage-receipt-status"
          data-status={
            detail.state === 'unknown'
              ? 'unknown'
              : detail.state === 'running'
                ? 'pending'
                : 'received'
          }
        >
          {t(jobStatusLabels[detail.state] ?? detail.state)}
        </span>
      </div>
      <dl className="usage-job-metrics">
        <div>
          <dt>
            <Stack size={15} aria-hidden /> {t('回执 token')}
          </dt>
          <dd>{summary.tokenStages ? pointText(summary.knownTokens) : t('不适用')}</dd>
          <small>
            {summary.tokenStages
              ? t('{v0} / {v1} 个阶段有总量{v2}', {
                  v0: summary.recordedTokenStages,
                  v1: summary.tokenStages,
                  v2: summary.tokenComplete ? '' : t(' · 不完整'),
                })
              : t('按时长或其他计量项记录')}
          </small>
        </div>
        <div>
          <dt>
            <Coins size={15} aria-hidden /> {t('公开费率估算')}
          </dt>
          <dd>{usdText(summary.estimatedNanoUsd)}</dd>
          <small>
            {summary.estimateComplete ? t('按本任务冻结费率 · USD') : t('仅已知部分 · USD')}
          </small>
        </div>
        <div>
          <dt>
            <Receipt size={15} aria-hidden /> {t('任务预占额度')}
          </dt>
          <dd>
            {pointText(recordedCount(detail.units))}
            <span> {t('点')}</span>
          </dd>
          <small>
            {t(holdStatusLabels[detail.holdState] ?? detail.holdState)} {t('· 实际变动见下方流水')}
          </small>
        </div>
      </dl>
      <p className="usage-footnote usage-billing-note">
        {t(
          '美元数值依据已记录回执与公开费率估算，和平台服务点分别记录；供应商实际账单以其结算为准。',
        )}
      </p>
      {summary.knownTokens !== null && summary.knownTokens > 0 && (
        <section className="usage-job-distribution" aria-label={t('研究分支的已记录 token 分布')}>
          <div className="usage-section-heading">
            <h3>
              <ArrowsSplit size={17} aria-hidden /> {t('已记录 token 分布')}
            </h3>
            <span>
              {formatNumber(summary.branches)} {t('个关联分支')}
            </span>
          </div>
          <ol>
            {groups.map((group) => (
              <li key={branchKey(group.branchId)}>
                <div>
                  <strong>
                    {group.branchId
                      ? t('分支 {v0}', { v0: group.branchId })
                      : t('未关联分支的调用')}
                  </strong>
                  <span>{pointText(group.summary.knownTokens)} token</span>
                </div>
                <small>
                  {formatNumber(group.stages.length)} {t('次调用')}
                  {group.summary.missingTokenStages
                    ? t(' · {v0} 个阶段未记录总量', { v0: group.summary.missingTokenStages })
                    : ''}
                </small>
                {group.summary.knownTokens !== null && (
                  <svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
                    <rect width="100" height="4" rx="2" className="usage-distribution-track" />
                    <rect
                      width={(100 * group.summary.knownTokens) / summary.knownTokens!}
                      height="4"
                      rx="2"
                      className="usage-distribution-value"
                    />
                  </svg>
                )}
              </li>
            ))}
          </ol>
          <p className="usage-footnote">
            {t('只展示本次返回的供应商调用；本地素材检索和画面检查不计入 token 分布。')}
          </p>
        </section>
      )}
      <section className="usage-job-stages" aria-label={t('模型调用阶段')}>
        <div className="usage-section-heading">
          <h3>
            {t('模型调用阶段')}
            <span>{formatNumber(detail.stages.length)}</span>
          </h3>
          {groups.length > 1 && (
            <ChoiceSelect
              className="usage-branch-filter"
              ariaLabel={t('调用分支')}
              value={selected}
              onValueChange={setBranch}
              options={[
                { value: '*', label: t('全部调用') },
                ...groups.map((group) => ({
                  value: branchKey(group.branchId),
                  label: group.branchId ? t('分支 {v0}', { v0: group.branchId }) : t('未关联分支'),
                })),
              ]}
            />
          )}
        </div>
        <div className="usage-stage-list">
          {visible.map((stage) => (
            <StageCard key={stage.stageId} stage={stage} index={detail.stages.indexOf(stage)} />
          ))}
        </div>
        {!detail.stages.length && (
          <p className="usage-empty-copy">{t('尚无已记录的供应商调用。')}</p>
        )}
      </section>
      <MotionDetails className="usage-job-movements usage-small-details" defaultOpen>
        <summary>
          <span>{t('服务点流转')}</span>
          <span>
            {formatNumber(detail.movements.length)} {t('条')}
          </span>
        </summary>
        <ol>
          {detail.movements.map((movement) => (
            <li key={movement.id}>
              <div>
                <strong>
                  {{ hold: t('预占'), settled: t('结算'), released: t('释放') }[movement.kind] ??
                    movement.kind}
                </strong>
                <span>
                  {pointText(recordedCount(movement.units))} {t('点')}
                </span>
              </div>
              <time dateTime={movement.createdAt}>{formatDate(movement.createdAt)}</time>
              {movement.lotId && <code>{t('权益批次 {id}', { id: movement.lotId })}</code>}
            </li>
          ))}
        </ol>
        {!detail.movements.length && <p className="usage-empty-copy">{t('尚无关联流水。')}</p>}
      </MotionDetails>
      <MotionDetails className="usage-job-identifiers usage-small-details">
        <summary>{t('任务与账户标识')}</summary>
        <dl className="usage-stage-meta">
          <div>
            <dt>{t('任务 ID')}</dt>
            <dd>
              <code>{detail.jobId}</code>
            </dd>
          </div>
          <div>
            <dt>{t('预占 ID')}</dt>
            <dd>
              <code>{detail.holdId}</code>
            </dd>
          </div>
          <div>
            <dt>{t('成员 ID')}</dt>
            <dd>
              <code>{detail.actorId}</code>
            </dd>
          </div>
          <div>
            <dt>{t('空间 ID')}</dt>
            <dd>
              <code>{detail.spaceId}</code>
            </dd>
          </div>
        </dl>
      </MotionDetails>
    </div>
  );
}

export function UsagePublicPrices({ prices }: { prices: PricingSnapshot[] }) {
  useLocale();
  const [model, setModel] = useState('');
  const selected = prices.some((price) => price.modelId === model) ? model : '';
  const visible = prices.filter((price) => !selected || price.modelId === selected);
  return (
    <div className="usage-public-prices">
      <div className="usage-section-heading">
        <p>{t('标准档公开费率，以服务端版本为准。任务明细使用派发时的快照。')}</p>
        <ChoiceSelect
          className="usage-public-model-filter"
          ariaLabel={t('公开费率模型')}
          value={selected}
          onValueChange={setModel}
          options={[
            { value: '', label: t('全部模型') },
            ...prices.map((price) => ({ value: price.modelId, label: price.modelId })),
          ]}
        />
      </div>
      <div className="usage-public-price-list">
        {visible.map((snapshot) => (
          <section
            className="usage-public-price"
            key={`${snapshot.modelId}:${snapshot.version}`}
            aria-label={t('{v0}公开费率', { v0: snapshot.modelId })}
          >
            <div className="usage-public-price-heading">
              <strong>{snapshot.modelId}</strong>
              <PriceSource snapshot={snapshot} />
            </div>
            <table className="usage-rate-table">
              <caption className="usage-sr-only">
                {snapshot.modelId} {t('标准档公开费率')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('模型')}</th>
                  <th scope="col">{t('计量项')}</th>
                  <th scope="col">{t('公开单价 / USD')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(snapshot.meters).map(([key, rate], index) => (
                  <tr key={key}>
                    {index === 0 && (
                      <td
                        className="usage-rate-model"
                        rowSpan={Object.keys(snapshot.meters).length}
                      >
                        {snapshot.modelId}
                      </td>
                    )}
                    <th scope="row">{t(meterLabels[key as keyof typeof meterLabels] ?? key)}</th>
                    <td>{publishedRateText(rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      {!prices.length && <p className="usage-empty-copy">{t('当前没有可读取的公开费率。')}</p>}
      <p className="usage-footnote">
        {t('未列出费率不表示免费。公开估算不包含供应商发票差异，也不用于换算服务点余额。')}
      </p>
    </div>
  );
}

export function UsageJob({
  target,
  identity,
  operator,
  onClose,
}: {
  target: UsageJobTarget;
  identity: string;
  operator: boolean;
  onClose(): void;
}) {
  const key = JSON.stringify([identity, operator, target]);
  return (
    <UsageJobDialog
      key={key}
      target={target}
      identity={key}
      operator={operator}
      onClose={onClose}
    />
  );
}
function UsageJobDialog({
  target,
  identity,
  operator,
  onClose,
}: {
  target: UsageJobTarget;
  identity: string;
  operator: boolean;
  onClose(): void;
}) {
  useLocale();
  const [refresh, setRefresh] = useState(0);
  const path = usageJobEndpoint(target, operator);
  const result = useUsageResource<UsageJobDetail | PublishedPrices>(
    path,
    identity,
    String(refresh),
  );
  const checked = useMemo(() => {
    if (!result.data) return { detail: null, prices: null, error: null };
    try {
      if (target.kind === 'prices') {
        const value = result.data as PublishedPrices;
        assertPublishedPrices(value);
        return { detail: null, prices: value.prices, error: null };
      }
      const value = result.data as UsageJobDetail;
      assertUsageJobScope(value, target.reference);
      return { detail: value, prices: null, error: null };
    } catch (error) {
      return { detail: null, prices: null, error: errorMessage(error) };
    }
  }, [result.data, target]);
  return (
    <Modal
      title={target.kind === 'prices' ? t('模型公开费率') : t('任务调用与费用')}
      subtitle={target.kind === 'prices' ? t('按模型和计量项查看') : target.reference.jobId}
      onClose={onClose}
      className="studio-dialog usage-job-modal"
      wide
    >
      <div className="usage-job-toolbar">
        <span>{target.kind === 'prices' ? t('公开计价 · USD') : t('供应商回执与平台流水')}</span>
        <button
          type="button"
          className="text-button"
          disabled={result.loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <ArrowClockwise size={16} aria-hidden />{' '}
          {result.error || checked.error ? t('重新读取') : t('刷新')}
        </button>
      </div>
      <InlineError message={t(result.error || checked.error || '')} />
      {result.loading && (
        <div className="usage-job-loading" role="status">
          <Busy label={t('读取用量明细')} />
        </div>
      )}
      {checked.detail && <UsageJobContent detail={checked.detail} />}
      {checked.prices && <UsagePublicPrices prices={checked.prices} />}
    </Modal>
  );
}
