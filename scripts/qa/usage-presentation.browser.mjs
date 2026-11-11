/**
 * Presentation checks for an already authenticated usage page. Call only after
 * the task receipt assertions and task-model-ledger.png have completed.
 * Uses the page's real refresh/locale controls and its actual GET /v1/usage;
 * creates no fixture, modifies no ledger and starts no paid operation.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const viewports = [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
  { width: 320, height: 780 },
];

async function settleChart(chart, until) {
  await until(
    () =>
      chart.evaluate(
        (root) =>
          !root
            .getAnimations({ subtree: true })
            .some(
              (animation) =>
                Number.isFinite(animation.effect?.getComputedTiming().iterations) &&
                (animation.playState === 'running' || animation.pending),
            ),
      ),
    'usage chart finishes its own finite presentation motion',
  );
}

async function closeDialog(dialog) {
  await dialog.locator(':scope > .modal-header button').click();
  await dialog.waitFor({ state: 'detached' });
}

async function languageControl(page) {
  const direct = page.locator('.language-select select:visible');
  if (await direct.count()) return { select: direct.first(), dialog: null };
  const trigger = page.locator('.workspace-settings-trigger:visible');
  if (!(await trigger.count())) return null;
  await trigger.first().click();
  const dialog = page.locator('.workspace-settings-dialog');
  await dialog.waitFor();
  const select = dialog.locator('.language-select select');
  if (!(await select.count())) {
    await closeDialog(dialog);
    return null;
  }
  return { select, dialog };
}

async function selectLanguage(page, locale) {
  const control = await languageControl(page);
  assert.ok(control, 'A previously available language control remains reachable');
  try {
    await control.select.selectOption(locale);
    await page.waitForFunction((expected) => document.documentElement.lang === expected, locale);
    assert.equal(await control.select.inputValue(), locale);
  } finally {
    if (control.dialog) await closeDialog(control.dialog);
  }
}

async function selectedPoint(chart) {
  return chart.evaluate((root) => {
    const slider = root.querySelector('.usage-trend-plot');
    const readout = root.querySelector('.usage-trend-readout > div:first-child');
    const value = readout.querySelector('strong');
    return {
      index: Number(slider.getAttribute('aria-valuenow')),
      minimum: Number(slider.getAttribute('aria-valuemin')),
      maximum: Number(slider.getAttribute('aria-valuemax')),
      accessibleText: slider.getAttribute('aria-valuetext'),
      date: readout.querySelector(':scope > span').textContent.trim(),
      value: [...value.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join('')
        .trim(),
      previousDisabled: root.querySelectorAll('.usage-trend-navigation button')[0].disabled,
      nextDisabled: root.querySelectorAll('.usage-trend-navigation button')[1].disabled,
    };
  });
}

async function inspectKeyboard(page, chart, series, locale, until) {
  const slider = chart.getByRole('slider');
  await slider.scrollIntoViewIfNeeded();
  // A stationary pointer on the plot must not overwrite a keyboard selection
  // when scrolling or resizing causes a native pointer event.
  await page.mouse.move(2, 2);
  const last = series.length - 1;
  const steps = [
    ['Home', 0],
    ['ArrowRight', Math.min(1, last)],
    ['ArrowDown', 0],
    ['End', last],
    ['ArrowLeft', Math.max(0, last - 1)],
    ['ArrowUp', last],
  ];
  const samples = [];
  for (const [key, index] of steps) {
    await slider.press(key);
    const row = series[index];
    const expectedValue =
      typeof row.consumed === 'number' && Number.isFinite(row.consumed)
        ? new Intl.NumberFormat(locale).format(row.consumed)
        : locale === 'en'
          ? 'Unknown'
          : '未知';
    const actual = await until(async () => {
      const point = await selectedPoint(chart);
      return point.index === index + 1 && point.date === row.bucket && point.value === expectedValue
        ? point
        : null;
    }, `${locale} ${key} selects the actual API bucket and recorded value`);
    assert.equal(actual.minimum, 1);
    assert.equal(actual.maximum, series.length, 'Slider exposes only real API buckets');
    assert.ok(actual.accessibleText.includes(row.bucket));
    assert.ok(actual.accessibleText.includes(expectedValue));
    assert.equal(actual.previousDisabled, index === 0);
    assert.equal(actual.nextDisabled, index === last);
    samples.push({ key, ...actual });
  }
  if (series.length > 1) {
    assert.notEqual(samples[0].date, samples[3].date, 'Home and End select different real dates');
    assert.notEqual(samples[0].index, samples[1].index, 'ArrowRight advances a real bucket');
  }
  return { samples, crossBucketChangeObserved: series.length > 1 };
}

async function chartLayout(chart) {
  const result = await chart.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    const plot = root.querySelector('.usage-trend-plot').getBoundingClientRect();
    const text = [
      ...root.querySelectorAll(
        'h2,p,.usage-trend-readout > div:first-child > span,.usage-trend-readout strong,' +
          '.usage-trend-navigation > span,.usage-trend-dates > span,.usage-trend-axis > span',
      ),
    ].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none')
        return [];
      return element.scrollWidth > element.clientWidth + 1 ||
        rect.left < bounds.left - 1 ||
        rect.right > bounds.right + 1
        ? [
            {
              className: element.className,
              text: element.textContent.trim().slice(0, 100),
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              left: rect.left,
              right: rect.right,
            },
          ]
        : [];
    });
    return {
      card: { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height },
      plot: { width: plot.width, height: plot.height },
      viewportWidth: innerWidth,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      text,
      navigation: [...root.querySelectorAll('.usage-trend-navigation button')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
      }),
    };
  });
  assert.deepEqual(result.text, [], 'Trend titles, dates, values and instructions fit their card');
  assert.ok(
    result.card.left >= -1 && result.card.right <= result.viewportWidth + 1,
    'The trend card remains inside the actual viewport',
  );
  assert.ok(result.documentOverflow <= 1, 'The page does not require horizontal scrolling');
  assert.ok(
    result.plot.width >= 120 && result.plot.height >= 150,
    'The narrow chart retains a useful interactive plot area',
  );
  assert.equal(result.navigation.length, 2);
  assert.ok(
    result.navigation.every(
      (button) =>
        button.width >= 44 &&
        button.height >= 44 &&
        button.left >= result.card.left - 1 &&
        button.right <= result.card.right + 1,
    ),
    'Both previous/next buttons retain 44px targets inside the chart',
  );
  return result;
}

export async function runUsagePresentationChecks({ page, until, artifacts }) {
  const originalViewport = page.viewportSize();
  const originalLocale = await page.locator('html').getAttribute('lang');
  const evidence = {
    source: 'existing authenticated page; actual GET /v1/usage',
    kind: 'consumed',
    locales: [],
    captures: [],
    mutations: [],
    limitations: [],
  };
  const observe = (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/v1/'))
      evidence.mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  };
  page.on('request', observe);
  let failed = false;
  try {
    const job = page.locator('.usage-job-modal');
    if (await job.count()) await closeDialog(job);
    await page.setViewportSize(viewports[0]);
    const dashboard = page.locator('.usage-dashboard');
    await dashboard.waitFor();
    assert.equal(
      await dashboard.locator('.usage-totals button').nth(2).getAttribute('aria-pressed'),
      'true',
      'The existing page is displaying consumed points',
    );
    const received = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'GET' &&
        url.pathname === '/v1/usage' &&
        !url.searchParams.has('cursor') &&
        url.searchParams.get('format') === 'json'
      );
    });
    await dashboard.locator('.usage-actions > .text-button').click();
    const response = await received;
    assert.equal(response.status(), 200);
    const report = await response.json();
    assert.equal(report.unit, 'credit');
    assert.equal(report.timezone, 'Asia/Shanghai');
    assert.ok(
      Array.isArray(report.series) && report.series.length > 0,
      'This recorded-usage acceptance requires at least one actual API bucket',
    );
    const series = [...report.series].sort((a, b) => a.bucket.localeCompare(b.bucket));
    assert.equal(new Set(series.map((row) => row.bucket)).size, series.length);
    evidence.series = series.map(({ bucket, consumed }) => ({ bucket, consumed }));
    evidence.scope = report.scope;
    evidence.range = report.range;
    if (series.length === 1)
      evidence.limitations.push(
        'The real response contains one bucket. Home/End/arrows verify correct boundary behavior; ' +
          'cross-date movement cannot be claimed and no historical amounts are invented.',
      );
    const chart = dashboard.locator('.usage-chart');
    await chart.getByRole('slider').waitFor();
    const control = await languageControl(page);
    let locales = [originalLocale];
    if (control) {
      const options = await control.select
        .locator('option')
        .evaluateAll((rows) => rows.map((row) => row.value));
      locales = ['zh-CN', 'zh-TW', 'en'].filter((locale) => options.includes(locale));
      if (control.dialog) await closeDialog(control.dialog);
      evidence.localeEntry = 'visible LanguageSelect, via existing workspace settings when needed';
    } else {
      evidence.localeEntry = 'no visible language selector or workspace settings entry';
      evidence.limitations.push(
        'Only the existing document locale was checked; no language entry was fabricated.',
      );
    }
    for (const locale of locales) {
      await page.setViewportSize(viewports[0]);
      if ((await page.locator('html').getAttribute('lang')) !== locale)
        await selectLanguage(page, locale);
      evidence.locales.push(locale);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await chart.scrollIntoViewIfNeeded();
        await settleChart(chart, until);
        const keyboard = await inspectKeyboard(page, chart, series, locale, until);
        const layout = await chartLayout(chart);
        await page.mouse.move(2, 2);
        await settleChart(chart, until);
        const file = `usage-presentation-${locale}-${viewport.width}.png`;
        const target = viewport.width === 1440 ? dashboard.locator('.usage-insights') : chart;
        await target.screenshot({ path: resolve(artifacts, file) });
        evidence.captures.push({
          file,
          locale,
          viewport,
          layout,
          keyboard,
          scope: viewport.width === 1440 ? 'trend and allocation overview' : 'complete trend card',
        });
      }
    }
    assert.deepEqual(
      evidence.mutations,
      [],
      'Presentation checks never mutate the API or start paid work',
    );
    return evidence;
  } catch (error) {
    failed = true;
    await page
      .screenshot({ path: resolve(artifacts, 'usage-presentation-failure.png') })
      .catch(() => {});
    throw error;
  } finally {
    try {
      await page.setViewportSize(viewports[0]);
      if ((await page.locator('html').getAttribute('lang')) !== originalLocale)
        await selectLanguage(page, originalLocale);
      if (originalViewport) await page.setViewportSize(originalViewport);
    } catch (error) {
      if (!failed) throw error;
    } finally {
      page.off('request', observe);
    }
  }
}
