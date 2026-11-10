# @ai-xiutu/editor

**当前统一入口已支持 Recipe v4。** [V4 契约与预算](V4.md) 包括真正四角投影、带保护的谐和/梯度域局部修复、六种独立质感算子，以及统一坐标/裁切映射。中性迁移保持旧版像素不漂移；服务器 200MP/高位深母版另见 [media](../media/README.md)，不能混同为浏览器高位深编辑。

[V3 算法、扩展与完整契约](V3.md) 仍定义已发布的精细构图、完整局部色彩/曲线、组联动、复合蒙版、绘制/仿制/16种混合、图像图层、手动液化与背景保护。下文 v1/v2 章节也保留原算法定义。

无 DOM、网络、模型依赖的 TypeScript CPU 图像参考引擎。提供版本固定的基础调色、曲线、无插值几何变换，以及 v2 新增的色阶、连续插值 HSL、色彩分级、纹理/清晰度、暗角/颗粒和多种手动局部选区。配方是非破坏性的 JSON：原图与配方分开保存，每次从原始输入计算结果。已发布的 v1 解释器保留；v2 是显式版本，不会静默改变旧配方的效果。

本包不是完整的 125 项编辑功能实现，也不包含人脸识别、肤色识别、自动磨皮、五官形变、多人实例分割、隐私销毁或 AI 修图。`soften` 是手动选择作用区域的局部平滑算法；把它用于人像不使它变成人脸模型。

## v1 最小使用方式与兼容约定

```ts
import {
  createRecipe,
  renderRecipe,
  parseRecipe,
  validateRecipe,
  type RGBAImage,
} from '@ai-xiutu/editor';

// EXIF 方向已应用，RGBA8，直通 alpha，显示编码 sRGB。
const source: RGBAImage = {
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([64, 64, 64, 255, 128, 128, 128, 255]),
};
const recipe = createRecipe({ adjustments: { exposure: 1 } });
const rendered = renderRecipe(source, recipe);
// rendered.data: [90, 90, 90, 255, 176, 176, 176, 255]
// source 和 recipe 均不会被修改。

const savedJson = JSON.stringify(recipe);
const restored = parseRecipe(JSON.parse(savedJson)); // 无效时抛 RecipeValidationError
const result = validateRecipe(JSON.parse(savedJson)); // UI 可用的判别联合
if (!result.valid) console.error(result.errors);
```

`DEFAULT_RECIPE` 是深度冻结的默认对象。使用 `createRecipe()` 获取独立可编辑副本；它也可深度合并白名单内的部分覆盖值。服务端保存来自请求的 JSON 前，应使用 `parseRecipe(input: unknown)`；它会返回重新构造的完整有效对象。`validateRecipe(input)` 返回 `{valid: true, recipe, errors: []}` 或 `{valid: false, errors: string[]}`。

## 配方与验证约束

旧入口 `createRecipe/parseRecipe/validateRecipe/renderRecipe/renderRecipeTiled` 继续只处理 `schemaVersion: 1`、`engineVersion: '1.0.0'`。完整 v1 配方包含 `adjustments`、`curves`、`geometry`、`local`，具体接口由 `src/types.ts` 导出。只有 `createRecipe()` 负责补齐默认值，`parseRecipe()` 不会静默补齐不完整的持久化对象。新版通用入口及 v2 模型见下方“Recipe v2 与显式迁移”。

验证器拒绝未知属性、未知版本、非有限数值、超界数值、非法原型、符号属性、属性访问器、非法数组结构及曲线点；不会读取执行 getter。部分配方构建也拒绝循环、过深结构和 `__proto__`、`constructor`、`prototype` 等不安全键。无效的、暂时禁用的局部设置仍会被拒绝，以免保存不能解释的状态。配方是数据，不是执行脚本。

`TOOLS` 是 13 个冻结的工具定义组成的数组，包含 `id`、中文 `label`、`min/max/step`、`neutral`、`unit`、`group`、`description`、`domain`。滑杆 UI 应直接采用此注册表。这里的 `%` 是归一化工具强度标签，并非摄影测量单位。

| 参数          | 范围 / 步长    | 0 与正负方向                           | 实际运算域           |
| ------------- | -------------- | -------------------------------------- | -------------------- |
| `exposure`    | −3…3 EV / 0.05 | 0 恒等；正值增加线性光增益             | 线性 sRGB            |
| `brightness`  | −100…100 / 1   | 正值提高中间调，负值降低；黑白端点保留 | 编码 sRGB 的亮度代理 |
| `contrast`    | −100…100 / 1   | 正值拉开 0.5 两侧，负值收拢            | 编码 sRGB 的亮度代理 |
| `shadows`     | −100…100 / 1   | 正值提高暗部曲线节点，负值降低         | 编码 sRGB 的亮度代理 |
| `highlights`  | −100…100 / 1   | 正值提高亮部曲线节点，负值降低         | 编码 sRGB 的亮度代理 |
| `blacks`      | −100…100 / 1   | 正值抬黑，负值压黑，可发生裁切         | 编码 sRGB 的亮度代理 |
| `whites`      | −100…100 / 1   | 正值提白，负值压白，可发生裁切         | 编码 sRGB 的亮度代理 |
| `saturation`  | −100…100 / 1   | −100 去色；正值增强色度                | 编码 sRGB            |
| `vibrance`    | −100…100 / 1   | 正值较多增强低色度像素，负值减弱       | 编码 sRGB            |
| `temperature` | −100…100 / 1   | 正值偏暖，负值偏冷；相对量，非开尔文   | 线性 sRGB            |
| `tint`        | −100…100 / 1   | 正值偏洋红，负值偏绿                   | 线性 sRGB            |
| `sharpness`   | 0…100 / 1      | 0 恒等；正值添加有阈值的高频           | 线性 sRGB            |
| `soften`      | 0…100 / 1      | 0 恒等；正值增加边缘感知平滑           | 线性 sRGB            |

