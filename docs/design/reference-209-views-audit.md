# 209 参考 · 业务页面与弹层只读审计

## 1. 基线与证据边界

- 产品代码固定于 `bb9e126cd668eb87d53548fbcdef773982f284a4`。扫描开始时共同 checkout 为 `7a7c86247b0809aba2c8a57b3f35d47c0010f276`；收尾为 `87ac4581e7ba7b5a96f5f3a1386f32457f566334`。已核 diff 只有研究文档、实际截图与来源清单，产品逻辑源未变。
- 源码目录：`/workspace/scratch/a16fa6d0bc34/AI-xiutu-v2`。已阅读 AGENTS、root README、DESIGN、web README；完整读取用户 209 条参考及附加要求，再扫描业务路由、状态、公共弹层、响应式样式。
- 官方 React Bits 固定快照：`9d9c687dc4f55b23539aa5417b703078047efa74`，目录 `/workspace/scratch/a16fa6d0bc34/react-bits-audit`。本审计完整源读 17 项 TSX 与对应全部独立 CSS，逐文件 Git blob / SHA256 / URL / 依赖在 `reference-209-views-sources.json`。LICENSE.md 已全文读，为 MIT + Commons Clause；需要保留相应版权及许可，不把组件本身再作为组件商品分发。
- 40 个 `<Modal>` **挂载点**保存在 `reference-209-modal-mounts.json`。挂载点不等于 40 种业务流程，也不意味着每种异步状态都已运行。
- 以下尺寸是 **当前源声明及层叠分析**，不是新分支浏览器实测。旧第五/六轮截图不作为 bb9 的视觉证据。Root 独占新应用和官方演示的真实浏览器取证；本轮尚未据此宣布“无重叠”或“全部状态通过”。
- 此文件记录实施前的只读审计；该阶段未改产品、测试、Git ref 或部署状态。Root 已于审计收尾后授权第一轮实施；未验证候选仍不视为已采用。

## 2. 建议真正采用的机制

每组只解决对应问题，沿用同一轻量 motion 基础与当前业务状态机。现有项目没有 GSAP / motion / Hugeicons；不因参考组件出现这些依赖而批量安装。Editor 负责公共调度与 reduced-motion 接口；原 `usePresence`、native dialog、关闭校验、退出 inert 保留为唯一行为基础。

| 页面或组件 | 参考组合 | 采用的具体部分 | 应保留的行为边界 | 拟实施归属 |
|---|---|---|---|---|
| About 九段自然阅读 | 31 + 35 | 少量媒体外框展开、短距离分段到达；真实截图与精细 SVG 引导视线 | 内容默认可见；截图无裁切/拉伸/虚构细节；不加滚动劫持、tab 或隐藏正文；主 CTA 直达工作台 | Root |
| 主导航、空间侧栏 | 78 + 68；移动打开借 85 | 当前项的双边滑动胶囊/细线；按可用宽度折叠；短分层入场 | 原 Logo 不旋转、不反色；actual route 决定选中；button/aria-current、Esc、焦点归还与背景隔离完整 | Requirements |
| 素材与资源 | 69 + 119；多选可用 133 | 内容到达的轻反馈、选中轮廓、真实载入/操作状态、小选择标记 | 保留真实图片比例；常用操作可直达；hover 不能改变业务选择；不隐藏半可见卡片；DOM 顺序稳定 | Views |
| 文档列表与编辑页 | 69 + 119 + 115 | 列表选中轮廓；单一保存状态；短回执可暂停通知 | 本页草稿、CAS 冲突、未知创建、读取最新、导出草稿和离开校验全部保留 | Views |
| 协作讨论与任务 | 133 + 119；筛选可借 131 | 小视觉勾选、可辨 todo/doing/done、真实回执后的状态形变；筛选底板滑动 | 非 optimistic 完成；保留三态、权限、版本绑定；不能用 checkbox 把 doing 隐去；键盘真实 click | Views |
| 导出、恢复、复制、共享、导入等弹层 | 119 + 120 + 115 | 真实异步状态、选择行底板、暂停式回执；内容按任务分区 | 单一 native dialog；异步关闭锁/返回焦点/未知结果/保存回执不改；不新增向导步骤 | Views |
| 账号、登录、注册、设置 | 78/131 的受控选中反馈 + 119；200 待验 | 简洁选中反馈和真实提交状态；主题可用太阳/月亮同形变换 | 现有手机号/密码/one-time-code input；验证码值保留；系统主题仍为独立第三态；未知登录先核验 | Views / Requirements |
| 用量、账本、报价 | 119 + 120；保留原 SVG 图表 | 当前筛选、真实读取/错误状态；统一明细展开与读数视觉 | 不将 unknown 金额补零；不能把预占与结算相加当余额；不添加演示数据或计时进度 | Views |
| AI 输入与执行 | 114 + 119 + 111 | 输入自增高、附件 chips、发送/停止 SVG 同形变化；真实 SSE 事件简报 | 现有 IME、草稿、收据、unknown、取消核验、费用/权限约束保留；没有自动清草稿、假思考、假进度 | Requirements |
| 语音 | 112 + 119 | 胶囊展开、真实音量与时长、显式停止/取消 | 用现有录音/通话生命周期；不重复打开麦克风；不能使用 simulated 波形；静音/连接中/结束待核验不同状态 | Requirements |
| 普通短通知 | 115 + 119 | hover / focus / hidden 暂停计时，触摸可逆手势，明确关闭 | 正常文流位置不遮挡工具；pointercancel 复位；错误与未知结果不自动消失；成功由真实结果驱动 | Views + Editor motion |

