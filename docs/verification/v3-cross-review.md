# V3 跨模块独立审查：范围、发现与逐文件清单

## 结论与证据口径

本记录复核了工作台打开、保存、导出、历史恢复、AI 候选采纳、素材复制、团队权限、额度账本及旧版编辑内核之间的实际调用关系。**在已阅读的范围内没有确认 P0/P1；这不是不存在漏洞、所有场景通过或每一行经过六次人工复核的保证。**

最初任务为只读跨审。发现后得到根任务明确授权，实际修改了两处产品行为：AI V3 差异展示（CR-01）和 Canvas 多指事务所有权（CR-02）；其他实现保持只读，未提交 Git。

- 清单生成时间（UTC）：`2026-11-09T17:52:08.825462+00:00`。
- 基础提交：`770be981daa99898937fbd92cb15661c40f92131`；本轮代码仍在工作树中，不把基础提交等同于最终交付提交。
- 文件清单：304 个文件；代码/样式/脚本 220 个。清单不包含此 Markdown 和配套 JSON 自身，以避免递归哈希。
- **本轮完整阅读 F：122 个文件，其中代码/样式/脚本 112 个。**其余逐项标明 O/C/T/S/B/U，不通过扩大分母声称全仓人工覆盖。
- 文件哈希仅代表生成清单时状态。审查过程中其他任务还在修复；之后改变的文件需要对应差异复核，最终冻结与六轮全仓命令结果由根任务记录。
- 全文件 SHA-256、文本行数及状态见 [v3-cross-review-inventory.json](v3-cross-review-inventory.json)。行数只用于定位范围，不构成逐行正确性证明。
- 前轮负责模块记录见 [v3-ui-review.md](v3-ui-review.md)。其他专项记录见 [v3-editor-review.md](v3-editor-review.md)、[v3-backend-review.md](v3-backend-review.md)。没有把其他审查者的阅读冒充为本人的独立阅读。

## 具体发现与处理

| 编号 | 级别 / 状态 | 触发条件与影响 | 处理及验证边界 |
| --- | --- | --- | --- |
| CR-01 | P2 / 已修复并定向验证 | schemaVersion=3 的 AI 候选继承 V2 数值，但旧差异列表只在两边均恰好为 V2 时列扩展参数，可能漏列色阶、HSL、分级、细节、颗粒等。V3 局部/层/位移也缺少变化提示。 | `recipeDiff.ts` 按 >=2 纳入继承参数，V3 加入实际注册参数；列出蒙版/分组/图层/液化等非数值块变化；键序不误报但数组顺序保留。没有扩展 AI 写白名单。6项测试及 web typecheck通过。 |
| CR-02 | P2 / 已修复并定向验证，待真机触摸复验 | 画笔/液化活跃时，第二触点可从 beginEdit 早退并冒泡至 viewport；放大画面后可能同时平移和落笔。 | viewport 捕获阶段通过共用 `CanvasPointerOwnership` 实施单编辑指针事务；第二触点先取消仍属于本事务的预览，再抑制全部触点直到都结束；迟到/第三指不提前解锁；普通无编辑双指导航保留。新增6项策略/实际配方所有权用例通过，另3项源坐标用例通过；不把 Node 测试写成真机双指操作成功。 |
| CR-03 | P2 / 已由后端任务修复，完成补充源码复核 | 原先某能力已有 queued 任务后关闭其运行配置并重启，worker只claim当前availableOperations；停用能力排队预占缺少取消入口。全部关闭时也不进行旧running清扫。 | 当前 `createAiService.runOnce()` 在运行能力判断之外执行 `recoverStaleAiJobs`，旧running转unknown且保留预占；新增真实取消排队接口，以任务锁、成员授权和发送记录检查保证只释放未发送任务。发送证据不明转unknown，不能自动退款。前端取消后刷新权威状态，不自己猜测释放成功。本补充仅核对源码，相关运行测试以后端/根任务记录为准。 |
| CR-04 | P2 / 已由后端任务修复，完成补充源码复核 | 原先 `scripts/doctor.ts` 只以 schemaVersion>=2 判断数据库就绪，而当前新增功能依赖迁移7。旧库可被该项误标ok。 | 当前 doctor 改用数据库包的 `getSchemaReadiness`，与实际迁移共用注册表，检查所有缺失版本和意外版本，不能只凭最大版本高就通过。本补充核对了注册表、readiness实现和doctor调用；数据库测试结果以根任务记录为准。 |

早期检查见到的新画笔/图层 UUID 直接调用差异，在复查时已由根任务统一改成 `secureUuid`；没有把已不存在的问题继续列为遗留。运行资源预算、解码器支持范围、审核和账号开关属于明确边界，不把拒绝超限本身写成失败或假成功。

### 清单生成后的修复复核

生成清单后另做一次有界的只读差异复核：完整读取新 `packages/ai/src/lifecycle.ts`、`apps/web/src/ai/QueuedCancellation.tsx` 和当前 `scripts/doctor.ts`，读取 `packages/ai/src/index.ts` 的取消与统一 worker 调度路径、`packages/db/src/index.ts` 的迁移/readiness路径、`apps/api/src/app.ts` 的取消路由。上表 CR-03/04 状态据这些实际内容更新。JSON 的 `followupReads` 单独保存该次文件哈希和阅读范围；下方原始304文件清单仍保留其生成时的状态，不把局部差异复核重算为又一次全文件人工审查。

## 关键不变量追踪

### 原图、图层与历史

`App` 在打开历史时读取该 revision 自己绑定的 asset，再解析当前配方引用的每个图片层。保存前冻结本次配方和来源，服务器重验目标项目编辑权与每个引用；已知云端源跨项目必须经过授权复制，不能在复制被拒绝后退回普通上传。保存过程中继续编辑会保留新的本地草稿，服务端冲突采用 CAS 明确返回而非覆盖。恢复是追加版本，替换底图和恢复旧源图均不改写旧 revision。

预览和最终导出使用同一版本化解释器，但预览会明确降至显示预算；点采样、颗粒、邻域细节存在分辨率差异，不承诺预览每个显示像素与原图导出逐字节相等。原图输出与新 V3 16.8MP预算、旧 V1/V2分块预算分别校验，不能单纯把输入框范围提升就宣称引擎无限。

### AI 决定与额度

任务提交冻结 provider payload、模型参数、输入素材和哈希，并由服务器确定价格与预占。真实生成之前审核实际文本/参考输入，结果规范化后再次审核，整批结果和结算同事务发布。超时、断流、worker遗失或供应商已可能处理的未知结果保留未知态，不自动重发。

结果决定与模型完成独立：拒绝是未采用记录，不自动退款；另存、替换、合成图层、应用建议和文本保存分别校验类型与项目授权。作用到现有作品或文档必须带预期版本；编辑过的文本记录contentEdited并保留原生成内容。额度释放回原批次、检查过期，不能把已过期免费额度变成新可用额。

### 个人、团队与运营

项目和素材读写都在服务端检查身份、成员、角色、共享策略及过期/撤销。运营权限不自动赋予私人素材权限。参考共享与独立副本语义分开：撤销可阻止继续访问源，无法收回已生成的合法副本。任务、文档、评论使用项目/版本锚点，事件长轮询重新检验成员状态；这属于版本冲突保护与同步提示，不是CRDT多人像素合并。

### 人物分析与手动编辑

