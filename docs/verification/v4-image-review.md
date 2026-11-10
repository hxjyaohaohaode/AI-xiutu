# V4 图像内核、人像与媒体：逐文件复核及真实验证

本记录覆盖 `packages/editor`、`packages/portrait`、新增 `packages/media` 与对应 QA 脚本。本轮的代码审阅、自动化回归、真实像素运算、人工视觉观察分别记载，不能把其中一种称为另一种，也不把本子模块检查冒充全仓六轮门禁。

## 1. 已完成的实际验证

| 范围           | 实际执行                                                          | 本次结果                                                                      |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 编辑器全包     | `npm test -w @ai-xiutu/editor`                                    | 153/153，通过；含11条V4专项测试                                               |
| 人像全包       | `npm test -w @ai-xiutu/portrait`                                  | 30/30，通过；含4条V4/像素执行器测试及5条面部过渡/旧版回放/颈长可用性测试      |
| 媒体全包       | `npm test -w @ai-xiutu/media`                                     | 7/7，通过；每条含多实际格式/流程断言                                          |
| 三包类型       | 分别执行各包 `npm run typecheck`                                  | 全部通过                                                                      |
| 真实照片扫值   | `node --import tsx scripts/qa/editor-v4-sweep.ts`                 | 5类照片、80个全局数值控制、2,630次实际渲染对照、12项不可用、68张接触表、0失败 |
| 原尺寸面部过渡 | `node --import tsx scripts/qa/portrait-v4-boundaries.ts`          | 2张真实规范图片、10次整幅/分块一致检查，2张前后对照实际查看                   |
| 原生与大图     | `scripts/qa/media-verify.ts --large`，使用固定native环境及真实NEF | 见 `v4-media-native.json` 的逐例最新结果与环境                                |

2,630是修正后实际执行的案例数，每例都重新渲染整图与64px分块结果，逐字节比对输出，同时校验源像素未变。这个数字不是参数控件个数，也不是全部可能图像/参数组合的穷举。每项数值取5个有界采样：最小、中间、中性（适用时）、另一中间、最大；输出尺寸、SHA、改变像素数、平均色差、通道裁切数与耗时保存在 [完整紧凑数据表](v4-image-sweep.json)。原先2,645次中三个身体样本的五个颈长值已删除，新增三条明确不可用记录，不计作成功效果。

实际照片扫值使用长边至多320px的预览；不能据此断言16MP每个参数都具有相同速度/视觉质量。包含4类照片的全局80控件、多局部完整颜色、任意形状曲线、组/蒙版布尔组合、16混合、人像控制、独立质感、Poisson修复、四角与保护液化。依赖参数的效果会先启用真实上下文，例如扫描分级色相时给定分级饱和度，扫描颗粒大小/种子时启用颗粒量。

部分身体关键点不可见，Hopper的手臂/腰/胯/腿/身高等6项、近景portrait的腿/身高3项明确记录为不可用；三个身体样本的自动颈长因不能可靠保护脸与肩膀而停用，合计12项不可用，没有算成渲染通过。全身pose样本实际覆盖其余9项身体控制。花朵局部没有有效紫色色相样本，三个局部purple控制五值均相同，属于适用范围内无该颜色的正常不变；它们没有被当成“所有颜色都变了”的证据。

V4扫值复用既有 [真实原生MediaPipe CPU证据](v3-portrait-native.json) 的分析，重新校验完整规范RGBA哈希后才用原图归一化关键点。没有在产品中硬编码样本点，也没有把此次重放称为浏览器自动人像推理再次通过。

## 2. 本轮逐文件复核清单

这里的“复核”表示读过本轮对应源码/改动并核对相关数据路径与测试，不表示形式化证明所有无限状态均正确。现有旧引擎未改的数学由原版全包回归保持；本轮并未声称六次人工逐行阅读全部历史代码。

