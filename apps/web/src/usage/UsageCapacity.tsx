import { t, useLocale } from '../i18n';
import { useId, useState } from 'react';
import { HardDrives, ArrowClockwise } from '@phosphor-icons/react';
import { Busy, InlineError } from '../components/Ui';
import { MotionDetails } from '../motion/Presence';
import { byteText, pointText, storageUsage, type StorageAccountSummary } from './model';
import { useUsageResource } from './useUsageResource';

export function UsageCapacity({
  spaceId,
  spaceName,
  operator,
  identity,
  refresh,
}: {
  spaceId?: string;
  spaceName?: string;
  operator: boolean;
  identity: string;
  refresh: string;
}) {
  useLocale();
  const heading = useId();
  const [retry, setRetry] = useState(0);
  const resource = useUsageResource<{ storage: StorageAccountSummary }>(
    spaceId ? `${operator ? '/ops' : ''}/spaces/${encodeURIComponent(spaceId)}/storage` : null,
    identity,
    `${refresh}:${retry}`,
  );
  const storage = resource.data?.storage;
  const mismatch = storage && storage.spaceId !== spaceId;
  const usage = storage && !mismatch ? storageUsage(storage) : null;
  return (
    <section className="usage-card usage-capacity" aria-labelledby={heading}>
      <div className="usage-card-heading">
        <h2 id={heading}>
          <HardDrives size={17} aria-hidden /> {t('存储空间')}
        </h2>
        <span className="usage-context-label" title={spaceName || spaceId}>
          {spaceName || (operator && spaceId ? t('所选空间') : t('容量'))}
        </span>
      </div>
      {resource.loading && <Busy label={t('读取容量')} />}
      {!spaceId && (
        <p className="usage-empty-copy">
          {operator ? t('选择一个空间后查看容量。') : t('请在空间中查看当前容量。')}
        </p>
      )}
      {(resource.error || mismatch) && (
        <div className="usage-card-error">
          <InlineError
            message={resource.error ? t(resource.error) : t('容量返回的空间不一致，请重新读取。')}
          />
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            <ArrowClockwise size={14} aria-hidden /> {t('重试容量')}
          </button>
        </div>
      )}
      {usage && (
        <>
          <p className="usage-capacity-total">
            <strong>{byteText(usage.used)}</strong>
            <span> / {byteText(usage.maximum)}</span>
          </p>
          <div className="usage-capacity-track" aria-hidden="true" data-over={!!usage.overBy}>
            {usage.fraction !== null && <span style={{ width: `${usage.fraction * 100}%` }} />}
          </div>
          <div className="usage-capacity-breakdown">
            <span>
              {t('保留')}
              <strong>{byteText(usage.retained)}</strong>
            </span>
            <span>
              {t('上传预占')}
              <strong>{byteText(usage.reserved)}</strong>
            </span>
          </div>
          <p className="usage-capacity-assets">
            {t('素材')}
            <strong>{pointText(usage.assets)}</strong> / {pointText(usage.maxAssets)} {t('项')}
            {usage.overBy ? (
              <span>
                {t('已超容量')}
                {byteText(usage.overBy)}
              </span>
            ) : usage.maximum === 0 ? (
              <span>{t('当前容量额度为 0')}</span>
            ) : null}
            {usage.assets !== null &&
              usage.maxAssets !== null &&
              usage.assets > usage.maxAssets && <span>{t('已超素材数量上限')}</span>}
          </p>
          <MotionDetails className="usage-small-details">
            <summary>{t('容量如何计算')}</summary>
            <p>{t('保留数据与上传预占共同计入容量。删除素材不会立即释放这部分容量。')}</p>
          </MotionDetails>
        </>
      )}
    </section>
  );
}
