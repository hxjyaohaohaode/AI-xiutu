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