| 文件/组                                                           | 核对内容与结论                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `editor/src/v4-types.ts`                                          | 新版本字段、坐标约定、修复/质感独立语义、公开硬预算；无隐藏模型字段                                                                              |
| `editor/src/v4-recipe.ts`                                         | 有界纯数据复制、严格字段/枚举/ID、复合mask总量、新旧显式迁移、禁静默降级、neutral defaults                                                       |
| `editor/src/v4-geometry.ts`                                       | 8自由度真实单应、四点/逆矩阵、convex/orientation/horizon判定、contain偏移、crop固定frame、尺寸在分配前验证                                       |
| `editor/src/v4-engine.ts`                                         | 新操作与旧各阶段顺序、迁移fast path、辅助图层预算、单次合成重采样、两个逆地平线透明处理、取消                                                    |
| `editor/src/v4-spatial.ts`                                        | 扫描与ROI预算、有效权重/保护、opaque约束、donor不重叠与邻域alpha、搜索上限、Poisson边界/梯度、六独立算子、精确外部像素/alpha、取消               |
| `editor/src/v3-geometry.ts`                                       | 统一compile-once映射、源/输出/内容三个语义、旧整数crop量化、所有中间viewport可见性、源透明像素可操作；被裁掉源点仍可能无法正向投影，UI须显式处理 |
| `editor/src/v3-recipe.ts`                                         | 只导出已有有界reader供v4复用、增加降级拒绝；旧参数设置沿用白名单并保留新结构                                                                     |
| `editor/src/v3-engine.ts`                                         | 仅导出旧整数构图函数复用，没有重写旧v3滤镜/采样数学                                                                                              |
| `editor/src/v2-types.ts / v2-recipe.ts / v2-engine.ts / index.ts` | 通用union、解析/渲染分发、迁移拒绝、公共导出；旧version仍走旧入口                                                                                |
| `editor/test/v4.test.ts`                                          | 全中性迁移、实际四点/逆、真实平移、组合构图、horizon、保护/repair/不同retouch像素、tile一致、取消与拒绝预算                                      |
| `portrait/src/plans.ts`                                           | V3/V4泛型保留；新skin仅明确v2语义生成retouch；完整性seal包括新增primitive；零值、detach唯一ID、多目标和手改保护不丢失                            |
| `portrait/src/geometry.ts / test/mask-v4.test.ts`                 | V4按实际脸部像素尺度的向内过渡，原眼眉口与皮肤交集不变；V3蒙版/配方/像素固定摘要，尺寸/长宽比/旋转、实际曝光过渡、旧颈长回放与清除保留其他控制   |
| `portrait/src/retouch-adapter.ts`                                 | 未配置真实driver时拒绝；模型SHA/许可字段、源RGBA哈希、4MP范围、独立输入、结果版本/尺寸、取消、外部像素和alpha保护；端口本身不是神经模型          |
| `portrait/src/index.ts / test/v4.test.ts`                         | 公共API与类型可导入；两个人完整向量保持独立且符合预算；source/late-cancel/integrity不以虚假驱动冒充模型实测                                      |
| `media/src/types.ts / index.ts`                                   | 原件/16位母版/float线性母版/8位代理/瓦片身份分开；ICC未知为null；原sampleEncoding与解码位深分开；export不含browser recipe显式为false             |
| `media/src/process.ts`                                            | 可信绝对解释器路径、限额/FIFO排队取消、独占目录/导出保留、环境密钥隔离、prlimit与整个进程组kill、超时/取消回收；明确不是文件系统/网络沙箱        |
| `media/src/capabilities.ts`                                       | Linux执行条件、运行时decoder输入能力、native配置与真实import探测分开、缓存有界；不把可执行路径存在当模型/格式验证通过                            |
| `media/src/worker.ts`                                             | 固定worker入口、原编码SHA、文件签名及真实解码、静态/页数限制、PSD合成图预算、RGB/CMYK/ICC、master/proxy/DZI、描述最后发布、导出母版完整性校验    |
| `media/src/icc.ts`                                                | 已生成PNG/classic单页TIFF的metadata-only ICC写入，长度与目录边界、短读/短写、PNG颜色块替换、不二次色彩转换                                       |
| `media/native/convert.py`                                         | RAW全sensor预算、实际LibRaw输出；HDR通道/deep/multipart/finite/色域拒绝；associated alpha先解除预乘再tone-map；float副本与SDR母版分开            |
| `media/native/requirements.txt / package.json / tsconfig.json`    | 精确依赖、node-only模块、原生步骤可选、无模型/付费调用隐藏安装；普通test不下载外部素材                                                           |
| `media/test/media.test.ts`                                        | 真实PNG16/uint16相邻值/CMYK/P3/PSD/GIF/AVIF/WebP/alpha/EXIF方向、篡改母版拒绝、重复目录争用、预有辅助文件不误删、预算/取消/异常                  |
| `scripts/qa/editor-v4-sweep.ts`                                   | 使用实际照片、校验分析来源、从公共注册表取边界、生成实际接触表与数据，不把期望值写成执行结果                                                     |
| `scripts/qa/portrait-v4-boundaries.ts`                            | 完整源RGBA哈希绑定，两个原尺寸人像分别比较固定旧羽化与新羽化，整幅/分块对等、原始局部蒙版剖面与前后接触图                                        |
| `scripts/qa/media-verify.ts`                                      | 实际native解码、受控synthetic200MP编码+完整处理、取消/超时与ICC导出中断；不在普通门禁中自动下载或执行昂贵步骤                                    |