### 已核源码中必须适配的差异

- **68** 的原始交互是 `li onClick`，没有完整键盘语义；只能借线条反馈，不能照搬 DOM。
- **78** 的移动展开不是 modal，不能替换现有焦点/背景隔离；原示例 Logo 动画不采用。
- **85** 缺 Esc、focus trap、inert 与 reduced-motion；只借入场节奏，不借其生命周期。
- **69** 默认 hover 改选中，且以相交比例把部分行隐藏；不带入文档、素材业务。
- **114** 原 send 即刻清空输入，不等待业务回执；菜单 Enter 分支早于 IME 检查。保留现有 `ComposerInput`，只改视觉与状态形变。
- **112** 默认 simulated；pointercancel 走正常抬起，toggle 录音后的 blur 监听不完整。只接现有真实媒体状态。
- **119** 没有 unknown，且 reduced 分支仍会呼吸；须添加明确未知状态和完全静态低动态分支。
- **115** 原 pointercancel 会走 dismiss 判定，action 也先关后 await；不可直接替换当前通知。
- **120** 缺完整水平碰撞/长列表滚动/IME 防护。当前 ChoiceSelect 已有这些行为，只增强其视觉。
- **133** 原组件是二态；项目任务是三态且有 CAS，动画必须由真实状态驱动。

## 3. 当前实际路由与状态覆盖

### 顶层与业务视图

`SiteRoute` 为 `about / studio / login / register / reset / account / welcome / usage / sample`。`works / compare / collaborate / docs / deliver` 是 App 内部 view，不是分别独立 hash 路由。`sample` 是兼容入口，读取真实本地样本并经过真实编辑导入；当前 About 主操作不经过样本练习。About 与工作区切换保留已经挂载的 App，隐藏时 inert，离开检查可拒绝导航。

