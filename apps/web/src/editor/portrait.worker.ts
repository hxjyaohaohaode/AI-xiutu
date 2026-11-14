import {
  FaceLandmarker,
  FaceDetector,
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
  analyzeFacePixels,
  analyzeHeadBoundaries,
  measureBodySections,
  visibleFaceParts,
  visibleEyeAccessories,
  visibleMeshLighting,
  OBSERVED_PORTRAIT_ANALYSIS,
  anchoredSubjectPrior,
  type PortraitAnalysis,
  type PortraitTarget,
} from '@ai-xiutu/portrait';
import { portraitAnalysisErrorMessage } from './portrait-analysis-errors';
import {
  analysisCanvas,
  confidenceRaster,
  confidenceSampler,
  confidenceWeight,
  detectFaceDetails,
  entireFrame,
  faceWindow,
  headWindow,
  observeBodies,
  poseEditCorridor,
  recoverDistantFaces,
} from './portrait-refinement';

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
function subjectMatte(background: Float32Array, width: number, height: number) {
  for (const edge of [160, 128, 96, 64, 40]) {
    const w = Math.max(1, Math.round(edge * Math.min(1, width / height)));
    const h = Math.max(1, Math.round(edge * Math.min(1, height / width)));
    const pixels = new Uint8Array(w * h);
    let foreground = false,
      outside = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const probability =
          background[
            Math.floor(((y + 0.5) * height) / h) * width + Math.floor(((x + 0.5) * width) / w)
          ]!;
        if (!Number.isFinite(probability)) return undefined;
        const value = Math.min(1, Math.max(0, (0.94 - probability) / 0.88));
        foreground ||= value > 0.96;
        outside ||= value < 0.04;
        pixels[y * w + x] = Math.round(value * 15) * 17;
      }
    }
    if (!foreground || !outside) return undefined;
    try {
      return createRasterMask(w, h, pixels);
    } catch (error) {
      if (edge === 40) throw error;
    }
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
      algorithmVersion: OBSERVED_PORTRAIT_ANALYSIS,
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
      const oval = (points: Point[]) =>
        contourLoops(points, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL)[0] ?? [];
      const primary = detectFaceDetails(canvas, face, oval);
      let found = primary;
      if (
        manifest.assets?.some(
          (asset: { file?: string }) => asset.file === 'blaze_face_full_range.tflite',
        )
      ) {
        try {
          found = await recoverDistantFaces(
            canvas,
            face,
            () =>
              FaceDetector.createFromOptions(freshWasm(), {
                canvas: new OffscreenCanvas(1, 1),
                baseOptions: {
                  modelAssetPath: '/vision/blaze_face_full_range.tflite',
                  delegate: 'CPU',
                },
                runningMode: 'IMAGE',
                minDetectionConfidence: 0.58,
                minSuppressionThreshold: 0.35,
              }),
            primary,
            oval,
          );
        } catch (error) {
          if (import.meta.env.DEV) console.error('Wide-range face detector unavailable', error);
          result.warnings.push('远景人脸补充识别未完成。');
        }
      }
      const targets = found.map((points) => {
        const shape = contours(points);
        return {
          landmarks: points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
          contours: shape,
          bounds: boundsOf(shape.oval),
        };
      });
      result.targets = targets.map((t, i) => ({
        ...t,
        id: `face-${hash.slice(0, 12)}-${i + 1}`,
        kind: 'face',
        label: `人物 ${i + 1}`,
      }));
      for (const target of result.targets) {
        if (Math.min(target.bounds.width * image.width, target.bounds.height * image.height) < 34)
          continue;
        const relight = visibleMeshLighting(
          target,
          image,
          FaceLandmarker.FACE_LANDMARKS_TESSELATION,
        );
        if (relight) target.featureMasks = { relight };
      }
    } finally {
      face.close();
    }
    if (segmentation) {
      progress('正在分离皮肤、头发与背景');
      let segment: ImageSegmenter | null = null;
      const overview = analysisCanvas(canvas, entireFrame, 576);
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
        segment.segment(overview, (output) => {
          const mask = output.categoryMask;
          if (!mask) throw new Error('没有分割结果');
          const data = mask.getAsUint8Array();
          const confidence = output.confidenceMasks?.[0];
          const hair = output.confidenceMasks?.[1]?.getAsFloat32Array();
          const bodySkin = output.confidenceMasks?.[2]?.getAsFloat32Array();
          const faceSkin = output.confidenceMasks?.[3]?.getAsFloat32Array();
          const accessory = output.confidenceMasks?.[5];
          const background = confidence?.getAsFloat32Array();
          if (accessory) {
            const probabilities = accessory.getAsFloat32Array();
            for (const target of result.targets) {
              const mask = visibleEyeAccessories(probabilities, accessory, target);
              if (mask) target.featureMasks = { ...target.featureMasks, accessories: mask };
            }
          }
          const subject = confidence
            ? subjectMatte(
                anchoredSubjectPrior(
                  background!,
                  data,
                  confidence.width,
                  confidence.height,
                  result.targets.map((target) => ({
                    x: target.bounds.x + target.bounds.width / 2,
                    y: target.bounds.y + target.bounds.height / 2,
                  })),
                ),
                confidence.width,
                confidence.height,
              )
            : undefined;
          const grid = (weight: (index: number) => number, budget?: number) =>
            confidenceRaster(mask.width, mask.height, weight, 192, budget) ??
            createRasterMask(1, 1, new Uint8Array(1));
          result.segmentation = {
            skin: grid(
              (at) =>
                confidenceWeight(
                  faceSkin && bodySkin
                    ? faceSkin[at]! + bodySkin[at]!
                    : Number(data[at] === 2 || data[at] === 3),
                  0.44,
                  0.86,
                ),
              1800,
            ),
            hair: grid((at) => confidenceWeight(hair?.[at] ?? Number(data[at] === 1), 0.29, 0.83)),
            background: grid((at) =>
              confidenceWeight(background?.[at] ?? Number(data[at] === 0), 0.3, 0.88),
            ),
            ...(subject ? { subject } : {}),
          };
        });
        for (const target of result.targets) {
          if (Math.min(target.bounds.width * image.width, target.bounds.height * image.height) < 34)
            continue;
          const window = faceWindow(canvas, target.bounds, 1.3);
          if (Math.min(window.width * canvas.width, window.height * canvas.height) < 28) continue;
          const crop = analysisCanvas(canvas, window, 448);
          try {
            segment.segment(crop, (output) => {
              const skin = output.confidenceMasks?.[3];
              if (!skin) return;
              const pixels = skin.getAsFloat32Array();
              const accessory = output.confidenceMasks?.[5]?.getAsFloat32Array();
              const hair = output.confidenceMasks?.[1]?.getAsFloat32Array();
              const alpha = accessory
                ? confidenceRaster(
                    skin.width,
                    skin.height,
                    (at) => {
                      const u = window.x + (((at % skin.width) + 0.5) / skin.width) * window.width;
                      const v =
                        window.y +
                        ((Math.floor(at / skin.width) + 0.5) / skin.height) * window.height;
                      const b = target.bounds;
                      if (
                        u < b.x - b.width * 0.05 ||
                        u > b.x + b.width * 1.05 ||
                        v < b.y + b.height * 0.15 ||
                        v > b.y + b.height * 1.04
                      )
                        return 0;
                      return confidenceWeight(accessory[at]!, 0.36, 0.68);
                    },
                    120,
                    800,
                    window,
                  )
                : undefined;
              const faceSkin = confidenceRaster(
                skin.width,
                skin.height,
                (at) => {
                  const confidence = confidenceWeight(pixels[at]!, 0.43, 0.84);
                  const occlusion = confidenceWeight(
                    Math.max(accessory?.[at] ?? 0, hair?.[at] ?? 0),
                    0.23,
                    0.68,
                  );
                  return confidence * (1 - occlusion);
                },
                128,
                900,
                window,
              );
              if (faceSkin) target.featureMasks = { ...target.featureMasks, skin: faceSkin };
              if (alpha) target.featureMasks = { ...target.featureMasks, accessories: alpha };
            });
          } finally {
            crop.width = crop.height = 1;
          }
          const head = headWindow(target.bounds);
          const headCrop = analysisCanvas(canvas, head, 448);
          try {
            segment.segment(headCrop, (output) => {
              const masks = output.confidenceMasks;
              if (!masks?.[0] || !masks[1] || !masks[3]) return;
              const samplers = masks.map((mask) =>
                confidenceSampler(mask.getAsFloat32Array(), mask.width, mask.height, head),
              );
              Object.assign(
                target.contours,
                analyzeHeadBoundaries(
                  target,
                  image,
                  head,
                  (index, point) => samplers[index]?.(point) ?? 0,
                  result.targets
                    .filter((person) => person !== target)
                    .map((person) => person.bounds),
                ),
              );
            });
          } finally {
            headCrop.width = headCrop.height = 1;
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Portrait segmentation unavailable', error);
        result.warnings.push('皮肤分割未完成，当前只使用面部轮廓并排除五官；请检查蒙版。');
      } finally {
        overview.width = overview.height = 1;
        segment?.close();
      }
    }
    for (const target of result.targets) {
      target.visibleParts = visibleFaceParts(image, target);
      if (target.visibleParts.pixels < 34) continue;
      const evidence = analyzeFacePixels(image, target);
      Object.assign(target.contours, evidence.contours);
      if (evidence.featureMasks && Object.keys(evidence.featureMasks).length)
        target.featureMasks = { ...target.featureMasks, ...evidence.featureMasks };
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
          outputSegmentationMasks: true,
        });
        const observations = observeBodies(
          canvas,
          pose,
          result.targets.map((target) => target.bounds),
        );
        const targets = observations.flatMap(({ points, sample }, index) => {
          try {
            const target: PortraitTarget = {
              id: '',
              kind: 'body',
              label: '',
              landmarks: points.map(({ x, y, z, visibility }) => ({ x, y, z, visibility })),
              contours: {},
              bounds: boundsOf(points.filter((p) => p.visibility > 0.55)),
            };
            if (sample) {
              const neighbor = (p: Point) =>
                observations.reduce(
                  (maximum, other, i) =>
                    i === index ? maximum : Math.max(maximum, other.sample?.(p) ?? 0),
                  0,
                );
              target.contours = measureBodySections(target, image, sample, neighbor, true);
              const { x, y, width, height } = target.bounds;
              const x0 = Math.max(0, x - width * 0.28);
              const y0 = Math.max(0, y - height * 0.14);
              const extent = {
                x: x0,
                y: y0,
                width: Math.min(1, x + width * 1.28) - x0,
                height: Math.min(1, y + height * 1.14) - y0,
              };
              const ew = extent.width * image.width;
              const eh = extent.height * image.height;
              const scale = Math.min(1, 144 / Math.max(ew, eh));
              const w = Math.max(1, Math.round(ew * scale)),
                h = Math.max(1, Math.round(eh * scale));
              const samples = Float32Array.from({ length: w * h }, (_, i) =>
                sample({
                  x: extent.x + (((i % w) + 0.5) / w) * extent.width,
                  y: extent.y + ((Math.floor(i / w) + 0.5) / h) * extent.height,
                }),
              );
              const mask = confidenceRaster(
                w,
                h,
                (i) => confidenceWeight(samples[i]!, 0.31, 0.76),
                144,
                630,
                extent,
              );
              if (mask) {
                target.bodyMask = mask;
                const a = points[11]!,
                  b = points[12]!;
                const shoulder = Math.hypot((a.x - b.x) * image.width, (a.y - b.y) * image.height);
                const support = poseEditCorridor(samples, w, h, ew, eh, shoulder);
                const corridor = support && confidenceRaster(w, h, support, 144, 740, extent);
                if (corridor) target.bodySupport = corridor;
              }
            }
            return [target];
          } catch {
            // A partly out-of-frame detection may have no usable bounds.
            return [];
          }
        });
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
      error: portraitAnalysisErrorMessage(error),
      diagnostic: import.meta.env.DEV && error instanceof Error ? error.stack : undefined,
    });
  } finally {
    active = false;
  }
};
