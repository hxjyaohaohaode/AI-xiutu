import { useEffect, useState } from 'react';
import type { Meter, PricingSnapshot, UsageJobDetail } from '@ai-xiutu/contracts';
import { api, errorMessage, formatDate } from '../lib/api';
import { Busy, InlineError, Modal } from '../components/Ui';

const labels: Record<Meter, string> = {
  input: '输入',
  'cached-input': '缓存输入',
  output: '输出',
  reasoning: '推理输出',
  'text-input': '文本输入',
  'text-cached': '文本缓存',
  'text-output': '文本输出',
  'image-input': '图片输入',
  'image-cached': '图片缓存',
  'image-output': '图片输出',
  'audio-input': '音频输入',
  'audio-cached': '音频缓存',
  'audio-output': '音频输出',
  'web-search': '公开检索',
  'voice-seconds': '通话计费时长',
};
const purpose: Record<string, string> = {
  conversation: '编辑对话',
  'web-search': '公开检索',
  'research-merge': '合并研究证据',
  'generate-image': '生图',
  'live-duration': '实时通话时长',
  'realtime-response': '实时语音回应',
  'voice-delegation': '通话委派',
  'generate-text': '文案',
  transcribe: '转写',
};
function usd(nano: string) {
  const amount = BigInt(nano);
  const decimal = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `$${amount / 1_000_000_000n}${decimal ? '.' + decimal : ''}`;
}

