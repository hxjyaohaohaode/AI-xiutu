# 工作台逐角色动效清单

当前通用注册表有 78 个逻辑角色，另保留编辑器 CSS 的 6 个专属角色。下面从 src/motion/registry.ts 当前值生成；三种设备档分别定义进入、退出、延迟、位移、缩放、模糊和交互时间，不按统一比例压缩桌面参数。每个逻辑角色可有多个 DOM 实例，不能将逻辑角色数称为每个 DOM 都有独特轨迹。

含照片/画布的祖先必须 pixelSafe，模糊为 0；角色的界面装饰模糊不参与图像渲染。拖动时取消时间动画和滤镜，坐标即时跟手。减少动态偏好取消位移、缩放、延迟与模糊。

## 三端完整参数

每格依次是轨迹、进入/退出/延迟、位移 X/Y、起始缩放、模糊、交互响应。

| 逻辑角色 | 桌面 | 平板 | 手机 | 像素安全 |
| --- | --- | --- | --- | --- |
| topbar | settle · 280/140/0ms · 0/-8px · 0.995× · blur 4px · 响应 110ms | settle · 265/130/0ms · 0/-6px · 0.995× · blur 3px · 响应 110ms | slide · 225/110/0ms · 0/-4px · 1× · blur 2px · 响应 70ms | 界面装饰 |
| brand | reveal · 320/130/24ms · 0/0px · 1× · blur 3px · 响应 120ms | reveal · 305/120/16ms · 0/0px · 1× · blur 2px · 响应 120ms | reveal · 265/100/0ms · 0/0px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| navigation | slide · 300/180/0ms · -20/0px · 1× · blur 5px · 响应 120ms | slide · 275/170/0ms · -20/0px · 1× · blur 4px · 响应 120ms | slide · 230/155/0ms · -10/0px · 1× · blur 3px · 响应 85ms | 界面装饰 |
| space-row | slide · 240/120/32ms · -9/0px · 1× · blur 3px · 响应 100ms | slide · 215/110/26ms · -9/0px · 1× · blur 2px · 响应 100ms | slide · 170/95/12ms · -4.5/0px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| project-row | slide · 220/100/46ms · -6/0px · 1× · blur 2px · 响应 100ms | slide · 195/90/40ms · -6/0px · 1× · blur 1px · 响应 100ms | slide · 150/90/12ms · -3/0px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| tool-dock | lift · 290/150/42ms · 0/12px · 0.98× · blur 4px · 响应 110ms | lift · 275/140/34ms · 0/9px · 0.98× · blur 3px · 响应 110ms | slide · 235/120/0ms · 0/6px · 1× · blur 2px · 响应 70ms | 界面装饰 |
| tool-item | settle · 230/110/12ms · 0/5px · 0.94× · blur 2px · 响应 90ms | settle · 215/100/4ms · 0/3.75px · 0.94× · blur 1px · 响应 90ms | reveal · 175/80/0ms · 0/2.5px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| panel-frame | settle · 250/160/0ms · 0/10px · 0.985× · blur 0px · 响应 0ms | settle · 240/150/0ms · 0/8px · 0.985× · blur 0px · 响应 0ms | slide · 210/145/0ms · 0/16px · 1× · blur 0px · 响应 0ms | 是 |
| panel-header | slide · 240/120/18ms · 6/0px · 1× · blur 3px · 响应 100ms | slide · 225/110/10ms · 6/0px · 1× · blur 2px · 响应 100ms | slide · 185/90/0ms · 3/0px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| panel-menu | scale · 180/120/0ms · 0/-3px · 0.95× · blur 3px · 响应 90ms | scale · 165/110/0ms · 0/-2.25px · 0.95× · blur 2px · 响应 90ms | slide · 125/90/0ms · 0/-1.5px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| inspector-header | slide · 260/130/20ms · 8/0px · 1× · blur 3px · 响应 100ms | slide · 235/120/14ms · 8/0px · 1× · blur 2px · 响应 100ms | slide · 190/105/12ms · 4/0px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| inspector-section | reveal · 300/160/36ms · 0/8px · 1× · blur 4px · 响应 120ms | reveal · 275/150/30ms · 0/6.4px · 1× · blur 3px · 响应 120ms | reveal · 230/135/12ms · 0/4px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| slider-row | slide · 235/110/15ms · 7/0px · 1× · blur 2px · 响应 75ms | slide · 215/110/5ms · 7/0px · 1× · blur 1px · 响应 85ms | slide · 170/90/8ms · 3.5/0px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| curve-controls | settle · 275/145/30ms · 0/7px · 0.98× · blur 3px · 响应 85ms | settle · 255/145/20ms · 0/7px · 0.98× · blur 2px · 响应 85ms | slide · 210/120/8ms · 0/4.2px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| color-picker | scale · 290/140/12ms · 0/5px · 0.97× · blur 5px · 响应 95ms | scale · 270/140/2ms · 0/5px · 0.97× · blur 4px · 响应 85ms | reveal · 225/115/8ms · 0/3px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| selection-controls | reveal · 310/150/18ms · 0/9px · 1× · blur 4px · 响应 100ms | reveal · 290/150/8ms · 0/9px · 1× · blur 3px · 响应 85ms | slide · 245/125/8ms · 0/5.4px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| canvas-toolbar | lift · 270/130/48ms · 0/7px · 0.98× · blur 3px · 响应 90ms | lift · 255/120/40ms · 0/5.25px · 0.98× · blur 2px · 响应 90ms | slide · 215/100/0ms · 0/3.5px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| ai-tabs | slide · 230/110/0ms · 0/-5px · 1× · blur 3px · 响应 85ms | slide · 215/100/0ms · 0/-3.75px · 1× · blur 2px · 响应 85ms | slide · 175/80/0ms · 0/-2.5px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| ai-status | reveal · 200/110/15ms · 0/4px · 1× · blur 2px · 响应 95ms | reveal · 185/100/7ms · 0/3px · 1× · blur 1px · 响应 95ms | slide · 145/80/0ms · 0/2px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| ai-context | slide · 240/130/30ms · 7/0px · 1× · blur 3px · 响应 100ms | slide · 225/120/22ms · 7/0px · 1× · blur 2px · 响应 100ms | slide · 185/100/0ms · 3.5/0px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| ai-user-message | slide · 280/150/0ms · 12/0px · 1× · blur 3px · 响应 120ms | slide · 255/140/0ms · 12/0px · 1× · blur 2px · 响应 120ms | slide · 210/125/0ms · 6/0px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| ai-answer | reveal · 360/180/24ms · 0/10px · 1× · blur 5px · 响应 130ms | reveal · 335/170/18ms · 0/8px · 1× · blur 4px · 响应 130ms | reveal · 290/155/12ms · 0/5px · 1× · blur 3px · 响应 85ms | 界面装饰 |
| ai-result-media | settle · 310/160/30ms · 0/8px · 0.99× · blur 0px · 响应 120ms | settle · 300/150/20ms · 0/6.4px · 0.99× · blur 0px · 响应 120ms | slide · 270/145/0ms · 0/5px · 1× · blur 0px · 响应 80ms | 是 |
| ai-composer | lift · 260/140/38ms · 0/9px · 1× · blur 3px · 响应 110ms | lift · 240/140/28ms · 0/9px · 1× · blur 2px · 响应 85ms | slide · 195/115/8ms · 0/5.4px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| ai-options | reveal · 290/150/0ms · 0/-7px · 0.995× · blur 4px · 响应 95ms | reveal · 270/150/0ms · 0/-7px · 0.995× · blur 3px · 响应 85ms | reveal · 225/125/0ms · 0/-4.2px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| ai-reference | settle · 245/125/20ms · 0/6px · 0.96× · blur 0px · 响应 100ms | settle · 235/115/10ms · 0/4.8px · 0.96× · blur 0px · 响应 100ms | slide · 205/110/0ms · 0/5px · 1× · blur 0px · 响应 80ms | 是 |
| voice-controls | scale · 330/180/15ms · 0/9px · 0.95× · blur 4px · 响应 120ms | scale · 310/180/5ms · 0/9px · 0.95× · blur 3px · 响应 85ms | reveal · 265/155/8ms · 0/5.4px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| voice-result | reveal · 300/160/26ms · 0/8px · 1× · blur 4px · 响应 100ms | reveal · 275/150/20ms · 0/6.4px · 1× · blur 3px · 响应 100ms | reveal · 230/135/12ms · 0/4px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| drawing-frame | settle · 280/170/0ms · 0/12px · 0.99× · blur 0px · 响应 0ms | settle · 270/160/0ms · 0/9.6px · 0.99× · blur 0px · 响应 0ms | slide · 240/155/0ms · 0/16px · 1× · blur 0px · 响应 0ms | 是 |
| drawing-tools | slide · 260/120/22ms · -8/0px · 1× · blur 3px · 响应 85ms | slide · 240/120/12ms · -8/0px · 1× · blur 2px · 响应 85ms | slide · 195/95/8ms · -4/0px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| drawing-colors | scale · 250/140/38ms · 0/5px · 0.97× · blur 4px · 响应 85ms | scale · 230/140/28ms · 0/5px · 0.97× · blur 3px · 响应 85ms | slide · 185/115/8ms · 0/3px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| auth-fields | slide · 280/150/30ms · 0/9px · 1× · blur 4px · 响应 110ms | slide · 255/140/24ms · 0/7.2px · 1× · blur 3px · 响应 110ms | reveal · 210/125/12ms · 0/4.5px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| auth-tabs | settle · 235/130/16ms · 0/5px · 0.98× · blur 3px · 响应 90ms | settle · 215/130/6ms · 0/5px · 0.98× · blur 2px · 响应 85ms | slide · 170/105/8ms · 0/3px · 1× · blur 2px · 响应 65ms | 界面装饰 |
| view-header | slide · 280/140/0ms · 0/-7px · 1× · blur 4px · 响应 120ms | slide · 255/130/0ms · 0/-5.6px · 1× · blur 3px · 响应 120ms | reveal · 210/115/0ms · 0/-3.5px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| artwork-meta | lift · 300/160/18ms · 0/9px · 1× · blur 3px · 响应 110ms | lift · 275/150/12ms · 0/7.2px · 1× · blur 2px · 响应 110ms | reveal · 230/135/12ms · 0/4.5px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| artwork-media | settle · 320/170/0ms · 0/8px · 0.99× · blur 0px · 响应 110ms | settle · 310/160/0ms · 0/6.4px · 0.99× · blur 0px · 响应 110ms | slide · 280/155/0ms · 0/5px · 1× · blur 0px · 响应 80ms | 是 |
| discussion | reveal · 320/170/15ms · 0/12px · 1× · blur 4px · 响应 110ms | reveal · 295/160/9ms · 0/9.6px · 1× · blur 3px · 响应 110ms | reveal · 250/145/12ms · 0/6px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| comment | slide · 270/140/18ms · -9/0px · 1× · blur 3px · 响应 100ms | slide · 245/130/12ms · -9/0px · 1× · blur 2px · 响应 100ms | slide · 200/115/12ms · -4.5/0px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| task-item | slide · 240/125/12ms · 8/0px · 1× · blur 2px · 响应 90ms | slide · 215/115/6ms · 8/0px · 1× · blur 1px · 响应 90ms | slide · 170/100/12ms · 4/0px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| document-list | slide · 285/155/8ms · -10/0px · 1× · blur 4px · 响应 110ms | slide · 260/145/2ms · -10/0px · 1× · blur 3px · 响应 110ms | slide · 215/130/8ms · -5/0px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| document-editor | reveal · 340/170/32ms · 0/10px · 1× · blur 4px · 响应 110ms | reveal · 315/160/26ms · 0/8px · 1× · blur 3px · 响应 110ms | reveal · 270/145/12ms · 0/5px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| delivery | lift · 315/165/20ms · 0/13px · 0.99× · blur 4px · 响应 120ms | lift · 290/155/14ms · 0/10.4px · 0.99× · blur 3px · 响应 120ms | reveal · 245/140/12ms · 0/6.5px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| ops-navigation | slide · 275/145/0ms · -12/0px · 1× · blur 4px · 响应 100ms | slide · 250/135/0ms · -12/0px · 1× · blur 3px · 响应 100ms | slide · 205/120/0ms · -6/0px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| ops-content | reveal · 325/175/24ms · 0/9px · 1× · blur 4px · 响应 120ms | reveal · 300/165/18ms · 0/7.2px · 1× · blur 3px · 响应 120ms | reveal · 255/150/12ms · 0/4.5px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| ops-row | slide · 225/115/16ms · 6/0px · 1× · blur 2px · 响应 90ms | slide · 200/105/10ms · 6/0px · 1× · blur 1px · 响应 90ms | slide · 155/90/12ms · 3/0px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| quota | scale · 320/170/18ms · 0/6px · 0.98× · blur 4px · 响应 110ms | scale · 295/160/12ms · 0/4.8px · 0.98× · blur 3px · 响应 110ms | reveal · 250/145/12ms · 0/3px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| modal-frame | settle · 270/170/0ms · 0/12px · 0.985× · blur 0px · 响应 100ms | settle · 260/160/0ms · 0/9.6px · 0.985× · blur 0px · 响应 100ms | slide · 230/155/0ms · 0/16px · 1× · blur 0px · 响应 80ms | 是 |
| modal-header | reveal · 285/140/18ms · 0/-7px · 1× · blur 4px · 响应 110ms | reveal · 260/130/12ms · 0/-5.6px · 1× · blur 3px · 响应 110ms | reveal · 215/115/12ms · 0/-3.5px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| modal-content | reveal · 300/150/32ms · 0/8px · 1× · blur 4px · 响应 110ms | reveal · 275/140/26ms · 0/6.4px · 1× · blur 3px · 响应 110ms | reveal · 230/125/12ms · 0/4px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| popover | scale · 205/120/0ms · 0/-4px · 0.95× · blur 4px · 响应 95ms | scale · 180/110/0ms · 0/-3.2px · 0.95× · blur 3px · 响应 95ms | reveal · 135/95/0ms · 0/-2px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| empty-state | reveal · 400/190/40ms · 0/15px · 1× · blur 6px · 响应 120ms | reveal · 375/180/34ms · 0/12px · 1× · blur 5px · 响应 120ms | reveal · 330/165/12ms · 0/7.5px · 1× · blur 3px · 响应 85ms | 界面装饰 |
| notice | slide · 240/150/0ms · 0/-8px · 1× · blur 3px · 响应 100ms | slide · 215/140/0ms · 0/-6.4px · 1× · blur 2px · 响应 100ms | reveal · 170/125/0ms · 0/-4px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| inline-error | settle · 210/120/0ms · 0/4px · 0.99× · blur 2px · 响应 95ms | settle · 185/110/0ms · 0/3.2px · 0.99× · blur 1px · 响应 95ms | reveal · 140/95/0ms · 0/2px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| capability | reveal · 260/140/12ms · 0/5px · 1× · blur 3px · 响应 105ms | reveal · 235/130/6ms · 0/4px · 1× · blur 2px · 响应 105ms | reveal · 190/115/12ms · 0/2.5px · 1× · blur 2px · 响应 85ms | 界面装饰 |
| panel-body | reveal · 225/130/14ms · 0/5px · 1× · blur 0px · 响应 90ms | reveal · 205/120/10ms · 0/4px · 1× · blur 0px · 响应 85ms | slide · 185/110/6ms · 0/3px · 1× · blur 0px · 响应 70ms | 是 |
| panel-actions | slide · 165/90/6ms · 4/0px · 1× · blur 1px · 响应 75ms | slide · 155/85/4ms · 3/0px · 1× · blur 1px · 响应 70ms | reveal · 145/80/0ms · 0/2px · 1× · blur 1px · 响应 65ms | 界面装饰 |
| panel-docking | slide · 205/110/12ms · -5/0px · 1× · blur 2px · 响应 90ms | slide · 190/100/8ms · -4/0px · 1× · blur 1px · 响应 85ms | reveal · 170/95/4ms · 0/2.5px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| panel-sizing | lift · 255/135/24ms · 0/7px · 0.99× · blur 2px · 响应 95ms | lift · 235/125/18ms · 0/5px · 0.995× · blur 2px · 响应 85ms | slide · 205/110/10ms · 0/4px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| panel-composition | settle · 235/125/32ms · 0/5px · 0.995× · blur 2px · 响应 95ms | settle · 220/115/22ms · 0/4px · 0.995× · blur 1px · 响应 85ms | reveal · 190/105/12ms · 2/0px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| result-actions | slide · 215/105/28ms · 0/5px · 1× · blur 2px · 响应 85ms | reveal · 205/100/18ms · 0/4px · 1× · blur 1px · 响应 80ms | slide · 175/95/8ms · 0/3px · 1× · blur 1px · 响应 65ms | 界面装饰 |
| result-provenance | reveal · 245/115/36ms · 3/0px · 1× · blur 2px · 响应 90ms | reveal · 225/105/24ms · 2/0px · 1× · blur 1px · 响应 80ms | settle · 195/100/10ms · 0/3px · 0.998× · blur 1px · 响应 70ms | 界面装饰 |
| result-confirmation | settle · 285/145/30ms · 0/9px · 0.993× · blur 3px · 响应 100ms | lift · 255/130/20ms · 0/8px · 0.995× · blur 2px · 响应 90ms | slide · 220/115/12ms · 0/6px · 1× · blur 1px · 响应 75ms | 界面装饰 |
| revision-entry | slide · 260/110/18ms · -5/0px · 1× · blur 2px · 响应 90ms | settle · 240/105/14ms · 0/4px · 0.997× · blur 1px · 响应 85ms | reveal · 200/95/6ms · 0/3px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| revision-restore | lift · 290/150/26ms · 0/7px · 0.99× · blur 3px · 响应 105ms | settle · 260/135/18ms · 0/6px · 0.995× · blur 2px · 响应 95ms | slide · 225/115/8ms · 0/5px · 1× · blur 1px · 响应 75ms | 界面装饰 |
| parameter-options | settle · 245/110/18ms · 0/4px · 0.996× · blur 2px · 响应 85ms | slide · 225/105/12ms · 0/3px · 1× · blur 1px · 响应 80ms | reveal · 185/90/4ms · 0/2px · 1× · blur 1px · 响应 65ms | 界面装饰 |
| parameter-current | slide · 205/95/12ms · 4/0px · 1× · blur 2px · 响应 75ms | reveal · 195/95/8ms · 2/0px · 1× · blur 1px · 响应 70ms | settle · 170/85/0ms · 0/2px · 0.999× · blur 1px · 响应 60ms | 界面装饰 |
| scope-selector | reveal · 220/110/14ms · -3/0px · 1× · blur 2px · 响应 85ms | slide · 210/100/8ms · -2/0px · 1× · blur 1px · 响应 80ms | reveal · 180/90/0ms · 0/3px · 1× · blur 1px · 响应 65ms | 界面装饰 |
| mask-editor | slide · 260/120/24ms · 0/5px · 1× · blur 0px · 响应 90ms | settle · 245/110/16ms · 0/4px · 1× · blur 0px · 响应 85ms | slide · 205/100/6ms · 0/3px · 1× · blur 0px · 响应 70ms | 是 |
| color-family | reveal · 255/115/20ms · 0/3px · 1× · blur 0px · 响应 85ms | slide · 235/110/12ms · 2/0px · 1× · blur 0px · 响应 80ms | reveal · 195/95/4ms · 0/2px · 1× · blur 0px · 响应 65ms | 是 |
| geometry-controls | settle · 280/125/22ms · 0/6px · 0.996× · blur 2px · 响应 95ms | slide · 255/115/16ms · 0/5px · 1× · blur 1px · 响应 85ms | reveal · 205/105/8ms · 0/3px · 1× · blur 1px · 响应 75ms | 界面装饰 |
| region-controls | slide · 270/125/26ms · 4/0px · 1× · blur 0px · 响应 95ms | reveal · 245/115/18ms · 2/0px · 1× · blur 0px · 响应 85ms | slide · 200/100/8ms · 0/4px · 1× · blur 0px · 响应 70ms | 是 |
| paint-controls | reveal · 265/120/28ms · 0/4px · 1× · blur 0px · 响应 90ms | settle · 250/115/18ms · 0/3px · 1× · blur 0px · 响应 85ms | reveal · 210/100/6ms · 0/2px · 1× · blur 0px · 响应 70ms | 是 |
| warp-controls | settle · 275/130/24ms · -3/3px · 0.997× · blur 2px · 响应 100ms | slide · 250/120/14ms · -2/2px · 1× · blur 1px · 响应 90ms | reveal · 210/105/6ms · 0/3px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| composite-controls | slide · 285/125/30ms · 5/0px · 1× · blur 0px · 响应 95ms | settle · 260/115/20ms · 3/0px · 1× · blur 0px · 响应 85ms | slide · 215/100/8ms · 0/4px · 1× · blur 0px · 响应 75ms | 是 |
| portrait-controls | reveal · 295/135/24ms · 0/5px · 1× · blur 0px · 响应 100ms | settle · 270/125/18ms · 0/4px · 1× · blur 0px · 响应 90ms | reveal · 225/110/8ms · 0/3px · 1× · blur 0px · 响应 75ms | 是 |
| portrait-manual | slide · 240/110/35ms · 0/5px · 1× · blur 2px · 响应 90ms | reveal · 220/105/22ms · 0/4px · 1× · blur 1px · 响应 80ms | slide · 180/90/10ms · 0/3px · 1× · blur 1px · 响应 65ms | 界面装饰 |
| advanced-history | reveal · 250/120/18ms · -4/0px · 1× · blur 2px · 响应 90ms | slide · 230/110/12ms · -3/0px · 1× · blur 1px · 响应 85ms | reveal · 195/95/4ms · 0/3px · 1× · blur 1px · 响应 70ms | 界面装饰 |
| ai-cancellation | reveal · 215/105/8ms · -3/2px · 1× · blur 1.5px · 响应 85ms | slide · 195/100/6ms · -2/1px · 1× · blur 1px · 响应 75ms | reveal · 175/85/0ms · 0/2px · 1× · blur 0.5px · 响应 65ms | 界面装饰 |

