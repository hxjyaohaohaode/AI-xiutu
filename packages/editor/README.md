# @ai-xiutu/editor

无 DOM、网络、模型依赖的 TypeScript CPU 图像参考引擎。当前提供可运行的基础调色、曲线、无插值几何变换，以及一个手动椭圆区域内的局部调整。配方是非破坏性的 JSON：原图与配方分开保存，每次从原始输入计算结果。

本包不是完整的 125 项编辑功能实现，也不包含人脸识别、肤色识别、自动磨皮、五官形变、多人实例分割、隐私销毁或 AI 修图。`soften` 是手动选择作用区域的局部平滑算法；把它用于人像不使它变成人脸模型。

## 最小使用方式

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

当前必须为 `schemaVersion: 1`、`engineVersion: '1.0.0'`。完整配方包含 `adjustments`、`curves`、`geometry`、`local`，具体接口由 `src/types.ts` 导出。只有 `createRecipe()` 负责补齐默认值，`parseRecipe()` 不会静默补齐不完整的持久化对象。

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

## 固定执行顺序与算法

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

`local.enabled` 为 `false` 时局部参数全部不参与计算。启用时先从全局结果计算局部候选，仅在掩模有非零权重的地方混合；局部的锐化/柔化不会变成全局滤镜。当前只有一个局部区域，没有画笔、多区域叠加、语义人物蒙版或局部曲线。

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

## 测试与扩展契约

从仓库根目录执行：

```sh
node --import tsx --test packages/editor/test/*.test.ts
node node_modules/typescript/bin/tsc -p packages/editor/tsconfig.json --noEmit
```

原 23 项核心测试和新增 14 项分块测试覆盖：安全验证、完整灰阶与 alpha 的中性恒等、曝光线性光数值、滑杆双向变化、饱和与冷暖、曲线顺序和无效曲线、全部四种旋转与翻转、量化裁切映射、透明邻域、柔化/锐化方向、椭圆羽化和反选、局部不外溢、直方图、输入预算/取消、各工具极值，以及整图/分块/真实 Worker 的同输入同配方一致性。另有头部预检测试覆盖签名、动画、畸形长度、尺寸炸弹、CRC、帧与画布不一致和检查预算。独立头部审计回归还覆盖 AVIF 主图关联、跨 box 读字段、重复关键盒、顶层序列盒、真实 AVIF 截断、BMP 行填充、GIF 注释内伪标记等反例；真实静态 GIF、RGB/alpha AVIF 由 Sharp 编码验证。它们是合成数值、容器结构与 API 契约测试，不是完整编解码器认证、人像质量评测、手机性能认证或生产稳定性测试。

头部布局核对依据：[W3C PNG 第三版](https://www.w3.org/TR/png-3/)、[Google WebP RIFF 容器规范](https://developers.google.com/speed/webp/docs/riff_container)、[WebP 无损位流规范](https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification)。此包实现有意只接纳上述明确支持的子集，不是通用媒体解析器。

扩展应保持以下规则：

1. 改变现有参数解释、数学公式、顺序、颜色域或边界行为时，升级 `engineVersion`，保留旧解释器或提供显式迁移；不能用相同版本静默改变历史配方。
2. 增加必需字段或改变配方结构时升级 `schemaVersion`；持久化配方须能说明使用的解释器版本。当前不自动迁移未知版本。
3. 新功能先增加可验证的注册表与模型，再增加共享参考实现及恒等/方向/边界测试。CPU、WASM、GPU 版本须声明容差并对同一输入交叉验证；不能在 UI 独立复制颜色计算。
4. 多蒙版、图层、人物跟踪、形变、智能修复、AI、隐私压平和撤销/重做属于后续明确建模的模块。当前包不会把不支持字段悄悄忽略，借此冒充实现。

当前也不接收 RAW、PSD、ICC 色彩配置、HDR、视频帧序列或任意角度旋转。文件格式识别、解码后的 sRGB 归一化与 EXIF 方向应用是调用方责任；本包仅验证接收的 RGBA 形状和预算，无法从像素数组证明其真实色彩空间。
