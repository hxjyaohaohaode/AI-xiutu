# OpenAI Images：实际接入与能力边界

核验日期 2026-11-13。适配器通过服务器直接请求官方 Images API。测试项目的 11 个模型 ID 均取得真实图像回执，生产环境的模型权限需在部署时核对。响应、通话和录音模型参见 [OpenAI 模型参数核对](../../docs/OPENAI-MODELS.md)。

## 模型与参数矩阵

模型档案由精确 ID 选择。`chatgpt-image-latest` 按本次实测的能力单独登记。 [生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate) · [编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit) · [生成指南](https://developers.openai.com/api/docs/guides/image-generation) · [2.6 提示指南](https://developers.openai.com/api/docs/guides/image-prompting)

| 档案          | 本版精确 ID                                                                | 质量                 | 尺寸策略                                                                                                  | 复杂度                                      | 引导图                     |
| ------------- | -------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------- |
| GPT Image 2   | `gpt-image-2`、`gpt-image-2-2026-04-21`                                    | auto/low/medium/high | 16倍数；1:3…3:1；每边≤3840；655360…8294400像素                                                            | 不发送                                      | 蒙版；不开放markup         |
| GPT Image 2.5 | `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`，及各自 `-2026-09-08` 快照 | 再含xhigh/max        | 同上；超过2560×1440属于官方实验范围                                                                       | 不发送                                      | 蒙版或markup，不能同时使用 |
| GPT Image 2.6 | `gpt-image-2.6-sunburst`、`gpt-image-2.6-flare` | 六档 | 16 倍数、1:3…3:1、每边至多 3840、655360…8294400 像素 | `low/medium/high`，可留空 | 蒙版或 markup，二者互斥 |
| GPT Image 1 系列与 ChatGPT Image | `gpt-image-1.5`、`gpt-image-1-mini`、`chatgpt-image-latest` | `auto/low/medium/high` | `1024x1024`、`1536x1024`、`1024x1536` | 供应商默认 | 蒙版 |

2.5用途与质量来源：[Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)、[Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)。2.6模型来源：[Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst)、[Flare](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare)。不把模型公开列出等同于运营账户已经开通。

### 已实现的请求映射

应用 `imageOptions.quality/background/outputFormat/outputCompression/n/complexity` 分别映射供应商 `quality/background/output_format/output_compression/n/complexity`。`size` 可为明确的 `WIDTHxHEIGHT` 或 `auto`。选择 `auto` 时，以三个标准画幅中的最大面积预留像素预算，并逐张核对实际尺寸。生成请求固定走 `/v1/images/generations`，编辑请求走 `/v1/images/edits`，`images` 数组使用经过授权和摘要核对的私有规范 PNG 数据。

- 供应商支持1…10张；应用默认最多4张，运营 `maxOutputs` 和服务器预算可以进一步收紧。提高服务器上限也不能绕过整批像素/字节限制。
- 输出请求接纳PNG/JPEG/WebP；压缩仅限JPEG/WebP且范围0…100；透明背景不能配JPEG。显式透明要求检查实际解码alpha，不能把供应商描述或棋盘格当成透明。
- 首张参考图是蒙版/标注作用对象；所有参考图与引导图必须在本项目内、仍可访问，经过完整规范化与图片审核。引导层须与首图同尺寸、PNG且存在透明像素。蒙版是模型引导，不能保证区域外像素完全不变。
- `input_fidelity` 仅编辑可选，`gpt-image-1.5` 支持 `low/high`，`gpt-image-1-mini` 支持 `low`。`moderation` 接受 `auto/low`，两者均经过应用审核。`safety_identifier` 使用内部用户 ID 的稳定 SHA-256。
- 档案内型号接受单张光栅 `stream`。`OPENAI_IMAGE_PARTIALS_ENABLED=true` 时可请求 `partial_images`（0–3）。Worker 逐条解析 SSE，暂存已审核中间图供任务发起人查看，独立校验最终图。中间图最多保留五分钟，终态移除。预留按申请的数量，扣点按收到的部分图数，差额释放。
- 2.6 Flare/Sunburst 的 SVG 生成由 `OPENAI_IMAGE_SVG_ENABLED` 开放，单张、无参考图、无流、无压缩。可通过 `OPENAI_IMAGE_SVG_AUTHORS` 提供允许的作者模型。只有通过 XML 元素和属性验证的矢量可交付。界面显示审核后的光栅图，下载提供可编辑 SVG。
- 2.6 Flare/Sunburst 的 GIF 由 `OPENAI_IMAGE_GIF_ENABLED` 开放，帧数 2–16（默认 9），帧延时至少 20ms（默认 200ms，GIF 编码按 10ms 舍入，上限 655,350ms）。可使用静态参考图，大小受所选帧数及总像素预算约束。逐帧合成及审核后才提供原 GIF。蒙版、流和输出压缩互斥于 GIF。[生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate) · [编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)

规范编辑源为私有 PNG。JPEG/WebP 请求按真实返回容器检查后转为 PNG、保留 Alpha，审核实际存储字节。SVG 与 GIF 另保留已验证的原格式文件，计入空间储存配额。

## 运行配置与预算

`AI_IMAGE_ENABLED=true`、`OPENAI_IMAGE_ENABLED=true`、服务端 `OPENAI_API_KEY`、非空 `OPENAI_IMAGE_MODELS` 精确白名单、启用的运营目录以及腾讯文字/图片审核配置全部满足后才能入队。仓库模板的开关为false、密钥及模型列表为空。配置可用不表示真实外部验收已通过。可选 `OPENAI_BASE_URL` 只能精确等于 `https://api.openai.com/v1`，不支持自定义主机或重定向。

| 限制                            | 默认/硬边界                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `OPENAI_IMAGE_MAX_OUTPUTS`      | 默认4，允许1…10；再取运营maxOutputs交集                                       |
| `OPENAI_IMAGE_MAX_REFERENCES`   | 默认4，允许1…16                                                               |
| `OPENAI_IMAGE_MAX_TOTAL_PIXELS` | 默认16777216，硬上限67108864；按画幅、张数及 GIF 帧数或所请求部分图数准入       |
| `OPENAI_IMAGE_MAX_TOTAL_BYTES`  | 默认28000000，允许7000000…70000000；分别限制原始输出总量和规范化输出总量      |
| 单张输入/输出                   | ≤7000000字节；参考图单边须大于50，以满足审核链                                |
| 全部参考图+蒙版/标注            | ≤28000000字节、≤33554432像素；单张≤16777216像素                               |
| 网络                            | 光栅单次180秒，SVG/GIF 220秒。读取上限按字节预算换算 Base64 加有限信封开销     |

网络或返回内容不确定、输出数量不符、任一输出格式/尺寸/透明不符、审核失败或规范化超限，都不能发布部分结果。供应商可能已收费时整批为unknown，保存已得到的requestId和原预留，人工核验后处理。明确的、未生成任何结果的供应商拒绝可释放预留。

## 持久任务与服务点

OpenAI使用版本2冻结清单，保存原始用户请求、规范化参数、模型目录版本、实际引用字节摘要、固定端点、完整实际供应商JSON的规范摘要和整批报价。Worker复算这些值，审核完整提示与全部参考图，在异步审核后再次检查权限、模型和素材；最终提交时再查权限及参考图撤销。旧Ark版本1任务保留原摘要规则；新参数不混入旧任务。

单张基价为 `imageUnitCosts[quality] ?? unitCost`。整批按光栅张数与请求部分图、GIF 总帧数，或 SVG 生图加作者两段计算预占。只有收到完整终态才扣点，部分图按实际供应商事件数结算。运营设置整数服务点，并单独保留供应商用量。预占上限 100000 点。报价冻结后改价不追溯队列，当前安全范围收紧则拒绝继续派发。

逐张顺序规范化和审核，不并行解码整批。只有全部结果通过后，才在同一个SQL事务创建所有素材、作品和初始修订并结算一次hold；失败仅清理已权威确认未挂载的私有文件，不让用户取到其中“先成功”的图片。发布和清理使用相同storageKey事务锁：即使COMMIT已成功而回包断链，清理也先等原事务结束并查询全部引用；查询失败保留私有候选，不能误删已发布结果。

图片迭代需要显式 `parentJobId`，并至少选用一张该成功父任务的真实输出作为本轮参考。服务器核同项目并派生threadId，最多50轮；不会偷偷发送整段可见聊天历史。文案迭代显式冻结成功父文案和选定文档版本，超长度直接拒绝；调整建议仍只以本轮完整配方与作品版本为输入，不声称看过照片。旧版调整建议仅可写原13项；新v2请求采用显式proposalVersion2，另外开放编辑器注册表52个全局数值路径，并提供真实before/after差异，最终一次完整验证联合约束。不能修改区域/蒙版/几何/曲线或任意JSON路径；全部其余配方字段保留。

## 验证

`test/openai.test.ts`验证真实协议构造、固定端点/凭据门禁、参数依赖、PNG/JPEG/WebP真实解码、透明alpha、蒙版/标注和批次异常。`packages/ai/test/openai.test.ts`验证SQL报价冻结、并发幂等、审核拒绝不外呼、整批失败不发布、引用撤销、真实父子关联和输入篡改拒绝。运行结果只能证明这些测试范围；真实账户授权、网络可达性、效果和账单需要独立受控验收。