分析结果绑定原图完整指纹、方向和尺寸；人物面部与身体目标不靠数组序号猜测为同一个人。浏览器自动分析明确检查同源模型和图形能力，失败不生成虚假识别框。导入人物标注是显式外部分析路径，不写成浏览器自动推理成功。前轮 owned 人物算子整体脱离/完整性标记另见人物专项，尚未人工复读的内核文件在下面仍为 S。

## 本轮实际执行的定向验证

| 命令 / 范围 | 实际结果 | 不能替代的证据 |
| --- | --- | --- |
| `node --import tsx --test apps/web/test/recipe-diff.test.ts` | 修正测试夹具后6/6通过；首次夹具把已为true的warp.enabled再次设true，未造成真实变化，未把该次失败记通过。 | 完整生图或模型账户调用。 |
| `node --import tsx --test apps/web/test/canvas-gesture.test.ts apps/web/test/source-coordinates.test.ts` | 9/9通过，0失败，0跳过。 | 浏览器捕获事件实现、真机多指、触控笔硬件。 |
| `npm run typecheck -w @ai-xiutu/web` | 两项授权修复完成后均通过。 | 全仓运行、浏览器布局、真实供应商结果。 |
| 仅对授权文件执行 Prettier | 完成。 | 格式化不算行为测试。 |

本子任务没有执行或声称六轮人工全代码检查。最终自动化全仓轮次、源快照、实际浏览器/原生数据库/供应商边界统一由 [VERIFICATION.md](../VERIFICATION.md) 记录。

## 仍需真实环境覆盖

- 真机 iOS/Android 的触点捕获、第二/第三指、抬起先后、浏览器失焦、软键盘、横竖屏、触控笔与辅助技术；本次策略用例只验证共享逻辑。
- 原生浏览器人像模型执行：本环境WebGL不可用的路径必须记为受限。CPU生成真实标注后导入所验证的是另一条后续渲染链路。
- 模型账号权限、真正计费与未知账单核验、短信实收、审核生产账号、支付接入、大陆三网可达性和个人代理实际出口可靠性，均不能由源码存在或本地替身证明。
- 大量历史、极限蒙版/笔触、多图层全分辨率、低端设备长时间内存压力需要独立压力与目标设备验收。预算是保护上限，不是吞吐或视觉质量承诺。
- 未读文件在清单中保留 U/S/O，不将全文件枚举、哈希或其他审查者的专项报告当成本轮人工逐行完成。

## 清单状态

| 状态 | 含义 | 文件数 |
| --- | --- | ---: |
| F | 本轮完整阅读，备注列说明实际关键检查 | 122 |
| O | 前轮本人负责范围已有复核，非本轮独立再审 | 47 |
| C | 已读任务上下文，不等于本轮代码审查 | 4 |
| T | 本轮执行测试，但未逐行重读测试文件 | 1 |
| S | 另有专项负责，本独立审查未逐行覆盖 | 16 |
| B | 二进制/图片仅登记哈希 | 9 |
| U | 仅登记，未宣称人工覆盖 | 105 |

## 逐文件记录

路径相对仓库根目录。表中哈希为SHA-256前12位，完整值保存在配套JSON。F不表示该文件无缺陷；O不表示本轮又完整读过一次。

