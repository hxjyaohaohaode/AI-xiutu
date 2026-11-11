/**
 * About experience gates for the existing isolated web-account-smoke harness.
 * This module never starts a browser, API, account or paid task. All assertions
 * use the rendered DOM, native input, decoded image metadata or canvas pixels.
 * Call once with the harness's newContext/check/capture/until/report helpers.
 */
import assert from 'node:assert/strict';

const desktop = { width: 1440, height: 960 };

const localeCases = [
  { locale: 'zh-CN', viewport: desktop },
  { locale: 'zh-TW', viewport: { width: 390, height: 844 } },
  { locale: 'en', viewport: { width: 320, height: 568 } },
  { locale: 'en', viewport: { width: 844, height: 390 } },
];

const tourImages = [
  '/about/color-landscape.webp',
  '/about/local-stilllife.webp',
  '/about/portrait-editorial.webp',
  '/about/layers-editorial.webp',
];

async function assertAgentWithinFrame(page, stage) {
  const geometry = await page.locator('.agent-visual').evaluate((frame, activeStage) => {
    const bounds = frame.getBoundingClientRect();
    const selectors = [
      '.agent-visual-canvas',
      '.agent-visual-top',
      '.agent-visual-footer',
      '.agent-photo-source',
      '.agent-prompt',
      ...(activeStage === 1 ? ['.agent-tools'] : []),
      ...(activeStage >= 2 ? ['.agent-candidate'] : []),
      ...(activeStage === 3 ? ['.agent-decision'] : []),
    ];
    return {
      frame: { left: bounds.left, right: bounds.right, width: bounds.width },
      scrollLeft: frame.scrollLeft,
      scrollWidth: frame.scrollWidth,
      clientWidth: frame.clientWidth,
      items: selectors.flatMap((selector) =>
        [...frame.querySelectorAll(selector)].map((element) => {
          const rect = element.getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right, width: rect.width };
        }),
      ),
    };
  }, stage);
  assert.ok(
    Math.abs(geometry.scrollLeft) <= 1 &&
      geometry.scrollWidth <= geometry.clientWidth + 1 &&
      geometry.items.every(
        (item) => item.left >= geometry.frame.left - 1 && item.right <= geometry.frame.right + 1,
      ),
    `Agent stage ${stage} must fit its card without focus-induced horizontal scrolling: ${JSON.stringify(geometry)}`,
  );
  return geometry;
}

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