| 区域 / 源文件 | 已扫描的当前状态 | 本轮应调整的呈现 | 不能误删的内容 |
|---|---|---|---|
| `SiteShell.tsx`、`about/AboutPage.tsx` | About 九段；首次 lazy 载入；route error/retry；三语言；窄屏隐藏锚点；低动态；自定义品牌 | 九段里的 assistant / together / delivery 仍偏静态图标与文案；手机整张桌面截图缩得过小。需要当前 UI 证据与更具体的 SVG 连接，不增加阅读点击 | 主内容连续可读、配置品牌、工作区保留状态、首屏真实截图 |
| `Sidebar.tsx`、`WorkspaceNavigation.tsx` | 游客 / 已登录；个人 / 团队；无项目；只读；owner/admin；ops 入口；打开/关闭；手机 view chooser | 侧栏聚焦与背景隔离先补；删重复“此处是什么”说明；保留角色和当前空间 | 当前项目、角色、团队创建/加入、账号入口、权限限制 |
| `StudioWelcome.tsx` | 未载图；guest/loading/signed-in；导入/草图/AI 入口 | 大导入面与桌面/手机分别定几何；小屏无需大图标＋大标题占半屏；SVG 体现导入动作 | 本机导入明确、登录独立、不诱导上传 |
| `AssetLibrary.tsx` | 无空间/无项目、加载、错误、空、筛选空、两种密度、分页、来源/日期/分组、实际图片、元信息、多个作品版本、readonly | 常用动作小而可触；素材信息层级统一；手机 toolbar 收敛；compact 两列下长名/版本/操作专项检查 | 原图比例、项目/素材身份、权限、真实版本、分页结果 |
| `ResourceSearch.tsx` | 全部/个人/团队；空间/来源；250ms 搜索；过滤切换 abort；加载更多；无结果；权限撤销；长期素材开关；读取原件 | 统一资产卡与项目卡视觉、避免当前 multicolumn 阅读顺序差异；长期素材表单缩减常态高度 | 私人标注与团队元信息的区别、删除和访问权限不能混为一谈 |
| `WorkspaceViews.tsx` Documents | 初载、空、搜索空、选中、创建、dirty、pending-save、unknown-create、读取最新、冲突、权限变化、恢复/导出/丢弃草稿；手机 list/editor | 68px 同高文档行过大；编辑头和 footer 重复保存状态。收敛为一个事实状态＋就地错误，保留完整恢复面 | CAS 版本、本页草稿、未知保存不重复提交、只读仍可复制 |
| `WorkspaceViews.tsx` Collaborate | loading/error/retry/empty；discussion all/open/resolved；project/version 范围；task todo/doing/done；pending锁；readonly；全页/嵌入页 | 现有标题旁 stats 已是行内，不能又加三张卡；任务图标应更精细、缩小视觉；手机讨论/任务层次更短 | reviewer 可评论、只能处理自己讨论、版本绑定、三态和真实保存 |
| `WorkspaceViews.tsx` Delivery | 无图；sourcePending/loading/rendering；可导出；配方导入/导出；版本/尺寸 | 现阶段 preview 与导出rail合理；手机标题/空间/主按钮单独缩尺寸；导出反馈统一 | 配方不含原图、真实尺寸、生成文件后可再次下载 |
| `UsageDashboard/Trend/River/Ledger/Job/Pricing/Capacity` | 日期/空间/成员/operator 范围；loading/error/stale；0记录/unknown金额；分页；CSV取消；真实余额/容量；报价不可用；receipt detail | 双图与六项汇总在手机需要更紧凑组合；任务费用里的9px字应消除；无需把图表改为装饰卡 | 金额口径、未知值、北京时间、预占与结算区别、价格来源、历史账本标识 |
| `AuthPanel.tsx` | 密码/OTP登录；register phone/details；SMS不可用/冷却/unknown；输入错误；busy；unknown-session核验；reset done | 50px字段和两层切换在手机仍偏大；分清入口与登录方式层级；用真实状态SVG替代堆叠spinner | 实际 input value/autocomplete、密码可粘贴、已收到码可继续、未知结果不能盲重发 |
| `AccountCenter.tsx` / `AccountReady.tsx` | overview/security/billing/data；roving tabs；无空间；额度加载/错/读到；未开放支付/注销；草稿；活动；退出中/失败；注册成功后入口 | 最后覆写使手机头像仍52、余额最小48；四panel标题仍24。应独立减小手机视觉，并减少信息行间隔 | 当前账号、数据导出、未保存工作、退出清除本页草稿、未开放能力的诚实状态 |
| `AIPanel.tsx` / `LiveAssistant.tsx` | login/project/model pending/unavailable/ready；四任务；历史；参考素材；上下文/记忆；授权；SSE；voice；queued/running/unknown/failed/cancelled/completed；preview/confirm/reject；恢复 | 正常输入与高级设置分工已有基础；下一步聚焦精细发送/停止状态、输入与附件布局、真实执行摘要；不可重复添加 AI 标题 | 未决请求冻结、服务点、共享画面许可、模型能力、请求身份、停止待核验、候选不自动应用 |

### 全部弹层分组

