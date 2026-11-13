import { SaxesParser } from 'saxes';
import sharp from 'sharp';

const svgNs = 'http://www.w3.org/2000/svg';
const xlinkNs = 'http://www.w3.org/1999/xlink';
const svgElements = new Set(
  'svg g defs symbol path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath mask pattern use'.split(' '),
);
const svgAttributes = new Set(
  'id class width height viewBox preserveAspectRatio version x y x1 x2 y1 y2 cx cy r rx ry fx fy fr d points pathLength transform fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linejoin stroke-linecap stroke-miterlimit opacity paint-order vector-effect color stop-color stop-opacity offset gradientUnits gradientTransform spreadMethod clip-path clip-rule clipPathUnits mask maskUnits maskContentUnits patternUnits patternContentUnits patternTransform text-anchor textLength lengthAdjust dominant-baseline alignment-baseline dx dy rotate font-family font-size font-weight font-style letter-spacing word-spacing text-decoration display visibility'.split(' '),
);
const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const localId = /^[A-Za-z_][\w.:-]{0,127}$/;

type SvgNode = {
  name: string;
  attributes: Map<string, string>;
  children: (SvgNode | string)[];
};

function unsafeSvg(): never {
  throw new Error('SVG_CONTENT_UNSUPPORTED');
}

/** Rebuild a bounded, self-contained vector document from parsed XML. */
export function sanitizeOpenAISvg(
  bytes: Uint8Array,
  dimensions: { width: number; height: number },
): Buffer {
  if (bytes.byteLength > 1_000_000) unsafeSvg();
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parser = new SaxesParser({ xmlns: true });
  const stack: SvgNode[] = [];
  const ids = new Map<string, SvgNode>();
  const references = new Map<SvgNode, string[]>();
  let root: SvgNode | undefined;
  let count = 0;
  parser.on('doctype', unsafeSvg);
  parser.on('processinginstruction', unsafeSvg);
  parser.on('opentag', (tag) => {
    if (
      ++count > 2500 || stack.length >= 32 ||
      (tag.uri !== svgNs && tag.uri !== '') || !svgElements.has(tag.local)
    ) unsafeSvg();
    if (!stack.length && (root || tag.local !== 'svg')) unsafeSvg();
    if (stack.length && tag.local === 'svg') unsafeSvg();
    const node: SvgNode = { name: tag.local, attributes: new Map(), children: [] };
    const values = Object.values(tag.attributes);
    if (values.length > 64) unsafeSvg();
    for (const attr of values) {
      if (attr.uri === 'http://www.w3.org/2000/xmlns/') continue;
      if (attr.uri && !(attr.uri === xlinkNs && attr.local === 'href')) unsafeSvg();
      const attribute = attr.local;
      const add = (name: string, value: string) => {
        if (!svgAttributes.has(name) && name !== 'href') unsafeSvg();
        if (value.length > (name === 'd' || name === 'points' ? 160_000 : 1000)) unsafeSvg();
        if (/[\u0000-\u001f\\]/.test(value) || /(?:https?:|javascript:|data:|@import)/i.test(value))
          unsafeSvg();
        if (name === 'href' || /url\s*\(/i.test(value)) {
          const ref = name === 'href' ? /^#(.+)$/.exec(value) : /^url\(#(.+)\)$/.exec(value);
          if (!ref || !localId.test(ref[1]!)) unsafeSvg();
          references.set(node, [...(references.get(node) ?? []), ref[1]!]);
        }
        node.attributes.set(name, value);
      };
      if (attribute === 'style') {
        for (const style of attr.value.split(';').filter((value) => value.trim())) {
          const colon = style.indexOf(':');
          if (colon < 1) unsafeSvg();
          add(style.slice(0, colon).trim(), style.slice(colon + 1).trim());
        }
      } else add(attribute, attr.value);
    }
    const id = node.attributes.get('id');
    if (id) {
      if (!localId.test(id) || ids.has(id)) unsafeSvg();
      ids.set(id, node);
    }
    if (stack.length) stack.at(-1)!.children.push(node);
    else root = node;
    stack.push(node);
  });
  const onText = (value: string) => {
    if (value.trim()) {
      const current = stack.at(-1);
      if (!current || !['text', 'tspan', 'title', 'desc'].includes(current.name)) unsafeSvg();
      current.children.push(value);
    }
  };
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', () => stack.pop());
  parser.write(xml).close();
  if (!root) unsafeSvg();
  const viewBox = root.attributes.get('viewBox');
  if (viewBox) {
    const values = viewBox.trim().split(/[\s,]+/).map(Number);
    if (values.length !== 4 || values.some((n) => !Number.isFinite(n) || Math.abs(n) > 32768) ||
        values[2]! <= 0 || values[3]! <= 0) unsafeSvg();
  } else root.attributes.set('viewBox', '0 0 ' + dimensions.width + ' ' + dimensions.height);
  root.attributes.set('xmlns', svgNs);
  root.attributes.set('width', String(dimensions.width));
  root.attributes.set('height', String(dimensions.height));

  const active = new Set<SvgNode>();
  let complexity = 0;
  function check(node: SvgNode, depth: number) {
    if (++complexity > 8000 || depth > 64 || active.has(node)) unsafeSvg();
    active.add(node);
    for (const id of references.get(node) ?? []) {
      const target = ids.get(id);
      if (!target) unsafeSvg();
      check(target, depth + 1);
    }
    for (const child of node.children) if (typeof child !== 'string') check(child, depth + 1);
    active.delete(node);
  }
  check(root, 0);
  function serialize(node: SvgNode): string {
    const attrs = [...node.attributes].map(([name, value]) => ' ' + name + '="' + escapeXml(value) + '"').join('');
    return '<' + node.name + attrs + '>' + node.children.map((child) =>
      typeof child === 'string' ? escapeXml(child) : serialize(child),
    ).join('') + '</' + node.name + '>';
  }
  return Buffer.from(serialize(root));
}

/** Decode every displayed GIF frame, including disposal, transparency and overlays. */
export async function reviewableGifFrames(
  bytes: Uint8Array,
  limits: { maxPixels: number; maxBytes: number; frames: number },
) {
  const image = sharp(bytes, { animated: true, limitInputPixels: limits.maxPixels, failOn: 'warning' });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? 0;
  const count = meta.pages ?? 0;
  if (meta.format !== 'gif' || !width || !height || count !== limits.frames ||
      width * height * count > limits.maxPixels || bytes.byteLength > limits.maxBytes)
    throw new Error('GIF_FORMAT_OR_BUDGET_INVALID');
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || data.length !== width * height * count * 4)
    throw new Error('GIF_FRAME_LAYOUT_INVALID');
  async function* frames() {
    const stride = width * height * 4;
    for (let index = 0; index < count; index++)
      yield sharp(data.subarray(index * stride, (index + 1) * stride), {
        raw: { width, height, channels: 4 },
      }).png().toBuffer();
  }
  return { width, height, count, delays: meta.delay, frames: frames() };
}

export async function renderSvgForReview(bytes: Uint8Array, maxPixels: number) {
  return sharp(bytes, { limitInputPixels: maxPixels, failOn: 'warning' }).png().toBuffer();
}