所有工具独立保存参数。锐化与柔化是两个非负参数，不把一个滑杆的负值伪装成另一种算法。冷暖与色偏是可重复的 RGB 相对增益，不声称与相机 RAW 白平衡或专业色适应变换等价。

## 固定的 v1 阶段与算法

整个工作主缓冲是 **Float32 线性 sRGB RGB**。明确属于感知调色的工具先转换到编码 sRGB，在其声明域操作，再返回线性工作缓冲。输入和输出都是 8 位 SDR；需要裁切到 0…1，因此它不是 HDR/RAW 保真管线。

执行顺序固定为：输入解码 → 全局曝光/冷暖/色偏 → 全局亮度/对比/暗部/亮部/黑白 → 全局饱和/自然饱和 → 主 RGB 曲线 → 各通道曲线 → 全局细节 → 局部调色及局部细节候选 → 椭圆权重线性混合 → 裁切 → 顺时针旋转 → 输出坐标翻转 → 输出编码。

### 参考数学定义

令 `e = exposure`、`t = temperature / 100`、`u = tint / 100`，线性 RGB 乘数分别为：

```text
R: 2^(e + 0.35*t + 0.12*u)
G: 2^(e          - 0.18*u)
B: 2^(e - 0.35*t + 0.12*u)
```

随后裁切到 SDR 范围并编码为 sRGB。调色用 `Y' = 0.2126R' + 0.7152G' + 0.0722B'` 作为亮度代理；它不是物理线性亮度。

- 亮度：`Y' ^ (2^(-brightness/100))`。
- 对比度：令 `k = 2^(contrast/100)`，小于 0.5 时为 `0.5*(2Y')^k`，其余为 `1 - 0.5*(2*(1-Y'))^k`。
- 暗部和亮部：以 `(0,0)`、`(0.25, 0.25 + 0.16*shadows/100)`、`(0.75, 0.75 + 0.16*highlights/100)`、`(1,1)` 分段线性插值。节点区间相邻，两者存在可解释的过渡交叠，并非语义分区。
- 黑白：在上一步 `v` 上加 `0.2*(blacks/100)*(1-v) + 0.2*(whites/100)*v`，再裁切。
- 将总亮度代理变化量等量加到三个编码通道；必要时裁切。该简化不是严格色相/色度不变的颜色科学算法。
- 饱和度：围绕当前 `Y'` 缩放通道差值。缩放因子为 `(1+saturation/100) * (1+0.75*(vibrance/100)*(1-(maxRGB'-minRGB')))`。没有肤色识别或保护承诺。

### 曲线

`curves.rgb/red/green/blue` 各有 2…16 个 `[x,y]` 点。坐标在 0…1，首末横坐标必须为 0 和 1，横坐标严格递增。纵坐标可以不单调，以允许反相等创意效果；分段线性插值无样条过冲。

先逐通道使用主 RGB 曲线，再使用对应颜色通道曲线。默认编译为 4096 项 Float32 LUT 并插值采样；`compileCurveLut(points, size)` 允许 2…65536 项。所有点满足 `x === y` 时使用恒等快速路径，避免无意义舍入。`sampleCurveLut()` 与 `radialMaskWeight()` 是已验证数据的底层计算函数，不代替 `parseRecipe()` 的输入边界。

### 细节

邻域固定为当前输入分辨率的 3×3，空间权重是 `[1,2,1]` 的外积，图像边界采用边缘像素扩展。

锐化使用 alpha 加权高斯邻域差值 `h = C - gaussian(C)`，添加 `1.5*sharpness/100 * sign(h)*max(abs(h)-0.003,0)`。柔化使用额外边缘权重 `1/(1+RGB平方距离/0.004)` 的邻域，添加 `0.8*soften/100*(bilateral(C)-C)`。两项都从**相同、不可变的该阶段输入**计算，再一起加到原值并裁切；不是先柔化再从柔化结果重新算锐化。

透明邻居以 alpha 加权，完全透明像素不参与邻域颜色混合。alpha 不模糊、不调色，输出逐像素保留对应输入 alpha；完全透明像素的隐藏 RGB 也原样保留。由此保证透明颜色不污染邻居，但本引擎没有清除隐藏信息的隐私语义。

