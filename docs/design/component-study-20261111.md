# 组件与账号流程参考记录 · 2026-11-11

## 本次范围与证据

本记录对应本轮实际浏览器操作，覆盖 React Bits、Uiverse、Refero 的公开页面，以及 Mobbin 的访问结果。采用公共云浏览器：连接本机浏览器的工具在该子任务中报告缺少 originating browser context，因此没有读取用户私人会话。截图在本轮浏览器工具输出中逐次返回；本文件记录可复核的页面、动作和结果，不将图库截图视为真实产品注册测试。

| 参考                         | 实际操作                                                                                  | 可确认结果                                                                                | 本次边界                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| React Bits Background Studio | 打开用户提供的 Topography 配置；用键盘微调 Lines；Undo；切换 Landing page 预览            | Lines 从 21 变为 22，Undo 可用；撤销后恢复 21，Redo 可用；预览模式选择状态同步变化        | 设置面板正常，中央 iframe 在本浏览器中始终空白；不能据此评价着色器、鼠标跟随、帧率或成片效果 |
| React Bits Stepper           | Continue 进入 Plan；Back 返回 Welcome；选择 Mobile · 375px                                | 当前步骤、完成标记和前后导航随状态改变；预览宽度控制显示 375；表单内容区域随内容变化      | 仅操作公开组件示例，未执行真实账号或付款                                                     |
| Uiverse                      | 搜索 input；选择 Light 主题；打开输入控件详情；聚焦并输入演示文本                         | 搜索范围和主题在 URL 中保留；详情同时展示预览与源码；标签、输入框、说明分层；聚焦边界清晰 | 不提交表单、不收藏、不发布；只研究公开输入示例                                               |
| Refero                       | 进入 Signing Up & Onboarding；打开 Aboard 公开流程；横向滚动及点击进度点                  | 实际看见落地页、注册表单、验证码错误页、注册后的工作台截图；流程中的当前屏切换改变 URL    | 为图库中的产品截图，不是执行 Aboard 的注册；更多样本被登录/订阅门槛限制                      |
| Mobbin                       | 打开首页，操作公开的 Show next icon 控件；因样式缺失重新加载一次；沿 Open Mobbin 进入图库 | 首页文本可读但样式/图像未完整加载；图库返回 `This request was blocked` 与 `403 FORBIDDEN` | 没有确认有效的动画反馈，也没有访问到图库，不计为完成的交互研究；未登录、未绕过限制           |

## 已验证的页面

