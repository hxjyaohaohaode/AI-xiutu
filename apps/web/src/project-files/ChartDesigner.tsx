import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChartBar,
  ChartBarHorizontal,
  ChartLine,
  ChartLineUp,
  ChartDonut,
  ChartPolar,
  ChartScatter,
  Funnel,
  SquaresFour,
  GridFour,
  Waves,
  FlowArrow,
  Cube,
  Stack,
  X,
} from '@phosphor-icons/react';
import {
  chartLayouts,
  chartLegendPositions,
  chartThemes,
  officeCharts,
  type OfficeChartOptions,
  type OfficeChartSnapshot,
} from '@ai-xiutu/contracts';
import {
  chartCapabilities,
  chartDataHints,
  chartNames,
  chartThemeStyles,
  createChartSnapshot,
  type ChartKind,
  type DataTable,
} from '@ai-xiutu/contracts/office-data';
import { t } from '../i18n';
import { mountChart, type ChartMount } from './chart-view';
import './chart-designer.css';

const icons: Record<ChartKind, ReactNode> = {
  bar: <ChartBar size={22} />,
  line: <ChartLine size={22} />,
  combo: <ChartLineUp size={22} />,
  area: <Stack size={22} />,
  stream: <Waves size={22} />,
  sankey: <FlowArrow size={22} />,
  radar: <ChartPolar size={22} />,
  scatter3d: <ChartScatter size={22} />,
  donut: <ChartDonut size={22} />,
  heatmap: <GridFour size={22} />,
  treemap: <SquaresFour size={22} />,
  funnel: <Funnel size={22} />,
  waterfall: <ChartBarHorizontal size={22} style={{ transform: 'rotate(-90deg)' }} />,
  bar3d: <Cube size={22} />,
};
const groups: [string, ChartKind[]][] = [
  ['比较', ['bar', 'combo', 'bar3d', 'waterfall']],
  ['趋势', ['line', 'area', 'stream']],
  ['构成', ['donut', 'treemap', 'funnel']],
  ['分布与关系', ['heatmap', 'radar', 'sankey', 'scatter3d']],
];
const themeNames: Record<(typeof chartThemes)[number], string> = {
  studio: '工作室',
  ocean: '海洋',
  sunset: '日落',
  forest: '森林',
  mono: '单色',
  midnight: '深夜',
};
const legendNames: Record<(typeof chartLegendPositions)[number], string> = {
  top: '顶部',
  bottom: '底部',
  right: '右侧',
  none: '隐藏',
};
const layoutNames: Record<(typeof chartLayouts)[number], string> = {
  grouped: '分组',
  stacked: '堆叠',
  percent: '百分比',
};

