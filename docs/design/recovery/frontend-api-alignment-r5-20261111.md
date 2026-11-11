# 前端 R5：AI、语音与运营接口对齐恢复稿

日期：2026-11-11。后端基线：`d5ad8db311a424c8e6a90487666f15b2806989f9`，Recipe v4 / engine 4.0.0、数据库 schema 20。

**保存状态**：执行环境在提交产品代码前再次不可用。本稿依据此前实际读取的仓库文件、实际打开的官方文档及已执行的测试编写；原工作区的 `docs/design/frontend-api-alignment-r5-20261111.md` 尚未写入。这份文件是恢复依据，不表示产品代码已经集成、发布或完成五轮浏览器验收。完整源码/局部补丁/缺失项分别见同目录下的 AI/voice/BOS recovery JSON，不以行为描述冒充完整 diff。

## 1. 与功能主表对应

主表是 `docs/research/PHOTO-EDITING-FEATURE-MATRIX.md`。本轮清单编号来自 `docs/design/R5-RESUME-20261111.md`，两套编号必须加前缀，避免把“主表 R06”误当成“本轮 R06”。

| 功能主表 | 本轮项目 | 本次前端范围 |
| --- | --- | --- |
| 主表 R03、R04、A12 | 本轮 C01、C04、E03 | 候选预览、取消、再预览与真实保存；工作节点、参数明细和授权预算 |
| 主表 R06 | 本轮 E02、C01、P06 | 同面板返回、结果旁确认/取消、BOS 表单与窄屏控制 |
| 主表 A02、A05 | 本轮 C02、P06 | 任务/供应商/服务端能力交集，模型目录刷新与参数合法组合 |
| 主表 A10、A11 | 本轮 C03 | 个人实时通话、团队语音、字幕/打断、设备错误和终态 |
| 主表 C07 | 本轮 C01、C03、P06 | 未决请求保留、幂等恢复、已确认回执和人工核验 |
| 主表 C13 | 本轮 P06、V08 | 额度、审计、品牌图标、模型配置和运营信息层级 |
| 主表 F06、F07 | 本轮 R07 | schema 20 的原生母版与预览契约边界；本区不改 native engine |

## 2. 图片模型：以服务端能力交集为准

实际读取：`packages/multimodal/OPENAI.md`、`packages/multimodal/src/openai.ts`、`apps/api/src/operations.ts`、`apps/api/src/app.ts`、`apps/web/src/ai/capabilities.ts`、`AIPanel.tsx`、`ImageParameters.tsx`。

前端只使用 `/v1/models` 返回的任务、运行状态、参数能力、运营边界与价格。模型名和型号前缀不构成能力声明。运营目录中的存在、执行环境配置完成和某个真实供应商账号拥有权限是不同事实。

| 项目 | 已读取的契约 | 前端处理 |
| --- | --- | --- |
| 任务类型 | `operations/runtimeOperations/availableOperations` | 文字、语音识别、调整建议不显示图像尺寸和质量表单 |
| 图片质量 | `parameterCapabilities.quality.values` 与运营 `allowedQualities` | 只列有效交集；不把六档复制给所有模型 |
| 规划复杂度 | `complexity.supported/values` | 仅声明支持时显示，与渲染质量独立 |
| 格式和透明度 | `outputFormat`、`background`、依赖关系 | 透明 JPEG 必须按当前档案改为透明格式或不透明背景 |
| 输出压缩 | `outputCompression.formats/min/max` | PNG 请求不带压缩字段；格式联动后再决定是否保留压缩 |
| 数量与尺寸 | 模型宽高、像素/比例、离散尺寸、步进、`n`、`batchLimits` | 同时验证单张与整批预算；不能只验证宽高输入范围 |
| 参考图与引导图 | `references.maxCount/allowMask/allowMarkup` | 撤销能力后移除不可用草稿；蒙版与 markup 互斥；仍由服务端检查授权及实际图片 |
| 价格 | `pricing` / 质量价格、输出数量 | 显示服务点报价；不将它描述成供应商实际货币账单 |
| 不支持功能 | SVG、GIF、stream、partialImages 等返回 `supported:false` | 普通参数区不堆放无效控件；前端不开放供应商适配器尚未完成的输出链 |

