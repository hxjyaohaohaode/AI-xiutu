# 前端深度改版：分阶段测试记录

## 已取得的完整验收与收尾范围

PR #6 的功能提交 `794d3fb0b35a66a46bd1d89c741f9a942edadcf5` 已通过原生基线、两种 motion 的 Account、独立 AI、容器和完整综合浏览器工作流。实际 PR 合并检查提交为 `d27b463b93b8824dfe702f2ba1544e887feaf630`，两者 Git tree 均为 `b8a4161298f0e47e99b0984a370f9709c73aeea6`；它也与本地受检 `086fc1d` 的 tree 一致。具体检查、作用域和链接见本文末尾的 GitHub CI 节。

此后收尾仅统一 About 默认品牌标记、补拍英文人像图和更新文档及证据，未再修改 TypeScript/JavaScript、编辑器、接口或算法。品牌修正保持桌面 31 × 31、手机 27 × 27 的外框和自定义 logo 分支，复用工作台已有视觉规则。收尾 Web 构建与格式检查通过；入口 CSS 为 **53.70 kB / gzip 12.33 kB**，延迟编辑器块仍为 **626.85 kB / gzip 185.79 kB**。这项样式修正之后的 CI 结果以 [PR #6 checks](https://github.com/hxjyaohaohaode/AI-xiutu/pull/6/checks) 的对应提交为准，不把 `794d3fb` 的通过冒充为后续提交已经执行。

[实际 About 浏览器截图及来源](evidence/frontend-immersive-20261111/README.md) 保留所对应的受检版本；[前后端能力边界](../design/backend-front-alignment-20261111.md) 与当前主线 `6625ce8` 对齐。

## 早期 lite 快照结论（历史记录）

下方完整 `npm run test:lite` 记录属于 **05:09 开始的旧工作区快照**：Node 测试运行器报告 **951 项：936 通过、13 失败、2 跳过、0 取消**，退出码为 **1**。它早于 `58ce371` 合入主线 `2392944`，也早于随后的人像超时与人物标签修正；不能写成当前源码的完整测试结果或“全部测试通过”。

本地环境使用隔离的 PostgreSQL 18 WASM / PGlite，包装器固定 `DB_POOL_MAX=1`。两项直接连接超时及其后续失败需要在原生 PostgreSQL 多连接环境重新验收。测试没有被删减、改成跳过或放宽断言，生产代码和官方 lite 包装器均未为本环境修改。原生 PostgreSQL 的最终门槛由相应提交的 GitHub CI 单独记录。

后续新增证据为：合入 `6625ce8` 后精度组合 **67/67**、人物/三语组合 **28/28**；再之后手机面板恢复修正 **47/47**，两阶段 Web 类型检查均通过。各阶段源码范围不同，不能相加或视为完整套件；**最终发布源码的原生 PostgreSQL CI 仍待验收**。

## 合并后的审阅范围

最后静态审查的合并基线为 `58ce371b80d9aff2ca9b36e31854f5d849635570`，其中主线父提交为 `2392944b98410e4983209334e0e10320540dfee2`。工作区随后仍有人像识别超时提示、三语人物标签和实际截图更新，因此只记录每一项检查真正覆盖的阶段，不将较早的通过继承给最终提交。

已核对 `SiteShell.tsx` 与 `public-shell.css`：介绍页使用文档滚动，工作台隐藏时具有 `hidden` / `inert`；动效组件没有监听或阻止 wheel/touch。`AboutPage.tsx` 的界面截图具有比例占位、加载状态、失败重试和三语 alt；功能预览与 Agent 步骤支持键盘焦点；FAQ 已处理悬停打开后的首次点击，关闭答案具有 `inert`。低高度横屏取消了功能图的 sticky 定位。

本次审查仅追加一处效果样式修正：`ScrollReveal` 的片段增加 `max-width: 100%` 与 `overflow-wrap: anywhere`，让不支持 `Intl.Segmenter` 时的整段中文后备内容和超长英文词仍可在窄屏折行。这是静态逻辑与布局约束检查，不冒充实际浏览器尺寸测量。参考站实际操作、源码与最终页面位置的逐项对应见 [参考研究记录](../../apps/web/src/about/effects/REFERENCE_STUDY.md)。

### 合并后定向回归

以下由移动编辑实现代理在共享工作区实际执行，原始结果保留在相应工具会话，没有另存完整日志；本报告未重复运行，也不把这些数量相加为互不重叠的测试总数。

| 阶段                              | 实际结果                                | 原始会话与范围                                                                                   |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 合入 `2392944` 后的精度与预览组合 | 66 通过，0 失败；4392.482901 ms         | 会话 `37836`；Worker 清晰度/生命周期、自适应预算、选区/画布/范围手势、参数架及径向蒙版/液化/几何 |
| 人像超时提示修正                  | 26 通过，0 失败；4883.278118 ms         | 会话 `26040`；错误规范化、人物选择和三语目录                                                     |
| 默认人物标签三语修正              | 28 通过，0 失败、0 跳过；4143.905549 ms | 会话 `29311`；同一组合增加两个默认标签回归，覆盖语言切换与原始标签数据不被改写                   |

精度组合的实际命令：

```sh
node --import tsx --test apps/web/test/render-worker-quality.test.ts apps/web/test/interactive-preview-policy.test.ts apps/web/test/render-preview-budget.test.ts apps/web/test/render-worker.test.ts apps/web/test/render-worker-lifecycle.test.ts apps/web/test/selection-transform.test.ts apps/web/test/canvas-gesture.test.ts apps/web/test/range-gesture.test.ts apps/web/test/parameter-shelf.test.ts packages/editor/test/radial-mask.test.ts packages/editor/test/flow-warp.test.ts packages/editor/test/v3-geometry.test.ts
```

26 项与后续 28 项使用相同命令，后者含新增回归：

```sh
node --import tsx --test apps/web/test/portrait-analysis-errors.test.ts apps/web/test/portrait-selection.test.ts apps/web/test/i18n.test.ts
```

### 05:36 当前工作区类型检查与构建

本报告代理在人物标签修正落盘后重新执行 `npm run build`，它按仓库脚本先运行全仓 `npm run typecheck`，再运行 Web 生产构建。**14 个 TypeScript 项目通过，生产构建通过，退出码 0**。这属于 **合入后续主线 `6625ce8` 之前** 的工作区，不代表该新主线组合已通过。

| 项目                | 实际记录                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 时间                | `2026-11-11T05:36:30.392Z` 至 `2026-11-11T05:37:15.485Z`                                                                 |
| HEAD                | `58ce371b80d9aff2ca9b36e31854f5d849635570`，加本轮人像修正与效果样式                                                     |
| 输入指纹            | 591 个源码/测试/脚本/配置文件，起止均为 `cd04632d9a91941bac1fe81d83f1da11e39c1f459f4d8654314570555a311897`，运行中无变化 |
| 构建                | 4,925 个模块；Vite 阶段 981 ms                                                                                           |
| 主入口 / 独立编辑器 | 339.02 kB / 626.31 kB；gzip 为 106.87 kB / 185.62 kB                                                                     |
| 日志 SHA-256        | `0debb491e77212222bd186914edee43a40a5219dba53f95eb223aecc1475b91e`                                                       |

原始日志和起止快照在 `artifacts/verification/frontend-immersive-20261111/` 的 `build-final.log`、`build-final-summary.json`、`build-source-start.json` 与 `build-source-end.json`。构建保留了独立编辑器块超过 500 kB 的提示，没有调高阈值隐藏它。此命令未执行单元/API 测试或浏览器测试，**没有当前提交的原生 PostgreSQL CI 通过结论**。

### 05:38 合入 `6625ce8` 后复验

已读取 `merged-precision-summary.json` 和完整日志，并核对日志 SHA-256。受检 HEAD 为 `3031f8e44141895701e93be8ec200ab2e930f7b3`；执行时间 **05:38:16–05:38:35 UTC**，摘要记录 591 个源码输入起止无变化。

| 命令范围                             | 实际结果                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 上文相同精度组合命令                 | **67 通过，0 失败、0 跳过**；3144.082889 ms。比旧 66 项增加液化最新笔刷窗口重放回归，包含重叠历史、反向与保护编辑。 |
| 上文相同人物/三语命令                | **28 通过，0 失败、0 跳过**；3583.506083 ms。                                                                       |
| `npm run typecheck -w @ai-xiutu/web` | 退出码 **0**。                                                                                                      |

原始文件为 `artifacts/verification/frontend-immersive-20261111/merged-precision.log` 与 `merged-precision-summary.json`；日志 SHA-256 为 `1216bdba4a7c2e0056973097c5cb0560c0b429c497d9d672dbde087c3d49a1a9`。该次复验早于下面的手机面板修改。

### 05:49 手机面板恢复与拖拽归属回归

真实预览发现保存为 112px 的手机面板不能通过“编辑”恢复到可用高度，并发现跨设备视口后的旧拖拽事件归属问题。修正后的回归检查真实 `FloatingPanel` 处理器：恢复可用高度、旧桌面拖拽的延迟回调/释放/取消不能写入新手机视口，同一视口仍可精确提交或回退。

**05:49:02–05:49:21 UTC** 执行下列组合，**47 通过，0 失败、0 跳过**，测试耗时 **4203.078229 ms**；随后 Web 类型检查通过，五个拥有文件的格式检查通过。

```sh
node --import tsx --test apps/web/test/workspace-layout.test.ts apps/web/test/floating-panel-gesture.test.ts apps/web/test/parameter-shelf.test.ts apps/web/test/range-gesture.test.ts apps/web/test/i18n.test.ts
```

已读取 `mobile-panel-recovery-summary.json` 与日志并核对 SHA-256。摘要只证明 `FloatingPanel.tsx`、`panelGeometry.ts`、`useWorkspaceLayout.ts` 及两个对应布局/手势测试文件起止哈希一致，**不是全仓冻结快照**。原始文件为同目录的 `mobile-panel-recovery.log` 与 `mobile-panel-recovery-summary.json`；日志 SHA-256 为 `40e3a56c0e1d8ba3c37b531f25ee82bf104d38fb2ffa91a37da97faa6048ce99`。它不与 05:38 的 67/28 项混计，真实 HTTPS 手机复测、最终完整构建与原生 CI 结果由主任务另行记录。

## 05:09 完整 lite 运行：环境与范围

| 项目           | 本轮实际记录                                                           |
| -------------- | ---------------------------------------------------------------------- |
| 标准命令       | `npm run test:lite`                                                    |
| 实际链路       | `scripts/with-lite.mjs test` → `scripts/test.mjs` → Node 测试运行器    |
| 发现的测试文件 | 115 个，来自 `apps`、`packages`、`tests`                               |
| 执行方式       | 测试文件串行；文件内部原有的显式并发测试保持不变                       |
| 数据库         | 独立内存 PGlite，通过本机 PostgreSQL wire 接口访问；不复用开发数据库   |
| Node / 系统    | Node.js `v24.22.1`，Linux x64，uid 1000                                |
| 开始时间       | `2026-11-11T05:09:04.182Z`                                             |
| 结束时间       | `2026-11-11T05:11:50.473Z`                                             |
| Node 测试耗时  | `162476.636097 ms`，约 162.48 秒                                       |
| 命令总历时     | 约 166.29 秒，包含数据库与包装器启动、清理                             |
| 退出码         | `1`                                                                    |
| HEAD 基线      | `8d9d3bb9b9d716336f6ae1ae21ce8d6424e6a814`，加本轮尚未提交的工作区改动 |

测试启动前已等待移动端自适应预览生产代码及其最后一项源像素恢复断言落盘。环境检查确认没有 `.env`，没有预置 `TEST_DATABASE_URL`，所需 PGlite 与 socket 包已安装。测试包装器建立自己的内存数据库、设置测试环境并在退出时关闭。

主任务此前记录 `npm run db:local` 的 embedded-postgres 初始化发生同步异常，未成功启动原生服务。本报告没有再次尝试绕过该异常，也没有以新的端口、权限或网络路径规避环境约束。

## 失败项：完整保留

Node 的 13 个失败记录由 **11 个失败子例和 2 个失败父例**组成。父例聚合失败也计入 Node 的总数，不能误写成 13 个独立根因。

### 语音 WebSocket 组：10 个子例与 1 个父例

源码：`apps/api/test/assistant.test.ts`。父例为 `actual local websocket bridge: origin/ticket/PCM/Live delegation/Realtime/revocation/uncertain close`。

| 失败子例                                                                                                 | 本轮观测                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `disconnect during an actual database-blocked handshake never opens the vendor socket or hangs shutdown` | `pg-pool` 报 `timeout exceeded when trying to connect`，约 5.04 秒。栈指向持有事务锁时另外调用 `f.db.query` 查询锁等待的步骤。 |
| `disabled models between prepare and upgrade never open the paid upstream`                               | 准备通话返回 `409 VOICE_ALREADY_ACTIVE`，期望 `200`。                                                                          |
| `late session.started cannot resurrect a recovered connecting session or send ready`                     | 准备通话返回 `409 VOICE_ALREADY_ACTIVE`，期望 `200`。                                                                          |
| `Live final event without usage remains unknown and reserves its hold for reconciliation`                | 准备通话返回 `409 VOICE_ALREADY_ACTIVE`，期望 `200`。                                                                          |
| `typed moderation and single in-flight responses stop unbounded Realtime request queues`                 | 准备通话返回 `409 VOICE_ALREADY_ACTIVE`，期望 `200`。                                                                          |
| `network loss cannot be reported as free or successfully settled`                                        | 准备通话返回 `409 VOICE_ALREADY_ACTIVE`，期望 `200`。                                                                          |
| `removing a member terminates their active voice access`                                                 | `openVoice` 内等待状态超过 8000 ms。                                                                                           |
| `arbitrary upstream configuration events are not forwarded`                                              | 准备通话返回 `409 VOICE_ALREADY_ACTIVE`，期望 `200`。                                                                          |
| `a new canvas invalidates already published voice candidates and in-flight delegates`                    | 准备通话返回 `409 VOICE_ALREADY_ACTIVE`，期望 `200`。                                                                          |
| `graceful shutdown drains an already dispatched delegation before database settlement`                   | 准备通话返回 `409 VOICE_ALREADY_ACTIVE`，期望 `200`。                                                                          |

已同时核对测试代码和连接池配置：该组首个失败用例通过 `f.db.connect()` 持有事务连接与行锁，然后在释放前要求池再提供连接；`with-lite.mjs` 固定池大小为 1，`packages/db/src/index.ts` 的取连接超时为 5000 ms。这解释了已观测的首个取连接超时。其后的八个 `VOICE_ALREADY_ACTIVE` 和一个状态等待超时发生在同一父例的共享夹具中，符合首例失败后残留通话状态的表现；**本轮没有在原生数据库中重新证明这些子例，仍按失败保留**。

### 账本快照组：1 个子例与 1 个父例

源码：`apps/api/test/resources-usage.test.ts`。父例为 `resource memories, membership lifecycle and credit reports are authorized and persistent`。

失败子例：`member usage and ledger snapshots survive an older transaction committing between pages`。

实际错误同样是 `pg-pool` 的 `timeout exceeded when trying to connect`，约 5.05 秒。该测试先用 `delayed = await f.db.connect()` 开启未提交事务，再在事务提交前通过 `write(f.db, ...)` 写入另一批可见账本记录。它明确需要同时占用不同连接；单连接 lite 包装器无法完成这一步。本轮没有调整池配置来伪装成原生 PostgreSQL，也没有删除此并发断言。

## 两项跳过

| 测试                                                                                                     | 既有跳过条件与本轮边界                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `native OCR recognizes, indexes and deletes an authorized two-column image`                              | `apps/api/test/asset-processing.test.ts` 要求 `REQUIRE_NATIVE_OCR=1`。本轮没有启用该独立原生 OCR 验收。                |
| `native float editing keeps EXR windows, pixel aspect, negative channels, headroom and associated alpha` | `packages/media/test/precision.test.ts` 要求已配置 `MEDIA_QA_PYTHON`。本轮未提供相应 Python / OpenImageIO 验收运行时。 |

跳过数量是 2，不能作为通过数量的一部分。两项均来自既有测试条件，本轮没有新增 `skip`。

## 本次前端改动的明确回归证据

完整运行日志中，新增的自适应预览策略 6 项全部通过：不同操作族的预算隔离、迟滞恢复、空间细节下限与恢复上限、渲染时间和空闲时间区分、旧请求隔离、局部色彩分类，以及真正调用 `render.worker.ts` 的粗预览恢复与导出一致性用例。

其中 Worker 用例使用真实调度器、降采样、可转移回复与参考像素，验证恢复使用保留的较清晰源、最终导出维持完整源语义。**其时钟输入是确定性测试夹具，因此不能把约 0.95 秒的测试耗时解释为手机交互延迟或帧率保证。**

新增的局部变换 4 项也全部通过：非正方形原图上的物理旋转距离与中心保持、像素正方形选区的四分之一圈回放、整体移动到源边界时不挤压顶点、越界旋转整次拒绝及指针旋转的源宽高比处理。这些检查调用真实蒙版采样逻辑，支持几何正确性；不替代真实浏览器中的控制柄命中、触屏手势和视觉体验验收。

测试错误列表没有出现 `apps/web` 的失败项。整轮仍因上述 API 并发用例失败而保持退出码 1。

## 源码一致性与原始记录

对 `apps`、`packages`、`tests`、`scripts` 中的 TypeScript、JavaScript、CSS、JSON、SQL、YAML，以及根 `package.json` / `package-lock.json` 计算内容指纹。此集合包括未提交源码与测试，不包括图片、文档、构建产物及忽略目录，因此不能把它称为整个仓库的所有文件快照。

| 项目                 | 结果                                                               |
| -------------------- | ------------------------------------------------------------------ |
| 起点输入文件数       | 579                                                                |
| 终点输入文件数       | 579                                                                |
| 起点 SHA-256         | `81a5cbe49b9e82cbff468b7c43130c678af43158e2debe7d03e9ae33144f4a57` |
| 终点 SHA-256         | `81a5cbe49b9e82cbff468b7c43130c678af43158e2debe7d03e9ae33144f4a57` |
| 本轮起止差异         | 无                                                                 |
| 完整运行日志 SHA-256 | `c51179487ace7e13982aeb6e6e81ba09162b5837e8856ec9bcff222cc4b89f63` |

原始记录保存在本地被 Git 忽略的 `artifacts/verification/frontend-immersive-20261111/`：`test-lite.log`、`test-lite-summary.json`、`source-start.json`、`source-end.json`。`run-lite.mjs` 仅记录官方命令的日志、退出码和源码指纹，不修改测试参数或生产逻辑。它不属于产品运行时。

## 本报告未覆盖的验收层

- 原生 PostgreSQL 多连接完整 CI，尤其是上面两组并发条件。
- 新 About 与账号页面的实际浏览器交互、三语布局、动态效果、触屏和截图，使用主任务的独立浏览器记录。此测试任务没有启动本地浏览器；`about-experience.browser.mjs` 等浏览器辅助脚本不在这份单元/API 结果内。
- 原生 OCR、EXR 浮点编辑运行时，以及真实外部供应商与实际移动设备的效果、延迟和硬件表现。

最终发布提交如有后续源码变化，应引用对应提交的 CI 或补验结果；本报告各节只证明其对应时间区间和输入指纹下的实际运行。

已知的后续工作：移动端实现代理在本轮结束后，依据真实 390px 浏览器预览继续修正 `PrecisionRange` 的端点显示，以及 `AdvancedInspector` / `FloatingPanel` 切换工具或设备尺寸分组时的滚动位置。它们不属于上面已完成的源码快照；相应最小回归及最终原生 CI 应单独引用，不将其并入本轮的通过声明。

## 主任务的 HTTPS 实操与发布前构建

主任务在私有 HTTPS 预览中实际操作，不把本地端口访问受限后的替代环境冒充成本地服务。

- About 使用真实滚轮连续经过功能、Agent、引擎调色示例与样片段落；悬停切换功能与 Agent 步骤，点击样片进入实际编辑器。简体、繁体、英文以及 320、390、768、1440 px 布局分阶段检查。
- 实际创建多边形、设置 15° 步长并旋转；未打开持续红色覆盖。实际创建独立绘制层，以 4 px 白色画笔画出一笔，撤销后重画。
- 在预览中加载同源模型并识别生成的人像。首次曾超时，手动重试成功；新版再次成功识别，英文下拉实际呈现 `Person 1`。没有真实账号、短信、付款或付费 AI 请求。
- 手机复测原失效步骤：1440 × 960 下把面板拖到 **518.333 px**，切换为 390 × 844；展开后点击“调节”得到 **334.333 px**。再次拖至 **112 px**，点击“调节”恢复 **334.333 px**；返回桌面，保留 **518.333 px**。滑杆 DOM 命中区域高度实测 **44 px**，照片与参数同时可见。
- 账号入口在 `#/login`、`#/register`、`#/reset` 独立页面间切换，原编辑文档留在同一 App 所有者内。空表单校验未发出短信。密码按钮位置及窄屏图标溢出由实拍发现并修正，新增原生浏览器回归继续验证。
- 绘制面板低处控件聚焦时，发现外层 `overflow: hidden` 自身滚动了 **24.666 px**，遮住顶部导航；已改为 `clip` 并加入两个桌面尺寸的真实聚焦检查。该修复需要由对应提交的浏览器 CI 确认。

在上述源码修正、`6625ce8` 合并及三语混合模式修复之后，主任务执行 **`npm run build`，退出 0**（工具会话 `11243`，包含 14 个 TypeScript 项目检查）。初始 CSS **53.63 kB / gzip 12.31 kB**，初始 JS **339.02 kB / gzip 106.87 kB**；延迟载入的编辑器块仍为 **626.85 kB**，保留 Vite 的 500 kB 提示，没有提高阈值隐藏它。

产品图位于 `apps/web/public/about`；重复原始 JPEG 保留在被忽略的验收产物内，避免把同一截图的两种编码重复加入仓库。英文人像已在最终 HTTPS 预览补拍，实际识别成功并显示 `Person 1`，皮肤纹理仍为 0；截图为 1440 × 960。当前英文绘制图仍为本轮较早的实拍，尚未反映最后的 Normal/stroke 文案修正；当前功能代码已经修正，晚一轮补拍遇到浏览器连接超时，继续访问又被自动审批以未保存草稿可能被替换为由拒绝；没有把该受阻补拍写成完成。它们不是生成的 UI。

此处不宣称当前原生 PostgreSQL CI 或整套浏览器门槛已经通过，发布提交的结果应独立核对。

### PR #6 第一轮 CI：保留失败与修复原因

提交 `abfad4342bf82d4647ba97c5d52fb5ae780a9190` 的 Account checks（run `42971566664`）两种 motion 均在新增样片检查中失败：`.canvas-file-info > span` 同时匹配了 `coast.webp` 与短暂的 `.busy` “更新预览”节点。修复仅把文件名定位限定为 `span:not(.busy)`，继续严格核对文件名、1536 × 1024 源尺寸和实际非透明画布像素，没有放宽导入行为要求。

失败之前，两种 motion 已通过实际调色与编辑器状态保留、三语言五档尺寸、账号语言切换保留输入、About 真实截图与连续 wheel/hover/keyboard 导览，以及指针实际像素/空闲停止/离屏/减少动效检查。该轮仍保留为失败，不用局部门槛覆盖整体结果。

同一提交的 AI interaction checks（run `42971566674`，job `130361010423`）已成功：21 项助手场景与 5 项团队语音场景。最终修正提交仍需对应的新工作流结果。

## GitHub CI：PR #6，head `794d3fb`

本节仅记录 [PR #6](https://github.com/hxjyaohaohaode/AI-xiutu/pull/6) 的 head [`794d3fb0b35a66a46bd1d89c741f9a942edadcf5`](https://github.com/hxjyaohaohaode/AI-xiutu/commit/794d3fb0b35a66a46bd1d89c741f9a942edadcf5) 已取得的 GitHub Actions 结果。原生基线、账户、独立 AI 交互工作流、容器与综合浏览器 job 均已通过；2026-11-11 06:54 UTC 已取得全部终态。

### 已取得终态的检查

| 检查                  | 已验证结果                                                                                                      | 执行范围与证据                                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生基线              | **成功；978 tests / 978 pass / 0 fail / 0 skipped**；typecheck、build 成功；生产依赖 audit 为 0 vulnerabilities | 原生 PostgreSQL、英文/简体中文 OCR 和固定版本精密媒体运行时环境中的 `npm run check`、`npm audit --omit=dev --audit-level=high`。[baseline job](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42972099344/job/130362833471)                                      |
| 账户，`no-preference` | **成功；21 / 21 gates**                                                                                         | 真实 Chromium、HTTP API、隔离 PostgreSQL；包括公开入口、三语言、五种尺寸、账户页面与会话恢复。[Account no-preference job](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42972099377/job/130362702887)                                                           |
| 账户，`reduce`        | **成功；21 / 21 gates**                                                                                         | 同一组账户检查在减少动态效果偏好下完整执行；这是两种 motion 条件下各 21 项，并非 42 个互不重复的功能。[Account reduce job](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42972099377/job/130362702628)                                                          |
| 独立 AI 交互工作流    | **成功；助手 21 / 21、团队语音 5 / 5**                                                                          | 验证助手权限、请求保留、流式响应、会话和响应式操作，以及团队语音权限、麦克风控制、保留通话和共享 AI 发言。[AI interaction job](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42972099407/job/130362703621)                                                      |
| 容器                  | **成功**；媒体测试 **8 / 8**、精度测试 **3 / 3**，均无失败或跳过                                                | 双 Docker target 构建、可选 native media 镜像及真实库验证；实际启动 PostgreSQL、迁移、API、worker、web；HTTP/health、关闭外部执行、私有网络绑定与资源清理检查通过。[containers job](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42972099344/job/130363981160) |

### 账户与 About 已验证的实际范围

两个 Account job 的成功日志均包含以下检查：About 真实调整与返回 Studio 时保留画布；三语言与五种视口下的页面布局；认证切换语言时保留输入字段；真实界面截图的滚轮、悬停和键盘浏览；指针装饰的实际像素变化及 idle/offscreen/reduced-motion 行为；三语言样片打开对应文件、`1536 × 1024` 原图尺寸及非空真实编辑画布。此次文件名定位明确排除 `.busy` 状态节点，文件名、尺寸和画布像素断言保持完整。[About 检查源码](https://github.com/hxjyaohaohaode/AI-xiutu/blob/794d3fb0b35a66a46bd1d89c741f9a942edadcf5/scripts/qa/about-experience.browser.mjs)

账户部分覆盖真实注册、密码/验证码登录、注册后的首次进入、错误与未知结果恢复、退出会话、密码重置及旧凭证撤销、重复注册保护、文档草稿恢复、账户切换后的私有云来源保护，以及各认证步骤在双主题、五种视口下的可达性。[账户检查源码](https://github.com/hxjyaohaohaode/AI-xiutu/blob/794d3fb0b35a66a46bd1d89c741f9a942edadcf5/scripts/web-account-smoke.mjs)

**注销与重复注册的准确解释：**

| 实际执行层                                  | 检查的操作与断言                                                                                                                                   | 可据此得出的结论                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 账户页面 UI 与请求记录                      | 点击“注销账号”，显示暂不支持/尚未开放；`accountPurgeRequests = 0`。支付同样显示当前能力未开放，`paymentConfigured = false`、`checkoutRequests = 0` | 已验证未实现能力的明确反馈与请求边界；未执行账户清除或实际支付 |
| 浏览器 UI、真实退出 API、会话核验           | 取消退出时不发送退出请求；确认退出时调用 `POST /v1/auth/logout`，原会话失效                                                                        | 已验证退出登录及会话撤销；退出登录不等于注销账号               |
| 浏览器注册 UI、真实注册 API、数据库只读核验 | 对仍然存在的同手机号再次注册，`POST /v1/auth/register` 返回 `409`；原用户 `id`、`display_name` 保持，已使用验证码清空并给出提示                    | 已验证重复注册不能覆盖原身份；没有执行“删除账号后重新注册”     |

这 21 个 gate 没有账户删除后重新注册的步骤，也没有 account purge 调用。测试夹具提供短信投递端口、受控故障和隔离数据；它不构成产品自助注销入口已开放的证据。账户报告明确记录真实短信调用与付费调用均为零。

独立 AI 检查使用注入的本地 Responses SSE 协议夹具；团队语音使用本地 WebSocket 协议夹具、真实 AudioWorklet 与合成麦克风。它们验证实际应用链路、状态和权限行为，不代表付费供应商验收、真实手机麦克风验收或生成图像质量验收。[助手检查源码](https://github.com/hxjyaohaohaode/AI-xiutu/blob/794d3fb0b35a66a46bd1d89c741f9a942edadcf5/scripts/qa/assistant.browser.mjs) · [团队语音检查源码](https://github.com/hxjyaohaohaode/AI-xiutu/blob/794d3fb0b35a66a46bd1d89c741f9a942edadcf5/scripts/qa/team-voice.browser.mjs)

### 综合浏览器终态

[Baseline browser job `130362833446`](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42972099344/job/130362833446) 已完成，结论为 **success**。GitHub 官方 job 元数据中的以下实际测试步骤全部成功：

- 连续滑杆、曲线与触屏预览测量。
- 同一提交的六轮完整 workspace-v4 浏览器流程，以及下载图像检查和截图保存。
- 助手权限、记忆、流式响应、会话与生成工作区。
- 团队语音麦克风、权限和共享 AI 发言。
- 真实人物推理与完整/分块像素比较。
- 多类真实照片的美肤、抠图和运动修复观察。

此 job 内的实际人物模型与图像检查独立于助手的协议夹具，不将夹具响应或生成练习照片当作商业美颜质量保证。所有证据上传步骤与清理完成；没有修改既有 35 分钟门槛、减少六轮次数或为通过而重跑。
