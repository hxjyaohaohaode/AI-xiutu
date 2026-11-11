import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AboutPage, type AboutIntent } from './about/AboutPage';
import { aboutCopy } from './about/copy';
import { readSiteRoute, siteRouteHash, type SiteRoute } from './about/site-route';
import { useLocale } from './i18n';
import { api } from './lib/api';
import type { PublicConfig } from './lib/types';
import type { StudioEntry } from './App';
import type { SampleSettings } from './about/sample';

const loadStudio = () => import('./App').then((module) => ({ default: module.App }));
let Studio = lazy(loadStudio);
function StudioLoading() {
  const c = aboutCopy(useLocale());
  return (
    <div className="site-loading" role="status" aria-live="polite">
      <div className="site-loading-content">
        <div className="studio-loading-geometry" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <h1>{c.loadingStudio}</h1>
        <p>{c.loadingBody}</p>
      </div>
    </div>
  );
}
class StudioBoundary extends Component<
  { children: ReactNode; onRetry: () => void; title: string; body: string; retry: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="site-loading" role="alert">
          <div className="site-loading-content">
            <h1>{this.props.title}</h1>
            <p>{this.props.body}</p>
            <button
              type="button"
              onClick={() => {
                this.props.onRetry();
                this.setState({ failed: false });
              }}
            >
              {this.props.retry}
            </button>
          </div>
        </div>
      );
    return this.props.children;
  }
}
export function SiteShell() {
  const locale = useLocale();
  const c = aboutCopy(locale);
  const [route, setRoute] = useState<SiteRoute>(() => readSiteRoute(location.hash));
  const [opened, setOpened] = useState(() => route !== 'about');
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const sequence = useRef(0);
  const currentRoute = useRef(route);
  const canLeaveStudio = useRef<(() => boolean) | null>(null);
  const registerLeaveGuard = useCallback((guard: (() => boolean) | null) => {
    canLeaveStudio.current = guard;
  }, []);
  const [entry, setEntry] = useState<StudioEntry>(() => ({
    key: 0,
    mode:
      route === 'login'
        ? 'password'
        : route === 'register' || route === 'reset' || route === 'sample'
          ? route
          : 'studio',
  }));
  const active = route !== 'about';
  useLayoutEffect(() => {
    document.body.dataset.sitePage = active ? 'studio' : 'about';
    return () => {
      delete document.body.dataset.sitePage;
    };
  }, [active]);
  const applyRoute = (next: SiteRoute, sample?: SampleSettings) => {
    if (currentRoute.current === next) return true;
    if (
      next === 'about' &&
      currentRoute.current !== 'about' &&
      canLeaveStudio.current?.() === false
    )
      return false;
    currentRoute.current = next;
    setRoute(next);
    if (next !== 'about') {
      setOpened(true);
      setEntry({ key: ++sequence.current, mode: next === 'login' ? 'password' : next, sample });
    }
    return true;
  };
  const navigate = (next: SiteRoute, replace = false, sample?: SampleSettings) => {
    if (!applyRoute(next, sample)) return;
    const hash = siteRouteHash(next);
    if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    if (next === 'about') window.scrollTo({ top: 0, behavior: 'instant' });
  };
  useEffect(() => {
    const navigateFromHistory = () => {
      if (!applyRoute(readSiteRoute(location.hash)))
        history.replaceState(null, '', siteRouteHash(currentRoute.current));
    };
    window.addEventListener('hashchange', navigateFromHistory);
    window.addEventListener('popstate', navigateFromHistory);
    return () => {
      window.removeEventListener('hashchange', navigateFromHistory);
      window.removeEventListener('popstate', navigateFromHistory);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<PublicConfig>('/public-config', { signal: controller.signal })
      .then(setConfig)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const enter = (intent: AboutIntent, sample?: SampleSettings) => navigate(intent, false, sample);
  return (
    <>
      {!active && <AboutPage config={config} onEnter={enter} hasStudio={opened} />}
      {opened && (
        <div className="site-studio" hidden={!active} inert={!active}>
          <StudioBoundary
            key={retryKey}
            title={c.loadError}
            body={c.loadErrorBody}
            retry={c.retry}
            onRetry={() => {
              Studio = lazy(loadStudio);
              setRetryKey((value) => value + 1);
            }}
          >
            <Suspense fallback={<StudioLoading />}>
              <Studio
                active={active}
                entryRequest={entry}
                publicConfig={config}
                onRegisterLeaveGuard={registerLeaveGuard}
                onAbout={() => navigate('about')}
                onEntryCancel={() => navigate('about', true)}
                onEntryComplete={() => {
                  if (readSiteRoute(location.hash) !== 'studio') navigate('studio', true);
                }}
              />
            </Suspense>
          </StudioBoundary>
        </div>
      )}
      {active && (route === 'login' || route === 'register' || route === 'reset') && (
        <button type="button" className="site-about-back" onClick={() => navigate('about', true)}>
          {c.authBack}
        </button>
      )}
    </>
  );
}
