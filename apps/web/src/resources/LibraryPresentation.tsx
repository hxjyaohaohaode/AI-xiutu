import { lazy, Suspense, type ReactNode } from 'react';
import { ArrowClockwise, CaretDown, GridFour, MagnifyingGlass, SlidersHorizontal, SquaresFour, X } from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import type { MasonryItem } from '../components/react-bits/Masonry';
import { FeatureSkeleton } from '../components/DeferredFeature';
import { MotionDisclosure } from '../motion/Presence';
import { resourceExperienceCopy } from './experience-copy';

const Masonry = lazy(() => import('../components/react-bits/Masonry'));
export type LibraryDensity = 'comfortable' | 'compact';

export function LibraryToolbar({
  query, onQuery, selector, filterId, filtersOpen, filterCount, onToggle, onReset,
  density, onDensity, onRefresh, refreshing, children,
}: {
  query: string;
  onQuery: (query: string) => void;
  selector: ReactNode;
  filterId: string;
  filtersOpen: boolean;
  filterCount: number;
  onToggle: () => void;
  onReset?: () => void;
  density: LibraryDensity;
  onDensity: (density: LibraryDensity) => void;
  onRefresh: () => void;
  refreshing: boolean;
  children: ReactNode;
}) {
  const c = resourceExperienceCopy(useLocale());
  return (
    <div className="asset-library-filters library-filters-progressive">
      <label className="library-search">
        <MagnifyingGlass size={18} aria-hidden />
        <input
          type="search"
          aria-label={t('搜索当前范围素材')}
          value={query}
          maxLength={120}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t('搜索名称、标题、标签…')}
        />
        {query && (
          <button type="button" className="library-clear-search" aria-label={t('清除素材搜索')}
            onClick={() => onQuery('')}>
            <X size={16} aria-hidden />
          </button>
        )}
      </label>
      <div className="library-project-select">{selector}</div>
      <button type="button" className="library-filter-toggle"
        aria-label={filterCount ? `${c.filters} · ${filterCount} ${c.filterCount}` : c.filters}
        title={c.filters} aria-expanded={filtersOpen} aria-controls={filterId} onClick={onToggle}>
        <SlidersHorizontal size={18} aria-hidden />
        <span className="library-filter-label">{c.filters}</span>
        {!!filterCount && <span className="library-filter-count" aria-hidden>{filterCount}</span>}
        <CaretDown size={13} aria-hidden />
      </button>
      <div className="library-status-actions">
        {onReset && (
          <button type="button" className="text-button library-reset-filters" onClick={onReset}
            aria-label={t('重置筛选')} title={t('重置筛选')}>
            <X size={15} aria-hidden /> <span>{t('重置筛选')}</span>
          </button>
        )}
        <div className="library-density-choice" role="group" aria-label={t('素材显示密度')}>
          <button type="button" aria-label={t('大图显示')} title={t('大图显示')}
            aria-pressed={density === 'comfortable'} onClick={() => onDensity('comfortable')}>
            <SquaresFour size={19} aria-hidden />
          </button>
          <button type="button" aria-label={t('紧凑显示')} title={t('紧凑显示')}
            aria-pressed={density === 'compact'} onClick={() => onDensity('compact')}>
            <GridFour size={19} aria-hidden />
          </button>
        </div>
        <button type="button" className="text-button library-refresh" onClick={onRefresh}
          disabled={refreshing} aria-label={t('刷新')} title={t('刷新')}>
          <ArrowClockwise size={16} aria-hidden /> <span>{t('刷新')}</span>
        </button>
      </div>
      <MotionDisclosure id={filterId} open={filtersOpen} className="library-filter-disclosure">
        {children}
      </MotionDisclosure>
    </div>
  );
}

export function LibraryMasonry({ items, density, onOpen, onDetails }: {
  items: MasonryItem[];
  density: LibraryDensity;
  onOpen: (item: MasonryItem) => void;
  onDetails: (id: string) => void;
}) {
  const c = resourceExperienceCopy(useLocale());
  return (
    <Suspense fallback={<FeatureSkeleton profile="gallery" label={t('读取当前授权范围')} compact />}>
      <Masonry className="library-reference-masonry" columnWidth={density === 'compact' ? 168 : 238}
        animateFrom="none" revealOnScroll={false} captions="hover" hoverEffect="lift" lightbox={false} draggable={false}
        items={items} onItemClick={onOpen}
        renderActions={(item) => (
          <button type="button" className="library-masonry-more icon-button" aria-haspopup="dialog"
            aria-label={c.details + ' · ' + item.title} onClick={() => onDetails(String(item.id))}>
            <SlidersHorizontal size={16} aria-hidden />
          </button>
        )}
      />
    </Suspense>
  );
}