| 弹层族 | 具体入口 / 状态 | 设计工作 |
|---|---|---|
| 导航与设置 | 7工作视图；light/dark/system；语言；导入预算；重置布局；帮助；用量；命令搜索的匹配/无匹配/全部disabled | 统一紧凑菜单项、当前项、SVG及桌面/手机几何；保留完整CommandMenu/ChoiceSelect键盘与定位 |
| 一字段表单 | 新建项目、创建团队、加入团队；空/校验/提交/错误 | 小型居中表单或短sheet，避免与大型媒体窗口同大小；字段焦点优先，真实submit锁 |
| 团队管理 | 成员、角色、移交、移除、生成/复制邀请码、共享规则、成员活动、读取失败 | 三个任务区各自短列表；初载/错误/重试明确；危险操作用现有确认；长人名与role控制换行专项 |
| 项目复制 / 共享 | 目标空间为空/有；reference/copy；有效期；有效/过期grant；撤销；提交错误 | 动作前只显示影响决定的事实；grant list初载不假显示空；读取失败可原地重试 |
| 图片导出 | PNG/JPEG/WebP；质量；源切换；渲染/编码busy；ready；下载失败；再次下载；重新生成 | 图片preview/格式/质量/文件名/状态/主动作顺序；手机格式说明至少可读，移除9px；busy至ready原位置反馈 |
| 图片导入 | 本机预算；不支持/超预算；普通服务端规范化；RAW/HDR/PSD/HEIC原件能力；上传/暂停/继续/处理/失败/取消/恢复/原件ready | 常态精简为所选文件＋适用路径＋主动作；能力上限按当前格式汇总；深入格式/内存说明放二级详情，不能隐藏实际上传意图 |
| 原件与母版 | assets/resource/AI参考/导入完成多个入口；适屏/1:1；GPU/CPU；native编辑；保存/导出；加载错误 | 专用media容器宽度、预览/参数两区和手机布局；不更改源坐标、GPU fallback、保存锁、原件参数契约 |
| 修复 | denoise/motion；报价debounce/pending/不可用；高级参数closed/open；session journal unavailable；busy/unknown/recover/完成副本 | 真实双图、参数和报价footer统一；手机数值框/摘要可读与独立命中区；闭合details焦点规则保留 |
| OCR / GIF / 拼图 | 语言包/像素限制、识别记录/文字/表格、删除；GIF读取/帧顺序/时长/循环/配方/另存；拼图2–12张/尺寸/contain-cover/透明间距 | 避免选择素材只有名称的密集清单：加真实thumbnail与选中顺序；GIF帧顺序可在真实元数据范围内可视化；不宣称现有接口有未提供预览 |
| 素材元信息 / 长期标注 | CAS冲突、读取最新；标题/标签/时间/地点；remembered/private note/remove | 常态字段紧凑；时间/来源为元信息；个人隐私区别保留但不重复解释；未知/冲突不静默丢稿 |
| 版本 / 冲突 | 历史restore；fork pending/unknown/停止等待/已创建/打开；云端更新保留本地；通用确认 | 目标版本→新版本关系用小SVG；一个主要动作；保留原请求重放身份与不覆盖队友说明 |
| AI任务 / 参考 / 历史 | 任务picker、references/mask、历史、结果差异表、参考预览、保存文案、候选fork/layer/replace/apply/reject | 紧凑真实内容与可读动作；与公共Modal共用外壳，业务body由Requirements所有；避免多层标题 |
| AI恢复 | 文本、图像、语音、团队未决邀请；journal读取失败；跨项目；原image/audio已不可重放 | 一条明确结论＋下一步＋可展开标识；费用/重放后果不能删；不添加“自动重新生成” |
| 用量明细 / 公开费率 / 服务点 | loading/error/retry；verified receipt；token与费用；unknown分摊；当前余额 | 明细可按阶段读，移动卡片无需全宽多列；9px收据字增到可读；不改计费口径 |
| 草图 | canvas、工具/画幅、选择/图层、撤销/重做、清空、保存 | Editor负责canvas和工具；本代理只管drawing Modal profile/公共语义 |

另外，`PanelSettingsPage` 是保留在 AI 面板里的页面，已有进入heading焦点和返回原按钮，不应改成二次Dialog。`ChoiceSelect` 是 owning dialog DOM 内的 native top-layer popover，不应移动到脱离焦点域的任意 portal。`QuotaManager` / `UnknownJobsPanel` 为运营页内表单，非独立Modal；其运营流程另见以下10项扫描。

### 运营管理的 10 个真实页面

完整读取 `OpsDashboard.tsx`、`AssistantOpsPanel.tsx`、`QuotaManager.tsx`、`UnknownJobsPanel.tsx` 与 `ops-surface.css`。以下是源审计，不表示已获得运营角色或运行写操作。

