# 系统重设计：111项前端逐项核对

核对日期：2026-11-12（UTC）。文件名沿用本轮 `20261111` 重设计批次。

## 快照、范围与读法

需求来源固定为 [new/native-color-feedback@fc2827c](https://github.com/hxjyaohaohaode/AI-xiutu/commit/fc2827c05c137588511c94e4431b523f2d3bab87) 的 [AI修图功能对照与验收主表](https://github.com/hxjyaohaohaode/AI-xiutu/blob/fc2827c05c137588511c94e4431b523f2d3bab87/docs/research/PHOTO-EDITING-FEATURE-MATRIX.md)，文件blob为 `09d821e4ba685e6ef79417dd28885752a98a900c`。本文件没有修改canonical表。

前端核对以 `8811b4f769088f6e3729b4f26bc3677c68a57297` 为初始重设计检查点，包含随后AI结果/文案/弹窗样式的5项补丁，以及 `383d067` 合入的最新后端与常规模型CAS接线。F07母版曲线/区域和S09/S10独立修复派生在该检查点尚缺完整前端入口；本轮已将其明确列为接线工作，后续合入时应更新对应行的源码记录。

本轮范围是前端信息结构、交互、组件大小、状态、真实图像展示及已有后端能力的接线。没有承诺在前端任务中填满缺失的算法。主表原证据状态逐行原样保留，包括括号内的限定范围：**15项已验、85项部分、11项缺口**。这里的“已验”是canonical既有证据，绝不代表本轮UI、当前设备或新提交已重新通过。

本表的111个ID与名称来自canonical逐行读取；旧R5的44项只可写为 `FE-R5-<旧编号>`，不能用旧R5的R/A/C编号替代当前同名ID。用户现在要求About自然滚动读取全部内容，覆盖旧FE-R5中需要多次点击才能看到完整介绍的交互要求。

“本轮处理”说明实际源码变动或保留的范围；“门禁与待验”列出具体约束与尚无本轮证据的交互。**本文件生成时，本轮CI与新布局真实浏览器验收待运行。** 旧浏览器/性能/SQL结果不会因换UI自动升级。

## 本轮查出的两类接线问题

1. **C13常规模型保存契约已更新。** 当前后端要求 `expectedVersion`；新建为0，编辑现有模型使用读到的版本。已把 `version/baseId`、保存回执更新版本、`MODEL_CONFIG_CHANGED` 后读取目录并保留草稿合入重设计表单，并与最新后端一起保存到 `383d067`。这与已有助手模型的 `expectedHash` 是两种不同契约。
2. **F07和独立photo-restore-v1不能由相似控件冒充。** 8811母版查看器只有七项全局参数；SDR CurveEditor/LocalControls不是native高位深曲线/区域的接线。S09已有本地optics降噪控件，但独立修复派生接口、尤其S10运动核参数没有前端动作。两项本轮都应以真实能力和真实派生结果补接，不增加虚构算法或假进度。

## 逐项核对

### 渲染与编辑工作流

| ID | 功能（原名） | 原证据状态 | 当前前端入口与源码 | 本轮处理 / 明确未补项 | 能力门禁与具体待验 |
| --- | --- | --- | --- | --- | --- |
| R01 | 拖动时原尺寸清晰 | 部分 | 编辑→明暗/色彩；[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx)、[PrecisionRange.tsx](../../apps/web/src/editor/PrecisionRange.tsx)、[previewBudget.ts](../../apps/web/src/editor/previewBudget.ts) | 重做参数选择与调节位置；连续输入仍调用原有预览链路，未替换渲染内核。 | 按原图/设备预算执行；须重测持按首变化、最长帧间隔、1:1细节，旧性能成绩不自动覆盖新UI。 |
| R02 | 超预算大图与 1:1 瓦片 | 部分 | 原件与母版→1:1；[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx)、[tile-layout.ts](../../apps/web/src/media/tile-layout.ts) | 保留平移、缩放、瓦片及原件入口；本轮未新增超预算渲染算法。 | 由媒体descriptor/tiles及maxPixels决定；重测跨瓦片接缝、宽窗、弱网与移动真机内存。 |
| R03 | 即时取消、撤销与重做 | 已验（浏览器基础路径） | 编辑确认/取消/历史；[useEditor.ts](../../apps/web/src/editor/useEditor.ts)、[HistoryPanel.tsx](../../apps/web/src/editor/HistoryPanel.tsx)、[CandidateActions.tsx](../../apps/web/src/ai/CandidateActions.tsx) | 暴露hasUncommittedPreview；AI候选旁新增确认/取消，并允许取消后再次预览。裁切撤销同步释放失效比例。 | 沿用协作editor封装与候选基线校验；待逐工具Esc、失焦、pointercancel、一次手势一条历史回归。 |
| R04 | 局部回退与重编辑栈 | 部分 | 历史/图层；[HistoryPanel.tsx](../../apps/web/src/editor/HistoryPanel.tsx)、[LayerControls.tsx](../../apps/web/src/editor/LayerControls.tsx) | 保留配方版本重开及现有图层排序；没有新增任意效果节点重排。 | 现有处理阶段保持固定顺序；局部退回、可启停节点及换序一致性仍是原主表差距。 |
| R05 | 原图、当前、版本与局部对比 | 已验（常规浏览器路径） | 作品→对比；[WorkspaceViews.tsx](../../apps/web/src/components/WorkspaceViews.tsx) 的 CompareView、[ImagePreview.tsx](../../apps/web/src/components/ImagePreview.tsx) | 同尺寸原图与实际渲染结果改用可拖动分界；尺寸不匹配保留并排。 | 分界采用原生range，图片共享适配矩形；待鼠标/触摸/键盘、裁切后模式切换及母版多版本同视口验证。 |
| R06 | 工具返回、键鼠和窄屏触控 | 部分 | 工具栏/浮动与停靠面板；[panelGeometry.ts](../../apps/web/src/workspace/panelGeometry.ts)、[useWorkspaceLayout.ts](../../apps/web/src/workspace/useWorkspaceLayout.ts)、[ParameterShelf.tsx](../../apps/web/src/editor/ParameterShelf.tsx) | 重建图形参数入口和单个活动控件；提高面板可操作最小高度，修复旧112px偏好恢复后控件被挤掉。 | 320px、390px、平板、短横屏必须可达且不重叠；返回/关闭/切工具保持草稿和视口，待真实设备验收。 |
| R07 | 导入失败、离线草稿、Worker 恢复 | 部分 | 本地导入/草稿/重试；[source-flow.ts](../../apps/web/src/editor/source-flow.ts)、[workerLifecycle.ts](../../apps/web/src/editor/workerLifecycle.ts)、[MediaImportDialog.tsx](../../apps/web/src/components/MediaImportDialog.tsx) | 保留原图更换和异步请求归属保护，错误以状态呈现；没有用宣传说明代替恢复路径。 | 无网、Worker崩溃、解码失败、保存响应丢失须分别复测最后确认稿与可重试入口。 |
| R08 | 批量套参数、批量渲染和部分失败 | 部分 | 配方/单项派生；[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx)、[RevisionTools.tsx](../../apps/web/src/components/RevisionTools.tsx)、[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) | 保留现有单图配方、派生、导出；本轮没有补50图统一队列。 | 逐项进度、仅重跑失败项、命名与总账单预算仍缺，不能将素材多选视为批量编辑完成。 |
| R09 | 首次进入、懒加载与设备预算 | 部分 | 首次作品页/按需功能；[StudioWelcome.tsx](../../apps/web/src/workspace/StudioWelcome.tsx)、[DeferredFeature.tsx](../../apps/web/src/components/DeferredFeature.tsx)、[AIPanelFeature.tsx](../../apps/web/src/components/AIPanelFeature.tsx) | 简化首次入口和页面说明；保持功能懒加载及真实加载骨架。 | 未测新首屏包体、冷缓存与4GB真机；ONNX/解码器预算沿用已有能力声明。 |
### 色彩与局部

| ID | 功能（原名） | 原证据状态 | 当前前端入口与源码 | 本轮处理 / 明确未补项 | 能力门禁与具体待验 |
| --- | --- | --- | --- | --- | --- |
| T01 | 曝光、亮度、光感、对比、白黑、高光阴影 | 已验（SDR 曝光） | 编辑→明暗；[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx)、[ParameterShelf.tsx](../../apps/web/src/editor/ParameterShelf.tsx)、[PrecisionRange.tsx](../../apps/web/src/editor/PrecisionRange.tsx) | 曝光等改用统一图形选择、数值和活动滑条；保留正负范围、步长、中性值与重置。 | SDR与母版入口分开；负/零/正、透明边、撤销像素及窄屏持按待重新验证。 |
| T02 | 白平衡与色偏校正 | 部分 | 编辑→色彩；[ColorControls.tsx](../../apps/web/src/editor/ColorControls.tsx)、[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx) | 保留色温、色调和现有取色；仅重做控件展示，未增加RAW灰点或自动混光修正。 | 手工值不得因切页丢失；灰卡、肤色及噪声结果继续按原表验收。 |
| T03 | 主曲线、RGB 通道、单通道重置 | 已验（SDR 持按） | 编辑→曲线；[CurveEditor.tsx](../../apps/web/src/editor/CurveEditor.tsx)、[AdvancedInspector.tsx](../../apps/web/src/editor/AdvancedInspector.tsx) | 保留SDR通道节点和scope；在重做的面板中显示，未宣称母版曲线等同SDR曲线。 | 逐通道键盘/拖点/重置只影响当前通道；母版曲线另见F07，须单独能力门禁与输出验证。 |
| T04 | HSL、选色与多色区 | 部分 | 编辑→色彩/HSL；[ColorControls.tsx](../../apps/web/src/editor/ColorControls.tsx)、[ParameterShelf.tsx](../../apps/web/src/editor/ParameterShelf.tsx) | 统一色区参数入口和精确数值布局；源色查表与组合渲染未改。 | 其余色区、局部HSL和肤色边界仍需实拍；旧Canon/Nikon持按证据只保留原范围。 |
| T05 | 饱和度、自然饱和、黑白与色调分离 | 部分 | 编辑→色彩/分级；[ColorControls.tsx](../../apps/web/src/editor/ColorControls.tsx)、[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx) | 饱和度、自然饱和与已有分区分级使用同一活动控件布局。 | 未补通道黑白混合或自动肤色联动；验证调零、重开、跨区互不污染。 |
| T06 | 细节、锐化、清晰度、纹理、去灰 | 部分 | 编辑→细节/局部质感；[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx)、[LocalControls.tsx](../../apps/web/src/editor/LocalControls.tsx) | 压缩重复说明并统一精调大小；保留现有锐化、清晰度等算子。 | 自动去雾和专用超分不因入口合并算完成；需发丝、文字、噪声和光晕专项结果。 |
| T07 | 滤镜、配方、收藏及胶片效果 | 部分 | 编辑→滤镜/配方；[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx)、[RevisionTools.tsx](../../apps/web/src/components/RevisionTools.tsx) | 保留基础预设和配方保存/复用；没有新增LUT导入或胶片算法。 | 预设强度、收藏、跨图重开仍待端到端；LUT工作空间及版本缺项保持。 |
| T08 | 一键出片、风格迁移和个人偏好 | 部分 | AI助手→调整候选；[LiveAssistant.tsx](../../apps/web/src/ai/LiveAssistant.tsx)、[WorkspaceCards.tsx](../../apps/web/src/ai/WorkspaceCards.tsx) | 候选动作集中在结果旁，取消后可重新预览；仍以实际配方和测量结果呈现。 | 没有训练个人风格或自动多模型盲评；任何模型执行由用户请求/既有授权触发。 |
| T09 | 多个局部独立调、命名、分组和复用 | 部分 | 编辑→局部/区域组；[LocalControls.tsx](../../apps/web/src/editor/LocalControls.tsx)、[MaskControls.tsx](../../apps/web/src/editor/MaskControls.tsx)、[AdvancedInspector.tsx](../../apps/web/src/editor/AdvancedInspector.tsx) | 重做活动参数展示，保留每工具scope、区域和组选择；未改区域求解。 | 源坐标、区域/组数量与配方预算继续有效；五局部两组的重叠、复制、保存并发待验。 |
| T10 | 手绘、线性/径向、范围及布尔蒙版 | 部分 | 编辑→局部蒙版；[MaskControls.tsx](../../apps/web/src/editor/MaskControls.tsx)、[selection-transform.ts](../../apps/web/src/editor/selection-transform.ts) | 保留手绘、渐变、范围、布尔与保护入口，控件使用新的参数排布。 | 跨裁切/透视/液化仍以源坐标重放；任意物体自动分割未新增，见S01。 |
| T11 | 直方图、裁切报警、数值输入与重置 | 部分 | 编辑→直方图/精确输入；[Histogram.tsx](../../apps/web/src/editor/Histogram.tsx)、[PrecisionRange.tsx](../../apps/web/src/editor/PrecisionRange.tsx) | 精确输入和重置随活动参数可见；中性值按注册值判断，不猜裁切/画笔默认值。 | 场景线性波形、软打样与通道裁切报警未补；键盘输入、边界、重置范围待验。 |
### 构图与变形

| ID | 功能（原名） | 原证据状态 | 当前前端入口与源码 | 本轮处理 / 明确未补项 | 能力门禁与具体待验 |
| --- | --- | --- | --- | --- | --- |
| G01 | 自由裁切、比例、旋转和翻转 | 已验（常规几何） | 编辑→构图；[GeometryControls.tsx](../../apps/web/src/editor/GeometryControls.tsx)、[precision.ts](../../apps/web/src/editor/precision.ts)、[useEditor.ts](../../apps/web/src/editor/useEditor.ts) | 重建比例和几何参数布局；撤销后根据实际几何清除不再成立的比例预设。 | 保留原始源坐标和旋转方向；自定义实体单位及批量裁切仍未新增。 |
| G02 | 四角投影、建筑/文档校正 | 已验（四角手势） | 编辑→透视；[ProjectiveControls.tsx](../../apps/web/src/editor/ProjectiveControls.tsx)、[projective-model.ts](../../apps/web/src/editor/projective-model.ts) | 保留四角手势和数值入口，在统一参数面板内呈现。 | 交叉/退化拒绝、透明边和固定手势参照仍由原实现负责；没有自动文档/建筑找边。 |
| G03 | 画布扩展、边缘填充与旋转补边 | 部分 | 构图透明边/AI生成；[GeometryControls.tsx](../../apps/web/src/editor/GeometryControls.tsx)、[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx) | 保留现有变换和通用生成入口；未包装为专用扩图工具。 | 保留区、边缘融合、旋转补边的专门执行与采纳闭环仍待实现。 |
| G04 | 位移笔、变形保护和修复相容 | 部分 | 编辑→液化；[LayerControls.tsx](../../apps/web/src/editor/LayerControls.tsx) 的 LiquifyControls、[ParameterShelf.tsx](../../apps/web/src/editor/ParameterShelf.tsx) | 笔刷参数用统一精调布局，保留保护区与flow-v2路径。 | 大图多笔、栅格直线保护和修复组合仍需实测；未改位移场或采样算法。 |
| G05 | 镜头配置、畸变、暗角与色差校正 | 部分 | 构图/暗角；[GeometryControls.tsx](../../apps/web/src/editor/GeometryControls.tsx)、[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx) | 保留普通构图、暗角功能；没有镜头profile选择器。 | 焦段元数据联动、光学色差检测及专用镜头校正仍为原差距。 |
| G06 | 裁切建议、黄金比例、主体安全区 | 部分 | 编辑→构图；[GeometryControls.tsx](../../apps/web/src/editor/GeometryControls.tsx) | 手工构图入口维持可见；没有增加自动建议。 | 主体/文字安全区识别、黄金比例推荐与批量构图模板未补。 |
### 人像与妆发

| ID | 功能（原名） | 原证据状态 | 当前前端入口与源码 | 本轮处理 / 明确未补项 | 能力门禁与具体待验 |
| --- | --- | --- | --- | --- | --- |
| H01 | 多人检测、独立目标、可见性和手工修正 | 部分 | 编辑→美颜→人物；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[usePortraitAnalysis.ts](../../apps/web/src/editor/usePortraitAnalysis.ts) | 重做人物和分类参数展示，保留逐人目标与真实分析状态。 | 分析必须匹配当前source/contentHash；portraitToolAvailability控制可见轮廓，不伪造遮挡点或跨帧ID。 |
| H02 | 磨皮、肤质纹理、毛孔与保痣 | 部分 | 美颜→肤质；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[ParameterShelf.tsx](../../apps/web/src/editor/ParameterShelf.tsx) | 肤质参数使用图形选择和统一强度控件；guided-v4算法不变。 | 保痣/眉睫自动保护与材质盲评仍未通过；负样本和高频纹理保留继续验证。 |
| H03 | 美白、去暗沉、均匀肤色、面身匹配 | 部分 | 美颜→肤色；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[ColorPicker.tsx](../../apps/web/src/components/ColorPicker.tsx) | 保留亮度、肤色及连续色输入，调整控件层级。 | 分析区域与皮肤/轮廓交集不变；身体匹配、复杂遮挡和过渡待真实照片验证。 |
| H04 | 祛斑、祛痘、遮瑕和纹理回贴 | 部分 | 美颜/修复；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[RepairControls.tsx](../../apps/web/src/editor/RepairControls.tsx) | 修复模式、供体和笔刷参数改用精简布局，保持可追踪的当前模式。 | 没有新增自动区分痘/痣/雀斑/纹身；供体、保护和纹理回贴结果待验。 |
| H05 | 眼袋、泪沟、法令纹、眼纹和油光 | 部分 | 美颜→肤质/局部；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[LocalControls.tsx](../../apps/web/src/editor/LocalControls.tsx) | 保留已存在的眼下、油光和局部质感参数。 | 不将通用提亮称为泪沟/皱纹专门识别；多肤质与遮挡结果未补证据。 |
| H06 | 脸型、头脸比例、下颌与双下巴 | 部分 | 美颜→五官；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx) | 二维脸型参数采用新的图形参数入口，范围与中性值保持。 | 未引入3D塑形、双下巴分割或自动背景保护；领口、背景直线与多脸独立性待验。 |
| H07 | 眼形、眼宽高、眼睑、虹膜和眼神 | 部分 | 美颜→眼部；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[portrait-analysis-errors.ts](../../apps/web/src/editor/portrait-analysis-errors.ts) | 保留眼部、可见虹膜参数，并将不可用状态留在真实能力判断上。 | 轮廓不足仍禁用；没有眼神矫正专项，不能靠放开滑条假装可执行。 |
| H08 | 鼻型、唇形、嘴角、眉位与眉形 | 部分 | 美颜→鼻/唇/眉；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx) | 统一局部五官参数的大小、数值和控制位置。 | 锚点与左右可见性条件不变；左右独立和遮挡组合验收仍缺。 |
| H09 | 牙齿美白、整牙、眼白提亮 | 缺口（自动牙齿/眼白专用） | 近似入口：局部提亮；[LocalControls.tsx](../../apps/web/src/editor/LocalControls.tsx) | 原缺口保留；没有自动牙齿/眼白专用入口。 | 手工提亮与亮眼不等于牙齿分区、美白、整牙或眼白独立处理。 |
| H10 | 眼镜镜框、帽沿、手挡脸及五官保护 | 部分 | 保护蒙版；[MaskControls.tsx](../../apps/web/src/editor/MaskControls.tsx)、[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx) | 保留手绘保护与轮廓可见性，整理操作层级。 | 未增加眼镜、帽沿、手/头发自动分层；需复杂遮挡的保形验收。 |
| H11 | 表情替换、闭眼和胡须 | 缺口（表情合成） | 近似入口：AI通用候选；[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx) | 原缺口保留；没有同人参考表情、睁眼、胡须专用执行。 | 通用生成与二维嘴角移动不可作为表情合成验收。 |
| H12 | 3D 塑颜、头部朝向、左右对称 | 缺口（3D 执行） | 近似入口：二维五官；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx) | 原缺口保留；未新增3D头部/对称模型或相应控件。 | 不得将二维位移、局部光影介绍为3D执行。 |
| H13 | 美体、肩颈、腰胯、手臂、腿与体态 | 部分 | 美颜→美体；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx) | 肩颈、腰胯、腿等已有二维参数接入统一控件；不改变实际执行范围。 | V4自动颈长继续不可用；旧颈长值仅按已有迁移/清理路径处理，多人遮挡和衣缝待验。 |
| H14 | 局部口红、腮红、眼影、眉妆与修容 | 部分 | 美颜→妆容；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[ColorPicker.tsx](../../apps/web/src/components/ColorPicker.tsx) | 保留七类部位妆、连续RGBA和独立强度，重排选择/颜色/强度。 | 口腔排除、遮挡溢色和多层混合仍按原实现；专门质地与妆式质量未新增证据。 |
| H15 | 手工修容笔、取色、擦除与亮片 | 部分 | 编辑→绘制/取色；[LayerControls.tsx](../../apps/web/src/editor/LayerControls.tsx)、[ColorPicker.tsx](../../apps/web/src/components/ColorPicker.tsx) | 画笔/橡皮/取色使用一致尺寸和动作反馈，减少重复文字。 | 区域锁定独立调色与亮片材质闭环未补；保护区和导出效果待验。 |
| H16 | 参考照迁妆和区域妆容控制 | 缺口 | 近似入口：显式参考图；[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx) | 原缺口保留；未把多参考输入标为区域迁妆功能。 | 迁妆区域、身份与遮挡保持无专用执行证据。 |
| H17 | 发丝精抠、透明度与复杂遮挡 | 部分 | 美颜→主体提取；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[portrait-matte.worker.ts](../../apps/web/src/editor/portrait-matte.worker.ts)、[portrait-selection.ts](../../apps/web/src/editor/portrait-selection.ts) | 重排抠图参数和动作；保持MODNet连续alpha、原像素求解及来源匹配。 | alphaPrior/source尺寸、原图身份与预算继续校验；复杂发丝/遮挡误差不能因换UI算消失。 |
| H18 | 发色、局部挑染、发根与发质 | 部分 | 头发选区/手工上色；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[LayerControls.tsx](../../apps/web/src/editor/LayerControls.tsx) | 保留头发分割与手工颜色操作。 | 专用保高光染发、染根、多发质方案仍未新增。 |
| H19 | 祛碎发、补发量、发际线与换发型 | 缺口（专用算法） | 近似入口：手修/通用AI；[RepairControls.tsx](../../apps/web/src/editor/RepairControls.tsx)、[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx) | 原缺口保留；没有专用祛碎发/补发量/发际线生成。 | 不以通用候选冒充可控发丝算法，需单独身份/背景保持证据。 |
| H20 | 真三维发丝几何 | 缺口 | 近似入口：二维抠图；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx) | 原缺口保留；没有三维发丝对象、几何或编辑入口。 | 二维alpha和保护区不等于真三维发丝。 |
### 抠图合成与恢复

