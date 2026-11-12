import { getLocale, t } from '../i18n';
import { RubberSegment } from '../components/control-motion';
import { useMemo, useState } from 'react';
import type { RGBAImage } from '@ai-xiutu/editor';
import { sharedHistogram } from './histogram-cache';

export function Histogram({ image }: { image: RGBAImage | null }) {
  const histogram = useMemo(() => sharedHistogram(image), [image]);
  const [logarithmic, setLogarithmic] = useState(false);
  const [channel, setChannel] = useState<'rgb' | 'red' | 'green' | 'blue' | 'luminance'>('rgb');
  if (!histogram) return null;
  const series =
    channel === 'rgb' ? [histogram.red, histogram.green, histogram.blue] : [histogram[channel]];
  const convert = (value: number) => (logarithmic ? Math.log1p(value) : value);
  const maximum = Math.max(1, ...series.flatMap((channel) => Array.from(channel, convert)));
  const paths = series.map(
    (channel) =>
      `M 0 92 ${Array.from(channel, (value, x) => `L ${x} ${92 - (convert(value) / maximum) * 86}`).join(' ')} L 255 92 Z`,
  );
  return (
    <section
      className="histogram refined-histogram"
      aria-label={t('当前画面色彩分布')}
      data-motion="histogram"
    >
      <div className="histogram-title">
        <RubberSegment<typeof channel>
          className="histogram-channel compact-choice-row"
          label={t('直方图通道')}
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'rgb', label: 'RGB', ariaLabel: t('RGB 直方图') },
            { value: 'luminance', label: 'L', ariaLabel: t('亮度分布') },
            { value: 'red', label: 'R', ariaLabel: t('红色通道') },
            { value: 'green', label: 'G', ariaLabel: t('绿色通道') },
            { value: 'blue', label: 'B', ariaLabel: t('蓝色通道') },
          ]}
        />
        <label>
          <input
            type="checkbox"
            checked={logarithmic}
            onChange={(event) => setLogarithmic(event.target.checked)}
          />
          {t('对数')}
        </label>
        <div>
          <i className="histogram-r" />
          <i className="histogram-g" />
          <i className="histogram-b" />
        </div>
      </div>
      <svg
        viewBox="0 0 255 96"
        preserveAspectRatio="none"
        role="img"
        aria-label={t('当前预览 {v0} 个像素的红绿蓝亮度分布', {
          v0: histogram.pixelCount.toLocaleString(getLocale()),
        })}
      >
        <path d="M0 23H255M0 46H255M0 69H255" className="histogram-grid" />
        {paths.map((path, index) => (
          <path
            d={path}
            key={`${channel}-${index}`}
            className={`histogram-path channel-${channel === 'rgb' ? index : channel === 'red' ? 0 : channel === 'green' ? 1 : channel === 'blue' ? 2 : 'luminance'}`}
          />
        ))}
      </svg>
      <div className="histogram-axis">
        <span>{t('0 · 暗部')}</span>
        <span>{t('当前预览')}</span>
        <span>{t('亮部 · 255')}</span>
      </div>
      <div className="histogram-endpoints">
        <span title={t('当前预览亮度代理恰好等于0的像素占比，不等于RAW信息丢失判定')}>
          {t('暗端')}{' '}
          {(((histogram.luminance[0] ?? 0) / Math.max(1, histogram.pixelCount)) * 100).toFixed(2)}%
        </span>
        <span title={t('当前预览亮度代理恰好等于255的像素占比')}>
          {t('亮端')}{' '}
          {(((histogram.luminance[255] ?? 0) / Math.max(1, histogram.pixelCount)) * 100).toFixed(2)}
          %
        </span>
      </div>
    </section>
  );
}