## 局部椭圆与几何坐标

`local.enabled` 为 `false` 时局部参数全部不参与计算。启用时先从全局结果计算局部候选，仅在掩模有非零权重的地方混合；局部的锐化/柔化不会变成全局滤镜。v1 的 `local` 只有一个椭圆区域。v2 保留这个完整阶段，另提供有序 `regions`，支持画笔等手动选区；两者独立，不能在升级时自动删除旧局部效果。两版均没有语义人物蒙版或局部曲线。

局部椭圆的中心、半径和裁切框，都以**已应用 EXIF 的完整原始输入**为 0…1 坐标，不随裁切和旋转重新解释。`radiusX/radiusY` 是沿原图横纵轴的归一化半径，允许 0.0001…1。像素在 `(x+0.5)/width, (y+0.5)/height` 处采样掩模。令椭圆距离为 `d`：

- `d >= 1`：权重 0。
- `d <= 1-feather`：权重 1。
- 中间区：`t=(1-d)/feather`，权重 `t²*(3-2t)`。
- `feather=0` 为硬边；`invert=true` 取 `1-weight`。

**零权重区保持全局结果逐像素不变**。局部细节读取周围源像素来计算候选，掩模限制的是结果写入范围，不承诺候选计算完全不读取区外邻居。它不是隐私隔离蒙版。

几何顺序为裁切 → 顺时针 0/90/180/270 度旋转 → 按输出轴翻转。裁切左上取 `floor()`，右下取 `ceil()`，裁至图像边界，至少保留一个像素；这些变换都是精确像素置换，不做重采样。

```ts
import { getOutputDimensions, mapSourceToOutput, mapOutputToSource } from '@ai-xiutu/editor';

const dimensions = getOutputDimensions(source, recipe.geometry);
const displayedPoint = mapSourceToOutput(
  { x: recipe.local.mask.centerX, y: recipe.local.mask.centerY },
  source,
  recipe.geometry,
);
const originalPoint = mapOutputToSource({ x: 0.5, y: 0.5 }, source, recipe.geometry);
```

这些函数使用实际量化后的裁切边界，输入输出 `Point` 为归一化**边界坐标**；源点在裁切外时，映射结果可以超出 0…1。UI 应复用它们，避免手写第二套变换规则。

## 内存、预览和 Worker

- **必须在解码前检查头部**：先将 `await file.slice(0, MAX_HEADER_BYTES).arrayBuffer()` 包装为 `Uint8Array` 交给 `readImageHeader(bytes, {maxPixels, maxDimension})`；其中 `MAX_HEADER_BYTES = 1_048_576`。返回 `{width,height,format,animated}`；应用须在 `animated === true` 时拒绝动画，再按当前设备预算准入，最后才调用 `createImageBitmap()` 等解码器。原件超预算时不能先完整解码再缩小，应该要求用户提供较小副本或显式选择受控转换。
- 头部检查默认预算为 8192 单边、16,777,216 像素；可显式收紧，或提高到最多 16384 单边、67,108,864 像素。它与渲染预算是独立门禁：解码前传入实际设备预算，不能因为格式头合法就自动启用高分辨率。JPEG EXIF 方向不在此解析；方向应用后宽高可交换，但像素数不变。
- PNG 在首个 IDAT 前验证头部 CRC 与动画声明；8 位 baseline/extended sequential/progressive JPEG 检查到首个 SOS 并拒绝重复帧头；静态 WebP 核对 VP8X 画布与实际 VP8/VP8L 帧尺寸。BMP 仅接纳 DIB 40/108/124、未压缩 24/32 位 RGB，检查有符号尺寸、行填充和声明像素区长度。GIF 必须在完整的 1 MiB 检查预算内完成逐块扫描，静态输入要求恰好一帧和文件末尾 trailer；发现第二帧返回 `animated: true`。
- AVIF 仅接纳 `avif` 品牌、具有完整可见 metadata 的直接 `av01` 主图：核对 item ID、属性关联、唯一 `ispe` 尺寸、AV1 配置头及每个 box 的边界。拒绝 `avis`、可见 `moov`、重复关键 metadata、派生/grid 主图及预算内缺失 metadata 的布局。AVIF、GIF、BMP 的这些子集不等于对 HEIC、所有 AVIF 布局或所有 BMP 编码的普遍支持；浏览器仍可能缺少对应解码器，届时应明确报错或让用户主动转换。
- 该门禁验证可见头部，不完整解码/验证所有压缩像素、预算外后续块、ICC/EXIF 语义或浏览器解码器安全。小于 1 MiB 的输入必须是完整文件，大文件必须传入完整的前 1 MiB；块/段长度越界、不支持的签名、超过预算还无法确定必要头部等情况失败关闭。仍需限制压缩文件大小、复查实际解码后的尺寸，并考虑运行环境内存。浏览器本地格式扩展不扩大 AI 供应商的输入格式白名单，供应商适配器应独立核验或使用明确转换后的副本。
- 默认输入预算：`MAX_INPUT_PIXELS = 4_194_304`；最长单边 `MAX_DIMENSION = 8192`。
- 只有显式传入 `renderRecipe(image, recipe, {maxPixels})` 才能提高预算，上限 `MAX_EXPLICIT_PIXELS = 16_777_216`。预算必须为 1 至该上限的整数；裁切不会绕过原始输入预算。
- 原 `renderRecipe()` 的最坏路径最多两个全图 Float32 RGB 工作缓冲，加原始和输出 RGBA 字节缓冲，约 **32 字节/输入像素**：4,194,304 像素约 128 MiB，16,777,216 像素约 512 MiB。浏览器解码、Canvas、原件、缩略图、GC 等开销还要另计。高分辨率应显式选择下述分块路径；本包不提供磁盘缓冲，也不代表手机可安全处理这些上限。
- `renderRecipe()` 同步执行，应由 UI 放入 Worker。函数在开始和每 32 行附近检查 `signal.aborted`；同一线程被同步计算占用时，普通 AbortController 的后续事件不能抢占它。交互取消应终止 Worker 或以任务代次丢弃过期结果。
- 同一已接纳像素输入、同一有效配方，预览与导出调用同一个参考算法。测试验证了 Node 主线程与真实 worker_threads 的字节一致。未声称跨不同 JS 引擎/未来 GPU 路径的绝对位级一致。
- 若预览先缩小图像，细节滤镜的 3×3 是**预览像素**，在原尺寸导出中则是**原图像素**。二者是分辨率相关的效果预览，不能宣称像素一致。100% 细节检查必须用同分辨率的输入。本包不负责缩放或编码 PNG/JPEG。

