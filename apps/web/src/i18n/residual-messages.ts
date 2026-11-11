export const residualEnglish: Readonly<Record<string, string>> = {
  用量账本: 'Usage ledger',
  构图: 'Composition',
  局部: 'Regions',
  调整照片: 'Adjust photo',
  添加合成素材: 'Add image layer',
  导入配方: 'Import recipe',
  恢复原图: 'Restore original',
  上传照片: 'Upload photo',
  手绘草图: 'Draw a sketch',
  '素材或整理草稿已经变化，请检查后重试。':
    'The asset or detail draft changed. Review it before trying again.',
  '整理信息尚未保存，确定关闭吗？': 'Asset details are unsaved. Close anyway?',
  放弃并关闭: 'Discard & close',
  '信息已被其他成员修改。关闭当前草稿并读取最新信息吗？':
    'Another member changed these details. Close this draft and load the latest version?',
  '最多20个标签，每个不超过40字。': 'Use up to 20 tags, each no longer than 40 characters.',
  已授权项目: 'Authorized project',
  入库日期未记录: 'Date added not recorded',
  英文: 'English',
  中英混合: 'Chinese & English',
  自动版面: 'Automatic layout',
  连续段落: 'Continuous paragraphs',
  零散文字: 'Scattered text',
  对齐表格: 'Aligned table',
  删除识别结果: 'Delete recognition result',
  '素材、权限或识别记录已变化，请重新选择后确认。':
    'The asset, permissions, or recognition record changed. Select it again before confirming.',
  '请用逗号分隔有效帧编号。': 'Enter valid frame numbers separated by commas.',
  '请选择至少两帧，编号需在原动图范围内。':
    "Choose at least two frames within the original animation's range.",
  '帧时长需为 20 到 60000 毫秒内的 10 毫秒整数倍。':
    'Frame duration must be a multiple of 10ms between 20 and 60000ms.',
  '配方文件上限 1MB。': 'Recipe file limit: 1MB.',
  '循环次数需为 0 到 65535 的整数。': 'Loop count must be an integer from 0 to 65535.',
  '请先选择 GIF 文件。': 'Choose a GIF file first.',
  '请先读取当前服务的 GIF 导入能力。': "Load this service's GIF import capabilities first.",
  '请选择当前项目中的 2 到 12 张图。画布单边不能超过 8192 像素，总计不能超过 16,777,216 像素。':
    'Choose 2–12 images in the current project. Canvas limit: 8192px per side and 16,777,216 pixels in total.',
  '间距超出画布，无法放置素材。': 'The gaps exceed the canvas, leaving no room for assets.',
  '拼图.png': 'collage.png',
  '请选择或填写模型 ID。': 'Choose or enter a model ID.',
  'HEX 使用 3、4、6 或 8 位十六进制颜色。': 'HEX requires 3, 4, 6, or 8 hexadecimal digits.',
  '当前浏览器无法保存色板，本次会话中仍可使用。':
    'This browser cannot save swatches. They remain available during this session.',
  '草图状态已经变化，请检查当前内容后重试。':
    'The sketch changed. Review the current content before trying again.',
  '草图还在当前绘画窗口中。确认已下载或不再需要后，再关闭吗？':
    'The sketch is still in this drawing window. Close only after downloading it or confirming you no longer need it.',
  关闭草图: 'Close sketch',
  '切换画幅会按比例重新排布已有笔画，继续吗？':
    'Changing the frame proportionally rearranges existing strokes. Continue?',
  切换画幅: 'Change frame',
  '清空画布？已下载的草图不会改变。': 'Clear the canvas? Downloaded sketches remain unchanged.',
  '草图画布暂不可用。': 'Sketch canvas is unavailable.',
  '无法导出这张草图。': 'Could not export this sketch.',
  '草图导出失败。': 'Sketch export failed.',
  '续传时请选择同一份原文件，或先取消之前的导入。':
    'Choose the same original file to resume, or cancel the previous import first.',
  '导入已取消，服务器仍在清理临时文件。存储预占将在确认清理后释放。':
    'Import cancelled; the server is still cleaning temporary files. Storage holds will be released after cleanup is confirmed.',
  '导入已取消，临时存储预占已释放。': 'Import cancelled and temporary storage hold released.',
  运行概览: 'Overview',
  用户管理: 'Users',
  站点与注册: 'Site & registration',
  权益套餐: 'Benefit plans',
  模型能力: 'Model capabilities',
  额度调整: 'Quota adjustments',
  操作审计: 'Audit log',
  注册用户: 'Registered users',
  AI任务: 'AI tasks',
  未设置则使用默认价格: 'Leave unset to use the default price',
  '图片或调整在导出期间发生了变化，旧结果已丢弃。请为当前画面重新生成文件。':
    'The image or adjustments changed during export, so the old result was discarded. Generate a new file for the current image.',
  移除成员: 'Remove member',
  '团队、成员或权限已经变化，请重新核对后操作。':
    'The team, member, or permissions changed. Review before proceeding.',
  '团队所有权或成员状态已经变化，请重新核对。':
    'Team ownership or member status changed. Review again.',
  '授权上限与素材上限须为 0 至 100 的整数。':
    'Sharing and asset limits must be integers from 0 to 100.',
  '共享规则已保存。': 'Sharing rules saved.',
  '项目已授权给接收者。请提醒对方在自己的账号中查看。':
    'Project access granted. Ask the recipient to view it from their account.',
  '已撤销该授权，后续访问将重新检查权限。':
    'Access revoked. Subsequent requests will recheck permissions.',
  更正减少: 'Correct by deducting',
  'PNG 已交给浏览器下载。': 'PNG sent to browser downloads.',
  '恢复记录与当前项目不一致。': 'Recovery record does not match the current project.',
  '分支已创建，尚未打开。': 'Branch created but not yet opened.',
  '发现此前的分支请求，请先恢复这次操作。':
    'An earlier branch request exists. Recover that operation first.',
  '请填写 1–120 字的新作品名称。': 'Enter a new image name of 1–120 characters.',
  '分支已创建；未能保存本机回执，原请求标识仍保留。':
    'Branch created. The local receipt could not be saved; the original request identifier is retained.',
  '已停止等待，创建结果尚未确认。可以继续原请求。':
    'Stopped waiting. Creation is still unconfirmed; you can continue the original request.',
  参数建议: 'Parameter suggestions',
  文案生成: 'Text generation',
  语音转写: 'Speech transcription',
  '已按核验证据结算，记录已写入账本与审计。':
    'Settled using the reconciliation evidence. Ledger and audit records were written.',
  '已按核验证据释放预占，记录已写入账本与审计。':
    'Hold released using the reconciliation evidence. Ledger and audit records were written.',
  '当前作品版本已改变，请重新查看历史后恢复。':
    'The current image version changed. Review history before restoring.',
  '当前作品版本已变化，请重新选择讨论范围。':
    'The image version changed. Choose the discussion scope again.',
  '文档或项目已更新，请核对当前文字后重新操作。':
    'The document or project changed. Review your text before proceeding.',
  '本页保留的文档草稿已达上限。请先返回已有草稿的项目保存，或导出并丢弃，再编辑新的文档。':
    'This page has reached its retained-draft limit. Save an existing draft in its project, or export and discard it before editing another document.',
  '文字超过草稿保留范围，本次输入未应用。':
    'Text exceeds the draft-retention limit. This input was not applied.',
  '丢弃这份保留在本页的未保存草稿？此操作不会取消已经提交的保存请求，也不会删除云端文档。':
    "Discard this page's retained unsaved draft? This does not cancel an already-submitted save or delete the cloud document.",
  '草稿已经变化，请重新核对后操作。': 'The draft changed. Review before proceeding.',
  '请先恢复或丢弃本页保留的草稿，再切换文档；可以先导出一份。':
    "Restore or discard this page's retained draft before switching documents. You can export a copy first.",
  '上次新建结果尚未确认。建议先导出草稿；切换会丢弃本页文字，但不会取消已经提交的保存请求。确定切换吗？':
    "The previous create result is unconfirmed. Export your draft first. Switching discards this page's text but does not cancel the submitted save. Switch anyway?",
  '这份文档还有未保存的修改。放弃修改并切换吗？':
    'This document has unsaved changes. Discard and switch?',
  '草稿状态已变化，请先核对当前内容再保存。':
    'The draft changed. Review the current content before saving.',
  '保存回执不完整，当前草稿已保留。请核对云端列表，不要重复新建。':
    'The save receipt is incomplete; your draft is preserved. Check the cloud list and avoid creating it again.',
  '读取最新版本会替换当前未保存的文字。确定继续吗？':
    'Loading the latest version replaces unsaved text. Continue?',
  '这份文档已不可访问，请重新选择文档。':
    'This document is no longer accessible. Choose another document.',
  '素材列表与当前项目不一致，请刷新后再准备草案。':
    'The asset list does not match the current project. Refresh before preparing a draft.',
  '复制回执与来源或目标项目不一致，未采用该素材。':
    'The copy receipt does not match its source or destination project. The asset was not adopted.',
  '请求未完成，请重试。': 'Request incomplete. Try again.',
  '参考图未完整准备，草案仍待确认。':
    'Reference images are not fully ready. The draft still needs confirmation.',
  '请从当前作品选择一个已保存的版本。': 'Choose a saved version from the current image.',
  '分支恢复记录不完整，暂时不能新建另一条请求。':
    'Branch recovery record is incomplete. A new request cannot be created yet.',
  '分支回执记录不完整，请先核对这次操作。':
    'The branch receipt is incomplete. Reconcile this operation first.',
  '本机存在无法读取的分支恢复记录。请先核对原操作，避免重复创建。':
    'An unreadable local branch recovery record exists. Reconcile the original operation to avoid duplicates.',
  '这个作品还有另一条分支请求需要核对。':
    'Another branch request for this image needs reconciliation.',
  '这次分支已经创建，请打开已有回执中的作品。':
    'This branch already exists. Open the image from the existing receipt.',
  '分支回执与原版本不一致。请用原请求核对，暂不重新创建。':
    'The branch receipt does not match the source version. Check using the original request; do not create another branch yet.',
  '分支回执没有匹配的历史版本来源。':
    'The branch receipt has no matching historical source version.',
  '服务端渲染信息与所选版本不一致，请重新读取。':
    'Server render information does not match the selected version. Reload it.',
  这个版本的几何变换无法计算输出尺寸:
    "This version's transform cannot produce valid output dimensions",
  源图尺寸超出渲染上限: 'Source dimensions exceed the render limit',
  合成图层超出像素预算: 'Image layers exceed the pixel budget',
  输出或中间画布尺寸超出渲染上限:
    'Output or intermediate canvas dimensions exceed the render limit',
  源文件总大小超出读取预算: 'Total source-file size exceeds the read budget',
  解码与合成超过工作内存预算: 'Decoding and compositing exceed the working-memory budget',
  '请先确认这个版本的输出与渲染预算。': "Confirm this version's output and render budget first.",
  '服务端导出未完成，请稍后重试。': 'Server export did not complete. Try again later.',
  '导出内容或版本标识不匹配，没有保存文件。':
    'Export content or version identifier does not match. No file was saved.',
  '这次导出超过本机 128 MiB 下载预算。': 'This export exceeds the local 128MiB download limit.',
  '没有收到完整的 PNG 文件。': 'A complete PNG file was not received.',
  'PNG 下载长度不完整，没有保存文件。': 'PNG download length is incomplete. No file was saved.',
  'PNG 内容或输出尺寸不匹配，没有保存文件。':
    'PNG content or dimensions do not match. No file was saved.',
  'PNG 文件结构不完整，没有保存文件。': 'PNG structure is incomplete. No file was saved.',
  '这组参数暂时不可用，上一个有效状态已保留。':
    'These settings are temporarily invalid. The last valid state is preserved.',
  完成当前作用范围: 'Done with current scope',
  '本次调整超出安全范围，已保留上一个有效状态。':
    'This adjustment exceeds the safe range. The last valid state is preserved.',
  '这里没有可编辑的源像素，请在图片内容上落笔。':
    'There are no editable source pixels here. Paint on the image content.',
  '无法建立安全的编辑标识。': 'Could not create a secure edit identifier.',
  '克隆来源已选，下一笔开始绘制。': 'Clone source selected. The next stroke will paint.',
  手动绘制: 'Manual painting',
  '当前笔刷记录已达安全预算。可删除旧笔触或建立新作品；不会静默丢弃笔触。':
    'The brush history has reached its safety budget. Remove old strokes or create a new image; no strokes are silently discarded.',
  '已达蒙版笔划上限；已画部分保留。': 'Mask stroke limit reached. Existing strokes are preserved.',
  '本笔已达采样预算，请松开后继续下一笔；已画部分保留。':
    'This stroke reached its sampling limit. Release and start another stroke; existing work is preserved.',
  '请保持四角不交叉；已保留上一个有效形状。':
    'Keep the four corners uncrossed. The last valid shape is preserved.',
  '请保留三个非共线轮廓点；已保留上一个有效形状。':
    'Keep three non-collinear contour points. The last valid shape is preserved.',
  四角自由变换: 'Four-corner transform',
  手动构图: 'Manual composition',
  移动合成图层: 'Move image layer',
  手动液化: 'Manual liquify',
  绘制局部笔触: 'Paint local stroke',
  直接调整选区: 'Adjust selection directly',
  '构图预览正在更新，请就绪后再取色。': 'Composition preview is updating. Wait before sampling.',
  '透明扩展区域没有对应源像素，请在图片内容上取色。':
    'Transparent extensions have no source pixel. Sample within the image content.',
  添加轮廓控制点: 'Add contour point',
  '这个控制点无法形成有效轮廓，原选区已保留。':
    'This point cannot form a valid contour. The original selection is preserved.',
  '参数组合暂时无效。': 'This parameter combination is temporarily invalid.',
  重置: 'Reset',
  '连续颜色范围 ': 'Continuous color range ',
  调整曲线: 'Adjust curve',
  调整裁切: 'Adjust crop',
  '参数组合不可用。': 'This parameter combination is unavailable.',
  按比例建立裁切起点: 'Set initial crop ratio',
  正片叠底: 'Multiply',
  滤色: 'Screen',
  叠加: 'Overlay',
  柔光: 'Soft light',
  强光: 'Hard light',
  变暗: 'Darken',
  变亮: 'Lighten',
  差值: 'Difference',
  排除: 'Exclusion',
  颜色减淡: 'Color dodge',
  颜色加深: 'Color burn',
  明度: 'Luminosity',
  '绘制 ': 'Paint ',
  新建绘制图层: 'New paint layer',
  按原图坐标落笔: 'Paint at source coordinates',
  调整局部叠加顺序: 'Reorder local effects',
  '范围分组 ': 'Region group ',
  将多个局部编组: 'Group multiple regions',
  连续选色: 'Continuous color selection',
  组合范围: 'Compound selection',
  '此选区已改变，请重新选择。': 'This selection changed. Select it again.',
  水平半径: 'Horizontal radius',
  垂直半径: 'Vertical radius',
  羽化: 'Feathering',
  色相容差: 'Hue tolerance',
  最低明度: 'Minimum lightness',
  最高明度: 'Maximum lightness',
  过渡羽化: 'Transition feathering',
  '顶点 ': 'Vertex ',
  '人物分析与当前原图不一致，请重新识别后提取素材。':
    'Portrait analysis does not match the current source. Detect again before extracting an asset.',
  '请等待这次识别完成，再建立选区。':
    'Wait for this detection to finish before creating a selection.',
  建立: 'Create',
  '绘制图层已达当前预算，请先整理图层后再新建手动精修。':
    'Paint layers have reached the current limit. Organize them before starting another manual refinement.',
  图像: 'Image',
  ' · 手动修补': ' · Manual repair',
  ' · 手动绘制': ' · Manual painting',
  准备独立人物塑形: 'Prepare independent portrait shaping',
  准备独立手动精修: 'Prepare independent manual refinement',
  人像: 'Portrait',
  '这个人物控制当前无法使用，请检查识别范围。':
    'This portrait control is unavailable. Check the detected region.',
  '参数已更新，已保留最新值。请重新输入。':
    'The parameter changed; its latest value is retained. Enter your value again.',
  整数: 'integer',
  数值: 'number',
  水平: 'Horizontal',
  垂直: 'Vertical',
  '请保持四角轮廓不交叉。': 'Keep the four-corner outline uncrossed.',
  '纹理修复 ': 'Texture repair ',
  '局部质感 ': 'Local texture ',
  '无法新建修复区域。': 'Could not create repair region.',
  调整修复强度: 'Adjust repair strength',
  调整搜索范围: 'Adjust search range',
  纹理搜索精度: 'Texture search precision',
  边界融合迭代: 'Boundary blending iterations',
  调整融合迭代: 'Adjust blending iterations',
  调整修复纹理: 'Adjust repair texture',
  调整纹理补片: 'Adjust texture patch',
  '来源 ': 'Source ',
  微调供体坐标: 'Fine-tune donor coordinates',
  调整局部色斑: 'Adjust local discoloration',
  调整质感半径: 'Adjust texture radius',
  美颜: 'Portrait',
  '按人物调节肤质、五官与妆容': "Adjust each person's skin, features, and makeup",
  曝光与明暗层次: 'Exposure & tonal range',
  '白平衡、饱和度与分区色彩': 'White balance, saturation & color ranges',
  逐点调整亮度与颜色通道: 'Adjust brightness and color channels point by point',
  '画幅、旋转与透视': 'Frame, rotation & perspective',
  '选定范围，独立调整': 'Select an area and adjust it independently',
  '锐化、柔化与颗粒': 'Sharpening, softening & grain',
  修复: 'Repair',
  纹理修补与肤质处理: 'Texture repair & skin refinement',
  绘制: 'Paint',
  '画笔、克隆与混合': 'Brush, clone & blending',
  液化: 'Liquify',
  '推移、膨胀与收缩': 'Push, expand & pinch',
  合成: 'Composite',
  '图层、混合与蒙版': 'Layers, blending & masks',
  '撤销、重做与编辑记录': 'Undo, redo & edit history',
  '这个形状暂时不能成立：多边形至少保留三个非共线点，渐变两端应分开。原有效选区已保留。':
    'This shape is invalid: polygons need three non-collinear points, and gradient endpoints must be apart. The previous valid selection is preserved.',
  调整选区: 'Adjust selection',
  调整径向选区: 'Adjust radial selection',
  启用新版编辑能力: 'Enable newer editing tools',
  切换画幅比例: 'Change aspect ratio',
  颜色范围: 'Color range',
  '当前配方版本已经改变，请重新打开工具。': 'The recipe version changed. Reopen the tool.',
  '作用范围已不存在，请重新选择。': 'This scope no longer exists. Select it again.',
  '参数路径未注册。': 'Parameter path is not registered.',
  '参数不在已注册范围内。': 'Parameter is outside the registered range.',
  '无效参数路径。': 'Invalid parameter path.',
  '这组变换的输出超过当前设备处理预算，请降低缩放或选择保留画幅。':
    'This transform exceeds the device processing budget. Reduce scaling or keep the frame bounds.',
  '颜色格式无效。': 'Invalid color format.',
  '当前浏览器无法准备共享图片。': 'This browser cannot prepare a shared image.',
  '浏览器未能编码共享预览。': 'The browser could not encode the shared preview.',
  '合成素材单文件上限为 64MiB。': 'Image-layer file limit: 64MiB.',
  '合成素材需要静态图片，请先明确选择单帧。':
    'Image layers require static images. Explicitly choose a single frame first.',
  '素材解码尺寸与头信息不一致。': 'Decoded asset dimensions do not match its header.',
  '无法创建合成素材画布。': 'Could not create an image-layer canvas.',
  '当前浏览器无法规范化素材。': 'This browser cannot normalize the asset.',
  '素材PNG编码失败。': 'Asset PNG encoding failed.',
  '人物分析与当前原图不一致，请重新识别后建立选区。':
    'Portrait analysis does not match the current source. Detect again before creating a selection.',
  '这次分析没有提供头发或背景范围，可到“局部”手动建立选区。':
    'This analysis has no hair or background mask. Create a selection manually in Regions.',
  '这个选区标识已经存在，请重新建立选区。':
    'This selection identifier already exists. Create the selection again.',
  '另一项人像分析尚未结束。': 'Another portrait analysis is still running.',
  '人像分析输入超出预算。': 'Portrait analysis input exceeds the budget.',
  '当前浏览器不支持后台图像分析；可以继续手动精修，或在支持 OffscreenCanvas 的浏览器中识别。':
    'This browser lacks background image analysis. Continue manual refinement or use a browser with OffscreenCanvas support.',
  '当前浏览器没有可用的 WebGL 2，自动人物识别无法运行。请检查浏览器图形加速；手动局部、涂妆和液化仍可使用。':
    'WebGL 2 is unavailable, so automatic portrait detection cannot run. Check browser graphics acceleration. Manual regions, makeup, and liquify remain available.',
  '本地人像模型尚未安装；请由部署人员运行 vision:prepare。仍可使用手动局部与液化。':
    'Local portrait models are not installed. Ask the deployment operator to run vision:prepare. Manual regions and liquify remain available.',
  '人像模型资源版本与当前程序不一致。':
    'Portrait model resources do not match the current application version.',
  '缺少原始图像指纹。': 'Source image fingerprint is missing.',
  '当前设备不能创建分析画布。': 'This device cannot create an analysis canvas.',
  正在定位面部关键点: 'Locating facial landmarks',
  '正在分离皮肤、头发与背景': 'Separating skin, hair & background',
  没有分割结果: 'No segmentation result',
  '皮肤分割未完成，当前只使用面部轮廓并排除五官；请检查蒙版。':
    'Skin segmentation did not finish. Facial contours with features excluded are used instead; inspect the mask.',
  正在定位身体关键点: 'Locating body landmarks',
  '身体关键点未完成；面部结果仍可使用。':
    'Body landmarks did not finish; face results remain available.',
  '人像分析失败，请使用手动选区。': 'Portrait analysis failed. Use a manual selection.',
  '选区结构已改变，请重新选择子区域。':
    'The selection structure changed. Choose the subregion again.',
  '变换角点不存在。': 'Transform corner does not exist.',
  '这个四角变换超出当前画幅预算，请缩小范围或保留画幅。':
    'This four-corner transform exceeds the frame budget. Reduce its extent or retain frame bounds.',
  '这个四角变换会超过当前画幅预算，请缩小范围或保留画幅。':
    'This four-corner transform would exceed the frame budget. Reduce its extent or retain frame bounds.',
  '画布尚未准备好。': 'Canvas is not ready yet.',
  '请先导入图片。': 'Import an image first.',
  '原图超过 V3 的 16.8MP 编辑上限，请明确准备较小副本。':
    'The source exceeds the v3 editing limit of 16.8MP. Explicitly prepare a smaller copy.',
  '当前浏览器无法创建导出画布。': 'This browser cannot create an export canvas.',
  '图像处理失败。可降低明确选择的分辨率预算后重试。':
    'Image processing failed. Choose a lower resolution budget and try again.',
  '作品版本与来源素材不匹配，请刷新项目后重试。':
    'Image version and source asset do not match. Refresh the project and try again.',
  原始照片: 'Original photo',
  '图像处理暂时中断。请重新导入照片，已下载的配方仍可恢复。':
    'Image processing was interrupted. Reimport the photo; downloaded recipes can still restore your edits.',
  图像处理进程已中断: 'Image processing worker stopped',
  编辑器已关闭: 'Editor closed',
  导出失败: 'Export failed',
  导入时状态: 'Imported state',
  '本地文件上限为 128MiB。请选择较小副本，或在已配置的服务端导入流程中处理。':
    'Local file limit: 128MiB. Choose a smaller copy or use the configured server import workflow.',
  '这份文件未通过当前本地静态图片头检查。TIFF、部分AVIF、较大的GIF或特殊编码需要明确选择服务端规范化；服务端仍会检查内容与资源限制。':
    'This file did not pass local static-image header validation. TIFF, some AVIF, larger GIFs, and special encodings require explicit server normalization, which still validates content and resource limits.',
  '当前仅处理静态图片，不能自动丢弃动画帧。请先明确导出单帧副本。':
    'Only static images are supported here; animation frames cannot be discarded automatically. Explicitly export a single-frame copy first.',
  '图片头部与实际解码尺寸不一致，或超过当前预算，请使用重新导出的静态副本。':
    'Image header and decoded dimensions differ or exceed the budget. Use a newly exported static copy.',
  '当前浏览器无法创建图像画布。': 'This browser cannot create an image canvas.',
  '当前浏览器无法创建预览。': 'This browser cannot create a preview.',
  '合成素材未能解析，请重新选择素材或从有权访问的项目中打开。':
    'The image-layer asset could not be resolved. Choose it again or open it from an accessible project.',
  '合成素材总像素超出当前设备的 16.8MP 预算。':
    "Total image-layer pixels exceed this device's 16.8MP budget.",
  '本地图像处理器未能接收照片，请重新导入。':
    'The local image processor could not receive the photo. Reimport it.',
  '请先打开底图。': 'Open a base image first.',
  '素材读取期间底图已改变，请重新添加。':
    'The base image changed while loading this asset. Add it again.',
  '当前工作稿最多保留 8 个合成图层。': 'The current draft supports at most 8 image layers.',
  '本会话合成素材（含撤销历史）总像素上限为 16.8MP。可保存后重新打开，释放已删除素材。':
    'Image-layer assets, including undo history, are limited to 16.8MP per session. Save and reopen to release deleted assets.',
  '合成素材载入期间作品已改变。': 'The image changed while loading the image-layer asset.',
  '共享图层超出本次会话 16.8MP 素材预算，请保存草稿后重新打开作品。':
    "Shared layers exceed this session's 16.8MP asset budget. Save your draft and reopen the image.",
  '共享素材已失效，请重试。': 'The shared asset is no longer valid. Try again.',
  保存合成素材引用: 'Save image-layer references',
  '照片正在导入，请等待完成后再导出。': 'Photo import is running. Wait before exporting.',
  '请重新导入照片后再导出。': 'Reimport the photo before exporting.',
  '图像结果为空。': 'Image result is empty.',
  '无法创建导出画布。': 'Could not create export canvas.',
  '浏览器未能编码导出图片。': 'The browser could not encode the exported image.',
  '配方文件过大，请选择本工作台导出的 JSON 配方。':
    'Recipe file is too large. Choose a JSON recipe exported by this studio.',
  '读取配方期间图片已切换，配方没有应用到新图。请在当前图片准备好后重新导入。':
    'The image changed while reading the recipe. It was not applied to the new image. Reimport once the current image is ready.',
  '配方引用的合成素材不在本会话中。请从云端项目打开完整作品，或先恢复所引用的素材。':
    'Referenced image-layer assets are missing from this session. Open the complete cloud image or restore the referenced assets first.',
  '这张原图超过 v3 编辑预算，请明确准备较小副本。':
    'This source exceeds the v3 editing budget. Explicitly prepare a smaller copy.',
  正在加载本地分析模型: 'Loading local analysis models',
  '分析超时，已终止。可改用手动局部。':
    'Analysis timed out and stopped. Use manual regions instead.',
  '本地人像模型尚未安装。仍可使用手动局部、绘制与液化。':
    'Local portrait models are not installed. Manual regions, painting, and liquify remain available.',
  分析已取消: 'Analysis cancelled',
  '本地分析进程未能运行，请检查模型与 WASM 资源。':
    'The local analysis worker could not run. Check model and WASM resources.',
  '未找到可信的人像目标；可使用手动局部、绘制或液化。':
    'No reliable portrait target found. Use manual regions, painting, or liquify.',
  '请先打开对应的原图。': 'Open the matching source image first.',
  '人物标注文件上限为 2MiB。': 'Portrait annotation file limit: 2MiB.',
  '读取标注期间图片或分析任务已改变，请重新选择。':
    'The image or analysis task changed while reading annotations. Select them again.',
  '人物标注的关键点协议不受当前版本支持，请先通过对应分析适配器转换。':
    'This annotation landmark protocol is unsupported. Convert it through the appropriate analysis adapter first.',
  '标注中没有人物目标，可以继续手动精修。':
    'No portrait targets in the annotations. Manual refinement remains available.',
  '请先识别或导入人物标注。': 'Detect people or import portrait annotations first.',
  '辅助预览中断，可重新打开图片；原件未被修改。':
    'Auxiliary preview stopped. Reopen the image; the original is unchanged.',
  '暂时无法连接云端。你可以继续本地编辑，请稍后重试。':
    'Cannot connect to the cloud right now. Continue local editing and try again later.',
  '云端暂不可用，请稍后重试。': 'Cloud service is temporarily unavailable. Try again later.',
  '请求未完成，请稍后重试。': 'Request incomplete. Try again later.',
  '操作没有完成，请重试。': 'The operation did not complete. Try again.',
  '素材来源标识不可解析，请重新选择本地素材或从云端项目打开。':
    'Asset source identifier cannot be resolved. Choose the local asset again or open it from a cloud project.',
  '录音超过本地处理限制，请录制更短的内容。':
    'Recording exceeds the local processing limit. Record a shorter clip.',
  '录音长度无效，请控制在 30 秒以内。': 'Invalid recording length. Keep it within 30 seconds.',
  映间: '映间',
  '版本分页信息不一致，请重新打开作品后重试。':
    'Version pagination is inconsistent. Reopen the image and try again.',
  '当前浏览器缺少安全随机数，暂时无法提交此操作。请使用支持 Web Crypto 的浏览器。':
    'Secure randomness is unavailable in this browser. Use a browser with Web Crypto to submit this operation.',
  转换未完成: 'Conversion incomplete',
  '转换结果超过本设备下载预算，请直接下载母版或原件。':
    "Conversion exceeds this device's download limit. Download the master or original directly.",
  '最多30个标签，每个不超过40字。': 'Use up to 30 tags, each no longer than 40 characters.',
  '素材或个人标注已经变化，请重新核对。': 'The asset or personal notes changed. Review again.',
  变更角色: 'Change role',
  离开团队: 'Leave team',
};
