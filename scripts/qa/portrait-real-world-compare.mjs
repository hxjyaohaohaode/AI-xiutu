import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const [before, after, target] = process.argv.slice(2);
assert.ok(
  before && after && target,
  'Usage: node portrait-real-world-compare.mjs OLD_DIR NEW_DIR OUTPUT_DIR',
);
const output = resolve(target);
const read = (path) => readFile(path, 'utf8').then(JSON.parse);
const [oldReport, newReport, { inputs }] = await Promise.all([
  read(join(before, 'report.json')),
  read(join(after, 'report.json')),
  read('scripts/qa/portrait-real-world-inputs.json'),
]);
await mkdir(output, { recursive: true });
const names = {
  'group-distance': '远景小脸与多人全身',
  'smile-headshot': '露齿与面部叠加',
  'smile-freckles': '瞳孔与皮肤肌理',
  'standing-guo': '腿长与身形叠加',
  'standing-pat': '腰线与交叉腿',
  'smile-fringe': '发际线与蓬松发',
  'group-street': '两人身体重叠',
  'group-crew': '头盔与背景人物',
  'low-phone-light': '手机屏幕照明的极暗侧脸',
  'low-nina': '暗光侧脸',
  'half-mask': '半脸裁切和面具',
  'profile-curls': '侧脸与发丝遮挡',
  'low-vox': '大面积暗部的正脸',
  'low-koshy': '轮廓逆光',
  'smile-studio': '正脸肤质与笑容',
  'profile-pedro': '日光下的侧脸',
  'group-aerobics': '多人运动与手臂轮廓',
  'ballet-arms': '可见上臂与前臂',
};
const labels = new Map(Object.entries(newReport.inventory).map(([id, v]) => [id, v.label]));
const escape = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const columnNames = ['原图', '旧版', '新版'];
const get = (report, name) => report.cases.find((entry) => entry.name === name);
const font = 'Microsoft YaHei, Noto Sans CJK SC, sans-serif';
const html = [];

function detailRect(name, { width, height }, a, b) {
  const custom = {
    'smile-freckles': [0.34, 0.31, 0.54, 0.43],
    'smile-headshot': [0.39, 0.42, 0.65, 0.58],
    'smile-fringe': [0.29, 0.21, 0.79, 0.56],
  }[name];
  if (custom) {
    const [x0, y0, x1, y1] = custom;
    return {
      left: Math.floor(x0 * width),
      top: Math.floor(y0 * height),
      width: Math.floor((x1 - x0) * width),
      height: Math.floor((y1 - y0) * height),
    };
  }
  const bounds = b?.bounds ?? a?.bounds;
  if (!bounds) return;
  const x = Math.max(0, bounds.x - bounds.width * 0.28);
  const y = Math.max(0, bounds.y - bounds.height * 0.32);
  return {
    left: Math.floor(x * width),
    top: Math.floor(y * height),
    width: Math.floor((Math.min(1, bounds.x + bounds.width * 1.28) - x) * width),
    height: Math.floor((Math.min(1, bounds.y + bounds.height * 1.2) - y) * height),
  };
}

