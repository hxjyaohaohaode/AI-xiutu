export type SiteRoute = 'about' | 'studio' | 'login' | 'register' | 'reset' | 'sample';
/** Explicit public routes; ordinary section anchors stay on About. */
export function readSiteRoute(hash: string): SiteRoute {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  return path === 'studio' ||
    path === 'login' ||
    path === 'register' ||
    path === 'reset' ||
    path === 'sample'
    ? path
    : 'about';
}
export function siteRouteHash(route: SiteRoute): string {
  return route === 'about' ? '#/' : '#/' + route;
}
