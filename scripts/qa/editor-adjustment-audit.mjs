import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  createRecipeV4,
  parseRecipeV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
} from '@ai-xiutu/editor';
import {
  NUMERIC_CONTROLS,
  numericAt,
  withNumeric,
} from '../../apps/web/src/editor/advanced-model.ts';

const path = resolve(process.env.ADJUSTMENT_QA_DIR ?? 'artifacts/editor-adjustment-audit');
const { inputs } = JSON.parse(await readFile('scripts/qa/portrait-real-world-inputs.json', 'utf8'));
const photos = await Promise.all(
  ['smile-headshot', 'group-distance', 'smile-fringe', 'group-street', 'group-crew'].map(
    async (name) => {
      const input = inputs.find((p) => p.name === name);
      const bytes = await readFile(
        join(
          input.vendored ? 'scripts/qa/fixtures/portrait' : 'artifacts/portrait-real-world-inputs',
          name + '.jpg',
        ),
      );
      assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256);
      const { info, data } = await sharp(bytes)
        .autoOrient()
        .resize(430, 430, { fit: 'inside', withoutEnlargement: true })
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { name, width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
    },
  ),
);
const controls = new Map(NUMERIC_CONTROLS.map((def) => [def.path, def]));
const change = (recipe, key, value) => withNumeric(recipe, controls.get(key), value);
const support = (key) => {
  let recipe = createRecipeV4();
  if (key.startsWith('effects.vignette.') && !key.endsWith('.amount'))
    recipe = change(recipe, 'effects.vignette.amount', 37);
  if (key.startsWith('effects.grain.') && !key.endsWith('.amount'))
    recipe = change(recipe, 'effects.grain.amount', 34);
  if (key.startsWith('grading.') && (key.endsWith('.hue') || key.endsWith('.balance')))
    recipe = change(
      recipe,
      'grading.' +
        (key.split('.')[1] === 'balance' ? 'shadows' : key.split('.')[1]) +
        '.saturation',
      36,
    );
  if (key.startsWith('optics.aberrationCenter'))
    recipe = change(recipe, 'optics.aberrationRed', 12);
  if (key.startsWith('transform.translate')) recipe.transform.fit = 'crop';
  return recipe;
};
const differs = (a, b) =>
  a.width !== b.width ||
  a.height !== b.height ||
  Buffer.compare(
    Buffer.from(a.data.buffer, a.data.byteOffset, a.data.byteLength),
    Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength),
  ) !== 0;
const results = [];
for (const definition of NUMERIC_CONTROLS) {
  const { path: key, neutral, min, max, step } = definition;
  assert.equal(numericAt(createRecipeV4(), key), neutral, key + ' neutral registration');
  const base = support(key);
  const baseline = photos.map((photo) => renderEditorRecipe(photo, base));
  const values = [min, max]
    .filter((limit) => limit !== neutral)
    .map((limit) => neutral + (limit - neutral) * (key.startsWith('transform.') ? 0.14 : 0.44))
    .map((candidate) =>
      key.endsWith('.seed')
        ? 71
        : Math.max(min, Math.min(max, Math.round(candidate / step) * step)),
    );
  const settings = [];
  for (const value of values) {
    const recipe = parseRecipeV4(withNumeric(base, definition, value));
    const index = photos.findIndex((photo, i) =>
      differs(baseline[i], renderEditorRecipe(photo, recipe)),
    );
    if (index >= 0) {
      const reference = renderEditorRecipe(photos[index], recipe);
      const tiled = renderEditorRecipeTiled(photos[index], recipe, { tileSize: 127 });
      assert.ok(!differs(reference, tiled), key + ' tiled export must match');
    }
    settings.push({ value, photo: index >= 0 ? photos[index].name : null });
  }
  results.push({ path: key, label: definition.label, neutral, settings });
}
await mkdir(path, { recursive: true });
await writeFile(join(path, 'report.json'), JSON.stringify({ results }, null, 2) + '\n');
const unobserved = results.flatMap((item) =>
  item.settings.filter(({ photo }) => !photo).map(({ value }) => [item.path, value]),
);
console.log(
  JSON.stringify({
    controls: results.length,
    directions: results.flatMap(({ settings }) => settings).length,
    unobserved,
  }),
);
assert.deepEqual(
  unobserved,
  [],
  'Each tested direction needs a real change on at least one suitable photo',
);
