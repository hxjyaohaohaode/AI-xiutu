/**
 * Seven distinct frontend risk scenarios, then current-UI product captures.
 * Real built application + real HTTP API + disposable PostgreSQL WASM.
 * Public, attributed photos only. No mocked API, SMS, AI supplier or payments.
 * This is not the native/HDR, all-feature, performance or paid-service gate.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { chromium } from 'playwright';
import sharp from 'sharp';
import {
  REPOSITORY, LOCALES, SCREEN_NAMES, ABOUT_SECTIONS, SCENARIOS,
  PHOTO_SOURCES, PUBLISH_IMAGE_PATHS, MANIFEST_PATH,
} from './system-redesign-policy.mjs';

assert.equal(process.env.CI, 'true', 'Use only this isolated CI review.');
assert.notEqual(process.env.NODE_ENV, 'production');
const root = fileURLToPath(new URL('../..', import.meta.url));
const sdkName = '@mediapipe/tasks-vision';
const sdkTelemetryEndpoint = 'https://odml.pa.googleapis.com/v1/log';
const webPackage = JSON.parse(await readFile(resolve(root, 'apps/web/package.json'), 'utf8'));
const sdkVersion = webPackage.dependencies[sdkName];
const dependencyLock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
assert.equal(sdkVersion, '1.2.2', 'Telemetry classification is restricted to the reviewed, exactly pinned SDK.');
assert.equal(dependencyLock.packages['node_modules/' + sdkName].version, sdkVersion);
const testedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(testedCommit, process.env.REVIEW_HEAD, 'The checkout must be the exact reviewed feature head.');
const artifacts = resolve(root, 'artifacts/frontend-review');
const publishRoot = resolve(artifacts, 'publish');
await mkdir(artifacts, { recursive: true });
const privateDirectory = await mkdtemp(join(tmpdir(), 'xiutu-frontend-review-'));
for (const key of [
  'OPENAI_API_KEY', 'OPENAI_REALTIME_API_KEY', 'GEMINI_API_KEY', 'DASHSCOPE_API_KEY',
  'ARK_API_KEY', 'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'PEXELS_API_KEY',
]) process.env[key] = '';
for (const flag of [
  'AI_PLAN_ENABLED', 'AI_TEXT_ENABLED', 'AI_IMAGE_ENABLED', 'AI_SPEECH_ENABLED',
  'AI_ASSISTANT_ENABLED', 'AI_VOICE_ENABLED', 'MEDIA_ADVANCED_ENABLED',
]) process.env[flag] = 'false';
process.env.NODE_ENV = 'test';
process.env.DB_POOL_MAX = '1';
process.env.AI_LITE_ACTIVE = 'true';
const port = 4186;
const origin = 'http://127.0.0.1:' + port;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = {
  schemaVersion: 1, testedCommit, repository: REPOSITORY,
  startedAt: new Date().toISOString(), state: 'running',
  runtime: 'built Vite app; actual API; isolated in-memory PostgreSQL WASM',
  cases: [], layouts: [], logos: [], scrolls: [], screenshots: [], inputs: [], cjkFontEvidence: [],
  pageErrors: [], routingErrors: [], unexpectedOrigins: [], blockedSdkTelemetryAttempts: [], requests: {}, manualVisualReview: false,
  limits: [
    'Seven locale/viewport/motion scenarios exercise import, numeric editing, undo, redo, original comparison and a decoded download; including 320x568 and 768x1024.',
    'This does not certify all 111 matrix items, native HDR precision, a physical device, a live AI provider or a real multiplayer session.',
    'Account/project images, if present, use explicit disposable CI fixtures and actual local API permissions.',
    'Photo capture is a browser screenshot followed only by WebP encoding. No generated interface or retouched screenshot is used.',
    'Every Simplified/Traditional Chinese capture requires CDP evidence of visible Han glyphs rendered with the matching Noto CJK family. This sampled font gate does not replace visual review.',
    'Publication is a separate exact-head, explicit-path job and cannot occur after any required verification step fails.',
    'Only exact POST attempts to the pinned MediaPipe SDK telemetry endpoint may be classified separately after route.abort succeeds; all remain blocked. Unknown external attempts fail the review.',
    'Telemetry counts apply only to this isolated Vite browser run. The repository Caddy configuration declares connect-src self, but deployed response headers and production telemetry were not verified.',
  ],
};
const published = [];
const photos = new Map();
const caseContexts = new Set();
const quoteTransportGates = new WeakMap();
const failures = new Map();
let memoryDb, socket, db, app, preview, browser, activePage;
let activeCase = 'bootstrap';
let canonicalLogo;
let reviewFixture;
async function until(read, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    await delay(80);
  } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}

async function failureEvidence(page = activePage) {
  if (failures.has(activeCase)) return failures.get(activeCase);
  const evidence = { case: activeCase, pageAvailable: !!page && !page.isClosed() };
  failures.set(activeCase, evidence);
  if (!evidence.pageAvailable) return evidence;
  const safe = (value, limit = 500) => String(value ?? '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\+?\d[\d ()-]{8,}\d/g, '[redacted phone]')
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{28,}(?:\.[A-Za-z0-9_-]+)*/g, '[redacted identifier]')
    .replace(/界面验收|示例创作者/g, '[fixture user]').slice(0, limit);
  try {
    evidence.dom = await page.evaluate(() => {
      const visible = (node) => {
        if (!(node instanceof Element) || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
        // A closed disclosure only paints its first direct summary, even when descendants retain layout boxes.
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open &&
            !parent.querySelector(':scope > summary')?.contains(node)) return false;
        }
        const r = node.getBoundingClientRect(), css = getComputedStyle(node);
        return r.width > 0 && r.height > 0 && css.visibility !== 'hidden' &&
          Number(css.opacity) > .01 && r.bottom > 0 && r.top < innerHeight &&
          r.right > 0 && r.left < innerWidth;
      };
      const panels = [...document.querySelectorAll('.free-panel,[data-panel-id],dialog')].slice(0, 20).map((node) => ({
        tag: node.tagName.toLowerCase(), panel: node.getAttribute('data-panel-id'),
        hidden: node.hasAttribute('hidden'), inert: node.hasAttribute('inert'),
        ariaHidden: node.getAttribute('aria-hidden'), ariaExpanded: node.getAttribute('aria-expanded'),
        open: node.hasAttribute('open'), visible: visible(node),
      }));
      const controls = [...document.querySelectorAll('[data-control-id]')].filter(visible).slice(0, 80).map((node) => ({
        id: node.getAttribute('data-control-id'), pressed: node.getAttribute('aria-pressed'),
        selected: node.getAttribute('aria-selected'), disabled: node.matches(':disabled'),
      }));
      const tools = [...document.querySelectorAll('[data-dock-tool]')].filter(visible).slice(0, 24).map((node) => ({
        id: node.getAttribute('data-dock-tool'), pressed: node.getAttribute('aria-pressed'),
        expanded: node.getAttribute('aria-expanded'),
      }));
      const fragments = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let textLength = 0, node;
      while ((node = walker.nextNode()) && textLength < 3000) {
        const owner = node.parentElement;
        if (!owner || !visible(owner) ||
          owner.closest('input,textarea,select,[role="textbox"],script,style,.sr-only,[data-sensitive],[class*="account"],[class*="profile"],[data-testid="account-center"]')) continue;
        const value = node.textContent?.replace(/\s+/g, ' ').trim();
        if (value) { fragments.push(value); textLength += value.length + 1; }
      }
      return {
        path: location.pathname,
        route: location.hash.match(/^#\/[a-z-]+/)?.[0] ?? '',
        panels, controls, tools,
        body: fragments.join(' ').slice(0, 3000),
      };
    });
    evidence.dom.path = safe(evidence.dom.path, 180);
    evidence.dom.body = safe(evidence.dom.body, 3000);
    console.error('DIAGNOSTIC ' + activeCase + ' ' + JSON.stringify(evidence.dom));
  } catch (error) {
    evidence.diagnosticError = safe(error?.message ?? error);
    console.error('DIAGNOSTIC ' + activeCase + ' unavailable: ' + evidence.diagnosticError);
  }
  const name = 'failures/' + activeCase.replace(/[^a-zA-Z0-9_-]+/g, '-') + '.png';
  try {
    const path = resolve(artifacts, name);
    await mkdir(dirname(path), { recursive: true });
    const bytes = await page.screenshot({
      path, timeout: 5000,
      mask: [page.locator('input[type="password"]:visible')],
    });
    evidence.screenshot = name;
    report.screenshots.push({ case: activeCase, file: name, state: 'captured', bytes: bytes.length, sha256: sha256(bytes), viewport: page.viewportSize(), failure: true });
  } catch (error) {
    evidence.screenshotError = safe(error?.message ?? error);
    report.screenshots.push({ case: activeCase, file: name, state: 'failed', message: evidence.screenshotError });
  }
  return evidence;
}
async function closeCaseContext(context) {
  try { await context.close(); }
  finally { caseContexts.delete(context); }
}
async function check(name, run) {
  activeCase = name;
  activePage = undefined;
  const started = Date.now();
  try {
    const details = await run();
    assert.deepEqual(report.routingErrors.filter((failure) => failure.case === name), [], name + ' must not have request routing errors.');
    report.cases.push({ name, state: 'passed', durationMs: Date.now() - started, ...details });
    console.log('PASS ' + name);
    return details;
  } catch (error) {
    const message = String(error?.stack ?? error).slice(0, 6000);
    const diagnostics = await failureEvidence();
    report.cases.push({ name, state: 'failed', durationMs: Date.now() - started, message, diagnostics });
    console.error('FAIL ' + name + ': ' + String(error?.message ?? error).slice(0, 1500));
    return null;
  } finally {
    for (const context of [...caseContexts]) {
      try { await closeCaseContext(context); }
      catch (error) {
        (report.cleanupErrors ??= []).push({ resource: 'browser context', case: name, message: String(error.message).slice(0, 500) });
      }
    }
    activePage = undefined;
  }
}
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const visible = (node) => {
      if (!(node instanceof Element) || node.closest('[inert],[hidden],[aria-hidden="true"]')) return false;
      // A closed disclosure only paints its first direct summary, even when descendants retain layout boxes.
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open &&
          !parent.querySelector(':scope > summary')?.contains(node)) return false;
      }
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    };
    // Recheck each frame: a real API read can mount a second entry animation
    // after the first one finishes. JS springs are not Web Animations, so also
    // observe the painted geometry and visibility without changing app state.
    const watched='.overview-expanding-frame,[data-scroll-reveal],.rubber-segment-indicator,.choice-highlight,.squish-switch-thumb,.workspace-view-indicator,.warm-tooltip,[data-motion]';
    const signature=()=>[...document.querySelectorAll(watched)].filter(visible).map(node=>{
      const box=node.getBoundingClientRect(),style=getComputedStyle(node);
      return [box.x,box.y,box.width,box.height].map(value=>Math.round(value*10)).join(',')+
        ':'+[style.opacity,style.filter,style.clipPath].join(',');
    }).join(';');
    const isMoving=()=>document.getAnimations().some(animation=>{
      const timing=animation.effect?.getComputedTiming();
      return visible(animation.effect?.target) && Number.isFinite(timing?.iterations) &&
        timing.endTime<3000 && animation.playState==='running';
    });
    let previous=signature(),stable=0;
    const deadline=performance.now()+3500;
    while(stable<4 && performance.now()<deadline) {
      await new Promise(done=>requestAnimationFrame(done));
      const current=signature();
      stable=!isMoving() && current===previous?stable+1:0;
      previous=current;
    }
    if(stable<4) throw new Error('Visible motion did not settle within the capture bound.');
  });
}
async function newPage(specification, route = '/#/studio', signedIn = false) {
  const context = await browser.newContext({
    viewport: specification.viewport, hasTouch: specification.touch ?? false,
    reducedMotion: specification.motion ?? 'no-preference', locale: specification.locale,
    colorScheme: specification.colorScheme ?? 'light',
    acceptDownloads: true, serviceWorkers: 'block',
  });
  caseContexts.add(context);
  context.setDefaultTimeout(25000);
  context.setDefaultNavigationTimeout(30000);
  await context.addInitScript(({ locale, theme }) => {
    localStorage.setItem('yingjian.locale.v1', locale);
    if(localStorage.getItem('image-workspace:theme')===null)
      localStorage.setItem('image-workspace:theme', theme);
  }, { locale: specification.locale, theme: specification.theme ?? 'light' });
  const ownerCase = activeCase;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    try {
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {
        const knownSdkTelemetry = request.method() === 'POST' &&
          request.url() === sdkTelemetryEndpoint && url.search === '' && url.hash === '';
        // Classification follows successful blocking. Neither known telemetry nor
        // an unknown origin is ever continued or answered with a synthetic response.
        await route.abort('blockedbyclient');
        if (knownSdkTelemetry)
          report.blockedSdkTelemetryAttempts.push({
            case: ownerCase, endpoint: sdkTelemetryEndpoint, method: 'POST', blocked: true,
          });
        else report.unexpectedOrigins.push({
          case: ownerCase, origin: url.origin, path: url.pathname, method: request.method(),
        });
      } else {
        const gate = quoteTransportGates.get(context);
        if (gate && !gate.held && request.method() === 'POST' && request.url() === gate.url) {
          gate.held = true;
          // The existing origin guard owns the only handler and continuation.
          // Only this exact, once-only local quote waits; no response is replaced.
          await gate.wait;
        }
        await route.continue();
      }
    } catch (error) {
      const failure = {
        case: ownerCase, method: request.method(),
        path: url.pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/g, ':id').slice(0, 200),
        message: String(error?.message ?? error).split('\n')[0].slice(0, 600),
      };
      if (report.routingErrors.length < 40) {
        report.routingErrors.push(failure);
        console.error('ROUTE FAILURE ' + JSON.stringify(failure));
      }
      const finishedCase = report.cases.find((entry) => entry.name === ownerCase);
      if (finishedCase?.state === 'passed') {
        finishedCase.state = 'failed';
        finishedCase.message = 'Request routing failed: ' + failure.message;
      }
    }
  });
  if (signedIn) await signedIn(context);
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror', (error) =>
    report.pageErrors.push({ case: activeCase, message: error.message.slice(0, 1500) }));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/v1/')) {
      const key = request.method() + ' ' + url.pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/g, ':id');
      report.requests[key] = (report.requests[key] ?? 0) + 1;
    }
  });
  await page.goto(origin + route);
  await page.waitForFunction((locale) => document.documentElement.lang === locale, specification.locale);
  if (route.includes('/studio')) await page.locator('.floating-topbar').waitFor();
  await settle(page);
  return { page, context };
}
const cjkFontFamilies = { 'zh-CN': 'Noto Sans CJK SC', 'zh-TW': 'Noto Sans CJK TC' };
async function verifyRenderedCjk(page, captureName) {
  const locale = await page.evaluate(() => document.documentElement.lang);
  const expectedFamily = cjkFontFamilies[locale];
  if (!expectedFamily) return locale;
  const samples = await page.evaluate(() => {
    const scope = document.querySelector('dialog[open]:not([inert])') ?? document.body;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const samples = [];
    for (let textNode = walker.nextNode(); textNode && samples.length < 3; textNode = walker.nextNode()) {
      const element = textNode.parentElement;
      const text = textNode.textContent.trim();
      // Pure Han text prevents Latin glyphs in a CJK font from satisfying this check.
      if (!element || element.children.length || !/^[\p{Script=Han}\s]+$/u.test(text)) continue;
      const hanText = text.replace(/\s/g, '');
      if (!hanText || [...hanText].length > 32 ||
          [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).length !== 1 ||
          element.closest('[inert],[hidden],[aria-hidden="true"],script,style') ||
          !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      let closed = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement && !parent.open &&
            !parent.querySelector(':scope > summary')?.contains(element)) closed = true;
      if (closed) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rect = [...range.getClientRects()].find((r) =>
        r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight);
      if (!rect) continue;
      const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
      const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== element && !element.contains(hit))) continue;
      const parts = [];
      for (let node = element; node && node !== document.documentElement; node = node.parentElement)
        parts.unshift(node.localName + ':nth-child(' + ([...node.parentElement.children].indexOf(node) + 1) + ')');
      samples.push({ selector: 'html > ' + parts.join(' > '), text: hanText, hanCount: [...hanText].length });
    }
    return samples;
  });
  assert.ok(samples.length, captureName + ': no visible Han text node available for the font gate.');
  const session = await page.context().newCDPSession(page);
  const evidence = { case: activeCase, capture: captureName, locale, method: 'CDP.CSS.getPlatformFontsForNode', samples: [] };
  // Keep actual fallback evidence even when the expected font check fails.
  report.cjkFontEvidence.push(evidence);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root: documentNode } = await session.send('DOM.getDocument');
    for (const sample of samples) {
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: sample.selector });
      assert.ok(nodeId, captureName + ': the actual Han text node disappeared.');
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      evidence.samples.push({
        ...sample,
        fonts: fonts.map(({ familyName, postScriptName, isCustomFont, glyphCount }) =>
          ({ familyName, postScriptName, isCustomFont, glyphCount })),
      });
    }
    for (const sample of evidence.samples) {
      const rendered = sample.fonts.filter((font) => font.familyName === expectedFamily)
        .reduce((count, font) => count + font.glyphCount, 0);
      assert.ok(rendered >= sample.hanCount,
        captureName + ': visible Han text must actually render with ' + expectedFamily + '; got ' + JSON.stringify(sample.fonts));
    }
  } finally { await session.detach(); }
  return locale;
}

