# 209 参考改造：第一轮业务页面人工视觉复核

日期：2026-11-12。审阅对象是源提交 `0a88d9e22a7c455538e8c875c54ba82333d0b319` 的真实浏览器截图，位于工作区 `v2-reference-study/round1/`。逐张使用图像查看器打开了以下 **52 张**，不是以自动布局断言代替目检。

本轮报告是 **23 / 24 个浏览器 case 通过**。账号/运营综合 case 停在账号页键盘导航的测试起点断言，后面的手机账号和运营截图没有生成。此文不把第一轮称为全绿；Root 已独立修正该测试起点，并拆分后续 case，实际结果需以第二轮为准。

## 已确认的问题与对应修正

| 位置与画面证据 | 实际问题 | 本轮修正与保留行为 |
| --- | --- | --- |
| `screens/library-phone-{zh-CN,zh-TW,en}.png` | 390 px 手机的次操作、导入、搜索、项目筛选、密度/刷新各占一行。中文首图约从 y=431 开始；英文分类换行后更低。 | 手机次操作使用各自独立的 44 px 图标按钮，保留可访问名称及标题；“导入照片”保留文字，与次操作同排。搜索独立一行，项目、筛选、密度、刷新合为一行。DOM 顺序、权限和实际事件不变。筛选生效后的重置入口仍保留。 |
| `views/works.png` 及 6 张素材截图 | 首次打开素材时，四个分类紧贴视口左边，几乎是未设置样式的文字。英文手机发生两行折返。 | 根因是公共 `library-context-tabs` 样式只由懒加载的 `ResourceSearch.tsx` 导入。将其移入编辑器常驻 `content-redesign.css`，采用 40/44 px 独立点击区、选中态和原生单行横向滚动；删除搜索专属 CSS 中的旧副本，避免切页面后尺寸再变化。 |
| `views/collaborate.png` | API 返回后的讨论正文几乎不可见，任务文字仍模糊；三语 `screens/collaboration-*` 的后续最终画面清晰。 | `discussion`、`comment`、`task-item` 的入场原本有 backwards delay、opacity 0 和叠加 blur。刷新会重新挂载这些节点。只对协作正文改为 180 ms、3 px 位移入场，从第一帧可读；减少动态时无动画。真实任务三态与 `TaskStateMark` 动效不变，不延迟或伪造业务状态。 |
| 三语手机协作截图 | 单条评论后仍被桌面继承的列表最小高度留出较大空白；英文返回/刷新/共享又折成两行，使任务进一步低于首屏。 | 手机完整协作页的评论列表不再预留 190 px 最小高度；返回、刷新改为保留可访问名称的 44 px 图标按钮，共享保留文字。嵌入编辑器的协作面板不套用这一排布。 |
| `account/desktop-zh-CN-login.png`、`phone-zh-CN-login.png`、`small-phone-zh-CN-login.png` 等 7 张登录图 | 手机输入与主按钮反而比桌面更高。原 `.account-page` 的缩放被后加载、同等优先级的 `.account-auth` 规则覆盖。 | 使用明确的 `.account-page.account-auth` 作用域，输入及主按钮拥有 40/44 px 实际目标区；输入背景按桌面 38 / 手机 36 px、按钮按桌面 36 / 手机 32 px 绘制。输入字号仍为 16 px，保留焦点、错误、密码可见切换、校验和提交逻辑。 |
| `views/restoration-{denoise,motion,motion-advanced}.png` | 运动长度的“源像素”单位使该行轨道、数字框与其余参数错位；浏览器默认范围控件呈较粗的深色轨道。 | 统一数字/单位列宽为 104 px；原生 range 使用 3 px 轨道与 12 px 圆形柄，填色只根据当前真实数值计算。保留原生键盘、数值输入、禁用态、quote 与幂等提交逻辑；未改修复算法。 |

以上修正已通过 web 类型检查、31 项既有 i18n / modal-close / restoration 测试与 `git diff --check`。这只是本地代码验证，**修改后的视觉效果尚待下一轮真实截图确认**。没有新增测试替身、伪成功状态、供应商调用或后端契约修改。

## 逐张审阅范围

以下每个列出的文件都已实际打开；路径相对本轮截图根目录。

