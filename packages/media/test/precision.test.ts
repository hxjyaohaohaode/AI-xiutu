import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  NEUTRAL_PRECISION_EDIT,
  compilePrecisionEdit,
  parsePrecisionEdit,
  linearToSrgb,
  srgbToLinear,
} from '@ai-xiutu/editor';
import { editMaster16 } from '../src/precision.js';
import { processMedia, exportMedia } from '../src/index.js';

const execute = promisify(execFile);
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
