# V4 局部修复独立视觉验证

## 结论与验证边界

本次以现有真实建筑、花卉、人像图像的**原实际尺寸**调用产品 `renderEditorRecipe`，覆盖平滑区、纹理边缘、跨轮廓三种场景，每处各用中、大两档笔径，分别执行 `diffusion`、`patch-poisson`、冻结源 `clone`。正式完成 **3 类源图、9 个位置、18 个笔径场景、54 次真实渲染、9 张对照图**；9 张对照图全部实际通过 `view_image` 查看。

视觉结论不是全部通过。中笔径平滑水面的小暗点可以被减弱；大笔径扩散会出现明显色块和纹理丢失；补片与仿制会带入供体的结构、方向、颜色或噪纹。屋檐、花瓣轮廓、眼镜等跨轮廓位置，以及高纹理花心、屋瓦和脸颊的大范围处理，存在清楚可见的接缝、结构错位或复制痕迹。**这些结果不能作为高质量自动消除、自动祛皱或五官结构保护已经完成的证据。**

本次没有合成假瑕疵，没有用其他修图软件或模型代替算法输出，没有外部 AI 调用。产品代码和既有证据 JSON 未修改；独立脚本及原尺寸输出只写入 `artifacts`。所有运行和视觉观察是局部修复专项验证，不是浏览器交互、移动端帧率、全部参数组合或商业质量验收。

## 1. 来源、像素与时间快照

正式运行时间为 `2026-11-10T05:22:55.424Z` 至 `2026-11-10T05:23:01.109Z`，Node.js `v24.22.1`。解码使用现有 Sharp：应用 EXIF 方向，转换为 sRGB，补齐 Alpha；**渲染前没有缩小或放大源图**。建筑和花卉为 640×427，人像为 512×600，均采用完整实际源尺寸，最长边至少 600 像素。

像素输出为 sRGB RGBA8；报告没有声称高位深修复。源文件编码哈希与解码后的 RGBA 哈希不同，分别记录，避免把解码归一化误当成产品修改原始照片。

| 源类型       | 原文件路径                                          | 尺寸    | 原编码 SHA-256                                                     | 解码 RGBA8 SHA-256                                                 |
| ------------ | --------------------------------------------------- | ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| architecture | `artifacts/browser-fixtures/architecture-china.jpg` | 640×427 | `8378025ad2519d649d02e32bd98990db4ab572357d9f09841c2fbfbb4fefad29` | `e3d4eecac312f4df08cfea2cd8343f7a9ade445309f25e3b3e17d1b126428b23` |
| flower       | `artifacts/browser-fixtures/flower.jpg`             | 640×427 | `a77f6ec41e353afdf8bdff2ea981b2955535d8d83294f8cfa49cf4e423dd5638` | `5a169c2eb0f274b9df6bdfa59806d934cedf19eea2a1f39129cc157421a29a68` |
| portrait     | `artifacts/browser-fixtures/portrait-hopper.jpg`    | 512×600 | `a8ca6d734765703b09728ab47fe59f473d93ae3967fc24c7c0288c3c7adb7130` | `9c5934c1d558b086b162ed59c857962e4df6d77737b47ee123b4e54380e5b7eb` |

独立脚本：`artifacts/v4-repair-visual.ts`。全部结果位于 `artifacts/editor-v4-repair-visual/`，路径均相对仓库根目录 `/workspace/scratch/c8b2edcd498c/AI-xiutu/`。

| 证据文件                                                     | SHA-256                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `artifacts/v4-repair-visual.ts`                              | `5a4e7a865d0ab2943f334674ff5641b28ffff718652a61af9c93dfb2014623a4` |
| `artifacts/editor-v4-repair-visual/manifest.json`            | `46399aa087e14a90589ffa4618981e83405ebe4a3c7a974402a3bfb47e2a8713` |
| `artifacts/editor-v4-repair-visual/evidence.jsonl`           | `4b549a8e765a951e98cd69bf6f42cd154f914b55e764de872594f44c4588a5fd` |
| `artifacts/editor-v4-repair-visual/attempt-1-rejection.txt`  | `7134e8e80f2cd9a21476ccb74a2e26bf4698e3df410b83e54feb66087e71a8da` |
| `artifacts/editor-v4-repair-visual/attempt-1-evidence.jsonl` | `0d70094ddf828f85078df868950c9cfb48043d84ff37acc8559cae70c858839b` |