- [React Bits：用户指定的 Background Studio / Topography 配置](https://www.reactbits.dev/tools/background-studio?bg=topography&lineCount=21&lineWidth=1&elevation=1.5&foreground=1&scale=0.65&detail=0.56&tilt=23&speed=0.16&morph=0&glow=0.4&depthOfField=0.24&fog=0.07&brightness=1.05&mouseRadius=1.8&mouseStrength=0.35&trail=0.12&parallax=0.14)
- [React Bits：Stepper](https://www.reactbits.dev/components/stepper)
- [Uiverse：input 搜索的浅色筛选结果](https://uiverse.io/elements?search=input&theme=light)
- [Uiverse：muhammad_1180 的输入框示例](https://uiverse.io/muhammad_1180/blue-panther-32)
- [Refero：公开注册与引导流程列表](https://refero.design/search/flows?flow_types[id][]=1&order=trending)
- [Refero：Aboard 注册流程的落地页](https://refero.design/flows/406/417e2019-bade-4837-bbbe-77f342587ab7?flow_types[id][]=1&order=trending)
- [Refero：Aboard 注册表单样本](https://refero.design/flows/406/089d07e2-c7a0-4baf-b5c9-d621531daba6?flow_types[id][]=1&order=trending)
- [Refero：Aboard 验证码错误样本](https://refero.design/flows/406/e680e476-6cd9-4ee0-a001-d961efbf9ab9?flow_types[id][]=1&order=trending)
- [Refero：Aboard 注册后工作台样本](https://refero.design/flows/406/3a3d66b1-abe0-4f07-b27a-7e0f519c1cf0?flow_types[id][]=1&order=trending)
- [Mobbin：首页](https://mobbin.com/)
- [Mobbin：当前浏览器被拦截的图库入口](https://mobbin.com/discover)

## 对当前实现的具体校对

### 1. 流程位置应当同时有视觉和语义表达

Stepper 中可以直接分辨当前步骤、已经走过的步骤、继续和返回。我们的注册保持两步：输入手机号、设置账号。`AuthPanel.tsx` 用 `aria-current="step"` 表示当前步骤，`data-complete` 表示手机号输入步骤已经经过。它不代表短信验证已完成；真正的验证码仍由注册请求验证。

`auth.css` 为前进和返回分别设置水平位移方向，常规视口为 ±8px、窄屏为 ±4px；输入文字不添加高斯模糊。此处数值为项目自己的设计值，不是从参考站测得的动画参数。账号功能保留独立的弹窗、字段、结果和恢复状态，避免把所有面板当作同尺寸的通用卡片。

### 2. 可选内容在用户需要时展开

Background Studio 把预览、参数和撤销状态放在各自稳定的位置。可以从公开操作中确认的是“修改—反馈—撤销”链路。账号表单据此复核了可选邀请码的展开方式：选填时由“有邀请码？”展开；必填、已有值或有错误时保持可见。`MotionDisclosure` 管理开合与可交互状态，避免隐藏字段仍然抢占键盘操作。

这部分没有引入背景着色器。支付、删除账号等没有接口的操作也不采用示例组件里的假完成状态。

### 3. 输入框的层次首先服务于阅读与修正

Uiverse 的公开输入示例在标签、可输入区域、图标和辅助说明之间留出明确间隔，聚焦边界可见。我们的账号表单保留独立 label、字段错误和 `aria-describedby`；输入区采用 16px 字号与充足的点击高度。验证码、手机号、密码显示按钮分别有自己的布局，说明文案减少为完成当前动作所需的信息。

例如隐私说明缩为“本地编辑无需登录。保存到项目或发送参考图时才会上传照片。”，并保留真实上传边界。短信发送回执使用“已提交发送”，没有将服务受理误写成用户已收到短信。

### 4. 验证失败与进入产品的状态都属于完整流程

Refero 中的 Aboard 公开样本包含验证码错误页和账号创建后的工作台，说明流程参考不能只看漂亮的首屏。当前实现据此校对了 `AuthPanel` 的恢复界面、`AccountReady` 的下一步入口、账号中心的安全和数据页面。

`AccountReady.tsx` 展示真实个人空间名称，并根据当前是否已有照片给出继续路径。它不以虚构的项目、照片、额度或欢迎统计填充空状态。账号中心分别组织概览、安全、额度、数据内容；余额使用明确的数字层级，详细规则放入可展开说明，下一步动作保持可见。

### 5. 真实能力决定操作状态

参考站中的套餐示例不能作为本项目付款能力的依据。现有服务端公开配置 `paymentConfigured: false`，也没有用户自助购买、订阅取消或注销接口。账号中心因此明确显示购买尚未开放，并解释现有额度仍可使用。

停止使用、退出登录和取消已有任务是不同动作：退出登录不会撤销已派发请求，也不会自动释放预占。注销区域保留清楚的能力说明与数据导出路径，不提交猜测的 API，不展示假删除成功。

### 6. 三语需要覆盖动态标签与账务语义

在账号文案之外，本轮对用量账本作了补充校对：范围选择、成员回退名称、钱包标题、任务与回执状态、计量单位、错误信息、图表说明和数字日期格式都随语言切换更新。由同一句中文拆开的片段改为带参数的完整句子，以保证英语顺序可读。

`usage-messages.ts` 当前含 331 个英文键及相同范围的繁体映射。成员显示名、空间名称、用户原因文本、模型标识与账务标识保持原值。日期筛选和账本显示仍遵守北京时间的既有口径；纳美元使用原有精确算法，不把未知费用显示为零。

## 验证记录

完成账号调整后，以下聚焦测试通过：auth-model、account-model、session-lifecycle、document-drafts、modal-close、confirmation-dialog，共 56 项。

完成用量调整后，usage-workspace、resource-usage、provider-billing 共 34 项通过，涵盖权限范围、日期边界、账本快照、分页/导出、未知费用、纳美元精度、服务点与供应商费用的区分。Web TypeScript 检查通过，`git diff --check` 通过。

这些结果证明受测的行为与类型约束。当前子任务没有在浏览器中测试本地项目；浏览器访问的是上述公共参考页面。项目的桌面、平板、窄屏、横屏及三语视觉验收另见主任务记录。也不将本次抽样研究表述为遍历所有组件库页面。