`v4-image-sweep.json`、`v4-media-native.json` 中保存本轮源文件摘要，用于对照执行快照；根任务的最终提交和六轮完整仓库验证另行记录，不能用这里的包测试替代。

## 3. 真实执行/复核发现并修复的具体问题

1. **合法quad的包围矩形内存在逆投影地平线。** 旧的新路径会在透明角落抛异常。已把它视为透明，并增加实际像素/命中测试。
2. **fine透视与四角串联的中间逆地平线。** 随机有界组合找到了有效且可复现的参数，构造到像素中心；原V4整图报错，现输出该角落透明且有效区域继续渲染，旧v3不改。
3. **颜色转换的隐式中间profile。** 对RGB16默认P3路径进行实际检查后，采用一次显式嵌入profile→sRGB，已知sRGB中间图禁隐式二次转换；相邻16位样本测试不再丢低位。
4. **TIFF默认压缩可导致8位编码。** 改成明确deflate uint16并解码验证位深；PNG16/TIFF16输出都实际检查。
5. **HDR alpha语义。** 真实associated-alpha EXR需要在非线性tone-map前解除预乘，写出straight-alpha TIFF；实际像素与预计算参考匹配。
6. **RAW/Radiance源位深描述。** RAW用白电平表达传感器位深；RGBE尾数+共享指数与float解码分别记录，避免把Radiance误称普通8位SDR或源每通道32位float。
7. **donor梯度读取透明边邻。** 原本仅检查donor目标alpha，邻域隐藏RGB仍可能参与梯度；现包含完整梯度邻域不透明检查，真实透明边邻fixture拒绝。
8. **母版完整性。** 一个仍能被TIFF解码的附加数据篡改不能沿用原来源导出；编码前核对字节数/SHA，失败不删原件。
9. **PNG ICC插入期间取消。** SIGKILL无法运行子进程finally；父进程必须清理自己保留的 `.partial.icc`，并先拒绝既有辅助路径，避免删到别的任务内容。真实过程中断结果见媒体证据。
10. **实际额头明暗边界。** 视觉复核发现固定图像短边羽化对不同人脸大小不合适。仅新V4自动编译改为按脸实际像素尺寸向内羽化；原尺寸对照确认额头边界减轻，中央曝光与五官保护保持。眼镜/粗分割边缘仍有限制，详见定向修正记录。
11. **自动颈长语义错误。** 实际极值会拉伸鼻口；当前锚点圆形推移不能实现受约束头颈伸缩。V4明确停用该自动能力并拒绝非零值，V3及已存操作回放不漂移，可清除旧效果且保留其他身体调节，不宣称已完成精准颈长。

照片修复初次扫值中，测试donor与目标过近，产品正确拒绝了5个配置；随后修正测试补片中心并重跑完整照片矩阵。没有把被拒绝样本计作通过。最终核查记录保留明确边界，不把测试fixture调整伪装成算法质量突破。