`manifest.json` 保存源图、坐标、参数、全部 `packages/editor/src/*.ts` 的运行前源码哈希、对照图哈希及方法说明。`evidence.jsonl` 保存 54 条实际结果，每条含**完整已校验 RecipeV4**、配方哈希、源像素哈希、输出像素哈希、完整 PNG 路径及编码哈希、耗时和不变量检查。脚本结束时再次核对编辑器源码库存，确认该次运行期间没有变化。

复现命令（使用现有夹具和依赖，输出仍写到独立 artifacts 目录）：

```sh
node --import tsx artifacts/v4-repair-visual.ts
```

## 2. 明确目标、供体与真实配方

两档笔径为 **28 px 与 64 px**，即源图半径 14 px 与 32 px。“中／大”是本次实验标记，不是所有分辨率下统一的推荐值。所有方法使用单次圆形点按范围，羽化 `0.25`、不透明度 `1`，没有同时叠加其他调色、修肤或几何变换。供体为同一源图中明确指定的位置；未测试自动供体搜索。

| 场景 ID                       | 类别与实际目标                         | 目标中心 T（源图 px） | 供体中心 D（源图 px） |
| ----------------------------- | -------------------------------------- | --------------------- | --------------------- |
| architecture-smooth-water     | 平滑水面中的天然小暗点                 | (470, 274)            | (402, 267)            |
| architecture-texture-roof     | 重复屋瓦及檐口纹理                     | (257, 267)            | (155, 272)            |
| architecture-contour-roof-sky | 屋檐端部与天空交界                     | (307, 116)            | (140, 114)            |
| flower-smooth-bokeh           | 自然失焦背景色团；没有伪造待消除物     | (538, 286)            | (525, 190)            |
| flower-texture-petals         | 花心的小花瓣与密集边缘                 | (301, 217)            | (376, 246)            |
| flower-contour-flower         | 花瓣外缘与绿色背景交界                 | (430, 222)            | (420, 145)            |
| portrait-smooth-wall          | 带原有摄影噪纹的蓝墙；没有伪造皮肤瑕疵 | (427, 220)            | (440, 298)            |
| portrait-texture-cheek        | 脸颊皮肤褶皱与明暗边缘                 | (328, 276)            | (211, 282)            |
| portrait-contour-glasses      | 眼镜、眼部与皮肤轮廓                   | (329, 187)            | (214, 198)            |

所有坐标基于已解码、应用方向后的完整源图。令源尺寸为 `W×H`、半径为 `r`，两种修复配方的选区为：

```ts
{
  type: 'radial',
  centerX: T.x / W,
  centerY: T.y / H,
  radiusX: r / W,
  radiusY: r / H,
  feather: 0.25,
  invert: false,
}
```

`createHealingOperationV4` 构造独立启用操作，`protection:null`、`opacity:1`、`iterations:256`、`texture:1`、`searchRadius:0.3`。`diffusion` 的 `source:null`，实际使用目标边界；`patch-poisson` 的 `source:{x:D.x/W,y:D.y/H}`，实际使用固定供体梯度。本次没有把 `texture` 的同一数值误解释为 diffusion 的纹理重建能力。

仿制使用真实绘制链路：一个启用的 `paintLayers`，`blendMode:'normal'`、图层 `opacity:1`、`mask:null`，其中一个 `mode:'clone'` 的笔画，`points:[T归一化坐标]`、`source:D归一化坐标`、`radius:r/min(W,H)`、`feather:0.25`、笔画 `opacity:1`、`color:[255,255,255,255]`。源采样由产品已有的冻结源仿制算法完成。没有把普通复制粘贴或 Sharp 合成伪装成仿制结果。

