# 组件参考与实际适配

## 范围与来源

本记录覆盖这轮新增的 Aceternity UI、React Bits、Uiverse 三站的官方组件文档、公开源码和许可核对。它记录源码研究与项目实现的对应关系，不将源码阅读表述为完整人工浏览器验收，也不声称覆盖三个网站的全部组件。其余参考站与完整页面流程的现场检查由本轮总验收记录说明。

研究使用的仓库基线：

- React Bits：`9d9c687dc4f55b23539aa5417b703078047efa74`。
- Uiverse Galaxy：`adbd2adde0a299a3956ea288fb444ec01891ca41`。
- Aceternity：官方组件页面及页面公开安装 registry，未读取需要 All-Access 的源文件。

| 官方来源                                                                                                                                                                                                                           | 实际读到的交互                                                         | 适配判断                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Aceternity Signup Form](https://ui.aceternity.com/components/signup-form) / [公开示例源码](https://ui.aceternity.com/registry/signup-form-demo.json)                                                                              | 标签与字段分组；手机缩小外壳内边距；主要提交和其他入口分层             | 参考表单层级；示例只输出提交日志，不能代替真实注册接口                                                |
| [Aceternity Stateful Button](https://ui.aceternity.com/components/stateful-button)                                                                                                                                                 | 异步动作的等待与成功反馈                                               | 状态必须由实际请求结果驱动；文档已读，registry 抓取未成功，不记为源码验收                             |
| [Aceternity Animated Modal](https://ui.aceternity.com/components/animated-modal) / [公开源码](https://ui.aceternity.com/registry/animated-modal.json)                                                                              | 分离遮罩与内容进入；弹层弹性过渡                                       | 保留项目原生 dialog、焦点恢复和退出 inert；不采用示例的双层全屏模糊、40° 翻转与缺少完整焦点约束的外壳 |
| [Aceternity Tabs](https://ui.aceternity.com/components/tabs) / [公开源码](https://ui.aceternity.com/registry/tabs.json)                                                                                                            | 选中背景连续移动                                                       | 使用连续位置反馈；不采用堆叠内容卡片，不让隐藏字段继续接受焦点                                        |
| [React Bits Stepper](https://reactbits.dev/components/stepper) / [源码](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Components/Stepper/Stepper.tsx)                       | 测量真实标签宽度；容器缩小时折叠；前进、后退方向不同；新转换取消旧动画 | 作为账号流程的设计依据；不把其 560ms 位移默认值直接用于高频操作                                       |
| [React Bits Animated List](https://reactbits.dev/components/animated-list) / [源码](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Components/AnimatedList/AnimatedList.tsx) | 按实际行位置移动背景；方向键选择；键盘导航后等待真实鼠标移动才交回控制 | 已独立实现到 `ChoiceSelect`，见下节                                                                   |
| [React Bits Blur Text](https://reactbits.dev/text-animations/blur-text) / [源码](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/TextAnimations/BlurText/BlurText.tsx)        | 文字分片渐显，提供一次性、悬停等触发方式                               | 中文不能照搬按空格拆词；关键表单、错误、金额和图像区域的模糊值为 0，不延迟信息可读性                  |
| [React Bits Fade Content](https://reactbits.dev/animations/fade-content) / [源码](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/src/ts-default/Animations/FadeContent/FadeContent.tsx)     | 进入可视区后渐显、清理动画与监听；支持减少动态偏好                     | 采用有限时长和清理原则，沿用已有动效实现；未引入 GSAP、ScrollTrigger 或噪声滤镜                       |
| [Uiverse / Galahhad 搜索框](https://uiverse.io/Galahhad/breezy-wolverine-23/) / [源码](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Inputs/Galahhad_breezy-wolverine-23.html)                | 图标、输入、快捷键提示各自占位；focus-within 显示整体焦点              | 采用稳定的文字起点和图标占位比例；不复制输入后横移文本、12px 小图标的处理                             |
| [Uiverse / Cksunandh 开关](https://uiverse.io/Cksunandh/slimy-treefrog-92) / [源码](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Toggle-switches/Cksunandh_slimy-treefrog-92.html)           | 轨道与滑块位置联动                                                     | 保留原生 checkbox、可见焦点与清楚状态；图形尺寸和触点范围分别设计                                     |
| [Uiverse / iZOXVL 表单](https://uiverse.io/iZOXVL/slippery-dragonfly-42) / [源码](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Forms/iZOXVL_slippery-dragonfly-42.html)                      | 输入、辅助操作、提交和注册入口分层                                     | 参考结构；不增加没有对应能力的“记住我”或第三方登录，不使用空链接                                      |
| [Uiverse / mrhyddenn 进度条](https://uiverse.io/mrhyddenn/tasty-crab-98) / [源码](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/loaders/mrhyddenn_tasty-crab-98.html)                         | 细轨道与循环加载反馈                                                   | 只借鉴比例；循环 0–100% 不是实际进度，不能用于假装上传、支付或账号注销已完成                          |

## 已落地：选择控件

文件：

- [ChoiceSelect.tsx](../../apps/web/src/components/ChoiceSelect.tsx)
- [choice-model.ts](../../apps/web/src/components/choice-model.ts)
- [choice-motion.css](../../apps/web/src/components/choice-motion.css)
- [choice-interaction.test.ts](../../apps/web/test/choice-interaction.test.ts)

### 视觉与操作

`ChoiceSelect` 使用独立编写的测量和 CSS 过渡，没有复制 React Bits 或 Uiverse 的组件源码，也没有添加第三方运行时。它保留原生 popover，使菜单进入 top layer 时仍属于原对话框 DOM 和焦点范围。

选择背景依照当前选项的实际布局坐标、宽度和高度移动，不以“行号 × 固定行高”推算。说明文字换行、字体变化或菜单宽度改变后会重新测量。文字和价格本身保持静止；选中项始终有勾选标记，键盘游标有额外轮廓，避免把“正在浏览”和“已保存的值”混为一谈。

| 部位             | 桌面                                  | 手机 / 粗指针                  |
| ---------------- | ------------------------------------- | ------------------------------ |
| 选择背景         | 180ms 位置与尺寸过渡                  | 165ms                          |
| 文字与图像       | 不缩放、不模糊                        | 不缩放、不模糊                 |
| 触发图标与选中勾 | 18px 图形，选中标记保留 20px 独立位置 | 相同图形比例，不扩大为笨重图标 |
| 触发器           | 沿用普通 / 紧凑场景的既有尺寸         | 最小 44px 高                   |
| 选项             | 保留紧凑排布，说明可换行              | 最小 44px 高                   |
| 减少动态偏好     | 取消背景与文字过渡                    | 同左                           |

输入状态处理：

- 键盘方向键、Home、End 跳过不可用选项；Escape 关闭菜单且不误关外层对话框；Tab 保持原生前进顺序。
- 文字查找支持重复首字母循环、700ms 内连续前缀、全角文字规范化和中文标签。输入法组合期间不接管按键。
- 键盘滚动后，同坐标的指针事件不会抢回当前游标；真实鼠标移动后才转为指针控制。触摸拖动保留原生纵向滚动。
- 游标绑定选项的值，服务端刷新、重排或禁用选项不会让原索引悄悄指向其他模型。回退仅改变浏览位置，不自动提交任何值。
- 菜单高度读取实际内容，再按 visual viewport 与触发器位置决定向上、向下或极短屏可用区域内展开。活动行滚动使用其真实高度，长说明不会被固定行高算法截断。
- resize、scroll 和测量观察器只在打开时工作；关闭后立即停止测量，离场内容继续保持 inert 和 aria-hidden。

## 已落地：账号与使用

文件：

- [AccountCenter.tsx](../../apps/web/src/account/AccountCenter.tsx)
- [account-center.css](../../apps/web/src/account/account-center.css)
- [account-model.ts](../../apps/web/src/account/account-model.ts)
- [account-model.test.ts](../../apps/web/test/account-model.test.ts)

Aceternity Tabs 的连续选中背景被改为实际测量按钮位置与大小的指示层：桌面纵向导航 180ms，手机和短横屏横向导航 170ms。React Bits Stepper 的方向与测量原则用于账号面板切换，按前进、后退给予 7px 横向路径，桌面 200ms、手机 180ms；内容直接可读，未加入动画等待或新的运行时。均为独立实现，未复制组件源码。

桌面是身份栏与内容双列；宽度低于 760px 或高度低于 500px 时，身份信息收紧并使用真正可横向滚动的 tab 条。选中标签的宽度由内容决定，方向键和 Home / End 会将标签滚入条内，不滚动照片工作区。导航使用完整 tablist / tab / tabpanel 关联，只有当前 tab 进入顺序焦点。手机与粗指针动作保持至少 44px 触点，图标保留 16–23px 的视觉比例。

界面按真实职责分成概览、安全、额度与付费、数据与退出。信息行、余额、错误反馈、导出行、退出行分别使用 180–200ms 的短过渡；FAQ 与注销说明沿用原生 details 和既有 180–220ms disclosure，离场内容 inert。所有文字、服务点数字、图片区域的模糊为 0；减少动态偏好下立即切换。

### 接口与能力边界

`GET /me/entitlements?spaceId=...` 按用户 ID、空间 ID 与本次请求绑定。切换用户或空间的首个渲染就隐藏上一份结果；清理时中止读取，旧回包不能改写数字。明确指定但无权访问的团队不会回退到个人钱包。响应必须包含匹配的空间 ID、非负安全整数、正确的可用额度合计和有效时区日期，异常数据不被格式化成 0 或四舍五入后的余额。

当前请求的 401 只通知根组件复查会话；403 留在当前空间错误状态，不擅自清除账号。免费与获赠、已购可用、任务预占独立展示，数字不缩写为约数，周期按服务端采用的北京时间展示。服务点不被表述为现金。

账号重置进入现有短信重置流程，明确重置成功后所有旧会话失效。退出动作只交给根组件既有的照片、活动任务与会话确认保护；组件不复制确认框或自行删除会话。公开购买流程和自助注销能力尚不存在，因此只显示真实状态与原因，不创建假套餐、金额、订单、删除请求或注销成功画面。`paymentConfigured` 即使为 true，也不会被当成公开 checkout 契约已具备的证据。

七项账号模型测试覆盖无权空间、身份与空间范围、错误数字和合计、零及大整数、日期和时区、异常未遮罩号码、键盘导航。可操作性、手机布局、主题和动画仍以真实浏览器检查为准，不由模型测试推定。

## 许可与采用方式

### Aceternity

[官方安装说明](https://ui.aceternity.com/installation) 区分公开组件和需要密钥的 Pro 内容。[Licence](https://ui.aceternity.com/licence) 是 Aceternity 的许可条款，并非全站通用 MIT。本轮仅研究公开文档与公开 registry 的行为，没有取得或提交 Pro 源文件。项目中的适配逻辑独立编写。

### React Bits

[该提交的 LICENSE.md](https://github.com/DavidHDev/react-bits/blob/9d9c687dc4f55b23539aa5417b703078047efa74/LICENSE.md) 为 MIT + Commons Clause。文件允许组件作为应用的一部分使用，同时限制将组件本身再销售或分发。工具和声音库还有专门条款：不能提供工具本身或实质类似副本的托管服务。因此本轮没有移植 Texture Lab、Background Studio、Shape Magic 等工具源码；图片处理继续使用项目自己的版本化引擎与契约。

### Uiverse

[Galaxy 的 LICENSE](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/LICENSE) 为 MIT，单个组件页面也列出作者署名。若后续复制实质源码，应同时保留对应作者及许可。当前选择控件的布局和状态逻辑为独立实现，来源链接用于说明设计研究和行为取舍。

## 验证边界

本组件的新增测试覆盖实时选项重排 / 禁用、前缀查找、静止指针与键盘控制权，以及不同真实行高的滚动计算；既有选择器的配方字段、受控值与隐藏表单语义测试保持执行。类型检查不代替视觉检查。桌面、窄手机、短横屏、深浅主题与原生 popover 的实际浏览器结果以本轮总验收报告为准。
