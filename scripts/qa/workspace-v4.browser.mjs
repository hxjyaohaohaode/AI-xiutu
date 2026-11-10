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
  const compact = page.getByRole('combobox', { name: '切换工作视图' });
  if (await compact.isVisible()) await compact.selectOption(id);
  else
    await page
      .getByRole('navigation', { name: '工作视图', exact: true })
      .getByRole('button', { name: label, exact: true })
      .click();
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
  if (!(await panel.getByRole('slider', { name: label, exact: true }).count()))
    await panel
      .locator('.parameter-shelf-options')
      .getByRole('button', { name: new RegExp(`^${label}`) })
      .click();
  await panel.getByRole('button', { name: new RegExp(`^${label}数值`) }).click();
  await panel.getByRole('spinbutton', { name: `${label}精确数值` }).fill(String(value));
  await panel.getByRole('spinbutton', { name: `${label}精确数值` }).press('Enter');
  await eventually(
    async () =>
      Number(await panel.getByRole('slider', { name: label, exact: true }).inputValue()) === value,
    `${label} displayed value`,
  );
}
async function downloadBytes(page, action) {
  const pending = page.waitForEvent('download');
  await action();
  const download = await pending;
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
    page.getByRole('button', { name: '下载配方 JSON' }).click(),
  );
  const value = JSON.parse(bytes.toString('utf8'));
  await changeView(page, 'editor', '精修');
  return value;
}
async function imageDownload(page) {
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '把这张画面，带走', exact: true });
  await dialog.getByRole('button', { name: '生成导出文件', exact: true }).click();
  const bytes = await downloadBytes(page, () =>
    dialog.getByRole('link', { name: '下载图片', exact: true }).click(),
  );
  await dialog.getByRole('button', { name: '关闭窗口', exact: true }).click();
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
  await page.locator('.free-panel[aria-hidden="false"] .panel-title-drag').click({ trial: true });
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
async function watchPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) =>
    report.pageErrors.push({ case: activeCase, message: error.message.slice(0, 1500) }),
  );
  page.on('dialog', (dialog) => void dialog.accept());
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
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      panel: rect('.free-panel[aria-hidden="false"]'),
      dock: rect('.floating-tool-dock'),
      frame: rect('.image-frame'),
      slider: rect('.free-panel[aria-hidden="false"] .parameter-shelf-current input[type="range"]'),
      control: rect('.free-panel[aria-hidden="false"] .parameter-shelf-current .precision-control'),
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
      await page.goto(origin);
      await page
        .getByLabel('选择照片', { exact: true })
        .setInputFiles({ name: 'technical-gradient.png', mimeType: 'image/png', buffer: png });
      await page.locator('.image-frame canvas').waitFor();
      await tool(page, size.width < 760 ? '调节' : '明暗');
      const initial = await layoutAssertions(page, size.width < 760);
      await precision(page, '曝光', -0.35);
      const normal = await layoutAssertions(page, size.width < 760);
      let resized = null;
      if (size.width < 760) {
        const grip = page.locator('.free-panel[aria-hidden="false"] .panel-title-drag');
        const box = await grip.boundingBox();
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
        await grip.press('Alt+ArrowLeft');
        const narrower = await page.locator('.free-panel[aria-hidden="false"]').boundingBox();
        assert.ok(
          Math.abs(narrower.width - (resized.panel.width - 1)) < 0.1,
          'keyboard width has a true 1px step',
        );
        await grip.press('Alt+ArrowRight');
        await page.getByRole('button', { name: /^(看全图：|折叠到标题栏)/ }).click();
        await eventually(
          async () =>
            (await page.locator('.free-panel').getAttribute('data-presentation')) === 'collapsed',
          'collapse',
        );
        await page.getByRole('button', { name: /^继续调节：/ }).click();
        await eventually(
          async () =>
            Number(await page.getByRole('slider', { name: '曝光', exact: true }).inputValue()) ===
            -0.35,
          'restore retains photo adjustment',
        );
        await page.getByRole('button', { name: '展开精调，允许遮挡画面' }).click();
        assert.equal(
          await page.locator('.free-panel').getAttribute('data-presentation'),
          'maximized',
        );
        await page.getByRole('button', { name: '返回常规调节，恢复面板尺寸' }).click();
      }
      await page.screenshot({ path: join(artifacts, `layout-${size.width}x${size.height}.png`) });
      const exported = await recipeDownload(page);
      assert.equal(exported.schemaVersion, 4);
      assert.equal(exported.adjustments.exposure, -0.35);
      await page.getByRole('button', { name: '导出', exact: true }).click();
      await page.getByRole('button', { name: '生成导出文件', exact: true }).click();
      const bytes = await downloadBytes(page, () =>
        page.getByRole('link', { name: '下载图片', exact: true }).click(),
      );
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
        resized,
        download: { format: metadata.format, width: metadata.width, height: metadata.height },
      };
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
        await page.goto(origin);
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
        const grip = page.locator('.free-panel[aria-hidden="false"] .panel-title-drag');
        await grip.focus();
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
    await page.goto(origin);
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
        await page.goto(origin);
        await page
          .getByLabel('选择照片', { exact: true })
          .setInputFiles({ name: 'freehand.png', mimeType: 'image/png', buffer: png });
        await page.locator('.image-frame canvas').waitFor();
        await tool(page, '绘制');
        await page
          .locator('[data-motion="paint-controls"]')
          .getByRole('button', { name: '新建', exact: true })
          .click();
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
          await page
            .locator('.free-panel[aria-hidden="false"]')
            .getByRole('button', { name: /^收起.*可从工具栏重新打开$/ })
            .click();
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
        const grip = page.locator('.free-panel[aria-hidden="false"] .panel-title-drag');
        await grip.focus();
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
    await page.goto(origin);
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await page
      .locator('.sidebar')
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
    await a.page.locator('.panel-title-drag').focus();
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
      .locator('.sidebar')
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
    await history.locator('summary').click();
    await eventually(
      async () =>
        (await history.locator('.revision-entry').count()) === 100 &&
        (await history.locator('summary').innerText()).includes('已载入 100'),
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
      assert.ok((await history.locator('summary').innerText()).includes('已载入 100'));
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
        (await history.locator('summary').innerText()).includes('已载入 105'),
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
  await caseRun('project-library-imports-real-gif-and-edits-its-frames', async () => {
    const { page } = a;
    const desktop = page.viewportSize();
    const viewportEvidence = [];
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
        await layout.getByRole('button', { name: '关闭窗口', exact: true }).scrollIntoViewIfNeeded();
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
    await dialog.getByText(/选择拼图素材/).click();
    await dialog.getByRole('checkbox', { name: 'CI-gradient.png', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'QA-motion.gif', exact: true }).check();
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
    const collagePixels = await sharp(await collageFile.body()).ensureAlpha().raw().toBuffer();
    assert.equal(collagePixels[3], 0);
    const gifCell = (20 * 64 + 50) * 4;
    assert.deepEqual([...collagePixels.subarray(gifCell, gifCell + 4)], [221, 21, 19, 255]);
    await dialog.getByRole('status').filter({ hasText: '拼图.png' }).waitFor();
    await dialog.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await page
      .locator('.library-asset')
      .filter({ hasText: 'QA-motion.gif' })
      .getByRole('button', { name: 'GIF 帧编辑' })
      .click();
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
