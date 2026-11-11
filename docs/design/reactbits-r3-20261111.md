# React Bits：实际交互、源码与 AI-xiutu 适配清单

研究日期：2026-11-11。本文记录参考研究，不把建议当成已发布的产品功能。完整的 **216 项逐项映射**、实际动作、未验证结果、源码路径、代码哈希与静态技术索引见 [reactbits-r3-20261111.json](./reactbits-r3-20261111.json)。

## 1. 覆盖范围与证据边界

公开站点 [React Bits](https://www.reactbits.dev/get-started/index) 的实际目录 DOM 与官方源码目录对照后，得到 216 个唯一公开条目：Text Animations 33、Animations 38、Components 48、Micro 34、Backgrounds 63。源码元数据有 218 项，其中 EvilEye、FlyingButton 没有出现在此次公开目录，未加入 216 项分母。

两位研究者合计逐一打开了 **216 个独立详情页**：研究代理负责 Components、Micro、Backgrounds、Animations 共 183 项，主代理负责 Text Animations 的 33 项，且另外复核了 Animated Content。不是只看首页或卡片缩略图。以下数字表示访问和操作的范围，不能读成“216 个效果全部成功运行”或“每个状态全部测试过”。主代理的 Text 原始记录来自 `artifacts/root-text-reference-r3.json`，已合并进完整 JSON；每项 `browserEvidence` 保留操作者、动作、可见结果和未确认内容。

| 类别 | 独立详情 | 有组件交互尝试 | 参数控件操作 | 预览阅读 | 未验证或错误 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Text Animations | 33 | 8 | 7 | 15 | 3 |
| Components | 48 | 22 | 0 | 17 | 9 |
| Micro | 34 | 27 | 0 | 6 | 1 个明确降级 |
| Backgrounds | 63 | 2 | 55 | 0 | 6 |
| Animations | 38 | 10 | 24 | 0 | 4 |

“交互尝试”包括明确记录失败或结果未确认的动作。例如 Card Swap 的拖动没有取得完成截图；Scroll Stack 的滚动没有看到清晰进展；Tear Ticket 的撕裂完成态未确认；Swipe Toast 点击 Undo 后只捕捉到退出阶段。JSON 没有把这些动作记成成功完成。

此浏览器中，一批 GPU 演示的主图为空。Flex Carousel 的实际控制台报错明确包含无法创建 WebGL context、renderer 为 null；Paper Crumple 显示了“交互不可用、展示原图”的降级提示。其他空白预览只记录空白，不将它们一概认定为同一种错误，更不说网站屏蔽了访问。能改变数值或点击 Refresh，只证明参数控件工作，不证明 shader 画面或每个动画阶段已被看见。Text 的 15 个默认预览项没有被包装成完整的 hover、键盘、预设测试。

本轮没有录制真实语音、请求摄像头、发送 Agent 请求、订阅提醒、支付、删除用户内容。Voice Pill 默认使用 Simulated 信号，Thought Line、Call Chip、Status Mark 都是受控的组件演示；它们只能为真实业务状态提供外观与交互方式。

## 2. 最适合此次问题的具体参考

### 2.1 工作台、模型设置与流程

| 参考 | 实际观察 | AI-xiutu 适配位置与约束 |
| --- | --- | --- |
| [Glide Select](https://www.reactbits.dev/micro/glide-select) | 打开五项格式列表，选择 WebP，再打开，值与选中指示一致 | 模型/格式选择使用紧凑列表。名称、提供方、必要能力为主；已选模型的参数在同一面板的下一级显示。保留键盘、上下翻转定位、Escape、关闭还焦点。 |
| [Animated List](https://www.reactbits.dev/components/animated-list) | ArrowDown 两次到第二项，End 到第十五项；滚动位置 560，最后一项可见 | 模型列表、任务步骤与工具总览。顺序稳定，错峰延迟封顶；切一个数值不重播整列。 |
| [Rubber Segment](https://www.reactbits.dev/micro/rubber-segment) | Month 点击后，ArrowRight 选中 Year；DOM 的 checked 状态明确 | 精修面板内 AI/协作/精度切换和用量周期。逻辑选择立即改变，滑块仅装饰；面板状态保留，不变成整页跳转。 |
| [Dock](https://www.reactbits.dev/components/dock) | Photos 普通/右键交互、Options 子菜单、Escape 两级退出 | 底部工具栏。桌面微幅邻近响应；手机保持稳定宽度与至少 44px 的触区。二级工具总要有上一级返回，不靠全部关闭重进。 |
| [Stepper](https://www.reactbits.dev/components/stepper) | Welcome → Plan → Back → Welcome，步骤指示和正文同步 | 注册流程、导出流程、真实 Agent 执行轨迹。正文与 currentStep 同源；可退回的步骤明确显示 Back。 |
| [Prompt Bar](https://www.reactbits.dev/micro/prompt-bar) | 选 Nova Mini 后输入演示文字；空输入 Send 禁用，输入后启用；没有发送 | AI 输入、模型与参数在编辑上下文内。核心操作可见，详细参数逐级进入，保留返回。 |
| [Scrub Field](https://www.reactbits.dev/micro/scrub-field) | ArrowUp 使 24 → 25；点击后仍为 spinbutton，直接输入未实测 | 精修数值：即时 onChange 与松手后的 onCommit 分开；直接输入、粗细步长、重置、最小/最大边界都要成立。 |
| [Wake Slider](https://www.reactbits.dev/micro/wake-slider) | ArrowRight 使 50 → 51 | 滑杆数值和图像预览立即响应；弯曲尾迹独立于实际值，不能让参数“跟着弹簧慢慢到位”。 |
| [Warm Tooltip](https://www.reactbits.dev/micro/warm-tooltip) | Tab 聚焦 Italic，出现 Italic⌘I 提示 | 去掉高频界面的说明长文，改为必要的键盘/悬停帮助；移动端不能依赖 hover。 |
| [Branched Menu](https://www.reactbits.dev/micro/branched-menu) | 折叠第一组后，第二组保持原位；aria-expanded 变 false | 工具分类可折叠，但折叠不等于“返回”。子工具仍需独立返回按钮和路径。 |
| [Code Slots](https://www.reactbits.dev/micro/code-slots) | 一个输入框填入演示 123456，六格与计数同步 | 独立验证码页。保留单一可访问输入，避免六个焦点造成粘贴、删除和手机自动填充障碍。 |
| [Swipe Row](https://www.reactbits.dev/micro/swipe-row) | 左拖 135px 出现 Archive/Delete；“2 actions”按钮当次未显露菜单 | 可参考手机快捷操作；必须另有一直可找到的“更多”按钮，不能只依靠隐藏拖动。 |

### 2.2 真实任务、加载与错误

| 参考 | 实际观察 | 适配方式 |
| --- | --- | --- |
| [Refine Frame](https://www.reactbits.dev/micro/refine-frame) | 切 Error 后媒体框大小保留，出现 Failed 与 Retry | 生成结果/编辑预览保持比例和位置。重试只作用于失败任务；没有结果时使用真实空状态。 |
| [Call Chip](https://www.reactbits.dev/micro/call-chip) | Error 保留工具名、命令与耗时，增加 Retry | 工具调用用短摘要和真实状态；参数/详细日志按需展开，避免占满精修面板。 |
| [Thought Line](https://www.reactbits.dev/micro/thought-line) | 关闭循环和 Working 后，轨迹收束为 Thought for 7.1s | 用于受控执行摘要和已完成步骤。不能用演示中的假步骤冒充真实工作图谱。 |
| [Status Mark](https://www.reactbits.dev/micro/status-mark) | 停止循环，切 Failed，标签不位移 | 保存、云同步、Agent 步骤的统一语义，外观变化不挤动主体。 |
| [Voice Pill](https://www.reactbits.dev/micro/voice-pill) | Simulated 下 Dictate 展开波形/计时，Escape 恢复 | 真实语音状态机应区分录音、转录、结果、失败和取消，不能把视觉波形当成功录音。 |
| [Swipe Toast](https://www.reactbits.dev/micro/swipe-toast) | 自动消失、重新显示、Undo 的退出阶段 | 云不可用等提示可关闭、有清楚动作，不持续遮挡画布；重要失败不能只用自动消失 toast。 |
| [Lattice Loader](https://www.reactbits.dev/micro/lattice-loader) | Orbit → Ripple，小状态格占位稳定 | 只用于局部请求。作品、对比、用量、设置各自需要与最终结构一致的骨架，不能整页都用同一个小圈。 |
| [Counter](https://www.reactbits.dev/components/counter) | 切 Dashboard，看到四种格式化数值和滚动字形 | 可优化用量关键数字，但 React Bits 免费目录并没有一个可直接照搬的完整用量图表。图表必须由真实时间序列、坐标、hover/touch 读数构成。 |

## 3. About：借什么、舍弃什么

实际看到了 [Scroll Expand](https://www.reactbits.dev/animations/scroll-expand) 的完整主要变化：在预览内部滚动约 0.7 页，窄的圆角人物照片扩为整幅预览，起始标题变为正文标题与说明。这是“自然滚动驱动内容和画面一起变化”的明确参考。源码把 `scrollDistance` 和 `holdDistance` 分开，默认分别为 1.2 与 0.35；AI-xiutu 应让每个功能拥有阅读停留段，再进入下一功能，不能滚一点就切完几张图。

[Animated Content](https://www.reactbits.dev/animations/animated-content) 的实测包括三卡错峰进入和参数控制；主代理另实测 Blur preset、Refresh、Code。该预设 distance 40px、duration 1s、stagger 0.08、blur 12px 对当前产品偏重。建议 About 采用更克制的约 14px 位移、6px 初始模糊、55ms 组内延迟，且总延迟封顶。每段由自身可见状态触发，标题、解释、媒体、标注分层进入；这不是把整站所有元素套一条无限重播动画。

[Fade Content](https://www.reactbits.dev/animations/fade-content) 的 Mist 实际从模糊文本/图像碎片变成清晰图文。可以借层次和收束顺序；不必照搬其 SVG 噪声遮罩。模糊只能出现在过渡的宣传层，不能让真实精修图片看起来不清楚。

[Gradual Blur](https://www.reactbits.dev/animations/gradual-blur) 的图库内部滚动时，顶部和底部固定，照片从窄范围渐进模糊后经过导航。这适合有滚动内容的边缘和浅色浮层。需要自动识别内容末端并退去遮罩，不能永远挡住最后一项。

[Magnet](https://www.reactbits.dev/animations/magnet) 在指针靠近按钮外缘时，实际变换矩阵包含约 -10.28px、-0.77px 位移和轻微倾斜，文字仍清楚。产品若借用，只给 About 的一处主 CTA 做 2–3px 的有界响应；精修工具必须保持稳定命中位置。源码已经区分触摸、reduced motion 和最近的独占目标，不应丢掉这些条件只抄视觉。

[Target Cursor](https://www.reactbits.dev/animations/target-cursor) 的四个白色角框实际吸附到 Play 按钮，跟随圆角，旁边显示短标签。可以参考“标注热点回应指针”的方式，但不能将全站光标替换成准星，更不能给每个工具加一个额外追踪框。

[Image Trail](https://www.reactbits.dev/animations/image-trail) 的实际拖动产生四张不同照片，前面的图片更小、更透明，最后一张更大、更清楚。它只适合独立、短暂的灵感互动；功能解释仍要用有意义的不同素材。不能借循环轨迹继续反复使用同两张图。

### 文字动画：完整目录与实际状态

Text Animations 的 33 页均实际打开并查看截图。最有针对性的结果如下；其他默认预览、Refresh 动作和未确认状态逐项留在 JSON，并为全部 33 项写了独立适配位置或舍弃原因。

| 参考 | 已确认的实际状态 | 当前适配取舍 |
| --- | --- | --- |
| [Variable Proximity](https://www.reactbits.dev/text-animations/variable-proximity) | 指针移到首词，Hov 附近字形局部变粗 | 可借 About 小字标的轻指针响应；固定字宽或充分留空间，触控保持稳定字重。 |
| [Blur Text](https://www.reactbits.dev/text-animations/blur-text) | 开启 Focus On Hover、Refresh、查看 Code；读取到近结束阶段 blur 0.087px、opacity 0.991 | 取短标题的分组渐显，初始帧没有完整捕捉；中文按语义或行分组，延迟封顶。 |
| [Scroll Float](https://www.reactbits.dev/text-animations/scroll-float) | 在真实内预览滚动 850px 后看到组字；早期 330px 没触发 | 可借章节短标题的小距离进入，不能让长段正文逐字漂浮。 |
| [Scroll Reveal](https://www.reactbits.dev/text-animations/scroll-reveal) | 在真实内预览滚动 800px 后，完整段落亮起 | 可借短说明逐组进入，正文应尽早达到完整对比度并留下阅读窗口。 |
| [Count Up](https://www.reactbits.dev/text-animations/count-up) | To 从 100 改为 120.25，Refresh 后看到 120.25；Code 页签的 usage 随后重置为 100 | 用量数字以真实最终值为准；不把演示计数当作真实增长，不声称代码导出保留了新值。 |
| [Falling Text](https://www.reactbits.dev/text-animations/falling-text) | 悬停句子后，单词实际掉落并旋转 | 当前产品不采用。鼠标划过就破坏文本位置，与清楚说明和精确操作相冲突。 |
| [Decrypted Text](https://www.reactbits.dev/text-animations/decrypted-text) | 实际看见乱字符逐渐恢复成文本 | 不用于 AI 输出、错误、模型名和主要正文，避免暂时隐藏语义。 |
| [Shuffle](https://www.reactbits.dev/text-animations/shuffle) / [Text Cursor](https://www.reactbits.dev/text-animations/text-cursor) | Shuffle 首次空白，复访后看见字形；Text Cursor 移动指针后截图仍未捕获尾迹 | 保留复访过程，不把空白算成功，也不把已经移动鼠标当作已看见尾迹。 |

### FAQ 与前后对比不是同一类组件

[Accordion Gallery](https://www.reactbits.dev/components/accordion-gallery) 是外框固定、内部图片面板横向伸缩的相册，不是 FAQ 的合理直接来源。FAQ 应保持题目、容器、列宽不变，只展开答案。主文阅读宽度与下方内容的空间策略需要产品独立设计，不能用相册的 flex-grow 把整块 FAQ 撑宽。

用户描述的“弯曲分割线、加速时的小粒子”更贴近公开的 [Aceternity Compare Slider](https://ui.aceternity.com/interactions/compare-slider)，不是免费 React Bits 的 Morph Slider，也不是 Aceternity 的基础 Compare。主代理实际完成键盘 50 → 55、拖动到 73，并看到弯曲边界和上下彩色运动细线。公开控件包括 Bend 18、Drift 10、Motion Blur 6、Aberration 3、Dots On、Density 4。其 Code 受 All Access 保护，没有读取。产品采用独立实现的有界弹簧边界与少量粒子；真实图像像素保持清楚，不能把装饰性 motion blur 加到照片本体上。

## 4. 背景与性能：可用的依据

背景 63 项都打开了各自详情；55 项实际改变或尝试改变公开参数，Shape Grid 与 Grid Motion 另做了明确可见的指针交互。其余主图的空白是已记录的验证限制，不能因为源码存在就声称“已经体验过”。

| 参考 | 已核源码与实际效果 | 当前取舍 |
| --- | --- | --- |
| [Shape Grid](https://www.reactbits.dev/backgrounds/shape-grid) | 实际拖动出现窄幅斜向亮格轨迹；主引擎 Canvas2D；DPR 默认封顶 2、8MP 限额、离屏暂停、静止停帧、reduced motion | 可借单区域稀疏响应。建议 cellSize 48、speed 0、glow 0、clickCascade false、较低 DPR，始终留在 About 空白区域。 |
| [Grid Motion](https://www.reactbits.dev/backgrounds/grid-motion) | 图片行与局部聚光实际响应；DOM/CSS transform；4 行默认、900ms 入场、各行不同惯性、离屏停帧 | 只取低幅视差。原实现复制循环图片且可视时持续 RAF，不能直接带入；需唯一图片、speed 0 和静止停止更新。 |
| [Dot Grid](https://www.reactbits.dev/backgrounds/dot-grid) | 当前源码主引擎明确 `getContext('webgl2')`；失败直接返回；现场主图空白 | 不依据旧教程把它当成轻量 2D 点阵直接复制。 |
| Shape Waves / Aero Shards | 源码出现 Canvas2D，但用于 mask 或颜色探针；主体导入 `vgpu` | 静态搜索命中 Canvas2D 不等于没有 GPU 依赖。 |
| Gradual Blur | DOM 的多层 backdrop-filter / mask | 只在小边缘使用；避免多个大面积 backdrop blur 叠加。 |

取舍的依据是产品任务：作品颜色、细节和精确编辑优先于装饰。全站持续液体、烟雾、800 粒子光标、巨大黏液指针、三维挂绳不应为了“用满组件库”而出现。可学习它们的衰减、边界和状态分离，而不是复制 GPU 数量与高饱和光效。

## 5. 源码与许可

官方来源：[DavidHDev/react-bits](https://github.com/DavidHDev/react-bits)，检出提交 `9d9c687dc4f55b23539aa5417b703078047efa74`。本地参考目录：`/workspace/scratch/708b88080b1c/react-bits-reference-r3`。组件优先对应 `src/ts-default/<Category>/<Name>/<Name>.tsx`；演示对应 `src/demo/<Category>/<Name>Demo.jsx`。JSON 为全部条目记录精确文件路径与 SHA-256，已校正 ASCIIText 目录大小写。

对 Glide Select、Grid Motion 阅读了主组件全文；另对约二十个高匹配组件阅读了参数、状态、动画时序、键盘或生命周期片段。主代理还查看了 Blur Text、Animated Content 的 Code 与实现，并读取 Count Up 主文件前 180 行。其他组件完成源码路径、依赖和渲染信号索引，**没有宣称每个源码文件都逐行审完**。`sourceEvidence.scope` 区分全文与部分阅读，`sourceScan` 明确是静态索引。

许可为 MIT 加 Commons Clause。产品/网站集成需保留相应版权和许可，不能把组件本体包装成另一个独立收费组件包/库。演示图片、肖像、交易卡等并不因组件代码公开就自动成为 AI-xiutu 的宣传资产；本项目用独立生成/自有素材，真实界面截图只承担必要的产品证据。

## 6. 落地验收关注点

1. **状态而非装饰驱动内容。** 模型选择、工具类别、FAQ、Agent 步骤与对应正文使用同一个受控值；不能左侧高亮、右侧照片、下方滑杆各自变化。
2. **编辑上下文持续存在。** 面板内切换 AI、协作、精度不离开当前作品；子级面板有返回；云状态通知可关闭，失败任务可重试。
3. **数值即时、装饰延迟。** 滑杆/数值输入立即更新真实值；弹簧、尾迹、字形变化只表现这个状态，不决定数值提交时机。
4. **尺寸按内容与设备单独控制。** 导航、模型列表、工具栏、FAQ、图表各有自己的尺寸策略；简体、繁体、英语使用实际长文本检查，不以强制省略隐藏错误。
5. **不把视觉空白当完成。** 懒加载必须有结构骨架，数据为空有可操作空状态，图形失败有替代内容，reduced motion 和触控下仍能完成操作。
6. **实现证据另行核对。** 此文的 31 项 adapt 是研究优先级；最终哪些进入产品，必须与实际 diff、运行状态和产品 QA 对应，不能凭清单声称全部完成。
