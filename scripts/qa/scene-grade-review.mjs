import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  createRecipeV4,
  measureSceneTone,
  renderEditorRecipe,
  renderEditorRecipeTiled,
} from '@ai-xiutu/editor';
import { applyAssistantProposal } from '@ai-xiutu/assistant';
import { sceneBalance } from '../../packages/assistant/src/scene.ts';

const kodak = (name, id, sha256) => ({
  name,
  file: `${name}.png`,
  reference: `https://r0k.us/graphics/kodak/kodim${id}.html`,
  url: `https://r0k.us/graphics/kodak/kodak/kodim${id}.png`,
  sha256,
});
const inputs = [
  kodak('forest-stream', '13', 'bc34a3ce58dea09dce1704c997171602de90cb34d0c8503a988b77f473d39b08'),
  kodak('sailboat', '06', '363510303b715d4cbc384e1ce227e466b613a09e1b71ae985882bf8e7fbd9b18'),
  kodak('lighthouse', '19', 'b7450b264b1b0a411390d8931b112c27905a992520fc90569dc4b920aa32bbdc'),
  kodak('flowers', '07', 'b77d3f006f42414bb242222e0482e750c0fb9e5ee8d4bed2f6f11c5605fe54a4'),
  {
    name: 'night-florida',
    file: 'night-florida.jpg',
    reference: 'https://images.nasa.gov/details/iss040e063570',
    url: 'https://images-assets.nasa.gov/image/iss040e063570/iss040e063570~medium.jpg',
    sha256: 'aaeb9d8acdecf84e3632ca46f2cbdbe6c5968ebc61c0ca6ba5ef51a0b62737e7',
  },
];
const output = resolve(process.env.SCENE_GRADE_OUTPUT ?? 'artifacts/scene-grade-review');
await mkdir(output, { recursive: true });
const report = [];
const strategies = ['balanced', 'open-shadows', 'retain-highlights', 'preserve-night'];
const width = 315,
  height = 225;
const raw = (image) =>
  sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } });
for (const input of inputs) {
  const bytes = process.env.SCENE_GRADE_INPUT_DIR
    ? await readFile(join(process.env.SCENE_GRADE_INPUT_DIR, input.file))
    : await fetch(input.url, { signal: AbortSignal.timeout(30000) }).then(async (response) => {
        if (!response.ok) throw new Error(`${input.name}: ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      });
  assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256);
  const decoded = await sharp(bytes)
    .autoOrient()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = {
    width: decoded.info.width,
    height: decoded.info.height,
    data: new Uint8ClampedArray(decoded.data),
  };
  const before = measureSceneTone(image),
    base = createRecipeV4();
  const trials = [],
    panels = [{ title: 'Source', image }];
  for (const strategy of strategies)
    for (const strength of [0, 0.05, 0.5, 1]) {
      const plan = sceneBalance(base, { before }, { strategy, strength });
      const recipe = plan.changes.length
        ? applyAssistantProposal(base, {
            summary: strategy,
            target: 'global',
            targetId: null,
            changes: plan.changes,
          }).recipe
        : base;
      if (strategy === 'preserve-night') assert.equal(recipe.adjustments.exposure, 0);
      const edited = renderEditorRecipe(image, recipe);
      assert.deepEqual(renderEditorRecipeTiled(image, recipe, { tileSize: 77 }), edited);
      if (strength === 0) assert.deepEqual(edited, image);
      const after = measureSceneTone(edited);
      let changed = 0;
      for (let at = 0; at < edited.data.length; at += 4) {
        assert.equal(edited.data[at + 3], image.data[at + 3]);
        changed += Number(
          edited.data[at] !== image.data[at] ||
            edited.data[at + 1] !== image.data[at + 1] ||
            edited.data[at + 2] !== image.data[at + 2],
        );
      }
      trials.push({ strategy, strength, changes: plan.changes, after, changed, tiledExact: true });
      if (strength === 1) panels.push({ title: strategy, image: edited });
    }
  const cells = [];
  for (const [index, panel] of panels.entries()) {
    cells.push({
      left: index * width,
      top: 20,
      input: await raw(panel.image)
        .resize(width, height - 20, { fit: 'contain', background: '#202020' })
        .png()
        .toBuffer(),
    });
    cells.push({
      left: index * width,
      top: 0,
      input: Buffer.from(
        `<svg width="${width}" height="20"><text x="8" y="15" fill="white" font-size="14">${panel.title}</text></svg>`,
      ),
    });
  }
  const comparison = `${input.name}.png`;
  await sharp({
    create: { width: (width * cells.length) / 2, height, channels: 4, background: '#202020' },
  })
    .composite(cells)
    .png()
    .toFile(join(output, comparison));
  report.push({ input, before, trials, comparison });
  console.log(
    JSON.stringify({
      scene: input.name,
      variants: trials.length,
      changed: trials.filter((item) => item.changed).length,
      before: before.tone,
    }),
  );
}
await writeFile(
  join(output, 'report.json'),
  JSON.stringify({ cases: report, paidCalls: 0 }, null, 2) + '\n',
);
