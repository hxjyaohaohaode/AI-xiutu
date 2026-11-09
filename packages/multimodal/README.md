# @ai-xiutu/multimodal

服务端多模态供应商适配器：真实 HTTP 的 OpenAI Images 多图生成/编辑、火山方舟 Seedream 单图生成/参考图生成、阿里云 Qwen3-ASR-Flash 短语音识别，以及来自 `@ai-xiutu/providers` 的腾讯云 IMS 图片审核适配器导出。没有浏览器端凭证、假生成图、模拟识别文本或自动重试。

OpenAI 的官方参数证据、精确模型矩阵、环境开关、批次预算、蒙版/标注、暂不支持项和生命周期限制见 [OPENAI.md](OPENAI.md)。本文件后续单张限制专指Ark适配器，不限制OpenAI已实现的批次协议。

当前验证范围是本地类型检查、合成音频、真实本地编码的图片与注入 HTTP 响应测试。未持有供应商账号凭证，**没有实际调用、消耗额度或确认账号已开通指定模型**。上线前仍需在运营已开通的账号上完成单次受控验收，并核对账单、审核配置、地域与模型权限。

## 导出接口

```ts
import {
  createArkImageProvider,
  createQwenSpeechProvider,
  createTencentImageModerator,
  validateWav,
} from '@ai-xiutu/multimodal';

const images = createArkImageProvider(process.env); // 第二参数可注入 typeof fetch
// images: { configured, models, validate(input), generate(input) }
const input = {
  model: '运营已启用且配置过的模型 ID',
  prompt: '按参考草图生成一幅海边小屋插画',
  width: 1024,
  height: 1024,
  // reference?: {bytes: Uint8Array, mime: 'image/png'|'image/jpeg'|'image/webp'}
};
images.validate(input); // 无网络；在创建任务/预占资金之前调用
// 业务层完成审核、授权、预算和持久化派发记录后，才调用：
const generated = await images.generate(input);
// { bytes: Uint8Array, mime, requestId }

const speech = createQwenSpeechProvider(process.env);
// speech: { configured, models, transcribe({model,wav}) }
const wavInfo = validateWav(wavBytes); // {durationSeconds,sampleRate:16000,channels:1}
const transcript = await speech.transcribe({ model: 'qwen3-asr-flash', wav: wavBytes });
// { text, requestId }。空字符串可以是静音，不虚构识别结果。

const moderation = createTencentImageModerator(process.env);
const check = await moderation.check(generated.bytes, generated.mime, '业务任务 ID');
// { decision:'passed'|'blocked'|'review', inputHash, requestId }
```

接口本身只完成供应商调用与边界检查。业务编排必须保存任务/预算/派发状态，在请求前审核提示词及参考图，并在完整解码、输出审核与安全转码成功后发布生成图。`configured` 仅表示所需配置已提供，不代表联网测试成功或拥有调用资格。模型和审核未配置时失败关闭。

## 火山方舟配置与能力

固定调用地址：`https://ark.cn-beijing.volces.com/api/v3/images/generations`。`ARK_IMAGE_ENDPOINT` 若设置，必须与它完全一致；不允许任意代理地址、重定向、用户指定 URL 或供应商响应中的下载 URL。

配置示意（模型 ID 必须换成控制台中实际启用的 ID）：

```dotenv
ARK_API_KEY=只放服务端的实际密钥
ARK_IMAGE_MODELS_JSON=[{"id":"ep-actual-enabled-endpoint","profile":"seedream-5-flash"}]
```

`ARK_IMAGE_MODELS_JSON` 最多 16 条，每条只允许 `id` 与 `profile`。明确绑定能力档案，是为了正确选择字段和尺寸约束；它不自动证明 `ep-` 推理接入点背后确实是该模型。运营须核对绑定后再启用。没有内置默认模型、默认可用额度或“最新版”推断。

