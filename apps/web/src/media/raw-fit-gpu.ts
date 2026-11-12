import type { PrecisionEdit } from '@ai-xiutu/editor';
import { rawFitGeometry, rawGradeParameters, RAW_GRADE_WORDS } from './raw-fit-parameters';
import { normalizedRawCodes, streamRawMaster, type RawMaster } from './raw-master-stream';
import shader from './raw-fit.wgsl?raw';

const MAX_GPU_BYTES = 768 * 1024 ** 2;
const WORKGROUP_WIDTH = 16;
const WORKGROUP_HEIGHT = 8;

export async function openRawFitGpu(
  assetId: string,
  master: RawMaster,
  maxEdge: number,
  onLost: () => void,
) {
  const { width, height } = master;
  const pixels = width * height;
  if (
    ![width, height].every((side) => Number.isSafeInteger(side) && side > 0 && side <= 16_384) ||
    pixels > 64_000_000 ||
    !Number.isSafeInteger(maxEdge) ||
    maxEdge < 128 ||
    maxEdge > 1536
  )
    throw new Error('Unsupported RAW preview dimensions');
  const shape = rawFitGeometry(width, height, maxEdge);
  const { outputWidth, outputHeight, x, y } = shape;
  const sourceBytes = Math.ceil((pixels * 3) / 2) * 4;
  const verticalBytes = width * y.reduced * 8;
  const horizontalBytes = x.reduced * outputHeight * 8;
  const outputBytes = outputWidth * outputHeight * 8;
  const largest = Math.max(sourceBytes, verticalBytes, horizontalBytes, outputBytes);
  if (sourceBytes + verticalBytes + horizontalBytes + outputBytes > MAX_GPU_BYTES)
    throw new Error('RAW preview exceeds its GPU budget');

  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (
    !adapter ||
    adapter.info.isFallbackAdapter ||
    adapter.limits.maxBufferSize < largest ||
    adapter.limits.maxStorageBufferBindingSize < largest
  )
    throw new Error('RAW preview GPU is unavailable');
  const device = await adapter.requestDevice({
    requiredLimits: { maxBufferSize: largest, maxStorageBufferBindingSize: largest },
  });
  void device.lost.then(onLost);
  device.addEventListener('uncapturederror', onLost);
  device.pushErrorScope('out-of-memory');
  device.pushErrorScope('validation');
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const context = canvas.getContext('webgpu');
  try {
    if (!context) throw new Error('RAW preview canvas is unavailable');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque', colorSpace: 'srgb' });
    const storage = GPUBufferUsage.STORAGE;
    const writableStorage = storage | GPUBufferUsage.COPY_DST;
    const upload = (
      values: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Int32Array<ArrayBuffer>,
      usage: number,
    ) => {
      const buffer = device.createBuffer({
        size: values.byteLength,
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, values);
      return buffer;
    };
    const original = device.createBuffer({ size: sourceBytes, usage: writableStorage });
    const lookup = upload(normalizedRawCodes(), storage);
    const geometry = upload(
      new Uint32Array([
        width,
        height,
        outputWidth,
        outputHeight,
        y.average,
        y.reduced,
        y.taps,
        0,
        x.average,
        x.reduced,
        x.taps,
        0,
      ]),
      GPUBufferUsage.UNIFORM,
    );
    const parameters = device.createBuffer({ size: RAW_GRADE_WORDS * 4, usage: writableStorage });
    const vertical = device.createBuffer({ size: verticalBytes, usage: storage });
    const horizontal = device.createBuffer({ size: horizontalBytes, usage: storage });
    const rows = upload(y.table, storage);
    const columns = upload(x.table, storage);
    const pixels16 = device.createBuffer({ size: outputBytes, usage: storage });
    const buffers = [
      original,
      lookup,
      geometry,
      parameters,
      vertical,
      horizontal,
      rows,
      columns,
      pixels16,
      pixels16,
    ];
    const module = device.createShaderModule({ code: shader });
    const bind = (layout: GPUBindGroupLayout, bindings: readonly number[]) =>
      device.createBindGroup({
        layout,
        entries: bindings.map((binding) => ({ binding, resource: { buffer: buffers[binding]! } })),
      });

    const [passes, render] = await Promise.all([
      Promise.all(
        (
          [
            ['developRows', [0, 1, 2, 3, 4], width, y.reduced],
            ['reduceRows', [2, 4, 5, 6], x.reduced, outputHeight],
            ['reduceColumns', [2, 5, 7, 8], outputWidth, outputHeight],
          ] as const
        ).map(async ([entryPoint, bindings, width, height]) => {
          const pipeline = await device.createComputePipelineAsync({
            layout: 'auto',
            compute: { module, entryPoint },
          });
          return { pipeline, group: bind(pipeline.getBindGroupLayout(0), bindings), width, height };
        }),
      ),
      device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module, entryPoint: 'draw' },
        fragment: { module, entryPoint: 'pixel', targets: [{ format }] },
      }),
    ]);
    const display = bind(render.getBindGroupLayout(0), [2, 9]);
    const invalid = await device.popErrorScope();
    const allocation = await device.popErrorScope();
    if (invalid || allocation) throw new Error('RAW preview GPU initialization failed');

    const response = await fetch(`/v1/assets/${encodeURIComponent(assetId)}/media/linearMaster`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(180_000),
    });
    await streamRawMaster(response, master, async (top, band) => {
      device.queue.writeBuffer(original, top * width * 6, band);
      await device.queue.onSubmittedWorkDone();
    });

    return {
      async frame(edit: PrecisionEdit) {
        device.queue.writeBuffer(parameters, 0, rawGradeParameters(edit, width, height));
        const command = device.createCommandEncoder();
        for (const { pipeline, group, width, height } of passes) {
          const pass = command.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group);
          pass.dispatchWorkgroups(
            Math.ceil(width / WORKGROUP_WIDTH),
            Math.ceil(height / WORKGROUP_HEIGHT),
          );
          pass.end();
        }
        const image = command.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: [0, 0, 0, 1],
            },
          ],
        });
        image.setPipeline(render);
        image.setBindGroup(0, display);
        image.draw(3);
        image.end();
        device.queue.submit([command.finish()]);
        await device.queue.onSubmittedWorkDone();
        return canvas.transferToImageBitmap();
      },
    };
  } catch (error) {
    context?.unconfigure();
    device.destroy();
    throw error;
  }
}
