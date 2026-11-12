# @ai-xiutu/media：受控原件、母版、预览和瓦片

本包在独立 Linux 子进程中完成真实解码、ICC 转换、16 位母版生成、代理图与 Deep Zoom 瓦片。它与浏览器 RGBA8 编辑器分开：**200MP 导入/查看、16 位母版导出，不等于 200MP 或 16 位浏览器配方编辑**。

新增 `scene-linear-v1` 母版全局调色与 float32 EXR 导出。浏览器整套 V4 配方的高位深往返仍是独立范围。

## 母版线性调色

`exportMedia` 可传 `precisionEdit`，完整字段为 `algorithm:'scene-linear-v1'`、`exposure`（−10…10EV）、`temperature/tint/contrast/saturation/shadows/highlights`（−100…100）和 `toneMap:'none'|'reinhard'`。全零及 none 为中性。温度/色偏沿既有相对 RGB 增益；对比度围绕线性亮度0.18使用指数，饱和度围绕线性亮度，阴影/高光按 `Y/(Y+0.18)` 连续分配正负一档曝光。Reinhard 是显式的亮度色调映射。

选择 `precisionInput:'master16'` 时，按65536项完整传递函数表解码 uint16 样本，调色后量化一次，整图最多16,777,216像素。选择 `'linear-master'` 时，OpenImageIO 从已校验的线性母版逐块读取，最多6400万像素。EXR32 保留有符号浮点亮度、透明度、数据窗口和显示窗口。PNG16/TIFF16 先应用同一线性调色，再作 SDR 编码。线性路径需要配置 `options.pythonExecutable`。

