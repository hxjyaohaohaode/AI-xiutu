import { Component, lazy, Suspense, useState, type ComponentProps, type ReactNode } from 'react';
import type { AIPanel } from './AIPanel';
import { SecureRandomUnavailableError } from '../lib/uuid';
import { Busy } from './Ui';

type BoundaryProps = {
  children: ReactNode;
  onRetry: () => void;
  onClose: () => void;
};

class AIPanelErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error('AI_PANEL_UNAVAILABLE') };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="ai-panel-error" aria-label="创作助手暂不可用">
        <div role="alert">
          <h3>创作助手暂时无法打开</h3>
          <p>
            {this.state.error instanceof SecureRandomUnavailableError
              ? this.state.error.message
              : '请重试打开，或收起面板继续编辑。'}
          </p>
          <p>当前图片和本地编辑已保留。</p>
        </div>
        <div className="ai-panel-error-actions">
          <button
            className="button button-primary"
            onClick={() => {
              this.props.onRetry();
              this.setState({ error: null });
            }}
          >
            重试打开
          </button>
          <button className="button button-secondary" onClick={this.props.onClose}>
            收起面板
          </button>
        </div>
      </section>
    );
  }
}

const createPanel = () =>
  lazy(() => import('./AIPanel').then((module) => ({ default: module.AIPanel })));

/** Keep failures and retries inside this panel; never remount the local editor. */
export function AIPanelFeature(props: ComponentProps<typeof AIPanel>) {
  const [Panel, setPanel] = useState(createPanel);
  return (
    <AIPanelErrorBoundary onClose={props.onClose} onRetry={() => setPanel(() => createPanel())}>
      <Suspense fallback={<Busy label="正在打开创作助手" />}>
        <Panel {...props} />
      </Suspense>
    </AIPanelErrorBoundary>
  );
}