三种方法都由 `createRecipeV4` 与 `parseRecipeV4` 接收后，调用 `renderEditorRecipe(source, recipe, {maxPixels:4_194_304})`。正式运行 54 个配方全部通过实际准入与渲染。每个完整输出 PNG 无圈线或说明文字；圈线只用于后续对照图展示。

### 第一遍发生的真实拒绝

首次尝试的花心供体为 `(360,241)`。64 px 笔径时，目标 `(301,217)` 与供体的中心距离约 63.69 px，小于两圆半径之和 64 px。产品 `patch-poisson` 实际抛出：

```text
RangeError: Healing donor overlaps the target, transparency, or image boundary; choose another source
```

没有把这一格换成原图或伪造结果，也没有把它计入正式 54 次成功。保留了 `attempt-1-rejection.txt`、`attempt-1-script.txt`、`attempt-1-evidence.jsonl`；其中有拒绝前已执行的 28 条真实渲染记录。只将独立 QA 脚本中的供体移到 `(376,246)`，明确解除重叠，然后从头重跑所有 54 项。本次观察到的是有效的供体约束拒绝，不是产品漏洞；它同时说明用户手动选源也可能被拒绝，不能承诺任意供体都合法。

## 3. 对照图及实际查看记录

每张图顶部为完整源图定位：黄色实线圈表示目标，两圈分别对应 14／32 px 半径；青色虚线圈表示补片与仿制供体。下面两行分别是 28／64 px 笔径，每行依次为原图裁片、diffusion、patch-poisson、clone。

每格裁片覆盖同一个原生 `160×160` 区域，展示时按最近邻放大到 `320×320`，因此可见像素块不是新增细节。只有原图格加黄色范围线以说明目标；处理结果格没有额外标记。没有对算法结果再做平滑、锐化或色彩美化。

以下 9 张均已实际调用 `view_image` 查看，而非只核对统计或文件存在。文件 SHA 在查看后重读核对。

| 已查看的对照图路径                                                    | 查看后 SHA-256                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `artifacts/editor-v4-repair-visual/architecture-smooth-water.png`     | `f4a82f93b52938655c5adee8a22a7792cb83f6b376c7c8b0fb2628790d057e50` |
| `artifacts/editor-v4-repair-visual/architecture-texture-roof.png`     | `28d12e917d23b7f81c7f9f72310487bc239b9e8af5d2962053a752f86e7a751c` |
| `artifacts/editor-v4-repair-visual/architecture-contour-roof-sky.png` | `2424b6e42f02bed6eaa7d4683f4f3d7783de430f00bcfec9e6d7b9ca5b63c4f6` |
| `artifacts/editor-v4-repair-visual/flower-smooth-bokeh.png`           | `b4139464935fd79bdea20fa832cc7f52e8c7c8f79dd22808b722a89723ef9fcb` |
| `artifacts/editor-v4-repair-visual/flower-texture-petals.png`         | `533373e37ee8e048099f8f4f81a17514832c08ce9cc168ac48645889132ea78f` |
| `artifacts/editor-v4-repair-visual/flower-contour-flower.png`         | `fe0be62d55cb7c73f794542f4e54475c575de5d6f088041ae6bea4e4b8c82a43` |
| `artifacts/editor-v4-repair-visual/portrait-smooth-wall.png`          | `18e53d3b9700be181c76050f86254fa7a1a7865b96da05a6e157ce66b2418111` |
| `artifacts/editor-v4-repair-visual/portrait-texture-cheek.png`        | `1750d7ee61ca487d6c831c225e95e736ac9278bd9ae2384eb9b17b9989374430` |
| `artifacts/editor-v4-repair-visual/portrait-contour-glasses.png`      | `d9c635aacd582a7ab9b894f5c56cbf6e5338b830f2d075c274d52dfbac287845` |