function JobFlow({ detail }: { detail: UsageJobDetail }) {
  const total = detail.stages.reduce((sum, stage) => sum + (stage.totals.total ?? 0), 0);
  const largest = detail.stages
    .filter((stage) => stage.totals.total)
    .sort((a, b) => (b.totals.total ?? 0) - (a.totals.total ?? 0))
    .slice(0, 8);
  if (!total) return null;
  const height = Math.max(95, largest.length * 35 + 20);
  const shown = largest.reduce((sum, stage) => sum + (stage.totals.total ?? 0), 0);
  return (
    <figure className="usage-job-flow">
      <svg viewBox={`0 0 620 ${height}`} role="img" aria-label="任务与调用阶段之间的 token 流向">
        <rect
          x="28"
          y={height / 2 - 23}
          width="94"
          height="46"
          rx="9"
          fill="currentColor"
          opacity=".09"
        />
        <text x="38" y={height / 2 - 2}>
          任务总量
        </text>
        <text x="38" y={height / 2 + 15}>
          {total.toLocaleString('zh-CN')}
        </text>
        {largest.map((stage, index) => {
          const y = index * 35 + 20;
          const model = stage.modelId.length > 24 ? `${stage.modelId.slice(0, 23)}…` : stage.modelId;
          return (
            <g key={stage.stageId}>
              <title>{stage.modelId} · {stage.totals.total?.toLocaleString('zh-CN')} token</title>
              <path
                d={`M126 ${height / 2 + (index - (largest.length - 1) / 2) * 4} C226 ${height / 2}, 255 ${y}, 365 ${y}`}
                fill="none"
                stroke="currentColor"
                opacity={0.19 + (index % 3) * 0.09}
                strokeWidth={Math.max(2, (30 * (stage.totals.total ?? 0)) / total)}
              />
              <text x="378" y={y - 2}>
                {purpose[stage.purpose] ?? stage.purpose}
              </text>
              <text x="378" y={y + 13}>
                {model} · {stage.totals.total?.toLocaleString('zh-CN')}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        按供应商回执中的 token 数绘制。
        {shown < total ? `图中显示用量最高的 ${largest.length} 个阶段，表格列出全部阶段。` : ''}
      </figcaption>
    </figure>
  );
}

export function UsageJob({
  id,
  operator,
  onClose,
}: {
  id: string;
  operator: boolean;
  onClose(): void;
}) {
  const [detail, setDetail] = useState<UsageJobDetail | null>(null);
  const [prices, setPrices] = useState<PricingSnapshot[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    if (id === 'prices') {
      void api<{ prices: PricingSnapshot[] }>('/usage/model-prices', { signal: controller.signal })
        .then((result) => setPrices(result.prices))
        .catch((failure) => {
          if (!controller.signal.aborted) setError(errorMessage(failure));
        });
    } else {
      void api<UsageJobDetail>(`${operator ? '/ops' : ''}/usage/jobs/${encodeURIComponent(id)}`, {
        signal: controller.signal,
      })
        .then(setDetail)
        .catch((failure) => {
          if (!controller.signal.aborted) setError(errorMessage(failure));
        });
    }
    return () => controller.abort();
  }, [id, operator]);
  return (
    <Modal
      title={id === 'prices' ? '模型公开费率' : '任务调用与费用'}
      subtitle={id === 'prices' ? '按模型和计量项查看' : id}
      className="studio-dialog"
      wide
      onClose={onClose}
    >
      <InlineError message={error} />
      {!error && !detail && !prices && <Busy label="读取用量明细" />}
      {detail && (
        <>
          <p>
            {detail.modelId} · {detail.units.toLocaleString('zh-CN')} 服务点 ·{' '}
            {{ held: '预占中', unknown: '待核验', settled: '已结算', released: '已释放' }[
              detail.holdState
            ] ?? detail.holdState}
          </p>
          <JobFlow detail={detail} />
          <div className="usage-table-scroll" role="region" aria-label="模型调用阶段" tabIndex={0}>
            <table className="usage-table">
              <caption>模型调用阶段</caption>
              <thead>
                <tr>
                  <th>用途与模型</th>
                  <th>时间</th>
                  <th>用量</th>
                  <th>公开费率估算</th>
                </tr>
              </thead>
              <tbody>
                {detail.stages.map((stage) => (
                  <tr key={stage.stageId}>
                    <td>
                      {purpose[stage.purpose] ?? stage.purpose}
                      <small>{stage.modelId}</small>
                      {stage.branchId && <small>{stage.branchId}</small>}
                    </td>
                    <td>
                      {stage.dispatchedAt ? formatDate(stage.dispatchedAt) : '派发时间未记录'}
                      {stage.receivedAt && <small>回执 {formatDate(stage.receivedAt)}</small>}
                    </td>
                    <td>
                      {stage.totals.total === null
                        ? {
                            pending: '等待回执',
                            unknown: '待核验',
                            received: '按计量项记录',
                            'no-receipt': '未记录回执',
                          }[stage.status]
                        : `${stage.totals.total.toLocaleString('zh-CN')} token`}
                      {stage.meters.map((meter) => (
                        <small key={meter.meter}>
                          {labels[meter.meter]} {meter.quantity.toLocaleString('zh-CN')}
                          {meter.estimatedNanoUsd !== null
                            ? ` · ${usd(meter.estimatedNanoUsd)}`
                            : ''}
                        </small>
                      ))}
                    </td>
                    <td>
                      {stage.estimatedNanoUsd === null
                        ? '无法估算'
                        : `${stage.estimateComplete ? '' : '已知部分 '}${usd(stage.estimatedNanoUsd)}`}
                      {stage.pricing && (
                        <small>
                          <a href={stage.pricing.source} target="_blank" rel="noreferrer">
                            {stage.pricing.version}
                          </a>
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="usage-table-scroll" role="region" aria-label="服务点流转" tabIndex={0}>
            <table className="usage-table">
              <caption>服务点流转</caption>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>动作</th>
                  <th>服务点</th>
                  <th>批次</th>
                </tr>
              </thead>
              <tbody>
                {detail.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatDate(movement.createdAt)}</td>
                    <td>
                      {{ hold: '预占', settled: '结算', released: '释放' }[movement.kind] ??
                        movement.kind}
                    </td>
                    <td>{movement.units}</td>
                    <td>{movement.lotId?.slice(0, 8) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {prices && (
        <div className="usage-table-scroll" tabIndex={0} role="region" aria-label="模型费率明细">
          <table className="usage-table">
            <caption>标准档公开费率</caption>
            <thead>
              <tr>
                <th>模型</th>
                <th>计量项</th>
                <th>美元</th>
                <th>版本</th>
              </tr>
            </thead>
            <tbody>
              {prices.flatMap((snapshot) =>
                Object.entries(snapshot.meters).map(([key, rate]) => {
                  const factor = rate.unit === 'token' ? 1_000_000n : 1n;
                  return (
                    <tr key={`${snapshot.modelId}:${key}`}>
                      <td>{snapshot.modelId}</td>
                      <td>{labels[key as Meter]}</td>
                      <td>
                        {usd((BigInt(rate.nanoUsd) * factor).toString())} /{' '}
                        {rate.unit === 'token'
                          ? '百万 token'
                          : `${rate.quantity} ${rate.unit === 'call' ? '次' : '秒'}`}
                      </td>
                      <td>
                        <a href={snapshot.source} target="_blank" rel="noreferrer">
                          {snapshot.version}
                        </a>
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
