
1. **全量学习，按需取用，不准敷衍。** 从文档第 1 条到第 209 条均视为有效的设计/交互研究样本。接到前端开发任务后，应先浏览整份目录、按照任务需要建立“**页面/模块 → 候选序号 → 交互目的 → 采用/舍弃理由**”映射；不得只挑熟悉的几个组件，或声称已经参考而实际上未研究。**全量阅读参考库不等于必须把 209 个组件全部安装、全部渲染。**
2. **先复刻行为，再风格化融合。** 不能照搬原站的品牌色、字体、背景、文案、配图和卡片尺寸；必须与正在开发项目的设计 token、版式网格、品牌标识、浅/深主题、信息层级、移动端与无障碍约束一致。与此同时，原组件的**核心交互机制**——触发条件、指针/触控跟随、缓动曲线、速度与惯性、弹簧阻尼、层级、微反馈、过渡衔接、退出与回位——应尽量高保真迁移。允许实现方式变化，**不允许只做一张看似相似的静态皮肤**。
3. **先见证据，再写代码。** 对拟采用组件逐一：打开真实演示并操作默认态、悬停、点击、拖拽、长按、移入移出、反向滚动、键盘、触屏、加载/完成/错误等**该组件实际具有的**状态；查看真实 TSX/JSX/CSS/HTML/Shader 源码及必要的 demo 配置，抽取依赖、Props、资源和 API。页面打不开时可查官方仓库源文件、发行版本或官方原作品代码入口；**不能据名称编造不存在的交互**。
4. **完整迁移，不做假按钮。** 新组件必须使用当前项目真实路由与业务状态，读写真实的功能接口；表单有校验与反馈，导航可达，媒体可播放/暂停，参数能持久化，禁用态不能触发操作。演示用模拟数据与生产真实功能必须明确区分，未实现的能力不能用视觉动效冒充。
5. **依赖最小化且版本可控。** `React` 表示所在项目已安装 React/ReactDOM；此文件中的 React Bits 依赖对应 **TypeScript + Tailwind** 版本。列出的包只对实际采用的条目按需安装，先检查项目已有版本、锁文件、Peer Dependencies、SSR 和构建兼容性；未列额外包不代表不需要字体、静态素材、WebGL 或浏览器 API。`motion` 是现代 Motion 包（通常从 `motion/react` 导入），不要未经核对误装成旧 `framer-motion`。
6. **不牺牲可用性。** 悬停特效在触屏提供点击/拖动/聚焦等效路径；兼顾 `prefers-reduced-motion`、键盘焦点、语义标签、输入法、明暗主题、窄屏、低功耗/低端 GPU、重复挂载和事件清理。控制首屏负载、帧率、资源缓存及多个动画组件相互影响；Canvas/WebGL 应提供合理降级。
7. **许可证与证据留痕。** React Bits 官方采用 **MIT + Commons Clause**，允许在应用/网站中使用，但不允许将其组件本身作为可再分发组件库转售、转授权或打包分发；在复制或改动源码时保留适用的版权与许可文本。Uiverse 页面标示的许可和第三方图片/字体/图标权利应分别确认。每个最终采用组件都要留存**原始序号/网址、读过的源文件、实际安装依赖、改造说明、验收状态及相关证据**。

## 统一依赖口径

**React Bits**：每条的“依赖”均按官方 `TS + Tailwind` 组件源码标注。`React + Tailwind CSS` 是该实现方案的统一基础；后列的 `gsap`、`motion`、`ogl`、`three`、`@hugeicons/react` 等是按需添加的具体 npm 包。若只用原生 CSS 版/JavaScript 版，**须改查对应变体**，不能假设依赖完全相同。
**Uiverse**：大多数是**HTML + CSS**，少数页面使用 **HTML + Tailwind CSS**；只要使用原生 HTML/CSS，**不必因为本文件而另装 React 动效包**。若把它们封装成 React 组件，React 属于项目环境而不是原始作品的额外依赖。第三方图标、字体、图片或 JS 要以原作品代码为准。
**关于描述**：下面两行描述依次给出**视觉基调、典型触发方式、主要反馈与可借鉴的细节**。示例图片颜色、文本与具体倍率不是必须照搬的参数；对于未实际读取完整源码的 Uiverse 作品，不得把描述中的观察/设计方向当成已确认的源代码事实。

## 组件目录与逐条说明


### A. React Bits · 文字动画（1–27）