function markings(analysis, width, height) {
  const scale = Math.max(width, height) / 470;
  const toPixels = (p) => [p.x * width, p.y * height];
  const points = (list) => list.map((p) => toPixels(p).join(',')).join(' ');
  const dot = (p, fill, radius = 2.1) => {
    const [x, y] = toPixels(p);
    return `<circle cx="${x}" cy="${y}" r="${radius * scale}" fill="${fill}"/>`;
  };
  const outline = (list, color, closed = false) =>
    `<${closed ? 'polygon' : 'polyline'} points="${points(list)}" fill="none" stroke="${color}" stroke-width="${1.35 * scale}" opacity=".9"/>`;
  let elements = '';
  for (const body of analysis.targets.filter((t) => t.kind === 'body')) {
    for (const [a, b] of [
      [11, 12],
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
      [11, 23],
      [12, 24],
      [23, 24],
      [23, 25],
      [25, 27],
      [24, 26],
      [26, 28],
    ]) {
      const first = body.landmarks[a],
        second = body.landmarks[b];
      if ((first?.visibility ?? 0) > 0.62 && (second?.visibility ?? 0) > 0.62)
        elements += outline([first, second], '#25bfff') + dot(first, '#25bfff', 1.45);
    }
    for (const p of body.contours.footPins ?? []) elements += dot(p, '#ffdb69', 2);
    for (const kind of ['waistBand', 'upperTorso', 'pelvisBand', 'neckBand']) {
      const bands = body.contours[kind] ?? [];
      for (let i = 0; i < bands.length; i += 3)
        elements += outline(bands.slice(i, i + 3), '#ffca6b');
    }
  }
  for (const face of analysis.targets.filter((t) => t.kind === 'face')) {
    elements += outline(face.contours.oval ?? [], '#72ffc1', true);
    for (const kind of ['hairline', 'hairCrown', 'earA', 'earB']) {
      const anchors = face.contours[kind];
      if (anchors?.length)
        elements +=
          outline(anchors, '#f7be75') + anchors.map((p) => dot(p, '#f7be75', 1.2)).join('');
    }
    for (const kind of ['leftPupil', 'rightPupil', 'nostrilCenters'])
      for (const p of (face.contours[kind] ?? []).slice(0, kind === 'nostrilCenters' ? 2 : 1))
        elements += dot(p, '#ed82ff', 1.4);
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${elements}</svg>`,
  );
}

async function triptych({ input, title, mode, crop }) {
  const oldPath = join(before, input.name),
    newPath = join(after, input.name);
  const source = join(newPath, 'original.png');
  assert.deepEqual(
    await readFile(join(oldPath, 'original.png')),
    await readFile(source),
    input.name + ' must compare identical input pixels',
  );
  const w = 405,
    h = crop ? 320 : 430,
    gap = 7,
    top = 54,
    labelHeight = 32,
    bottom = 43;
  const width = w * 3 + gap * 4;
  const height = top + labelHeight + h + bottom;
  const images = [
    source,
    mode === 'anchors' ? source : join(oldPath, mode + '.png'),
    mode === 'anchors' ? source : join(newPath, mode + '.png'),
  ];
  const composite = await Promise.all(
    images.map(async (path, i) => {
      let buffer = await readFile(path);
      const info = await sharp(buffer).metadata();
      if (i && mode === 'anchors') {
        const analysis = await read(join(i === 1 ? oldPath : newPath, 'analysis.json'));
        buffer = await sharp(buffer)
          .composite([{ input: markings(analysis, info.width, info.height) }])
          .png()
          .toBuffer();
      }
      let bitmap = sharp(buffer);
      if (crop) bitmap = bitmap.extract(crop);
      return {
        input: await bitmap
          .resize(w, h, { fit: 'contain', background: '#161b21' })
          .jpeg({ quality: 94 })
          .toBuffer(),
        left: gap + i * (w + gap),
        top: top + labelHeight,
      };
    }),
  );
  const svg =
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <text x="15" y="34" fill="#f6f2ed" font-family="${font}" font-size="21" font-weight="bold">${escape(names[input.name] + ' · ' + title)}</text>
    ${columnNames.map((name, i) => `<text x="${gap + i * (w + gap) + w / 2}" y="${top + 20}" text-anchor="middle" fill="#dce5ee" font-family="${font}" font-size="16">${name}</text>`).join('')}
    <text x="15" y="${height - 15}" fill="#c5cdd5" font-family="${font}" font-size="12">${escape(input.source + ' · ' + input.license + ' · 旧版 ' + oldReport.commit.slice(0, 7) + ' · 新版 ' + afterCommit.slice(0, 7))}</text>
  </svg>`);
  const file = input.name + '-' + mode + (crop ? '-detail' : '') + '.jpg';
  await sharp({ create: { width, height, channels: 3, background: '#222831' } })
    .composite([...composite, { input: svg }])
    .jpeg({ quality: 92 })
    .toFile(join(output, file));
  return file;
}

