/**
 * About experience gates for the existing isolated web-account-smoke harness.
 * This module never starts a browser, API, account or paid task. All assertions
 * use the rendered DOM, native input, decoded image metadata or canvas pixels.
 * Call once with the harness's newContext/check/capture/until/report helpers.
 */
import assert from 'node:assert/strict';

const desktop = { width: 1440, height: 960 };
const examples = ['coast', 'portrait', 'color-study'];
const localeCases = [
  {
    locale: 'zh-CN',
    viewport: desktop,
    titles: ['海岸日光', '自然人像', '一抹鲜明'],
    open: '打开并编辑',
    selected: 0,
  },
  {
    locale: 'zh-TW',
    viewport: { width: 390, height: 844 },
    titles: ['海岸日光', '自然人像', '一抹鮮明'],
    open: '開啟並編輯',
    selected: 1,
  },
  {
    locale: 'en',
    viewport: { width: 320, height: 568 },
    titles: ['Coastal light', 'A natural portrait', 'A vivid note'],
    open: 'Open and edit',
    selected: 2,
  },
];

async function canvasPixels(canvas) {
  return canvas.evaluate((element) => {
    const context = element.getContext('2d');
    if (!context || !element.width || !element.height) return null;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let checksum = 2166136261;
    let opaque = 0;
    for (let i = 0; i < pixels.length; i += 1) {
      checksum = Math.imul(checksum ^ pixels[i], 16777619) >>> 0;
      if (i % 4 === 3 && pixels[i] > 0) opaque += 1;
    }
    return { width: element.width, height: element.height, checksum, opaque };
  });
}

async function decodedImage(image, expectedPath, dimensions, until) {
  const state = await until(async () => {
    const value = await image.evaluate((element) => ({
      complete: element.complete,
      width: element.naturalWidth,
      height: element.naturalHeight,
      pathname: new URL(element.currentSrc || element.src, location.href).pathname,
      origin: new URL(element.currentSrc || element.src, location.href).origin,
      pageOrigin: location.origin,
      alt: element.alt,
      loading: element.loading,
    }));
    return value.pathname === expectedPath && value.complete && value.width > 0 && value.height > 0
      ? value
      : null;
  }, `decode the actual ${expectedPath} image`);
  assert.equal(
    state.pathname,
    expectedPath,
    'The visible image must use its intended bundled asset',
  );
  assert.equal(
    state.origin,
    state.pageOrigin,
    'Public examples and UI captures stay on this origin',
  );
  assert.deepEqual(
    [state.width, state.height],
    dimensions,
    `${expectedPath} has its full source size`,
  );
  assert.ok(state.alt.trim(), `${expectedPath} needs a useful localized description`);
  return state;
}

async function selectLocale(page, locale) {
  await page.locator('.about-header .language-select select').selectOption(locale);
  await page.waitForFunction((value) => document.documentElement.lang === value, locale);
  await page.locator(`.about-page[data-locale="${locale}"]`).waitFor();
}

async function assertActiveFeature(page, index, until) {
  const article = page.locator('.experience-feature').nth(index);
  await until(
    async () => (await article.locator('button').getAttribute('aria-pressed')) === 'true',
    `feature ${index + 1} responds to the input`,
  );
  const image = page.locator('.experience-tour-image').nth(index);
  await until(
    async () =>
      image.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.getAttribute('aria-hidden') === 'false' &&
          style.visibility === 'visible' &&
          Number(style.opacity) === 1
        );
      }),
    `feature ${index + 1} finishes its visible transition`,
  );
  assert.equal(await page.locator('.experience-feature button[aria-pressed="true"]').count(), 1);
  assert.equal(await page.locator('.experience-tour-image[aria-hidden="false"]').count(), 1);
}