| ID | 功能（原名） | 原证据状态 | 当前前端入口与源码 | 本轮处理 / 明确未补项 | 能力门禁与具体待验 |
| --- | --- | --- | --- | --- | --- |
| S01 | 任意物体点选、框选、文字选和多实例 | 部分 | 人物/头发/背景选区及手绘；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[MaskControls.tsx](../../apps/web/src/editor/MaskControls.tsx) | 保留已实现的人像和手动选择路径。 | 未增加任意对象点/框/文本多实例提示分割；不显示虚构可用状态。 |
| S02 | 透明底、换背景、局部擦除与消色边 | 部分 | 主体提取/合成/透明导出；[PortraitControls.tsx](../../apps/web/src/editor/PortraitControls.tsx)、[LayerControls.tsx](../../apps/web/src/editor/LayerControls.tsx)、[ProjectDialogs.tsx](../../apps/web/src/components/ProjectDialogs.tsx) | 精简抠图和导出操作，保留透明PNG及去边色参数。 | 背景模板一步切换与跨背景自然融合未补；检查透明边和原图/派生来源。 |
| S03 | 背景虚化、景深与前后遮挡 | 部分 | 局部模糊/图层；[LocalControls.tsx](../../apps/web/src/editor/LocalControls.tsx)、[LayerControls.tsx](../../apps/web/src/editor/LayerControls.tsx) | 保留区域模糊、蒙版和底图合成入口。 | 没有焦点深度或多层散景引擎；遮挡边界与景深质量继续单独验收。 |
| S04 | 复制、图层、混合、透明度与蒙版 | 部分 | 编辑→图层/合成；[LayerControls.tsx](../../apps/web/src/editor/LayerControls.tsx) | 保留位置、裁切、透明度、混合和保护；新的参数面板避免嵌套控制挤压。 | 图像层8/绘制层24及固定阶段仍有效；组、嵌套、剪贴蒙版/调整层未补。 |
| S05 | 一图拆成可单独编辑的 RGBA 层 | 缺口（自动拆层） | 近似入口：采纳AI结果为图层；[ResultActions.tsx](../../apps/web/src/ai/ResultActions.tsx) | 原缺口保留；没有自动将一张照片拆成多个可编辑RGBA对象层。 | 采纳独立结果不可当作自动拆层，遮挡背面补全也未实现。 |
| S06 | 克隆图章、点瑕疵修复、梯度域补片 | 已验（基础） | 编辑→修复；[RepairControls.tsx](../../apps/web/src/editor/RepairControls.tsx)、[repair-draft.ts](../../apps/web/src/editor/repair-draft.ts) | 模式、供体、笔刷、保护与强度重新布局；保留真实算法选择。 | 原基础验收保留；需要自然照片逐模式比对、取消快照和历史回放，不能默认exemplar更优。 |
| S07 | 语义消除路人、物件、电线及其影子 | 部分 | 手工修复/AI遮罩参考；[RepairControls.tsx](../../apps/web/src/editor/RepairControls.tsx)、[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx) | AI参考区按allowMask/allowMarkup分别保留附件，防止能力刷新误清标注图。 | 未补目标影子识别、蒙版外原图回用或专用消除融合；通用模型质量另验。 |
| S08 | AI 超分、旧照片修复与人脸保真 | 部分 | 近似入口：细节/普通导出；[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx)、[ProjectDialogs.tsx](../../apps/web/src/components/ProjectDialogs.tsx) | 未增加专用超分或旧照修复入口；不使用伪造修复效果图。 | 人脸与文字保真、专用模型部署和真实质量证据仍缺。 |
| S09 | 亮度与色度降噪、保边与纹理 | 部分 | 编辑→细节→光学；[ColorControls.tsx](../../apps/web/src/editor/ColorControls.tsx)、[advanced-model.ts](../../apps/web/src/editor/advanced-model.ts)；新派生入口待接[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) | 原有optics.denoiseLuminance/denoiseChroma（固定5×5）已通过动态V3工具表接入；独立photo-restore-v1派生尚未接前端，本轮补接已授权。 | 局部配方降噪与新素材派生分开；restoration.maxPixels/maxWork继续限制，RAW噪声模型/高ISO成对质量不因此完成。 |
| S10 | 去运动拖影与散焦 | 部分 | 待接：素材→降噪与去拖影；[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx)；后端restorationRequest | 后端已有photo-restore-v1受控运动核反卷积；383d前端无length/angle/iterations/strength输入，本轮补接真实quote→显式执行→新素材。 | 4,194,304像素/134,217,728工作预算；长度0–31源像素、角度±180、迭代1–12、强度0–1；未知核盲估仍false。 |
| S11 | 玻璃去反光、眩光、镜面污渍与摩尔纹 | 部分 | 编辑→细节→光学/局部；[ColorControls.tsx](../../apps/web/src/editor/ColorControls.tsx)、[advanced-model.ts](../../apps/web/src/editor/advanced-model.ts) | 保留已有确定性算子和局部控制。 | 不称为完整玻璃反射/透射分离；需夜窗、展柜等实拍失败样本验证。 |
| S12 | 弱光、补光、闪光灯、发丝光和环境统一 | 部分 | 明暗/局部/场景候选；[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx)、[LocalControls.tsx](../../apps/web/src/editor/LocalControls.tsx)、[WorkspaceCards.tsx](../../apps/web/src/ai/WorkspaceCards.tsx) | 统一局部调光和候选动作表现。 | 未补定向补光、材质估计或换背景一致照明；高光/发丝保持待验。 |
| S13 | 换天、天气、穿搭与参考换背景 | 部分 | AI生图→显式参考；[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx)、[ResultActions.tsx](../../apps/web/src/ai/ResultActions.tsx) | 保留授权参考、真实候选预览和采纳；删除无关说明。 | 没有专用换天/穿搭算法；地景反光、人体分区与光色一致性不能自动判通过。 |
### RAW/HDR 与文件交付

