/** A bounded, branch-specific capture publication policy. */
export const REPOSITORY = 'hxjyaohaohaode/AI-xiutu';
export const BRANCH = 'frontend/system-redesign-20261111';
export const BASE_BRANCH = 'new/native-color-feedback';
export const LOCALES = ['zh-CN', 'zh-TW', 'en'];
export const SCREEN_NAMES = [
  'workspace', 'desktop-flow', 'local', 'portrait', 'layers', 'tablet', 'phone',
  'library', 'collaboration', 'team-canvas', 'assistant', 'delivery',
  'local-phone', 'portrait-phone', 'layers-phone', 'library-phone',
  'collaboration-phone', 'assistant-phone', 'delivery-phone',
];
export const ABOUT_SECTIONS = ['hero', 'craft', 'portrait', 'layers', 'assistant', 'together', 'delivery', 'questions', 'end'];
export const SCENARIOS = [
  { id: 'desktop-zh-CN', locale: 'zh-CN', viewport: { width: 1440, height: 960 }, motion: 'no-preference', touch: false },
  { id: 'phone-zh-CN', locale: 'zh-CN', viewport: { width: 390, height: 844 }, motion: 'no-preference', touch: true },
  { id: 'small-phone-zh-CN', locale: 'zh-CN', viewport: { width: 320, height: 568 }, motion: 'no-preference', touch: true },
  { id: 'landscape-en', locale: 'en', viewport: { width: 844, height: 390 }, motion: 'no-preference', touch: true },
  { id: 'tablet-zh-TW', locale: 'zh-TW', viewport: { width: 1024, height: 768 }, motion: 'no-preference', touch: true },
  { id: 'portrait-tablet-en', locale: 'en', viewport: { width: 768, height: 1024 }, motion: 'no-preference', touch: true },
  { id: 'reduced-desktop-en', locale: 'en', viewport: { width: 1440, height: 960 }, motion: 'reduce', touch: false },
];
export const MANIFEST_PATH = 'apps/web/public/about/source-manifest.json';
export const PUBLISH_IMAGE_PATHS = [
  ...SCREEN_NAMES.flatMap((name) => LOCALES.map((locale) => 'apps/web/public/about/' + name + '-' + locale + '.webp')),
  'apps/web/public/about/coast.webp',
  'apps/web/public/about/portrait.webp',
  'apps/web/public/about/color-study.webp',
  'docs/design/verification/system-redesign/about-desktop.png',
  'docs/design/verification/system-redesign/about-phone.png',
  'docs/design/verification/system-redesign/export-desktop.png',
  'docs/design/verification/system-redesign/export-phone.png',
  'docs/design/verification/system-redesign/works.png',
  'docs/design/verification/system-redesign/restoration-denoise.png',
  'docs/design/verification/system-redesign/restoration-motion.png',
  'docs/design/verification/system-redesign/restoration-motion-advanced.png',
  'docs/design/verification/system-redesign/documents.png',
  'docs/design/verification/system-redesign/collaborate.png',
  'docs/design/verification/system-redesign/usage.png',
  'docs/design/verification/system-redesign/assistant-unavailable.png',
  'docs/design/verification/system-redesign/account.png',
];
export const PUBLISH_PATHS = [...PUBLISH_IMAGE_PATHS, MANIFEST_PATH];
export const PHOTO_SOURCES = [
  {
    id: 'coast',
    pexelsId: 17344850,
    author: 'Peter Steiner1973',
    page: 'https://www.pexels.com/photo/17344850/',
    url: 'https://images.pexels.com/photos/17344850/pexels-photo-17344850.jpeg?auto=compress&cs=tinysrgb&w=1536',
    license: 'https://www.pexels.com/license/',
  },
  {
    id: 'portrait',
    pexelsId: 3791554,
    author: 'Andrea Piacquadio',
    page: 'https://www.pexels.com/photo/3791554/',
    url: 'https://images.pexels.com/photos/3791554/pexels-photo-3791554.jpeg?auto=compress&cs=tinysrgb&w=1536',
    license: 'https://www.pexels.com/license/',
  },
];
