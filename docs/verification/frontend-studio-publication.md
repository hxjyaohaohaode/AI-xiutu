# Studio 前端发布与验收快照映射

初始记录时间：2026-11-10 14:51 UTC；追加 CI 与修正记录：2026-11-10。目标分支：`work/frontend-studio-v2`；已同步主线：`5e6c994d94a3c45e2847b4871641640d838aa375`。当前产品修正提交为远端 `aa529491e76792d44057c93f676d33cb148424fe`。两轮 browser 失败与相应定向修正均已记录；第三轮运行 `42845426490` 已 completed / success，2026-11-10 16:00:58 UTC 的终态 jobs 确认 baseline、browser、containers 均成功。15:37 的历史阶段快照继续保留。最新状态以 [PR #1 检查](https://github.com/hxjyaohaohaode/AI-xiutu/pull/1/checks) 及 PR 说明为准。

终端没有 GitHub 推送凭据，本次通过已授权的 GitHub 连接发布 Git 对象。连接创建提交时使用新的提交元数据，因此远端提交 SHA 与本地验收提交 SHA 不同；文件内容、文件模式、目录树及合并父分支关系保持一致。

**每个上传的 blob SHA 以及下表的每个 Git tree SHA 均与本地逐项核对一致。** 这证明对应阶段的仓库内容完全相同，不代表在新提交号上重新运行了测试。验收报告和机器证据保留实际执行时的本地 SHA；不得把该历史 SHA 改写成远端 SHA 后冒称重新执行。

| 阶段                                 | 实际本地快照                               | 对应远端提交                               | 完全相同的 Git tree                        |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| 初始 Studio 改版                     | `29009096eeed32ae8c9b6c417643ce75f3f97807` | `6194d58274cfb0e0f31b8048891d423b1d8317a4` | `b9410d90727c63d1e531d31db227cf6c6f6ea0bb` |
| 同步开放麦克风主线；Native gate 起点 | `70359f9446ba8a2ed06a9fa660a532d43f93387a` | `6aab8415294742bbe11f4c5d77fee4e160e59378` | `0164791461b746f37cd2bb25349615af471578d2` |
| 紧凑通话条 CSS 修正                  | `79b0fab538fc56a7292ed5b5aa280afa6b99b0c2` | `67cb2125f613141fdac293cd39164e0f39b3dbf8` | `75999ad5cdcb013be2e15cc8cd01eb2d450aff65` |
| 发布前 web / 类型 / 构建门槛         | `c03a91d7fc8c1659d48a21de30b54279a66beacc` | `450bccfecc58962310e9846c55a38389f8596784` | `16a4feb55569fb77cf4fec19b72fde15654ae0d7` |
| 整理验收文档与截图                   | `f32347f187ce974e4cc8b4828d58e5c219b475a5` | `ec547d36527957c3fa52919f361fa042ea2bea5c` | `e9d6773521b9ad90b6cbc7a2d93bf021adb8a358` |
| 首次发布映射文档；首轮 CI 的 head    | `fc0177a775a86ca08a7e31aa7238cdb29fcfb3cc` | `38b3451a8ea30b606c69ceeadc57a6d2bcbdd3af` | `009fa4551170febef11dab34d6cfc23e750e26aa` |
| 首轮 CI 后的紧凑色调触控区修正       | `5991d34f2b9914f9b78350bccc131e6203749155` | `09247f7b6a8721173b5b4e47418b2ccae681d839` | `e13ef999b89767b133edfe89603547488bef9796` |
| 第二轮 CI 后的精确输入聚焦修正       | `3d151c77b2eaf538087b151bc51020fcea206de0` | `aa529491e76792d44057c93f676d33cb148424fe` | `f361ea9d2dee88bb2e5ebc01938fc8e235696bec` |

## 验证范围

- 原生 PostgreSQL 全仓 722 项测试从本地 `70359f9` 启动。运行期间只有 `79b0fab` 的紧凑通话条 CSS 改动；该变动另做生产构建与浏览器布局检查。
- 发布前本地 `c03a91d` 完成 215 项 web 测试、14 个 TypeScript 项目和生产构建。受检 426 个文件在该轮门槛中未变化，源码指纹为 `5e129a779df840579c651a6ef2ab5a880a2effeeba39b25c8e8ef7e2b5b0485a`。该结果不移写为后续控件与聚焦修正上的完整 web 运行。
- 本地 `f32347f` 只补交付资料。此发布映射及其链接也是文档增量，没有改变上述受检产品源码。
- 团队浏览器 QA 剧本本地未执行；发布后的 CI 结果须单独查询，不由本映射推断为通过。
- 合并提交保留已同步主线的 `1f7e8f4`、`5e6c994` 为额外父提交；未改写或推送 `main`。

## 首轮远端 CI 与对应修正

[运行 42838715652](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42838715652) 面向 PR head `38b3451a8ea30b606c69ceeadc57a6d2bcbdd3af`，实际 checkout 为 GitHub PR merge commit `f72478c6ad483a8101da0c90032db6358cc26a31`。baseline 的原生 722 / 722、14 项类型检查、web 构建和生产依赖审计成功，containers 成功；**browser 在 `layout-320x700` 失败，整个运行不能记为通过**。

真实匿名浏览器复现了滑条完整触控盒约 7.766px 的裁切。本地 `5991d34` / 远端 `09247f7` 仅增加 `studio.css` 的 12 行紧凑色调间距规则与 `workspace-v4.browser.mjs` 的 8 行测量日志，没有缩小既有触控盒、放宽断言或改变产品 JavaScript 行为。该阶段控件定向测试 10 / 10、web 类型检查和 Vite 构建通过；真实匿名应用的 320、390、844px 控件几何复核通过。

## 第二轮远端 CI 与聚焦修正

[运行 42842515740](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42842515740) 面向 `09247f7`，实际 checkout 为 PR merge commit `f680d8fbddce4332aebefc4b9c4fad73570f082c`。baseline 的 **722 / 722、97.84 秒**、14 项类型检查、web 构建、生产依赖审计 0 vulnerabilities，以及 containers 均成功；browser 仍失败，不能记为全 workflow 通过。

第二轮首次布局断言已经通过，滑条完整位于滚动区；失败发生在精确曝光输入后的再次检查。CI Chromium 158 记录面板、工具坞和照片框统一左移 5px。CUA Chromium 156 读到了外层 workspace 的 320px 可视宽度与 325px scrollWidth，但没有复现这次水平偏移。

本地 `3d151c7` / 远端 `aa529491` 为 `PrecisionRange.tsx` 四处显式聚焦增加 `preventScroll`，只在手机编辑视图给固定外层 `.workspace-body` 使用 `overflow: clip`，并补齐 QA 横向数据、断言说明和错误栈。内部滚动、resize 命中框、原断言阈值和执行次数未改。本地最新定向检查 10 / 10 与 web 类型检查通过；CUA Chromium 156 验证 Enter 提交 `-0.25`、Escape 保留 `-0.25`、按钮确认 `-0.35`，焦点均返回滑条。最终几何为外层 `scrollLeft=0`、面板 `x=0`，内部 `scrollTop` 仍为 25px，不能称完全不滚动。

本地浏览器没有复现原水平偏移，不能替代 CI Chromium 158 的完整确认。旧 215 项前端结果、前两轮 CI 各自的 722 项结果及各次定向检查继续归属于各自源码阶段。

## 第三轮 CI 的阶段快照与终态

[运行 42845426490](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42845426490) 实际 checkout 为 `d747d7bdcc3c72f5bd18103329448279c99d263f`，由 head `aa529491` 与基线 `5e6c994` 组成。**截至 2026-11-10 15:37:36 UTC，baseline 与 containers 成功；browser 仍为 in_progress，结论为 null。**

GitHub Git commit API 的直接读回进一步确认：该实际 checkout 的 tree 为 `f361ea9d2dee88bb2e5ebc01938fc8e235696bec`，parents 为 `[5e6c994d94a3c45e2847b4871641640d838aa375, aa529491e76792d44057c93f676d33cb148424fe]`，与上表当前产品修正的本地 / 远端 tree 完全一致。因此这次 CI merge checkout 与发布 head 具有相同内容；这项核对不代表额外运行了测试，也不把未结束的 browser 改记为通过。

baseline 新运行的 **722 / 722、77.555 秒**、14 项类型检查、web 构建（报告 731ms）与生产依赖审计 0 vulnerabilities 均通过；容器构建、启动、健康检查和清理均成功。该结果不包括尚在执行的六轮完整浏览器流程，因此该历史快照不记录整轮通过。原始摘要与日志位于 `ci-42845426490/`；下段另行追加后来取得的终态。

最终 GitHub run 为 `completed / success`，`run_started_at=2026-11-10T15:32:39Z`、`updated_at=2026-11-10T15:58:49Z`；终态 jobs 在 15:58:54 与 16:00:58 UTC 分别读回三个 jobs 均成功。工作台六轮各 **21 / 21**，合计 126 次场景执行、108 条布局测量；这是 21 种场景重复六轮。助手 **16 / 16**、团队语音 **5 / 5**；两者为零付费的本地协议夹具，团队使用模拟麦克风。空间检查为 **419 passed + 12 unavailable**，不是 431 / 431；其真实浏览器 CPU/WASM 推理与共享内核数值检查范围另见验收记录第 4.9 节。

最终 Chromium 158 六轮中的 320px 初始滑条触控盒完整可见，精确输入后面板与工具坞仍为 `x=0`、外层 `scrollLeft=0`；内部 `scrollTop=25` 如实保留。此次成功来自相同 `f361ea9d` 源码树上的实际完整运行，没有放宽旧断言，也没有把本地 Chromium 156 未复现的结果冒作远端复验。

本轮最终追加只有交付资料与截图，产品文件仍对应 `aa529491` / 本地 `3d151c7`。后续资料提交的映射与发布树校验由 PR 说明记录，本文件不自引用尚未生成的文档提交 SHA。

本映射只证明同一阶段的 Git 内容相同，不把本地人工浏览器操作、静态团队语音夹具、CI 测试账号、真实模型推理或已完成的协议夹具流程混为一种验收。

详细结果、历史失败及实际浏览器范围见 [验收记录](frontend-studio-20261110.md) 和 [机器证据](frontend-studio-evidence.json)。