## 4. 人工视觉观察与质量边界

初次审阅实际打开以下8张接触表。其后分工执行的实际逐张观看记录见 `v4-visual-review-part1.md` 至 `part4.md`，它们保留修正前SHA；本次受影响5张新图和2张原尺寸前后图的实际复核见 [定向修正记录](v4-visual-review-fixes.md)。各报告仅对自己的实际查看范围负责，不以文件摘要代替观看。

| 接触表（`artifacts/editor-v4-sweep/` 下） | 实际观察                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `hopper-retouch.jpg`                      | 六种信号运算有不同效果；强负纹理塑料化、强正纹理强化细纹，说明需要用户控制和手动检查 |
| `hopper-face-1-1.jpg`                     | skin局部与背景分离基本可见，极端脸型会造成邻近纹理扭曲；不是商业遮挡/背景重建        |
| `portrait-face-1-3.jpg`                   | 五官与妆容独立变化；鼻长/表情等极值仍可能不自然，真实二维位移不等于三维重塑          |
| `pose-body-1-1.jpg`                       | 全身不同关节控制真实改变身体；强腿/腰调节会带动附近海岸纹理，需保护区与适度强度      |
| `flower-curve-mask-paint.jpg`             | 曲线、布尔mask、组联动、16种混合产生不同结果；并非用同一透明色块替代所有混合         |
| `flower-hsl-1.jpg`                        | 色相连续变化可见；极端明度出现裁切黑白，这是8位SDR范围的实际结果                     |
| `geometry-protection.jpg`                 | 四角形状与背景保护范围可见；强液化允许明显扭曲，不应被系统默认套用                   |
| `photographic-repair.jpg`                 | 小水面细节的有限迭代修复可见，但不能据此判断大型物体移除效果                         |

初次8张表是320px预览上的质性观察，后补面部过渡图使用原尺寸像素；都没有用“肉眼看起来不错”代替逐字节验证，也没有用像素改变数量证明美颜自然。缺少系统性年龄/肤色/遮挡/逆光/多人物重叠人群数据集评价；没有HDR显示器、真实手机GPU、200MP摄影最坏纹理文件的完整性能验收。

## 5. 复现与来源

先按 `scripts/qa/portrait-native-inputs.json` 与既有V3原生验收记录准备授权样本和固定模型，生成规范PNG与analysis；确认完整源RGBA哈希一致。architecture/flower来自scikit-learn示例图片，原件及输出图片都留在ignored artifacts，不提交用户或第三方照片。

照片命令：`node --import tsx scripts/qa/editor-v4-sweep.ts`。输出完整原始数据为 `artifacts/editor-v4-sweep/evidence.json`，仓库提交的是保留全部案例摘要/哈希的 `v4-image-sweep.json`。

本次原生环境位于 `/workspace/scratch/c8b2edcd498c/media-native-venv/bin/python`，原生依赖版本写在媒体证据中。复现命令：

```sh
MEDIA_QA_PYTHON=/absolute/pinned/venv/bin/python \
MEDIA_QA_RAW=/absolute/authorized/iss030e122639.NEF \
node --import tsx scripts/qa/media-verify.ts --large
```

实际NEF来源URL/文件SHA/原件字节数、合成HDR/200MP构造方式以及逐例清理结果在 `v4-media-native.json`。素材/权重许可与软件许可证分别见 [研究矩阵](../research/v4-image-media.md)。未确认单张源图再分发许可时只提交来源/摘要，不能借软件仓库许可证默认授权图片。

## 6. 交付能力的明确边界

已实现的是可重放、有界、实际运行的图像控制与媒体导入/查看/母版转换路径。尚未完成的是商业级自动祛痘/发丝/3D遮挡、自动受约束颈长、部署好的神经修复模型、200MP浏览器全量编辑、16位/float配方重放、CMYK印前工作流、完整PSD图层往返与任意元数据表编辑。它们有明确协议/原件保留/候选结果边界可继续开发，但不能在当前交付时写成“所有软件有的功能都已达到同等质量”。