| 页面 | 实际状态与约束 | 呈现改造边界 |
|---|---|---|
| 运行概览 | 真计数、布尔能力开关，loading/failed/readReady；无业务数据阅读权限扩张 | 数值密度与真实119状态；不把已配置等同执行账户已核验 |
| 用户管理 | 搜索/空/待验证/正常/限制；变更需审计原因；限制会撤销会话；创建待验证账号 | 当前用户行手机换行，搜索结果就地反馈；不删操作后果 |
| 站点与注册 | 配置读取/保存、logo上传项目权限与owner检查；邀请码一次显示/复制失败 | 区分上传待保存与已公开；不得替换配置品牌或把上传成功说成配置已保存 |
| 权益套餐 | 目录空/启用/停售、新版本；创建默认未上架；真实分值/价格/有效期 | 紧凑目录行和输入；不存在支付能力不展示购买成功 |
| 模型能力 | 目录/实际runtime availability、动态尺寸/输出/质量能力；expectedVersion冲突重读 | 修复model-row首子SVG被flex:1误伸展；长ID换行；保留真实provider能力与价格 |
| 语音与协作模型 | catalog/readiness、真实协议、输出/上下文/图像预算；expectedHash；读取与提交owner隔离 | 两区布局与手机独立字段尺寸；不启用模型或更改配置；恢复/核验不能当重发 |
| 额度调整 | 查用户→真实权益→正负调整；事务回执更新余额，idempotencyKey；忙时禁交互 | 同一屏保留目标、依据与调整量；空查询回执可读；不得把读取失败变为写失败 |
| 用量账本 | 复用operator UsageDashboard，真实scope/date/unknown/分页/CSV | 尺寸沿用业务用量组件，不改运营权限或计费口径 |
| 生成任务核验 | unknown列表筛选/分页/加载/失败/空；executor不可用只读；人工证据/reviewed后结算或释放 | 119静态unknown、手机长ID可读；不能自动重发或删证据/说明字段 |
| 操作审计 | 真操作原因、时间、ID与target详情，载入失败不显示空列表 | 紧凑时间/结果/详情，保留审计字段；不展示私人项目内容 |

运营现有桌面导航190px、行44px，content padding24–56，标题24–34，字段44px/13px；720以下横向10项导航、内容左右20，仍继承13px输入。手机需16px输入与更小非输入层级、明确 `aria-current`，长表保留滚动/字段语义。当前 `.model-row > :first-child { flex:1 }` 实际命中SVG，是确定的几何问题；改为文本 `div` 伸展，图标固定独立尺寸。所借机制限119状态、已实证后115/133/120与共用131/136，不改变运营业务契约。

## 4. 当前桌面 / 手机尺寸与明确落点

以下“手机”对应各文件现有断点，未人为假设为单一760。实际视口、容器断点、触控指针可能叠加，实施时应以computed尺寸复核。