## 新交互的状态边界

- panel-body / panel-actions / panel-docking / panel-sizing / panel-composition 分别承担内容、动作、停靠、连续宽高和叠放关系。内容关闭立即 inert / aria-hidden，退出完成再隐藏；尺寸与拖动不用延迟动画追赶指针。最大化/折叠保留普通尺寸以还原。
- parameter-options / parameter-current / scope-selector 区分参数选择、当前滑条和全图/局部/组作用范围；更换参数显露新的当前控件，已有图像像素不被淡入模糊。
- mask-editor / color-family / geometry-controls / region-controls / paint-controls / warp-controls / composite-controls / portrait-controls / portrait-manual / advanced-history 分别定义自己的三端参数；颜色、蒙版和画笔外层保持零模糊。
- result-actions / result-provenance / result-confirmation / revision-entry / revision-restore 区分结果决定、来源记录、确认和历史恢复。成功动画只在服务器明确返回后出现，不等同于重新调用模型或退款。
- usePresence 管理的浮层、Modal、Disclosure 使用 enter → idle → exit → hidden。原生 details 或直接卸载没有保留退出状态时，不声称执行完整退出轨迹。
- 支持 --motion-index 的错开封顶，但未设置该索引的实例仍使用自身角色延迟，不虚报逐项交错。
- ai-cancellation 为排队取消的请求、错误与服务器确认状态定义独立三端轨迹；收到未知结果不出现退款成功动画。
- 每种真实录音、排队、未知结果、模型错误与空状态使用实际数据；不以持续动画或伪百分比假装工作已完成。

