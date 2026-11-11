# React Bits R4：216 项源码连续性复核与产品取舍

本次继续工作先核对已有研究的真实性与可复用范围，再定位到当前前端代码。复核依据为官方仓库提交 `9d9c687dc4f55b23539aa5417b703078047efa74`，与 [R3 逐项研究记录](./reactbits-r3-20261111.json) 一致。**216 个主组件文件的 SHA-256、字节数和目录元数据全部匹配，没有缺失或新增的公开目录条目。**

完整逐项结果见 [R4 机器可读审计](./reactbits-source-audit-r4-20261111.json)。每一项保留组件名、公开路径、主源码路径及哈希、CSS 与 Demo 路径及哈希、适配目标、取舍原因、原有研究范围，以及本次静态源码信号的位置。

本轮另在用户 Edge 浏览器定向操作了 Scroll Expand、Animated Content、Rubber Segment、Voice Pill、Call Chip、Thought Line 与 Refine Frame，具体动作、采用位置和未确认部分见 [R4 浏览器交互补充](./reactbits-browser-r4-20261111.md)。该记录包含 Voice Pill 停止操作超时的限制，不将其记为通过，也不扩大为全部 216 页的第二次手动交互验收。

## 1. 本次确认了什么

| 核对对象                     |                 结果 | 证据范围                                                                       |
| ---------------------------- | -------------------: | ------------------------------------------------------------------------------ |
| 主组件 SHA-256               |       216 / 216 一致 | 与 R3 存档逐项比较                                                             |
| 主组件字节数                 |       216 / 216 一致 | 与 R3 存档逐项比较                                                             |
| 名称、标题、分类、路由、描述 |       216 / 216 一致 | 静态解析官方 `Categories.js` 与 `Information.js`，重建 `catalog.js` 的路径映射 |
| CSS                          | 202 个存在并登记哈希 | R3 没有 CSS 哈希，因此这里只能称为新登记                                       |
| Demo                         | 216 个存在并登记哈希 | R3 没有 Demo 哈希，因此这里只能称为新登记                                      |
| 公开目录 / 全部元数据        |            216 / 218 | `Backgrounds/EvilEye`、`Micro/FlyingButton` 仍只在元数据中，不计入公开目录     |

| 公开分类        | 数量 |
| --------------- | ---: |
| Text Animations |   33 |
| Animations      |   38 |
| Components      |   48 |
| Micro           |   34 |
| Backgrounds     |   63 |

可复跑命令：

```sh
node scripts/qa/audit-reactbits-reference.mjs /path/to/react-bits-reference docs/design/reactbits-source-audit-r4-20261111.json
```

[审计脚本](../../scripts/qa/audit-reactbits-reference.mjs) 只读取参考仓库，使用 TypeScript AST 解析静态目录，不执行上游 JavaScript，也不启动浏览器。提交、文件哈希、字节数、名称、目录集合或分类数量不一致时，结果会失败并列出差异。CSS / Demo 文件不存在也会直接失败。

这次源码复核没有增加“216 个页面又全部实际操作过”的声明。R3 的浏览器动作和局限仍按原记录保留；其未确认的拖动、GPU 空白、仅默认预览等结果没有改写为成功。静态出现 `getContext('2d')` 也不等于组件的主体是轻量 2D 引擎：它可能只是 GPU 组件的颜色或蒙版探针。

## 2. 216 项取舍的含义

| 决定                     | 数量 | 本项目的含义                                                                           |
| ------------------------ | ---: | -------------------------------------------------------------------------------------- |
| `adapt`                  |   31 | 交互语义或布局方式直接适合现有任务，按下面的产品位置调整；不是导入 31 个原始组件的承诺 |
| `reference-only`         |   55 | 只参考局部构图、进场、衰减或状态反馈；需要独立验证价值，不能把候选当成已完成           |
| `reject`                 |   56 | 对目标位置会增加遮挡、误解、不可预测操作或无关装饰，不放入该产品流程                   |
| `reject-direct-renderer` |   61 | 不直接带入背景渲染器；部分静态线条或低频配色仍可独立表达                               |
| `reject-for-core-ui`     |   13 | 文字效果不用于精修参数、导航、真实 AI 输出、金额或错误信息                             |