/** Wait for the visible presentation, while keeping real motion enabled. */
export async function settleVisibleAbout(page, until) {
  let waiting = null;
  try {
    await until(async () => {
      waiting = await page.locator('.about-page').evaluate((root) => {
        const visible = (element) => {
          if (
            !(element instanceof Element) ||
            element.closest('[hidden],[inert],[aria-hidden="true"]')
          )
            return false;
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            box.width > 0 &&
            box.height > 0 &&
            box.bottom > 0 &&
            box.right > 0 &&
            box.top < innerHeight &&
            box.left < innerWidth &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const animations = root
          .getAnimations({ subtree: true })
          .filter((animation) => {
            const effect = animation.effect;
            return (
              effect &&
              visible(effect.target) &&
              Number.isFinite(effect.getComputedTiming().iterations) &&
              (animation.playState === 'running' || animation.pending)
            );
          })
          .map(
            (animation) =>
              animation.animationName || animation.transitionProperty || 'finite animation',
          );
        const images = [...root.querySelectorAll('.about-image')]
          .filter(visible)
          .filter((frame) => {
            const image = frame.querySelector('img');
            return (
              frame.dataset.imageState !== 'ready' ||
              !image?.complete ||
              !image.naturalWidth ||
              Number(getComputedStyle(image).opacity) !== 1
            );
          })
          .map((frame) => frame.querySelector('img')?.getAttribute('src') || 'missing image');
        const reveals = [...root.querySelectorAll('.about-scroll-reveal,[data-reveal-piece]')]
          .filter(visible)
          .filter((element) => {
            const owner = element.closest('.about-scroll-reveal') || element;
            // Only require pieces whose entry threshold has been reached;
            // offscreen/edge previews are allowed to wait for native scrolling.
            if (owner.getBoundingClientRect().top >= innerHeight * 0.9) return false;
            const style = getComputedStyle(element);
            return (
              Number(style.opacity) !== 1 || style.transform !== 'none' || style.filter !== 'none'
            );
          })
          .map((element) => element.textContent?.trim().slice(0, 50));
        return { animations, images, reveals };
      });
      return !waiting.animations.length && !waiting.images.length && !waiting.reveals.length;
    }, 'visible About images and finite presentation motion finish');
  } catch (error) {
    throw new Error(`${error.message}; visible presentation: ${JSON.stringify(waiting)}`);
  }
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

async function settleElementMotion(element, until, label) {
  await until(
    async () =>
      element.evaluate((target) =>
        target
          .getAnimations({ subtree: true })
          .every(
            (animation) =>
              !Number.isFinite(animation.effect?.getComputedTiming().iterations) ||
              (!animation.pending && animation.playState !== 'running'),
          ),
      ),
    `${label} finishes its own finite motion`,
  );
}

async function selectLocale(page, locale) {
  await page.locator('.about-header .language-select select').selectOption(locale);
  await page.waitForFunction((value) => document.documentElement.lang === value, locale);
  await page.locator(`.about-page[data-locale="${locale}"]`).waitFor();
}

async function assertActiveFeature(page, index, until) {
  const article = page.locator('.experience-feature').nth(index);
  await until(
    async () => (await article.getAttribute('aria-pressed')) === 'true',
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
  assert.equal(await page.locator('.experience-feature[aria-pressed="true"]').count(), 1);
  assert.equal(await page.locator('.experience-tour-image[aria-hidden="false"]').count(), 1);
}

async function settledDocumentScroll(page, until, label) {
  let previous = null;
  let stable = 0;
  return until(async () => {
    const y = await page.evaluate(() => scrollY);
    stable = y === previous ? stable + 1 : 0;
    previous = y;
    return stable >= 2 ? { y } : null;
  }, label);
}

// Read the real selected chapter; advance only with native wheel input. There
// is deliberately no click/focus shortcut that could conceal broken scrolling.
async function wheelThroughFeatureChapters(page, until) {
  const chapters = [];
  const tour = page.locator('.experience-tour');
  await page.mouse.move(12, Math.round(desktop.height * 0.65));
  for (let index = 0; index < tourImages.length; index += 1) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const active = Number(await tour.getAttribute('data-active'));
      if (active === index) break;
      assert.equal(active, index - 1, 'Native scrolling must visit the four chapters in order');
      const position = await page.evaluate(() => ({
        y: scrollY,
        viewport: innerHeight,
        maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      }));
      assert.ok(position.y < position.maximum - 1, 'The next chapter must be reachable');
      await page.mouse.wheel(0, Math.round(position.viewport * 0.2));
      await until(
        async () => (await page.evaluate(() => scrollY)) > position.y + 1,
        `native wheel advances toward chapter ${index + 1}`,
      );
      await settledDocumentScroll(page, until, `wheel settles before reading chapter ${index + 1}`);
    }
    assert.equal(
      Number(await tour.getAttribute('data-active')),
      index,
      `Wheel input must actually select chapter ${index + 1}`,
    );
    await assertActiveFeature(page, index, until);
    const item = page.locator('.experience-feature-item').nth(index);
    await until(
      async () =>
        item.locator('.feature-explanation').evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            style.visibility === 'visible' &&
            Number(style.opacity) === 1 &&
            element.clientHeight > 0
          );
        }),
      `chapter ${index + 1} expands its own explanation`,
    );
    const image = await decodedImage(
      page.locator('.experience-tour-image').nth(index).locator('img'),
      tourImages[index],
      [1536, 1024],
      until,
    );
    await until(
      async () =>
        page
          .locator('.experience-tour-image')
          .nth(index)
          .locator('.feature-art-note')
          .evaluateAll(
            (notes) =>
              notes.length === 3 &&
              notes.every((note) => {
                const style = getComputedStyle(note);
                return style.visibility === 'visible' && Number(style.opacity) === 1;
              }),
          ),
      `chapter ${index + 1} shows its own three image annotations`,
    );
    chapters.push({
      index,
      y: await page.evaluate(() => scrollY),
      image: image.pathname,
      title: await item.locator('.experience-feature > span').nth(1).innerText(),
    });
  }
  assert.ok(
    chapters.every((chapter, index) => index === 0 || chapter.y > chapters[index - 1].y),
    'Every subsequent chapter must be reached farther down the document',
  );
  return chapters;
}

