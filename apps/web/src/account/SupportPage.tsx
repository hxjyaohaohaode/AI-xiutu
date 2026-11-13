import { useEffect, useRef, useState } from 'react';
import { AccountPageFrame } from './AccountPageFrame';
import { ApiError, api, errorMessage } from '../lib/api';
import { formatNumber, t, useLocale } from '../i18n';
import type { PublicConfig, SupportCatalog } from '../lib/types';
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
                  src={data.qrUrl}
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
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('赞赏金额')}</th>
                  <th scope="col">{t('参考点数')}</th>
                  <th scope="col">{t('约合美元')}</th>
                  <th scope="col">{t('估算 Token')}</th>
                </tr>
              </thead>
              <tbody>
                {data.tiers.map((tier) => (
                  <tr key={tier.cents}>
                    <th scope="row">
                      ¥{formatNumber(tier.cents / 100, { minimumFractionDigits: 2 })}
                    </th>
                    <td>{formatNumber(tier.points)}</td>
                    <td>
                      $
                      {formatNumber(tier.usd, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td>{formatNumber(tier.textTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              {t(
                '按 {date} 的汇率（1 美元约 {rate} 元）及 {model} 文本标准价估算，假设输入占 {input}、输出占 {output}。实际消耗取决于所选模型与任务。',
                {
                  date: data.rates.asOf,
                  rate: data.rates.cnyPerUsd,
                  model: data.rates.model,
                  input: formatNumber(data.rates.inputShare, { style: 'percent' }),
                  output: formatNumber(1 - data.rates.inputShare, { style: 'percent' }),
                },
              )}
            </p>
            <p>{t('点数按平台任务报价扣除。赞赏是一次性的，可随时返回。')}</p>
          </section>
        </div>
      )}
    </AccountPageFrame>
  );
}