## 验证责任

注册表与 CSS 轨迹存在性、减少动态逃生路径、图像外层零模糊由 apps/web/test/motion.test.ts 校验。真实桌面/平板/窄手机/短横屏、键盘、触控、缩放和动态偏好由 [本轮六轮验证记录](../../docs/VERIFICATION.md) 给出结果。此文档不替代截图和实际操作，旧轮数不沿用作新增功能证据。

## 编辑器专属角色

这6个角色的实际CSS位于 src/editor/editor-controls.css，不向通用注册表重复添加。它们沿用6个独立命名的keyframe，各自通过CSS变量指定进入/退出时长、延迟、位移、双轴缩放和blur；绑定对象都是控件、统计图或文字提示，不是照片及照片祖先。角色在带退出状态的父容器中按自己的时长反向退出；未提供保留状态的直接卸载不假称执行了退出动画。

这6个控件采用的视口宽度分档为：桌面默认，平板600–959px，手机≤599px；高度≤500px且横屏时采用短横屏覆盖。它们与工作台布局的760/1120px分档分别定义。减少动态偏好取消这些动画；活动拖动仍由全局手势规则立即去除动画和模糊。

下表每格依次为：**进入/退出/延迟 ms；blur px；位移x/y px；缩放x/y**。

| 专属角色         | 桌面                        | 平板                          | 手机                           | 短横屏                       |
| ---------------- | --------------------------- | ----------------------------- | ------------------------------ | ---------------------------- |
| histogram        | 245/135/20；1.5；0/0；1/.93 | 220/125/12；1.2；0/1；1/.95   | 180/105/5；.9；0/1；1/.97      | 150/90/0；.6；0/0；1/.98     |
| crop-transforms  | 220/120/25；2；-4/3；1/1    | 205/115/18；1.6；-3/2；.995/1 | 170/100/10；1.2；-2/2；1/1     | 145/85/4；.8；-1/1；1/1      |
| canvas-file-info | 210/110/35；2.5；0/-3；1/1  | 195/105/20；1.8；0/-2；1/1    | 165/95/5；1.4；0/-1.5；1/1     | 135/80/0；.8；0/-1；1/1      |
| selection-hint   | 230/135/80；3；0/4；1/1     | 215/125/50；2.1；0/3；1/1     | 190/110/35；1.7；0/2.5；.995/1 | 155/95/15；1.2；0/1.5；1/1   |
| crop-hint        | 280/145/60；2；0/-4；1/1    | 240/130/40；1.5；0/-3；.995/1 | 200/115/20；1.1；0/-2；1/1     | 165/100/10；.9；0/-1.5；1/1  |
| sample-hint      | 180/95/5；1；0/0；.97/.97   | 170/90/4；.8；0/1；.98/.98    | 150/80/0；.6；0/1；.99/.99     | 125/75/0；.5；0/0；.995/.995 |

这些参数描述源码行为，不是所有浏览器、低端手机或每个DOM实例均已经实测的结论。