| ID | 功能（原名） | 原证据状态 | 当前前端入口与源码 | 本轮处理 / 明确未补项 | 能力门禁与具体待验 |
| --- | --- | --- | --- | --- | --- |
| F01 | 静态图片解码、EXIF 方向、透明与原件 | 已验（常见静态） | 打开照片/素材导入；[MediaImportDialog.tsx](../../apps/web/src/components/MediaImportDialog.tsx)、[imageSources.ts](../../apps/web/src/editor/imageSources.ts) | 保留真实解码和不可变原件；新作品/素材卡片按实际宽高比呈现。 | 按服务能力区分静态与GIF首帧；EXIF方向、透明及原件哈希须在新入口复测。 |
| F02 | 导出尺寸、质量、透明与色彩一致 | 部分 | 导出；[ProjectDialogs.tsx](../../apps/web/src/components/ProjectDialogs.tsx) 的 ExportDialog、[ImagePreview.tsx](../../apps/web/src/components/ImagePreview.tsx) | 加入当前真实RGBA预览；一次明确点击编码并发起下载，保留同一文件再次下载。 | 普通PNG/JPEG/WebP与高位深母版分开；尺寸、质量、alpha及迟到编码归属待验。 |
| F03 | 大图保留、分块上传和服务端导出 | 部分 | 媒体导入/原件母版；[MediaImportDialog.tsx](../../apps/web/src/components/MediaImportDialog.tsx)、[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx) | 保留大图、分块上传和服务端导出入口；没有扩大预算。 | 由导入能力与源像素/字节限额控制；200MP宣传不能代替自然大图、移动内存证据。 |
| F04 | 相机 RAW 显影、曝光余量与相机资料 | 部分 | 素材→原件与母版；[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx) | 保留RAW原件、源窗口、母版版本和三种精度导出。 | 相机配置/64MP等边界以服务descriptor为准；灰点、坏点、EXIF完整性及高光重建仍待验。 |
| F05 | 真 HDR 原件、浮点、非零 data window 与 alpha | 部分 | 原件与母版→线性输入；[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx) | 保持真HDR/EXR线性入口，未用普通RGBA8预览替代母版保存。 | floatAvailable、源色域/window/alpha语义有效；deep/multipart等受限能力不显示为已支持。 |
| F06 | 16 位母版与线性 32 位可重编导出 | 部分 | 母版→PNG16/TIFF16/EXR32；[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx) | 保留独立精度导出、源SHA与版本；普通导出新UI不改变高位深链路。 | RGBA8配方与场景线性母版不能混写；需要重开/窗口/导出同值验证。 |
| F07 | RAW/HDR 全配方、图层和实时母版窗口 | 部分 | 母版编辑；[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx)、[useMasterPreview.ts](../../apps/web/src/media/useMasterPreview.ts) | 8811基线仅有七项全局参数；本轮已明确补接native曲线和ordered regions，源码补丁与端到端验证在本表生成时仍待整合。 | 仅linear-master及curves.available/regions.available启用；区域最多8，使用源坐标；save保留expectedVersion/sourceSha，导出继续attachment。不得冒充全部高位深笔刷/图层/修复/液化已支持。 |
| F08 | Display-P3、ICC、场景工作空间及显示 | 部分 | 媒体色彩信息/预览；[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx)、[MediaImportDialog.tsx](../../apps/web/src/components/MediaImportDialog.tsx) | 保持现有ICC输入与sRGB显示路径；未新增广色域工作空间选择器。 | P3输入转色证据不等于广色域编辑/输出；HDR显示器、软打样仍待专项。 |
| F09 | 手机 Ultra HDR / 增益图与 HEIC HDR | 部分 | 母版→Ultra HDR；[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx) | 保留真实增益图/HEIC HDR原件与HDR JPEG导出选项。 | 只有ultraHdrJpeg能力允许才显示/执行；线性输入、源SHA与attachment下载票据必须保持，手机HDR显示待验。 |
| F10 | CMYK 输入、编辑、软打样和印前输出 | 部分 | 媒体导入→带ICC的CMYK；[MediaImportDialog.tsx](../../apps/web/src/components/MediaImportDialog.tsx) | 保留受支持的CMYK输入转sRGB；未添加印前输出UI。 | 16位CMYK、目标纸张/墨量/意图与CMYK导出仍缺。 |
| F11 | PSD/PSB 可编辑往返 | 部分 | PSD导入/原件信息；[MediaImportDialog.tsx](../../apps/web/src/components/MediaImportDialog.tsx)、[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx) | 保留合成图、图层元数据和原件；不在About声称可编辑PSD往返。 | PSD v1有界范围照旧；PSB、CMYK、32位限制与无PSD回写须保留。 |
| F12 | 元数据、保密交付和水印策略 | 部分 | 导出/来源记录；[ProjectDialogs.tsx](../../apps/web/src/components/ProjectDialogs.tsx)、[ResourceSearch.tsx](../../apps/web/src/resources/ResourceSearch.tsx) | 精简导出和来源显示，保留可查元数据。 | 未补专用EXIF/GPS/嵌入预览清除和批量水印；涂画遮挡不自动构成隐私导出证明。 |
| F13 | 导出/导入任务取消、并发、原件和配额 | 部分 | 导入/导出与任务状态；[MediaImportDialog.tsx](../../apps/web/src/components/MediaImportDialog.tsx)、[ProjectDialogs.tsx](../../apps/web/src/components/ProjectDialogs.tsx)、[MediaSourceViewer.tsx](../../apps/web/src/media/MediaSourceViewer.tsx) | 普通导出继续用源图/配方/请求代次防迟到结果；母版导出保留独立请求状态。 | 取消、并发窗口调色、原件与容量配额按真实回执；跨部署恢复和超大图资源隔离未新验收。 |
### 创作动图与识别

