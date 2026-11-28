import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { writeOfficeBlock } from '@ai-xiutu/contracts';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.ts';
import { showEditorTopbar } from './studio-navigation.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  process.env.CI !== 'true' ||
  process.env.NODE_ENV === 'production' ||
  !databaseUrl ||
  !new URL(databaseUrl).pathname.includes('test')
)
  throw new Error('Use CI=true with a disposable test database.');
const port = Number(process.env.BROWSER_WEB_PORT || 4198);
const origin = `http://127.0.0.1:${port}`;
const artifacts = resolve(process.env.BROWSER_ARTIFACT_DIR || 'artifacts/browser-document-sharing');
const report = { viewportChecks: [], pageErrors: [], externalRequests: [] };
const dimensions = [
  [1400, 900],
  [820, 1100],
  [390, 844],
  [844, 390],
];
let fixture, web, browser, owner;

async function until(read, predicate, label) {
  const deadline = Date.now() + 22_000;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((resume) => setTimeout(resume, 180));
  } while (Date.now() < deadline);
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}

async function openOffice(page) {
  await page.goto(origin + '/#/studio');
  const nav = page.getByRole('button', { name: '打开空间与项目', exact: true });
  await nav.click();
  await page
    .locator('dialog.sidebar-navigation-modal')
    .getByRole('button', { name: /^V4 team/ })
    .click();
  await nav.click();
  await page
    .getByRole('navigation', { name: '项目', exact: true })
    .getByRole('button', { name: 'V4 project', exact: true })
    .click();
  await page.locator('.saved-work-open').filter({ hasText: 'Collaborative portrait' }).click();
  await page.locator('.collaboration-status[data-state="ready"]').waitFor();
  await showEditorTopbar(page);
  const compact = page.getByRole('button', { name: '切换工作视图', exact: true });
  await (
    (await compact.isVisible())
      ? compact
      : page.getByRole('button', { name: '项目与用量', exact: true })
  ).click();
  await page
    .getByRole('navigation', { name: '切换工作视图', exact: true })
    .locator('[data-view="docs"]')
    .click();
}

async function openDocument(page, title) {
  const row = page.locator('.document-row').filter({ has: page.locator(`[title="${title}"]`) });
  if (
    !(await row.isVisible()) &&
    (await page.getByRole('button', { name: '文档列表', exact: true }).isVisible())
  )
    await page.getByRole('button', { name: '文档列表', exact: true }).click();
  await row.click();
  await until(
    () => page.getByLabel('文档标题', { exact: true }).inputValue(),
    (value) => value === title,
    `Open ${title}`,
  );
}


/**
 * Document sharing: the owner enables document links in team settings policy,
 * opens the share dialog, sees who has access, creates a 7-day link with
 * download allowed, and an anonymous visitor (no cookies) opens the read-only
 * viewer with the embedded image on four viewports. Revoking the link makes the
 * same URL show the expired state.
 */
