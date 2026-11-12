import { srgbToLinear, type PrecisionEdit } from '@ai-xiutu/editor';
import {
  linearFitGeometry,
  fitGradeParameters,
  FIT_GRADE_WORDS,
  type LinearFitArea,
} from './linear-fit-parameters';
import {
  normalizedRawCodes,
  streamLinearMaster,
  type FitMasterEncoding,
  type LinearMaster,
} from './linear-master-stream';
import { streamTiffMaster } from './tiff-master-stream';
import shader from './linear-fit.wgsl?raw';

const MAX_GPU_BYTES = 768 * 1024 ** 2;
const WORKGROUP_WIDTH = 16;
const WORKGROUP_HEIGHT = 8;

export async function openLinearFitGpu(
  assetId: string,
  master: LinearMaster,
  encoding: FitMasterEncoding,
  onLost: () => void,
) {
  const { width, height } = master;
  const pixels = width * height;
  if (
    ![width, height].every((side) => Number.isSafeInteger(side) && side > 0 && side <= 16_384) ||
    pixels > 64_000_000
  )
    throw new Error('Unsupported linear preview dimensions');
  const displayHdr = encoding === 'display-hdr';
  const sourceBytes = displayHdr ? pixels * 12 : Math.ceil((pixels * 3) / 2) * 4;
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || adapter.info.isFallbackAdapter)
    throw new Error('Linear preview GPU is unavailable');
  const bindingLimit = Math.min(
    MAX_GPU_BYTES,
    adapter.limits.maxBufferSize,
    adapter.limits.maxStorageBufferBindingSize,
  );
  if (sourceBytes > bindingLimit) throw new Error('Linear preview GPU is unavailable');
  const device = await adapter.requestDevice({
    requiredLimits: { maxBufferSize: bindingLimit, maxStorageBufferBindingSize: bindingLimit },
  });
  void device.lost.then(onLost);
  device.addEventListener('uncapturederror', onLost);
  device.pushErrorScope('out-of-memory');
  device.pushErrorScope('validation');
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext('webgpu');
  try {
    if (!context) throw new Error('Linear preview canvas is unavailable');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque', colorSpace: 'srgb' });
    const storage = GPUBufferUsage.STORAGE;
    const writableStorage = storage | GPUBufferUsage.COPY_DST;
    const upload = (values: Float32Array<ArrayBuffer> | Int32Array<ArrayBuffer>) => {
      const buffer = device.createBuffer({ size: values.byteLength, usage: writableStorage });
      device.queue.writeBuffer(buffer, 0, values);
      return buffer;
    };
    const original = device.createBuffer({ size: sourceBytes, usage: writableStorage });
    const lookup = upload(
      displayHdr
        ? new Float32Array(1)
        : encoding === 'srgb-master'
          ? Float32Array.from({ length: 65_536 }, (_, code) => srgbToLinear(code / 65_535))
          : normalizedRawCodes(),
    );
    const geometry = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const parameters = device.createBuffer({ size: FIT_GRADE_WORDS * 4, usage: writableStorage });
    const module = device.createShaderModule({ code: shader });
    const [passes, render] = await Promise.all([
      Promise.all(
        (
          [
            ['developRows', [0, 1, 2, 3, 4]],
            ['reduceRows', [2, 4, 5, 6]],
            ['reduceColumns', [2, 5, 7, 8]],
          ] as const
        ).map(async ([entryPoint, bindings]) => {
          const pipeline = await device.createComputePipelineAsync({
            layout: 'auto',
            compute: { module, entryPoint },
          });
          return { pipeline, bindings };
        }),
      ),
      device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module, entryPoint: 'draw' },
        fragment: { module, entryPoint: 'pixel', targets: [{ format }] },
      }),
    ]);
    const invalid = await device.popErrorScope();
    const allocation = await device.popErrorScope();
    if (invalid || allocation) throw new Error('Linear preview GPU initialization failed');

    const response = await fetch(
      '/v1/assets/' +
        encodeURIComponent(assetId) +
        '/media/' +
        (encoding === 'srgb-master' ? 'master' : 'linearMaster'),
      {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(180_000),
      },
    );
    const uploadBand = async (
      top: number,
      band: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
    ) => {
      device.queue.writeBuffer(original, top * width * 3 * band.BYTES_PER_ELEMENT, band);
      await device.queue.onSubmittedWorkDone();
    };
    if (encoding === 'srgb-master') await streamTiffMaster(response, master, uploadBand);
    else await streamLinearMaster(response, master, encoding, uploadBand);

    function makePlan(inputWidth: number, inputHeight: number, maxEdge: number) {
      const shape = linearFitGeometry(inputWidth, inputHeight, maxEdge);
      const { outputWidth, outputHeight, x, y } = shape;
      const verticalBytes = inputWidth * y.reduced * 8;
      const horizontalBytes = x.reduced * outputHeight * 8;
      const outputBytes = outputWidth * outputHeight * 8;
      const bytes = [
        verticalBytes,
        horizontalBytes,
        outputBytes,
        x.table.byteLength,
        y.table.byteLength,
      ];
      const fixed = sourceBytes + lookup.size + geometry.size + parameters.size;
      if (
        Math.max(...bytes) > bindingLimit ||
        bytes.reduce((sum, size) => sum + size, fixed) > MAX_GPU_BYTES
      )
        throw new Error('Linear preview exceeds its GPU budget');
      const vertical = device.createBuffer({ size: verticalBytes, usage: storage });
      const horizontal = device.createBuffer({ size: horizontalBytes, usage: storage });
      const pixels16 = device.createBuffer({ size: outputBytes, usage: storage });
      const rows = upload(y.table);
      const columns = upload(x.table);
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
      const bind = (layout: GPUBindGroupLayout, bindings: readonly number[]) =>
        device.createBindGroup({
          layout,
          entries: bindings.map((binding) => ({
            binding,
            resource: { buffer: buffers[binding]! },
          })),
        });
      const dimensions = [
        [inputWidth, y.reduced],
        [x.reduced, outputHeight],
        [outputWidth, outputHeight],
      ] as const;
      return {
        shape,
        stages: passes.map(({ pipeline, bindings }, index) => ({
          pipeline,
          group: bind(pipeline.getBindGroupLayout(0), bindings),
          dimensions: dimensions[index]!,
        })),
        display: bind(render.getBindGroupLayout(0), [2, 9]),
        destroy: () => {
          for (const buffer of [vertical, horizontal, pixels16, rows, columns]) buffer.destroy();
        },
      };
    }
    let plan: ReturnType<typeof makePlan> | undefined;
    let planKey = '';
    return {
      async frame(edit: PrecisionEdit, { region, maxEdge }: LinearFitArea) {
        const area = region ?? { left: 0, top: 0, width, height };
        if (
          ![area.left, area.top, area.width, area.height, maxEdge].every(Number.isSafeInteger) ||
          area.left < 0 ||
          area.top < 0 ||
          area.width < 1 ||
          area.height < 1 ||
          area.left + area.width > width ||
          area.top + area.height > height ||
          maxEdge < 128 ||
          maxEdge > 2048
        )
          throw new Error('Invalid linear preview area');
        const key = [area.width, area.height, maxEdge].join(':');
        if (!plan || planKey !== key) {
          plan?.destroy();
          plan = makePlan(area.width, area.height, maxEdge);
          planKey = key;
          canvas.width = plan.shape.outputWidth;
          canvas.height = plan.shape.outputHeight;
        }
        const { outputWidth, outputHeight, x, y } = plan.shape;
        device.queue.writeBuffer(
          geometry,
          0,
          new Uint32Array([
            width,
            height,
            area.left,
            area.top,
            area.width,
            area.height,
            outputWidth,
            outputHeight,
            y.average,
            y.reduced,
            y.taps,
            Number(displayHdr),
            x.average,
            x.reduced,
            x.taps,
            0,
          ]),
        );
        device.queue.writeBuffer(
          parameters,
          0,
          fitGradeParameters(edit, width, height, displayHdr),
        );
        const command = device.createCommandEncoder();
        for (const {
          pipeline,
          group,
          dimensions: [width, height],
        } of plan.stages) {
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
        image.setBindGroup(0, plan.display);
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