| ID | 功能（原名） | 原证据状态 | 当前前端入口与源码 | 本轮处理 / 明确未补项 | 能力门禁与具体待验 |
| --- | --- | --- | --- | --- | --- |
| D01 | 文字、贴纸、边框与水印对象 | 部分 | 草图/绘制/图层；[DrawingBoard.tsx](../../apps/web/src/components/DrawingBoard.tsx)、[LayerControls.tsx](../../apps/web/src/editor/LayerControls.tsx) | 保留现有栅格/绘制对象；未增加正式照片可编辑文字排版系统。 | 字体复现、贴纸对象和边框预设的完整化仍待完成。 |
| D02 | 拼图、模板布局与批量切图 | 部分 | 素材工具→拼图；[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) 的 ProjectAssetTools | 保留真实拼图派生和当前尺寸/间距等输入，工作区卡片重新排版。 | 仍限制有效素材数量/项目范围；模板锁焦点、切图与二次编辑未扩展。 |
| D03 | 涂鸦、克隆、标记、马赛克与真正遮盖 | 部分 | 绘制/草图/克隆；[LayerControls.tsx](../../apps/web/src/editor/LayerControls.tsx)、[DrawingBoard.tsx](../../apps/web/src/components/DrawingBoard.tsx) | 保留涂画、擦除、克隆与标记；笔刷参数按新样式显示。 | 未增加自动人脸打码或导出隐私验证；真正遮盖需要像素检查。 |
| D04 | 草图、形状与作为 AI 参考 | 已验（基本入口） | 草图→作为AI参考；[DrawingBoard.tsx](../../apps/web/src/components/DrawingBoard.tsx)、[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx) | 保留透明PNG及显式参考流程；刷新能力时附件按类型判断。 | 仅选中且允许的参考发送；复杂文字对象、压感与模板持久化仍待验。 |
| D05 | GIF 拆帧、重排、帧时长、循环和导出 | 已验（有界 GIF） | 素材→GIF工具；[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) 的 AnimationDialog | 保留帧序、时长、循环与共享配方；未把静态卡片布局变化计为动画新验收。 | animation.formats/maxFrames/maxFramePixels/maxTotalPixels/maxBytes控制；逐帧蒙版/完整时间轴仍缺。 |
| D06 | APNG、动画 WebP、跨格式时序 | 缺口（完整动画） | 静态PNG/WebP与GIF工具；[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) | 原缺口保留；没有APNG/动画WebP逐帧工程入口。 | 不能以静态格式导出或GIF编辑冒充跨格式时序支持。 |
| D07 | Live Photo、动态美容与跨帧跟踪 | 缺口 | 近似入口：GIF共享参数；[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) | 原缺口保留；没有Live Photo配对、动态美容或跨帧身份。 | 保音频、动作遮挡及配对读写均无完整入口。 |
| D08 | 文档校正、图片文字、OCR 搜索 | 部分 | 素材→识别/搜索；[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) 的 AssetRecognitionDialog、[ResourceSearch.tsx](../../apps/web/src/resources/ResourceSearch.tsx) | 保留真实OCR文字、框和置信度；素材浏览减少冗余元信息。 | recognition.languages/maxPixels与权限继续校验；自动文档边界、去摩尔纹、纠错链路未补。 |
| D09 | 图片表格识别、合并行列与结构化导出 | 部分 | 素材识别→对齐表格；[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) | 保留可能为空的简单表格结果，未生成虚构单元格。 | 合并行列、复杂表格校正和结构化导出仍是原差距。 |
| D10 | 画布中的可编辑表格 | 缺口 | 无专用前端入口 | 原缺口保留；未新增画布内可编辑排版表格。 | OCR识别表格不是可编辑表格对象，不能合并验收。 |
| D11 | 证件照、打印和人像比例 | 部分 | 手工裁切/抠图/拼图；[GeometryControls.tsx](../../apps/web/src/editor/GeometryControls.tsx)、[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) | 保留组合路径；未添加证件照尺寸模板或打印向导。 | 主体占比、实体尺寸/分辨率与打印输出需独立实现和验收。 |
| D12 | 拍摄直出、基础视频编辑、时序美容 | 缺口（拍摄和通用视频） | 现有静态照片/GIF入口；[MediaImportDialog.tsx](../../apps/web/src/components/MediaImportDialog.tsx)、[AssetTools.tsx](../../apps/web/src/components/AssetTools.tsx) | 原缺口保留；未扩展拍摄直出、通用视频或时序美容。 | 没有摄像/时间轴/音轨闭环，不能从语音输入推导视频支持。 |
| D13 | 素材库、配方模板、收藏与做同款 | 部分 | 作品/素材/配方；[AssetLibrary.tsx](../../apps/web/src/components/AssetLibrary.tsx)、[WorkspaceViews.tsx](../../apps/web/src/components/WorkspaceViews.tsx)、[ToolInspector.tsx](../../apps/web/src/editor/ToolInspector.tsx) | 使用真实宽高比重排素材，减少卡片文字；保留现有配方与来源。 | 未增加按版本发布、权限、对象模板和做同款工程；About样例不是模板库。 |
### AI 执行与语音

