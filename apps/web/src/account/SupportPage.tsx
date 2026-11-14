import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountPageFrame } from './AccountPageFrame';
import { ApiError, api, errorMessage } from '../lib/api';
import { formatNumber, t, useLocale } from '../i18n';
import type { PublicConfig, SupportCatalog } from '../lib/types';
import { usageQuotes, type UsageAssistantCatalog, type UsageModelCatalog } from '../usage/catalog';
import { usageOperationName } from '../usage/model';
import './support-page.css';

export function SupportPage({
  config,
  onBack,
  onSessionExpired,
}: {
  config: PublicConfig | null;
  onBack: () => void;
  onSessionExpired: () => void;
}) {
  useLocale();
  const [data, setData] = useState<SupportCatalog | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [quotes, setQuotes] = useState<ReturnType<typeof usageQuotes>>([]);
  const [quoteState, setQuoteState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeAmount, setActiveAmount] = useState<number | null>(null);
  const selectedTier = data?.tiers.find((tier) => tier.cents === activeAmount) ?? data?.tiers[0];
  const examples = useMemo(() => {
    const seen = new Map<string, ReturnType<typeof usageQuotes>>();
    for (const quote of quotes) {
      if (quote.available && quote.points !== null && quote.points > 0)
        seen.set(quote.operation, [...(seen.get(quote.operation) ?? []), quote]);
    }
    return [...seen];
  }, [quotes]);
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;
  useEffect(() => {
    const controller = new AbortController();
    api<SupportCatalog>('/support', { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setData(result);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setFailure(error);
        if (error instanceof ApiError && error.status === 401) expired.current();
      },
    );
    void Promise.allSettled([
      api<UsageModelCatalog>('/models', { signal: controller.signal }),
      api<UsageAssistantCatalog>('/assistant/models', { signal: controller.signal }),
    ]).then(([other, assistant]) => {
      if (controller.signal.aborted) return;
      setQuotes(usageQuotes(other.status === 'fulfilled' ? other.value : null,
        assistant.status === 'fulfilled' ? assistant.value : null));
      setQuoteState(other.status === 'fulfilled' && assistant.status === 'fulfilled' ? 'ready' : 'error');
    });
    return () => controller.abort();
  }, [retry]);
  return (
    <AccountPageFrame
      title={t('订阅与支持')}
      config={config}
      onBack={onBack}
      backLabel={t('返回个人主页')}
      className="account-support-page"
    >
      {!data &&
        (failure ? (
          <div role="alert">
            <p>{t(errorMessage(failure))}</p>
            <button
              type="button"
              className="account-action"
              onClick={() => {
                setFailure(null);
                setRetry((value) => value + 1);
              }}
            >
              {t('重试')}
            </button>
          </div>
        ) : (
          <p role="status">{t('正在读取赞赏信息…')}</p>
        ))}
      {data && (
        <div className="account-support">
          <section className="account-support-scan" aria-label={t('微信赞赏')}>
            <h2>{t('微信赞赏')}</h2>
            {data.qrUrl === '/v1/support/wechat-qr' && !imageFailed ? (
              <>
                <p>
                  <strong>{t('打赏时请在微信备注注册手机号，方便为你开通相应权限。')}</strong>
                </p>
                <p>{t('用微信扫一扫，自愿支持开发。手机上可先保存图片，再从微信相册识别。')}</p>
                <img
                  src={data.qrUrl + '?v=' + data.version}
                  width="1171"
                  height="1171"
                  alt={t('微信赞赏码')}
                  onError={() => setImageFailed(true)}
                />
                <p>{t('运营核对赞赏记录后手动发放服务点。请勿在备注中填写密码或验证码。')}</p>
                {!data.phoneVerified && <p role="status">{t('发放服务点前需完成手机号验证。')}</p>}
              </>
            ) : (
              <p role="status">{t('微信赞赏暂未开放')}</p>
            )}
          </section>
          <section className="account-support-values" aria-labelledby="support-tier-title">
            <h2 id="support-tier-title">{t('赞赏金额与参考服务点')}</h2>
            <div className="support-tier-picks" role="group" aria-label={t('选择金额计算可用次数')}>
              {data.tiers.map((tier) => (
                <button key={tier.cents} type="button"
                  aria-pressed={selectedTier?.cents === tier.cents}
                  onClick={() => setActiveAmount(tier.cents)}>
                  <strong>¥{formatNumber(tier.cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  <span>{formatNumber(tier.points)} {t('服务点')}</span>
                </button>
              ))}
            </div>
            {selectedTier && <div className="support-task-estimates">
              <h3>{t('{points} 服务点可用于', { points: formatNumber(selectedTier.points) })}</h3>
              {quoteState === 'loading' && <p role="status">{t('正在读取模型报价…')}</p>}
              {quoteState === 'error' && <p role="status">{t('部分模型报价暂不可用。')}</p>}
              {quoteState === 'ready' && !examples.length && <p>{t('当前没有可用的模型报价。')}</p>}
              {examples.map(([operation, models]) => (
                <details key={operation}>
                  <summary>
                    <span>{usageOperationName(operation)}</span>
                    <small>{t('{count} 个模型', { count: models.length })}</small>
                  </summary>
                  <ul>{models.map((model) => (
                    <li key={model.key}>
                      <strong>{model.label}</strong>
                      <span>{formatNumber(model.points!)} {t('点')} / {t(model.per)}
                        {' · '}{t('约 {count} {unit}', {
                          count: formatNumber(Math.floor(selectedTier.points / model.points!)), unit: t(model.per),
                        })}</span>
                      {model.maxSeconds && <small>{t('单次最长 {seconds} 秒', { seconds: model.maxSeconds })}</small>}
                      {model.qualities.filter(({ points }) => points).map(({ name, points }) => (
                        <small key={name}>{name} · {formatNumber(points!)} {t('点')} / {t(model.per)}
                          {' · '}{t('约 {count} {unit}', {
                            count: formatNumber(Math.floor(selectedTier.points / points!)), unit: t(model.per),
                          })}</small>
                      ))}
                    </li>
                  ))}</ul>
                </details>
              ))}
            </div>}
            <p>{t('出图张数、质量及文字模型档位会影响点数。语音按次报价，以发送或通话前显示的点数为准。')}</p>
          </section>
        </div>
      )}
    </AccountPageFrame>
  );
}
