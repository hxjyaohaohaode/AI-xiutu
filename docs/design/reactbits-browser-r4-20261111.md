# React Bits R4：本轮浏览器交互补充

日期：2026-11-11。以下按主任务在用户 **Edge 浏览器** 中实际完成的操作和观察整理；本文的整理过程没有重新执行这些浏览器动作。来源链接指向相应公开组件页，观察范围以每行所列动作及结果为限。

## 范围

本轮再次查看了全部 **216 项公开组件目录**，并完成与 R3 的主源码哈希连续性复核，结果见 [R4 源码审计](./reactbits-source-audit-r4-20261111.md) 与 [机器可读明细](./reactbits-source-audit-r4-20261111.json)。目录查看、源码比对和组件交互是三种不同证据：**本轮没有再次逐一手动操作 216 个页面。** 下表仅补充七个组件的定向操作，其中 Voice Pill 的停止动作未确认成功。

## 实际操作、采用方式与限制

| 来源 | 本轮操作与实际观察 | 本站采用的位置与方式 | 拒绝点与未确认范围 |
| --- | --- | --- | --- |
| [Scroll Expand](https://www.reactbits.dev/animations/scroll-expand) | 在预览中向下滚动 560，看到预览展开；打开 Code，核对 `clipPath`、`scale`、`smoothing` 与 reduced motion 处理。 | [ProductHero](../../apps/web/src/about/ProductHero.tsx) 的有限滚动呈现，以及 [FeatureTour](../../apps/web/src/about/FeatureTour.tsx) 的自然滚动和统一活动章节。画面、标题和说明保持同一状态来源，手动选择保留阅读时间。 | 不照搬参考中的人物图片或把所有截图裁切缩放；Code 中看到 reduced motion 分支，不等于本轮又在参考站运行了完整的低动态回归。 |
| [Animated Content](https://www.reactbits.dev/animations/animated-content) | 选择 **Blur** 预设，再点 **Refresh**，看到三张卡片分阶段从模糊过渡为清晰。 | [ScrollReveal](../../apps/web/src/about/effects/ScrollReveal.tsx) 的分组进入与有限模糊；About 的标题、说明和辅助内容按顺序呈现。 | 不把原预设强度机械移植到所有元素，不模糊真实照片、精确参数和可操作控件；本条不新增参考站时长或帧率测量。 |
| [Rubber Segment](https://www.reactbits.dev/micro/rubber-segment) | 点击 **Month**，随后按 **ArrowRight**，选中 **Year**。 | [PanelNavigation](../../apps/web/src/workspace/PanelNavigation.tsx) 与 [CreativeStories](../../apps/web/src/about/CreativeStories.tsx) 中的受控分段选择：选择状态先更新，装饰动画跟随；切换保留当前编辑上下文。 | 不让滑块动画决定业务状态，也不把面板切换变成整页跳转。本次参考站观察只覆盖点击和右方向键，不扩大为所有键盘路径均已实测。 |
| [Voice Pill](https://www.reactbits.dev/micro/voice-pill) | 点击 **Dictate** 后，观察到 `pressed=true` 与 `0:01`。随后发送 Escape 的工具操作超时；之后导航离开，组件被卸载。 | [VoiceStory](../../apps/web/src/about/CreativeStories.tsx) 的明确演示开关，以及 [LiveAssistant](../../apps/web/src/ai/LiveAssistant.tsx) 的真实语音状态区分。 | **不能声称本轮已验证 Escape 停止。** 导航卸载不替代停止按钮验收；网页演示计时与波形不证明实际录音、转录或通话成功。R3 的旧观察不补作本轮成功证据。 |
| [Call Chip](https://www.reactbits.dev/micro/call-chip) | 将 **Status** 设为 **Error**，DOM 显示 `bash`、`npm test`、`failed after 2814ms`。 | [ResearchGraph](../../apps/web/src/ai/ResearchGraph.tsx) 保留真实节点执行类型、状态与可展开详情；[AgentStory](../../apps/web/src/about/AgentStory.tsx) 将公开动作和演示状态分别标明。 | 这些是参考组件的演示内容，不代表执行了项目测试；不把 `2814ms`、工具名或失败状态写入本站真实任务。真实进度和结果只来自服务端事件。 |
| [Thought Line](https://www.reactbits.dev/micro/thought-line) | 先关闭 **Loop**，再关闭 **Working**；`Thinking` 变为 `Thought for 14.4 seconds`，组件不再处于 expanded 状态。 | [AgentStory](../../apps/web/src/about/AgentStory.tsx) 的四项可收起公开动作，以及 [ResearchGraph](../../apps/web/src/ai/ResearchGraph.tsx) 的真实任务详情；采用展开、收束与摘要保留的交互方式。 | 不展示或伪造模型私有思考链，不把 `14.4 seconds` 当作本站耗时；参考演示文案不迁入真实运行状态。公开动作、可审阅参数和任务依赖足以说明过程。 |
| [Refine Frame](https://www.reactbits.dev/micro/refine-frame) | 选择 **Error**，看到 **Failed** 与 **Retry**；点击 **Retry** 后变为 **Generating**，4:3 画框保持。 | [AboutArt](../../apps/web/src/about/AboutArt.tsx) 的固定比例图片加载、错误和重试；[AgentStory](../../apps/web/src/about/AgentStory.tsx) 候选继续使用同一图框与图片恢复逻辑。 | 保留的是固定尺寸与失败恢复原则，实际画幅仍按各自产物。此操作没有证明真实供应商重试成功，也没有观察到新的生成完成结果；本站不自动重发结果未知的收费请求。 |

## 与代码及其他记录的关系

上述采用方式是将交互原则映射到本站已有状态与内容，不表示逐个直接引入上游组件。Agent 展示的两张候选仍是现有本地编辑引擎预渲染结果；配方、演示边界及真实 API 对接见 [前端 API 对齐记录](./frontend-api-alignment-r4-20261111.md)。浏览器参考操作不能代替本站修改后的视口、键盘、低动态和异常状态验收。

[R3 浏览器记录](./reactbits-r3-20261111.md) 保留为历史证据；本补充不改写其未验证项，也不将两轮不同的观察时间或演示数值合并成一次测试。源码哈希、目录数量与逐组件取舍仍以 [R4 源码审计](./reactbits-source-audit-r4-20261111.md) 为准。
