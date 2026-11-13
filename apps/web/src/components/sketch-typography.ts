const cjkSerif = '"Noto Serif CJK SC", "Songti SC", SimSun, serif';

export const sketchFonts = {
  sans: { label: '无衬线', family: 'system-ui, sans-serif' },
  serif: { label: '衬线', family: 'Georgia, "Noto Serif CJK SC", serif' },
  mono: { label: '等宽', family: 'Consolas, monospace' },
  'wenkai': { label: '霞鹜文楷', face: 'LXGW WenKai TC', family: '"LXGW WenKai TC", ' + cjkSerif, preview: '"LXGW WenKai TC Preview", ' + cjkSerif },
  'xiaowei': { label: '站酷小薇', face: 'ZCOOL XiaoWei', family: '"ZCOOL XiaoWei", ' + cjkSerif, preview: '"ZCOOL XiaoWei Preview", ' + cjkSerif },
  'mashan': { label: '马善政', face: 'Ma Shan Zheng', family: '"Ma Shan Zheng", ' + cjkSerif, preview: '"Ma Shan Zheng Preview", ' + cjkSerif },
  'kuaile': { label: '站酷快乐体', face: 'ZCOOL KuaiLe', family: '"ZCOOL KuaiLe", ' + cjkSerif, preview: '"ZCOOL KuaiLe Preview", ' + cjkSerif },
  'inter': { label: 'Inter', face: 'Inter', family: '"Inter", ' + 'system-ui, sans-serif', weights: [100, 900] },
  'bricolage': { label: 'Bricolage Grotesque', face: 'Bricolage Grotesque', family: '"Bricolage Grotesque", ' + 'system-ui, sans-serif', weights: [200, 800] },
  'work-sans': { label: 'Work Sans', face: 'Work Sans', family: '"Work Sans", ' + 'system-ui, sans-serif', weights: [100, 900] },
  'archivo-black': { label: 'Archivo Black', face: 'Archivo Black', family: '"Archivo Black", ' + 'system-ui, sans-serif' },
  'instrument': { label: 'Instrument Serif', face: 'Instrument Serif', family: '"Instrument Serif", ' + cjkSerif },
  'playfair': { label: 'Playfair Display', face: 'Playfair Display', family: '"Playfair Display", ' + cjkSerif, weights: [400, 900] },
  'dm-serif': { label: 'DM Serif Text', face: 'DM Serif Text', family: '"DM Serif Text", ' + cjkSerif },
  'plex-mono': { label: 'IBM Plex Mono', face: 'IBM Plex Mono', family: '"IBM Plex Mono", ' + 'monospace' },
} as const satisfies Record<string, {
  label: string;
  face?: string;
  family: string;
  preview?: string;
  weights?: readonly [number, number];
}>;

export type SketchFont = keyof typeof sketchFonts;
export const sketchFontIds = Object.keys(sketchFonts) as SketchFont[];
export const sketchFamily = (font: SketchFont) => sketchFonts[font].family;
export const sketchFontWeight = (font: SketchFont, weight: number) => {
  const face = sketchFonts[font];
  if (!('weights' in face)) return weight >= 650 ? 700 : 400;
  return Math.max(face.weights[0], Math.min(face.weights[1], weight));
};
export const sketchFontCss = (font: SketchFont, size: number, weight: number, italic: boolean) =>
  `${italic ? 'italic' : 'normal'} ${weight} ${size}px ${sketchFamily(font)}`;

export async function loadSketchFont(font: SketchFont, size: number, weight: number, italic: boolean, text: string) {
  if (!('face' in sketchFonts[font]) || !text.trim()) return;
  await document.fonts.load(sketchFontCss(font, size, weight, italic), text);
}
