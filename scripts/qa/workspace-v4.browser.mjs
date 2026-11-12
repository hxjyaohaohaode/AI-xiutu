/** CI-only real Chromium / HTTP / PostgreSQL integration. No supplier keys, SMS, mocked API or private photos. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createDatabase, transaction, adjustUnits } from '@ai-xiutu/db';
import {
  createRecipeV4,
  createAdjustmentRegionV3,
  renderEditorRecipeTiled,
} from '@ai-xiutu/editor';

if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production')
  throw new Error('This browser harness is restricted to isolated non-production CI.');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !decodeURIComponent(new URL(databaseUrl).pathname).includes('test'))
  throw new Error(
    'TEST_DATABASE_URL must point to a disposable database whose name includes test.',
  );
const webPort = Number(process.env.BROWSER_WEB_PORT ?? 4178);
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535)
  throw new Error('Invalid browser web port.');
const origin = `http://127.0.0.1:${webPort}`;
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const artifacts = resolve(root, process.env.BROWSER_ARTIFACT_DIR ?? 'artifacts/browser-v4');
await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'xiutu-browser-v4-'));
// These environment gates are set before importing API providers. CI never starts paid tools.
for (const name of [
  'OPENAI_API_KEY',
  'OPENAI_REALTIME_API_KEY',
  'GEMINI_API_KEY',
  'DASHSCOPE_API_KEY',
  'ARK_API_KEY',
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
])
  process.env[name] = '';
for (const name of [
  'AI_PLAN_ENABLED',
  'AI_TEXT_ENABLED',
  'AI_IMAGE_ENABLED',
  'AI_SPEECH_ENABLED',
  'AI_ASSISTANT_ENABLED',
  'AI_VOICE_ENABLED',
])
  process.env[name] = 'false';
process.env.NODE_ENV = 'test';
const { buildApp } = await import('../../apps/api/src/app.ts');
const { loadConfig } = await import('../../apps/api/src/config.ts');
const { LocalPrivateStorage } = await import('../../apps/api/src/storage.ts');
const { createArtworkBranch } = await import('../../apps/api/src/revision-commands.ts');
const { hashPassword } = await import('../../apps/api/src/core.ts');
const { createPersonalSpace } = await import('../../apps/api/src/auth.ts');
const { createServer } = await import('vite');
const db = createDatabase(databaseUrl);
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  SESSION_SECRET: randomBytes(48).toString('hex'),
  APP_ORIGIN: origin,
  STORAGE_DIR: directory,
  COOKIE_SECURE: 'false',
  NODE_ENV: 'test',
});
let app, vite, browser;
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  source:
    'technical PNG generated in CI plus three public photographs with pinned byte counts and SHA-256',
  authentication: 'random CI fixture passwords, actual HTTP login; no SMS delivered',
  browser: null,
  cases: [],
  layoutMeasurements: [],
  pageErrors: [],
  manualVisualReview: false,
};
const pages = [];
let activeCase = 'bootstrap';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function eventually(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let result;
  do {
    result = await check();
    if (result) return result;
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
async function caseRun(name, run) {
  activeCase = name;
  const before = Date.now();
  try {
    const detail = await run();
    report.cases.push({ name, state: 'passed', durationMs: Date.now() - before, ...detail });
    process.stdout.write(`Browser case passed: ${name}\n`);
  } catch (error) {
    report.cases.push({
      name,
      state: 'failed',
      durationMs: Date.now() - before,
      message: String(error.message).slice(0, 2500),
    });
    throw error;
  }
}
async function changeView(page, id, label) {
  const compact = page.getByRole('button', { name: '切换工作视图', exact: true });
  const tab = page
    .getByRole('navigation', { name: '工作视图', exact: true })
    .getByRole('button', { name: label, exact: true });
  await compact.or(tab).first().waitFor();
  if (await compact.isVisible()) {
    await compact.click();
    const dialog = page.getByRole('dialog', { name: '工作视图', exact: true });
    await dialog.locator(`button[data-view="${id}"]`).click();
    await dialog.waitFor({ state: 'hidden' });
  } else await tab.click();
}
async function navigationClosed(page) {
  const sidebar = page.locator('dialog.sidebar-navigation-modal');
  await sidebar.waitFor({ state: 'hidden' });
  const state = await sidebar.evaluate((node) => ({
    ariaHidden: node.getAttribute('aria-hidden'),
    inert: node.inert,
    open: node.open,
  }));
  assert.deepEqual(state, {
    ariaHidden: 'true',
    inert: true,
    open: false,
  });
  await page.getByRole('button', { name: '打开空间与项目', exact: true }).click({ trial: true });
  return state;
}
async function tool(page, label) {
  const button = page
    .getByRole('navigation', { name: '编辑工具' })
    .getByRole('button', { name: label, exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await page.locator('.free-panel[aria-hidden="false"]').waitFor();
}
async function precision(page, label, value) {
  const panel = page.locator('.free-panel[aria-hidden="false"]');
  if (!(await panel.getByRole('slider', { name: label, exact: true }).count())) {
    const compact = panel.locator('.parameter-compact-picker:visible').getByRole('combobox');
    if (await compact.isVisible()) {
      await compact.click();
      await page.getByRole('option', { name: label, exact: true }).click();
    } else {
      await panel
        .locator('.parameter-shelf-options')
        .getByRole('button', { name: new RegExp(`^${label}`) })
        .click();
    }
  }
  await panel.getByRole('button', { name: new RegExp(`^${label}数值`) }).click();
  await panel.getByRole('spinbutton', { name: `${label}精确数值` }).fill(String(value));
  await panel.getByRole('spinbutton', { name: `${label}精确数值` }).press('Enter');
  await eventually(
    async () =>
      Number(await panel.getByRole('slider', { name: label, exact: true }).inputValue()) === value,
    `${label} displayed value`,
  );
}
async function editorReturnAndHistory(page) {
  const canvas = await page.locator('.image-frame canvas').elementHandle();
  assert.ok(canvas, 'the live canvas exists before changing panel contexts');
  try {
    const inspector = page.locator('.free-panel[data-panel-id="inspector"][aria-hidden="false"]');
    if ((await inspector.getAttribute('data-inline-adjustment')) === 'true')
      await inspector.locator('.panel-layout-trigger').click();
    await inspector.getByRole('button', { name: '返回工具总览', exact: true }).click();
    const overview = inspector.getByRole('region', { name: '全部工具', exact: true });
    await overview.waitFor();
    assert.equal(await inspector.locator('.inspector-retained').getAttribute('inert'), '');
    const first = overview.locator('.tool-overview-list > button').first();
    await first.focus();
    await first.press('End');
    assert.equal(
      await overview
        .locator('.tool-overview-list > button')
        .last()
        .evaluate((button) => button === document.activeElement),
      true,
      'End focuses and reveals the actual last tool',
    );
    await overview.getByRole('searchbox', { name: '查找工具', exact: true }).fill('明暗');
    assert.equal(await overview.locator('.tool-overview-list > button').count(), 1);
    await overview.getByRole('button', { name: /^明暗/ }).click();
    await overview.waitFor({ state: 'hidden' });
    assert.equal(
      Number(await inspector.getByRole('slider', { name: '曝光', exact: true }).inputValue()),
      -0.35,
      'returning through the tool overview preserves the exact current adjustment',
    );
    const tabs = inspector.getByRole('navigation', { name: '当前作品面板', exact: true });
    const visibleTabs = await tabs.isVisible();
    if (visibleTabs) await tabs.getByRole('button', { name: '记录', exact: true }).click();
    else await tool(page, '记录');
    await inspector
      .locator('.detailed-history-list > li[data-selected="true"] .history-expand')
      .click();
    const changes = inspector.locator('.history-change-details');
    await changes.waitFor();
    const exposure = changes
      .locator(':scope > div')
      .filter({ has: page.locator('dt').filter({ hasText: /曝光$/ }) });
    assert.equal(await exposure.locator('dd > span').innerText(), '0EV');
    assert.equal(await exposure.locator('dd > strong').innerText(), '-0.35EV');
    if (visibleTabs) await tabs.getByRole('button', { name: '调整', exact: true }).click();
    else await tool(page, page.viewportSize().width < 760 ? '调节' : '明暗');
    assert.equal(
      Number(await inspector.getByRole('slider', { name: '曝光', exact: true }).inputValue()),
      -0.35,
    );
    assert.equal(
      await canvas.evaluate(
        (node) => node.isConnected && node === document.querySelector('.image-frame canvas'),
      ),
      true,
      'tool overview and local history keep the original canvas owner mounted',
    );
    const topbar = await page.locator('.floating-topbar').boundingBox();
    assert.ok(
      topbar && topbar.height <= (page.viewportSize().width < 760 ? 44.5 : 56.5),
      'compact studio chrome leaves room for the photograph',
    );
    return {
      toolOverviewReturn: true,
      keyboardToolTraversal: true,
      actualHistoryDelta: [0, -0.35],
      sameCanvas: true,
      topbarHeight: topbar.height,
    };
  } finally {
    await canvas.dispose();
  }
}
async function downloadBytes(page, action) {
  const [download] = await Promise.all([page.waitForEvent('download'), action()]);
  const stream = await download.createReadStream();
  assert.ok(stream, 'a browser download stream must exist');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(await download.failure(), null);
  return Buffer.concat(chunks);
}
async function recipeDownload(page) {
  await changeView(page, 'deliver', '交付');
  const bytes = await downloadBytes(page, () =>
    page.getByRole('button', { name: '保存编辑配方' }).click(),
  );
  const value = JSON.parse(bytes.toString('utf8'));
  await changeView(page, 'editor', '精修');
  return value;
}
async function imageDownload(page) {
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const dialog = page.locator('dialog.export-dialog[open]');
  const bytes = await downloadBytes(page, () => dialog.locator('button.button-full').click());
  await dialog.locator('a[download]').waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  return bytes;
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function photographicSources() {
  const manifest = JSON.parse(
    await readFile(join(root, 'scripts/qa/portrait-native-inputs.json'), 'utf8'),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(
    manifest.inputs.map((item) => item.name).sort(),
    ['mediapipe-portrait', 'mediapipe-pose', 'portrait-hopper'],
    'the six photo cases require all three fixed public sources',
  );
  for (const source of manifest.inputs) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(['raw.githubusercontent.com', 'storage.googleapis.com'].includes(url.hostname));
    assert.equal(url.username + url.password, '');
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(source.bytes) && source.bytes > 0 && source.bytes <= 2_097_152);
  }
  return manifest.inputs;
}
async function publicPhoto(source) {
  // A shared cache avoids fetching the originals again in each of the six CI
  // rounds. It is separate from the uploaded screenshot/output evidence and
  // every read, including a cache hit, must match the pinned bytes and hash.
  const cache = join(root, 'artifacts/browser-v4-source-cache');
  await mkdir(cache, { recursive: true });
  const path = join(cache, `${source.sha256}.jpg`);
  let bytes,
    cacheHit = false;
  try {
    const info = await stat(path);
    assert.equal(info.size, source.bytes, 'cached public photograph byte count');
    bytes = await readFile(path);
    cacheHit = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(source.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok, `public photograph download failed: HTTP ${response.status}`);
    assert.ok(response.body, 'public photograph download must have a body');
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        assert.ok(length <= source.bytes, 'public photograph exceeds its pinned byte budget');
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    bytes = Buffer.concat(chunks, length);
  }
  assert.equal(bytes.length, source.bytes, 'public photograph byte count must match the manifest');
  assert.equal(sha256(bytes), source.sha256, 'public photograph SHA-256 must match the manifest');
  if (!cacheHit) await writeFile(path, bytes, { flag: 'wx' });
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'jpeg');
  const oriented = metadata.autoOrient;
  assert.ok(
    oriented?.width > 0 && oriented.height > 0,
    'the photograph has real decoded dimensions',
  );
  return { bytes, cacheHit, width: oriented.width, height: oriented.height };
}
async function pixelEvidence(bytes) {
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'png', 'actual canvas/export evidence must decode as PNG');
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  let luma = 0,
    opaquePixels = 0,
    clippedBlack = 0,
    clippedWhite = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) continue;
    opaquePixels += 1;
    luma += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) clippedBlack += 1;
    if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) clippedWhite += 1;
  }
  assert.equal(
    opaquePixels,
    info.width * info.height,
    'an exposure edit must not empty this JPEG photo',
  );
  return {
    data,
    evidence: {
      width: info.width,
      height: info.height,
      rgbaSha256: sha256(data),
      meanLuma: luma / opaquePixels,
      opaquePixels,
      clippedBlack,
      clippedWhite,
    },
  };
}
async function canvasEvidence(page) {
  await imageReady(page);
  await page
    .locator('.free-panel[aria-hidden="false"] .panel-layout-trigger')
    .click({ trial: true });
  // PixelCanvas paints in an effect; give committed state and its paint two
  // actual animation frames rather than reading React internals.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await imageReady(page);
  const dataUrl = await page
    .locator('.image-frame canvas')
    .evaluate((canvas) => canvas.toDataURL('image/png'));
  assert.ok(dataUrl.startsWith('data:image/png;base64,'));
  return pixelEvidence(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
}
function exposureDirection(dark, neutral, light, label) {
  assert.equal(dark.data.length, neutral.data.length, `${label} dark dimensions`);
  assert.equal(light.data.length, neutral.data.length, `${label} light dimensions`);
  let darkerPixels = 0,
    brighterPixels = 0,
    darkReversed = 0,
    lightReversed = 0;
  for (let i = 0; i < neutral.data.length; i += 4) {
    const luminance = (data) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const base = luminance(neutral.data);
    const darkDelta = luminance(dark.data) - base;
    const lightDelta = luminance(light.data) - base;
    if (darkDelta < -0.5) darkerPixels += 1;
    if (lightDelta > 0.5) brighterPixels += 1;
    if (darkDelta > 0.5) darkReversed += 1;
    if (lightDelta < -0.5) lightReversed += 1;
  }
  const count = neutral.evidence.opaquePixels;
  assert.ok(
    dark.evidence.meanLuma < neutral.evidence.meanLuma - 1,
    `${label}: -3 EV really darkens the photograph`,
  );
  assert.ok(
    light.evidence.meanLuma > neutral.evidence.meanLuma + 1,
    `${label}: +3 EV really brightens the photograph`,
  );
  assert.ok(
    darkerPixels > count * 0.1 && brighterPixels > count * 0.1,
    `${label}: a meaningful portion of actual pixels changes`,
  );
  assert.equal(darkReversed, 0, `${label}: negative exposure does not brighten pixels`);
  assert.equal(lightReversed, 0, `${label}: positive exposure does not darken pixels`);
  return { darkerPixels, brighterPixels, darkReversed, lightReversed };
}
async function acceptDefaultConfirmations(page) {
  await page.addLocatorHandler(
    page.getByRole('dialog', { name: '确认操作', exact: true }),
    async (dialog) => dialog.getByRole('button', { name: '确认继续', exact: true }).click(),
  );
}
async function watchPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) =>
    report.pageErrors.push({ case: activeCase, message: error.message.slice(0, 1500) }),
  );
  page.on('dialog', (dialog) => void dialog.accept());
  await acceptDefaultConfirmations(page);
  pages.push(page);
  return page;
}
async function imageReady(page) {
  await page.locator('.image-frame canvas').waitFor();
  await page.locator('.stage-loading').waitFor({ state: 'hidden' });
  await page.locator('.canvas-stage[aria-busy="true"]').waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('.canvas-error').getByRole('alert').count(),
    0,
    'the image pipeline must complete without a visible processing error',
  );
}
async function readyHandleBox(page, handle) {
  await imageReady(page);
  // Visibility alone is insufficient: a previous geometry render or panel layout
  // can still be changing the frame. Trial actionability waits without editing it.
  await handle.click({ trial: true });
  await imageReady(page);
  const box = await handle.boundingBox();
  assert.ok(box, 'the transform handle must have an actionable screen position');
  return box;
}
async function cloudRecoveryHeaderEvidence(page, expectedRoute) {
  const header = page.locator('.floating-topbar');
  await eventually(
    async () => (await header.locator('.mobile-view-trigger > span').innerText()) === expectedRoute,
    'the selected language is reflected in the work-view label',
  );
  const measured = await header.evaluate((node) => {
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
        exposed: element.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        ),
      };
    };
    const textLines = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects())
        .filter((box) => box.width > 0 && box.height > 0)
        .map((box) => ({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          right: box.right,
          bottom: box.bottom,
        }));
    };
    const label = node.querySelector('.mobile-view-trigger > span');
    const toolbar = document.querySelector('.canvas-view-controls');
    const compare = toolbar.querySelector('.compare-press');
    const compareLabel = compare.querySelector('span');
    const contexts = document.querySelector(
      '.free-panel[aria-hidden="false"] .studio-context-tabs',
    );
    return {
      locale: document.documentElement.lang,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      headerOverflow: node.scrollWidth - node.clientWidth,
      route: rect(node.querySelector('.mobile-view-trigger')),
      label: label.textContent.trim(),
      lines: textLines(label),
      brand: rect(node.querySelector('.workspace-home-link')),
      controls: [
        '.workspace-identity > .icon-button',
        '.workspace-settings-trigger',
        '.cloud-status-trigger',
        '.top-save',
        '.top-export',
      ].map((selector) => ({ selector, ...rect(node.querySelector(selector)) })),
      toolbar: {
        ...rect(toolbar),
        overflow: toolbar.scrollWidth - toolbar.clientWidth,
        buttons: Array.from(toolbar.querySelectorAll('button'))
          .filter((button) => button.getBoundingClientRect().width > 0)
          .map((button) => ({
            label: button.getAttribute('aria-label') || button.textContent.trim(),
            enabled: !button.disabled,
            ...rect(button),
          })),
        compare: {
          ...rect(compare),
          text: compare.getAttribute('aria-label'),
          lines: textLines(compareLabel),
        },
      },
      contexts: {
        ...rect(contexts),
        buttons: Array.from(contexts?.querySelectorAll('button') ?? []).map((button) => ({
          label: button.querySelector('span').textContent.trim(),
          lines: textLines(button.querySelector('span')),
          ...rect(button),
        })),
      },
    };
  });
  report.layoutMeasurements.push({ case: activeCase, cloudRecoveryHeader: measured });
  assert.equal(measured.label, expectedRoute);
  assert.ok(measured.route?.height >= 44, 'the work-view switch retains its 44px touch height');
  assert.ok(measured.lines.length <= 1, 'the current view does not wrap into another line');
  for (const line of measured.lines)
    assert.ok(line.x >= measured.route.x - 1 && line.right <= measured.route.right + 1);
  assert.ok(measured.pageOverflow <= 1, 'cloud recovery must not cause horizontal page overflow');
  assert.ok(measured.headerOverflow <= 1, 'the header must fit without hiding overflow');
  for (const control of [measured.route, measured.brand, ...measured.controls]) {
    assert.ok(control?.width > 0 && control.height > 0, 'every header action stays visible');
    assert.ok(
      control.x >= -1 && control.right <= measured.viewportWidth + 1,
      'each header action fits inside the viewport',
    );
    assert.equal(control.exposed, true, 'header actions must not obscure each other');
  }
  for (const control of measured.controls)
    assert.ok(control.height >= 44, `${control.selector} retains its 44px touch height`);
  const inside = (inner, outer, label) =>
    assert.ok(
      inner.x >= outer.x - 1 &&
        inner.right <= outer.right + 1 &&
        inner.y >= outer.y - 1 &&
        inner.bottom <= outer.bottom + 1,
      `${label}: ${JSON.stringify({ inner, outer })}`,
    );
  const toolbar = measured.toolbar;
  assert.ok(
    toolbar.x >= -1 &&
      toolbar.right <= measured.viewportWidth + 1 &&
      toolbar.y >= -1 &&
      toolbar.bottom <= measured.viewportHeight + 1 &&
      toolbar.overflow <= 1,
    'the canvas toolbar and its contents must fit the phone width',
  );
  assert.equal(toolbar.buttons.length, 5, 'the phone keeps five primary canvas actions in one row');
  for (const button of toolbar.buttons) {
    inside(button, toolbar, `${button.label} fits fully within the canvas toolbar`);
    assert.ok(
      button.width >= 43.5 && button.height >= 43.5,
      'canvas actions retain 44px touch targets',
    );
    if (button.enabled)
      assert.equal(button.exposed, true, `${button.label} receives a pointer at its center`);
  }
  assert.equal(
    toolbar.compare.text,
    { 'zh-CN': '按住对比', 'zh-TW': '按住對比', en: 'Hold to compare' }[measured.locale],
    'the compare instruction retains its complete translated text',
  );
  assert.equal(
    toolbar.compare.lines.length,
    0,
    'the compare glyph has no second visual line on phones',
  );
  assert.equal(
    measured.contexts.width ?? 0,
    0,
    'the phone editor does not duplicate work-view navigation in the adjustment sheet',
  );
  const more = page.locator('.canvas-tools-trigger');
  await more.click();
  const tools = page.locator('.canvas-secondary-controls[data-open="true"]');
  assert.equal(
    await tools.locator('button:visible').count(),
    7,
    'the six view controls and collage remain available',
  );
  await page.keyboard.press('Escape');
  await tools.waitFor({ state: 'hidden' });
  return measured;
}
async function layoutAssertions(page, phone) {
  await imageReady(page);
  await sleep(450); // wait for this component's finite entry trajectory, not network readiness
  const measured = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } : null;
    };
    const photo = document.querySelector('.image-frame canvas');
    const scroller = document.querySelector('.inspector-scroll');
    const workspace = document.querySelector('.workspace-body');
    const slider = document.querySelector(
      '.free-panel[aria-hidden="false"] .parameter-shelf-current input[type="range"]',
    );
    return {
      rangeBounds: slider ? { min: Number(slider.min), max: Number(slider.max) } : null,
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      panel: rect('.free-panel[aria-hidden="false"]'),
      dock: rect('.floating-tool-dock'),
      frame: rect('.image-frame'),
      slider: rect('.free-panel[aria-hidden="false"] .parameter-shelf-current input[type="range"]'),
      control: rect('.free-panel[aria-hidden="false"] .parameter-shelf-current .precision-control'),
      heading: rect('.free-panel[aria-hidden="false"] .parameter-shelf-current .precision-heading'),
      scale: rect('.free-panel[aria-hidden="false"] .parameter-shelf-current .precision-scale'),
      scaleStart: rect(
        '.free-panel[aria-hidden="false"] .parameter-shelf-current .precision-scale > span:first-child',
      ),
      scaleEnd: rect(
        '.free-panel[aria-hidden="false"] .parameter-shelf-current .precision-scale > span:last-child',
      ),
      scroll: rect('.inspector-scroll'),
      scrollTop: scroller?.scrollTop ?? null,
      scrollHeight: scroller?.scrollHeight ?? null,
      workspaceScrollLeft: workspace?.scrollLeft ?? null,
      workspaceClientWidth: workspace?.clientWidth ?? null,
      workspaceScrollWidth: workspace?.scrollWidth ?? null,
      photoFilter: photo ? getComputedStyle(photo).filter : null,
    };
  });
  // Preserve the failing geometry as well as successful measurements. A visible
  // track can still have a clipped native input hit area on a short panel.
  report.layoutMeasurements.push({ case: activeCase, ...measured });
  assert.ok(
    measured.scrollWidth <= measured.width + 1,
    'the page must not acquire horizontal overflow',
  );
  assert.equal(measured.photoFilter, 'none', 'UI motion must not blur the image');
  assert.ok(
    measured.frame?.width > 60 && measured.frame.height > 40,
    'the image remains measurable and visible',
  );
  assert.ok(
    measured.panel && measured.slider && measured.scroll,
    'current parameter and panel are rendered',
  );
  assert.ok(
    measured.panel.x >= -1 && measured.panel.x + measured.panel.width <= measured.width + 1,
    'the floating panel stays within the horizontal viewport bounds',
  );
  assert.ok(
    measured.slider.y >= measured.scroll.y - 1 &&
      measured.slider.bottom <= measured.scroll.bottom + 1,
    'the active slider is inside its own visible scroller',
  );
  assert.ok(
    measured.rangeBounds?.min < 0 && measured.rangeBounds?.max > 0,
    'the active exposure slider retains its signed range at every size',
  );
  if (phone) {
    assert.equal(measured.scale?.height, 0, 'phone controls omit the decorative scale row');
  } else {
    assert.ok(
      measured.heading && measured.scale && measured.scaleStart && measured.scaleEnd,
      'parameter bounds are rendered with the active control',
    );
    assert.ok(
      measured.scale.y >= measured.heading.bottom &&
        measured.scale.y >= measured.slider.bottom - 5.5,
      'min/max labels stay below the value and reset row, even with About CSS loaded',
    );
    assert.ok(
      measured.scaleStart.x + measured.scaleStart.width < measured.scaleEnd.x &&
        measured.scaleStart.x >= measured.scale.x - 1 &&
        measured.scaleEnd.x + measured.scaleEnd.width <=
          measured.scale.x + measured.scale.width + 1,
      'signed min/max labels occupy distinct ends of their own full-width row',
    );
  }
  if (phone) {
    assert.ok(
      Math.abs(measured.panel.bottom - measured.dock.y) <= 1.5,
      'the phone sheet attaches directly to its bottom tool rail',
    );
    assert.ok(
      measured.frame.bottom <= measured.panel.y + 1.5,
      'default docked controls cannot cover the fitted photo',
    );
  }
  return measured;
}

async function assertPaintPanelFocus(page) {
  const panel = page.locator('.free-panel[aria-hidden="false"]');
  const field = panel
    .locator('[data-motion="paint-controls"]')
    .getByRole('textbox', { name: 'HEX颜色', exact: true });
  await panel.locator('.panel-drag-header').waitFor({ state: 'visible' });
  // Native focus must reveal the low color input through the editor scroller,
  // without scrolling the shared navigation out of the clipped outer shell.
  await field.focus();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const measured = await field.evaluate((input) => {
    const panel = input.closest('.free-panel');
    const content = input.closest('.panel-content');
    const scroller = input.closest('.inspector-scroll');
    const header = panel?.querySelector('.panel-drag-header');
    const navigation = panel?.querySelector('.panel-presentation-actions');
    if (!content || !scroller || !header || !navigation)
      throw new Error('The paint input must be inside the real editor panel');
    const bounds = (element) => {
      const { top, bottom } = element.getBoundingClientRect();
      return { top, bottom };
    };
    return {
      focused: document.activeElement === input,
      outerScrollTop: content.scrollTop,
      innerScrollTop: scroller.scrollTop,
      content: bounds(content),
      scroller: bounds(scroller),
      header: bounds(header),
      navigation: bounds(navigation),
      input: bounds(input),
    };
  });
  assert.equal(measured.focused, true, 'the low color input receives real native focus');
  assert.equal(measured.outerScrollTop, 0, 'focus cannot scroll the outer panel shell');
  assert.ok(
    measured.navigation.top >= measured.header.top - 1 &&
      measured.navigation.bottom <= measured.header.bottom + 1,
    'compact context actions stay inside the single pinned header',
  );
  assert.ok(
    measured.input.top >= measured.scroller.top - 1 &&
      measured.input.bottom <= measured.scroller.bottom + 1,
    'the inner editor still scrolls to reveal the focused color input',
  );
  return measured;
}

try {
  app = await buildApp({
    db,
    config,
    sms: {
      configured: false,
      async send() {
        throw new Error('CI does not send SMS');
      },
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(app.server.address().port);
  vite = await createServer({
    cacheDir: resolve(artifacts, 'vite-cache'),
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: webPort, strictPort: true },
  });
  await vite.listen();
  const width = 600,
    height = 400,
    pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = Math.round((x * 255) / (width - 1));
      pixels[i + 1] = Math.round((y * 255) / (height - 1));
      pixels[i + 2] = (Math.floor(x / 30) + Math.floor(y / 30)) % 2 ? 210 : 45;
      pixels[i + 3] = 255;
    }
  const png = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const storage = new LocalPrivateStorage(config);
  await storage.initialize();
  const stored = await storage.storeGenerated(png);
  const actors = ['owner', 'editor'].map((role, index) => ({
    id: randomUUID(),
    role,
    name: `CI ${role}`,
    phone: `+1555${String(1000000 + (Number.parseInt(randomBytes(3).toString('hex'), 16) % 8000000) + index).padStart(7, '0')}`,
    password: randomBytes(24).toString('base64url'),
  }));
  const teamId = randomUUID(),
    projectId = randomUUID(),
    assetId = randomUUID();
  const teamName = `CI browser ${randomUUID().slice(0, 8)}`,
    projectName = 'V4 browser integration',
    artworkName = 'Shared technical gradient';
  let work;
  await transaction(db, async (tx) => {
    for (const actor of actors) {
      await tx.query(
        'INSERT INTO users(id,phone,display_name,password_hash,phone_verified_at) VALUES($1,$2,$3,$4,clock_timestamp())',
        [actor.id, actor.phone, actor.name, await hashPassword(actor.password)],
      );
      await createPersonalSpace(tx, actor.id, actor.name);
    }
    await tx.query('INSERT INTO operator_users(user_id) VALUES($1)', [actors[0].id]);
    await tx.query("INSERT INTO spaces(id,name,kind,owner_id) VALUES($1,$2,'team',$3)", [
      teamId,
      teamName,
      actors[0].id,
    ]);
    for (const actor of actors)
      await tx.query('INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,$3)', [
        teamId,
        actor.id,
        actor.role,
      ]);
    await tx.query('INSERT INTO projects(id,space_id,title,created_by) VALUES($1,$2,$3,$4)', [
      projectId,
      teamId,
      projectName,
      actors[0].id,
    ]);
    await tx.query(
      'INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,provenance,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)',
      [
        assetId,
        projectId,
        'CI-gradient.png',
        stored.key,
        stored.mime,
        stored.width,
        stored.height,
        stored.bytes,
        stored.hash,
        JSON.stringify({ kind: 'uploaded', declaredSource: 'upload' }),
        actors[0].id,
      ],
    );
    work = await createArtworkBranch(tx, {
      projectId,
      actorId: actors[0].id,
      assetId,
      title: artworkName,
      label: 'CI source',
      recipe: createRecipeV4({
        regionEdits: [
          createAdjustmentRegionV3({
            id: 'ci-left',
            name: 'Left region',
            mask: {
              type: 'radial',
              centerX: 0.25,
              centerY: 0.5,
              radiusX: 0.12,
              radiusY: 0.2,
              feather: 0.4,
              invert: false,
            },
          }),
        ],
      }),
    });
    await adjustUnits(tx, {
      spaceId: teamId,
      actorId: actors[0].id,
      units: 125,
      reason: 'CI fixture grant',
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    });
    await adjustUnits(tx, {
      spaceId: teamId,
      actorId: actors[0].id,
      units: -5,
      reason: 'CI fixture negative adjustment',
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    });
  });
  const browserChannel = process.env.BROWSER_CHANNEL;
  if (browserChannel && !['chrome', 'msedge'].includes(browserChannel))
    throw new Error('BROWSER_CHANNEL must be chrome or msedge; omit it for bundled Chromium.');
  browser = await chromium.launch({
    headless: true,
    ...(browserChannel ? { channel: browserChannel } : {}),
  });
  report.browser = { name: 'Chromium', version: browser.version() };
  for (const size of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1024, height: 768 },
    { width: 1440, height: 960 },
  ]) {
    await caseRun(`layout-${size.width}x${size.height}`, async () => {
      const context = await browser.newContext({
        viewport: size,
        hasTouch: size.width < 1120,
        reducedMotion: 'reduce',
        acceptDownloads: true,
      });
      const page = await watchPage(context);
      await page.goto(`${origin}/#/studio`);
      await page
        .getByLabel('选择照片', { exact: true })
        .setInputFiles({ name: 'technical-gradient.png', mimeType: 'image/png', buffer: png });
      await page.locator('.image-frame canvas').waitFor();
      await tool(page, size.width < 760 ? '调节' : '明暗');
      const initial = await layoutAssertions(page, size.width < 760);
      await precision(page, '曝光', -0.35);
      const panelContext = await editorReturnAndHistory(page);
      const normal = await layoutAssertions(page, size.width < 760);
      let resized = null;
      if (size.width < 760) {
        const panel = page.locator('.free-panel[aria-hidden="false"]');
        const grip = panel.locator('.panel-title-drag');
        const edge = panel.locator('.panel-resize-edge.resize-n');
        const box = await edge.boundingBox();
        assert.ok(box);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width / 2,
          box.y + box.height / 2 - (339 - normal.panel.height),
          { steps: 8 },
        );
        await page.mouse.up();
        resized = await layoutAssertions(page, true);
        assert.ok(
          Math.abs(resized.panel.height - 339) < 2,
          'phone resize is continuous CSS pixels',
        );
        assert.equal(
          resized.panel.width,
          size.width,
          'an attached phone sheet uses the complete viewport width',
        );
        await edge.press('Alt+ArrowUp');
        const taller = await page.locator('.free-panel[aria-hidden="false"]').boundingBox();
        assert.ok(
          Math.abs(taller.height - (resized.panel.height + 1)) < 0.1,
          'keyboard height has a true 1px step',
        );
        await edge.press('Alt+ArrowDown');
        await page.getByRole('button', { name: '面板位置与连续尺寸', exact: true }).click();
        assert.equal(await panel.getByRole('button', { name: '浮动', exact: true }).count(), 0,
          'the phone adjustment rail cannot detach and cover the photo');
        assert.equal(await panel.getAttribute('data-attached'), 'true');
        await panel.locator('.panel-layout-menu .panel-collapse-action').click();
        await eventually(
          async () =>
            (await page
              .locator('.free-panel[aria-hidden="false"]')
              .getAttribute('data-presentation')) === 'collapsed',
          'collapse',
        );
        await grip.press('Enter');
        await eventually(
          async () =>
            Number(await page.getByRole('slider', { name: '曝光', exact: true }).inputValue()) ===
            -0.35,
          'restore retains photo adjustment',
        );
        await panel.locator('.panel-layout-trigger').click();
        await panel.getByRole('button', { name: '展开精调，允许遮挡画面', exact: true }).click();
        assert.equal(
          await page.locator('.free-panel[aria-hidden="false"]').getAttribute('data-presentation'),
          'maximized',
        );
        await panel.locator('.panel-layout-trigger').click();
        await panel
          .getByRole('button', { name: '返回常规调节，恢复面板尺寸', exact: true })
          .click();
        await panel.locator('.panel-layout-trigger').click();
        await panel.getByRole('button', { name: '收起工具面板', exact: true }).click();
        await panel.waitFor({ state: 'hidden' });
        await tool(page, '调节');
      }
      await page.screenshot({ path: join(artifacts, `layout-${size.width}x${size.height}.png`) });
      const exported = await recipeDownload(page);
      assert.equal(exported.schemaVersion, 4);
      assert.equal(exported.adjustments.exposure, -0.35);
      const bytes = await imageDownload(page);
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, 'png');
      assert.equal(metadata.width, width);
      assert.equal(metadata.height, height);
      assert.notDeepEqual(
        await sharp(bytes).ensureAlpha().raw().toBuffer(),
        pixels,
        'actual decoded image export reflects the changed exposure',
      );
      await context.close();
      return {
        initial,
        normal,
        panelContext,
        resized,
        download: { format: metadata.format, width: metadata.width, height: metadata.height },
      };
    });
  }
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 960 },
  ]) {
    await caseRun(`tool-context-retention-${viewport.width}x${viewport.height}`, async () => {
      const context = await browser.newContext({
        viewport,
        hasTouch: viewport.width < 760,
        reducedMotion: 'reduce',
      });
      const page = await watchPage(context);
      await page.goto(`${origin}/#/studio`);
      await page
        .getByLabel('选择照片', { exact: true })
        .setInputFiles({ name: 'retained-tools.png', mimeType: 'image/png', buffer: png });
      await page.locator('.image-frame canvas').waitFor();
      const inspector = page.locator('.free-panel[data-panel-id="inspector"][aria-hidden="false"]');
      await tool(page, '美颜');
      const portrait = inspector.locator('[data-tool-family="beauty"]');
      const portraitOwner = await portrait.elementHandle();
      assert.ok(portraitOwner);
      const bodyTab = inspector.getByRole('button', { name: '身形', exact: true });
      await bodyTab.click();
      const portraitHelp = portrait.locator('summary').filter({ hasText: '选区与抠图' });
      await portraitHelp.click();
      await tool(page, '构图');
      assert.equal(await portrait.isVisible(), false, 'previous tool has no visible hit targets');
      await tool(page, '美颜');
      assert.equal(await bodyTab.getAttribute('aria-pressed'), 'true');
      assert.equal(await portraitHelp.getAttribute('aria-expanded'), 'true');
      assert.equal(
        await portraitOwner.evaluate((element) => element.isConnected),
        true,
        'return keeps the same portrait controls owner',
      );
      const openColor = async () => {
        await tool(page, viewport.width < 760 ? '调节' : '色彩');
        if (
          viewport.width < 760 &&
          !(await inspector.locator('[data-tool-family="color"]').isVisible())
        ) {
          await inspector.getByRole('combobox', { name: '调节类别', exact: true }).click();
          await page.getByRole('option', { name: '色彩', exact: true }).click();
        }
      };
      await openColor();
      const color = inspector.locator('[data-tool-family="color"]');
      const colorOwner = await color.elementHandle();
      assert.ok(colorOwner);
      if (viewport.width < 760) {
        await color.getByRole('combobox', { name: '调节类别', exact: true }).click();
        await page.getByRole('option', { name: 'HSL', exact: true }).click();
      } else {
        await color.getByRole('button', { name: 'HSL', exact: true }).click();
      }
      await color.getByRole('button', { name: '蓝色段', exact: true }).click();
      await tool(page, '构图');
      assert.equal(await color.isVisible(), false);
      await openColor();
      assert.equal(
        await color
          .locator('.color-family-tabs button')
          .filter({ hasText: /^HSL$/ })
          .getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(
        await color
          .getByRole('button', { name: '蓝色段', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(
        await colorOwner.evaluate((element) => element.isConnected),
        true,
        'HSL band and parameter controls survive tool return',
      );
      const visibleTools = await inspector.locator('.inspector-tool-content:visible').count();
      assert.equal(visibleTools, 1, 'one editing tool owns the visible control surface');
      await page.screenshot({ path: join(artifacts, `retained-tools-${viewport.width}.png`) });
      await page
        .getByLabel('选择照片', { exact: true })
        .setInputFiles({ name: 'new-tool-source.png', mimeType: 'image/png', buffer: png });
      const replaceSource = page.getByRole('dialog', { name: '确认操作', exact: true });
      await page.removeLocatorHandler(replaceSource);
      await replaceSource.getByRole('button', { name: '确认继续', exact: true }).click();
      await eventually(
        async () => !(await portraitOwner.evaluate((element) => element.isConnected)),
        'changing source discards previous tool-local controls',
      );
      await tool(page, '美颜');
      assert.equal(
        await inspector
          .getByRole('button', { name: '美肤', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(
        await inspector
          .locator('summary')
          .filter({ hasText: '选区与抠图' })
          .getAttribute('aria-expanded'),
        'false',
      );
      await portraitOwner.dispose();
      await colorOwner.dispose();
      await context.close();
      return {
        portraitCategoryAndDisclosureRetained: true,
        hslBandAndOwnerRetained: true,
        visibleToolOwners: visibleTools,
        newSourceClearsToolState: true,
      };
    });
  }
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 1440, height: 960 },
  ]) {
    await caseRun(`dismissible-cloud-status-${viewport.width}x${viewport.height}`, async () => {
      const context = await browser.newContext({
        viewport,
        hasTouch: viewport.width < 760,
        reducedMotion: 'reduce',
        acceptDownloads: true,
      });
      const page = await watchPage(context);
      let offline = true,
        configReads = 0;
      const writes = [];
      page.on('request', (request) => {
        if (
          new URL(request.url()).pathname.startsWith('/v1/') &&
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        )
          writes.push(request.method());
      });
      const unavailable = async (route) => {
        configReads++;
        if (offline) await route.abort('internetdisconnected');
        else await route.continue();
      };
      await page.route('**/v1/public-config', unavailable);
      try {
        await page.goto(`${origin}/#/studio`);
        const notice = page.locator('.cloud-status');
        await notice.waitFor();
        await page.getByLabel('选择照片', { exact: true }).setInputFiles({
          name: 'offline-gradient.png',
          mimeType: 'image/png',
          buffer: png,
        });
        await imageReady(page);
        await tool(page, viewport.width < 760 ? '调节' : '明暗');
        await precision(page, '曝光', -0.15);
        const readsBeforeDismiss = configReads;
        await notice.getByRole('button', { name: '收起云端状态', exact: true }).click();
        await notice.waitFor({ state: 'hidden' });
        const restore = page.getByRole('button', { name: '查看云端连接状态', exact: true });
        await restore.waitFor();
        await restore.click({ trial: true });
        assert.equal(configReads, readsBeforeDismiss, 'dismissing the banner is not a retry');
        assert.equal(
          Number(await page.getByRole('slider', { name: '曝光', exact: true }).inputValue()),
          -0.15,
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          true,
        );
        const headerLayouts = [];
        if (viewport.width < 760) {
          headerLayouts.push(await cloudRecoveryHeaderEvidence(page, '精修'));
          for (const [locale, label] of [
            ['zh-TW', '精修'],
            ['en', 'Edit'],
            ['zh-CN', '精修'],
          ]) {
            await page.locator('.workspace-settings-trigger').click();
            const settings = page.locator('.workspace-settings-dialog');
            await settings.waitFor();
            await settings.locator('.language-select select').selectOption(locale);
            await page.waitForFunction((value) => document.documentElement.lang === value, locale);
            await settings.locator('.modal-header > .icon-button').click();
            await settings.waitFor({ state: 'hidden' });
            headerLayouts.push(await cloudRecoveryHeaderEvidence(page, label));
            if (locale !== 'zh-CN')
              await page.screenshot({
                path: join(artifacts, `cloud-dismissed-${viewport.width}-${locale}.png`),
              });
          }
        }
        await page.screenshot({ path: join(artifacts, `cloud-dismissed-${viewport.width}.png`) });
        await restore.click();
        await notice.waitFor();
        assert.equal(configReads, readsBeforeDismiss, 'opening connection details is read-free');
        offline = false;
        const recovered = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/v1/public-config' && response.status() === 200,
        );
        await notice.getByRole('button', { name: '重试', exact: true }).click();
        await recovered;
        await notice.waitFor({ state: 'hidden' });
        assert.equal(
          configReads,
          readsBeforeDismiss + 1,
          'only explicit Retry refreshes public configuration',
        );
        assert.equal(
          Number(await page.getByRole('slider', { name: '曝光', exact: true }).inputValue()),
          -0.15,
        );
        assert.deepEqual(
          writes,
          [],
          'cloud-status recovery must not submit work, assistant turns or charges',
        );
        return {
          dismissed: true,
          recoveryEntry: true,
          explicitReadRetries: 1,
          mutationRequests: 0,
          exposure: -0.15,
          headerLayouts,
        };
      } finally {
        await context.close();
      }
    });
  }
  for (const source of await photographicSources()) {
    for (const size of [
      { width: 390, height: 844 },
      { width: 1440, height: 960 },
    ]) {
      await caseRun(`photo-${source.name}-${size.width}x${size.height}`, async () => {
        const original = await publicPhoto(source);
        const context = await browser.newContext({
          viewport: size,
          hasTouch: size.width < 760,
          reducedMotion: 'no-preference',
          acceptDownloads: true,
        });
        const page = await watchPage(context);
        await page.goto(`${origin}/#/studio`);
        assert.equal(
          await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
          false,
        );
        await page.getByLabel('选择照片', { exact: true }).setInputFiles({
          name: `${source.name}.jpg`,
          mimeType: 'image/jpeg',
          buffer: original.bytes,
        });
        await imageReady(page);
        await tool(page, size.width < 760 ? '调节' : '明暗');
        const layout = await layoutAssertions(page, size.width < 760);
        const prefix = `photo-${source.name}-${size.width}x${size.height}`;
        const screenshots = [];
        async function state(label) {
          // Export is driven by the current public UI and awaits the real
          // full-resolution worker. Compare it independently with the canvas,
          // whose preview resolution can be lower on a mobile device.
          const pngBytes = await imageDownload(page);
          const exported = await pixelEvidence(pngBytes);
          assert.equal(
            exported.evidence.width,
            original.width,
            `${label}: original oriented width`,
          );
          assert.equal(
            exported.evidence.height,
            original.height,
            `${label}: original oriented height`,
          );
          const canvas = await canvasEvidence(page);
          const screenshot = `${prefix}-${label}.png`;
          await page.screenshot({ path: join(artifacts, screenshot) });
          screenshots.push(screenshot);
          await writeFile(join(artifacts, `${prefix}-${label}-export.png`), pngBytes);
          return { canvas, exported };
        }
        const initial = await state('initial-neutral');
        await precision(page, '曝光', -3);
        const dark = await state('minus-3');
        await precision(page, '曝光', 0);
        const neutral = await state('neutral');
        assert.equal(
          neutral.canvas.evidence.rgbaSha256,
          initial.canvas.evidence.rgbaSha256,
          'resetting to zero restores the actual neutral preview pixels',
        );
        assert.equal(
          neutral.exported.evidence.rgbaSha256,
          initial.exported.evidence.rgbaSha256,
          'resetting to zero restores the actual neutral export pixels',
        );
        await precision(page, '曝光', 3);
        const bright = await state('plus-3');
        const previewDirection = exposureDirection(
          dark.canvas,
          neutral.canvas,
          bright.canvas,
          'canvas',
        );
        const exportDirection = exposureDirection(
          dark.exported,
          neutral.exported,
          bright.exported,
          'export',
        );
        // Focus outside number/text fields so Ctrl+Z exercises product history
        // rather than the browser's input undo behavior.
        await page.getByRole('button', { name: '撤销本次编辑', exact: true }).focus();
        await page.keyboard.press('Control+z');
        await eventually(
          async () =>
            Number(await page.getByRole('slider', { name: '曝光', exact: true }).inputValue()) ===
            0,
          'undo returns the actual exposure control to zero',
        );
        const undone = await state('undone-neutral');
        assert.equal(
          undone.canvas.evidence.rgbaSha256,
          neutral.canvas.evidence.rgbaSha256,
          'undo restores every decoded preview pixel',
        );
        assert.equal(
          undone.exported.evidence.rgbaSha256,
          neutral.exported.evidence.rgbaSha256,
          'undo restores every decoded full-resolution exported pixel',
        );
        const recipe = await recipeDownload(page);
        assert.equal(recipe.schemaVersion, 4);
        assert.equal(recipe.adjustments.exposure, 0);
        const recipeFile = `${prefix}-recipe.json`;
        await writeFile(join(artifacts, recipeFile), JSON.stringify(recipe, null, 2) + '\n');
        await context.close();
        const evidence = (states, key) =>
          Object.fromEntries(
            Object.entries(states).map(([name, value]) => [name, value[key].evidence]),
          );
        const states = { initial, dark, neutral, bright, undone };
        return {
          source: {
            name: source.name,
            url: source.url,
            sha256: sha256(original.bytes),
            bytes: original.bytes.length,
            width: original.width,
            height: original.height,
            cacheHit: original.cacheHit,
          },
          viewport: size,
          reducedMotion: 'no-preference',
          layout,
          canvas: evidence(states, 'canvas'),
          exported: evidence(states, 'exported'),
          previewDirection,
          exportDirection,
          screenshots,
          recipeFile,
        };
      });
    }
  }
  await caseRun('four-corner-preview-cancel-undo-keyboard', async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      acceptDownloads: true,
    });
    const page = await watchPage(context);
    await page.goto(`${origin}/#/studio`);
    await page
      .getByLabel('选择照片', { exact: true })
      .setInputFiles({ name: 'geometry.png', mimeType: 'image/png', buffer: png });
    await page.locator('.image-frame canvas').waitFor();
    await tool(page, '构图');
    await page.getByRole('button', { name: '自由四角', exact: true }).click();
    const tl = page.getByRole('button', { name: '左上角透视控制点', exact: true });
    await tl.waitFor();
    assert.equal(await page.locator('.projective-handle').count(), 4);
    await tl.press('Alt+ArrowRight');
    let recipe = await recipeDownload(page);
    assert.equal(recipe.projective.enabled, true);
    assert.ok(Math.abs(recipe.projective.corners[0].x - 0.1 / width) < 1e-9);
    await tool(page, '构图');
    const original = structuredClone(recipe.projective);
    let b = await readyHandleBox(page, tl);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 45, b.y + b.height / 2 + 25, { steps: 10 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    recipe = await recipeDownload(page);
    assert.deepEqual(recipe.projective, original, 'Escape must not commit the preview');
    await tool(page, '构图');
    b = await readyHandleBox(page, tl);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 35, b.y + b.height / 2 + 20, { steps: 10 });
    await page.mouse.up();
    recipe = await recipeDownload(page);
    assert.ok(recipe.projective.corners[0].x > original.corners[0].x + 0.01);
    await tool(page, '构图');
    await tl.focus();
    await page.keyboard.press('Control+z');
    recipe = await recipeDownload(page);
    assert.deepEqual(recipe.projective, original, 'undo restores the exact pre-drag geometry');
    await tool(page, '构图');
    await page.screenshot({ path: join(artifacts, 'four-corners.png') });
    await context.close();
    return { corners: 4, subpixel: 0.1, cancelVerified: true, undoVerified: true };
  });

  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
    { width: 844, height: 390 },
  ]) {
    await caseRun(
      `freehand-coalescing-export-undo-${viewport.width}x${viewport.height}`,
      async () => {
        const context = await browser.newContext({
          viewport,
          acceptDownloads: true,
          reducedMotion: 'reduce',
        });
        const page = await watchPage(context);
        await page.goto(`${origin}/#/studio`);
        await page
          .getByLabel('选择照片', { exact: true })
          .setInputFiles({ name: 'freehand.png', mimeType: 'image/png', buffer: png });
        await page.locator('.image-frame canvas').waitFor();
        await tool(page, '绘制');
        await page
          .locator('[data-motion="paint-controls"]')
          .getByRole('button', { name: '新建', exact: true })
          .click();
        const paintPanelFocus = viewport.width >= 1024 ? await assertPaintPanelFocus(page) : null;
        await precision(page, '柔边', 0);
        const empty = await recipeDownload(page);
        const curve = [
          { x: 0.25, y: 0.35 },
          { x: 0.3, y: 0.5 },
          { x: 0.25, y: 0.65 },
        ];
        const endpoint = { x: 0.25 + 0.5 / width, y: 0.65 };
        const closeTools = async () => {
          await tool(page, '绘制');
          const panel = page.locator('.free-panel[aria-hidden="false"]');
          if (viewport.width < 760) {
            await page.locator('[data-dock-tool="paint"][aria-pressed="true"]').click();
            await panel.waitFor({ state: 'hidden' });
          } else {
            await panel.getByRole('button', { name: /^收起.*可从工具栏重新打开$/ }).click();
          }
          await imageReady(page);
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
        };
        const draw = async (cancel = false) => {
          await closeTools();
          const frame = page.locator('.image-frame');
          const box = await frame.boundingBox();
          assert.ok(box);
          const client = (p) => ({
            clientX: box.x + p.x * box.width,
            clientY: box.y + p.y * box.height,
          });
          // Real pointerdown owns capture. Inject only the hardware event batch;
          // the production React handler, history, Worker and export stay intact.
          await frame.evaluate((element) =>
            element.addEventListener(
              'pointerdown',
              (event) => {
                element.dataset.qaPointer = String(event.pointerId);
              },
              { once: true },
            ),
          );
          const start = client(curve[0]);
          await page.mouse.move(start.clientX, start.clientY);
          await page.mouse.down();
          await frame.evaluate(
            (element, data) => {
              const pointerId = Number(element.dataset.qaPointer);
              if (!Number.isInteger(pointerId) || !element.hasPointerCapture(pointerId))
                throw new Error('Real input did not acquire canvas pointer capture');
              const init = {
                bubbles: true,
                pointerId,
                pointerType: 'mouse',
                buttons: 1,
                button: -1,
              };
              const event = new PointerEvent('pointermove', { ...init, ...data.summary });
              Object.defineProperty(event, 'getCoalescedEvents', {
                value: () =>
                  data.points.map(
                    (point) => new PointerEvent('pointermove', { ...init, ...point }),
                  ),
              });
              element.dispatchEvent(event);
            },
            { points: curve.slice(1).map(client), summary: client({ x: 0.35, y: 0.5 }) },
          );
          if (cancel) await page.keyboard.press('Escape');
          else
            await frame.evaluate((element, point) => {
              element.dispatchEvent(
                new PointerEvent('pointerup', {
                  bubbles: true,
                  pointerId: Number(element.dataset.qaPointer),
                  pointerType: 'mouse',
                  buttons: 0,
                  button: 0,
                  ...point,
                }),
              );
            }, client(endpoint));
          await page.mouse.up();
          await imageReady(page);
        };
        await draw();
        const drawn = await recipeDownload(page);
        const stroke = drawn.paintLayers[0].strokes[0];
        assert.equal(
          stroke.points.length,
          4,
          'one actual stroke contains the bend and short release endpoint, without the summary point',
        );
        for (const [i, point] of [...curve, endpoint].entries()) {
          assert.ok(Math.abs(stroke.points[i].x - point.x) < 1e-6);
          assert.ok(Math.abs(stroke.points[i].y - point.y) < 1e-6);
        }
        const exported = await pixelEvidence(await imageDownload(page));
        const reference = renderEditorRecipeTiled(
          { width, height, data: new Uint8ClampedArray(pixels) },
          drawn,
          { tileSize: 37 },
        );
        assert.equal(
          exported.evidence.rgbaSha256,
          sha256(reference.data),
          'actual downloaded PNG matches the reference engine at every RGBA byte',
        );
        assert.notEqual(exported.evidence.rgbaSha256, sha256(pixels));
        await tool(page, '绘制');
        await page.getByRole('button', { name: '撤销本次编辑', exact: true }).focus();
        await page.keyboard.press('Control+z');
        assert.deepEqual(
          await recipeDownload(page),
          empty,
          'all coalesced samples are one history operation',
        );
        await draw(true);
        assert.deepEqual(
          await recipeDownload(page),
          empty,
          'Escape restores the exact pre-stroke state',
        );
        await draw();
        await tool(page, '绘制');
        await page.getByRole('button', { name: '橡皮', exact: true }).click();
        await draw();
        const erased = await recipeDownload(page);
        assert.equal(erased.paintLayers[0].strokes.length, 2);
        assert.equal(erased.paintLayers[0].strokes[1].mode, 'erase');
        const erasedPng = await pixelEvidence(await imageDownload(page));
        assert.equal(
          erasedPng.evidence.rgbaSha256,
          sha256(pixels),
          'erasing the same hard stroke restores all source bytes',
        );
        await tool(page, '绘制');
        await page.getByRole('button', { name: '画笔', exact: true }).click();
        await precision(page, '直径', 8);
        await closeTools();
        const frameBox = await page.locator('.image-frame').boundingBox();
        assert.ok(frameBox);
        const cdp = await context.newCDPSession(page);
        const pen = (type, x, y, force) =>
          cdp.send('Input.dispatchMouseEvent', {
            type,
            x: frameBox.x + x * frameBox.width,
            y: frameBox.y + y * frameBox.height,
            pointerType: 'pen',
            button: 'left',
            buttons: type === 'mouseReleased' ? 0 : 1,
            clickCount: 1,
            force,
          });
        await pen('mousePressed', 0.23, 0.27, 0.14);
        await pen('mouseMoved', 0.27, 0.28, 0.35);
        await pen('mouseMoved', 0.52, -0.02, 0.55);
        await pen('mouseMoved', 0.76, 0.71, 0.79);
        await pen('mouseReleased', 0.8, 0.74, 0);
        await cdp.detach();
        await imageReady(page);
        const pressureRecipe = await recipeDownload(page);
        const pressure = pressureRecipe.paintLayers[0].strokes.at(-1).sampling;
        assert.equal(pressure?.algorithm, 'swept-v1');
        assert.equal(pressure.antialias, true);
        assert.equal(pressure.breaks.length, 1);
        assert.ok(pressure.pressure.at(-1) > pressure.pressure[0] + 0.5);
        const pressurePng = await pixelEvidence(await imageDownload(page));
        assert.equal(
          pressurePng.evidence.rgbaSha256,
          sha256(
            renderEditorRecipeTiled(
              { width, height, data: new Uint8ClampedArray(pixels) },
              pressureRecipe,
              { tileSize: 23 },
            ).data,
          ),
        );
        await tool(page, '绘制');
        await page.screenshot({
          path: join(artifacts, `freehand-${viewport.width}x${viewport.height}.png`),
        });
        await context.close();
        return {
          viewport,
          samples: stroke.points.length,
          input: 'real pointer capture with injected coalesced hardware samples',
          sourcePixels: width * height,
          exportMatchesReference: true,
          eraseRestoresSource: true,
          penPressureAndGap: true,
          undoVerified: true,
          cancelVerified: true,
          paintPanelFocus,
        };
      },
    );
  }

  const clients = [];
  for (const actor of actors) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      acceptDownloads: true,
      reducedMotion: 'reduce',
    });
    const login = await context.request.post(origin + '/v1/auth/login', {
      headers: { origin },
      data: { phone: actor.phone, password: actor.password },
    });
    assert.equal(login.status(), 200, 'test account must pass actual password verification');
    assert.equal((await login.json()).user.id, actor.id);
    const page = await watchPage(context);
    await page.goto(`${origin}/#/studio`);
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await page
      .locator('dialog.sidebar-navigation-modal')
      .getByRole('button', { name: new RegExp(`^${teamName}`) })
      .click();
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await page
      .getByRole('navigation', { name: '项目', exact: true })
      .getByRole('button', { name: projectName, exact: true })
      .click();
    await page
      .locator('.library-version-links')
      .getByRole('button', { name: new RegExp(artworkName) })
      .click();
    await page.locator('.collaboration-status[data-state="ready"]').waitFor();
    clients.push({ context, page, actor });
  }
  const [a, b] = clients;
  const request = (client, path, method = 'GET', data) =>
    client.context.request.fetch(origin + '/v1' + path, {
      method,
      headers: { origin },
      ...(data === undefined ? {} : { data }),
    });
  const readHead = async () => {
    const result = await request(a, `/artworks/${work.artwork.id}`);
    assert.equal(result.status(), 200);
    return result.json();
  };
  await caseRun(
    'same-canvas-collaboration-keeps-two-drafts-through-full-page-and-return',
    async () => {
      const page = a.page;
      const initialHead = await readHead();
      const originalFilename = await page.locator('.canvas-file-info > span').innerText();
      const canvas = await page.locator('.image-frame canvas').elementHandle();
      assert.ok(canvas);
      const draftWrites = [];
      const trackWrite = (request) => {
        const path = new URL(request.url()).pathname;
        if (
          request.method() !== 'GET' &&
          (path === `/v1/projects/${projectId}/comments` ||
            path === `/v1/projects/${projectId}/tasks`)
        )
          draftWrites.push({ method: request.method(), path });
      };
      page.on('request', trackWrite);
      let releaseComments;
      let commentsRequestStarted = false;
      let commentOwner;
      const commentsGate = new Promise((resolve) => {
        releaseComments = resolve;
      });
      const commentsPath = `**/v1/projects/${projectId}/comments`;
      const holdComments = async (route) => {
        const response = await route.fetch();
        commentsRequestStarted = true;
        await commentsGate;
        await route.fulfill({ response });
      };
      await page.route(commentsPath, holdComments);
      try {
        await tool(page, '明暗');
        await page
          .locator('.free-panel[aria-hidden="false"]')
          .getByRole('navigation', { name: '当前作品面板', exact: true })
          .getByRole('button', { name: '协作', exact: true })
          .click();
        const collaboration = page.locator('.free-panel[data-panel-id="collaboration"]');
        await collaboration.waitFor();
        assert.equal(await collaboration.getAttribute('data-display-mode'), 'panel');
        const skeleton = collaboration.locator(
          '.feature-skeleton[data-skeleton-profile="collaboration"]',
        );
        await skeleton.waitFor();
        await eventually(
          () => commentsRequestStarted,
          'the real comments response is held for loading-state inspection',
        );
        assert.equal(await skeleton.getAttribute('aria-busy'), 'true');
        assert.equal(
          await page.locator('.image-frame canvas').isVisible(),
          true,
          'actual collaboration loading keeps the photograph visible',
        );
        assert.equal(
          await canvas.evaluate(
            (node) => node.isConnected && node === document.querySelector('.image-frame canvas'),
          ),
          true,
          'the contextual collaboration tab keeps the exact canvas mounted',
        );
        releaseComments();
        await skeleton.waitFor({ state: 'hidden' });
        const comment = collaboration.getByRole('textbox', {
          name: '向项目成员发送意见',
          exact: true,
        });
        await comment.fill('保留这条未发送的协作草稿。');
        commentOwner = await comment.elementHandle();
        assert.ok(commentOwner);
        await collaboration
          .locator('.collaboration-panel-tabs')
          .getByRole('button', { name: /^任务/ })
          .click();
        const task = collaboration.getByRole('textbox', { name: '新任务标题', exact: true });
        await task.fill('这条任务先不提交');
        await collaboration
          .getByRole('button', { name: '在完整页面查看协作', exact: true })
          .click();
        await page
          .locator('.free-panel[data-panel-id="collaboration"][data-display-mode="page"]')
          .waitFor();
        assert.equal(await comment.inputValue(), '保留这条未发送的协作草稿。');
        assert.equal(await task.inputValue(), '这条任务先不提交');
        assert.equal(
          await commentOwner.evaluate(
            (node) => node.isConnected && node === document.querySelector('#comment-body'),
          ),
          true,
          'expanding uses the same discussion textarea, not a second owner',
        );
        await collaboration.getByRole('button', { name: '继续精修', exact: true }).click();
        await page.locator('.free-panel[data-panel-id="inspector"][aria-hidden="false"]').waitFor();
        await imageReady(page);
        assert.equal(
          await page.locator('.canvas-file-info > span').innerText(),
          originalFilename,
          'returning from the explicitly expanded page retains the original image',
        );
        await page
          .locator('.free-panel[aria-hidden="false"]')
          .getByRole('navigation', { name: '当前作品面板', exact: true })
          .getByRole('button', { name: '协作', exact: true })
          .click();
        await collaboration.waitFor();
        assert.equal(await task.inputValue(), '这条任务先不提交');
        await task.fill('');
        await collaboration
          .locator('.collaboration-panel-tabs')
          .getByRole('button', { name: /^项目讨论/ })
          .click();
        assert.equal(await comment.inputValue(), '保留这条未发送的协作草稿。');
        assert.equal(await page.locator('#comment-body').count(), 1);
        await comment.fill('');
        await collaboration.getByRole('button', { name: '返回当前调节', exact: true }).click();
        await collaboration.waitFor({ state: 'hidden' });
        assert.deepEqual(draftWrites, [], 'typing and navigating cannot submit a comment or task');
        assert.equal((await readHead()).artwork.headVersion, initialHead.artwork.headVersion);
        assert.deepEqual(
          await recipeDownload(page),
          initialHead.revision.recipe,
          'the complete recipe survives both the in-canvas tab and explicit full-page round trip',
        );
        await page.screenshot({ path: join(artifacts, 'same-canvas-collaboration-return.png') });
        return {
          contextualSkeleton: true,
          sameCanvas: true,
          retainedCommentOwner: true,
          unsentCommentAndTask: true,
          accidentalWrites: 0,
        };
      } finally {
        releaseComments();
        await page.unroute(commentsPath, holdComments);
        page.off('request', trackWrite);
        await commentOwner?.dispose();
        await canvas.dispose();
      }
    },
  );
  await caseRun('two-accounts-shared-edit-cursor-and-owned-undo', async () => {
    await eventually(
      async () => Number(await a.page.locator('.collaboration-summary small').textContent()) === 2,
      'both real browser sessions are present',
    );
    await tool(a.page, '明暗');
    await precision(a.page, '曝光', -0.35);
    await eventually(
      async () => (await readHead()).revision.recipe.adjustments.exposure === -0.35,
      'server immutable exposure commit',
    );
    await tool(b.page, '明暗');
    await eventually(
      async () =>
        Number(await b.page.getByRole('slider', { name: '曝光', exact: true }).inputValue()) ===
        -0.35,
      'peer DOM receives exposure',
    );
    const image = await a.page.locator('.image-frame').boundingBox();
    assert.ok(image);
    await a.page.mouse.move(image.x + image.width * 0.35, image.y + image.height * 0.4);
    await b.page.locator('.collaboration-cursor').filter({ hasText: 'CI owner' }).waitFor();
    await Promise.all([precision(a.page, '对比度', 12), precision(b.page, '曝光', -0.65)]);
    await eventually(async () => {
      const r = (await readHead()).revision.recipe;
      return r.adjustments.contrast === 12 && r.adjustments.exposure === -0.65;
    }, 'independent targets survive concurrent publication');
    await eventually(
      async () =>
        (await a.page.locator('.collaboration-status').getAttribute('data-state')) === 'ready',
      'owner commit completes',
    );
    await a.page.locator('.free-panel[aria-hidden="false"] .panel-title-drag').focus();
    await a.page.keyboard.press('Control+z');
    await eventually(async () => {
      const r = (await readHead()).revision.recipe;
      return r.adjustments.contrast === 0 && r.adjustments.exposure === -0.65;
    }, 'owned undo preserves the other user change');
    await a.page.screenshot({ path: join(artifacts, 'collaboration-owner.png') });
    await b.page.screenshot({ path: join(artifacts, 'collaboration-peer.png') });
    return { accounts: 2, sameArtwork: true, peerDomViaRealPoll: true, ownedUndo: true };
  });
  await caseRun('lease-conflict-visible-and-explicit-retry', async () => {
    // A committed head is observable before the writer's subsequent lease DELETE
    // is acknowledged. Do not confuse that normal release interval with this case.
    await eventually(async () => {
      const statuses = await Promise.all(
        clients.map(({ page }) => page.locator('.collaboration-status').getAttribute('data-state')),
      );
      if (statuses.some((state) => state !== 'ready')) return false;
      const response = await request(a, `/artworks/${work.artwork.id}/collaboration`);
      assert.equal(response.status(), 200);
      return (await response.json()).snapshot.leases.length === 0;
    }, 'previous commands acknowledged and their real leases released');
    const state = await (await request(a, `/artworks/${work.artwork.id}/collaboration`)).json();
    const session = state.snapshot.presences.find((item) => item.userId === a.actor.id);
    assert.ok(session);
    // Reserve a real backend lease as a deterministic competing writer, not a fake response.
    const held = await request(a, `/artworks/${work.artwork.id}/collaboration/leases`, 'POST', {
      sessionId: session.id,
      target: { kind: 'parameter', id: 'adjustments.exposure' },
    });
    assert.ok([200, 201].includes(held.status()), 'a real competing lease is acquired');
    const { lease } = await held.json();
    try {
      await precision(b.page, '曝光', -0.55);
      await b.page.locator('.collaboration-status[data-state="conflict"]').waitFor();
      assert.equal(
        (await readHead()).revision.recipe.adjustments.exposure,
        -0.65,
        'conflict cannot overwrite the head',
      );
    } finally {
      const released = await request(
        a,
        `/artworks/${work.artwork.id}/collaboration/leases/${lease.id}`,
        'DELETE',
        { sessionId: session.id, fence: lease.fence },
      );
      assert.ok(released.ok());
    }
    await b.page.getByRole('button', { name: '重试同步', exact: true }).click();
    await eventually(
      async () => (await readHead()).revision.recipe.adjustments.exposure === -0.55,
      'explicit retry after release',
    );
    return { realLease: true, localDraftRetained: true };
  });
  await caseRun('unknown-command-retries-original-key-without-duplicate-revision', async () => {
    let drop = true;
    const route = async (route) => {
      const response = await route.fetch();
      if (drop) {
        drop = false;
        await route.abort('failed');
      } else await route.fulfill({ response });
    };
    await b.page.route('**/collaboration/commands', route);
    try {
      await eventually(
        async () =>
          (await b.page.locator('.collaboration-status').getAttribute('data-state')) === 'ready',
        'previous commit ready',
      );
      await precision(b.page, '曝光', -0.45);
      const version = await eventually(async () => {
        const h = await readHead();
        return h.revision.recipe.adjustments.exposure === -0.45 ? h.artwork.headVersion : false;
      }, 'command actually committed before lost response');
      await b.page.locator('.collaboration-status[data-state="reconnecting"]').waitFor();
      await b.page.getByRole('button', { name: '重试同步', exact: true }).click();
      await b.page.locator('.collaboration-status[data-state="ready"]').waitFor();
      assert.equal(
        (await readHead()).artwork.headVersion,
        version,
        'same command is acknowledged, not committed twice',
      );
      return { responseLossInjected: true, version, duplicateRevisions: 0 };
    } finally {
      await b.page.unroute('**/collaboration/commands', route);
    }
  });
  await caseRun('resource-memory-privacy-and-ledger-export', async () => {
    await changeView(a.page, 'works', '作品');
    await a.page.getByRole('button', { name: '跨空间查找', exact: true }).click();
    await a.page.getByRole('searchbox', { name: '搜索资源', exact: true }).fill('CI-gradient');
    const card = a.page.locator('.resource-card').filter({ hasText: 'CI-gradient.png' });
    await card.waitFor();
    await card.getByRole('button', { name: '长期复用', exact: true }).click();
    await a.page
      .getByRole('textbox', { name: '便于查找的名称', exact: true })
      .fill('CI private memory');
    await a.page
      .getByRole('textbox', { name: '复用时要记得的说明', exact: true })
      .fill('Only this test account opted in.');
    await a.page.getByRole('button', { name: '保存个人说明', exact: true }).click();
    await eventually(async () => {
      const r = await request(a, `/assets/${assetId}/memory`);
      return (await r.json()).memory?.title === 'CI private memory';
    }, 'memory persisted');
    assert.equal(
      (await (await request(b, `/assets/${assetId}/memory`)).json()).memory,
      null,
      'team peers do not read private memory',
    );
    await changeView(a.page, 'usage', '用量');
    await a.page.getByRole('region', { name: '用量与额度历史' }).waitFor();
    await a.page.locator('.usage-table tbody tr').first().waitFor();
    const csv = await downloadBytes(a.page, () =>
      a.page.getByRole('button', { name: '导出CSV', exact: true }).click(),
    );
    assert.ok(csv.toString('utf8').includes('CI fixture negative adjustment'));
    assert.ok(csv.toString('utf8').includes('-5'));
    await a.page.getByRole('button', { name: '查看模型公开费率', exact: true }).click();
    const prices = a.page.getByRole('dialog', { name: '模型公开费率' });
    await prices.getByRole('cell', { name: 'gpt-5.4-mini', exact: true }).first().waitFor();
    await prices.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await a.page.screenshot({ path: join(artifacts, 'usage-ledger.png') });
    return { privateMemory: true, realLedgerCsv: true };
  });
  await caseRun('cloud-history-summary-pagination-opens-full-revision-draft', async () => {
    const historyTitle = `CI history ${randomUUID().slice(0, 8)}`;
    const firstRecipe = createRecipeV4({ adjustments: { exposure: -0.25, contrast: 13 } });
    const created = await request(a, `/projects/${projectId}/artworks`, 'POST', {
      assetId,
      title: historyTitle,
      recipe: firstRecipe,
    });
    assert.equal(created.status(), 201, 'the owner creates an isolated history work over HTTP');
    let saved = await created.json();
    const historyArtworkId = saved.artwork.id;
    const firstRevisionId = saved.revision.id;
    assert.equal(saved.artwork.headVersion, 1);
    for (let version = 2; version <= 105; version++) {
      const response = await request(a, `/artworks/${historyArtworkId}/revisions`, 'POST', {
        expectedVersion: version - 1,
        recipe: createRecipeV4({ adjustments: { exposure: version / 1000 } }),
        label: `CI history version ${version}`,
      });
      assert.equal(response.status(), 201, `immutable history version ${version} is created`);
      saved = await response.json();
      assert.equal(saved.artwork.headVersion, version);
    }
    const headResponse = await request(a, `/artworks/${historyArtworkId}`);
    assert.equal(headResponse.status(), 200);
    const head = await headResponse.json();
    assert.equal(head.artwork.headVersion, 105);

    // The earlier cases leave this page on usage. Reload and select the real
    // project again so its library fetch includes the newly created work.
    await a.page.reload();
    await a.page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await a.page
      .locator('dialog.sidebar-navigation-modal')
      .getByRole('button', { name: new RegExp(`^${teamName}`) })
      .click();
    await a.page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await a.page
      .getByRole('navigation', { name: '项目', exact: true })
      .getByRole('button', { name: projectName, exact: true })
      .click();
    await a.page
      .locator('.library-version-links')
      .getByRole('button', { name: new RegExp(`^${historyTitle}`) })
      .click();
    await imageReady(a.page);
    await a.page.locator('.collaboration-status[data-state="ready"]').waitFor();

    const historyPath = `/v1/artworks/${historyArtworkId}/revisions`;
    const isHistoryPage = (response, beforeVersion) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname === historyPath &&
        url.searchParams.get('summary') === 'true' &&
        url.searchParams.get('beforeVersion') === beforeVersion
      );
    };
    const [firstPageResponse] = await Promise.all([
      a.page.waitForResponse((response) => isHistoryPage(response, null)),
      changeView(a.page, 'compare', '对比'),
    ]);
    assert.equal(firstPageResponse.status(), 200);
    const firstPage = await firstPageResponse.json();
    assert.equal(firstPage.revisions.length, 100);
    assert.equal(firstPage.page.headVersion, 105);
    assert.equal(firstPage.page.nextBeforeVersion, 6);
    assert.deepEqual(
      firstPage.revisions.map((revision) => revision.version),
      Array.from({ length: 100 }, (_, index) => 105 - index),
    );
    assert.ok(firstPage.revisions.every((revision) => !Object.hasOwn(revision, 'recipe')));

    const history = a.page.locator('.saved-versions');
    await history.locator(':scope > summary').click();
    await eventually(
      async () =>
        (await history.locator('.revision-entry').count()) === 100 &&
        (await history.locator(':scope > summary').innerText()).includes('已载入 100'),
      'the first 100 summary rows are visible',
    );
    const olderPageUrl = (url) =>
      url.pathname === historyPath &&
      url.searchParams.get('summary') === 'true' &&
      url.searchParams.get('beforeVersion') === '6';
    let olderPageRequests = 0;
    const loseFirstOlderPage = async (route) => {
      olderPageRequests++;
      if (olderPageRequests === 1) await route.abort('failed');
      else await route.continue();
    };
    let secondPageResponse;
    await a.page.route(olderPageUrl, loseFirstOlderPage);
    try {
      await history.getByRole('button', { name: '加载更早版本', exact: true }).click();
      await history.getByRole('button', { name: '重试读取版本', exact: true }).waitFor();
      assert.equal(await history.locator('.revision-entry').count(), 100);
      assert.ok((await history.locator(':scope > summary').innerText()).includes('已载入 100'));
      [secondPageResponse] = await Promise.all([
        a.page.waitForResponse((response) => isHistoryPage(response, '6')),
        history.getByRole('button', { name: '重试读取版本', exact: true }).click(),
      ]);
      assert.equal(
        olderPageRequests,
        2,
        'retry keeps the same older-page cursor after one failure',
      );
    } finally {
      await a.page.unroute(olderPageUrl, loseFirstOlderPage);
    }
    assert.equal(secondPageResponse.status(), 200);
    const secondPage = await secondPageResponse.json();
    assert.deepEqual(
      secondPage.revisions.map((revision) => revision.version),
      [5, 4, 3, 2, 1],
    );
    assert.equal(secondPage.page.nextBeforeVersion, null);
    assert.ok(secondPage.revisions.every((revision) => !Object.hasOwn(revision, 'recipe')));
    await eventually(
      async () =>
        (await history.locator('.revision-entry').count()) === 105 &&
        (await history.locator(':scope > summary').innerText()).includes('已载入 105'),
      'the older page appends without dropping or duplicating history',
    );
    assert.equal(
      await history.getByRole('button', { name: '加载更早版本', exact: true }).count(),
      0,
      'no further page remains after version one',
    );
    await a.page.screenshot({ path: join(artifacts, 'history-pagination-105.png') });

    const detailPath = `${historyPath}/${firstRevisionId}`;
    const sourcePath = new URL(head.asset.url, origin).pathname;
    let detailRequests = 0;
    const countDetail = (request) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === detailPath)
        detailRequests++;
    };
    a.page.on('request', countDetail);
    try {
      const [detailResponse, sourceResponse] = await Promise.all([
        a.page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            new URL(response.url()).pathname === detailPath,
        ),
        a.page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            new URL(response.url()).pathname === sourcePath,
        ),
        history.locator('.revision-open').filter({ hasText: /V1$/ }).click(),
      ]);
      assert.equal(detailResponse.status(), 200);
      const detail = await detailResponse.json();
      assert.equal(detail.revision.id, firstRevisionId);
      assert.equal(detail.revision.version, 1);
      assert.equal(detail.revision.artworkId, historyArtworkId);
      assert.equal(detail.revision.assetId, assetId);
      assert.equal(detail.asset.id, assetId);
      assert.equal(detail.asset.projectId, projectId);
      assert.deepEqual(detail.revision.recipe, firstRecipe);
      assert.equal(sourceResponse.status(), 200);
      assert.equal(await sourceResponse.headerValue('content-length'), String(png.byteLength));
      await a.page.locator('.compare-view').waitFor({ state: 'hidden' });
      await a.page
        .getByText('历史版本 1 的底图、合成素材与配方已打开，保存将建立独立作品。', { exact: true })
        .waitFor();
      await imageReady(a.page);
      assert.equal(detailRequests, 1, 'opening a summary reads one complete immutable revision');
      const draftRecipe = await recipeDownload(a.page);
      assert.deepEqual(draftRecipe, firstRecipe, 'the old full recipe enters the real editor');
      const exported = await pixelEvidence(await imageDownload(a.page));
      const reference = renderEditorRecipeTiled(
        { width, height, data: new Uint8ClampedArray(pixels) },
        firstRecipe,
        { tileSize: 37 },
      );
      assert.equal(
        exported.evidence.rgbaSha256,
        sha256(reference.data),
        'the browser loaded the correct historical source and exported the expected pixels',
      );
      const unchanged = await request(a, `/artworks/${historyArtworkId}`);
      assert.equal(unchanged.status(), 200);
      const unchangedHead = await unchanged.json();
      assert.equal(unchangedHead.artwork.headVersion, 105);
      assert.equal(unchangedHead.revision.id, saved.revision.id);
      await a.page.screenshot({ path: join(artifacts, 'history-old-version-draft.png') });
      return {
        createdVersions: 105,
        summaryPageSizes: [100, 5],
        nextBeforeVersion: [6, null],
        summaryRecipesOmitted: true,
        olderPageNetworkFailureInjected: true,
        olderPageRequests,
        rowsRetainedAfterReadFailure: 100,
        fullRevisionRequests: detailRequests,
        openedVersion: 1,
        historicalOpenedRgbaSha256: exported.evidence.rgbaSha256,
        historicalRecipeSha256: sha256(Buffer.from(JSON.stringify(draftRecipe))),
        openedAsIndependentDraft: true,
        cloudHeadUnchanged: true,
      };
    } finally {
      a.page.off('request', countDetail);
    }
  });
  await caseRun('history-render-and-original-key-fork-preserve-local-draft', async () => {
    const sourceTitle = `CI render fork ${randomUUID().slice(0, 8)}`;
    const branchTitle = `${sourceTitle} branch`;
    const historicalRecipe = createRecipeV4({ adjustments: { exposure: -0.4, contrast: 12 } });
    const created = await request(a, `/projects/${projectId}/artworks`, 'POST', {
      assetId,
      title: sourceTitle,
      recipe: historicalRecipe,
    });
    assert.equal(created.status(), 201);
    const initial = await created.json();
    const sourceArtworkId = initial.artwork.id;
    const historicalRevisionId = initial.revision.id;
    const changed = await request(a, `/artworks/${sourceArtworkId}/revisions`, 'POST', {
      expectedVersion: 1,
      recipe: createRecipeV4({ adjustments: { exposure: 0.3 } }),
      label: 'CI later head remains untouched',
    });
    assert.equal(changed.status(), 201);
    const originalHead = await changed.json();
    await a.page.reload();
    await a.page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await a.page
      .locator('dialog.sidebar-navigation-modal')
      .getByRole('button', { name: new RegExp(`^${teamName}`) })
      .click();
    await a.page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await a.page
      .getByRole('navigation', { name: '项目', exact: true })
      .getByRole('button', { name: projectName, exact: true })
      .click();
    await a.page
      .locator('.library-version-links')
      .getByRole('button', { name: new RegExp(`^${sourceTitle}`) })
      .click();
    await imageReady(a.page);
    await a.page.locator('.collaboration-status[data-state="ready"]').waitFor();

    // A real second editor owns a conflicting lease. This leaves a genuine local
    // draft, without inventing React state or silently publishing that draft.
    const sessionResponse = await request(
      b,
      `/artworks/${sourceArtworkId}/collaboration/sessions`,
      'POST',
      {
        clientId: randomUUID(),
      },
    );
    assert.equal(sessionResponse.status(), 201);
    const peer = (await sessionResponse.json()).session;
    let held;
    try {
      const response = await request(
        b,
        `/artworks/${sourceArtworkId}/collaboration/leases`,
        'POST',
        {
          sessionId: peer.id,
          target: { kind: 'parameter', id: 'adjustments.exposure' },
        },
      );
      assert.ok(response.ok());
      held = (await response.json()).lease;
      await tool(a.page, '明暗');
      await precision(a.page, '曝光', -0.8);
      await a.page.locator('.collaboration-status[data-state="conflict"]').waitFor();
    } finally {
      if (held) {
        const response = await request(
          b,
          `/artworks/${sourceArtworkId}/collaboration/leases/${held.id}`,
          'DELETE',
          {
            sessionId: peer.id,
            fence: held.fence,
          },
        );
        assert.ok(response.ok());
      }
      const response = await request(
        b,
        `/artworks/${sourceArtworkId}/collaboration/sessions/${peer.id}`,
        'DELETE',
      );
      assert.ok(response.ok());
    }
    const localDraft = await recipeDownload(a.page);
    assert.equal(localDraft.adjustments.exposure, -0.8);
    await changeView(a.page, 'compare', '对比');
    const history = a.page.locator('.saved-versions');
    await history.locator(':scope > summary').click();
    const historicalRow = history.locator('.revision-entry').filter({
      has: a.page.locator('.revision-open').filter({ hasText: /V1$/ }),
    });
    await historicalRow.locator('.revision-more > summary').click();
    const renderInfoPath = `/v1/artworks/${sourceArtworkId}/revisions/${historicalRevisionId}/render-info`;
    const [infoResponse] = await Promise.all([
      a.page.waitForResponse((response) => new URL(response.url()).pathname === renderInfoPath),
      historicalRow.locator('.revision-render > summary').click(),
    ]);
    assert.equal(infoResponse.status(), 200);
    const renderInfo = await infoResponse.json();
    assert.equal(renderInfo.artworkId, sourceArtworkId);
    assert.equal(renderInfo.revisionId, historicalRevisionId);
    assert.equal(renderInfo.version, 1);
    assert.equal(renderInfo.source.assetId, assetId);
    assert.equal(renderInfo.source.kind, 'canonical');
    assert.equal(renderInfo.pixelFormat, 'srgb-rgba8');
    assert.equal(renderInfo.available, true);
    assert.deepEqual(renderInfo.output, { width, height });
    const renderPath = renderInfoPath.replace(/-info$/, '');
    const [renderResponse, renderedBytes] = await Promise.all([
      a.page.waitForResponse((response) => new URL(response.url()).pathname === renderPath),
      downloadBytes(a.page, () =>
        historicalRow.getByRole('button', { name: '下载 PNG', exact: true }).click(),
      ),
    ]);
    assert.equal(renderResponse.status(), 200);
    assert.equal(renderResponse.headers()['x-xiutu-revision'], historicalRevisionId);
    assert.equal(renderResponse.headers()['x-xiutu-pixel-format'], 'srgb-rgba8');
    const rendered = await pixelEvidence(renderedBytes);
    const reference = renderEditorRecipeTiled(
      { width, height, data: new Uint8ClampedArray(pixels) },
      historicalRecipe,
      { tileSize: 37 },
    );
    assert.equal(rendered.evidence.rgbaSha256, sha256(reference.data));
    await writeFile(join(artifacts, 'history-server-render-v1.png'), renderedBytes);

    const forkPath = `/v1/artworks/${sourceArtworkId}/fork-revision`;
    const forkUrl = (url) => url.pathname === forkPath;
    const submitted = [];
    let firstReceipt;
    let replayReceipt;
    let releaseLostReply;
    const lostReplyGate = new Promise((resolve) => {
      releaseLostReply = resolve;
    });
    const forkRoute = async (route) => {
      const attempt = submitted.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (attempt === 1) {
        assert.equal(response.status(), 201, 'the first request really creates a branch');
        firstReceipt = await response.json();
        await lostReplyGate;
        await route.abort('failed');
      } else {
        assert.equal(response.status(), 200, 'the same request replays its original receipt');
        replayReceipt = await response.json();
        await route.fulfill({ response });
      }
    };
    const refusedOpen = [];
    await a.page.route(forkUrl, forkRoute);
    try {
      await historicalRow.getByRole('button', { name: '从此版本建分支', exact: true }).click();
      let dialog = a.page.getByRole('dialog', { name: '从历史版本创建分支', exact: true });
      await dialog.getByLabel('新作品名称', { exact: true }).fill(branchTitle);
      await dialog.getByRole('button', { name: '创建并打开', exact: true }).click();
      await eventually(() => firstReceipt, 'the original fork was accepted by the real server');
      assert.equal(await dialog.locator('button[type="submit"]').isDisabled(), true);
      // Native form submissions while the HTTP acknowledgement is pending must
      // be guarded synchronously, including before the next React paint.
      await dialog.locator('form').evaluate((form) => {
        form.requestSubmit();
        form.requestSubmit();
      });
      await a.page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(submitted.length, 1, 'an in-flight operation cannot submit a second request');
      releaseLostReply();
      await dialog.getByRole('button', { name: '继续原请求', exact: true }).waitFor();
      assert.equal(await dialog.getByLabel('新作品名称', { exact: true }).isDisabled(), true);
      await dialog.getByRole('button', { name: '稍后处理', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await historicalRow.getByRole('button', { name: '从此版本建分支', exact: true }).click();
      dialog = a.page.getByRole('dialog', { name: '从历史版本创建分支', exact: true });
      await dialog.getByRole('button', { name: '继续原请求', exact: true }).waitFor();
      assert.equal(
        await dialog.getByLabel('新作品名称', { exact: true }).inputValue(),
        branchTitle,
      );
      await a.page.removeLocatorHandler(
        a.page.getByRole('dialog', { name: '确认操作', exact: true }),
      );
      await dialog.getByRole('button', { name: '继续原请求', exact: true }).click();
      const replaceConfirmation = a.page.getByRole('dialog', { name: '确认操作', exact: true });
      await replaceConfirmation.waitFor();
      refusedOpen.push(await replaceConfirmation.innerText());
      await replaceConfirmation.getByRole('button', { name: '取消', exact: true }).click();
      await replaceConfirmation.waitFor({ state: 'hidden' });
      const savedDialog = a.page.getByRole('dialog', { name: '分支已创建', exact: true });
      await savedDialog.getByRole('button', { name: '打开已创建分支', exact: true }).waitFor();
      assert.equal(refusedOpen.length, 1);
      assert.match(refusedOpen[0], /未保存/);
      assert.equal(submitted.length, 2);
      assert.deepEqual(
        submitted[1],
        submitted[0],
        'recovery keeps the frozen source, title and original key',
      );
      assert.deepEqual(Object.keys(submitted[0]).sort(), ['idempotencyKey', 'revisionId', 'title']);
      assert.equal(submitted[0].revisionId, historicalRevisionId);
      assert.equal(replayReceipt.artwork.id, firstReceipt.artwork.id);
      assert.equal(replayReceipt.revision.id, firstReceipt.revision.id);
      assert.equal(replayReceipt.replayed, true);
      await savedDialog.getByRole('button', { name: '稍后处理', exact: true }).click();
      await savedDialog.waitFor({ state: 'hidden' });
      const retainedDraft = await recipeDownload(a.page);
      assert.deepEqual(
        retainedDraft,
        localDraft,
        'declining to open keeps every field of the local draft',
      );
      await acceptDefaultConfirmations(a.page);
      await changeView(a.page, 'compare', '对比');
      await history.locator(':scope > summary').click();
      await historicalRow.locator('.revision-more > summary').click();
      await historicalRow.getByRole('button', { name: '从此版本建分支', exact: true }).click();
      const recovered = a.page.getByRole('dialog', { name: '分支已创建', exact: true });
      await recovered.getByRole('button', { name: '打开已创建分支', exact: true }).click();
      // An actionability check lets the common confirmation handler accept this
      // explicitly requested replacement before waiting for the new work.
      await a.page.getByRole('button', { name: '保存', exact: true }).click({ trial: true });
      await recovered.waitFor({ state: 'hidden' });
      await imageReady(a.page);
      await a.page.getByText(`已打开「${branchTitle}」版本 1。`, { exact: true }).waitFor();
      assert.equal(submitted.length, 2, 'opening an accepted receipt never creates another branch');
      assert.deepEqual(await recipeDownload(a.page), historicalRecipe);
      const unchanged = await request(a, `/artworks/${sourceArtworkId}`);
      assert.equal(unchanged.status(), 200);
      const head = await unchanged.json();
      assert.equal(head.artwork.headVersion, 2);
      assert.equal(head.revision.id, originalHead.revision.id);
      assert.deepEqual(head.revision.recipe, originalHead.revision.recipe);
      const opened = await request(a, `/artworks/${firstReceipt.artwork.id}`);
      assert.equal(opened.status(), 200);
      const branch = await opened.json();
      assert.notEqual(branch.artwork.id, sourceArtworkId);
      assert.equal(branch.artwork.projectId, projectId);
      assert.equal(branch.artwork.headVersion, 1);
      assert.equal(branch.asset.id, assetId);
      assert.equal(branch.revision.assetId, assetId);
      assert.equal(branch.revision.origin.kind, 'history-fork');
      assert.equal(branch.revision.origin.sourceRevisionId, historicalRevisionId);
      assert.deepEqual(branch.revision.recipe, historicalRecipe);
      // Project detail is the actual read endpoint; /artworks beneath a project
      // is a POST-only creation route.
      const listing = await request(a, `/projects/${projectId}`);
      assert.equal(listing.status(), 200);
      const projectDetail = await listing.json();
      assert.equal(projectDetail.project.id, projectId);
      const branches = projectDetail.artworks.filter((item) => item.title === branchTitle);
      assert.equal(branches.length, 1);
      assert.equal(branches[0].id, firstReceipt.artwork.id);
      await a.page.screenshot({ path: join(artifacts, 'history-fork-opened-once.png') });
      return {
        renderInfo: {
          available: renderInfo.available,
          sourceKind: renderInfo.source.kind,
          output: renderInfo.output,
          pixelFormat: renderInfo.pixelFormat,
        },
        rendered: rendered.evidence,
        actualPngMatchesReference: true,
        forkPostCount: submitted.length,
        originalKeyAndBodyRetained: true,
        lostAcceptedReceiptRecovered: true,
        refusedOpenPreservesDraftAndReceipt: true,
        sourceHeadUnchanged: true,
        independentBranchCount: branches.length,
        historicalSourceAndRecipePreserved: true,
      };
    } finally {
      releaseLostReply();
      await a.page.unroute(forkUrl, forkRoute);
      await a.page.removeLocatorHandler(
        a.page.getByRole('dialog', { name: '确认操作', exact: true }),
      );
      await acceptDefaultConfirmations(a.page);
    }
  });

  await caseRun('phone-document-list-keeps-unsaved-draft-and-cas-save', async () => {
    await a.page.setViewportSize({ width: 390, height: 844 });
    await changeView(a.page, 'docs', '文档');
    const list = a.page.getByRole('complementary', { name: '项目文档列表', exact: true });
    const receipt = a.page.locator('.document-editor-label');
    const waitForSavedVersion = async (version) => {
      await receipt.getByText(`版本 ${version}`, { exact: true }).waitFor();
      await receipt.getByText('已保存', { exact: true }).waitFor();
    };
    await list.getByRole('button', { name: '新建文档', exact: true }).click();
    const title = `CI phone document ${randomUUID().slice(0, 8)}`;
    const initialBody = '真实手机文档初稿。';
    const editedBody = `${initialBody}\n返回列表和刷新列表后，这一段仍应保留。`;
    const readDocument = async (match) => {
      const response = await request(a, `/projects/${projectId}/documents`);
      assert.equal(response.status(), 200);
      const document = (await response.json()).documents.find(match);
      assert.ok(document, 'The saved document must be visible to the project member');
      return document;
    };
    await a.page.getByLabel('文档标题', { exact: true }).fill(title);
    await a.page.getByLabel('文档内容', { exact: true }).fill(initialBody);
    const [createdResponse] = await Promise.all([
      a.page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `/v1/projects/${projectId}/documents`,
      ),
      a.page.getByRole('button', { name: '保存文档', exact: true }).click(),
    ]);
    assert.equal(createdResponse.status(), 201);
    await waitForSavedVersion(1);
    const document = await readDocument((item) => item.title === title);
    assert.equal(document.version, 1);
    assert.equal(document.body, initialBody);
    await a.page.getByLabel('文档内容', { exact: true }).fill(editedBody);
    await a.page.getByRole('button', { name: '文档列表', exact: true }).click();
    assert.equal(
      await a.page.locator('.documents-layout').getAttribute('data-mobile-view'),
      'list',
    );
    assert.equal(await a.page.getByLabel('文档内容', { exact: true }).isVisible(), false);
    const [refreshResponse] = await Promise.all([
      a.page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === `/v1/projects/${projectId}/documents`,
      ),
      list.getByRole('button', { name: '刷新列表', exact: true }).click(),
    ]);
    assert.equal(refreshResponse.status(), 200);
    const persistedBefore = await readDocument((item) => item.id === document.id);
    assert.equal(persistedBefore.body, initialBody, 'returning to the list must not silently save');
    const confirmations = [];
    await a.page.removeLocatorHandler(
      a.page.getByRole('dialog', { name: '确认操作', exact: true }),
    );
    try {
      await list.getByRole('button', { name: '新建文档', exact: true }).click();
      const discardConfirmation = a.page.getByRole('dialog', { name: '确认操作', exact: true });
      await discardConfirmation.waitFor();
      confirmations.push(await discardConfirmation.innerText());
      await discardConfirmation.getByRole('button', { name: '取消', exact: true }).click();
      await discardConfirmation.waitFor({ state: 'hidden' });
      assert.equal(confirmations.length, 1);
      assert.match(confirmations[0], /未保存/);
      await list.getByRole('button', { name: '继续编辑当前文档', exact: true }).click();
      assert.equal(await a.page.getByLabel('文档标题', { exact: true }).inputValue(), title);
      assert.equal(await a.page.getByLabel('文档内容', { exact: true }).inputValue(), editedBody);
      await a.page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
      const sidebar = a.page.locator('dialog.sidebar-navigation-modal');
      // This existing owner fixture is also an actual operator. Both entries
      // must ask before unmounting the dirty document, and cancellation must
      // preserve it without opening a new-project form or the operator page.
      for (const label of ['新建项目', '运营管理']) {
        await sidebar.getByRole('button', { name: label, exact: true }).click();
        await discardConfirmation.waitFor();
        const message = await discardConfirmation.innerText();
        assert.match(message, /未保存/);
        assert.ok(message.includes(label));
        await discardConfirmation.getByRole('button', { name: '取消', exact: true }).click();
        await discardConfirmation.waitFor({ state: 'hidden' });
        assert.equal(await a.page.getByLabel('文档标题', { exact: true }).inputValue(), title);
        assert.equal(await a.page.getByLabel('文档内容', { exact: true }).inputValue(), editedBody);
        assert.equal(
          await a.page.getByRole('dialog', { name: '新建项目', exact: true }).count(),
          0,
        );
      }
      await a.page.screenshot({ path: join(artifacts, 'sidebar-close-phone.png'), fullPage: true });
      await sidebar.getByRole('button', { name: '关闭窗口', exact: true }).click();
      const closedNavigation = await navigationClosed(a.page);
      await a.page.getByLabel('文档内容', { exact: true }).click({ trial: true });
      assert.equal(await a.page.getByLabel('文档内容', { exact: true }).inputValue(), editedBody);
      await a.page.screenshot({ path: join(artifacts, 'phone-document-cancelled-navigation.png') });
      const [savedResponse] = await Promise.all([
        a.page.waitForResponse(
          (response) =>
            response.request().method() === 'PATCH' &&
            new URL(response.url()).pathname === `/v1/documents/${document.id}`,
        ),
        a.page.getByRole('button', { name: '保存文档', exact: true }).click(),
      ]);
      assert.equal(savedResponse.status(), 200);
      assert.deepEqual(savedResponse.request().postDataJSON(), {
        title,
        body: editedBody,
        expectedVersion: 1,
      });
      await waitForSavedVersion(2);
      const saved = await readDocument((item) => item.id === document.id);
      assert.equal(saved.version, 2);
      assert.equal(saved.body, editedBody);
      await a.page.getByRole('button', { name: '文档列表', exact: true }).click();
      await list.locator('.document-row').filter({ hasText: title }).click();
      assert.equal(await a.page.getByLabel('文档内容', { exact: true }).inputValue(), editedBody);
      const geometry = await a.page.evaluate(() => ({
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(
        geometry.scrollWidth <= geometry.viewport + 1,
        'phone document editor has no page overflow',
      );
      await a.page.screenshot({ path: join(artifacts, 'phone-document-retained-draft.png') });
      return {
        viewport: { width: 390, height: 844 },
        draftSurvivesListAndRefresh: true,
        refusedReplacement: true,
        newProjectNavigationCancelled: true,
        operatorNavigationCancelled: true,
        closedNavigation,
        expectedVersion: 1,
        savedVersion: 2,
        geometry,
      };
    } finally {
      await acceptDefaultConfirmations(a.page);
    }
  });

  await caseRun('document-theme-persists-through-navigation-dialog-and-usage', async () => {
    const page = a.page;
    const readTheme = () =>
      page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        preference: localStorage.getItem('image-workspace:theme'),
      }));
    const surfaceEvidence = async (locator, background) =>
      eventually(async () => {
        const value = await locator.evaluate((element, background) => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = background;
          probe.style.color = 'var(--ink)';
          document.body.append(probe);
          const expected = getComputedStyle(probe);
          const actual = getComputedStyle(element);
          const result = {
            background: actual.backgroundColor,
            foreground: actual.color,
            expectedBackground: expected.backgroundColor,
            expectedForeground: expected.color,
          };
          probe.remove();
          return result;
        }, background);
        return value.background === value.expectedBackground &&
          value.foreground === value.expectedForeground
          ? value
          : false;
      }, `the ${background} surface finishes its theme transition`);
    const assertSurface = (value, label) => {
      assert.equal(
        value.background,
        value.expectedBackground,
        `${label} follows the document surface token`,
      );
      assert.equal(
        value.foreground,
        value.expectedForeground,
        `${label} follows the document text token`,
      );
      assert.notEqual(
        value.background,
        value.foreground,
        `${label} has distinct text and surface colors`,
      );
    };
    await page.getByRole('button', { name: '布局与工作台设置', exact: true }).click();
    let settings = page.getByRole('dialog', { name: '工作台设置', exact: true });
    await settings
      .getByRole('group', { name: '外观模式', exact: true })
      .getByRole('button', { name: '深色', exact: true })
      .click();
    await eventually(async () => {
      const value = await readTheme();
      return value.theme === 'dark' && value.preference === 'dark';
    }, 'dark preference is stored at document scope');
    const darkDialog = await surfaceEvidence(settings, 'var(--surface-raised)');
    assertSurface(darkDialog, 'settings dialog');
    await page.screenshot({ path: join(artifacts, 'theme-dark-settings-phone.png') });
    await settings.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '切换工作视图', exact: true }).click();
    const navigation = page.getByRole('dialog', { name: '工作视图', exact: true });
    const darkNavigation = await surfaceEvidence(navigation, 'var(--surface-raised)');
    assertSurface(darkNavigation, 'navigation dialog');
    await navigation.locator('button[data-view="usage"]').click();
    await navigation.waitFor({ state: 'hidden' });
    const usage = page.getByRole('region', { name: '用量与额度历史', exact: true });
    const usageFilter = usage.getByLabel('开始日期', { exact: true });
    const usageCapacity = usage.locator('.usage-capacity');
    await usageCapacity.waitFor();
    const darkUsageFilter = await surfaceEvidence(usageFilter, 'var(--surface-secondary)');
    assertSurface(darkUsageFilter, 'usage date filter');
    const darkUsage = await surfaceEvidence(usageCapacity, 'transparent');
    assertSurface(darkUsage, 'usage capacity card');
    assert.deepEqual(await readTheme(), { theme: 'dark', preference: 'dark' });
    await page.screenshot({ path: join(artifacts, 'theme-dark-usage-phone.png') });
    await page.setViewportSize({ width: 1440, height: 960 });
    assert.deepEqual(await readTheme(), { theme: 'dark', preference: 'dark' });
    await page.reload();
    await eventually(async () => {
      const value = await readTheme();
      return value.theme === 'dark' && value.preference === 'dark';
    }, 'theme survives resize and a real reload');
    await page.getByRole('button', { name: '布局与工作台设置', exact: true }).click();
    settings = page.getByRole('dialog', { name: '工作台设置', exact: true });
    assert.equal(
      await settings
        .getByRole('button', { name: '深色', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await settings.getByRole('button', { name: '浅色', exact: true }).click();
    await eventually(
      async () => (await readTheme()).theme === 'light',
      'light preference applies to the open dialog',
    );
    const lightDialog = await surfaceEvidence(settings, 'var(--surface-raised)');
    assertSurface(lightDialog, 'light settings dialog');
    assert.notEqual(lightDialog.background, darkDialog.background);
    await settings.getByRole('button', { name: '跟随系统', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await eventually(async () => {
      const value = await readTheme();
      return value.theme === 'dark' && value.preference === 'system';
    }, 'system dark preference is observed');
    await page.emulateMedia({ colorScheme: 'light' });
    await eventually(async () => {
      const value = await readTheme();
      return value.theme === 'light' && value.preference === 'system';
    }, 'system light preference is observed');
    await settings.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    await changeView(page, 'usage', '用量');
    await usageCapacity.waitFor();
    const lightUsageFilter = await surfaceEvidence(usageFilter, 'var(--surface-secondary)');
    assertSurface(lightUsageFilter, 'light usage date filter');
    const lightUsage = await surfaceEvidence(usageCapacity, 'transparent');
    assertSurface(lightUsage, 'light usage capacity card');
    assert.notEqual(darkUsageFilter.background, lightUsageFilter.background);
    assert.notEqual(darkUsage.foreground, lightUsage.foreground);
    await page.screenshot({ path: join(artifacts, 'theme-light-usage-desktop.png') });
    return {
      darkDialog,
      darkNavigation,
      darkUsage,
      darkUsageFilter,
      lightDialog,
      lightUsage,
      lightUsageFilter,
      persistsAcrossViewportAndReload: true,
      followsBothSystemSchemes: true,
    };
  });

  await caseRun('continuous-pointer-drag-renders-intermediate-canvas-pixels', async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: 'no-preference',
      acceptDownloads: true,
    });
    let page;
    const diagnostic = { state: 'running', neutral: null, heldSamples: [], gesture: null };
    const saveDiagnostic = async (state) => {
      diagnostic.state = state;
      if (page && !page.isClosed())
        diagnostic.gesture = await page.evaluate(() => {
          const trace = window.continuousPreviewTrace;
          if (!trace) return null;
          return { down: trace.down, endedAt: trace.endedAt, events: trace.events };
        });
      await writeFile(
        join(artifacts, 'continuous-preview-gesture.json'),
        JSON.stringify(diagnostic, null, 2) + '\n',
      );
    };
    try {
      page = await watchPage(context);
      await page.goto(`${origin}/#/studio`);
      await page
        .getByLabel('选择照片', { exact: true })
        .setInputFiles({ name: 'CI-continuous-preview.png', mimeType: 'image/png', buffer: png });
      await imageReady(page);
      await tool(page, '明暗');
      await precision(page, '曝光', 0);
      await imageReady(page);
      const range = page.getByRole('slider', { name: '曝光', exact: true });
      await range.scrollIntoViewIfNeeded();
      await range.click({ trial: true });
      await range.evaluate((element) => {
        const trace = (window.continuousPreviewTrace = {
          control: element,
          down: null,
          endedAt: null,
          buttons: 0,
          events: [],
        });
        element.addEventListener(
          'pointerdown',
          (event) => {
            element.dataset.qaPreviewPointer = String(event.pointerId);
            element.dataset.qaPreviewStart = String(performance.now());
            trace.buttons = event.buttons;
            trace.down = {
              at: Number(element.dataset.qaPreviewStart),
              pointerId: event.pointerId,
              pointerType: event.pointerType,
              trusted: event.isTrusted,
              buttons: event.buttons,
            };
          },
          { once: true },
        );
        function end(event) {
          if (String(event.pointerId) === element.dataset.qaPreviewPointer) {
            trace.endedAt = performance.now();
            trace.buttons = event.buttons;
            delete element.dataset.qaPreviewPointer;
          }
        }
        document.addEventListener('pointerup', end, true);
        document.addEventListener('pointercancel', end, true);
        const describe = (node) =>
          node instanceof Element
            ? `${node.tagName.toLowerCase()}#${node.id}[${node.getAttribute('aria-label') ?? ''}]`
            : node === window
              ? 'window'
              : node === document
                ? 'document'
                : String(node?.nodeName);
        const record = (event) => {
          if (event.type === 'pointermove' && event.pointerId === trace.down?.pointerId)
            trace.buttons = event.buttons;
          const box = element.getBoundingClientRect();
          trace.events.push({
            type: event.type,
            at: performance.now(),
            pointerId: event.pointerId ?? null,
            buttons: event.buttons ?? null,
            x: event.clientX ?? null,
            y: event.clientY ?? null,
            target: describe(event.target),
            path: event.composedPath().slice(0, 8).map(describe),
            trusted: event.isTrusted,
            captured: trace.down ? element.hasPointerCapture(trace.down.pointerId) : false,
            connected: element.isConnected,
            focus: describe(document.activeElement),
            visibility: document.visibilityState,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
          });
        };
        for (const type of [
          'pointerdown',
          'pointermove',
          'pointerup',
          'pointercancel',
          'gotpointercapture',
          'lostpointercapture',
          'focus',
          'blur',
          'visibilitychange',
        ])
          document.addEventListener(type, record, true);
        window.addEventListener('blur', record);
      });
      const sample = async () => {
        const value = await range.evaluate(async (element) => {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const visible = document.querySelector('.image-frame canvas');
          if (!(visible instanceof HTMLCanvasElement)) throw new Error('No actual preview canvas');
          const sampleCanvas = document.createElement('canvas');
          sampleCanvas.width = 16;
          sampleCanvas.height = 16;
          const drawing = sampleCanvas.getContext('2d', { willReadFrequently: true });
          if (!drawing) throw new Error('Sampling context unavailable');
          drawing.drawImage(visible, 0, 0, 16, 16);
          const rgba = Array.from(drawing.getImageData(0, 0, 16, 16).data);
          const trace = window.continuousPreviewTrace;
          const box = element.getBoundingClientRect();
          return {
            rgba,
            width: visible.width,
            height: visible.height,
            exposure: Number(element.value),
            held: element.dataset.qaPreviewPointer !== undefined,
            captured: trace.down ? element.hasPointerCapture(trace.down.pointerId) : false,
            pointerId: element.dataset.qaPreviewPointer ?? null,
            pointerEndedAt: trace.endedAt,
            buttons: trace.buttons,
            sameControl: trace.control === element,
            connected: element.isConnected,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
            elapsedMs: element.dataset.qaPreviewStart
              ? performance.now() - Number(element.dataset.qaPreviewStart)
              : 0,
          };
        });
        let sum = 0;
        for (let index = 0; index < value.rgba.length; index += 4)
          sum +=
            0.2126 * value.rgba[index] +
            0.7152 * value.rgba[index + 1] +
            0.0722 * value.rgba[index + 2];
        const { rgba, ...detail } = value;
        return { ...detail, rgbaSha256: sha256(Buffer.from(rgba)), meanLuma: sum / 256 };
      };
      const neutral = await sample();
      diagnostic.neutral = neutral;
      const box = await range.boundingBox();
      assert.ok(box);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      diagnostic.pressPoint = point;
      diagnostic.hitTest = await range.evaluate((element, at) => {
        const target = document.elementFromPoint(at.x, at.y);
        return { isControl: target === element || element.contains(target), tag: target?.tagName };
      }, point);
      assert.equal(diagnostic.hitTest.isControl, true, 'the actual press position hits the slider');
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      const samples = diagnostic.heldSamples;
      try {
        assert.ok(
          await range.getAttribute('data-qa-preview-pointer'),
          'the range received pointerdown',
        );
        const down = await page.evaluate(() => window.continuousPreviewTrace.down);
        assert.ok(
          down?.trusted && down.pointerType === 'mouse' && down.buttons === 1,
          'the control receives an actual left-button pointerdown',
        );
        for (let index = 0; index < 32; index++) {
          await page.mouse.move(box.x + box.width * (0.53 + index * 0.009), box.y + box.height / 2);
          await sleep(45);
          samples.push(await sample());
        }
      } finally {
        await page.mouse.up();
        await saveDiagnostic('sampled');
      }
      assert.ok(
        samples.every((value) => value.held),
        'all intermediate evidence is taken before pointer release',
      );
      assert.ok(
        samples.every(
          (value) =>
            value.sameControl &&
            value.connected &&
            value.pointerEndedAt === null &&
            value.pointerId === String(diagnostic.gesture.down.pointerId) &&
            (value.buttons & 1) === 1,
        ),
        'all samples retain the same control and pressed pointer without an up or cancel',
      );
      const changed = samples.filter(
        (value) =>
          value.rgbaSha256 !== neutral.rgbaSha256 && value.meanLuma > neutral.meanLuma + 0.5,
      );
      assert.ok(
        new Set(changed.map((value) => value.rgbaSha256)).size >= 2,
        'at least two genuinely brightened canvas frames are visible during the continuous drag',
      );
      assert.ok(
        Math.max(...changed.map((value) => value.meanLuma)) -
          Math.min(...changed.map((value) => value.meanLuma)) >
          0.1,
        'intermediate pixel evidence includes changing brightness, not only control labels',
      );
      await imageReady(page);
      const finalRecipe = await recipeDownload(page);
      const exported = await pixelEvidence(await imageDownload(page));
      const reference = renderEditorRecipeTiled(
        { width, height, data: new Uint8ClampedArray(pixels) },
        finalRecipe,
        { tileSize: 37 },
      );
      assert.equal(exported.evidence.rgbaSha256, sha256(reference.data));
      await tool(page, '明暗');
      const finalCanvas = await canvasEvidence(page);
      assert.equal(
        finalCanvas.evidence.rgbaSha256,
        exported.evidence.rgbaSha256,
        'settled preview matches the actual final export at full fixture size',
      );
      await page.screenshot({ path: join(artifacts, 'continuous-preview-settled.png') });
      await saveDiagnostic('passed');
      return {
        source: '600x400 technical gradient; no recognition model',
        neutral,
        heldSamples: samples,
        changedHeldFrames: new Set(changed.map((value) => value.rgbaSha256)).size,
        firstVisibleChangeMs: changed[0].elapsedMs,
        finalExposure: finalRecipe.adjustments.exposure,
        finalCanvas: finalCanvas.evidence,
        exported: exported.evidence,
        finalExportMatchesReference: true,
        latencyIsMeasurementNotFpsGate: true,
      };
    } catch (error) {
      diagnostic.failure = String(error.stack ?? error);
      const captures = await Promise.allSettled([
        saveDiagnostic('failed'),
        page && !page.isClosed()
          ? page.screenshot({
              path: join(artifacts, 'continuous-preview-failure.png'),
              fullPage: true,
            })
          : Promise.resolve(),
      ]);
      for (const capture of captures)
        if (capture.status === 'rejected')
          process.stderr.write(`Continuous-preview diagnostic capture failed: ${capture.reason}\n`);
      throw error;
    } finally {
      await context.close();
    }
  });
  await caseRun('project-library-imports-real-gif-and-edits-its-frames', async () => {
    const { page } = a;
    const desktop = page.viewportSize();
    const viewportEvidence = [];
    // The theme case deliberately reloads the app. Re-select this isolated
    // fixture through the real navigation instead of inheriting a prior view.
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await page
      .locator('dialog.sidebar-navigation-modal')
      .getByRole('button', { name: new RegExp(`^${teamName}`) })
      .click();
    const afterTeamSelection = await navigationClosed(page);
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    const [projectResponse, assetsResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === `/v1/projects/${projectId}`,
      ),
      page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === `/v1/projects/${projectId}/assets`,
      ),
      page
        .getByRole('navigation', { name: '项目', exact: true })
        .getByRole('button', { name: projectName, exact: true })
        .click(),
    ]);
    assert.equal(projectResponse.status(), 200);
    assert.equal((await projectResponse.json()).project.id, projectId);
    assert.equal(assetsResponse.status(), 200);
    assert.ok(
      (await assetsResponse.json()).assets.some(
        (asset) => asset.id === assetId && asset.projectId === projectId,
      ),
      'the project asset listing contains the actual collage source',
    );
    const afterProjectSelection = await navigationClosed(page);
    async function checkDialog(layout, name, action) {
      for (const [width, height] of [
        [1440, 960],
        [1024, 768],
        [390, 844],
        [320, 700],
        [844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await layout.getByRole('button', { name: action }).scrollIntoViewIfNeeded();
        const bounds = await layout.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            horizontalOverflow: node.scrollWidth - node.clientWidth,
          };
        });
        assert.ok(bounds.width <= width && bounds.height <= height, JSON.stringify(bounds));
        assert.ok(bounds.horizontalOverflow <= 1, JSON.stringify(bounds));
        await layout
          .getByRole('button', { name: '关闭窗口', exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(artifacts, `${name}-${width}x${height}.png`) });
        viewportEvidence.push({ name, viewport: `${width}×${height}`, ...bounds });
      }
      await page.setViewportSize(desktop);
    }
    await changeView(page, 'works', '作品');
    await page.getByRole('button', { name: '拼图与 GIF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '拼图与 GIF', exact: true });
    const raw = Buffer.alloc(16 * 12 * 4 * 2);
    for (let at = 0; at < raw.length; at += 4)
      raw.set(at < raw.length / 2 ? [221, 21, 19, 255] : [16, 29, 209, 255], at);
    const gif = await sharp(raw, { raw: { width: 16, height: 24, pageHeight: 12, channels: 4 } })
      .gif({ delay: [70, 120], loop: 0 })
      .toBuffer();
    await dialog
      .getByLabel('导入 GIF')
      .setInputFiles({ name: 'QA-motion.gif', mimeType: 'image/gif', buffer: gif });
    await dialog.getByRole('button', { name: '保留全部帧并导入' }).click();
    await dialog.getByRole('status').filter({ hasText: 'QA-motion.gif' }).waitFor();
    await checkDialog(dialog, 'project-asset-tools', '保留全部帧并导入');
    const sourcePicker = dialog.locator('.asset-tool-assets');
    const sourceSummary = sourcePicker.locator(':scope > summary');
    if ((await sourceSummary.getAttribute('aria-expanded')) !== 'true') await sourceSummary.click();
    await sourcePicker.getByRole('checkbox', { name: /^CI-gradient\.png/ }).check();
    await sourcePicker.getByRole('checkbox', { name: /^QA-motion\.gif/ }).check();
    await dialog.getByRole('spinbutton', { name: '画布宽' }).fill('64');
    await dialog.getByRole('spinbutton', { name: '画布高' }).fill('40');
    await dialog.getByRole('spinbutton', { name: '间距' }).fill('3');
    await dialog.getByRole('checkbox', { name: '透明间距' }).check();
    const collagePending = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/derived-assets'),
    );
    await dialog.getByRole('button', { name: '生成拼图素材', exact: true }).click();
    const collageResponse = await collagePending;
    assert.equal(collageResponse.status(), 201);
    const { asset: collage } = await collageResponse.json();
    assert.equal(collage.width, 64);
    assert.equal(collage.height, 40);
    assert.equal(collage.source, 'derived');
    const collageFile = await a.context.request.get(new URL(collage.url, origin).href);
    assert.equal(collageFile.status(), 200);
    const collagePixels = await sharp(await collageFile.body())
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.equal(collagePixels[3], 0);
    const gifCell = (20 * 64 + 50) * 4;
    assert.deepEqual([...collagePixels.subarray(gifCell, gifCell + 4)], [221, 21, 19, 255]);
    await dialog.getByRole('status').filter({ hasText: '拼图.png' }).waitFor();
    await dialog.getByRole('button', { name: '关闭窗口', exact: true }).click();
    const animationCard = page.locator('.library-asset').filter({ hasText: 'QA-motion.gif' });
    const summary = animationCard.locator('.library-asset-details > summary');
    await summary.click();
    assert.equal(await summary.getAttribute('aria-expanded'), 'true');
    const refresh = page
      .locator('.library-status-actions')
      .getByRole('button', { name: '刷新', exact: true });
    const [refreshed] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === `/v1/projects/${projectId}/assets` &&
          new URL(response.url()).searchParams.get('limit') === '50',
      ),
      refresh.click(),
    ]);
    assert.equal(refreshed.status(), 200);
    await eventually(() => refresh.isEnabled(), 'the refreshed asset listing settles');
    assert.equal(await summary.getAttribute('aria-expanded'), 'true');
    await animationCard.getByRole('button', { name: 'GIF 帧编辑' }).click();
    const editor = page.getByRole('dialog', { name: 'GIF 帧编辑' });
    await editor.getByRole('button', { name: '反转帧顺序' }).click();
    const pendingEdit = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/animation/edit'),
    );
    await editor.getByRole('button', { name: '另存为项目动图' }).click();
    const response = await pendingEdit;
    assert.equal(response.status(), 201);
    const result = await response.json();
    assert.deepEqual(result.animation.delay, [120, 70]);
    await editor.getByRole('link', { name: '下载 GIF' }).waitFor();
    await eventually(
      async () =>
        (await editor.getByRole('link', { name: '下载 GIF' }).getAttribute('href')) ===
        `/v1/assets/${result.asset.id}/animation/file`,
      'new GIF becomes the download target',
    );
    const bytes = await downloadBytes(page, () =>
      editor.getByRole('link', { name: '下载 GIF' }).click(),
    );
    const frames = await sharp(bytes, { animated: true }).ensureAlpha().raw().toBuffer();
    assert.deepEqual([...frames.subarray(0, 4)], [16, 29, 209, 255]);
    assert.deepEqual([...frames.subarray(16 * 12 * 4, 16 * 12 * 4 + 4)], [221, 21, 19, 255]);
    await checkDialog(editor, 'project-animation-editor', '另存为项目动图');
    return {
      frames: result.animation.frames,
      delay: result.animation.delay,
      gifSha256: sha256(bytes),
      collageRgbaSha256: sha256(collagePixels),
      viewportEvidence,
      projectSelectedThroughUi: true,
      sourceReadFromProjectListing: true,
      disclosureSurvivesRefresh: true,
      navigationAfterSelection: { team: afterTeamSelection, project: afterProjectSelection },
    };
  });
  assert.deepEqual(report.pageErrors, [], 'no unhandled browser runtime errors');
  report.state = 'passed';
} catch (error) {
  report.state = 'failed';
  report.failure = {
    case: activeCase,
    message: String(error.message).slice(0, 2500),
    stack: String(error.stack ?? '').slice(0, 6000),
  };
  for (const [index, page] of pages.entries())
    if (!page.isClosed())
      await page.screenshot({ path: join(artifacts, `failure-${index}.png`) }).catch(() => {});
  process.stderr.write(`Browser verification failed in ${activeCase}: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await vite?.close();
  await app?.close();
  await db.end();
  await rm(directory, { recursive: true, force: true });
}