1、[https://reactbits.dev/text-animations/tech-text](https://reactbits.dev/text-animations/tech-text)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；科技感交互文字。大号粗体字母可切换为工程虚线轮廓，伴随粒子、标尺与定位框等视觉线索；指针接近、点击和拖拽时呈现拆解、回弹等反馈，具体模式由组件参数决定。

2、[https://reactbits.dev/text-animations/text-loop](https://reactbits.dev/text-animations/text-loop)
依赖：React、Tailwind CSS（TSX 版本）、gsap；循环曲线文字。高对比粗体文字沿波浪、圆环或∞形等轨迹连续滚动，形成流动丝带；可配置方向、速度、交叉层和悬停暂停，拖拽时呈现惯性式位移。

3、[https://reactbits.dev/text-animations/masked-heading](https://reactbits.dev/text-animations/masked-heading)
依赖：React、Tailwind CSS（TSX 版本）、gsap；遮罩揭示标题。大幅标题笔画作为图片或动态纹理的裁切窗口，底层色彩随视口和指针变化；文字逐词出现，适合章节标题与品牌主张强调。

4、[https://reactbits.dev/text-animations/particle-text](https://reactbits.dev/text-animations/particle-text)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；粒子组字。散点从随机位置聚拢形成可辨识字形，随后扩散、漂浮或重新组合；悬停时可观察粒子轨迹与边缘散落效果，背景宜保持克制。

5、[https://reactbits.dev/text-animations/split-flap-text](https://reactbits.dev/text-animations/split-flap-text)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；翻页字牌。字母像机场时刻牌的机械叶片逐格翻转，字符切换存在短暂的错位和层叠；适合数值、状态、短词轮换，不宜用于长段正文。

6、[https://reactbits.dev/text-animations/warp-text](https://reactbits.dev/text-animations/warp-text)
依赖：React、Tailwind CSS（TSX 版本）、ogl；需要 WebGL 环境；空间扭曲文字。WebGL 纹理中的标题随指针或动画发生波纹、拉伸和透视变形；移开后逐步恢复，注意小屏触控替代及低性能设备降级。

7、[https://reactbits.dev/text-animations/stroke-text](https://reactbits.dev/text-animations/stroke-text)
依赖：React、Tailwind CSS（TSX 版本）、gsap；描边生长文字。大号文字先显示细线笔画，再沿字形路径显现描边、填充或光泽；适合滚动入场和聚焦标题，可调动画速度与描边宽度。

8、[https://reactbits.dev/text-animations/depth-text](https://reactbits.dev/text-animations/depth-text)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；景深立体文字。字形叠加投影与前后深度层，指针移动时产生视差和阴影角度变化；悬停强调浮起、位移或层间错动，营造立体压印感。

9、[https://reactbits.dev/text-animations/fold-text](https://reactbits.dev/text-animations/fold-text)
依赖：React、Tailwind CSS（TSX 版本）、gsap；折纸翻折文字。单字或词组像纸片沿水平/垂直折线翻开，依次露出正面；转场带有透视与阴影递变，适合短标题和状态变化。

10、[https://reactbits.dev/text-animations/echo-text](https://reactbits.dev/text-animations/echo-text)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；回声残影文字。文字运动时在后方留下透明度逐渐降低的多层文字轮廓，最终重叠归位；速度与间距决定拖尾强度，适合短促强调。

11、[https://reactbits.dev/text-animations/split-text](https://reactbits.dev/text-animations/split-text)
依赖：React、Tailwind CSS（TSX 版本）、gsap、@gsap/react；分割入场文字。逐字、逐词或逐行切分为独立动画单元，从位移、旋转或透明状态错峰进入；常用于首屏标题，须保留可读的无动画状态。

12、[https://reactbits.dev/text-animations/blur-text](https://reactbits.dev/text-animations/blur-text)
依赖：React、Tailwind CSS（TSX 版本）、motion；模糊清晰文字。文字由柔焦与低透明度逐段变为锐利清晰，支持按字或按词延迟揭示；适合说明文案的轻量滚动进入。

13、[https://reactbits.dev/text-animations/circular-text](https://reactbits.dev/text-animations/circular-text)
依赖：React、Tailwind CSS（TSX 版本）、motion；环形排版文字。字符沿圆周均匀排布并持续自转，悬停可改变转速或方向；适合圆形品牌徽章、提示环与局部装饰。

14、[https://reactbits.dev/text-animations/text-type](https://reactbits.dev/text-animations/text-type)
依赖：React、Tailwind CSS（TSX 版本）、gsap；打字机文字。文本逐字符出现和删除，尾部光标周期闪烁；可设置多条语句、停顿、回删和循环，适合动态角色介绍与搜索提示。

15、[https://reactbits.dev/text-animations/text-pressure](https://reactbits.dev/text-animations/text-pressure)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；需准备支持可变字体轴的字体文件；压感变形文字。采用可变字体轴随鼠标距离调整字重、宽度或斜度，局部字符像受到压力般伸缩；需具备相应 variable font 文件。

16、[https://reactbits.dev/text-animations/curved-loop](https://reactbits.dev/text-animations/curved-loop)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；弧线循环字幕。长串文字沿可调曲线连续滑行，形成拱形/波纹式跑马灯；指针拖拽改变文字在曲线上的位置，移开后按设定速度续动。

17、[https://reactbits.dev/text-animations/fuzzy-text](https://reactbits.dev/text-animations/fuzzy-text)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；毛刺抖动文字。字符边缘呈轻微颗粒毛糙与随机像素偏移，悬停时干扰可增强；适合故障提示和实验性标题，不宜滥用。

18、[https://reactbits.dev/text-animations/gradient-text](https://reactbits.dev/text-animations/gradient-text)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；动态渐变文字。字形内部流转多色渐变与柔和高光，文字外轮廓保持清楚；可调渐变角度、色阶、动画周期及悬停反馈。

19、[https://reactbits.dev/text-animations/text-cursor](https://reactbits.dev/text-animations/text-cursor)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；跟随指针字符。移动鼠标时在路径上依次留下文字、符号或表情，尾迹按寿命淡出并清理；适合互动彩蛋，必须限制层数和触控行为。

20、[https://reactbits.dev/text-animations/true-focus](https://reactbits.dev/text-animations/true-focus)
依赖：React、Tailwind CSS（TSX 版本）、motion；焦点切换文字。多个短词轮流成为清晰焦点，其他词维持柔焦、淡化或外围景深；通过细小的边框与聚焦移动实现节奏化阅读。

21、[https://reactbits.dev/text-animations/scroll-float](https://reactbits.dev/text-animations/scroll-float)
依赖：React、Tailwind CSS（TSX 版本）、gsap；滚动上浮文字。标题在进入视口时随滚动进度升起、平移、显露与微幅旋转；可配置触发阈值与相对滚动距离，避免破坏文本布局。

22、[https://reactbits.dev/text-animations/scroll-reveal](https://reactbits.dev/text-animations/scroll-reveal)
依赖：React、Tailwind CSS（TSX 版本）、gsap；滚动揭示段落。正文由模糊、裁切或低对比状态随滚动逐行变清晰，形成逐句阅读节奏；大段文本需优先保证可读性。

23、[https://reactbits.dev/text-animations/ascii-text](https://reactbits.dev/text-animations/ascii-text)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；ASCII 字幕特效。字形被字符点阵与噪声网格组成，表现屏幕扫描、粗颗粒或旋转错动；悬停可改变字符分布，注意字体与 Canvas 性能。

24、[https://reactbits.dev/text-animations/rotating-text](https://reactbits.dev/text-animations/rotating-text)
依赖：React、Tailwind CSS（TSX 版本）、motion；轮播单词标题。多条短词在同一个位置交替翻页、滑入或旋转，前后词高度保持稳定；支持停留时间与循环次数调整。

25、[https://reactbits.dev/text-animations/scroll-velocity](https://reactbits.dev/text-animations/scroll-velocity)
依赖：React、Tailwind CSS（TSX 版本）、motion；滚动速度跑马字。宽幅连续文字根据页面滚动方向改变行进方向与速度，快速滚动带出更明显的位移；停下时平滑减速而非跳变。

26、[https://reactbits.dev/text-animations/variable-proximity](https://reactbits.dev/text-animations/variable-proximity)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；需准备可变字体文件；近距可变字体。指针越接近某个字符，该字符的字重、宽度或形状变化越明显，周围字符平滑过渡；适合大字号品牌交互。

27、[https://reactbits.dev/text-animations/count-up](https://reactbits.dev/text-animations/count-up)
依赖：React、Tailwind CSS（TSX 版本）、motion；数字递增计数。数字从起始值平滑滚动到目标值，支持小数、分组和前后缀显示；进入视口或目标值改变时启动，避免无意义重复动画。


### B. React Bits · 基础动效（28–56）

28、[https://reactbits.dev/animations/crystalized-ball](https://reactbits.dev/animations/crystalized-ball)
依赖：React、Tailwind CSS（TSX 版本）、ogl；需要 WebGL 环境；水晶能量球。半透明球体内部呈晶面、折射与光粒流动，外沿闪烁细小电弧；指针移动使反射与能量轨迹偏转，强调空间材质感。

29、[https://reactbits.dev/animations/electric-logo](https://reactbits.dev/animations/electric-logo)
依赖：React、Tailwind CSS（TSX 版本）、ogl；需要标志素材与 WebGL 环境；电流标志。徽标外轮廓被细亮电流沿边追踪，局部出现跳跃火花和短时过曝；适合作为加载、发布或品牌强调，不应替换正式 Logo 本体。

30、[https://reactbits.dev/animations/glow-cursor](https://reactbits.dev/animations/glow-cursor)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；辉光指针。鼠标后方跟随柔和光团或烟雾状尾迹，移动时拉长、停止时收敛；可控制半径、颜色与衰减，不遮挡按钮点击。

31、[https://reactbits.dev/animations/scroll-expand](https://reactbits.dev/animations/scroll-expand)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；滚动扩展媒体。画面初始收在圆角卡片里，滚动推进时扩大到宽屏或满幅，标题与图像产生层次运动；反向滚动平顺收回。

32、[https://reactbits.dev/animations/elastic-mesh](https://reactbits.dev/animations/elastic-mesh)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；弹性网格。柔软的细线格栅受到指针挤压后局部鼓起、牵连邻线并回弹；像橡皮膜一样保有张力，可用于 Hero 背景。

33、[https://reactbits.dev/animations/pixel-swap](https://reactbits.dev/animations/pixel-swap)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；像素切换。图像被方块像素短暂拆分与重新排列，实现两种画面/状态切换；触发时伴随方格的错峰波动和恢复。

34、[https://reactbits.dev/animations/cursor-grid](https://reactbits.dev/animations/cursor-grid)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；指针网格。整齐的小格或节点随鼠标位置点亮、偏移并形成波纹；点击可产生短暂的扩散脉冲，作为低对比动态底纹。

35、[https://reactbits.dev/animations/animated-content](https://reactbits.dev/animations/animated-content)
依赖：React、Tailwind CSS（TSX 版本）、gsap；内容入场。卡片或文本在滚动进入视区时做上浮、淡入、透视倾斜或错峰显现；可配置延迟、方向和离场行为，须允许一次性触发。

36、[https://reactbits.dev/animations/fade-content](https://reactbits.dev/animations/fade-content)
依赖：React、Tailwind CSS（TSX 版本）、gsap；柔化显现。图文由模糊、透明、灰雾或轻粒子遮罩中渐显；触发范围通常随滚动决定，适合作为低刺激信息入场。

37、[https://reactbits.dev/animations/electric-border](https://reactbits.dev/animations/electric-border)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；电流边框。元素四周沿细线持续游走带色电弧，局部随指针接近增强辉光；适合单个强调状态，避免批量常亮造成噪声。

38、[https://reactbits.dev/animations/orbit-images](https://reactbits.dev/animations/orbit-images)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；轨道环绕图片。多张图沿圆形或空间曲线路径匀速绕转，前后位置由层级和缩放表达；可点击选中、改变公转速度。

39、[https://reactbits.dev/animations/pixel-transition](https://reactbits.dev/animations/pixel-transition)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；像素溶解转场。旧内容化为小方块逐批退场，新内容在同一位置重新像素化拼装；适合标签页、步骤结果和卡片替换。

40、[https://reactbits.dev/animations/glare-hover](https://reactbits.dev/animations/glare-hover)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；镜面高光悬停。卡片表面产生随鼠标移动的反射斜光、明暗坡度与玻璃折射线索；离开后高光缓慢滑回并淡去。

41、[https://reactbits.dev/animations/logo-loop](https://reactbits.dev/animations/logo-loop)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；循环徽标带。品牌图标或合作方标识水平无缝流动，鼠标悬停可减速或暂停；支持变速、间距、渐隐边缘与多行布局。

42、[https://reactbits.dev/animations/target-cursor](https://reactbits.dev/animations/target-cursor)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；目标追踪光标。四角定位框或准星自动贴附到指定可交互元素，进入、离开时平滑放大缩小；保持原生焦点与点击行为。

43、[https://reactbits.dev/animations/laser-flow](https://reactbits.dev/animations/laser-flow)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；激光流束。高亮流线沿画面穿过并在物体边缘产生发光折射与涟漪，颜色和流向可调；适合重点区域短时点亮。

44、[https://reactbits.dev/animations/gradual-blur](https://reactbits.dev/animations/gradual-blur)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；渐进模糊遮罩。容器上缘或下缘由清晰逐渐过渡到高斯柔焦，形成平滑景深遮挡；滚动、菜单展开时可调整模糊范围。

45、[https://reactbits.dev/animations/click-spark](https://reactbits.dev/animations/click-spark)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；点击火花。点击坐标处瞬时射出细线与小星点，外扩后透明消失；颜色、数量和衰减可调，不阻断事件冒泡。

46、[https://reactbits.dev/animations/strands](https://reactbits.dev/animations/strands)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；光纤细丝。数束半透明发光丝带在空间中交织飘移，受到指针的微弱牵引；整体呈柔软、纵深和慢节奏流动。

47、[https://reactbits.dev/animations/sticker-peel](https://reactbits.dev/animations/sticker-peel)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；撕角贴纸。贴纸的一角随指针悬停翘起并显示底层阴影，按住拖动可增加剥离程度；放手回弹或完成翻揭。

48、[https://reactbits.dev/animations/noise](https://reactbits.dev/animations/noise)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；静态纹理噪声。画面叠加极细颗粒、胶片噪点或低对比扫描感，可保持静止或缓慢重采样；主要是材质增强而非强交互。

49、[https://reactbits.dev/animations/shape-blur](https://reactbits.dev/animations/shape-blur)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；形变模糊。图形受移动方向影响产生伸缩、羽化与光学模糊，指针离开后逐渐回到锐利轮廓；适用于装饰性图案。

50、[https://reactbits.dev/animations/crosshair](https://reactbits.dev/animations/crosshair)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；十字定位光标。交叉准星随指针精确定位，经过特定区域时可吸附、显示坐标或标记；适合画布操作氛围，但不能代替真实编辑控件。

51、[https://reactbits.dev/animations/image-trail](https://reactbits.dev/animations/image-trail)
依赖：React、Tailwind CSS（TSX 版本）、gsap；影像拖尾。移动指针时多张缩略图沿路径依次冒出并错层重叠，停止后按顺序缩小、淡出；适合图库探索。

52、[https://reactbits.dev/animations/ribbons](https://reactbits.dev/animations/ribbons)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；弹性丝带。彩色柔软带状线追随指针旋转、摆动与拉伸，快速滑过时拖出长尾，停止后以阻尼方式收束。

53、[https://reactbits.dev/animations/splash-cursor](https://reactbits.dev/animations/splash-cursor)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；液体泼墨光标。指针轨迹呈墨水/液滴漩涡，点击时向四周溅开并逐渐融合；适用于少量装饰，不应遮盖关键控件。

54、[https://reactbits.dev/animations/meta-balls](https://reactbits.dev/animations/meta-balls)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；融并液球。不同半径的半透明液态球相互靠近时边缘融接，分开时拉丝再断裂；鼠标可推散、吸引或改变流向。

55、[https://reactbits.dev/animations/blob-cursor](https://reactbits.dev/animations/blob-cursor)
依赖：React、Tailwind CSS（TSX 版本）、three；流体光标球。圆润高亮光团随指针追随、拉长并震颤，外缘呈折射与柔软凝胶质感；快速移动出现拖尾与延迟回弹。

56、[https://reactbits.dev/animations/star-border](https://reactbits.dev/animations/star-border)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；星光边框。圆角容器边缘有细小光点沿路径循环移动，局部形成星芒闪烁；悬停可增强亮度，适合克制的重点按钮。


### C. React Bits · UI 组件（57–103）

57、[https://reactbits.dev/components/holo-card](https://reactbits.dev/components/holo-card)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；全息反光卡片。卡面覆有细碎镭射光谱、斜向虹彩与高光涂层，鼠标移动时材质反射和视差随倾角变化；适合会员卡、作品封面。

58、[https://reactbits.dev/components/circular-carousel](https://reactbits.dev/components/circular-carousel)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；环形轮播画廊。卡片围绕圆环或空间轴排列，前景放大、两侧逐层缩小，拖拽会让卡片带惯性转动并吸附到焦点。

59、[https://reactbits.dev/components/flex-carousel](https://reactbits.dev/components/flex-carousel)
依赖：React、Tailwind CSS（TSX 版本）、ogl；柔性横向画廊。多张媒体卡连续排布，滚动与拖拽时发生玻璃样的边缘伸缩、挤压和柔和转场；可设置停靠方式与卡片间距。

60、[https://reactbits.dev/components/infinite-spiral](https://reactbits.dev/components/infinite-spiral)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；无限螺旋陈列。图片沿透视螺旋轨道围绕中心向纵深排布，滚动或拖拽改变螺旋相位；远近尺寸与遮挡构成深度感。

61、[https://reactbits.dev/components/depth-carousel](https://reactbits.dev/components/depth-carousel)
依赖：React、Tailwind CSS（TSX 版本）、gsap；景深式轮播。前景主卡清晰突出，后方卡片通过缩放、虚化、偏移层叠排布；点击或滑动时重新计算主次与动画顺序。

62、[https://reactbits.dev/components/morph-slider](https://reactbits.dev/components/morph-slider)
依赖：React、Tailwind CSS（TSX 版本）、ogl、gsap；液态形变滑块。前后图片在同一视觉容器内通过 WebGL 位移与折叠式溶解过渡；切换时纹理似橡胶被拉伸，结束后恢复平面。

63、[https://reactbits.dev/components/drift-wall](https://reactbits.dev/components/drift-wall)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；漂流图片墙。规则或不规则图片矩阵在视野中持续横移与漫游，指针悬停会放慢、抬起或突出单张作品；适合图库浏览。

64、[https://reactbits.dev/components/accordion-gallery](https://reactbits.dev/components/accordion-gallery)
依赖：React、Tailwind CSS（TSX 版本）、gsap；手风琴图片组。并排窄卡被悬停或键盘聚焦时横向展开，其他卡顺势压缩；标题、编号和图像视差同步调整。

65、[https://reactbits.dev/components/specular-button](https://reactbits.dev/components/specular-button)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；镜面精密按钮。圆角按键带层叠高光、细微倒角和金属/玻璃质感，随指针位置改变镜面反射；按压时有明显的深度反馈。

66、[https://reactbits.dev/components/option-wheel](https://reactbits.dev/components/option-wheel)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；滚轮选项器。选项沿圆弧或纵向轮盘排布，滚动、拖动或方向键使选中项转向中心；非选中项渐小渐淡，支持离散吸附。

67、[https://reactbits.dev/components/curved-input](https://reactbits.dev/components/curved-input)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；弧线输入框。输入框沿弯曲路径构建视觉基线，字符与光标跟随曲率排布；聚焦时轨迹强调、辅助按钮响应，需检查输入法兼容。

68、[https://reactbits.dev/components/line-sidebar](https://reactbits.dev/components/line-sidebar)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；线型侧边栏。极简细线和文本组成导航，鼠标经过时某一项获得流动指示线、横向位移或颜色强调；选中状态持续保留。

69、[https://reactbits.dev/components/animated-list](https://reactbits.dev/components/animated-list)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；动效列表。多条消息或任务纵向排列，新增项带位移渐入、删除时相邻项柔顺补位；键盘选择与当前高亮行保持同步。

70、[https://reactbits.dev/components/scroll-stack](https://reactbits.dev/components/scroll-stack)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；滚动叠卡。连续卡片随着页面滚动停靠在同一顶部锚点，后续卡片一层层压住前者；背景、阴影与缩放营造纸牌堆叠感。

71、[https://reactbits.dev/components/bubble-menu](https://reactbits.dev/components/bubble-menu)
依赖：React、Tailwind CSS（TSX 版本）、gsap；气泡弹出菜单。主按钮悬浮于内容之上，点击后分裂/扩张为一圈或多枚菜单项，子项以弹簧节奏错峰出现；收起时反向汇聚。

72、[https://reactbits.dev/components/magic-bento](https://reactbits.dev/components/magic-bento)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；魔法 Bento 栅格。不同尺寸的卡片形成不对称拼贴，指针在卡片范围内触发局部辉光、边线追踪和轻微上浮；适合功能矩阵。

73、[https://reactbits.dev/components/circular-gallery](https://reactbits.dev/components/circular-gallery)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；曲面媒体画廊。图像排成可拖动的弧形轨道，横向移动时卡片随空间曲率旋转；点击选中或放大查看，注意触控滚动冲突。

74、[https://reactbits.dev/components/reflective-card](https://reactbits.dev/components/reflective-card)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；反射质感卡。卡面具有镜面/磨砂叠层和随视角变化的投影，高光在指针追踪下倾斜扫过；内容保持清晰易读。

75、[https://reactbits.dev/components/card-nav](https://reactbits.dev/components/card-nav)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；卡片式导航。顶部主导航展开后呈现若干带标题和简介的内容卡，卡片错峰滑入、折叠收回；适合大型网站分区入口。

76、[https://reactbits.dev/components/stack](https://reactbits.dev/components/stack)
依赖：React、Tailwind CSS（TSX 版本）、motion；可甩动卡组。多张卡层叠在一起，拖拽最上方卡片可改变角度、将其甩开并露出下一张；松手根据位移回弹或完成切换。

77、[https://reactbits.dev/components/fluid-glass](https://reactbits.dev/components/fluid-glass)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；流体玻璃层。半透明面板折射后方元素，边缘形成明显曲面镜片与光谱高光；指针移动会改变玻璃形状或视差。

78、[https://reactbits.dev/components/pill-nav](https://reactbits.dev/components/pill-nav)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；药丸导航栏。水平圆角标签按序排列，当前项的胶囊背景沿轨迹滑动，悬停时文字滚动或小圆点弹跳；切换保持连贯。

79、[https://reactbits.dev/components/tilted-card](https://reactbits.dev/components/tilted-card)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；倾斜交互卡。卡片随指针位置在 X/Y 轴微旋转，搭配动态眩光和偏移阴影；离开时以缓动回正，聚焦时提供等效反馈。

80、[https://reactbits.dev/components/masonry](https://reactbits.dev/components/masonry)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；瀑布流排版。高低不同的卡片按列自然填充，加载与重排时使用柔和位置过渡；单图点击可进入放大查看，移动端可降列。

81、[https://reactbits.dev/components/glass-surface](https://reactbits.dev/components/glass-surface)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；镜片玻璃面板。容器具备磨砂、透亮折射和内阴影，边缘可出现液态高光；适合承载少量内容，需保证背景下的文字对比。

82、[https://reactbits.dev/components/dome-gallery](https://reactbits.dev/components/dome-gallery)
依赖：React、Tailwind CSS（TSX 版本）、@use-gesture/react；需提供图像素材；穹顶图像展厅。媒体分布在球面/半球幕上，拖拽或滚轮带动整个图像幕旋转，视线靠近正中时图片更大更清晰。

83、[https://reactbits.dev/components/chroma-grid](https://reactbits.dev/components/chroma-grid)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；彩度响应网格。照片默认低饱和或覆柔色蒙层，指针划过时局部恢复鲜艳颜色并聚焦；可用作探索式作品展示。

84、[https://reactbits.dev/components/folder](https://reactbits.dev/components/folder)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；文件夹翻盖。像实体文件夹的扁平图形带有封面、分页和阴影，悬停时封页上翻，内部标签/文件片浮出；点击进入对应内容。

85、[https://reactbits.dev/components/staggered-menu](https://reactbits.dev/components/staggered-menu)
依赖：React、Tailwind CSS（TSX 版本）、gsap；错峰侧滑菜单。点击导航后，深色或高对比菜单层从边缘滑入，内部条目依次错峰出现；关闭时逐层退场，需管理焦点。

86、[https://reactbits.dev/components/lanyard](https://reactbits.dev/components/lanyard)
依赖：React、Tailwind CSS（TSX 版本）、three；需提供胸牌图像/素材文件；悬挂胸牌。具有吊绳、卡片和阻尼摆动的实体物理质感，按住卡片可拖甩并继续摆动；点击卡面可展示背面信息。

87、[https://reactbits.dev/components/profile-card](https://reactbits.dev/components/profile-card)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；全息个人卡。头像、昵称和个人信息放在半透明彩色卡面上，指针倾斜时出现虹彩格纹、立体浮层与高光，强化身份展示。

88、[https://reactbits.dev/components/dock](https://reactbits.dev/components/dock)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；图标 Dock 栏。底部一排图标在鼠标接近时局部放大、邻项按距离递减变形；点击有弹性按压与当前激活提示，触屏需替代悬停。

89、[https://reactbits.dev/components/gooey-nav](https://reactbits.dev/components/gooey-nav)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；黏性导航。激活项底部的液态圆点/胶囊在切换标签时沿路径拉伸，带粘连尾巴和回缩；其他导航保持稳定且可键盘操作。

90、[https://reactbits.dev/components/pixel-card](https://reactbits.dev/components/pixel-card)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；像素填充卡。卡片悬停时大量方格从触发位置向外点亮、扩散或翻转，露出标题与图标；结束后像素逐格熄灭。

91、[https://reactbits.dev/components/carousel](https://reactbits.dev/components/carousel)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；经典卡片轮播。带前后箭头、指示器或手势拖动的图片卡按序轮换；切换可设置缩放、交叠、淡入与自动播放。

92、[https://reactbits.dev/components/spotlight-card](https://reactbits.dev/components/spotlight-card)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；聚光灯卡片。柔和的径向光斑精准跟随鼠标在卡面滑动，边线与内容在光斑附近略微增亮；离开后高光平缓隐去。

93、[https://reactbits.dev/components/border-glow](https://reactbits.dev/components/border-glow)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；流光描边卡。只有边框区域沿光标方向亮起彩色光带，角落呈现圆滑扩散和强弱变化；适合信息卡而非铺满整页。

94、[https://reactbits.dev/components/flying-posters](https://reactbits.dev/components/flying-posters)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；飞行海报。竖向大型图像在空间中错层穿梭，滚动、拖拽时海报像贴片一样转向、前后穿插；适合活动作品集。

95、[https://reactbits.dev/components/card-swap](https://reactbits.dev/components/card-swap)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；三维换位卡。多张卡片按照固定深度与偏转角度层叠，时间或点击触发队列换位；前卡移向后方、后卡旋至最前，连续循环。

96、[https://reactbits.dev/components/glass-icons](https://reactbits.dev/components/glass-icons)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；玻璃图标方块。图标置于半透明圆角镜片内，背景被轻微折射；悬停时镜片亮度、阴影或图标高度发生小幅弹跳。

97、[https://reactbits.dev/components/decay-card](https://reactbits.dev/components/decay-card)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；侵蚀溶解卡。图片卡片在指针经过时局部出现碎裂、颗粒剥蚀或液态拉扯，移开后逐步补齐原图；需控制重绘成本。

98、[https://reactbits.dev/components/flowing-menu](https://reactbits.dev/components/flowing-menu)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；流动整行菜单。大字号纵向菜单被每行铺满，指针经过时该行出现连续横移的图像/文字带，其他行降低对比；离开时流带收拢。

99、[https://reactbits.dev/components/elastic-slider](https://reactbits.dev/components/elastic-slider)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；弹性拖动滑杆。圆形把手拖动时轨道与光标发生橡胶式拉伸，松手会略微越过目标后回弹；实时显示数值并支持键盘输入。

100、[https://reactbits.dev/components/counter](https://reactbits.dev/components/counter)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；逐位翻滚计数器。数字不是整体替换，而是各位数像里程表滚轮般分别上下翻动；可用于金额、数量、年度等实时数值。

101、[https://reactbits.dev/components/infinite-menu](https://reactbits.dev/components/infinite-menu)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；球形无限菜单。媒体缩略图分布在可拖动的球体表面，旋转时前景项扩大、背面项远离；居中卡片可被点击选中。

102、[https://reactbits.dev/components/stepper](https://reactbits.dev/components/stepper)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；流程步骤器。几个步骤通过细线或节点连接，当前步骤的高亮背景沿轨迹滑动；完成步骤呈现勾选、进行中和异常状态。

103、[https://reactbits.dev/components/bounce-cards](https://reactbits.dev/components/bounce-cards)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；弹跳卡片群。多张图片卡以扇形错落排列，悬停某卡时它弹起或微旋转，周围卡轻微避让；离开后回归原先构图。


### D. React Bits · 微交互（104–136）

104、[https://reactbits.dev/micro/shredder](https://reactbits.dev/micro/shredder)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；文件碎纸机。待删除的条目像纸条送入狭窄槽口，被切成多根细丝并逐渐消失；适合可撤销删除确认后的视觉反馈。

105、[https://reactbits.dev/micro/paper-crumple](https://reactbits.dev/micro/paper-crumple)
依赖：React、Tailwind CSS（TSX 版本）、three；纸张揉皱。平整卡片或图像在持续按压/拖拽中发生多面体折皱、阴影加深和缩小；释放后根据状态恢复或落入废纸堆。

106、[https://reactbits.dev/micro/tear-ticket](https://reactbits.dev/micro/tear-ticket)
依赖：React、Tailwind CSS（TSX 版本）、motion；票券撕裂。票面沿虚线或锯齿边界被拖拽分离，撕开时两侧产生错位与弹性；适合优惠券核销与一次性操作。

107、[https://reactbits.dev/micro/flip-card](https://reactbits.dev/micro/flip-card)
依赖：React、Tailwind CSS（TSX 版本）、motion；立体双面卡。圆角卡片围绕 X/Y 轴翻到背面，翻转中展示透视、层间阴影与缓动；支持点击或拖动触发，须处理键盘访问。

108、[https://reactbits.dev/micro/branched-menu](https://reactbits.dev/micro/branched-menu)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；分枝菜单。主操作向外延伸多条细线，沿分叉方向依次长出子选项；悬停高亮对应分支，收起时沿原路径收缩。

109、[https://reactbits.dev/micro/folder-float](https://reactbits.dev/micro/folder-float)
依赖：React、Tailwind CSS（TSX 版本）、matter-js；漂浮文件夹。悬停/点击开启文件夹封面，内部纸张或标签在轻微重力感下依次升起并摆动；适合项目入口与收藏管理。

110、[https://reactbits.dev/micro/refine-frame](https://reactbits.dev/micro/refine-frame)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；展示处理结果需业务接口；精修进度框。图像预览被简洁细框包住，处理中显示流转线、细微占位或加载符号；完成后转换为成功勾选，不改变版面尺寸。

111、[https://reactbits.dev/micro/thought-line](https://reactbits.dev/micro/thought-line)
依赖：React、Tailwind CSS（TSX 版本）、motion、@hugeicons/react、@hugeicons/core-free-icons；思考过程线。简短的分析状态沿水平线连接多个步骤，当前节点闪动并显示状态进度；结束时将长流程收束为简洁结论。

112、[https://reactbits.dev/micro/voice-pill](https://reactbits.dev/micro/voice-pill)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；实际录音须接浏览器媒体采集 API；语音录制胶囊。短小麦克风按钮点击后扩展为带声波、计时与取消按钮的圆角录音条；波形是交互表现，实际采音需另接媒体接口。

113、[https://reactbits.dev/micro/slosh-gauge](https://reactbits.dev/micro/slosh-gauge)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；液位进度量表。半透明容器中的彩色液面随数值上涨而上升，伴随表面波纹、晃动和回落；适合容量、额度与完成率。

114、[https://reactbits.dev/micro/prompt-bar](https://reactbits.dev/micro/prompt-bar)
依赖：React、Tailwind CSS（TSX 版本）、motion、@hugeicons/react、@hugeicons/core-free-icons；实际文件上传/语音/模型调用须接业务接口；智能提示输入栏。圆角聊天输入控件集合文本、附件、模型或语音入口，聚焦后呈现快捷选项与状态变化；功能接线须对齐真实 Agent。

115、[https://reactbits.dev/micro/swipe-toast](https://reactbits.dev/micro/swipe-toast)
依赖：React、Tailwind CSS（TSX 版本）、motion、@hugeicons/react、@hugeicons/core-free-icons；手势通知。轻量 Toast 从页面边缘滑入，显示操作结果和可能的撤销时限；用户横向/纵向滑走后带弹簧收拢，不遮挡操作。

116、[https://reactbits.dev/micro/sling-button](https://reactbits.dev/micro/sling-button)
依赖：React、Tailwind CSS（TSX 版本）、motion、@hugeicons/react、@hugeicons/core-free-icons；弹弓发送键。按钮像被橡皮筋拉开的圆形发射器，按住拖拽蓄势后释放触发提交，随后快速回弹；应另提供普通点击路径。

117、[https://reactbits.dev/micro/bell-toggle](https://reactbits.dev/micro/bell-toggle)
依赖：React、Tailwind CSS（TSX 版本）、motion、@hugeicons/react、@hugeicons/core-free-icons；铃铛开关。通知按钮在开关切换时像实体铃铛抖动，图标在开启/静音间变形并伴随胶囊底座反馈；状态须持久化。

118、[https://reactbits.dev/micro/call-chip](https://reactbits.dev/micro/call-chip)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；通话状态条。紧凑胶囊同时显示呼叫图标、运行时长与连接状态；接通、等待、断开时采用不同轻量色彩和动画。

119、[https://reactbits.dev/micro/status-mark](https://reactbits.dev/micro/status-mark)
依赖：React、Tailwind CSS（TSX 版本）、motion；代理状态标识。小型状态点或几何标记分别表达空闲、思考、完成与故障；切换时有细环旋转、短闪或勾号收束。

120、[https://reactbits.dev/micro/glide-select](https://reactbits.dev/micro/glide-select)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；滑动式选择框。选择菜单在触发器旁展开，当前选项被小胶囊高亮块柔和滑到目标位置；关闭后仅保留所选标签。

121、[https://reactbits.dev/micro/swipe-row](https://reactbits.dev/micro/swipe-row)
依赖：React、Tailwind CSS（TSX 版本）、motion、@hugeicons/react、@hugeicons/core-free-icons；滑动操作行。列表条目可左右拖开露出删除、置顶或归档按钮，松手按阈值自动吸附打开或闭合；提供非手势等效入口。

122、[https://reactbits.dev/micro/jelly-radio](https://reactbits.dev/micro/jelly-radio)
依赖：React、Tailwind CSS（TSX 版本）、motion；果冻单选。单选圆点受到点击时短暂压扁、膨胀并移向新位置，边缘呈凝胶弹性；相邻标签随之产生细微联动。

123、[https://reactbits.dev/micro/comet-dial](https://reactbits.dev/micro/comet-dial)
依赖：React、Tailwind CSS（TSX 版本）、motion；彗尾旋钮。环形刻度盘被拖动或滚轮操作时，选中角度带出一段发光彗尾；放手对准刻度，数值实时变化。

124、[https://reactbits.dev/micro/wake-slider](https://reactbits.dev/micro/wake-slider)
依赖：React、Tailwind CSS（TSX 版本）、motion；尾波滑杆。滑杆把手沿轨道移动时留下逐步淡化的短线或渐变尾迹，速度越快拖尾越明显；数值与实际范围必须一致。

125、[https://reactbits.dev/micro/code-slots](https://reactbits.dev/micro/code-slots)
依赖：React、Tailwind CSS（TSX 版本）、motion、@hugeicons/react、@hugeicons/core-free-icons；验证码槽。多格字符槽逐位填充，输入后焦点自动移向下一格；粘贴整段验证码时按序分配并显示完成反馈。

126、[https://reactbits.dev/micro/lattice-loader](https://reactbits.dev/micro/lattice-loader)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；格点加载器。均匀排列的细小方格以波纹、错峰闪烁或明暗扫描形成循环加载；适合后台作业等待状态。

127、[https://reactbits.dev/micro/scrub-field](https://reactbits.dev/micro/scrub-field)
依赖：React、Tailwind CSS（TSX 版本）、motion；拖动修订数值。单行数字标签可左右拖拽调整数值，离开拖拽模式后可直接键盘精确输入；越界时显示轻微阻力反馈。

128、[https://reactbits.dev/micro/fuse-button](https://reactbits.dev/micro/fuse-button)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；保险丝按钮。点击删除等操作后按钮短暂显示撤销倒计时进度，计时结束才执行不可逆提交；状态应与真实事务一致。

129、[https://reactbits.dev/micro/warm-tooltip](https://reactbits.dev/micro/warm-tooltip)
依赖：React、Tailwind CSS（TSX 版本）、motion；延迟浮层提示。第一次悬停稍作停顿才弹出柔和提示框，连续浏览相邻选项时缩短等待；离开后轻盈淡出。

130、[https://reactbits.dev/micro/slide-commit](https://reactbits.dev/micro/slide-commit)
依赖：React、Tailwind CSS（TSX 版本）、motion、@hugeicons/react、@hugeicons/core-free-icons；滑动确认条。用户拖动内部滑块穿过轨道才能执行操作，滑行过程中显示提交进度；达到阈值后变为旋转处理中与成功态。

131、[https://reactbits.dev/micro/rubber-segment](https://reactbits.dev/micro/rubber-segment)
依赖：React、Tailwind CSS（TSX 版本）、motion；橡皮筋分段切换。选中段的高亮背景先沿手势方向拉长，再收缩到目标项下方；可配合标签或图标变化并保持键盘可选。

132、[https://reactbits.dev/micro/pulse-heart](https://reactbits.dev/micro/pulse-heart)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/core-free-icons；心形点赞键。触发后爱心短暂缩放、染色并跳动，计数随状态更新；取消点赞执行逆向反馈，避免只动效不同步数据。

133、[https://reactbits.dev/micro/spring-check](https://reactbits.dev/micro/spring-check)
依赖：React、Tailwind CSS（TSX 版本）、motion、@hugeicons/core-free-icons；弹簧勾选框。圆角方框从未选中变为实心后，勾号沿路径绘出并回弹；可以联动文字划线，但不能破坏表单语义。

134、[https://reactbits.dev/micro/peek-rating](https://reactbits.dev/micro/peek-rating)
依赖：React、Tailwind CSS（TSX 版本）、@hugeicons/react、@hugeicons/core-free-icons；星级评分器。鼠标掠过星星时从左到右依次填充和抬升，点击确认后保留评分并显示精简反馈；触屏支持连续选级。

135、[https://reactbits.dev/micro/hold-button](https://reactbits.dev/micro/hold-button)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；按住确认按钮。按压时圆形进度沿按钮周边逐步填满，提前松手回退，达到时长才触发危险操作；必须显示清晰确认结果。

136、[https://reactbits.dev/micro/squish-switch](https://reactbits.dev/micro/squish-switch)
依赖：React、Tailwind CSS（TSX 版本）、motion；挤压切换开关。滑块被按住时先缩短或压扁，移向另一端后拉长并回弹；边缘、颜色和文案同步表达启闭状态。


### E. React Bits · 动态背景（137–165）

137、[https://reactbits.dev/backgrounds/gradient-ascii](https://reactbits.dev/backgrounds/gradient-ascii)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；渐变字符背景。由等宽字符组成的大面积光场随着动态色带明暗变化，字符疏密表现层次与发光；适合科技叙事的局部底纹。

138、[https://reactbits.dev/backgrounds/shape-waves](https://reactbits.dev/backgrounds/shape-waves)
依赖：React、Tailwind CSS（TSX 版本）、vgpu；需确认 GPU/WebGL 支持；几何波场。方块、三角和柔和弧线组成重复图案，行列按照波浪相位依次起伏；不同深浅与色阶形成流体般的秩序感。

139、[https://reactbits.dev/backgrounds/aero-shards](https://reactbits.dev/backgrounds/aero-shards)
依赖：React、Tailwind CSS（TSX 版本）、vgpu；需确认 GPU/WebGL 支持；空气感棱片。半透明玻璃碎片或长条晶片悬浮在柔色光场里，随着指针或时间缓慢偏转并折射；适合大幅品牌背景。

140、[https://reactbits.dev/backgrounds/ghost-fibers](https://reactbits.dev/backgrounds/ghost-fibers)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；幽灵光纤。极细的半透明丝束纵深交错，发光点沿曲线缓慢滑行；整体像烟雾中的纤维束，宜保持文字区安静。

141、[https://reactbits.dev/backgrounds/web-threads](https://reactbits.dev/backgrounds/web-threads)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；网页织线。细亮曲线交错成连通网络，指针经过时局部结点发光、连线弯曲并传出脉冲；适合协作和连接主题。

142、[https://reactbits.dev/backgrounds/topography](https://reactbits.dev/backgrounds/topography)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；等高地形。多层闭合等高线缓缓隆起、流动，形成地貌/海拔图视觉；鼠标可影响局部高度或线条间距，适合数据主题。

143、[https://reactbits.dev/backgrounds/light-tunnel](https://reactbits.dev/backgrounds/light-tunnel)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；光纤隧道。发亮粒子线条沿透视消失点延伸，中心似飞速穿越的管道；指针位移可改变视线方向，注意眩晕与性能。

144、[https://reactbits.dev/backgrounds/sliced-waves](https://reactbits.dev/backgrounds/sliced-waves)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；分层切片波。彩色柔性波面被横向切成多层薄片，每片明暗和相位略有错开；滑动时似透明光片彼此错层掠过。

145、[https://reactbits.dev/backgrounds/lightfall](https://reactbits.dev/backgrounds/lightfall)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；光束飘落。柔细的斜向光线在暗场中缓慢坠下并散射，亮点有景深与轨迹衰减；适合作为标题背景而非交互核心。

146、[https://reactbits.dev/backgrounds/prism](https://reactbits.dev/backgrounds/prism)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；棱镜折射。几何镜面把白光拆成彩色光谱，高亮线条随视角旋转、交叉与重组；冷暖配色可按品牌重定。

147、[https://reactbits.dev/backgrounds/light-pillar](https://reactbits.dev/backgrounds/light-pillar)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；竖直光柱。中心是一束扭曲上升的柔亮体积光，内部有层叠流线和轻微旋转；可通过指针变化方向或光能强弱。

148、[https://reactbits.dev/backgrounds/side-rays](https://reactbits.dev/backgrounds/side-rays)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；侧向射线。柔和光束从屏幕侧边斜射进来，形成方向明确的渐变雾化光场；指针或滚动改变射线角度和扩散长度。

149、[https://reactbits.dev/backgrounds/light-rays](https://reactbits.dev/backgrounds/light-rays)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；体积光线。多束半透明光线通过空气散射形成明显纵深，远处雾化、近处边缘锐利；适合背景深度与材质强调。

150、[https://reactbits.dev/backgrounds/radar](https://reactbits.dev/backgrounds/radar)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；雷达扫描盘。细同心圆与径向刻度构成仪表盘，扫描扇形持续绕中心旋转，经过标记点时短暂点亮并留下残影。

151、[https://reactbits.dev/backgrounds/soft-aurora](https://reactbits.dev/backgrounds/soft-aurora)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；柔和极光。多层低饱和彩光像薄纱般横向飘动、渐变混合，纹理稳定而不抢视线；可用于柔和的全屏底色。

152、[https://www.reactbits.dev/backgrounds/magic-rings](https://www.reactbits.dev/backgrounds/magic-rings)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；魔法能量环。多层细光环围绕共同中心旋转、呼吸和交错，局部出现颗粒与细亮边缘；适合加载及数据聚焦氛围。

153、[https://reactbits.dev/backgrounds/aurora](https://reactbits.dev/backgrounds/aurora)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；极光帷幕。大片冷色/暖色光幕从上方向下垂落并缓慢翻涌，边缘如烟雾溶解；能营造深色首屏的空间感。

154、[https://reactbits.dev/backgrounds/particles](https://reactbits.dev/backgrounds/particles)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；漂浮粒子场。大量大小不一的光点在景深中缓缓运动，靠近指针时可形成排斥或连接线；粒子密度应按设备能力动态调整。

155、[https://reactbits.dev/backgrounds/gradient-blinds](https://reactbits.dev/backgrounds/gradient-blinds)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；渐变百叶窗。重复竖条如玻璃百叶片依次偏转、显露渐变颜色，形成随指针或时间缓慢折叠的柔光背景。

156、[https://reactbits.dev/backgrounds/grainient](https://reactbits.dev/backgrounds/grainient)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；颗粒流体渐变。几组柔和色斑互相扩散融合，细颗粒覆盖其上消除平滑塑料感；指针移动可轻微搅动色场。

157、[https://reactbits.dev/backgrounds/pixel-snow](https://reactbits.dev/backgrounds/pixel-snow)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；像素雪花。细小方块雪点以多层速度缓缓下落，近景较大、远景较细；鼠标可推开局部雪点或造成短时乱流。

158、[https://reactbits.dev/backgrounds/galaxy](https://reactbits.dev/backgrounds/galaxy)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；银河星群。疏密有致的点状星体按透视深度移动，亮度微微闪烁；指针改变星轨和偏转方向，适合空间探索主题。

159、[https://reactbits.dev/backgrounds/faulty-terminal](https://reactbits.dev/backgrounds/faulty-terminal)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；故障终端。黑底或深色背景呈现密集字符、扫描线与荧光残影，字符持续抖动重排；点击可触发短暂数据故障波纹。

160、[https://reactbits.dev/backgrounds/hyperspeed](https://reactbits.dev/backgrounds/hyperspeed)
依赖：React、Tailwind CSS（TSX 版本）、three；超速时空。车道般的弯曲光轨向视野远端高速推进，颜色与运动模糊制造加速感；鼠标偏转视角、按压可增强速度。

161、[https://reactbits.dev/backgrounds/grid-distortion](https://reactbits.dev/backgrounds/grid-distortion)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；网格畸变。规则方形或图像网格受到指针牵引后局部拉伸成凸起/凹陷，离开后渐渐恢复；适合画布或画廊装饰。

162、[https://reactbits.dev/backgrounds/ballpit](https://reactbits.dev/backgrounds/ballpit)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；弹性球池。大大小小的柔和色球在容器中相互碰撞、堆积与弹跳，指针可推动和抛掷球体；需限制数量和碰撞运算。

163、[https://reactbits.dev/backgrounds/orb](https://reactbits.dev/backgrounds/orb)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；发光光晕球。单个柔边彩色圆球由多个光层组成，内部颜色缓慢漂移且边缘呈折射高光；指针靠近时光晕轻微偏移。

164、[https://reactbits.dev/backgrounds/letter-glitch](https://reactbits.dev/backgrounds/letter-glitch)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；字母故障场。随机字母在屏幕上像电子干扰般不断替换和闪烁，局部可形成像素方阵；指针经过扰动字符，随后恢复。

165、[https://reactbits.dev/backgrounds/grid-motion](https://reactbits.dev/backgrounds/grid-motion)
依赖：React、Tailwind CSS（TSX 版本）；无额外第三方 npm 包；栅格视差运动。由图片块构成的规则矩阵按行列错向移动，视觉中心与鼠标方向产生细微视差；适合作品集背景。


### F. Uiverse · HTML/CSS 作品（166–209）

166、[https://uiverse.io/Praashoo7/black-lizard-62](https://uiverse.io/Praashoo7/black-lizard-62)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；仿真黑色银行卡。深色卡面有芯片、非接触图标、编号与金属反光细节；重点参考正反面切换时的三维透视、遮挡和光泽变化。

167、[https://uiverse.io/bandirevanth/wonderful-dog-56](https://uiverse.io/bandirevanth/wonderful-dog-56)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；二态滑动开关。浅灰轨道中有醒目的红色/白色滑块，切换后标签和色块翻转位置；重点研究开关位移、按下反馈与语义状态。

168、[https://uiverse.io/Mayurwaghgpr/foolish-liger-76](https://uiverse.io/Mayurwaghgpr/foolish-liger-76)
依赖：原生 HTML + Tailwind CSS（需可用的 Tailwind 构建/运行环境；未确认额外 npm 包）；表情反应选择器。初态只有紧凑的点赞入口，触发后展开一串不同表情的圆形选项；悬停可抬升单项，选择后收回并显示当前反应。

169、[https://uiverse.io/chintu_2484/fat-moose-56](https://uiverse.io/chintu_2484/fat-moose-56)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；键帽立体按钮。浅灰方形按键采用硬质底部阴影与小圆角，鼠标按下时整体向下移动、阴影缩短，模拟实体键盘回弹。

170、[https://uiverse.io/Pradeepsaranbishnoi/hungry-bat-66](https://uiverse.io/Pradeepsaranbishnoi/hungry-bat-66)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；圆形数字刻度选择器。围绕中心布置编号与放射刻度，当前数字在渐变色盘上高亮；旋转或切换时研究刻度过渡和选中指示。

171、[https://uiverse.io/Nawsome/short-dolphin-98](https://uiverse.io/Nawsome/short-dolphin-98)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；拟物红色软糖开关。高光红色圆钮嵌入浅灰底座，具有软胶凸起和内阴影；切换时圆钮受挤压移动，回弹后形成新状态。

172、[https://uiverse.io/vinodjangid07/smart-emu-83](https://uiverse.io/vinodjangid07/smart-emu-83)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；黑色删除图标键。小型深色圆角按钮里放置垃圾桶符号，默认简洁，悬停时强调图标和背景反差；适合二级删除操作。

173、[https://uiverse.io/Satwinder04/ancient-sloth-30](https://uiverse.io/Satwinder04/ancient-sloth-30)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；极简浅色文本输入。细灰轮廓/下划线承托单行文本和占位提示，获得焦点时边线或标签清晰化；重点参考克制的焦点与错误态。

174、[https://uiverse.io/Novaxlo/splendid-dingo-30](https://uiverse.io/Novaxlo/splendid-dingo-30)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；线路站点卡。彩色交通路线穿过一组圆点站台标识，站名和时间整齐排列；可参考节点高亮、经过顺序和横向信息密度。

175、[https://uiverse.io/zeeshan_2112/shy-rattlesnake-3](https://uiverse.io/zeeshan_2112/shy-rattlesnake-3)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；霓虹活动入场券。深紫色活动卡含网格、标题与条码式元素，彩光营造电子票质感；重点参考票据分区、渐变和悬停强调。

176、[https://uiverse.io/LilaRest/soft-baboon-75](https://uiverse.io/LilaRest/soft-baboon-75)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；软凸单选控件。淡色凹凸轨道包裹圆形选择滑珠，光照与阴影塑造磨砂手感；状态变化以滑珠位移和边缘高光表达。

177、[https://uiverse.io/Praashoo7/quick-fish-43](https://uiverse.io/Praashoo7/quick-fish-43)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；社交平台圆形按钮。多枚白底圆形图标分列，在悬停时分别升起、扩影或显示品牌色；适合分享区域，注意无障碍名称。

178、[https://uiverse.io/satyamchaudharydev/brown-puma-94](https://uiverse.io/satyamchaudharydev/brown-puma-94)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；深色状态信息卡。深蓝卡面整合时间、摘要、图标与明显的主操作按钮；重点借鉴紧凑的信息层级及悬停时卡片抬升。

179、[https://uiverse.io/alexruix/neat-tiger-82](https://uiverse.io/alexruix/neat-tiger-82)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；黑白极简加载器。以少量高对比几何形状循环旋转、伸缩或交替明暗，不依赖复杂背景；适合纯净的系统级等待态。

180、[https://uiverse.io/Nawsome/wet-mayfly-23](https://uiverse.io/Nawsome/wet-mayfly-23)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；仓鼠跑轮动画。橙灰色小动物在圆形跑轮中循环奔跑，轮子与四肢节奏匹配；适合轻松的空状态或趣味加载，不宜长时常驻。

181、[https://uiverse.io/ilkhoeri/thin-bobcat-83](https://uiverse.io/ilkhoeri/thin-bobcat-83)
依赖：原生 HTML + Tailwind CSS（需可用的 Tailwind 构建/运行环境；未确认额外 npm 包）；隐私与 Cookie 提示卡。浅色卡片组合插图、简短正文与确认按钮；研究操作优先级、圆角留白和按钮悬停，不照搬合规文案。

182、[https://uiverse.io/cohencoo/dry-rat-94](https://uiverse.io/cohencoo/dry-rat-94)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；橙色环形等待动画。几个橙色圆弧/点围绕中心循环旋转，形成清晰的速度节奏；重点参考低成本的旋转与渐隐实现。

183、[https://uiverse.io/themrsami/quick-zebra-71](https://uiverse.io/themrsami/quick-zebra-71)
依赖：原生 HTML + Tailwind CSS（需可用的 Tailwind 构建/运行环境；未确认额外 npm 包）；文件图标提示气泡。鼠标聚焦小图标时在其附近弹出黑白高对比工具提示，带微小阴影及定位偏移；需补足键盘触发。

184、[https://uiverse.io/mihocsaszilard/rare-fox-73](https://uiverse.io/mihocsaszilard/rare-fox-73)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；金属银灰银行卡。卡面通过细条纹、芯片符号和渐变反光模拟拉丝金属，悬停时适度改变高光位置；重点参考材质层次。

185、[https://uiverse.io/byllzz/rude-bat-50](https://uiverse.io/byllzz/rude-bat-50)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；电子钱包支付卡。蓝绿等金融色系卡片呈现账户名称、余额和支付入口，鼠标经过时有轻微上浮与表层高光；保留真实数据层次。

186、[https://uiverse.io/AatreyuShau/lazy-quail-10](https://uiverse.io/AatreyuShau/lazy-quail-10)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；奇异果鸟行走加载。黑色小鸟以重复迈步和身体微摆形成可爱循环，背景保持简洁；重点研究步态节拍与无动画占位。

187、[https://uiverse.io/codebykay101/ugly-lion-23](https://uiverse.io/codebykay101/ugly-lion-23)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；叠层玻璃卡片。三张半透明磨砂卡片倾斜交错堆叠，带圆角、柔和阴影与图标文字；重点复刻悬停时旋正、依次向两侧舒展及移开后收拢的层级反馈。

188、[https://uiverse.io/vinodjangid07/popular-owl-27](https://uiverse.io/vinodjangid07/popular-owl-27)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；物流货车加载。小卡车位于简化道路上前进，车轮旋转并伴随轻微车身颠簸；可融合进上传、传输及准备状态。

189、[https://uiverse.io/esraaabdel-kareem/bad-dragonfly-54](https://uiverse.io/esraaabdel-kareem/bad-dragonfly-54)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；咖啡杯蒸汽加载。圆角杯体上升起几缕慢速弯曲的蒸汽线条，热气交错消散并循环生成；适合短时轻松等待场景。

190、[https://uiverse.io/eslam-hany/selfish-bobcat-73](https://uiverse.io/eslam-hany/selfish-bobcat-73)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；简洁灰度信息卡。圆角卡面配微弱投影和整洁居中文本，悬停时可增强阴影与边缘反差；重点借鉴呼吸感而不是强动效。

191、[https://uiverse.io/Cobp/mighty-pig-13](https://uiverse.io/Cobp/mighty-pig-13)
依赖：原生 HTML + Tailwind CSS（需可用的 Tailwind 构建/运行环境；未确认额外 npm 包）；暖色文件夹提示卡。卡片用橙黄强调、文件夹图标与简要说明形成提醒视觉；可参考点击/悬停时的状态区分和文案留白。

192、[https://uiverse.io/Bodyhc/light-lion-39](https://uiverse.io/Bodyhc/light-lion-39)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；黑白经典拨动开关。小巧轨道与双色滑块构成明确启闭关系，状态切换依靠横向移动与阴影高低差；适合系统设置页。

193、[https://uiverse.io/ayman-ashine/curvy-starfish-3](https://uiverse.io/ayman-ashine/curvy-starfish-3)
依赖：原生 HTML + Tailwind CSS（需可用的 Tailwind 构建/运行环境；未确认额外 npm 包）；极简浮层说明。按钮附近出现小尺寸文本提示框，背景和箭头构成定位关系；重点研究鼠标进入、键盘焦点和离开时的时序。

194、[https://uiverse.io/Smit-Prajapati/spicy-rat-83](https://uiverse.io/Smit-Prajapati/spicy-rat-83)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；深色商务名片。细圆角矩形上放置姓名、职称与图标，深色表面搭配低饱和高光；悬停时内容或背景层作微幅移动。

195、[https://uiverse.io/jeremy_4982/massive-falcon-52](https://uiverse.io/jeremy_4982/massive-falcon-52)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；彩圈循环加载。数个不同粗细/颜色的环围绕中心运动，内外环节奏错开；适合进度未知的短时异步操作。

196、[https://uiverse.io/JkHuger/curvy-liger-67](https://uiverse.io/JkHuger/curvy-liger-67)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；汉堡菜单拨钮。黑白极简条线在菜单关闭与开启间切换，可研究线条旋转为交叉图形、缩放及焦点反馈。

197、[https://uiverse.io/ashif_6672/nice-warthog-84](https://uiverse.io/ashif_6672/nice-warthog-84)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；文件树导航卡。左侧树状目录配分级缩进、文件夹/文件图标与选中背景，展开时子层逐级显露；适合项目与素材库。

198、[https://uiverse.io/vamsidevendrakumar/soft-shrimp-94](https://uiverse.io/vamsidevendrakumar/soft-shrimp-94)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；双色翻转内容卡。圆角卡片前后或上下分为不同色彩的内容面，触发后文字与色块切换主次；适合选中方案和对比状态。

199、[https://uiverse.io/vinodjangid07/plastic-parrot-51](https://uiverse.io/vinodjangid07/plastic-parrot-51)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；深色邮件订阅输入栏。圆角邮箱输入框与发送箭头按钮融为一体，焦点时边界变亮；提交按钮提供短促按压/完成反馈。

200、[https://uiverse.io/Galahhad/strong-squid-82](https://uiverse.io/Galahhad/strong-squid-82)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；昼夜主题开关。云朵、太阳/月亮或星点在轨道内部过渡，滑块移动同时背景由亮色转向深色；与应用真实主题状态同步。

201、[https://uiverse.io/barisdogansutcu/big-moose-69](https://uiverse.io/barisdogansutcu/big-moose-69)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；趣味角色按钮。明亮黄底圆角控件以卡通人物为主要视觉，悬停/按压时图形微微跳动；可借鉴角色与按钮动作的耦合。

202、[https://uiverse.io/byllzz/fluffy-hound-44](https://uiverse.io/byllzz/fluffy-hound-44)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；蓝色玻璃设置卡。卡片将多个参数滑杆、标签和透明层次集中陈列，拖动时轨道填充与数值同步；适合独立的小型控制台。

203、[https://uiverse.io/NK2552003/silly-moth-73](https://uiverse.io/NK2552003/silly-moth-73)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；心率周趋势卡。粉白卡片结合 BPM 数字、心形提示与一周折线/条状数据，当前日期高亮；适合指标卡的可读动画。

204、[https://uiverse.io/Cobp/horrible-quail-18](https://uiverse.io/Cobp/horrible-quail-18)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；颜色放大选择器。紧密排列的圆角色块形成横向色带；重点借鉴 macOS Dock 式悬停放大、邻块递减变形、色值浮标和点击复制反馈，具体倍率及复制提示以作品源码为准。

205、[https://uiverse.io/Javierrocadev/red-stingray-37](https://uiverse.io/Javierrocadev/red-stingray-37)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；中性色图形展示卡。以浅灰内容背景、几何图案与简单布局呈现视觉主体，悬停时可使用轻微描边或位移；重点借鉴低装饰的层次处理。

206、[https://uiverse.io/vinodjangid07/thin-duck-22](https://uiverse.io/vinodjangid07/thin-duck-22)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；退出登录操作按钮。圆角主按钮将文字与退出图标并置，悬停时图标向外滑移或背景变亮；注意把危险操作和普通按钮区别开。

207、[https://uiverse.io/adamgiebl/smart-moth-68](https://uiverse.io/adamgiebl/smart-moth-68)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；动态发送按钮。蓝色圆角键包含纸飞机/箭头图标，点击时图标以飞出、倾斜或缩回表现提交；成功状态仍以实际请求结果为准。

208、[https://uiverse.io/SmookyDev/sharp-stingray-58](https://uiverse.io/SmookyDev/sharp-stingray-58)
依赖：原生 HTML + Tailwind CSS（需可用的 Tailwind 构建/运行环境；未确认额外 npm 包）；暖色半透明按钮。橙红渐变与玻璃高光构成厚度和反射，悬停时高光扫过并略微抬升，按压短暂下沉；适合有限的重点 CTA。

209、[https://uiverse.io/preet_7613/new-cougar-63](https://uiverse.io/preet_7613/new-cougar-63)
依赖：原生 HTML + CSS（当前未确认必装第三方 npm 包；字体/图标/素材需核对原作代码）；404 错误状态卡。纯净黑白文字、图形和空白构成明确的找不到页面提示；可借鉴简洁版式与返回入口，不能直接复用错误文案。



**这 209 条不是装饰性收藏夹，而是必须认真学习、检索、比对、选择和落地的设计资产。任何时候都不得以“参考过网站”“改了一个颜色”“加了几张 AI 图片”“放一个静态组件截图”替代真实的交互工程。**

**每一次前端开发或重构，强制执行以下闭环：**
1. **全量扫描**：以业务目标和已有设计系统为准，检视所有 209 条的相关性；为各页面、流程、状态建立候选映射，覆盖用户实际经历的关键交互，而非只优化展示页。允许多个组件机制融合，但必须说明组合理由和性能代价。
2. **深度拆解**：对确定采用的每条，读取源码、依赖、Props 和样式；在可行条件下重现演示。记录默认、悬停、聚焦、按压、拖拽、滚动、切换、加载、完成、错误、禁用、离开和复位中**实际存在的**状态及动画曲线。源码与演示不一致时，以真实代码/行为证据为准，清楚标出差异。
3. **品牌化再设计**：**保留交互骨架与运动规律，重构视觉外衣**。重新制定颜色、字体、间距、圆角、噪声、阴影、图标、尺寸、明暗主题和不同屏幕的布局；让组件服从当前产品的使用情景和信息层级。绝不把原站 1:1 的色彩、文案、布局直接拼贴入项目，也不能因换风格而削弱核心交互质感。
4. **统一接口和状态**：与项目现有组件规范、设计 token、路由、鉴权、API、业务事件、错误处理和撤销机制对齐，禁止演示假数据混入真实业务。多个组件共享状态时必须避免动画冲突、遮挡冲突、重复订阅和资源泄露。
5. **真正运行并复测**：本地安装所需最少依赖，执行类型检查、Lint、构建、启动及关键交互测试；覆盖鼠标/键盘/触控、移动端/桌面端、浅/深主题、低带宽/低性能环境。关注 Layout Shift、帧率、交互延迟、循环卸载、内存和 `prefers-reduced-motion`。不能编译、不能交互、没有业务连线的成果均不得标注为“完成”。
6. **逐项留证**：每个已使用组件必须输出“**文档序号 → 对应页面 → 原源码地址与依赖 → 保留的交互机制 → 风格适配内容 → 测试证据 → 已知限制**”。对于未使用的组件记录“暂不适用原因”，不得空写“已查看”。未实际看到源代码或未运行测试时必须明确标记“待验证”，不能伪称已全面复刻。
7. **不强行堆特效**：复杂动效应服务表达、反馈、导航、探索与协作，不应妨碍阅读、输入、修图画布、响应速度和用户掌控感。首页视觉冲击力、功能完成率、稳定性、可访问性与性能必须同时成立。

**最高优先级**：当前项目的真实需求和业务正确性 ＞ 可用性、无障碍与性能 ＞ 官方组件的交互动力学还原 ＞ 原组件的示例外观。冲突时需要调整或舍弃，而不是强行套用；调整要明确解释保留了什么、为什么改变、怎么检验。
**许可证提醒**：React Bits 官方源代码受 MIT + Commons Clause 限制；在应用内使用与再分发组件库不是同一行为。Uiverse 作品及其字体、图像、图标需分别核实许可。不能因为仓库能读取，就默认所有资产可无条件拷贝。
**证据边界**：本文件帮助快速定位设计方向和第三方依赖，**不是 209 个组件全部完成真实运行、截图对照、源码全文审计的证明**。对于 Uiverse 的具体动画时序、颜色倍率、复制动作、悬停连动等细节，只有读到原始 HTML/CSS/JS 且运行复现后才能宣称完成。遇到访问异常，应如实记录并使用公开可验证的替代路径，不得猜测或填充虚假结论。