`scene-linear-v2` 在全局调色后加入可选的 `curves.luminance/red/green/blue`。每条曲线包含 2–16 个 `[输入EV, 输出EV]` 点，横纵坐标为相对线性灰 0.18 的 −16…16EV，输入严格递增。相邻点按 EV 线性插值，两端延用端点的曝光偏移。先按亮度曲线等比缩放 RGB，再执行各正值通道的独立曲线，最后按需要做 Reinhard 映射。Alpha 和全透明像素的隐藏颜色保留在线性 EXR 中，浮点结果允许大于 1 的高光。EV 调节位置参考场景线性曝光分区，曲线插值和端点延拓按上面的协议执行。 [darktable Tone Equalizer](https://github.com/darktable-org/darktable/blob/1c96821ea863fca682d458f5b91f8a50f248959d/src/iop/toneequal.c)

能力目录和素材媒体记录的 `precisionEditing.curves` 给出算法、输入、通道和点位预算。使用 v2 时选择 `precisionInput:'linear-master'`，既可用同一参数请求原像素窗口，也可追加带 `expectedVersion` 的调色版本，再用 `gradeVersion` 输出。窗口、PNG16、TIFF16 和 EXR32 通过同一线性母版渲染，记录相同的来源和配方摘要。

`scene-linear-v3` 增加最多八个有顺序的局部调色项。选区使用现有原图坐标中的旋转径向形状或线性渐变，参数可选曝光、色温、色偏、对比度、饱和度、阴影和高光。每项的开关与透明度参与运算。全局曲线之后，原像素 RGB 按每个选区权重依次在线性光混合，再做显式色调映射。透明度和选区外像素保留，原像素窗口和整图以相同坐标渲染。服务端用 `precisionEditing.regions` 公布能力，版本保存和导出使用原有接口。[darktable 选区混合源码](https://github.com/darktable-org/darktable/blob/1c96821ea863fca682d458f5b91f8a50f248959d/src/develop/blend.c#L929)

母版预览可提交不超过2048像素的窗口，按源数据窗口坐标提取真实像素。整图预览先调色再缩小。相同输入、调色和源摘要共享同一个 `X-Precision-Edit-SHA256`，包含窗口预览和不同导出格式。API 将用户保存的参数追加为独立版本，支持重新打开、继续调色及指定版本导出。

原件与母版查看器对可用 WebGPU 的相机 RAW、Ultra HDR JPEG 和 HEIC PQ 支持适屏连续调色。Worker 从现有受授权的母版接口读取 ZIP EXR 并校验 SHA-256。相机 RAW 开发的 uint16 归一化样本可逆地打包，HDR 直接传递有符号 float32。GPU 每帧对所有原像素计算场景线性配方，显示 HDR 时应用同一 SDR 色调映射，再按相同的 Lanczos3 几何采样。原像素窗口和文件导出由媒体 API 交付。浏览器显存和计算设备能力不足时使用同源 CPU 预览。[相机和手机实拍验收](../../docs/research/PHOTO-EDITING-FEATURE-MATRIX.md#r01-和-f07-原尺寸开发后的适屏性能)

线性母版窗口在独立 Python 进程中复用解码环境，使用与导出相同的条带调色及 sRGB 量化。每次按当前素材授权打开母版，核对实际文件的设备、inode、尺寸和纳秒时间戳。首次或身份变化时重新核对完整 SHA-256。解码使用已核对的文件描述符，返回前再核对文件和路径。对同一文件身份和坐标复用最多一个窗口的原始 float32 条带，缓存最多 16MiB。窗口 PNG16 使用低压缩级别的无损编码，API 写入标准 sRGB ICC 后返回。每个 API 实例最多一个原像素窗口执行槽和一个等待槽，可与整图转换并行。窗口地址空间 1GiB，执行期限 10 秒，空闲 20 秒或处理 1,024 次后回收。取消和超时终止进程组。

新导入的 OpenEXR 在线性母版和 EXR 导出中都保留数据窗口、显示窗口和像素宽高比。尺寸与资源预算按实际采样的数据窗口计算，浏览器 SDR 代理仍以该窗口的栅格呈现。此前已生成的母版按其现有 EXR 头导出。要从旧素材重获原始窗口，可重新导入已保留的原件。

返回的 `precisionEdit` 包含实际输入类型、算法、数值和绑定来源的SHA256。`includesEditorRecipe:false` 保持原含义，因为它不重放浏览器的全部蒙版、修复、绘制、图层与几何。HTTP端要求匹配 `expectedSourceSha256`，能力目录在解码前报告精度、格式、像素与原生运行时状态。控制文件由父进程拥有，终止整个进程组后也会清理。

## 使用与输出身份

公开入口在 `src/index.ts`：

```ts
const descriptor = await processMedia({
  inputPath: '/private/imports/upload.bin',
  workDir: '/private/media/new-uuid',
  originalName: 'camera.NEF',
  signal,
  options: {
    maxPixels: 200_000_000,
    maxProxyPixels: 4_194_304,
    generateTiles: true,
    tileSize: 512,
    pythonExecutable: '/opt/media-venv/bin/python',
  },
});
const output = await exportMedia({
  workDir: '/private/media/new-uuid',
  outputPath: '/private/exports/new.png',
  format: 'png16',
  signal,
});
// output.includesEditorRecipe === false
```

路径只来自服务器可信存储层，绝不能接受用户任意路径或 URL。`workDir` 必须是新的私有目录，`outputPath` 必须未存在；两个并发任务竞争同一目录时只能有一个成功，失败者不删除另一个的结果。创建 `.partial` 内容，所有文件成功后最后发布 `descriptor.json`。取消/超时杀死进程组并清理本任务拥有的目录或导出文件。

`MediaDescriptorV1` 的固定协议为 `media-v1`：

| 输出                      | 保存内容                                                   | 精度与使用方式                                       |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| `original.bin`            | 上传的原编码逐字节复制与 SHA-256                           | 原始元数据、RAW 传感器内容和源 ICC 保留在这里        |
| `master.tif`              | 应用方向与明确色彩转换后的 sRGB、deflate、256px tiled TIFF | uint16 SDR 工作母版；低位深源不会凭空增加真实信息    |
| `proxy.png`               | 限定像素数的 sRGB RGBA8                                    | 用于浏览器现有编辑器；尺寸与母版分别记录             |
| `linear-master.exr`       | HDR 的线性浮点样本或新 RAW 导入的线性显影结果              | HDR 保留原动态范围。RAW 从相机白平衡、16 位线性去马赛克结果归一化 |
| `tiles.dzi / tiles_files` | 整幅母版的 JPEG 金字塔                                     | 用于大图查看；透明区域对白底合成，仅影响这些查看瓦片 |

`proxy.normalizedDimensions` 是方向归一化后的母版尺寸，`proxy.width/height` 才是预览像素尺寸。浏览器配方绑定的是它实际加载的源像素哈希，不能把代理哈希冒充原文件哈希。

DZI：`tileSize` 为 256/512/1024，`overlap:1`；`levels = ceil(log2(max(width,height))) + 1`，最大层编号为 `levels−1`。边缘瓦片有 overlap 时，请按完整 DZI 坐标放置与裁切。描述中的 tile bytes/count 不包括所有母版/原件；存储额度应由上层对真实文件树计量。

母版导出支持 `png16/tiff16/jpeg/webp`。编码前核对固定母版路径、尺寸、位深、文件类型、字节数和 SHA-256。发生篡改/损坏时拒绝用旧来源身份导出。PNG/TIFF 保留 16 位编码；JPEG/WebP 为 8 位，JPEG 透明转白。返回值明确 `includesEditorRecipe:false`。浏览器的修图配方目前没有被完整重放到高位深母版；这个开关不能删除或改成含糊文案。

## 实际格式矩阵

| 输入                                         | 已落地的处理                                                   | 边界                                                                  |
| -------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| JPEG、PNG、WebP、TIFF、单帧 GIF、AVIF        | sharp/libvips 实际解码；常规原图、alpha、方向处理              | 单幅静态；运行时编解码能力决定具体可用格式                            |
| RGB/灰度 8/16 位                             | uint16 SDR 母版；有 RGB ICC 时转换到 sRGB                      | 无 ICC 的 RGB 明确按 sRGB 解释                                        |
| CMYK JPEG/TIFF                               | 只接受带 ICC 的 8 位输入，由真实 CMS 转 sRGB                   | 无 ICC 拒绝；高位深 CMYK 拒绝；不是 CMYK 印前编辑/输出                |
| PSD v1 RGB/灰度 8/16 位                      | ag-psd 读取文件已保存合成图；有界图层名/边界/隐藏状态          | 不重新渲染文字、智能对象、效果；没有可编辑图层往返；PSB/CMYK/32位拒绝 |
| Camera RAW                                   | 可选 rawpy/LibRaw，16 位线性去马赛克、相机白平衡，同时保留线性母版和 sRGB 母版 | 全传感器至多64MP。按瓦片行写入线性母版，已裁切高光仍受显影边界限制 |
| EXR/Radiance                                 | 可选 OpenImageIO，flat 1/3/4 通道 float 解码与独立线性母版     | 至多50MP；deep、multipart、未知显式色域/曲线拒绝                      |
| JPEG Ultra HDR                               | 可选 libultrahdr 重建高光并转换到线性 Rec.709，独立保存原件、SDR 基图和 EXR32 母版 | 至多 24MP、128MiB、每边 8–8192 像素。原件和 SDR 开发在增益图解码器未启用时仍可用 |
| HEIC PQ                                     | libheif/libde265 解出 10/12 位样本，显式解释 NCLX 色域和参考白，保存原件、线性 Rec.709 EXR32 和 SDR16 母版 | 至多 24MP、128MiB、每边 8–8192 像素。单幅、不透明、无辅助图、无 ICC |
| 浮点 TIFF、SVG/PDF、JXL/JP2、动画/多页、其他 HEIC | 当前没有完整开启的导入工作流                                | HEIC 的 HLG、增益图、SDR 和 HEIC 同容器编辑导出仍待支持               |

本机验证过 JPEG、PNG、WebP、AVIF、GIF、16 位 TIFF/PNG、RGB8/RGB16 PSD、P3 ICC、CMYK JPEG/TIFF、实际 Nikon NEF、float EXR 与 Radiance。原件、母版原像素窗口、调色历史、PNG16/TIFF16/EXR32 的实拍验证另覆盖 Nikon NEF、Canon CR2、Sony A7 III ARW、富士 X-T4 RAF、宾得 K-1 DNG 和 Pixel 6 Pro DNG。Sony、富士、宾得和 Pixel 样本来自 raw.pixls.us 的 CC0 条目 2414、3914、2470 和 5961。另用条目 2790 的 Nikon Z7 NEF（45.75MP）和 3480 的 Sony A7R IV ARW（61.01MP）验证跨瓦片原像素窗口及三种格式的整图下载。具体证据见 `test/media.test.ts`、`scripts/qa/media-verify.ts` 和[验收主表](../../docs/research/PHOTO-EDITING-FEATURE-MATRIX.md#r02-和-f04-真实大幅相机-raw)。

### ICC 与元数据

对嵌入 RGB ICC 做一次显式转换；untagged RGB 使用明确 sRGB 假设。处理已知 sRGB 母版时禁用隐式 ICC 二次变换。当前 sharp 0.35 的 RGB16 默认处理中间 profile 可能是 P3，本实现避免把原来 sRGB 数值再隐式改变。测试对相邻 ushort 值做逐值相等比较，P3/CMYK 则和实际 CMS 参考输出比较。

PNG iCCP 与单页 classic TIFF ICC 元数据插入不改变已编码样本；相关读写处理短读/短写，不依赖一次系统调用一定写完整。不是任意 TIFF 编辑器，不支持 BigTIFF/多页重写。

`original.metadataSummary` 说明检查深度：普通 raster 为 `full`（只提取方向/EXIF是否存在/XMP是否存在/ICC摘要/页数），PSD 为 `icc-only`，可选原生解码为 `not-inspected`。这里的 full 是这个摘要的完整范围，**不是任意 EXIF/GPS 标签已全部解析**。未知值用 null，不能假报为不存在。原编码仍完整保留。相机时间/GPS 的编辑、选择性剥离以及完整 IPTC/XMP 标签表是后续独立工作；敏感元数据不应默认公开到团队。

RAW `bitDepth` 来自 LibRaw 白电平可表达位数，`sampleEncoding:'sensor-raw'`、`decodedBitDepth:16` 区分传感器与输出。Radiance 是 RGBE 共享指数：描述为 8 位 RGB 尾数、`sampleEncoding:'rgbe'`、解码 float32；不能当成普通8位SDR，也不能称源文件每通道32位浮点。

### HDR 的明确解释

EXR/Radiance 接受明确或默认线性 Rec.709/sRGB 的输入。显式 ACEScg、其他 chromaticities、未认可的 transfer/primaries 需先用可信色彩配置转换。没有色域标签的输入会标示假设。

SDR 母版采用固定亮度 Reinhard：非负线性 RGB 除以 `1+Y`，再 sRGB 编码并裁切 SDR 范围。RGBA 按 OIIO 默认 associated alpha 读取，做非线性色调映射前解除预乘，并将 TIFF 声明为 straight alpha。负值/超出 SDR 色域的值只在 SDR 结果裁切，float 母版与原件分别保留。浏览器目前显示 SDR 预览。

Ultra HDR JPEG 保留原 JPEG 的 SDR 基图与色彩解释。参考解码器以线性半浮点重建增益图的最高 HDR 意图，再逐条带把解码器报告的 Rec.709、Display P3 或 Rec.2020 转成 Rec.709。浮点母版保留负通道及大于 1 的值，并按 EXIF 方向写入。选择 `format:'ultrahdr'` 时，同一母版调色结果经编码生成新的 SDR 基图和增益图，支持原尺寸及原图坐标内裁切。精确浮点交付使用 EXR32。由增益图母版生成的浏览器窗口和 SDR 导出在量化到 sRGB 前统一应用 Reinhard 映射，保留 SDR 上的亮部层次。`toneMap:'none'` 保留 HDR 输出的线性高光。[Android Ultra HDR 规范](https://developer.android.com/media/platform/hdr-image-format)

HEIC PQ 按 ST 2084 把原始编码值转换为绝对亮度。用文件声明的 `ndwt` 漫射参考白归一化，缺省用 203 cd/m²。Rec.709、Display P3 或 Rec.2020 转成有符号线性 Rec.709。参考白和源色域写入 `original.pq`。调色保存、原像素窗口、PNG16、TIFF16、EXR32 和 Ultra HDR JPEG 复用同一母版。原件下载保留 HEIC 字节，调色后的 HDR 下载提供 EXR32 或带增益图的 JPEG。[Apple HDR 样例](https://developer.apple.com/documentation/uikit/supporting-hdr-images-in-your-app) · [ITU-R BT.2408](https://www.itu.int/pub/R-REP-BT.2408)

## 部署与资源治理

默认 Node 24 + 固定依赖 `sharp@0.35.5/ag-psd@34.1.0`。可选原生环境单独创建：

```sh
python3 -m venv /opt/media-venv
/opt/media-venv/bin/pip install -r packages/media/native/requirements.txt
```

requirements 固定 rawpy 0.28.0、OpenImageIO 3.2.2.0、numpy 2.4.2。`getMediaCapabilities({pythonExecutable})` 同时返回 `nativeConfigured`（可信路径可执行）和 `nativeReady/nativeVersions`（实际 import 探测结果）。路径存在不等于依赖能导入，依赖能导入也不等于任意文件能解码。

`server-media` 镜像固定构建 [libultrahdr 参考解码器](https://github.com/google/libultrahdr/blob/5f117294cb701170b9198ed8eae16270aa84896c/ultrahdr_api.h)，并配置 `MEDIA_UHDR_LIBRARY`。独立部署可用 `options.ultraHdrLibrary` 指向受信的库文件绝对路径，由 `getMediaCapabilities` 探测。JPEG 编码由镜像内 Sharp/libvips 实现，发布前验证输出带增益图且尺寸符合请求。

同一镜像固定构建 HEIC 解码器，配置 `MEDIA_HEIC_DECODER`。独立部署的 `options.heicDecoder` 指向可信可执行文件的绝对路径，由 `getMediaCapabilities` 探测。解码由受限 Linux 进程组执行。[libheif 1.23.7](https://github.com/strukturag/libheif/releases/tag/v1.23.7) · [libde265 1.1.3](https://github.com/strukturag/libde265/releases/tag/v1.1.3)

当前 worker 是项目内 TypeScript 固定入口，父进程用 `--import tsx` 启动；部署要保留此包的 `src/worker.ts`、`native/convert.py`、tsx 及本项目目录结构。它不是可随意只复制一个编译后 index.js 的独立二进制包。

| 资源               | 当前值                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ |
| 普通 raster 源像素 | 默认 200,000,000，可通过 `MEDIA_RASTER_MAX_PIXELS` 设置至 256,000,000，宽高各不超过 65,535 |
| 输入文件           | 至多512MiB                                                                                 |
| 代理图             | 至多4,194,304像素                                                                          |
| Camera RAW         | 至多64MP。LibRaw 显影保留整幅 uint16 数组，float32 归一化按瓦片行执行                      |
| EXR/Radiance       | 至多50MP，原生解码仍分配整幅数组                                                            |
| PSD                | 至多16,777,216像素、128MiB编码、256元数据节点、解析器内存预算512MiB                        |
| 并发队列           | 每个API进程1执行、8等待；不是分布式队列                                                    |
| wall timeout       | 默认180s，可配置1～600s                                                                    |
| Linux prlimit      | 默认每进程地址空间4GiB，可配置1～8GiB；单文件2GiB、文件描述符128、CPU时间有界              |
| Node/decoder       | JS堆512MiB、jitless；sharp1线程、cache32MiB                                                |
| 瓦片数             | 至多8192                                                                                   |

普通 raster 在像素解码前从文件头核对尺寸、页数、位深和配置。全帧编解码器、
渐进式输入、需要垂直重排的方向和瓦片层数分别检查内存与临时磁盘。
超窄代理图在短边取整到 1 后仍检查长边，确保输出面积不超限。
母版导出从已保留文件的实际摘要、元数据和目标编码预算重新判断。

`prlimit` 是资源隔离，**不是 syscall、文件系统或网络沙箱**。生产部署还需非 root 容器、只读根目录、仅挂载工作目录、网络禁止、进程组总 cgroup 内存与真实磁盘配额。Node 和 Python 各自受地址空间限制，不代表两者总 RSS 严格等于那个值。单文件限额不等于整个作业目录磁盘限额。

worker 不获得应用密钥/代理密码/AI provider key；API 上层负责登录、空间授权、资产 ACL、计费、任务持久状态和被撤权后停止服务。UUID 不是权限凭据。进程崩溃时留在私有工作目录的半成品需要上层重启清理策略。

## 真实验证与可重复命令

普通 `npm test -w @ai-xiutu/media` 不下载模型、不访问收费 API。覆盖真实编码/ICC/高位深/透明度/PSD、来源保留、取消、资源拒绝、并发输出冲突、损坏输入和母版完整性。

可选独立验收：

```sh
MEDIA_QA_PYTHON=/absolute/venv/bin/python \
MEDIA_QA_RAW=/absolute/authorized/sample.NEF \
node --import tsx scripts/qa/media-verify.ts --large
```

输出 `artifacts/media-v4/evidence.json`。`--large` 创建真实20,000×10,000 uint16非均匀梯度TIFF，走完整母版、代理和瓦片，并测试真实处理中取消/超时。该梯度高度可压缩，不能把它的耗时/内存推广成200MP摄影文件的最坏上限，也没有测试200MP逐像素浏览器编辑。

依赖许可与待接入项目的代码/权重区别见 [研究矩阵](../../docs/research/v4-image-media.md)。
