import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const revision = 'e12c65a915945e4c28e237a9b52bc4a8f39a0cec';
const files = [
  [
    'eng.traineddata',
    15_400_601,
    '8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba',
  ],
  [
    'chi_sim.traineddata',
    13_077_423,
    '4fef2d1306c8e87616d4d3e4c6c67faf5d44be3342290cf8f2f0f6e3aa7e735b',
  ],
  ['LICENSE', 10_173, 'a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9'],
];
const directory = resolve(process.argv[2] ?? '.data/ocr-tessdata');
await mkdir(directory, { recursive: true });
for (const [name, size, sha] of files) {
  const target = join(directory, name);
  const valid = (value) =>
    value?.length === size && createHash('sha256').update(value).digest('hex') === sha;
  if (valid(await readFile(target).catch(() => null))) continue;
  const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/${revision}/${name}`;
  const result = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
  if (!result.ok || !result.body) throw new Error(`OCR model ${name}: HTTP ${result.status}`);
  const chunks = [];
  let received = 0;
  for await (const chunk of result.body) {
    received += chunk.byteLength;
    if (received > size) throw new Error(`OCR model ${name} exceeds expected size`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (!valid(bytes)) throw new Error(`OCR model ${name} does not match the pinned content digest`);
  const temporary = join(directory, `.${randomUUID()}.partial`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