### 3.1 建筑：平滑水面

28 px 的原图圈内可以辨认一个小暗点。扩散后该点被减弱，水面颜色过渡相对平缓，未看到显著的硬圆形边界。补片与仿制也改变了该区域，但供体本身含水面细点，结果仍可见一些小纹理；这不是有真实“干净水面”真值的重建实验。

64 px 选区覆盖更多水面并接近树岸。扩散出现明显发灰、平滑的圆状区域，原有水面和靠边的树冠细节被弱化；补片、仿制会带入供体中的水面小点和色彩关系，不能保证所有船点都被干净消除。**中笔径平滑区的小点减弱有可见效果，大笔径结果不满足无痕消除要求。**

### 3.2 建筑：重复屋瓦纹理

两档扩散都把有规律的瓦片纹理变成平滑色块，64 px 的失纹理区域尤其明显。补片和仿制保留了供体的纹理，但供体屋瓦的方向、位置和暗部形状与目标不一致；28 px 已能看到瓦片方向断接，64 px 出现更大的暗楔形补片及错开的檐口线。

这是“带纹理”与“正确延续目标结构”的直接区别。本次三种方法均未把该屋瓦场景处理为无痕、结构连续的结果。改变供体、分小笔径或增加保护可以作为后续具体实验，但本次没有进行这些优化，不能假定它们已经解决问题。

### 3.3 建筑：屋檐与天空跨轮廓

扩散将屋檐局部轮廓模糊成灰蓝色团，64 px 进一步吞掉檐角细节。补片在小范围内出现过亮的瓦片／边缘片段，仿制保留较直接的供体颜色；大范围中两者都把另一段屋檐的方向和结构带到檐角，形成突起或断接。

三种方法在这个未做语义保护、供体方向不同的场景中都不能保持原有轮廓。未见整图丢失，但局部内容已发生显著结构错误，**跨轮廓修复质量不通过**。

### 3.4 花卉：失焦背景

原图是连续的青绿失焦背景，没有人为添加瑕疵。扩散和梯度域补片在两档范围内保持了较平顺的低频色彩过渡，相较其他困难场景，边界不突出；它们改变了自然背景色团，不能由此称为“成功消除某个物体”。

仿制在 28 px 时就产生明显偏蓝的圆形色块，64 px 的蓝色斑块更大。固定供体与目标的绝对颜色不同，羽化并未完全隐藏这种差别。此处可见梯度域补片对边界颜色的适配与仿制直接带入颜色的区别，但不是对所有背景或供体的普遍质量排名。

### 3.5 花卉：花心密集纹理

扩散把花心细小结构变成红橙色平滑斑，64 px 形成一块明显缺少花瓣细节的区域。补片与仿制把外侧较大的花瓣结构带入中心：中笔径已有一片与花心尺寸不一致的斜向纹理，大笔径则出现数片显著偏大的花瓣。补片颜色更受目标边界影响，仿制更直接保留供体颜色；两者都没有重建中心原有密度与几何排列。

这组结果只能证明三种运算真实执行。对密集、尺度变化的自然重复结构，**局部修复质量不通过**，不能将有纹理的输出当作合理补全。

### 3.6 花卉：花瓣与绿色背景跨轮廓

28 px 扩散弱化花瓣边缘，补片出现明显的亮瓣片段，仿制把供体中的暗背景带进花瓣，形成暗洞样缺口。64 px 扩散在花瓣与背景之间产生大块模糊色团；补片和仿制改变花瓣外轮廓，出现凹缺与错开的瓣片。

输出没有全图变色，但目标轮廓未被保存。该组明确显示单一供体不理解花瓣边缘的走向和内外关系，不能用于证明智能轮廓保护已经实现。

### 3.7 人像：蓝墙平滑区

原墙面具有可见摄影噪纹，不是纯色。扩散在 28 px 时使目标处更平滑；64 px 留下清楚的低纹理圆斑，周围原有颗粒与圆斑反差明显。补片与仿制仍保留较接近原墙面的噪纹，边界比扩散不突出，整体没有突兀的大色块。