### 官方资料重新核对

本次实际打开以下官方页面，并检索到相应正文：

- [Images 生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate)：明确列出 2.5/2.6 精确 ID；压缩仅针对 JPEG/WebP；复杂度独立于渲染质量。
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)：费用估算章节明确给 2.5/2.6 Sunburst/Flare 五种显式质量档位，另有 auto；早期 Image 2 只有 low/medium/high 与 auto。
- [GPT-Image-2.6 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst) 与 [GPT-Image-2.6 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare)：两者均有独立公开档案，并提到复杂度、markup、SVG/GIF 等能力入口。
- [Images 编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit) 已实际打开；具体应用限制仍以本仓库适配器的严格校验为准。

本轮没有发现需要删除仓库 2.5/2.6 ID 或把 xhigh/max 从这些档案一刀切移除的依据。官方文档中有 SVG/GIF，也不能推出本应用已具备对应审核、存储、预算与结算链。仓库对 2.6 保留每边 1536、最多 1,572,864 像素的保守运行限制；这不是对官方最大能力的重新声明。

同一 ID 在 BOS 中调整后，未提交草稿应依据能力签名重新校验。此次已经实现并测试的 `reconcileImageOptions` 会保留仍合法的选择、移除被撤销的字段、收紧数量/压缩值，并处理格式依赖；它不会改写已经冻结的请求对象。AIPanel 的目录在面板可见、窗口重新聚焦和模型配置事件后重新读取，读取期间禁止新的提交。完整 AIPanel 集成 diff 因环境丢失只保留了部分片段。

最后追加到 LiveAssistant 的目录刷新效应**尚未通过测试**。恢复时需专门检查初始 `submissionBlocked` 与模型初选的时序，避免读取目录时因恢复锁而跳过初选，之后又没有重新选择。不得为修复该时序而覆盖活动通话、执行授权或冻结请求。

## 3. 候选与保存：决定记录不等于编辑版本

实际读取：`apps/api/src/assistant/index.ts`、`apps/web/src/ai/assistantGuards.ts`、`LiveAssistant.tsx` 与协作状态接口。

服务端允许尚未应用的 `previewed` 候选再次预览；`rejected` 不允许重新预览。请求仍需原 artwork、当前 headVersion、基准配方完全一致。已返回 `appliedRevisionId` 的候选表示真实保存回执，不能重新当作未保存预览应用。

新 `CandidateActions.tsx` 将“当前配方与候选配方相同且有待确认草稿”视为预览中，在结果旁显示确认和取消。取消恢复基准配方后，候选记录继续保持 previewed，但入口改为“重新预览”。只有仍匹配基准版本和配方时才可执行；无登录或缺源图身份也不可执行。

根组件已报告接入可选 `previewControls`：pending、saving、onConfirm、onCancel。确认继续调用现有 `collaboration.publishCurrent`；取消继续调用 `discardDraft`。没有增加私自提交接口，没有跳过 lease/CAS，没有由前端虚构 appliedRevisionId。

单元测试已经实际验证：预览 → 取消 → 再预览，两次走同一真实 guard；版本变化后在调用确认端点前拒绝；确认/取消文字紧邻结果。浏览器全链仍待恢复环境后复验。

## 4. 语音：设备、协议与计费终态分开

实际读取：`packages/assistant/src/models.ts`、`protocol.ts`、`apps/api/src/assistant/service.ts`、语音 API 测试，以及 `VoiceCapture/LiveAssistant/TeamVoiceControls/TeamVoiceBanner`。

- Live 与 Realtime 档案通过声明的 protocol 区分。应用 Live 启动消息不使用 `maxOutputTokens`，因此 BOS 中该无效输入已隐藏；Realtime 使用协议定义的输出预算。上下文预算/视觉 token 预留只出现在适用的文字模型配置中。
- 麦克风不存在、被拒绝、设备占用和格式限制共用 `voiceErrorMessage`；不会把未知计费状态改称设备错误。
- VoiceCapture 的实现曾加入同步 active 锁、请求 epoch、过期 track 停止与失败 recorder 的 onstop 防护。TeamVoiceControls 曾加入房间 epoch，旧请求的 finally 不可解锁新房间操作。完整长文件 diff 未恢复，不能仅凭本说明算已集成。
- 中断仍调用现有音频 client 的 interrupt，保持已验证的播放队列清理与可听片段报告。没有将静音当成挂断，也没有用 UI 文案宣称账单已结算。
- 个人通话/团队 AI 邀请结果未知时，保留原请求和核验入口，不自动重新发起收费调用。已知的服务端终态/账本才是结算依据。