async function capture(page, name, options = {}) {
  await settle(page);
  const locale = await verifyRenderedCjk(page, name);
  const path = resolve(artifacts, name);
  await mkdir(dirname(path), { recursive: true });
  const bytes = await page.screenshot({
    path, fullPage: options.fullPage ?? false,
    mask: [page.locator('input[type="password"]:visible')],
  });
  report.screenshots.push({
    file: name, bytes: bytes.length, sha256: sha256(bytes),
    viewport: page.viewportSize(), locale, state: 'captured', case: activeCase,
  });
  return bytes;
}
async function publishImage(path, bytes, detail) {
  assert.ok(PUBLISH_IMAGE_PATHS.includes(path), 'Unexpected publication path.');
  assert.ok(!published.some((file) => file.path === path), 'Duplicate publication image.');
  const metadata = await sharp(bytes).metadata();
  assert.ok(metadata.width > 0 && metadata.height > 0);
  const destination = resolve(publishRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  published.push({
    path, bytes: bytes.length, sha256: sha256(bytes),
    width: metadata.width, height: metadata.height, ...detail,
  });
  if (path.startsWith('apps/web/public/about/')) {
    const runtime = resolve(root, 'apps/web/dist/about', path.split('/').at(-1));
    await mkdir(dirname(runtime), { recursive: true });
    await writeFile(runtime, bytes);
  }
}
async function verificationCapture(page, artifactName, name, state) {
  const bytes = await capture(page, artifactName);
  await publishImage('docs/design/verification/system-redesign/' + name + '.png', bytes, {
    kind: 'current-ui-screenshot', screen: name, state, locale: 'zh-CN',
    viewport: page.viewportSize(), isolatedFixture: true,
  });
}
async function productCapture(page, name, locale, photo, state) {
  const png = await capture(page, 'screens/' + name + '-' + locale + '.png');
  const bytes = await sharp(png).webp({ quality: 90 }).toBuffer();
  await publishImage('apps/web/public/about/' + name + '-' + locale + '.webp', bytes, {
    kind: 'current-ui-screenshot', locale, screen: name, photo, state,
    viewport: page.viewportSize(),
  });
}
async function layout(page, label, selector = null) {
  await settle(page);
  const result = await page.evaluate((selector) => {
    const scope = selector ? document.querySelector(selector) : document.querySelector('dialog[open]:not([inert])') ?? document;
    if (!scope) throw new Error('Missing layout scope: ' + selector);
    const visible = (node) => {
      if (!(node instanceof HTMLElement) || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
      // A closed disclosure only paints its first direct summary, even when descendants retain layout boxes.
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open &&
          !parent.querySelector(':scope > summary')?.contains(node)) return false;
      }
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      const nativeCheck = node.matches('.check-control-target > input[type="checkbox"]') &&
        node.parentElement.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
      return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && (Number(style.opacity) > 0.01 || nativeCheck);
    };
    const obscured = [];
    let sampledControls = 0;
    for (const node of scope.querySelectorAll('button,a[href],input:not([type="file"]),select,textarea,[role="slider"],[role="combobox"]')) {
      if (!visible(node) || node.matches(':disabled') || getComputedStyle(node).pointerEvents === 'none') continue;
      const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
      let clipped = false;
      for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
        const css = getComputedStyle(p), box = p.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(css.overflowX) && (x < box.left || x > box.right)) clipped = true;
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY) && (y < box.top || y > box.bottom)) clipped = true;
      }
      if (clipped) continue;
      sampledControls++;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === node || node.contains(hit) || (node instanceof HTMLInputElement && node.labels && [...node.labels].some((label) => label === hit || label.contains(hit)))))
        obscured.push({
          label: (node.getAttribute('aria-label') || node.textContent || node.tagName).trim().slice(0, 90),
          rect: [r.x, r.y, r.width, r.height].map(Math.round),
          covering: hit?.className?.toString().slice(0, 80) ?? null,
        });
    }
    const dialog = scope instanceof HTMLDialogElement ? scope : null;
    const bounds = dialog?.getBoundingClientRect();
    const headings = [...scope.querySelectorAll('h1,h2,h3')].filter(visible).filter((node) =>
      getComputedStyle(node).textOverflow !== 'ellipsis' && node.scrollWidth > node.clientWidth + 2)
      .map((node) => node.textContent.trim().slice(0, 80));
    return {
      width: innerWidth, height: innerHeight,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      sampledControls, obscured, headingOverflows: headings,
      dialog: bounds ? { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom } : null,
    };
  }, selector);
  report.layouts.push({ case: activeCase, label, ...result });
  assert.ok(result.documentOverflow <= 2, label + ' creates horizontal document overflow: ' + result.documentOverflow);
  assert.deepEqual(result.headingOverflows, [], label + ' heading overflows');
  assert.deepEqual(result.obscured, [], label + ' controls overlap or are covered');
  assert.ok(result.sampledControls > 0, label + ' must expose real usable controls.');
  if (result.dialog) {
    const box = result.dialog;
    assert.ok(box.left >= -1 && box.right <= result.width + 1 && box.top >= -1 && box.bottom <= result.height + 1,
      label + ' dialog must fit the viewport.');
  }
  return result;
}
async function logo(page, label) {
  const images = page.locator('img.product-brand-mark:visible');
  assert.ok(await images.count() > 0, label + ' needs a visible product mark.');
  for (const image of await images.all()) {
    await image.evaluate(async (node) => { if (!node.complete) await node.decode(); });
    const state = await image.evaluate((node) => ({
      src: new URL(node.currentSrc || node.src, location.href).pathname,
      decoded: node.complete && node.naturalWidth > 0,
    }));
    assert.equal(state.decoded, true, 'The logo must decode.');
    if (!canonicalLogo) canonicalLogo = state.src;
    assert.equal(state.src, canonicalLogo, 'The product mark must stay identical across pages and themes.');
    report.logos.push({ case: activeCase, label, ...state });
  }
}
async function imageReady(page) {
  await page.locator('.image-frame canvas[aria-label]:visible').waitFor();
  await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
  await page.locator('.stage-loading:visible').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.canvas-error [role="alert"]:visible').count(), 0);
  await settle(page);
}
async function canvasPixels(page) {
  await imageReady(page);
  const data = await page.locator('.image-frame canvas[aria-label]:visible').evaluate((canvas) => canvas.toDataURL('image/png'));
  const bytes = Buffer.from(data.split(',')[1], 'base64');
  const { data: pixels, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, luma = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) {
    opaque++;
    luma += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  }
  assert.ok(opaque > 0, 'The actual photo canvas must contain visible pixels.');
  return { width: info.width, height: info.height, pixelSha256: sha256(pixels), opaque, meanLuma: luma / opaque };
}
async function importPhoto(page, id) {
  const source = photos.get(id);
  assert.ok(source);
  await page.locator('input[type="file"].sr-only').first().setInputFiles({
    name: id === 'coast' ? 'Lake study.jpg' : 'Portrait study.jpg', mimeType: 'image/jpeg', buffer: source.bytes,
  });
  await imageReady(page);
  return canvasPixels(page);
}
async function tool(page, id) {
  const button = page.locator('[data-dock-tool="' + id + '"]');
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await page.locator('.free-panel[aria-hidden="false"]').waitFor();
  await settle(page);
}
async function parameter(page, id, value, owner = '.free-panel[aria-hidden="false"]') {
  const button = page.locator(owner + ' [data-control-id="' + id + '"]:visible').first();
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await button.click({ timeout: 5000 });
  const shelf = button.locator('..').locator('..');
  const current = shelf.locator('.parameter-shelf-current');
  await current.locator('.precision-value').click();
  const input = current.locator('input[type="number"]');
  await input.fill(String(value));
  await input.press('Enter');
  await until(async () => Number(await current.locator('input[type="range"]').inputValue()) === value, 'numeric change is committed');
  await imageReady(page);
}
const viewIds = ['editor', 'works', 'compare', 'collaborate', 'docs', 'deliver', 'usage'];
async function changeView(page, id) {
  const assistantReturn = page.locator('[data-ai-return]:visible');
  if (await assistantReturn.count()) {
    await assistantReturn.click();
    await assistantReturn.waitFor({ state: 'hidden' });
  }
  assert.ok(viewIds.includes(id));
  const compact = page.locator('.mobile-view-trigger');
  if (await compact.isVisible()) {
    await compact.click();
    const dialog = page.locator('dialog.workspace-navigation-dialog');
    await dialog.locator('[data-view="' + id + '"]').click();
    await dialog.waitFor({ state: 'hidden' });
  } else await page.locator('.compact-view-tabs > button[data-view="' + id + '"]').click();
  await settle(page);
}

