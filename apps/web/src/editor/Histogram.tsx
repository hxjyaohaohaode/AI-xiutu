import { useMemo, useState } from 'react';
import { computeHistogram, type RGBAImage } from '@ai-xiutu/editor';

export function Histogram({ image }: { image: RGBAImage | null }) {
  const histogram = useMemo(() => (image ? computeHistogram(image) : null), [image]);
  const [logarithmic, setLogarithmic] = useState(false);
  if (!histogram) return null;
  const series = [histogram.red, histogram.green, histogram.blue];
  const convert = (value: number) => (logarithmic ? Math.log1p(value) : value);
  const maximum = Math.max(1, ...series.flatMap((channel) => Array.from(channel, convert)));
  const paths = series.map(
    (channel) =>
      `M 0 92 ${Array.from(channel, (value, x) => `L ${x} ${92 - (convert(value) / maximum) * 86}`).join(' ')} L 255 92 Z`,
  );
  return (
    <section className="histogram" aria-label="当前画面RGB直方图">
      <div className="histogram-title">
        <strong>RGB 直方图</strong>
        <label>
          <input
            type="checkbox"
            checked={logarithmic}
            onChange={(event) => setLogarithmic(event.target.checked)}
          />
          对数
        </label>
        <div>
          <i className="histogram-r" />
          <i className="histogram-g" />
          <i className="histogram-b" />
        </div>
      </div>
      <svg
        viewBox="0 0 255 96"
        role="img"
        aria-label={`当前预览 ${histogram.pixelCount.toLocaleString()} 个像素的红绿蓝亮度分布`}
      >
        <path d="M0 23H255M0 46H255M0 69H255" className="histogram-grid" />
        {paths.map((path, index) => (
          <path d={path} key={index} className={`histogram-path channel-${index}`} />
        ))}
      </svg>
      <div className="histogram-axis">
        <span>0 · 暗部</span>
        <span>当前预览</span>
        <span>亮部 · 255</span>
      </div>
    </section>
  );
}