上表沿用 R3 的逐项判断，并通过相同的源码快照确认研究没有漂移。完整 216 行的目标和理由都在 JSON 中，没有把未采用的组件藏起来，也没有将所有效果统一说成“可用”。

## 3. 31 项高匹配参考与当前代码位置

以下“代码位置”指能够核对或继续适配该原则的现有产品位置。来源组件与项目组件并非一一导入关系；原生控件更适合的地方保持原生语义。标为候选的效果，不计作已实现。各上游组件的精确源码、哈希和静态信号见同名 JSON 行。

| 参考组件                                                              | 源码中可核对的交互                                    | 当前产品位置与取舍                                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Animated Content](https://reactbits.dev/animations/animated-content) | `stagger`、`blur` 与 reduced motion 分开处理          | [ScrollReveal](../../apps/web/src/about/effects/ScrollReveal.tsx) 已按文字/媒体分层，短距离、有限模糊与封顶延迟；图片和精确值不被模糊。                                                                                                           |
| [Fade Content](https://reactbits.dev/animations/fade-content)         | 分段 opacity / blur 和独立 stagger                    | 同一 About reveal 系统可取逐层收束；不添加大面积 SVG 噪声蒙版。                                                                                                                                                                                   |
| [Gradual Blur](https://reactbits.dev/animations/gradual-blur)         | 容器测量、ResizeObserver 与边缘渐变                   | 边缘处理候选。[ToolDock](../../apps/web/src/workspace/ToolDock.tsx) 已有真实左右溢出状态，可用于提示可滚动；并不声称当前已经引入多层 blur。                                                                                                       |
| [Animated List](https://reactbits.dev/components/animated-list)       | listbox / option、可见性观察和顺序延迟                | [ChoiceSelect](../../apps/web/src/components/ChoiceSelect.tsx) 与 [ResearchGraph](../../apps/web/src/ai/ResearchGraph.tsx) 是模型选择和真实步骤的落点；状态先更新、动画后表现，列表刷新不应重新制造阅读等待。                                     |
| [Card Nav](https://reactbits.dev/components/card-nav)                 | 有界展开、`aria-expanded`、Escape 和测量              | [AboutPage](../../apps/web/src/about/AboutPage.tsx) 的紧凑导航；入口较少时只取分组和关闭方式，不增加无用三栏。                                                                                                                                    |
| [Carousel](https://reactbits.dev/components/carousel)                 | 默认 `autoplay=false`、索引回调、键盘与可见性暂停     | About 手机能力展示应以同一个索引驱动图片、标题与注释；手动选择和阅读停留优先。此项不要求新建自动轮播。                                                                                                                                            |
| [Counter](https://reactbits.dev/components/counter)                   | 受控真实数值、Intl 格式与位数 stagger                 | [UsageNumber](../../apps/web/src/usage/UsageNumber.tsx) 只揭示真实数字，保留完整可访问文本，不经过虚构金额。                                                                                                                                      |
| [Dock](https://reactbits.dev/components/dock)                         | toolbar、键盘方向/Home/End、嵌套菜单两级退出          | [ToolDock](../../apps/web/src/workspace/ToolDock.tsx) 与 [PanelNavigation](../../apps/web/src/workspace/PanelNavigation.tsx)；触屏命中位置稳定，返回层级独立于关闭整个面板。                                                                      |
| [Glass Surface](https://reactbits.dev/components/glass-surface)       | 表面渲染与尺寸/可见性管理                             | 只取 [About 导航 CSS](../../apps/web/src/about/about.css) 的浅色半透明小表面；不导入折射引擎，不影响真实照片颜色。                                                                                                                                |
| [Masonry](https://reactbits.dev/components/masonry)                   | 按容器重排、自然比例、list / listitem                 | [WorksView](../../apps/web/src/components/WorkspaceViews.tsx) 与 [AssetLibrary](../../apps/web/src/components/AssetLibrary.tsx) 用真实作品尺寸和加载占位。当前选择、筛选和扫描效率优先，不以瀑布流样式替代数据状态。                              |
| [Pill Nav](https://reactbits.dev/components/pill-nav)                 | 当前路由 `aria-current`、展开与关闭                   | [WorkspaceNavigation](../../apps/web/src/workspace/WorkspaceNavigation.tsx) 与 About 导航；选中项必须等于当前业务视图，简繁英按实际标签布局。                                                                                                     |
| [Scroll Expand](https://reactbits.dev/animations/scroll-expand)       | `scrollDistance` 与 `holdDistance` 分离               | About 的滚动功能章节；阅读停留与切换分段，使用自然页面滚动，左右内容共用活动步骤。                                                                                                                                                                |
| [Stepper](https://reactbits.dev/components/stepper)                   | `currentStep`、回调、`aria-current=step`              | [AuthPanel](../../apps/web/src/components/AuthPanel.tsx) 的注册步骤和真实 Agent 进度。回退保留用户输入，不以动画推进假任务。                                                                                                                      |
| [Squish Switch](https://reactbits.dev/micro/squish-switch)            | 受控 checked、switch 语义、键盘、reduced motion       | [LocalControls](../../apps/web/src/editor/LocalControls.tsx) / [LayerControls](../../apps/web/src/editor/LayerControls.tsx) 的开关。优先保留真实 checkbox/switch 状态；弹性形变只是可选装饰。                                                     |
| [Spring Check](https://reactbits.dev/micro/spring-check)              | checked 即时提交与装饰弹簧分开                        | 作品或局部分组的勾选，按当前原生复选框结构处理；标签和点击区不随勾选动画位移。                                                                                                                                                                    |
| [Rubber Segment](https://reactbits.dev/micro/rubber-segment)          | 受控选择、方向/Home/End、装饰滑块                     | [PanelNavigation](../../apps/web/src/workspace/PanelNavigation.tsx) 已把选择与背景滑动分开；本轮 [AdvancedInspector](../../apps/web/src/editor/AdvancedInspector.tsx) 进一步保留各工具的真实子状态。                                              |
| [Warm Tooltip](https://reactbits.dev/micro/warm-tooltip)              | focus、blur、Escape、`aria-describedby` 和触控区分    | 图标说明的候选参考。现有 [IconButton](../../apps/web/src/components/Ui.tsx) 的可访问标签不是完整 Warm Tooltip 实现；长文改为按需帮助时仍让手机能够主动打开。                                                                                      |
| [Scrub Field](https://reactbits.dev/micro/scrub-field)                | `onChange` / `onCommit`、spinbutton、粗细步长、Escape | [PrecisionRange](../../apps/web/src/editor/PrecisionRange.tsx) 的直接输入和手势生命周期；预览立即更新、完成时提交历史，不用动画时长决定保存。                                                                                                     |
| [Lattice Loader](https://reactbits.dev/micro/lattice-loader)          | 真实 status / elapsed 与局部占位                      | 只作为局部请求形态候选；[FeatureSkeleton](../../apps/web/src/components/DeferredFeature.tsx) 和 [UsageSkeleton](../../apps/web/src/usage/UsageSkeleton.tsx) 继续按实际页面结构加载，不能被统一小图标替代。                                        |
| [Code Slots](https://reactbits.dev/micro/code-slots)                  | 单一 numeric input、`one-time-code` 与可访问计数      | [AuthPanel](../../apps/web/src/components/AuthPanel.tsx) 已保留单一验证码输入、粘贴与系统自动填充；不拆成六个独立焦点。                                                                                                                           |
| [Wake Slider](https://reactbits.dev/micro/wake-slider)                | 数值 onChange、滑杆 aria、方向键与端点、指针捕获      | [PrecisionRange](../../apps/web/src/editor/PrecisionRange.tsx) 的即时数值与独立装饰；About 试玩还必须同步所有真实参数，不让弹性尾迹改变图像值。                                                                                                   |
| [Jelly Radio](https://reactbits.dev/micro/jelly-radio)                | 受控 value、radio / radiogroup、键盘与减少动态        | 质量、格式和模型单选的位置候选；按现有 [OptionChips](../../apps/web/src/components/Controls.tsx) / ChoiceSelect 的业务语义选择，不为了形变增加第三套设置面板。                                                                                    |
| [Glide Select](https://reactbits.dev/micro/glide-select)              | combobox / listbox、活动项与已选项、Escape/Tab        | [ChoiceSelect](../../apps/web/src/components/ChoiceSelect.tsx) 的紧凑选择器；模型能力详情在同一编辑上下文按需进入，并保留返回与焦点。                                                                                                             |
| [Status Mark](https://reactbits.dev/micro/status-mark)                | 外部 status 驱动稳定标签                              | 云状态、保存状态及 [CollaborationStatus](../../apps/web/src/collaboration/CollaborationStatus.tsx)；不播放与服务状态无关的成功循环。                                                                                                              |
| [Call Chip](https://reactbits.dev/micro/call-chip)                    | 工具名、状态、耗时、仅 error 时的 Retry               | [AIThread](../../apps/web/src/ai/AIThread.tsx) 与 [ResearchGraph](../../apps/web/src/ai/ResearchGraph.tsx) 展示真实调用事件；详情收起后仍保留必要状态。                                                                                           |
| [Swipe Toast](https://reactbits.dev/micro/swipe-toast)                | `role=status`、关闭、Escape 与有条件撤销              | [Toast](../../apps/web/src/components/Ui.tsx) 和可关闭云状态提示。重要失败仍保留可重新打开的状态入口，不以自动消失掩盖未知结算。                                                                                                                  |
| [Prompt Bar](https://reactbits.dev/micro/prompt-bar)                  | 草稿、模型/参数、空输入禁发、onSend / onStop          | [AIThread](../../apps/web/src/ai/AIThread.tsx)、[ModelChoice](../../apps/web/src/ai/ModelChoice.tsx) 和 [ImageParameters](../../apps/web/src/ai/ImageParameters.tsx)；参数来源按模型能力目录，保留正在编辑的作品。                                |
| [Voice Pill](https://reactbits.dev/micro/voice-pill)                  | mic / simulated 明确区分、取消与禁用生命周期          | [LiveAssistant](../../apps/web/src/ai/LiveAssistant.tsx) 与 [VoiceCapture](../../apps/web/src/components/VoiceCapture.tsx) 使用真实媒体状态；演示波形不能成为录音或通话成功证据。                                                                 |
| [Thought Line](https://reactbits.dev/micro/thought-line)              | 外部 working / elapsed、状态读出                      | Agent 的执行摘要及已完成步骤；只表达真实事件与耗时，不生成虚假的思考、节点或进度。                                                                                                                                                                |
| [Refine Frame](https://reactbits.dev/micro/refine-frame)              | 比例容器、明确 error、Retry 与状态提示                | [WorkspaceCards](../../apps/web/src/ai/WorkspaceCards.tsx) 中实际结果/预览；失败不丢失布局，空结果不替换成装饰照片。                                                                                                                              |
| [Branched Menu](https://reactbits.dev/micro/branched-menu)            | 组展开、叶项 current 与固定组标题                     | [AdvancedInspector](../../apps/web/src/editor/AdvancedInspector.tsx)、[LocalControls](../../apps/web/src/editor/LocalControls.tsx) 和 [MotionDetails](../../apps/web/src/motion/Presence.tsx)。折叠和返回是不同动作，返回不能靠关闭全部工具完成。 |

## 4. 另外 185 项为什么没有全部直接搬入

逐项理由已经保留在审计 JSON；以下是需要避免的错误对应关系，而不是泛泛地认为“动画都太重”。

- **对比不是轮播。** Morph Slider 的目标是轮播，因此不拿来实现前后对比；实际照片也不能套 Ripple Distortion、Pixel Transition 或 Decay Card 改变像素判断。About 的弯曲分割线采用独立的 [ElasticCompare](../../apps/web/src/about/ElasticCompare.tsx)，参考来源仍按 R3 记录区分。
- **真实图谱不是流光背景。** Laser Flow、Meta Balls、Strands 的动画不能证明 Agent 调用或音频输入。图谱由后端事件、节点标识、状态和时间产生；失败、等待、无数据要可见。
- **用量不是装饰液位。** Slosh Gauge 不承担计费分析。Counter / Count Up 只帮助数字的呈现；真实趋势、余额、期间消耗和流水分别由用量模型与图表计算，不能把流水合计称作余额。
- **精修需要稳定命中。** Dodge Field、Sling Button、Blob Cursor、Swarm Cursor、Splash Cursor 不用于真实工具或发送操作。Magnet、Target Cursor 的局部反馈可以只出现在 About 的有界区域，保留系统指针。
- **文字需要先可读。** Falling Text、Decrypted Text、Glitch Text、Fuzzy Text、Particle Text 等不承担模型名、错误、金额或长正文。Blur Text、Scroll Reveal、Split Text 等仅参考有限的分组进入，中文不能机械照搬英文逐字符动画。
- **图片需承担信息。** Drift Wall、Infinite Spiral、Orbit Images、Card Swap 等不能掩盖素材重复或功能解释缺失。固定的真实系统截图、专属功能图、局部标注和用户作品才构成内容。
- **背景按区域预算。** Grid Motion 与 Shape Grid 仍是 `reference-only`，不是默认全站背景。其他 61 个背景不直接引入渲染器；静态构图若有价值，可以在不依赖持续 GPU 更新的情况下独立表达。

## 5. 本轮编辑器落地与参考原则的关系

本轮具体修复的是状态连续性和操作密度，不是给工具名称加一个过场就算完成：

1. `AdvancedInspector` 只创建用户访问过的工具 owner，并通过 React Activity 保留相应子分类、选中参数、折叠帮助和未提交字段。切回美颜、HSL、曲线或局部工具不会自动回到默认项。隐藏 owner 不参与布局或焦点，并暂停其效果；源图变更依然由既有 `sourceIdentity` key 统一清理。
2. 曲线的上下文重置只在图片、作用范围或通道实际改变时发生。抠图设置和隐藏期间完成的结果/失败也只在同一图片恢复；新图片不会接收旧结果。
3. HSL / 色谱 / 局部分组的长说明收进默认关闭的帮助。当前局部、当前分组和数量保留为短读数，用户自定义名称不被翻译或替换。
4. 局部、涂抹和图层重命名支持 Enter 提交、Escape 还原、空值还原、中文输入法保护；撤销或外部名称变化会刷新输入，工具切换不会重建相同名称下的未提交草稿。
5. [workspace-v4.browser.mjs](../../scripts/qa/workspace-v4.browser.mjs) 增加 390×844 与 1440×960 的“工具返回后状态保留、隐藏 owner 不可见、换图清空”回归。脚本定义本身不代表浏览器已经通过；实际执行结果需由本轮验收另行登记。
6. 真实浏览器检查发现 344px 面板中的英文 `Collaborate` 被拆开。本轮改为可见短标 `Team`，保留完整可访问名称，并取消导航标签的强制任意断词。窄工具面板的参数标签调整为 11px 和平衡换行，按钮的命中面积保持原值。

上述修复保持 recipe、提交、撤销和服务接口的既有边界。本轮不改变后端协议或计算方法。上游许可快照及哈希随审计登记；具体复制/改写的模块继续保留仓库已有的来源与许可文件，不把素材和演示数据当作产品资产。