| 区域 | 当前桌面声明 | 当前手机声明 / 覆写 | 建议改造目标 |
|---|---|---|---|
| 业务页框 | max1480；内边距22–52；标题28–40 | 小于760：22/20/44；小于440左右16；标题28 | desktop标题30–34，phone22–24；手机段距20–24，常用toolbar不堆3行 |
| 作品卡网格 | comfortable min320 auto-fit；compact min210 auto-fill；gap28×24/24×18 | compact固定2列gap22×14；comfortable通常1列；密度按钮38→44 | 维持图像构图；phone图标视觉更小，44命中盒；长名/多版本不挤压图片 |
| 资源搜索 | multicolumn3×260；4个filter列 | 2×200，440下1列；filters2列 | DOM/键盘读取顺序与视觉顺序一致；搜索首行，其余筛选紧凑且可直达 |
| 文档 | rail240＋gap36；row68；textarea≥390；title22–34 | list/editor切换；row仍68；textarea≥40dvh/16px；title26 | phone row52–56、title20–22；一处保存状态；不为改造增加保存点击 |
| 协作 | 两列1.6fr/min260；gap52；comment padding20；textarea100 | 单列gap36；上述内部高度多数继承 | phone文字与动作更紧凑；任务视觉18–20、命中44；避免大型0值空态 |
| 交付 | 大preview＋rail；主动作48 | preview≤48dvh/450；h2 24；主动作仍48 | phone动作44、title20–22、metadata12；保留实际preview |
| 公共modal | form480、danger420、export540(后覆写520)、settings520、AI580、media800、team760、billing900 | 多数fullwidth bottom sheet；padding14–22；title22；close40；按钮44；fields≥46且16px | 内容型profile而非一律放大；phone title18–20、padding14–16、字段44、视觉32–36控件＋独立44命中；短表单保留紧凑高度 |
| 导出 | preview190；格式card≥70；说明10px | preview165；格式card仍70；小于440说明9px | phone格式card54–60，说明≥11；主要动作44；短横屏preview省略保留内容是已有逻辑 |
| 修复 | 自有CSS声明width880，但wide解析为detail，公共高specificity profile约束740；image max380；controls gap22；number76×36；mode42 | 自有widthvw-20声明受公共sheet规则约束；image max230；controls gap20；number仍76×36/13px | phone number更窄但输入16px、hit44；模式视觉32–36＋44hit；双图保持原比例 |
| 原件与母版 | 默认form480入口；preview300；zoom按钮30 | preview≤38dvh/280；zoom40；横屏grading专设800双列；短高参数区独立scroll | 为多个入口统一media profile；桌面预览可大、phone空间独立分配；不改GPU/native功能 |
| 登录 | frame440；input/send/submit50；fieldgap22；heading32–42 | input/send/submit仍50；main top32；header64 | phone字段44、fieldgap16、heading26–28；保持16px输入、真实OTP值 |
| 账号 | rail220；头像52；panel标题24；余额48–76 | 最后高specificity覆写使头像仍52、panel标题仍24、余额仍至少48；tab44 | phone头像36、title20、余额34–40；statements用单行而非卡片 |
| AI | header44；action34×36；input36–136/14px；tools36 | header42–46；action40；input36–112/16px；tools40；260/200px容器短高专门模式 | 保留短高适配；phone视觉glyph16–18、底板32–36、命中44；需布局重排避免扩大button挤掉对话 |
| 用量 | 钱包38–64；6汇总；trend220–340；读数导航44 | 钱包48；3汇总；trend230；job receipt最小9 | phone余额34–40、细节≥11；按数据重要性缩段距，不压金额可读性 |
| About | header64；main gap70–130；primary58；sectionh2 33–58 | header62；sectiongap58；primary50；h2 35；body13–14 | phone视觉尺寸独立；缩总留白、提高真实截图细节可读；不为动效隐藏段落 |

**关键实现约束：**“手机更小”体现在可见表面、字号层级、间距、图标和面板结构；触控按钮可以用透明外盒保留44px，内部视觉32–36px。命中盒必须在布局中占有自己的区域，不能用互相重叠的负 inset 伪元素来凑44。输入保留16px，缩边距和高度，不用9px/10px文字换密度。

## 5. SVG 与信息密度

当前 `StudioGlyph` 已有统一24 viewBox /1.7 stroke/round cap，但业务页仍大量混用 Phosphor 14–42px及regular/light/fill。`ComposerVisual` 是64×48少量路径的功能示意；About assistant手机又把图标隐藏，剩余纯文字。UsageTrend/River为真实数值SVG，已有non-scaling-stroke、键盘读数、unknown标识及表格替代，不应改成演示图。

建议 SVG 改造按职责划分：

1. **功能glyph族：**保留品牌资产，只细化24网格的nav、文件/素材、讨论/任务、上传/导出、账户/安全；desktop20与phone18分别做光学对齐和stroke校验。删除/关闭仍清楚，不用装饰替换识别性。
2. **状态glyph族：**119适配真实 pending / running / done / failed / cancelled / unknown；SVG轨迹与文案一起由状态驱动；未知不能与失败共用“叉后重试”的含义。
3. **业务关系小图：**版本fork/restore、原件→工作预览→导出、副本与源项目、任务三态用少量精细矢量解释真实关系，替代多段实现术语；不伪造真实结果。
4. **真实图表：**保留Usage几何/unknown semantics，优化轴线、选点、读数，手机减小非数据空间。禁止自动翻滚数值显示未被接口确认的金额。
5. **About系统展示：**真实当前截图为底，SVG可以连接实际区域和流程；不用新AI画面代替系统细节，也不把整张桌面图缩成不可读的手机贴图。

## 6. 明确问题与优先级

### P1：行为/状态问题，先于装饰

| 发现 | 证据 | 改造要求 |
|---|---|---|
| 侧导航显示为overlay，但开态没有dialog语义、focus进入/循环/归还和背景隔离；App全局Esc在输入元素提前return后才处理 | `components/Sidebar.tsx`、`App.tsx` | Root新浏览器核对Tab/ShiftTab/Esc，Requirements统一到现有语义体系，不能照搬85 |
| ShareDialog无独立首次loading标记，`grants=[]`在请求完成前会渲染“没有未撤销授权” | `components/ProjectDialogs.tsx` ShareDialog | 显式读取状态，失败原地重试；真空态只在已读到空列表后显示 |
| 通知固定5s/错误9s，不随hover、焦点或document hidden暂停 | `components/Ui.tsx` Toast | 采用115可暂停计时；关键unknown/错误持久；pointercancel不得误dismiss |