// Only the wheel advances this helper: no DOM scrollTo/scrollIntoView shortcut.
async function wheelTo(page, selector, until) {
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const position = await page.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const header = document.querySelector('.about-header')?.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        header: header?.bottom ?? 0,
        viewport: innerHeight,
        y: scrollY,
        maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      };
    });
    const reachesEnd = position.maximum - position.y <= 1;
    if (
      (position.top < position.viewport * 0.76 ||
        (reachesEnd && position.top < position.viewport - 1)) &&
      position.bottom > position.header + 24
    )
      return position.y;
    const direction = position.top < position.header ? -1 : 1;
    assert.ok(
      direction > 0 ? position.y < position.maximum - 1 : position.y > 1,
      `${selector} must be reachable through ordinary document scrolling`,
    );
    await page.mouse.move(12, Math.round(position.viewport * 0.65));
    await page.mouse.wheel(0, Math.round(position.viewport * 0.62) * direction);
    await until(
      async () => Math.abs((await page.evaluate(() => scrollY)) - position.y) > 1,
      `the document moves toward ${selector}`,
    );
    let previous = null;
    let stable = 0;
    await until(async () => {
      const y = await page.evaluate(() => scrollY);
      stable = y === previous ? stable + 1 : 0;
      previous = y;
      return stable >= 2;
    }, `the native wheel settles at ${selector}`);
  }
  assert.fail(`Native wheel did not reach ${selector} within the bounded page traversal`);
}

