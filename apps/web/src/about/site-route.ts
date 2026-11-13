export type SiteRoute =
  | 'about'
  | 'studio'
  | 'login'
  | 'register'
  | 'reset'
  | 'account'
  | 'support'
  | 'welcome'
  | 'usage'
  | 'sample';

export function isAccountSiteRoute(route: SiteRoute): boolean {
  return ['login', 'register', 'reset', 'account', 'support', 'welcome'].includes(route);
}
/** Explicit public routes; ordinary section anchors stay on About. */
export function readSiteRoute(hash: string): SiteRoute {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  if (path === 'account/support') return 'support';
  return path === 'studio' ||
    path === 'login' ||
    path === 'register' ||
    path === 'reset' ||
    path === 'account' ||
    path === 'welcome' ||
    path === 'usage' ||
    path === 'sample'
    ? path
    : 'about';
}
export function siteRouteHash(route: SiteRoute): string {
  if (route === 'support') return '#/account/support';
  return route === 'about' ? '#/' : '#/' + route;
}
