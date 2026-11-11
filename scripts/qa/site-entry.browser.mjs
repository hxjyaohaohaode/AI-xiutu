/** Public entry integration checks, executed by web-account-smoke.
 * Uses the actual frontend, renderer, API and isolated database already owned by
 * that harness. It creates no account, sends no SMS and starts no paid task.
 */
import assert from 'node:assert/strict';

const viewports = [
  { width: 1440, height: 960 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
];
const locales = [
  { value: 'zh-CN', headline: '让想法，', login: '登录', auth: '登录工作空间' },
  { value: 'zh-TW', headline: '讓想法，', login: '登入', auth: '登入工作空間' },
  { value: 'en', headline: 'Make it', login: 'Log in', auth: 'Sign in to your space' },
];

async function canvasFingerprint(canvas) {
  return canvas.evaluate((element) => {
    const context = element.getContext('2d');
    if (!context || !element.width || !element.height) return null;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let checksum = 2166136261;
    let opaque = 0;
    for (let i = 0; i < pixels.length; i++) {
      checksum = Math.imul(checksum ^ pixels[i], 16777619) >>> 0;
      if (i % 4 === 3 && pixels[i] > 0) opaque++;
    }
    return { width: element.width, height: element.height, checksum, opaque };
  });
}

// About intentionally scrolls the document. Studio's existing measurement
// rejects all document scrolling, so use a distinct public-page measurement.
async function measureAboutControl(page, target, name) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(async (element) => {
    const animations = new Set();
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement)
      for (const animation of ancestor.getAnimations())
        if (Number.isFinite(animation.effect?.getComputedTiming().iterations))
          animations.add(animation);
    await Promise.allSettled([...animations].map((animation) => animation.finished));
  });
  const geometry = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const textOverflows = [...document.querySelectorAll('.about-hero h1, .about-intro')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => node.className || node.tagName);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      hit: !!hit && (hit === element || element.contains(hit)),
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      textOverflows,
    };
  });
  assert.ok(geometry.width > 0 && geometry.height > 0, `${name} must be rendered`);
  assert.ok(
    geometry.left >= -1 &&
      geometry.right <= geometry.viewportWidth + 1 &&
      geometry.top >= -1 &&
      geometry.bottom <= geometry.viewportHeight + 1,
    `${name} must fit in the visible viewport`,
  );
  assert.equal(geometry.hit, true, `${name} must receive a pointer at its center`);
  assert.ok(geometry.horizontalOverflow <= 1, `${name} must not create page overflow`);
  assert.deepEqual(geometry.textOverflows, [], 'Public heading and introduction must wrap');
  return { name, ...geometry };
}

async function selectLocale(page, selector, locale) {
  await page.locator(selector).selectOption(locale);
  await page.waitForFunction((value) => document.documentElement.lang === value, locale);
}

