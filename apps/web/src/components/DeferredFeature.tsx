import { t } from '../i18n';
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { ArrowClockwise, ArrowLeft, WarningCircle } from '@phosphor-icons/react';

export type FeatureSkeletonProfile =
  | 'panel'
  | 'gallery'
  | 'compare'
  | 'collaboration'
  | 'documents'
  | 'delivery'
  | 'usage'
  | 'search'
  | 'media'
  | 'account'
  | 'assistant'
  | 'operations'
  | 'table'
  | 'drawing';

export type DeferredFeatureState = {
  kind: 'pending' | 'error';
  label: string;
  retry: () => void;
  onBack?: () => void;
  profile?: FeatureSkeletonProfile;
};

/** Reserved wrapper prop; it is never forwarded to the loaded feature. */
export type DeferredFeatureNavigation = { onLoadBack?: () => void };

type FeatureLoader<P extends object> = (retry: boolean) => Promise<{ default: ComponentType<P> }>;
type FeatureStateRenderer<P extends object> = (
  state: DeferredFeatureState,
  props: Readonly<P>,
) => ReactNode;

class DeferredFeatureBoundary extends Component<
  { children: ReactNode; renderError: () => ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.renderError() : this.props.children;
  }
}

/** Shared status body can also be placed inside a native, feature-specific Modal. */
export function FeatureSkeleton({
  profile = 'panel',
  label,
  compact = false,
}: {
  profile?: FeatureSkeletonProfile;
  label: string;
  compact?: boolean;
}) {
  const rows = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, i) => (
      <div className="feature-skeleton-row" key={prefix + i}>
        <i />
        <span>
          <b />
          <b />
        </span>
      </div>
    ));
  const blocks = (count: number) =>
    Array.from({ length: count }, (_, i) => (
      <div className="feature-skeleton-card" key={i}>
        <i />
        <b />
        <b />
      </div>
    ));
  return (
    <div
      className={`feature-skeleton skeleton-profile-${profile}${compact ? ' is-compact' : ''}`}
      data-skeleton-profile={profile}
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div className="feature-skeleton-structure" aria-hidden="true">
        <div className="feature-skeleton-toolbar">
          <b />
          <i />
        </div>
        {profile === 'gallery' || profile === 'media' ? (
          <div className="feature-skeleton-grid">{blocks(profile === 'gallery' ? 6 : 3)}</div>
        ) : profile === 'compare' ? (
          <>
            <div className="feature-skeleton-comparison">
              <i />
              <i />
            </div>
            <div className="feature-skeleton-version-strip">{blocks(4)}</div>
          </>
        ) : profile === 'documents' ? (
          <div className="feature-skeleton-document">
            <aside>{rows(4, 'doc')}</aside>
            <article>
              <b />
              <b />
              <b />
              <b />
              <b />
            </article>
          </div>
        ) : profile === 'collaboration' ? (
          <div className="feature-skeleton-collaboration">
            <div>
              {rows(3, 'comment')}
              <div className="feature-skeleton-composer" />
            </div>
            <aside>{rows(4, 'task')}</aside>
          </div>
        ) : profile === 'assistant' ? (
          <div className="feature-skeleton-assistant">
            <div className="feature-skeleton-message" />
            <div className="feature-skeleton-message" />
            <div className="feature-skeleton-composer" />
          </div>
        ) : profile === 'operations' ? (
          <>
            <div className="feature-skeleton-operations">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index}>
                  <b />
                  <i />
                </div>
              ))}
            </div>
            <div className="feature-skeleton-list">{rows(4, 'capability')}</div>
          </>
        ) : profile === 'table' ? (
          <div className="feature-skeleton-table">
            {Array.from({ length: 7 }, (_, row) => (
              <div key={row}>
                {Array.from({ length: 4 }, (_, column) => (
                  <b key={column} />
                ))}
              </div>
            ))}
          </div>
        ) : profile === 'drawing' ? (
          <div className="feature-skeleton-drawing">
            <aside>
              {Array.from({ length: 6 }, (_, index) => (
                <i key={index} />
              ))}
            </aside>
            <i className="feature-skeleton-drawing-canvas" />
            <div>
              <b />
              <i />
              <b />
              <i />
            </div>
          </div>
        ) : profile === 'usage' ? (
          <>
            <div className="feature-skeleton-metrics">
              <b />
              <b />
              <b />
            </div>
            <div className="feature-skeleton-chart">
              {Array.from({ length: 12 }, (_, i) => (
                <i
                  key={i}
                  style={{ height: `${[38, 52, 43, 64, 56, 74, 62, 83, 69, 91, 77, 86][i]}%` }}
                />
              ))}
            </div>
            {rows(3, 'ledger')}
          </>
        ) : profile === 'delivery' ? (
          <div className="feature-skeleton-delivery">
            <i />
            <aside>{rows(4, 'export')}</aside>
          </div>
        ) : profile === 'account' ? (
          <div className="feature-skeleton-account">
            <i />
            <div>{rows(4, 'account')}</div>
          </div>
        ) : (
          <div className="feature-skeleton-list">{rows(profile === 'search' ? 6 : 4, 'list')}</div>
        )}
      </div>
    </div>
  );
}

