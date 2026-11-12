# 业务界面与公共弹层：参考机制与改造边界

本轮在读取用户提供的完整 209 项目录、当前业务源码和拟采用项完整官方 TSX/CSS 后实施。来源固定到 React Bits 提交 `9d9c687dc4f55b23539aa5417b703078047efa74`，文件哈希及初始审计见 [完整来源记录](../../../../docs/design/reference-209-views-sources.json) 与 [业务/弹层审计](../../../../docs/design/reference-209-views-audit.md)。当前应用不添加 `motion/react`、GSAP 或参考演示的图标依赖；数值动画复用本项目 `motion/useKinetic.ts` 的单调度器和动态减少动效设置。

| 用户目录编号 / 参考组件 | 固定官方源文件 | 应用位置 | 实际采用及改动 |
|---|---|---|---|
| 119 · StatusMark | [StatusMark.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/StatusMark/StatusMark.tsx)<br>[StatusMark.css](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/StatusMark/StatusMark.css) | `StatusMark.tsx / status-mark.css` | 细描边轨迹只跟随真实 pending / running / done / failed / cancelled / unknown；只有实际数值可以画进度，unknown 为静态问号。没有自动切换生命周期。 |
| 115 · SwipeToast | [SwipeToast.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/SwipeToast/SwipeToast.tsx)<br>[SwipeToast.css](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/SwipeToast/SwipeToast.css) | `Ui.tsx / Toast` | 保留当前 notice / usePresence。可见关闭、悬停/焦点/页面隐藏暂停；错误需明确关闭。没有添加未完成实机取证的滑动手势，也没有假 Undo。 |
| 133 · SpringCheck | [SpringCheck.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/SpringCheck/SpringCheck.tsx)<br>[SpringCheck.css](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/SpringCheck/SpringCheck.css) | `CheckControl.tsx / TaskStateMark.tsx / check-control.css` | 原生 checkbox 保留 Space / 表单 / disabled；共享弹簧只填充 SVG。项目任务保留 todo / doing / done 三态和真实 CAS，不能把三态替换成二元勾选。 |
| 120 · GlideSelect | [GlideSelect.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/GlideSelect/GlideSelect.tsx)<br>[GlideSelect.css](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/GlideSelect/GlideSelect.css) | `ChoiceSelect.tsx / choice-motion.css` | 按真实选项尺寸移动装饰背景；文字和触控区域不移动。保留原生 popover、VisualViewport 碰撞、IME、长列表、禁用选项、键盘返回与关闭语义。 |

主代理已实际操作 #119 的真实演示状态、#115 的显示/关闭、#133 的点击与键盘切换、#120 的选项菜单和 ArrowDown/Enter/Escape。#115 滑动手势没有获得同等视觉证据，本轮没有实现或声称验证它。来源演示证明机制可研究，不等于应用自身已通过浏览器验收；实际应用验收以本轮单独的 CI 报告和截图为准。

## 与业务数据的关系

- 状态、数额、权限、版本和提交回执由既有业务逻辑决定。等待动效不会生成结果或把未知回执变成成功。
- 原生 `dialog`、异步关闭守卫、焦点恢复、闭合 `details` 过滤和 `inert` 均保留；不同弹层配置独立的桌面/平板/手机宽度。
- 手机控制面可以小于 44px，但独立交互框至少使用共享触控 token；不使用相邻控件重叠的负 inset 热区。输入使用 16px 字号，保留真实字段与限制。
- 图片为实际素材缩略图或既有真实工作预览；没有 AI 界面插图、伪造媒体结果或替换用户的 Logo。
- `MediaSourceViewer` 的 GPU / CPU 切换、`fitRegion`、源坐标和原件保存逻辑不在本次业务层改动范围内。

## 许可证

上述 React Bits 固定版本的许可证名称是 **MIT + Commons Clause License Condition v1.0**，版权所有 **Copyright (c) 2026 David Haz**，并非无附加条件的普通 MIT。完整原文随本项目保存在 [REFERENCE-LICENSE.react-bits.txt](REFERENCE-LICENSE.react-bits.txt)。本项目只将经过调整的机制用于应用界面，不作为独立组件库销售或再分发。

## 全站界面复查

[42 个入口流程](../../../../docs/design/reference-209-flows.md) 和 [209 项逐项对应](../../../../docs/design/reference-209-review.md) 用于核对应用可见路径。此次统一面板层级、字段、媒体框、状态与导航密度，并把以下参考接入具体业务界面。

