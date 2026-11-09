# 映间 · 可扩展的 AI 图像创作基线

“映间”是可替换的初始品牌。项目围绕作品组织精修、草图、AI、多版本和团队工作，个人与团队处于同一个工作台。品牌名称、说明、公开图标由运营配置提供，源码包名不决定产品名称。

这是 **0.1 开发基线**：真实的编辑内核、持久数据、鉴权、额度账本和供应商适配器已经串联；没有内置演示账户、伪造验证码、假 AI 回复或默认收费凭据。完整人像重塑、图层合成、实时 CRDT 和商业支付不冒充已完成。

![内容优先的桌面工作台](docs/screenshots/refined-desktop-color.jpg)

默认把空间留给作品，工具按需出现；支持移动和调整面板、停靠、专注模式及按屏幕保存布局。另见[多选区人像精修](docs/screenshots/refined-portrait-regions.jpg)、[短横屏布局](docs/screenshots/refined-landscape.jpg)和[当前实操记录](docs/verification/browser-refinement.md)。截图使用公开示例照片或独立技术测试构图；产品没有预置演示作品。

## 从这里开始

| 入口                                          | 内容                                               |
| --------------------------------------------- | -------------------------------------------------- |
| [项目总设计](docs/DESIGN.md)                  | 模块、数据、权限、联动、扩展与后续开发边界         |
| [部署、成本与网络](docs/OPERATIONS.md)        | 本地运行、账号配置、部署、代理判断、成本与上线验收 |
| [实现与验证记录](docs/VERIFICATION.md)        | 实际检查范围、结果、未完成的外部实测               |
| [API 契约](apps/api/API.md)                   | 可直接用于后续开发的真实端点、请求、响应           |
| [图像核心](packages/editor/README.md)         | 数值语义、配方版本、几何与内存预算                 |
| [多模态适配器](packages/multimodal/README.md) | OpenAI / Ark 生图、Qwen ASR、模型档案、格式及错误分类 |
| [OpenAI 参数契约](packages/multimodal/OPENAI.md) | 按模型映射的参数、依赖、预算与尚未开放的能力 |
| [交互与能力边界](docs/INTERACTION.md) | 多局部、自由构图、精细调色、响应式和后续扩展 |
| [工作台说明](apps/web/README.md)              | 响应式交互、本地处理与云端保存                     |

## 本地运行

需要 Node.js 24（锁定版本见 `.nvmrc`）和 npm。不要把生产数据库用于测试。

```sh
npm ci
cp .env.example .env
# 在 .env 中设置随机 SESSION_SECRET（至少 32 字符）。不要提交该文件。
npm run dev:lite
```

`dev:lite` 使用持久化的开发 PostgreSQL WASM 数据库，启动 API、独立 AI Worker 与 Vite；默认网页是 `http://localhost:5173`。它适用于本地开发，不能代替原生 PostgreSQL 的并发/生产验收。也可以提供真实 `DATABASE_URL`，运行 `npm run db:migrate` 后使用 `npm run dev`。

首次运营账号通过受控命令行创建：先停止 `dev:lite`，仅在私有 `.env` 中设置 `BOOTSTRAP_ADMIN_PHONE`、`BOOTSTRAP_ADMIN_PASSWORD`、`BOOTSTRAP_ADMIN_NAME`，执行 `npm run admin:lite`，然后从 `.env` 移除这三项并重新启动。原生数据库使用 `npm run admin:create`。命令拒绝替换已有运营账户，不打印密码；这是站点持有者的初次配置，不是用户注册的验证码替代方案。

未配置短信时，普通注册/验证码入口会明确报告不可用。未配置模型或审核时，AI 入口不会产生假结果，也不会自动调用收费接口。本地图像编辑和草图不依赖账号。

## 核心能力

- **编辑**：版本化 v1/v2 非破坏配方；13 项基础参数及 52 条新增数值路径；连续 HSL、三路分级、色阶、纹理/清晰度、颗粒/暗角；自由像素裁切、可拖曲线、最多 8 个独立区域与 6 类选区。美颜为顶层手动分人精修，自动人像分析尚未接入。
- **AI**：参数建议、文字/草图/多参考图生图与编辑、文本迭代、短语音识别；按任务与模型能力呈现参数。v2 建议可修改白名单内的 65 个数值路径，呈现实际差异后由用户确认。每个任务有冻结输入、审核、额度预占、状态与核验记录。
- **数据**：私人素材、项目、作品、不可变版本、讨论、任务和文档；空间与项目范围内搜索、分页、日期/来源分组；可编辑的声明标题、标签、拍摄时间和手工位置。编辑与元数据保存都有版本比较，冲突不静默覆盖。
- **空间**：个人与团队统一导航；owner/admin/editor/reviewer/viewer 分工；参考授权与独立复制分别控制，额度不在个人与团队之间偷偷挪用。
- **运营**：账户、注册模式、免费周期权益、套餐目录、模型范围、品牌与图标、带原因的正负额度调整和审计。
- **部署**：同源网页/API、独立 Worker、PostgreSQL、私有存储与发送日志；提供 Docker Compose、环境模板和 GitHub Actions。

详细支持的格式、分辨率与布局以当前版本文档为准。配置存在、适配器测试通过和真实供应商账户完成验收，是三个不同的状态。

## 验证命令

```sh
npm run typecheck
npm run test:lite
npm run build
npm run verify:lite -- local-round

# 指向隔离的原生测试库后：
npm run verify -- native-round
```

`verify` 包含全工作区严格类型检查、完整自动测试、生产前端构建和生产依赖审计；没有 `TEST_DATABASE_URL` 时拒绝把数据库测试算作通过。报告保存到被 Git 忽略的 `artifacts/verification`。各测试文件串行运行，文件内显式的并发场景继续验证锁和幂等。

## 仓库结构

```text
apps/web          内容优先的浏览器工作台
apps/api          同源 HTTP API、账户、空间、项目与运营
apps/worker-ai    独立的持久任务执行器
packages/editor  版本化配方、数值算法、几何、格式门禁
packages/db      PostgreSQL 迁移、事务、账本与事件
packages/storage 私有素材接收、安全规范化与有界读取
packages/providers Tencent 短信/文本与图片审核
packages/multimodal OpenAI / Ark 生图、Qwen 语音适配器
packages/ai      任务编排、冻结输入、计费状态与恢复保护
infra            容器与同源反向代理
scripts          开发、诊断和验证入口
```

后续扩展请先读 [AGENTS.md](AGENTS.md)。新增工具应同时增加数值语义、配方迁移和回归用例；新增模型应实现现有适配器接口；新增收费流程应进入同一个不可变账本，不能直接改余额。
