import {
  FaceLandmarker,
  PoseLandmarker,
  ImageSegmenter,
  FilesetResolver,
} from '@mediapipe/tasks-vision';
import {
  createRasterMask,
  type RGBAImage,
  type SelectionMaskV3,
  type Point,
} from '@ai-xiutu/editor';
import {
  boundsOf,
  contourLoops,
  contourHull,
  type PortraitAnalysis,
  type PortraitTarget,
} from '@ai-xiutu/portrait';

type Request = {
  id: number;
  image: RGBAImage;
  width: number;
  height: number;
  body: boolean;
  segmentation: boolean;
  contentHash: string;
};
const ALGORITHM = 'mediapipe-v1-selfie256';
function limitMask(
  data: Uint8Array,
  width: number,
  height: number,
  ids: number[],
): SelectionMaskV3 {
  // The bounded category grid is intentionally a coarse selection, not a pixel-perfect matte.
  let edge = 128;
  for (;;) {
    const w = Math.max(1, Math.round(edge * Math.min(1, width / height))),
      h = Math.max(1, Math.round(edge * Math.min(1, height / width)));
    const pixels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        pixels[y * w + x] = ids.includes(
          data[
            Math.min(height - 1, Math.floor(((y + 0.5) * height) / h)) * width +
              Math.min(width - 1, Math.floor(((x + 0.5) * width) / w))
          ]!,
        )
          ? 255
          : 0;
    try {
      return createRasterMask(w, h, pixels);
    } catch (error) {
      if (edge <= 32) throw error;
      edge /= 2;
    }
  }
}
function subjectMatte(background: Float32Array, width: number, height: number) {
  for (const edge of [160, 128, 96, 64, 40]) {
    const w = Math.max(1, Math.round(edge * Math.min(1, width / height)));
    const h = Math.max(1, Math.round(edge * Math.min(1, height / width)));
    const pixels = new Uint8Array(w * h);
    let foreground = false, outside = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const probability = background[Math.floor((y + 0.5) * height / h) * width + Math.floor((x + 0.5) * width / w)]!;
        if (!Number.isFinite(probability)) return undefined;
        const value = Math.min(1, Math.max(0, (0.94 - probability) / 0.88));
        foreground ||= value > 0.96;
        outside ||= value < 0.04;
        pixels[y * w + x] = Math.round(value * 15) * 17;
      }
    }
    if (!foreground || !outside) return undefined;
    try { return createRasterMask(w, h, pixels); }
    catch (error) { if (edge === 40) throw error; }
  }
}
function contours(points: Point[]) {
  const first = (connections: { start: number; end: number }[]) =>
    contourLoops(points, connections)[0] ?? [];
  const lips = contourLoops(points, FaceLandmarker.FACE_LANDMARKS_LIPS);
  return {
    oval: first(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL),
    leftEye: first(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE),
    rightEye: first(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE),
    leftBrow: contourHull(points, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW),
    rightBrow: contourHull(points, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW),
    lips: lips[0] ?? [],
    innerLips: lips[1] ?? [],
  };
}
let active = false;
let loaderGeneration = 0;
self.onmessage = async (event: MessageEvent<Request>) => {
  if (active) {
    self.postMessage({ id: event.data.id, error: '另一项人像分析尚未结束。' });
    return;
  }
  active = true;
  const { id, image, width, height, body, segmentation } = event.data;
  const progress = (message: string) => self.postMessage({ id, progress: message });
  try {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      image.width * image.height > 4_194_304 ||
      image.data.length !== image.width * image.height * 4
    )
      throw new Error('人像分析输入超出预算。');
    if (typeof OffscreenCanvas === 'undefined')
      throw new Error(
        '当前浏览器不支持后台图像分析；可以继续手动精修，或在支持 OffscreenCanvas 的浏览器中识别。',
      );
    const graphicsProbe = new OffscreenCanvas(1, 1);
    const graphicsContext = graphicsProbe.getContext('webgl2');
    if (!graphicsContext)
      throw new Error(
        '当前浏览器没有可用的 WebGL 2，自动人物识别无法运行。请检查浏览器图形加速；手动局部、涂妆和液化仍可使用。',
      );
    graphicsContext.getExtension('WEBGL_lose_context')?.loseContext();
    const manifestResponse = await fetch('/vision/manifest.json', {
      signal: AbortSignal.timeout(10000),
      credentials: 'same-origin',
    });
    if (!manifestResponse.ok)
      throw new Error(
        '本地人像模型尚未安装；请由部署人员运行 vision:prepare。仍可使用手动局部与液化。',
      );
    const manifest = await manifestResponse.json();
    if (
      manifest.schemaVersion !== 1 ||
      manifest.sdkVersion !== '1.2.2' ||
      manifest.algorithmVersion !== ALGORITHM
    )
      throw new Error('人像模型资源版本与当前程序不一致。');
    const hash = event.data.contentHash;
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('缺少原始图像指纹。');
    const result: PortraitAnalysis = {
      schemaVersion: 1,
      provider: 'mediapipe',
      algorithmVersion: ALGORITHM,
      frame: {
        coordinates: 'source-normalized',
        contentHash: hash,
        width,
        height,
        orientation: 'normalized',
      },
      targets: [],
      segmentation: null,
      warnings: [],
    };
    const canvas = new OffscreenCanvas(image.width, image.height),
      ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前设备不能创建分析画布。');
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
    const wasm = await FilesetResolver.forVisionTasks('/vision/wasm', true);
    // The pinned SDK clears self.ModuleFactory after each task initialization.
    // Module-worker import() caches the loader, so a second task otherwise fails
    // with "ModuleFactory not set". Give each initialization a distinct module
    // URL; the actual WASM binary remains the same pinned, same-origin resource.
    const freshWasm = () => {
      const loader = new URL(wasm.wasmLoaderPath, self.location.origin);
      loader.searchParams.set('instance', String(++loaderGeneration));
      return { ...wasm, wasmLoaderPath: loader.toString() };
    };
    progress('正在定位面部关键点');
    const face = await FaceLandmarker.createFromOptions(freshWasm(), {
      canvas: new OffscreenCanvas(1, 1),
      baseOptions: { modelAssetPath: '/vision/face_landmarker.task', delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 8,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6,
    });
    try {
      const found = face.detect(canvas).faceLandmarks;
      const targets = found
        .flatMap((points) => {
          try {
            const shape = contours(points),
              bounds = boundsOf(shape.oval);
            return [
              {
                landmarks: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
                contours: shape,
                bounds,
              },
            ];
          } catch {
            return [];
          }
        })
        .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
      result.targets = targets.map((t, i) => ({
        ...t,
        id: `face-${hash.slice(0, 12)}-${i + 1}`,
        kind: 'face',
        label: `人物 ${i + 1}`,
      }));
    } finally {
      face.close();
    }
    if (segmentation) {
      progress('正在分离皮肤、头发与背景');
      let segment: ImageSegmenter | null = null;
      try {
        segment = await ImageSegmenter.createFromOptions(freshWasm(), {
          canvas: new OffscreenCanvas(1, 1),
          baseOptions: {
            modelAssetPath: '/vision/selfie_multiclass_256x256.tflite',
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          outputCategoryMask: true,
          outputConfidenceMasks: true,
        });
        segment.segment(canvas, (output) => {
          const mask = output.categoryMask;
          if (!mask) throw new Error('没有分割结果');
          const data = mask.getAsUint8Array();
          const confidence = output.confidenceMasks?.[0];
          const subject = confidence ? subjectMatte(confidence.getAsFloat32Array(), confidence.width, confidence.height) : undefined;
          result.segmentation = {
            skin: limitMask(data, mask.width, mask.height, [2, 3]),
            hair: limitMask(data, mask.width, mask.height, [1]),
            background: limitMask(data, mask.width, mask.height, [0]),
            ...(subject ? { subject } : {}),
          };
        });
      } catch (error) {
        if (import.meta.env.DEV) console.error('Portrait segmentation unavailable', error);
        result.warnings.push('皮肤分割未完成，当前只使用面部轮廓并排除五官；请检查蒙版。');
      } finally {
        segment?.close();
      }
    }
    if (body) {
      progress('正在定位身体关键点');
      let pose: PoseLandmarker | null = null;
      try {
        pose = await PoseLandmarker.createFromOptions(freshWasm(), {
          canvas: new OffscreenCanvas(1, 1),
          baseOptions: { modelAssetPath: '/vision/pose_landmarker_lite.task', delegate: 'CPU' },
          runningMode: 'IMAGE',
          numPoses: 8,
          minPoseDetectionConfidence: 0.6,
          minPosePresenceConfidence: 0.6,
          outputSegmentationMasks: false,
        });
        const poses = pose.detect(canvas).landmarks;
        const targets: PortraitTarget[] = poses
          .flatMap((points) => {
            try {
              return [
                {
                  id: '',
                  kind: 'body' as const,
                  label: '',
                  landmarks: points.map((p) => ({
                    x: p.x,
                    y: p.y,
                    z: p.z,
                    visibility: p.visibility,
                  })),
                  contours: {},
                  bounds: boundsOf(points.filter((p) => (p.visibility ?? 0) > 0.5)),
                },
              ];
            } catch {
              return [];
            }
          })
          .sort((a, b) => a.bounds.x - b.bounds.x);
        result.targets.push(
          ...targets.map((t, i) => ({
            ...t,
            id: `body-${hash.slice(0, 12)}-${i + 1}`,
            label: `身形 ${i + 1}`,
          })),
        );
      } catch (error) {
        if (import.meta.env.DEV) console.error('Portrait pose unavailable', error);
        result.warnings.push('身体关键点未完成；面部结果仍可使用。');
      } finally {
        pose?.close();
      }
    }
    canvas.width = 1;
    canvas.height = 1;
    self.postMessage({ id, result });
  } catch (error) {
    if (import.meta.env.DEV) console.error('Portrait analysis failed', error);
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : '人像分析失败，请使用手动选区。',
      diagnostic: import.meta.env.DEV && error instanceof Error ? error.stack : undefined,
    });
  } finally {
    active = false;
  }
};