此前本轮真实浏览器基线遇到 Requested device not found；这只验证了设备失败路径。不能据本地协议测试声称物理麦克风音质、跨公网多人通话或真实供应商计费已经验收。

## 5. BOS 保存与异步回执

| 区域 | 实际契约 | 已实现的前端决策与恢复注意 |
| --- | --- | --- |
| 助手模型 | PUT 带 `expectedHash`，服务端 hash CAS；响应只返回 ok | 写成功后读取新 hash；若后续 GET 失败，保留“已保存”事实、锁定继续编辑并提供重新读取。不能伪造新 hash |
| 图像模型 | PUT 版本自增，但没有 `expectedVersion` | 不宣传已具备并发配置 CAS；这是需要后端协同补齐的缺口 |
| 额度调整 | POST 返回 `adjustment` 与 `entitlements`，幂等 key/请求 hash 在事务内校验 | 先用权威回执更新对应用户余额、显示成功并轮换 key；后续列表 GET 失败只显示刷新提示，不把成功写入误报为失败 |
| Logo 上传 | 真实项目资产上传，随后保存站点配置 | 异步结果检查组件存活、配置页、项目及 epoch；函数式更新保留其他已编辑字段；切项目/重置不能被旧结果覆盖 |
| 审计 | `targetType/targetId/detail` | 对实际 action 给语义标签，有 reason 才显示原因；原 action/actor/id 收入详情。未知操作不猜业务含义 |
| 未决账务 | 人工核验与已确认回执 | 保留审阅确认、结算/释放选择与幂等；不增加自动重试 |

BOS 参数表单曾由六个通用滑杆改成按任务显示的精确数值输入；质量与分档价格使用当前档案。上述长组件的完整源文件不在恢复包中，需优先从恢复的原工作区拿 diff；无法恢复时应重新实现并重新验收，而不是按说明勾成完成。

## 6. schema 20 与原生母版边界

最新 main 与断点文档已经记录 immutable `media_grade_revisions`、native working buffer、原生母版预览及 MediaSourceViewer/useMasterPreview。它们与常规 V4 RGBA8 编辑存在独立能力和预算边界。

本区没有更改 native engine、原片存储、母版精度、原生渲染队列或预览协议，也不把普通 AI 候选应用宣传成 16/32 位全配方编辑。前端后续应继续按导入能力与真实母版 revision/preview 状态显示，不用 CSS 处理或截图替代原生处理成功回执。此项关联主表 F06/F07，具体像素一致性由已有母版测试和后端验收承担，本次没有重新做该验证。

## 7. 可恢复验证与未完成事项

已执行并可确认：

1. Web typecheck 退出 0；该结果早于最后的 LiveAssistant 目录刷新补丁。
2. 13 项相关测试通过，覆盖候选取消/重开、过期基准、同 ID 能力收紧、格式与压缩依赖和设备错误。
3. 现有 assistant guards 与 voice playback 定向测试通过，分别覆盖身份/作用域变化、晚到回执与播放中断。
4. 新 `scripts/qa/manual-ai-fixture.mjs` 本地 smoke 通过：返回 Responses SSE 工具调用及完成事件，拒绝非本地临时数据库，并关闭自己的 WS 监听。它不会调用 global fetch，也不连接真实供应商。
5. 主线程报告把该 fixture 放在显式 `--protocol-fixtures` 开关后并启动了临时预览；环境随后失效，没有完成新服务的 UI 联调。

待恢复后必须完成：保存完整工作区 diff；修正并验证最后目录刷新时序；真实候选确认/取消/再预览；个人/团队语音错误及已知/未知终态；BOS 十页和表单窄屏；额度写成功后刷新失败与 Logo 晚到结果；再按总清单走不少于五轮完整流程。现有单元测试不替代这些浏览器验收。