async function assertStaticFeatureExhibition(page, until) {
  const pictures = page.locator('.feature-mobile-art');
  assert.equal(await pictures.count(), 4, 'All four chapters need their own static artwork');
  const images = [];
  for (let index = 0; index < tourImages.length; index += 1) {
    await wheelTo(
      page,
      `.experience-feature-item:nth-child(${index + 1}) .feature-mobile-art`,
      until,
    );
    const picture = pictures.nth(index);
    const frame = await picture.boundingBox();
    assert.ok(
      frame?.width > 200 && frame.height > 100,
      'Each narrow-screen artwork occupies real space',
    );
    images.push(await decodedImage(picture.locator('img'), tourImages[index], [1536, 1024], until));
  }
  const geometry = await page.locator('.experience-tour').evaluate((root) => {
    const sticky = root.querySelector('.experience-tour-sticky');
    const stage = root.querySelector('.feature-artwork-stage');
    const items = [...root.querySelectorAll('.experience-feature-item')];
    const bounds = items.map((item) => item.getBoundingClientRect());
    return {
      height: root.getBoundingClientRect().height,
      contentHeight: sticky.getBoundingClientRect().height,
      position: getComputedStyle(sticky).position,
      desktopStageDisplay: getComputedStyle(stage).display,
      gaps: bounds.slice(1).map((rect, index) => rect.top - bounds[index].bottom),
      chapters: items.map((item) => {
        const title = item.querySelector('.feature-mobile-title');
        const explanation = item.querySelector('.feature-explanation');
        const picture = item.querySelector('.feature-mobile-art');
        return {
          desktopButtonDisplay: getComputedStyle(item.querySelector('.experience-feature')).display,
          titleHeight: title.getBoundingClientRect().height,
          explanationVisible:
            getComputedStyle(explanation).visibility === 'visible' &&
            Number(getComputedStyle(explanation).opacity) === 1 &&
            explanation.clientHeight > 0,
          pictureDisplay: getComputedStyle(picture).display,
        };
      }),
    };
  });
  assert.equal(geometry.position, 'static', 'Narrow or short screens use normal document flow');
  assert.equal(
    geometry.desktopStageDisplay,
    'none',
    'The desktop stack must not duplicate the static exhibition',
  );
  assert.ok(
    Math.abs(geometry.height - geometry.contentHeight) <= 2,
    'The tour must not reserve an empty desktop sticky-scroll runway',
  );
  assert.ok(
    geometry.gaps.every((gap) => gap >= -1 && gap <= 100),
    'Static chapters flow consecutively without large empty scroll gaps',
  );
  assert.ok(
    geometry.chapters.every(
      (chapter) =>
        chapter.desktopButtonDisplay === 'none' &&
        chapter.titleHeight >= 40 &&
        chapter.explanationVisible &&
        chapter.pictureDisplay !== 'none',
    ),
    'Every static chapter exposes its title, explanation and artwork without a hidden selector',
  );
  assert.equal(new Set(images.map((image) => image.pathname)).size, 4);
  return { geometry, images: images.map((image) => image.pathname), nativeWheel: true };
}

