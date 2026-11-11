import { t } from '../i18n';

export function UsageSkeleton({
  profile = 'dashboard',
}: {
  profile?: 'dashboard' | 'capacity' | 'pricing';
}) {
  const label =
    profile === 'capacity'
      ? t('读取容量')
      : profile === 'pricing'
        ? t('读取模型报价')
        : t('读取用量账本');
  return (
    <div
      className={`usage-skeleton usage-skeleton-${profile}`}
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {profile === 'dashboard' ? (
          <>
            <div className="usage-skeleton-overview">
              <div>
                <i />
                <b />
                <b />
              </div>
              <div>
                <i />
                <b />
                <span />
              </div>
            </div>
            <div className="usage-skeleton-metrics">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index}>
                  <i />
                  <b />
                </div>
              ))}
            </div>
            <div className="usage-skeleton-insights">
              <div>
                <i />
                <div className="usage-skeleton-grid" />
              </div>
              <div>
                <i />
                <b />
                <b />
                <b />
              </div>
            </div>
            <div className="usage-skeleton-ledger">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index}>
                  <i />
                  <b />
                  <span />
                </div>
              ))}
            </div>
          </>
        ) : profile === 'capacity' ? (
          <>
            <b />
            <span />
            <div className="usage-skeleton-pair">
              <i />
              <i />
            </div>
          </>
        ) : (
          <div className="usage-skeleton-ledger">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index}>
                <i />
                <b />
                <span />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
