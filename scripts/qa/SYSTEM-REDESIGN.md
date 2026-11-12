# 本次系统界面重做的远端验证

这份检查只为 frontend/system-redesign-20261111 到 new/native-color-feedback 的 PR 服务。它验证当前构建的真实前端、真实本地 HTTP API，以及一次性内存 PostgreSQL WASM；不启动 Docker/native 完整回归，不调用 AI 供应商、短信或支付，不把隔离 fixture 当成真实云服务或多人验收。

## 唯一入口与执行边界

工作流为 .github/workflows/frontend-system-redesign.yml。它只处理该精确前端分支的 PR，响应 opened、reopened 和 synchronize。中间开发检查点使用 [skip ci]；准备好的修复提交会自动验收新的 head。所有实现应先合到前端分支，再开启 PR。检查期间保持分支 head 不变。

workflow_dispatch 也受到精确分支限制；GitHub 手动调度是否可用受工作流是否已存在于默认分支的规则限制。失败后必须先查看具体报告、修复具体问题，再提交新的待测 head；没有自动重跑循环。截图提交由 GITHUB_TOKEN 发起并带 [skip ci]，不会反复触发自身。

第一个 job 只有 contents:read，完整执行 npm run typecheck、所有 apps/web 单元测试、一次 Vite build 和真实 Chrome。类型或单元测试失败不会被忽略；已成功 build 时仍独立采集浏览器证据，最终整个 job 继续失败。所有已产生的报告和截图在 always artifact 步骤保留。

免费本地人物模型通过现有 vision:prepare 的固定摘要校验下载，然后随本地站点提供。人物截图必须经过真实识别和真实参数调整。模型或照片无法取得时检查失败，不生成替代的 AI 界面图片。

## 本地 SDK 遥测的明确拦截

检查从 apps/web/package.json 读取精确锁定的 @mediapipe/tasks-vision 1.2.2，并与 package-lock.json 的解析版本一致核对。已审阅的 SDK 使用 POST 向 https://odml.pa.googleapis.com/v1/log 尝试发送日志。此处不将遥测元数据称为“无敏感数据”，也不据此推断生产环境没有遥测。

隔离浏览器仍阻止所有外部请求。只有完整 URL 严格等于上述地址、方法为 POST、query 和 fragment 均为空，并且 route.abort('blockedbyclient') 已成功完成的尝试，才单独进入 blockedSdkTelemetryAttempts；没有外连放行、伪造响应或重试。任何其他地址/方法仍作为未知外连尝试使检查失败，阻止操作本身出错也使检查失败。

report.json 与 source-manifest.json 保存完全相同的安全条目和汇总：场景、固定 endpoint、方法、blocked:true、实际次数、SDK 名称与读取的版本。次数来自本轮实际事件，不强制为六次，也不把历史缺失的方法记录补写成 POST。不记录请求 body、headers 或 query。publisher 逐条验证精确字段、地址、方法和阻止状态，并校验汇总、次数、SDK 版本及两份记录一致。

仓库 infra/Caddyfile 已配置 connect-src 'self'。本轮使用的 Vite preview 不带该生产响应头，隔离由原有唯一 context.route guard 完成。线上响应头未核验，本报告只说明本轮受控浏览器的阻止情况，不宣称线上 SDK 从不发起遥测。SDK 隐私边界参见 [官方隐私说明](https://developers.google.com/edge/mediapipe/solutions/privacy) 与 [服务条款](https://developers.google.com/edge/mediapipe/legal/tos)。

## 简繁中文的实际字体门槛

工作流安装 fonts-noto-cjk 与 fontconfig，刷新缓存，并用 fc-match 严格核对 Noto Sans CJK SC/TC 实际匹配的字体家族和文件；不能接受静默回退到没有汉字的字体。安装或匹配失败时不进入截图步骤。

每张简体/繁体截图在 document.fonts.ready 后，从当前真实页面读取最多三个可见的纯汉字叶节点；弹窗打开时只在该弹窗内取样。隐藏、遮挡、inert 和收起 details 内文字不能提供证据，不新增测试节点，也不改写页面文字或图片。通过 CDP DOM.enable、CSS.enable、DOM.getDocument、DOM.querySelector、CSS.getPlatformFontsForNode 获取实际使用的字体与 glyphCount；简体必须由 Noto Sans CJK SC、繁体必须由 Noto Sans CJK TC 渲染取样汉字，仅有 CSS font-family 声明或字体加载完成不算通过。

report.json 和 source-manifest.json 保存完全相同的 cjkFontEvidence，包含所属 case、截图名、语言、真实节点选择器、短汉字样本、实际字体及字形计数。publisher 要求两语均有覆盖、每张中文截图有对应证据、case 已通过、两份证据相同，且正确区域字体的字形计数覆盖样本；缺失、错误回退或零字形阻止图片提交。这个取样门槛解决已发现的中文缺字风险，不替代整页人工目检。既有16个case、34张发布图片和精确head限制保持不变。

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

只有第二个 publish-captures job 获得 contents:write。它必须依赖第一个 job 完全成功，重新核对被测40位SHA、5个核心场景、报告状态、无浏览器错误或未知外连尝试、已知 SDK 遥测确已阻止且两份证据一致，逐张简繁中文的实际字体证据，以及每张图片的长度和 SHA-256。

源码中的精确白名单只有：

- public/about 六类三语 WebP，18张。
- public/about/coast.webp、portrait.webp、color-study.webp，3张真实源照片。
- docs/design/verification/system-redesign/about-desktop.png 和 about-phone.png，2张最终 About 截图。
- 同目录另存11张真实审阅截图：桌面／手机导出弹窗、作品、降噪、运动模糊、展开后的运动模糊参数、文档、协作空态、用量、助手不可用态、账户。总图片白名单为34张。
- apps/web/public/about/source-manifest.json，来源和被测提交记录。

发布脚本不 stage 任何其他路径；只接收普通 PNG/WebP 文件。它在读取、提交和推送前检查远端 feature head 仍等于被测 head，分支发生变化立即失败。只允许正常快进 push，不 merge、不 force、不重试，提交带 [skip ci]。

这是素材更新提交，不是生产部署。manifest 的 manualVisualReview 保持 false；实际目检由审阅者打开本次提交中的工作台、完整 About、页面与弹窗截图完成，不能用浏览器自动断言代替视觉判断。

## 证据位置与失败处理

artifact 名称为 frontend-redesign-<tested-head>。包含 report.json、每个场景截图、失败截图、实际下载 PNG，以及 publish/ 下的完整有限图片提交负载。source-manifest.json 会随成功图片提交进入 public/about。

在原生执行环境不可用时编写了这组脚本；静态语法检查不能被写成浏览器验收通过。首次真实执行结果应以对应 source head 的 Actions 与 report.json 为准。任一必要步骤失败都阻止图片提交；已有真实老截图只属于过渡素材，不能因此宣布新界面已经完成视觉验收。
