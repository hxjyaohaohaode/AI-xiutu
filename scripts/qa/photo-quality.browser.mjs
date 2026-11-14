/** Real public photographs, actual inference and independent known degradations. No paid calls. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import matting from '../../third-party/portrait-matting.json' with { type: 'json' };
import fineMatting from '../../third-party/portrait-fine-matting.json' with { type: 'json' };
import {
  createRecipeV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  compileEditorCoordinateMap,
  renderCutout,
  compileSelectionMaskV3,
  renderPhotoRestoration,
  motionKernel,
  srgbToLinear,
  linearToSrgb,
} from '@ai-xiutu/editor';
import {
  validatePortraitAnalysis,
  applyPortraitValues,
  portraitToolAvailability,
  OBSERVED_PORTRAIT_ANALYSIS,
} from '@ai-xiutu/portrait';

if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production')
  throw new Error('Isolated QA only');
const output = resolve(process.env.PHOTO_QUALITY_ARTIFACT_DIR ?? 'artifacts/photo-quality');
const verifyFineMatting = process.env.PHOTO_QUALITY_FINE_MATTING === '1';
await mkdir(output, { recursive: true });
const sources = [
  ...JSON.parse(await readFile('scripts/qa/portrait-native-inputs.json', 'utf8')).inputs,
  ...JSON.parse(await readFile('scripts/qa/restoration-inputs.json', 'utf8')).inputs,
];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const models = JSON.parse(await readFile('apps/web/public/vision/manifest.json', 'utf8'));
for (const model of models.assets)
  assert.equal(sha(await readFile(join('apps/web/public/vision', model.file))), model.sha256);
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  models,
  source:
    'Pinned public photographs; actual local MediaPipe inference; deterministic degradation ground truth',
  paidCalls: 0,
  manualVisualReview: false,
  photos: [],
  cases: [],
};
const png = (i) =>
  sharp(i.data, { raw: { width: i.width, height: i.height, channels: 4 } })
    .png()
    .toBuffer();
async function sheet(name, tiles) {
  const width = 340,
    height = 310,
    columns = 3,
    composites = [];
  for (let i = 0; i < tiles.length; i++) {
    const left = (i % columns) * width,
      top = Math.floor(i / columns) * height;
    const image = await sharp(await png(tiles[i].image))
      .resize(width, height - 28, { fit: 'contain', background: '#dedede' })
      .png()
      .toBuffer();
    composites.push({ input: image, left, top: top + 28 });
    composites.push({
      input: Buffer.from(
        `<svg width="340" height="28"><rect width="340" height="28" fill="white"/><text x="6" y="19" font-size="14">${tiles[i].label.replace(/[<>&]/g, '')}</text></svg>`,
      ),
      left,
      top,
    });
  }
  await sharp({
    create: {
      width: width * columns,
      height: height * Math.ceil(tiles.length / columns),
      channels: 4,
      background: '#fff',
    },
  })
    .composite(composites)
    .png()
    .toFile(join(output, `${name}.png`));
}
const mse = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) if (i % 4 !== 3) sum += (a.data[i] - b.data[i]) ** 2;
  return sum / (a.width * a.height * 3);
};
function checkPortraitSupport(image, edited, recipe) {
  const mask = [...recipe.regionEdits, ...recipe.retouch]
    .filter((op) => op.enabled && op.opacity > 0)
    .map((op) => ({
      selected: compileSelectionMaskV3(op.mask, image, image),
      protect: op.protection ? compileSelectionMaskV3(op.protection, image, image) : null,
    }));
  let changed = 0;
  for (let at = 0; at < image.data.length; at += 4) {
    assert.equal(edited.data[at + 3], image.data[at + 3], 'portrait alpha');
    if (
      edited.data[at] === image.data[at] &&
      edited.data[at + 1] === image.data[at + 1] &&
      edited.data[at + 2] === image.data[at + 2]
    )
      continue;
    const pixel = at / 4,
      x = ((pixel % image.width) + 0.5) / image.width,
      y = (Math.floor(pixel / image.width) + 0.5) / image.height;
    assert.ok(
      mask.some(({ selected, protect }) => selected(x, y) > 0 && (protect?.(x, y) ?? 0) < 1),
      `changed outside portrait mask: ${pixel}`,
    );
    changed++;
  }
  return changed;
}
async function getBytes(source) {
  const path = join('artifacts/browser-v4-source-cache', `${source.sha256}.jpg`);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
    assert.ok(response.ok, `${source.name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, source.bytes);
    assert.equal(sha(bytes), source.sha256);
    await mkdir('artifacts/browser-v4-source-cache', { recursive: true });
    await writeFile(path, bytes);
  }
  assert.equal(sha(bytes), source.sha256);
  return bytes;
}

async function checkLocalCutout(browser, origin, image, view) {
  const page = await browser.newPage({
    viewport: { width: view.width, height: view.height },
    hasTouch: view.touch ?? false,
    reducedMotion: 'reduce',
    acceptDownloads: true,
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(message, ...args) {
          if (message.type === 'export' && message.cutout)
            window.observedCutout = structuredClone(message.cutout);
          super.postMessage(message, ...args);
        }
      };
    });
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
      if (url.origin !== origin) return route.abort();
      if (view.missingModel && url.pathname === '/vision/' + matting.file)
        return route.fulfill({ status: 404 });
      if (view.missingFineModel && url.pathname === '/vision/' + fineMatting.file)
        return route.fulfill({ status: 404 });
      if (url.pathname.startsWith('/v1/'))
        return route.fulfill({ status: 503, json: { message: 'offline' } });
      return route.continue();
    });
    await page.goto(`${origin}/#/studio`);
    const sourcePng = await png(image);
    await page.getByLabel('选择照片', { exact: true }).setInputFiles({
      name: 'public-portrait.png',
      mimeType: 'image/png',
      buffer: sourcePng,
    });
    const beauty = page
      .getByRole('navigation', { name: '编辑工具', exact: true })
      .getByRole('button', { name: '美颜', exact: true });
    await page.locator('.canvas-stage[aria-busy="false"] .image-frame canvas').first().waitFor();
    if ((await beauty.getAttribute('aria-pressed')) !== 'true') await beauty.click();
    const person = page.locator('.free-panel[aria-hidden="false"] .portrait-person-select');
    try {
      await person.waitFor({ state: 'attached', timeout: 60000 });
    } catch (error) {
      throw new Error(
        'Portrait controls are unavailable in the ' +
          view.id +
          ' cutout layout: ' +
          pageErrors.join(' | '),
        { cause: error },
      );
    }
    await page
      .locator('summary')
      .filter({ hasText: /^选区与抠图$/ })
      .click();
    const button = page.getByRole('button', { name: '从原图提取人物素材', exact: true });
    await button.waitFor({ timeout: 60000 });
    if (view.fine) {
      await page.locator('summary').filter({ hasText: '精准抠图' }).click();
      const mode = page.getByRole('combobox', { name: '抠图模式', exact: true });
      await mode.click();
      await page.getByRole('option', { name: '发丝与边缘', exact: true }).click();
      if (view.missingFineModel) {
        let downloads = 0;
        page.on('download', () => downloads++);
        await button.click();
        await page
          .getByText('发丝与边缘抠图暂不可用，可以切回标准抠图。', { exact: true })
          .first()
          .waitFor();
        assert.equal(downloads, 0);
        await mode.click();
        await page.getByRole('option', { name: '标准抠图', exact: true }).click();
      }
    }
    const downloading = page.waitForEvent('download', { timeout: 70000 });
    await button.click();
    const download = await downloading;
    assert.equal(await download.failure(), null);
    const bytes = await readFile(await download.path());
    const settings = await page.evaluate(() => window.observedCutout);
    assert.equal(settings.algorithm, view.missingModel ? 'guided-v5' : 'continuous-alpha-v1');
    if (view.fine && !view.missingFineModel)
      assert.deepEqual([settings.selection.width, settings.selection.height], [768, 768]);
    const expected = renderCutout(image, settings);
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
    assert.deepEqual(decoded, Buffer.from(expected.data));
    const partialAlpha = expected.data.filter(
      (value, index) => index % 4 === 3 && value > 0 && value < 255,
    ).length;
    assert.ok(partialAlpha > 0);
    assert.deepEqual(pageErrors, []);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, `Horizontal overflow: ${overflow}px`);
    const cloud =
      view.id === 'desktop' || view.id === 'fine-desktop'
        ? await checkCloudCutout(sourcePng, settings, decoded)
        : undefined;
    await writeFile(join(output, `workspace-cutout-${view.id}.png`), bytes);
    await page.screenshot({ path: join(output, `workspace-cutout-${view.id}-view.png`) });
    return {
      view,
      overflow,
      algorithm: settings.algorithm,
      exactRgbaBytes: decoded.length,
      partialAlpha,
      sha256: sha(bytes),
      cloud,
    };
  } finally {
    await page.close();
  }
}

async function checkCloudCutout(sourcePng, settings, browserPixels) {
  const database = process.env.TEST_DATABASE_URL;
  if (!database) return { state: 'not-run', reason: 'No isolated PostgreSQL fixture configured' };
  if (!decodeURIComponent(new URL(database).pathname).includes('test'))
    throw new Error('Cutout fixture requires a disposable test database');
  const { collaborationFixture } = await import('../../apps/api/test/collaboration-fixture.ts');
  const fixture = await collaborationFixture(database);
  try {
    const boundary = randomUUID();
    const upload = await fixture.app.inject({
      method: 'POST',
      url: `/v1/projects/${fixture.projectId}/assets`,
      headers: {
        origin: fixture.origin,
        cookie: fixture.actors.owner.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="portrait.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        sourcePng,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    assert.equal(upload.statusCode, 201, upload.body);
    const path = `/v1/projects/${fixture.projectId}/derived-assets`;
    const request = {
      kind: 'cutout',
      sourceAssetId: upload.json().asset.id,
      requestId: randomUUID(),
      name: 'guided.png',
      settings,
    };
    assert.equal((await fixture.call('POST', path, request, 'viewer')).statusCode, 403);
    const quote = await fixture.call('POST', `${path}/quote`, request);
    assert.equal(quote.statusCode, 200, quote.body);
    assert.equal(quote.json().available, true);
    const derived = await fixture.call('POST', path, request);
    assert.equal(derived.statusCode, 201, derived.body);
    const asset = derived.json().asset;
    const download = await fixture.call('GET', asset.url);
    assert.equal(download.statusCode, 200, download.body);
    const decoded = await sharp(download.rawPayload).ensureAlpha().raw().toBuffer();
    assert.deepEqual(decoded, browserPixels);
    const lineage = (await fixture.call('GET', `/v1/assets/${asset.id}/derivation`)).json();
    assert.equal(lineage.algorithm, 'continuous-alpha-v1');
    assert.equal(lineage.sources[0].assetId, request.sourceAssetId);
    assert.equal((await fixture.call('POST', path, request)).json().asset.id, asset.id);
    return {
      state: 'passed',
      exactRgbaBytes: decoded.length,
      rgbaSha256: sha(decoded),
      replayed: true,
    };
  } finally {
    await fixture.close();
  }
}

let vite, browser;
try {
  vite = await createServer({
    configFile: resolve('apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 4186, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || undefined,
    args: verifyFineMatting ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return u.origin === 'http://127.0.0.1:4186' || ['data:', 'blob:'].includes(u.protocol)
      ? route.continue()
      : route.abort();
  });
  await page.goto('http://127.0.0.1:4186/#/studio');
  for (const source of sources) {
    const decoded = await sharp(await getBytes(source))
      .autoOrient()
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const image = {
      width: decoded.info.width,
      height: decoded.info.height,
      data: new Uint8ClampedArray(decoded.data),
    };
    if (source.name === 'portrait-hopper') {
      const standard = [
        { id: 'desktop', width: 1440, height: 960 },
        { id: 'tablet', width: 1024, height: 768, touch: true },
        { id: 'phone', width: 320, height: 640, touch: true },
        { id: 'landscape', width: 844, height: 390, touch: true },
        { id: 'missing-model', width: 960, height: 720, missingModel: true },
      ];
      const fine = verifyFineMatting
        ? [
            ...standard.slice(0, 4).map((view) => ({ ...view, id: 'fine-' + view.id, fine: true })),
            {
              id: 'missing-fine-model',
              width: 960,
              height: 720,
              fine: true,
              missingFineModel: true,
            },
          ]
        : [];
      for (const view of [...standard, ...fine]) {
        const receipt = await checkLocalCutout(browser, 'http://127.0.0.1:4186', image, view);
        report.cases.push({
          photo: source.name,
          tool: 'workspace-cutout',
          state: 'passed',
          ...receipt,
        });
      }
    }
    const frame = {
      width: image.width,
      height: image.height,
      coordinates: 'source-normalized',
      orientation: 'normalized',
      contentHash: sha(
        Buffer.concat([Buffer.from(`${image.width}x${image.height}:srgb-rgba8:`), decoded.data]),
      ),
    };
    const started = performance.now();
    const result = await page.evaluate(
      async (input) => {
        const { default: Worker } = await import('/src/editor/portrait.worker.ts?worker');
        const worker = new Worker();
        try {
          return await new Promise((done, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Actual model inference timed out')),
              60000,
            );
            worker.onerror = (event) => {
              clearTimeout(timer);
              reject(new Error(event.message));
            };
            worker.onmessage = (event) => {
              if (event.data.error) {
                clearTimeout(timer);
                reject(new Error(event.data.error));
              }
              if (event.data.result) {
                clearTimeout(timer);
                done(event.data.result);
              }
            };
            worker.postMessage({
              id: 1,
              width: input.width,
              height: input.height,
              contentHash: input.contentHash,
              body: true,
              segmentation: true,
              image: {
                width: input.width,
                height: input.height,
                data: Uint8ClampedArray.from(atob(input.bytes), (c) => c.charCodeAt(0)),
              },
            });
          });
        } finally {
          worker.terminate();
        }
      },
      { ...frame, bytes: decoded.data.toString('base64') },
    );
    const analysis = validatePortraitAnalysis(result, frame);
    assert.equal(analysis.algorithmVersion, OBSERVED_PORTRAIT_ANALYSIS);
    if (source.name === 'basketball')
      assert.ok(
        analysis.targets.some(({ kind }) => kind === 'face'),
        'preserve the distant face',
      );
    if (source.name === 'portrait-hopper')
      assert.ok(
        analysis.targets.some((target) => target.featureMasks?.skin?.sampling === 'bilinear-v1'),
      );
    report.photos.push({
      analysisMs: performance.now() - started,
      ...source,
      frame,
      targets: analysis.targets.map((t) => ({
        id: t.id,
        kind: t.kind,
        features: Object.keys(t.featureMasks ?? {}),
      })),
      warnings: analysis.warnings,
    });
    const beautyTiles = [{ label: 'Original', image }];
    const shapeTiles = [{ label: 'Original', image }];
    for (const target of analysis.targets.filter((t) => t.kind === 'face')) {
      const available = new Map(
        portraitToolAvailability(analysis, target.id, 4).map((t) => [t.id, t]),
      );
      if (
        target.featureMasks?.accessories &&
        available.get('eyeSize')?.available &&
        available.get('eyeSpacing')?.available
      ) {
        const recipe = applyPortraitValues(createRecipeV4(), analysis, target.id, {
          eyeSize: 90,
          eyeSpacing: -30,
        });
        const protectedImage = renderEditorRecipe(image, recipe);
        const unguarded = renderEditorRecipe(image, {
          ...recipe,
          warp: {
            ...recipe.warp,
            guards: [],
            strokes: recipe.warp.strokes.map(({ guardId, ...stroke }) => stroke),
          },
        });
        const weight = compileSelectionMaskV3(target.featureMasks.accessories, image, image);
        let locked = 0,
          otherwiseChanged = 0;
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++) {
            if (weight((x + 0.5) / image.width, (y + 0.5) / image.height) < 1) continue;
            const i = (y * image.width + x) * 4;
            locked++;
            for (let c = 0; c < 4; c++) assert.equal(protectedImage.data[i + c], image.data[i + c]);
            if ([0, 1, 2, 3].some((c) => unguarded.data[i + c] !== image.data[i + c]))
              otherwiseChanged++;
          }
        report.cases.push({
          photo: source.name,
          tool: 'eye-accessory-protection',
          locked,
          otherwiseChanged,
          state: 'passed',
        });
        if (source.name === 'portrait-hopper') {
          assert.ok(locked > 10 && otherwiseChanged > 10);
          await sheet('portrait-hopper-eye-frame', [
            { label: 'Original', image },
            { label: 'Without guard', image: unguarded },
            { label: 'With guard', image: protectedImage },
          ]);
        }
      }
      if (available.get('faceSlim')?.available && target.featureMasks?.skin) {
        assert.equal(target.landmarks.length, 478);
        const slim = applyPortraitValues(createRecipeV4(), analysis, target.id, { faceSlim: 55 });
        assert.equal(slim.warp.strokes.length, 1);
        const field = slim.warp.strokes[0];
        assert.equal(field.algorithm, 'face-field-v2');
        assert.ok(field.contour.rows.length >= 12);
        assert.ok(
          field.contour.rows.some(({ leftShift, rightShift }) => leftShift > 0 || rightShift > 0),
          'the width profile responds to the single face slimming control',
        );
        const shaped = renderEditorRecipe(image, slim);
        assert.deepEqual(renderEditorRecipeTiled(image, slim, { tileSize: 61 }), shaped);
        assert.notDeepEqual(
          shaped.data,
          image.data,
          'a nonzero shape produces actual changed pixels',
        );
        report.cases.push({
          photo: source.name,
          target: target.id,
          tool: 'faceSlim',
          state: 'passed',
          contourRows: field.contour.rows.length,
          mseChange: mse(image, shaped),
        });
        if (
          target === analysis.targets.find((item) => item.kind === 'face') &&
          ['mediapipe-portrait', 'astronaut'].includes(source.name)
        ) {
          const distance = (a, b) =>
            Math.hypot((a.x - b.x) * image.width, (a.y - b.y) * image.height);
          const landmarks = target.landmarks;
          const forward = (params) => {
            const enabled = Object.fromEntries(
              Object.entries(params).filter(([id]) => available.get(id)?.available),
            );
            const recipe = applyPortraitValues(createRecipeV4(), analysis, target.id, enabled);
            return compileEditorCoordinateMap(image, recipe, image).toContentOutput;
          };
          const ratio = (map, a, b) =>
            distance(map(landmarks[a]), map(landmarks[b])) / distance(landmarks[a], landmarks[b]);
          const contour = { faceSlim: 70, vFace: 70 };
          const combined = forward({ ...contour, eyeSize: 65, lipSize: 45, smooth: 50 });
          const singleSlim = forward({ faceSlim: 70 });
          const singleV = forward({ vFace: 70 });
          const singleEye = forward({ eyeSize: 65 });
          const strong = forward({
            faceSlim: 100,
            faceNarrow: 100,
            vFace: 100,
            jaw: 100,
            faceSmall: 100,
            chin: 100,
            eyeSize: 100,
            eyeWidth: 100,
            eyeHeight: 100,
            lowerLid: 100,
            irisScale: 100,
            lipSize: 100,
            lipWidth: 100,
            upperLip: 100,
            lowerLip: 100,
            smile: 100,
            smooth: 100,
          });
          const cheek = ratio(combined, 234, 454);
          const jaw = ratio(combined, 150, 379);
          const aperture = ratio(combined, 159, 145);
          const strongJaw = ratio(strong, 150, 379);
          const mouthOpening = ratio(strong, 13, 14);
          const strongSmileToJaw = ratio(strong, 61, 291) / strongJaw;
          assert.ok(ratio(singleSlim, 234, 454) < 0.991, 'single cheek narrowing stays visible');
          assert.ok(ratio(singleV, 150, 379) < 0.989, 'single lower-jaw narrowing stays visible');
          assert.ok(ratio(singleEye, 159, 145) > 1.015, 'a clear eye opening still responds');
          assert.ok(cheek > 0.955 && cheek < 0.992 && jaw > 0.947 && jaw < 0.993);
          assert.ok(aperture > 1.015 && aperture < 1.105);
          assert.ok(strongJaw > 0.9 && strongJaw < 0.995);
          assert.ok(
            Math.abs(mouthOpening - 1) < 0.035,
            'lip thickness and smile retain the original mouth opening',
          );
          assert.ok(
            strongSmileToJaw < 1.17,
            'simultaneous edits preserve smile scale relative to the jaw',
          );
          assert.ok(
            distance(strong(landmarks[152]), landmarks[152]) <
              0.026 * distance(landmarks[234], landmarks[454]),
            'small face and chin together keep the chin within the shape budget',
          );
          report.cases.push({
            photo: source.name,
            target: target.id,
            tool: 'combined-feature-stability',
            state: 'passed',
            cheek,
            jaw,
            aperture,
            strongJaw,
            mouthOpening,
            strongSmileToJaw,
          });
        }
        if (shapeTiles.length === 1) {
          const values = { faceSlim: 65, smooth: 65, skinLight: 28 };
          for (const id of [
            'vFace',
            'faceNarrow',
            'jaw',
            'noseWidth',
            'eyeSize',
            'eyeWidth',
            'lowerLip',
          ])
            if (available.get(id)?.available) values[id] = 55;
          const baseline = applyPortraitValues(
            createRecipeV4(),
            {
              ...analysis,
              algorithmVersion: 'mediapipe-v1-selfie256',
            },
            target.id,
            values,
          );
          const refined = applyPortraitValues(createRecipeV4(), analysis, target.id, values);
          const upgraded = applyPortraitValues(baseline, analysis, target.id, values, undefined, {
            upgradeFace: true,
          });
          assert.deepEqual(
            renderEditorRecipe(image, upgraded),
            renderEditorRecipe(image, refined),
            'a deliberate upgrade recompiles the automatic settings through the new path',
          );
          assert.equal(upgraded.retouch[0]?.algorithm, 'guided-v5');
          assert.throws(
            () =>
              applyPortraitValues(
                refined,
                { ...analysis, algorithmVersion: 'mediapipe-v1-selfie256' },
                target.id,
                values,
              ),
            /重新识别/,
          );
          const output = renderEditorRecipe(image, refined);
          assert.deepEqual(renderEditorRecipeTiled(image, refined, { tileSize: 61 }), output);
          assert.equal(refined.warp.strokes.length, 1);
          const { toContent } = compileEditorCoordinateMap(image, refined, image);
          const reference = compileEditorCoordinateMap(image, baseline, image);
          const faceWidth = target.bounds.width * image.width;
          function largestDisplacement(map) {
            return (
              Math.max(
                ...target.landmarks.map((point) => {
                  const q = map(point);
                  return Math.hypot((point.x - q.x) * image.width, (point.y - q.y) * image.height);
                }),
              ) / faceWidth
            );
          }
          const after = largestDisplacement(toContent);
          const before = largestDisplacement(reference.toContent);
          assert.ok(
            after < 0.15,
            'combined controls must keep landmark displacement within the face',
          );
          assert.ok(after > 0.004, 'combined controls must still be visible');
          report.cases.push({
            photo: source.name,
            target: target.id,
            tool: 'coordinated-face',
            state: 'passed',
            beforeRelativeDisplacement: before,
            afterRelativeDisplacement: after,
            contourRows: refined.warp.strokes[0].contour?.rows.length,
            movingAnchors: refined.warp.strokes[0].anchors.filter((anchor) => anchor.mode !== 'pin')
              .length,
          });
          shapeTiles.push(
            { label: 'Previous combined retouch', image: renderEditorRecipe(image, baseline) },
            { label: 'Coordinated contour and features', image: output },
          );
        }
      }
      for (const tool of [
        'smooth',
        'texture',
        'wrinkles',
        'even',
        'skinLight',
        'skinShine',
        'skinBlemish',
        'skinColorSpot',
        'teethTone',
        'meshLight',
      ]) {
        if (!available.get(tool)?.available) {
          report.cases.push({
            photo: source.name,
            tool,
            state: 'unavailable',
            reason: available.get(tool)?.reason,
          });
          continue;
        }
        const signed = ['texture', 'skinLight', 'teethTone', 'meshLight'].includes(tool);
        for (const value of signed ? [-100, -50, 0, 50, 100] : [0, 25, 50, 75, 100]) {
          const recipe = applyPortraitValues(createRecipeV4(), analysis, target.id, {
              [tool]: value,
            }),
            start = performance.now();
          const edited = renderEditorRecipe(image, recipe);
          assert.deepEqual(renderEditorRecipeTiled(image, recipe, { tileSize: 61 }), edited);
          if (value === 0) assert.deepEqual(edited.data, image.data);
          report.cases.push({
            photo: source.name,
            target: target.id,
            tool,
            value,
            state: 'passed',
            ms: performance.now() - start,
            hash: sha(edited.data),
            mseChange: mse(image, edited),
            changedPixels: checkPortraitSupport(image, edited, recipe),
          });
          if (target === analysis.targets.find((t) => t.kind === 'face') && value === 50)
            beautyTiles.push({ label: `${tool} 50`, image: edited });
        }
      }
    }
    await sheet(`${source.name}-beauty`, beautyTiles);
    if (shapeTiles.length > 1) await sheet(`${source.name}-shape`, shapeTiles);
    if (analysis.segmentation?.subject) {
      const tiles = [{ label: 'Original', image }];
      for (const algorithm of ['guided-v4', 'guided-v5']) {
        const start = performance.now(),
          cutout = renderCutout(image, {
            algorithm,
            selection: analysis.segmentation.subject,
            radius: 0.02,
            decontaminate: 0.8,
          });
        for (let at = 3; at < cutout.data.length; at += 4)
          assert.ok(cutout.data[at] <= image.data[at]);
        report.cases.push({
          photo: source.name,
          tool: algorithm,
          state: 'passed',
          ms: performance.now() - start,
          hash: sha(cutout.data),
          qualityVerdict: 'requires visual review; no natural-photo ground-truth alpha',
        });
        for (const background of ['#151515', '#ffffff']) {
          const bytes = await sharp(await png(cutout))
            .flatten({ background })
            .ensureAlpha()
            .raw()
            .toBuffer();
          tiles.push({
            label: `${algorithm} ${background}`,
            image: { ...image, data: new Uint8ClampedArray(bytes) },
          });
        }
      }
      await sheet(`${source.name}-hair-occlusion`, tiles);
    }
    let state = 1997;
    const noisy = { ...image, data: image.data.slice() };
    for (let at = 0; at < noisy.data.length; at++)
      if (at % 4 !== 3) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        noisy.data[at] += (state % 33) - 16;
      }
    const base = {
      algorithm: 'photo-restore-v1',
      luminanceNoise: 55,
      chromaNoise: 75,
      motion: { length: 0, angle: 0, iterations: 6, strength: 0 },
    };
    let start = performance.now();
    const denoised = renderPhotoRestoration(noisy, base);
    const beforeNoise = mse(image, noisy),
      afterNoise = mse(image, denoised);
    assert.ok(
      afterNoise < beforeNoise,
      `${source.name}: actual-image denoise ${beforeNoise} -> ${afterNoise}`,
    );
    report.cases.push({
      photo: source.name,
      tool: 'photo-restore-v1-noise',
      state: 'passed',
      ms: performance.now() - start,
      beforeMse: beforeNoise,
      afterMse: afterNoise,
      truth: 'original real photo before controlled added noise',
    });
    const blurred = { ...image, data: image.data.slice() },
      taps = motionKernel(5, 13);
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        for (let c = 0; c < 3; c++) {
          let sum = 0,
            weight = 0;
          for (const tap of taps) {
            const xx = x + tap.dx,
              yy = y + tap.dy;
            if (xx < 0 || yy < 0 || xx >= image.width || yy >= image.height) continue;
            sum += srgbToLinear(image.data[(yy * image.width + xx) * 4 + c] / 255) * tap.weight;
            weight += tap.weight;
          }
          blurred.data[(y * image.width + x) * 4 + c] = 255 * linearToSrgb(sum / weight);
        }
    start = performance.now();
    const deblurred = renderPhotoRestoration(blurred, {
      ...base,
      luminanceNoise: 0,
      chromaNoise: 0,
      motion: { length: 5, angle: 13, iterations: 6, strength: 0.8 },
    });
    const beforeMotion = mse(image, blurred),
      afterMotion = mse(image, deblurred);
    assert.ok(
      afterMotion < beforeMotion,
      `${source.name}: known motion ${beforeMotion} -> ${afterMotion}`,
    );
    report.cases.push({
      photo: source.name,
      tool: 'photo-restore-v1-motion',
      state: 'passed',
      ms: performance.now() - start,
      beforeMse: beforeMotion,
      afterMse: afterMotion,
      truth: 'original real photo before known linear-light directional PSF',
    });
    await sheet(`${source.name}-restoration`, [
      { label: 'Original truth', image },
      { label: 'Added noise', image: noisy },
      { label: 'Denoise', image: denoised },
      { label: 'Original truth', image },
      { label: 'Known motion blur', image: blurred },
      { label: 'Directional deblur', image: deblurred },
    ]);
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(
      `Real-photo quality observations: ${source.name}; ${analysis.targets.length} targets\n`,
    );
  }
} catch (error) {
  report.failure = String(error.stack);
  throw error;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await vite?.close();
}
