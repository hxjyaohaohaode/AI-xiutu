# R5 · Lapa 参考机制与实现对应（恢复记录）

日期：2026-11-11。代码基准：main `d5ad8db311a424c8e6a90487666f15b2806989f9`，R5 分支 `frontend/experience-r5-20261111`。

## 证据边界

本报告在执行环境第二次中断后，依据已经进入仓库的 `R5-RESUME-20261111.md`、`reference-study-20261111.md`、`gallery-study-20261111.md` 和当前会话的实际产品操作记录恢复。不是新一轮参考站浏览。

R5 续作检查点记载：Lapa 有 23 个目录视图、35 张截图、12 个原站入口，其中 11 个公共页面可访问、1 个受限。第一次执行环境中断后，原始目录 JSON、具体 12 个原站名单、动作日志和截图未恢复到当前工作区。上述数量仅是检查点保存的历史摘要，不能作为目前可重新核查的逐站完成清单，不能宣称覆盖 Lapa 全站或所有案例。之前上下文中的 532 条目录去重数量缺少当前原始文件，不作为本报告的验收指标。

## 目前能够追溯的来源

| 来源 | 已存记录中的实际观察 | 证据类型与限制 | 本轮处理 |
|---|---|---|---|
| [Lapa 首页](https://www.lapa.ninja/) | 首页、Sections / Motion 分类入口；分类长列表通过 View All 收起，标题和分类入口各有层级 | 仓库既有 R4 研究记录；本报告没有重新访问 | 将功能入口分组，避免在编辑工作区引入宣传大标题、广告和无用说明 |
| [FAQ 分类](https://www.lapa.ninja/elements/faq/) 中 Dessn | 查看 FAQ 大图，区分标题、问题列表、展开符号和正文层级 | 静态案例大图，不是已操作 Dessn 的 accordion；广告遮挡限制了可见区域 | 账号额度说明和注销能力通过按需 disclosure 呈现；主要动作保持在外层 |
| [Page Transition 分类](https://www.lapa.ninja/elements/page-transition/) | 从 Sections 进入，关闭广告，滚动观察分类轨道与预览 | 部分预览不可播放，不能据此推断或复现具体转场轨迹 | 页面阶段进入使用现有 motion 机制；不复制未经验证的 wheel 接管或转场 |
| R5 大图 / 留白 / 非对称节奏 | 检查点保留了设计结论 | 具体原站名单及原图未保全；不能把该结论归到未核实品牌 | 作品按真实素材比例排版，交付页扩大当前作品；图像表达真实功能和状态 |

代码 `library-collection.css` 首行曾写“Cosmos/Masonry study”。当前能核查的原始站点记录未包含 Cosmos 逐项证据；该注释不能作为已完成 Cosmos 浏览的证明。后续应改成中性的实际布局说明，React Bits Masonry 的独立证据以根代理参考总表为准。

## 机制、采用位置与明确弃用项

| 机制 | 当前实际实现文件 | 对应行为 | 不采用的部分 |
|---|---|---|---|
| 作品作为主要视觉内容 | `apps/web/src/components/AssetLibrary.tsx`、`resources/library-collection.css` | 真实比例大图、自适应列数、大图/紧凑密度、原图与已保存作品分开操作；实际 3 张素材横向完整利用桌面宽度 | 循环复制图片、为填空反复摆同图、默认灰化用户照片、图片自动漂移 |
| 资源结果一致的视觉和加载结构 | `resources/ResourceSearch.tsx`、`CollectionSkeleton.tsx`、`library-hub.css` | 结构匹配的图片骨架；常驻导航 CSS；照片错误有独立重试 | 用旋转圈代替页面骨架；把读取失败显示成零条；用装饰照片替代失败原片 |
| 对比围绕真实照片 | `components/WorkspaceViews.tsx` 的 ComparisonFrame / CompareView、`workspace/workspace-library.css` | 实际照片原比例展示，滑动和并排；尺寸不匹配时回退并排；云端版本短标签 | 巨大空白容器、裁剪后强行错位比较、自动修改服务端版本文案 |
| 交付以作品和操作构成非对称双栏 | 同文件 DeliveryView 与独立 CSS | 大幅当前预览 + 导出格式 + 配方操作；预览尺寸、云端版本明确 | 缩小成 124px 截图；把 JSON 配方称为照片；声称所有 native 编辑链均可无损回放 |
| 账号按任务逐层展示 | `account/AccountPageFrame.tsx`、`AccountCenter.tsx`、`account-page.css` | 单列登录/注册；概览、安全、额度、数据与退出；说明按需展开 | 重复 About 雪山工作台截图；左半屏宣传模块；重复隐私和上传声明 |
| 首层保留操作，技术细节展开 | `components/MediaImportDialog.tsx`、`media/media-import-r5.css` | 原件导入与“格式与尺寸”能力 disclosure，依据真实后端 capability | 未配置 RAW / EXR 时宣称可用；PSD 宣称可编辑图层；展示服务器部署操作指南 |
| 文档以内容与保存状态为中心 | WorkspaceViews 的 DocumentsView 与独立 CSS | 手机目录列布局，返回列表，内容/骨架/空态/错误互斥，真实版本与草稿恢复保留 | 首次读取同时出现“创建第一份”；列表控件挤成单行；用展示用假文档填空 |
| 用量有一个主要图表 | `usage/UsageDashboard.tsx`、`UsageTrend.tsx`、`usage-dashboard-r5.css` | 主趋势图、紧凑指标、次级预占/结算按需展开 | 伪造非零数据；稀疏数据仍强制四列大图；未知余额从零计数 |

这里是布局机制适配，并未复制 Lapa 收录站的品牌、图片或付费模板源码。具体状态交互来源由 React Bits / Aceternity / Uiverse 独立研究记录说明，不混称“全部来自 Lapa”。

## 当前产品实测与待补

当前恢复后的独立修复复验，已实际看到登录/注册入口、作品三列大图、已保存 V2、滑动和并排对比、文档保存 V1、大图交付、JPEG 真实下载、账号四个分区及键盘右箭头切换。证据当时成功保存在 `/workspace/shared/r5-library-account-after/`。账号注销仅展开了真实“暂不支持自助注销”能力说明，没有执行删除。

执行环境随后再次 unavailable，不能在本报告中声称这些文件已经重新复制进入仓库，也不能声称手机/平板或五轮全站回归通过。完整五轮由根代理统一矩阵记录；这些是修复复验，不是一轮全站检查。

后续需补：确认本轮代码与截图 checkpoint、手机 390/320 及平板 820 的文档目录与作品布局、资源搜索和长期素材、用量的真实数据状态、注册短信与账号退出的合法服务链；恢复参考站原始逐站证据或重新做有界实操后，才能补回具体案例清单。