| 页面 | 对应参考 | 产品中的采用方式 |
| --- | --- | --- |
| 介绍与公开入口 | 31 Scroll Expand、35 Animated Content、78 Pill Nav | 实际产品图沿正常文档流出现。导航入口、媒体框和键盘焦点采用同一主题。 |
| 登录、注册、重置和欢迎 | 125 Code Slots、131 Rubber Segment、119 Status Mark | 同一个原生输入支持短信自动填充、粘贴和退格，六格直接显示该字段的值。密码与验证码登录使用可键盘操作的分段控件。 |
| 精修、构图、草图与专业修复 | 124 Wake Slider、127 Scrub Field、129 Warm Tooltip、131 Rubber Segment、204 色板 | 手机端区分视觉尺寸和触控区域。构图和修复模式使用测量过的选中底板，草图工具可组合选择、调色和改对象。 |
| AI 对话、生图和语音 | 114 Prompt Bar、112 Voice Pill、111 Thought Line、110 Refine Frame | 参考图、输入、模型和送出动作共用一组控件。加号在输入区上方展开真实来源菜单，保持键盘、短屏、IME 和正在执行状态。 |
| 作品库、跨空间搜索与长期素材 | 78 Pill Nav、120 Glide Select、110 Refine Frame | 作品分类选中块跟随实际选项尺寸。筛选与图片卡使用原生选择和真实加载状态。 |
| 对比、版本、协作和文档 | 131 Rubber Segment、119 Status Mark、133 Spring Check | 对比模式和协作分类支持方向键。版本及草稿入口采用一致的行状态，任务状态仍由实际操作驱动。 |
| 导出、分享和专业原片 | 110 Refine Frame、119 Status Mark、120 Glide Select | 图片和导出选项分别排版，状态图标跟随真实渲染。弹层使用既有尺寸配置与原件、预览的真实状态。 |
| 账户、用量、运营和共享弹层 | 78 Pill Nav、120 Glide Select、115 Swipe Toast、136 Squish Switch | 账户和运营导航的选中态、用量卡片、配置表单及回执沿用统一主题和明确焦点。业务权限、额度及请求处理由现有接口驱动。 |

新增组件参考的固定源文件为 [PromptBar.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/PromptBar/PromptBar.tsx) 和 [CodeSlots.tsx](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/CodeSlots/CodeSlots.tsx)。Prompt Bar 的真实演示已核对文字输入和上方来源菜单。应用中的对应实现位于 `PromptToolbar.tsx`、`ComposerInput.tsx`、`AuthPanel.tsx` 和 `reference-surfaces.css`，复用项目现有原生控件、图标和弹簧。交互与视觉以本次实际运行报告为准。

Prompt Bar 的单底板、上方菜单和滑动高亮以 [PromptBar.css](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/PromptBar/PromptBar.css) 为参考。选择框沿用 [GlideSelect.css](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Micro/GlideSelect/GlideSelect.css) 的紧凑触发器、弹层和高亮状态。账户和导航的移动选中块取自 [PillNav.css](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Components/PillNav/PillNav.css)。运营概览以同一量尺绘制 API 返回的实体计数，借鉴 [203 号趋势卡](https://uiverse.io/NK2552003/silly-moth-73) 的数值与图形并列方式。表单焦点保留在当前输入或操作上，弹层按内容适配尺寸。

手机拼图采用用户参考图的照片优先布局、比例轮廓和图形模板。编辑器保留同一工具栏和导出位置，普通照片、实况和动图可共用一套拼图。主体作为独立前景，可跨越格子。 [OPPO Reno15 Pro 多实况拼图](https://www.oppo.com/cn/smartphones/series-reno/reno15-pro/) · [OPPO Find X9s Pro 实况玩法](https://www.oppo.com/cn/smartphones/series-find-x/find-x9s-pro/)

眼影参考裸棕、玫瑰和金属色系及不同光泽，腮红参考粉质晕染。产品里保存可编辑的屏幕颜色与混合参数。 [MAC Unfiltered Nudes](https://www.maccosmetics.com/products/connect-in-colour-eye-shadow-palette-unfiltered-nudes) · [Charlotte Tilbury Pillow Talk](https://www.charlottetilbury.com/us/product/luxury-palette-pillow-talk) · [NARS Powder Blush](https://www.narscosmetics.com/USA/dolce-vita-powder-blush/0194251140452.html)
