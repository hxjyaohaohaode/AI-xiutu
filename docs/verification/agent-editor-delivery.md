# 智能体与编辑器交付验收

## 大图、画幅与交付

用正常工作台路径验证：助手提议 864 × 1536 像素的竖幅插画，报价 3 个测试服务点，点击后数据库出现一个任务。模型适配器收到相同尺寸，私有素材的 PNG 解码也为 864 × 1536。打开该结果继续编辑，在原导出窗口选择长边 1080，实际下载并独立解码的 PNG、JPEG、WebP 均为 608 × 1080。报价还根据引用素材的宽高比、模型开放尺寸、像素步长和整批预算选择尺寸，用户点下的报价与提交的是同一份参数。模型响应使用本地协议样本。[完整浏览器场景](../../scripts/qa/agent-image.browser.mjs) · [尺寸和报价测试](../../apps/web/test/ai-capabilities.test.ts)

导出尺寸按裁切和旋转后的画面计算。默认保留编辑栅格可输出的全部像素，按长边缩小时保持比例；透明像素按 Alpha 加权参与缩放。超过编辑预算的原片和编辑代理分别标尺寸，原件下载保留源字节。浏览器支持 Worker、OffscreenCanvas 和流式压缩时，静态 JPEG/PNG 的全局逐像素调色、裁切、直角旋转和翻转可以重新读取原片、分条带计算并输出原分辨率 PNG。含图层、局部修复、蒙版等空间操作的配方按编辑副本的实际尺寸输出。[导出工作线程](../../apps/web/src/editor/render.worker.ts) · [尺寸和透明边缘测试](../../apps/web/test/export-size.test.ts) · [Adobe Lightroom 长边与禁止放大](https://helpx.adobe.com/lightroom-classic/desktop/export-photos/export-files-disk-or-cd.html) · [libvips 的透明图缩小实现](https://github.com/libvips/libvips/blob/master/libvips/resample/thumbnail.c)

真实 48 MP Worker 验收对 25,235,741 字节、EXIF 6 的相机片施加 +0.45 EV、色温 −14、90° 旋转和翻转，得到 8000 × 6000 PNG（163,465,937 字节）。四角、相邻像素和条带交界等 12 处的 RGBA 均与同一浏览器从原件独立解码、执行参考算法的结果相同。另用透明 PNG 比对全部像素。PNG 文件尺寸取决于图像内容；实际下载字节数显示在导出面板。[正式 Worker 与参考像素](../../scripts/qa/original-photo-export.browser.mjs) · [四种旋转和全部翻转的像素回归](../../packages/editor/test/original-photo-export.test.ts)

常规项目导入使用既有的私有素材、配额和版本机制。相机 JPEG 原文件 25,235,741 字节，EXIF 转正后为 6000 × 8000；项目代理为 1773 × 2364，发往测试图像服务的参考图为 768 × 1024。24,010,907 字节的 PNG 在原件、项目代理、模型输入三处分别为 3200 × 2500、2317 × 1810、1024 × 800。服务重启后对两个私有原件重算 SHA-256，逐字节一致。另在新浏览器会话中，从已保存的 8 MP 作品直接下载原片编辑成品。工作台提取私有原件、校验 SHA-256、完成 Worker 编码。用独立解码器读取下载的 PNG，32,000,000 个 RGBA 字节全部与原图解码结果一致（SHA-256 `574e6f6967b5a242a42b0fe568ec09511453a9a672887be1ecb1c0df852e35f3`）。测试包含断点、分块重放和原件访问范围。[大图 HTTP 回归](../../scripts/qa/large-photo.mjs) · [同一编辑器的浏览器回归](../../scripts/qa/large-photo.browser.mjs)

从部署前 main 的 schema 28 直接升级到 30，随后重复执行迁移。原有 28 个迁移时间戳、8 张表的 11 条历史记录完整保留；已有上传任务仍为 studio 模式，原有 4,000,000 字节分块进度保留。[迁移清单](../../packages/db/src/index.ts) · [普通照片兼容迁移](../../packages/db/src/schema-v30.ts)

语音客户端在 30 秒内未收到服务端 ready 时释放麦克风和连接。短暂拥塞后继续发送新的实时语音帧，持续拥塞时报告失败并保留原会话的核验入口。迟到的网络事件不会重复报错或创建新的付费会话。[连接生命周期与网络回归](../../apps/web/test/voice-connection.test.ts)

合并后的复验暴露过一个团队语音状态同步问题。作品产生新版本时，观察者若正在等待数据库重新核对权限，可能错过唯一一次“AI 上下文待更新”的房间状态。回归测试用实际 PostgreSQL 表锁稳定重现。服务端在成功复核后为错过变化的成员补发当前状态一次；已撤权成员断开连接，音频和字幕保持实时传递。[房间状态与权限复核](../../apps/api/src/assistant/team-voice.ts) · [慢查询和成员撤权的 WebSocket 回归](../../apps/api/test/team-voice.test.ts)

窄画布的工具栏允许整组换行，给拼图和布局按钮各自保留可点击区域。在手机上收起顶部导航时，已有的导航按钮使用同一产品标识。浏览器验收同时检查按钮中心的实际点击目标、暗色手机上标识的可见性，以及标识与 favicon 的源文件一致性。[响应式编辑流程](../../scripts/qa/system-redesign.browser.mjs)

## 上次开发基线（schema 29）

数据库迁移至 schema 29 后，按用户在同一工作台内的实际操作验收。以下结果来自隔离的原生 PostgreSQL、生产构建的网页或注明的单元测试。模型、审核与语音供应商在这些测试中由可控的本地服务代替，测试积分只写入测试库。

在 Node 24.22.3、PostgreSQL 18.6 上运行 `npm test`，1,172 项通过，失败、跳过、取消均为 0，耗时 394 秒。测试启用中英文 Tesseract、RAW、HEIC 与 Ultra HDR 原生解码。生产依赖审计报告 0 条已知漏洞。

Chromium 生产构建验收通过 24 个助手场景，覆盖对话回放、项目切换、撤销、记忆、权限和移动端操作，页面运行错误为 0。项目文件浏览器回归实际下载四种格式、检查 PPT 封面、核对所选文档的版本与图表数值，记录到的外部请求和页面错误均为 0。[390 像素宽手机上的生图候选和实际报价](evidence/editor-agent-delivery/image-candidate-390.png) · [办公文件浏览器回归](../../scripts/qa/project-files.browser.mjs)

## 已实测

| 工作台操作 | 观察结果与复验入口 |
| --- | --- |
| 启动服务、处理排队任务 | 运行时按供应商、模型和操作逐项计算可用性。启用了能力却没有可运行模型时，部署检查返回失败。Worker 在数据库错误后以非零状态退出，使 Compose 的 `restart: on-failure` 能重新拉起服务。正常停机返回 0，有排队任务时连续处理。[部署检查测试](../../apps/api/test/doctor.test.ts) · [真实进程退出测试](../../apps/worker-ai/src/worker-process.test.ts) |
| 升级已有项目数据库 | 原生 PostgreSQL 18.6 从主分支 `10fab276` 建立 schema 28，写入 8 张表的 11 条代表性历史记录，含已完成和待核验派发。连续两次运行 `npm run db:migrate` 后均为 29。原 28 个迁移时间戳、历史用量和派发记录逐行一致，新派发的结算互斥约束生效。[迁移注册表](../../packages/db/src/index.ts) · [schema 29](../../packages/db/src/schema-v29.ts) |
| 在部署前检查 AI 能力 | 实际运行 `npm run doctor`。未配置供应商且关闭 AI 时退出 0，可执行操作为空，文字、图像、语音均未就绪。开启文字与语音并配置离线测试适配器、保留空执行模型目录时退出 1，报告缺少 `generate-text`、智能体模型档案和语音协议档案。两轮均未发出供应商请求。[诊断入口](../../scripts/doctor.ts) · [原生数据库回归](../../apps/api/test/doctor.test.ts) |
| 让助手分别复核色调、构图或交付 | 主助手最多并行请求两名专家，再汇总回复。专家只收到本轮明确共享的内容。原生 PostgreSQL 覆盖成功、拒绝、结果未知的混合分支，以及凭据迟到后只结算一次。总上限为四次模型请求，含最终汇总。[助手集成测试](../../apps/api/test/assistant.test.ts) |
| 在长对话继续编辑、选择可用模型 | 单元测试覆盖工具回合后重新计算上下文、保留用户原话与候选决定、已授权记忆按相关性排序。仅启用文字审核时，文字请求可继续，六类显式视觉输入在预占积分前被拒绝。[助手测试](../../packages/assistant/test/assistant.test.ts) · [模型选择测试](../../apps/web/test/model-selection.test.ts) · [接口契约](../../apps/api/API_V4.md) |
| 让助手生图、在现有作品上使用蒙版 | Chromium 中两轮助手调用后点击一次，形成一次图像派发、一个项目任务，保存并显示 1024 × 1024 PNG，计 3 个测试积分。像素测试另验同尺寸带 Alpha 的蒙版，完全保护处保留原 RGBA，半透明边界按覆盖率混合。[浏览器生图](../../scripts/qa/agent-image.browser.mjs) · [像素断言](../../packages/multimodal/test/masked-output.test.ts) |
| 两人通话、邀请 AI、主持人掉线 | 两个 Chromium 页面使用合成麦克风，经真实 WebSocket 与 PostgreSQL 覆盖成员互听、字幕、同意后共享音频、主持人断线后找回已结算会话，以及单人通话中检索。两端各连续播放 40 段，共 1.6 秒。[团队通话浏览器测试](../../scripts/qa/team-voice.browser.mjs) |
| 下载图片、分享文件、撤销项目共享 | 访客在五种视口下载同一张 480 × 336 PNG，同一文件交给 Web Share 测试替身，字节长度均为 294,532，SHA-256 一致。完整工作台启动回归共 17 组、27 张截图，页面运行错误为 0。[工作台启动回归](../../scripts/qa/launch-readiness.browser.mjs)。项目共享方式由空间策略决定，跨项目撤销被拒，重复撤销只记一条审计。[图片导出](../../apps/web/test/export-flow.test.ts) · [项目共享接口测试](../../apps/api/test/integration.test.ts) |
| 从项目已有表格创作、下载并编辑图表 | 浏览器读取真实 XLSX，选择「源数据」工作表的 A1:C3，单击导入后保存项目文档 v1。从该文档进入「用此文档与 AI 创作」，提交「把源数据整理为可编辑图表」。服务端按文档 ID 和版本接单，Worker 获得本地供应商返回的表格，测试账本结算 2 分。从结果下载 XLSX，用 openpyxl 读回武汉的 12、50% 和恩施的 −3、37.625%，两张图的数值区分别指向 `Data1!$B$2:$B$3`、`Data1!$C$2:$C$3`。[输入与输出契约](../../apps/api/API.md) · [文件断言](../../apps/web/test/project-file-export.test.ts) |
| 下载 Word、PowerPoint、Excel 与独立图表 | 四种浏览器视口分别下载 DOCX、PPTX、XLSX、SVG。Word、PowerPoint 样本在 LibreOffice 渲染后目视检查。选择「含当前画面」后，解包 PPTX 确认含所选作品的 64 × 48 JPEG 封面。文件测试另查可编辑表格、内嵌图表工作簿、前导零编号、引号内空格和中文长单元格。[文件导出实现](../../apps/web/src/project-files/) · [文件断言](../../apps/web/test/project-file-export.test.ts) |

关闭工作台页面时，事件长轮询会立即停止等待。在真实 HTTP 连接和 PostgreSQL 上，修复前断开后仍有一次查询，修复后为零。此前浏览器验收结束时另见一个匿名服务端错误，其日志缺少路由，无法逐条归因。[连接断开回归](../../apps/api/test/event-disconnect.test.ts)

## 已覆盖的范围与生产待验

| 部分覆盖 | 上线前验收条件 |
| --- | --- |
| 已确认的派发可以对账和回放，结果未知的外部调用保留预占。现有编排覆盖三种固定职责。 | 在目标部署实际重启 API、Worker，断开上游连接并核对供应商账单。通用工作流从任意节点继续执行、跨任务长期规划仍须另行实现及验证。 |
| 图片用本地协议样本验证入库与保护区像素。 | 使用已开通的模型，用同一批真实照片核查细发、肤质、背景与色彩。记录导出格式、尺寸与耗时。2K、HDR 往返及与商业修图产品的盲评尚待实测。 |
| 语音已测浏览器音频管线，分享已测文件交接。 | 在目标手机与桌面使用实际麦克风、扬声器、付费语音模型和系统分享面板。验证回声、打断、首声延迟、切后台恢复及接收应用打开文件。 |
| 数据源支持已保存的文本，以及从 XLSX、CSV、TSV 导入的可见表格区域。选区保存文件名、SHA-256、工作表、A1 范围和缓存公式数，原文件留在本机。AI 源文档上限 5,000 个 Unicode 码点。首列作为分类，完整数值列生成原生图表。 | 用实际文本模型核对其引用值和缺失值处理，再在桌面版 Office 打开文件、修改数值、确认图表跟随并保存重开。本次 XLSX 仅独立读回数据、格式及图表关系。工作表样式、宏、公式重算及透视表仍由原办公软件处理。 |

日常回归从仓库根目录运行 `npm run verify`，使用专用 `TEST_DATABASE_URL`。生图、语音及[办公文件浏览器回归](../../scripts/qa/project-files.browser.mjs)另外需要已构建的前端、可用 Chromium、`CI=true` 和名称含 `test` 的临时数据库。运行 `node --import tsx scripts/qa/project-files.browser.mjs` 可复验实际下载、嵌图封面、源文档版本、结算与原生图表范围。办公文件的快速回归命令为 `TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --import tsx --test apps/web/test/project-file-export.test.ts`。

导入回归使用 openpyxl 写出的多表工作簿和 XlsxWriter 写出的共享字符串工作簿。样本覆盖隐藏表、隐藏行列、合并单元格、带日期格式的数值、文本编号、缓存零及缺少缓存的公式。CSV/TSV 另验引号、跨行文本、UTF-16 和百分比。[多工作表样本](../../scripts/qa/fixtures/project-data.xlsx) · [共享字符串样本](../../scripts/qa/fixtures/shared-strings.xlsx) · [导入回归](../../apps/web/test/spreadsheet-import.test.ts)

固定依赖为官方 SheetJS CE 0.20.3。源码的 `parse_sst_xml` 读取共享字符串，`parse_ws_xml_data` 处理单元格类型、数值格式和公式；在未写入缓存的公式上，启用公式解析可能补数值零。本项目再用关闭公式解析的读数验证缓存，只允许确实存在的缓存零。工作簿样式或宏不复制到项目文档，不执行公式，也不读取隐藏工作表中的内容作为模型上下文。原文件留在本机，项目保存所选区域的值及来源信息。[官方发行包及源码](https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz) · [单元格模型](https://docs.sheetjs.com/docs/csf/cell/) · [公式语义](https://docs.sheetjs.com/docs/csf/features/formulae/) · [OOXML 共享字符串](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table)

封面归属回归覆盖跨项目、底图错配、截图时切换项目及文件编码过程中变更账号、作品版本、源或配方。导出器会在下载前复核。结构限额回归覆盖稀疏大表、图表重复引用的长分类标签及 PowerPoint 超长表头。超限会提示拆分或调整数据。[具体限额](../../apps/api/API.md) · [回归用例](../../apps/web/test/project-file-export.test.ts)

## 第一方参考与对应取舍

| 领域 | 参考实现 | 用于核对的行为 |
| --- | --- | --- |
| 智能体 | DeepSeek Harness [扩展机制](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/capability-seams.md) · [压缩](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md) | 分工协作、较早历史的压缩与恢复。 |
| 智能体 | OpenAI Codex [子智能体派发源码](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs) · [上下文压缩源码](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs) | 父任务派发独立子任务，结合当前上下文继续工作。 |
| 智能体 | Anthropic [Claude Code 子智能体](https://code.claude.com/docs/en/sub-agents) | 角色有自己的上下文和工具范围，据此限制专家收到的资料。 |
| 智能体 | Google [ADK 并行工作流](https://adk.dev/agents/workflow-agents/parallel-agents/) | 独立职责并发执行，分别保存输出供后续步骤汇总。 |
| 智能体 | Microsoft [Agent Framework 检查点](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints) | 执行器状态、待投递消息和恢复点，用于辨别事件回放与工作流续跑。 |
| 修图 | 醒图[开发者产品页](https://apps.apple.com/cn/app/id1500526240) | 一键肤质调整、精细人像和参考图修图，作为真人样片的检查项目。 |
| 修图 | 美图秀秀[智能选区](https://pc.meitu.com/pchelp/photoedit/zhinengxuanqu20240428) | 用户在选区内调整或重绘，输出要核对选区内外。 |
| 修图 | OPPO [ColorOS 17 发布说明](https://www.oppo.com/cn/newsroom/press/549/) | 自然语言描述目标效果，OPPO 公布的 2K、HDR 为待比测指标。 |
| 修图 | Adobe [Photoshop 图层蒙版](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/edit-and-refine-layer-masks.html) | 用灰度控制隐藏与显现程度，据此覆盖羽化边缘与受保护像素。 |
| 修图 | Google [Photos 聊天检索与编辑](https://support.google.com/photos/answer/15318661?hl=en) | 从已选照片在对话中继续工作，据此核对资源选择和操作上下文。 |
| 办公 | Microsoft [Copilot 生成演示文稿](https://support.microsoft.com/en-us/microsoft-365-copilot/prepare-your-presentation-with-microsoft-365-copilot) | 参考其用资料生成演示初稿的流程。项目文档和实际导入的选区可进入同一 AI 创作入口，结果导出为可编辑的 PPTX。 |
| 办公 | Google [Slides 与 Gemini](https://support.google.com/docs/answer/14355071) | 参考其在创作时显式选取来源的设计。此处可选文件、工作表及区域，形成单独的项目文档版本，再按 ID 与版本绑定 AI 请求。 |
| 办公 | Canva [AI 图表](https://www.canva.com/help/ai-charts/) | 参考其从 CSV 创建可编辑图表的工作流。项目保留引号内分隔符、跨行文本和百分比，按完整数值列生成可编辑图表。 |
| 办公 | Gamma [演示文稿](https://gamma.app/products/presentations) | 参考其从资料或提纲转演示稿的流程。文本、数据表和当前项目画面可分别成为 PowerPoint 的正文、原生表格与封面。 |
| 办公 | Apple [Numbers 图表与数据](https://support.apple.com/en-sa/guide/numbers-ipad/tan727160fa/ipados) | 参考其让图表随源单元格变化的方式。XLSX 的每张图保留同一工作簿内的数值区引用，在浏览器测试及 openpyxl 中独立核对。 |
| 办公 | 金山 [WPS Office](https://www.wps.com/) · [套件说明](https://www.wps.com/feature/productivity-suite/) | 从已有文件生成仍可编辑的演示，并在同一套件交付文档、表格与幻灯片，用来核对项目内的统一入口。 |
| 办公 | [ONLYOFFICE Docs](https://helpcenter.onlyoffice.com/docs/getting-started) · [Apple iWork](https://www.apple.com/iwork/index.html) | 对照分别面向文稿、工作表和演示的编辑能力。目标格式需要保留文本、数值、图表和图像对象。 |
| 交互 | Apple HIG [工具栏](https://developer.apple.com/design/human-interface-guidelines/toolbars) · [菜单](https://developer.apple.com/design/human-interface-guidelines/menus) | 高频操作留在当前工作流，相关下载格式集中选择，低频分享设置按需展开。 |

产品页用于确认公开的功能、交互与输出目标。醒图、美图秀秀和 ColorOS 的专有成像算法及商业模型权重均未取得。
