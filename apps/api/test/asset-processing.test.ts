import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import {
  createCutoutTrimap,
  createRasterMask,
  createRecipeV4,
  renderCutout,
  type CutoutSettings,
} from '@ai-xiutu/editor';
import { inferOcrTable, readTesseractWords } from '../src/asset-recognition.js';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
type Fixture = Awaited<ReturnType<typeof collaborationFixture>>;
async function upload(f: Fixture, path: string, bytes: Buffer, name: string, mime: string) {
  const boundary = randomUUID();
  return f.app.inject({
    method: 'POST',
    url: path,
    headers: {
      origin: f.origin,
      cookie: f.actors.owner.cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

test(
  'restoration and guided cutout publish immutable, idempotent sources through the same ACL and lineage transaction',
  { skip: !databaseUrl },
  async () => {
    const f = await collaborationFixture(databaseUrl!);
    try {
      const path = `/v1/projects/${f.projectId}/derived-assets`;
      const body = {
        kind: 'restoration',
        sourceAssetId: f.assetId,
        requestId: randomUUID(),
        name: 'sports-repair.png',
        settings: {
          algorithm: 'photo-restore-v1',
          luminanceNoise: 35,
          chromaNoise: 50,
          motion: { length: 3, angle: 12.5, iterations: 3, strength: 0.65 },
        },
      };
      const quote = await f.call('POST', `${path}/quote`, body);
      assert.equal(quote.statusCode, 200, quote.body);
      assert.equal(quote.json().available, true);
      assert.equal(quote.json().reservesQuota, false);
      assert.equal(
        (await f.call('POST', `${path}/quote`, { ...body, sourceAssetId: f.privateAssetId }))
          .statusCode,
        404,
      );
      assert.equal((await f.call('POST', path, body, 'viewer')).statusCode, 403);
      assert.equal(
        (await f.call('POST', path, { ...body, sourceAssetId: f.privateAssetId })).statusCode,
        404,
      );
      const result = await f.call('POST', path, body);
      assert.equal(result.statusCode, 201, result.body);
      assert.equal((await f.call('POST', path, body)).json().asset.id, result.json().asset.id);
      assert.equal(
        (await f.call('POST', path, { ...body, settings: { ...body.settings, chromaNoise: 51 } }))
          .statusCode,
        409,
      );
      const lineage = (
        await f.call('GET', `/v1/assets/${result.json().asset.id}/derivation`)
      ).json();
      assert.equal(lineage.algorithm, 'photo-restore-v1');
      assert.equal(lineage.sources[0].assetId, f.assetId);
      const settings: CutoutSettings = {
        algorithm: 'guided-v2',
        selection: createRasterMask(3, 1, Uint8Array.of(255, 128, 0)),
        radius: 0.03,
        decontaminate: 0.8,
      };
      const guided = await f.call('POST', path, {
        kind: 'cutout',
        sourceAssetId: f.assetId,
        requestId: randomUUID(),
        name: 'guided.png',
        settings,
      });
      assert.equal(guided.statusCode, 201, guided.body);
      assert.equal(
        (await f.call('GET', `/v1/assets/${guided.json().asset.id}/derivation`)).json().algorithm,
        'rgb-guided-trimap-v2',
      );
      const actual = await f.call('GET', guided.json().asset.url);
      assert.equal(actual.statusCode, 200);
      const source = new Uint8ClampedArray(64 * 48 * 4);
      for (let at = 0; at < source.length; at += 4) source.set([85, 153, 136, 255], at);
      const expected = renderCutout({ width: 64, height: 48, data: source }, settings);
      assert.ok(expected.data.some((value, at) => at % 4 === 3 && value > 0 && value < 255));
      assert.deepEqual(
        await sharp(actual.rawPayload).ensureAlpha().raw().toBuffer(),
        Buffer.from(expected.data),
      );
      const nativeSettings: CutoutSettings = {
        ...settings,
        algorithm: 'guided-v5',
        selection: createCutoutTrimap(
          64,
          48,
          Uint8Array.from({ length: 64 * 48 }, (_, at) =>
            at % 64 < 20 ? 255 : at % 64 < 27 ? 128 : 0,
          ),
        ),
      };
      const nativeRequest = {
        kind: 'cutout',
        sourceAssetId: f.assetId,
        requestId: randomUUID(),
        name: 'native-trimap.png',
        settings: nativeSettings,
      };
      const wrongSize = {
        ...nativeRequest,
        settings: { ...nativeSettings, selection: createCutoutTrimap(1, 1, Uint8Array.of(255)) },
      };
      const nativeQuote = await f.call('POST', `${path}/quote`, wrongSize);
      assert.equal(nativeQuote.statusCode, 200);
      assert.deepEqual(nativeQuote.json().limits, ['CUTOUT_TRIMAP_DIMENSIONS']);
      assert.equal((await f.call('POST', path, wrongSize)).statusCode, 422);
      const native = await f.call('POST', path, nativeRequest);
      assert.equal(native.statusCode, 201, native.body);
      assert.equal(
        (await f.call('GET', `/v1/assets/${native.json().asset.id}/derivation`)).json().algorithm,
        'rgb-guided-trimap-v5',
      );
      const png = await f.call('GET', native.json().asset.url);
      assert.equal(png.statusCode, 200);
      assert.deepEqual(
        await sharp(png.rawPayload).ensureAlpha().raw().toBuffer(),
        Buffer.from(renderCutout({ width: 64, height: 48, data: source }, nativeSettings).data),
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'cutout and collage keep exact permissions, lineage, transparent pixels and request receipts',
  { skip: !databaseUrl },
  async () => {
    const f = await collaborationFixture(databaseUrl!);
    try {
      const path = `/v1/projects/${f.projectId}/derived-assets`;
      const request = {
        kind: 'cutout',
        sourceAssetId: f.assetId,
        requestId: randomUUID(),
        name: 'transparent.png',
        settings: { selection: createRasterMask(2, 1, Uint8Array.from([255, 0])), radius: 0 },
      };
      const denied = await f.call('POST', path, request, 'viewer');
      assert.equal(denied.statusCode, 403);
      assert.equal(
        (await f.call('POST', path, { ...request, sourceAssetId: f.privateAssetId })).statusCode,
        404,
      );
      const result = await f.call('POST', path, request);
      assert.equal(result.statusCode, 201, result.body);
      const cutout = result.json().asset;
      assert.equal(cutout.source, 'derived');
      const listing = await f.call('GET', `/v1/projects/${f.projectId}/assets?source=derived`);
      assert.deepEqual(
        listing.json().assets.map((item: { id: string }) => item.id),
        [cutout.id],
      );
      const found = await f.call('GET', `/v1/resources?projectId=${f.projectId}&source=derived`);
      assert.deepEqual(
        found.json().resources.map((item: { asset: { id: string } }) => item.asset.id),
        [cutout.id],
      );
      assert.equal((await f.call('POST', path, request)).json().asset.id, cutout.id);
      assert.equal(
        (await f.call('POST', path, { ...request, name: 'another.png' })).statusCode,
        409,
      );
      const lineage = await f.call('GET', `/v1/assets/${cutout.id}/derivation`);
      assert.equal(lineage.json().sources[0].assetId, f.assetId);
      assert.equal(
        (await f.call('GET', `/v1/assets/${cutout.id}/derivation`, undefined, 'operator'))
          .statusCode,
        404,
      );
      const rendered = await f.call('GET', cutout.url);
      const { data } = await sharp(rendered.rawPayload)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.deepEqual([...data.subarray(0, 4)], [85, 153, 136, 255]);
      assert.deepEqual([...data.subarray((64 - 1) * 4, 64 * 4)], [0, 0, 0, 0]);
      const collage = await f.call('POST', path, {
        kind: 'collage',
        requestId: randomUUID(),
        name: 'collage.png',
        width: 142,
        height: 54,
        background: [15, 20, 30, 0],
        cells: [
          { assetId: cutout.id, left: 3, top: 3, width: 64, height: 48, fit: 'cover' },
          { assetId: f.assetId, left: 75, top: 3, width: 64, height: 48, fit: 'contain' },
        ],
      });
      assert.equal(collage.statusCode, 201, collage.body);
      const composed = collage.json().asset;
      const raw = await sharp((await f.call('GET', composed.url)).rawPayload)
        .ensureAlpha()
        .raw()
        .toBuffer();
      const alpha = (x: number, y: number) => raw[(y * 142 + x) * 4 + 3];
      assert.deepEqual(
        [alpha(0, 0), alpha(5, 24), alpha(65, 24), alpha(74, 24), alpha(78, 24)],
        [0, 255, 0, 0, 255],
      );
      const work = await f.call('POST', `/v1/projects/${f.projectId}/artworks`, {
        assetId: composed.id,
        title: 'Reusable composite',
        recipe: createRecipeV4(),
      });
      assert.equal(work.statusCode, 201, work.body);
      const { revision } = work.json();
      const png = await f.call(
        'GET',
        `/v1/artworks/${revision.artworkId}/revisions/${revision.id}/render`,
      );
      assert.equal(png.statusCode, 200, png.statusCode === 200 ? undefined : png.body);
      assert.deepEqual(await sharp(png.rawPayload).ensureAlpha().raw().toBuffer(), raw);
    } finally {
      await f.close();
    }
  },
);

test(
  'animated GIF preserves exact input and edits actual frame order, delays, crop and loop',
  { skip: !databaseUrl },
  async () => {
    const f = await collaborationFixture(databaseUrl!);
    try {
      const width = 32,
        height = 24;
      const colors = [
        [230, 15, 20],
        [15, 210, 25],
        [10, 15, 220],
      ];
      const raw = Buffer.alloc(width * height * colors.length * 4);
      colors.forEach((color, index) => {
        for (let px = 0; px < width * height; px++)
          raw.set([...color, px % width === 0 ? 0 : 255], (index * width * height + px) * 4);
      });
      const gif = await sharp(raw, {
        raw: { width, height: height * 3, pageHeight: height, channels: 4 },
      })
        .gif({ delay: [70, 120, 190], loop: 4 })
        .toBuffer();
      const uploaded = await upload(
        f,
        `/v1/projects/${f.projectId}/animations?requestId=${randomUUID()}`,
        gif,
        'three.gif',
        'image/gif',
      );
      assert.equal(uploaded.statusCode, 201, uploaded.body);
      const original = uploaded.json().asset;
      const path = `/v1/assets/${original.id}/animation`;
      assert.deepEqual((await f.call('GET', `${path}/file`)).rawPayload, gif);
      assert.equal((await f.call('GET', `${path}/file`, undefined, 'outsider')).statusCode, 404);
      await f.db.query(
        `UPDATE spaces SET sharing_policy='{"allowCopy":true,"allowReference":true,"maxActiveGrants":20,"maxCopyAssets":20}'::jsonb WHERE id=$1`,
        [f.teamId],
      );
      const copied = await f.call('POST', `/v1/assets/${original.id}/copy`, {
        targetProjectId: f.privateProjectId,
        idempotencyKey: randomUUID(),
      });
      assert.equal(copied.statusCode, 201, copied.body);
      const copyPath = `/v1/assets/${copied.json().asset.id}/animation/file`;
      assert.deepEqual((await f.call('GET', copyPath)).rawPayload, gif);
      assert.equal((await f.call('GET', copyPath, undefined, 'editor')).statusCode, 404);
      const request = {
        requestId: randomUUID(),
        name: 'trim.gif',
        frames: [2, 0, 2],
        delay: [60, 90, 130],
        loop: 0,
        recipe: createRecipeV4({
          geometry: {
            crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
            rotation: 0,
            flipX: false,
            flipY: false,
          },
        }),
      };
      const edited = await f.call('POST', `${path}/edit`, request, 'editor');
      assert.equal(edited.statusCode, 201, edited.body);
      const { asset, animation } = edited.json();
      assert.deepEqual(
        [animation.width, animation.height, animation.frames, animation.delay, animation.loop],
        [16, 12, 3, [60, 90, 130], 0],
      );
      const encoded = (await f.call('GET', `/v1/assets/${asset.id}/animation/file`)).rawPayload;
      const decoded = await sharp(encoded, { animated: true }).ensureAlpha().raw().toBuffer();
      const pixels = 16 * 12 * 4;
      assert.deepEqual(
        [0, 1, 2].map((index) => [...decoded.subarray(index * pixels + 4, index * pixels + 8)]),
        [
          [10, 15, 220, 255],
          [230, 15, 20, 255],
          [10, 15, 220, 255],
        ],
      );
      assert.deepEqual([decoded[3], decoded[pixels + 3], decoded[2 * pixels + 3]], [0, 0, 0]);
      assert.equal(
        (
          await f.call('POST', `${path}/edit`, {
            ...request,
            requestId: randomUUID(),
            frames: [9, 0],
            delay: undefined,
          })
        ).statusCode,
        422,
      );
      assert.deepEqual((await f.call('GET', `${path}/file`)).rawPayload, gif);
    } finally {
      await f.close();
    }
  },
);

test('OCR parses bounded geometry and infers only consistent table columns', () => {
  const line = (text: string, x: number, y: number, w = 30) =>
    `5\t1\t1\t1\t1\t1\t${x}\t${y}\t${w}\t18\t90\t${text}`;
  const words = readTesseractWords(
    [
      line('Name', 20, 10),
      line('Price', 150, 10),
      line('Apple', 20, 38),
      line('20', 150, 38),
      line('Invalid', 190, 18),
    ].join('\n'),
    200,
    80,
  );
  assert.equal(words.length, 4);
  assert.deepEqual(inferOcrTable(words), {
    columns: 2,
    rows: [
      ['Name', 'Price'],
      ['Apple', '20'],
    ],
  });
  assert.equal(inferOcrTable(words.slice(0, 3)), null);
});

test(
  'native OCR recognizes, indexes and deletes an authorized two-column image',
  { skip: !databaseUrl || process.env.REQUIRE_NATIVE_OCR !== '1' },
  async () => {
    const f = await collaborationFixture(databaseUrl!);
    try {
      const letters = ['PRODUCT', 'PRICE', 'APRICOT', '24', 'ORANGE', '36'];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="340"><rect width="760" height="340" fill="white"/>
      ${letters.map((value, index) => `<text font-family="DejaVu Sans" font-size="44" x="${index % 2 ? 450 : 52}" y="${85 + 100 * Math.floor(index / 2)}">${value}</text>`).join('')}</svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      const imported = await upload(
        f,
        `/v1/projects/${f.projectId}/assets`,
        png,
        'letter-grid.png',
        'image/png',
      );
      assert.equal(imported.statusCode, 201, imported.body);
      const assetId = imported.json().asset.id;
      const path = `/v1/assets/${assetId}/recognitions`;
      const recognized = await f.call('POST', path, { language: 'eng', layout: 'table' });
      assert.equal(recognized.statusCode, 201, recognized.body);
      const { recognition } = recognized.json();
      assert.deepEqual(recognition.table.rows, [
        ['PRODUCT', 'PRICE'],
        ['APRICOT', '24'],
        ['ORANGE', '36'],
      ]);
      assert.equal(
        (await f.call('POST', path, { language: 'eng', layout: 'table' })).json().reused,
        true,
      );
      const search = `/v1/projects/${f.projectId}/assets?query=APRICOT`;
      assert.equal((await f.call('GET', search, undefined, 'viewer')).json().assets[0].id, assetId);
      assert.equal((await f.call('GET', path, undefined, 'outsider')).statusCode, 404);
      assert.equal(
        (await f.call('DELETE', `${path}/${recognition.id}`, undefined, 'editor')).statusCode,
        200,
      );
      assert.deepEqual((await f.call('GET', search)).json().assets, []);
      const chinese = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="240">
      <rect width="760" height="240" fill="white"/><text font-family="Noto Sans CJK SC" font-size="70" x="60" y="130">春天花园</text></svg>`);
      const importedChinese = await upload(
        f,
        `/v1/projects/${f.projectId}/assets`,
        await sharp(chinese).png().toBuffer(),
        'chinese-text.png',
        'image/png',
      );
      assert.equal(importedChinese.statusCode, 201, importedChinese.body);
      const result = await f.call(
        'POST',
        `/v1/assets/${importedChinese.json().asset.id}/recognitions`,
        { language: 'chi_sim', layout: 'block' },
      );
      assert.equal(result.statusCode, 201, result.body);
      const recovered = result.json().recognition;
      assert.equal(recovered.text, '春天花园');
      assert.equal(recovered.preprocessing, 'contrast-resampled');
      assert.equal(
        (
          await f.call(
            'GET',
            `/v1/projects/${f.projectId}/assets?query=${encodeURIComponent('春天花园')}`,
          )
        ).json().assets[0].id,
        importedChinese.json().asset.id,
      );
    } finally {
      await f.close();
    }
  },
);