| ID | 功能（原名） | 原证据状态 | 当前前端入口与源码 | 本轮处理 / 明确未补项 | 能力门禁与具体待验 |
| --- | --- | --- | --- | --- | --- |
| A01 | 文字修图、实际参数建议、预览和确认 | 部分 | AI助手→参数候选；[LiveAssistant.tsx](../../apps/web/src/ai/LiveAssistant.tsx)、[CandidateActions.tsx](../../apps/web/src/ai/CandidateActions.tsx)、[WorkspaceCards.tsx](../../apps/web/src/ai/WorkspaceCards.tsx) | 取消后重新预览；结果旁确认/取消；本地确认与云端已保存分别显示。 | acknowledgeEditCandidate仍检查当前作品/recipe/版本；建议模式不执行，三模式权限不变。 |
| A02 | 文生图、模型参数和采纳到独立图层 | 已验（一个真实模型低成本路径） | AI→生图/采纳；[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx)、[ImageParameters.tsx](../../apps/web/src/ai/ImageParameters.tsx)、[AIThread.tsx](../../apps/web/src/ai/AIThread.tsx)、[ResultActions.tsx](../../apps/web/src/ai/ResultActions.tsx) | 结果槽使用真实尺寸/缩略图，失败只重读预览；参数随实际模型能力刷新。 | 保留张数、尺寸、质量、报价与采纳ACL；一个真实模型低成本旧证据不等于全模型质量矩阵。 |
| A03 | 图生图、中文指令、多参考、局部遮罩 | 部分 | AI→参考图/遮罩；[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx)、[capabilities.ts](../../apps/web/src/ai/capabilities.ts) | 按mask/markup分别判断能力，保留仍有效的附件与参数，去掉重复说明。 | references.supported/maxCount/allowMask/allowMarkup及字节/尺寸依赖继续有效；多参考保真与外区保留需真调用。 |
| A04 | 场景分析、测量像素、候选评分和证据 | 部分 | 助手→结构化工作区/证据；[WorkspaceCards.tsx](../../apps/web/src/ai/WorkspaceCards.tsx)、[ContextEvidence.tsx](../../apps/web/src/ai/ContextEvidence.tsx)、[ResearchGraph.tsx](../../apps/web/src/ai/ResearchGraph.tsx) | 工作区采用开放排版，预算、参数、参考和候选继续读取真实返回值。 | 未新增评分算法；低分辨率测量不得变成高分辨率质量保证。 |
| A05 | 模型目录、能力参数、定价与错误回显 | 部分 | AI模型/运营模型；[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx)、[LiveAssistant.tsx](../../apps/web/src/ai/LiveAssistant.tsx)、[OpsDashboard.tsx](../../apps/web/src/components/OpsDashboard.tsx)、[AssistantOpsPanel.tsx](../../apps/web/src/components/AssistantOpsPanel.tsx) | 修正首次默认模型选择的锁定关系；可见时定时/聚焦刷新目录。运营按任务过滤尺寸、张数、质量，语音按协议显示预算。 | 冻结请求/通话时不改选择；没有自动付费调用；model capabilities、运行门禁、价格和错误仍来自服务端。 |
| A06 | 画布内助手、上下文冻结与工作台切换 | 部分 | 侧栏/独立助手；[AIPanel.tsx](../../apps/web/src/components/AIPanel.tsx)、[LiveAssistant.tsx](../../apps/web/src/ai/LiveAssistant.tsx)、[assistantGuards.ts](../../apps/web/src/ai/assistantGuards.ts) | 保留上下文冻结和切页状态，预览动作与editor当前预览状态对齐。 | project/artwork/version/recipe来源校验继续；关闭面板不清除尚未核实请求。 |
| A07 | 写作、字幕、搜索与结构化工作区 | 部分 | AI文字/字幕/搜索；[AIThread.tsx](../../apps/web/src/ai/AIThread.tsx)、[AssistantText.tsx](../../apps/web/src/ai/AssistantText.tsx)、[VoiceCaptions.tsx](../../apps/web/src/ai/VoiceCaptions.tsx) | 文案一键新建文档；存到已有文档另有明确入口并保留版本确认；缩短重复说明。 | 保留原始AI来源与手改标记、expectedDocumentVersion、复制失败反馈及真实流式正文；供应商多任务中断仍待验。 |
| A08 | 工具调用、MCP 与外部连接 | 部分 | 助手设置/研究分支；[PanelSettingsPage.tsx](../../apps/web/src/ai/PanelSettingsPage.tsx)、[ResearchGraph.tsx](../../apps/web/src/ai/ResearchGraph.tsx)、[AssistantOpsPanel.tsx](../../apps/web/src/components/AssistantOpsPanel.tsx) | 保留现有受控工具与模型设置；没有新增通用用户MCP管理台。 | 项目域鉴权、工具授权、外部连接能力不因UI重排放开；增删/撤销/兼容仍缺完整证据。 |
| A09 | 记忆、会话、长上下文和断流续接 | 部分 | 会话/记忆/恢复；[MemoryControls.tsx](../../apps/web/src/ai/MemoryControls.tsx)、[assistantSubmission.ts](../../apps/web/src/ai/assistantSubmission.ts)、[turnStream.ts](../../apps/web/src/ai/turnStream.ts) | 保留确认式记忆、会话和断流回读；不隐藏未知请求状态。 | 范围、来源、过期、CAS与恢复检查继续；长任务错误召回/删除需新实测。 |
| A10 | AI 双向长通话、字幕、打断与账单 | 部分 | 实时语音；[LiveAssistant.tsx](../../apps/web/src/ai/LiveAssistant.tsx)、[voice-error.ts](../../apps/web/src/ai/voice-error.ts)、[VoiceCapture.tsx](../../apps/web/src/components/VoiceCapture.tsx) | 通话控制重排为状态胶囊；缺麦克风、拒绝、占用和格式错误给出不同可操作消息。 | 真实时间/字幕/连接状态才显示；旧347秒协议证据不证明物理麦克风、弱网或公网已验。 |
| A11 | 团队多人语音、共享 AI 与网络退化 | 部分 | 团队语音；[TeamVoiceControls.tsx](../../apps/web/src/collaboration/TeamVoiceControls.tsx)、[useTeamVoice.ts](../../apps/web/src/collaboration/useTeamVoice.ts)、[TeamVoiceBanner.tsx](../../apps/web/src/collaboration/TeamVoiceBanner.tsx) | 可用模型默认选择减少操作；麦克风和离开动作并排且44px触达，设备错误统一。 | 每人音频共享同意、票据、邀请未知状态与个人/团队请求互斥仍保留；3+物理端/公网长通话待验。 |
| A12 | 权限三模式、撤销授权和自动执行预算 | 已验（后端契约） | 助手执行模式/预算；[CreativeControls.tsx](../../apps/web/src/ai/CreativeControls.tsx)、[LiveAssistant.tsx](../../apps/web/src/ai/LiveAssistant.tsx) | 保持建议/预览确认/预算自动三个实际入口；候选本地确认不标为服务器已存版本。 | grant、CAS、租约、撤销、费用均由服务器判断；旧后端契约已验范围不扩大为浏览器三模式全通过。 |
| A13 | 真实照片、多模型多风格、质量与成本 | 部分 | 真实图像结果/用量；[AIThread.tsx](../../apps/web/src/ai/AIThread.tsx)、[UsageDashboard.tsx](../../apps/web/src/usage/UsageDashboard.tsx) | 结果与预览只显示实际素材；本轮未自动发起收费质量样本。 | 原公开样本与小额调用成绩原样保留；同片竞品、多模型、审美盲评和失败率没有新增结果。 |
### 协作与服务