可在浏览器 Worker 中导入本包，接收 `width/height`、配方 JSON 和 RGBA ArrayBuffer，运行渲染后转移返回缓冲。转移会分离发送端的 ArrayBuffer，调用方应保留独立原件或发送工作副本。Worker 之外的文件解码、导出编码、任务代次、下载交互与历史栈由应用负责。

`computeHistogram(image, options)` 返回四个 256 桶 `Uint32Array`：红、绿、蓝和编码亮度代理。完全透明像素不计数，其余像素各计一次，不按 alpha 比例加权；`pixelCount` 为已计入像素数量。

### 高分辨率分块路径

```ts
import { renderRecipeTiled, validateTiledImage } from '@ai-xiutu/editor';

// 调用方应先在解码前依据头部和设备预算准入；此处像素数组已经存在。
validateTiledImage(source, { maxPixels: 16_777_216 });
const highResolution = renderRecipeTiled(source, recipe, {
  maxPixels: 16_777_216, // 由应用预算决定，可以低于硬上限
  tileSize: 512,
});
```

新方法 `renderRecipeTiled()` 显式允许的默认/硬上限为 `MAX_TILED_PIXELS = 67_108_864`、单边 `MAX_TILED_DIMENSION = 16384`。它没有改变原 `renderRecipe()` 的 4MP 默认及 16MP 显式上限。`tileSize` 为 16…1024 的整数，默认 512；校验输入完整性与预算后才分配输出和工作缓冲。几何元数据与坐标辅助函数支持相同的 64MP/16384 硬上限，因为它们不分配图像缓冲；这不代表渲染或浏览器解码已获准使用同样内存。

分块渲染与整图参考路径复用同一组计算阶段、Float32 舍入位置、已编译曲线和 alpha 规则。每个源图核心块周围包含 **2 像素 halo**，覆盖全局半径 1 细节与局部半径 1 细节叠加后的输入依赖；只把核心部分写入最终输出。局部蒙版始终使用完整原图的中心/半径/归一坐标。裁切边缘仍读取裁切外的原图邻居，随后在拼接时精确应用裁切、旋转与翻转，不从缩小预览生成导出。

每个任务预分配并复用两块 tile Float32 RGB、一个输入 tile RGBA 和一个输出 tile RGBA；不为每块重新创建大缓冲并依赖 GC 回收。512 核心块的最大工作区域为 516×516，这四块缓冲合计约 **8.125 MiB**，加最多 64 KiB 的曲线 LUT。**完整输入和最终输出 RGBA 仍各占 4 字节/像素**：16MP 完整输入+完整输出约 128 MiB；64MP 约 512 MiB，再加浏览器解码/Canvas 等额外开销。分块减少的是浮点处理中间缓冲，不能使任意设备具备 64MP 可用内存。应用应继续使用更低的手机预算、明确的桌面高分辨率选项及 Worker 取消策略。

14 项分块专项测试逐字节对照参考引擎，覆盖不整除的块尺寸、512 接缝、全部旋转/翻转组合、裁切外邻居、两级细节、全图蒙版、透明像素、极窄图像和真实 Worker；构造器监测还验证只有两块 tile 大小的 Float32 工作缓冲。实际运行了 16384 单边输入，以及 **20MP 输入的小裁切**，后者验证超 16MP 准入与裁切区域计算。没有将这些测试描述为整幅 64MP 照片导出、移动设备内存或速度认证。