try {
  await mkdir(artifacts, { recursive: true });
  fixture = await collaborationFixture(databaseUrl, { origin });
  const title = '对外分享验收';
  const image = writeOfficeBlock({ kind: 'image', assetId: fixture.assetId, title: '样片' });
  const created = await fixture.call('POST', `/v1/projects/${fixture.projectId}/documents`, {
    title,
    body: ['# 发布说明', '- [x] 已完成拍摄', '正文：可以分享给客户查看。', image].join('\n'),
  });
  assert.equal(created.statusCode, 201);
  const documentId = created.json().document.id;
  const policy = (await fixture.call('GET', `/v1/spaces/${fixture.teamId}/sharing-policy`)).json().policy;
  assert.equal(
    (await fixture.call('PUT', `/v1/spaces/${fixture.teamId}/sharing-policy`, { ...policy, allowDocumentLinks: true })).statusCode,
    200,
  );
  await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(fixture.app.server.address().port);
  web = await preview({
    configFile: resolve('apps/web/vite.config.ts'),
    build: { outDir: process.env.BROWSER_DIST_DIR || resolve('apps/web/dist') },
    preview: { host: '127.0.0.1', port, strictPort: true },
  });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  report.browser = browser.version();
  const ownerContext = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await ownerContext.addCookies([{ name: 'xiutu_session', value: fixture.actors.owner.cookie.split('=')[1], url: origin }]);
  await ownerContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  owner = await ownerContext.newPage();
  owner.on('pageerror', (error) => report.pageErrors.push(error.message));
  await openOffice(owner);
  await openDocument(owner, title);
  await owner.getByRole('button', { name: '分享', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: `分享“${title}”` });
  await dialog.getByText('有权访问的成员').waitFor();
  const people = await dialog.locator('.share-people li').count();
  assert.ok(people >= 3, 'Space members are listed');
  await dialog.getByLabel('链接有效期').selectOption('7');
  await dialog.getByLabel('允许下载文件').check();
  await dialog.getByRole('button', { name: '创建链接', exact: true }).click();
  const url = await dialog.getByLabel('分享链接').inputValue();
  assert.match(url, /#\/shared\/[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole('button', { name: '复制链接', exact: true }).click();
  await dialog.getByRole('button', { name: '已复制', exact: true }).waitFor();
  assert.equal(await dialog.locator('.share-links li').count(), 1);
  await owner.screenshot({ path: resolve(artifacts, 'share-dialog.png') });

  // Anonymous visitor: a fresh context with no cookies.
  const visitorContext = await browser.newContext({ reducedMotion: 'reduce' });
  const visitor = await visitorContext.newPage();
  visitor.on('pageerror', (error) => report.pageErrors.push(error.message));
  const sentCookies = [];
  visitor.on('request', (request) => {
    if (request.url().includes('/v1/') && request.headers().cookie) sentCookies.push(request.url());
  });
  for (const [width, height] of dimensions) {
    await visitor.setViewportSize({ width, height });
    await visitor.goto(url.replace(/^https?:\/\/[^/]+/, origin));
    await visitor.getByRole('heading', { name: title }).waitFor();
    await visitor.locator('.ProseMirror .doc-h1').waitFor();
    await until(
      () => visitor.locator('.ProseMirror figure img').evaluate((img) => img.complete && img.naturalWidth > 0),
      Boolean,
      'Embedded image loads through the link',
    );
    const overflow = await visitor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `No horizontal overflow at ${width}x${height}`);
    assert.equal(await visitor.locator('.project-format-tools').count(), 0, 'No editing toolbar for visitors');
    assert.equal(await visitor.locator('.ProseMirror').getAttribute('contenteditable'), 'false');
    report.viewportChecks.push({ width, height, overflow });
    await visitor.screenshot({ path: resolve(artifacts, `shared-${width}x${height}.png`) });
  }
  assert.deepEqual(sentCookies, []);
  const [download] = await Promise.all([
    visitor.waitForEvent('download'),
    visitor.getByRole('button', { name: '下载 DOCX', exact: true }).click(),
  ]);
  report.download = download.suggestedFilename();

  // Revoke: the same URL now shows the invalid-link state.
  await dialog.getByRole('button', { name: '停用此链接' }).click();
  await until(() => dialog.locator('.share-links li').count(), (n) => n === 0, 'Link revoked');
  await visitor.reload();
  await visitor.getByRole('heading', { name: '链接无效或已失效' }).waitFor();
  await visitor.screenshot({ path: resolve(artifacts, 'shared-revoked.png') });
  const stored = (await fixture.db.query('SELECT revoked_at, view_count FROM document_share_links WHERE document_id=$1', [documentId])).rows[0];
  assert.ok(stored.revoked_at);
  report.sharing = { members: people, viewCount: stored.view_count, revoked: true };
  assert.deepEqual(report.pageErrors, []);
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  if (owner) await owner.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await web?.close();
  await fixture?.close();
}
