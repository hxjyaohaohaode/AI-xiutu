# 智能体运行时与办公编辑：对标调研与采纳记录（2026-11-28）

本轮调研用于决定**做什么、按什么方式做**。每项结论都标出来源类型：一手资料（官方工程文章、官方帮助、官方开发者文档）或二手报道。二手报道只用来了解“有这项功能”，不作为实现细节的依据。凡是没有一手资料能确认的功能，这里不写成已对标。

## 1. 智能体工程（prompt / context / harness / loop）

| 来源 | 类型 | 确认到的做法 | 本项目的采纳 |
| --- | --- | --- | --- |
| [OpenAI：Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop) | 一手 | 循环在模型不再发出工具调用、改为输出给用户的消息时结束；请求按 `instructions → tools → input` 排列；提示缓存要求**前缀完全一致**，静态内容放前、可变内容放后；运行中配置变化以**追加**新消息表达，不改写已发送内容；工具结果以 `function_call_output` 按 `call_id` 回传；内置 `update_plan` 计划工具 | 系统提示改为分节构建，稳定策略在前，本轮事实（执行模式、是否共享画面）只放在最后一节；每轮运行状态追加在最新工具结果里，不再改写 `instructions`（含最后一次请求的提示），各轮 `instructions` 字节一致 |
| [Anthropic：Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 一手 | 用最少的高信号 token；系统提示用标题/XML 分节，保持合适的抽象层级；工具功能少重叠、返回精简；即时检索（只保留标识，需要时再取）；工具结果清理是最轻量的压缩；结构化笔记（如待办列表）放在上下文之外；子智能体返回精简摘要 | 提示只纳入本轮实际可用工具的章节（无办公工具时不出现办公规则）；运行台账（`harness`）相当于由宿主维护的结构化待办，列出剩余请求数、候选、检查状态和下一步；原有的工具结果归档、`read_tool_result` 分页与专家子调用保持不变 |
| [DeepSeek Harness 开发者预览](https://deepseek.com/harness/en/)，[The New Stack 报道](https://thenewstack.io/deepseek-harness-open-source-plugins/) | 一手 + 二手 | 模型适配器、工具注册表与智能体循环都是可替换插件；“一步”= 一次模型请求加其工具调用 | 原有的循环恢复设计已引用其源码（见 [assistant README](../../packages/assistant/README.md)）；本轮把循环控制（失败分类、重复失败拦截、台账）抽成独立的 `harness.ts`，与模型协议解耦 |
| Claude Code 社区分析（如 [Prompt Assembly Pipeline](https://y-agent.github.io/inside-claude-code/03-prompt-assembly.html)、[Hooks 深入](https://dev.to/swapnanilsaha/claude-code-hooks-a-practical-deep-dive-on-deterministic-agent-behavior-2i7d)） | 二手（非官方） | 用带外的系统提醒传递计划/待办状态；确定性行为由宿主（hooks）保证，而不是靠模型自觉 | 只采纳原则：重复失败拦截、连续两轮全部失败后强制直接回答（`tool_choice: none`）都由宿主执行。不照搬任何未经官方确认的阈值 |

### 落地后的运行时行为

- **分节提示**（`packages/assistant/src/prompt.ts`，策略版本 `editor-agent-v12`）：角色 → 信任边界 → 协作方式 → 回合循环 → 按工具出现的章节 → 创作方向 → 本轮事实。测试确认不同执行模式、不同共享状态下，“本轮事实”之前的内容字节一致。
- **可执行的工具错误**（`harness.ts`）：工具失败仍返回 `TOOL_INPUT_OR_ACCESS_REJECTED`，并附上稳定的原因码、修复提示，以及 zod 校验失败时的字段路径。只有白名单原因码会透出；权限、存储或其他自由文本错误统一归为 `REJECTED`，不泄露路径或资源信息。
- **重复失败拦截**：同一工具、参数规范化后相同的调用在本轮失败过一次，就不再执行，直接返回 `REPEATED_FAILED_CALL`。
- **运行台账**：每轮最后一个工具结果追加 `harness` 对象，包括剩余模型请求数、候选列表（是否已做像素检查）、剩余检查次数、已提名候选、办公草稿数和建议的下一步（`verify`/`review`/`final_request` 等）。台账不进入工具记录存储和重放缓存。
- **收敛**：连续两轮所有调用都失败时，下一次请求设置 `tool_choice: "none"`，要求模型直接说明情况，不再消耗付费请求做无效尝试。
- **人机协作**：提示明确三种执行模式的含义（建议 / 预览确认（默认）/ 预算内自动），自动模式下的保存仍以服务端授权、版本、租约、范围与费用校验为准；有两三个可行方向时，优先用已有的澄清卡片让用户选，而不是猜。

## 2. 文档编辑（Google Docs、Canva Docs、Word）

| 来源 | 类型 | 确认到的功能 | 本项目的采纳 |
| --- | --- | --- | --- |
| [Google Workspace：Smart canvas](https://workspace.google.com/blog/product-announcements/delivering-new-innovations-in-google-workspace-with-smart-canvas)，[Google Docs 帮助中心](https://support.google.com/docs/topic/9046002) | 一手 | 无分页模式、@ 智能芯片、构建块模板、清单在项目符号/编号区域 | 工具栏按 Docs 的分组排列；清单与项目符号、编号并列；文档以“纸张”卡片呈现。智能芯片与构建块**本轮未做** |
| [Canva Docs 介绍](https://www.canva.com/docs/)，[Magic Write](https://www.canva.com/magic-write/) | 一手（营销页） + 二手 | AI 写作助手；“文档转演示”（Docs to Decks）；图表可上传 CSV 或连接表格 | 本项目已有“AI 生成项目文件”和文档内嵌图表；本轮扩充图表类型。“文档一键转演示”**本轮未做** |

本轮在文档编辑器中实际完成的功能：

- **段落样式**：正文、标题 1–3、引用、项目符号、编号、清单。样式以 Markdown 行前缀保存，因此纯文本正文、服务端协作步骤校验、DOCX/PPTX 导出和旧文档仍是同一种格式；编辑器通过装饰层把它们显示为真实的标题、圆点、编号和可点击复选框。
- **文字格式**：加粗、斜体、下划线、删除线、8 色文字颜色（固定调色板，在白底上对比度 ≥ 4.5:1）、5 色突出显示（与 Word 高亮色集合一一对应，导出无损）、上标、下标、链接（只允许 https/http/mailto，`javascript:`、`data:` 等在服务端步骤校验中被拒绝）。
- **段落格式**：四种对齐、四档行距（1 / 1.15 / 1.5 / 2）、四级缩进、段后间距、清除格式（保留链接）。
- **编辑效率**：字号 −/+ 步进、列表内按回车继续编号、在空列表项按回车结束列表、列表内 Tab/Shift-Tab 缩进、查找与替换（区分大小写、上一个/下一个、全部替换）、文档大纲（点击跳转）、字数/字符/阅读时间/选中字数状态栏（中日韩文字按字计数）。
- **快捷键**：Ctrl/⌘ + B/I/U、Shift+X 删除线、`.`/`,` 上下标、Alt+0–3 样式、Shift+7/8/9 列表、`[`/`]` 缩进、`\` 清除格式、F 查找。
- **导出**：DOCX 写入原生的删除线、颜色、高亮、上下标、超链接、缩进与行距；PPTX 文本框同样写入这些属性和超链接。

## 3. 演示与数据可视化（Gamma、PowerPoint）

| 来源 | 类型 | 确认到的功能 | 本项目的采纳 |
| --- | --- | --- | --- |
| [Gamma：卡片式布局](https://gamma.app/explore/content/guides/ai-presentation-tool-card-based-layouts) | 一手（营销页） | 卡片随内容自适应，主题与字体统一，可导出 PDF/PPTX | 记录为后续方向，本轮未改动演示编辑器布局引擎 |
| [PowerPoint Designer / Copilot 设计建议](https://support.microsoft.com/en-us/topic/02f83d65-ec10-4365-b88f-17c19e0dc5cb)，[Smart Guides 说明](https://blog.indezine.com/?p=93635) | 一手 + 二手 | 设计建议已并入 Copilot；智能参考线在对齐或等距时显示虚线提示 | 本轮未改动；作为演示编辑器下一步（对齐/等距参考线） |

本轮新增 7 种图表，与已有的条形、折线、河流、桑基、雷达、三维散点共 13 种，都可以插入文档和演示，并导出 SVG/PNG：

| 图表 | 数据形状 | 说明 |
| --- | --- | --- |
| 堆叠面积图 | 分类 + 1–8 列非负数值 | 零基线堆叠，带刻度 |
| 环形图 | 名称 + 正数，2–12 行 | 中心显示合计，扇区显示占比 |
| 热力图 | 2–24 行 × 2–16 列 | 有正有负时自动用发散色阶，附色阶图例 |
| 矩形树图 | 名称 + 正数，≤40 项 | Squarified 算法（Bruls、Huizing、van Wijk 2000） |
| 漏斗图 | 有序阶段 + 正数，≤10 步 | 显示相对首步与上一步的转化率 |
| 瀑布图 | 名称 + 带符号增量，≤24 行 | 正/负分色，虚线连接，自动合计 |
| 三维柱状图 | 分类 ≤12 × 系列 ≤6 | 斜投影，按画家算法由远及近绘制 |

在 Markdown 演示导出中，面积图与环形图写成 PowerPoint **原生可编辑图表**，其余类型沿用条形图或图片。

### 图表引擎 v2：样式、组合、交互与自定义

用户反馈第一版图表“样式、组合性、动态交互和自由度不够”，因此做了以下改动：

- **统一外框**（`chart-engine.ts`）：所有 14 种图表共用标题、副标题、图例（顶部 / 底部 / 右侧 / 隐藏）、主题与字体。条形、折线、组合、面积图在图例位于右侧时收窄绘图区，而不是整体缩小文字；其余图表按比例放入剩余空间。
- **6 套主题**：工作室（默认，与旧图表一致）、海洋、日落、森林、单色、深夜（深色背景）。坐标轴、网格、文字颜色都随主题变化。
- **重写条形图与折线图**：纵向或横向，分组、堆叠或 100% 百分比；分类过多或名称过长时标签自动倾斜；可加坐标轴标题和数据标签。折线支持平滑；单系列折线带浅色面积。
- **组合图（新增）**：第一列数值画柱，其余列画折线。单位不同或量级相差 4 倍以上时，折线自动使用右轴。
- **保存在图表里的选项**：`officeChartOptionsSchema` 记录主题、图例、标签、网格、平滑、排列、方向、排序、小数位、坐标轴标题、环形孔径和隐藏的系列。所有字段可选且严格校验，旧图表照常显示，导出与预览使用同一套选项。
- **交互**（`chart-view.ts`，只在编辑器中启用）：悬停显示数值提示并突出当前系列；点击图例（或用键盘 Enter / 空格）隐藏或显示某个系列或扇区，被隐藏的项在图例中变淡，可以再点回来；首次出现有淡入或柱体生长动画，系统开启“减弱动态效果”时关闭。导出的 SVG/PNG/DOCX/PPTX 不含动画，避免截到半帧画面。
- **图表设计器**（`ChartDesigner.tsx`）：图标分组的类型选择（比较 / 趋势 / 构成 / 分布与关系），标题与副标题，主题色板，按图表类型只显示有效的选项，实时可交互预览。数据不适合所选类型时，说明原因和需要的数据形状，并禁用“插入”。在文档中插入、在幻灯片中插入、选中幻灯片图表后“编辑图表”、文档内图表右上角“编辑图表”都打开这个设计器。文档内的修改是一次经过服务端校验的协作步骤。
- **兼容**：多张 Markdown 表格，或单位不同、无法放在同一轴上的表格，仍使用原来的逐系列布局；文本列（如备注）照旧跳过。

## 4. 手机厂商相册与图像编辑（ColorOS 17、HyperOS 4、美图、醒图）

| 来源 | 类型 | 报道的功能 |
| --- | --- | --- |
| [Gizmochina：ColorOS 17 正式发布](https://www.gizmochina.com/2026/09/17/oppos-coloros-17-goes-official-check-the-latest-features-and-rollout-schedule-here/)，[NPowerUser：10 月更新](https://nokiapoweruser.com/coloros-17-october-update-xiaobu-memory-notes-ai-features/) | 二手 | 笔记：边录音边记录、一键导入书籍/视频生成结构化笔记、可编辑的概览导图、文本与录音 AI 摘要 |
| [NPowerUser：HyperOS 4 相册](https://nokiapoweruser.com/xiaomi-hyperos-4-gallery-features-dynamic-photos-ai-video/)，[Mi Community 相册 AI 评测](https://new.c.mi.com/global/post/1786612) | 二手 / 社区 | AI 智能剪辑、动态照片导出静态图、语音指令修图、AI 扩图/消除/去反光（部分功能来自更早的 HyperOS 版本） |
| [腾讯新闻：美图秀秀 AI 助手](https://news.qq.com/rain/a/20260910A09X8E00)，[网易：Smart 模式](https://www.163.com/tech/article/LAG0QE3300099F4I.html)，[搜狐：醒图专业版](https://www.sohu.com/a/1008320187_122362510) | 二手 | 自然语言修图、按照片内容推荐工具、醒图桌面专业版与对话式修图 |

这些厂商都没有可核对的官方更新日志或开源实现，名称和上线时间在不同报道之间也有出入。因此本轮**没有**据此新增图像功能。对话式修图与按内容推荐，本项目已有对应的智能体候选流程和像素检查；本轮对运行时的改进（可执行错误、运行台账、收敛控制）直接作用于这条流程。录音笔记、导图、相册智能剪辑尚未实现，需要先找到可核对的一手资料或开源实现再立项。

## 5. Apple 界面规范

| 来源 | 类型 | 确认到的规范 | 本轮采纳 |
| --- | --- | --- | --- |
| [HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)，[Liquid Glass 概览](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) | 一手 | Liquid Glass 用于浮在内容之上的控件和导航层，内容层用标准材质；越厚的材质对比度越好；用户可以开启“降低透明度”或“减弱动态效果” | 文档工具栏作为浮层，使用半透明背景加模糊，正文“纸张”保持不透明 |
| [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | 一手 | 不为动效而加动效；动效响应直接操作 | 只给弹出层加 140ms 出现动画；开启“减弱动态效果”时关闭全部过渡 |
