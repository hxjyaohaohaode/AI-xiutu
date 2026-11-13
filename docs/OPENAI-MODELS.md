# OpenAI 模型、接口和参数核对

核对日期 2026-11-13。以 AI-xiutu 项目在 OpenAI Playground 中显示的选项、项目密钥请求 `GET /v1/models` 的返回、官方模型说明及真实请求回执为依据。测试项目返回 96 个 ID，均有对应的应用适配器。`运营 → 语音与协作模型 → OpenAI 项目模型清单` 可重新读取当前服务器所用项目。启用模型和设置服务点由运营完成。模型会更新、下线或按项目限流。[官方模型目录](https://developers.openai.com/api/docs/models) · [项目模型查询](https://developers.openai.com/api/reference/resources/models/methods/list) · [退役公告](https://developers.openai.com/api/docs/deprecations)

## Responses

模型及快照的精确 ID、官方上限、可选值和来源写在 [responses-models.ts](../packages/assistant/src/responses-models.ts)。当前包含官方 Playground 中 47 个可选模型，均以对应 ID 收到正式 Responses 回复。产品服务点按运营确认的模型配置预占，实际档位和供应商用量进入派发记录。应用每次响应使用 256–8192 输出 token 预算，且不会超过所选模型的限制。基础控制已接入运营设置，普通用户可在助手设置覆盖本轮的推理档位和详细度，价格和服务档位由服务器配置。[Responses 请求](https://developers.openai.com/api/reference/resources/responses/methods/create) · [推理指南](https://developers.openai.com/api/docs/guides/reasoning)

| 官方型号或系列 | `reasoning.effort` | 默认或其他约束 |
| --- | --- | --- |
| GPT-6 Astra、GPT-6.1 Sol | `low, medium, high, xhigh, max` | 默认 `medium`，支持 `standard/pro`、Flex、Fast、Ultrafast |
| GPT-6.1 Terra、GPT-6 Sol、GPT-6 Luna、GPT-5.6 Sol/Terra/Luna | `none, low, medium, high, xhigh, max` | 默认 `medium`，支持 `standard/pro`、Flex、Fast。采样在有效档位 `none` 时开放 |
| GPT-5.5 | `none, low, medium, high, xhigh` | 默认 `medium` |
| GPT-5.4 / Mini / Nano、GPT-5.2 | `none, low, medium, high, xhigh` | 默认 `none` |
| GPT-5.5 Pro、GPT-5.4 Pro、GPT-5.2 Pro | `medium, high, xhigh` | 5.5 Pro 默认 `high`。支持 JSON Schema 及流式终态。5.2 Pro 的 Flex 请求实测容量不足 |
| GPT-5.3-Codex | `low, medium, high, xhigh` | 已公告停用日期，仍可调用 |
| GPT-5.1 | `none, low, medium, high` | 默认 `none` |
| GPT-5 / Mini / Nano | `minimal, low, medium, high` | 使用 `minimal` 时仍有推理。仅配置真实可用的服务档位 |
| GPT-5 Pro | `high` | 只有 `high`。单次回复可能耗时较长 |
| o3 | `low, medium, high` | 不接受 `concise` 摘要 |
| `chat-latest` | 随官方别名有效设置 | 实测 `low` 推理、自定义采样温度及 `low` 详细度被拒绝 |
| GPT-4.1 / Mini、GPT-4o / Mini | 无可调推理档位 | 支持采样和结构化输出，已公告停用日期 |

| 官方字段 | 含义和参数 |
| --- | --- |
| `reasoning.mode` | `standard` 默认，`pro` 增加推理计算。与 `effort` 是两个独立参数，按模型验证 |
| `reasoning.summary` | 不传、`auto`、`concise`、`detailed`。可用范围按型号，合规审核后的摘要在回复内展开 |
| `text.verbosity` | `low/medium/high`，影响可见文字细节程度。支持此字段的模型通常默认 `medium` |
| `text.format` | `text` 为默认文本，`json_object` 为 JSON 对象，`json_schema` 需要名称、对象 Schema 和严格模式。结构化响应完成后才交付，复制得到原始回复文本 |
| `temperature` / `top_p` | 采样温度 `0–2`，核采样概率 `0–1`，官方默认通常为 `1`。后台检查型号和生效推理档位 |
| `service_tier` | `default`、型号支持的 `fast`（`priority` 为官方等价请求值）、`ultrafast`、`flex`。以回执实际档位为准，非标准档位不套用标准价估算 |
| 传输 | HTTP JSON、HTTP SSE，已适配型号可由服务器用官方 Responses WebSocket 发起。应用每次派发独立关联收据；出现未知结果进入核对 |
| `store` / `tools` | 应用显式 `store:false`。现有编辑候选、已授权素材检索及显式公开网页/图片查询走产品权限。Playground 的供应商留存开关、托管文件检索、解释器、Shell、任意 MCP 和自定义远端函数仍无产品入口 |

部署用量以真实回执为依据。`flex`、Fast、Ultrafast 的项目额度与价格不同。已维护标准费率的型号按回执区分普通输入、缓存读取与缓存写入。缺少计量明细的历史回执只显示能核对的费用。较长任务可能超过应用的 140 秒单次等待，后台任务及长时间恢复暂未开放。[服务档位与定价](https://developers.openai.com/api/docs/pricing) · [缓存计费](https://developers.openai.com/api/docs/guides/prompt-caching) · [Fast](https://developers.openai.com/api/docs/guides/fast-mode) · [Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode) · [WebSocket](https://developers.openai.com/api/docs/guides/websocket-mode)

## Images

11 个精确 ID 支持从生图/编辑路径使用。2、2.5 Sunburst/Flare 及其快照、2.6 Sunburst/Flare 支持可用档案内的自定义尺寸。应用按 16 像素步进、1:3 到 3:1、最多 8,294,400 像素、最长边 3840 检查。2.6 Flare 的 `3840x2160` 有真实回执。`gpt-image-1.5`、`gpt-image-1-mini` 和 `chatgpt-image-latest` 开放 `1024x1024`、`1536x1024`、`1024x1536`。选 `auto` 时以实际出图尺寸为准，并在入队前确认三种标准尺寸均在该配置的预算内。[Images 生成参数](https://developers.openai.com/api/reference/resources/images/methods/generate) · [Images 编辑参数](https://developers.openai.com/api/reference/resources/images/methods/edit) · [图像生成指南](https://developers.openai.com/api/docs/guides/image-generation)

| 官方字段 | 应用行为 |
| --- | --- |
| `quality` | 默认 `auto`，标准 `low/medium/high`。2.5 / 2.6 增加 `xhigh/max`。运营可限制可选质量、单张点数和批量张数 |
| `complexity` | 2.6 支持 `low/medium/high`，控制构图规划投入；默认留空让上游选值 |
| `n` | 官方 1–10，默认 1。应用以型号设置、整批像素和费用预算共同检查 |
| `background` | `auto/opaque/transparent`，默认 `auto`。透明要求支持 Alpha 的 PNG/WebP |
| `output_format` / `output_compression` | PNG 默认，可请求 JPEG/WebP。JPEG/WebP 可发整数 0–100，官方默认 100。应用把审核后的结果保存为规范 PNG |
| `moderation` | `auto/low`，默认 `auto`。两种取值仍经过应用的输入、输出审核 |
| `input_fidelity` | 仅编辑使用。GPT Image 1.5 支持 `low/high`，1 mini 支持 `low`，其余档案交由上游处理 |
| `images` / `mask` / `markup` | 绑定当前有权读取的真实素材。蒙版与标注互斥，标注由 2.5/2.6 接入，首张参考和引导图需满足尺寸与透明度条件 |
| `stream` / `partial_images` | Images 2 系列支持单张流式请求。Worker 读取供应商 SSE 终态并审核最终图。运营可通过 `OPENAI_IMAGE_PARTIALS_ENABLED=true` 开放 `partial_images=0–3`，每个请求的部分图按当前单张点数计入本轮报价。界面暂未播放中间图 |
| `svg` / GIF | 测试项目实际返回过 SVG（需要明确 `svg.model`，作者有独立 token）及 512×512 双帧 GIF（`frame_count` 为 2–16）。应用尚缺向量净化、逐帧审核、原格式下载与新增费率结算 |

## 语音和其他专用模型

- **Realtime 通话**覆盖 8 个 ID 和 **GPT-Live** 的 `gpt-live-1`。可分别选通话模型、音色与委派的 Responses 模型。Realtime 2 系列支持 `minimal/low/medium/high/xhigh`，Realtime 1.x 没有该推理控件。Realtime 音色取官方 10 项。Live 预设目录为 38 个官方名称，`marin` 为默认，`gleam` 可选。Live 的风格提示、开场白及 `acknowledgement_delay_ms`（0–800）随会话冻结。开场经官方事件请求，语音实际开始时间及措辞由模型决定。[Realtime 参数](https://developers.openai.com/api/reference/resources/realtime/client-events) · [GPT-Live 开场与音色](https://developers.openai.com/api/docs/guides/live-conversations) · [Live 委派](https://developers.openai.com/api/docs/guides/live-delegation)
- **通话转写**核验了 8 个模型，包括两个 4o mini 快照、`gpt-transcribe`、`gpt-live-transcribe`、`gpt-realtime-whisper` 和 `whisper-1`。可设置 ISO 639-1 语言、型号适用的转写提示或 Whisper 延迟档、降噪 `near_field/far_field`、语速 `0.25–1.5`。`server_vad` 按音量和静音判停，阈值 `0–1`，应用默认 `0.5`、前置缓冲 300ms、判停 600ms；`semantic_vad` 按语意判停，积极度 `auto/low/medium/high`。本应用的安全输出预算目前限制为 4096 token，PCM 固定 24 kHz 单声道。禁用 VAD 后的手动提交、闲置触发和原生 OpenAI Responses/Decisions 委派仍需接入。[Realtime 语音活动检测](https://developers.openai.com/api/docs/guides/realtime-vad)
- **录音转写**使用 `/v1/audio/transcriptions`，运营可启用 `gpt-transcribe`、`gpt-4o-transcribe`、`gpt-4o-transcribe-diarize`、`gpt-4o-mini-transcribe` 及两份快照、`whisper-1`。现有录音入口提交 30 秒以内的单声道 PCM WAV，可设 ISO 639-1 语言、`temperature`（0–1，默认 0）及型号支持的提示。`gpt-transcribe` 可另设候选语言与关键词。diarize 使用 `diarized_json` 并返回说话人，拒绝 `prompt`。Whisper 可选词级、段级或两种时间戳，通过 `verbose_json` 取回。SRT/VTT、说话人参照音频与 token 置信度暂无应用入口。`gpt-live-transcribe` 的文件 API 返回 404，实时通话转写成功。[录音转写接口](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
- **专用模型**通过现有「切换 AI 任务」进入 AI 朗读、音频问答、联网搜索、文本向量和语音翻译。7 个朗读、5 个音频问答、2 个联网搜索、3 个嵌入和 1 个语音翻译 ID 均通过应用入队、真实供应商请求、结果落库及服务点结算。语音翻译把确认提交的录音通过官方实时翻译 WebSocket 发送，输出译文和 WAV。2 个 `omni-moderation` ID 可由服务端选择用于审核。[朗读](https://developers.openai.com/api/docs/guides/text-to-speech) · [音频 API](https://developers.openai.com/api/docs/guides/audio) · [嵌入](https://developers.openai.com/api/docs/guides/embeddings) · [实时翻译](https://developers.openai.com/api/docs/guides/realtime-translation)

| 专用接口 | 官方参数与用途 |
| --- | --- |
| Speech | `input` 最多 4096 字符。`voice` 按型号从内置音色选，GPT-4o mini TTS 另有 `instructions`，指定语气、情绪或语速。`speed` 为 `0.25–4.0`，默认 `1.0`。`response_format` 默认 `mp3`，也可选 `opus/aac/flac/wav/pcm`。`stream_format` 默认 `audio`，GPT-4o mini TTS 还接受 `sse`。 [Speech 请求](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create) |
| Audio Chat Completions | 官方支持 `modalities=["text"]` 或 `["text","audio"]`。前者须有录音输入，后者允许纯文字输入。音频输出需 `audio.voice` 和 `audio.format`。应用录音使用规范 WAV，已实测六种输出容器。 [Chat Completions 请求](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| Search Chat Completions | `web_search_options.search_context_size` 为 `low/medium/high`，默认 `medium`。可选 `user_location.type=approximate`，下含 `city/country/region/timezone`，用于调整搜索的地域相关性。结果附来源注释。 [Search 模型](https://developers.openai.com/api/docs/models/gpt-5-search-api) |
| Embeddings | `input` 为字符串、字符串数组或 token 数组。单条最多 8192 tokens，总批次最多 300,000 tokens。`encoding_format` 为 `float/base64`，默认 `float`。3 Small 默认 1536 维，3 Large 默认 3072 维，两者可指定较低的 `dimensions`。Ada 002 固定 1536 维。 [Embeddings 请求](https://developers.openai.com/api/reference/resources/embeddings/methods/create) |
| Realtime Translate | 在专用 WebSocket 以 `session.update` 设置 `audio.output.language`，以 `session.input_audio_buffer.append` 发送 PCM 音频。结束时发送 `session.close`，等待 `session.closed` 后断开，排空剩余译文和语音。 [实时翻译协议](https://developers.openai.com/api/docs/guides/realtime-translation) |

运营启用专用任务需在 API 和 Worker 一起设置 `OPENAI_SPECIALIST_ENABLED=true`、注入服务端密钥和审核配置、应用数据库迁移 23，并在「模型能力」启用对应型号。结果音频按字节纳入项目空间存储额度，通过当前已验证项目成员的同源接口播放或下载。应用的专用任务采用显式提交和完整结果交付。朗读 SSE、账户级自定义音色、音频多轮和实时麦克风同传、批量向量输入暂无对应入口。

## 验收证据

本机 `artifacts/acceptance-20261113/openai` 保存脱敏 JSON。`models.json` 是 96 个项目 ID，`responses.json` 是 47 个文本型号的逐一响应，`responses-options.json`、`responses-constraints.json` 和 `responses-transport-edge.json` 保存真实参数的正反例。`application-responses-all.json` 记录 47 个模型从应用发起到真实回执和服务点结算，40 条因同一审核项目集中调用触发限制后使用隔离审核夹具复验，模型请求仍为真实请求。`images.json` 与 `images-extended.json` 覆盖 11 个图像型号。`application-worker-expanded.json` 记录自动画幅与说话人识别，`application-image-stream.json` 记录流式终态，`application-transcription-options.json` 记录 Whisper 时间戳和候选语言，`application-specialists.json` 记录 18 个专用模型的真实应用任务。语音采用合成素材，实体设备、较长会话、商用网络及生产账号还需验收。
