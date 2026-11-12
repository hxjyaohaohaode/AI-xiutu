/** Real account journeys on an isolated API/database and the actual web app.
 * The SMS port captures server-generated random OTPs in memory. No production
 * route, fixed code, real SMS, payment provider or account purge is introduced.
 * Run in the dedicated CI job, never against an existing user's application.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createDatabase } from '@ai-xiutu/db';
import { ProviderError } from '@ai-xiutu/providers';
import { runSiteEntryChecks } from './qa/site-entry.browser.mjs';

if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production')
  throw new Error('Run only in isolated non-production CI.');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !decodeURIComponent(new URL(databaseUrl).pathname).includes('test'))
  throw new Error('Use a disposable TEST_DATABASE_URL with test in its database name.');
for (const key of [
  'OPENAI_API_KEY',
  'OPENAI_REALTIME_API_KEY',
  'GEMINI_API_KEY',
  'DASHSCOPE_API_KEY',
  'ARK_API_KEY',
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
])
  process.env[key] = '';
for (const flag of [
  'AI_PLAN_ENABLED',
  'AI_TEXT_ENABLED',
  'AI_IMAGE_ENABLED',
  'AI_SPEECH_ENABLED',
  'AI_ASSISTANT_ENABLED',
  'AI_VOICE_ENABLED',
  'MEDIA_ADVANCED_ENABLED',
])
  process.env[flag] = 'false';
process.env.NODE_ENV = 'test';
const { buildApp } = await import('../apps/api/src/app.ts');
const { loadConfig } = await import('../apps/api/src/config.ts');
const { hash, secretHash } = await import('../apps/api/src/core.ts');
const { createServer } = await import('vite');
const root = fileURLToPath(new URL('..', import.meta.url));
const motion = process.env.ACCOUNT_BROWSER_MOTION ?? 'no-preference';
assert.ok(['no-preference', 'reduce'].includes(motion), 'Unknown motion mode');
const artifacts = resolve(
  root,
  process.env.BROWSER_ARTIFACT_DIR ?? `artifacts/browser-account/${motion}`,
);
await mkdir(artifacts, { recursive: true });
const port = Number(process.env.BROWSER_WEB_PORT ?? 4182);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid isolated browser port');
const origin = `http://127.0.0.1:${port}`;
const runId = randomUUID();
const privateValues = new Set();
const keepPrivate = (value) => {
  privateValues.add(value);
  return value;
};
const makePhone = () => keepPrivate(`+86139${String(randomInt(0, 100_000_000)).padStart(8, '0')}`);
const password = keepPrivate(`Account-${randomBytes(18).toString('base64url')}`);
const newPassword = keepPrivate(`Changed-${randomBytes(18).toString('base64url')}`);
const primaryPhone = makePhone();
const primaryName = '账号流程验收';
const smsCodes = new Map();
const unknownSms = new Set();
const smsDeliveries = [];
const report = {
  runId,
  startedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  motion,
  environment: 'isolated native PostgreSQL; actual API and frontend; in-memory SmsAdapter',
  realSmsCalls: 0,
  paidCalls: 0,
  cases: [],
  layouts: [],
  authLayouts: [],
  screenshots: [],
  pageErrors: [],
  unexpectedOrigins: [],
  requestCounts: {},
  manualVisualReview: false,
  limits: [
    'Random OTPs originate in the real auth route, but the SMS delivery port is an injected in-memory adapter.',
    'A malformed login receipt is deliberately injected after a real successful server mutation to test unknown-outcome recovery.',
    'SMS-purpose cases wait for the real server cooldown; neither browser time nor challenge timestamps are changed.',
    'Account deletion and checkout remain explicitly unavailable when the current backend exposes no real contract; no purchase or purge is performed.',
    'Headless Chromium viewport/input checks do not prove physical keyboard, screen reader, mobile OS or paid-provider acceptance.',
    'Authentication inputs with nonempty values are masked in screenshots; empty placeholders and borders remain visible. No OTP/password/session token is written to artifacts.',
  ],
};
let db, app, vite, browser, directory, main, peer, currentPage, fixtureSecret;
const ownedPhones = new Set([primaryPhone]);
const safeError = (error) => {
  let value = String(error?.stack ?? error);
  for (const secret of [...privateValues].sort((a, b) => b.length - a.length))
    value = value.split(secret).join('[redacted]');
  return value.replace(/\+86139\d{8}/g, '[fixture phone]');
};
async function until(read, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
async function check(name, run) {
  const started = performance.now();
  try {
    const details = await run();
    report.cases.push({
      name,
      state: 'passed',
      ms: Math.round(performance.now() - started),
      ...details,
    });
    console.log(`Passed: ${name}`);
  } catch (error) {
    report.cases.push({ name, state: 'failed', message: safeError(error) });
    throw error;
  }
}
async function newContext(viewport = { width: 1440, height: 960 }, entry = 'studio', options = {}) {
  assert.ok(entry === 'about' || entry === 'studio', 'Unknown public entry route');
  const context = await browser.newContext({
    viewport,
    hasTouch: options.hasTouch ?? false,
    reducedMotion: motion,
    locale: 'zh-CN',
    serviceWorkers: 'block',
  });
  context.setDefaultTimeout(20000);
  context.setDefaultNavigationTimeout(30000);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      report.unexpectedOrigins.push(url.origin);
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(safeError(error)));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/v1/')) {
      const key = `${request.method()} ${path}`;
      report.requestCounts[key] = (report.requestCounts[key] ?? 0) + 1;
    }
  });
  currentPage = page;
  await page.goto(`${origin}/${entry === 'studio' ? '#/studio' : ''}`);
  if (entry === 'about') await page.locator('.about-page').waitFor();
  else await page.getByRole('button', { name: '打开空间与项目', exact: true }).waitFor();
  return { context, page };
}
async function capture(page, name) {
  const file = `${name}.png`;
  const fields = page.locator('.account-page.account-auth input');
  const masks = [];
  for (let index = 0; index < (await fields.count()); index++) {
    const input = fields.nth(index);
    if (await input.evaluate((element) => element.value.length > 0)) masks.push(input);
  }
  await page.screenshot({
    path: resolve(artifacts, file),
    mask: masks,
    maskColor: '#73766c',
  });
  report.screenshots.push({
    file,
    authenticationValuesMasked: true,
    maskedInputCount: masks.length,
  });
}
async function request(context, method, path, data) {
  const response = await context.request.fetch(`${origin}${path}`, {
    method,
    headers: { origin },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), body: await response.json() };
}
async function session(context) {
  const response = await request(context, 'GET', '/v1/session');
  assert.equal(response.status, 200);
  return response.body;
}
function authControl(page, name) {
  // MotionSwitch intentionally retains an inert outgoing form. Match only its
  // active replacement so a fill cannot target the previous screen's fields.
  return page.locator('[data-testid="auth-stage"]:not([inert])').getByTestId(`auth-${name}`);
}
function workspaceLogin(page) {
  return page
    .locator('button.studio-account')
    .and(page.getByRole('button', { name: '登录创作空间', exact: true }));
}
async function openNavigation(page) {
  const sidebar = page.getByRole('complementary', { name: '空间与项目', exact: true });
  if (!(await sidebar.isVisible()))
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
  await sidebar.waitFor();
  return sidebar;
}
async function openAuth(page) {
  currentPage = page;
  const topbar = workspaceLogin(page);
  if (await topbar.isVisible()) await topbar.click();
  else await (await openNavigation(page)).locator('button.account-login').click();
  const dialog = page.getByRole('region', { name: '登录工作空间', exact: true });
  await dialog.waitFor();
  await authControl(page, 'phone').waitFor();
  return dialog;
}
async function finishWelcome(page, registered) {
  // First use is a genuine standalone page, not a seeded completion flag.
  const onboarding = page.getByTestId('account-onboarding');
  if (registered) {
    await onboarding.waitFor();
    await capture(page, `registered-account-first-use-${report.screenshots.length + 1}`);
    await onboarding.getByTestId('account-start').click();
    await onboarding.waitFor({ state: 'hidden' });
  }
}
async function expectSignedIn(page, name = primaryName, registered = false) {
  // The first-use page retains a hidden/inert workspace. Complete that step
  // before requiring its account action to rejoin the accessibility tree.
  await finishWelcome(page, registered);
  await page.getByRole('button', { name: `账户：${name}`, exact: true }).waitFor();
  const auth = page.locator('.account-page.account-auth');
  await until(async () => !(await auth.isVisible()), 'auth result leaves its original page');
}
async function openAccount(page, name = primaryName) {
  currentPage = page;
  const dialog = page.getByRole('region', { name: '账号与使用', exact: true });
  if (!(await dialog.isVisible())) {
    const topbar = page.getByRole('button', { name: `账户：${name}`, exact: true });
    if (await topbar.isVisible()) await topbar.click();
    else
      await (
        await openNavigation(page)
      )
        .getByRole('button', { name: `账号与使用：${name}`, exact: true })
        .click();
  }
  await page.getByTestId('account-center').waitFor();
  return dialog;
}
async function closeDialog(dialog) {
  if (await dialog.evaluate((element) => element.classList.contains('account-page'))) {
    if (await dialog.evaluate((element) => element.classList.contains('account-auth'))) {
      // Auth is a document journey: details -> phone -> login -> workspace.
      // Its header now returns one level instead of dismissing every screen.
      const authPage = dialog.page().locator('.account-page.account-auth');
      const stage = () =>
        authPage.evaluate((element) => ({
          title: element.querySelector('.account-page-heading h1')?.textContent,
          back: element.querySelector('.account-page-header .account-page-back')?.textContent,
        }));
      for (let depth = 0; depth < 3 && (await authPage.isVisible()); depth += 1) {
        const before = await stage();
        await authPage.locator('.account-page-header .account-page-back').click();
        await until(async () => {
          if (!(await authPage.isVisible())) return true;
          const after = await stage();
          return after.title !== before.title || after.back !== before.back;
        }, 'the account header returns to the preceding real screen');
      }
      await authPage.waitFor({ state: 'hidden' });
      return;
    }
    await dialog.locator('.account-page-back').click();
    await dialog.waitFor({ state: 'hidden' });
    return;
  }
  const nativeDialog = await dialog.elementHandle();
  assert.ok(nativeDialog, 'The visible modal must own a native dialog');
  try {
    await dialog.getByRole('button', { name: '关闭窗口', exact: true }).click();
    // aria-hidden changes on exit, before the native modal releases the editor.
    await dialog
      .page()
      .waitForFunction((element) => !element.isConnected || !element.open, nativeDialog);
  } finally {
    await nativeDialog.dispose();
  }
}
async function logout(page, name = primaryName) {
  const account = await openAccount(page, name);
  await page.getByTestId('account-tab-data').click();
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/v1/auth/logout' && r.request().method() === 'POST',
  );
  await page.getByTestId('account-logout').click();
  const confirmation = page.getByRole('dialog', { name: '退出当前账号？', exact: true });
  await confirmation.getByRole('button', { name: '退出登录', exact: true }).click();
  assert.equal((await response).status(), 200);
  await account.waitFor({ state: 'hidden' });
  await workspaceLogin(page).waitFor();
  assert.equal((await session(page.context())).user, null);
}
async function codeFor(phone, purpose) {
  const code = await until(
    () => smsCodes.get(`${phone}:${purpose}`),
    'server-generated OTP reaches test adapter',
  );
  assert.ok(/^\d{6}$/.test(code), 'OTP adapter must receive six random digits');
  return code;
}
async function waitForOtpCooldown(phone) {
  assert.ok(ownedPhones.has(phone), 'Only this run may inspect its own fixture cooldown');
  const phoneKey = secretHash(fixtureSecret, `otp-phone:${phone}`);
  const deadline = Date.now() + 70000;
  while (Date.now() < deadline) {
    const result = await db.query(
      "SELECT GREATEST(0,COALESCE(extract(epoch from max(created_at)+interval '60 seconds'-clock_timestamp()),0))::float8 AS remaining FROM otp_challenges WHERE phone_key=$1",
      [phoneKey],
    );
    const remaining = result.rows[0].remaining;
    if (remaining <= 0) return;
    await delay(Math.min(10000, Math.ceil(remaining * 1000) + 150));
  }
  throw new Error('The real SMS cooldown did not expire within its documented window');
}
async function fillRegistration(page, code, name = primaryName) {
  await authControl(page, 'code').fill(code);
  await authControl(page, 'display-name').fill(name);
  await authControl(page, 'password').fill(password);
}
async function actualLogin(page, phone, secret, name = primaryName) {
  const dialog = await openAuth(page);
  await authControl(page, 'phone').fill(phone);
  await authControl(page, 'password').fill(secret);
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/v1/auth/login' && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  assert.equal((await response).status(), 200);
  await expectSignedIn(page, name);
}
async function savedSession(context) {
  const cookie = (await context.cookies(origin)).find((c) => c.name === 'xiutu_session');
  assert.ok(cookie?.value, 'A successful login must set a session cookie');
  keepPrivate(cookie.value);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  return cookie;
}
async function sessionFromCookie(cookie) {
  const response = await app.inject({
    method: 'GET',
    url: '/v1/session',
    headers: { origin, cookie: `xiutu_session=${cookie.value}` },
  });
  assert.equal(response.statusCode, 200);
  return response.json();
}
async function measureReachable(page, target, name) {
  await target.waitFor();
  // Allow the real, finite entrance motion to finish. Do not disable product
  // animation or wait on ongoing spinners/cursors that are meant to repeat.
  await target.evaluate(async (element) => {
    const animations = new Set();
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      for (const animation of ancestor.getAnimations()) {
        if (Number.isFinite(animation.effect?.getComputedTiming().iterations))
          animations.add(animation);
      }
    }
    await Promise.allSettled([...animations].map((animation) => animation.finished));
  });
  const before = await target.evaluate((element) => {
    const result = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      result.push({
        tag: ancestor.tagName,
        className: ancestor.className,
        x: ancestor.scrollLeft,
        y: ancestor.scrollTop,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      });
    }
    return result;
  });
  await target.scrollIntoViewIfNeeded();
  const geometry = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const box = (r) => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const ancestors = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const r = ancestor.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, r.left);
        clip.right = Math.min(clip.right, r.right);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, r.top);
        clip.bottom = Math.min(clip.bottom, r.bottom);
      }
      ancestors.push({
        tag: ancestor.tagName,
        className: ancestor.className,
        x: ancestor.scrollLeft,
        y: ancestor.scrollTop,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      });
    }
    const x = (rect.left + rect.right) / 2,
      y = (rect.top + rect.bottom) / 2;
    const top = document.elementFromPoint(x, y);
    return {
      rect: box(rect),
      clip,
      ancestors,
      hit: !!top && (top === element || element.contains(top)),
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentPage:
        !!element.closest('.account-page') && document.body.dataset.sitePage === 'account',
      documentOverflowY: getComputedStyle(document.body).overflowY,
    };
  });
  assert.ok(geometry.rect.width > 0 && geometry.rect.height > 0, `${name} is not rendered`);
  const r = geometry.rect,
    c = geometry.clip;
  assert.ok(
    r.left >= c.left - 0.5 &&
      r.right <= c.right + 0.5 &&
      r.top >= c.top - 0.5 &&
      r.bottom <= c.bottom + 0.5,
    `${name} must lie inside all actual clipping ancestors`,
  );
  assert.equal(geometry.hit, true, `${name} must be hit at its visible center`);
  assert.ok(geometry.horizontalOverflow <= 0.5, `${name} page must not overflow horizontally`);
  for (let i = 0; i < before.length; i++) {
    const next = geometry.ancestors[i],
      previous = before[i];
    if (!next || next.tag !== previous.tag || next.className !== previous.className) continue;
    if (Math.abs(next.x - previous.x) > 0.5)
      assert.match(
        previous.overflowX,
        /^(auto|scroll)$/,
        `${name} must not scroll a hidden horizontal ancestor`,
      );
    if (Math.abs(next.y - previous.y) > 0.5) {
      // Standalone account pages intentionally scroll the document. The editor
      // still rejects scrolling hidden ancestors, including its root frame.
      if (next.tag === 'HTML' && geometry.documentPage)
        assert.match(
          geometry.documentOverflowY,
          /^(auto|scroll)$/,
          `${name} account page must own real document scrolling`,
        );
      else
        assert.match(
          previous.overflowY,
          /^(auto|scroll)$/,
          `${name} must not scroll a hidden vertical ancestor`,
        );
    }
  }
  return { name, ...geometry };
}
async function setTheme(page, theme) {
  const current = await page.locator('html').getAttribute('data-theme');
  if (current === theme) return;
  await page.getByRole('button', { name: '布局与工作台设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '工作台设置', exact: true });
  await dialog
    .getByRole('button', { name: theme === 'dark' ? '深色' : '浅色', exact: true })
    .click();
  await closeDialog(dialog);
  assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
}

try {
  directory = await mkdtemp(join(tmpdir(), 'xiutu-account-browser-'));
  db = createDatabase(databaseUrl);
  fixtureSecret = keepPrivate(randomBytes(32).toString('hex'));
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: fixtureSecret,
    STORAGE_DIR: directory,
    APP_ORIGIN: origin,
    COOKIE_SECURE: 'false',
    NODE_ENV: 'test',
  });
  const sms = {
    configured: true,
    async send(input) {
      keepPrivate(input.code);
      smsCodes.set(`${input.phone}:${input.purpose}`, input.code);
      smsDeliveries.push({
        purpose: input.purpose,
        outcome: unknownSms.has(input.phone) ? 'unknown' : 'sent',
      });
      if (unknownSms.delete(input.phone))
        throw new ProviderError('FIXTURE_RECEIPT_LOST', 'unknown');
      return { requestId: randomUUID() };
    },
  };
  app = await buildApp({ db, config, sms });
  await app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(app.server.address().port);
  vite = await createServer({
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || undefined,
  });
  report.browser = browser.version();
  await runSiteEntryChecks({
    newContext,
    check,
    capture,
    until,
    closeDialog,
    authControl,
    measureReachable,
    report,
    phone: primaryPhone,
  });
  // The continuous public overview and responsive screenshots run in system-redesign.browser.mjs.
  main = await newContext();
  let primaryUserId, originalCookie, peerCookie, documentActor;

  await check(
    'Guest entry, inline validation and password visibility retain field ownership',
    async () => {
      assert.equal((await session(main.context)).user, null);
      const dialog = await openAuth(main.page);
      await until(
        () =>
          main.page
            .getByTestId('auth-phone')
            .evaluate((element) => document.activeElement === element),
        'phone field receives focus',
      );
      const close = dialog.locator('.account-page-back');
      await close.focus();
      await main.page.keyboard.press('Shift+Tab');
      assert.equal(
        await dialog.evaluate((element) => element.contains(document.activeElement)),
        true,
        'Page navigation must retain a visible keyboard destination',
      );
      await main.page.keyboard.press('Tab');
      assert.equal(
        await close.evaluate((element) => document.activeElement === element),
        true,
        'Tab from language returns to the page navigation action',
      );
      assert.equal(new URL(main.page.url()).hash, '#/login');
      assert.equal(
        await main.page.locator('dialog[open]').count(),
        0,
        'Login must be a page, not a modal',
      );
      assert.equal(await main.page.locator('.site-workspace-frame').getAttribute('hidden'), '');
      assert.equal(await main.page.locator('.site-workspace-frame').getAttribute('inert'), '');
      await dialog.getByRole('button', { name: '登录', exact: true }).click();
      assert.equal(await authControl(main.page, 'phone').getAttribute('aria-invalid'), 'true');
      assert.equal(await authControl(main.page, 'password').getAttribute('aria-invalid'), 'true');
      const before = report.requestCounts['POST /v1/auth/login'] ?? 0;
      assert.equal(before, 0, 'Invalid local fields must not post credentials');
      await authControl(main.page, 'password').fill(password);
      await dialog.getByRole('button', { name: '显示密码', exact: true }).click();
      assert.equal(await authControl(main.page, 'password').getAttribute('type'), 'text');
      await dialog.getByRole('button', { name: '隐藏密码', exact: true }).click();
      assert.equal(await authControl(main.page, 'password').getAttribute('type'), 'password');
      await authControl(main.page, 'password').fill('');
      await capture(main.page, '01-guest-validation');
      const retainedWorkspace = await main.page.locator('.site-workspace-frame').elementHandle();
      assert.ok(retainedWorkspace);
      try {
        await dialog.getByRole('button', { name: '创建新账号', exact: true }).click();
        await main.page.getByRole('heading', { name: '注册账号', exact: true }).waitFor();
        assert.equal(new URL(main.page.url()).hash, '#/register');
        await main.page.goBack();
        await main.page.getByRole('heading', { name: '登录工作空间', exact: true }).waitFor();
        assert.equal(new URL(main.page.url()).hash, '#/login');
        await main.page.goBack();
        await workspaceLogin(main.page).waitFor();
        assert.equal(new URL(main.page.url()).hash, '#/studio');
        assert.equal(
          await retainedWorkspace.evaluate(
            (element) =>
              element.isConnected && document.querySelector('.site-workspace-frame') === element,
          ),
          true,
        );
        await openAuth(main.page);
      } finally {
        await retainedWorkspace.dispose();
      }
      return {
        localInvalidSubmissions: 0,
        explicitVisibilityToggle: true,
        keyboardPageNavigation: true,
        standaloneRoutes: ['login', 'register'],
        browserHistoryKeepsWorkspaceOwner: true,
      };
    },
  );

  await check(
    'Registration uses real OTP, immediate cooldown and recoverable invalid-code feedback',
    async () => {
      const page = main.page;
      await page.getByRole('button', { name: '创建新账号', exact: true }).click();
      await authControl(page, 'phone').fill(primaryPhone);
      const sent = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/otp' && r.request().method() === 'POST',
      );
      await page
        .getByRole('region', { name: '注册账号', exact: true })
        .getByRole('button', { name: '获取验证码', exact: true })
        .click();
      const receipt = await sent;
      assert.equal(receipt.status(), 202);
      const publicReceipt = await receipt.json();
      assert.equal(Object.hasOwn(publicReceipt, 'code'), false);
      await authControl(page, 'code').waitFor();
      const resend = page.locator('.auth-send-code');
      assert.equal(await resend.isDisabled(), true);
      const label = await resend.innerText();
      await until(
        async () => (await resend.innerText()) !== label,
        'real resend countdown advances',
        4000,
      );
      assert.equal(smsDeliveries.length, 1);
      const cooldown = await request(main.context, 'POST', '/v1/auth/otp', {
        phone: primaryPhone,
        purpose: 'register',
      });
      assert.equal(cooldown.status, 429);
      assert.equal(cooldown.body.error.code, 'OTP_COOLDOWN');
      assert.equal(cooldown.body.error.details.retryAfterSeconds, 60);
      assert.equal(smsDeliveries.length, 1, 'Cooldown may not dispatch another SMS');
      const actual = await codeFor(primaryPhone, 'register');
      const wrong = keepPrivate(String((Number(actual) + 1) % 1_000_000).padStart(6, '0'));
      await fillRegistration(page, wrong);
      const invalid = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/register' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '创建账号', exact: true }).click();
      assert.equal((await invalid).status(), 400);
      await until(
        async () => (await authControl(page, 'code').getAttribute('aria-invalid')) === 'true',
        'invalid code is attached to code field',
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS count FROM users WHERE phone=$1', [primaryPhone]))
          .rows[0].count,
        0,
      );
      await authControl(page, 'code').fill(actual);
      const registered = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/register' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '创建账号', exact: true }).click();
      assert.equal((await registered).status(), 201);
      await expectSignedIn(page, primaryName, true);
      const current = await session(main.context);
      primaryUserId = current.user.id;
      assert.equal(current.user.displayName, primaryName);
      assert.equal(Object.hasOwn(current.user, 'phone'), false);
      assert.equal(current.spaces.filter((space) => space.kind === 'personal').length, 1);
      originalCookie = await savedSession(main.context);
      const stored = (
        await db.query('SELECT token_hash FROM sessions WHERE user_id=$1', [primaryUserId])
      ).rows;
      assert.ok(
        stored.some((row) => row.token_hash === hash(originalCookie.value)),
        'Server must persist a token hash',
      );
      const user = (await db.query('SELECT password_hash FROM users WHERE id=$1', [primaryUserId]))
        .rows[0];
      assert.ok(
        user.password_hash.startsWith('scrypt-v1$'),
        'Password must be hashed by real backend',
      );
      await capture(page, '02-registered-workspace');
      return {
        smsDispatches: 1,
        cooldownStatus: 429,
        invalidCodeStatus: 400,
        registerStatus: 201,
        personalSpaces: 1,
        publicPhoneMasked: true,
        cookieHttpOnly: true,
        cookieSameSite: 'Strict',
      };
    },
  );

  await check(
    'A failed account module retries locally while the photo, unsent AI text and session retain their owners',
    async () => {
      const page = main.page;
      const { default: sharp } = await import('sharp');
      const bytes = await sharp({
        create: {
          width: 32,
          height: 24,
          channels: 4,
          background: { r: 92, g: 131, b: 168, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      await page.getByLabel('选择照片', { exact: true }).setInputFiles({
        name: 'account-local-fixture.png',
        mimeType: 'image/png',
        buffer: bytes,
      });
      const canvas = page.locator('canvas[aria-label="照片编辑预览"]');
      await canvas.waitFor();
      await until(
        () => canvas.evaluate((element) => element.width === 32 && element.height === 24),
        'local photo finishes decoding',
      );
      await page
        .locator('.floating-tool-dock')
        .getByRole('button', { name: 'AI 助手', exact: true })
        .click();
      const assistant = page.locator('.live-assistant');
      await assistant.waitFor();
      const composer = assistant.getByRole('textbox', {
        name: '向智能体描述修改需求',
        exact: true,
      });
      const unsent = keepPrivate('保留这段未发送的组件恢复验收文字');
      await composer.fill(unsent);
      const canvasOwner = await canvas.elementHandle();
      const assistantOwner = await assistant.elementHandle();
      assert.ok(canvasOwner && assistantOwner);
      const pixels = () =>
        canvas.evaluate((element) => {
          const values = element
            .getContext('2d')
            .getImageData(0, 0, element.width, element.height).data;
          let checksum = 0;
          for (let index = 0; index < values.length; index++)
            checksum = (checksum + values[index] * (index + 1)) % 2147483647;
          return { width: element.width, height: element.height, checksum };
        });
      const before = await pixels();
      let intercepted = 0;
      await page.route(
        '**/src/account/AccountCenter.tsx*',
        async (route) => {
          intercepted++;
          await route.abort('connectionreset');
        },
        { times: 1 },
      );
      await page.getByRole('button', { name: `账户：${primaryName}`, exact: true }).click();
      const dialog = page.getByRole('region', { name: '账号与使用', exact: true });
      await dialog.getByTestId('deferred-feature-error').waitFor();
      assert.equal(intercepted, 1);
      await measureReachable(
        page,
        dialog.locator('.account-page-back'),
        'return from failed account page',
      );
      assert.equal(
        await canvasOwner.evaluate(
          (element) =>
            element.isConnected &&
            document.querySelector('canvas[aria-label="照片编辑预览"]') === element,
        ),
        true,
      );
      assert.equal(
        await assistantOwner.evaluate(
          (element) => element.isConnected && document.querySelector('.live-assistant') === element,
        ),
        true,
      );
      await dialog.getByTestId('deferred-feature-retry').click();
      await page.getByTestId('account-center').waitFor();
      await closeDialog(page.getByRole('region', { name: '账号与使用', exact: true }));
      assert.equal(
        await canvasOwner.evaluate(
          (element) =>
            element.isConnected &&
            document.querySelector('canvas[aria-label="照片编辑预览"]') === element,
        ),
        true,
      );
      assert.equal(
        await assistantOwner.evaluate(
          (element) => element.isConnected && document.querySelector('.live-assistant') === element,
        ),
        true,
      );
      assert.deepEqual(await pixels(), before);
      assert.equal(await composer.inputValue(), unsent);
      assert.equal(hash((await savedSession(main.context)).value), hash(originalCookie.value));
      await composer.fill('');
      await capture(page, 'module-recovery-retains-local-workspace');
      await page
        .getByRole('button', { name: '收起AI 助手，可从工具栏重新打开', exact: true })
        .click();
      await canvasOwner.dispose();
      await assistantOwner.dispose();
      return {
        injectedModuleFailures: 1,
        localRetrySucceeded: true,
        errorCloseReachable: true,
        returnedToEditor: true,
        canvasOwnerRetained: true,
        assistantOwnerRetained: true,
        decodedPixelsUnchanged: true,
        unsentTextRetained: true,
        sessionUnchanged: true,
      };
    },
  );

  await check(
    'Account center exposes real capability boundaries and logout revokes its session',
    async () => {
      const page = main.page;
      await openAccount(page);
      for (const tab of ['overview', 'security', 'billing', 'data']) {
        await page.getByTestId(`account-tab-${tab}`).click();
        assert.equal(
          await page.getByTestId(`account-tab-${tab}`).getAttribute('aria-selected'),
          'true',
        );
      }
      await page.getByRole('button', { name: '注销账号', exact: true }).click();
      await page.getByTestId('account-deletion-status').waitFor();
      assert.match(
        await page.getByTestId('account-deletion-status').innerText(),
        /暂不支持|尚未|未开放/,
      );
      await page.getByTestId('account-tab-billing').click();
      await page.getByTestId('account-payment-status').waitFor();
      const publicConfig = await request(main.context, 'GET', '/v1/public-config');
      assert.equal(publicConfig.body.capabilities.paymentConfigured, false);
      assert.match(
        await page.getByTestId('account-payment-status').innerText(),
        /未开放|未接入|未配置|暂不支持/,
      );
      await capture(page, '03-account-billing');
      assert.equal(
        Object.keys(report.requestCounts).filter((key) =>
          /checkout|payment|DELETE.*account/.test(key),
        ).length,
        0,
      );
      await page.getByTestId('account-tab-data').click();
      const posts = report.requestCounts['POST /v1/auth/logout'] ?? 0;
      await page.getByTestId('account-logout').click();
      const confirmation = page.getByRole('dialog', { name: '退出当前账号？', exact: true });
      await confirmation.getByRole('button', { name: '继续使用', exact: true }).click();
      await confirmation.waitFor({ state: 'hidden' });
      assert.equal(
        report.requestCounts['POST /v1/auth/logout'] ?? 0,
        posts,
        'Cancelled logout must not revoke the session',
      );
      assert.equal((await session(main.context)).user.id, primaryUserId);
      await logout(page);
      assert.equal((await sessionFromCookie(originalCookie)).user, null);
      return {
        paymentConfigured: false,
        checkoutRequests: 0,
        accountPurgeRequests: 0,
        cancelledLogoutPosts: 0,
        logoutSessionRevoked: true,
      };
    },
  );

  await check(
    'Password failure and unknown successful receipt recover through current session without reposting',
    async () => {
      const page = main.page;
      let dialog = await openAuth(page);
      await authControl(page, 'phone').fill(primaryPhone);
      await authControl(page, 'password').fill('deliberately-wrong-test-value');
      const denied = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/login' && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: '登录', exact: true }).click();
      assert.equal((await denied).status(), 401);
      await dialog.getByRole('alert').waitFor();
      await authControl(page, 'password').fill(password);
      const before = report.requestCounts['POST /v1/auth/login'] ?? 0;
      let actualServerReceiptStatus = 0;
      let releaseReceipt;
      const receiptGate = new Promise((resolve) => {
        releaseReceipt = resolve;
      });
      await page.route(
        '**/v1/auth/login',
        async (route) => {
          const response = await route.fetch();
          actualServerReceiptStatus = response.status();
          assert.equal(
            actualServerReceiptStatus,
            200,
            'Real backend must complete login before its receipt is truncated',
          );
          const headers = { ...response.headers() };
          delete headers['content-length'];
          delete headers['content-encoding'];
          await receiptGate;
          // Preserve the actual HTTP status and real Set-Cookie; only the body is
          // truncated to reproduce a connection ending after response headers.
          await route.fulfill({ status: response.status(), headers, body: '{' });
        },
        { times: 1 },
      );
      await dialog.getByRole('button', { name: '登录', exact: true }).click();
      await until(
        () => actualServerReceiptStatus === 200,
        'real login reaches the pending receipt',
      );
      const pendingForm = await dialog.elementHandle();
      assert.ok(pendingForm);
      try {
        assert.equal(await dialog.locator('.account-page-back').isDisabled(), true);
        await page.goBack();
        await page.waitForURL('**/#/login');
        assert.equal(
          await pendingForm.evaluate((element) => element.isConnected),
          true,
          'Browser history may not discard an in-flight authentication owner',
        );
      } finally {
        releaseReceipt();
        await pendingForm.dispose();
      }
      await authControl(page, 'recovery').waitFor();
      assert.equal(actualServerReceiptStatus, 200);
      assert.equal((report.requestCounts['POST /v1/auth/login'] ?? 0) - before, 1);
      const sessionReads = report.requestCounts['GET /v1/session'] ?? 0;
      await page.getByRole('button', { name: '检查登录状态', exact: true }).click();
      await page.getByRole('button', { name: '使用这个账号', exact: true }).waitFor();
      await capture(page, '04-session-recovery');
      await page.getByRole('button', { name: '使用这个账号', exact: true }).click();
      await expectSignedIn(page);
      assert.equal(
        (report.requestCounts['GET /v1/session'] ?? 0) - sessionReads,
        2,
        'Preview and explicit acceptance must each reread the current session',
      );
      assert.equal((await session(main.context)).user.id, primaryUserId);
      assert.equal(
        (report.requestCounts['POST /v1/auth/login'] ?? 0) - before,
        1,
        'Recovery cannot automatically repeat login',
      );
      originalCookie = await savedSession(main.context);
      return {
        invalidPasswordStatus: 401,
        actualServerReceiptStatus,
        truncatedReceipts: 1,
        loginPostsDuringRecovery: 1,
        recoverySessionReads: 2,
        explicitSessionAcceptance: true,
        pendingHistoryNavigationBlocked: true,
      };
    },
  );

  await check(
    'OTP login uses its own purpose while an independent password session stays active',
    async () => {
      peer = await newContext();
      await actualLogin(peer.page, primaryPhone, password);
      peerCookie = await savedSession(peer.context);
      assert.notEqual(hash(peerCookie.value), hash(originalCookie.value));
      currentPage = main.page;
      await logout(main.page);
      await waitForOtpCooldown(primaryPhone);
      const dialog = await openAuth(main.page);
      await dialog.getByRole('button', { name: '验证码登录', exact: true }).click();
      await authControl(main.page, 'phone').fill(primaryPhone);
      const sent = main.page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/otp' && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: '获取验证码', exact: true }).click();
      assert.equal((await sent).status(), 202);
      await authControl(main.page, 'code').fill(await codeFor(primaryPhone, 'login'));
      const logged = main.page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/v1/auth/login-otp' && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: '登录', exact: true }).click();
      assert.equal((await logged).status(), 200);
      await expectSignedIn(main.page);
      originalCookie = await savedSession(main.context);
      assert.equal((await sessionFromCookie(peerCookie)).user.id, primaryUserId);
      return { otpLoginStatus: 200, purpose: 'login', independentSessions: 2 };
    },
  );

  await check(
    'Password reset revokes both real sessions and old credentials before new-password login',
    async () => {
      const page = main.page;
      await openAccount(page);
      await page.getByTestId('account-tab-security').click();
      await page.getByTestId('account-reset-password').click();
      await page.getByRole('region', { name: '重置密码', exact: true }).waitFor();
      await waitForOtpCooldown(primaryPhone);
      await authControl(page, 'phone').fill(primaryPhone);
      const sent = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/otp' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '获取验证码', exact: true }).click();
      assert.equal((await sent).status(), 202);
      await authControl(page, 'code').fill(await codeFor(primaryPhone, 'reset'));
      await authControl(page, 'password').fill(newPassword);
      const reset = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/reset' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '更新密码', exact: true }).click();
      assert.equal((await reset).status(), 200);
      await authControl(page, 'reset-success').waitFor();
      assert.equal((await sessionFromCookie(originalCookie)).user, null);
      assert.equal((await sessionFromCookie(peerCookie)).user, null);
      assert.equal(
        (
          await db.query('SELECT count(*)::int AS count FROM sessions WHERE user_id=$1', [
            primaryUserId,
          ])
        ).rows[0].count,
        0,
      );
      await capture(page, '05-reset-complete');
      await authControl(page, 'reset-success')
        .getByRole('button', { name: '返回登录', exact: true })
        .click();
      const dialog = page.getByRole('region', { name: '登录工作空间', exact: true });
      await authControl(page, 'phone').fill(primaryPhone);
      await authControl(page, 'password').fill(password);
      const old = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/login' && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: '登录', exact: true }).click();
      assert.equal((await old).status(), 401);
      await dialog.getByRole('alert').waitFor();
      await authControl(page, 'password').fill(newPassword);
      const next = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/login' && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: '登录', exact: true }).click();
      assert.equal((await next).status(), 200);
      await expectSignedIn(page);
      await peer.page.reload();
      await workspaceLogin(peer.page).waitFor();
      return {
        resetStatus: 200,
        revokedSessions: 2,
        remainingOldSessions: 0,
        oldPasswordStatus: 401,
        newPasswordStatus: 200,
      };
    },
  );

  await check(
    'Registering an existing account cannot overwrite identity and explains the consumed OTP',
    async () => {
      const page = peer.page;
      currentPage = page;
      await waitForOtpCooldown(primaryPhone);
      await openAuth(page);
      await page.getByRole('button', { name: '创建新账号', exact: true }).click();
      await authControl(page, 'phone').fill(primaryPhone);
      smsCodes.delete(`${primaryPhone}:register`);
      const sent = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/otp' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '获取验证码', exact: true }).click();
      assert.equal((await sent).status(), 202);
      await fillRegistration(page, await codeFor(primaryPhone, 'register'), '不能替换原账号');
      const duplicate = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/register' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '创建账号', exact: true }).click();
      assert.equal((await duplicate).status(), 409);
      await until(
        async () => (await authControl(page, 'code').inputValue()) === '',
        'consumed code clears after definitive registration rejection',
      );
      assert.match(
        await page.getByRole('region', { name: '注册账号', exact: true }).innerText(),
        /验证码已使用/,
      );
      const rows = (
        await db.query('SELECT id,display_name FROM users WHERE phone=$1', [primaryPhone])
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, primaryUserId);
      assert.equal(rows[0].display_name, primaryName);
      await capture(page, '06-existing-account-registration');
      await closeDialog(page.getByRole('region', { name: '注册账号', exact: true }));
      await peer.context.close();
      currentPage = main.page;
      return {
        status: 409,
        preservedAccounts: 1,
        consumedCodeCleared: true,
        noSelfDeletionContractClaimed: true,
      };
    },
  );

  await check(
    'Unknown SMS receipt permits the real delivered code without duplicate dispatch',
    async () => {
      const phone = makePhone();
      ownedPhones.add(phone);
      unknownSms.add(phone);
      const other = await newContext();
      const page = other.page;
      await openAuth(page);
      await page.getByRole('button', { name: '创建新账号', exact: true }).click();
      await authControl(page, 'phone').fill(phone);
      const before = smsDeliveries.length;
      const sent = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/otp' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '获取验证码', exact: true }).click();
      const response = await sent;
      assert.equal(response.status(), 503);
      assert.equal((await response.json()).error.code, 'SMS_SEND_UNKNOWN');
      await authControl(page, 'code').waitFor();
      assert.equal(await page.locator('.auth-send-code').isDisabled(), true);
      await fillRegistration(page, await codeFor(phone, 'register'), '短信回执验收');
      const registered = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/v1/auth/register' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '创建账号', exact: true }).click();
      assert.equal((await registered).status(), 201);
      await expectSignedIn(page, '短信回执验收', true);
      documentActor = { ...other, phone, name: '短信回执验收' };
      assert.equal(smsDeliveries.length - before, 1);
      return {
        sendReceipt: 'unknown',
        actualCodeAccepted: true,
        smsDispatches: 1,
        automaticResends: 0,
      };
    },
  );

  await check(
    'Session expiry retains exact document text for the same actor and never overwrites a newer cloud version',
    async () => {
      assert.ok(documentActor, 'The preceding real registration must establish the document actor');
      const { page, context, phone, name } = documentActor;
      currentPage = page;
      const current = await session(context);
      const space = current.spaces.find((item) => item.kind === 'personal');
      assert.ok(space);
      const projectTitle = '会话恢复验收项目';
      const created = await request(context, 'POST', '/v1/projects', {
        spaceId: space.id,
        title: projectTitle,
      });
      assert.equal(created.status, 201);
      const projectId = created.body.project.id;
      const initial = await request(context, 'POST', `/v1/projects/${projectId}/documents`, {
        title: '云端原始文档',
        body: '云端原始正文',
      });
      assert.equal(initial.status, 201);
      const document = initial.body.document;
      await page.reload();
      await page.getByRole('button', { name: `账户：${name}`, exact: true }).waitFor();
      async function openProjectDocuments() {
        await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
        await page
          .getByRole('navigation', { name: '项目', exact: true })
          .getByRole('button', { name: projectTitle, exact: true })
          .click();
        const compact = page.getByRole('button', { name: '切换工作视图', exact: true });
        if (await compact.isVisible()) {
          await compact.click();
          const navigation = page.getByRole('dialog', { name: '工作视图', exact: true });
          await navigation.locator('button[data-view="docs"]').click();
          await navigation.waitFor({ state: 'hidden' });
        } else {
          await page
            .getByRole('navigation', { name: '工作视图', exact: true })
            .getByRole('button', { name: '文档', exact: true })
            .click();
        }
        await page.locator('.documents-view').waitFor();
      }
      await openProjectDocuments();
      await page.locator('.document-row').filter({ hasText: document.title }).click();
      const draftTitle = keepPrivate('  会话保留草稿  ');
      const draftBody = keepPrivate('逐字保留的草稿\n第二行 🧑🏽‍🎨\n\n结尾空格  ');
      await page.getByRole('textbox', { name: '文档标题', exact: true }).fill(draftTitle);
      await page.getByRole('textbox', { name: '文档内容', exact: true }).fill(draftBody);
      const cookie = await savedSession(context);
      const revoked = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: { origin, cookie: `xiutu_session=${cookie.value}` },
      });
      assert.equal(revoked.statusCode, 200);
      // Drive the same focus observer used when a user returns to an expired
      // tab; its GET/session and actor transition remain actual application code.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await workspaceLogin(page).waitFor();
      await page.locator('.documents-view').waitFor({ state: 'hidden' });
      const hasUnloadProtection = () =>
        page.evaluate(() => {
          const event = new Event('beforeunload', { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        });
      assert.equal(
        await hasUnloadProtection(),
        true,
        'Retained draft must still protect page close after its editor unmounts',
      );
      await actualLogin(page, phone, password, name);
      // The original project is still closed. The current actor can export its
      // retained document from AccountCenter without reopening that project.
      const account = await openAccount(page, name);
      await page.getByTestId('account-tab-data').click();
      await page.getByTestId('account-document-draft').waitFor();
      const accountDownloadEvent = page.waitForEvent('download');
      await page.getByTestId('account-document-draft-export').click();
      const accountDownloadPath = await (await accountDownloadEvent).path();
      assert.ok(accountDownloadPath);
      const accountExport = JSON.parse(await readFile(accountDownloadPath, 'utf8'));
      assert.equal(accountExport.title, draftTitle);
      assert.equal(accountExport.body, draftBody);
      assert.equal(accountExport.baseVersion, document.version);
      assert.equal(Object.hasOwn(accountExport, 'actorId'), false);
      await closeDialog(account);
      const newer = await request(context, 'PATCH', `/v1/documents/${document.id}`, {
        expectedVersion: document.version,
        title: '云端更新后的文档',
        body: '保留这份更高版本',
      });
      assert.equal(newer.status, 200);
      await openProjectDocuments();
      await page.getByTestId('document-draft-recovery').waitFor();
      assert.equal(
        await page.getByRole('textbox', { name: '文档内容', exact: true }).count(),
        0,
        'A retained draft must require explicit recovery instead of opening itself',
      );
      const downloadEvent = page.waitForEvent('download');
      await page.getByTestId('document-draft-export').click();
      const download = await downloadEvent;
      const downloadedPath = await download.path();
      assert.ok(downloadedPath);
      const exported = JSON.parse(await readFile(downloadedPath, 'utf8'));
      assert.equal(exported.title, draftTitle);
      assert.equal(exported.body, draftBody);
      assert.equal(exported.baseVersion, document.version);
      assert.equal(exported.documentId, document.id);
      await page.getByTestId('document-draft-recover').click();
      assert.equal(
        await page.getByRole('textbox', { name: '文档标题', exact: true }).inputValue(),
        draftTitle,
      );
      assert.equal(
        await page.getByRole('textbox', { name: '文档内容', exact: true }).inputValue(),
        draftBody,
      );
      const rejectedSave = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/v1/documents/${document.id}` &&
          response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: '保存文档', exact: true }).click();
      assert.equal((await rejectedSave).status(), 409);
      await page.locator('.document-conflict').waitFor();
      assert.equal(
        await page.getByRole('textbox', { name: '文档内容', exact: true }).inputValue(),
        draftBody,
      );
      const cloud = await request(context, 'GET', `/v1/projects/${projectId}/documents`);
      const latest = cloud.body.documents.find((item) => item.id === document.id);
      assert.equal(latest.version, newer.body.document.version);
      assert.equal(latest.body, newer.body.document.body);
      const discardAccount = await openAccount(page, name);
      await page.getByTestId('account-tab-data').click();
      await page.getByTestId('account-document-draft-discard').click();
      await page.getByTestId('account-document-draft-confirm').click();
      await until(
        async () => (await page.getByTestId('account-document-draft').count()) === 0,
        'explicit account discard removes its own retained row',
      );
      await closeDialog(discardAccount);
      assert.equal(
        await page.getByRole('textbox', { name: '文档标题', exact: true }).inputValue(),
        document.title,
      );
      assert.equal(
        await page.getByRole('textbox', { name: '文档内容', exact: true }).inputValue(),
        document.body,
      );
      await until(
        async () => !(await hasUnloadProtection()),
        'account discard releases the matching active editor copy',
      );
      // A fresh edit after that explicit discard must establish a new lineage,
      // which the subsequent real logout is separately authorized to clear.
      await page.getByRole('textbox', { name: '文档标题', exact: true }).fill(draftTitle);
      await page.getByRole('textbox', { name: '文档内容', exact: true }).fill(draftBody);
      assert.equal(
        await page.getByRole('textbox', { name: '文档内容', exact: true }).inputValue(),
        draftBody,
      );
      await until(hasUnloadProtection, 'new document edit is independently protected');
      await logout(page, name);
      await until(
        async () => !(await hasUnloadProtection()),
        'confirmed logout releases its own document unload protection',
      );
      await actualLogin(page, phone, password, name);
      await openProjectDocuments();
      await page.locator('.document-row').filter({ hasText: newer.body.document.title }).waitFor();
      assert.equal(await page.getByTestId('document-draft-recovery').count(), 0);
      await context.close();
      currentPage = main.page;
      return {
        actualSessionRevocations: 1,
        retainedAfterUnmount: true,
        exactExportRoundTrip: true,
        accountExportBeforeProjectReopen: true,
        accountDiscardSynchronizesActiveEditor: true,
        explicitRecovery: true,
        staleSaveStatus: 409,
        cloudVersionPreserved: true,
        explicitLogoutClearsOwnDraft: true,
      };
    },
  );

  await check(
    'Account actions remain reachable in both themes across desktop, tablet and narrow/short phones',
    async () => {
      const page = main.page;
      currentPage = page;
      const sizes = [
        [1440, 960],
        [1024, 768],
        [390, 844],
        [320, 568],
        [844, 390],
      ];
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        for (const theme of ['light', 'dark']) {
          await setTheme(page, theme);
          const account = await openAccount(page);
          const controls = [];
          for (const tab of ['overview', 'security', 'billing', 'data']) {
            const button = page.getByTestId(`account-tab-${tab}`);
            controls.push(await measureReachable(page, button, `${tab} tab`));
            await button.click();
            assert.equal(await button.getAttribute('aria-selected'), 'true');
            if (tab === 'security')
              controls.push(
                await measureReachable(
                  page,
                  page.getByTestId('account-reset-password'),
                  'reset password',
                ),
              );
            if (tab === 'data')
              controls.push(
                await measureReachable(page, page.getByTestId('account-logout'), 'log out'),
              );
          }
          controls.push(
            await measureReachable(
              page,
              account.locator('.account-page-back'),
              'return from account page',
            ),
          );
          report.layouts.push({ width, height, theme, controls });
          await page.getByTestId('account-tab-overview').click();
          await capture(page, `account-${width}x${height}-${theme}`);
          await closeDialog(account);
        }
      }
      return {
        accountLayouts: sizes.length * 2,
        checkedControls: report.layouts.reduce((sum, layout) => sum + layout.controls.length, 0),
        horizontalOverflowPx: 0,
      };
    },
  );

  await check(
    'Command search keeps keyboard focus, skips unavailable actions and restores empty search',
    async () => {
      const page = main.page;
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.getByRole('button', { name: '搜索工具与操作（Ctrl / ⌘ K）', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '搜索工具与操作', exact: true });
      const input = dialog.getByRole('combobox', { name: '搜索工具与操作', exact: true });
      await input.waitFor();
      for (const key of ['Home', 'ArrowDown', 'End', 'ArrowUp']) {
        await input.press(key);
        const selected = await input.getAttribute('aria-activedescendant');
        assert.ok(selected, 'An enabled command must be selected');
        assert.equal(await page.locator(`[id="${selected}"]`).getAttribute('aria-disabled'), null);
        assert.equal(await input.evaluate((element) => document.activeElement === element), true);
      }
      await input.fill('不存在的命令验收');
      await dialog.getByRole('button', { name: '查看全部操作', exact: true }).waitFor();
      assert.equal(await input.getAttribute('aria-activedescendant'), null);
      await dialog.getByRole('button', { name: '查看全部操作', exact: true }).click();
      assert.equal(await input.inputValue(), '');
      assert.equal(await input.evaluate((element) => document.activeElement === element), true);
      await capture(page, '07-command-search');
      await input.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      return {
        keyboardKeys: 4,
        disabledActionsSkipped: true,
        emptyResultRecovery: true,
        inputFocusRetained: true,
      };
    },
  );

  await check(
    'Every authentication step fits both themes and five viewports without hidden-ancestor scrolling',
    async () => {
      const other = await newContext();
      const page = other.page;
      const phone = makePhone();
      ownedPhones.add(phone);
      const sizes = [
        [1440, 960],
        [1024, 768],
        [390, 844],
        [320, 568],
        [844, 390],
      ];
      const postsBefore = Object.entries(report.requestCounts)
        .filter(([key]) => key.startsWith('POST /v1/auth/'))
        .reduce((sum, [, count]) => sum + count, 0);
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        for (const theme of ['light', 'dark']) {
          await setTheme(page, theme);
          await openAuth(page);
          async function record(mode, title, controls) {
            const dialog = page.getByRole('region', { name: title, exact: true });
            await dialog.waitFor();
            const measurements = [];
            for (const [name, target] of controls)
              measurements.push(await measureReachable(page, target, name));
            measurements.push(
              await measureReachable(
                page,
                dialog.locator('.account-page-back'),
                'return from account page',
              ),
            );
            report.authLayouts.push({ width, height, theme, mode, controls: measurements });
            await capture(page, `auth-${mode}-${width}x${height}-${theme}`);
          }
          const field = (name) => authControl(page, name);
          const button = (name) =>
            page.locator('.account-page.account-auth').getByRole('button', { name, exact: true });
          const headerLoginReturn = page
            .locator('.account-page.account-auth .account-page-header')
            .getByRole('button', { name: '返回登录', exact: true });
          const existingAccount = page
            .locator('.account-page.account-auth .auth-entry-links')
            .getByRole('button', { name: '登录已有账号', exact: true });
          await record('password', '登录工作空间', [
            ['phone', field('phone')],
            ['password', field('password')],
            ['show password', button('显示密码')],
            ['log in', button('登录')],
            ['forgot password', button('忘记密码？')],
            ['register', button('创建新账号')],
          ]);
          await button('验证码登录').click();
          await record('otp', '登录工作空间', [
            ['phone', field('phone')],
            ['code', field('code')],
            ['send code', button('获取验证码')],
            ['log in', button('登录')],
          ]);
          await button('创建新账号').click();
          await record('register-phone', '注册账号', [
            ['phone', field('phone')],
            ['send code', button('获取验证码')],
            ['existing code', button('已有验证码，继续')],
            ['back to log in', headerLoginReturn],
          ]);
          await field('phone').fill(phone);
          await button('已有验证码，继续').click();
          // Optional invitation codes use progressive disclosure. Exercise the
          // real expansion before checking this field's visible geometry.
          if (!(await field('invite-code').isVisible())) await button('有邀请码？').click();
          await record('register-details', '注册账号', [
            ['code', field('code')],
            ['name', field('display-name')],
            ['password', field('password')],
            ['invite', field('invite-code')],
            ['register', button('创建账号')],
            ['sign in to an existing account', existingAccount],
          ]);
          await field('code').focus();
          await existingAccount.click();
          await page.getByRole('region', { name: '登录工作空间', exact: true }).waitFor();
          await button('忘记密码？').click();
          await record('reset', '重置密码', [
            ['phone', field('phone')],
            ['code', field('code')],
            ['send code', button('获取验证码')],
            ['new password', field('password')],
            ['reset', button('更新密码')],
            ['back to log in', headerLoginReturn],
          ]);
          await closeDialog(page.getByRole('region', { name: '重置密码', exact: true }));
        }
      }
      const postsAfter = Object.entries(report.requestCounts)
        .filter(([key]) => key.startsWith('POST /v1/auth/'))
        .reduce((sum, [, count]) => sum + count, 0);
      assert.equal(
        postsAfter,
        postsBefore,
        'Reviewing form steps may not dispatch SMS or create an account',
      );
      await other.context.close();
      currentPage = main.page;
      return {
        formLayouts: report.authLayouts.length,
        states: 5,
        checkedControls: report.authLayouts.reduce(
          (sum, layout) => sum + layout.controls.length,
          0,
        ),
        mutationRequests: 0,
      };
    },
  );

  await check(
    'Unconfigured SMS is a real capability gate while password sign-in remains available',
    async () => {
      sms.configured = false;
      const other = await newContext({ width: 390, height: 844 });
      const page = other.page;
      const config = await request(other.context, 'GET', '/v1/public-config');
      assert.equal(config.body.capabilities.smsConfigured, false);
      const dialog = await openAuth(page);
      await dialog.getByRole('button', { name: '验证码登录', exact: true }).click();
      const phone = makePhone();
      ownedPhones.add(phone);
      await authControl(page, 'phone').fill(phone);
      assert.equal(
        await dialog.getByRole('button', { name: '短信暂不可用', exact: true }).isDisabled(),
        true,
      );
      const before = smsDeliveries.length;
      const denied = await request(other.context, 'POST', '/v1/auth/otp', {
        phone,
        purpose: 'login',
      });
      assert.equal(denied.status, 503);
      assert.equal(denied.body.error.code, 'SMS_NOT_CONFIGURED');
      assert.equal(smsDeliveries.length, before);
      await dialog.getByRole('button', { name: '密码登录', exact: true }).click();
      assert.equal(
        await dialog.getByRole('button', { name: '登录', exact: true }).isEnabled(),
        true,
      );
      await capture(page, '08-unavailable-sms-password-route');
      await other.context.close();
      currentPage = main.page;
      return {
        smsConfigured: false,
        serverStatus: 503,
        smsDispatches: 0,
        passwordRouteAvailable: true,
      };
    },
  );

  await check(
    'Changing accounts preserves private cloud provenance and a denied copy never falls back to uploading source bytes',
    async () => {
      const page = main.page;
      currentPage = page;
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.getByRole('button', { name: `账户：${primaryName}`, exact: true }).waitFor();
      const canvas = page.locator('canvas[aria-label="照片编辑预览"]');
      await until(
        () => canvas.evaluate((element) => element.width === 32 && element.height === 24),
        'previously imported local fixture remains available',
      );
      async function saveThroughNewProject(title) {
        const creation = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/v1/projects' &&
            response.request().method() === 'POST',
        );
        await page.getByRole('button', { name: '保存', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
        await dialog.getByRole('textbox', { name: '项目名称', exact: true }).fill(title);
        await dialog.getByRole('button', { name: '创建', exact: true }).click();
        const response = await creation;
        assert.equal(response.status(), 201);
        const { project } = await response.json();
        await dialog.waitFor({ state: 'hidden' });
        await until(
          () => page.getByRole('button', { name: '保存', exact: true }).isEnabled(),
          'save attempt finishes',
        );
        return project;
      }
      const uploads = [],
        artworks = [];
      const watchInitialSave = (response) => {
        if (response.request().method() !== 'POST') return;
        const path = new URL(response.url()).pathname;
        if (/^\/v1\/projects\/[^/]+\/assets$/.test(path)) uploads.push(response);
        if (/^\/v1\/projects\/[^/]+\/artworks$/.test(path)) artworks.push(response);
      };
      page.on('response', watchInitialSave);
      const sourceProject = await saveThroughNewProject('原账号私有图像');
      page.off('response', watchInitialSave);
      assert.equal(uploads.length, 1);
      assert.equal(artworks.length, 1);
      assert.equal(uploads[0].status(), 201);
      assert.equal(artworks[0].status(), 201);
      const sourceAsset = (await uploads[0].json()).asset;
      const sourceArtwork = (await artworks[0].json()).artwork;
      const compact = page.getByRole('button', { name: '切换工作视图', exact: true });
      if (await compact.isVisible()) {
        await compact.click();
        const navigation = page.getByRole('dialog', { name: '工作视图', exact: true });
        await navigation.locator('button[data-view="works"]').click();
        await navigation.waitFor({ state: 'hidden' });
      } else
        await page
          .getByRole('navigation', { name: '工作视图', exact: true })
          .getByRole('button', { name: '作品', exact: true })
          .click();
      const cloudOpen = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/v1/artworks/${sourceArtwork.id}` &&
          response.request().method() === 'GET',
      );
      await page
        .locator('.library-version-links button')
        .filter({ hasText: sourceArtwork.title })
        .click();
      assert.equal((await cloudOpen).status(), 200);
      await until(
        () => canvas.evaluate((element) => element.width === 32 && element.height === 24),
        'private cloud source is actually opened',
      );
      await logout(page);
      await actualLogin(page, documentActor.phone, password, documentActor.name);
      assert.equal(
        (await request(main.context, 'GET', `/v1/projects/${sourceProject.id}`)).status,
        404,
        'The second actor must have no access to the private source project',
      );
      const mutationPaths = [],
        copies = [];
      const watchMutation = (request) => {
        if (request.method() === 'POST') mutationPaths.push(new URL(request.url()).pathname);
      };
      const copyPath = `/v1/assets/${sourceAsset.id}/copy`;
      const watchCopy = (response) => {
        if (response.request().method() === 'POST' && new URL(response.url()).pathname === copyPath)
          copies.push(response);
      };
      page.on('request', watchMutation);
      page.on('response', watchCopy);
      const destination = await saveThroughNewProject('新账号隔离目标');
      page.off('request', watchMutation);
      page.off('response', watchCopy);
      assert.equal(
        copies.length,
        1,
        'Known cloud bytes must attempt authorized copy after an actor switch',
      );
      assert.equal(copies[0].status(), 404);
      assert.equal((await copies[0].json()).error.code, 'PROJECT_NOT_FOUND');
      assert.equal(
        mutationPaths.filter((path) => path === `/v1/projects/${destination.id}/assets`).length,
        0,
        'Copy rejection must never upload the already-downloaded private file',
      );
      assert.equal(
        mutationPaths.filter((path) => path === `/v1/projects/${destination.id}/artworks`).length,
        0,
      );
      const target = await request(main.context, 'GET', `/v1/projects/${destination.id}`);
      assert.equal(target.status, 200);
      assert.equal(target.body.assets.length, 0);
      assert.equal(target.body.artworks.length, 0);
      assert.equal(
        await canvas.evaluate((element) => element.width === 32 && element.height === 24),
        true,
      );
      return {
        privateSourceReadStatus: 404,
        authorizedCopyStatus: 404,
        copyAttempts: 1,
        fallbackUploadRequests: 0,
        destinationArtworkRequests: 0,
        destinationAssets: 0,
        destinationArtworks: 0,
        localPreviewRetained: true,
      };
    },
  );
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.unexpectedOrigins, []);
} catch (error) {
  report.error = safeError(error);
  if (currentPage) await capture(currentPage, 'failure').catch(() => {});
  console.error(safeError(error));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.smsFixtureDeliveries = smsDeliveries;
  report.summary = {
    total: report.cases.length,
    passed: report.cases.filter((item) => item.state === 'passed').length,
    failed: report.cases.filter((item) => item.state === 'failed').length,
    pageErrors: report.pageErrors.length,
    unexpectedOrigins: report.unexpectedOrigins.length,
  };
  try {
    const serialized = JSON.stringify(report, null, 2);
    for (const value of privateValues) {
      if (value.length >= 10)
        assert.equal(
          serialized.includes(value),
          false,
          'Private fixture value entered artifact report',
        );
    }
    await writeFile(resolve(artifacts, 'report.json'), serialized + '\n');
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  } finally {
    // Clean resources even if artifact writing or one preceding close fails.
    // Dependency order is intentional: finish browser traffic before closing
    // the application and close the application before its database pool.
    for (const cleanup of [
      () => browser?.close(),
      () => vite?.close(),
      () => app?.close(),
      () => db?.end(),
      () => directory && rm(directory, { recursive: true, force: true }),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        console.error(safeError(error));
        process.exitCode = 1;
      }
    }
    smsCodes.clear();
    privateValues.clear();
  }
}
