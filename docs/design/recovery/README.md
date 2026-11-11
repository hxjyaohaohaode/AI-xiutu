# R5 源码恢复范围

本目录用于保全第二次执行环境中断后能够准确恢复的内容。**它不是集成完成的前端，也不是五轮回归交付。** 产品运行路径没有接入这些 JSON 内的源码。

## 文件与可恢复程度

| 文件 | 内容 | 准确边界 |
|---|---|---|
| [ai-voice-bos-r5-source-bundle-20261111.json](./ai-voice-bos-r5-source-bundle-20261111.json) | 7 个完整源码文件、6 项局部代码及验证记录 | 17 项长文件/研究文件完整 diff 未恢复；最后 LiveAssistant 刷新补丁未验证且有已知初选时序风险 |
| [r5-library-account-partial-20261111.json](./r5-library-account-partial-20261111.json) | 2 段真实读到的源码片段、23 个未恢复文件列表、Lapa 恢复报告、实际操作和下载记录 | 没有完整产品源文件；不能据此覆盖当前 AuthPanel、WorkspaceViews 等文件 |
| [frontend-api-alignment-r5-20261111.md](./frontend-api-alignment-r5-20261111.md) | 模型参数、候选、语音、BOS、版本/权限/计费、native 边界及官方资料 | 环境中断后新整理的对齐稿，不等于完成联调 |
| [editor-r5-source-bundle-20261111.json](./editor-r5-source-bundle-20261111.json) | 6 个完整源码文件、11 项部分源码/精确片段、10 个缺失文件记录 | ParameterGlyph 缺少最终 SVG JSX 尾段；完整文件依赖未恢复集成点，不能自动应用 |

合计保全 **13 个完整源码文件和 19 项局部源码/片段记录**。完整不等于独立可运行：其中包括测试、CSS 和隔离 QA 模块。完整源码和局部补丁均保留来源、原目标路径及最后验证状态。格式可能与最后一次 Prettier 结果不同；没有根据行为摘要猜造缺失长文件。截图和下载文件目前不能重新读取，本目录只记录当时真实发生的结果及路径，不包含原始图片字节。

## AI / 语音 / BOS 完整源码列表

- `apps/web/src/ai/CandidateActions.tsx`
- `apps/web/src/ai/voice-errors.ts`
- `apps/web/src/components/ops-audit.ts`
- `apps/web/src/i18n/ai-r5-messages.ts`
- `scripts/qa/manual-ai-fixture.mjs`
- `apps/web/test/ai-candidate-actions.test.ts`
- `apps/web/test/voice-errors.test.ts`

这些完整文件依赖尚未恢复的集成点，尤其 App/AIPanel 的 previewControls、样式和词典合并，不能直接据此宣称界面已修复。

## 编辑器完整源码列表

- `apps/web/src/editor/ParameterShelf.tsx`
- `apps/web/src/editor/editor-control-copy.ts`
- `apps/web/src/editor/HistoryPanel.tsx`
- `apps/web/src/editor/editor-controls-r5.css`
- `apps/web/src/editor/ProjectiveControls.tsx`
- `apps/web/test/parameter-glyph.test.ts`

ParameterGlyph 的映射/路径表与 panelBounds 替换函数等保存在 partialPatches。缺失的 JSX、其他模块和集成点不能按行为摘要补猜后沿用旧测试结论。

## 恢复规则

1. 先确认原工作区是否仍存在。读取并保护真实 diff，不能用本目录覆盖可能更完整的原文件。
2. 当前 main 基准为 `d5ad8db311a424c8e6a90487666f15b2806989f9`，最后检查时间为 2026-11-11 23:39 UTC；恢复前再检查最新后端。
3. 完整 source 是待集成代码，partial/fragment 只是片段。只有完成与当前基线的逐项比对后才应用。
4. 保留用户并行后端工作、native 管线、source identity/hash、ACL、CAS/expectedVersion、lease、真实价格和未知收费终态。
5. 恢复集成后重新执行类型检查、生产构建和必要测试。丢失工作树曾通过的 474 项 Web 测试不能自动转移到恢复后的代码。
6. 按 [最新 44 项状态与五轮矩阵](../R5-CONTINUATION-20261111.md) 验收。当前五轮完整真实 UI 回归为 **0/5**。

## 新增可核对文档

- [完整续作状态与 44 项清单](../R5-CONTINUATION-20261111.md)
- [参考机制与产品位置对应](../r5-adoption-map.md)
- [Lapa 可恢复来源与采用边界](../r5-reference-lapa-20261111.md)
- [第一次中断历史检查点](../R5-RESUME-20261111.md)

已明确不能完成的短信、真实麦克风、多端通话、WebGL2、美颜算法、自助注销等，继续按实际依赖标为未验证或阻塞，不能使用测试成功界面代替。