/** Live preview of a snapshot with tooltips, focus and legend toggles. */
export function ChartView({
  chart,
  onHidden,
  className,
}: {
  chart: OfficeChartSnapshot;
  onHidden?: (hidden: number[]) => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<ChartMount | null>(null);
  const hiddenHook = useRef(onHidden);
  hiddenHook.current = onHidden;
  useEffect(() => {
    if (!host.current) return;
    mounted.current = mountChart(host.current, chart, {
      onHidden: (hidden) => hiddenHook.current?.(hidden),
      label: (action, name) => t(action === 'hide' ? '隐藏 {v0}' : '显示 {v0}', { v0: name }),
    });
    return () => {
      mounted.current?.destroy();
      mounted.current = null;
    };
    // The mount is created once; later snapshots go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    mounted.current?.update(chart);
  }, [chart]);
  return <div ref={host} className={className} aria-label={chart.title} role="figure" />;
}

type Props = {
  table: DataTable;
  /** Existing chart (edit) or a suggested title/kind (insert). */
  initial: { title: string; kind: ChartKind; options?: OfficeChartOptions };
  source?: OfficeChartSnapshot['source'];
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (chart: OfficeChartSnapshot) => void;
};

export function ChartDesigner({ table, initial, source, confirmLabel, onCancel, onConfirm }: Props) {
  const [kind, setKind] = useState<ChartKind>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [options, setOptions] = useState<OfficeChartOptions>(initial.options ?? {});
  const dialog = useRef<HTMLDivElement>(null);
  const set = <K extends keyof OfficeChartOptions>(key: K, value: OfficeChartOptions[K] | undefined) =>
    setOptions((current) => {
      const next = { ...current };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  const capability = chartCapabilities[kind];
  // Only options the chosen kind honours are saved, so switching types never leaves stray settings.
  const effective = useMemo(() => {
    const keep: OfficeChartOptions = {};
    for (const [key, value] of Object.entries(options) as [keyof OfficeChartOptions, never][]) {
      const scoped: Partial<Record<keyof OfficeChartOptions, boolean | undefined>> = {
        layout: capability.layout,
        orientation: capability.orientation,
        smooth: capability.smooth,
        labels: capability.labels,
        xTitle: capability.axes,
        yTitle: capability.axes,
        hole: capability.hole,
        sort: capability.sort,
      };
      if (key in scoped && !scoped[key]) continue;
      keep[key] = value;
    }
    return keep;
  }, [options, capability]);
  const preview = useMemo((): { chart?: OfficeChartSnapshot; error?: string } => {
    try {
      return { chart: createChartSnapshot(table, title.trim() || t('未命名图表'), kind, source, effective) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [table, title, kind, source, effective]);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }, []);
  const segmented = <T extends string>(
    label: string,
    values: readonly T[],
    names: Record<T, string>,
    current: T,
    onChange: (value: T) => void,
  ) => (
    <div className="designer-field">
      <span>{t(label)}</span>
      <div className="designer-segmented" role="radiogroup" aria-label={t(label)}>
        {values.map((value) => (
          <button key={value} type="button" role="radio" aria-checked={current === value} onClick={() => onChange(value)}>
            {t(names[value])}
          </button>
        ))}
      </div>
    </div>
  );
  const toggle = (label: string, value: boolean, onChange: (value: boolean) => void) => (
    <label className="designer-toggle">
      <input type="checkbox" role="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{t(label)}</span>
    </label>
  );
  return (
    <div className="chart-designer-scrim" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={dialog}
        className="chart-designer"
        role="dialog"
        aria-modal="true"
        aria-label={t('图表设计')}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <header>
          <h2>{t('图表设计')}</h2>
          <button type="button" className="designer-close" aria-label={t('关闭')} onClick={onCancel}>
            <X size={18} />
          </button>
        </header>
        <div className="designer-body">
          <aside className="designer-controls">
            <section aria-label={t('图表类型')}>
              {groups.map(([group, kinds]) => (
                <div key={group} className="designer-group">
                  <h3>{t(group)}</h3>
                  <div className="designer-kinds">
                    {kinds.filter((item) => officeCharts.includes(item)).map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={kind === item}
                        title={t(chartDataHints[item])}
                        onClick={() => setKind(item)}
                      >
                        {icons[item]}
                        <span>{t(chartNames[item])}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="designer-hint">{t(chartDataHints[kind])}</p>
            </section>
            <section className="designer-section">
              <label className="designer-field">
                <span>{t('标题')}</span>
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="designer-field">
                <span>{t('副标题')}</span>
                <input
                  value={options.subtitle ?? ''}
                  maxLength={160}
                  placeholder={t('例如：数据来源或单位')}
                  onChange={(e) => set('subtitle', e.target.value || undefined)}
                />
              </label>
              <div className="designer-field">
                <span>{t('配色主题')}</span>
                <div className="designer-themes" role="radiogroup" aria-label={t('配色主题')}>
                  {chartThemes.map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      role="radio"
                      aria-checked={(options.theme ?? 'studio') === theme}
                      title={t(themeNames[theme])}
                      onClick={() => set('theme', theme === 'studio' ? undefined : theme)}
                      style={{ background: chartThemeStyles[theme].background ?? 'transparent' }}
                    >
                      {chartThemeStyles[theme].colors.slice(0, 4).map((color) => (
                        <i key={color} style={{ background: color }} />
                      ))}
                      <span>{t(themeNames[theme])}</span>
                    </button>
                  ))}
                </div>
              </div>
              {segmented('图例', chartLegendPositions, legendNames, options.legend ?? 'top', (value) =>
                set('legend', value === 'top' ? undefined : value),
              )}
              {capability.layout &&
                segmented('排列', chartLayouts, layoutNames, options.layout ?? (kind === 'area' ? 'stacked' : 'grouped'), (value) =>
                  set('layout', value),
                )}
              {capability.orientation &&
                segmented('方向', ['vertical', 'horizontal'] as const, { vertical: '纵向', horizontal: '横向' }, options.orientation ?? 'vertical', (value) =>
                  set('orientation', value === 'vertical' ? undefined : value),
                )}
              {capability.sort &&
                segmented('排序', ['none', 'desc', 'asc'] as const, { none: '原顺序', desc: '从大到小', asc: '从小到大' }, options.sort ?? 'none', (value) =>
                  set('sort', value === 'none' ? undefined : value),
                )}
              {capability.hole && (
                <label className="designer-field">
                  <span>
                    {t('环形孔径')} {Math.round((options.hole ?? 0.58) * 100)}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={0.8}
                    step={0.02}
                    value={options.hole ?? 0.58}
                    onChange={(e) => set('hole', Number(e.target.value))}
                  />
                </label>
              )}
              <div className="designer-toggles">
                {capability.labels && toggle('数据标签', !!options.labels, (value) => set('labels', value || undefined))}
                {toggle('网格线', options.grid !== false, (value) => set('grid', value ? undefined : false))}
                {capability.smooth &&
                  toggle('平滑曲线', kind === 'area' ? options.smooth !== false : !!options.smooth, (value) =>
                    set('smooth', kind === 'area' ? (value ? undefined : false) : value || undefined),
                  )}
              </div>
              <label className="designer-field">
                <span>{t('小数位')}</span>
                <select
                  value={options.decimals ?? ''}
                  onChange={(e) => set('decimals', e.target.value === '' ? undefined : Number(e.target.value))}
                >
                  <option value="">{t('自动')}</option>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {capability.axes && (
                <div className="designer-pair">
                  <label className="designer-field">
                    <span>{t('横轴标题')}</span>
                    <input value={options.xTitle ?? ''} maxLength={60} onChange={(e) => set('xTitle', e.target.value || undefined)} />
                  </label>
                  <label className="designer-field">
                    <span>{t('纵轴标题')}</span>
                    <input value={options.yTitle ?? ''} maxLength={60} onChange={(e) => set('yTitle', e.target.value || undefined)} />
                  </label>
                </div>
              )}
            </section>
          </aside>
          <main className="designer-preview">
            {preview.chart ? (
              <>
                <ChartView
                  chart={preview.chart}
                  onHidden={(hidden) => set('hidden', hidden.length ? hidden : undefined)}
                />
                <p className="designer-tip">{t('悬停查看数值，点击图例可隐藏或显示系列。')}</p>
              </>
            ) : (
              <div className="designer-error" role="alert">
                <strong>{t('当前数据无法绘制这种图表')}</strong>
                <span>{preview.error}</span>
                <span>{t(chartDataHints[kind])}</span>
              </div>
            )}
          </main>
        </div>
        <footer>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            {t('取消')}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!preview.chart}
            onClick={() => preview.chart && onConfirm(preview.chart)}
          >
            {t(confirmLabel)}
          </button>
        </footer>
      </div>
    </div>
  );
}
