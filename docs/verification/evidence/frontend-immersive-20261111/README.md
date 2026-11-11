# About 实际浏览器证据

本目录的三张 PNG 来自 PR #6 的原生 Chromium 验收，保留浏览器原始像素，没有重新排版、补画控件或修改图像内容。

| 文件                                               | 实际观察                                         |
| -------------------------------------------------- | ------------------------------------------------ |
| [about-hero-zh-CN.png](about-hero-zh-CN.png)       | 首页首屏、指针笔触，以及页面中的真实工作台画面。 |
| [about-gallery-zh-CN.png](about-gallery-zh-CN.png) | 三张可继续编辑的生成练习照片及其独立入口。       |
| [about-devices-zh-CN.png](about-devices-zh-CN.png) | 手机与桌面实际界面的组合展示。                   |

三张截图均为 **1440 × 960**。它们对应 PR head `794d3fb0b35a66a46bd1d89c741f9a942edadcf5`；GitHub 实际检出的 PR 合并检查提交为 `d27b463b93b8824dfe702f2ba1544e887feaf630`，两者 Git tree 同为 `b8a4161298f0e47e99b0984a370f9709c73aeea6`。截图还保留这一阶段 About 的双环默认标记；后续收尾修正将它统一为工作台和账号页已有的映间标志，因此这些图片不作为该标志修正的视觉证明。

原始证据来自 [Account no-preference job](https://github.com/hxjyaohaohaode/AI-xiutu/actions/runs/42972099377/job/130362702887) 的 artifact `13833464690`。下载 ZIP 的 SHA-256 与 GitHub 元数据一致：`104894730f95aa9575177f108949ec4efc063477a227d3cc05d1753d06ad2400`。完整 ZIP 与报告保留在本地忽略的 `artifacts/verification/frontend-immersive-20261111/`，避免将所有认证截图及重复图像加入仓库。

工作台本身的三语实拍直接位于 [public/about](../../../../apps/web/public/about/README.md)。本目录展示的是 About 页的浏览器渲染；生成练习照片与真实界面截图的来源在页面和资产说明中分别标注。