### P2：手机尺度、密度与恢复成本

- 公共modal最终层叠把多个profile标题统一放大为24/22，削弱danger/form/detail区别；phone大多只是全宽sheet。应按任务规模定义尺寸，而非给所有窗口同尺寸。（`modal-profiles.*`、`content-redesign.css`）
- Auth字段50px、Account头像52px、余额至少48px与桌面共用最终覆写；手机没有完整独立视觉尺寸。（`account-page.css`、`account-center.css`）
- 导出说明、费用回执有9px小字，多个资产元信息10px；减少密度应压重复行与留白，不能压关键字号。（`content-redesign.css`、`usage.css`）
- Docs顶部与footer同时报告dirty/saved，68px列表行手机继承；正常态可收敛，冲突/unknown必须突出。（`WorkspaceViews.tsx`）
- Team共享规则失败要求关闭再试、TeamActivity初载失败无就地retry；与减少操作目标相反。（`ProjectDialogs.tsx`、`TeamActivity.tsx`）
- ImportSettings常态同时展示内存估算、文件格式、本机上限、服务端规范化、独立原片路线，文字过密；应按所选文件和能力先给适用动作，再展开准确限制。（`ImportSettings.tsx`）
- 拼图选素材只有文本行，GIF帧顺序靠逗号字符串；可用现有真实文件信息提高可视操作，但不能声称当前backend供应任意预览/帧图。（`AssetTools.tsx`）
- 新原件Viewer横屏已有双列/短高参数scroll，不能重新退回一长列；常规入口仍按form默认480，需统一媒体外壳而不动native逻辑。（`AssetLibrary.tsx`、`ResourceSearch.tsx`、`media.css`）
- 资源搜索用CSS columns，长短卡的视觉次序与同行期望不同；实际作品页现在为真grid且第五轮单列问题已修，不能把旧缺陷重新当当前发现。（`content-redesign.css`）
- About九段已经自然滚动，但assistant/together/delivery还可以更具体；图片网络失败没有专门恢复反馈。需新截图细节与真实state说明，而不是多加宣传段落。（`AboutPage.tsx`）

## 7. 未采用 / 待证据项

这些决定是针对页面目的；只有标为“已读源码”的项目才包含源码行为结论。

| 候选 | 判定 | 原因 |
|---|---|---|
| 102 Stepper（已读） | 不新增向导 | 登录已有真正两阶段；导出、About、普通导入加步骤会增加点击；原footer也不等待异步验证 |
| 110 RefineFrame（已读） | 不采用 | 对完整已知图做模拟马赛克清晰化，不是真实进度/结果 |
| 118 CallChip（已读） | 不采用其进度 | 目录名称易误导；实际是tool-call且按expectedMs走到90%，不是语音状态；119已覆盖有效部分 |
| 125 CodeSlots（已读） | 不采用原控件 | value为空、可见码aria-hidden、错误自动清空；破坏真实未知/可复用验证码语义 |
| 84 Folder（部分源） | 暂不采用 | 源码体量大且尚未完整核实；产品没有真正文件夹树契约，不制造“文件夹可管理”假象 |
| 80 Masonry（未完整源核） | 不更换现有grid | 当前作品grid已修；无需为视觉参考引入新布局/排序依赖；若资源确需masonry再完整核源码 |
| 121 SwipeRow（未源核） | 不藏常用动作 | 编辑/打开/导出要直达，不能仅手势发现；可触控辅助需另行完整核源 |
| 58/59/60/61/64/70/73/79/82/95（目录比较） | 不用于业务列表/About主内容 | 环形/轮播/叠卡/倾斜/3D陈列会隐藏资料或增加浏览操作；不能取代工作内容的稳定网格与自然阅读 |
| 33/36/39/44/49/77（目录比较） | 不用于图像真实性与正文入口 | 像素/模糊/形变/液体遮罩影响判断或隐藏当前内容；真实照片编辑不需要模拟画质变化 |
| 104/105/106/128/130/135（目录比较） | 不用于删除/退出/确认主流程 | 碎纸/揉纸/撕票/保险丝/滑动/长按增加操作或把不可逆动作游戏化；现有明确两按钮确认足够 |
| 184/185/199（目录比较） | 不用于账号与用量 | 当前购买/订阅未开放，不能放支付卡片或订阅示例造成能力误导 |
| 187 / 200 | 等Root精确source＋license＋demo证据 | 187最多借轻层次，不覆盖实际作品；200若采纳只做真实主题SVG变化，系统第三态保留；未实证前不写“已采用” |
| 129/131/136 | 复用Editor完整源核结论 | tooltip需viewport碰撞/aria合并；segment保留click/Enter/Space；switch保留单次提交、取消/失焦；我不重复装一套 |