| 文件 | 观察 |
| --- | --- |
| `views/works.png` | 桌面两列真实素材已成立；发现子导航未加载样式。 |
| `views/collaborate.png` | 发现刷新后入场模糊/淡出的中间状态，已追到产品 CSS。 |
| `views/documents.png` | 文档列表、正文、唯一保存状态和操作分区清楚；未见重叠。 |
| `views/usage.png` | 钱包、存储、期间汇总和账本区可分辨；零用量仍显示真实空数据，没有伪趋势。 |
| `views/assistant-disabled.png` | 不可用状态只有一处主原因入口；编辑画布与浮窗没有互相覆盖。AI 业务由另一责任人维护，本轮未改。 |
| `views/restoration-denoise.png` | 原图完整、quote 回执与创建入口可见；范围控件需统一绘制。 |
| `views/restoration-motion.png` | 长度单位导致参数对齐差异；关闭按钮焦点环可见，未重叠。 |
| `views/restoration-motion-advanced.png` | 展开后迭代次数、同时降噪、页脚均在弹层内，未重叠；没有执行创建。 |
| `screens/library-zh-CN.png` | 两列顺序正确，中文清楚；子导航未加载样式。 |
| `screens/library-zh-TW.png` | 繁体标签没有缺字/挤压；同一子导航问题。 |
| `screens/library-en.png` | 英文桌面操作容纳完整；同一子导航问题。 |
| `screens/library-phone-zh-CN.png` | 首屏工具行冗长，需合排。 |
| `screens/library-phone-zh-TW.png` | 同一首屏问题，刷新长标签使工具更宽。 |
| `screens/library-phone-en.png` | 分类折两行，首图最靠下；明确需要独立手机布局。 |
| `screens/collaboration-zh-CN.png` | 最终正文和三个真实任务状态清晰、无重叠。 |
| `screens/collaboration-zh-TW.png` | 最终状态清晰，繁体时间与操作标签完整。 |
| `screens/collaboration-en.png` | 英文标签完整；用户填写的中文评论和任务原样保留。 |
| `screens/collaboration-phone-zh-CN.png` | 单列顺序合理，评论列表空占位过高。 |
| `screens/collaboration-phone-zh-TW.png` | 同一空占位问题；繁体控件可读。 |
| `screens/collaboration-phone-en.png` | 操作行折行加重首屏浪费；没有文字重叠。 |
| `screens/delivery-zh-CN.png` | 桌面导出弹窗的预览、格式、文件名和下载按钮完整。 |
| `screens/delivery-zh-TW.png` | 繁体弹窗无缺字、遮挡或不自然截断。 |
| `screens/delivery-en.png` | 较长英文格式说明可自然换行，三列仍对齐。 |
| `screens/delivery-phone-zh-CN.png` | 底部弹层在视口内，背景原图与弹层预览比例正确。 |
| `screens/delivery-phone-zh-TW.png` | 繁体手机格式和文件名完整。 |
| `screens/delivery-phone-en.png` | 英文说明换两行但下载入口完整，未溢出。 |
| `account/center.png` | 账号总览双列清楚、真实服务不可用状态未被伪造。 |
| `account/desktop-overview.png` | 导航选中态、身份与账号状态可辨。 |
| `account/desktop-security.png` | 绑定手机号、重置入口及短信不可用反馈分区清楚。 |
| `account/desktop-billing.png` | 真实余额和可用/预占明细对齐，未重叠。 |
| `account/desktop-data.png` | 导出不可用原因、草稿、退出和注销限制可辨。 |
| `account/desktop-zh-CN-login.png` | 登录页无重叠；确认旧 auth 字段尺寸覆盖。 |
| `account/phone-zh-CN-login.png` | 主按钮比桌面更高，需纠正覆盖。 |
| `account/small-phone-zh-CN-login.png` | 320 px 无横向裁切，全部登录操作仍可见；同一尺寸问题。 |
| `account/landscape-en-login.png` | 短横屏为自然纵向滚动，输入未遮挡；内容高度仍可压缩。 |
| `account/portrait-tablet-en-login.png` | 纵向平板表单未铺满整屏，英文标签完整。 |
| `account/tablet-zh-TW-login.png` | 繁体平板表单清楚，未见缺字。 |
| `account/reduced-desktop-en-login.png` | 减少动态的静态登录页完整，没有被入场样式留空。 |

登录图中洋红矩形是 QA 对密码输入的截图遮罩，不是产品颜色或缺失控件。

另逐张打开 `flows/` 下以下 14 个文件：七个场景各一张 `-export-dialog.png` 与 `-delivery.png`：

- `desktop-zh-CN`：桌面弹窗全部内容可见，下载回执不覆盖操作。
- `phone-zh-CN`：手机底部弹层及交付主操作完整，照片保持实际长宽比。
- `small-phone-zh-CN`：320 px 弹层仍完整；交付页自然滚动，没有横向溢出。
- `landscape-en`：短横屏弹层省去重复预览后保留格式/文件名/下载，未遮挡；交付内容可滚动。
- `tablet-zh-TW`：横向平板导出弹窗与交付的两列布局完整。
- `portrait-tablet-en`：纵向平板仍能并排容纳照片与交付操作，没有文字盖图。
- `reduced-desktop-en`：减少动态下导出与交付内容完整，通知清楚。

## 下一轮必须补看的范围

1. 重拍并人工查看上述修正后的素材、协作、登录、修复界面；不能用此次旧图替代最终证据。
2. 第一轮未执行的手机账号四页，以及桌面/手机运营十个 tab。
3. 本轮没有手机修复弹层、所有项目共享/导入/媒体弹层的完整状态截图，不能把 52 张目检扩大成“全部弹窗已覆盖”。

本轮截图采用隔离账号及真实本地照片/页面。它们不证明生产部署完成、所有 111 项后台功能五轮回归、原生 RAW/HDR/GPU 全路径或真实有偿 AI 已验收。
