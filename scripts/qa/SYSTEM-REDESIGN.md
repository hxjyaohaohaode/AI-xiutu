# 本次系统界面重做的远端验证

这份检查只为 frontend/system-redesign-20261111 到 new/native-color-feedback 的 PR 服务。它验证当前构建的真实前端、真实本地 HTTP API，以及一次性内存 PostgreSQL WASM；不启动 Docker/native 完整回归，不调用 AI 供应商、短信或支付，不把隔离 fixture 当成真实云服务或多人验收。

## 唯一入口与执行边界

工作流为 .github/workflows/frontend-system-redesign.yml。它只处理该精确前端分支的 PR，响应 opened、reopened 和 synchronize。中间开发检查点使用 [skip ci]；准备好的修复提交会自动验收新的 head。所有实现应先合到前端分支，再开启 PR。检查期间保持分支 head 不变。

workflow_dispatch 也受到精确分支限制；GitHub 手动调度是否可用受工作流是否已存在于默认分支的规则限制。失败后必须先查看具体报告、修复具体问题，再提交新的待测 head；没有自动重跑循环。截图提交由 GITHUB_TOKEN 发起并带 [skip ci]，不会反复触发自身。

第一个 job 只有 contents:read，完整执行 npm run typecheck、所有 apps/web 单元测试、一次 Vite build 和真实 Chrome。类型或单元测试失败不会被忽略；已成功 build 时仍独立采集浏览器证据，最终整个 job 继续失败。所有已产生的报告和截图在 always artifact 步骤保留。

免费本地人物模型通过现有 vision:prepare 的固定摘要校验下载，然后随本地站点提供。人物截图必须经过真实识别和真实参数调整。模型或照片无法取得时检查失败，不生成替代的 AI 界面图片。

## 五组不同的真实核心流程

| 场景 | 视口 | 语言 | 主要风险 |
| --- | --- | --- | --- |
| desktop-zh-CN | 1440 × 960 | 简体中文 | 桌面参数、导出和焦点 |
| phone-zh-CN | 390 × 844 | 简体中文 | 竖屏面板与导航 |
| landscape-en | 844 × 390 | English | 短横屏和较长英文 |
| tablet-zh-TW | 1024 × 768 | 繁体中文 | 平板布局与本地化 |
| reduced-desktop-en | 1440 × 960 | English | 减少动态偏好 |

每组都从真实 Pexels 照片导入开始，完成曝光精确输入、实际 canvas 像素变化、撤销恢复、重做恢复、按住原图对比、滑动对比键盘操作，以及一键 PNG 下载。下载文件被真正解码，核对原始方向下的尺寸；预览为全尺寸时要求输出像素摘要一致，否则验证全尺寸输出确实包含曝光变化。弹窗检查 Tab 焦点闭环、Escape 关闭和焦点返回。

这些是五种不同风险的流程，不是 111 个功能全量验收五轮；native/HDR 高精度链路、供应商计费、真实多人音视频和实体手机性能仍有各自的验证范围。

## About 与截图

About 的9个稳定 section 必须通过原生滚轮连续抵达；不点击 tab/accordion 展开内容。五组场景同时记录滚动位置、水平溢出、可见控制遮挡、标题溢出、登录页与工作台的相同 Logo。深色工作台及 favicon 另行核对同一原始标记资产。

workspace、local、portrait、layers、tablet、phone 六类截图在三种语言各采集一张，共18张。图片来自当前真实界面，先保存原始 PNG，再仅做 WebP 编码。所有输入照片记录源 URL、作者、Pexels 许可链接、取得时间、解码尺寸、字节数与 SHA-256。coast、portrait、color-study 三张旧样例改用本次真实照片，执行方向校正与 sRGB/WebP 转换，不裁切。

新截图临时复制到已构建的 dist，随后重新载入 About，逐图核对实际 HTTP 字节摘要，最后采集新的完整 About 桌面与手机图。不需要再次运行 build。另有真实隔离账户/项目的作品、文档、协作空态、用量、助手不可用态与账户截图；不宣称这些图证明线上 AI 或多人业务成功。

## 成功后的有限图片提交

只有第二个 publish-captures job 获得 contents:write。它必须依赖第一个 job 完全成功，重新核对被测40位SHA、5个核心场景、报告状态、无浏览器错误/外连，以及每张图片的长度和 SHA-256。

源码中的精确白名单只有：

- public/about 六类三语 WebP，18张。
- public/about/coast.webp、portrait.webp、color-study.webp，3张真实源照片。
- docs/design/verification/system-redesign/about-desktop.png 和 about-phone.png，2张最终 About 截图。
- apps/web/public/about/source-manifest.json，来源和被测提交记录。

发布脚本不 stage 任何其他路径；只接收普通 PNG/WebP 文件。它在读取、提交和推送前检查远端 feature head 仍等于被测 head，分支发生变化立即失败。只允许正常快进 push，不 merge、不 force、不重试，提交带 [skip ci]。

这是素材更新提交，不是生产部署。manifest 的 manualVisualReview 保持 false；实际目检由审阅者打开本次提交中的完整 About 截图完成，不能用浏览器自动断言代替视觉判断。

## 证据位置与失败处理

artifact 名称为 frontend-redesign-<tested-head>。包含 report.json、每个场景截图、失败截图、实际下载 PNG，以及 publish/ 下的完整有限图片提交负载。source-manifest.json 会随成功图片提交进入 public/about。

在原生执行环境不可用时编写了这组脚本；静态语法检查不能被写成浏览器验收通过。首次真实执行结果应以对应 source head 的 Actions 与 report.json 为准。任一必要步骤失败都阻止图片提交；已有真实老截图只属于过渡素材，不能因此宣布新界面已经完成视觉验收。
