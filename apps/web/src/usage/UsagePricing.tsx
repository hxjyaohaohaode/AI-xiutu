import { useMemo, useState } from 'react';
import { ArrowClockwise, Tag } from '@phosphor-icons/react';
import { Busy, InlineError } from '../components/Ui';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { MotionDetails } from '../motion/Presence';
import { pointText, usageOperationName } from './model';
import type { UsageQuote } from './catalog';

const qualityLabels: Record<string, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  standard: '标准',
  hd: '高清',
};
export function UsagePricing({
  quotes,
  loading,
  errors,
  onRefresh,
}: {
  quotes: UsageQuote[];
  loading: boolean;
  errors: string[];
  onRefresh: () => void;
}) {
  const [operation, setOperation] = useState('');
  const operations = useMemo(() => [...new Set(quotes.map((quote) => quote.operation))], [quotes]);
  const selected = operations.includes(operation) ? operation : '';
  const visible = quotes.filter((quote) => !selected || quote.operation === selected);
  return (
    <MotionDetails className="usage-card usage-pricing">
      <summary>
        <span>
          <Tag size={18} aria-hidden /> 当前服务点报价
        </span>
        <span className="usage-pricing-summary">
          {loading ? '读取中' : `${quotes.length} 个用途报价`}
        </span>
      </summary>
      <div className="usage-pricing-body">
        <div className="usage-section-heading">
          <p>按当前模型配置计点，历史流水以实际结算为准。</p>
          <button type="button" className="text-button" disabled={loading} onClick={onRefresh}>
            <ArrowClockwise size={15} aria-hidden /> 刷新报价
          </button>
        </div>
        {loading && <Busy label="读取模型报价" />}
        {errors.map((message, index) => (
          <InlineError key={index} message={message} />
        ))}
        {operations.length > 1 && (
          <ChoiceSelect
            className="usage-pricing-filter"
            label="用途"
            value={selected}
            onValueChange={setOperation}
            options={[
              { value: '', label: '全部用途' },
              ...operations.map((value) => ({ value, label: usageOperationName(value) })),
            ]}
          />
        )}
        <div className="usage-price-list">
          {visible.map((quote) => (
            <article className="usage-price-row" key={quote.key}>
              <div className="usage-price-model">
                <strong>{quote.label}</strong>
                <span>{usageOperationName(quote.operation)}</span>
                <code>{quote.modelId}</code>
              </div>
              <div className="usage-price-amount">
                <strong>{pointText(quote.points)}</strong>
                <span>
                  {quote.points === null
                    ? '报价'
                    : `点 / ${quote.per}${quote.qualities.length ? ' · 基准' : ''}`}
                </span>
              </div>
              <div className="usage-price-meta">
                <span className="usage-availability" data-available={quote.available}>
                  {quote.available ? '已启用' : '暂不可用'}
                </span>
                {!quote.available && quote.reason && <small>{quote.reason}</small>}
                {quote.maxSeconds !== null && (
                  <small>每次最长 {pointText(quote.maxSeconds)} 秒</small>
                )}
                {quote.qualities.length > 0 && (
                  <small className="usage-quality-prices">
                    {quote.qualities
                      .map(
                        (quality) =>
                          `${qualityLabels[quality.name] ?? quality.name} ${pointText(quality.points)} 点/张`,
                      )
                      .join(' · ')}
                  </small>
                )}
              </div>
            </article>
          ))}
        </div>
        {!loading && !quotes.length && (
          <p className="usage-empty-copy">
            {errors.length ? '报价暂未读到，请稍后重试。' : '当前没有已配置的模型报价。'}
          </p>
        )}
        <p className="usage-footnote">
          服务点按平台配置计量；任务的 token 回执与公开费率估算可从用量明细进入查看。
        </p>
      </div>
    </MotionDetails>
  );
}