### 根目录与基础设施

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `.dockerignore` | F | 11 | `b4e841875e7e` | 构建排除环境凭据、数据目录、依赖与输出；仅查看规则不读取私人配置。 |
| `.env.example` | U | 77 | `36dfcc3269ee` | 已纳入清单；本独立审查未逐行复核。 |
| `.github/workflows/checks.yml` | F | 164 | `86e9ac58bdac` | 固定action引用、原生PG18、DB强制测试、容器禁用供应商与私网检查；脚本存在不等于本轮CI已通过。 |
| `.gitignore` | U | 14 | `8ffde91a0668` | 已纳入清单；本独立审查未逐行复核。 |
| `.npmrc` | U | 3 | `e7aec7c6391e` | 已纳入清单；本独立审查未逐行复核。 |
| `.nvmrc` | U | 1 | `d9f318747a12` | 已纳入清单；本独立审查未逐行复核。 |
| `.prettierignore` | U | 10 | `9c2b626452d5` | 已纳入清单；本独立审查未逐行复核。 |
| `.prettierrc.json` | U | 5 | `d7fa1c1dee12` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `AGENTS.md` | C | 19 | `35733974c4a4` | 任务上下文已读；本轮没有重新逐段验收全部文档事实。 |
| `README.md` | C | 93 | `97fa2505f547` | 任务上下文已读；本轮没有重新逐段验收全部文档事实。 |
| `compose.yaml` | F | 104 | `13e57173b595` | 数据库/迁移/API/worker/web依赖、仅web公开端口、存储与dispatch持久卷、健康检查。 |
| `infra/Caddyfile` | F | 25 | `d33033f73288` | CSP同源WASM/worker、麦克风self、API反代、vision缺文件404不落SPA；真实公网仍需部署验收。 |
| `infra/Dockerfile` | F | 19 | `8085b8d940fb` | Node24构建、多阶段web/server、默认安装同源模型、nonroot运行、私有存储目录。 |
| `package-lock.json` | U | 3309 | `19f86f179c77` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `package.json` | F | 61 | `45d019c05afe` | Node24范围、工作区、typecheck/test/build/migrate/worker/verify入口；供应商开关无隐式付费执行。 |
| `tests/vision-assets.test.mjs` | U | 38 | `a91f02e449b5` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `third-party/Apache-2.0.txt` | U | 202 | `cfc7749b96f6` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `third-party/NOTICE.md` | U | 19 | `0264dce47453` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `tsconfig.base.json` | U | 16 | `bf2a1cae2098` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### apps/api

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `apps/api/API.md` | U | 254 | `288e15aec6be` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `apps/api/package.json` | F | 20 | `8b79534b4863` | contracts/db/providers/editor/ai/storage 工作区依赖与真实脚本。 |
| `apps/api/src/ai-decisions.ts` | F | 377 | `c926b4f5b505` | completed/provenance 门禁、actor 幂等/请求哈希、CAS、正确候选类型；拒绝不退款；采用不二次结算。 |
| `apps/api/src/app.ts` | F | 351 | `ccb9fed5639f` | Origin 写门禁、body/multipart 限制、错误脱敏、真实服务能力发现、每条 AI 路由鉴权。 |
| `apps/api/src/asset-annotations.ts` | F | 184 | `c282b7164409` | 严格字段 schema、版本冲突、声明元数据、游标绑定 actor/filter、搜索转义与结果上限。 |
| `apps/api/src/asset-copy.ts` | F | 340 | `ee6d4d30fc3c` | 源访问+复制许可+目标编辑权限、持久幂等、已完成副本复用、目标容量、最后一次权限/过期检查。 |
| `apps/api/src/auth.ts` | F | 285 | `ad012478e9e9` | OTP HMAC/时效/独立失败计数、一次性消费、邀请激活、重置撤销会话、短信真实发送/未知态。 |
| `apps/api/src/bootstrap.ts` | F | 50 | `1876f1719872` | 显式配置、一次性锁、已有账号/运营拒绝、无默认密钥/密码；初始化与用户自证语义分开。 |
| `apps/api/src/collaboration.ts` | F | 323 | `ceab69cd0bb3` | 评论锚点项目绑定、任务/文档 CAS、文档历史追加；事件长轮询反复重验成员和账号状态。 |
| `apps/api/src/config.ts` | F | 44 | `68ec42ada2c0` | 数据库/秘密值长度、exact origin、secure cookie、代理跳数及数值预算；未读取私有环境值。 |
| `apps/api/src/core.ts` | F | 263 | `5b4bc72a8742` | 密码 scrypt 与常时比较、会话不透明哈希、限流、project/member/shared ACL、operator 不绕过私人项目。 |
| `apps/api/src/editor-contract.ts` | F | 83 | `8b61bdc1f546` | 直接派生真实注册表参数/作用域；AI 可写范围只覆盖现有全局白名单，不任意改 V3 路径。 |
| `apps/api/src/index.ts` | F | 32 | `7b0f321c55cc` | 配置/服务启动顺序和进程停止时数据库/HTTP 清理。 |
| `apps/api/src/operations.ts` | F | 514 | `0f11967d5723` | 运营专属/审计、账号限制撤会话、套餐版本追加、模型参数校验、额度理由与幂等、无默认密码。 |
| `apps/api/src/projects.ts` | F | 437 | `2b75f9706641` | 上传前后 ACL、私有素材/缩略图 ACL、源与引用层保护、CAS 版本追加、历史按自身底图恢复。 |
| `apps/api/src/recipe-references.ts` | F | 49 | `d21d558b4469` | V3 图层必须是同项目有效 UUID 素材，跨项目复制完整重映射，不接受任意 URL。 |
| `apps/api/src/revision-commands.ts` | F | 93 | `2a4c25714ccd` | 同项目源锁与引用验证、原子更新头和追加不可变版本；分支独立。 |
| `apps/api/src/sharing.ts` | F | 348 | `0bfaf6723b88` | reference/copy 许可与容量、不可越权授予、同事务快照复制、幂等、图层来源重映射、过期重检。 |
| `apps/api/src/spaces.ts` | F | 228 | `65466d5e875c` | 个人空间不可加成员、角色层级、邀请使用时重验、移除成员撤销关联授权，团队额度独立。 |
| `apps/api/src/storage.ts` | F | 1 | `0bc6642ecddc` | 仅复用私有存储包，没有额外公开文件服务。 |
| `apps/api/test/ai-decisions.test.ts` | U | 1120 | `a31dc70b0ccb` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/api/test/asset-annotations.test.ts` | U | 460 | `6bb035a7eaf4` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/api/test/asset-copy.test.ts` | U | 600 | `764012fd88be` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/api/test/integration.test.ts` | U | 951 | `006a1e40ca14` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/api/tsconfig.json` | U | 5 | `8232231dbe3c` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### apps/web

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `apps/web/MOTION.md` | O | 122 | `bdb76c7c27f4` | 前轮编写/复核记录；内容证据范围见文件自身，不当本轮六次人工代码审核。 |
| `apps/web/README.md` | C | 72 | `cfb2958dc5c8` | 任务上下文已读；本轮没有重新逐段验收全部文档事实。 |
| `apps/web/index.html` | U | 18 | `edd7725e8524` | 已纳入清单；本独立审查未逐行复核。 |
| `apps/web/package.json` | F | 29 | `238333e9967e` | 真实工作区依赖、typecheck/test/build 入口，新增 portrait/contracts/MediaPipe 版本关联。 |
| `apps/web/public/favicon.svg` | U | 1 | `5835ffd8d76a` | 已纳入清单；本独立审查未逐行复核。 |
| `apps/web/qa-responsive.html` | U | 145 | `e979f59da6c2` | 已纳入清单；本独立审查未逐行复核。 |
| `apps/web/src/App.tsx` | F | 1716 | `19c382e7a858` | 跨源异步身份、保存快照、CAS 冲突分支、正确 revision 源图、跨项目复制许可；未保存草稿不会被 AI 采用或历史慢响应覆盖。 |
| `apps/web/src/ai/AIThread.tsx` | O | 561 | `9db509e5993b` | 前轮：原AI输出与手改稿分开、真实来源和明确采用动作。 |
| `apps/web/src/ai/ImageParameters.tsx` | F | 252 | `201b99f8dfd6` | 按当前模型显示真正开放参数；自由尺寸受能力约束；不支持项给原因；供应商编码与项目规范化格式分开。 |
| `apps/web/src/ai/QueuedCancellation.tsx` | U | 72 | `0f2a420de0a7` | 已纳入清单；本独立审查未逐行复核。 |
| `apps/web/src/ai/ResultActions.tsx` | O | 382 | `7468de30d36c` | 前轮：明确拒绝/分支/替换/合成/应用/文本保存、目标版本快照。 |
| `apps/web/src/ai/capabilities.ts` | F | 163 | `33ceea5fbeee` | 服务端/供应商/运营参数交集、尺寸步进和比例、输出总像素、透明与 JPEG 依赖、整数服务点报价。 |
| `apps/web/src/ai/decisions.css` | O | 153 | `28214581cee9` | 前轮：结果/确认/历史层级与小屏正文密度。 |
| `apps/web/src/ai/decisions.ts` | O | 95 | `b05015b65be2` | 前轮：协议1请求、actor/project/job隔离、稳定幂等与dirty门禁。 |
| `apps/web/src/ai/recipeDiff.ts` | F | 95 | `c9a588a00350` | V3 继承 V2 数值差异、V3 数值与非数值块变化；对象键序不误报，图层顺序变化保留；已修复 CR-01。 |
| `apps/web/src/ai/types.ts` | O | 165 | `94a4d66fce08` | 前轮：共享能力与结果类型，非权限权威。 |
| `apps/web/src/ai/useResultDecisions.ts` | O | 135 | `5c24dac80388` | 前轮：未知请求保留key、GET/POST竞态、父刷新错误不反转已成功决定。 |
| `apps/web/src/components/AIPanel.tsx` | O | 1016 | `a8b60ddda6bb` | 前轮：按实际模型能力请求、用户确认、草图/语音/文档入口；新结果决定接入。 |
| `apps/web/src/components/AIPanelFeature.tsx` | F | 64 | `84e1db16ba00` | AI 面板懒加载/错误边界与安全随机数错误独立，不使本地图像编辑整体失效。 |
| `apps/web/src/components/AssetLibrary.tsx` | F | 595 | `d0f7d7efa883` | 服务器授权范围检索、游标/请求世代、项目/来源/时间分组、annotation CAS、声明时间地点与原图分离。 |
| `apps/web/src/components/AuthPanel.tsx` | F | 260 | `036839322875` | 真实密码/验证码/注册/重置端点、忙碌门禁、短信未配置状态、无演示验证码；服务器限流为权威。 |
| `apps/web/src/components/ColorPicker.tsx` | O | 448 | `e23250cef538` | 前轮：连续色谱/HEX/HSV/HSL/RGBA、单指针取消和键盘。 |
| `apps/web/src/components/Controls.tsx` | F | 157 | `38247e821d5e` | 折叠逐层展现、可访问选项组、滑条与精确输入并存；能力/参数合法性仍由调用方和服务器检查。 |
| `apps/web/src/components/DrawingBoard.tsx` | F | 386 | `7e15ced1f020` | 本地笔触、撤销/重做、取消捕获、完整色谱、白底 PNG；确认后才作为 AI 参考，笔触/画幅预算显式。 |
| `apps/web/src/components/ImportSettings.tsx` | F | 178 | `09bed7012651` | 新 V3 16.8MP 与旧版大图预算区分；服务端规范化需明确上传；真实格式和元数据丢弃说明。 |
| `apps/web/src/components/OpsDashboard.tsx` | F | 1120 | `3dc3a013cb48` | 运营状态/待验证用户/品牌公开确认/套餐目录/模型与价格；服务端执行门禁不可被目录绕过，无假支付。 |
| `apps/web/src/components/ProjectDialogs.tsx` | F | 699 | `e8489079f005` | 复制稳定幂等、空间角色、参考与副本撤销语义、导出实际 Blob 重复下载、MIME/质量说明；不声称系统相册实写。 |
| `apps/web/src/components/QuotaManager.tsx` | F | 250 | `91d46f6347c4` | 运营查用户和明确空间；正向赠额/负向可用额调整、理由、稳定幂等 key；未知请求不伪报完成。 |
| `apps/web/src/components/Sidebar.tsx` | F | 243 | `8d55e190e78a` | 个人/团队统一入口、共享项目分列、移动隐藏导航 inert、角色文案；导航本身不充当权限。 |
| `apps/web/src/components/Ui.tsx` | F | 227 | `e447e2261f1a` | dialog 关闭门禁/退场 inert、Escape 原生取消、toast 保留最后状态、ARIA、品牌数据驱动。 |
| `apps/web/src/components/VoiceCapture.tsx` | F | 196 | `1d81f0c0dd19` | 只有明确开始才申请麦克风、30秒停止、流结束/卸载清理、本地试听和明确发送；不自动外传。 |
| `apps/web/src/components/WorkspaceViews.tsx` | O | 919 | `80748ec70e6d` | 前轮：revision源图、恢复CAS、文档/任务/评论联动。 |
| `apps/web/src/components/color-model.ts` | O | 76 | `b095ef9b0006` | 前轮：颜色空间往返和全alpha字节测试。 |
| `apps/web/src/editor/AdvancedInspector.tsx` | O | 232 | `609b40b35ba2` | 前轮：V3全工具路由、scoped参数/曲线、错误保留合法配方。 |
| `apps/web/src/editor/CanvasStage.tsx` | F | 1528 | `f2b3679d7f60` | 源/显示坐标转换、变换就绪门禁、像素画笔、液化、选区/图层手势、取消与捕获；第二触点竞争已修复，见 CR-02。 |
| `apps/web/src/editor/ColorControls.tsx` | O | 373 | `e243274b70f3` | 前轮：全局/区域/组完整色彩控件、连续选色与分区。 |
| `apps/web/src/editor/CurveEditor.tsx` | O | 501 | `f4d6e2e4a1f3` | 前轮：完整配方scoped曲线、跨源/作用域手势失效、捕获重入。 |
| `apps/web/src/editor/GeometryControls.tsx` | O | 281 | `4fedebff6a5e` | 前轮：自由整数裁切/连续几何，奇异与超预算拒绝。 |
| `apps/web/src/editor/Histogram.tsx` | F | 84 | `64442de2bcc5` | RGB/亮度/对数切换、明确当前预览统计和暗亮端代理；不冒充 RAW 截断判定。 |
| `apps/web/src/editor/LayerControls.tsx` | O | 1019 | `aafb93d2379f` | 前轮：图层/混合/绘制/克隆来源/像素点/保护液化，真实上限。 |
| `apps/web/src/editor/LocalControls.tsx` | O | 516 | `82c9c1ee048b` | 前轮：多局部/组、独立/共享参数、顺序/透明度/名称。 |
| `apps/web/src/editor/MaskControls.tsx` | O | 422 | `a8531eabdc74` | 前轮：复合子路径、添加/减去/相交、合法范围与蒙版预算。 |
| `apps/web/src/editor/ParameterShelf.tsx` | O | 84 | `19330d4e089c` | 前轮：同类集中、单主滑条、切换结束当前事务。 |
| `apps/web/src/editor/PortraitControls.tsx` | O | 405 | `cf0aed314b0d` | 前轮：能力可用性、多人独立、每妆容颜色、整体脱离、标注导入导出。 |
| `apps/web/src/editor/PrecisionRange.tsx` | O | 298 | `4f3074936ae0` | 前轮：触摸/键盘事务、取消恢复、不相关指针不能提交。 |
| `apps/web/src/editor/ToolInspector.tsx` | O | 1654 | `f1b8ae23dd24` | 前轮：美颜顶层与V3显式升级；旧基础工具保留。 |
| `apps/web/src/editor/advanced-inspector.css` | O | 432 | `da1fbb750717` | 前轮：紧凑层级、微色阶、三端/低高/减少动态规则。 |
| `apps/web/src/editor/advanced-model.ts` | O | 181 | `d1fbad704e81` | 前轮：注册表身份、全局/区域/组独立ColorBlock、预览前严格合法性。 |
| `apps/web/src/editor/canvas-gesture.ts` | F | 57 | `f6787997c498` | 真实 Stage 共用触点策略：第二触点取消一次，全部松开前抑制；回滚严格核对 source identity 与 recipe 引用。 |
| `apps/web/src/editor/coordinates.ts` | F | 38 | `8a9885532707` | 实际变换/位移逆映射；透明扩展区不落笔；图层把手允许域外移动，画笔和取色有严格边界。 |
| `apps/web/src/editor/editor-controls.css` | U | 1429 | `9bd224a09953` | 已纳入清单；本独立审查未逐行复核。 |
| `apps/web/src/editor/histogram-cache.ts` | F | 16 | `a8b95bc72282` | 以不可变预览对象为 WeakMap 键；计数缓存不持有原始像素源；消费者不得修改共享 bins。 |
| `apps/web/src/editor/imageSources.ts` | F | 79 | `44717fa659eb` | 文件头先验、方向归一、尺寸与总像素预算、图层完整/预览源分离、失败释放 canvas；显式规范化。 |
| `apps/web/src/editor/portrait.worker.ts` | F | 276 | `96ddb72ec387` | 真实模型/WASM 同源加载、WebGL2 前置检查、脸/身体分离目标、分割初选与降级警告、资源关闭；非完整实机成功证据。 |
| `apps/web/src/editor/precision.ts` | F | 148 | `d120237e12d2` | 最小 1px 中心吸附、原图裁切取整、注册路径、嵌套蒙版替换保持兄弟节点、旧版独立兼容。 |
| `apps/web/src/editor/previewBudget.ts` | F | 100 | `7ddfaacfdfc8` | 输入及变换后预览均受像素预算；线性预乘 alpha 面积采样；不更改原图、配方和最终导出。 |
| `apps/web/src/editor/range-gesture.ts` | O | 69 | `2aa41d7eef70` | 前轮：真实共享滑条事务状态机与迟到事件门禁。 |
| `apps/web/src/editor/render.worker.ts` | F | 124 | `42dc35e6113b` | 源消息顺序、完整分辨率几何检查、V3/旧配方分派、导出 MIME 实核、JPEG 白底、源与导出请求快照。 |
| `apps/web/src/editor/selection.worker.ts` | F | 59 | `88d69ba6b3f0` | 受限预览预算、V3 复合蒙版、反变换采样、域外透明、错误不保留旧成功覆盖图。 |
| `apps/web/src/editor/source-flow.ts` | F | 36 | `f1663c12dd06` | 异步打开/保存的身份防护；历史 artwork、revision、asset、project 绑定校验。 |
| `apps/web/src/editor/useEditor.ts` | F | 762 | `5bc31a443014` | 不可变原图/完整指纹、预览 latest-wins、图层引用解析、原图导出、源切换失效、历史和复制来源缓存；分辨率预算显式。 |
| `apps/web/src/editor/usePortraitAnalysis.ts` | F | 204 | `9d2704cb9d6f` | 超时/取消/换源失效；分析帧匹配完整原图 hash、方向和尺寸；导入严格协议校验，未当自动识别成功。 |
| `apps/web/src/editor/useStagePreviews.ts` | F | 144 | `8f056a4231d9` | 每类单在途与末次请求合并；源/几何变化丢弃迟到帧；对比保留几何，源坐标编辑明确禁用当前位移。 |
| `apps/web/src/features.css` | O | 791 | `98f45858ab89` | 前轮修改范围复核；完整旧CSS未在本独立审查逐行重读。 |
| `apps/web/src/lib/api.ts` | F | 77 | `35814ca45bab` | 同源凭据、结构化错误、网络未知态、无自动付费重试、下载文件名与 Blob URL 有界释放。 |
| `apps/web/src/lib/asset-copy.ts` | F | 45 | `079c1fd5c188` | actor/source/target 绑定的复制幂等身份；云端源使用授权复制，不能失败后退回未授权重上传。 |
| `apps/web/src/lib/audio.ts` | F | 51 | `bf7f363715e5` | 受限字节/时长、16k 单声道 PCM、解码失败与 AudioContext 清理；真机编码仍需验收。 |
| `apps/web/src/lib/brand.ts` | F | 9 | `6d55c788bcd8` | 单一可配置品牌回退、logo 版本参数；无外部字体或任意 URL 注入。 |
| `apps/web/src/lib/types.ts` | O | 114 | `4a00f8f98239` | 前轮：Revision自身assetId与服务器契约匹配。 |
| `apps/web/src/lib/uuid.ts` | F | 41 | `3470cf3ffeb7` | Web Crypto UUID 及 getRandomValues 回退；缺安全随机数明确失败，无 Math.random 替代。 |
| `apps/web/src/main.tsx` | F | 14 | `eb6553973cea` | StrictMode、实际样式装载顺序、根容器初始化。 |
| `apps/web/src/motion/motion.css` | O | 2751 | `50a3092017f4` | 前轮：按角色轨迹，媒体祖先零blur，reduced-motion。 |
| `apps/web/src/motion/registry.ts` | O | 2825 | `24f9341501c4` | 前轮：77逻辑角色三档参数；不声称每DOM实例独立动画。 |
| `apps/web/src/motion/usePresence.ts` | F | 51 | `80544b6723a6` | 角色时序与 reduced-motion；退出时保留节点，由组件 inert/hidden 配合。 |
| `apps/web/src/refinement.css` | O | 2093 | `721b7a88ab70` | 前轮修改范围复核；完整旧CSS未在本独立审查逐行重读。 |
| `apps/web/src/styles.css` | O | 4474 | `224b74af9dd0` | 前轮修改范围复核；完整旧CSS未在本独立审查逐行重读。 |
| `apps/web/src/workspace/FloatingPanel.tsx` | O | 561 | `7ccd2f56fa49` | 前轮：单指针所有权、键盘、取消/失焦、尺寸菜单、最大化还原。 |
| `apps/web/src/workspace/panel.css` | O | 343 | `cb84ade5525a` | 前轮：三档/短屏密度、单外线、触摸把手与减少动态。 |
| `apps/web/src/workspace/panelGeometry.ts` | O | 262 | `5ab5554bb15f` | 前轮：自由尺寸/停靠/8边缩放/视口约束，11项几何测试。 |
| `apps/web/src/workspace/useWorkspaceLayout.ts` | O | 167 | `afa1d2c45626` | 前轮：按设备方向与面板偏好、迁移/存储失败降级。 |
| `apps/web/src/workspace/workspace.css` | U | 2331 | `0bd13bb6a1a5` | 已纳入清单；本独立审查未逐行复核。 |
| `apps/web/test/advanced-inspector.test.ts` | O | 131 | `43e722314b41` | 前轮已阅读并执行：4项作用域/合法参数/退化几何；本轮不虚增为又一次逐行审查。 |
| `apps/web/test/ai-capabilities.test.ts` | U | 150 | `db22ec360a94` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/web/test/ai-decisions.test.ts` | O | 103 | `8dcae72e6d6c` | 前轮已阅读并执行：3项真实请求构造/稳定幂等；本轮不虚增为又一次逐行审查。 |
| `apps/web/test/asset-copy.test.ts` | U | 105 | `809bea4d7409` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/web/test/canvas-gesture.test.ts` | F | 100 | `d94961d78c0f` | 6项实际执行：双指释放两种顺序、第三指、重复down、普通缩放、失焦重置、配方/源所有权回滚。 |
| `apps/web/test/color-picker.test.ts` | O | 43 | `a802e00d2acc` | 前轮已阅读并执行：3项连续颜色空间/alpha；本轮不虚增为又一次逐行审查。 |
| `apps/web/test/compound-mask-path.test.ts` | O | 65 | `599c9bc8dfe3` | 前轮已阅读并执行：2项嵌套替换与陈旧路径；本轮不虚增为又一次逐行审查。 |
| `apps/web/test/curve-gesture.test.ts` | O | 263 | `4239adcec494` | 前轮已阅读并执行：10项曲线源/通道/作用域事务；本轮不虚增为又一次逐行审查。 |
| `apps/web/test/histogram-cache.test.ts` | U | 59 | `5ee53f1bf3de` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/web/test/image-sources-flow.test.ts` | U | 95 | `60836934daa7` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/web/test/motion.test.ts` | O | 59 | `0032ca7e55c2` | 前轮已阅读并执行：3项角色和媒体低动态规则；本轮不虚增为又一次逐行审查。 |
| `apps/web/test/precision.test.ts` | U | 155 | `7e2e1d0ad480` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/web/test/range-gesture.test.ts` | O | 57 | `4a8830de87a8` | 前轮已阅读并执行：4项指针/键盘/取消事务；本轮不虚增为又一次逐行审查。 |
| `apps/web/test/recipe-diff.test.ts` | F | 173 | `addcd0da6890` | 6项实际执行：v1/v2及V3数值、非数值块、对象键序/图层顺序、输入不被修改。 |
| `apps/web/test/render-preview-budget.test.ts` | U | 138 | `326fd89d045b` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/web/test/render-worker.test.ts` | U | 96 | `3cb463038262` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/web/test/source-coordinates.test.ts` | T | 78 | `11914843301a` | 本轮实际执行3项，验证变换/保护就绪与源像素映射；未在本轮人工逐条重读测试文件。 |
| `apps/web/test/uuid.test.ts` | U | 83 | `035e4945d89c` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `apps/web/test/workspace-layout.test.ts` | O | 206 | `a9d20d4b6567` | 前轮已阅读并执行：11项连续尺寸/方向/视口退化；本轮不虚增为又一次逐行审查。 |
| `apps/web/tsconfig.json` | F | 17 | `612b38ad4ed9` | strict/noEmit、DOM/Worker 类型边界，源码与 Vite 配置被类型检查纳入。 |
| `apps/web/vite.config.ts` | F | 61 | `b34a4717f9e9` | 开发代理指向实际 API 端口；仅固定 MediaPipe loader 文件直出，缺文件404；无任意路径读取。 |

### apps/worker-ai

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `apps/worker-ai/package.json` | U | 10 | `d8d1846da5ab` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `apps/worker-ai/src/index.ts` | F | 36 | `47f5ae852893` | 真实适配器环境门禁、后台轮询、失配停止、优雅关闭；没有替身自动注入生产路径。 |
| `apps/worker-ai/tsconfig.json` | U | 1 | `2fbd292cd186` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### docs

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `docs/DESIGN.md` | C | 203 | `797197a4e7a6` | 任务上下文已读；本轮没有重新逐段验收全部文档事实。 |
| `docs/EXTENSIONS.md` | U | 226 | `9fe8d3c1b6ad` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/INTERACTION.md` | O | 114 | `a400f214b41d` | 前轮编写/复核记录；内容证据范围见文件自身，不当本轮六次人工代码审核。 |
| `docs/OPERATIONS.md` | U | 178 | `6ae725658041` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/RESEARCH.md` | O | 106 | `c7e0d39c47ed` | 前轮编写/复核记录；内容证据范围见文件自身，不当本轮六次人工代码审核。 |
| `docs/VERIFICATION.md` | U | 94 | `9f5ca56c2908` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/VISION.md` | U | 62 | `6fd9b2c96662` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/screenshots/comparison.jpg` | B | — | `af5bd3e303d4` | 仅列入文件清单与哈希；不把截图/二进制当作人工源码检查。 |
| `docs/screenshots/desktop.jpg` | B | — | `b9e5defcf8f6` | 仅列入文件清单与哈希；不把截图/二进制当作人工源码检查。 |
| `docs/screenshots/phone-390.jpg` | B | — | `784cd5bed1b5` | 仅列入文件清单与哈希；不把截图/二进制当作人工源码检查。 |
| `docs/screenshots/refined-desktop-color.jpg` | B | — | `010d4a704903` | 仅列入文件清单与哈希；不把截图/二进制当作人工源码检查。 |
| `docs/screenshots/refined-landscape.jpg` | B | — | `35e1eb28bca5` | 仅列入文件清单与哈希；不把截图/二进制当作人工源码检查。 |
| `docs/screenshots/refined-phone-curves.jpg` | B | — | `f37bfbeb92a6` | 仅列入文件清单与哈希；不把截图/二进制当作人工源码检查。 |
| `docs/screenshots/refined-portrait-regions.jpg` | B | — | `ff7e94412872` | 仅列入文件清单与哈希；不把截图/二进制当作人工源码检查。 |
| `docs/screenshots/v3-paint-desktop.jpg` | B | — | `2ef6dedc780c` | 仅列入文件清单与哈希；不把截图/二进制当作人工源码检查。 |
| `docs/screenshots/v3-portrait-desktop.jpg` | B | — | `01602712b50d` | 仅列入文件清单与哈希；不把截图/二进制当作人工源码检查。 |
| `docs/verification/browser-refinement.md` | U | 68 | `25af8db397e2` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/verification/initial-baseline.md` | U | 100 | `d1dc0c1f0127` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/verification/initial-rounds.md` | U | 243 | `5f40c0d70495` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/verification/interaction-v2.md` | O | 101 | `b866f50cda5a` | 前轮编写/复核记录；内容证据范围见文件自身，不当本轮六次人工代码审核。 |
| `docs/verification/rounds.md` | U | 243 | `1ab619fac5f6` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/verification/v3-backend-review.md` | U | 87 | `c0ed35eaeca4` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/verification/v3-editor-review.md` | U | 101 | `7a5576041e0f` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/verification/v3-portrait-native.json` | U | 1990 | `07a3aff68abc` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `docs/verification/v3-ui-review.md` | O | 93 | `67d375f23029` | 前轮编写/复核记录；内容证据范围见文件自身，不当本轮六次人工代码审核。 |

### packages/ai

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `packages/ai/README.md` | U | 29 | `7fe6d25c2f86` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/ai/package.json` | U | 15 | `4c4e9ed9142b` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/ai/src/index.ts` | F | 682 | `c8af3ed75be0` | 冻结输入/全局准入/权限复验、任务 claim、调参白名单、双审核、未知预占与人工证据处理；CR-03 待停用恢复策略。 |
| `packages/ai/src/journal.ts` | F | 88 | `d44b99692510` | 独占创建、文件与目录 fsync、哈希绑定数据库；恢复不一致失败停止，不能仅凭缓存自动重发。 |
| `packages/ai/src/lifecycle.ts` | U | 29 | `981849e18550` | 已纳入清单；本独立审查未逐行复核。 |
| `packages/ai/src/multimodal.ts` | F | 1296 | `778887050f4b` | 多模态严格输入、引用文件哈希/像素预算、冻结 manifest、整批审核原子发布、授权复验和未知结果保持。 |
| `packages/ai/src/provider.ts` | F | 249 | `0c47e79fe807` | 批准端点、无照片时禁止声称看过图片；严格数值提案、单次请求、V3 继承数据完整保留、无任意路径写入。 |
| `packages/ai/test/multimodal.test.ts` | U | 1360 | `9a3185a11cad` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/ai/test/openai.test.ts` | U | 519 | `3f16dc2d3e53` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/ai/test/provider.test.ts` | U | 330 | `9f9318d89370` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/ai/test/service.test.ts` | U | 240 | `bb955037888c` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/ai/tsconfig.json` | U | 1 | `0202ddd07a99` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### packages/contracts

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `packages/contracts/README.md` | U | 18 | `389914777554` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/contracts/package.json` | F | 8 | `8355f8933fc5` | 工作区统一契约入口；没有重复拷贝前端专属数据模型作为权威。 |
| `packages/contracts/src/catalog.ts` | F | 366 | `d20c77015676` | 模块/能力/权限/输入输出/限制可发现；contract-only 与执行器分开，不能用功能目录证明已实现全部商业能力。 |
| `packages/contracts/src/index.ts` | F | 3 | `10d1abc72332` | 单一协议/注册器/目录公共出口。 |
| `packages/contracts/src/protocol.ts` | F | 266 | `8ce7a21e310b` | 严格版本/资源帧/参数范围、动作辨别联合、expectedVersion、文本替换成对字段，编辑原文标记。 |
| `packages/contracts/src/registry.ts` | F | 117 | `b6473816d12c` | 命名空间/重复/依赖环校验、注册封存、返回克隆、runtime gate；元数据不执行第三方代码或代替ACL。 |
| `packages/contracts/test/contracts.test.ts` | U | 174 | `af8ccfe0b203` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/contracts/tsconfig.json` | U | 1 | `0202ddd07a99` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### packages/db

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `packages/db/package.json` | U | 11 | `20d797896663` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/db/src/index.ts` | F | 150 | `c3781ac17628` | 事务 rollback/finally、迁移版本1–7与锁、发布锁/引用感知清理、事件提交顺序。 |
| `packages/db/src/migrate.ts` | F | 11 | `9f79d83264f1` | 显式 DATABASE_URL、调用共享迁移、成功/失败后关闭连接池。 |
| `packages/db/src/quota.ts` | F | 266 | `aae335d7bcb6` | wallet 串行化、月批次唯一、预占/结算/释放状态机、归还原批次并尊重过期、未知不自动重试。 |
| `packages/db/src/schema-v3.ts` | F | 8 | `8f9c66d614bb` | 素材说明为独立版本元数据，不改原始内容；列表索引。 |
| `packages/db/src/schema-v4.ts` | F | 65 | `f7e0e4b4e250` | revision 源快照/不可变与同项目引用触发器；结果决定独立不可变记录。 |
| `packages/db/src/schema-v5.ts` | F | 5 | `69878bd81042` | 只追加 contentEdited 标记，保留既有决定和来源。 |
| `packages/db/src/schema-v6.ts` | F | 6 | `c698d53aaad3` | 前向扩展 layer action 约束，不重写既有决定。 |
| `packages/db/src/schema-v7.ts` | F | 77 | `72dd2f95e99a` | 逻辑保留容量、原子配额触发器、素材内容与副本来源不可变；软删除不假释放容量。 |
| `packages/db/src/schema.ts` | F | 219 | `902fc38f6020` | 原始表约束、额度守恒、ledger/revision/audit/document/plan 不可变、v2 追加迁移。 |
| `packages/db/test/fault-database.ts` | U | 56 | `3465c90bb91b` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/db/tsconfig.json` | U | 5 | `055076ab4314` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### packages/editor

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `packages/editor/README.md` | U | 332 | `9389dde9e980` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/editor/V3.md` | U | 161 | `64f628260915` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/editor/package.json` | U | 16 | `85d0a1408237` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/editor/src/curves.ts` | F | 36 | `e4d6bae5a7a4` | X有序控制点、线性插值允许Y反相、LUT有界，公开编译入口先校验。 |
| `packages/editor/src/engine.ts` | F | 453 | `55a1acff28c2` | v1固定运算顺序、线性光与编码域分离、透明RGB不污染邻域、有限细节、取消检查、中性保真。 |
| `packages/editor/src/geometry.ts` | F | 213 | `1055983f12f5` | 独立普通/分块预算、裁切 floor/ceil、整数旋转/镜像及逆坐标一致。 |
| `packages/editor/src/headers.ts` | F | 611 | `52f888e0bcd0` | 1MiB前缀预算、实际文件签名、PNG/JPEG/WebP/BMP/GIF/AVIF结构/尺寸检查；不能替代压缩像素解码校验。 |
| `packages/editor/src/index.ts` | F | 121 | `7fd1ec3e4c08` | v1/v2/v3公共导出与不同渲染/解析/迁移函数明示，没有静默降级。 |
| `packages/editor/src/mask.ts` | F | 16 | `7966873ba709` | 原图归一椭圆、内外及反选、平滑羽化；专用算法不冒充识别人像。 |
| `packages/editor/src/recipe.ts` | F | 332 | `53f5a91bf579` | 普通数据对象/禁止getter、未知字段/稀疏数组/循环拒绝、有限数值、严格曲线/几何与显式schema。 |
| `packages/editor/src/registry.ts` | F | 183 | `598d3ad846c1` | 真实算法对应范围/中性值/单位，双向数值与独立非负锐化柔化的语义明确。 |
| `packages/editor/src/tiled.ts` | F | 109 | `085abf903249` | 旧版分块共享同一参考实现、正确halo、原图坐标、只拼接核心区域，不把分块写成零内存。 |
| `packages/editor/src/types.ts` | F | 135 | `9bc7ab62bebe` | RGBA8 straight alpha sRGB、EXIF已定向、旧schema数值域、不同渲染预算语义。 |
| `packages/editor/src/v2-engine.ts` | F | 550 | `f5f3f00617b2` | 固定旧色阶/HSL/分级/细节/局部顺序、确定性颗粒、halo随局部细节增长、v1原解释器保持。 |
| `packages/editor/src/v2-mask.ts` | F | 255 | `5375ffaffefb` | 源坐标域外为0、羽化/反选、连续色相/饱和/亮度、透明排除、有界栅格游程、不隐藏位图分配。 |
| `packages/editor/src/v2-recipe.ts` | F | 615 | `75d9cef4aab9` | 扩展数值联合约束、局部/点/栅格预算、严格mask辨别联合、复制安全、显式迁移和V3禁止降级。 |
| `packages/editor/src/v2-registry.ts` | F | 339 | `be074a30db05` | 八色段之间连续插值而非离散颜色限制；数值路径范围与真实budget常量。 |
| `packages/editor/src/v2-types.ts` | F | 175 | `7e18119ed86e` | 旧版局部和完整扩展参数结构，版本/算法语义与V3兼容继承范围。 |
| `packages/editor/src/v3-blend.ts` | S | 112 | `71b275f98a51` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/editor/src/v3-engine.ts` | S | 198 | `cbba8a3d7d26` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/editor/src/v3-geometry.ts` | S | 254 | `d1907ef77b9b` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/editor/src/v3-mask.ts` | S | 49 | `b82c35717ea6` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/editor/src/v3-optics.ts` | S | 95 | `7b95cb887032` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/editor/src/v3-paint.ts` | S | 275 | `11d408f1f2c6` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/editor/src/v3-pixels.ts` | S | 76 | `7af2bfce4975` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/editor/src/v3-recipe.ts` | S | 675 | `9cdc7b125bd7` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/editor/src/v3-registry.ts` | F | 202 | `2179396fd996` | 实际V3数值/图层/蒙版/位移预算、16混合与真实参数；没有增加AI任意写入路径。 |
| `packages/editor/src/v3-types.ts` | F | 218 | `ba12f4f1f2b5` | 原图归一、完整ColorBlock、多独立选区/组、显式图层来源、可重放笔触和双向位移、origin追溯。 |
| `packages/editor/src/v3-warp.ts` | S | 95 | `cb2974679498` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/editor/test/editor.test.ts` | U | 606 | `ddc68a54ed80` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/extended-headers.test.ts` | U | 112 | `df09d0f04dd6` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/header-audit.test.ts` | U | 305 | `4b3608db6421` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/headers.test.ts` | U | 225 | `f1c264bcc132` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/render-worker.mjs` | U | 5 | `3868c9c25344` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/tiled-worker.mjs` | U | 18 | `06745c68de4f` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/tiled.test.ts` | U | 397 | `9c03b77f2f61` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/v2-mask.test.ts` | U | 275 | `d6d866888908` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/v2-recipe.test.ts` | U | 315 | `05c9b38495c8` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/v2-render.test.ts` | U | 787 | `59b7a21e819c` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/v2-worker.mjs` | U | 18 | `fb9607705f6d` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/v3-composite.test.ts` | U | 573 | `5bcc0882abb8` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/v3-geometry.test.ts` | U | 248 | `1df9e3d500de` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/v3-recipe.test.ts` | U | 285 | `23f98f7e13cf` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/test/v3-worker.mjs` | U | 23 | `4ce3c4915bf9` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/editor/tsconfig.json` | U | 4 | `902aedcca693` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### packages/multimodal

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `packages/multimodal/OPENAI.md` | U | 57 | `133fd2deba17` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/multimodal/README.md` | U | 131 | `18af50d021f0` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/multimodal/package.json` | U | 21 | `a0835dbf58d5` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/multimodal/src/ark.ts` | F | 258 | `6624817aaf43` | 运营绑定准确模型与 profile、国内固定端点、单图和参考约束、base64字节解码、拒绝跟随输出 URL。 |
| `packages/multimodal/src/http.ts` | F | 128 | `1b28d224f9a1` | 单次有界 POST、禁止重定向、响应体/超时限制、拒绝与未知区分，不自动重试付费调用。 |
| `packages/multimodal/src/index.ts` | F | 21 | `ef2da6fe4390` | 公共导出只暴露受验证的适配器与共享传输；端点冻结仍由上层负责。 |
| `packages/multimodal/src/openai.ts` | F | 462 | `ee412899d2d2` | 固定官方端点、明确模型白名单/参数依赖、引用/批次预算、整批输出数与像素/MIME校验、透明性实查。 |
| `packages/multimodal/src/qwen.ts` | F | 99 | `9de05beb26b6` | ASR 固定北京端点/模型白名单、严格 WAV、完整完成状态和输出长度，禁止未知结果伪报转写成功。 |
| `packages/multimodal/src/types.ts` | F | 118 | `86c3aac1c7fd` | 模型能力、参考/遮罩/参数/结果契约，供应商未知字段不会通过类型自动获授权。 |
| `packages/multimodal/src/wav.ts` | F | 53 | `fdedc786effe` | RIFF 边界、单 fmt/data、16k单声道PCM16、30秒预算、不接受压缩/扩展格式。 |
| `packages/multimodal/test/adapters.test.ts` | U | 460 | `9fda7ce99a24` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/multimodal/test/openai.test.ts` | U | 337 | `676c736d9a25` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/multimodal/tsconfig.json` | U | 1 | `0202ddd07a99` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### packages/portrait

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `packages/portrait/README.md` | U | 145 | `0912a82b2862` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/portrait/package.json` | U | 20 | `1073065bdde3` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/portrait/src/adapter.ts` | S | 72 | `3fd85040c68e` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/portrait/src/catalog.ts` | S | 72 | `7ca070476851` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/portrait/src/geometry.ts` | S | 142 | `9e5639cae961` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/portrait/src/index.ts` | S | 22 | `221ef1c55c89` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/portrait/src/plans.ts` | S | 746 | `4f423298e6d6` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/portrait/src/types.ts` | S | 37 | `e2d678db7512` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/portrait/src/validation.ts` | S | 192 | `e1613e0f4c26` | 本独立审查未逐行复读；引擎/人物专项记录见 v3-editor-review.md，不借用为本人的人工覆盖。 |
| `packages/portrait/test/fixtures.ts` | U | 86 | `6d2a73506a3b` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/portrait/test/portrait.test.ts` | U | 451 | `875b755a17ea` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/portrait/tsconfig.json` | U | 1 | `a61cc0903b4a` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### packages/providers

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `packages/providers/README.md` | U | 53 | `0dad6c169f3c` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/providers/package.json` | U | 11 | `a453487bccb6` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/providers/src/index.ts` | F | 350 | `a7d3110a7841` | TC3 签名、固定腾讯端点、短信收件人/状态验证；文本/图片审核类型分开、字节/像素预算、未知失败关闭。 |
| `packages/providers/test/providers.test.ts` | U | 230 | `442167b1f598` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/providers/tsconfig.json` | U | 5 | `055076ab4314` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### packages/storage

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `packages/storage/README.md` | U | 61 | `8a72a70a4699` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/storage/package.json` | U | 11 | `e999abf18114` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `packages/storage/src/index.ts` | F | 437 | `f96c9c75f21d` | 实际字节探测/Sharp限制、动画/危险格式拒绝、私有原子持久化、规范化与缩略图、引用感知清理责任。 |
| `packages/storage/test/storage.test.ts` | U | 210 | `b85ac24c50b7` | 已纳入清单；本独立审查未逐条阅读/执行此文件，不据此推断全部用例通过。 |
| `packages/storage/tsconfig.json` | U | 5 | `055076ab4314` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |

### scripts

| 文件 | 状态 | 行数 | SHA-256前缀 | 关键复核 / 范围说明 |
| --- | --- | ---: | --- | --- |
| `scripts/dev.mjs` | F | 60 | `bf602ad2e349` | 先迁移再启动API/worker/web、子进程失败退出、信号清理，避免未迁移库执行AI。 |
| `scripts/doctor.ts` | F | 93 | `88e8a6d22ed8` | 本地配置/DB/私有目录fsync检查、不发供应商请求、不打印凭据；schema最低版本遗漏见CR-04。 |
| `scripts/local-db.mjs` | F | 80 | `169add609994` | 仅非root本地开发、随机凭据文件0600且忽略、localhost绑定、保留数据而非重建生产库。 |
| `scripts/prepare-vision.mjs` | F | 70 | `44e629373c28` | 官方版本化模型与WASM同源资源、size/SHA/结构核验、受限下载、不在用户运行时外部CDN加载。 |
| `scripts/qa/README.md` | U | 52 | `68fff164c101` | 根任务正在维护的真实模型QA材料；本独立审查未执行或逐行复核。 |
| `scripts/qa/portrait-native-fetch.py` | U | 26 | `b03fa008e419` | 根任务正在维护的真实模型QA材料；本独立审查未执行或逐行复核。 |
| `scripts/qa/portrait-native-infer.py` | U | 161 | `d05fe888a0c5` | 根任务正在维护的真实模型QA材料；本独立审查未执行或逐行复核。 |
| `scripts/qa/portrait-native-inputs.json` | U | 26 | `1d73d4053665` | 根任务正在维护的真实模型QA材料；本独立审查未执行或逐行复核。 |
| `scripts/qa/portrait-native-report.mjs` | U | 153 | `9ee3f4c8d2f4` | 根任务正在维护的真实模型QA材料；本独立审查未执行或逐行复核。 |
| `scripts/qa/portrait-native-requirements.txt` | U | 21 | `f558d7b17cae` | 根任务正在维护的真实模型QA材料；本独立审查未执行或逐行复核。 |
| `scripts/qa/portrait-native-verify.ts` | U | 345 | `702d15f62fa4` | 根任务正在维护的真实模型QA材料；本独立审查未执行或逐行复核。 |
| `scripts/qa/portrait-native-visuals.py` | U | 74 | `28933dae0fa0` | 根任务正在维护的真实模型QA材料；本独立审查未执行或逐行复核。 |
| `scripts/test.mjs` | F | 20 | `b605d899da40` | 收集实际测试文件、受控并发；数据库缺失不能在强制模式被悄悄算通过。 |
| `scripts/tsconfig.json` | U | 4 | `487cd5319c8b` | 已纳入清单；本独立审查未逐段复核内容。锁文件/许可证清单不等于供应链或法律认证。 |
| `scripts/typecheck.mjs` | F | 20 | `e8c25cb67427` | 发现各app/package/scripts实际TS配置，任何检查失败退出。 |
| `scripts/verify.mjs` | F | 97 | `bdd41d2a1449` | 源码哈希前后、typecheck/tests/build/audit四门；强制DB测试，轮次证据不等于人工每行审核。 |
| `scripts/vision-assets.mjs` | F | 66 | `3ebca2332eae` | 模型长度/哈希/TFL3或task容器完整性验证；不是运行质量认证。 |
| `scripts/with-lite.mjs` | F | 66 | `40e8e554b20e` | WASM数据库仅开发/测试、生产拒绝、测试隔离内存库；不替代原生PostgreSQL并发验收。 |
