import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assets, verifyVisionAsset } from './vision-assets.mjs';
import matting from '../third-party/portrait-matting.json' with { type: 'json' };
import fineMatting from '../third-party/portrait-fine-matting.json' with { type: 'json' };

// Official public version-1 assets, pinned by content hash. No photo leaves the browser.
const root = fileURLToPath(new URL('../', import.meta.url)),
  out = resolve(root, 'apps/web/public/vision');
await mkdir(out, { recursive: true });
const prepared = [
  ...assets,
  ...[matting, fineMatting].map((asset) => ({ ...asset, format: 'onnx' })),
];
for (const asset of prepared) {
  const target = resolve(out, asset.file);
  let bytes = await readFile(target).catch(() => null);
  try {
    if (bytes) verifyVisionAsset(asset, bytes);
  } catch {
    bytes = null;
  }
  if (!bytes) {
    const response = await fetch(
      asset.url ?? `https://storage.googleapis.com/mediapipe-models/${asset.path}`,
      {
        signal: AbortSignal.timeout(asset.downloadTimeoutMs ?? 60_000),
        redirect: asset.url ? 'follow' : 'error',
      },
    );
    if (!response.ok)
      throw new Error(`Official vision asset ${asset.file}: HTTP ${response.status}`);
    const reader = response.body.getReader();
    bytes = Buffer.allocUnsafe(asset.bytes);
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.length > bytes.length) {
        await reader.cancel();
        throw new Error('Vision asset exceeds size budget');
      }
      bytes.set(value, size);
      size += value.length;
    }
    if (size !== bytes.length) throw new Error(`Truncated model download: ${asset.file}`);
    verifyVisionAsset(asset, bytes);
    await writeFile(target, bytes);
  }
  console.log(`Verified ${asset.file} (${bytes.length} bytes)`);
}
await mkdir(resolve(out, 'wasm'), { recursive: true });
await copyFile(resolve(root, 'third-party/Apache-2.0.txt'), resolve(out, 'LICENSE.txt'));
await copyFile(resolve(root, 'third-party/BiRefNet-MIT.txt'), resolve(out, 'BiRefNet-MIT.txt'));
await copyFile(resolve(root, 'third-party/NOTICE.md'), resolve(out, 'NOTICE.txt'));
await copyFile(
  resolve(root, 'third-party/ONNX-Runtime-LICENSE.txt'),
  resolve(out, 'ONNX-Runtime-LICENSE.txt'),
);
await copyFile(
  resolve(root, 'third-party/ONNX-Runtime-ThirdPartyNotices.txt'),
  resolve(out, 'ONNX-Runtime-ThirdPartyNotices.txt'),
);
await copyFile(
  resolve(root, 'node_modules/onnxruntime-web/dist', matting.runtimeFile),
  resolve(out, 'wasm', matting.runtimeFile),
);
for (const variant of ['asyncify', 'jsep'])
  for (const extension of ['mjs', 'wasm']) {
    const file = `ort-wasm-simd-threaded.${variant}.${extension}`;
    await copyFile(
      resolve(root, 'node_modules/onnxruntime-web/dist', file),
      resolve(out, 'wasm', file),
    );
  }
for (const file of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm'])
  await copyFile(
    resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm', file),
    resolve(out, 'wasm', file),
  );
const sdk = JSON.parse(
  await readFile(resolve(root, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8'),
);
await writeFile(
  resolve(out, 'manifest.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      sdkVersion: sdk.version,
      algorithmVersion: 'mediapipe-v1-selfie256',
      assets: prepared.map(({ file, sha256, bytes }) => ({ file, sha256, bytes })),
    },
    null,
    2,
  ),
);
console.log(
  'Local vision assets ready. They are served from the website origin; no external CDN is needed at runtime.',
);
