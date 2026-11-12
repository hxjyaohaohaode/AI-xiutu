import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });
const square = (background, format = 'png') =>
  sharp({ create: { width: 96, height: 96, channels: 3, background } })
    .toFormat(format)
    .toBuffer();

async function avifMotionPhoto(video) {
  const xmp =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:Camera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1">' +
    '<Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/avif" Item:Semantic="Primary" Item:Padding="8"/></rdf:li>' +
    '<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="' +
    video.length +
    '"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>';
  const cover = await sharp({
    create: { width: 96, height: 96, channels: 3, background: '#24a675' },
  })
    .avif()
    .withXmp(xmp)
    .toBuffer();
  const box = Buffer.alloc(8);
  box.writeUInt32BE(video.length + 8);
  box.write('mpvd', 4);
  return Buffer.concat([cover, box, video]);
}

async function colorCycle() {
  const rows = 48;
  const frame = (color) =>
    Buffer.from(
      Array(rows * rows)
        .fill(color)
        .flat(),
    );
  return sharp(Buffer.concat([frame([209, 51, 83]), frame([31, 159, 215])]), {
    raw: { width: rows, height: rows * 2, pageHeight: rows, channels: 3 },
  })
    .gif({ delay: [280, 280], loop: 0 })
    .toBuffer();
}

async function slidingSubject() {
  const size = 96;
  const frame = (start) => {
    const pixels = Buffer.alloc(size * size * 3, 27);
    for (let y = 36; y < 60; y++)
      for (let x = start; x < start + 19; x++) {
        const offset = (y * size + x) * 3;
        pixels.set(y < 44 ? [243, 163, 45] : [226, 52, 75], offset);
      }
    return pixels;
  };
  return sharp(Buffer.concat([frame(22), frame(47)]), {
    raw: { width: size, height: size * 2, pageHeight: size, channels: 3 },
  })
    .gif({ delay: [500, 500], loop: 0 })
    .toBuffer();
}

function canvasPixel(canvas, x, y) {
  return canvas.evaluate(
    (node, { x, y }) =>
      Array.from(
        node
          .getContext('2d')
          .getImageData(Math.floor(x * node.width), Math.floor(y * node.height), 1, 1).data,
      ),
    { x, y },
  );
}

async function openCollage(page) {
  await page.locator('[data-dock-tool="collage"]').click();
  const surface = page.locator('.collage-studio:visible');
  await surface.waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  return surface;
}