| ID | 功能（原名） | 原证据状态 | 当前前端入口与源码 | 本轮处理 / 明确未补项 | 能力门禁与具体待验 |
| --- | --- | --- | --- | --- | --- |
| C01 | 同图实时光标、区域、预览和并发提交 | 已验（本地真实 SQL 与浏览器） | 画布协作；[useCollaboration.ts](../../apps/web/src/collaboration/useCollaboration.ts)、[CollaborationOverlay.tsx](../../apps/web/src/collaboration/CollaborationOverlay.tsx)、[App.tsx](../../apps/web/src/App.tsx) | AI确认/取消连接现有collaboration.editor包装，保持协作预览和命令队列。 | 对象级权限/租约/版本与重连归属不变；公网P95、多角色并发和队员撤权需回归。 |
| C02 | 作品、素材、个人/团队空间及节点 | 部分 | 作品/素材/团队空间；[WorkspaceViews.tsx](../../apps/web/src/components/WorkspaceViews.tsx)、[AssetLibrary.tsx](../../apps/web/src/components/AssetLibrary.tsx)、[TeamActivity.tsx](../../apps/web/src/resources/TeamActivity.tsx) | 真实比例媒体布局、精简元数据和相邻操作；保留分页、范围、显式复制和来源。 | 团队混合角色、跨空间复制和节点权限需实测；卡片布局不增加数据访问权。 |
| C03 | 身份验证、注册登录、恢复与账号数据 | 部分 | 登录/注册/账号；[AuthPanel.tsx](../../apps/web/src/components/AuthPanel.tsx)、[AccountCenter.tsx](../../apps/web/src/account/AccountCenter.tsx)、[AccountReady.tsx](../../apps/web/src/account/AccountReady.tsx) | 删除宣传式解释；账号入口单列，注册完成可直接开照片；原始Logo通过统一BrandMark呈现。 | 会话/短信/找回均依真实接口；生产短信、跨设备生命周期与账号删除仍须单列验收。 |
| C04 | 审批、评论、公开/私密分享和版本分支 | 部分 | 协作/文档/分享/版本；[WorkspaceViews.tsx](../../apps/web/src/components/WorkspaceViews.tsx)、[ProjectDialogs.tsx](../../apps/web/src/components/ProjectDialogs.tsx)、[RevisionTools.tsx](../../apps/web/src/components/RevisionTools.tsx) | 文档目录与编辑区分层；讨论/任务减少容器，分享和确认弹窗重新组织。 | 保留草稿、expectedVersion、并发冲突、退出保护和链接范围；分享不可收回边界不能删除。 |
| C05 | 角色、租约、成员撤权与运维隔离 | 已验（SQL 回归） | 角色和访问提示；[WorkspaceViews.tsx](../../apps/web/src/components/WorkspaceViews.tsx)、[useCollaboration.ts](../../apps/web/src/collaboration/useCollaboration.ts)、[OpsDashboard.tsx](../../apps/web/src/components/OpsDashboard.tsx) | 保留权限驱动动作与运营隔离，不将隐藏按钮视为鉴权。 | 服务端对象校验是权限来源；原SQL回归范围保持，成员撤权和跨对象访问待版本回归。 |
| C06 | 用量、钱包、分页、CSV 和账目对账 | 部分 | 用量/钱包/账本；[UsageDashboard.tsx](../../apps/web/src/usage/UsageDashboard.tsx)、[UsageLedger.tsx](../../apps/web/src/usage/UsageLedger.tsx)、[QuotaManager.tsx](../../apps/web/src/components/QuotaManager.tsx) | 区分当前余额、期间汇总与趋势；运营调整直接使用成功事务回执更新权益，避免后续GET失败误报写入失败。 | 保留幂等键、未知值、分页与CSV保护；真实收费、时区、未知派发结算仍待验证。 |
| C07 | 运行队列、模型失败、重试和幂等 | 已验（受控回归及小样） | AI任务与恢复；[jobSubmission.ts](../../apps/web/src/ai/jobSubmission.ts)、[QueuedCancellation.tsx](../../apps/web/src/ai/QueuedCancellation.tsx)、[AIThread.tsx](../../apps/web/src/ai/AIThread.tsx) | 保留冻结原请求与未知状态，缩略图重读与模型再提交明确分离。 | 只能按canCancel及原幂等请求处理；没有自动重发收费任务，生产故障恢复仍待验。 |
| C08 | 移动端、平板、横屏和小程序能力 | 部分 | 工作台/账号/对话框响应式；[panelGeometry.ts](../../apps/web/src/workspace/panelGeometry.ts)、[useWorkspaceLayout.ts](../../apps/web/src/workspace/useWorkspaceLayout.ts)、[Ui.tsx](../../apps/web/src/components/Ui.tsx) | 提高小面板下限、统一按钮触达和弹窗宽度；对比、作品和账号提供窄屏布局。 | 新布局须实测320/390/平板/横屏、三语言/浅深色/键盘；iOS/WebView/小程序不因Chromium成绩算支持。 |
| C09 | About、样例、功能导览和无障碍动效 | 部分 | About与品牌；[AboutPage.tsx](../../apps/web/src/about/AboutPage.tsx)、[useOverviewMotion.ts](../../apps/web/src/about/useOverviewMotion.ts)、[BrandMark.tsx](../../apps/web/src/components/BrandMark.tsx)、[SiteShell.tsx](../../apps/web/src/SiteShell.tsx) | About改成连续纵向展示与滚动变化，使用系统截图，去掉点击解锁内容和生成图堆砌；统一原始Logo。 | 新的布局需补真实屏幕截图及每段滚动验证；reduced-motion下仍完整可读，功能文案不得超出111表证据。 |
| C10 | 生产部署、迁移、运行依赖与 API 全量回归 | 部分 | 构建/CI与部署；[App.tsx](../../apps/web/src/App.tsx)、[DeferredFeature.tsx](../../apps/web/src/components/DeferredFeature.tsx) | 本轮是前端重做及最新后端契约同步；源码经不可变Git检查点保存。 | 旧1038/1042/1044项与164路由证据只属于原提交；本轮CI在生成此表时待运行，不能以旧成绩代替。 |
| C11 | 账单与作品联动的人工处置 | 部分 | 用量详情/人工核验/审计；[UsageJob.tsx](../../apps/web/src/usage/UsageJob.tsx)、[UnknownJobsPanel.tsx](../../apps/web/src/components/UnknownJobsPanel.tsx)、[AssistantOpsPanel.tsx](../../apps/web/src/components/AssistantOpsPanel.tsx)、[OpsDashboard.tsx](../../apps/web/src/components/OpsDashboard.tsx) | 审计主行改成人可读动作，原ID/类型/目标保留可展开；额度成功依据真实回执。 | 人工结算/释放仍需原因与证据；批量、长通话多笔关联和故障定位未宣称完备。 |
| C12 | 素材检索、去重、来源追溯和个人标注 | 部分 | 资源搜索/个人标注/OCR；[ResourceSearch.tsx](../../apps/web/src/resources/ResourceSearch.tsx)、[AssetLibrary.tsx](../../apps/web/src/components/AssetLibrary.tsx) | 真实素材比例与精简文字，保留来源、日期、私有标注和授权搜索。 | 未增加视觉语义检索、人脸归类或自动去重；各类授权查询和空结果待实测。 |
| C13 | 运营配置、模型停启、配额与实际支付边界 | 部分 | 运营→模型/品牌/配额；[OpsDashboard.tsx](../../apps/web/src/components/OpsDashboard.tsx)、[ops-model-fields.ts](../../apps/web/src/components/ops-model-fields.ts)、[AssistantOpsPanel.tsx](../../apps/web/src/components/AssistantOpsPanel.tsx)、[QuotaManager.tsx](../../apps/web/src/components/QuotaManager.tsx) | 按任务能力筛参数；保留配置草稿；合入最新version/baseId/expectedVersion及冲突读取，配额依据事务回执，Logo上传检查异步归属。 | CAS必须与fc2827后端成对；新建0、更新当前版本、409保留草稿/重开后再存均待本轮回归；真实支付仍未启用则不生成虚构订单。 |

