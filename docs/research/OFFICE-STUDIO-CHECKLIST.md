# 办公册与影像工作台验收清单

## 产品核对

| 对标 | 已核对的操作或状态 | 本项目验收目标 |
| --- | --- | --- |
| Gamma 演示 | 在固定 16:9 画布内，通过自由框移动、缩放和旋转；页面列表提供增删和管理。 | 保存元素的精确位置、尺寸、层级与样式；重新打开和导出 PPTX 后保持一致。 [操作示范](https://help.gamma.app/en/articles/17572896-how-do-grids-and-freeform-editing-work-in-gamma) |
| Canva 演示与 Docs | 帮助中心列出任意位置放置、按 Shift 多选，以及从元素面板插入照片、图表和媒体。浏览器打开 Canva 操作页超时，本表依据首方帮助记录。 | 选择后显示上下文工具，通过拖拽、数值和键盘定位，复用项目内图表和素材。 [定位元素](https://www.canva.com/en_gb/help/moving-elements/) · [插入元素](https://www.canva.com/help/add-elements/) |
| Microsoft PowerPoint、Excel | PowerPoint 官方图示展示编辑授权、共作者和修改提示。Excel 公开了公式操作符、引用与错误语义。 | 两个隔离会话编辑同一文档并收敛；工作表重算依赖，导出原生单元格公式和缓存结果。 [共编操作](https://support.microsoft.com/en-us/powerpoint/work-together-on-powerpoint-presentations) · [Excel 操作符](https://support.microsoft.com/en-us/office/calculation-operators-and-precedence-in-excel-48be406d-4975-4d31-b2b8-7af9e0e2878a) |
| Google Docs | 帮助页的编辑标记入口显示最后修改和版本历史，恢复动作受编辑权限控制。 | 编辑状态提示有明确的云端确认，离开与重新打开保留草稿，历史恢复写入后续版本。 [版本操作](https://support.google.com/docs/answer/190843?hl=en) |
| OPPO ColorOS 17、HyperOS 4 | OPPO 公开了一句话修图、参考图创作、去倒影、基于备选照片的闭眼修复、AI 笔记和信息速览图。小米台湾功能页展示相片提问、收藏与多种编辑入口，标明机型和地区条件。 | 区分当前画面、明确给出的参考和候选效果，支持版本化笔记、音频、图片和资料引用，保持发布与恢复可追溯。 [OPPO 发布说明](https://www.oppo.com/cn/newsroom/press/549/) · [OPPO AI 功能和教程](https://www.oppo.com/cn/discover/technology/oppo-ai/) · [小米功能页和发布时间](https://www.mi.com/tw/event/2026/hyperos-2026/) |
| Snapseed、醒图、美图与开源影像工具 | Snapseed RAW 提供色温、色调开发。darktable 的色彩校准建立在可信参照上，色彩平衡可配合局部遮罩。RawTherapee 区分亮度降噪、边缘增强与细节恢复。digiKam 的相似检索采用图像指纹与单独的比对入口。 | 可信中性色支持可撤销的色偏候选，按日期、格式、方向和来源查找素材，图像推断与生成使用实际授权输入。 [Snapseed RAW](https://support.google.com/snapseed/answer/6312515?hl=en) · [醒图](https://apps.apple.com/cn/app/id1500526240) · [美图](https://pc.meitu.com/pc) · [darktable 模块](https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/color-balance-rgb/) · [RawTherapee 源码](https://github.com/RawTherapee/RawTherapee) · [digiKam 相似性操作](https://docs.digikam.org/en/left_sidebar/similarity_view.html) |
| DeepSeek Harness、Codex、Claude Code | DeepSeek 的压缩和持久化追踪工具调用完成情况，重启时识别未知结果。Codex 有可回查的压缩窗口和独立的长期记忆读写阶段。Claude Code 区分手工维护的项目规则、自动记忆、独立子代理及团队会话。DeepSeek 社区插件对记忆版本替换和有界召回给出了可查看实现。 | 短期历史通过预算与回查索引保留用户原话和候选依据。长期个人与项目记忆分别授权，纠正关联来源并推进版本。团队代理仅获得当前角色的工具和最少上下文。 [DeepSeek 压缩](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md) · [持久化源码契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence/README.md) · [社区记忆版本讨论](https://github.com/deepseek-ai/deepseek-harness/discussions/10872) · [Codex 压缩](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs) · [Codex 记忆](https://github.com/openai/codex/blob/main/codex-rs/memories/README.md) · [Claude 记忆](https://code.claude.com/docs/en/memory) · [Claude 团队](https://code.claude.com/docs/en/agent-teams) |
| Apple 人机界面规范 | 按内容与工具层次使用材质；工具的位置和动效说明状态变化；尊重低动态偏好。 | 工作区保留清晰主画面，控件随选择出现，断点和焦点可预测，减少动态时仍可完成操作。 [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) · [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) · [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) |

## 实现与验收

- [x] **演示文稿**。新建、复制与排列幻灯片。拖拽、吸附对齐、缩放和数值定位均作用于 1600 × 900 画布。图层选择可选中被遮挡的对象。解包 PPTX 检查文字、原生形状、坐标、旋转与嵌入图表，重新打开验证坐标。
- [x] **工作表**。新建或导入后通过公式栏和网格编辑数据，计算范围引用、绝对引用和支持的函数。验证数值、重算、循环错误、原生 Excel 公式与缓存结果。导入保留原始文件坐标，外来公式沿用缓存读取规则，宏和外部数据连接仅作为不受支持的内容处理。
- [x] **文档实时共编**。两个独立登录的编辑者编辑同一段落，校验同一版本、断线续传、回执丢失去重、跨项目拒绝、权限撤销和旧版本处理。工作表和演示文稿各自使用版本比较后保存。
- [x] **图表**。共享计算器与 SVG 输出，提供条形、折线、河流、桑基、雷达和三维散点。单位与形状校验先于绘制。AI 图表工具直接绑定显式选中的版本数据，工作表可导出 SVG 或 2,400 像素长边的 PNG，可将同一图表插入文件。
- [x] **正文与项目资源**。富文本、笔记、图片、允许播放的音频和固定版本文档引用可与正文一起保存。文档历史保留原版本，回档以新版本保存。浏览器回归在四种屏幕尺寸检查编辑、导出与越界。
- [x] **短期与长期上下文**。系统规则由服务构造，用户消息原文保留。旧回复先保留有来源的摘录，再回查归档。个人、团队、项目及作品记忆以授权过滤，明确确认后可更新已有记录及版本。模型产物经过工具、授权、审核和预算检查，原对话与工具记录可回查。
- [x] **影像工作流**。使用可信中性色估计色温和综合色调，复用同一渲染引擎生成可撤销建议。相册支持周、月、单日与日期交集，以及方向、格式、来源组合筛选。照片任务入口将明确的输入、保留约束和候选状态传入助手。
- [x] **本地验收**。按 `scripts/qa/office-studio.browser.mjs` 在真实 PostgreSQL 上编辑、保存、断线、重开和下载。CI 保留四种屏幕的截图与导出文件。`apps/web/test/office-studio.test.ts` 检查生成包与确定性绘图。
- [ ] **发布验收**。核对 GitHub 主干同一提交的全部工作流与发布资产 SHA-256。腾讯云先用隔离库演练追加迁移，再校验线上版本、认证、公开页面和回滚材料。

## 需要独立验收的能力

| 能力 | 当前行为及验收条件 |
| --- | --- |
| 相册与相似成片 | 当前支持组合筛选与人工选择参考。相似图聚类需要有访问范围限制的指纹索引、重复与相似测试集及恢复操作。 |
| 换天、最佳表情、反光、拖影、超分、背景再生成 | 各任务能构造带输入约束的候选。本地现有修复工具能处理用户指定的局部缺陷。还需要针对任务接入模型或专用算子，并在已授权实拍样本上分别验证边缘、保真度、失败状态与付费链路。 |
| 原有文件兼容性 | 兼容已有项目正文、项目工作表和原生导出。当前公式使用有限函数集合，三维散点以固定视角绘制。已保存文档可共编，工作表和演示使用版本冲突处理。 |
| 笔记继续使用 | 文档可播放项目音频并打开固定版本引用。DOCX 将音频保存为受权限保护的链接。离线共编可重连，未同步草稿可在同一标签页恢复。手机厂商的端侧归档和联动需要分别实机验证。 |
| 开源复用 | D3 负责河流和桑基布局，ProseMirror Collab 处理正文变换。影像开源项目用于对照算法和操作，未移植 GPL 模块。 |