async function navigationFocus(page, label) {
  const opener = page.locator('.workspace-identity button').first();
  await opener.click();
  const dialog = page.locator('dialog.sidebar-navigation-modal[open]');
  await dialog.waitFor();
  await until(() => dialog.evaluate(node => node.contains(document.activeElement)), 'navigation receives focus');
  await layout(page, label + ': native project navigation');
  await dialog.locator('button:visible:enabled').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, 'Navigation Tab must stay in the actual modal');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, 'Navigation reverse Tab must stay in the actual modal');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate(node => node === document.activeElement), true, 'Navigation returns focus to its opener');
}

async function editorGeometry(page, specification) {
  const photo = await page.locator('.image-frame').boundingBox();
  assert.ok(photo && photo.width > 0 && photo.height > 0, 'The real photograph must retain a visible editing area');
  const evidence = { scenario: specification.id, photo, controls: [] };
  if (specification.id === 'small-phone-zh-CN')
    assert.ok(photo.height >= 180, '320x568 default editing must leave at least180px of photograph height; got' + photo.height);
  if (specification.viewport.width < 760) {
    evidence.controls = await page.locator('[data-control-id]:visible').evaluateAll(nodes => nodes.map(node => {
      const r=node.getBoundingClientRect();
      return { id:node.dataset.controlId, width:r.width, height:r.height, x:r.x,y:r.y };
    }).filter(r => r.x+r.width/2>0 && r.x+r.width/2<innerWidth && r.y+r.height/2>0 && r.y+r.height/2<innerHeight));
    for (const control of evidence.controls) {
      assert.ok(control.width >=43.5 && control.height >=43.5,
        'Phone parameter buttons retain individual44px hit boxes:' + JSON.stringify(control));
    }
  }
  (report.editorGeometry ??= []).push(evidence);
}

async function referenceControlReview() {
  const desktop = await newPage({locale:'en',viewport:{width:1440,height:960}});
  const scrubs=[];
  try {
    const page=desktop.page;
    await importPhoto(page,'coast');
    await tool(page,'light');
    await parameter(page,'exposure',0.1234);
    const panel=page.locator('[data-panel-id="inspector"][aria-hidden="false"]');
    const current=panel.locator('.parameter-shelf-current');
    const range=current.locator('input[type="range"]');
    const value=current.locator('.precision-value');
    const baseline=await canvasPixels(page);
    const exact=async(expected,label)=>until(async()=>Math.abs(Number(await range.inputValue())-expected)<1e-10,label);
    for (const cancel of [true,false]) {
      const box=await value.boundingBox();
      assert.ok(box);
      const x=box.x+box.width/2,y=box.y+box.height/2;
      await page.mouse.move(x,y);
      await page.mouse.down();
      try {
        await page.mouse.move(x+20,y,{steps:1});
        await exact(0.2234,'Scrub begins at the actual step');
        await page.keyboard.down('Alt');
        await page.mouse.move(x+22,y,{steps:1});
        await exact(0.2234,'Switching to fine movement does not jump');
        await page.mouse.move(x+24,y,{steps:1});
        await exact(0.2244,'Fine movement uses the new origin');
        await page.keyboard.up('Alt');
        await page.keyboard.down('Shift');
        await page.mouse.move(x+26,y,{steps:1});
        await exact(0.2244,'Switching to coarse movement does not jump');
        await page.mouse.move(x+28,y,{steps:1});
        await exact(0.3244,'Coarse movement uses the new origin');
        if (cancel) await page.keyboard.press('Escape');
      } finally {
        await page.mouse.up();
        await page.keyboard.up('Alt');
        await page.keyboard.up('Shift');
      }
      assert.equal(await panel.getAttribute('aria-hidden'),'false','Cancelling a scrub does not close its inspector');
      assert.equal(await current.locator('input[type="number"]').count(),0,'A finished drag does not open numeric entry');
      if (cancel) {
        await exact(0.1234,'Escape and late pointer release preserve the original value');
      } else {
        await exact(0.3244,'Pointer release commits the actual edit');
        assert.notEqual((await canvasPixels(page)).pixelSha256,baseline.pixelSha256);
        await page.keyboard.press('Control+z');
        await exact(0.1234,'One Undo restores the whole scrub transaction');
      }
      assert.equal((await canvasPixels(page)).pixelSha256,baseline.pixelSha256,'Cancelled or undone scrub restores the real pixels');
      scrubs.push({cancel,modifierRebase:true,singleTransaction:true,restoredPixels:true});
    }
    await layout(page,'actual Scrub modifiers, cancellation and single Undo');
    await capture(page,'interactions/scrub-desktop.png');
  } catch(error) {await failureEvidence(desktop.page);throw error;}
  finally {await closeCaseContext(desktop.context);}
  const phone=await newPage({locale:'zh-CN',viewport:{width:390,height:844},touch:true});
  const heights=[];
  let touchEvidence;
  try {
    const page=phone.page;
    await importPhoto(page,'coast');await tool(page,'light');await parameter(page,'exposure',0);
    const panel=page.locator('[data-panel-id="inspector"][aria-hidden="false"]');
    const slider=panel.locator('.parameter-shelf-current input[type="range"]');
    const beforeTouch=await canvasPixels(page),touchStart=Number(await slider.inputValue());
    const track=await slider.boundingBox();assert.ok(track);
    const x=track.x+track.width/2,y=track.y+track.height/2;
    const touchSession=await page.context().newCDPSession(page);
    try {
      await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      for(let distance=6;distance<=30;distance+=6)
        await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+distance,y,id:1}]});
      await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } finally {await touchSession.detach();}
    await until(async()=>Number(await slider.inputValue())>touchStart+0.1,'Real touchscreen input changes the mobile range');
    const afterTouch=await canvasPixels(page);
    assert.notEqual(afterTouch.pixelSha256,beforeTouch.pixelSha256);
    const undo=page.getByRole('button',{name:'撤销本次编辑',exact:true});
    const undoBox=await undo.boundingBox();assert.ok(undoBox);
    await page.touchscreen.tap(undoBox.x+undoBox.width/2,undoBox.y+undoBox.height/2);
    await until(async()=>Number(await slider.inputValue())===touchStart,'One real touch on Undo reverses the slider gesture');
    assert.equal((await canvasPixels(page)).pixelSha256,beforeTouch.pixelSha256);
    touchEvidence={method:'Chromium touchscreen events and actual touchscreen tap',changedPixels:true,oneUndoRestoredPixels:true,physicalDevice:false};
    for (const target of [339,176]) {
      await panel.locator('.panel-layout-trigger').click();
      const height=panel.locator('.panel-size-controls input[type="range"]').last();
      await height.waitFor();await height.press('Home');
      const minimum=Number(await height.inputValue());
      assert.ok(target>=minimum);
      for(let step=minimum;step<target;step++) await height.press('ArrowRight');
      assert.equal(Number(await height.inputValue()),target);
      await panel.locator('.panel-layout-trigger').click();
      await settle(page);
      const before=await panel.boundingBox();
      await panel.locator('.panel-layout-trigger').click();
      await panel.locator('.panel-layout-menu .panel-collapse-action').click();
      await settle(page);
      assert.ok((await panel.boundingBox()).height<before.height-60,'The panel really collapses');
      await panel.locator('.panel-drag-header .panel-collapse-action').click();
      await settle(page);
      const after=await panel.boundingBox();
      assert.ok(Math.abs(after.height-before.height)<1.5,'A manually sized panel restores its actual height');
      await panel.locator('.panel-layout-trigger').click();
      assert.equal(Number(await height.inputValue()),target,'The saved manual height survives collapse');
      await panel.locator('.panel-layout-trigger').click();
      heights.push({target,before:before.height,after:after.height});
    }
    await layout(page,'phone manually resized and restored panel');
    await capture(page,'interactions/restored-phone-panel.png');
  } catch(error) {await failureEvidence(phone.page);throw error;}
  finally {await closeCaseContext(phone.context);}
  return {scrubs,heights,touchEvidence};
}