async function comparisonState(page) {
  return page.locator('.elastic-compare').evaluate((root) => {
    const path = root.querySelector('.compare-edge > path').getAttribute('d') || '';
    const coordinates = (path.match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    const geometryValid = coordinates.length === 14 && coordinates.every(Number.isFinite);
    return {
      path,
      geometryValid,
      bendPixels: geometryValid
        ? Math.abs(coordinates[6] - coordinates[0]) * root.clientWidth
        : null,
      particleOpacity: Math.max(
        0,
        ...[...root.querySelectorAll('.compare-edge ellipse')].map(
          (particle) => Number(particle.getAttribute('opacity')) || 0,
        ),
      ),
      value: Number(root.querySelector('.study-compare').value),
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
}

async function dragElasticComparison(page, until) {
  await page.mouse.move(10, 10);
  const baseline = await until(async () => {
    const state = await comparisonState(page);
    return state.geometryValid && state.bendPixels < 0.05 && state.particleOpacity < 0.001
      ? state
      : null;
  }, 'the comparison edge rests straight with no moving particles');
  const bounds = await page.locator('.study-picture').boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  const samples = [];
  try {
    for (const fraction of [0.38, 0.56, 0.74]) {
      await page.mouse.move(bounds.x + bounds.width * fraction, bounds.y + bounds.height * 0.5, {
        steps: 8,
      });
      samples.push(
        await until(
          async () => {
            const state = await comparisonState(page);
            const inputMoved = Math.abs(state.value - fraction * 100) <= 5;
            const motionPainted = baseline.reduced
              ? state.bendPixels < 0.05 && state.particleOpacity < 0.001
              : state.bendPixels >= 0.25 && state.particleOpacity > 0.001;
            return state.geometryValid && inputMoved && motionPainted ? state : null;
          },
          `the native comparison drag paints at ${Math.round(fraction * 100)} percent`,
        ),
      );
    }
    assert.ok(
      samples.every((sample) => sample.geometryValid),
      'Every comparison frame has finite control points',
    );
    assert.ok(
      samples.at(-1).value > 60 && samples.at(-1).value < 85,
      'A real pointer drag moves the native comparison value through the image',
    );
    if (baseline.reduced) {
      assert.ok(
        samples.every((sample) => sample.bendPixels < 0.05 && sample.particleOpacity < 0.001),
        'Reduced motion retains direct dragging without bending or particles',
      );
    } else {
      assert.ok(
        samples.some((sample) => sample.bendPixels >= 0.25 && sample.particleOpacity > 0.001),
        'Pointer velocity must visibly bend the boundary and reveal actual particles',
      );
    }
  } finally {
    await page.mouse.up();
    await page.mouse.move(10, 10);
  }
  const settled = await until(async () => {
    const state = await comparisonState(page);
    return state.geometryValid && state.bendPixels < 0.05 && state.particleOpacity < 0.001
      ? state
      : null;
  }, 'the comparison boundary settles straight and its particles disappear');
  return { baseline, samples, settled };
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
    for (const element of root.querySelectorAll('h1,h2,h3,p,.feature-art-note,.study-range')) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden')
        continue;
      if (element.scrollWidth > element.clientWidth + 1)
        result.push({
          tag: element.tagName,
          className: element.className,
          text: element.textContent?.trim().slice(0, 80),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          parent: element.parentElement?.className,
        });
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

export async function runAboutExperienceChecks({
  newContext,
  check,
  capture: captureRaw,
  until,
  report,
}) {
  const evidence = {
    tour: null,
    motion: null,
    studies: [],
    responsive: [],
    faq: [],
    agent: null,
    agentTouch: null,
  };
  report.aboutExperience = evidence;
  const capture = async (page, name) => {
    await settleVisibleAbout(page, until);
    await captureRaw(page, name);
  };
  const withPublicPage = async (name, viewport, run, options = {}) => {
    const { context, page } = await newContext(viewport, 'about', options);
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
      await captureRaw(page, `about-r3-${name}-failure`).catch(() => {});
      throw error;
    } finally {
      page.off('request', observe);
      await context.close();
    }
  };
  await check(
    'About has unique editorial art and synchronized slow wheel, hover and keyboard chapters',
    async () =>
      withPublicPage('tour', desktop, async (page) => {
        const hero = await decodedImage(
          page.locator('.hero-artwork img'),
          '/about/hero-editorial.webp',
          [1536, 1024],
          until,
        );
        assert.equal(hero.loading, 'eager');
        assert.ok(
          (await page.locator('.about-header').boundingBox()).height <= 60,
          'Header should leave room for the work',
        );
        await capture(page, 'about-r3-hero-desktop');
        await wheelTo(page, '.experience-tour-sticky', until);
        const features = page.locator('.experience-feature');
        assert.equal(await features.count(), 4);
        const chapters = await wheelThroughFeatureChapters(page, until);
        await features.nth(1).hover();
        await assertActiveFeature(page, 1, until);
        await decodedImage(
          page.locator('.experience-tour-image').nth(1).locator('img'),
          '/about/local-stilllife.webp',
          [1536, 1024],
          until,
        );
        await features.nth(1).focus();
        await page.mouse.move(10, 250);
        await page.keyboard.press('Tab');
        assert.equal(await features.nth(2).evaluate((el) => document.activeElement === el), true);
        await assertActiveFeature(page, 2, until);
        await capture(page, 'about-r3-portrait-annotations');
        await features.nth(3).hover();
        await assertActiveFeature(page, 3, until);
        await page.locator('.feature-artwork-footer button').click();
        await decodedImage(
          page.locator('.feature-interface img'),
          '/about/layers-zh-CN.webp',
          [1440, 960],
          until,
        );
        await capture(page, 'about-r3-actual-interface-inline');
        await page.locator('.feature-interface-close').click();
        assert.equal(await page.locator('.feature-interface').count(), 0);
        const geometry = await page
          .locator('.experience-tour')
          .evaluate((el) => ({ height: el.offsetHeight, viewport: innerHeight }));
        assert.ok(
          geometry.height >= geometry.viewport * 3.8,
          'Each chapter needs a readable scroll interval',
        );
        const activeBefore = await page.locator('.experience-tour').getAttribute('data-active');
        await page.mouse.move(10, 600);
        await page.mouse.wheel(0, 24);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        assert.equal(
          await page.locator('.experience-tour').getAttribute('data-active'),
          activeBefore,
          'A tiny wheel movement must not erase a manual selection',
        );
        const positions = [];
        for (const selector of [
          '#agent-title',
          '#try-title',
          '#paths-title',
          '#team-title',
          '#device-title',
          '#faq-title',
          '.about-closing h2',
          '.about-footer',
        ])
          positions.push({ selector, y: await wheelTo(page, selector, until) });
        await noTextClipping(page);
        const distinct = await page
          .locator(
            '.hero-artwork img,.experience-tour-image img,.agent-photo-source img,.team-visual > .about-image img',
          )
          .evaluateAll((images) => images.map((img) => new URL(img.src).pathname));
        assert.equal(
          new Set(distinct).size,
          distinct.length,
          'Different chapters must not recycle the same photograph',
        );
        evidence.tour = {
          hero,
          positions,
          chapters,
          distinct,
          hover: true,
          keyboard: true,
          nativeWheel: true,
          apiMutations: 0,
        };
        return evidence.tour;
      }),
  );

  await check(
    'Agent, voice and team illustrations change content and spatial state without starting services',
    async () =>
      withPublicPage('creative-states', desktop, async (page) => {
        await page.locator('.agent-visual').scrollIntoViewIfNeeded();
        const steps = page.locator('.agent-steps button');
        await steps.nth(0).click();
        await page.mouse.move(10, 10);
        await settleElementMotion(page.locator('.agent-photo-source'), until, 'the full source');
        const before = await page.locator('.agent-photo-source').boundingBox();
        await steps.nth(1).click();
        await until(
          async () =>
            page.locator('.agent-tools').evaluate((el) => getComputedStyle(el).opacity === '1'),
          'Agent tool stage enters',
        );
        await page.mouse.move(10, 10);
        await settleElementMotion(
          page.locator('.agent-photo-source'),
          until,
          'the tool-stage source',
        );
        const tools = await page.locator('.agent-photo-source').boundingBox();
        assert.ok(
          tools.width < before.width * 0.85,
          'The source visibly moves and scales to make room for tools',
        );
        await steps.nth(2).click();
        await until(
          async () =>
            page
              .locator('.agent-candidates')
              .evaluate((el) => getComputedStyle(el).opacity === '1'),
          'Agent candidates enter',
        );
        await page.locator('.agent-candidate > button').nth(1).click();
        assert.equal(
          await page.locator('.agent-candidate > button').nth(1).getAttribute('aria-pressed'),
          'true',
        );
        await decodedImage(
          page.locator('.agent-candidate').nth(1).locator('img'),
          '/about/agent-candidate-1.webp',
          [768, 512],
          until,
        );
        await capture(page, 'about-r3-agent-candidates');
        assert.equal(
          await page.locator('.agent-visual').getAttribute('data-step'),
          '2',
          'Reading and selecting a candidate must not reset its story stage',
        );
        assert.equal(
          await page.locator('.agent-candidates').evaluate((el) => getComputedStyle(el).visibility),
          'visible',
        );
        await steps.nth(3).click();
        await until(
          async () =>
            page.locator('.agent-decision').evaluate((el) => getComputedStyle(el).opacity === '1'),
          'Decision stage enters',
        );
        await page.locator('.voice-pill button').click();
        assert.equal(await page.locator('.voice-pill button').getAttribute('aria-pressed'), 'true');
        await page.locator('.voice-pill button').press('Escape');
        assert.equal(
          await page.locator('.voice-pill button').getAttribute('aria-pressed'),
          'false',
        );
        await page.locator('.voice-modes button').nth(1).click();
        assert.ok((await page.locator('.voice-transcript').innerText()).includes('只提亮人物'));
        await page.locator('.voice-modes button').nth(2).click();
        assert.equal(
          await page.locator('.voice-pill button').getAttribute('aria-pressed'),
          'false',
        );
        await capture(page, 'about-r3-voice-states');
        await page.locator('.team-modes button').nth(0).click();
        assert.equal(await page.locator('.team-visual').getAttribute('data-team'), 'false');
        await page.locator('.team-modes button').nth(1).click();
        await page.locator('.team-presence button').nth(1).click();
        assert.equal(await page.locator('.team-visual').getAttribute('data-member'), '1');
        await page.locator('.team-versions button').nth(2).click();
        assert.equal(await page.locator('.team-visual').getAttribute('data-version'), '3');
        await capture(page, 'about-r3-team-regions');
        const device = [];
        for (let index = 0; index < 3; index++) {
          await page.locator('.device-modes button').nth(index).click();
          assert.equal(
            await page.locator('.device-composition').getAttribute('data-device'),
            String(index),
          );
          await page.mouse.move(10, 10);
          await settleElementMotion(
            page.locator('.device-composition'),
            until,
            `device mode ${index + 1}`,
          );
          device.push(await page.locator('.device-phone').boundingBox());
        }
        assert.ok(device.every((rect) => rect && rect.width > 0));
        assert.ok(
          device
            .slice(1)
            .every(
              (rect, index) =>
                Math.hypot(rect.x - device[index].x, rect.y - device[index].y) > 20 ||
                Math.abs(rect.width - device[index].width) > 10,
            ),
          'Each device mode reaches a visibly different final composition',
        );
        assert.equal(
          await page.locator('.device-phone figcaption').count(),
          0,
          'Device capture has no text pasted over it',
        );
        await capture(page, 'about-r3-device-phone');
        evidence.agent = {
          sourceBefore: before,
          sourceWithTools: tools,
          candidates: true,
          voiceStates: true,
          teamStates: true,
          device,
          apiMutations: 0,
        };
        return evidence.agent;
      }),
  );

  await check(
    'A tablet preserves tapped Agent steps and candidates, then resumes chapters after native touch scrolling',
    async () =>
      withPublicPage(
        'agent-touch',
        { width: 1024, height: 1366 },
        async (page) => {
          const visual = page.locator('.agent-visual');
          const steps = page.locator('.agent-steps button');
          await visual.scrollIntoViewIfNeeded();
          await settleVisibleAbout(page, until);
          const environment = await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
            maxTouchPoints: navigator.maxTouchPoints,
            scrollChapters: !matchMedia('(max-width: 760px), (max-height: 800px)').matches,
          }));
          assert.ok(environment.maxTouchPoints > 0 && environment.scrollChapters);
          const tapped = [];
          for (const stage of [1, 2]) {
            await steps.nth(stage).tap();
            await settleElementMotion(visual, until, `tapped Agent stage ${stage}`);
            await settledDocumentScroll(page, until, `focus scrolling after Agent tap ${stage}`);
            assert.equal(await visual.getAttribute('data-step'), String(stage));
            assert.equal(await steps.nth(stage).getAttribute('aria-pressed'), 'true');
            tapped.push(stage);
          }
          const candidate = page.locator('.agent-candidate > button').nth(1);
          await candidate.tap();
          await settleElementMotion(visual, until, 'the tapped Agent candidate');
          await settledDocumentScroll(
            page,
            until,
            'candidate tap retains its chapter after focus scrolling',
          );
          assert.equal(await candidate.getAttribute('aria-pressed'), 'true');
          assert.equal(await visual.getAttribute('data-step'), '2');
          assert.equal(await visual.getAttribute('data-candidate'), '1');
          await capture(page, 'about-r3-agent-touch-selection');
          assert.equal(await visual.getAttribute('data-step'), '2');

          const gesture = await visual.evaluate((card) => {
            const box = card.getBoundingClientRect();
            // The card's left inset is background, outside candidate controls.
            const start = {
              x: box.left + Math.min(16, box.width * 0.04),
              y: Math.min(innerHeight - 96, box.bottom - 96),
            };
            const end = { x: start.x, y: Math.max(96, start.y - 280) };
            const hit = document.elementFromPoint(start.x, start.y);
            return {
              start,
              end,
              scrollBefore: scrollY,
              insideCard: !!hit && card.contains(hit),
              interactiveTarget: !!hit?.closest(
                'button,a,input,select,textarea,[contenteditable="true"]',
              ),
            };
          });
          assert.ok(gesture.insideCard && !gesture.interactiveTarget);
          assert.ok(gesture.start.y - gesture.end.y >= 160);
          const cdp = await page.context().newCDPSession(page);
          const touch = (type, point) =>
            cdp.send('Input.dispatchTouchEvent', {
              type,
              touchPoints: point ? [{ ...point, id: 1 }] : [],
            });
          let touchActive = false;
          try {
            await touch('touchStart', gesture.start);
            touchActive = true;
            for (let index = 1; index <= 48; index += 1) {
              await touch('touchMove', {
                x: gesture.start.x,
                y: gesture.start.y + ((gesture.end.y - gesture.start.y) * index) / 48,
              });
              await new Promise((done) => setTimeout(done, 8));
            }
            await touch('touchEnd');
            touchActive = false;
          } finally {
            if (touchActive) await touch('touchCancel').catch(() => {});
            await cdp.detach();
          }
          await until(
            async () => (await page.evaluate(() => scrollY)) - gesture.scrollBefore >= 80,
            'the native single-finger drag actually scrolls the document at least 80px',
          );
          await settledDocumentScroll(page, until, 'the native touch scroll and inertia settle');
          const scroll = await page.locator('.agent-story').evaluate((story) => {
            const box = story.getBoundingClientRect();
            const position = Math.max(
              0,
              Math.min(3.999, ((80 - box.top) / Math.max(1, story.offsetHeight - innerHeight)) * 4),
            );
            return {
              y: scrollY,
              storyTop: box.top,
              storyHeight: story.offsetHeight,
              viewportHeight: innerHeight,
              chapterPosition: position,
              expectedStage: Math.floor(position),
            };
          });
          assert.notEqual(
            scroll.expectedStage,
            2,
            'the scroll position must differ from the manual chapter',
          );
          await until(
            async () => (await visual.getAttribute('data-step')) === String(scroll.expectedStage),
            'Agent returns to the chapter at the actual document scroll position',
          );
          assert.equal(await steps.nth(scroll.expectedStage).getAttribute('aria-pressed'), 'true');
          assert.equal(await visual.getAttribute('data-candidate'), '1');
          await capture(page, 'about-r3-agent-touch-scroll');
          evidence.agentTouch = {
            environment,
            tappedStages: tapped,
            candidate: 1,
            manualStageRetained: 2,
            nativeTouchEvents: 50,
            gesture,
            scrollDistance: scroll.y - gesture.scrollBefore,
            scroll,
            finalStage: Number(await visual.getAttribute('data-step')),
            candidatePreservedAfterScroll: true,
            apiMutations: 0,
          };
          return evidence.agentTouch;
        },
        { hasTouch: true },
      ),
  );

  await check(
    'Each preset updates all eight real parameters; comparison keeps precise pixels and keyboard control',
    async () =>
      withPublicPage('study', desktop, async (page) => {
        await page.locator('.color-study').scrollIntoViewIfNeeded();
        await page.locator('.study-compare').waitFor();
        const presets = [
          { index: 0, values: [0.12, 10, 4, -4, -16, 14, 12, 6] },
          { index: 1, values: [0.18, 4, 18, 12, -28, 18, 24, 16] },
          { index: 2, values: [0.22, 20, -16, -10, -30, 26, 6, -12] },
        ];
        for (const preset of presets) {
          await page.locator('.study-presets button').nth(preset.index).click();
          const values = await page
            .locator('.study-adjustments input')
            .evaluateAll((inputs) => inputs.map((input) => Number(input.value)));
          assert.deepEqual(
            values,
            preset.values,
            'The displayed controls are the exact preset recipe',
          );
          await page.locator('.study-picture[aria-busy="false"]').waitFor();
          assert.equal(
            await page.locator('canvas.study-result').getAttribute('data-rendered-preset'),
            ['natural', 'vivid', 'soft'][preset.index],
            'The completed pixels belong to the selected preset, not the preceding frame',
          );
          evidence.studies.push({
            index: preset.index,
            values,
            pixels: await canvasPixels(page.locator('canvas.study-result')),
          });
        }
        assert.equal(
          new Set(evidence.studies.map((x) => x.pixels.checksum)).size,
          3,
          'All looks produce distinct real pixels',
        );
        const oldValues = await page
          .locator('.study-adjustments input')
          .evaluateAll((inputs) => inputs.map((input) => Number(input.value)));
        await page.locator('.study-range-warmth input').press('ArrowRight');
        const newValues = await page
          .locator('.study-adjustments input')
          .evaluateAll((inputs) => inputs.map((input) => Number(input.value)));
        assert.equal(newValues[1], oldValues[1] + 1);
        assert.deepEqual(
          newValues.filter((_, i) => i !== 1),
          oldValues.filter((_, i) => i !== 1),
        );
        assert.equal(
          await page.locator('.study-adjustments').getAttribute('data-preset'),
          'custom',
        );
        await page.locator('.study-compare').press('Home');
        assert.equal(await page.locator('.study-compare').inputValue(), '0');
        await page.locator('.study-compare').press('End');
        assert.equal(await page.locator('.study-compare').inputValue(), '100');
        await page.locator('.study-compare').press('ArrowLeft');
        assert.equal(await page.locator('.study-compare').inputValue(), '99');
        const comparison = await dragElasticComparison(page, until);
        assert.equal(
          await page.locator('.study-result').evaluate((el) => getComputedStyle(el).filter),
          'none',
          'No blur is applied to editing pixels',
        );
        assert.equal(
          await page.locator('.study-picture').evaluate((el) => getComputedStyle(el).outlineStyle),
          'none',
          'The image never gets a dark focus frame',
        );
        await page.mouse.move(10, 10);
        await capture(page, 'about-r3-real-eight-parameter-study');
        await page.locator('.study-open').click();
        await page.waitForURL((url) => url.hash === '#/studio');
        await page.getByLabel('选择照片', { exact: true }).waitFor({ state: 'attached' });
        assert.equal(
          await page.locator('canvas[aria-label="照片编辑预览"]').count(),
          0,
          'Starting work leaves image choice to the user',
        );
        return {
          presets: evidence.studies,
          customPreservesValues: true,
          comparisonKeyboard: true,
          comparison,
          sharpPixels: true,
          ownWorkEntry: true,
          apiMutations: 0,
        };
      }),
  );

  await check(
    'About FAQ reserves its width and height, and all three languages fit narrow screens',
    async () => {
      for (const item of localeCases)
        await withPublicPage(`responsive-${item.locale}`, item.viewport, async (page) => {
          await selectLocale(page, item.locale);
          await decodedImage(
            page.locator('.hero-artwork img'),
            '/about/hero-editorial.webp',
            [1536, 1024],
            until,
          );
          await capture(page, `about-r3-${item.locale}-${item.viewport.width}-hero`);
          const staticTour =
            item.viewport.width <= 760 || item.viewport.height <= 800
              ? await assertStaticFeatureExhibition(page, until)
              : null;
          let agentStages = null;
          if (staticTour) {
            agentStages = [];
            for (let stage = 0; stage < 4; stage++) {
              await page.locator('.agent-steps button').nth(stage).click();
              await page.locator('.agent-visual').scrollIntoViewIfNeeded();
              await settleVisibleAbout(page, until);
              assert.equal(
                await page.locator('.agent-visual').getAttribute('data-step'),
                String(stage),
                'Every short-screen Agent stage stays selected while its artwork is read',
              );
              agentStages.push({
                stage,
                source: await page.locator('.agent-photo-source').boundingBox(),
                geometry: await assertAgentWithinFrame(page, stage),
              });
            }
            const decision = await page.locator('.agent-decision').boundingBox();
            const candidates = await page.locator('.agent-candidate').evaluateAll((cards) =>
              cards.map((card) => {
                const rect = card.getBoundingClientRect();
                const button = card.querySelector('button').getBoundingClientRect();
                return { bottom: rect.bottom, buttonHeight: button.height };
              }),
            );
            assert.ok(
              decision && candidates.every((card) => card.bottom + 8 <= decision.y),
              'The mobile confirmation has its own space below both candidate cards',
            );
            assert.ok(candidates.every((card) => card.buttonHeight >= 44));
            await page.locator('.agent-candidate > button').nth(1).click();
            assert.equal(
              await page.locator('.agent-candidate > button').nth(1).getAttribute('aria-pressed'),
              'true',
            );
            await capture(page, `about-r3-${item.locale}-${item.viewport.width}-agent-decision`);
            await assertAgentWithinFrame(page, 3);
          }
          await page.locator('.about-faq').scrollIntoViewIfNeeded();
          const geometry = () =>
            page.locator('.faq-layout').evaluate((el) => ({
              width: el.getBoundingClientRect().width,
              height: el.getBoundingClientRect().height,
              next: document.querySelector('.about-closing').getBoundingClientRect().top + scrollY,
            }));
          const baseline = await geometry();
          for (let index = 0; index < 5; index++) {
            await page.locator('.about-question button').nth(index).click();
            const next = await geometry();
            assert.ok(
              Math.abs(next.width - baseline.width) < 1 &&
                Math.abs(next.height - baseline.height) < 1 &&
                Math.abs(next.next - baseline.next) < 1,
              'FAQ changes only its answer, never the next section position',
            );
            assert.equal(await page.locator('.question-answer[aria-hidden="false"]').count(), 1);
          }
          await noTextClipping(page);
          await capture(page, `about-r3-${item.locale}-${item.viewport.width}-faq`);
          await page.locator('.color-study').scrollIntoViewIfNeeded();
          await page.locator('.study-compare').waitFor();
          await noTextClipping(page);
          await capture(page, `about-r3-${item.locale}-${item.viewport.width}-study`);
          const ranges = await page.locator('.study-adjustments input').evaluateAll((inputs) =>
            inputs.map((el) => {
              const r = el.getBoundingClientRect();
              return { width: r.width, height: r.height };
            }),
          );
          assert.equal(ranges.length, 8);
          assert.ok(
            ranges.every((r) => r.width >= 80 && r.height >= 32),
            'Each parameter has a reachable track',
          );
          evidence.faq.push({
            locale: item.locale,
            viewport: item.viewport,
            geometry: baseline,
            stable: true,
          });
          evidence.responsive.push({
            locale: item.locale,
            viewport: item.viewport,
            ranges,
            staticTour,
            agentStages,
          });
        });
      return { faq: evidence.faq, responsive: evidence.responsive, apiMutations: 0 };
    },
  );

  await check(
    'Pointer decoration respects idle, offscreen, reduced motion and readable reveals',
    async () =>
      withPublicPage('motion', desktop, async (page) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await settleVisibleAbout(page, until);
        const canvas = page.locator('.about-hero .about-pointer-ribbons canvas');
        await until(async () => (await canvasPixels(canvas))?.width > 1, 'Pointer canvas sizes');
        const baseline = await canvasPixels(canvas);
        await tracePointer(page);
        const drawn = await until(async () => {
          const v = await canvasPixels(canvas);
          return v && v.opaque > baseline.opaque && v.checksum !== baseline.checksum ? v : null;
        }, 'Pointer paints a real trace');
        await capture(page, 'about-r3-pointer-trace');
        await until(
          async () => (await canvasPixels(canvas))?.checksum === baseline.checksum,
          'Pointer becomes idle',
        );
        await tracePointer(page);
        const bounds = await page.locator('.about-hero').boundingBox();
        await page.mouse.move(10, desktop.height - 60);
        await page.mouse.wheel(0, Math.ceil(bounds.y + bounds.height + desktop.height / 2));
        await until(
          async () =>
            page.locator('.about-hero').evaluate((el) => el.getBoundingClientRect().bottom <= 0),
          'Hero leaves viewport',
        );
        await until(
          async () => (await canvasPixels(canvas))?.checksum === baseline.checksum,
          'Offscreen canvas clears',
        );
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.keyboard.press('Control+Home');
        await page.waitForFunction(() => scrollY === 0);
        await tracePointer(page);
        const reduced = await page.locator('.about-hero').evaluate((root) => ({
          canvasDisplay: getComputedStyle(root.querySelector('.about-pointer-ribbons canvas'))
            .display,
          restOpacity: Number(
            getComputedStyle(root.querySelector('.about-pointer-ribbons__rest')).opacity,
          ),
          unreadable: [
            ...document.querySelectorAll('.about-scroll-reveal,[data-reveal-piece]'),
          ].filter((el) => {
            const s = getComputedStyle(el);
            return Number(s.opacity) !== 1 || s.transform !== 'none' || s.filter !== 'none';
          }).length,
        }));
        assert.equal(reduced.canvasDisplay, 'none');
        assert.ok(reduced.restOpacity > 0);
        assert.equal(reduced.unreadable, 0);
        await capture(page, 'about-r3-reduced-motion');
        evidence.motion = { baseline, drawn, reduced, apiMutations: 0 };
        return evidence.motion;
      }),
  );
}