export async function runSiteEntryChecks({
  newContext,
  check,
  capture,
  until,
  authControl,
  measureReachable,
  report,
  phone,
}) {
  const { context, page } = await newContext(viewports[0], 'about');
  const apiMutations = [];
  const observeMutation = (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/v1/'))
      apiMutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  };
  page.on('request', observeMutation);
  report.siteEntryLayouts = [];
  try {
    await check(
      'About first entry renders real adjustments and preserves Studio on return',
      async () => {
        assert.equal(
          await page.locator('.site-studio').count(),
          0,
          'First entry must be the public page',
        );
        await page.locator('.about-hero h1').getByText('让想法，', { exact: true }).waitFor();
        await page.locator('.study-compare').waitFor();
        const preview = page.locator('canvas.study-result');
        const original = await canvasFingerprint(preview);
        assert.ok(original?.opaque > 0, 'The About demonstration must render actual image pixels');
        await page.getByRole('slider', { name: /^色温/ }).press('End');
        assert.equal(await page.getByRole('slider', { name: /^色温/ }).inputValue(), '60');
        await page
          .locator('.study-presets')
          .getByRole('button', { name: '鲜明', exact: true })
          .click();
        assert.equal(
          await page
            .locator('.study-presets')
            .getByRole('button', { name: '鲜明', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        );
        await until(
          async () => (await canvasFingerprint(preview))?.checksum !== original.checksum,
          'the real About renderer responds to an adjustment',
        );
        await page.locator('.study-compare').press('Home');
        assert.equal(await page.locator('.study-compare').inputValue(), '0');
        await capture(page, 'site-about-adjusted-desktop');
        await page.locator('.study-open').click();
        await page.waitForURL((url) => url.hash === '#/studio');
        const canvas = page.locator('canvas[aria-label="照片编辑预览"]');
        await canvas.waitFor();
        await until(
          async () => (await canvasFingerprint(canvas))?.opaque > 0,
          'the public sample opens in the actual editor',
        );
        await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
        await page
          .getByRole('navigation', { name: '编辑工具', exact: true })
          .getByRole('button', { name: '色彩', exact: true })
          .click();
        const colorPanel = page.locator('.free-panel[aria-hidden="false"]');
        await colorPanel.getByRole('button', { name: /^色温，/ }).click();
        assert.equal(
          await colorPanel.getByRole('slider', { name: '色温', exact: true }).inputValue(),
          '60',
        );
        await colorPanel.getByRole('button', { name: /^饱和度，/ }).click();
        assert.equal(
          await colorPanel.getByRole('slider', { name: '饱和度', exact: true }).inputValue(),
          '18',
        );
        await capture(page, 'site-studio-retains-sample-adjustments');
        const owner = await canvas.elementHandle();
        assert.ok(owner);
        try {
          const editorPixels = await canvasFingerprint(canvas);
          await page.locator('.workspace-home-link').click();
          await page.locator('.about-page').waitFor();
          assert.equal(await page.locator('.site-studio').getAttribute('hidden'), '');
          assert.equal(await page.locator('.site-studio').getAttribute('inert'), '');
          assert.equal(await owner.evaluate((element) => element.isConnected), true);
          await page.keyboard.press('Control+k');
          assert.equal(
            await page.locator('dialog[open]').count(),
            0,
            'Studio shortcuts must not open a hidden dialog over About',
          );
          await page.locator('.about-hero-actions .about-primary').click();
          await page.locator('.site-studio:not([hidden])').waitFor();
          assert.equal(
            await owner.evaluate(
              (element) =>
                element.isConnected &&
                document.querySelector('canvas[aria-label="照片编辑预览"]') === element,
            ),
            true,
          );
          assert.deepEqual(
            await canvasFingerprint(canvas),
            editorPixels,
            'Returning to Studio must retain the displayed edit',
          );
          await capture(page, 'site-studio-retained-after-about');
          await page.goBack();
          await page.locator('.about-page').waitFor();
          await page.goForward();
          await page.locator('.site-studio:not([hidden])').waitFor();
          assert.equal(await owner.evaluate((element) => element.isConnected), true);
          assert.deepEqual(
            await canvasFingerprint(canvas),
            editorPixels,
            'History navigation must not replace the source or remount the editor',
          );
          await page.locator('.workspace-home-link').click();
          await page.locator('.about-page').waitFor();
        } finally {
          await owner.dispose();
        }
        assert.deepEqual(
          apiMutations,
          [],
          'About, local demo and return must not upload or mutate an account',
        );
        return {
          actualPreviewPixels: true,
          localSampleOpened: true,
          retainedCanvas: true,
          historyRoundTrip: true,
          hiddenShortcutsInactive: true,
          apiMutations: 0,
        };
      },
    );

    await check('About is scrollable and fits five viewports in all three languages', async () => {
      for (const locale of locales) {
        await selectLocale(page, '.about-header .language-select select', locale.value);
        await page.locator('.about-hero h1').getByText(locale.headline, { exact: true }).waitFor();
        assert.equal(await page.locator('.about-login').innerText(), locale.login);
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          await page.evaluate(() => scrollTo(0, 0));
          await page.mouse.move(24, Math.min(400, viewport.height - 40));
          await page.mouse.wheel(0, 600);
          await page.waitForFunction(() => scrollY > 20);
          const controls = [];
          for (const [name, selector] of [
            ['language', '.about-header .language-select select'],
            ['login', '.about-login'],
            ['start or resume', '.about-hero-actions .about-primary'],
            ['open sample', '.study-open'],
          ])
            controls.push(await measureAboutControl(page, page.locator(selector), name));
          report.siteEntryLayouts.push({
            surface: 'about',
            locale: locale.value,
            ...viewport,
            controls,
          });
          await page.locator('.about-header').scrollIntoViewIfNeeded();
          await capture(page, `site-about-${locale.value}-${viewport.width}x${viewport.height}`);
        }
      }
      return {
        locales: 3,
        viewports: viewports.length,
        layouts: locales.length * viewports.length,
        documentWheelScroll: true,
      };
    });

    await check('Auth language changes preserve typed fields and fit five viewports', async () => {
      await page.setViewportSize(viewports[0]);
      await page.locator('.about-login').click();
      const dialog = page.locator('.auth-dialog');
      await dialog.waitFor();
      const field = authControl(page, 'phone');
      await field.fill(phone);
      const owner = await field.elementHandle();
      assert.ok(owner);
      try {
        for (const locale of locales) {
          await selectLocale(page, '.auth-identity .language-select select', locale.value);
          await dialog.getByRole('heading', { name: locale.auth, exact: true }).waitFor();
          assert.equal(
            await field.inputValue(),
            phone,
            'Changing language must keep the entered phone',
          );
          assert.equal(
            await owner.evaluate(
              (element) =>
                element.isConnected &&
                document.querySelector('[data-testid="auth-phone"]') === element,
            ),
            true,
          );
          for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            if (viewport.width < 760) {
              const bounds = await dialog.boundingBox();
              assert.ok(bounds, 'The mobile authentication sheet must be visible');
              assert.ok(
                Math.abs(bounds.x) <= 1,
                'The authentication sheet must meet the left edge',
              );
              assert.ok(
                Math.abs(bounds.x + bounds.width - viewport.width) <= 1,
                'The authentication sheet must meet the right edge without a one-sided gutter',
              );
            }
            const controls = [];
            for (const [name, target] of [
              ['language', dialog.locator('.language-select select')],
              ['phone', field],
              ['password', authControl(page, 'password')],
              ['submit', dialog.locator('button[type="submit"]')],
              ['close', dialog.locator('.modal-header button')],
            ])
              controls.push(await measureReachable(page, target, name));
            report.siteEntryLayouts.push({
              surface: 'auth',
              locale: locale.value,
              ...viewport,
              controls,
            });
            await capture(page, `site-auth-${locale.value}-${viewport.width}x${viewport.height}`);
          }
        }
      } finally {
        await owner.dispose();
      }
      await dialog.locator('.modal-header button').click();
      await page.locator('.about-page').waitFor();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      assert.deepEqual(
        apiMutations,
        [],
        'Reviewing entry and locales must not send authentication requests',
      );
      return {
        locales: 3,
        viewports: viewports.length,
        layouts: locales.length * viewports.length,
        fieldIdentityRetained: true,
        typedPhoneRetained: true,
        returnedToAbout: true,
        apiMutations: 0,
      };
    });
  } catch (error) {
    await capture(page, 'site-entry-failure').catch(() => {});
    throw error;
  } finally {
    page.off('request', observeMutation);
    await context.close();
  }
}