## Recipe v2 与显式迁移

`RecipeV2` 固定为 `schemaVersion: 2`、`engineVersion: '2.0.0'`，`EditorRecipe` 当前为 `RecipeV1 | RecipeV2 | RecipeV3`；此节专述 v2。新版本完整保留 v1 的 `adjustments/curves/geometry/local`，增加 `levels/hsl/grading/detail/effects/regions`。v1 配方不能直接改一个版本号充当 v2：必须补齐完整模型并验证。

```ts
import {
  createRecipeV2,
  createAdjustmentRegionV2,
  migrateRecipeToV2,
  parseEditorRecipe,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  patchEditorAdjustments,
  V2_TOOLS,
  setRecipeV2Parameter,
} from '@ai-xiutu/editor';

const current = createRecipeV2({
  levels: { gamma: 1.1 },
  hsl: { orange: { saturation: -8 } },
  regions: [
    createAdjustmentRegionV2({
      id: 'person-1-manual',
      name: '手动圈选区域一',
      mask: {
        type: 'brush',
        invert: false,
        strokes: [
          {
            points: [
              { x: 0.35, y: 0.4 },
              { x: 0.4, y: 0.5 },
            ],
            radius: 0.06,
            feather: 0.7,
            opacity: 1,
            mode: 'add',
          },
        ],
      },
      adjustments: { exposure: 0.15, soften: 18 },
    }),
  ],
});
const output = renderEditorRecipe(source, current);
const restoredEitherVersion = parseEditorRecipe(JSON.parse(savedJson));
// 明确升级后，所有新增项中性，结果与原 v1 配方逐字节一致。
const upgraded = migrateRecipeToV2(restoredEitherVersion);
// AI 只允许改动旧 13 项参数时，保留版本、曲线、几何及全部 v2 字段。
const candidate = patchEditorAdjustments(current, { exposure: 0.2 });
// UI 的新增数值控件直接读注册表；非法 path 或非法组合不会写入。
const changed =
  candidate.schemaVersion === 2 ? setRecipeV2Parameter(candidate, 'levels.gamma', 1.2) : candidate;
const fullExport = renderEditorRecipeTiled(source, changed, { maxPixels: 16_777_216 });
```

`patchEditorAdjustments` 返回 `EditorRecipe`，通用 UI 可直接交给 `renderEditorRecipe`；要使用仅接收 `RecipeV2` 的参数函数，应先以 `schemaVersion === 2` 缩窄类型。代码示例中的来源、预算和输出编码仍由调用方处理。

`parseEditorRecipe(input)` 保留输入版本，未知版本失败关闭；`validateEditorRecipe` 返回与旧验证器同形状的判别联合。`parseRecipeV2/validateRecipeV2` 只接受完整 v2。`createRecipeV2`、`createAdjustmentRegionV2` 才补齐已知默认值；默认对象 `DEFAULT_RECIPE_V2` 深度冻结。`migrateRecipeToV2` 对 v1 显式添加中性字段，对 v2 返回独立的已验证副本。没有自动向下转换或丢弃高级字段的接口。

`createAdjustmentRegionV2()` 的默认 id 是固定字符串 `default-region`，便于确定性测试；应用创建多个区域必须主动传入不同 id，例如 `crypto.randomUUID()`。引擎不读取随机数或时钟来补 id。最多 8 个区域，id 唯一，名称最长 80 个字符。区域含独立 `enabled`、0…1 `opacity`、一个完整 `mask` 和完整的旧 13 项 `adjustments`；区域名是用户标签，不代表已识别出某个人物。

v2 继承旧安全白名单，拒绝未知字段、错误版本、NaN/Infinity、访问器、特殊原型、循环、危险键和预算外结构。所有禁用字段也要有效。输入色阶要求 `inputWhite - inputBlack >= 0.0001`，输出色阶要求 `outputBlack <= outputWhite`。注册表的单字段范围不能替代完整配方校验。

### 新增参数与实际颜色域

`V2_TOOLS` 提供 **52 个数值路径**，加上原 `TOOLS` 的 13 项基础参数。52 是注册表路径数，包含色相、半径、种子等控制项，并非 52 种独立算法。字段为 `path/label/min/max/step/neutral/unit/group/domain/description`；`neutral` 是默认值，没有独立的 `default` 字段。`getRecipeV2Parameter/setRecipeV2Parameter` 只允许注册表里的路径。`effects.grain.colored` 等布尔值和蒙版形状通过类型明确的字段编辑。