## 11项底层缺口：保持未完成

- **H09 牙齿美白、整牙、眼白提亮**：缺口（自动牙齿/眼白专用）。原缺口保留；没有自动牙齿/眼白专用入口。
- **H11 表情替换、闭眼和胡须**：缺口（表情合成）。原缺口保留；没有同人参考表情、睁眼、胡须专用执行。
- **H12 3D 塑颜、头部朝向、左右对称**：缺口（3D 执行）。原缺口保留；未新增3D头部/对称模型或相应控件。
- **H16 参考照迁妆和区域妆容控制**：缺口。原缺口保留；未把多参考输入标为区域迁妆功能。
- **H19 祛碎发、补发量、发际线与换发型**：缺口（专用算法）。原缺口保留；没有专用祛碎发/补发量/发际线生成。
- **H20 真三维发丝几何**：缺口。原缺口保留；没有三维发丝对象、几何或编辑入口。
- **S05 一图拆成可单独编辑的 RGBA 层**：缺口（自动拆层）。原缺口保留；没有自动将一张照片拆成多个可编辑RGBA对象层。
- **D06 APNG、动画 WebP、跨格式时序**：缺口（完整动画）。原缺口保留；没有APNG/动画WebP逐帧工程入口。
- **D07 Live Photo、动态美容与跨帧跟踪**：缺口。原缺口保留；没有Live Photo配对、动态美容或跨帧身份。
- **D10 画布中的可编辑表格**：缺口。原缺口保留；未新增画布内可编辑排版表格。
- **D12 拍摄直出、基础视频编辑、时序美容**：缺口（拍摄和通用视频）。原缺口保留；未扩展拍摄直出、通用视频或时序美容。