## 8. 分工与实施边界建议

**Views（本代理）：**业务内容页、account/auth、公共Modal外壳/feedback/ChoiceSelect视觉、项目/团队/导入导出/资产工具/修复/用量弹层；允许补真实首次loading/原地retry与焦点恢复；不变API、权限、计费、请求身份或持久化契约。媒体容器与参数逻辑分开：本代理尺寸/布局，Editor保有NativeGrade/Viewer功能。

**Requirements：**主导航/侧栏/AI各页与状态；共用本代理Modal/选择控件，AI业务body由其改。应把本报告17项证据链接入209主台账，不复制另一套209表。

**Root：**About、品牌、整个应用shell、浏览器演示和真机/真实视口取证；图片继续用当前真实系统。

**Editor：**编辑器/草图/高级native，公共轻量motion与SVG状态基础需协调；本代理不改其画布/undo/preview/native保存逻辑。

建议顺序：共同尺寸/SVG/motion协议 → 公共弹层及通知 → 账号与业务页 → 少量真实状态场景浏览器审查 → 完整类型/既有测试/构建门槛 → 受影响流程与手机/短横屏/低动态复核。本文件完成扫描与来源准备；Root 已授权按已核实机制开始第一轮实施。参考的源码验证、真实演示和产品验收分别记录，不能互相替代。

## 9. 新浏览器必须补的有针对性证据

1. **导航：**桌面/phone/短横屏打开侧栏，Tab/ShiftTab/输入焦点Esc/关闭归还；与已打开native Modal、ChoiceSelect叠加。
2. **图片：**真实portrait+landscape；works两密度、长名/多版本、filters open；resource读序；metadata/replace/native viewer/restore三态；导出ready/error保留文件。
3. **文本/协作：**Docs empty/dirty/recovery/conflict/readonly与手机list/editor；Collab有长讨论和三态任务、提交中/版本改变；Team加载/错/成员长名/权限。
4. **账号：**phone登录/OTP/SMS unavailable/unknown/resets；account四panel/长名/无space/额度错误，200%字号和软键盘，不能靠缩文本避免溢出。
5. **AI：**真实provider unavailable要明确原因；只读catalog/settings/history/reference及unknown恢复视图；语音权限与结束状态按真实可用能力；不开付费provider、不伪造执行成功。
6. **用量：**0数据/真实非0/unknown金额、日期/成员筛选、明细展开/CSV取消、job stage长模型名；SVG键盘读数与手机纵向滚动。
7. **所有弹层：**closed details不可被focus；pending主动作disabled后焦点循环；ChoiceSelect在软键盘visualViewport边缘；busy close guard；退出动画inert；reduced motion切换后无残留RAF/遮罩。

以上为基于当前源的验收清单，不表述为已通过，也不把5个视口场景扩张成111项功能的五轮全面回归。

## 源码索引

- [业务视图](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/components/WorkspaceViews.tsx)
- [资产库](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/components/AssetLibrary.tsx)
- [资源搜索](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/resources/ResourceSearch.tsx)
- [公共Modal与通知](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/components/Ui.tsx)
- [项目与团队弹层](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/components/ProjectDialogs.tsx)
- [最终内容尺寸覆写](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/workspace/content-redesign.css)
- [Auth](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/components/AuthPanel.tsx)
- [Account](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/account/AccountCenter.tsx)
- [AI任务](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/components/AIPanel.tsx)
- [实时助手](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/ai/LiveAssistant.tsx)
- [真实用量](https://github.com/hxjyaohaohaode/AI-xiutu/blob/bb9e126cd668eb87d53548fbcdef773982f284a4/apps/web/src/usage/UsageDashboard.tsx)
- [官方源码与许可](https://github.com/DavidHDev/react-bits/tree/9d9c687dc4f55b23539aa5417b703078047efa74)
