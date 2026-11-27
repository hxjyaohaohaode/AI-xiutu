# 智能体与编辑器交付验收

数据库迁移至 schema 29 后，按用户在同一工作台内的实际操作验收。以下结果来自隔离的原生 PostgreSQL、生产构建的网页或注明的单元测试。模型、审核与语音供应商在这些测试中由可控的本地服务代替，测试积分只写入测试库。

Chromium 生产构建验收通过 24 个助手场景，覆盖对话回放、项目切换、撤销、记忆、权限和移动端操作，页面运行错误为 0。[390 像素宽手机上的生图候选和实际报价](evidence/editor-agent-delivery/image-candidate-390.png)

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
| 下载图片、分享文件、撤销项目共享 | 访客在五种视口下载同一张 480 × 336 PNG，同一文件交给 Web Share 测试替身，页面无运行错误。项目共享方式由空间策略决定，跨项目撤销被拒，重复撤销只记一条审计。[图片导出](../../apps/web/test/export-flow.test.ts) · [项目共享接口测试](../../apps/api/test/integration.test.ts) |
| 从项目已有表格创作、下载并编辑图表 | 浏览器从已保存的文档 v1 进入「用此文档与 AI 创作」，提交「把源数据整理为可编辑图表」。服务端按文档 ID 和版本接单，Worker 获得本地供应商返回的表格，测试账本结算 2 分。从结果下载 XLSX，用 openpyxl 读回武汉的 12、50% 和恩施的 −3、37.625%，两张图的数值区分别指向 `Data1!$B$2:$B$3`、`Data1!$C$2:$C$3`。[输入与输出契约](../../apps/api/API.md) · [文件断言](../../apps/web/test/project-file-export.test.ts) |
| 下载 Word、PowerPoint、Excel 与独立图表 | 四种浏览器视口分别下载 DOCX、PPTX、XLSX、SVG。Word、PowerPoint 样本在 LibreOffice 渲染后目视检查。选择「含当前画面」后，解包 PPTX 确认含所选作品的 64 × 48 JPEG 封面。文件测试另查可编辑表格、内嵌图表工作簿、前导零编号、引号内空格和中文长单元格。[文件导出实现](../../apps/web/src/project-files/) · [文件断言](../../apps/web/test/project-file-export.test.ts) |

## 已覆盖的范围与生产待验

| 部分覆盖 | 上线前验收条件 |
| --- | --- |
| 已确认的派发可以对账和回放，结果未知的外部调用保留预占。现有编排覆盖三种固定职责。 | 在目标部署实际重启 API、Worker，断开上游连接并核对供应商账单。通用工作流从任意节点继续执行、跨任务长期规划仍须另行实现及验证。 |
| 图片用本地协议样本验证入库与保护区像素。 | 使用已开通的模型，用同一批真实照片核查细发、肤质、背景与色彩。记录导出格式、尺寸与耗时。2K、HDR 往返及与商业修图产品的盲评尚待实测。 |
| 语音已测浏览器音频管线，分享已测文件交接。 | 在目标手机与桌面使用实际麦克风、扬声器、付费语音模型和系统分享面板。验证回声、打断、首声延迟、切后台恢复及接收应用打开文件。 |
| 数据源支持项目中已保存的文本，表格支持 Markdown、CSV、TSV。AI 源文档上限 5,000 个 Unicode 码点。首列作为分类，完整数值列生成原生图表。 | 用实际文本模型核对其引用值和缺失值处理，再在桌面版 Office 打开文件、修改数值、确认图表跟随并保存重开。本次 XLSX 仅独立读回数据、格式及图表关系。当前入口不支持上传任意 Excel 工作簿重新排版。 |

日常回归从仓库根目录运行 `npm run verify`，使用专用 `TEST_DATABASE_URL`。生图与语音浏览器脚本另外需要已构建的前端、可用 Chromium、`CI=true` 和名称含 `test` 的临时数据库。办公文件的快速回归命令为 `TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --import tsx --test apps/web/test/project-file-export.test.ts`。

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
| 办公 | Microsoft [Copilot 生成演示文稿](https://support.microsoft.com/en-us/microsoft-365-copilot/prepare-your-presentation-with-microsoft-365-copilot) | 将来源资料转成可继续修改的演示初稿。 |
| 办公 | Google [Slides 与 Gemini](https://support.google.com/docs/answer/14355071) | 在创作时显式引用所选文件，本项目绑定已保存的文档版本。 |
| 办公 | Canva [AI 图表](https://www.canva.com/help/ai-charts/) | 从已有数据制图，输出仍可编辑。 |
| 办公 | Gamma [演示文稿](https://gamma.app/products/presentations) | 从提纲或素材开始创作，最终交付可编辑的 PowerPoint。 |
| 办公 | Apple [Numbers 图表与数据](https://support.apple.com/en-sa/guide/numbers-ipad/tan727160fa/ipados) | 图表引用源数据区域。导出原生图表后需核对工作表单元格引用。 |
| 交互 | Apple HIG [工具栏](https://developer.apple.com/design/human-interface-guidelines/toolbars) · [菜单](https://developer.apple.com/design/human-interface-guidelines/menus) | 高频操作留在当前工作流，相关下载格式集中选择，低频分享设置按需展开。 |

产品页用于确认公开的功能、交互与输出目标。醒图、美图秀秀和 ColorOS 的专有成像算法及商业模型权重均未取得。
