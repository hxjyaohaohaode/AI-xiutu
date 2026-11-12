# 209 项参考：完整对应、源码证据与实际适配

**当前结果：209 项均已逐项阅读和映射；28 项完成指定变体的完整源码审阅；20 项有协调者的真实 Edge 演示记录；19 项核心机制已适配到本轮源码。当前这批改造尚未完成自己的 exact-head CI 与截图验收。**

目录阅读、适用性判断、完整源码审阅、演示操作、产品集成、产品验收是六种不同证据。没有把 209 项全部安装，也没有把未浏览或未读源码的条目写成研究完成。

初始全量应用扫描固定在 `bb9e126cd668eb87d53548fbcdef773982f284a4`；整合前端基准为 `80f3968dc5678f2f43c4f8353665564fd371a69d`，后端契约核对到 `9df0e9c06787bce270f4fa03502d81ed3097d872`。19 项指核心机制适配，不代表原演示全部行为被复制。

## 完整资料与验证边界

- [用户完整 209 项原文](reference-209-input.md)：678 行，209 个连续唯一 ID，原始 SHA256 `1264589183c17551ff3898bce0405892f119a2d7c5f4f187852581353ee9718a`。
- [209 项机器台账](reference-209-candidates.json)：逐项保留原 URL、类目、原描述、声明依赖、适用页面、选择理由、完整源码文件/hash、演示动作与未验边界、实际产品路径。
- [真实演示观察](reference-209-browser-observations.json)：由 `/root` 操作用户 Edge；不是本审阅者的浏览器操作。
- [42 流程盘点](reference-209-flows.md)与[111 功能核对](reference-209-feature-review.md)：入口与能力边界分别记录，参考动效不提升功能完成状态。
- [业务界面完整源码证据](reference-209-views-sources.json)与[编辑器完整源码证据](reference-209-editor-sources.json)。

改造前 fresh 基线 [run 43156744177](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/43156744177) 的产品仍是 bb9：整仓类型检查、499/499 前端单测、production build、16/16 浏览器场景通过；34 张 manifest 图片、53 张报告截图核对字节/hash。它只证明改造前基线，不能算作当前改造完成。当前导航/AI/i18n 针对性 62/62 单测通过，也不替代浏览器视觉复核。 协调者已完成本地整仓类型检查与 production build；全量 test:lite 在真实语音并发锁测试失败后未退出，已终止并保留日志，不能记为全仓测试通过。首次集成 CI 另设原生 PostgreSQL 全量门槛。

本机独立 Chromium 普通启动受到 socket 权限限制，未产生页面或截图；实际产品浏览器复核交由现有 GitHub CI。未放宽门槛或复用旧图充当新图。

## 本轮实际适配的 19 项

| ID / 原参考 | 产品文件 | 采用的核心机制 | 补强语义与未采用部分 |
| --- | --- | --- | --- |
| 31 | [apps/web/src/about/useOverviewMotion.ts](../../apps/web/src/about/useOverviewMotion.ts)<br>[apps/web/src/about/AboutPage.tsx](../../apps/web/src/about/AboutPage.tsx)<br>[apps/web/src/about/about.css](../../apps/web/src/about/about.css) | 真实系统屏幕随原生滚动平滑舒展，反向滚动恢复；手机独立 picture 与尺寸。 | 不锁滚动、不分配多屏固定停留、不裁掉关键 UI；全部内容常驻正常文档流；减少动效直接显示。 |
| 35 | [apps/web/src/about/useOverviewMotion.ts](../../apps/web/src/about/useOverviewMotion.ts)<br>[apps/web/src/about/about.css](../../apps/web/src/about/about.css) | 相交触发一次短距离进入，共用 KineticValue，默认内容可见。 | 只变换展示位置；无点击解锁、opacity 隐藏门槛或假业务阶段；卸载断开 observer。 |
| 68 | [apps/web/src/workspace/useNavigationProximity.ts](../../apps/web/src/workspace/useNavigationProximity.ts)<br>[apps/web/src/components/Sidebar.tsx](../../apps/web/src/components/Sidebar.tsx)<br>[apps/web/src/workspace/navigation.css](../../apps/web/src/workspace/navigation.css) | 按鼠标或焦点与实际行中心的距离调整短细线，平滑归位。 | 不移动整行命中框；受控 current 与真实 native button 不由 hover 改写。 |
| 78 | [apps/web/src/workspace/WorkspaceViewTabs.tsx](../../apps/web/src/workspace/WorkspaceViewTabs.tsx)<br>[apps/web/src/workspace/navigation.css](../../apps/web/src/workspace/navigation.css) | 按选中项真实宽度，用独立左右边弹簧移动选中底板；可用宽度不足时收为当前视图按钮。 | 保留 data-view/aria-current，隐藏的测量导航 inert；品牌不旋转、不改色，手机单独布局。 |
| 85 | [apps/web/src/components/Sidebar.tsx](../../apps/web/src/components/Sidebar.tsx)<br>[apps/web/src/workspace/navigation.css](../../apps/web/src/workspace/navigation.css) | 抽屉内有限、短距离错峰进入，当前选择一眼可见。 | 使用已有 native Modal 的 Esc、焦点进入/循环/归还和背景隔离；不照搬演示的大字号全屏导航。 |
| 88 | [apps/web/src/workspace/useDockProximity.ts](../../apps/web/src/workspace/useDockProximity.ts)<br>[apps/web/src/workspace/ToolDock.tsx](../../apps/web/src/workspace/ToolDock.tsx) | 测量中心后应用 cos² 邻近响应和弹簧回位，键盘焦点得到同类反馈。 | 只动图标表面；独立命中框和选中状态固定。手机只对单个图标作更小响应，不挤压画布。 |
| 111 | [apps/web/src/ai/ExecutionStatus.tsx](../../apps/web/src/ai/ExecutionStatus.tsx)<br>[apps/web/src/ai/execution-events.ts](../../apps/web/src/ai/execution-events.ts)<br>[apps/web/src/ai/LiveAssistant.tsx](../../apps/web/src/ai/LiveAssistant.tsx) | 紧凑执行摘要与可展开的最近真实公开 SSE 工具/运行事件。 | 不展示隐藏推理、不按计时完成、不把前序步骤自动标成功；unknown 保持独立；不同 run 不串记录。 |
| 112 | [apps/web/src/components/VoiceCapture.tsx](../../apps/web/src/components/VoiceCapture.tsx)<br>[apps/web/src/ai/local-recording.ts](../../apps/web/src/ai/local-recording.ts)<br>[apps/web/src/ai/RecordingMeter.tsx](../../apps/web/src/ai/RecordingMeter.tsx)<br>[apps/web/src/ai/interaction-v2.css](../../apps/web/src/ai/interaction-v2.css) | 录音胶囊、实际秒数、同一已有录音流的 RMS 波形，明确停止/取消/试听。 | 不用 demo 默认模拟波形、不申请第二支麦克风；权限迟到/转换迟到不能复活取消录音。物理麦克风尚未实测。 |
| 114 | [apps/web/src/ai/ComposerAction.tsx](../../apps/web/src/ai/ComposerAction.tsx)<br>[apps/web/src/ai/ComposerInput.tsx](../../apps/web/src/ai/ComposerInput.tsx)<br>[apps/web/src/ai/LiveAssistant.tsx](../../apps/web/src/ai/LiveAssistant.tsx)<br>[apps/web/src/components/AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx)<br>[apps/web/src/ai/interaction-v2.css](../../apps/web/src/ai/interaction-v2.css) | 保留现有 IME 与真实输入自增高；附件直达共享范围；同按钮送出/停止轮廓 240ms 形变。 | 只有真实 stop handler 才出现停止，普通任务只显示真实等待；不发送即清空草稿/附件，冻结输入和未知计费守卫不改。 |
| 115 | [apps/web/src/components/Ui.tsx](../../apps/web/src/components/Ui.tsx) | 短通知可见关闭；剩余显示时间随 hover、focus、页面隐藏暂停；错误显式关闭。 | 没有采用未实操确认的 swipe，也不添加假 Undo；关键冲突/未知回执保留原恢复入口。 |
| 119 | [apps/web/src/components/StatusMark.tsx](../../apps/web/src/components/StatusMark.tsx)<br>[apps/web/src/components/status-mark.css](../../apps/web/src/components/status-mark.css)<br>[apps/web/src/ai/AIThread.tsx](../../apps/web/src/ai/AIThread.tsx)<br>[apps/web/src/ai/ExecutionStatus.tsx](../../apps/web/src/ai/ExecutionStatus.tsx) | 统一细描边 pending/running/done/failed/cancelled/unknown，未知为静态问号。 | 只有实际测得的 progress 才画进度；不定时切换生命周期；由外层真实状态容器决定 aria-live。 |
| 120 | [apps/web/src/components/ChoiceSelect.tsx](../../apps/web/src/components/ChoiceSelect.tsx)<br>[apps/web/src/components/choice-motion.css](../../apps/web/src/components/choice-motion.css) | 选项装饰背景按真实测量边缘移动；文字和命中区不移动。 | 保留原生 popover、VisualViewport 碰撞、长列表、禁用项、IME、键盘和关闭归焦。 |
| 124 | [apps/web/src/editor/useWakeTicks.ts](../../apps/web/src/editor/useWakeTicks.ts)<br>[apps/web/src/editor/PrecisionRange.tsx](../../apps/web/src/editor/PrecisionRange.tsx) | 位置与速度分别平滑，刻度尾迹有方向并在静止时归平。 | 精确数值不走弹簧，视觉尾迹不扩大真实参数边界；共用动画时钟。 |
| 127 | [apps/web/src/editor/PrecisionRange.tsx](../../apps/web/src/editor/PrecisionRange.tsx) | 点击严格数值输入；3px 鼠标/8px 触摸阈值，2px 每步，Shift 粗调、Alt 细调和边界视觉阻力。 | 单手势单提交；Escape、失焦、pointercancel 和源失效保留事务取消。 |
| 129 | [apps/web/src/components/control-motion/WarmTooltip.tsx](../../apps/web/src/components/control-motion/WarmTooltip.tsx) | 共享移动提示气泡，冷启动延迟、暖启动/焦点即时显示和短退出宽限。 | 补齐 viewport 碰撞、立即 Esc 移除、动态 reduced；不沿用参考演示未确认的 Esc 表现。 |
| 131 | [apps/web/src/components/control-motion/RubberSegment.tsx](../../apps/web/src/components/control-motion/RubberSegment.tsx)<br>[apps/web/src/editor/ParameterShelf.tsx](../../apps/web/src/editor/ParameterShelf.tsx)<br>[apps/web/src/ai/LiveAssistant.tsx](../../apps/web/src/ai/LiveAssistant.tsx) | 受控分段的左右边独立弹簧、方向伸展及拖动/短速度预测；参数分类复用测量指示。 | 原生 button/aria-pressed 保留 Enter/Space；取消不选择；不增加一层导航或第二个数值状态来源。 |
| 133 | [apps/web/src/components/CheckControl.tsx](../../apps/web/src/components/CheckControl.tsx)<br>[apps/web/src/components/TaskStateMark.tsx](../../apps/web/src/components/TaskStateMark.tsx)<br>[apps/web/src/components/check-control.css](../../apps/web/src/components/check-control.css) | 原生复选框使用精细 SVG 弹性填色；任务用同类状态轮廓。 | 二元 checkbox 不替代 todo/doing/done 任务；任务仍是独立 button 和真实 CAS 回执，等待只显示 ring。 |
| 136 | [apps/web/src/components/control-motion/SquishSwitch.tsx](../../apps/web/src/components/control-motion/SquishSwitch.tsx)<br>[apps/web/src/components/OpsDashboard.tsx](../../apps/web/src/components/OpsDashboard.tsx)<br>[apps/web/src/components/AssistantOpsPanel.tsx](../../apps/web/src/components/AssistantOpsPanel.tsx) | 弹簧位置、速度压缩、拖动预览与松手单次受控 boolean。 | 取消/失焦恢复预览；业务配置仍需既有明确保存和 CAS；与保留视图生命周期的 MotionSwitch 分开。 |
| 204 | [apps/web/src/components/ColorPicker.tsx](../../apps/web/src/components/ColorPicker.tsx)<br>[apps/web/src/editor/editor-controls.css](../../apps/web/src/editor/editor-controls.css) | 真实色块选择邻近表面按 1.5/1.3/1.15 响应，500ms 回位；手机 18px 表面与独立 44px 命中。 | 官方仅 HTML/CSS、没有复制 JS；只有实际 clipboard promise 成功才提示复制，不伪造回执。 |