async function selectSave(page, name) {
  await page.getByRole('combobox', { name: '保存拼图', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

async function downloadCollage(page, label) {
  const result = page.waitForEvent('download', { timeout: 20_000 });
  await selectSave(page, label);
  const download = await result;
  assert.equal(await download.failure(), null);
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

async function checkControlBounds(controls) {
  const overflow = await controls.evaluateAll((items) =>
    items
      .filter(
        (item) =>
          item.scrollWidth > item.clientWidth + 2 || item.scrollHeight > item.clientHeight + 2,
      )
      .map((item) => item.textContent || item.getAttribute('aria-label')),
  );
  assert.deepEqual(overflow, [], 'labels must fit within their own controls');
}

export async function reviewCollage({ page, until, capture, portrait, coast }) {
  const green = [28, 171, 117, 255];
  const red = [216, 53, 83, 255];
  const pictures = [
    file('Green square.png', 'image/png', await square('#1cab75')),
    file('Rose square.png', 'image/png', await square('#d83553')),
  ];
  const dialog = await openCollage(page);
  const input = dialog.getByTestId('collage-files');
  const canvas = dialog.getByRole('img', { name: '拼图预览' });
  await input.setInputFiles(pictures);
  await canvas.waitFor();
  await dialog.getByRole('button', { name: '长拼图', exact: true }).click();
  assert.ok(await canvas.evaluate((node) => node.height > node.width * 1.9));
  await dialog.getByRole('button', { name: '横拼图', exact: true }).click();
  assert.ok(await canvas.evaluate((node) => node.width > node.height * 1.9));
  await dialog.getByRole('button', { name: '模板', exact: true }).click();
  const ratios = dialog.getByRole('group', { name: '画幅比例' });
  assert.equal(await ratios.getByRole('button').count(), 16);
  for (const [label, aspect] of [
    ['9:16', 9 / 16],
    ['2.39:1', 2.39],
  ]) {
    const choice = ratios.getByRole('button', { name: label, exact: true });
    await choice.click();
    const dimensions = await choice.locator('rect').evaluate((rect) => ({
      width: rect.width.baseVal.value,
      height: rect.height.baseVal.value,
    }));
    assert.ok(Math.abs(dimensions.width / dimensions.height - aspect) < 0.0001);
    await until(
      async () =>
        canvas.evaluate(
          (node, ratio) => Math.abs(node.width / node.height - ratio) < 0.004,
          aspect,
        ),
      'actual collage uses ' + label,
    );
  }
  await ratios.getByRole('button', { name: '自定比例', exact: true }).click();
  const custom = page.getByRole('dialog', { name: '自定比例', exact: true });
  await custom.getByRole('spinbutton', { name: '宽度' }).fill('7');
  await custom.getByRole('spinbutton', { name: '高度' }).fill('10');
  await custom.getByRole('button', { name: '应用', exact: true }).click();
  await until(
    async () => canvas.evaluate((node) => Math.abs(node.width / node.height - 0.7) < 0.002),
    'custom 7:10 ratio',
  );
  await checkControlBounds(ratios.getByRole('button'));
  await dialog.getByRole('button', { name: '1:1', exact: true }).click();
  assert.equal(await canvas.evaluate((node) => node.width - node.height), 0);
  const settings = dialog.locator('summary').filter({ hasText: '拼图素材' });
  await settings.click();
  await dialog.getByRole('button', { name: '1 Green square.png' }).click();
  await dialog.getByRole('button', { name: '手动抠图', exact: true }).click();
  let bounds = await canvas.boundingBox();
  for (const [x, y] of [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
  ])
    await page.mouse.click(bounds.x + x * bounds.width, bounds.y + y * bounds.height);
  await dialog.getByRole('button', { name: '应用抠图', exact: true }).click();
  bounds = await canvas.boundingBox();
  const from = { x: bounds.x + 0.25 * bounds.width, y: bounds.y + 0.5 * bounds.height };
  assert.deepEqual(await canvasPixel(canvas, 0.75, 0.5), red);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 0.5 * bounds.width, from.y, { steps: 5 });
  await page.mouse.up();
  await until(
    async () => (await canvasPixel(canvas, 0.75, 0.5))[1] === green[1],
    'foreground crosses the tile boundary',
  );
  const png = await downloadCollage(page, '下载 PNG');
  assert.equal(png.name, 'collage.png');
  const pngInfo = await sharp(png.bytes).metadata();
  assert.deepEqual([pngInfo.width, pngInfo.height], [4096, 4096]);
  const outputPixel = await sharp(png.bytes)
    .extract({ left: 3072, top: 2048, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual([...outputPixel], green, 'the actual download includes the crossing foreground');
  await dialog.getByRole('button', { name: '撤销', exact: true }).click();
  assert.deepEqual(await canvasPixel(canvas, 0.75, 0.5), red);
  await dialog.getByRole('button', { name: '重做', exact: true }).click();
  assert.deepEqual(await canvasPixel(canvas, 0.75, 0.5), green);
  const positionOption = dialog.locator('[data-control-id="collage-position-x"]');
  if (!(await positionOption.isVisible())) await settings.click();
  const position = dialog.locator('.parameter-shelf');
  await positionOption.click();
  const beforePosition = await position.locator('.precision-value').innerText();
  await position.locator('.precision-value').click();
  await position.getByRole('spinbutton').fill('2047.5');
  await position.getByRole('spinbutton').press('Enter');
  assert.match(await position.locator('.precision-value').innerText(), /2,047\.5/);
  await dialog.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await position.locator('.precision-value').innerText(), beforePosition);
  await dialog.getByRole('button', { name: '2 Rose square.png', exact: true }).click();
  const replacementPicker = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: '替换素材', exact: true }).click();
  await (
    await replacementPicker
  ).setFiles([file('Blue square.png', 'image/png', await square('#164f91'))]);
  await until(
    async () => (await canvasPixel(canvas, 0.9, 0.1))[2] === 145,
    'local replacement preserves the selected cell',
  );
  await dialog.getByRole('button', { name: '撤销', exact: true }).click();
  assert.deepEqual(await canvasPixel(canvas, 0.9, 0.1), red);
  await selectSave(page, '放进编辑器');
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.image-frame canvas[aria-label]:visible').waitFor();

  await openCollage(page);
  assert.deepEqual(
    await canvasPixel(canvas, 0.75, 0.5),
    green,
    'returning to the tool preserves the composition',
  );
  await page.reload();
  const gif = file('Color cycle.gif', 'image/gif', await colorCycle());
  await page.locator('input[type="file"].sr-only').first().setInputFiles([gif]);
  const moving = page.locator('.collage-studio:visible');
  await moving.waitFor();
  assert.equal(
    await page.locator('[data-dock-tool="collage"]').getAttribute('aria-pressed'),
    'true',
  );
  const movingInput = moving.getByTestId('collage-files');
  const movingCanvas = moving.getByRole('img', { name: '拼图预览' });
  assert.equal((await sharp(gif.buffer, { animated: true }).metadata()).pages, 2);
  await movingCanvas.waitFor();
  const play = () => moving.getByRole('button', { name: '播放实况', exact: true }).click();
  const pause = () => moving.getByRole('button', { name: '暂停实况', exact: true }).click();
  const first = await canvasPixel(movingCanvas, 0.5, 0.5);
  await play();
  await until(
    async () => (await canvasPixel(movingCanvas, 0.5, 0.5))[2] > 170,
    'GIF changes visible canvas pixels',
  );
  await pause();
  assert.ok(first[0] > first[2], 'animated input starts on the first frame');

  const motion = await downloadCollage(page, '导出实况照片');
  assert.match(motion.name, /MP\.jpg$/);
  assert.equal((await sharp(motion.bytes).metadata()).format, 'jpeg');
  const video = await downloadCollage(page, '导出动态视频');
  assert.equal(video.name, 'collage.mp4');
  assert.equal(video.bytes.subarray(4, 8).toString(), 'ftyp');
  assert.ok(video.bytes.length > 2048);
  await movingInput.setInputFiles([file(motion.name, 'image/jpeg', motion.bytes)]);
  await moving.locator('summary').filter({ hasText: '拼图素材' }).click();
  await moving.getByRole('button', { name: '2 collageMP.jpg', exact: true }).waitFor();
  await moving.locator('summary').filter({ hasText: '拼图素材' }).click();
  await play();
  await until(
    async () => (await canvasPixel(movingCanvas, 0.77, 0.5))[0] > 170,
    'embedded MP4 changes away from its cover',
  );
  await until(
    async () => (await canvasPixel(movingCanvas, 0.77, 0.5))[2] > 170,
    'embedded MP4 plays inside the re-imported JPEG',
  );
  await pause();
  await moving
    .getByTestId('collage-pair')
    .setInputFiles([
      file('Unmatched cover.jpg', 'image/jpeg', await square('#24a675', 'jpeg')),
      file('Paired motion.mp4', 'video/mp4', video.bytes),
    ]);
  await until(
    async () => (await canvasPixel(movingCanvas, 0.5, 0.75))[1] > 150,
    'explicit pair uses its own still cover',
  );
  await play();
  await until(
    async () => (await canvasPixel(movingCanvas, 0.5, 0.75))[2] > 170,
    'paired clip plays instead of its cover',
  );
  await pause();
  await page.locator('[data-dock-tool="collage"]').click();
  await moving.waitFor({ state: 'hidden' });

  await page.reload();
  const avif = await avifMotionPhoto(video.bytes);
  assert.equal(avif.subarray(8, 12).toString(), 'avif');
  await page
    .getByLabel('选择照片', { exact: true })
    .setInputFiles([file('Color cycleMP.avif', 'image/avif', avif)]);
  const avifStudio = page.locator('.collage-studio:visible');
  const avifCanvas = avifStudio.getByRole('img', { name: '拼图预览' });
  await avifCanvas.waitFor();
  assert.ok((await canvasPixel(avifCanvas, 0.5, 0.5))[1] > 150, 'AVIF still is the poster');
  await avifStudio.getByRole('button', { name: '播放实况', exact: true }).click();
  await until(
    async () => (await canvasPixel(avifCanvas, 0.5, 0.5))[2] > 170,
    'real motion frames decode from the AVIF mpvd box',
  );
  await avifStudio.getByRole('button', { name: '暂停实况', exact: true }).click();

  await page.reload();
  const tracked = await openCollage(page);
  const trackedCanvas = tracked.getByRole('img', { name: '拼图预览' });
  await tracked
    .getByTestId('collage-files')
    .setInputFiles([
      file('Sliding subject.gif', 'image/gif', await slidingSubject()),
      file('Other tile.png', 'image/png', await square('#164f91')),
    ]);
  await trackedCanvas.waitFor();
  await tracked.getByRole('button', { name: '1:1', exact: true }).click();
  await tracked.locator('summary').filter({ hasText: '拼图素材' }).click();
  await tracked.getByRole('button', { name: '1 Sliding subject.gif' }).click();
  await tracked.getByRole('button', { name: '手动抠图', exact: true }).click();
  bounds = await trackedCanvas.boundingBox();
  for (const [x, y] of [
    [0.225, 0.365],
    [0.435, 0.365],
    [0.435, 0.63],
    [0.225, 0.63],
  ])
    await page.touchscreen.tap(bounds.x + x * bounds.width, bounds.y + y * bounds.height);
  await tracked.getByRole('button', { name: '应用抠图', exact: true }).click();
  const tileSettings = tracked.locator('summary').filter({ hasText: '拼图素材' });
  if (!(await tracked.getByRole('button', { name: '仅保留主体', exact: true }).isVisible()))
    await tileSettings.click();
  await tracked.getByRole('button', { name: '仅保留主体', exact: true }).click();
  bounds = await trackedCanvas.boundingBox();
  await page.mouse.move(bounds.x + 0.1 * bounds.width, bounds.y + 0.52 * bounds.height);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 0.6 * bounds.width, bounds.y + 0.52 * bounds.height, {
    steps: 5,
  });
  await page.mouse.up();
  await until(
    async () => (await canvasPixel(trackedCanvas, 0.58, 0.52))[0] > 175,
    'first frame foreground spans the neighboring tile',
  );
  await tracked.getByRole('button', { name: '播放实况', exact: true }).click();
  await until(
    async () => (await canvasPixel(trackedCanvas, 0.84, 0.52))[0] > 175,
    'the foreground follows the subject across the neighboring tile while the GIF plays',
  );
  await tracked.getByRole('button', { name: '暂停实况', exact: true }).click();

  await page.reload();
  const review = await openCollage(page);
  const preview = review.getByRole('img', { name: '拼图预览' });
  await review
    .getByTestId('collage-files')
    .setInputFiles([
      file('Public coast.jpg', 'image/jpeg', coast),
      file('Public portrait.jpg', 'image/jpeg', portrait),
      file('Color cycle.gif', 'image/gif', gif.buffer),
      file(
        'Coast detail.jpg',
        'image/jpeg',
        await sharp(coast).extract({ left: 100, top: 100, width: 350, height: 350 }).toBuffer(),
      ),
    ]);
  await preview.waitFor();
  await review.getByRole('button', { name: '左侧主图', exact: true }).click();
  assert.equal(
    await review.getByRole('group', { name: '拼图模板' }).getByRole('button').count(),
    18,
  );
  await review.locator('summary').filter({ hasText: '拼图素材' }).click();
  await review.getByRole('button', { name: '2 Public portrait.jpg' }).click();
  await review.getByRole('button', { name: '人像抠图', exact: true }).click();
  await review.getByRole('button', { name: '移动出圈主体', exact: true }).waitFor();
  await review.locator('summary').filter({ hasText: '拼图素材' }).click();
  await capture(page, 'interactions/mobile-motion-collage.png');
  for (const [width, height, label] of [
    [320, 640, 'narrow'],
    [768, 1024, 'tablet'],
    [844, 390, 'landscape'],
    [1440, 900, 'desktop'],
  ]) {
    await page.setViewportSize({ width, height });
    const canvas = await preview.boundingBox();
    const rail = await page.locator('.floating-tool-dock:visible').boundingBox();
    assert.ok(canvas.width > 30 && canvas.height > 30 && rail.y + rail.height <= height + 1, label);
    assert.ok(canvas.x >= 0 && canvas.x + canvas.width <= width + 1, label);
    await checkControlBounds(review.locator('.collage-ratio-rail > button'));
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1),
      label,
    );
    await capture(page, 'interactions/collage-' + label + '.png');
  }
  return {
    cutoutPixel: [...outputPixel],
    png: [pngInfo.width, pngInfo.height],
    jpegBytes: motion.bytes.length,
    mp4Bytes: video.bytes.length,
    avifMotionBytes: avif.length,
  };
}

