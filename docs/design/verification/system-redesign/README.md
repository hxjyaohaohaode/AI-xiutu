# 系统前端重做：验收证据

记录真实界面、浏览器检查与逐图视觉复核。本次未部署生产环境。

## 版本与结果

| 轮次 | 受检源版本 | 结果 |
| --- | --- | --- |
| 第五轮 | `936c54a44ee204bbf7e11dc4453538f22d500a80` | 浏览器 16/16；本工作流单元测试 497/498，一条旧面板高度断言失败，因此整轮未通过，未发布截图。 |
| 第六轮 | `f578c96f9dc73eb4d134e5f4420081bd8918749f` | 类型检查、单元测试 498/498、构建、浏览器 16/16 及截图发布均通过。 |

第六轮相对第五轮只改上述测试的一行断言，产品 UI 源码相同。截图发布后的 34 张图片和来源 manifest 共 35 个 Git blob，已与最终 artifact 逐字节核对一致。

- [第六轮 Actions 记录](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/43142870241)
- [截图发布提交 2897cb7](https://github.com/hxjyaohaohaode/AI-xiutu/commit/2897cb787dc3a165dd535b97e7ae119d66e9e240)
- [完整证据 artifact 13910122925](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/43142870241/artifacts/13910122925)，包含 `report.json`、各场景截图与来源 manifest。

| 文件 | SHA-256 |
| --- | --- |
| 下载的最终 artifact ZIP | `fad143dcc699cab89ba425b93243d21859a86fc47d0b18db821f6b5801734acd` |
| `report.json` | `af5e8b451b186f3974edf5800e1667228f98316c5008204dadc70a8aa75540e5` |
| `source-manifest.json` | `edc58b8fdabfc6950e9692b9cca51107dad16f252e98d59eaac83f183db5b44f` |

## 实际检查范围

五组场景为：桌面简中 1440×960、手机简中 390×844、英文短横屏 844×390、平板繁中 1024×768，以及减少动态的英文桌面 1440×960。每组实际完成导入、数值调节、撤销/重做、原图与键盘滑动对比、PNG 下载及解码核对。

共 16 个浏览器 case，另覆盖三语截图、About 连续滚动、可见控件布局与命中、品牌资源一致性，以及隔离账号的作品、文档、用量、账号和修复弹窗。修复仅验证真实只读预算回执、模式切换、更多参数及等待回执时的键盘焦点，不执行创建修复副本。最终报告的页面异常、路由异常和未知外部请求均为 0；简繁中文实际字形字体检查通过。

逐图视觉复核范围如下，范围之间有重叠，不累计为新的测试场景：

- 本目录 13 张审阅图，加桌面/手机简中登录图，共 15 张：第五轮逐张审阅；第六轮 10 张解码像素完全相同，5 张差异图重新打开复核。
- 编辑器专项 20 张：`screens/{workspace,local,portrait,layers,tablet,phone}-{zh-CN,zh-TW,en}.png` 共 18 张，以及 `flows/landscape-en-edited.png`、`brand/dark-studio.png`。第六轮 15 张文件及像素完全相同，其余 5 张重新打开复核。
- About 桌面六个分段、手机五个分段另作完整细看。

已确认中文可读、作品两列、AI 单一不可用原因、行内协作统计和弹窗完整边界；最终差异图无新增视觉阻断。登录图的洋红色区域是密码截图遮罩；文档时间和一次性账号脱敏尾号随运行变化。作品库大图缩略图比编辑器原图略软，记为非阻断画质观察。

人像简中第六轮三排参数已入镜，包含“眼下明暗”“亮眼”；英文人像图只覆盖首排，不能将第三排英文短标签列为已直接截图目检。静态截图审阅不代替交互检查。

## 截图与来源

发布白名单限定 **34 张图片及来源 manifest**：

| 内容 | 数量 |
| --- | ---: |
| workspace / local / portrait / layers / tablet / phone，各含简中、繁中、英文 | 18 |
| coast / portrait / color-study 真实来源图片 | 3 |
| 本目录 About 两张，以及导出、作品、修复三态、文档、协作、用量、AI 不可用、账号审阅图 | 13 |

界面图片来自本次构建运行后的真实浏览器截图，只做格式编码，不使用 AI 生成界面或给虚构界面加标注。场景使用实际本地 API、隔离数据库和一次性账号；来源是 Pexels 17344850（Peter Steiner1973）与 3791554（Andrea Piacquadio）。`coast` 与 `color-study` 复用同一张真实风景，不代表第三个独立来源。下载信息、许可链接、文件哈希与受检版本见 [source-manifest.json](../../../../apps/web/public/about/source-manifest.json)。

截图只在必需检查全部通过、远端 HEAD 仍等于受检版本时，由独立发布步骤提交白名单文件。自动 manifest 的 `manualVisualReview: false` 表示生成步骤不自动宣称人工验收；本记录单独说明后续视觉复核。

## 证据边界与参考

这五场景、16 case **不是 111 项功能各跑五遍的全面回归**，也不构成物理设备、原生 GPU / RAW / HDR 路线与精度、真实付费 AI 或真实多人会话验收。CI 隔离环境未启用供应商；6 次固定 SDK 遥测 POST 尝试均被阻止，详见 report / manifest。未核验生产响应头，不据此宣称生产无遥测。

About 查阅的源码参考为 **ScrollExpand、AnimatedContent、ScrollReveal**，实际适配和省略范围见 [product-reference-notes](../../../../apps/web/src/about/product-reference-notes.md)。参数控件查阅 **WakeSlider、RubberSegment、ElasticSlider**，来源和应用位置见 [REFERENCE-SOURCES](../../../../apps/web/src/editor/REFERENCE-SOURCES.md)。React Bits 许可为 **MIT + Commons Clause**，不是单独的 MIT。

执行与发布约束详见 [QA 说明](../../../../scripts/qa/SYSTEM-REDESIGN.md)。