export function DeferredFeatureStatus({
  kind,
  label,
  retry,
  onBack,
  profile = 'panel',
}: DeferredFeatureState) {
  return (
    <section
      className="deferred-feature-state"
      data-deferred-state={kind}
      data-skeleton-profile={profile}
      data-testid={`deferred-feature-${kind}`}
      aria-busy={kind === 'pending'}
    >
      {kind === 'pending' ? (
        <FeatureSkeleton profile={profile} label={t('正在打开{v0}', { v0: t(label) })} />
      ) : (
        <div className="deferred-feature-error" role="alert">
          <WarningCircle size={23} aria-hidden />
          <div>
            <h3>{t('{name}暂时无法打开', { name: t(label) })}</h3>
            <p>{t('可以重试打开，或返回工作区继续操作。')}</p>
          </div>
        </div>
      )}
      {(kind === 'error' || onBack) && (
        <div className="deferred-feature-actions">
          {kind === 'error' && (
            <button
              type="button"
              className="button button-secondary"
              data-testid="deferred-feature-retry"
              onClick={retry}
            >
              <ArrowClockwise size={17} aria-hidden />
              {t('重试打开')}
            </button>
          )}
          {onBack && (
            <button
              type="button"
              className="button button-quiet"
              data-testid="deferred-feature-back"
              onClick={onBack}
            >
              <ArrowLeft size={17} aria-hidden />
              {t('返回编辑器')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Declare once at module scope. Each mounted instance owns its lazy identity and
 * error boundary, so a retry never reloads the app or remounts sibling owners.
 * Modal features can supply renderState to keep their real title/profile/close.
 */
export function createDeferredFeature<P extends object>(
  loader: FeatureLoader<P>,
  label: string,
  renderState: FeatureStateRenderer<P> = (state) => <DeferredFeatureStatus {...state} />,
  profile: FeatureSkeletonProfile = 'panel',
): ComponentType<P & DeferredFeatureNavigation> {
  function DeferredFeature(props: P & DeferredFeatureNavigation) {
    const { onLoadBack, ...rest } = props;
    const featureProps = rest as P;
    const [attempt, setAttempt] = useState(() => ({
      Feature: lazy(() => loader(false)),
      generation: 0,
    }));
    const retry = useCallback(() => {
      // React.lazy caches rejected promises. Resetting only the boundary is insufficient.
      setAttempt((previous) => ({
        Feature: lazy(() => loader(true)),
        generation: previous.generation + 1,
      }));
    }, []);
    const { Feature } = attempt;
    const state = (kind: DeferredFeatureState['kind']): DeferredFeatureState => ({
      kind,
      label,
      retry,
      onBack: onLoadBack,
      profile,
    });
    return (
      <DeferredFeatureBoundary
        key={attempt.generation}
        renderError={() => renderState(state('error'), featureProps)}
      >
        <Suspense fallback={renderState(state('pending'), featureProps)}>
          <Feature {...featureProps} />
        </Suspense>
      </DeferredFeatureBoundary>
    );
  }
  DeferredFeature.displayName = `DeferredFeature(${label})`;
  return DeferredFeature;
}