| 参数族               | 范围与默认                                                | 真实语义及限制                                                            |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| 输入/输出色阶        | 黑/白端点 0…1；输入黑至 0.999、输入白从 0.001；默认 0/1   | 各编码 sRGB 通道独立压缩/扩展区间，越界裁切；输出黑白可相等以形成常量     |
| 色阶 gamma           | 0.1…5，默认 1                                             | 归一化值做 `x^(1/gamma)`；大于 1 提亮，不是线性曝光                       |
| 8 色段 HSL           | 每段 hue −60…60°、saturation/lightness −100…100，默认 0   | 按相邻色段连续插值并环绕红色接缝；零色度像素不分配虚构色相                |
| 阴影/中间调/高光分级 | hue 0…360°、saturation 0…100、luminance −100…100          | 连续亮度权重混合三种有界色偏；强度为 0 时色相不产生效果                   |
| 分级平衡             | −100…100，默认 0                                          | 中间锚点从 0.25 移至 0.75；全部分级中性时不改变画面                       |
| texture/clarity      | −100…100，默认 0                                          | 分别调节 3×3 / 5×5 亮度高频；负值削弱，正值增强，不检测或重新生成皮肤纹理 |
| monochrome           | 0…100，默认 0                                             | 向线性 Rec.709 亮度灰阶混合；与编码域 saturation 去色的结果不同           |
| fade                 | 0…100，默认 0                                             | 编码域抬黑压白，100 映射至 0.12…0.88                                      |
| 暗角                 | amount −100…100；中心 0…1；半径 0.0001…2；feather 0…1     | 正强度使椭圆外部最多 −2EV，负值最多 +2EV；位置固定在源图坐标              |
| 颗粒                 | amount 0…100、size 整数 1…32、seed uint32，colored 布尔值 | 固定坐标/种子程序噪声，尺寸以输入像素计；不是胶片噪声的物理模拟           |

`levels` 的每通道公式为 `outBlack + (outWhite-outBlack) * clamp((value-inBlack)/(inWhite-inBlack))^(1/gamma)`，全部在编码 sRGB 域。HSL 中心依次为 0/30/60/120/180/240/270/300 度；一个像素在相邻两个中心之间线性分配权重。饱和/明度的正向值向 1 混合、负向值向 0 混合，调整强度另乘 `clamp(chroma/0.05)`，避免极低色度的任意色相被剧烈放大。它是一种明确的 HSL 颜色模型，不是感知均匀色空间。

分级以编码 `Y′` 为权重，三个三角形亮度区共享 `pivot = 0.5 + balance/400`。每区从所选全饱和色相构建 RGB 色偏并减去其 `Y′`，色偏系数为 `0.25*saturation/100`；再加 `0.2*luminance/100` 的等通道偏移，必要时裁切。因此“零亮度代理色偏”是裁切前的定义，不能承诺饱和裁切后亮度严格不变。

texture 使用 alpha 加权 3×3 高斯线性亮度残差，阈值 0.002、最大系数 0.8；clarity 使用 `[1,4,6,4,1]` 外积的 5×5 残差，阈值 0.001、系数 `0.8*clarity/100*4Y(1-Y)`。两项读取同一阶段输入，合成亮度差等量加至 RGB 并裁切。它们与旧 RGB 锐化/边缘感知柔化具有不同且固定的定义；不承诺人像肤质“零风险”。

颗粒用 uint32 整数哈希与平滑双线性格点噪声，幅度为 `0.12*amount/100*(0.25+0.75*4Y′(1-Y′))`。彩色模式使用不同通道种子，单色模式使用相同噪声；完全透明像素仍保留隐藏 RGB。输入像素与种子不变时，裁切、旋转、不同块大小和重放不会随机改变颗粒。

### v2 固定流水线

完整 v1 全局调色/曲线/细节/旧 `local` 阶段 → 新色阶 → HSL → 三路分级 → 线性黑白混合 → 编码域褪色 → 新 texture/clarity → 按数组顺序执行 `regions` → 暗角/颗粒 → 原有裁切/旋转/翻转 → RGBA8 编码。

主工作缓冲继续是 Float32 线性 sRGB。新增阶段接入旧阶段**编码前**的浮点结果，不先生成一张 8 位中间图再重调；新参数全部中性时直接复用旧路径，因此显式迁移的 v1 数值结果保持一致。旧局部阶段与新区域是两次独立处理，叠加存在实际顺序；不能根据显示名称自动合并或覆盖。

每个新区域先从其输入阶段计算完整候选（13 项基础参数），再以 `maskWeight * opacity` 在线性域混合。后一区域读取前一区域已经混合的结果。`enabled=false`、`opacity=0` 或全部参数中性时跳过。零权重像素不写入，逐字节保持该区域输入结果；局部锐化/柔化仍可能读取选区之外的邻居，所以不是隐私隔离。当前 regions 不含独立曲线、HSL、分级、texture/clarity 或形变字段，不接受未知字段来假装支持。

### 六种真实选区

所有选区使用完整、已应用方向的原图归一坐标。`compileSelectionMask(mask, dimensions, source?)` 返回 `(x,y) => weight`，参数 x/y 为 0…1 源图坐标；采样器输出 0…1，源图范围外总是 0，NaN/Infinity 抛错。渲染器用像素中心采样。几何变化不重新解释选区，可通过前述坐标映射函数将编辑画布点还原到原图。

