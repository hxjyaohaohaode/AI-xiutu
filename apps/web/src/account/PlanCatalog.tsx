import { useEffect, useState } from 'react';
import { ArrowClockwise, Check, CreditCard, Sparkle } from '@phosphor-icons/react';
import { api, errorMessage } from '../lib/api';
import { Busy } from '../components/Ui';
import { t, useLocale } from '../i18n';
import PixelCard from '../components/react-bits/PixelCard';

type Plan = {
  id: string;
  version: number;
  name: string;
  units: number;
  priceCents: number;
  expiresAfterDays: number | null;
  description: string;
  benefits: string[];
  kind: 'credits' | 'subscription';
};

export function PlanCatalog({ actorId }: { actorId: string }) {
  const locale = useLocale();
  const [state, setState] = useState<{ plans: Plan[]; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(undefined);
    void api<{ plans: Plan[] }>('/plans', { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState(data); })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ plans: [], error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [actorId, attempt]);
  const currency = new Intl.NumberFormat(locale, { style: 'currency', currency: 'CNY' });
  return (
    <section className="account-plan-catalog" data-testid="account-payment-status" aria-label={t('充值与订阅')}>
      <header>
        <CreditCard size={19} aria-hidden />
        <h4>{t('充值与订阅')}</h4>
        <span>{t('在线支付尚未开放')}</span>
        <button className="icon-button" aria-label={t('刷新套餐')} disabled={!state} onClick={() => setAttempt((value) => value + 1)}>
          <ArrowClockwise size={16} />
        </button>
      </header>
      {!state ? <Busy label={t('正在读取套餐')} /> : state.error ? (
        <p role="alert">{state.error}</p>
      ) : state.plans.length ? (
        <div className="account-plan-grid">
          {state.plans.map((plan) => (
            <PixelCard key={plan.id} className="account-plan-pixel-card" variant={plan.kind === 'credits' ? 'yellow' : 'blue'}
              intro={false} clickPulse={false} noFocus
              style={{ width: 'min(300px, 100%)', height: '100%', minHeight: 224 }} theme="dark">
              <article className="account-plan-card">
              <span className="account-plan-kind"><Sparkle size={14} />{t(plan.kind === 'subscription' ? '订阅' : '充值')}</span>
              <h5>{plan.name}</h5>
              <strong className="account-plan-price">{currency.format(plan.priceCents / 100)}</strong>
              <p>{t('{v0} 服务点', { v0: plan.units.toLocaleString(locale) })} · {plan.expiresAfterDays
                ? t('{v0} 天有效', { v0: plan.expiresAfterDays }) : t('无自动到期')}</p>
              {plan.description && <p>{plan.description}</p>}
              {plan.benefits.length > 0 && (
                <ul>{plan.benefits.map((benefit, index) => (
                  <li key={index}><Check size={14} aria-hidden />{benefit}</li>
                ))}</ul>
              )}
              </article>
            </PixelCard>
          ))}
        </div>
      ) : <p className="account-plan-empty">{t('暂无已上架套餐')}</p>}
    </section>
  );
}
