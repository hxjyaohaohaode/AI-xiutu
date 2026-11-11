import { decodeImageSourceBitmap } from '../editor/imageSources';

export const SKETCH_IMAGE_INPUT =
  'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,.svg,.bmp,.avif';
const svgNamespace = 'http://www.w3.org/2000/svg';
const tags = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
]);
const attributes = new Set([
  'viewBox',
  'width',
  'height',
  'preserveAspectRatio',
  'id',
  'd',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'points',
  'transform',
  'fill',
  'fill-rule',
  'fill-opacity',
  'opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'clip-path',
  'clip-rule',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'clipPathUnits',
]);
const reference = /^url\(#[A-Za-z_][\w.-]{0,80}\)$/;
const color = /^(?:#[0-9a-f]{3,8}|[a-z]{1,30}|(?:rgba?|hsla?)\([\d.,%+\-\s]+\))$/i;

/** Convert a bounded, self-contained SVG drawing to an image source. */
export function sanitizeSketchSvg(markup: string) {
  if (markup.length > 512_000 || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(markup))
    throw new Error('SVG 内容超出草图支持范围。');
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement;
  if (
    root.localName !== 'svg' ||
    root.namespaceURI !== svgNamespace ||
    parsed.querySelector('parsererror')
  )
    throw new Error('请选择带有效画幅的 SVG 图片。');
  const elements = Array.from(root.querySelectorAll('*'));
  if (elements.length > 2048) throw new Error('SVG 元素数量过多。');
  for (const element of [root, ...elements]) {
    if (!tags.has(element.localName) || element.namespaceURI !== svgNamespace)
      throw new Error('SVG 只支持本地形状、路径和渐变。');
    let depth = 0;
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      if (++depth > 24) throw new Error('SVG 分组嵌套过深。');
    for (const attribute of Array.from(element.attributes)) {
      const { name, value } = attribute;
      if (element === root && name === 'xmlns' && value === svgNamespace) continue;
      if (
        !attributes.has(name) ||
        attribute.namespaceURI ||
        (['fill', 'stroke', 'stop-color'].includes(name) &&
          !color.test(value) &&
          !reference.test(value)) ||
        (name === 'clip-path' && value !== 'none' && !reference.test(value))
      )
        throw new Error('SVG 仅支持直接属性和文件内引用。');
    }
  }
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width =
    viewBox?.length === 4 ? viewBox[2]! : Number(root.getAttribute('width')?.replace(/px$/i, ''));
  const height =
    viewBox?.length === 4 ? viewBox[3]! : Number(root.getAttribute('height')?.replace(/px$/i, ''));
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 32768 ||
    height > 32768 ||
    (viewBox && (viewBox.length !== 4 || !viewBox.every(Number.isFinite)))
  )
    throw new Error('SVG 画幅无效或超出范围。');
  if (!viewBox) root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const scale = Math.min(
    4,
    1536 / Math.max(width, height),
    Math.sqrt(1_048_576 / (width * height)),
  );
  root.setAttribute('width', String(Math.max(1, Math.round(width * scale))));
  root.setAttribute('height', String(Math.max(1, Math.round(height * scale))));
  return new XMLSerializer().serializeToString(root);
}

export async function loadSketchImage(file: File) {
  let bitmap: ImageBitmap;
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    if (file.size > 512_000) throw new Error('SVG 超过草图导入的 512KB 限制。');
    const svg = sanitizeSketchSvg(await file.text());
    // SVG is decoded as an isolated image and never inserted into the page.
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      image.src = url;
      await image.decode();
      bitmap = await createImageBitmap(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  } else bitmap = (await decodeImageSourceBitmap(file, 16_777_216, true)).bitmap;
  try {
    const scale = Math.min(1, Math.sqrt(1_048_576 / (bitmap.width * bitmap.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法打开草图素材。');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}