| 类型          | 真实选区规则                                                          | 约束                                                                 |
| ------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `radial`      | 保留 v1 椭圆公式和羽化/反选                                           | 两轴半径相对各自原图维度；最小半径仍为 0.0001                        |
| `linear`      | start 权重 0、end 权重 1，沿源图实际像素方向投影并裁切，可 smoothstep | 两端不能相同；过渡宽度由两点距离决定                                 |
| `polygon`     | even-odd 填充；按到边界的源图像素距离向内羽化，外部严格 0             | 3…64 点；不能全部共线；允许明确的自交 even-odd 语义                  |
| `brush`       | 连续线段胶囊并集，圆形半径；依次执行 add/subtract 笔划                | 半径为短边的 0.000001…0.5；每笔最多 256 点，每区域最多 16 笔/1024 点 |
| `raster`      | 逐像素 byte 权重的无损 RLE，归一坐标最近邻采样                        | 宽高/像素预算同高分辨率输入；每区域最多 4096 个 run                  |
| `color-range` | 对原图颜色的连续 HSV 色相范围、饱和度范围与编码 `Y′` 范围求交         | 需要未改动原图 RGBA；不是皮肤/头发/人物语义识别                      |

polygon 的 `feather` 是短边的 0…0.5 倍，羽化完全位于区域内。brush 的 `radius` 是短边比例，`feather` 是半径的 0…1 占比，`opacity` 是本笔 0…1 覆盖量。单笔内部只取线段胶囊覆盖的最大值，所以提高采样点密度不会反复堆叠不透明度。不同笔依序 add `w+(1-w)*coverage*opacity` 或 subtract `w*(1-coverage*opacity)`；整体 `invert` 最后反选。半像素半径、像素中心单点和 feather=0 可严格限制一个像素的写入；测试不为此降低精度或放开整图预算。

raster 的 `runs` 是交替的正整数长度/0…255 权重，长度总和必须等于 width×height。`createRasterMask(width,height,weights,invert?)` 从 byte 数组构建，不损失权重；高频棋盘格等超过 run 预算会明确失败，不做静默近似。采样器编译累计长度并二分查找，不展开成完整大图蒙版。若 raster 维度与源图不同，按归一坐标最近邻放大/缩小，这是显式的选区解释；需要逐像素精确控制时令两者相等。

一个配方总笔刷点数最多 2048、总 raster runs 最多 8192，避免合法 JSON 携带无界计算和分配。这些上限约束当前 CPU 参考实现；复杂长时间绘画需要后续专门的掩模资产存储/合成设计，不能冒称无限画笔。

### 连续选色与手动多人精修

`ColorRangeMaskV2` 包含 `hue`（0…360°）、`hueWidth`（半宽 0…180°）、`saturationMin/Max`、`luminanceMin/Max`（均为 0…1）、`feather`（0…1）和 `invert`。色相按圆周最短距离匹配，0 度和 360 度相同；`hueWidth=0` 是精确色相，180 包含全色相并允许无彩色，较窄范围排除没有可定义色相的灰色。S 是 HSV 饱和度，亮度是编码 `Y′`，不是 HSL lightness 或物理线性亮度。

羽化分别在各选择范围内平滑收窄，三项权重相乘。S/Y′ 的 0、1 自然端点不渐隐，保证“全范围”不会意外排除纯色、纯黑或纯白。完全透明源像素始终不选中，**反选也不将它纳入**；部分透明像素保留自身 alpha，权重不再额外乘 alpha。

渲染器传入完整未改源图：即使先前调色把红色变成绿色、某个区域去色或调整肤色，选色仍固定在同一原始像素集合，不随处理链漂移。编译采样器借用传入的 RGBA buffer，不复制整幅图；调用方在采样器生命周期内必须保持它不变。UI 可明确传入缩小的 `originalPreview` 作为第三参，同时 dimensions 仍传完整原图尺寸；归一坐标会映射至该预览，但阈值附近的颜色/透明边缘只是近似预览。完整导出使用原分辨率源像素，不能把缩小图的颜色分类称为精确最终蒙版。

HSL 的八个控制色段与连续选色不是同一功能。八个 HSL 中心之间存在连续权重；color-range 允许任意色相中心和宽度，并将区域内 13 项参数真正应用于所选像素。它会选中全图中所有匹配颜色；需要限于某人的皮肤时，应手动画笔/多边形选择目标。当前 mask 模型没有颜色范围与任意几何蒙版的布尔交集字段，不应在 UI 宣称已具备该复合能力。

多个人物可以分别创建、命名、启用/禁用手动区域并设置不同的柔化、曝光、冷暖或色偏；重叠处按数组顺序累积。应用可以把它们组织为“人物一/人物二”，但这不是人脸检测、跟踪、精确皮肤分割、身份稳定映射或五官形变。原图不可变，配方可撤销，并不意味着任何美颜强度都能自然、无副作用或医学意义上安全。

### v2 分块内存与同分辨率一致性

`renderRecipeV2` 和通用 `renderEditorRecipe` 保持 4MP 默认、16MP 显式整图预算；`renderRecipeV2Tiled/renderEditorRecipeTiled` 与旧分块方法保持 64MP/16384 硬上限和 16…1024 核心块大小。应用仍须在解码前传入设备实际预算。64MP 对应最大正方形短边 8192，不能将单边 16384 上限解释为允许 16384×16384。