async function actualDownload(page, expectedSource, label) {
  await changeView(page, 'deliver');
  await page.locator('.delivery-composition').waitFor();
  await layout(page, label + ': delivery');
  const trigger = page.locator('.delivery-primary-action > button');
  const triggerHandle = await trigger.elementHandle();
  await trigger.click();
  const dialog = page.locator('dialog.export-dialog[open]');
  await dialog.waitFor();
  await layout(page, label + ': export modal');
  if (label === 'desktop-zh-CN' || label === 'phone-zh-CN')
    await verificationCapture(page, 'flows/' + label + '-export-dialog.png',
      label === 'desktop-zh-CN' ? 'export-desktop' : 'export-phone',
      'Actual export dialog before the same verified full-size PNG download; no generated interface');
  else await capture(page, 'flows/' + label + '-export-dialog.png');
  await dialog.locator('button:visible:not(:disabled)').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true, 'Tab must remain inside the active modal.');
  const pending = page.waitForEvent('download');
  await dialog.locator('button.button-full').click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  const file = resolve(artifacts, 'downloads/' + label + '.png');
  await mkdir(dirname(file), { recursive: true });
  await download.saveAs(file);
  const bytes = await readFile(file);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'png');
  assert.deepEqual([metadata.width, metadata.height], [expectedSource.width, expectedSource.height], 'Download keeps the actual imported photo dimensions.');
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer();
  let luma = 0;
  for (let i = 0; i < raw.length; i += 4)
    luma += 0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2];
  const evidence = {
    bytes: bytes.length, sha256: sha256(bytes), width: metadata.width, height: metadata.height,
    pixelSha256: sha256(raw), meanLuma: luma / (raw.length / 4), initiatedBySingleButton: true,
  };
  await dialog.locator('a[download]').waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await triggerHandle.evaluate((node) => node === document.activeElement), true, 'Escape restores the export opener.');
  await triggerHandle.dispose();
  return evidence;
}
async function coreFlow(specification) {
  const { context, page } = await newPage(specification);
  try {
    await logo(page, specification.id + ': studio');
    await navigationFocus(page, specification.id);
    await importPhoto(page, 'coast');
    await tool(page, 'light');
    const original = await canvasPixels(page);
    await parameter(page, 'exposure', 0.35);
    const edited = await until(async () => {
      const frame = await canvasPixels(page);
      return frame.pixelSha256 !== original.pixelSha256 ? frame : null;
    }, 'exposure changes actual displayed pixels');
    await layout(page, specification.id + ': parameters');
    await editorGeometry(page, specification);
    await capture(page, 'flows/' + specification.id + '-edited.png');
    const history = page.locator('.canvas-view-controls > button');
    await history.nth(0).click();
    await until(async () => (await canvasPixels(page)).pixelSha256 === original.pixelSha256, 'undo restores original displayed pixels');
    await history.nth(1).click();
    await until(async () => (await canvasPixels(page)).pixelSha256 === edited.pixelSha256, 'redo restores the exact edited preview');
    const compare = page.locator('.compare-press');
    await compare.focus();
    await page.keyboard.down('Space');
    let held;
    try {
      await page.locator('.original-label').waitFor();
      held = await until(async () => {
        const frame = await canvasPixels(page);
        return frame.pixelSha256 === original.pixelSha256 ? frame : null;
      }, 'holding compare shows the actual original');
    } finally { await page.keyboard.up('Space'); }
    await page.locator('.original-label').waitFor({ state: 'hidden' });
    await until(async () => (await canvasPixels(page)).pixelSha256 === edited.pixelSha256, 'releasing comparison restores the edit');
    await changeView(page, 'compare');
    const split = page.locator('.compare-reveal-input');
    await split.waitFor();
    await split.focus();
    await split.press('Home');
    assert.equal(await split.inputValue(), '0');
    await split.press('End');
    assert.equal(await split.inputValue(), '100');
    await split.press('ArrowLeft');
    assert.equal(await split.inputValue(), '99');
    await layout(page, specification.id + ': comparison');
    const exported = await actualDownload(page, photos.get('coast'), specification.id);
    if (edited.width === exported.width && edited.height === exported.height)
      assert.equal(exported.pixelSha256, edited.pixelSha256, 'Full-size export retains the actual displayed edited pixels.');
    else
      assert.ok(exported.meanLuma > original.meanLuma + 1, 'Full-size export contains the positive exposure edit, not just the original photo.');
    await capture(page, 'flows/' + specification.id + '-delivery.png');
    return {
      scenario: specification.id, locale: specification.locale, viewport: specification.viewport,
      reducedMotion: specification.motion, original, edited, held, exported,
      assertions: ['real import', 'numeric commit', 'changed canvas pixels', 'undo', 'redo', 'held original', 'keyboard split comparison', 'decoded full-size PNG', 'modal Tab and Escape'],
    };
  } catch (error) {
    await failureEvidence(page);
    throw error;
  } finally { await closeCaseContext(context); }
}
async function inspectAbout(specification) {
  const { context, page } = await newPage(specification, '/');
  try {
    const about = page.locator('.product-overview-root');
    await about.waitFor();
    await logo(page, specification.id + ': about');
    const sections = await about.locator('[data-product-section]').evaluateAll((nodes) => nodes.map((node) => node.dataset.productSection));
    assert.deepEqual(sections, ABOUT_SECTIONS);
    assert.equal(await about.locator('[role="tablist"],details,summary').count(), 0, 'About content must not require tabs or disclosure clicks.');
    assert.equal(await about.locator('[data-product-section][hidden],[data-product-section][inert]').count(), 0);
    await page.keyboard.press('Control+Home');
    const seen = new Set();
    const positions = [];
    for (let step = 0; step < 120; step++) {
      await settle(page);
      const position = await page.evaluate(() => {
        const visible = [...document.querySelectorAll('[data-product-section]')].filter((section) => {
          const rect = section.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        }).map((section) => section.dataset.productSection);
        const blocked = [...document.querySelectorAll('[data-scroll-reveal]')].filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight && Number(getComputedStyle(node).opacity) < 0.95;
        }).map((node) => node.textContent.trim().slice(0, 80));
        return {
          y: scrollY, height: innerHeight, end: scrollY + innerHeight >= document.documentElement.scrollHeight - 2,
          visible, blocked, overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      assert.ok(position.overflow <= 2, 'About horizontal overflow while scrolling');
      assert.deepEqual(position.blocked, [], 'Visible About content must finish revealing without a click.');
      position.visible.forEach((section) => seen.add(section));
      positions.push(position.y);
      if (position.end) break;
      await page.mouse.wheel(0, Math.max(220, Math.floor(specification.viewport.height * 0.72)));
      await page.waitForFunction((y) => scrollY > y + 1 || scrollY + innerHeight >= document.documentElement.scrollHeight - 2, position.y);
    }
    assert.deepEqual([...seen].sort(), [...ABOUT_SECTIONS].sort(), 'Native scrolling must reach every section.');
    assert.ok(positions.length > 2 && positions.at(-1) > positions[0], 'About must use natural document scrolling.');
    report.scrolls.push({ scenario: specification.id, positions, sections: [...seen] });
    for (const image of await about.locator('[data-product-screen] img').all()) {
      await image.evaluate(async (node) => { await node.decode(); });
      const state = await image.evaluate((node) => ({
        path: new URL(node.currentSrc || node.src, location.href).pathname,
        width: node.naturalWidth, height: node.naturalHeight, alt: node.alt,
      }));
      assert.ok(state.width > 0 && state.height > 0 && state.alt.trim());
      const expected = published.find((file) => file.path === 'apps/web/public' + state.path);
      assert.ok(expected, 'About must use a current screenshot from this run: ' + state.path);
      const response = await page.request.get(origin + state.path);
      assert.equal(response.status(), 200);
      assert.equal(sha256(await response.body()), expected.sha256, 'About must show the new screenshot bytes, not a cached older capture.');
    }
    await page.keyboard.press('Control+Home');
    await page.waitForFunction(() => scrollY <= 1);
    await settle(page);
    await layout(page, specification.id + ': About');
    const full = await capture(page, 'about/' + specification.id + '.png', { fullPage: true });
    if (specification.id === 'desktop-zh-CN')
      await publishImage('docs/design/verification/system-redesign/about-desktop.png', full, { kind: 'current-about-page', locale: specification.locale, viewport: specification.viewport });
    if (specification.id === 'phone-zh-CN')
      await publishImage('docs/design/verification/system-redesign/about-phone.png', full, { kind: 'current-about-page', locale: specification.locale, viewport: specification.viewport });
    await page.locator('.overview-sign-in').click();
    await page.locator('.account-page.account-auth').waitFor();
    await logo(page, specification.id + ': login');
    await layout(page, specification.id + ': login');
    await capture(page, 'account/' + specification.id + '-login.png');
    await page.goto(origin + '/');
    await page.locator('.overview-primary').first().click();
    await page.locator('.site-studio:not([hidden]) .floating-topbar').waitFor();
    assert.equal(await page.locator('.image-frame canvas').count(), 0, 'The primary About action opens the actual empty studio without inserting a marketing photo.');
    await logo(page, specification.id + ': entered studio');
    return { scenario: specification.id, nativeScrollSteps: positions.length, sections: [...seen], noDisclosureClicks: true, screenshotBytesVerified: true, directPrimaryEntry: true };
  } catch (error) {
    await failureEvidence(page);
    throw error;
  } finally { await closeCaseContext(context); }
}
async function downloadPhotos() {
  for (const source of PHOTO_SOURCES) {
    const response = await fetch(source.url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, 'Public photo download: ' + source.id);
    assert.match(response.headers.get('content-type') ?? '', /^image\/jpeg/);
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      assert.ok(length <= 8 * 1024 * 1024, 'Public photo exceeds the byte budget.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'jpeg');
    const oriented = metadata.autoOrient ?? metadata;
    assert.ok(oriented.width >= 600 && oriented.height >= 400, 'Use a real adequately sized photograph.');
    photos.set(source.id, { ...source, bytes, width: oriented.width, height: oriented.height });
    report.inputs.push({
      ...source, downloadedAt: new Date().toISOString(), bytes: bytes.length,
      sha256: sha256(bytes), width: oriented.width, height: oriented.height,
    });
    const webp = await sharp(bytes).rotate().toColourspace('srgb').webp({ quality: 92 }).toBuffer();
    await publishImage('apps/web/public/about/' + source.id + '.webp', webp, {
      kind: 'public-source-photo', source: source.id, conversion: 'EXIF orientation, sRGB and WebP only; no crop',
    });
    if (source.id === 'coast')
      await publishImage('apps/web/public/about/color-study.webp', webp, {
        kind: 'public-source-photo', source: source.id, conversion: 'same real coast photograph; no generated sample',
      });
  }
}
async function selectChoiceIndex(owner, index) {
  const trigger = owner.getByRole('combobox');
  await trigger.click();
  await owner.locator('[role="option"][data-choice-index="' + index + '"]').click();
  await until(async () => (await trigger.getAttribute('aria-expanded')) === 'false', 'choice closes after an actual selection');
}
async function checkModalTooltip(page, drawing) {
  await drawing.locator('.full-palette-trigger').click();
  const color = drawing.locator('.drawing-color-popover[aria-hidden="false"]');
  await color.waitFor();
  const swatch = color.locator('.color-swatch-rail [data-color]').first();
  await swatch.scrollIntoViewIfNeeded();
  await swatch.focus();
  // Use real keyboard navigation so the trigger receives :focus-visible.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const tip = drawing.locator('.warm-tooltip:popover-open');
  await tip.waitFor();
  await settle(page);
  const evidence = await tip.evaluate((node) => {
    const id = node.id;
    const anchor = [...document.querySelectorAll('[aria-describedby]')]
      .find((candidate) => candidate.getAttribute('aria-describedby')?.split(/\s+/).includes(id));
    if (!anchor) throw new Error('Tooltip is missing its real described trigger');
    const rect = node.getBoundingClientRect();
    const source = anchor.getBoundingClientRect();
    const view = window.visualViewport;
    const left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
    const width = view?.width ?? innerWidth, height = view?.height ?? innerHeight;
    const expectedLeft = Math.max(left + 10, Math.min(left + width - rect.width - 10,
      source.left + source.width / 2 - rect.width / 2));
    return {
      id,
      ownDialog: node.closest('dialog[open]') === anchor.closest('dialog[open]'),
      topLayer: node.matches(':popover-open'),
      fixed: getComputedStyle(node).position === 'fixed',
      viewportPositionError: Math.abs(rect.left - expectedLeft),
      insideViewport: rect.left >= left - 1 && rect.right <= left + width + 1 &&
        rect.top >= top - 1 && rect.bottom <= top + height + 1,
    };
  });
  assert.equal(evidence.ownDialog, true, 'Tooltip stays in the native modal DOM scope');
  assert.equal(evidence.topLayer, true, 'Tooltip is in the top layer, above its native modal');
  assert.equal(evidence.fixed, true);
  assert.ok(evidence.viewportPositionError < 1.5, 'Dialog transform must not offset viewport coordinates');
  assert.equal(evidence.insideViewport, true);
  await page.keyboard.press('Escape');
  await page.waitForFunction((id) => document.getElementById(id) === null, evidence.id);
  assert.equal(await drawing.evaluate((node) => node.open), true, 'First Escape dismisses help only');
  assert.equal((await swatch.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(evidence.id), false);
  await color.locator('.popover-heading button').click();
  await color.waitFor({ state: 'hidden' });
  return evidence;
}

async function sketchScreens(page, locale) {
  await page.locator('[data-action="open-sketch"]:visible').first().click();
  const drawing = page.locator('dialog.drawing-modal[open]');
  await drawing.waitFor();
  const shapes = drawing.getByRole('group', {
    name: locale === 'en' ? 'Add sketch elements' : locale === 'zh-TW' ? '草圖新增元素' : '草图添加元素',
  });
  await drawing.locator('input[type="file"]').setInputFiles({
    name: 'Lake study.jpg', mimeType: 'image/jpeg', buffer: photos.get('coast').bytes,
  });
  await until(async () => (await drawing.locator('.drawing-surface canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    for (let index=3; index<data.length; index+=4) if (data[index]) return true;
    return false;
  })), 'drawing contains the actually imported photograph');
  await shapes.getByRole('button', { name: locale === 'en' ? 'Text' : '文字', exact: true }).click();
  await drawing.locator('textarea').fill('STILL\nWATER');
  await drawing.locator('.drawing-colors > button').first().click();
  const size = drawing.locator('.drawing-width input[type="range"]');
  await size.press('End');
  const canvas = drawing.locator('.drawing-surface canvas');
  const box = await canvas.boundingBox();
  assert.ok(box?.width > 100 && box.height > 100);
  await canvas.click({ position: { x: box.width * .58, y: box.height * .32 } });
  await drawing.locator('.drawing-mode-tools > button').first().click();
  if(locale==='zh-CN') (report.modalTooltips??=[]).push({phone:false,...await checkModalTooltip(page,drawing)});
  await layout(page, locale + ': actual photograph and editable text in drawing board');
  await productCapture(page, 'layers', locale, 'coast', 'Real drawing board: photograph imported, text entered and placed with pointer; no generated interface');
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  if(locale==='zh-CN') (report.modalTooltips??=[]).push({phone:true,...await checkModalTooltip(page,drawing)});
  await drawing.locator('.drawing-mode-tools').scrollIntoViewIfNeeded();
  await layout(page, locale + ': phone drawing board');
  await productCapture(page, 'layers-phone', locale, 'coast', 'Same real drawing document rendered in the independent phone layout');
  if(locale==='zh-CN') {
    for(const [name,viewport] of [['small-phone',{width:320,height:568}],['short-landscape',{width:844,height:390}]]) {
      await page.setViewportSize(viewport);
      await drawing.locator('.drawing-mode-tools').scrollIntoViewIfNeeded();
      await layout(page,name+': actual drawing document');
      const rect=await canvas.boundingBox();
      assert.ok(rect.width>=100 && rect.height>=100,'Drawing retains usable canvas space at '+name);
      await capture(page,'interactions/drawing-'+name+'.png');
    }
  }
}

async function mobileEditingFlow() {
  const { context, page } = await newPage({
    locale: 'zh-CN', viewport: { width: 390, height: 844 }, touch: true, motion: 'reduce',
  });
  try {
    const source = await importPhoto(page, 'coast');
    await tool(page, 'crop');
    const presets = page.getByRole('group', { name: '裁切比例', exact: true });
    const dimensions = page.locator('.crop-live-readout output').first();
    const aspect = async () => (await dimensions.innerText()).match(/\d+/g).map(Number);
    for (const [name, ratio] of [['1:1',1],['4:3',4/3],['3:4',3/4],['16:9',16/9],
      ['3:2',3/2],['2:3',2/3],['电影 1.85:1',1.85],['电影 2.39:1',2.39],['9:16',9/16]]) {
      const chip = presets.getByRole('button', { name, exact: true });
      await chip.click();
      assert.equal(await chip.getAttribute('aria-pressed'), 'true');
      const [width, height] = await aspect();
      assert.ok(Math.abs(width - height * ratio) <= (1 + ratio) / 2, name);
    }
    const [width, height] = await aspect();
    await layout(page, 'phone fixed crop and orientation');
    await capture(page, 'interactions/mobile-crop-390.png');
    await presets.getByRole('button', { name: '自由', exact: true }).click();
    assert.deepEqual(await aspect(), [width, height], 'free crop unlocks the same framing');
    const first = await actualDownload(page, { width, height }, 'mobile-crop-9x16');
    await changeView(page, 'editor');
    await tool(page, 'crop');
    const actions = page.getByRole('group', { name: '画幅与方向', exact: true });
    await actions.getByRole('button', { name: '水平镜像', exact: true }).click();
    await actions.getByRole('button', { name: '向右旋转90度', exact: true }).click();
    assert.deepEqual(await aspect(), [height, width]);
    assert.equal(await actions.getByRole('button', { name: '垂直镜像', exact: true }).getAttribute('aria-pressed'), 'true');
    const turned = await actualDownload(page, { width: height, height: width }, 'mobile-crop-rotated');
    const rotatedExpected = await sharp(resolve(artifacts, 'downloads/mobile-crop-9x16.png'))
      .flop().rotate(90).ensureAlpha().raw().toBuffer();
    assert.equal(turned.pixelSha256, sha256(rotatedExpected));
    assert.notEqual(turned.pixelSha256, first.pixelSha256);
    await changeView(page, 'editor');
    await tool(page, 'crop');

    const dismiss = page.getByRole('button', { name: '关闭提示', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    let turnWrites = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/assistant-turns'))
        turnWrites++;
    });
    const viewport = await page.locator('.workspace').boundingBox();
    const ai = page.locator('[data-dock-tool="ai"]');
    await ai.click();
    const chat = page.locator('[data-panel-id="ai"][data-display-mode="page"][aria-hidden="false"]');
    const screenshot = chat.getByRole('img', { name: '编辑界面截图', exact: true });
    await screenshot.waitFor();
    const captured = await screenshot.evaluate(async (image) => {
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    assert.ok(Math.abs(captured.width / captured.height - viewport.width / viewport.height) < 0.005);
    const snapshot = Buffer.from((await screenshot.getAttribute('src')).split(',')[1], 'base64');
    const photoRegion = await sharp(snapshot).extract({
      left: Math.round(captured.width * .25), top: Math.round(captured.height * .22),
      width: Math.round(captured.width * .5), height: Math.round(captured.height * .25),
    }).toBuffer();
    assert.ok((await sharp(photoRegion).stats()).channels[0].stdev > 12,
      'the attached editor screenshot shows the actual public photograph');
    await writeFile(resolve(artifacts, 'interactions/mobile-editor-attachment.jpg'), snapshot);
    assert.equal(await page.locator('.workspace-view-transition').getAttribute('inert'), '');
    await layout(page, 'full-screen phone assistant with a real editor screenshot');
    await capture(page, 'interactions/mobile-ai-390.png');
    const sourceTrigger = chat.getByRole('button', { name: '共享画面与参考素材', exact: true });
    await sourceTrigger.press('ArrowDown');
    const sources = chat.locator('.ai-prompt-source-menu:popover-open');
    await sources.waitFor();
    assert.equal(await sourceTrigger.getAttribute('aria-expanded'), 'true');
    const sourceMenu = await sources.boundingBox();
    const promptSurface = await chat.locator('.ai-composer-surface:visible').boundingBox();
    assert.ok(sourceMenu.y + sourceMenu.height < promptSurface.y, 'the sources menu opens above the prompt bar');
    await capture(page, 'interactions/mobile-ai-sources.png');
    await page.keyboard.press('Escape');
    await sources.waitFor({ state: 'hidden' });
    await screenshot.waitFor();
    const back = chat.getByRole('button', { name: '返回编辑器', exact: true });
    await back.click();
    await actions.waitFor();
    assert.deepEqual(await aspect(), [height, width]);
    await ai.click();
    await screenshot.waitFor();
    await chat.getByRole('button', { name: '移除附件', exact: true }).click();
    await screenshot.waitFor({ state: 'hidden' });
    await back.click();
    assert.equal(turnWrites, 0, 'switching views and previewing attachments do not submit requests');

    const canvasTools = page.getByRole('button', { name: '画布工具', exact: true });
    if (await canvasTools.isVisible()) await canvasTools.click();
    await page.locator('[data-action="open-sketch"]:visible').first().click();
    const drawing = page.locator('dialog.drawing-modal[open]');
    const canvas = drawing.locator('.drawing-surface canvas');
    const triangle = drawing.getByRole('button', { name: '三角形', exact: true });
    await triangle.locator('svg').waitFor();
    await triangle.click();
    await drawing.locator('.drawing-colors > button').nth(1).click();
    const drag = async (from, to) => {
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, { steps: 6 });
      await page.mouse.up();
    };
    const ink = () => canvas.evaluate((surface) => {
      const { width, height } = surface;
      const pixels = surface.getContext('2d').getImageData(0,0,width,height).data;
      let left = width, top = height, right = 0, bottom = 0;
      for (let i = 0; i < width * height; i++) {
        const index = i * 4;
        if (pixels[index + 3] < 230 || pixels[index] < 150 || pixels[index] < pixels[index + 1] + 55) continue;
        const x = i % width, y = Math.floor(i / width);
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      return { x: left/width, y: top/height, right: right/width, bottom: bottom/height };
    });
    await drag({ x: .25, y: .27 }, { x: .48, y: .52 });
    assert.equal(await canvas.getAttribute('data-tool'), 'select');
    const initial = await ink();
    assert.ok(initial.right - initial.x > .18);
    await drag({ x: .36, y: .43 }, { x: .48, y: .51 });
    const moved = await ink();
    assert.ok(moved.x > initial.x + .09 && moved.y > initial.y + .05);
    await drag(
      { x: moved.right + .008, y: moved.bottom + .005 },
      { x: moved.right + .15, y: moved.bottom + .15 },
    );
    const resized = await ink();
    assert.ok(resized.right - resized.x > moved.right - moved.x + .08);
    await drawing.getByRole('button', { name: '撤销草图操作', exact: true }).click();
    assert.ok(Math.abs((await ink()).right - moved.right) < .02);
    await drawing.getByRole('button', { name: '重做草图操作', exact: true }).click();
    assert.ok(Math.abs((await ink()).right - resized.right) < .02);
    await drawing.getByRole('button', { name: '铅笔', exact: true }).click();
    await drawing.getByRole('slider', { name: '笔触粗细', exact: true }).press('End');
    assert.equal(await drawing.getByRole('slider', { name: '笔触粗细', exact: true }).inputValue(), '70');
    await layout(page, 'phone sketch with a moved and resized SVG-tool triangle');
    await capture(page, 'interactions/mobile-sketch-390.png');
    const sketchDimensions = await canvas.evaluate((node) => [node.width, node.height]);
    await drawing.getByRole('button', { name: '发给 AI', exact: true }).click();
    const sketch = chat.getByRole('img', { name: '草图', exact: true });
    await sketch.waitFor();
    assert.deepEqual(await sketch.evaluate(async (image) => {
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }), sketchDimensions, 'the draft image contains the whole drawing surface');
    assert.equal(turnWrites, 0);
    await capture(page, 'interactions/mobile-sketch-attachment.png');
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await sketch.waitFor();
      await layout(page, 'full-screen assistant ' + viewport.width + 'x' + viewport.height);
      const panel = await chat.boundingBox();
      const composer = await chat.locator('.ai-composer-surface:visible').boundingBox();
      assert.ok(panel.height >= viewport.height - 2 && composer.y + composer.height <= viewport.height);
      await capture(page, 'interactions/mobile-ai-' + viewport.width + '.png');
    }
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.locator('[data-panel-id="ai"][data-display-mode="panel"][aria-hidden="false"]').waitFor();
    await layout(page, 'tablet assistant in the existing editor panel');
    return { source, presets: 9, first, turned, captured, sketchDimensions, explicitSubmissions: turnWrites };
  } catch (error) {
    await failureEvidence(page);
    throw error;
  } finally {
    await closeCaseContext(context);
  }
}

async function productScreens(locale) {
  const specification = { locale, viewport: { width: 1440, height: 960 }, motion: 'no-preference' };
  const { context, page } = await newPage(specification);
  try {
    await importPhoto(page, 'coast');
    await tool(page, 'light');
    await parameter(page, 'exposure', 0.25);
    await layout(page, locale + ': workspace capture');
    await productCapture(page, 'workspace', locale, 'coast', 'Actual local exposure adjustment');
    await tool(page, 'local');
    await page.locator('[data-motion="region-controls"]:visible [data-action="create-region"][data-mask-type="radial"]').click();
    await page.locator('[data-motion="region-controls"]:visible .advanced-object-list .object-name').waitFor();
    await parameter(page, 'exposure', 0.25, '[data-motion="region-controls"]:visible');
    await layout(page, locale + ': local capture');
    await productCapture(page, 'local', locale, 'coast', 'Actual radial region created and adjusted through UI');
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await layout(page, locale + ': phone local capture');
    await productCapture(page, 'local-phone', locale, 'coast', 'Real radial selection and controls in independent phone layout');
    if(locale==='zh-CN') {
      for(const [name,viewport] of [['small-phone',{width:320,height:568}],['short-landscape',{width:844,height:390}]]) {
        await page.setViewportSize(viewport);
        await layout(page,name+': local adjustment first screen');
        const current = page.locator('[data-motion="region-controls"]:visible .parameter-shelf-current')
          .getByRole('slider', { name: '曝光', exact: true });
        const bounds=await current.boundingBox();
        const panel=await page.locator('[data-panel-id="inspector"][aria-hidden="false"]').boundingBox();
        assert.ok(bounds && panel && bounds.y+2>=panel.y && bounds.y+bounds.height<=panel.y+panel.height+1,
          'The current local slider is visible without scrolling at '+name);
        await capture(page,'interactions/local-'+name+'.png');
      }
    }
    await page.setViewportSize(specification.viewport);
    await settle(page);
    await sketchScreens(page, locale);
  } catch (error) {
    await failureEvidence(page);
    throw error;
  } finally { await closeCaseContext(context); }
  const portrait = await newPage(specification);
  try {
    await importPhoto(portrait.page, 'portrait');
    await tool(portrait.page, 'beauty');
    const usablePerson = portrait.page.locator('.portrait-controls-v3 .parameter-shelf-current .precision-value:enabled');
    const analyze = portrait.page.locator('.portrait-analysis-row > button').first();
    await until(async () => (await usablePerson.isVisible()) || (await analyze.isEnabled()), 'local person analysis is ready or its real action is enabled', 120000);
    if (!(await usablePerson.isVisible())) await analyze.click();
    await usablePerson.waitFor({ timeout: 120000 });
    assert.equal(await portrait.page.locator('.portrait-controls-v3 .inline-error:visible').count(), 0, 'Actual local person analysis must finish successfully.');
    const available = portrait.page.locator('.portrait-controls-v3 [data-control-id]:not(:disabled)').first();
    const controlId = await available.getAttribute('data-control-id');
    assert.ok(controlId);
    await available.click();
    const range = portrait.page.locator('.portrait-controls-v3 .parameter-shelf-current input[type="range"]');
    const limits = await range.evaluate(node => ({ min: Number(node.min), max: Number(node.max) }));
    const value = Math.max(limits.min, Math.min(limits.max, 12));
    await parameter(portrait.page, controlId, value, '.portrait-controls-v3');
    await layout(portrait.page, locale + ': portrait capture');
    await productCapture(portrait.page, 'portrait', locale, 'portrait', 'Actual local model inference and person-specific adjustment; no supplier call');
    await portrait.page.setViewportSize({ width: 390, height: 844 });
    await settle(portrait.page);
    await layout(portrait.page, locale + ': phone portrait capture');
    await productCapture(portrait.page, 'portrait-phone', locale, 'portrait', 'Same real locally detected person and controls in phone layout');
  } catch (error) {
    await failureEvidence(portrait.page);
    throw error;
  } finally { await closeCaseContext(portrait.context); }
  for (const [name, viewport] of [['tablet', { width: 1024, height: 768 }], ['phone', { width: 390, height: 844 }]]) {
    const device = await newPage({ ...specification, viewport, touch: true });
    try {
      await importPhoto(device.page, 'coast');
      await tool(device.page, 'light');
      await parameter(device.page, 'exposure', 0.25);
      await layout(device.page, locale + ': ' + name + ' capture');
      await productCapture(device.page, name, locale, 'coast', 'Actual responsive editor; viewport emulation, not a physical device claim');
    } catch (error) {
      await failureEvidence(device.page);
      throw error;
    } finally { await closeCaseContext(device.context); }
  }
  return { locale, screens: ['workspace','local','local-phone','layers','layers-phone','portrait','portrait-phone','tablet','phone'] };
}

async function supplementalViews(config) {
  const { transaction } = await import('@ai-xiutu/db');
  const { createRecipeV4 } = await import('@ai-xiutu/editor');
  const { hashPassword } = await import('../../apps/api/src/core.ts');
  const { createPersonalSpace } = await import('../../apps/api/src/auth.ts');
  const { createArtworkBranch } = await import('../../apps/api/src/revision-commands.ts');
  const { LocalPrivateStorage } = await import('../../apps/api/src/storage.ts');
  const actor = {
    id: randomUUID(), name: '示例创作者',
    phone: '+1555' + String(1000000 + (Number.parseInt(randomBytes(3).toString('hex'), 16) % 8000000)),
    password: randomBytes(24).toString('base64url'),
  };
  const projectId = randomUUID(), projectName = 'Lake & portrait';
  const storage = new LocalPrivateStorage(config);
  await storage.initialize();
  const stored = [];
  for (const id of ['coast', 'portrait'])
    stored.push({ id, assetId: randomUUID(), file: await storage.storeGenerated(photos.get(id).bytes) });
  await transaction(db, async (tx) => {
    await tx.query(
      'INSERT INTO users(id,phone,display_name,password_hash,phone_verified_at) VALUES($1,$2,$3,$4,clock_timestamp())',
      [actor.id, actor.phone, actor.name, await hashPassword(actor.password)],
    );
    await createPersonalSpace(tx, actor.id, actor.name);
    const space = await tx.query("SELECT id FROM spaces WHERE owner_id=$1 AND kind='personal'", [actor.id]);
    assert.equal(space.rows.length, 1);
    await tx.query('INSERT INTO projects(id,space_id,title,created_by) VALUES($1,$2,$3,$4)',
      [projectId, space.rows[0].id, projectName, actor.id]);
    for (const source of stored) {
      const file = source.file;
      await tx.query(
        'INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,provenance,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)',
        [source.assetId, projectId, source.id === 'coast' ? 'Lake study.png' : 'Portrait study.png', file.key, file.mime, file.width, file.height,
          file.bytes, file.hash, JSON.stringify({ kind: 'uploaded', declaredSource: 'upload' }), actor.id],
      );
      await createArtworkBranch(tx, {
        projectId, actorId: actor.id, assetId: source.assetId,
          title: source.id === 'coast' ? 'Lake study' : 'Portrait study',
        label: 'Public photo fixture', recipe: createRecipeV4(),
      });
    }
  });
  let sessionCookies;
  const signedIn = async (context) => {
    // The viewport cases share one verified account session. Each still loads
    // its own page and reads the real authorized routes in a fresh context.
    if (sessionCookies) {
      await context.addCookies(sessionCookies);
      return;
    }
    const response = await context.request.post(origin + '/v1/auth/login', {
      headers: { origin }, data: { phone: actor.phone, password: actor.password },
    });
    assert.equal(response.status(), 200, 'Disposable account must pass actual password verification.');
    assert.equal((await response.json()).user.id, actor.id);
    const document = await context.request.post(origin + '/v1/projects/' + projectId + '/documents', {
      headers: { origin },
      data: { title: 'Retouch notes', body: '保留山湖的自然层次。先调光影，再检查局部与导出。\n\nPreserve natural texture and colour. Review the edit before delivery.' },
    });
    assert.equal(document.status(), 201, 'Fixture document must be accepted by the actual route.');
    sessionCookies = await context.cookies(origin);
    assert.ok(sessionCookies.length, 'Password verification must establish a browser session.');
  };
  reviewFixture = { actorId: actor.id, projectId, projectName, signedIn };
  const { context, page } = await newPage({
    locale: 'zh-CN', viewport: { width: 1440, height: 960 }, motion: 'no-preference',
  }, '/#/studio', signedIn);
  try {
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    const [projectResponse] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === '/v1/projects/' + projectId && response.request().method() === 'GET'),
      page.getByRole('navigation', { name: '项目', exact: true })
        .getByRole('button', { name: projectName, exact: true }).click(),
    ]);
    assert.equal(projectResponse.status(), 200, 'The UI must load the selected project through its real permissions.');
    const selectedProject = await projectResponse.json();
    assert.equal(selectedProject.project.id, projectId);
    assert.deepEqual(selectedProject.assets.map((asset) => asset.id).sort(), stored.map((source) => source.assetId).sort());
    assert.deepEqual(selectedProject.artworks.map((work) => work.title).sort(), ['Lake study', 'Portrait study']);
    await changeView(page, 'works');
    const library = page.locator('.asset-library:visible');
    await library.getByRole('heading', { name: projectName, exact: true }).waitFor();
    await library.locator('.library-asset').first().waitFor();
    assert.equal(await library.locator('.library-asset').count(), 2);
    const savedWorks = library.locator('.library-version-links > button');
    assert.deepEqual((await savedWorks.locator('span').allTextContents()).sort(), ['Lake study', 'Portrait study']);
    await layout(page, 'isolated project gallery');
    await verificationCapture(page, 'views/works.png', 'works', 'Actual isolated project library with two real public photographs and their saved versions');
    const restoration = { state: 'unavailable', quoteVerified: false, createdDerivedAssets: 0 };
    const derivePath = '/v1/projects/' + projectId + '/derived-assets';
    let quoteResponse;
    const onRestorationResponse = (response) => {
      if (new URL(response.url()).pathname === derivePath + '/quote' && response.request().method() === 'POST')
        quoteResponse = response;
    };
    const onRestorationRequest = (request) => {
      if (new URL(request.url()).pathname === derivePath && request.method() === 'POST')
        restoration.createdDerivedAssets++;
    };
    page.on('response', onRestorationResponse);
    page.on('request', onRestorationRequest);
    try {
      await library.locator('.library-restoration-action').first().click();
      const repair = page.locator('dialog.restoration-dialog[open]');
      await repair.waitFor();
      const state = await until(async () => {
        if (quoteResponse) return 'quoted';
        if (await repair.getByText('当前服务未开放照片修复。', { exact: true }).isVisible()) return 'unavailable';
        return null;
      }, 'restoration capability or its actual read-only source quote');
      if (state === 'quoted') {
        assert.equal(quoteResponse.status(), 200, 'The repair estimate must reach the real quote route.');
        const quote = await quoteResponse.json();
        assert.equal(quote.reservesQuota, false);
        assert.equal(quote.checksDecodedPixels, false);
        assert.equal(quote.sources.length, 1);
        assert.ok(stored.some((source) => source.assetId === quote.sources[0].assetId));
        assert.equal(quote.available, true, 'Default repair settings must fit the advertised budget for this public fixture.');
        await repair.locator('.restoration-status').getByText(/预算检查通过/).waitFor();
        restoration.state = 'read-only-quote-confirmed';
        restoration.quoteVerified = true;
      } else {
        console.log('RESTORATION unavailable: the actual service does not advertise photo repair; no quote or mutation is claimed.');
      }
      await layout(page, 'restoration denoise dialog');
      await verificationCapture(page, 'views/restoration-denoise.png', 'restoration-denoise', restoration.state + ': actual denoise controls; no derived asset created');
      const advanced = repair.locator('details.restoration-extra');
      const quoteUrl = origin + derivePath + '/quote';
      let releaseQuote;
      const quoteGate = {
        url: quoteUrl, held: false,
        wait: new Promise((resolveGate) => { releaseQuote = resolveGate; }),
      };
      assert.equal(quoteTransportGates.has(context), false, 'A browser context can hold only this one quote gate.');
      quoteResponse = undefined;
      quoteTransportGates.set(context, quoteGate);
      try {
        await repair.getByRole('button', { name: '运动模糊', exact: true }).click();
        await repair.locator('input[type="number"][aria-label="运动长度"]').waitFor();
        if (restoration.quoteVerified) {
          await until(() => quoteGate.held, 'the next real motion quote waits at the transport gate');
          assert.equal(await repair.locator('.restoration-actions > button.button-primary').isDisabled(), true,
            'Creating a copy stays disabled while its actual quote is pending.');
          assert.equal(await advanced.evaluate((node) => node.open), false, 'Optional restoration parameters start collapsed.');
          const close = repair.locator('.modal-header').getByRole('button', { name: '关闭窗口', exact: true });
          const summary = advanced.locator(':scope > summary');
          await close.focus();
          await page.keyboard.press('Shift+Tab');
          assert.equal(await summary.evaluate((node) => node === document.activeElement), true,
            'Reverse Tab skips closed advanced inputs and reaches the visible summary.');
          await page.keyboard.press('Tab');
          assert.equal(await close.evaluate((node) => node === document.activeElement), true,
            'Tab wraps from the last visible summary to the dialog close button.');
          restoration.pendingKeyboardCycle = 'transport-delayed real quote: close → summary → close';
        } else {
          restoration.pendingKeyboardCycle = 'unavailable: no supported quote request to delay';
        }
      } finally {
        releaseQuote();
        if (quoteTransportGates.get(context) === quoteGate) quoteTransportGates.delete(context);
      }
      if (restoration.quoteVerified) {
        await until(() => quoteResponse, 'the released motion quote reaches the real backend');
        assert.equal(quoteResponse.status(), 200);
        const motionQuote = await quoteResponse.json();
        assert.equal(motionQuote.reservesQuota, false);
        assert.equal(motionQuote.checksDecodedPixels, false);
        assert.equal(motionQuote.sources.length, 1);
        assert.ok(stored.some((source) => source.assetId === motionQuote.sources[0].assetId));
        assert.equal(typeof motionQuote.available, 'boolean');
        if (motionQuote.available)
          await repair.locator('.restoration-status').getByText(/预算检查通过/).waitFor();
        else await repair.locator('.restoration-status .restoration-limit').waitFor();
        restoration.motionQuoteAvailable = motionQuote.available;
      }
      assert.equal(await advanced.evaluate((node) => node.open), false, 'Optional restoration parameters remain collapsed after keyboard navigation.');
      await layout(page, 'restoration motion dialog');
      await verificationCapture(page, 'views/restoration-motion.png', 'restoration-motion', restoration.state + ': actual motion controls with advanced disclosure closed; no derived asset created');
      await advanced.locator(':scope > summary').click();
      await repair.locator('details.restoration-extra[open]').waitFor();
      await advanced.scrollIntoViewIfNeeded();
      const advancedLayout = await layout(page, 'restoration advanced parameter hit targets',
        'dialog.restoration-dialog[open] details.restoration-extra[open]');
      assert.equal(advancedLayout.sampledControls, 2, 'Both the iteration input and denoise checkbox must be visible, enabled and checked for overlap.');
      await layout(page, 'restoration expanded motion dialog');
      await verificationCapture(page, 'views/restoration-motion-advanced.png', 'restoration-motion-advanced', restoration.state + ': actual expanded iteration and denoise controls verified by hit testing; no derived asset created');
      restoration.advancedControlsChecked = advancedLayout.sampledControls;
      await page.keyboard.press('Escape');
      await repair.waitFor({ state: 'hidden' });
      assert.equal(restoration.createdDerivedAssets, 0, 'Inspecting repair settings and quotes must never create an output.');
    } finally {
      page.off('response', onRestorationResponse);
      page.off('request', onRestorationRequest);
    }
    await changeView(page, 'docs');
    await page.locator('.document-row').filter({ hasText: 'Retouch notes' }).click();
    await page.locator('.document-editor').waitFor();
    await layout(page, 'isolated project document');
    await verificationCapture(page, 'views/documents.png', 'documents', 'Actual isolated project document created through the HTTP API');
    await changeView(page, 'collaborate');
    const collaboration = page.locator('.collaboration-view:not(.collaboration-panel):visible');
    await collaboration.locator('.comment-composer textarea').fill('保留山湖与天空的自然层次。局部调整后，再核对导出效果。');
    const [commentReceipt] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/v1/projects/' + projectId + '/comments' && response.request().method() === 'POST'),
      collaboration.locator('.comment-composer button[type="submit"]').click(),
    ]);
    assert.equal(commentReceipt.status(), 201);
    await collaboration.locator('.comment').waitFor();
    const taskEvidence = [];
    for (const [title, steps] of [['检查光影与色彩',2], ['核对局部选区',1], ['导出完成的作品',0]]) {
      await collaboration.locator('.task-add input').fill(title);
      const [created] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/v1/projects/' + projectId + '/tasks' && response.request().method() === 'POST'),
        collaboration.locator('.task-add button').click(),
      ]);
      assert.equal(created.status(), 201);
      const row = collaboration.locator('.task-item').filter({ hasText: title });
      await row.waitFor();
      for (let step=0; step<steps; step++) {
        const [saved] = await Promise.all([
          page.waitForResponse(response => /^\/v1\/tasks\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'PATCH'),
          row.locator('button').click(),
        ]);
        assert.equal(saved.status(), 200);
        assert.equal(saved.request().postDataJSON().expectedVersion, step+1, 'Task transitions submit the real prior version');
        await until(() => row.evaluate((node,state)=>node.classList.contains(state), step===0?'doing':'done'), 'Task state follows the actual accepted CAS update');
      }
      taskEvidence.push({ title, state:['todo','doing','done'][steps], actualAcceptedTransitions:steps });
    }
    await collaboration.locator('.view-heading').scrollIntoViewIfNeeded();
    await layout(page, 'isolated project collaboration after actual writes');
    await verificationCapture(page, 'views/collaborate.png', 'collaborate', 'Actual isolated comment and three tasks created through UI; todo/doing/done follow accepted API versioned transitions');
    await changeView(page, 'usage');
    await settle(page);
    await layout(page, 'isolated account usage');
    await verificationCapture(page, 'views/usage.png', 'usage', 'Actual isolated account usage; no paid supplier activity');
    await changeView(page, 'editor');
    await importPhoto(page, 'coast');
    await tool(page, 'ai');
    await page.locator('.free-panel[data-panel-id="ai"][aria-hidden="false"]').waitFor();
    const assistant = page.locator('.free-panel[data-panel-id="ai"][aria-hidden="false"] .live-assistant:visible');
    await page.waitForFunction(() =>
      document.querySelector('.free-panel[data-panel-id="ai"][aria-hidden="false"] .live-assistant')?.getAttribute('data-availability') === 'unavailable');
    const availability = assistant.locator('[data-assistant-availability]');
    await availability.waitFor();
    assert.equal(await availability.count(), 1, 'Unavailable assistant has one status, not repeated notices.');
    assert.ok((await availability.innerText()).trim());
    assert.equal(await assistant.locator('.ai-submit-request').isDisabled(), true);
    await layout(page, 'AI unavailable state without supplier');
    await verificationCapture(page, 'views/assistant-disabled.png', 'assistant-unavailable', 'Actual assistant unavailable state; no external AI request');
    await page.locator('.studio-account').click();
    await page.locator('[data-testid="account-center"]').waitFor();
    await logo(page, 'isolated account center');
    await layout(page, 'account center');
    await verificationCapture(page, 'account/center.png', 'account', 'Actual disposable account center; no production account data');
    return {
      environment: 'One disposable account and real local project with two public photos and one API-created document.',
      views: ['works', 'restoration-read-only', 'documents', 'collaborate', 'usage', 'assistant-unavailable', 'account'],
      restoration,
      assistant: { state: 'unavailable', statusCount: 1, submitDisabled: true },
      taskEvidence,
      liveCloudServiceAcceptance: false, multiPersonSessionAcceptance: false,
    };
  } catch (error) {
    await failureEvidence(page);
    throw error;
  } finally { await closeCaseContext(context); }
}
async function openFixtureProject(page) {
  assert.ok(reviewFixture, 'Disposable project setup must precede product account captures');
  await page.locator('.workspace-identity button').first().click();
  const sidebar = page.locator('dialog.sidebar-navigation-modal[open]');
  await sidebar.waitFor();
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/v1/projects/' + reviewFixture.projectId && response.request().method() === 'GET'),
    sidebar.locator('.project-list').getByRole('button', { name: reviewFixture.projectName, exact: true }).click(),
  ]);
  assert.equal(response.status(), 200);
  await sidebar.waitFor({ state: 'hidden' });
}
async function businessScreens(locale) {
  assert.ok(reviewFixture);
  for (const phone of [false, true]) {
    const { context, page } = await newPage({
      locale, viewport: phone ? { width:390,height:844 } : { width:1440,height:960 }, touch:phone,
    }, '/#/studio', reviewFixture.signedIn);
    const suffix = phone ? '-phone' : '';
    try {
      await openFixtureProject(page);
      await changeView(page, 'works');
      await page.locator('.asset-library:visible .library-asset').first().waitFor();
      await page.locator('.asset-library:visible img').evaluateAll(async nodes => { await Promise.all(nodes.map(node => node.decode())); });
      await layout(page, locale + suffix + ': real project library');
      await productCapture(page,'library'+suffix,locale,['coast','portrait'],'Actual private project assets and saved versions from disposable API-backed fixture');
      if(phone && locale==='zh-CN') {
        const firstAsset=page.locator('.asset-library:visible .library-asset').first();
        const regular=await firstAsset.boundingBox();
        await page.setViewportSize({width:320,height:568});
        await layout(page,'small phone: real library filters and assets');
        const narrow=await firstAsset.boundingBox();
        (report.libraryGeometry??=[]).push({regularPhone:regular,narrowPhone:narrow});
        await capture(page,'interactions/library-small-phone.png');
        await page.setViewportSize({width:390,height:844});await settle(page);
      }
      await changeView(page,'collaborate');
      const collaboration=page.locator('.collaboration-view:not(.collaboration-panel):visible');
      await collaboration.locator('.task-item').first().waitFor();
      assert.equal(await collaboration.locator('.task-item').count(),3);
      assert.equal(await collaboration.locator('.task-item.done').count(),1);
      assert.equal(await collaboration.locator('.task-item.doing').count(),1);
      await collaboration.locator('.view-heading').scrollIntoViewIfNeeded();
      await layout(page,locale+suffix+': real project discussion and three task states');
      await productCapture(page,'collaboration'+suffix,locale,null,'Actual local API discussion and tasks; no claim of a live multiplayer session');
      await changeView(page,'editor');
      await importPhoto(page,'coast');
      await tool(page,'ai');
      const assistant=page.locator('.free-panel[data-panel-id="ai"][aria-hidden="false"] .live-assistant:visible');
      await until(async()=>await assistant.getAttribute('data-availability')==='unavailable','honest AI service availability');
      const input=assistant.locator('.ai-composer-input');
      const draftEditable=await input.isEditable();
      if (draftEditable) await input.fill(locale==='en'
        ? 'Keep the lake natural. Lift the shadows slightly and preserve the sky.'
        : locale==='zh-TW'?'保留山湖的自然層次，稍微提亮暗部，天空保持不變。':'保留山湖的自然层次，稍微提亮暗部，天空保持不变。');
      assert.equal(await assistant.locator('.ai-submit-request').isDisabled(),true);
      await layout(page,locale+suffix+': actual assistant composer and unconfigured service state');
      await productCapture(page,'assistant'+suffix,locale,'coast',
        'Actual assistant input'+(draftEditable?' with an unsent draft':'')+'; service unavailable and submit disabled; no fabricated AI result');
      await changeView(page,'deliver');
      await page.locator('.delivery-primary-action > button').click();
      const dialog=page.locator('dialog.export-dialog[open]');
      await dialog.waitFor();
      await layout(page,locale+suffix+': actual export dialog');
      await productCapture(page,'delivery'+suffix,locale,'coast','Actual export settings before download; independent full-size PNG downloads are verified in the seven core flows');
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'hidden'});
    } catch(error) {
      await failureEvidence(page);
      throw error;
    } finally { await closeCaseContext(context); }
  }
  return { locale, screens:['library','collaboration','assistant','delivery'], independentPhoneCaptures:true };
}

