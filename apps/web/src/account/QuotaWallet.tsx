/* Wallet geometry and motion adapted from byllzz's rude-bat-50, Uiverse (MIT). */
import { useId, useState } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { t } from '../i18n';
import { formatAccountUnits, type AccountEntitlements } from './account-model';
import './quota-wallet.css';

export function QuotaWallet({ data }: { data: AccountEntitlements }) {
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const balanceId = useId();
  const revealed = hovered || open;
  const displayAmount = (value: number) => revealed ? formatAccountUnits(value) : '***';
  return (
    <div className="quota-wallet" data-revealed={revealed}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        setHovered(false);
        setOpen(false);
      }}>
      <div className="quota-wallet-back" aria-hidden />
      {([['free', '免费与获赠', data.freeAvailable], ['paid', '已购可用', data.purchasedAvailable],
        ['held', '任务预占', data.held]] as const).map(([key, label, value]) => {
        const title = t(label);
        const amount = displayAmount(value);
        return (
          <div className={`quota-wallet-card quota-wallet-card--${key}`} key={key}>
            <span className="quota-wallet-card-heading">
              <span className="quota-wallet-card-label" title={title}>{title}</span>
              <strong className="quota-wallet-card-amount" aria-hidden={!revealed}>{amount}</strong>
            </span>
          </div>
        );
      })}
      <div className="quota-wallet-pocket">
        <svg viewBox="0 0 280 160" fill="none" aria-hidden>
          <path d="M 0 20 C 0 10, 5 10, 10 10 C 20 10, 25 25, 40 25 L 240 25 C 255 25, 260 10, 270 10 C 275 10, 280 10, 280 20 L 280 120 C 280 155, 260 160, 240 160 L 40 160 C 20 160, 0 155, 0 120 Z" fill="#1e341e" />
          <path d="M 8 22 C 8 16, 12 16, 15 16 C 23 16, 27 29, 40 29 L 240 29 C 253 29, 257 16, 265 16 C 268 16, 272 16, 272 22 L 272 120 C 272 150, 255 152, 240 152 L 40 152 C 25 152, 8 150, 8 120 Z" stroke="#3d5635" strokeWidth="1.5" strokeDasharray="6 4" />
        </svg>
        <button type="button" className="quota-wallet-balance" aria-expanded={open}
          aria-label={t(open ? '收起可用服务点' : '查看可用服务点')}
          aria-describedby={revealed ? balanceId : undefined}
          onClick={() => setOpen((value) => !value)}>
          <strong id={balanceId} className="quota-wallet-number" data-testid="account-available-units"
            aria-hidden={!revealed}>{displayAmount(data.available)}</strong>
          <span>{t('可用服务点')}</span>
          {revealed ? <Eye size={20} aria-hidden /> : <EyeSlash size={20} aria-hidden />}
        </button>
      </div>
    </div>
  );
}