v2 的保守 halo 为 `2 + (clarity非零 ? 2 : texture非零 ? 1 : 0) + 启用且非零透明度的区域细节层数`，最大 **12 像素**。两项全局新细节读同一输入，无需把半径相加；八个区域是顺序依赖，必须逐层累加。逐 tile 重复计算 halo 后仅写入核心，源坐标、颗粒相位、原图颜色选择与几何置换全部复用同一解释器。

512 核心块在最坏 halo 下最多 536×536；两块 Float32 RGB、输入/输出 RGBA 四块复用缓冲合计 **9,193,472 字节，约 8.768 MiB**，其中 Float32 部分约 6.576 MiB。另有曲线 LUT、有界蒙版编译索引和少量对象。完整原图与完整输出仍各占 4 字节/像素，64MP 双 RGBA 约 512 MiB；本版未实现文件流式解码、磁盘分页或零内存高分辨率导出。

同一 RGBA 输入、同一配方的整图/分块/真实 Worker 已逐字节对照。缩小预览改变了细节滤镜的实际像素尺寸，也改变程序颗粒采样密度，选色阈值还可能受缩放混色影响；不能承诺缩小预览与完整导出逐像素一致。关键纹理、单像素选择和阈值边界应在原分辨率的实际像素上检查。本包提供确定性算法和数值验证，不提供自动人像质量、跨浏览器编解码颜色一致性或手机内存认证。

## 测试与扩展契约

从仓库根目录执行：

```sh
node --import tsx --test packages/editor/test/*.test.ts
node node_modules/typescript/bin/tsc -p packages/editor/tsconfig.json --noEmit
```

原 23 项核心测试和新增 14 项分块测试覆盖：安全验证、完整灰阶与 alpha 的中性恒等、曝光线性光数值、滑杆双向变化、饱和与冷暖、曲线顺序和无效曲线、全部四种旋转与翻转、量化裁切映射、透明邻域、柔化/锐化方向、椭圆羽化和反选、局部不外溢、直方图、输入预算/取消、各工具极值，以及整图/分块/真实 Worker 的同输入同配方一致性。另有头部预检测试覆盖签名、动画、畸形长度、尺寸炸弹、CRC、帧与画布不一致和检查预算。独立头部审计回归还覆盖 AVIF 主图关联、跨 box 读字段、重复关键盒、顶层序列盒、真实 AVIF 截断、BMP 行填充、GIF 注释内伪标记等反例；真实静态 GIF、RGB/alpha AVIF 由 Sharp 编码验证。它们是合成数值、容器结构与 API 契约测试，不是完整编解码器认证、人像质量评测、手机性能认证或生产稳定性测试。

本次 v2 另有 **40 项**测试：8 项版本/迁移/结构校验、11 项选区数学与边界、21 项实际渲染与分块/Worker 对照。覆盖每个新增参数族的真实方向和极值、所有 8 个 HSL 色段、低色度数值稳定性、连续选色的色环接缝与灰色/透明/反选、原始颜色选择不随前序编辑漂移、旧 v1 迁移逐字节重放、受保护区域和单像素写入、8 局部细节的 12px halo、最大依赖下的 Float32 分配计数，以及所有旋转/翻转和 512 接缝。最终 editor 全包实际执行 **98/98 通过、0 跳过**，严格 TypeScript 检查和 `git diff --check` 通过。未在这个包级验证中声称完成整仓验收、真实人像质量评审或 64MP 整幅照片性能测试。

头部布局核对依据：[W3C PNG 第三版](https://www.w3.org/TR/png-3/)、[Google WebP RIFF 容器规范](https://developers.google.com/speed/webp/docs/riff_container)、[WebP 无损位流规范](https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification)。此包实现有意只接纳上述明确支持的子集，不是通用媒体解析器。

扩展应保持以下规则：

1. 改变现有参数解释、数学公式、顺序、颜色域或边界行为时，升级 `engineVersion`，保留旧解释器或提供显式迁移；不能用相同版本静默改变历史配方。
2. 增加必需字段或改变配方结构时升级 `schemaVersion`；持久化配方须能说明使用的解释器版本。当前不自动迁移未知版本。
3. 新功能先增加可验证的注册表与模型，再增加共享参考实现及恒等/方向/边界测试。CPU、WASM、GPU 版本须声明容差并对同一输入交叉验证；不能在 UI 独立复制颜色计算。
4. v2 多区域与六类手动选区已实现；独立图层、选区布尔组合、人物跟踪、形变、智能修复、AI、隐私压平和撤销/重做仍由后续或应用模块明确建模。当前包不会把不支持字段悄悄忽略，借此冒充实现。

当前也不接收 RAW、PSD、ICC 色彩配置、HDR、视频帧序列或任意角度旋转。文件格式识别、解码后的 sRGB 归一化与 EXIF 方向应用是调用方责任；本包仅验证接收的 RGBA 形状和预算，无法从像素数组证明其真实色彩空间。
