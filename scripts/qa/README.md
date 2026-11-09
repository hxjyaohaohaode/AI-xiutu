# 可选的真实人像模型 QA

这里的手工实验使用固定哈希的公开示例照片、Google 官方模型与实际 CPU 推理，随后把真实输出经过产品的 `AnalysisAdapter` 和 RecipeV3 内核。它不是生产模块，不属于普通 `npm test`，不会自动下载模型、图片或调用收费 AI API。不要把私有用户图片、推理结果、模型二进制或 Python 虚拟环境提交到 Git。

## 运行环境

记录所用环境为 Linux x86_64、Python 3.12、Node.js 24、MediaPipe 1.2.2。完整 Python 依赖版本固定于 `portrait-native-requirements.txt`。不同机器上的模型数值与时长可能变化；原生 CPU 成功不代表浏览器 WebGL 2、手机速度或人群准确率已经通过。

MediaPipe 原生库即使用 CPU delegate 也可能要求系统具备 OpenGL/EGL 共享库。Ubuntu 环境通常需要 `libgles2`、`libegl1`、`libgl1`。本脚本不会用管理员权限安装系统包；缺少库时应由环境维护者安装或提供隔离的动态库目录。当前实验的缺失 `libGLESv2.so.2` 通过官方 Ubuntu `libgles2_1.7.0-1build1_amd64.deb` 解压到 ignored artifacts 后提供 `LD_LIBRARY_PATH` 解决。

## 显式执行

在仓库根目录、已有 npm 依赖的环境执行。下列准备步骤需要联网，模型与公开样本均检查固定长度/哈希；正常单元测试不会执行这些命令。

```sh
npm run vision:prepare
python3 -m venv artifacts/portrait-cpu/venv
artifacts/portrait-cpu/venv/bin/python -m pip install -r scripts/qa/portrait-native-requirements.txt
artifacts/portrait-cpu/venv/bin/python scripts/qa/portrait-native-fetch.py
```

准备完成后，以下命令只读取本地模型/图片并计算本地结果，按顺序执行；任何命令失败时停止，不把旧输出当成新一轮成功。

```sh
artifacts/portrait-cpu/venv/bin/python scripts/qa/portrait-native-infer.py
node --import tsx scripts/qa/portrait-native-verify.ts
artifacts/portrait-cpu/venv/bin/python scripts/qa/portrait-native-visuals.py
node scripts/qa/portrait-native-report.mjs
```

只需要导入标注、暂时不跑 46 项渲染时，第二步可加 `--annotations-only`。此模式不产生新的 46 项通过声明。

## 各步骤的真实职责

| 脚本                         | 行为                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `portrait-native-fetch.py`   | 只获取 `portrait-native-inputs.json` 中列出的三个公开 URL；已有文件哈希一致时不重复联网；检查 HTTP 200、大小上限、固定字节数与 SHA-256                                                                                               |
| `portrait-native-infer.py`   | 验证当前本地模型 manifest 的 SHA-256 和 `.task` ZIP 完整性；校验样本哈希；按 EXIF 规范方向、由 ICC 转 sRGB 并导出无 ICC/EXIF 的规范 RGBA PNG；对同一像素执行实际 face/pose/segmentation CPU 推理                                     |
| `portrait-native-verify.ts`  | 核对 Python/JS 官方轮廓连接表、同一 runId、模型 manifest、规范源图 hash；把真实点位和有界分割网格转换成严格产品标注；用适配器验证；逐一执行 36 个面部控制和 10 个身形控制，验证像素、正负值、full/tiled、alpha、蒙版外不变和原图不变 |
| `portrait-native-visuals.py` | 仅从规范原图、真实点位和内核输出字节生成观察用 PNG；不使用生成式图片代替算法输出                                                                                                                                                     |

每次原生推理先移除旧的成功记录，完成三张图后再写 `native-evidence.json`；每张原始输出与记录共享 runId。渲染验证拒绝不同轮次混杂的数据。所有数据写入 ignored `artifacts/portrait-cpu`。

源图摘要公式为 `SHA256(UTF8(width + 'x' + height + ':srgb-rgba8:') || 完整规范 RGBA 字节)`。使用 `*.canonical.png` 与同名 `*.analysis.json` 进行浏览器导入；不要把原始 JPEG 配上规范 PNG 的 hash。PNG 规范化消除了不同 JPEG 解码器/ICC 路径带来的源关联差异。

`native-evidence.json` 保存真实模型版本、固定模型摘要、输入来源、单次推理耗时与检测数量；`pixel-validation.json` 保存 46 项实际渲染断言和组合样本结果。时间不含模型首次加载，不是性能 SLA；控制验证耗时包含 full/tiled/反向渲染、逐像素断言和哈希运算，不能写成单次交互延迟。

## 可发布证据

`portrait-native-report.mjs` 核对同一轮成功记录、全部 46 项结果和样本/模型摘要后，生成可发布的 JSON；不复制照片、关键点数组或模型二进制。

仓库只保留 [脱敏原生验证记录](../../docs/verification/v3-portrait-native.json)、脚本、公开来源与输入摘要，不发布原始照片、规范 PNG、面部关键点、二进制模型或本地路径中的凭据。该记录和 [内核复核](../../docs/verification/v3-editor-review.md) 支持“实际模型输出能经过产品链路并改变像素”的结论；工业美颜质量、自动痘痘/皱纹检测、浏览器本机推理和真实终端性能仍需各自验收。
