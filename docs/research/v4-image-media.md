# V4 图像、人像与高级媒体研究矩阵

核查日期：2026-11-10。本记录只区分三个层次：官方公开描述了什么；公开实现/依赖具体能做什么；本仓库真正运行了什么。商业应用的宣传、论文指标、库的格式名称都不能直接变成本项目的质量或支持声明。没有复制醒图、美图、Snapseed、小米、OPPO 的专有代码、素材或模型。

## 一、产品参考与落地映射

| 参考对象与一手来源                                                                                                                                                            | 可以学习的公开能力/交互                                           | 本轮对应代码/路径                                                      | 仍然缺失或不等价的部分                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Snapseed 工具表](https://support.google.com/snapseed/answer/6183571?hl=en)、[透视](https://support.google.com/snapseed/answer/6157686?hl=en)                                 | 精细调色、局部工具、拖拽透视、缩放观察及边缘填充选项              | V3 完整颜色/复合区域；V4 真单应四角与统一逆映射                        | 本版透视露出的边界为透明，没有把边缘智能填充冒称已实现                                   |
| [Snapseed RAW develop](https://support.google.com/snapseed/answer/6312515?hl=en)                                                                                              | RAW 独立开发流程，输入能力受平台和设备限制                        | 单独 media native LibRaw→16位母版→8位代理                              | 不是全部相机支持，更不是浏览器直接处理RAW传感器数据                                      |
| [美图官方PC](https://pc.meitu.com/pc)、[美图服务协议](https://pro.meitu.com/xiuxiu/agreements/common/service.html)、[开发者商店页](https://apps.apple.com/cn/app/id416048305) | 人像、美肤、五官、身形、美妆、局部画笔、修复与项目化工作          | 46人物语义控制、多目标、独立颜色、蒙版/保护/手工绘制、V4专用质感       | 没有商业痘痘检测/发丝重建/遮挡理解；语义功能名不是质量证明                               |
| [醒图开发者商店页](https://apps.apple.com/cn/app/id1500526240)                                                                                                                | 分组调节、人像/妆容、身形与背景保护、RAW/消除等公开功能描述       | 单主控分层UI由前端实现；内核提供可逆参数、区域、真实修复和透明版本语义 | 未实测该软件所有内部功能，也没有可合法移植的公开完整算法/SDK；不宣称逐项达到同等成片效果 |
| [小米15 Ultra官方图库说明](https://www.mi.com/global/support/faq/details/KA-541936/)、[AI Erase Pro说明](https://www.mi.com/global/support/faq/details/KA-503772/)            | 按年月日组织、剪辑、拼图、抠图、AI扩展/消除、文字识别、分享水印等 | 资源组织由API/工作台负责；本包提供可追溯原件/母版与局部修复            | 视频、回忆成片、完整OCR等不是本轮图像内核实现；不能从某机型清单推断所有小米设备          |
| [OPPO AI Eraser官方说明](https://www.oppo.com/en/newsroom/stories/perfect-your-photos-with-ai-eraser/)                                                                        | 圈出对象→生成与周围协调的新内容，保持操作简单                     | mask/protection/版本候选与真实梯度域修复可复用同一交互                 | 当前小块Poisson修复没有语义生成背景能力，不能使用“与OPPO大模型消除等效”的表述            |

### 用户详细功能如何进入统一架构

- 构图：旧裁切比例不限制自由矩形；V3微角度/缩放/倾斜/投影与V4四角全部走显式矩阵。新功能不复写旧算法。
- 色彩：曝光/亮度/对比度/高光阴影/黑白色阶/饱和度/自然饱和度/色温色偏/曲线/HSL/分级/细节/颗粒等共用相同参数契约；全局、区域与成组区域复用。八个 HSL 控制锚点对色相连续插值，并不把图片强行分成八种颜色；当前工作色域仍是sRGB。
- 美肤：V4把保边亮度、双向纹理、局部色度、细线、高光、离散脉冲分成独立算子；人物识别与像素处理分层。没有把每个名称都映射成同一个blur。
- 五官/身形：真实关键点驱动二维位移，遮挡/缺失关节按各工具拒绝；手动液化和保护区保留。3D网格、遮挡重建、发丝并未完成。
- 美妆/绘制：每工具连续RGBA颜色、opacity、蒙版和独立混合；普通画笔/仿制/像素笔可与自动语义操作分离。用户手改自动层前转独立精修，防止后续自动重建覆盖手改。
- 消除/祛瑕：原图保留，显式选区/保护/donor，diffusion与patch-Poisson实际求解；另有真实像素执行器端口，但没有未配置模型的假成功。
- 文件与大图：原编码、16位母版、float HDR母版、8位代理、DZI是分开的可追溯对象。编辑器16MP的内存边界没有被伪装成200MP全量编辑。

## 二、公开实现、许可与采用决策

| 项目/原始来源                                                                                                                                                                                                                   | 实际可用原理                                                                                              | 许可核查与决定                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [GPUPixel](https://github.com/pixpark/gpupixel)、[美颜调用文档](https://gpupixel.pixpark.net/call/beauty_effects)、[滤镜表](https://gpupixel.pixpark.net/reference/filter-list)                                                 | C++/OpenGL shader；beauty_face_filter拼接blur/high-pass/beauty；makeup按关键点和纹理混合；reshape局部位移 | 主仓库[Apache-2.0](https://github.com/pixpark/gpupixel/blob/main/LICENSE)。实际读过beauty_face_filter、face_makeup_filter、face_reshape_filter和face_detector源文件；第三方Mars检测器的预编译库/权重不能仅凭主仓库LICENSE推定可再分发。本轮未打包这些第三方模型，采用已有可核验MediaPipe分析结果+独立CPU内核 |
| [LaMa](https://github.com/advimman/lama)、[许可证](https://github.com/advimman/lama/blob/main/LICENSE)                                                                                                                          | 频域卷积的学习型图像补全，可作为未来mask→candidate执行器                                                  | 代码Apache-2.0；[权重许可问题366](https://github.com/advimman/lama/issues/366)、[问题368](https://github.com/advimman/lama/issues/368)不能当授权证明。代码/权重/训练数据分开核对；本轮未下载或默认启用权重，不宣称商用许可已清楚                                                                             |
| [Poisson Image Editing论文](https://www.cs.cornell.edu/courses/cs5670/2020sp/resources/Perez_PoissonImageEditing.pdf)、[OpenCV seamlessClone](https://docs.opencv.org/4.12.0/df/da0/group__photo__clone.html)                   | 固定边界+源梯度的离散泊松方程                                                                             | 本仓库独立实现有界红黑Gauss–Seidel，没有复制OpenCV实现，也没有借用论文的结果图当本项目成片                                                                                                                                                                                                                   |
| [sharp](https://github.com/lovell/sharp)、[实际pipeline](https://github.com/lovell/sharp/blob/main/src/pipeline.cc)、[输出文档](https://sharp.pixelplumbing.com/api-output/)                                                    | libvips流式区域处理、ICC、位深输出、DZI                                                                   | sharp Apache-2.0；vips [LGPL-2.1-or-later](https://github.com/libvips/libvips)。本轮实际安装sharp0.35.5/vips8.18.7，保留原生依赖许可；依赖本身并不保证任何格式均在本构建启用                                                                                                                                 |
| [sharp原生依赖声明](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md)                                                                                                                                   | libpng/libtiff/libwebp/libheif/LCMS等实际编解码及CMS                                                      | 不把整个原生依赖树都称为Apache。发布二进制/容器需保留各依赖notices，LGPL等义务按分发方式落实                                                                                                                                                                                                                 |
| [rawpy](https://github.com/letmaik/rawpy)、[LICENSE](https://github.com/letmaik/rawpy/blob/main/LICENSE)、[LibRaw许可证](https://github.com/letmaik/rawpy/blob/main/LICENSE.LibRaw)                                             | 相机RAW解码、黑白电平、demosaic、相机白平衡与16位输出                                                     | rawpy MIT；LibRaw LGPL-2.1/CDDL-1.0双许可。固定rawpy0.28.0/LibRaw0.22.2，未启用额外GPL demosaic包；发布仍保留实际wheel的许可证文件                                                                                                                                                                           |
| [OpenImageIO许可](https://openimageio.readthedocs.io/en/stable/copyr.html)、[输入接口](https://openimageio.readthedocs.io/en/stable/imageinput.html)、[输出接口](https://openimageio.readthedocs.io/en/stable/imageoutput.html) | EXR/Radiance浮点I/O、明确alpha惯例、元数据与中间TIFF                                                      | 主体Apache-2.0，仍有历史BSD-3-Clause及其他vendored声明；已实际读取安装wheel LICENSE.md/THIRD-PARTY.md。固定3.2.2.0；不得写成“所有OIIO内容只有Apache”                                                                                                                                                         |
| [ag-psd](https://github.com/Agamnentzar/ag-psd)、[PSD说明](https://github.com/Agamnentzar/ag-psd/blob/master/README_PSD.md)                                                                                                     | 读取PSD保存合成图、图层/资源结构                                                                          | MIT，固定34.1.0。真实8/16位RGB合成图测试通过；未采用其默认CMYK近似作为ICC正确实现。拒绝CMYK/32位PSD、PSB，保留原文件而不是假装完成图层往返                                                                                                                                                                   |
| [Photopea官方仓库](https://github.com/photopea/photopea)                                                                                                                                                                        | 产品参考与问题跟踪                                                                                        | 仓库不是完整开源编辑器代码；不能把issue仓库当可移植PSD/RAW引擎，也未把外部在线编辑器植入当成本地算法                                                                                                                                                                                                         |

GPUPixel实际读取文件与SHA记录在 `v4-gpupixel-source-record.json`。记录用于证明阅读对象；不把源码拷贝进产品，也不把未知子组件许可改写成已批准。

## 三、实际性能与颜色验证所得结论

### 200MP 的可用路径

20,000×10,000 的真实uint16梯度TIFF已经经过新进程的解码、16位母版、1MP代理和全部DZI层。它证明当前包能完成该具体200MP输入，并证明超时/取消会中断工作、清理本任务目录。它不能证明RAW/HDR/PSD也能200MP，不能证明所有照片压缩比/颜色/页数/异常文件均有相同性能，也不能证明浏览器200MP像素编辑。

本次媒体执行的资源控制是Linux prlimit、固定进程组、1并发/8等待、独立工作目录、Node堆和decoder cache限制。生产容器还需总内存、磁盘和网络限制；接口不是替代这些限制的安全沙箱。预算、格式、环境与逐例真实数据在 `packages/media/README.md` 和 `docs/verification/v4-media-native.json`。

### 颜色处理不能靠容器标签冒充

16位PNG/TIFF测试使用相邻整数值，转换后逐值相同；将8位图放入16位容器时明确提示精度没有凭空增加。P3和CMYK验证使用实际CMS参考像素；无profile的CMYK拒绝。HDR保留float源副本，但固定SDR tone-map不等于HDR编辑器。PSDRGB16合成图真实读取不等于图层/智能对象/ICC全保真回写。

### 美颜算法与神经端口

目前MediaPipe提供关键点/分割分析；V4扫值复用此前**真实原生CPU**推理结果，重新校验输入RGBA哈希。没有把原生推理当成浏览器WebGL推理通过，也没有在产品里硬编码这些样本的关键点。

`createPortraitPixelAdapter` 统一来源、强度、蒙版、保护、取消、版本和模型许可声明，允许未来真实的祛瑕/补光/材质模型接入。但本次没有选择一个许可/质量未核实模型充数：高级痘痘检测、3D遮挡和发丝重建仍为未完成项，菜单/契约不能被写成已实现效果。

## 四、素材和模型的出处边界

- Hopper、官方MediaPipe portrait/pose的来源URL、规范化PNG摘要、三个固定模型SHA、CPU推理条件保存在既有 `docs/verification/v3-portrait-native.json`。V4用它们做参数效果检查，没有重新声称完成新的识别准确率研究。
- architecture/flower来自scikit-learn安装包的示例照片；当前仓库只记录出处/摘要与QA脚本，不再发布照片。软件仓库总许可证不自动证明每张示例照片许可。
- RAW样本来自 [rawpy官方测试文件iss030e122639.NEF](https://raw.githubusercontent.com/letmaik/rawpy/main/test/iss030e122639.NEF)。本轮没有确认其单张照片的完整再分发授权，不将其提交到项目；报告记录URL、字节数、SHA与真实解码结果。
- MediaPipe、LaMa、GPUPixel的代码许可和各自模型权重许可分别处理。已有MediaPipe部署记录不为新增第三方模型授权背书；新的权重上线前必须逐项核验和固定hash。

这里只记录技术和原始许可证信息，不将“开源代码可读”解释成“任意模型、素材、品牌和在线服务均可免费商业使用”。
