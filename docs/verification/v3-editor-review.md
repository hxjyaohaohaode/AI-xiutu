# V3 内核、人像与预览模块复核记录

记录日期：2026-11-09。本文覆盖本轮负责的图像内核、人像语义编译、预览预算与对应测试；不是整个仓库的逐行审计声明，也不把模块测试当作真实浏览器视觉验收。全仓库冻结回归由总验证记录单独列出。

## 实际复核的文件与关键路径

实现时及冻结前逐文件阅读了以下生产代码。涉及旧版本的文件只修改版本联合、解析/执行分派和必要导出；没有改写旧 V1/V2 数学。

| 文件                                                                          | 实际核查内容                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/editor/src/v3-types.ts`                                             | 版本号、纯数据结构、原图归一化坐标、完整颜色块、区域组、绘制/克隆/擦除、图像资源引用、液化与追溯字段                                                                   |
| `packages/editor/src/v3-registry.ts`                                          | 每项参数上下界、中性值、正负含义、几何精度、全配方预算、混合模式白名单                                                                                                 |
| `packages/editor/src/v3-recipe.ts`                                            | 无访问器有界复制、未知字段拒绝、循环/稀疏数组/原型/符号拒绝；完整颜色校验、蒙版递归预算、总点/笔触预算、唯一 ID、区域组引用、迁移和通用参数读写                        |
| `packages/editor/src/v3-geometry.ts`                                          | 原图→整数裁切/四分之一旋转/翻转→精细变换的顺序；3×3 矩阵逆变换、透视可见域、奇异组合、输出尺寸预检、编译后坐标映射和内容液化映射分离                                   |
| `packages/editor/src/v3-pixels.ts`                                            | 线性光与预乘 alpha 的双线性重建；透明边界、原像素精确落点、隐藏 RGB、取消检查                                                                                          |
| `packages/editor/src/v3-mask.ts`                                              | 联合/相交/相减/异或的软权重语义、反选、有限采样坐标、旧蒙版兼容、短路不改变数学结果                                                                                    |
| `packages/editor/src/v3-blend.ts`                                             | 16 种 W3C 混合、非分离色相/饱和度/颜色/明度模式、直 alpha 的 source-over 合成、透明背景和零透明度                                                                      |
| `packages/editor/src/v3-optics.ts`                                            | 5×5 明度/色度独立降噪、alpha 不变、平场不变、带符号红/蓝径向色散；没有把传统算法标成 AI 检测                                                                           |
| `packages/editor/src/v3-paint.ts`                                             | 连续胶囊笔触、空间索引、密集采样不重复累积笔触透明度、孤立图层擦除、冻结克隆源、层蒙版/混合、图像图层逆映射、共享资源、计算预算预检                                    |
| `packages/editor/src/v3-warp.ts`                                              | 推移/收缩/膨胀/旋转的有界反向位移场、负值反向、保护蒙版锁定像素、一次重采样、零场逐字节保留                                                                            |
| `packages/editor/src/v3-engine.ts`                                            | 确定的阶段顺序、旧版本中性迁移、组共享调整只应用一次、组后独立区域、源颜色选择不读变色后的像素、输出与资源预算、取消和 full/tiled 一致性                               |
| `packages/editor/src/index.ts`、`v2-types.ts`、`v2-recipe.ts`、`v2-engine.ts` | V3 公开 API/类型和分派；拒绝静默降级丢弃 V3 字段；旧算法继续走原执行路径                                                                                               |
| `packages/portrait/src/types.ts`、`catalog.ts`                                | 46 项实际语义控制、真实 target 类别、单双向范围、可替换分析契约、未实现工业算法不伪装为已实现能力                                                                      |
| `packages/portrait/src/validation.ts`                                         | 分析纯数据边界、数量/坐标/可见性/轮廓上限、源图 hash 和尺寸绑定、目标 ID 重复及跨源关联拒绝                                                                            |
| `packages/portrait/src/adapter.ts`                                            | 驱动是否配置、分析预览预算、预览比例、模型/算法版本一致性、冻结 SourceFrame、推理前后取消检查                                                                          |
| `packages/portrait/src/geometry.ts`                                           | 真闭合轮廓、开放眉毛连接凸包、面部/皮肤与五官排除、口腔排除、原图坐标区域                                                                                              |
| `packages/portrait/src/plans.ts`                                              | 全 46 项生成实际 V3 primitive；非方形图像的像素空间面轴；侧转/倒置方向；逐身体功能所需关节；同人物替换、不同人物独立；每项妆容独立颜色；整人物脱离自动控制及防覆盖校验 |
| `packages/portrait/src/index.ts`                                              | 公共分析/编译/恢复/可用性/脱离接口与类型统一导出                                                                                                                       |
| `apps/web/src/editor/previewBudget.ts`                                        | 根据变换后尺寸规划预览缩放；仅下采样一次；线性光预乘 alpha 面积采样；不修改配方或源坐标；奇异变换不被伪装成预算问题                                                    |
| `apps/web/src/editor/render.worker.ts`                                        | 主渲染与比较/裁切/选区辅助 Worker 使用相同预算规划；导出保留完整规范化原图；主 Worker 先拒绝不可导出的原图/输出尺寸；已有图层资源映射与源图重置                        |

测试文件同时检查了断言是否真的比较像素、输入是否不可变、full/tiled 是否使用独立执行入口、超限是否发生在大图中间分配之前，而不是只检查函数返回对象有某个字段。

## 冻结前发现并修复的问题

1. 精确 ±90° 旋转的浮点误差可能把透明像素的隐藏 RGB 清零。重建器改为双向近整点判断，并用多个非方形尺寸、两种旋转方向和透明 RGBA 验证精确排列。
2. 坐标映射若每个采样点重新解析整份配方，会在选区预览和手势中产生不必要开销。`compileEditorCoordinateMap` 一次解析和构建矩阵，闭包同时缓存整数裁切/翻转数学。
3. 多图层引用同一张不可变图像时不应重复计入已解析资源内存。资源预算按 sourceId 去重，同时保留每个图层的实际混合。
4. 密集且覆盖面积大的绘制路径可能在图像中间分配后才暴露工作量。空间索引引用量与估计工作量改成全配方累计并提前检查；超限测试确认没有先分配图像大小的字节数组。
5. 接近画幅大小的人脸妆容曾可能生成超过 parser 上限的笔刷半径。改为合法的整幅胶囊填充配合真正部位蒙版，并检验口腔和蒙版外像素。
6. 妆容 RGBA 追溯值曾可能被误读为人物滑条。恢复函数现在只取注册控制；独立颜色恢复不随无关滑条改变。
7. 身体工具不能因不需要的膝踝不可见而禁用肩颈操作。按工具独立检查实际需要的关节。真实 CPU 推理进一步发现上半身照片中不可见脚点可达 y=2.642，数据边界改为身体点有界 `[-8,8]`、面部点保持 `[-1,2]`；工具仍严格要求所需关节在图内且 visibility≥0.5，避免整份有效面部结果被不可见脚点连带拒绝。
8. 面轴不能简单采用屏幕竖直方向。用原图像素比例和眼—嘴方向定轴，覆盖倾斜、侧转和倒置照片。
9. 自动人像层经过手工精修后不能被下一次自动参数更新覆盖。完整 primitive 集合保存防误修改校验和；手改、部分删除、重排或缺少标记时拒绝重建。`detachPortraitTarget` 显式转换整个人物，保留像素、追溯并重命名唯一 ID。正常自动更新保留已有操作相对手动层的位置。
10. 原图预览本身小于 4MP，并不保证旋转/透视/缩放后仍小于 4MP。预览规划以实际输出尺寸为准，导出仍用原图；真实 Worker 协议验证 1800×1200 旋转 45° 的缩略预览和 2122×2122 导出。
11. Canvas 的液化坐标键、透明角落命中和形变后手势帧问题由本模块复核反馈给主集成者，其修复与浏览器测试记录在工作台验证中；这里不重复宣称已做整个 UI 的像素视觉验收。

## 已执行命令与结果

以下是冻结前本模块实际执行的结果，不把它们称作六轮全仓回归：

| 命令                                                                                                       | 结果                       |
| ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| `npm run typecheck -w @ai-xiutu/editor`                                                                    | 通过                       |
| `npm test -w @ai-xiutu/editor`                                                                             | 142 项通过，0 失败、0 跳过 |
| `npm run typecheck -w @ai-xiutu/portrait`                                                                  | 通过                       |
| `npm test -w @ai-xiutu/portrait`                                                                           | 21 项通过，0 失败、0 跳过  |
| `npm run typecheck -w @ai-xiutu/web`                                                                       | 通过                       |
| `node --import tsx --test apps/web/test/render-preview-budget.test.ts apps/web/test/render-worker.test.ts` | 5 项通过，0 失败、0 跳过   |

人像渲染测试逐项运行全部 46 个注册控制，验证非零实际改变像素；有符号参数的正负结果不同，full/tiled 字节一致。两个人物同时启用全部面部控制后的配方为 10 个区域、14 个绘制图层、64 个液化笔触。此证据证明实现和预算，不证明真实模型在人群中的准确率或所有图片的美学质量。

## 明确的能力与未完成验收边界

- V3 源图和输出各最多 16,777,216 像素，默认执行预算 4,194,304 像素。数据契约能表示 64MP 不是 V3 64MP 渲染承诺。
- 12 个新区域、6 个区域组、24 个绘制层、8 个图像层、128 个绘制笔触、8192 个绘制点、64 个液化笔触、128 个蒙版节点都是全配方共享预算。复杂蒙版另有深度、点数和 RLE 预算。
- 预览高阶计算仍在 CPU 上；分块限制浮点工作缓冲区，不代表没有完整 RGBA 中间图。没有声称手机上任意 16MP、多区域、多人物组合都能实时运行。
- 颜色结果是 sRGB RGBA8。新阶段之间会量化到 8 位，不是浮点 HDR、CMYK 印前、RAW 显影或无损全色域管线。
- 液化是二维反向采样场，不保证任意多笔后全局可逆。局部形状/保护编辑使用明确的源帧；画笔和取色用输出→内容映射，不能拿简单三点仿射替代。
- 人像 46 项为关键点/区域驱动的确定性基线。自动祛痘识别、真实皱纹识别、发丝重建、遮挡感知三维重塑与逐帧美颜未实现，不能用菜单名称代替算法。
- 浏览器模型运行需要真实可用的 WebGL 2，即使配置 CPU delegate。当前云端浏览器缺少该能力，自动浏览器推理没有通过验收；产品会清晰回退至手工编辑。原生 Python CPU 推理是独立证据。
- 原生 CPU 核查实际发现曾下载的 pose 模型被截断，尽管与旧固定 hash 一致仍无法打开 ZIP。已反馈主集成者修正完整官方资源、固定 hash 和文件完整性验证。原生结果及公开规范化样本保存在 ignored `artifacts/portrait-cpu`，不把测试照片和模型数据写进 Git。

## 真实模型与实际像素补充验证

完整脱敏结果保留在 [v3-portrait-native.json](v3-portrait-native.json)，包括公开输入 URL/摘要、三个模型的固定 SHA-256、运行条件、46 个控制逐项像素结果，以及参与算法源码的摘要。照片、规范 PNG、原始关键点、分割网格与模型二进制没有加入 Git。

| 公开样本                     | 实际原生 CPU 检测                         | 产品可用性判定                                      |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------- |
| Matplotlib Hopper，512×600   | 1 个面部目标、478 点；1 个身体目标、33 点 | 面部 36/36；身体 4/10，图外或不可见关节所需功能禁用 |
| MediaPipe portrait，820×1024 | 1 个面部目标、478 点；1 个身体目标、33 点 | 面部 36/36；身体 7/10，腿部相关 3 项禁用            |
| MediaPipe pose，1000×667     | 0 个面部目标；1 个身体目标、33 点         | 身体 10/10；没有伪造未检测到的脸                    |

保留的实验脚本已经从固定模型与样本重新完整执行。实际结果为：36 个面部控制和 10 个身体控制全部改变真实照片像素；36 项带符号控制的正、负效果不同；46 项 full/tiled 逐字节一致；18 项颜色/妆容控制的蒙版外像素逐字节不变；源图哈希保持不变。三张图片还分别执行了组合配方和 full/tiled 比较。已实际查看源图、真实关键点/皮肤估计叠加、渲染结果对照和人脸细节放大图。这是三张公开图片的链路与烟雾测试，不是工业修图质量或普遍识别准确率认证。

复现入口：[scripts/qa/README.md](../../scripts/qa/README.md)。它列出独立 Python 环境、固定 requirements、公开样本下载与模型准备步骤；普通 `npm test` 不下载模型/照片，也不触发收费 API。准备后从仓库根目录运行：

```sh
artifacts/portrait-cpu/venv/bin/python scripts/qa/portrait-native-infer.py
node --import tsx scripts/qa/portrait-native-verify.ts
artifacts/portrait-cpu/venv/bin/python scripts/qa/portrait-native-visuals.py
node scripts/qa/portrait-native-report.mjs
```

推理脚本检查固定样本摘要和 `.task` ZIP 完整性；JPEG 先按 ICC/EXIF 规范成同源 RGBA PNG。验证脚本核对 Python/JS 官方连接表、runId、模型 manifest 和完整源图 hash，再经过产品适配器。图外身体估计值保留为有界数据，严格按每个工具所需关节判断可用性。运行时的 XNNPACK/可选 feedback tensor 与 NORM_RECT 警告记入脱敏记录，不隐瞒底层模型警告。

## 数学和模型依据

- [W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/)：混合和 alpha 合成数学。
- [OpenCV Geometric Image Transformations](https://docs.opencv.org/4.x/da/d54/group__imgproc__transform.html)：二维几何逆映射与重采样概念；本项目实现自身纯 TypeScript 数学。
- [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)、[Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)、[Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)：实际分析输出与接口。模型输出是估计值，必须结合真实照片质量验收。