本场景的供体与目标墙面较接近，因此补片／仿制的表面连续性相对较好。照片中没有清楚定义的墙面瑕疵，此处验证的是纹理与边界表现，**不计作祛斑或皮肤修复成功**，也未评价噪声统计是否完全一致。

### 3.8 人像：脸颊纹理

28 px 扩散抹掉局部褶皱，同时产生可见的平滑皮肤斑；补片和仿制保留一些纹理，但纹理并非目标原本的皮肤结构。64 px 扩散形成明显的粉肤色圆块，并波及皮肤与邻近结构的关系。

大笔径补片和仿制把另一侧供体里的嘴角、阴影和褶皱片段带到目标脸颊，出现多余的暗线、重复结构与颜色不协调。**此处没有达到自然祛皱或真实皮肤质感修复要求**。样本记录的是手动固定供体修复，不是自动痘痘检测或人像语义模型。

### 3.9 人像：眼镜、眼睛与皮肤轮廓

中笔径扩散可以减弱原目标里的亮反光，但同时抹掉邻近眼镜／眼部细节，形成模糊块。补片与仿制会引入供体眼部的暗色与局部结构，不能只把“原反光变化”当作安全去反光。

64 px 扩散大面积遮掉眼睛与镜框；补片和仿制则把另一侧眼睛、镜框和高光复制进来，造成眼睛与眼镜轮廓错位和重复。**这组跨五官结构修复质量不通过。** 本次没有启用保护蒙版，没有配准两侧眼镜，也没有对供体做旋转／透视校正，因此不把结果解释为已测试这些尚未参与的能力。

## 4. 数据边界与实测耗时

正式 54 次渲染均实际检查：输入 RGBA 哈希未改变；输出宽高与输入一致；Alpha 未改变；根据独立的像素中心到目标中心距离计算，**圆形支持范围以外改变的像素数为 0**。这些检查说明本批输入的数据边界成立，不代表边界以内的内容视觉正确，也不代表其他参数和透明源情况都通过。

没有在本专项重新做全图／分块一致性或浏览器 Worker 性能测试。下面是每次 `renderEditorRecipe` 调用的一次本机墙钟测量，包含函数内校验，不包含 PNG 编码、图表生成和哈希扫描；未控制 JIT 热身、其他进程负载，也没有多轮统计分布。因此只能作为此次运行成本记录，不能写成手机帧率、P95 或生产服务延迟。

| 算法          | 实际次数 | 最小值 ms | 中位数 ms | 最大值 ms |
| ------------- | -------- | --------- | --------- | --------- |
| diffusion     | 18       | 18.647    | 32.859    | 81.977    |
| patch-poisson | 18       | 17.268    | 37.583    | 49.473    |
| clone         | 18       | 8.333     | 12.085    | 20.205    |

54 次渲染计时总和为 1476.711 ms；这不是包含解码、PNG 编码和制表的完整运行耗时。

| 场景                            | 笔径 px | diffusion ms | patch-poisson ms | clone ms |
| ------------------------------- | ------- | ------------ | ---------------- | -------- |
| `architecture-smooth-water`     | 28      | 57.506       | 37.289           | 20.205   |
| `architecture-smooth-water`     | 64      | 81.977       | 49.473           | 18.755   |
| `architecture-texture-roof`     | 28      | 61.291       | 36.821           | 12.516   |
| `architecture-texture-roof`     | 64      | 32.467       | 37.877           | 8.395    |
| `architecture-contour-roof-sky` | 28      | 18.647       | 17.268           | 8.632    |
| `architecture-contour-roof-sky` | 64      | 33.530       | 40.061           | 8.333    |
| `flower-smooth-bokeh`           | 28      | 19.592       | 18.064           | 12.984   |
| `flower-smooth-bokeh`           | 64      | 37.927       | 48.097           | 14.227   |
| `flower-texture-petals`         | 28      | 24.598       | 24.267           | 9.351    |
| `flower-texture-petals`         | 64      | 39.232       | 41.281           | 9.303    |
| `flower-contour-flower`         | 28      | 22.745       | 18.383           | 14.588   |
| `flower-contour-flower`         | 64      | 29.943       | 41.995           | 15.987   |
| `portrait-smooth-wall`          | 28      | 24.301       | 24.860           | 10.246   |
| `portrait-smooth-wall`          | 64      | 33.251       | 46.903           | 19.716   |
| `portrait-texture-cheek`        | 28      | 26.239       | 20.985           | 11.146   |
| `portrait-texture-cheek`        | 64      | 36.286       | 43.452           | 8.718    |
| `portrait-contour-glasses`      | 28      | 19.257       | 19.540           | 16.013   |
| `portrait-contour-glasses`      | 64      | 34.935       | 45.602           | 11.654   |

