import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  NEUTRAL_PRECISION_EDIT,
  compilePrecisionEdit,
  compileSelectionMaskV3,
  parsePrecisionEdit,
  linearToSrgb,
  srgbToLinear,
  type PrecisionEditV3,
} from '@ai-xiutu/editor';
import { editMaster16 } from '../src/precision.js';
import { createLinearWindowRuntime, processMedia, exportMedia } from '../src/index.js';

const execute = promisify(execFile);
test(
  'JPEG gain maps retain the original and develop a graded HDR crop without EXIF',
  { skip: !process.env.MEDIA_QA_PYTHON || !process.env.MEDIA_UHDR_LIBRARY },
  async () => {
    const pythonExecutable = process.env.MEDIA_QA_PYTHON!;
    const ultraHdrLibrary = process.env.MEDIA_UHDR_LIBRARY!;
    const dir = await mkdtemp(join(tmpdir(), 'xiutu-gain-map-test-'));
    const runtime = createLinearWindowRuntime();
    const width = 72;
    const height = 54;
    try {
      const floatTiff = join(dir, 'linear.tif');
      const inputPath = join(dir, 'gain-map.jpg');
      await execute(pythonExecutable, [
        '-c',
        `import numpy as n, OpenImageIO as o, sys
w,h=map(int,sys.argv[2:]); y,x=n.mgrid[0:h,0:w]
p=n.stack((0.2+x/25,0.3+y/20,0.2+(x+y)/66),axis=-1).astype(n.float32)
s=o.ImageSpec(w,h,3,o.FLOAT); s.attribute("oiio:ColorSpace","Linear")
out=o.ImageOutput.create(sys.argv[1]); assert out.open(sys.argv[1],s)
assert out.write_image(p); assert out.close()`,
        floatTiff,
        String(width),
        String(height),
      ]);
      const encoded = await sharp(floatTiff).toColourspace('scrgb').jpeg({ quality: 95 }).toBuffer();
      // Hide the generated EXIF segment without shifting the MPF gain-map offsets.
      const exifStart = encoded.indexOf(Buffer.from('Exif\0\0', 'ascii'));
      if (exifStart >= 4) {
        assert.equal(encoded.readUInt16BE(exifStart - 4), 0xffe1);
        encoded[exifStart - 3] = 0xef;
      }
      await writeFile(inputPath, encoded);
      const jpeg = await sharp(inputPath).metadata();
      assert.ok(jpeg.gainMap);
      assert.equal(jpeg.exif, undefined);
      const workDir = join(dir, 'media');
      const options = { pythonExecutable, ultraHdrLibrary };
      const descriptor = await processMedia({ inputPath, workDir, options });
      assert.equal(descriptor.original.sampleEncoding, 'gain-map');
      assert.deepEqual(descriptor.original.gainMap, { width: 36, height: 27, hdrGamut: 'Rec.709' });
      assert.equal(descriptor.linearMaster?.bitDepth, 32);
      assert.deepEqual(
        await readFile(join(workDir, descriptor.original.relativePath)),
        await readFile(inputPath),
      );
      const fallbackDir = join(dir, 'sdr-only');
      const fallback = await processMedia({
        inputPath,
        workDir: fallbackDir,
        options: { pythonExecutable },
      });
      assert.equal(fallback.linearMaster, undefined);
      assert.ok(fallback.warnings.some((message) => message.includes('gain map retained')));
      assert.equal(fallback.original.sha256, descriptor.original.sha256);
      const request = {
        workDir,
        precisionInput: 'linear-master' as const,
        precisionEdit: { ...NEUTRAL_PRECISION_EDIT, exposure: -0.2 },
        expectedSourceSha256: descriptor.sourceSha256,
        options: { ...options, quality: 96 },
      };
      const crop = { left: 22, top: 15, width: 37, height: 29 };
      const exr = join(dir, 'graded.exr');
      const outputPath = join(dir, 'graded.jpg');
      const reference = await exportMedia({ ...request, format: 'exr32', outputPath: exr });
      const exported = await exportMedia({ ...request, format: 'ultrahdr', crop, outputPath });
      assert.equal(exported.precisionEdit?.sha256, reference.precisionEdit?.sha256);
      assert.deepEqual([exported.width, exported.height], [crop.width, crop.height]);
      assert.ok((await sharp(outputPath).metadata()).gainMap);
      const sdrPath = join(dir, 'graded.png');
      const windowPath = join(dir, 'window.png');
      const sdr = await exportMedia({ ...request, format: 'png16', outputPath: sdrPath });
      const window = await exportMedia(
        {
          ...request,
          format: 'png16',
          outputPath: windowPath,
          preview: { maxEdge: 128, region: crop },
        },
        { descriptor, runtime },
      );
      assert.equal(sdr.precisionEdit?.sha256, reference.precisionEdit?.sha256);
      assert.equal(window.precisionEdit?.sha256, sdr.precisionEdit?.sha256);
      const raw16 = (pipeline: ReturnType<typeof sharp>) =>
        pipeline.toColourspace('rgb16').raw({ depth: 'ushort' }).toBuffer();
      const displayPixels = await raw16(sharp(windowPath, { ignoreIcc: true }));
      assert.deepEqual(
        displayPixels,
        await raw16(sharp(sdrPath, { ignoreIcc: true }).extract(crop)),
      );
      const displayLevels = new Set<number>();
      for (let offset = 2; offset < displayPixels.length; offset += 6)
        displayLevels.add(displayPixels.readUInt16LE(offset));
      assert.ok(displayLevels.size > 100, 'The SDR window must retain highlight detail');
      await execute(pythonExecutable, [
        '-B',
        '-c',
        `import numpy as n, OpenImageIO as o, sys
sys.path.insert(0,sys.argv[1]); from ultrahdr import decode_gain_map,linear_rec709
img=o.ImageInput.open(sys.argv[2]); reference=img.read_image(format=o.FLOAT); img.close()
x,y,w,h=map(int,sys.argv[5:]); reference=reference[y:y+h,x:x+w]
p,gamut,_=decode_gain_map(sys.argv[3],sys.argv[4],lambda *_:None)
decoded=linear_rec709(p,gamut); assert decoded.shape==reference.shape
assert n.count_nonzero(decoded>1)>w*h; assert n.mean(n.abs(decoded-reference))<0.12`,
        fileURLToPath(new URL('../native', import.meta.url)),
        exr,
        outputPath,
        ultraHdrLibrary,
        ...[crop.left, crop.top, crop.width, crop.height].map(String),
      ]);
    } finally {
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'RAW float master tile-row normalization retains every source code value through partial tiles',
  { skip: !process.env.MEDIA_QA_PYTHON },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xiutu-raw-float-tiles-'));
    try {
      await execute(process.env.MEDIA_QA_PYTHON!, [
        '-B',
        '-c',
        `import numpy as n,OpenImageIO as o,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1]); from convert import write_image,normalize_raw_tiles
w,h=339,271; p=n.arange(w*h*3,dtype=n.uint32).astype(n.uint16).reshape(h,w,3)
out=Path(sys.argv[2]); write_image(out,p,o.FLOAT,"Linear",tile_transform=normalize_raw_tiles)
i=o.ImageInput.open(str(out)); s=i.spec(); assert (s.width,s.height,s.tile_width,s.tile_height)==(w,h,256,256)
q=i.read_image(format=o.FLOAT); assert i.close(); assert n.array_equal(q,p.astype(n.float32)/n.float32(65535))`,
        fileURLToPath(new URL('../native', import.meta.url)),
        join(dir, 'linear.exr'),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('precision edits preserve all 65536 adjacent code values and use actual linear-light exposure without an 8bit stage', () => {
  const input = Uint16Array.from({ length: 65536 * 4 }, (_, i) =>
    i % 4 === 3 ? 32768 : Math.floor(i / 4),
  );
  assert.deepEqual(editMaster16(input, 4, { ...NEUTRAL_PRECISION_EDIT }), input);
  const result = editMaster16(input, 4, { ...NEUTRAL_PRECISION_EDIT, exposure: -0.73 });
  for (let i = 0; i < 65536; i++) {
    const expected = Math.round(linearToSrgb(srgbToLinear(i / 65535) * 2 ** -0.73) * 65535);
    for (let c = 0; c < 3; c++) assert.equal(result[i * 4 + c], expected);
    assert.equal(result[i * 4 + 3], 32768);
  }
  assert.ok(new Set(result.filter((_v, i) => i % 4 === 0)).size > 40_000);
  const transform = compilePrecisionEdit({ ...NEUTRAL_PRECISION_EDIT, exposure: 2 }),
    sample = new Float64Array(3);
  transform(-0.125, 2, 128, sample);
  assert.deepEqual([...sample], [-0.5, 8, 512]);
  assert.throws(() => parsePrecisionEdit({ ...NEUTRAL_PRECISION_EDIT, exposure: Infinity }));
  assert.throws(() => parsePrecisionEdit({ ...NEUTRAL_PRECISION_EDIT, unknown: 1 }));
  assert.throws(() => parsePrecisionEdit({ ...NEUTRAL_PRECISION_EDIT, curves: {} }));
  assert.throws(() =>
    parsePrecisionEdit({
      ...NEUTRAL_PRECISION_EDIT,
      algorithm: 'scene-linear-v2',
      curves: {
        red: [
          [0, 0],
          [0, 1],
        ],
      },
    }),
  );
});

test('native master grading exports true 16bit edited samples, retains immutable original and binds the edit to its source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xiutu-precision-test-'));
  try {
    const inputPath = join(dir, 'input.png'),
      workDir = join(dir, 'media');
    const values = Uint16Array.from({ length: 257 * 3 * 3 }, (_, i) => 11001 + i);
    await sharp(values, { raw: { width: 257, height: 3, channels: 3 } })
      .toColourspace('rgb16')
      .png()
      .toFile(inputPath);
    const descriptor = await processMedia({
      inputPath,
      workDir,
      options: { generateTiles: false },
    });
    const masterBefore = await readFile(join(workDir, 'master.tif'));
    for (const format of ['png16', 'tiff16'] as const) {
      const edit = { ...NEUTRAL_PRECISION_EDIT, exposure: -0.73 },
        outputPath = join(dir, `graded-${format}`);
      const result = await exportMedia({ workDir, outputPath, format, precisionEdit: edit });
      assert.equal(result.bitDepth, 16);
      assert.equal(result.includesEditorRecipe, false);
      assert.equal(result.precisionEdit?.input, 'master16');
      assert.equal(result.sourceSha256, descriptor.sourceSha256);
      const raw = await sharp(outputPath, { ignoreIcc: true })
        .removeAlpha()
        .toColourspace('rgb16')
        .raw({ depth: 'ushort' })
        .toBuffer();
      const actual = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
      assert.deepEqual(actual, editMaster16(values, 3, edit));
      assert.ok((await sharp(outputPath).metadata()).icc);
    }
    assert.deepEqual(await readFile(join(workDir, 'master.tif')), masterBefore);
    assert.deepEqual(await readFile(join(workDir, 'original.bin')), await readFile(inputPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  'native float editing keeps EXR windows, pixel aspect, negative channels, headroom and associated alpha',
  { skip: !process.env.MEDIA_QA_PYTHON },
  async () => {
    const python = process.env.MEDIA_QA_PYTHON!,
      dir = await mkdtemp(join(tmpdir(), 'xiutu-float-test-'));
    try {
      const inputPath = join(dir, 'input.exr'),
        workDir = join(dir, 'media');
      await execute(python, [
        '-c',
        `import OpenImageIO as o,numpy as n,sys
s=o.ImageSpec(3,2,4,o.FLOAT)
s.x,s.y,s.full_x,s.full_y,s.full_width,s.full_height=-7,13,-31,9,49,19
s.attribute("PixelAspectRatio",1.5)
s.attribute("oiio:ColorSpace","Linear")
p=n.array([[[-0.125,2,8,1],[0.5,1,2,0.5],[0.0625,0.125,1,0]],[[0.18,0.25,0.37,1],[4,8,16,1],[0.00001,0.00002,0.00003,1]]],dtype=n.float32)
out=o.ImageOutput.create(sys.argv[1]); assert out.open(sys.argv[1],s); assert out.write_image(p); out.close()`,
        inputPath,
      ]);
      const descriptor = await processMedia({
        inputPath,
        workDir,
        options: { pythonExecutable: python, generateTiles: false },
      });
      assert.ok(descriptor.linearMaster);
      const edit = { ...NEUTRAL_PRECISION_EDIT, exposure: 1 };
      const outputPath = join(dir, 'edited.exr');
      const result = await exportMedia({
        workDir,
        outputPath,
        format: 'exr32',
        precisionEdit: edit,
        options: { pythonExecutable: python },
      });
      assert.equal(result.bitDepth, 32);
      assert.equal(result.precisionEdit?.input, 'linear-master');
      const read = await execute(python, [
        '-c',
        `import OpenImageIO as o,json,sys
result=[]
for path in sys.argv[1:]:
    i=o.ImageInput.open(path); s=i.spec(); p=i.read_image(format=o.FLOAT); i.close()
    result.append({"format":str(s.format),"data":p.tolist(),"window":[s.x,s.y,s.width,s.height,s.full_x,s.full_y,s.full_width,s.full_height],"aspect":s.getattribute("PixelAspectRatio"),"color":s.getattribute("oiio:ColorSpace")})
print(json.dumps(result))`,
        join(workDir, 'linear-master.exr'),
        outputPath,
      ]);
      const [master, decoded] = JSON.parse(read.stdout);
      for (const image of [master, decoded]) {
        assert.equal(image.format, 'float');
        assert.deepEqual(image.window, [-7, 13, 3, 2, -31, 9, 49, 19]);
        assert.equal(image.aspect, 1.5);
        assert.equal(image.color, 'lin_rec709_scene');
        assert.deepEqual(image.data[0][2], [0.0625, 0.125, 1, 0]);
      }
      assert.deepEqual(decoded.data[0][0], [-0.25, 4, 16, 1]);
      assert.deepEqual(decoded.data[0][1], [1, 2, 4, 0.5]);
      assert.deepEqual(decoded.data[1][1], [8, 16, 32, 1]);
      const development = {
        workDir,
        format: 'png16' as const,
        precisionInput: 'linear-master' as const,
        precisionEdit: { ...NEUTRAL_PRECISION_EDIT, exposure: -3 },
        options: { pythonExecutable: python },
      };
      const png = join(dir, 'developed.png'),
        window = join(dir, 'window.png'),
        region = { left: 1, top: 0, width: 1, height: 2 };
      const full = await exportMedia({ ...development, outputPath: png });
      const part = await exportMedia({
        ...development,
        outputPath: window,
        preview: { maxEdge: 128, region },
      });
      assert.deepEqual([part.width, part.height, part.bitDepth], [1, 2, 16]);
      assert.equal(part.precisionEdit?.sha256, full.precisionEdit?.sha256);
      const raw16 = (pipeline: ReturnType<typeof sharp>) =>
        pipeline.toColourspace('rgb16').raw({ depth: 'ushort' }).toBuffer();
      const actual = await raw16(sharp(window, { ignoreIcc: true }));
      assert.deepEqual(actual, await raw16(sharp(png, { ignoreIcc: true }).extract(region)));
      const first = new Uint16Array(actual.buffer, actual.byteOffset, 4);
      assert.deepEqual(
        [...first],
        [0.125, 0.25, 0.5].map((v) => Math.round(linearToSrgb(v) * 65535)).concat(32768),
      );
      const curves = {
        ...NEUTRAL_PRECISION_EDIT,
        algorithm: 'scene-linear-v2' as const,
        curves: {
          luminance: [
            [-15, -16],
            [16, 15],
          ] as [number, number][],
          red: [
            [-15, -14],
            [15, 16],
          ] as [number, number][],
        },
      };
      const curved = join(dir, 'curved.exr');
      const curveResult = await exportMedia({
        ...development,
        outputPath: curved,
        format: 'exr32',
        precisionEdit: curves,
      });
      assert.equal(curveResult.precisionEdit?.algorithm, 'scene-linear-v2');
      const curvedRead = await execute(python, [
        '-c',
        'import OpenImageIO as o,json,sys; i=o.ImageInput.open(sys.argv[1]); print(json.dumps(i.read_image(format=o.FLOAT).tolist())); i.close()',
        curved,
      ]);
      const curvedSamples = JSON.parse(curvedRead.stdout);
      assert.deepEqual(curvedSamples[0], [
        [-0.0625, 1, 4, 1],
        [0.5, 0.5, 1, 0.5],
        [0.0625, 0.125, 1, 0],
      ]);
      assert.deepEqual(curvedSamples[1][1], [4, 4, 8, 1]);
      await assert.rejects(
        exportMedia({
          ...development,
          outputPath: join(dir, 'wrong-input.png'),
          precisionInput: 'master16',
          precisionEdit: curves,
        }),
        /retained float master/,
      );
      const fullCurve = join(dir, 'full-curve.png'),
        partCurve = join(dir, 'curve-window.png');
      const curveFull = await exportMedia({
        ...development,
        outputPath: fullCurve,
        precisionEdit: curves,
      });
      const curvePart = await exportMedia({
        ...development,
        outputPath: partCurve,
        precisionEdit: curves,
        preview: { maxEdge: 128, region },
      });
      assert.equal(curvePart.precisionEdit?.sha256, curveFull.precisionEdit?.sha256);
      assert.equal(curvePart.precisionEdit?.sha256, curveResult.precisionEdit?.sha256);
      assert.deepEqual(
        await raw16(sharp(partCurve, { ignoreIcc: true })),
        await raw16(sharp(fullCurve, { ignoreIcc: true }).extract(region)),
      );
      const runtime = createLinearWindowRuntime();
      const context = { runtime, descriptor };
      const preview = { maxEdge: 128, region };
      const windowEdit = { ...development, precisionEdit: curves, preview };
      const nativeMaster = join(workDir, 'linear-master.exr');
      try {
        const cancellation = new AbortController();
        const cancelled = join(dir, 'cancelled-window.png');
        const pending = exportMedia(
          { ...windowEdit, outputPath: cancelled, signal: cancellation.signal },
          context,
        );
        const timer = setTimeout(() => cancellation.abort(), 15);
        try {
          await assert.rejects(pending, { code: 'aborted' });
          await assert.rejects(stat(cancelled), { code: 'ENOENT' });
        } finally {
          clearTimeout(timer);
        }
        const cold = join(dir, 'cold-window.png');
        const warm = join(dir, 'warm-window.png');
        const firstWindow = await exportMedia({ ...windowEdit, outputPath: cold }, context);
        const warmWindow = await exportMedia({ ...windowEdit, outputPath: warm }, context);
        assert.equal(firstWindow.precisionEdit?.sha256, curveFull.precisionEdit?.sha256);
        assert.equal(warmWindow.precisionEdit?.sha256, curveFull.precisionEdit?.sha256);
        assert.deepEqual(
          await raw16(sharp(warm, { ignoreIcc: true })),
          await raw16(sharp(partCurve, { ignoreIcc: true })),
        );
        assert.deepEqual(
          (await sharp(warm).metadata()).icc,
          (await sharp(partCurve).metadata()).icc,
        );
        const original = await readFile(nativeMaster);
        const times = await stat(nativeMaster);
        const altered = Buffer.from(original);
        altered[altered.length - 1]! ^= 1;
        await writeFile(nativeMaster, altered);
        await utimes(nativeMaster, times.atime, times.mtime);
        const rejected = join(dir, 'stale-window.png');
        await assert.rejects(exportMedia({ ...windowEdit, outputPath: rejected }, context), {
          code: 'processing',
        });
        await assert.rejects(stat(rejected), { code: 'ENOENT' });
        await writeFile(nativeMaster, original);
        const restored = join(dir, 'restored-window.png');
        await exportMedia({ ...windowEdit, outputPath: restored }, context);
        assert.deepEqual(await readFile(restored), await readFile(warm));
      } finally {
        await runtime.close();
      }
      // Corrupting the retained source cannot be hidden behind its old descriptor.
      await writeFile(join(workDir, 'linear-master.exr'), 'changed');
      await assert.rejects(
        exportMedia({
          workDir,
          outputPath: join(dir, 'bad.exr'),
          format: 'exr32',
          precisionEdit: edit,
          options: { pythonExecutable: python },
        }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'ordered native region grading shares rotated and linear mask weights across float export and warm windows',
  { skip: !process.env.MEDIA_QA_PYTHON },
  async () => {
    const python = process.env.MEDIA_QA_PYTHON!;
    const dir = await mkdtemp(join(tmpdir(), 'xiutu-float-regions-test-'));
    const runtime = createLinearWindowRuntime();
    const width = 137;
    const height = 99;
    try {
      const inputPath = join(dir, 'input.exr');
      const workDir = join(dir, 'media');
      await execute(python, [
        '-c',
        `import OpenImageIO as o,numpy as n,sys
w,h=int(sys.argv[2]),int(sys.argv[3]); s=o.ImageSpec(w,h,4,o.FLOAT)
s.x,s.y,s.full_x,s.full_y,s.full_width,s.full_height=-11,7,-22,-13,w+40,h+30
s.tile_width=s.tile_height=32; s.tile_depth=1
s.attribute("oiio:ColorSpace","Linear")
y,x=n.mgrid[0:h,0:w]; a=n.where((x+y)%19==0,0,n.where((x+y)%11==0,0.5,1))
p=n.stack(((x-48)/256,(y+19)/256,(x+y+50)/64,a),axis=-1).astype(n.float32)
p[:,:,:3]*=n.where(a>0,a,1)[:,:,None]
out=o.ImageOutput.create(sys.argv[1]); assert out.open(sys.argv[1],s); assert out.write_image(p); assert out.close()`,
        inputPath,
        String(width),
        String(height),
      ]);
      const descriptor = await processMedia({
        inputPath,
        workDir,
        options: { pythonExecutable: python, generateTiles: false },
      });
      assert.ok(descriptor.linearMaster);
      const options = { pythonExecutable: python };
      const settings: PrecisionEditV3 = {
        ...NEUTRAL_PRECISION_EDIT,
        algorithm: 'scene-linear-v3',
        curves: {},
        regions: [
          {
            id: 'rotated',
            enabled: true,
            opacity: 0.75,
            mask: {
              type: 'radial',
              centerX: 0.47,
              centerY: 0.5,
              radiusX: 0.29,
              radiusY: 0.15,
              feather: 0.3,
              invert: false,
              shape: 'diamond',
              rotationDegrees: 36,
            },
            adjustments: { contrast: 31, temperature: 18 },
          },
          {
            id: 'gradient',
            enabled: true,
            opacity: 0.65,
            mask: {
              type: 'linear',
              start: { x: 0.35, y: 0.3 },
              end: { x: 0.85, y: 0.75 },
              smooth: true,
              invert: false,
            },
            adjustments: { exposure: 0.73, saturation: -22 },
          },
        ],
      };
      assert.deepEqual(parsePrecisionEdit(settings), settings);
      assert.throws(
        () =>
          parsePrecisionEdit({ ...settings, regions: [settings.regions[0], settings.regions[0]] }),
        /unique region/,
      );
      assert.throws(
        () =>
          parsePrecisionEdit({
            ...settings,
            regions: [
              { ...settings.regions[0], mask: { type: 'brush', strokes: [], invert: false } },
            ],
          }),
        /radial or linear/,
      );
      const request = {
        workDir,
        precisionInput: 'linear-master' as const,
        precisionEdit: settings,
        options,
      };
      const exr = join(dir, 'regions.exr');
      const result = await exportMedia({ ...request, format: 'exr32', outputPath: exr });
      assert.equal(result.precisionEdit?.algorithm, settings.algorithm);
      const readFloat = async (path: string, name: string) => {
        const raw = join(dir, name + '.bin');
        await execute(python, [
          '-c',
          'import OpenImageIO as o,numpy as n,sys; i=o.ImageInput.open(sys.argv[1]); assert i; n.asarray(i.read_image(format=o.FLOAT),dtype="<f4").tofile(sys.argv[2]); i.close()',
          path,
          raw,
        ]);
        const bytes = await readFile(raw);
        return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
      };
      const [original, graded] = await Promise.all([
        readFloat(join(workDir, 'linear-master.exr'), 'original'),
        readFloat(exr, 'edited'),
      ]);
      assert.equal(graded.length, width * height * 4);
      const regions = settings.regions.map((item) => ({
        sample: compileSelectionMaskV3(item.mask, { width, height }),
        apply: compilePrecisionEdit({ ...NEUTRAL_PRECISION_EDIT, ...item.adjustments }),
        opacity: item.opacity,
      }));
      const next = new Float64Array(3);
      let untouched = 0,
        edited = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const at = 4 * (y * width + x),
            alpha = original[at + 3]!;
          assert.equal(graded[at + 3], alpha);
          const weights = regions.map(
            ({ sample, opacity }) => sample((x + 0.5) / width, (y + 0.5) / height) * opacity,
          );
          if (!alpha || weights.every((weight) => weight === 0)) {
            assert.deepEqual(graded.subarray(at, at + 4), original.subarray(at, at + 4));
            untouched++;
            continue;
          }
          const values = [
            original[at]! / alpha,
            original[at + 1]! / alpha,
            original[at + 2]! / alpha,
          ];
          for (const [i, { apply }] of regions.entries()) {
            apply(values[0]!, values[1]!, values[2]!, next);
            for (let c = 0; c < 3; c++) values[c]! += weights[i]! * (next[c]! - values[c]!);
          }
          for (let c = 0; c < 3; c++)
            assert.ok(Math.abs(graded[at + c]! - Math.fround(values[c]! * alpha)) < 1e-6);
          edited++;
        }
      }
      assert.ok(untouched > 2000 && edited > 2000);
      assert.ok(graded.some((value, i) => i % 4 !== 3 && value > 1));
      assert.ok(graded.some((value, i) => i % 4 !== 3 && value < 0));
      const reversed = join(dir, 'reversed.exr');
      await exportMedia({
        ...request,
        precisionEdit: { ...settings, regions: [...settings.regions].reverse() },
        format: 'exr32',
        outputPath: reversed,
      });
      assert.notDeepEqual(await readFloat(reversed, 'reverse'), graded);
      const png = join(dir, 'full.png'),
        window = join(dir, 'window.png');
      const region = { left: 39, top: 21, width: 79, height: 66 };
      const pngRequest = {
        ...request,
        format: 'png16' as const,
        precisionEdit: { ...settings, toneMap: 'reinhard' as const },
      };
      const full = await exportMedia({ ...pngRequest, outputPath: png });
      const preview = await exportMedia(
        { ...pngRequest, outputPath: window, preview: { maxEdge: 128, region } },
        { runtime, descriptor },
      );
      const raw16 = (path: string, crop?: typeof region) => {
        const image = sharp(path, { ignoreIcc: true });
        return (crop ? image.extract(crop) : image)
          .toColourspace('rgb16')
          .raw({ depth: 'ushort' })
          .toBuffer();
      };
      assert.deepEqual(await raw16(window), await raw16(png, region));
      assert.equal(preview.precisionEdit?.sha256, full.precisionEdit?.sha256);
      assert.deepEqual(await readFile(join(workDir, 'original.bin')), await readFile(inputPath));
    } finally {
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