async function noTextClipping(page) {
  const overflows = await page.locator('.about-page').evaluate((root) => {
    const result = [];
    for (const element of root.querySelectorAll('h1,h2,h3,p,.experience-sample-caption')) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden')
        continue;
      if (element.scrollWidth > element.clientWidth + 1)
        result.push({ tag: element.tagName, text: element.textContent?.trim().slice(0, 80) });
    }
    return {
      text: result,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert.deepEqual(overflows.text, [], 'Public titles, descriptions and captions must wrap');
  assert.ok(overflows.page <= 1, 'The public page must not require horizontal scrolling');
}

async function tracePointer(page) {
  const bounds = await page.locator('.about-hero').boundingBox();
  assert.ok(bounds, 'The pointer interaction needs the visible hero');
  // The hero padding is an observed decorative region, away from any control.
  const y = bounds.y + 24;
  const left = bounds.x + bounds.width * 0.2;
  const right = bounds.x + bounds.width * 0.8;
  await page.mouse.move(left, y);
  await page.mouse.move(right, y + 14, { steps: 24 });
  await page.mouse.move(left + (right - left) * 0.3, y + 30, { steps: 24 });
}

export async function runAboutExperienceChecks({ newContext, check, capture, until, report }) {
  const evidence = { tour: null, motion: null, samples: [] };
  report.aboutExperience = evidence;
  const withPublicPage = async (name, viewport, run) => {
    const { context, page } = await newContext(viewport, 'about');
    const mutations = [];
    const observe = (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && path.startsWith('/v1/'))
        mutations.push(`${request.method()} ${path}`);
    };
    page.on('request', observe);
    try {
      const result = await run(page);
      assert.deepEqual(mutations, [], `${name} must not upload, authenticate or start a paid task`);
      return result;
    } catch (error) {
      await capture(page, `about-experience-${name}-failure`).catch(() => {});
      throw error;
    } finally {
      page.off('request', observe);
      await context.close();
    }
  };

  await check(
    'About shows real UI captures and a continuous wheel/hover/keyboard tour',
    async () => {
      return withPublicPage('tour', desktop, async (page) => {
        const hero = await decodedImage(
          page.locator('.experience-hero-window img'),
          '/about/workspace-zh-CN.webp',
          [1440, 960],
          until,
        );
        assert.equal(
          hero.loading,
          'eager',
          'The main product image must not wait for lazy loading',
        );
        const positions = [{ section: 'hero', y: await page.evaluate(() => scrollY) }];
        positions.push({ section: 'create', y: await wheelTo(page, '#create h2', until) });
        const features = page.locator('.experience-feature > h3 > button');
        assert.equal(await features.count(), 4);
        await features.nth(1).hover();
        await assertActiveFeature(page, 1, until);
        const local = await decodedImage(
          page.locator('.experience-tour-image').nth(1).locator('img'),
          '/about/local-zh-CN.webp',
          [1440, 960],
          until,
        );
        // Focus is established once; Tab itself must move to and select the next feature.
        await features.nth(1).focus();
        await page.mouse.move(12, 220);
        await page.keyboard.press('Tab');
        assert.equal(
          await features.nth(2).evaluate((element) => document.activeElement === element),
          true,
        );
        await assertActiveFeature(page, 2, until);
        const portrait = await decodedImage(
          page.locator('.experience-tour-image').nth(2).locator('img'),
          '/about/portrait-zh-CN.webp',
          [1440, 960],
          until,
        );
        await capture(page, 'about-experience-keyboard-feature');
        await features.nth(3).hover();
        await assertActiveFeature(page, 3, until);
        const layers = await decodedImage(
          page.locator('.experience-tour-image').nth(3).locator('img'),
          '/about/layers-zh-CN.webp',
          [1440, 960],
          until,
        );
        for (const selector of [
          '#agent h2',
          '#try h2',
          '#samples h2',
          '#together h2',
          '.experience-device h2',
          '#questions h2',
          '.about-closing h2',
          '.about-footer',
        ]) {
          positions.push({ section: selector, y: await wheelTo(page, selector, until) });
        }
        assert.ok(
          positions.at(-1).y > desktop.height * 2,
          'The full story must advance beyond the hero',
        );
        await noTextClipping(page);
        const phone = page.locator('.experience-device-phone img');
        await phone.scrollIntoViewIfNeeded();
        const mobile = await decodedImage(phone, '/about/phone-zh-CN.webp', [390, 844], until);
        await capture(page, 'about-experience-device-captures');
        evidence.tour = {
          positions,
          decoded: [hero, local, portrait, layers, mobile],
          hover: true,
          keyboardTab: true,
          nativeWheel: true,
          apiMutations: 0,
        };
        return evidence.tour;
      });
    },
  );

  await check(
    'About pointer motion changes real pixels and respects idle/offscreen/reduced motion',
    async () => {
      return withPublicPage('motion', desktop, async (page) => {
        // Explicitly exercise both user preferences in this isolated context.
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        assert.equal(
          await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches),
          true,
          'This gate needs the harness desktop pointer, not a fabricated event',
        );
        const canvas = page.locator('.about-hero .about-pointer-ribbons canvas');
        await until(
          async () => (await canvasPixels(canvas))?.width > 1,
          'the bounded pointer canvas sizes',
        );
        const baseline = await canvasPixels(canvas);
        await tracePointer(page);
        const drawn = await until(async () => {
          const pixels = await canvasPixels(canvas);
          return pixels && pixels.opaque > baseline.opaque && pixels.checksum !== baseline.checksum
            ? pixels
            : null;
        }, 'a real pointer movement paints a visible trace');
        await capture(page, 'about-experience-pointer-trace');
        const idle = await until(async () => {
          const pixels = await canvasPixels(canvas);
          return pixels?.checksum === baseline.checksum ? pixels : null;
        }, 'idle pointer decoration returns to its original canvas');
        await tracePointer(page);
        await until(
          async () => (await canvasPixels(canvas))?.checksum !== baseline.checksum,
          'the pointer decoration can wake after becoming idle',
        );
        const bounds = await page.locator('.about-hero').boundingBox();
        await page.mouse.move(12, desktop.height - 60);
        await page.mouse.wheel(0, Math.ceil(bounds.y + bounds.height + desktop.height / 2));
        await until(
          async () =>
            page
              .locator('.about-hero')
              .evaluate((element) => element.getBoundingClientRect().bottom <= 0),
          'the hero leaves the viewport',
        );
        const offscreen = await until(async () => {
          const pixels = await canvasPixels(canvas);
          return pixels?.checksum === baseline.checksum ? pixels : null;
        }, 'offscreen pointer decoration clears its dynamic canvas');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.keyboard.press('Control+Home');
        await page.waitForFunction(() => scrollY === 0);
        await tracePointer(page);
        await page.locator('.experience-hero-window').hover();
        const reduced = await page.locator('.about-hero').evaluate((root) => {
          const canvas = root.querySelector('.about-pointer-ribbons canvas');
          const rest = root.querySelector('.about-pointer-ribbons__rest');
          const preview = root.querySelector('.about-hover-preview__surface');
          return {
            canvasDisplay: getComputedStyle(canvas).display,
            restDisplay: getComputedStyle(rest).display,
            restOpacity: Number(getComputedStyle(rest).opacity),
            previewTransform: getComputedStyle(preview).transform,
            unreadableReveals: [
              ...document.querySelectorAll('.about-scroll-reveal, [data-reveal-piece]'),
            ].filter((element) => {
              const style = getComputedStyle(element);
              return Number(style.opacity) !== 1 || style.transform !== 'none';
            }).length,
          };
        });
        assert.equal(reduced.canvasDisplay, 'none', 'Reduced motion hides the dynamic canvas');
        assert.notEqual(reduced.restDisplay, 'none', 'A static illustration remains');
        assert.ok(reduced.restOpacity > 0, 'The static illustration remains visible');
        assert.equal(
          reduced.previewTransform,
          'none',
          'Reduced motion does not tilt the product capture',
        );
        assert.equal(
          reduced.unreadableReveals,
          0,
          'Reduced motion keeps all reveal content readable',
        );
        await capture(page, 'about-experience-reduced-motion');
        evidence.motion = { baseline, drawn, idle, offscreen, reduced, apiMutations: 0 };
        return evidence.motion;
      });
    },
  );

  await check(
    'Three localized sample galleries open the corresponding full-resolution source',
    async () => {
      for (const item of localeCases) {
        await withPublicPage(`samples-${item.locale}`, item.viewport, async (page) => {
          await selectLocale(page, item.locale);
          await decodedImage(
            page.locator('.experience-hero-window img'),
            `/about/workspace-${item.locale}.webp`,
            [1440, 960],
            until,
          );
          const cards = page.locator('.experience-sample button');
          assert.equal(await cards.count(), 3);
          const assets = [];
          for (let index = 0; index < examples.length; index += 1) {
            const card = cards.nth(index);
            await card.scrollIntoViewIfNeeded();
            assert.equal(await card.locator('h3').innerText(), item.titles[index]);
            assert.equal(
              await card.getAttribute('aria-label'),
              `${item.titles[index]} · ${item.open}`,
            );
            assets.push(
              await decodedImage(
                card.locator('img'),
                `/about/${examples[index]}.webp`,
                [1536, 1024],
                until,
              ),
            );
          }
          await noTextClipping(page);
          await capture(page, `about-experience-gallery-${item.locale}-${item.viewport.width}`);
          const expected = `${examples[item.selected]}.webp`;
          await cards.nth(item.selected).click();
          await page.waitForURL((url) => url.hash === '#/studio');
          await page
            .locator('.site-studio:not([hidden]) .canvas-stage[aria-busy="false"]')
            .waitFor();
          assert.equal(
            await page.locator('.canvas-file-info > span:not(.busy)').innerText(),
            expected,
          );
          assert.equal(await page.locator('.canvas-file-info > small').innerText(), '1536 × 1024');
          const preview = page.locator(
            '.site-studio:not([hidden]) .image-viewport canvas[aria-label]',
          );
          assert.equal(
            await preview.count(),
            1,
            'The imported image has one actual editing preview',
          );
          const pixels = await until(async () => {
            const value = await canvasPixels(preview);
            return value?.opaque > 0 ? value : null;
          }, `${expected} renders through the actual editor`);
          await capture(page, `about-experience-opened-${examples[item.selected]}-${item.locale}`);
          evidence.samples.push({
            locale: item.locale,
            viewport: item.viewport,
            assets,
            opened: expected,
            sourceDimensions: [1536, 1024],
            pixels,
            apiMutations: 0,
          });
        });
      }
      return {
        locales: 3,
        galleries: 3,
        decodedExamples: 9,
        distinctSourcesOpened: 3,
        actualEditorPixels: true,
        apiMutations: 0,
      };
    },
  );
}
