/**
 * Five distinct frontend risk scenarios, then current-UI product captures.
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
  cases: [], layouts: [], logos: [], scrolls: [], screenshots: [], inputs: [],
  pageErrors: [], unexpectedOrigins: [], requests: {}, manualVisualReview: false,
  limits: [
    'Five different locale/viewport/motion scenarios exercise import, numeric editing, undo, redo, original comparison and a decoded download.',
    'This does not certify all 111 matrix items, native HDR precision, a physical device, a live AI provider or a real multiplayer session.',
    'Account/project images, if present, use explicit disposable CI fixtures and actual local API permissions.',
    'Photo capture is a browser screenshot followed only by WebP encoding. No generated interface or retouched screenshot is used.',
    'Publication is a separate exact-head, explicit-path job and cannot occur after any required verification step fails.',
  ],
};
const published = [];
const photos = new Map();
const caseContexts = new Set();
const failures = new Map();
let memoryDb, socket, db, app, preview, browser, activePage;
let activeCase = 'bootstrap';
let canonicalLogo;
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
    .replace(/界面验收/g, '[fixture user]').slice(0, limit);
  try {
    evidence.dom = await page.evaluate(() => {
      const visible = (node) => {
        if (!(node instanceof Element) || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
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
          owner.closest('input,textarea,select,[role="textbox"],script,style,[data-sensitive],[class*="account"],[class*="profile"],[data-testid="account-center"]')) continue;
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
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    };
    const finite = document.getAnimations().filter((animation) =>
      visible(animation.effect?.target) &&
      Number.isFinite(animation.effect?.getComputedTiming().iterations) &&
      animation.effect?.getComputedTiming().endTime < 3000 &&
      animation.playState === 'running');
    await Promise.allSettled(finite.map((animation) => animation.finished));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}
async function newPage(specification, route = '/#/studio', signedIn = false) {
  const context = await browser.newContext({
    viewport: specification.viewport, hasTouch: specification.touch ?? false,
    reducedMotion: specification.motion ?? 'no-preference', locale: specification.locale,
    acceptDownloads: true, serviceWorkers: 'block',
  });
  caseContexts.add(context);
  context.setDefaultTimeout(25000);
  context.setDefaultNavigationTimeout(30000);
  await context.addInitScript(({ locale, theme }) => {
    localStorage.setItem('yingjian.locale.v1', locale);
    localStorage.setItem('image-workspace:theme', theme);
  }, { locale: specification.locale, theme: specification.theme ?? 'light' });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {
      report.unexpectedOrigins.push({ case: activeCase, origin: url.origin, path: url.pathname });
      await route.abort('blockedbyclient');
    } else await route.continue();
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
async function capture(page, name, options = {}) {
  await settle(page);
  const path = resolve(artifacts, name);
  await mkdir(dirname(path), { recursive: true });
  const bytes = await page.screenshot({
    path, fullPage: options.fullPage ?? false,
    mask: [page.locator('input[type="password"]:visible')],
  });
  report.screenshots.push({
    file: name, bytes: bytes.length, sha256: sha256(bytes),
    viewport: page.viewportSize(), state: 'captured', case: activeCase,
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
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && Number(style.opacity) > 0.01;
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
    name: id + '-pexels-' + source.pexelsId + '.jpg', mimeType: 'image/jpeg', buffer: source.bytes,
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
  assert.ok(viewIds.includes(id));
  const compact = page.locator('.mobile-view-trigger');
  if (await compact.isVisible()) {
    await compact.click();
    const dialog = page.locator('dialog.workspace-navigation-dialog');
    await dialog.locator('[data-view="' + id + '"]').click();
    await dialog.waitFor({ state: 'hidden' });
  } else await page.locator('.compact-view-tabs > button').nth(viewIds.indexOf(id)).click();
  await settle(page);
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
  await capture(page, 'flows/' + label + '-export-dialog.png');
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
    await importPhoto(page, 'coast');
    await tool(page, 'light');
    const original = await canvasPixels(page);
    await parameter(page, 'exposure', 0.35);
    const edited = await until(async () => {
      const frame = await canvasPixels(page);
      return frame.pixelSha256 !== original.pixelSha256 ? frame : null;
    }, 'exposure changes actual displayed pixels');
    await layout(page, specification.id + ': parameters');
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
    await page.locator('[data-motion="region-controls"]:visible > .tonal-tabs > button').first().click();
    await page.locator('[data-motion="region-controls"]:visible .advanced-object-list .object-name').waitFor();
    await parameter(page, 'exposure', 0.25, '[data-motion="region-controls"]:visible');
    await layout(page, locale + ': local capture');
    await productCapture(page, 'local', locale, 'coast', 'Actual radial region created and adjusted through UI');
    await tool(page, 'composite');
    await page.locator('[data-motion="composite-controls"]:visible input[type="file"]').setInputFiles({
      name: 'portrait-pexels-3791554.jpg', mimeType: 'image/jpeg', buffer: photos.get('portrait').bytes,
    });
    await page.locator('[data-motion="composite-controls"]:visible .object-name').waitFor();
    const coast = photos.get('coast'), portrait = photos.get('portrait');
    const ratio = (coast.width / coast.height) * (portrait.height / portrait.width);
    const layerWidth = Math.round(Math.min(0.28, 0.6 / ratio) * 10000) / 10000;
    const layerHeight = Math.round(layerWidth * ratio * 10000) / 10000;
    await parameter(page, 'width', layerWidth, '[data-motion="composite-controls"]:visible');
    await parameter(page, 'height', layerHeight, '[data-motion="composite-controls"]:visible');
    await parameter(page, 'x', 0.61, '[data-motion="composite-controls"]:visible');
    await parameter(page, 'y', 0.2, '[data-motion="composite-controls"]:visible');
    await layout(page, locale + ': layers capture');
    await productCapture(page, 'layers', locale, ['coast', 'portrait'], 'Actual imported image layer with UI position and scale controls');
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
    const limits = await range.evaluate((node) => ({ min: Number(node.min), max: Number(node.max) }));
    const value = Math.max(limits.min, Math.min(limits.max, 12));
    await parameter(portrait.page, controlId, value, '.portrait-controls-v3');
    await layout(portrait.page, locale + ': portrait capture');
    await productCapture(portrait.page, 'portrait', locale, 'portrait', 'Actual local model inference and person-specific adjustment; no supplier call');
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
  return { locale, screens: SCREEN_NAMES };
}

async function supplementalViews(config) {
  const { transaction } = await import('@ai-xiutu/db');
  const { createRecipeV4 } = await import('@ai-xiutu/editor');
  const { hashPassword } = await import('../../apps/api/src/core.ts');
  const { createPersonalSpace } = await import('../../apps/api/src/auth.ts');
  const { createArtworkBranch } = await import('../../apps/api/src/revision-commands.ts');
  const { LocalPrivateStorage } = await import('../../apps/api/src/storage.ts');
  const actor = {
    id: randomUUID(), name: '界面验收',
    phone: '+1555' + String(1000000 + (Number.parseInt(randomBytes(3).toString('hex'), 16) % 8000000)),
    password: randomBytes(24).toString('base64url'),
  };
  const projectId = randomUUID(), projectName = 'Coast & portrait';
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
        [source.assetId, projectId, source.id + '.png', file.key, file.mime, file.width, file.height,
          file.bytes, file.hash, JSON.stringify({ kind: 'uploaded', declaredSource: 'upload' }), actor.id],
      );
      await createArtworkBranch(tx, {
        projectId, actorId: actor.id, assetId: source.assetId,
        title: source.id === 'coast' ? 'Coast study' : 'Portrait study',
        label: 'Public photo fixture', recipe: createRecipeV4(),
      });
    }
  });
  const signedIn = async (context) => {
    const response = await context.request.post(origin + '/v1/auth/login', {
      headers: { origin }, data: { phone: actor.phone, password: actor.password },
    });
    assert.equal(response.status(), 200, 'Disposable account must pass actual password verification.');
    assert.equal((await response.json()).user.id, actor.id);
    const document = await context.request.post(origin + '/v1/projects/' + projectId + '/documents', {
      headers: { origin },
      data: { title: 'Retouch notes', body: 'Public photo interface review. Preserve natural texture, then export the current edit.' },
    });
    assert.equal(document.status(), 201, 'Fixture document must be accepted by the actual route.');
  };
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
    assert.deepEqual(selectedProject.artworks.map((work) => work.title).sort(), ['Coast study', 'Portrait study']);
    await changeView(page, 'works');
    const library = page.locator('.asset-library:visible');
    await library.getByRole('heading', { name: projectName, exact: true }).waitFor();
    await library.locator('.library-asset').first().waitFor();
    assert.equal(await library.locator('.library-asset').count(), 2);
    const savedWorks = library.locator('.library-version-links > button');
    assert.deepEqual((await savedWorks.locator('span').allTextContents()).sort(), ['Coast study', 'Portrait study']);
    await layout(page, 'isolated project gallery');
    await capture(page, 'views/works.png');
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
      await capture(page, 'views/restoration-denoise.png');
      await repair.getByRole('button', { name: '运动模糊', exact: true }).click();
      await repair.locator('input[type="number"][aria-label="运动长度"]').waitFor();
      await layout(page, 'restoration motion dialog');
      await capture(page, 'views/restoration-motion.png');
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
    await capture(page, 'views/documents.png');
    await changeView(page, 'collaborate');
    await settle(page);
    await layout(page, 'isolated project collaboration empty state');
    await capture(page, 'views/collaborate.png');
    await changeView(page, 'usage');
    await settle(page);
    await layout(page, 'isolated account usage');
    await capture(page, 'views/usage.png');
    await changeView(page, 'editor');
    await importPhoto(page, 'coast');
    await tool(page, 'ai');
    await page.locator('.free-panel[data-panel-id="ai"][aria-hidden="false"]').waitFor();
    await layout(page, 'AI unavailable state without supplier');
    await capture(page, 'views/assistant-disabled.png');
    await page.locator('.studio-account').click();
    await page.locator('[data-testid="account-center"]').waitFor();
    await logo(page, 'isolated account center');
    await layout(page, 'account center');
    await capture(page, 'account/center.png');
    return {
      environment: 'One disposable account and real local project with two public photos and one API-created document.',
      views: ['works', 'restoration-read-only', 'documents', 'collaborate', 'usage', 'assistant-unavailable', 'account'],
      restoration,
      liveCloudServiceAcceptance: false, multiPersonSessionAcceptance: false,
    };
  } catch (error) {
    await failureEvidence(page);
    throw error;
  } finally { await closeCaseContext(context); }
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
  for (const locale of LOCALES)
    await check('captures:' + locale, () => productScreens(locale));
  for (const scenario of SCENARIOS)
    await check('about:' + scenario.id, () => inspectAbout(scenario));
  await check('supplemental:isolated-account-and-views', () => supplementalViews(config));
  await check('brand:dark-studio-and-favicon', async () => {
    const { context, page } = await newPage({
      locale: 'en', viewport: { width: 1440, height: 960 }, theme: 'dark', motion: 'reduce',
    });
    try {
      await logo(page, 'dark studio');
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
      return { source: canonicalLogo, favicon, sha256: sha256(logoBytes) };
    } catch (error) {
    await failureEvidence(page);
    throw error;
  } finally { await closeCaseContext(context); }
  });
  await check('capture-completeness-and-runtime-errors', async () => {
    assert.deepEqual([...published.map((file) => file.path)].sort(), [...PUBLISH_IMAGE_PATHS].sort());
    assert.deepEqual(report.pageErrors, [], 'No unhandled browser runtime errors.');
    assert.deepEqual(report.unexpectedOrigins, [], 'The browser must not contact any external service.');
    return { publishedImageCount: published.length };
  });
  report.state = report.cases.some((entry) => entry.state !== 'passed') || report.cleanupErrors?.length ? 'failed' : 'passed';
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
  report.finishedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 1, state: report.state, testedCommit, repository: REPOSITORY,
    capturedAt: report.finishedAt, browser: report.browser ?? null, manualVisualReview: false,
    inputs: report.inputs,
    scenarios: SCENARIOS.map((scenario) => ({
      ...scenario, state: report.cases.find((entry) => entry.name === 'flow:' + scenario.id)?.state ?? 'not-run',
    })),
    files: published, limits: report.limits,
  };
  await mkdir(dirname(resolve(publishRoot, MANIFEST_PATH)), { recursive: true });
  await writeFile(resolve(publishRoot, MANIFEST_PATH), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Frontend review ' + report.state + ': ' + report.cases.filter((entry) => entry.state === 'passed').length + '/' + report.cases.length + ' cases passed.');
  if (report.state !== 'passed') process.exitCode = 1;
}