async function publicThemeReview() {
  const evidence=[];
  for(const specification of [
    {name:'desktop',locale:'en',viewport:{width:1440,height:960},theme:'dark',colorScheme:'light',motion:'reduce'},
    {name:'phone',locale:'en',viewport:{width:390,height:844},theme:'system',colorScheme:'dark',motion:'reduce',touch:true},
  ]) {
    const {context,page}=await newPage(specification,'/');
    try {
      const themed=async expected=>until(async()=>await page.locator('html').getAttribute('data-theme')===expected,
        specification.name+' document theme '+expected);
      await page.locator('.product-overview-root').waitFor();
      assert.equal(await page.locator('.studio-workspace').count(),0,'Fresh About does not mount the studio to initialize appearance');
      await themed('dark');
      await until(async()=>await page.locator('.overview-hero-media img').evaluate(node=>node.complete && node.naturalWidth>0),'Actual hero image loaded');
      await logo(page,specification.name+': direct dark About');
      await layout(page,specification.name+': direct dark About');
      await capture(page,'brand/about-dark-'+specification.name+'.png');
      if(specification.theme==='system') {
        await page.emulateMedia({colorScheme:'light'});await themed('light');
        await page.emulateMedia({colorScheme:'dark'});await themed('dark');
      }
      await page.locator(specification.touch ? '.overview-hero .overview-primary' : '.overview-start').click();
      await page.locator('.floating-topbar').waitFor();
      await themed('dark');
      await page.locator('.workspace-settings-trigger').click();
      const settings=page.locator('dialog.workspace-settings-dialog[open]');
      await settings.waitFor();
      await settings.locator('[data-theme-choice="light"]').click();
      await themed('light');
      await until(async()=>await page.evaluate(()=>localStorage.getItem('image-workspace:theme'))==='light','Actual appearance choice persists');
      await layout(page,specification.name+': actual appearance settings');
      await capture(page,'brand/theme-settings-'+specification.name+'.png');
      await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
      await page.locator('.workspace-home-link').click();
      await page.locator('.product-overview-root').waitFor();await themed('light');
      await page.reload();
      await page.locator('.product-overview-root').waitFor();await themed('light');
      assert.equal(await page.locator('.studio-workspace').count(),0);
      assert.equal(await page.evaluate(()=>localStorage.getItem('image-workspace:theme')),'light');
      await layout(page,specification.name+': chosen public appearance survives refresh');
      evidence.push({viewport:specification.viewport,initialPreference:specification.theme,
        systemChanges:specification.theme==='system',actualSettingsChoice:'light',returnAndRefresh:true});
    } catch(error) {await failureEvidence(page);throw error;}
    finally {await closeCaseContext(context);}
  }
  return {evidence};
}

