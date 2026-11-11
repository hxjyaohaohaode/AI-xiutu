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
import { Busy } from './Ui';

export type DeferredFeatureState = {
  kind: 'pending' | 'error';
  label: string;
  retry: () => void;
  onBack?: () => void;
};

/** Reserved wrapper prop; it is never forwarded to the loaded feature. */
export type DeferredFeatureNavigation = { onLoadBack?: () => void };

type FeatureLoader<P extends object> = () => Promise<{ default: ComponentType<P> }>;
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
export function DeferredFeatureStatus({ kind, label, retry, onBack }: DeferredFeatureState) {
  return (
    <section
      className="deferred-feature-state"
      data-deferred-state={kind}
      data-testid={`deferred-feature-${kind}`}
      aria-busy={kind === 'pending'}
    >
      {kind === 'pending' ? (
        <div className="deferred-feature-pending" role="status">
          <Busy label={`正在打开${label}`} />
        </div>
      ) : (
        <div className="deferred-feature-error" role="alert">
          <WarningCircle size={23} aria-hidden />
          <div>
            <h3>{label}暂时无法打开</h3>
            <p>可以重试打开，或返回工作区继续操作。</p>
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
              重试打开
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
              返回编辑器
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
): ComponentType<P & DeferredFeatureNavigation> {
  function DeferredFeature(props: P & DeferredFeatureNavigation) {
    const { onLoadBack, ...rest } = props;
    const featureProps = rest as P;
    const [attempt, setAttempt] = useState(() => ({
      Feature: lazy(loader),
      generation: 0,
    }));
    const retry = useCallback(() => {
      // React.lazy caches rejected promises. Resetting only the boundary is insufficient.
      setAttempt((previous) => ({ Feature: lazy(loader), generation: previous.generation + 1 }));
    }, []);
    const { Feature } = attempt;
    const state = (kind: DeferredFeatureState['kind']): DeferredFeatureState => ({
      kind,
      label,
      retry,
      onBack: onLoadBack,
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