const afterCommit = newReport.commit;
const display = [
  'group-distance',
  'smile-headshot',
  'smile-freckles',
  'standing-guo',
  'standing-pat',
  'smile-fringe',
  'group-street',
  'group-crew',
  'profile-curls',
  'half-mask',
  'low-nina',
  'low-phone-light',
  'low-vox',
  'low-koshy',
  'smile-studio',
  'profile-pedro',
  'group-aerobics',
  'ballet-arms',
];
for (const name of display) {
  const input = inputs.find((photo) => photo.name === name);
  const a = get(oldReport, name),
    b = get(newReport, name);
  assert.ok(a && b && !a.error && !b.error, 'Missing verified comparison: ' + name);
  assert.equal(a.photoSha256, input.sha256);
  assert.equal(b.photoSha256, input.sha256);
  const figure = async (title, mode, crop, desc = '') => {
    const file = await triptych({ input, title, mode, crop });
    return `<figure><a href="${file}"><img src="${file}" loading="lazy" alt="${escape(names[name] + ' ' + title)}"></a><figcaption>${escape(desc)}</figcaption></figure>`;
  };
  const figures = [];
  const describe = (values) =>
    Object.entries(values)
      .map(([id, value]) => (labels.get(id) ?? id) + ' ' + value)
      .join('、') || '无可用调整';
  function compareSettings(previous, next) {
    return (
      (next.requestedValues ? '共同请求 ' + describe(next.requestedValues) + '。' : '') +
      '旧版生效 ' +
      describe(previous.values) +
      '。新版生效 ' +
      describe(next.values) +
      '。'
    );
  }
  const count = (entry, kind) => entry.targets.filter((t) => t.kind === kind).length;
  if (['group-distance', 'group-street', 'group-crew'].includes(name))
    figures.push(
      await figure(
        '定位叠图',
        'anchors',
        undefined,
        '绿色为脸部轮廓，蓝线为姿态锚点，黄色为已确认的身体截面或脚部支点。',
      ),
    );
  for (const [key, title] of [
    ['portrait-stack', '面部和身形一起调'],
    ['complete-edit', '人像、调节、局部和构图成片'],
  ]) {
    const previous = a.comparisons.find((c) => c.name === key);
    const next = b.comparisons.find((c) => c.name === key);
    if (!previous || !next) continue;
    const grade =
      key === 'complete-edit'
        ? '两版额外应用同一个全局色调、局部提亮与修复、裁切、旋转和四角校正配方。'
        : '';
    figures.push(await figure(title, key, undefined, grade + compareSettings(previous, next)));
  }
  for (const kind of ['face', 'body']) {
    const modes = ['stack', 'single', 'strong'];
    for (const mode of modes) {
      const key = kind + '-' + mode;
      const oldCase = a.comparisons.find((c) => c.name === key);
      const newCase = b.comparisons.find((c) => c.name === key);
      if (mode !== 'stack' && !oldCase.changedPixels && !newCase.changedPixels) continue;
      if (mode === 'stack' && kind === 'body' && !count(a, 'body') && !count(b, 'body')) continue;
      if (
        mode === 'stack' &&
        kind === 'body' &&
        !input.tags.some((tag) => tag.includes('body')) &&
        !oldCase.changedPixels &&
        !newCase.changedPixels
      )
        continue;
      if (
        mode === 'stack' &&
        kind === 'face' &&
        !count(a, 'face') &&
        !count(b, 'face') &&
        count(b, 'body')
      )
        continue;
      const title =
        (kind === 'face' ? '面部' : '身形') +
        { stack: '日常叠加', single: '单项', strong: '高强度叠加' }[mode];
      const caption = compareSettings(oldCase, newCase);
      const crop =
        mode === 'single' && kind === 'face'
          ? detailRect(name, { width: b.size[0], height: b.size[1] }, oldCase, newCase)
          : undefined;
      const rendered = await figure(title, key, crop, caption);
      if (mode === 'strong')
        figures.push(`<details><summary>${title}</summary>${rendered}</details>`);
      else figures.push(rendered);
    }
  }
  html.push(`<section><h2>${names[name]}</h2><p class="meta">定位结果 · 人脸 ${count(a, 'face')} → ${count(b, 'face')} · 身形 ${count(a, 'body')} → ${count(b, 'body')}</p>
    ${figures.join('')}<p class="meta">${escape(input.source)} · <a href="${escape(input.page)}">照片来源</a> · <a href="${escape(input.licenseUrl)}">${escape(input.license)}</a> · 旧版与新版列包含编辑</p></section>`);
}

await writeFile(
  join(output, 'index.html'),
  `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>人像精修对照</title><style>
*{box-sizing:border-box}body{margin:0;background:#161b21;color:#f4f1eb;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif}
main{max-width:1280px;margin:auto;padding:clamp(14px,4vw,44px)}h1,h2{line-height:1.25}h1{font-size:clamp(30px,5vw,48px)}
section{margin:36px 0;padding-top:16px;border-top:1px solid #434b54}figure{margin:14px 0 22px}
img{display:block;width:100%;height:auto;border-radius:9px}figcaption,.meta{color:#bdc9d3;font-size:14px}figcaption{margin-top:6px}
details{color:#bdc9d3;margin-block:9px}a{color:#94dcfc}a:focus-visible,summary:focus-visible{outline:2px solid #94dcfc}
</style><main><h1>人像精修实拍对照</h1>
<p>每组从左到右为原图、旧版、新版。两版使用同一张照片、同一个人和相同滑条请求。图下列出实际生效的参数。没有确认可见部位的样本保留原图。点击任意对照图可放大。</p>
<p class="meta">旧版 ${oldReport.commit} · 新版 ${newReport.commit} · Chromium 本地模型与编辑内核 · 全部采用有来源的实际照片</p>
${html.join('')}</main></html>`,
);
console.log('Wrote ' + join(output, 'index.html'));