async function accountAndOperationsReview(section, requestedPhone) {
  assert.ok(reviewFixture);
  const accountEvidence=[];
  if(section==='account') {
  for (const phone of [requestedPhone]) {
    const {context,page}=await newPage({
      locale:'zh-CN',viewport:phone?{width:390,height:844}:{width:1440,height:960},touch:phone,
    },'/#/studio',reviewFixture.signedIn);
    try {
      if(phone) {
        await page.locator('.workspace-identity button').first().click();
        const navigation=page.locator('dialog.sidebar-navigation-modal[open]');
        await navigation.locator('.sidebar-account-details').click();
        await navigation.waitFor({state:'hidden'});
      } else await page.locator('.studio-account').click();
      const account=page.locator('[data-testid="account-center"]');
      await account.waitFor();
      for (const id of ['overview','security','billing','data']) {
        const tab=account.locator('[data-testid="account-tab-'+id+'"]');
        await tab.click();
        await until(async()=>await tab.getAttribute('aria-selected')==='true','account section selected');
        if (id==='billing') {
          const entitlements=account.locator('.account-entitlements');
          await until(async()=>await entitlements.getAttribute('aria-busy')==='false','account entitlement read settles');
          await account.locator('[data-testid="account-available-units"]').waitFor();
        }
        await layout(page,(phone?'phone':'desktop')+': account '+id);
        await capture(page,'account/'+(phone?'phone':'desktop')+'-'+id+'.png');
        accountEvidence.push({phone,section:id});
      }
      const tabs=account.getByRole('tablist');
      // Start from a real selected tab. Focusing an inactive tab in script does
      // not select it and is not the state produced by the roving tab stop.
      await tabs.getByRole('tab').first().click();
      await until(async()=>await tabs.getByRole('tab').first().getAttribute('aria-selected')==='true','account first tab is actually selected');
      const orientation=await tabs.getAttribute('aria-orientation');
      assert.equal(orientation,phone?'horizontal':'vertical');
      await page.keyboard.press(orientation==='horizontal'?'ArrowRight':'ArrowDown');
      await until(async()=>await tabs.getByRole('tab').nth(1).evaluate(node=>node===document.activeElement && node.getAttribute('aria-selected')==='true'),'Account roving focus and selection follow its actual orientation');
    } catch(error) {await failureEvidence(page);throw error;}
    finally {await closeCaseContext(context);}
  }
  return {accountEvidence,productionAccount:false,billingMutations:false};
  }
  // Explicit fixture setup in the disposable in-memory database, never a production grant.
  await db.query('INSERT INTO operator_users(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING',[reviewFixture.actorId]);
  const operationsEvidence=[];
  const tabs=['overview','users','config','plans','models','assistant','quota','usage','reconciliation','audit'];
  for (const phone of [requestedPhone]) {
    const {context,page}=await newPage({
      locale:'zh-CN',viewport:phone?{width:390,height:844}:{width:1440,height:960},touch:phone,
    },'/#/studio',reviewFixture.signedIn);
    try {
      await page.locator('.workspace-identity button').first().click();
      await page.locator('dialog.sidebar-navigation-modal[open]').getByRole('button',{name:'运营管理',exact:true}).click();
      await page.locator('[data-ops-tab]').waitFor();
      for (const id of tabs) {
        await page.locator('[data-ops-nav="'+id+'"]').click();
        const main=page.locator('[data-ops-tab="'+id+'"]');
        await until(async()=>await main.getAttribute('data-read-state')==='ready','operations '+id+' actual initial read');
        await until(async()=>await main.locator('.feature-skeleton:visible').count()===0,'operations '+id+' visible read placeholders settle');
        for (const attribute of ['data-read-state','data-catalog-state','data-record-state']) {
          const states=main.locator('['+attribute+']');
          for (const state of await states.all())
            await until(async()=>await state.getAttribute(attribute)==='ready','operations '+id+' independent '+attribute+' real read');
        }
        if (id==='usage') {
          await main.locator('.usage-skeleton-dashboard').waitFor({state:'hidden'});
          await main.locator('.usage-overview').waitFor();
        }
        assert.equal(await main.locator('[role="alert"]:visible').count(),0,'operations '+id+' has no unresolved read error');
        await layout(page,(phone?'phone':'desktop')+': operations '+id);
        await capture(page,'operations/'+(phone?'phone':'desktop')+'-'+id+'.png');
        assert.equal(await page.locator('[data-ops-nav][aria-current="page"]').count(),1);
        operationsEvidence.push({phone,tab:id,readsOnly:true});
      }
    } catch(error) {await failureEvidence(page);throw error;}
    finally {await closeCaseContext(context);}
  }
  return {accountEvidence,operationsEvidence,productionAccount:false,billingMutations:false};
}
try {
  await downloadPhotos();
  memoryDb = await PGlite.create('memory://');
  socket = new PGLiteSocketServer({ db: memoryDb, port: 0, host: '127.0.0.1', maxConnections: 4 });
  await socket.start();
  const databaseUrl = 'postgresql://postgres@' + socket.getServerConn() + '/postgres';
  const { createDatabase } = await import('@ai-xiutu/db');
  const { buildApp } = await import('../../apps/api/src/app.ts');
  const { loadConfig } = await import('../../apps/api/src/config.ts');
  const { preview: startPreview } = await import('vite');
  db = createDatabase(databaseUrl);
  const config = loadConfig({
    DATABASE_URL: databaseUrl, SESSION_SECRET: randomBytes(48).toString('hex'),
    APP_ORIGIN: origin, STORAGE_DIR: privateDirectory, COOKIE_SECURE: 'false', NODE_ENV: 'test',
  });
  app = await buildApp({
    db, config,
    sms: { configured: false, async send() { throw new Error('This review never sends SMS.'); } },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const apiPort = app.server.address().port;
  process.env.PORT = String(apiPort);
  preview = await startPreview({
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    preview: {
      host: '127.0.0.1', port, strictPort: true,
      proxy: { '/v1': { target: 'http://127.0.0.1:' + apiPort, ws: true } },
    },
  });
  const publicResponse = await fetch(origin + '/v1/public-config');
  assert.equal(publicResponse.status, 200);
  const publicConfig = await publicResponse.json();
  assert.equal(publicConfig.capabilities.aiConfigured, false);
  assert.equal(publicConfig.capabilities.smsConfigured, false);
  assert.equal(publicConfig.capabilities.paymentConfigured, false);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
  });
  report.browser = { name: 'Chromium', version: browser.version(), channel: process.env.BROWSER_CHANNEL ?? 'bundled' };
  for (const scenario of SCENARIOS)
    await check('flow:' + scenario.id, () => coreFlow(scenario));
  await check('reference-controls:actual-scrub-and-panel-restore', referenceControlReview);
  await check('mobile:crop-sketch-and-assistant-attachment', mobileEditingFlow);
  for (const locale of LOCALES)
    await check('captures:' + locale, () => productScreens(locale));
  await check('supplemental:isolated-account-and-views', () => supplementalViews(config));
  for (const locale of LOCALES)
    await check('business-captures:' + locale, () => businessScreens(locale));
  for (const scenario of SCENARIOS)
    await check('about:' + scenario.id, () => inspectAbout(scenario));
  await check('theme:direct-public-entry-and-persisted-choice',publicThemeReview);
  for (const phone of [false,true])
    await check('account:'+(phone?'phone':'desktop')+'-four-sections',()=>accountAndOperationsReview('account',phone));
  for (const phone of [false,true])
    await check('operations:'+(phone?'phone':'desktop')+'-ten-tabs',()=>accountAndOperationsReview('operations',phone));
  await check('brand:dark-studio-and-favicon', async () => {
    const { context, page } = await newPage({
      locale: 'en', viewport: { width: 1440, height: 960 }, theme: 'dark', motion: 'reduce',
    });
    try {
      await logo(page, 'dark studio');
      await importPhoto(page,'coast');
      await tool(page,'light');
      await parameter(page,'exposure',0.25);
      const favicon = await page.locator('link[rel~="icon"]').getAttribute('href');
      assert.ok(favicon);
      const response = await page.request.get(new URL(favicon, origin).href);
      const mark = await page.request.get(origin + canonicalLogo);
      assert.equal(response.status(), 200);
      assert.equal(mark.status(), 200);
      const [faviconBytes, logoBytes] = await Promise.all([response.body(), mark.body()]);
      assert.equal(faviconBytes.toString('utf8').trim(), logoBytes.toString('utf8').trim(), 'Favicon and product mark use the same original asset.');
      await layout(page, 'dark studio');
      await capture(page, 'brand/dark-studio.png');
      await page.setViewportSize({width:390,height:844});
      await logo(page,'dark phone studio');
      await layout(page,'dark phone studio');
      await capture(page,'brand/dark-phone.png');
      return { source: canonicalLogo, favicon, sha256: sha256(logoBytes),
        viewports:[{width:1440,height:960},{width:390,height:844}],actualPhotoEdited:true };
    } catch (error) {
    await failureEvidence(page);
    throw error;
  } finally { await closeCaseContext(context); }
  });
  await check('capture-completeness-and-runtime-errors', async () => {
    assert.deepEqual([...published.map((file) => file.path)].sort(), [...PUBLISH_IMAGE_PATHS].sort());
    assert.deepEqual(report.pageErrors, [], 'No unhandled browser runtime errors.');
    assert.deepEqual(report.routingErrors, [], 'No browser request routing errors.');
    assert.deepEqual(report.unexpectedOrigins, [], 'No unknown external request attempts are permitted.');
    for (const locale of Object.keys(cjkFontFamilies))
      assert.ok(report.cjkFontEvidence.some((entry) => entry.locale === locale), 'Missing rendered CJK font evidence: ' + locale);
    return { publishedImageCount: published.length, blockedSdkTelemetryCount: report.blockedSdkTelemetryAttempts.length };
  });
  report.state = report.cases.some((entry) => entry.state !== 'passed') || report.routingErrors.length || report.cleanupErrors?.length ? 'failed' : 'passed';
} catch (error) {
  report.state = 'failed';
  report.failure = { case: activeCase, message: String(error?.stack ?? error).slice(0, 6000) };
  console.error('Review bootstrap failed: ' + String(error.message).slice(0, 1500));
} finally {
  for (const [name, close] of [
    ['browser', () => browser?.close()],
    ['preview', () => preview ? new Promise((done, reject) => preview.httpServer.close((error) => error ? reject(error) : done())) : undefined],
    ['API', () => app?.close()], ['DB pool', () => db?.end()],
    ['DB socket', () => socket?.stop()], ['memory DB', () => memoryDb?.close()],
    ['private storage', () => rm(privateDirectory, { recursive: true, force: true })],
  ]) {
    try { await close(); }
    catch (error) {
      report.state = 'failed';
      (report.cleanupErrors ??= []).push({ resource: name, message: String(error.message).slice(0, 500) });
    }
  }
  if (report.routingErrors.length) report.state = 'failed';
  report.finishedAt = new Date().toISOString();
  report.sdkTelemetrySummary = {
    sdk: sdkName, sdkVersion, endpoint: sdkTelemetryEndpoint, method: 'POST', blocked: true,
    count: report.blockedSdkTelemetryAttempts.length,
    enforcement: 'isolated-vite-context-route-abort', productionHeadersVerified: false,
  };
  console.log('SDK TELEMETRY BLOCKED ' + JSON.stringify(report.sdkTelemetrySummary));
  const manifest = {
    schemaVersion: 1, state: report.state, testedCommit, repository: REPOSITORY,
    capturedAt: report.finishedAt, browser: report.browser ?? null, manualVisualReview: false,
    inputs: report.inputs,
    scenarios: SCENARIOS.map((scenario) => ({
      ...scenario, state: report.cases.find((entry) => entry.name === 'flow:' + scenario.id)?.state ?? 'not-run',
    })),
    files: published, limits: report.limits,
    cjkFontEvidence: report.cjkFontEvidence,
    blockedSdkTelemetryAttempts: report.blockedSdkTelemetryAttempts,
    sdkTelemetrySummary: report.sdkTelemetrySummary,
  };
  await mkdir(dirname(resolve(publishRoot, MANIFEST_PATH)), { recursive: true });
  await writeFile(resolve(publishRoot, MANIFEST_PATH), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Frontend review ' + report.state + ': ' + report.cases.filter((entry) => entry.state === 'passed').length + '/' + report.cases.length + ' cases passed.');
  if (report.state !== 'passed') process.exitCode = 1;
}
