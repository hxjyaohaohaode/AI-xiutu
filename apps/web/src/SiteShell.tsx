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
import {
  isAccountSiteRoute,
  readSiteRoute,
  siteRouteHash,
  type SiteRoute,
} from './about/site-route';
import './account/account-page.css';
import { accountPageCopy } from './account/page-copy';
import { t, useLocale } from './i18n';
import { api } from './lib/api';
import { brandLogoUrl } from './lib/brand';
import type { PublicConfig } from './lib/types';
import type { StudioEntry } from './App';
import type { SampleSettings } from './about/sample';
import './site-loading.css';

const loadStudio = () => import('./App').then((module) => ({ default: module.App }));
let Studio = lazy(loadStudio);
function StudioLoading({ route }: { route: SiteRoute }) {
  const locale = useLocale();
  const c = aboutCopy(locale);
  const account = isAccountSiteRoute(route);
  const layout =
    route === 'usage' ? 'usage' : route === 'account' ? 'account' : account ? 'auth' : 'studio';
  return (
    <div className="route-loading" data-layout={layout} role="status" aria-live="polite">
      <div className="route-loading-shell" aria-hidden="true">
        <div className="route-loading-header">
          <i />
          <span />
          <i />
        </div>
        <div className="route-loading-body">
          <div className="route-loading-primary">
            <i />
            <i />
            <i />
          </div>
          <div className="route-loading-secondary">
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
      <p className="route-loading-label">
        {route === 'usage'
          ? t('读取用量账本')
          : account
            ? accountPageCopy(locale).loading
            : c.loadingStudio}
      </p>
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
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = brandLogoUrl(config?.brand) || '/favicon.svg';
  }, [config?.brand.logoUrl, config?.brand.logoAssetId]);
  const [retryKey, setRetryKey] = useState(0);
  const sequence = useRef(0);
  const currentRoute = useRef(route);
  const accountReturn = useRef<SiteRoute>(route === 'about' ? 'about' : 'studio');
  const canLeaveStudio = useRef<((next: SiteRoute) => boolean) | null>(null);
  const registerLeaveGuard = useCallback((guard: ((next: SiteRoute) => boolean) | null) => {
    canLeaveStudio.current = guard;
  }, []);
  const [entry, setEntry] = useState<StudioEntry>(() => ({
    key: 0,
    mode: route === 'login' ? 'password' : route === 'about' ? 'studio' : route,
  }));
  const active = route !== 'about';
  useLayoutEffect(() => {
    document.body.dataset.sitePage = isAccountSiteRoute(route)
      ? 'account'
      : active
        ? 'studio'
        : 'about';
    return () => {
      delete document.body.dataset.sitePage;
    };
  }, [active, route]);
  const applyRoute = (next: SiteRoute, sample?: SampleSettings) => {
    if (currentRoute.current === next) return true;
    if (canLeaveStudio.current?.(next) === false) return false;
    if (isAccountSiteRoute(next) && !isAccountSiteRoute(currentRoute.current))
      accountReturn.current = currentRoute.current === 'about' ? 'about' : 'studio';
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
    if (next === 'about' || isAccountSiteRoute(next))
      window.scrollTo({ top: 0, behavior: 'instant' });
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
            <Suspense fallback={<StudioLoading route={route} />}>
              <Studio
                active={active}
                siteRoute={route}
                accountBackToAbout={accountReturn.current === 'about'}
                entryRequest={entry}
                publicConfig={config}
                onRegisterLeaveGuard={registerLeaveGuard}
                onAbout={() => navigate('about')}
                onPageNavigate={navigate}
                onEntryCancel={() => navigate(accountReturn.current, true)}
                onEntryComplete={() => {
                  if (readSiteRoute(location.hash) !== 'studio') navigate('studio', true);
                }}
              />
            </Suspense>
          </StudioBoundary>
        </div>
      )}
    </>
  );
}
