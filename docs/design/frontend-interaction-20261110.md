# 前端交互重构 · 2026-11-10

## 用户指定参考

以下八个网址来自本次会话读取的用户已打开标签页。它们是交互与视觉参考，不构成源码复用许可。

- [Recent](https://recent.design/)
- [Awwwards](https://www.awwwards.com/)
- [Siteinspire](https://www.siteinspire.com/)
- [Minimal Gallery](https://minimal.gallery/)
- [Land-book](https://land-book.com/)
- [Lapa Ninja](https://www.lapa.ninja/)
- [Mobbin](https://mobbin.com/discover/apps/ios/latest)
- [Refero](https://refero.design/search)

## 本轮目标

- 手机优先的画布、上下文面板与 AI composer，避免多层工具同时占据首屏。
- 全局浅色/深色语义色，覆盖页面、弹层、原生控件、状态和悬浮区域。
- 按操作语义重新组织 SVG、文字与容器比例；删除空泛标语。
- 输入即时反馈；进入、退出、展开、切换具有可中断的位移和透明度变化，保留减少动态偏好。
- 最新接口能力映射，保留请求身份、权限、不可变版本、草稿和计费恢复语义。
- 各状态在桌面、平板、窄手机、短横屏实际浏览器检查，完成 GitHub 验证后合并主线。

## 参考观察（实施前）

| 参考 | 本轮实际查看范围 | 采用方向 |
| --- | --- | --- |
| Recent | 独立浏览器首页、Interface筛选、排序入口、页面动效案例卡 | 照片优先、轻量分类、状态转场；不复制营销侧栏或播放失败的媒体 |
| Minimal Gallery | 独立浏览器深色首页与打开后的搜索浮层 | 统一暗色层级、输入与单一操作同排、聚焦搜索、轻量chips |
| Refero | 独立浏览器搜索结果、范围/模式按钮和画布工具案例 | 输入优先、范围摘要、工具随内容出现；不复制登录或付费限制内内容 |
| Land-book | 独立浏览器首页、Mobile/Motion等分类、紧凑搜索 | 类型与动作分开、统一图形比例、逐级展示筛选 |
| Lapa Ninja | 独立浏览器首页、导航与Motion入口 | 参考字重层级与分类；页面广告、巨型营销标题不适合编辑工作台 |
| Siteinspire | 独立浏览器首页与筛选收起 | 通过字号、留白和轻分区表达层级；筛选按需展开 |
| Awwwards | 独立浏览器首页与关闭cookie层后的内容 | 主次对比、紧凑悬浮导航；不照搬巨幅展示标题 |
| Mobbin | 独立浏览器返回403；随后在用户原有 Edge 标签中看到 iOS 应用分类、Latest筛选、手机画面卡片 | 手机内容优先、进度与筛选按需展示；未查看付费范围内素材 |

后续实施、截图与验证记录在完成后补充。当前仅记录本轮已观察的参考与目标。

