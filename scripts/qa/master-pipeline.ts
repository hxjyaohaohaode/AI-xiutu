/** Native PostgreSQL and Linux media worker. Inputs are supplied explicitly. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
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
const f = await collaborationFixture(database, { origin: browserOrigin });
const execute = promisify(execFile);
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const raw16 = (pipeline: Sharp) =>
  pipeline.toColourspace('rgb16').ensureAlpha().raw({ depth: 'ushort' }).toBuffer();
const report = [];

try {
  for (const [index, file] of files.entries()) {
    const bytes = await readFile(file);
    const created = await f.call('POST', '/v1/projects/' + f.projectId + '/media-imports', {
      name: basename(file),
      size: bytes.length,
      idempotencyKey: crypto.randomUUID(),
      generateTiles: false,
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
    assert.equal(sha((await f.call('GET', metadata.downloads.original)).rawPayload), sha(bytes));
    const result = {
      name: basename(file),
      sourceSha256: sha(bytes),
      width,
      height,
      importMs: Math.round(performance.now() - start),
      assetId: state.asset.id,
      sourceEncoding: descriptor.original.sampleEncoding,
      linear: !!descriptor.linearMaster,
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
      ...(precisionEdit.algorithm !== 'scene-linear-v1' ? { curves: precisionEdit.curves } : {}),
      ...(precisionEdit.algorithm === 'scene-linear-v3'
        ? { regions: precisionEdit.regions, localComparison }
        : {}),
      previewMs,
      nativeRegion: region,
      previewSha256: sha(cropped),
      files: [] as { format: string; bytes: number; bitDepth: number }[],
      verifiedSamples: 0,
      linearReadback: null as unknown,
    };
    if (width * height <= (precisionInput === 'linear-master' ? 50_000_000 : 16_777_216)) {
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
      for (const format of ['png16', 'tiff16', ...(descriptor.linearMaster ? ['exr32'] : [])]) {
        const response = await f.call('POST', path + '/export', {
          format,
          gradeVersion: withCurves ? 2 : 1,
          expectedSourceSha256: descriptor.sourceSha256,
        });
        assert.equal(response.statusCode, 200, response.body.slice(0, 250));
        assert.equal(
          response.headers['x-precision-edit-sha256'],
          preview.headers['x-precision-edit-sha256'],
        );
        const target = join(
          output,
          String(index) +
            '-developed.' +
            (format === 'tiff16' ? 'tif' : format === 'exr32' ? 'exr' : 'png'),
        );
        await writeFile(target, response.rawPayload);
        if (format === 'exr32') {
          const native = await execute(python, [
            '-c',
            [
              'import json,sys,OpenImageIO as o,numpy as n',
              'i=o.ImageInput.open(sys.argv[1]); s=i.spec(); p=i.read_image(format=o.FLOAT); i.close()',
              'print(json.dumps({"size":[s.width,s.height],"type":str(s.format),"range":[float(p[:,:,:3].min()),float(p[:,:,:3].max())],"channels":list(s.channelnames),"window":[s.x,s.y,s.full_x,s.full_y,s.full_width,s.full_height]}))',
            ].join('\n'),
            target,
          ]);
          const linear = JSON.parse(native.stdout);
          assert.deepEqual(linear.size, [width, height]);
          assert.equal(linear.type, 'float');
          record.linearReadback = linear;
        } else {
          const image = sharp(response.rawPayload, { ignoreIcc: true });
          const meta = await image.metadata();
          assert.equal(meta.depth, 'ushort');
          assert.deepEqual([meta.width, meta.height], [width, height]);
          assert.deepEqual(await raw16(image.extract(region)), cropped);
          record.verifiedSamples += cropped.length / 2;
        }
        record.files.push({
          format,
          bytes: response.rawPayload.length,
          bitDepth: format === 'exr32' ? 32 : 16,
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
    const port = Number(process.env.MEDIA_QA_PORT);
    assert.match(tokenHash ?? '', /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
    await f.db.query('UPDATE sessions SET token_hash=$1 WHERE token_hash=$2', [
      tokenHash,
      f.actors.owner.tokenHash,
    ]);
    await f.app.listen({ host: '0.0.0.0', port });
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