## 209 项完整映射

初筛保留原研究决定：39 项候选、55 项备选、115 项暂不适用。下表最后一列给出本轮是否真正集成；候选不会因名字相似自动变成采用。所有原 URL 原样保留。

| ID | 类目 / 原参考与 URL | 适用页面 | 初筛与具体理由 | 已有证据 | 本轮决定 |
| --- | --- | --- | --- | --- | --- |
| 1 | A · [科技感交互文字](https://reactbits.dev/text-animations/tech-text) | about | 备选机制；短标题聚焦候选；仅借指针接近与回位机制，工程虚线和粒子不进入产品参数区，避免品牌字被拆到难读。 | 目录全读；源码未核；Root 实际演示，有明确未验边界 | 短标题聚焦候选；仅借指针接近与回位机制，工程虚线和粒子不进入产品参数区，避免品牌字被拆到难读。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 2 | A · [循环曲线文字](https://reactbits.dev/text-animations/text-loop) | about | 本轮暂不采用；连续曲线文字会增加持续运动与阅读成本，不能帮助用户理解真实系统流程；本轮优先静止可读标题和真实界面。 | 目录全读；源码未核；无本轮实际演示认证 | 连续曲线文字会增加持续运动与阅读成本，不能帮助用户理解真实系统流程；本轮优先静止可读标题和真实界面。 |
| 3 | A · [遮罩揭示标题](https://reactbits.dev/text-animations/masked-heading) | about | 备选机制；章节标题遮罩可与真实截图边缘联动；只在标题之外保留完整语义文本，不能把关键功能说明藏在纹理里。 | 目录全读；源码未核；无本轮实际演示认证 | 章节标题遮罩可与真实截图边缘联动；只在标题之外保留完整语义文本，不能把关键功能说明藏在纹理里。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 4 | A · [粒子组字](https://reactbits.dev/text-animations/particle-text) | about | 本轮暂不采用；粒子重组主要展示特效，中文笔画密集且首屏有额外绘制成本，不承担本轮功能介绍。 | 目录全读；源码未核；无本轮实际演示认证 | 粒子重组主要展示特效，中文笔画密集且首屏有额外绘制成本，不承担本轮功能介绍。 |
| 5 | A · [翻页字牌](https://reactbits.dev/text-animations/split-flap-text) | usage、ops | 备选机制；短状态或数值变化的翻页反馈可研究；账本金额须立即可读，不滚动伪造中间消费值，减少动态时直接替换。 | 目录全读；源码未核；无本轮实际演示认证 | 短状态或数值变化的翻页反馈可研究；账本金额须立即可读，不滚动伪造中间消费值，减少动态时直接替换。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 6 | A · [空间扭曲文字](https://reactbits.dev/text-animations/warp-text) | about | 本轮暂不采用；WebGL 扭曲文字会占用编辑器所需 GPU 资源且影响中文清晰度；不是本轮标题必要机制。 | 目录全读；源码未核；无本轮实际演示认证 | WebGL 扭曲文字会占用编辑器所需 GPU 资源且影响中文清晰度；不是本轮标题必要机制。 |
| 7 | A · [描边生长文字](https://reactbits.dev/text-animations/stroke-text) | about | 备选机制；只用于章节短标题的一次入场，保留完整实心文字；描边生长不能延迟首屏核心信息。 | 目录全读；源码未核；无本轮实际演示认证 | 只用于章节短标题的一次入场，保留完整实心文字；描边生长不能延迟首屏核心信息。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 8 | A · [景深立体文字](https://reactbits.dev/text-animations/depth-text) | about、account | 本轮暂不采用；立体字投影与视差无助于当前功能导览，容易与统一品牌和细字精度冲突。 | 目录全读；源码未核；无本轮实际演示认证 | 立体字投影与视差无助于当前功能导览，容易与统一品牌和细字精度冲突。 |
| 9 | A · [折纸翻折文字](https://reactbits.dev/text-animations/fold-text) | about | 备选机制；短标题切换可参考透视与回位；当前 About 不需要轮流揭示才能读完的信息，静态最终态始终存在。 | 目录全读；源码未核；无本轮实际演示认证 | 短标题切换可参考透视与回位；当前 About 不需要轮流揭示才能读完的信息，静态最终态始终存在。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 10 | A · [回声残影文字](https://reactbits.dev/text-animations/echo-text) | about | 本轮暂不采用；文字残影会制造重复轮廓，与少文字、清晰阅读目标相冲突。 | 目录全读；源码未核；无本轮实际演示认证 | 文字残影会制造重复轮廓，与少文字、清晰阅读目标相冲突。 |
| 11 | A · [分割入场文字](https://reactbits.dev/text-animations/split-text) | about | 候选机制；研究按词错峰入场的时间组织，中文不逐字制造过多动画；章节全部随普通滚动可达，不等动画读正文。 | 目录全读；源码未核；无本轮实际演示认证 | 研究按词错峰入场的时间组织，中文不逐字制造过多动画；章节全部随普通滚动可达，不等动画读正文。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 12 | A · [模糊清晰文字](https://reactbits.dev/text-animations/blur-text) | about | 备选机制；可替代 35 的轻量入场节奏；不模糊真实截图、正文、金额或输入，避免把清晰度当阅读门槛。 | 目录全读；源码未核；无本轮实际演示认证 | 可替代 35 的轻量入场节奏；不模糊真实截图、正文、金额或输入，避免把清晰度当阅读门槛。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 13 | A · [环形排版文字](https://reactbits.dev/text-animations/circular-text) | about | 本轮暂不采用；环形旋转字会增加装饰和重复口号，当前品牌无需额外旋转徽章。 | 目录全读；源码未核；无本轮实际演示认证 | 环形旋转字会增加装饰和重复口号，当前品牌无需额外旋转徽章。 |
| 14 | A · [打字机文字](https://reactbits.dev/text-animations/text-type) | about、ai | 本轮暂不采用；打字机轮播不能代替真实助手流式结果，也会延迟提示内容；本轮不新增循环删除文字。 | 目录全读；源码未核；无本轮实际演示认证 | 打字机轮播不能代替真实助手流式结果，也会延迟提示内容；本轮不新增循环删除文字。 |
| 15 | A · [压感变形文字](https://reactbits.dev/text-animations/text-pressure) | about | 本轮暂不采用；需要额外可变字体且中文覆盖未确认，字宽随鼠标变化易造成标题布局不稳。 | 目录全读；源码未核；无本轮实际演示认证 | 需要额外可变字体且中文覆盖未确认，字宽随鼠标变化易造成标题布局不稳。 |
| 16 | A · [弧线循环字幕](https://reactbits.dev/text-animations/curved-loop) | about | 本轮暂不采用；可拖弧形字幕提高操作次数和持续动效成本，无法承载直接滑完的系统说明。 | 目录全读；源码未核；无本轮实际演示认证 | 可拖弧形字幕提高操作次数和持续动效成本，无法承载直接滑完的系统说明。 |
| 17 | A · [毛刺抖动文字](https://reactbits.dev/text-animations/fuzzy-text) | shared | 本轮暂不采用；错误态需要稳定可读的原因和恢复操作；毛刺抖动会降低识别与舒适度。 | 目录全读；源码未核；无本轮实际演示认证 | 错误态需要稳定可读的原因和恢复操作；毛刺抖动会降低识别与舒适度。 |
| 18 | A · [动态渐变文字](https://reactbits.dev/text-animations/gradient-text) | about | 备选机制；单个短词可用有限渐变强调系统重点；只在已有品牌色内使用，不能对整段文字持续扫描。 | 目录全读；源码未核；无本轮实际演示认证 | 单个短词可用有限渐变强调系统重点；只在已有品牌色内使用，不能对整段文字持续扫描。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 19 | A · [跟随指针字符](https://reactbits.dev/text-animations/text-cursor) | studio、about | 本轮暂不采用；指针文字尾迹可能遮挡画布、工具和正文，也缺少触屏等效价值。 | 目录全读；源码未核；无本轮实际演示认证 | 指针文字尾迹可能遮挡画布、工具和正文，也缺少触屏等效价值。 |
| 20 | A · [焦点切换文字](https://reactbits.dev/text-animations/true-focus) | about | 本轮暂不采用；轮流聚焦会把其他关键词模糊，用户需要同时看清平台重点，不应等待焦点轮换。 | 目录全读；源码未核；无本轮实际演示认证 | 轮流聚焦会把其他关键词模糊，用户需要同时看清平台重点，不应等待焦点轮换。 |
| 21 | A · [滚动上浮文字](https://reactbits.dev/text-animations/scroll-float) | about | 候选机制；章节标题跟随滚动轻移并反向回位，适合纵向系统叙事；手机位移与间距独立设置，正常滚动不被锁住。 | 目录全读；源码未核；无本轮实际演示认证 | 章节标题跟随滚动轻移并反向回位，适合纵向系统叙事；手机位移与间距独立设置，正常滚动不被锁住。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 22 | A · [滚动揭示段落](https://reactbits.dev/text-animations/scroll-reveal) | about | 备选机制；只研究滚动进度映射，不降低正文初始对比或逐词解锁；用户必须直接滚动读完所有内容。 | 目录全读；源码未核；无本轮实际演示认证 | 只研究滚动进度映射，不降低正文初始对比或逐词解锁；用户必须直接滚动读完所有内容。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 23 | A · [ASCII 字幕特效](https://reactbits.dev/text-animations/ascii-text) | about | 本轮暂不采用；字符点阵会牺牲中文标题精度且引入 Canvas 字体成本，缺少真实业务用途。 | 目录全读；源码未核；无本轮实际演示认证 | 字符点阵会牺牲中文标题精度且引入 Canvas 字体成本，缺少真实业务用途。 |
| 24 | A · [轮播单词标题](https://reactbits.dev/text-animations/rotating-text) | about | 备选机制；短标签稳定高度切换可用于补充提示；不能承载唯一功能说明，不能把真实状态做成随机轮播。 | 目录全读；源码未核；无本轮实际演示认证 | 短标签稳定高度切换可用于补充提示；不能承载唯一功能说明，不能把真实状态做成随机轮播。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 25 | A · [滚动速度跑马字](https://reactbits.dev/text-animations/scroll-velocity) | about | 本轮暂不采用；大幅滚动跑马字占据作品空间，阅读与反向滚动负担大于功能表达收益。 | 目录全读；源码未核；无本轮实际演示认证 | 大幅滚动跑马字占据作品空间，阅读与反向滚动负担大于功能表达收益。 |
| 26 | A · [近距可变字体](https://reactbits.dev/text-animations/variable-proximity) | about | 本轮暂不采用；近距可变字轴需要额外字体和鼠标专属反馈，中文与手机收益不足。 | 目录全读；源码未核；无本轮实际演示认证 | 近距可变字轴需要额外字体和鼠标专属反馈，中文与手机收益不足。 |
| 27 | A · [数字递增计数](https://reactbits.dev/text-animations/count-up) | usage、ops | 候选机制；真实汇总数变化时可用一次短数值过渡；保留最终值和静态无动画态，未知数值不能从 0 动画到猜测值。 | 目录全读；源码未核；无本轮实际演示认证 | 真实汇总数变化时可用一次短数值过渡；保留最终值和静态无动画态，未知数值不能从 0 动画到猜测值。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 28 | B · [水晶能量球](https://reactbits.dev/animations/crystalized-ball) | about | 本轮暂不采用；能量球与照片编辑业务没有直接关系，WebGL 材质持续占用预算而不呈现系统细节。 | 目录全读；源码未核；无本轮实际演示认证 | 能量球与照片编辑业务没有直接关系，WebGL 材质持续占用预算而不呈现系统细节。 |
| 29 | B · [电流标志](https://reactbits.dev/animations/electric-logo) | brand | 本轮暂不采用；正式 Logo 必须跨页面、状态一致；电流过曝容易再次改变标识，不作为加载或品牌替身。 | 目录全读；源码未核；无本轮实际演示认证 | 正式 Logo 必须跨页面、状态一致；电流过曝容易再次改变标识，不作为加载或品牌替身。 |
| 30 | B · [辉光指针](https://reactbits.dev/animations/glow-cursor) | studio、about | 本轮暂不采用；跟随光团容易影响颜色判断并遮盖精细操作，移动端也无必要替代路径。 | 目录全读；源码未核；无本轮实际演示认证 | 跟随光团容易影响颜色判断并遮盖精细操作，移动端也无必要替代路径。 |
| 31 | B · [滚动扩展媒体](https://reactbits.dev/animations/scroll-expand) | about | 候选机制；真实系统截图随滚动从局部扩展到完整工作区并可反向收回；保留自然文档流，桌面与手机分别计算图像尺寸。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 32 | B · [弹性网格](https://reactbits.dev/animations/elastic-mesh) | about | 本轮暂不采用；弹性网格仅是背景玩具，增加指针事件和绘制而没有流程反馈收益。 | 目录全读；源码未核；无本轮实际演示认证 | 弹性网格仅是背景玩具，增加指针事件和绘制而没有流程反馈收益。 |
| 33 | B · [像素切换](https://reactbits.dev/animations/pixel-swap) | compare、about | 本轮暂不采用；像素打散会妨碍前后画质比较，不应用于真实编辑结果切换。 | 目录全读；源码未核；无本轮实际演示认证 | 像素打散会妨碍前后画质比较，不应用于真实编辑结果切换。 |
| 34 | B · [指针网格](https://reactbits.dev/animations/cursor-grid) | studio、about | 本轮暂不采用；指针网格与实际选区网格容易混淆，画布之外也没有必要的业务状态绑定。 | 目录全读；源码未核；无本轮实际演示认证 | 指针网格与实际选区网格容易混淆，画布之外也没有必要的业务状态绑定。 |
| 35 | B · [内容入场](https://reactbits.dev/animations/animated-content) | about、shared | 候选机制；统一章节和局部内容入场/退出的时序与清理；以真实存在状态触发，不使关闭内容留在焦点序列。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 36 | B · [柔化显现](https://reactbits.dev/animations/fade-content) | about、shared | 备选机制；作为 35 的较轻替代研究淡入退出，保持照片和文本清晰；不同时叠加两套入场控制器。 | 目录全读；源码未核；无本轮实际演示认证 | 作为 35 的较轻替代研究淡入退出，保持照片和文本清晰；不同时叠加两套入场控制器。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 37 | B · [电流边框](https://reactbits.dev/animations/electric-border) | shared | 本轮暂不采用；电流边框会放大页面条框噪声，错误与重点操作用清楚的状态和标签表达。 | 目录全读；源码未核；无本轮实际演示认证 | 电流边框会放大页面条框噪声，错误与重点操作用清楚的状态和标签表达。 |
| 38 | B · [轨道环绕图片](https://reactbits.dev/animations/orbit-images) | about、assets | 本轮暂不采用；轨道环绕遮挡图片且需要等候目标靠前，违背直接看到全部内容和少操作。 | 目录全读；源码未核；无本轮实际演示认证 | 轨道环绕遮挡图片且需要等候目标靠前，违背直接看到全部内容和少操作。 |
| 39 | B · [像素溶解转场](https://reactbits.dev/animations/pixel-transition) | compare、documents | 本轮暂不采用；像素转场遮挡实际内容并延长结果替换，不适合精确对比或文档读写。 | 目录全读；源码未核；无本轮实际演示认证 | 像素转场遮挡实际内容并延长结果替换，不适合精确对比或文档读写。 |
| 40 | B · [镜面高光悬停](https://reactbits.dev/animations/glare-hover) | about | 备选机制；仅可在非画布的系统截图外框试验低幅镜面反馈；图片像素本身不覆光、不改变颜色判断。 | 目录全读；源码未核；无本轮实际演示认证 | 仅可在非画布的系统截图外框试验低幅镜面反馈；图片像素本身不覆光、不改变颜色判断。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 41 | B · [循环徽标带](https://reactbits.dev/animations/logo-loop) | about | 本轮暂不采用；没有需要轮播的真实合作方目录，不能用循环标志暗示未存在的集成或合作。 | 目录全读；源码未核；无本轮实际演示认证 | 没有需要轮播的真实合作方目录，不能用循环标志暗示未存在的集成或合作。 |
| 42 | B · [目标追踪光标](https://reactbits.dev/animations/target-cursor) | studio | 本轮暂不采用；准星吸附替代光标会与画笔、裁切和真实指针命中冲突，保留原生指针与焦点。 | 目录全读；源码未核；无本轮实际演示认证 | 准星吸附替代光标会与画笔、裁切和真实指针命中冲突，保留原生指针与焦点。 |
| 43 | B · [激光流束](https://reactbits.dev/animations/laser-flow) | about | 本轮暂不采用；激光流束缺少真实业务映射，视觉权重大且可能掩盖实际界面。 | 目录全读；源码未核；无本轮实际演示认证 | 激光流束缺少真实业务映射，视觉权重大且可能掩盖实际界面。 |
| 44 | B · [渐进模糊遮罩](https://reactbits.dev/animations/gradual-blur) | navigation、ai | 备选机制；仅研究滚动边界的渐进遮罩提示；不能模糊正文、余额或按钮，手机需保证底部输入和可点击区域清晰。 | 目录全读；源码未核；无本轮实际演示认证 | 仅研究滚动边界的渐进遮罩提示；不能模糊正文、余额或按钮，手机需保证底部输入和可点击区域清晰。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 45 | B · [点击火花](https://reactbits.dev/animations/click-spark) | shared | 本轮暂不采用；点击火花会在高频参数操作中制造噪声；按压、状态和撤销反馈更直接。 | 目录全读；源码未核；无本轮实际演示认证 | 点击火花会在高频参数操作中制造噪声；按压、状态和撤销反馈更直接。 |
| 46 | B · [光纤细丝](https://reactbits.dev/animations/strands) | about | 本轮暂不采用；光纤细丝不说明任何实际系统能力，也不应冒充精细发丝抠图结果。 | 目录全读；源码未核；无本轮实际演示认证 | 光纤细丝不说明任何实际系统能力，也不应冒充精细发丝抠图结果。 |
| 47 | B · [撕角贴纸](https://reactbits.dev/animations/sticker-peel) | about | 备选机制；可研究真实截图注记的边缘揭示与回弹；重要说明在静态文档流中，不要求撕开才能看到。 | 目录全读；源码未核；无本轮实际演示认证 | 可研究真实截图注记的边缘揭示与回弹；重要说明在静态文档流中，不要求撕开才能看到。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 48 | B · [静态纹理噪声](https://reactbits.dev/animations/noise) | about | 备选机制；极低对比静态材质可用于外层背景，禁止覆盖编辑图像、截图和色值；不引入持续随机重绘。 | 目录全读；源码未核；无本轮实际演示认证 | 极低对比静态材质可用于外层背景，禁止覆盖编辑图像、截图和色值；不引入持续随机重绘。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 49 | B · [形变模糊](https://reactbits.dev/animations/shape-blur) | about | 本轮暂不采用；形变模糊属于装饰且影响视觉锐度，不承担本轮系统说明或真实状态。 | 目录全读；源码未核；无本轮实际演示认证 | 形变模糊属于装饰且影响视觉锐度，不承担本轮系统说明或真实状态。 |
| 50 | B · [十字定位光标](https://reactbits.dev/animations/crosshair) | editor | 备选机制；仅研究真实取色/定位工具的准星对齐，必须服从现有源坐标与缩放矩阵；不能将装饰坐标冒充实际像素。 | 目录全读；源码未核；无本轮实际演示认证 | 仅研究真实取色/定位工具的准星对齐，必须服从现有源坐标与缩放矩阵；不能将装饰坐标冒充实际像素。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 51 | B · [影像拖尾](https://reactbits.dev/animations/image-trail) | assets | 本轮暂不采用；图片拖尾会重复创建缩略图和遮挡目标，降低检索、批量选择与触屏效率。 | 目录全读；源码未核；无本轮实际演示认证 | 图片拖尾会重复创建缩略图和遮挡目标，降低检索、批量选择与触屏效率。 |
| 52 | B · [弹性丝带](https://reactbits.dev/animations/ribbons) | about、studio | 本轮暂不采用；丝带指针与本次少干扰要求不符；既有历史组件不能仅因已经存在就继续采用。 | 目录全读；源码未核；无本轮实际演示认证 | 丝带指针与本次少干扰要求不符；既有历史组件不能仅因已经存在就继续采用。 |
| 53 | B · [液体泼墨光标](https://reactbits.dev/animations/splash-cursor) | studio | 本轮暂不采用；泼墨覆盖会妨碍修图颜色和笔刷判断，GPU 开销也与真实渲染竞争。 | 目录全读；源码未核；无本轮实际演示认证 | 泼墨覆盖会妨碍修图颜色和笔刷判断，GPU 开销也与真实渲染竞争。 |
| 54 | B · [融并液球](https://reactbits.dev/animations/meta-balls) | about | 本轮暂不采用；液球融并没有对应功能状态，无法替代真实协作、图层或参数说明。 | 目录全读；源码未核；无本轮实际演示认证 | 液球融并没有对应功能状态，无法替代真实协作、图层或参数说明。 |
| 55 | B · [流体光标球](https://reactbits.dev/animations/blob-cursor) | studio、about | 本轮暂不采用；three 流体光标带来依赖和持续渲染成本，且容易覆盖精细工具。 | 目录全读；源码未核；无本轮实际演示认证 | three 流体光标带来依赖和持续渲染成本，且容易覆盖精细工具。 |
| 56 | B · [星光边框](https://reactbits.dev/animations/star-border) | shared | 本轮暂不采用；持续星光描边增加按钮装饰负担；主次操作用尺寸、颜色和可用状态区分即可。 | 目录全读；源码未核；无本轮实际演示认证 | 持续星光描边增加按钮装饰负担；主次操作用尺寸、颜色和可用状态区分即可。 |
| 57 | C · [全息反光卡片](https://reactbits.dev/components/holo-card) | assets、account | 本轮暂不采用；全息卡会改变照片和账户内容观感，金融/会员展示不是当前真实业务重心。 | 目录全读；源码未核；无本轮实际演示认证 | 全息卡会改变照片和账户内容观感，金融/会员展示不是当前真实业务重心。 |
| 58 | C · [环形轮播画廊](https://reactbits.dev/components/circular-carousel) | assets、about | 本轮暂不采用；环形轮播隐藏部分图片、需要拖动找内容；素材与 About 采用直接可见的流式布局。 | 目录全读；源码未核；无本轮实际演示认证 | 环形轮播隐藏部分图片、需要拖动找内容；素材与 About 采用直接可见的流式布局。 |
| 59 | C · [柔性横向画廊](https://reactbits.dev/components/flex-carousel) | assets | 备选机制；仅研究横向触控惯性与停靠，不让真实图片发生玻璃变形；若已有原生滚动足够则不加 ogl。 | 目录全读；源码未核；无本轮实际演示认证 | 仅研究横向触控惯性与停靠，不让真实图片发生玻璃变形；若已有原生滚动足够则不加 ogl。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 60 | C · [无限螺旋陈列](https://reactbits.dev/components/infinite-spiral) | assets、about | 本轮暂不采用；螺旋陈列的遮挡和纵深缩放不利于检索与一次浏览全部内容。 | 目录全读；源码未核；无本轮实际演示认证 | 螺旋陈列的遮挡和纵深缩放不利于检索与一次浏览全部内容。 |
| 61 | C · [景深式轮播](https://reactbits.dev/components/depth-carousel) | assets、about | 本轮暂不采用；景深轮播将其他内容虚化并增加选中操作，不适合主素材列表与直接滚读介绍。 | 目录全读；源码未核；无本轮实际演示认证 | 景深轮播将其他内容虚化并增加选中操作，不适合主素材列表与直接滚读介绍。 |
| 62 | C · [液态形变滑块](https://reactbits.dev/components/morph-slider) | compare | 本轮暂不采用；液态形变会掩盖真实处理前后差异，不能用于图像质量或参数效果的对照。 | 目录全读；源码未核；无本轮实际演示认证 | 液态形变会掩盖真实处理前后差异，不能用于图像质量或参数效果的对照。 |
| 63 | C · [漂流图片墙](https://reactbits.dev/components/drift-wall) | assets | 本轮暂不采用；自动漂移图片墙会移动点击目标，不适合真实资产搜索、选取和元数据操作。 | 目录全读；源码未核；无本轮实际演示认证 | 自动漂移图片墙会移动点击目标，不适合真实资产搜索、选取和元数据操作。 |
| 64 | C · [手风琴图片组](https://reactbits.dev/components/accordion-gallery) | about | 备选机制；可研究媒体区域随焦点扩展的联动；手机必须全部纵向展开，正文和系统重点不能依赖悬停。 | 目录全读；源码未核；无本轮实际演示认证 | 可研究媒体区域随焦点扩展的联动；手机必须全部纵向展开，正文和系统重点不能依赖悬停。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 65 | C · [镜面精密按钮](https://reactbits.dev/components/specular-button) | shared | 本轮暂不采用；已读源码为每按钮 WebGL2 高光；本轮不采用，避免与图像渲染争用 GPU、干扰色彩判断。统一精细 SVG 和按压反馈另用轻量原语。 | 目录全读；完整源码已读；无本轮实际演示认证 | 已读源码为每按钮 WebGL2 高光；本轮不采用，避免与图像渲染争用 GPU、干扰色彩判断。统一精细 SVG 和按压反馈另用轻量原语。 |
| 66 | C · [滚轮选项器](https://reactbits.dev/components/option-wheel) | editor、export | 本轮暂不采用；已读源码为拦截滚轮的曲面离散选择且状态不受控；直接选项更少操作，避免抢走参数面板滚动和取消仍提交。 | 目录全读；完整源码已读；无本轮实际演示认证 | 已读源码为拦截滚轮的曲面离散选择且状态不受控；直接选项更少操作，避免抢走参数面板滚动和取消仍提交。 |
| 67 | C · [弧线输入框](https://reactbits.dev/components/curved-input) | auth、ai、documents | 本轮暂不采用；弧线输入会增加中文输入法、光标和长文本编辑风险，不适合真实表单。 | 目录全读；源码未核；无本轮实际演示认证 | 弧线输入会增加中文输入法、光标和长文本编辑风险，不适合真实表单。 |
| 68 | C · [线型侧边栏](https://reactbits.dev/components/line-sidebar) | navigation、account、ops | 候选机制；研究细线指示与当前项持续状态，替代密集卡片分区；桌面侧栏与手机短导航分别布局。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 69 | C · [动效列表](https://reactbits.dev/components/animated-list) | assets、collaboration、documents、ai | 候选机制；真实新增、删除和排序时柔顺补位，保持当前键盘焦点；不对轮询中未变化的行重复入场。 | 目录全读；完整源码已读；无本轮实际演示认证 | 完整源码仅研究；本轮无实际演示记录，业务列表未接 AnimatedList。保留稳定 DOM 与真实选中，避免 hover 改选择或相交比例隐藏内容。 |
| 70 | C · [滚动叠卡](https://reactbits.dev/components/scroll-stack) | about | 备选机制；只研究滚动层级感，不让卡片覆盖仍需阅读的系统细节；手机优先普通流，不能多屏固定叠卡阻断阅读。 | 目录全读；源码未核；无本轮实际演示认证 | 只研究滚动层级感，不让卡片覆盖仍需阅读的系统细节；手机优先普通流，不能多屏固定叠卡阻断阅读。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 71 | C · [气泡弹出菜单](https://reactbits.dev/components/bubble-menu) | navigation | 本轮暂不采用；气泡分裂菜单遮挡画布且增添展开步骤，与清晰紧凑的工具路径不符。 | 目录全读；源码未核；无本轮实际演示认证 | 气泡分裂菜单遮挡画布且增添展开步骤，与清晰紧凑的工具路径不符。 |
| 72 | C · [魔法 Bento 栅格](https://reactbits.dev/components/magic-bento) | about | 备选机制；可借非等宽网格组织真实功能图，但不把全站变成发光方框；手机独立两列或纵向节奏。 | 目录全读；源码未核；无本轮实际演示认证 | 可借非等宽网格组织真实功能图，但不把全站变成发光方框；手机独立两列或纵向节奏。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 73 | C · [曲面媒体画廊](https://reactbits.dev/components/circular-gallery) | assets | 本轮暂不采用；弧形拖动画廊会改变图片透视并与页面滚动争夺手势，不适合项目素材管理。 | 目录全读；源码未核；无本轮实际演示认证 | 弧形拖动画廊会改变图片透视并与页面滚动争夺手势，不适合项目素材管理。 |
| 74 | C · [反射质感卡](https://reactbits.dev/components/reflective-card) | about | 备选机制；只研究外框材质层级，不折射真实图片/文案；若需要新图标依赖则优先复用现有 SVG。 | 目录全读；源码未核；无本轮实际演示认证 | 只研究外框材质层级，不折射真实图片/文案；若需要新图标依赖则优先复用现有 SVG。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 75 | C · [卡片式导航](https://reactbits.dev/components/card-nav) | navigation | 本轮暂不采用；卡片导航附带简介会重新增加用户要求删掉的解释文字和展开高度。 | 目录全读；源码未核；无本轮实际演示认证 | 卡片导航附带简介会重新增加用户要求删掉的解释文字和展开高度。 |
| 76 | C · [可甩动卡组](https://reactbits.dev/components/stack) | assets、about | 本轮暂不采用；甩卡把内容藏在上一张之后；不适合要直接看到所有功能或稳定选择素材的路径。 | 目录全读；源码未核；无本轮实际演示认证 | 甩卡把内容藏在上一张之后；不适合要直接看到所有功能或稳定选择素材的路径。 |
| 77 | C · [流体玻璃层](https://reactbits.dev/components/fluid-glass) | studio | 本轮暂不采用；折射流体面板会干扰照片颜色与字形可读性，持续渲染也占用图像处理预算。 | 目录全读；源码未核；无本轮实际演示认证 | 折射流体面板会干扰照片颜色与字形可读性，持续渲染也占用图像处理预算。 |
| 78 | C · [药丸导航栏](https://reactbits.dev/components/pill-nav) | navigation、account、ai | 候选机制；研究选中底板连续位移与固定标签宽度，承接真实视图/任务切换；手机可横向滚动，不能由悬停决定状态。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 79 | C · [倾斜交互卡](https://reactbits.dev/components/tilted-card) | about | 备选机制；真实截图外框可用小幅指针倾斜与离开回正；手机和减少动态直接平面，不扭曲工作台本身。 | 目录全读；源码未核；无本轮实际演示认证 | 真实截图外框可用小幅指针倾斜与离开回正；手机和减少动态直接平面，不扭曲工作台本身。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 80 | C · [瀑布流排版](https://reactbits.dev/components/masonry) | assets | 候选机制；研究按图像比例自适应网格和加载重排，保持图像完整可见；页码、选择和键盘顺序须与 DOM 一致。 | 目录全读；源码未核；无本轮实际演示认证 | 研究按图像比例自适应网格和加载重排，保持图像完整可见；页码、选择和键盘顺序须与 DOM 一致。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 81 | C · [镜片玻璃面板](https://reactbits.dev/components/glass-surface) | shared | 备选机制；有限磨砂仅用于浮层背景且有不透明降级，文字和照片不折射；不叠多层重度 backdrop-filter。 | 目录全读；源码未核；无本轮实际演示认证 | 有限磨砂仅用于浮层背景且有不透明降级，文字和照片不折射；不叠多层重度 backdrop-filter。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 82 | C · [穹顶图像展厅](https://reactbits.dev/components/dome-gallery) | assets、about | 本轮暂不采用；穹顶旋转隐藏内容并依赖空间拖动，不能替代简单素材检索或纵向系统介绍。 | 目录全读；源码未核；无本轮实际演示认证 | 穹顶旋转隐藏内容并依赖空间拖动，不能替代简单素材检索或纵向系统介绍。 |
| 83 | C · [彩度响应网格](https://reactbits.dev/components/chroma-grid) | assets | 本轮暂不采用；默认降低真实照片彩度会误导用户识别素材与效果，不能用悬停恢复色彩作主要图库机制。 | 目录全读；源码未核；无本轮实际演示认证 | 默认降低真实照片彩度会误导用户识别素材与效果，不能用悬停恢复色彩作主要图库机制。 |
| 84 | C · [文件夹翻盖](https://reactbits.dev/components/folder) | navigation、assets | 候选机制；研究项目/文档入口的细致文件夹 SVG、轻翻盖与回位；实际项目仍一次点击进入，不增加层层卡片展开。 | 目录全读；仅部分源码；无本轮实际演示认证 | 研究项目/文档入口的细致文件夹 SVG、轻翻盖与回位；实际项目仍一次点击进入，不增加层层卡片展开。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 85 | C · [错峰侧滑菜单](https://reactbits.dev/components/staggered-menu) | navigation | 候选机制；研究手机导航抽屉的错峰进入/退出与焦点归还；尺寸按手机独立规划，减少动态立即显示。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 86 | C · [悬挂胸牌](https://reactbits.dev/components/lanyard) | account | 本轮暂不采用；物理胸牌引入 three 和持续模拟，不利于紧凑账户操作与真实信息层级。 | 目录全读；源码未核；无本轮实际演示认证 | 物理胸牌引入 three 和持续模拟，不利于紧凑账户操作与真实信息层级。 |
| 87 | C · [全息个人卡](https://reactbits.dev/components/profile-card) | account | 本轮暂不采用；全息个人卡的身份展示效果与当前账户功能无关，会扩大卡片和冗余信息。 | 目录全读；源码未核；无本轮实际演示认证 | 全息个人卡的身份展示效果与当前账户功能无关，会扩大卡片和冗余信息。 |
| 88 | C · [图标 Dock 栏](https://reactbits.dev/components/dock) | editor、navigation | 候选机制；研究鼠标距离驱动的相邻图标响应、激活与按压回位；手机用更小稳定图标和原生滑动，不套桌面放大尺寸。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 89 | C · [黏性导航](https://reactbits.dev/components/gooey-nav) | navigation | 备选机制；可与 78 比较选中底板的延展动力学；不同时运行两套导航动效，不让液态尾巴遮挡标签。 | 目录全读；源码未核；无本轮实际演示认证 | 可与 78 比较选中底板的延展动力学；不同时运行两套导航动效，不让液态尾巴遮挡标签。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 90 | C · [像素填充卡](https://reactbits.dev/components/pixel-card) | assets、shared | 本轮暂不采用；像素填充遮挡卡内图片和文字，不能帮助精确状态确认。 | 目录全读；源码未核；无本轮实际演示认证 | 像素填充遮挡卡内图片和文字，不能帮助精确状态确认。 |
| 91 | C · [经典卡片轮播](https://reactbits.dev/components/carousel) | compare | 备选机制；只保留明确箭头、键盘和触控换版本的可达性；系统介绍和主图库不采用自动轮播隐藏内容。 | 目录全读；源码未核；无本轮实际演示认证 | 只保留明确箭头、键盘和触控换版本的可达性；系统介绍和主图库不采用自动轮播隐藏内容。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 92 | C · [聚光灯卡片](https://reactbits.dev/components/spotlight-card) | about | 备选机制；外层截图卡可研究局部聚光的进入/退出，但不修改截图像素颜色，手机关闭指针效果。 | 目录全读；源码未核；无本轮实际演示认证 | 外层截图卡可研究局部聚光的进入/退出，但不修改截图像素颜色，手机关闭指针效果。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 93 | C · [流光描边卡](https://reactbits.dev/components/border-glow) | shared | 本轮暂不采用；全站发光描边会恢复用户反感的条框密度，不作为信息层级方案。 | 目录全读；源码未核；无本轮实际演示认证 | 全站发光描边会恢复用户反感的条框密度，不作为信息层级方案。 |
| 94 | C · [飞行海报](https://reactbits.dev/components/flying-posters) | assets、about | 本轮暂不采用；飞行海报会让实际图像重叠并改变阅读方向，违背稳定布局与少操作要求。 | 目录全读；源码未核；无本轮实际演示认证 | 飞行海报会让实际图像重叠并改变阅读方向，违背稳定布局与少操作要求。 |
| 95 | C · [三维换位卡](https://reactbits.dev/components/card-swap) | about | 本轮暂不采用；定时换位把功能介绍藏进堆叠卡片，用户需要等候或点击才知道内容。 | 目录全读；源码未核；无本轮实际演示认证 | 定时换位把功能介绍藏进堆叠卡片，用户需要等候或点击才知道内容。 |
| 96 | C · [玻璃图标方块](https://reactbits.dev/components/glass-icons) | navigation | 备选机制；可研究图标与底板的细小深度反馈，必须仍使用统一精细 SVG 和可辨激活状态；不新增厚重玻璃方块。 | 目录全读；源码未核；无本轮实际演示认证 | 可研究图标与底板的细小深度反馈，必须仍使用统一精细 SVG 和可辨激活状态；不新增厚重玻璃方块。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 97 | C · [侵蚀溶解卡](https://reactbits.dev/components/decay-card) | assets、compare | 本轮暂不采用；侵蚀照片会被误解为真实图像损坏或处理效果，不适合作为素材交互。 | 目录全读；源码未核；无本轮实际演示认证 | 侵蚀照片会被误解为真实图像损坏或处理效果，不适合作为素材交互。 |
| 98 | C · [流动整行菜单](https://reactbits.dev/components/flowing-menu) | navigation | 本轮暂不采用；巨幅流动菜单占用屏幕并增加文字/图片带噪声，当前导航需要直接、紧凑。 | 目录全读；源码未核；无本轮实际演示认证 | 巨幅流动菜单占用屏幕并增加文字/图片带噪声，当前导航需要直接、紧凑。 |
| 99 | C · [弹性拖动滑杆](https://reactbits.dev/components/elastic-slider) | editor、native、restoration | 备选机制；完整源码仅研究，Root 本轮未实看，不进入采用；保留权威数值与单手势事务，后续演示核实后再比较弹性边界反馈。 | 目录全读；完整源码已读；无本轮实际演示认证 | 完整源码仅研究，Root 本轮未实看，不进入采用；保留权威数值与单手势事务，后续演示核实后再比较弹性边界反馈。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 100 | C · [逐位翻滚计数器](https://reactbits.dev/components/counter) | usage、ops | 备选机制；可替代 27 的逐位数值反馈；账本历史金额不自动滚动，缺失值仍显示未知。 | 目录全读；源码未核；无本轮实际演示认证 | 可替代 27 的逐位数值反馈；账本历史金额不自动滚动，缺失值仍显示未知。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 101 | C · [球形无限菜单](https://reactbits.dev/components/infinite-menu) | assets | 本轮暂不采用；球形菜单隐藏大部分素材且不利于键盘顺序，不适合检索与授权来源选择。 | 目录全读；源码未核；无本轮实际演示认证 | 球形菜单隐藏大部分素材且不利于键盘顺序，不适合检索与授权来源选择。 |
| 102 | C · [流程步骤器](https://reactbits.dev/components/stepper) | auth、import、native | 本轮暂不采用；原源码 Next 默认先前进，不能等待异步校验，退出面板仅 aria-hidden 且无 inert；本应用已有真实两步注册/导入阶段，不新增向导或强制步骤。 | 目录全读；完整源码已读；无本轮实际演示认证 | 原源码 Next 默认先前进，不能等待异步校验，退出面板仅 aria-hidden 且无 inert；本应用已有真实两步注册/导入阶段，不新增向导或强制步骤。 |
| 103 | C · [弹跳卡片群](https://reactbits.dev/components/bounce-cards) | about | 备选机制；非关键系统截图组可研究聚焦时邻项避让和回位；不让文字被扇形遮挡，手机全部展开。 | 目录全读；源码未核；无本轮实际演示认证 | 非关键系统截图组可研究聚焦时邻项避让和回位；不让文字被扇形遮挡，手机全部展开。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 104 | D · [文件碎纸机](https://reactbits.dev/micro/shredder) | assets、documents | 本轮暂不采用；碎纸机暗示可撤销删除，但现有删除/撤销契约各异；本轮不为动效改变实际事务时机。 | 目录全读；源码未核；无本轮实际演示认证 | 碎纸机暗示可撤销删除，但现有删除/撤销契约各异；本轮不为动效改变实际事务时机。 |
| 105 | D · [纸张揉皱](https://reactbits.dev/micro/paper-crumple) | assets、documents | 本轮暂不采用；揉皱动画引入 three 并遮盖待删除内容，增加等待而不提供可靠恢复。 | 目录全读；源码未核；无本轮实际演示认证 | 揉皱动画引入 three 并遮盖待删除内容，增加等待而不提供可靠恢复。 |
| 106 | D · [票券撕裂](https://reactbits.dev/micro/tear-ticket) | account、usage | 本轮暂不采用；当前没有优惠券核销或票券业务，不新增不存在的一次性权益流程。 | 目录全读；源码未核；无本轮实际演示认证 | 当前没有优惠券核销或票券业务，不新增不存在的一次性权益流程。 |
| 107 | D · [立体双面卡](https://reactbits.dev/micro/flip-card) | about、account | 本轮暂不采用；翻面会隐藏另一面内容，与直接滚读和清楚账户操作冲突。 | 目录全读；源码未核；无本轮实际演示认证 | 翻面会隐藏另一面内容，与直接滚读和清楚账户操作冲突。 |
| 108 | D · [分枝菜单](https://reactbits.dev/micro/branched-menu) | navigation | 本轮暂不采用；分枝菜单消耗空间且需要展开定位，不能降低工具选择步骤。 | 目录全读；源码未核；无本轮实际演示认证 | 分枝菜单消耗空间且需要展开定位，不能降低工具选择步骤。 |
| 109 | D · [漂浮文件夹](https://reactbits.dev/micro/folder-float) | assets | 备选机制；文件夹内部页片的轻反馈可研究，但不引入 matter-js 只为摆动；正文和文件列表持续可见。 | 目录全读；源码未核；无本轮实际演示认证 | 文件夹内部页片的轻反馈可研究，但不引入 matter-js 只为摆动；正文和文件列表持续可见。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 110 | D · [精修进度框](https://reactbits.dev/micro/refine-frame) | ai、restoration、native、import | 本轮暂不采用；完整源码实证是九层整图马赛克缓冲把已有图像模拟变清晰，既非真实服务器进度也非渐进生图；保留现有诚实等待占位，不能直接采用该机制。 | 目录全读；完整源码已读；无本轮实际演示认证 | 完整源码实证是九层整图马赛克缓冲把已有图像模拟变清晰，既非真实服务器进度也非渐进生图；保留现有诚实等待占位，不能直接采用该机制。 |
| 111 | D · [思考过程线](https://reactbits.dev/micro/thought-line) | ai、import | 候选机制；研究真实执行阶段的紧凑线形进度，可折收已完成项；只映射服务端事件，不生成虚假思考过程。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 112 | D · [语音录制胶囊](https://reactbits.dev/micro/voice-pill) | ai、collaboration | 候选机制；将录音按钮扩为真实计时、波形和取消条；读取实际媒体状态，权限拒绝/设备缺失/停止各有明确出口。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 113 | D · [液位进度量表](https://reactbits.dev/micro/slosh-gauge) | usage | 本轮暂不采用；晃动液位会模糊余额、预占与消耗的区别，财务类数据应以准确数值和标签表达。 | 目录全读；源码未核；无本轮实际演示认证 | 晃动液位会模糊余额、预占与消耗的区别，财务类数据应以准确数值和标签表达。 |
| 114 | D · [智能提示输入栏](https://reactbits.dev/micro/prompt-bar) | ai | 候选机制；组合真实文本草稿、参考图、模型与语音入口；按能力和屏高收敛入口，发送/停止状态共用现有守卫。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 115 | D · [手势通知](https://reactbits.dev/micro/swipe-toast) | shared | 候选机制；短时非关键反馈可滑走并允许键盘关闭；保存冲突、计费未知和权限错误不能作为自动消失 Toast。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 116 | D · [弹弓发送键](https://reactbits.dev/micro/sling-button) | ai | 本轮暂不采用；拖拽蓄势发送会增加操作并诱发收费误触，显式普通提交与禁用状态更适合真实任务。 | 目录全读；源码未核；无本轮实际演示认证 | 拖拽蓄势发送会增加操作并诱发收费误触，显式普通提交与禁用状态更适合真实任务。 |
| 117 | D · [铃铛开关](https://reactbits.dev/micro/bell-toggle) | account | 本轮暂不采用；未发现真实通知订阅偏好端点，不能为铃铛动效添加不持久的假设置。 | 目录全读；源码未核；无本轮实际演示认证 | 未发现真实通知订阅偏好端点，不能为铃铛动效添加不持久的假设置。 |
| 118 | D · [通话状态条](https://reactbits.dev/micro/call-chip) | ai、collaboration | 本轮暂不采用；源码实际是工具调用状态而非目录描述的语音通话条，expectedMs 自动模拟进度到 90%；本轮用 119 映射真实状态，保留实际语音组件。 | 目录全读；完整源码已读；无本轮实际演示认证 | 源码实际是工具调用状态而非目录描述的语音通话条，expectedMs 自动模拟进度到 90%；本轮用 119 映射真实状态，保留实际语音组件。 |
| 119 | D · [代理状态标识](https://reactbits.dev/micro/status-mark) | ai、shared | 候选机制；小型状态标识替代重复标题/说明，严格区分未配置、处理中、完成和失败，保留文本与可访问名称。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 120 | D · [滑动式选择框](https://reactbits.dev/micro/glide-select) | shared、editor、ai、ops | 候选机制；研究选择器展开定位、当前项高亮与退出；接现有 ChoiceSelect 的键盘、IME、禁用和受控值，不新建伪选择状态。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 121 | D · [滑动操作行](https://reactbits.dev/micro/swipe-row) | assets、documents、collaboration | 候选机制；手机列表可轻滑露出次操作以降低常驻文字密度；保留显式菜单入口，滑动本身不立即删除。 | 目录全读；源码未核；无本轮实际演示认证 | 手机列表可轻滑露出次操作以降低常驻文字密度；保留显式菜单入口，滑动本身不立即删除。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 122 | D · [果冻单选](https://reactbits.dev/micro/jelly-radio) | shared、auth、export | 备选机制；保留原生单选语义，只给已选点短暂弹性反馈；不让选项标签跟着位移影响命中。 | 目录全读；源码未核；无本轮实际演示认证 | 保留原生单选语义，只给已选点短暂弹性反馈；不让选项标签跟着位移影响命中。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 123 | D · [彗尾旋钮](https://reactbits.dev/micro/comet-dial) | editor、native | 备选机制；完整源码仅研究，Root 本轮未实看，不进入采用；仅适合角度/色相，不能将曝光等参数改为大旋钮。 | 目录全读；完整源码已读；无本轮实际演示认证 | 完整源码仅研究，Root 本轮未实看，不进入采用；仅适合角度/色相，不能将曝光等参数改为大旋钮。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 124 | D · [尾波滑杆](https://reactbits.dev/micro/wake-slider) | editor | 候选机制；采用候选为真实拖动速度、方向与衰减形成短尾迹；结合127精确输入，只改反馈不让弹簧驱动配方数值，减少动态时静止。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 125 | D · [验证码槽](https://reactbits.dev/micro/code-slots) | auth | 本轮暂不采用；源码 input.value 恒为空、视觉字符 aria-hidden，错误时自动清码且缺 IME 防护；不适合未知回执和可重用验证码，保留真实 one-time-code 输入值与现有恢复。 | 目录全读；完整源码已读；无本轮实际演示认证 | 源码 input.value 恒为空、视觉字符 aria-hidden，错误时自动清码且缺 IME 防护；不适合未知回执和可重用验证码，保留真实 one-time-code 输入值与现有恢复。 |
| 126 | D · [格点加载器](https://reactbits.dev/micro/lattice-loader) | shared | 备选机制；只用于真实未知时长的局部等待，尺寸固定、减少动态静态替代；不模拟进度比例。 | 目录全读；源码未核；无本轮实际演示认证 | 只用于真实未知时长的局部等待，尺寸固定、减少动态静态替代；不模拟进度比例。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 127 | D · [拖动修订数值](https://reactbits.dev/micro/scrub-field) | editor、native、restoration、ops | 候选机制；数值标签可拖动微调并直接键盘输入，减少常驻字段；连续手势冻结源身份，取消必须还原同一次预览。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 128 | D · [保险丝按钮](https://reactbits.dev/micro/fuse-button) | shared | 本轮暂不采用；倒计时后才提交会改变现有删除/收费事务并制造假撤销窗口，不能仅为动效增加。 | 目录全读；源码未核；无本轮实际演示认证 | 倒计时后才提交会改变现有删除/收费事务并制造假撤销窗口，不能仅为动效增加。 |
| 129 | D · [延迟浮层提示](https://reactbits.dev/micro/warm-tooltip) | shared、editor、navigation | 候选机制；研究首次悬停延迟、连续浏览温启动与离开清理；键盘/触屏也能查看短工具名，关键说明不只放提示层。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 130 | D · [滑动确认条](https://reactbits.dev/micro/slide-commit) | shared、usage | 本轮暂不采用；拖动确认增加必须操作且可访问替代复杂，现有明确确认和一次提交锁更适合计费/危险动作。 | 目录全读；源码未核；无本轮实际演示认证 | 拖动确认增加必须操作且可访问替代复杂，现有明确确认和一次提交锁更适合计费/危险动作。 |
| 131 | D · [橡皮筋分段切换](https://reactbits.dev/micro/rubber-segment) | navigation、editor、ai、restoration | 候选机制；短分段选中底板以拉伸后收束连接状态切换；按真实 value 驱动，手机尺寸独立，避免无意义弹跳。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 132 | D · [心形点赞键](https://reactbits.dev/micro/pulse-heart) | assets | 本轮暂不采用；没有已核实的点赞计数业务，不能加视觉点赞后伪装已保存。 | 目录全读；源码未核；无本轮实际演示认证 | 没有已核实的点赞计数业务，不能加视觉点赞后伪装已保存。 |
| 133 | D · [弹簧勾选框](https://reactbits.dev/micro/spring-check) | shared、assets、ops | 候选机制；保留真实 checkbox/checked/disabled 语义，勾号精细 SVG 绘制可统一多选反馈；状态不能由动画完成决定。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 134 | D · [星级评分器](https://reactbits.dev/micro/peek-rating) | assets、ai | 本轮暂不采用；没有产品评分写入接口，不能用星级动效假造评价功能。 | 目录全读；源码未核；无本轮实际演示认证 | 没有产品评分写入接口，不能用星级动效假造评价功能。 |
| 135 | D · [按住确认按钮](https://reactbits.dev/micro/hold-button) | shared | 备选机制；仅研究高风险操作的中止反馈；若采用仍保留键盘明确确认，不把长按用于日常导出/发送增加步骤。 | 目录全读；源码未核；无本轮实际演示认证 | 仅研究高风险操作的中止反馈；若采用仍保留键盘明确确认，不把长按用于日常导出/发送增加步骤。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 136 | D · [挤压切换开关](https://reactbits.dev/micro/squish-switch) | shared、editor、account | 候选机制；启闭开关的按压压缩与回弹可精细化，状态来自现有设置；手机视觉缩小但触达区不随之失效。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 137 | E · [渐变字符背景](https://reactbits.dev/backgrounds/gradient-ascii) | about | 本轮暂不采用；大面积字符底纹会制造文字噪声，用户已明确要求减少密集文字。 | 目录全读；源码未核；无本轮实际演示认证 | 大面积字符底纹会制造文字噪声，用户已明确要求减少密集文字。 |
| 138 | E · [几何波场](https://reactbits.dev/backgrounds/shape-waves) | about | 本轮暂不采用；几何 GPU 波场与系统能力表达联系弱，额外 vgpu 不值得首屏预算。 | 目录全读；源码未核；无本轮实际演示认证 | 几何 GPU 波场与系统能力表达联系弱，额外 vgpu 不值得首屏预算。 |
| 139 | E · [空气感棱片](https://reactbits.dev/backgrounds/aero-shards) | about | 本轮暂不采用；棱片折射需要 GPU 而主要展示装饰，真实系统截图优先。 | 目录全读；源码未核；无本轮实际演示认证 | 棱片折射需要 GPU 而主要展示装饰，真实系统截图优先。 |
| 140 | E · [幽灵光纤](https://reactbits.dev/backgrounds/ghost-fibers) | about | 本轮暂不采用；光纤底纹不能代替真实平台细节，持续运动与编辑器资源竞争。 | 目录全读；源码未核；无本轮实际演示认证 | 光纤底纹不能代替真实平台细节，持续运动与编辑器资源竞争。 |
| 141 | E · [网页织线](https://reactbits.dev/backgrounds/web-threads) | about | 备选机制；可研究真实协作节点之间的细线关系展示；不把装饰连线冒充实时在线成员或已完成的任务。 | 目录全读；源码未核；无本轮实际演示认证 | 可研究真实协作节点之间的细线关系展示；不把装饰连线冒充实时在线成员或已完成的任务。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 142 | E · [等高地形](https://reactbits.dev/backgrounds/topography) | about | 本轮暂不采用；等高线地形缺少当前业务对象，不应为科技感新增一块持续背景。 | 目录全读；源码未核；无本轮实际演示认证 | 等高线地形缺少当前业务对象，不应为科技感新增一块持续背景。 |
| 143 | E · [光纤隧道](https://reactbits.dev/backgrounds/light-tunnel) | about | 本轮暂不采用；高速隧道有眩晕和性能代价，且无真实系统流程映射。 | 目录全读；源码未核；无本轮实际演示认证 | 高速隧道有眩晕和性能代价，且无真实系统流程映射。 |
| 144 | E · [分层切片波](https://reactbits.dev/backgrounds/sliced-waves) | about | 本轮暂不采用；波面切片无功能反馈用途，会压过实际界面与截图。 | 目录全读；源码未核；无本轮实际演示认证 | 波面切片无功能反馈用途，会压过实际界面与截图。 |
| 145 | E · [光束飘落](https://reactbits.dev/backgrounds/lightfall) | about | 本轮暂不采用；飘落光束只有背景装饰价值，本轮先保证信息、图像与交互机制。 | 目录全读；源码未核；无本轮实际演示认证 | 飘落光束只有背景装饰价值，本轮先保证信息、图像与交互机制。 |
| 146 | E · [棱镜折射](https://reactbits.dev/backgrounds/prism) | about | 备选机制；光谱结构可作为色彩章节的小型静态/低频图形研究；不得替换真实直方图或把示意光谱当算法输出。 | 目录全读；源码未核；无本轮实际演示认证 | 光谱结构可作为色彩章节的小型静态/低频图形研究；不得替换真实直方图或把示意光谱当算法输出。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 147 | E · [竖直光柱](https://reactbits.dev/backgrounds/light-pillar) | about | 本轮暂不采用；中心光柱会占据首屏视觉焦点，不能介绍平台真实能力。 | 目录全读；源码未核；无本轮实际演示认证 | 中心光柱会占据首屏视觉焦点，不能介绍平台真实能力。 |
| 148 | E · [侧向射线](https://reactbits.dev/backgrounds/side-rays) | about | 本轮暂不采用；侧向光线可能改变截图周边对比并持续重绘，缺少业务收益。 | 目录全读；源码未核；无本轮实际演示认证 | 侧向光线可能改变截图周边对比并持续重绘，缺少业务收益。 |
| 149 | E · [体积光线](https://reactbits.dev/backgrounds/light-rays) | about | 本轮暂不采用；体积光只是空间装饰，不适合修图产品需要的中性色彩环境。 | 目录全读；源码未核；无本轮实际演示认证 | 体积光只是空间装饰，不适合修图产品需要的中性色彩环境。 |
| 150 | E · [雷达扫描盘](https://reactbits.dev/backgrounds/radar) | ai、usage | 本轮暂不采用；雷达扫描容易暗示不存在的搜索进度/探测能力，真实任务状态应使用实际阶段。 | 目录全读；源码未核；无本轮实际演示认证 | 雷达扫描容易暗示不存在的搜索进度/探测能力，真实任务状态应使用实际阶段。 |
| 151 | E · [柔和极光](https://reactbits.dev/backgrounds/soft-aurora) | about | 备选机制；可比较柔和低频背景与纯色的对比度成本，手机/减少动态静止；不能让背景比真实截图更醒目。 | 目录全读；源码未核；无本轮实际演示认证 | 可比较柔和低频背景与纯色的对比度成本，手机/减少动态静止；不能让背景比真实截图更醒目。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 152 | E · [魔法能量环](https://www.reactbits.dev/backgrounds/magic-rings) | shared | 本轮暂不采用；能量环不能表达确切加载阶段，重复循环增添噪声，不作为通用等待态。 | 目录全读；源码未核；无本轮实际演示认证 | 能量环不能表达确切加载阶段，重复循环增添噪声，不作为通用等待态。 |
| 153 | E · [极光帷幕](https://reactbits.dev/backgrounds/aurora) | about | 备选机制；仅作为 151 的另一背景研究方向，不两者叠加；优先保证首屏资源和真实图像完整。 | 目录全读；源码未核；无本轮实际演示认证 | 仅作为 151 的另一背景研究方向，不两者叠加；优先保证首屏资源和真实图像完整。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 154 | E · [漂浮粒子场](https://reactbits.dev/backgrounds/particles) | about | 本轮暂不采用；大量粒子没有必要功能作用，增加持续动画与低端设备负担。 | 目录全读；源码未核；无本轮实际演示认证 | 大量粒子没有必要功能作用，增加持续动画与低端设备负担。 |
| 155 | E · [渐变百叶窗](https://reactbits.dev/backgrounds/gradient-blinds) | about | 本轮暂不采用；百叶光场易产生条纹噪声，与真实照片和界面细节抢注意力。 | 目录全读；源码未核；无本轮实际演示认证 | 百叶光场易产生条纹噪声，与真实照片和界面细节抢注意力。 |
| 156 | E · [颗粒流体渐变](https://reactbits.dev/backgrounds/grainient) | about | 备选机制；可研究低对比静态颗粒渐变的材质，禁止覆盖截图或创建不断搅动的全屏色场。 | 目录全读；源码未核；无本轮实际演示认证 | 可研究低对比静态颗粒渐变的材质，禁止覆盖截图或创建不断搅动的全屏色场。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 157 | E · [像素雪花](https://reactbits.dev/backgrounds/pixel-snow) | about | 本轮暂不采用；雪花没有功能语义，持续绘制并干扰阅读。 | 目录全读；源码未核；无本轮实际演示认证 | 雪花没有功能语义，持续绘制并干扰阅读。 |
| 158 | E · [银河星群](https://reactbits.dev/backgrounds/galaxy) | about | 本轮暂不采用；星群探索主题与当前照片平台说明不匹配，不能用通用特效填充内容。 | 目录全读；源码未核；无本轮实际演示认证 | 星群探索主题与当前照片平台说明不匹配，不能用通用特效填充内容。 |
| 159 | E · [故障终端](https://reactbits.dev/backgrounds/faulty-terminal) | about、ops | 本轮暂不采用；故障终端会再次形成密集文字并误导为系统异常，不作运营数据展示。 | 目录全读；源码未核；无本轮实际演示认证 | 故障终端会再次形成密集文字并误导为系统异常，不作运营数据展示。 |
| 160 | E · [超速时空](https://reactbits.dev/backgrounds/hyperspeed) | about | 本轮暂不采用；超速轨道增加 three 与眩晕风险，不帮助功能完成。 | 目录全读；源码未核；无本轮实际演示认证 | 超速轨道增加 three 与眩晕风险，不帮助功能完成。 |
| 161 | E · [网格畸变](https://reactbits.dev/backgrounds/grid-distortion) | studio、assets | 本轮暂不采用；网格畸变会被误解为修图变形或损坏，不适合真实照片展示。 | 目录全读；源码未核；无本轮实际演示认证 | 网格畸变会被误解为修图变形或损坏，不适合真实照片展示。 |
| 162 | E · [弹性球池](https://reactbits.dev/backgrounds/ballpit) | about | 本轮暂不采用；物理球池不提供平台信息，模拟成本与用户编辑任务无关。 | 目录全读；源码未核；无本轮实际演示认证 | 物理球池不提供平台信息，模拟成本与用户编辑任务无关。 |
| 163 | E · [发光光晕球](https://reactbits.dev/backgrounds/orb) | ai、about | 本轮暂不采用；发光球不能充当助手已思考/已连接的证据，真实状态用紧凑标签与控件表达。 | 目录全读；源码未核；无本轮实际演示认证 | 发光球不能充当助手已思考/已连接的证据，真实状态用紧凑标签与控件表达。 |
| 164 | E · [字母故障场](https://reactbits.dev/backgrounds/letter-glitch) | about | 本轮暂不采用；字母故障场既增加文字密度又损害中文一致性，缺少业务用途。 | 目录全读；源码未核；无本轮实际演示认证 | 字母故障场既增加文字密度又损害中文一致性，缺少业务用途。 |
| 165 | E · [栅格视差运动](https://reactbits.dev/backgrounds/grid-motion) | about | 备选机制；真实截图组成的矩阵可研究轻微视差，但各图与文字要保持可读、不相互遮挡；手机用静态独立布局。 | 目录全读；源码未核；无本轮实际演示认证 | 真实截图组成的矩阵可研究轻微视差，但各图与文字要保持可读、不相互遮挡；手机用静态独立布局。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 166 | F · [仿真黑色银行卡](https://uiverse.io/Praashoo7/black-lizard-62) | account、usage | 本轮暂不采用；没有银行卡支付链路，不复用卡号/芯片/金融卡片视觉暗示真实付款能力。 | 目录全读；源码未核；无本轮实际演示认证 | 没有银行卡支付链路，不复用卡号/芯片/金融卡片视觉暗示真实付款能力。 |
| 167 | F · [二态滑动开关](https://uiverse.io/bandirevanth/wonderful-dog-56) | shared | 备选机制；二态开关位移可与 136 比较，保留应用实际值、标签、焦点和禁用；不照搬红白配色。 | 目录全读；源码未核；无本轮实际演示认证 | 二态开关位移可与 136 比较，保留应用实际值、标签、焦点和禁用；不照搬红白配色。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 168 | F · [表情反应选择器](https://uiverse.io/Mayurwaghgpr/foolish-liger-76) | collaboration | 本轮暂不采用；未有已核实的表情反应写入契约，不在评论旁添加假点赞/反应菜单。 | 目录全读；源码未核；无本轮实际演示认证 | 未有已核实的表情反应写入契约，不在评论旁添加假点赞/反应菜单。 |
| 169 | F · [键帽立体按钮](https://uiverse.io/chintu_2484/fat-moose-56) | navigation、editor | 候选机制；研究键帽短按深度与细致图标边缘，适合命令/撤销小按钮；手机不照搬厚阴影和桌面键帽尺寸。 | 目录全读；源码未核；无本轮实际演示认证 | 研究键帽短按深度与细致图标边缘，适合命令/撤销小按钮；手机不照搬厚阴影和桌面键帽尺寸。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 170 | F · [圆形数字刻度选择器](https://uiverse.io/Pradeepsaranbishnoi/hungry-bat-66) | editor | 备选机制；圆形刻度可与 123 比较用于角度/色相，须确认原作是否实际可旋转，目录描述不等于实现证据。 | 目录全读；源码未核；无本轮实际演示认证 | 圆形刻度可与 123 比较用于角度/色相，须确认原作是否实际可旋转，目录描述不等于实现证据。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 171 | F · [拟物红色软糖开关](https://uiverse.io/Nawsome/short-dolphin-98) | shared | 备选机制；软胶压缩仅作开关按压研究，与 136/167 选择一套动力学；颜色和巨大高光不照搬。 | 目录全读；源码未核；无本轮实际演示认证 | 软胶压缩仅作开关按压研究，与 136/167 选择一套动力学；颜色和巨大高光不照搬。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 172 | F · [黑色删除图标键](https://uiverse.io/vinodjangid07/smart-emu-83) | assets、documents、editor | 候选机制；统一精细删除 SVG 与按压反馈，用在真实次级删除入口；隐藏/禁用/确认沿用原权限与事务。 | 目录全读；源码未核；无本轮实际演示认证 | 统一精细删除 SVG 与按压反馈，用在真实次级删除入口；隐藏/禁用/确认沿用原权限与事务。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 173 | F · [极简浅色文本输入](https://uiverse.io/Satwinder04/ancient-sloth-30) | auth、documents、ops | 候选机制；研究克制输入边界、焦点和错误态，减少字段层层方框；保留实际 label、校验与清楚的错误归属。 | 目录全读；源码未核；无本轮实际演示认证 | 研究克制输入边界、焦点和错误态，减少字段层层方框；保留实际 label、校验与清楚的错误归属。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 174 | F · [线路站点卡](https://uiverse.io/Novaxlo/splendid-dingo-30) | ai、usage | 备选机制；线路节点可表达实际阶段与时间顺序；没有事件的阶段不补造，不能把它当完整账单时间线。 | 目录全读；源码未核；无本轮实际演示认证 | 线路节点可表达实际阶段与时间顺序；没有事件的阶段不补造，不能把它当完整账单时间线。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 175 | F · [霓虹活动入场券](https://uiverse.io/zeeshan_2112/shy-rattlesnake-3) | account、usage | 本轮暂不采用；没有活动入场券/条码核销业务，霓虹票据会误导真实账户与权益含义。 | 目录全读；源码未核；无本轮实际演示认证 | 没有活动入场券/条码核销业务，霓虹票据会误导真实账户与权益含义。 |
| 176 | F · [软凸单选控件](https://uiverse.io/LilaRest/soft-baboon-75) | shared | 备选机制；单选滑珠位置反馈可作为 122 的低依赖替代；须核实对比度和原生 radio 语义。 | 目录全读；源码未核；无本轮实际演示认证 | 单选滑珠位置反馈可作为 122 的低依赖替代；须核实对比度和原生 radio 语义。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 177 | F · [社交平台圆形按钮](https://uiverse.io/Praashoo7/quick-fish-43) | about、collaboration | 本轮暂不采用；没有已核实的社交发布接口，不用第三方平台品牌按钮暗示可分享；复制真实链接已有明确路径。 | 目录全读；源码未核；无本轮实际演示认证 | 没有已核实的社交发布接口，不用第三方平台品牌按钮暗示可分享；复制真实链接已有明确路径。 |
| 178 | F · [深色状态信息卡](https://uiverse.io/satyamchaudharydev/brown-puma-94) | ai、usage | 备选机制；只研究紧凑状态信息层级，真实状态/时间/主操作从业务读回；不照搬大深色卡片。 | 目录全读；源码未核；无本轮实际演示认证 | 只研究紧凑状态信息层级，真实状态/时间/主操作从业务读回；不照搬大深色卡片。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 179 | F · [黑白极简加载器](https://uiverse.io/alexruix/neat-tiger-82) | shared | 候选机制；研究简单低成本等待图形，与真实 pending 状态绑定；保留文字和减少动态状态，避免全屏假进度。 | 目录全读；源码未核；无本轮实际演示认证 | 研究简单低成本等待图形，与真实 pending 状态绑定；保留文字和减少动态状态，避免全屏假进度。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 180 | F · [仓鼠跑轮动画](https://uiverse.io/Nawsome/wet-mayfly-23) | shared | 本轮暂不采用；仓鼠加载占用空间且风格偏离精细图像工作台，等待应短而清楚。 | 目录全读；源码未核；无本轮实际演示认证 | 仓鼠加载占用空间且风格偏离精细图像工作台，等待应短而清楚。 |
| 181 | F · [隐私与 Cookie 提示卡](https://uiverse.io/ilkhoeri/thin-bobcat-83) | account | 本轮暂不采用；当前任务没有新增 Cookie 同意业务，不因参考卡片添加额外合规弹窗或说明段落。 | 目录全读；源码未核；无本轮实际演示认证 | 当前任务没有新增 Cookie 同意业务，不因参考卡片添加额外合规弹窗或说明段落。 |
| 182 | F · [橙色环形等待动画](https://uiverse.io/cohencoo/dry-rat-94) | shared | 备选机制；低成本圆弧旋转可作为 179 的等待图形替代；使用真实 busy 状态，不同时堆多个加载器。 | 目录全读；源码未核；无本轮实际演示认证 | 低成本圆弧旋转可作为 179 的等待图形替代；使用真实 busy 状态，不同时堆多个加载器。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 183 | F · [文件图标提示气泡](https://uiverse.io/themrsami/quick-zebra-71) | navigation、assets | 备选机制；文件图标提示可参考定位与层级，必须补键盘/触屏；优先复用 129 的统一时序，避免两套 tooltip。 | 目录全读；源码未核；无本轮实际演示认证 | 文件图标提示可参考定位与层级，必须补键盘/触屏；优先复用 129 的统一时序，避免两套 tooltip。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 184 | F · [金属银灰银行卡](https://uiverse.io/mihocsaszilard/rare-fox-73) | account | 本轮暂不采用；金属银行卡材质会暗示不存在的银行/支付服务，且增大账户装饰面积。 | 目录全读；源码未核；无本轮实际演示认证 | 金属银行卡材质会暗示不存在的银行/支付服务，且增大账户装饰面积。 |
| 185 | F · [电子钱包支付卡](https://uiverse.io/byllzz/rude-bat-50) | usage、account | 本轮暂不采用；平台服务点不是电子钱包现金；不使用支付卡语义包装真实额度。 | 目录全读；源码未核；无本轮实际演示认证 | 平台服务点不是电子钱包现金；不使用支付卡语义包装真实额度。 |
| 186 | F · [奇异果鸟行走加载](https://uiverse.io/AatreyuShau/lazy-quail-10) | shared | 本轮暂不采用；小鸟行走纯属趣味加载，无法减少等待成本或说明实际系统过程。 | 目录全读；源码未核；无本轮实际演示认证 | 小鸟行走纯属趣味加载，无法减少等待成本或说明实际系统过程。 |
| 187 | F · [叠层玻璃卡片](https://uiverse.io/codebykay101/ugly-lion-23) | about | 候选机制；研究悬停旋正、逐层舒展和离开收拢的层级联动，装载真实系统截图；所有文字常驻，手机直接展开，不用点击解锁内容。 | 目录全读；源码未核；无本轮实际演示认证 | 研究悬停旋正、逐层舒展和离开收拢的层级联动，装载真实系统截图；所有文字常驻，手机直接展开，不用点击解锁内容。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 188 | F · [物流货车加载](https://uiverse.io/vinodjangid07/popular-owl-27) | import | 本轮暂不采用；货车动画不能表达实际分块上传/处理进度，会增加等待占位；采用真实阶段线和文件状态。 | 目录全读；源码未核；无本轮实际演示认证 | 货车动画不能表达实际分块上传/处理进度，会增加等待占位；采用真实阶段线和文件状态。 |
| 189 | F · [咖啡杯蒸汽加载](https://uiverse.io/esraaabdel-kareem/bad-dragonfly-54) | shared | 本轮暂不采用；咖啡蒸汽缺少系统状态语义且循环占位，本轮不新增趣味等待区。 | 目录全读；源码未核；无本轮实际演示认证 | 咖啡蒸汽缺少系统状态语义且循环占位，本轮不新增趣味等待区。 |
| 190 | F · [简洁灰度信息卡](https://uiverse.io/eslam-hany/selfish-bobcat-73) | account、usage | 备选机制；可借低装饰、留白与对齐，不整页增加卡片；真实余额与安全动作保留主次。 | 目录全读；源码未核；无本轮实际演示认证 | 可借低装饰、留白与对齐，不整页增加卡片；真实余额与安全动作保留主次。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 191 | F · [暖色文件夹提示卡](https://uiverse.io/Cobp/mighty-pig-13) | assets、documents | 备选机制；文件夹提醒的图标层级可参考，提示只在实际空态/需要操作时出现，不增添常驻说明卡。 | 目录全读；源码未核；无本轮实际演示认证 | 文件夹提醒的图标层级可参考，提示只在实际空态/需要操作时出现，不增添常驻说明卡。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 192 | F · [黑白经典拨动开关](https://uiverse.io/Bodyhc/light-lion-39) | shared、account | 候选机制；研究紧凑黑白开关与明确启闭，作为 136 的 CSS 方案候选；需语义、对比和持久化统一。 | 目录全读；源码未核；无本轮实际演示认证 | 研究紧凑黑白开关与明确启闭，作为 136 的 CSS 方案候选；需语义、对比和持久化统一。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 193 | F · [极简浮层说明](https://uiverse.io/ayman-ashine/curvy-starfish-3) | shared | 备选机制；提示层的聚焦/离开时序可比较 129/183，最终只保留统一组件，防止层级冲突。 | 目录全读；源码未核；无本轮实际演示认证 | 提示层的聚焦/离开时序可比较 129/183，最终只保留统一组件，防止层级冲突。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 194 | F · [深色商务名片](https://uiverse.io/Smit-Prajapati/spicy-rat-83) | account | 本轮暂不采用；商务名片不是账户安全/用量流程所需，避免把用户名和简介做成大展示块。 | 目录全读；源码未核；无本轮实际演示认证 | 商务名片不是账户安全/用量流程所需，避免把用户名和简介做成大展示块。 |
| 195 | F · [彩圈循环加载](https://uiverse.io/jeremy_4982/massive-falcon-52) | shared | 本轮暂不采用；多彩循环环增加装饰而不提高状态理解；同一产品统一一套等待反馈即可。 | 目录全读；源码未核；无本轮实际演示认证 | 多彩循环环增加装饰而不提高状态理解；同一产品统一一套等待反馈即可。 |
| 196 | F · [汉堡菜单拨钮](https://uiverse.io/JkHuger/curvy-liger-67) | navigation | 候选机制；精细线条在菜单/关闭间转形并保持焦点，绑定真实抽屉 expanded 状态；触屏按钮尺寸独立。 | 目录全读；源码未核；无本轮实际演示认证 | 精细线条在菜单/关闭间转形并保持焦点，绑定真实抽屉 expanded 状态；触屏按钮尺寸独立。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 197 | F · [文件树导航卡](https://uiverse.io/ashif_6672/nice-warthog-84) | navigation、assets、documents | 候选机制；树形分级和选中指示用于真实空间/项目/文档关系；不凭空新增文件夹层，键盘展开和收起需明确。 | 目录全读；源码未核；无本轮实际演示认证 | 树形分级和选中指示用于真实空间/项目/文档关系；不凭空新增文件夹层，键盘展开和收起需明确。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 198 | F · [双色翻转内容卡](https://uiverse.io/vamsidevendrakumar/soft-shrimp-94) | compare、about | 本轮暂不采用；翻转两面隐藏一半内容，尤其不适合需要同时判断图像差异的对比。 | 目录全读；源码未核；无本轮实际演示认证 | 翻转两面隐藏一半内容，尤其不适合需要同时判断图像差异的对比。 |
| 199 | F · [深色邮件订阅输入栏](https://uiverse.io/vinodjangid07/plastic-parrot-51) | ai | 备选机制；只研究输入与发送按钮合一的紧凑构造，接实际草稿/校验/忙态；不新增邮件订阅功能。 | 目录全读；源码未核；无本轮实际演示认证 | 只研究输入与发送按钮合一的紧凑构造，接实际草稿/校验/忙态；不新增邮件订阅功能。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 200 | F · [昼夜主题开关](https://uiverse.io/Galahhad/strong-squid-82) | brand、account、navigation | 候选机制；研究昼夜状态的细致 SVG 过渡并同步真实主题；现有 light/dark/system 三态须完整保留，不能压成假二态。 | 目录全读；源码未核；无本轮实际演示认证 | 研究昼夜状态的细致 SVG 过渡并同步真实主题；现有 light/dark/system 三态须完整保留，不能压成假二态。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 201 | F · [趣味角色按钮](https://uiverse.io/barisdogansutcu/big-moose-69) | shared | 本轮暂不采用；卡通角色会抢走图像和系统操作的注意力，且不是现有品牌资产。 | 目录全读；源码未核；无本轮实际演示认证 | 卡通角色会抢走图像和系统操作的注意力，且不是现有品牌资产。 |
| 202 | F · [蓝色玻璃设置卡](https://uiverse.io/byllzz/fluffy-hound-44) | editor、native、restoration | 候选机制；研究标签、当前值与轨道在小面积内的组合密度；不照搬蓝色玻璃大卡，桌面/手机分别控制宽度和留白。 | 目录全读；源码未核；无本轮实际演示认证 | 研究标签、当前值与轨道在小面积内的组合密度；不照搬蓝色玻璃大卡，桌面/手机分别控制宽度和留白。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 203 | F · [心率周趋势卡](https://uiverse.io/NK2552003/silly-moth-73) | usage | 备选机制；只借日期高亮和趋势可读性，接真实服务点聚合；不使用心率/BPM 语义，也不补造缺失日期数据。 | 目录全读；源码未核；无本轮实际演示认证 | 只借日期高亮和趋势可读性，接真实服务点聚合；不使用心率/BPM 语义，也不补造缺失日期数据。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 204 | F · [颜色放大选择器](https://uiverse.io/Cobp/horrible-quail-18) | editor、sketch | 候选机制；官方完整 HTML/CSS 与许可已核，确有邻近色块反馈而没有复制 JavaScript；只研究真实选色与键盘等效，复制提示必须来自产品 clipboard 回执。 | 目录全读；完整源码已读；Root 实际演示，有明确未验边界 | 已适配，产品验收待完成 |
| 205 | F · [中性色图形展示卡](https://uiverse.io/Javierrocadev/red-stingray-37) | about、assets | 备选机制；研究低装饰图形层次与轻边缘，不把几何示意当系统截图或真实素材。 | 目录全读；源码未核；无本轮实际演示认证 | 研究低装饰图形层次与轻边缘，不把几何示意当系统截图或真实素材。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 206 | F · [退出登录操作按钮](https://uiverse.io/vinodjangid07/thin-duck-22) | account | 候选机制；精细退出图标与按压反馈绑定真实退出核验，未知结果保留会话核对；不把退出称为注销。 | 目录全读；源码未核；无本轮实际演示认证 | 精细退出图标与按压反馈绑定真实退出核验，未知结果保留会话核对；不把退出称为注销。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 207 | F · [动态发送按钮](https://uiverse.io/adamgiebl/smart-moth-68) | ai、collaboration | 候选机制；发送图标可短促运动但提交锁立即生效，只有真实成功回执进入完成态；模型/权限禁用仍不可发送。 | 目录全读；源码未核；无本轮实际演示认证 | 发送图标可短促运动但提交锁立即生效，只有真实成功回执进入完成态；模型/权限禁用仍不可发送。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 208 | F · [暖色半透明按钮](https://uiverse.io/SmookyDev/sharp-stingray-58) | shared | 备选机制；只研究按压下沉与高光回位，主 CTA 视觉服从品牌；不增加大面积橙红渐变厚按钮。 | 目录全读；源码未核；无本轮实际演示认证 | 只研究按压下沉与高光回位，主 CTA 视觉服从品牌；不增加大面积橙红渐变厚按钮。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |
| 209 | F · [404 错误状态卡](https://uiverse.io/preet_7613/new-cougar-63) | shared | 候选机制；研究简洁错误层级与真实返回/重试入口；当前未知 hash 回 About，不能凭空宣称已有 404 路由。 | 目录全读；源码未核；无本轮实际演示认证 | 研究简洁错误层级与真实返回/重试入口；当前未知 hash 回 About，不能凭空宣称已有 404 路由。 本轮未形成完整源码、实际演示和明确集成三者齐备的采用证据，保留为研究备选。 |

## 组合与取舍

- About 使用 31 + 35；手机独立实拍，全部核心内容直接滚动可读。未采用 21/187 的未经完整源核组合，也不新增点击式功能说明。
- 导航使用 68 + 78 + 85，并由现有 Modal 承担焦点和 Esc；原 Logo 不作为动效材料。
- 参数使用 124 + 127 + 129，选择状态使用 131/136；共同动画时钟只改变展示，配方值仍由既有事务提交。99/123 仅源核，65/66 因每按钮 GPU 成本或不受控滚轮行为未采用。
- AI 使用 114 + 112 + 111/119；实际 SSE、录音与未知回执是状态来源。110 的马赛克假渐进、118 的模拟到 90% 与 125 的错误清码均未采用。
- 表单与反馈使用 120 + 133 + 119/115；不增加异步无法等待的 102 步骤器，不把三态任务压成二元复选。69/80/84/121 未进入业务集成。
- 全站保留真实权限、源身份、候选 hash、租约、CAS、费用和 unknown 恢复；手机视觉更小与独立可触达区域分别检查。

## 许可证与来源

React Bits 固定 `9d9c687dc4f55b23539aa5417b703078047efa74`，许可证是 **MIT + Commons Clause License Condition v1.0**，不是无附加条件的普通 MIT。完整原文见 [react-bits-LICENSE.md](reference-licenses/react-bits-LICENSE.md)。Uiverse 204 的完整单独 MIT 见 [uiverse-204-LICENSE.txt](reference-licenses/uiverse-204-LICENSE.txt)。这些机制用于本应用，不作为独立组件商品分发。

许可原文、源文件 SHA 与真实演示记录可以追溯到具体变体；本轮未新增 Motion/GSAP/Tailwind 运行依赖，没有把演示的模拟数据搬入产品。