这些条目没有被通用AI、手工局部调节、二维位移、普通图层或静态格式入口替代验收，也没有因About新增介绍而改为完成。

## 跨页面验收要求

- **预览与写入**：AI“在画布预览→取消→重新预览→确认”必须在同一候选旁完成；画布本地确认和服务器保存新版本分开。改图/换项目/版本变化后，旧候选仍由基线与权限拒绝。
- **减少操作**：AI文案默认一键新建文档；写入已有文档保留明确目标与版本确认。普通导出一键编码并下载；缩略图“重新载入预览”只重读图像，不创建模型请求。没有自动付费生成或自动重拨通话。
- **真实状态**：记录缺麦克风/拒绝/占用/格式错误、任务排队/未知/取消/完成、无权限、能力不可用、保存冲突与迟到结果；不得用假计时、模拟波形、假结果图或固定进度掩盖状态。
- **布局与无障碍**：320px、390px、平板、桌面、短横屏；浅色/深色；简中/繁中/英文；键盘、焦点、Esc和reduced-motion。检查弹窗、活动参数、区域/图层列表及模型表单均无遮挡和横向溢出。
- **About与Logo**：所有介绍段落直接存在于连续文档流；滚动变化是视觉增强。复用仓库真实系统截图并在新UI稳定后补拍当前屏幕；不以AI绘制界面替代截图。导航、登录、加载和About走同一BrandMark/原始默认标志。
- **财务和异步归属**：额度调整以事务返回的entitlements为成功依据；读取失败不变成“可以再次调额”。冻结请求、idempotencyKey、未知状态、scope/source身份、expectedVersion/expectedHash继续有效。

## 已建立的验证入口及当前证据

- 参数/布局：`apps/web/test/parameter-shelf.test.ts`、`precision.test.ts`、`workspace-layout.test.ts`，包含非零中性值、裁切比例撤销和旧112px面板恢复。
- AI交互：`apps/web/test/ai-interaction-redesign.test.ts`，覆盖候选再次预览、相邻确认/取消、未接回调不假确认、真实设备错误、任务能力字段过滤。
- 模型能力：`apps/web/test/ai-capabilities.test.ts`，新增同模型能力刷新保留有效值、缩减批量、透明JPEG依赖与移除不支持项。
- 国际化：`apps/web/test/i18n.test.ts` 必须包括本轮独立AI词典；恢复/错误/操作状态也须覆盖，不能只翻译页面标题。
- 内容/导出/账号已有定向测试仍需在整合后的提交再次运行。环境中断前部分类型和单元检查通过，仅可说明当时那份代码；不能当作 `383d067` 或后续新增入口的CI结果。
- 在执行环境不可用期间，已对实际capabilities helper移除TypeScript注解后运行4个行为用例，结果通过。该检查不等于TypeScript编译、React测试、浏览器交互或真实API验收。

本轮CI、真实浏览器以及F07/修复派生整合后的验收结果应附精确commit、设备/viewport、输入、动作、输出和证据链接。不得复用canonical旧数字来填本轮测试结果。