## 5. 输出像素 SHA-256

下表为**未标注、原尺寸渲染结果的原始 RGBA8 字节 SHA-256**。它不是接触表 PNG 的哈希。尺寸已由源图和场景确定；完整记录还保存包含尺寸前缀的像素哈希、PNG 编码哈希、配方哈希与完整配方。不能用哈希不同推导视觉质量优劣。

| 场景                            | 笔径 px | 算法          | 原始输出 RGBA8 SHA-256                                             |
| ------------------------------- | ------- | ------------- | ------------------------------------------------------------------ |
| `architecture-smooth-water`     | 28      | diffusion     | `6d98ecf641a3573d8d7ae38dfee1d96fa8dcb7d91e2fba126972e24d88a19290` |
| `architecture-smooth-water`     | 28      | patch-poisson | `096a22f99be0a38cb02798b535b8eb11293aff8e4eb09d5be083d81464ad1f37` |
| `architecture-smooth-water`     | 28      | clone         | `2536834233f3e0dce503ed6d7e7971a42f167f67c619c6d37bda8fbb0db419ee` |
| `architecture-smooth-water`     | 64      | diffusion     | `f28d769f927a17ba2b56fe221c973e6f5131371864a8d5e121ae8051b2dd444c` |
| `architecture-smooth-water`     | 64      | patch-poisson | `d4e2e05384665587f073438e60c17d997c918c449a738fe37fd44a6d72c961fa` |
| `architecture-smooth-water`     | 64      | clone         | `53eaf427f32102a1a7dd0b5575ce585fc2384f114e091484bf84bca3285dfb49` |
| `architecture-texture-roof`     | 28      | diffusion     | `1efba217d520918c9e3d150c82c08ee32bc26669634213ec2d03a9e6b52dc42e` |
| `architecture-texture-roof`     | 28      | patch-poisson | `057619d46bcbcd7f65aedcd2b479ff389157093ea4e7a0b030581d12665434ed` |
| `architecture-texture-roof`     | 28      | clone         | `9feee273507ed9eca6a6b09a172ab35f20d6febe6028c4395879b9f1de09924c` |
| `architecture-texture-roof`     | 64      | diffusion     | `97f430cab20b0a55c01e071b8562e0ec0099d223b9a471a0501704106a4f99f5` |
| `architecture-texture-roof`     | 64      | patch-poisson | `2ce29aabe5ee1f76b737a4d54c0945237811bb1edc0ac682b62abbcc096374af` |
| `architecture-texture-roof`     | 64      | clone         | `3bafa48188314271d28ef32973c82869978fcd9c330e521561c593f56f68dabc` |
| `architecture-contour-roof-sky` | 28      | diffusion     | `f5c49301400de345c8d8b1ede9bd66915cf948b6f66e324d6d5bf3aa3d04d2c9` |
| `architecture-contour-roof-sky` | 28      | patch-poisson | `5932db42d57c7e712c856f7a761fbc64295700b5da2954a50262daf13783cf7d` |
| `architecture-contour-roof-sky` | 28      | clone         | `f09ac32d484816803b8f85f4fab63bfb2b33d89ae6b01061a74564140e6a2194` |
| `architecture-contour-roof-sky` | 64      | diffusion     | `081d1a0b22ff5594c74ee62af33f9e62d2247f9b9b38b975143426978539947b` |
| `architecture-contour-roof-sky` | 64      | patch-poisson | `91884e212c0f9ba8777ef5eea59d4dc5573a4db3de6763afdcc30e51563c5b96` |
| `architecture-contour-roof-sky` | 64      | clone         | `a055eb29d9e789237030baf308a09788dc84e031de0e49d7389eb90f39b3cf5b` |
| `flower-smooth-bokeh`           | 28      | diffusion     | `4d450ce44a5326284e68aba359614a114a27f5c9c70b47a88bf3bc9984d803e1` |
| `flower-smooth-bokeh`           | 28      | patch-poisson | `ead23b330b3f5b3167bd933b8b7f291b4fb4c1d6ee6fa9f7c2685466f2124236` |
| `flower-smooth-bokeh`           | 28      | clone         | `4737e9571a0a648ca4f9715b043d0afb6ca511f5c74a0728ecc356ad03f99b9d` |
| `flower-smooth-bokeh`           | 64      | diffusion     | `ab531c5d2bf03a5fbe467aeb7817140a0ebb58c0000c2fe8eb8581e478ea4a57` |
| `flower-smooth-bokeh`           | 64      | patch-poisson | `e64615c143122681c9da2cf34b6144749459e7bf3a122495e5be048fb65e4e47` |
| `flower-smooth-bokeh`           | 64      | clone         | `5f86f20899bd31c10fa1f4a9c3b69f4c298555a78fdeee27caaa1ebb6f8e3cb5` |
| `flower-texture-petals`         | 28      | diffusion     | `59ec95e767b2308d449d554e152414d9556931a6acb89efdae27c97912b93659` |
| `flower-texture-petals`         | 28      | patch-poisson | `8a07101e9f4bb88c128a3f98a364c889693e7907de69c758e168fb4a4841af43` |
| `flower-texture-petals`         | 28      | clone         | `7a830fda3f18eacb887c3932c079bd68d8c993fe95a032b80c74eff24954885a` |
| `flower-texture-petals`         | 64      | diffusion     | `2f59182a81e74c56528e194c3ca8644a0c40f404f107c70d6d353c3839948478` |
| `flower-texture-petals`         | 64      | patch-poisson | `01f5e93e5d6ddec2df6acd5c20818eb662d084d5b583312791088e3030649689` |
| `flower-texture-petals`         | 64      | clone         | `ecc3c18d9524d6aeb4c992543463239a880e9909425196ec1f3fc87ef46d4a78` |
| `flower-contour-flower`         | 28      | diffusion     | `5905dae93b379235ed9a1de282bd64c5599279b4602c6ab93f6e31b7b536e992` |
| `flower-contour-flower`         | 28      | patch-poisson | `b86ac6829f9fcb509734cd4a8f4c63d3ec64abb40ebd0a152006ffa2f46fe819` |
| `flower-contour-flower`         | 28      | clone         | `e20e87b0566259bd3a742ced71aba0d3463c0313032cb70bb32a53c2e902d451` |
| `flower-contour-flower`         | 64      | diffusion     | `4202d8190455382919141147f1615b7ec1de6c4a116b10475c44b143200ffffb` |
| `flower-contour-flower`         | 64      | patch-poisson | `fc998b2efbc1753f53d5e770eda7c4f9c4f88225471b742db2364a8e0eabebfa` |
| `flower-contour-flower`         | 64      | clone         | `f65800a1c56f37cd652326541419c7f094a1aeefdbcc1375c893b1a845724f57` |
| `portrait-smooth-wall`          | 28      | diffusion     | `cc46c708acda4e5a3ee4ccba492e00437c87b2de476276cdb061ba05de037c42` |
| `portrait-smooth-wall`          | 28      | patch-poisson | `aa080838807a45402b7795204b44542e7fbd6661a5a81f7c1fa87cd5ad911ffd` |
| `portrait-smooth-wall`          | 28      | clone         | `0971c459316b0c89bae334232a1e3f134e671cc9185b3ba1ec8b6a0ce3e1e4e1` |
| `portrait-smooth-wall`          | 64      | diffusion     | `50d00d9c75d95890d279ed051948675addd2bd691f6dccfe65f34c5fa5b725fa` |
| `portrait-smooth-wall`          | 64      | patch-poisson | `1f11e71fdfd18d8e2b95a616e72dce3e7432014cb78f3d630e349876695b9776` |
| `portrait-smooth-wall`          | 64      | clone         | `a41b6dc2e02d905bd393d1959c267f72787858d3ee8e6601f90ea3fa05c28fde` |
| `portrait-texture-cheek`        | 28      | diffusion     | `768dfcd3395353789b938a09a288749218c5d4dda91208d23ffdfe4480c9f4c9` |
| `portrait-texture-cheek`        | 28      | patch-poisson | `e1d5405c77a20055ab8b3f9d2c018e8c446671433183f550443fcb3f122dcaa3` |
| `portrait-texture-cheek`        | 28      | clone         | `df67dae38288a856d682a4ce867b04b5c6a4245bfc778c164623452a7908d446` |
| `portrait-texture-cheek`        | 64      | diffusion     | `06a187a4c63c0c6fc02fc3140c20be25b4c451f2070998a7e82ad8b3bb6b4551` |
| `portrait-texture-cheek`        | 64      | patch-poisson | `c5f2b464031bfb61eb5977e7bfd2409635b1ec693691986629a4540aab6f9ede` |
| `portrait-texture-cheek`        | 64      | clone         | `eeef8a1d267dc85ab7a50bdaf78af3b432775ed949e6445d44eeb9c2d6ff5be5` |
| `portrait-contour-glasses`      | 28      | diffusion     | `e05f135924678ed2a2a86312bc4b62155aead838d9f99410e217d57473f89580` |
| `portrait-contour-glasses`      | 28      | patch-poisson | `9503047408aab2a153ab9335c20cc2f3833cc53712161dad94107cd02958cb13` |
| `portrait-contour-glasses`      | 28      | clone         | `a2f4e54d527900707c318d9b2d67696781e36c690a9d15c1650d501f6e3a877b` |
| `portrait-contour-glasses`      | 64      | diffusion     | `ef2b0c3d0ffac135278f4b69f7b06f317329a64861abb7281e7077501d996f2f` |
| `portrait-contour-glasses`      | 64      | patch-poisson | `4c285eef7f9c9878495a569fee82163496924d5318891b1dc2ba61f22adda345` |
| `portrait-contour-glasses`      | 64      | clone         | `5d3fe5304c592ab98cf754b72b9a0d26b0409ba9211c9de2357b435f4907eff8` |

## 6. 可以与不可以据此交付的结论

目前这三条产品链路是真实、有界且可重放的手动像素操作；本批测试没有观察到源图修改、选区外写入、Alpha 异常或通过合法配方后伪造输出。首次重叠供体被明确拒绝的记录也保留了。

本次更高尺度对照已经为质量边界提供了明确证据：平滑小区域可以得到相对平顺的填充，带纹理的补片能转移供体细节，但大笔径、供体结构不匹配和跨轮廓位置会显著失败。未做语义重建、自动配准或五官保护的算法，不应以“自动智能消除”“自然祛皱已完善”或“所有内容逐像素精准修复”对外表述。

后续质量工作应围绕具体失败样本继续验证：缩小受损范围、选择与目标结构一致的供体、显式保护重要轮廓、评估供体配准和更强修复算法。这里仅列出后续方向，不将未执行的优化计入本次完成度，也不以生成任务或商业模型的潜在能力替代本地算法的实测结果。