export async function reviewMakeup({ page, canvasPixels, tool, parameter, until, capture }) {
  const baseline = await canvasPixels(page);
  await tool(page, 'paint');
  const brush = page.getByRole('group', { name: '妆容笔', exact: true });
  await brush.getByRole('button', { name: '眼影', exact: true }).click();
  await parameter(page, 'makeup-saturation', 155);
  await parameter(page, 'makeup-diameter', 17.5);
  await page.getByRole('button', { name: '颜色', exact: true }).click();
  const disclosure = page.getByRole('button', { name: '自定义颜色', exact: true });
  await disclosure.click();
  const custom = page.getByRole('textbox', { name: 'HEX颜色', exact: true }).last();
  await custom.fill('#ac4569');
  await custom.press('Enter');
  await disclosure.click();
  await page.getByRole('button', { name: '笔触', exact: true }).click();

  const canvas = page.locator('.image-frame canvas[aria-label]:visible');
  const image = await canvas.boundingBox();
  const panel = await page.locator('.free-panel[aria-hidden="false"]').boundingBox();
  const y = Math.min(image.y + image.height * 0.42, panel.y - 16);
  const start = image.x + image.width * 0.45;
  assert.ok(y > image.y && image.width > 20);
  await page.mouse.move(start, y);
  await page.mouse.down();
  await page.mouse.move(start + image.width * 0.065, y - 2, { steps: 12 });
  await page.mouse.up();
  await until(
    async () => (await canvasPixels(page)).pixelSha256 !== baseline.pixelSha256,
    'makeup stroke changes the render',
  );
  const painted = await canvasPixels(page);
  await page.locator('.free-panel[aria-hidden="false"] .inspector-scroll').evaluate((node) => {
    node.scrollTop = 0;
  });
  await capture(page, 'interactions/mobile-makeup-brush.png');

  await page.getByRole('button', { name: '图层', exact: true }).click();
  await page.locator('.advanced-tool-family summary').filter({ hasText: '编辑妆容笔画' }).click();
  await page.getByRole('combobox', { name: '笔画', exact: true }).click();
  await page.getByRole('option', { name: '第 1 笔', exact: true }).click();
  await parameter(page, 'stroke-opacity', 0);
  await page.getByRole('button', { name: '应用笔画修改', exact: true }).click();
  await until(
    async () => (await canvasPixels(page)).pixelSha256 === baseline.pixelSha256,
    'post-stroke edit changes the rendered result',
  );
  await page.locator('body').press('Control+z');
  await until(
    async () => (await canvasPixels(page)).pixelSha256 === painted.pixelSha256,
    'undo restores the edited makeup stroke',
  );
  const mode = page.getByRole('switch', { name: '自动妆容', exact: true });
  await mode.click();
  assert.equal(await mode.getAttribute('aria-checked'), 'true');
  const automatic = page.locator('.automatic-makeup:visible');
  const areas = automatic.getByRole('group', { name: '妆容区域' });
  await areas.waitFor({ timeout: 50_000 });
  assert.equal(await areas.getByRole('button').count(), 9);
  await areas.getByRole('button', { name: '唇妆', exact: true }).click();
  const shades = automatic.getByRole('group', { name: '画笔颜色' });
  const families = automatic.getByRole('combobox', { name: '色系', exact: true });
  const allShades = new Set();
  for (const name of ['裸色', '红棕', '经典红', '莓果色', '珊瑚色', '玫瑰色']) {
    await families.click();
    await page.getByRole('option', { name, exact: true }).click();
    assert.equal(await shades.getByRole('button').count(), 8);
    for (const color of await shades
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))))
      allShades.add(color);
  }
  assert.equal(allShades.size, 48);
  assert.ok(await shades.evaluate((node) => node.scrollWidth > node.clientWidth));
  await shades.getByRole('button', { name: '#C55C6A', exact: true }).click();
  await until(
    async () => (await canvasPixels(page)).pixelSha256 !== painted.pixelSha256,
    'real landmark makeup changes the photo',
  );
  await automatic.getByRole('button', { name: '当前妆容强度', exact: true }).click();
  const range = automatic.getByRole('slider');
  const before = await canvasPixels(page);
  await range.scrollIntoViewIfNeeded();
  const slide = await range.boundingBox();
  await page.mouse.move(slide.x + slide.width * 0.45, slide.y + slide.height / 2);
  await page.mouse.down();
  await page.mouse.move(slide.x + slide.width * 0.83, slide.y + slide.height / 2, { steps: 8 });
  try {
    await until(async () => {
      const current = await canvasPixels(page);
      assert.deepEqual(
        [current.width, current.height],
        [before.width, before.height],
        'drag preview must keep the raster size',
      );
      return current.pixelSha256 !== before.pixelSha256;
    }, 'strength renders actual pixels while the pointer is held');
  } finally {
    await page.mouse.up();
  }
  await automatic.getByRole('button', { name: '颜色不透明度', exact: true }).click();
  const displayedValue = automatic.locator('.precision-value');
  await displayedValue.click();
  const opacity = automatic.locator('input[type="number"]');
  await opacity.fill('0');
  await opacity.press('Enter');
  await until(
    async () => (await canvasPixels(page)).pixelSha256 === painted.pixelSha256,
    'automatic opacity zero restores pixels without discarding the manual stroke',
  );
  await page.locator('body').press('Control+z');
  await until(
    async () => (await canvasPixels(page)).pixelSha256 !== painted.pixelSha256,
    'automatic opacity is undoable',
  );
  await automatic.getByRole('button', { name: '颜色', exact: true }).click();
  await checkControlBounds(automatic.locator('.makeup-icon-rail > button'));
  await page.locator('.free-panel[aria-hidden="false"] .inspector-scroll').evaluate((node) => {
    node.scrollTop = 0;
  });
  await capture(page, 'interactions/mobile-automatic-makeup.png');
  await page.setViewportSize({ width: 320, height: 568 });
  const palette = automatic.locator('.makeup-palette');
  await until(async () => {
    const color = await palette.boundingBox();
    const dock = await page.locator('.floating-tool-dock:visible').boundingBox();
    return (
      color &&
      dock &&
      color.y + color.height <= dock.y + 1 &&
      color.x >= 0 &&
      color.x + color.width <= 320
    );
  }, 'narrow phone keeps the whole palette above the tool dock');
  await capture(page, 'interactions/mobile-automatic-makeup-narrow.png');
  const setLanguage = async (locale) => {
    await page.evaluate((locale) => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'yingjian.locale.v1',
          newValue: locale,
        }),
      );
    }, locale);
    await until(
      () =>
        page
          .locator('html')
          .getAttribute('lang')
          .then((lang) => lang === locale),
      'render ' + locale,
    );
  };
  await areas.getByRole('button', { name: '高光', exact: true }).click();
  for (const [locale, expected] of [
    ['en', 'Champagne'],
    ['zh-TW', '香檳色'],
  ]) {
    await setLanguage(locale);
    const family = palette.locator('.choice-value');
    await until(
      async () => (await family.innerText()) === expected,
      'render the translated family label',
    );
    assert.ok(
      await family.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      expected + ' must display in full',
    );
    await capture(page, 'interactions/mobile-makeup-320-' + locale + '.png');
  }
  await setLanguage('zh-CN');
  await page.setViewportSize({ width: 390, height: 844 });

  await tool(page, 'beauty');
  await page.getByRole('button', { name: '身形', exact: true }).click();
  await page.getByRole('switch', { name: '自动人像调节', exact: true }).click();
  await page.getByRole('button', { name: '横向拉伸', exact: true }).click();
  const warp = page.locator('[data-motion="warp-controls"]:visible');
  await warp.getByRole('button', { name: '横向', exact: true }).waitFor();
  assert.equal(
    await warp.getByRole('button', { name: '横向', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  const beforeWarp = await canvasPixels(page);
  const imageForWarp = await canvas.boundingBox();
  const x = imageForWarp.x + imageForWarp.width * 0.48;
  const yWarp = imageForWarp.y + imageForWarp.height * 0.65;
  const cdp = await page.context().newCDPSession(page);
  try {
    const pointer = {
      pointerType: 'pen',
      x,
      y: yWarp,
      button: 'left',
      buttons: 1,
      force: 0.55,
      clickCount: 1,
    };
    await cdp.send('Input.dispatchMouseEvent', { ...pointer, type: 'mousePressed' });
    await cdp.send('Input.dispatchMouseEvent', {
      ...pointer,
      type: 'mouseMoved',
      x: x + 30,
      y: yWarp + 9,
      force: 0.75,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      ...pointer,
      type: 'mouseReleased',
      x: x + 30,
      y: yWarp + 9,
      buttons: 0,
      force: 0,
    });
  } finally {
    await cdp.detach();
  }
  await until(
    async () => (await canvasPixels(page)).pixelSha256 !== beforeWarp.pixelSha256,
    'the real manual body tool accepts pen input and renders a changed raster',
  );
  await capture(page, 'interactions/mobile-manual-stretch.png');
  return {
    baseline: baseline.pixelSha256,
    painted: painted.pixelSha256,
    editAndUndo: true,
    detectedMakeupAreas: 9,
    paletteShades: 18,
    nativeDrag: [before.width, before.height],
    browserPenStretch: true,
  };
}
