/** Native PostgreSQL and Linux media worker. Inputs are supplied explicitly. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp, { type Sharp } from 'sharp';
import {
  compileSelectionMaskV3,
  NEUTRAL_PRECISION_EDIT,
  type PrecisionEdit,
  type PrecisionEditV2,
} from '@ai-xiutu/editor';
import { editMaster16 } from '../../packages/media/src/precision.js';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.js';

const database = process.env.TEST_DATABASE_URL;
const python = process.env.MEDIA_QA_PYTHON;
const files = process.argv.slice(2);
if (!database || !new URL(database).pathname.includes('test') || !python || !files.length)
  throw new Error(
    'Supply a disposable TEST_DATABASE_URL, MEDIA_QA_PYTHON and real source file paths',
  );
process.env.NODE_ENV = 'test';
process.env.MEDIA_ADVANCED_ENABLED = 'true';
process.env.MEDIA_PYTHON = python;
const output = resolve(process.env.MEDIA_QA_OUTPUT ?? 'artifacts/master-pipeline');
await mkdir(output, { recursive: true });
const browserOrigin = process.env.MEDIA_QA_BROWSER_ORIGIN;
const withTiles = process.env.MEDIA_QA_TILES === '1';
const f = await collaborationFixture(database, { origin: browserOrigin });
const execute = promisify(execFile);
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const raw16 = (pipeline: Sharp) =>
  pipeline.toColourspace('rgb16').ensureAlpha().raw({ depth: 'ushort' }).toBuffer();
const report = [];

try {
  const port = browserOrigin ? Number(process.env.MEDIA_QA_PORT) : 0;
  if (browserOrigin) assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  await f.app.listen({ host: browserOrigin ? '0.0.0.0' : '127.0.0.1', port });
  const address = f.app.server.address();
  assert.ok(address && typeof address === 'object');
  const httpOrigin = `http://127.0.0.1:${address.port}`;
  const post = (path: string, payload: unknown) =>
    fetch(httpOrigin + path, {
      method: 'POST',
      headers: {
        origin: f.origin,
        cookie: f.actors.owner.cookie,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify(payload),
    });
  if (process.env.MEDIA_QA_STORAGE_BYTES) {
    const maxBytes = Number(process.env.MEDIA_QA_STORAGE_BYTES);
    assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0);
    // The two original RAWs, masters and pyramids share this disposable space.
    await f.db.query('UPDATE space_storage_accounts SET max_bytes=$2 WHERE space_id=$1', [
      f.teamId,
      maxBytes,
    ]);
  }
  for (const [index, file] of files.entries()) {
    const bytes = await readFile(file);
    const created = await f.call('POST', '/v1/projects/' + f.projectId + '/media-imports', {
      name: basename(file),
      size: bytes.length,
      idempotencyKey: crypto.randomUUID(),
      generateTiles: withTiles,
    });
    assert.equal(created.statusCode, 201, created.body);
    const task = '/v1/media-imports/' + created.json().job.id;
    for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024) {
      const response = await f.app.inject({
        method: 'PUT',
        url: task + '/chunk?offset=' + offset,
        payload: bytes.subarray(offset, offset + 4 * 1024 * 1024),
        headers: {
          origin: f.origin,
          cookie: f.actors.owner.cookie,
          'content-type': 'application/octet-stream',
        },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    const start = performance.now();
    assert.equal((await f.call('POST', task + '/complete')).statusCode, 202);
    let state;
    do {
      await delay(100);
      state = (await f.call('GET', task)).json();
    } while (state.job.state === 'processing' && performance.now() - start < 180_000);
    assert.equal(state.job.state, 'ready', JSON.stringify(state.job));
    const path = '/v1/assets/' + state.asset.id + '/media';
    const metadata = (await f.call('GET', path)).json();
    const descriptor = metadata.descriptor;
    const { width, height } = descriptor.master;
    assert.equal(descriptor.master.bitDepth, 16);
    if (descriptor.linearMaster) assert.equal(descriptor.linearMaster.bitDepth, 32);
    assert.equal(descriptor.sourceSha256, sha(bytes));
    const original = await f.call('GET', metadata.downloads.original);
    assert.equal(sha(original.rawPayload), sha(bytes));
    if (descriptor.original.pq) {
      const capabilities = (await f.call('GET', '/v1/media-capabilities')).json();
      assert.equal(capabilities.heicPq.available, true);
      assert.ok(capabilities.heicPq.bitDepths.includes(descriptor.original.bitDepth));
      assert.equal(descriptor.original.sampleEncoding, 'pq');
      assert.equal(descriptor.original.mime, 'image/heic');
      assert.equal(original.headers['content-type'], 'application/octet-stream');
      assert.match(original.headers['content-disposition'] as string, /^attachment;/);
      assert.ok(descriptor.linearMaster);
    }
    const result = {
      name: basename(file),
      sourceSha256: sha(bytes),
      width,
      height,
      importMs: Math.round(performance.now() - start),
      assetId: state.asset.id,
      sourceEncoding: descriptor.original.sampleEncoding,
      gainMap: descriptor.original.gainMap,
      pq: descriptor.original.pq,
      linear: !!descriptor.linearMaster,
      peakRssBytes: descriptor.processor.peakRssBytes,
      nativePeakRssBytes: descriptor.processor.nativePeakRssBytes,
    };
    const precisionInput = descriptor.linearMaster ? 'linear-master' : 'master16';
    const baseEdit = {
      ...NEUTRAL_PRECISION_EDIT,
      exposure: -0.65,
      temperature: 8,
      shadows: 12,
      highlights: -18,
    };
    const region = {
      left: Math.floor(width * 0.31),
      top: Math.floor(height * 0.43),
      width: Math.min(420, Math.floor(width * 0.55)),
      height: Math.min(300, Math.floor(height * 0.4)),
    };
    let tileComparison;
    if (withTiles) {
      const tiles = descriptor.tiles;
      assert.ok(tiles && metadata.downloads.tiles);
      const dz = await f.call('GET', metadata.downloads.tiles);
      assert.equal(dz.statusCode, 200);
      assert.ok(dz.body.includes(`Width="${width}"`) && dz.body.includes(`Height="${height}"`));
      const level = tiles.levels - 1;
      const x = Math.floor((width * 0.4) / tiles.tileSize),
        y = Math.floor((height * 0.4) / tiles.tileSize);
      const sizes = [];
      for (const column of [x, x + 1]) {
        const response = await f.call('GET', `${path}/tiles_files/${level}/${column}_${y}.jpeg`);
        assert.equal(response.statusCode, 200);
        const image = await sharp(response.rawPayload).metadata();
        const expectedEdge = tiles.tileSize + 2 * tiles.overlap;
        assert.deepEqual(
          [image.width, image.height, image.format],
          [expectedEdge, expectedEdge, 'jpeg'],
        );
        sizes.push([image.width, image.height]);
      }
      const boundaryX = (x + 1) * tiles.tileSize;
      region.left = boundaryX - Math.floor(region.width / 2);
      tileComparison = { level, boundaryX, sizes, overlapPixels: 0, tiles: tiles.count };
    }
    const withRegions = process.env.MEDIA_QA_REGIONS === '1';
    const withCurves = withRegions || process.env.MEDIA_QA_CURVES === '1';
    if (withCurves) assert.equal(metadata.editor.precisionEditing.curves.available, true);
    if (withRegions) assert.equal(metadata.editor.precisionEditing.regions.available, true);
    const curveEdit: PrecisionEditV2 = {
      ...baseEdit,
      algorithm: 'scene-linear-v2',
      curves: {
        luminance: [
          [-16, -16],
          [-2, -1.7],
          [2, 1.8],
          [16, 16],
        ],
        red: [
          [-16, -16],
          [0, 0.3],
          [16, 16],
        ],
      },
    };
    const precisionEdit: PrecisionEdit = withRegions
      ? {
          ...curveEdit,
          algorithm: 'scene-linear-v3',
          regions: [
            {
              id: 'radial',
              enabled: true,
              opacity: 0.72,
              mask: {
                type: 'radial',
                shape: 'ellipse',
                rotationDegrees: 37,
                feather: 0.35,
                invert: false,
                centerX: (region.left + region.width * 0.56) / width,
                centerY: (region.top + region.height * 0.54) / height,
                radiusX: (region.width * 0.35) / width,
                radiusY: (region.height * 0.36) / height,
              },
              adjustments: { exposure: 0.55, temperature: 8, shadows: 16 },
            },
            {
              id: 'linear',
              enabled: true,
              opacity: 0.66,
              mask: {
                type: 'linear',
                smooth: true,
                invert: false,
                start: {
                  x: (region.left + region.width * 0.49) / width,
                  y: (region.top + region.height * 0.47) / height,
                },
                end: {
                  x: (region.left + region.width * 0.94) / width,
                  y: (region.top + region.height * 0.77) / height,
                },
              },
              adjustments: { exposure: -0.35, saturation: -18, contrast: 10 },
            },
          ],
        }
      : withCurves
        ? curveEdit
        : baseEdit;
    const grade = {
      expectedSourceSha256: descriptor.sourceSha256,
      precisionInput,
      precisionEdit,
    };
    const previewStarted = performance.now();
    const preview = await f.call('POST', path + '/preview', { ...grade, maxEdge: 512, region });
    assert.equal(preview.statusCode, 200, preview.body.slice(0, 200));
    const cropped = await raw16(sharp(preview.rawPayload, { ignoreIcc: true }));
    const previewMs = Math.round(performance.now() - previewStarted);
    if (tileComparison) {
      const shift = Math.floor(region.width / 3);
      const adjacent = await f.call('POST', path + '/preview', {
        ...grade,
        maxEdge: 512,
        region: { ...region, left: region.left + shift },
      });
      assert.equal(adjacent.statusCode, 200, adjacent.body.slice(0, 200));
      const shifted = await raw16(sharp(adjacent.rawPayload, { ignoreIcc: true }));
      const rowBytes = region.width * 8;
      const overlapBytes = (region.width - shift) * 8;
      for (let y = 0; y < region.height; y++) {
        const start = y * rowBytes;
        assert.deepEqual(
          cropped.subarray(start + shift * 8, start + rowBytes),
          shifted.subarray(start, start + overlapBytes),
        );
      }
      tileComparison.overlapPixels = (region.width - shift) * region.height;
    }
    let localComparison;
    if (precisionEdit.algorithm === 'scene-linear-v3') {
      const baseline = await f.call('POST', path + '/preview', {
        ...grade,
        precisionEdit: curveEdit,
        maxEdge: 512,
        region,
      });
      assert.equal(baseline.statusCode, 200, baseline.body.slice(0, 200));
      const reference = await raw16(sharp(baseline.rawPayload, { ignoreIcc: true }));
      const masks = precisionEdit.regions.map(({ mask }) =>
        compileSelectionMaskV3(mask, { width, height }),
      );
      let outsidePixels = 0,
        changedPixels = 0;
      for (let y = 0; y < region.height; y++) {
        for (let x = 0; x < region.width; x++) {
          const at = (y * region.width + x) * 8;
          const equal = cropped.subarray(at, at + 8).equals(reference.subarray(at, at + 8));
          const u = (region.left + x + 0.5) / width,
            v = (region.top + y + 0.5) / height;
          if (masks.every((sample) => sample(u, v) === 0)) {
            assert.ok(equal, 'Pixels outside the authored masks must be unchanged');
            outsidePixels++;
          } else if (!equal) changedPixels++;
        }
      }
      assert.ok(outsidePixels > 500 && changedPixels > 500);
      localComparison = { outsidePixels, changedPixels };
      await writeFile(
        join(output, String(index) + '-native-window-before-regions.png'),
        baseline.rawPayload,
      );
    }
    const warmWindowMs: number[] = [];
    if (process.env.MEDIA_QA_WARM_WINDOWS === '1' && precisionInput === 'linear-master') {
      const seen = new Set();
      for (let step = 1; step <= 12; step++) {
        const startWindow = performance.now();
        const window = await f.call('POST', path + '/preview', {
          ...grade,
          precisionEdit:
            precisionEdit.algorithm === 'scene-linear-v3'
              ? {
                  ...precisionEdit,
                  regions: precisionEdit.regions.map((item, index) =>
                    index === 0
                      ? {
                          ...item,
                          adjustments: { ...item.adjustments, exposure: 0.55 + step / 20 },
                        }
                      : item,
                  ),
                }
              : { ...precisionEdit, exposure: precisionEdit.exposure + step / 20 },
          maxEdge: 512,
          region,
        });
        warmWindowMs.push(Math.round(performance.now() - startWindow));
        assert.equal(window.statusCode, 200, window.body.slice(0, 200));
        const metadata = await sharp(window.rawPayload).metadata();
        assert.deepEqual(
          [metadata.width, metadata.height, metadata.depth],
          [region.width, region.height, 'ushort'],
        );
        assert.ok(metadata.icc);
        seen.add(sha(window.rawPayload));
      }
      assert.ok(seen.size >= 10, 'exposure changes the native window samples');
    }
    const record = {
      ...result,
      algorithm: precisionEdit.algorithm,
      ...(warmWindowMs.length ? { warmWindowMs } : {}),
      ...(tileComparison ? { tileComparison } : {}),
      ...(precisionEdit.algorithm !== 'scene-linear-v1' ? { curves: precisionEdit.curves } : {}),
      ...(precisionEdit.algorithm === 'scene-linear-v3'
        ? { regions: precisionEdit.regions, localComparison }
        : {}),
      previewMs,
      nativeRegion: region,
      previewSha256: sha(cropped),
      files: [] as { format: string; bytes: number; bitDepth: number; ms: number }[],
      verifiedSamples: 0,
      linearReadback: null as unknown,
      windowStress: undefined as unknown,
      gainMapRoundTrip: undefined as unknown,
    };
    const precision = metadata.editor.precisionEditing;
    if (
      width * height <=
      (precisionInput === 'linear-master' ? precision.maxLinearPixels : precision.maxPixels)
    ) {
      if (withCurves) {
        const invalid = { ...grade, precisionInput: 'master16' };
        assert.equal(
          (await f.call('POST', path + '/preview', { ...invalid, maxEdge: 512, region }))
            .statusCode,
          422,
        );
        assert.equal(
          (await f.call('POST', path + '/grades', { ...invalid, expectedVersion: 0 })).statusCode,
          422,
        );
      }
      assert.equal(
        (
          await f.call('POST', path + '/grades', {
            ...grade,
            precisionEdit: baseEdit,
            expectedVersion: 0,
          })
        ).statusCode,
        201,
      );
      const changed = await f.call('POST', path + '/grades', {
        ...grade,
        expectedVersion: 1,
        precisionEdit: withCurves ? precisionEdit : { ...baseEdit, exposure: 0.2 },
      });
      assert.equal(changed.statusCode, 201);
      const history = (await f.call('GET', path + '/grades')).json().grades;
      assert.deepEqual(
        history.map(({ version }: { version: number }) => version),
        [2, 1],
      );
      const reopened = (await f.call('GET', path)).json().editor.precisionEditing.currentGrade;
      assert.equal(reopened.version, 2);
      assert.equal(reopened.sourceSha256, descriptor.sourceSha256);
      if (withCurves) {
        assert.deepEqual(reopened.edit, precisionEdit);
        assert.equal(history[1].edit.algorithm, 'scene-linear-v1');
      }
      const formats = ['png16', 'tiff16', ...(descriptor.linearMaster ? ['exr32'] : [])];
      if (precision.ultraHdrJpeg) formats.push('ultrahdr');
      for (const format of formats) {
        const target = join(
          output,
          String(index) +
            '-developed.' +
            (format === 'tiff16' ? 'tif' : format === 'exr32' ? 'exr' : format === 'ultrahdr' ? 'jpg' : 'png'),
        );
        let converting = true;
        const transfer = async () => {
          const started = performance.now();
          const response = await post(path + '/export', {
            format,
            gradeVersion: withCurves ? 2 : 1,
            expectedSourceSha256: descriptor.sourceSha256,
          });
          converting = false;
          assert.equal(
            response.status,
            200,
            response.ok ? undefined : `${format}: ${(await response.text()).slice(0, 250)}`,
          );
          assert.equal(
            response.headers.get('x-precision-edit-sha256'),
            preview.headers['x-precision-edit-sha256'],
          );
          assert.ok(response.body);
          await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
          const { size } = await stat(target);
          assert.equal(size, Number(response.headers.get('content-length')));
          return { size, ms: Math.round(performance.now() - started) };
        };
        const stress =
          process.env.MEDIA_QA_WINDOW_STRESS === '1' &&
          index === files.length - 1 &&
          format === 'png16' &&
          precisionInput === 'linear-master' &&
          withCurves;
        const exerciseWindow = async () => {
          if (!stress) return undefined;
          const started = performance.now();
          const samples = new Set<string>();
          const times = [];
          let whileConverting = 0;
          await delay(200);
          for (let step = 0; step < 240; step++) {
            const start = performance.now();
            const result = await post(path + '/preview', {
              ...grade,
              precisionEdit: { ...precisionEdit, exposure: precisionEdit.exposure + step / 100 },
              maxEdge: 512,
              region,
            });
            assert.equal(result.status, 200, result.ok ? undefined : await result.text());
            const bytes = Buffer.from(await result.arrayBuffer());
            if (converting) whileConverting++;
            const elapsed = performance.now() - start;
            times.push(elapsed);
            samples.add(sha(bytes));
            if (step % 30 === 0) {
              const info = await sharp(bytes).metadata();
              assert.deepEqual(
                [info.width, info.height, info.depth], [region.width, region.height, 'ushort'],
              );
            }
            if (elapsed < 80) await delay(80 - elapsed);
          }
          assert.ok(samples.size >= 200 && whileConverting >= 20);
          const stale = await post(path + '/grades', { ...grade, expectedVersion: 0 });
          assert.equal(stale.status, 409);
          const rejected = (await stale.json()) as { error: { code: string } };
          assert.equal(rejected.error.code, 'VERSION_CONFLICT');
          times.sort((a, b) => a - b);
          return {
            windows: times.length,
            distinct: samples.size,
            whileConverting,
            elapsedMs: Math.round(performance.now() - started),
            p50Ms: Math.round(times[Math.ceil(times.length * 0.5) - 1]!),
            p95Ms: Math.round(times[Math.ceil(times.length * 0.95) - 1]!),
            maxMs: Math.round(times.at(-1)!),
          };
        };
        const [{ size: exportBytes, ms: exportMs }, windowStress] = await Promise.all([
          transfer(),
          exerciseWindow(),
        ]);
        if (format === 'exr32') {
          const native = await execute(python, [
            '-c',
            [
              'import json,sys,OpenImageIO as o,numpy as n',
              'i=o.ImageInput.open(sys.argv[1]); s=i.spec(); low=float("inf"); high=float("-inf")',
              'for y in range(s.y,s.y+s.height,64):',
              '    p=i.read_scanlines(y,min(y+64,s.y+s.height),s.z,0,3,o.FLOAT)',
              '    low=min(low,float(p.min())); high=max(high,float(p.max()))',
              'i.close()',
              'print(json.dumps({"size":[s.width,s.height],"type":str(s.format),"range":[low,high],"channels":list(s.channelnames),"window":[s.x,s.y,s.full_x,s.full_y,s.full_width,s.full_height]}))',
            ].join('\n'),
            target,
          ]);
          const linear = JSON.parse(native.stdout);
          assert.deepEqual(linear.size, [width, height]);
          assert.equal(linear.type, 'float');
          record.linearReadback = linear;
        } else if (format === 'ultrahdr') {
          assert.ok(descriptor.original.gainMap || descriptor.original.pq);
          assert.ok(process.env.MEDIA_UHDR_LIBRARY);
          const sourceExr = join(output, `${index}-developed.exr`);
          const crop = {
            left: region.left, top: region.top,
            width: Math.min(513, width - region.left), height: Math.min(389, height - region.top),
          };
          const croppedFile = join(output, `${index}-cropped-ultrahdr.jpg`);
          const spec = { format, quality: 90, gradeVersion: withCurves ? 2 : 1, expectedSourceSha256: descriptor.sourceSha256 };
          const invalid = await post(path + '/export', { ...spec, crop: { ...crop, left: width } });
          assert.equal(invalid.status, 422);
          const cropped = await post(path + '/export', { ...spec, crop });
          assert.equal(cropped.status, 200, cropped.ok ? undefined : await cropped.text());
          assert.equal(cropped.headers.get('content-type'), 'image/jpeg');
          assert.equal(cropped.headers.get('x-precision-edit-sha256'), preview.headers['x-precision-edit-sha256']);
          assert.ok(cropped.body);
          await pipeline(Readable.fromWeb(cropped.body), createWriteStream(croppedFile));
          const verify = async (jpeg: string, expected: { left: number; top: number; width: number; height: number }) => {
            const meta = await sharp(jpeg).metadata();
            assert.deepEqual([meta.width, meta.height, meta.depth], [expected.width, expected.height, 'uchar']);
            assert.ok(meta.gainMap);
            const native = await execute(python, ['-c', [
              'import json,sys,numpy as n,OpenImageIO as o',
              'sys.path.insert(0,sys.argv[1]); import ultrahdr as u',
              'pixels,gamut,gain=u.decode_gain_map(sys.argv[2],sys.argv[4],lambda w,h: None)',
              'left,top,width,height=(int(v) for v in sys.argv[5:9])',
              'assert pixels.shape==(height,width,3)',
              'i=o.ImageInput.open(sys.argv[3]); s=i.spec(); maximum=-float("inf"); error=0; high=0; source_high=0',
              'for row in range(0,height,64):',
              ' count=min(height-row,64)',
              ' ref=i.read_scanlines(s.y+top+row,s.y+top+row+count,s.z,0,3,o.FLOAT)[:,left:left+width]',
              ' out=u.linear_rec709(pixels[row:row+count],gamut)',
              ' maximum=max(maximum,float(out.max())); error+=float(n.sum(n.abs(ref-out),dtype=n.float64))',
              ' high+=int(n.count_nonzero(out>1)); source_high+=int(n.count_nonzero(ref>1))',
              'i.close()',
              'print(json.dumps({"width":width,"height":height,"gainSize":gain,"gamut":u.GAMUT_NAMES[gamut],"max":maximum,"aboveWhite":high,"referenceAboveWhite":source_high,"mae":error/(width*height*3)}))',
            ].join('\n'), resolve('packages/media/native'), jpeg, sourceExr, process.env.MEDIA_UHDR_LIBRARY!,
              String(expected.left), String(expected.top), String(expected.width), String(expected.height),
            ]);
            return JSON.parse(native.stdout);
          };
          const whole = await verify(target, { left: 0, top: 0, width, height });
          assert.ok(whole.aboveWhite > 0 && whole.referenceAboveWhite > 0);
          record.gainMapRoundTrip = { whole, crop: await verify(croppedFile, crop) };
        } else {
          const image = sharp(target, { ignoreIcc: true });
          const meta = await image.metadata();
          assert.equal(meta.depth, 'ushort');
          assert.deepEqual([meta.width, meta.height], [width, height]);
          assert.deepEqual(await raw16(image.extract(region)), cropped);
          record.verifiedSamples += cropped.length / 2;
        }
        if (windowStress) {
          const wide = {
            left: region.left,
            top: region.top,
            width: Math.min(1536, width - region.left),
            height: Math.min(900, height - region.top),
          };
          const wideWindow = await post(path + '/preview', { ...grade, maxEdge: 2048, region: wide });
          assert.equal(wideWindow.status, 200, wideWindow.ok ? undefined : await wideWindow.text());
          const pixels = await raw16(
            sharp(Buffer.from(await wideWindow.arrayBuffer()), { ignoreIcc: true }),
          );
          assert.deepEqual(pixels, await raw16(sharp(target, { ignoreIcc: true }).extract(wide)));
          record.windowStress = { ...windowStress, wide, wideSamples: pixels.length / 2 };
        }
        record.files.push({
          format,
          bytes: exportBytes,
          ms: exportMs,
          bitDepth: format === 'exr32' ? 32 : format === 'ultrahdr' ? 8 : 16,
        });
      }
      const overview = await f.call('POST', path + '/preview', { ...grade, maxEdge: 768 });
      assert.equal(overview.statusCode, 200, overview.body.slice(0, 200));
      await writeFile(join(output, String(index) + '-overview.png'), overview.rawPayload);
    } else {
      assert.equal(
        (
          await f.call('POST', path + '/export', {
            format: 'png16',
            ...grade,
          })
        ).statusCode,
        413,
      );
      const master = await f.call('GET', metadata.downloads.master);
      assert.equal(master.statusCode, 200);
      const raw = await raw16(sharp(master.rawPayload, { ignoreIcc: true }).extract(region));
      const samples = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
      const reference = editMaster16(samples, 4, baseEdit);
      assert.deepEqual(
        cropped,
        Buffer.from(reference.buffer, reference.byteOffset, reference.byteLength),
      );
      record.verifiedSamples = samples.length;
    }
    await writeFile(join(output, String(index) + '-native-window.png'), preview.rawPayload);
    report.push(record);
    console.log(JSON.stringify(record));
  }
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify({ projectId: f.projectId, teamId: f.teamId, sources: report }, null, 2),
  );
  if (browserOrigin) {
    const tokenHash = process.env.MEDIA_QA_BROWSER_TOKEN_HASH;
    assert.match(tokenHash ?? '', /^[a-f0-9]{64}$/);
    await f.db.query('UPDATE sessions SET token_hash=$1 WHERE token_hash=$2', [
      tokenHash,
      f.actors.owner.tokenHash,
    ]);
    console.log('Test media API is listening');
    await new Promise<void>((resolve) => {
      const stop = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(stop, 300_000);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  }
} finally {
  await f.close();
}