| `profile`          | 单张像素数范围       | 本适配器的组图/流式字段                                       |
| ------------------ | -------------------- | ------------------------------------------------------------- |
| `seedream-5-pro`   | 921,600…4,624,220    | 不发送这些不受支持字段                                        |
| `seedream-5-flash` | 921,600…4,624,220    | 不发送这些不受支持字段                                        |
| `seedream-5-lite`  | 3,686,400…16,777,216 | 显式 `sequential_image_generation: disabled`、`stream: false` |
| `seedream-4.5`     | 3,686,400…16,777,216 | 同上                                                          |
| `seedream-4.0`     | 921,600…16,777,216   | 同上                                                          |

以上档案对应官方图片生成 API 当前公布的约束；所有档案宽高比限定 1/16…16，本项目另将最长边限制为 8192。业务可以继续降低像素预算。适配器只实现**单张**生成，`response_format` 固定 `b64_json`、`watermark` 固定 `true`，不发送 `n`、分层、联网搜索或强制输出格式字段。输出格式以实际 PNG/JPEG/WebP 头部确认。[官方图片生成 API](https://console.volcengine.com/ark/region%3Acn-beijing/docs/image-generation-api)

本项目的额外输入/输出限制如下：

- 提示词非空，最多 2,000 个 Unicode 码点且 UTF-8 最多 8,000 字节。
- 至多一张参考图，静态 PNG/JPEG/WebP；原始压缩字节不超过 `MAX_IMAGE_BYTES = 7_000_000`。宽高须大于 50，以满足项目的图片审核链；宽高比仍为 1/16…16。参考图使用 Data URI，绝不传公网 URL。
- 返回压缩图片同样最多 7,000,000 字节，整个解压后的 JSON 响应读取最多 `MAX_IMAGE_RESPONSE_BYTES = 10_000_000` 字节。Base64 必须合法且规范编码，结果数组必须恰有一张图片。
- 实际输出头部宽高必须等于请求宽高；如果供应商调整尺寸或返回了 URL、多个图、非法内容，状态是 `unknown`，不会静默使用或重复请求。最终发布之前仍须由业务 Worker 完整解码、检查尺寸/帧数、重新编码及审核。
- 参考草图只是模型输入，**不保证精确遵循线条、保留身份或保持非编辑区域像素**。本接口没有蒙版参数、身份模型、图层重建或确定性局部编辑承诺。

模型可能升级或下线。更换 ID 或能力档案须重新核验，不应把别家“兼容 API”或网页模型名直接当作此官方接口支持项。

## Qwen 语音配置与 WAV 契约

```dotenv
DASHSCOPE_API_KEY=北京地域的实际服务端密钥
QWEN_ASR_MODELS=qwen3-asr-flash
# 推荐：运营控制台中的真实业务空间 ID。
DASHSCOPE_WORKSPACE_ID=actual-workspace-id
```

存在业务空间 ID 时使用 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`；否则使用官方文档仍列出的旧北京域名 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`。也可显式配置 `QWEN_ASR_BASE_URL`，但它必须精确匹配上述北京地址结构，不能带用户信息、查询字符串、其他路径或其他地域域名。[官方 Qwen-ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)

模型白名单只接纳 `qwen3-asr-flash` 及其 `-YYYY-MM-DD` 快照名称；逗号分隔、最多 16 项。该包不把 `qwen3-asr-flash-filetrans`、realtime 或较新的 Qwen-Audio 系列混作相同接口。别名和快照仍需运营确认在账号中可用。

`validateWav()` 必须在入队和计费前调用。它接受整个 WAV 字节数组，只接纳：

- RIFF/WAVE，普通 PCM 格式码 1，16 位有符号样本，单声道，16,000 Hz。
- `byteRate = 32000`、`blockAlign = 2`、16 字节 `fmt ` 块；不接收压缩 WAV、WAVE_FORMAT_EXTENSIBLE、RIFX、RF64。
- 恰好一个 `fmt ` 和一个非空 `data`，格式块在数据前，RIFF/块长度精确匹配，数据长度偶数，填充字节合法。
- 时长大于 0 且不超过 30 秒，最多 480,000 样本；按真实数据长度计算时长，不相信 MIME 或客户端声明。
- 总文件最多 `MAX_WAV_BYTES = 960_096` 字节；因此完整 Base64 最大 1,280,128 个字符。仅额外允许有界 `JUNK`/`LIST` 块。

适配器发送 `input_audio.data = data:audio/wav;base64,...`，非流式、`asr_options.enable_itn = false`。响应上限为 131,072 字节，单条完整 `stop` 结果，文本不超过 10,000 个 UTF-16 单元及 32,000 个 UTF-8 字节。录音重采样、麦克风授权、用户确认和转录文本审核在应用层完成；语音识别成功不代表用户已授权自动执行修改。30 秒是本项目更紧的产品预算，不是对供应商全部输入能力的描述。

## 腾讯云图片审核

本包直接导出 `@ai-xiutu/providers` 的 `createTencentImageModerator`、`ImageModerator` 和 `ModerationResult`，不维护第二套 TC3 签名。

需要 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TENCENT_IMAGE_MODERATION_BIZ_TYPE`，地域沿用 `TENCENT_MODERATION_REGION`。供应商调用到固定 `ims.tencentcloudapi.com`，动作 `ImageModeration`，版本 `2020-12-29`；内容使用 Base64。实际图片格式、帧数和审核输入大小由 providers 实现检查。业务只有在 `decision === 'passed'` 时才可继续；`blocked`、`review`、超时与未配置不能作为通过。

## 超时、计费不确定性与隐私边界

`MultimodalProviderError` 继承共享 `ProviderError`，包含 `code`、`outcome: 'rejected'|'unknown'`、`requestId`。本地配置/输入问题属于 `rejected`；已发送后的网络失败、响应中断、超时、5xx、429、超大/畸形回复、无法验证的成功图片均为 `unknown`。仅 400/401/403/404/422 且存在明确供应商错误对象时归为 `rejected`。原始错误内容可能含提示词或供应商内部信息，因此不放进异常消息。

图像请求固定 120 秒上限，ASR 固定 45 秒上限，超时也覆盖流式读取响应体。每次调用最多一次 HTTP 请求，`redirect: 'error'`，不跟随返回的下载 URL。**unknown 不能自动退回预算并重发**；应进入持久化核对流程，记录业务任务与供应商请求标识。HTTP 适配器本身不实现支付、扣费、队列恢复、重试或跨进程幂等，业务系统负责这些状态机。

适配器不写磁盘或日志；图片、音频、Base64 和文本会在当前进程内存中出现，并在实际启用调用时发送到相应供应商。业务需要落实媒体授权、审核前置、输入生命周期、终态清理及日志脱敏。单纯地区域名白名单不代替产品使用资格或合规审查。

## 本地验证

```sh
node --import tsx --test packages/multimodal/test/adapters.test.ts
node node_modules/typescript/bin/tsc -p packages/multimodal/tsconfig.json --noEmit
```

12 项测试覆盖真实 PCM WAV 时长与畸形结构、允许域名/模型及尺寸、参考图真实编码、模型档案对应请求字段、单图 Base64 输出、禁止响应 URL 获取、异常计费状态、响应体容量和中断、Qwen 转录结构与不完整输出。图像夹具由本地 Sharp 真正编码，供应商 HTTP 使用注入的 `fetch`，所有测试不使用真实凭证、不产生外部模型费用。

官方文档于 2026-11-09 核对：

- [火山方舟图片生成 API](https://console.volcengine.com/ark/region%3Acn-beijing/docs/image-generation-api)：单图/参考图、字段差异、Base64 返回与尺寸范围。
- [火山方舟图片生成教程](https://console.volcengine.com/ark/region%3Acn-beijing/docs/image-generation-tutorial)：能力档案对应尺寸。
- [阿里云 Qwen-ASR API 参考](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)：北京业务空间地址、旧域名迁移、Data URI 与非流式回复。

文档访问可核对协议；不能据此声称账号权限、计费、网络可达性、模型效果或生产性能已经实测。
