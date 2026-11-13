export const registryEnglish: Readonly<Record<string, string>> = {
  鼻孔阴影: 'Nostril shadows',
  '只调整有像素证据的鼻孔暗部。负值加深，正值提亮。':
    'Adjusts confirmed nostril shadows. Negative darkens; positive brightens.',
  发顶蓬松: 'Crown volume',
  '沿可见发顶轮廓调整高度。负值压低，正值抬高；保留现有发丝。':
    'Changes the height of the visible crown. Negative lowers it; positive raises it. Existing strands are preserved.',
  耳廓大小: 'Outer ear size',
  '围绕可见耳根缩放外耳轮廓。负值收小，正值放大。':
    'Resizes the outer ear around its visible base. Negative shrinks it; positive enlarges it.',
  瞳孔大小: 'Pupil size',
  '根据可见瞳孔边缘调整暗色核心，保留虹膜外缘和眼睑。':
    'Adjusts the dark center using the visible pupil boundary while preserving the outer iris and eyelids.',
  '沿可见肩部轮廓调整宽度。负值放宽，正值收窄。':
    'Changes shoulder width along the visible outline. Negative widens; positive narrows.',
  '沿可见上臂和前臂轮廓收放。负值放宽，正值收窄。':
    'Changes visible upper-arm and forearm widths. Negative widens; positive narrows.',
  '以实际腰线为边界平滑收放。负值放宽，正值收窄。':
    'Smoothly adjusts the waist along its visible outline. Negative widens; positive narrows.',
  '沿可见髋部轮廓收放。负值收窄，正值放宽。':
    'Changes hip width along the visible outline. Negative narrows; positive widens.',
  '在髋、膝和踝之间分配长度，保持脚底位置。负值缩短，正值拉长。':
    'Redistributes length between hip, knee, and ankle while keeping the feet in place. Negative shortens; positive lengthens.',
  '沿可见大腿和小腿轮廓收放。负值放宽，正值收窄。':
    'Changes visible thigh and calf widths. Negative widens; positive narrows.',
  '按可见躯干和腿部分配纵向变化。负值压缩，正值拉长。':
    'Distributes vertical changes across the visible torso and legs. Negative compresses; positive lengthens.',
  '该参数需要新版人物分析与配方。':
    'This control requires an updated portrait analysis and recipe.',
  '这个部位的可见边界不足，可以手动精修。':
    'This feature is not clearly visible. You can retouch it manually.',
  '看不清这段身体的完整轮廓或支点，可以手动调节。':
    'The outline or joints in this area are unclear. You can adjust it manually.',
  重新计算当前身形: "Recalculate this person's body edits",
  隐藏身形定位: 'Hide body landmarks',
  显示身形定位: 'Show body landmarks',
  曝光: 'Exposure',
  '在线性光域乘以 2^EV；不恢复照片已截断的高光。':
    'Multiplies linear light by 2^EV; cannot recover clipped highlights.',
  亮度: 'Brightness',
  '中间调伽马曲线，黑白端保持；与曝光独立。':
    'Midtone gamma curve with black and white endpoints preserved; independent of exposure.',
  对比度: 'Contrast',
  '以中灰为枢轴的连续曲线；正值拉开明暗。':
    'Continuous curve pivoting around midgray; positive values increase tonal separation.',
  高光: 'Highlights',
  '调整亮部曲线控制点，不伪造丢失细节。':
    'Adjusts highlight curve points without inventing lost detail.',
  阴影: 'Shadows',
  '调整暗部曲线控制点，可提亮或压暗。': 'Adjusts shadow curve points to brighten or darken.',
  白色色阶: 'Whites',
  '明亮端的输出偏移；正值提亮，可能剪切。':
    'Output offset at the bright end; positive values brighten and may clip.',
  黑色色阶: 'Blacks',
  '暗端的输出偏移；正值抬黑，负值压黑。':
    'Output offset at the dark end; positive lifts blacks, negative deepens them.',
  饱和度: 'Saturation',
  '围绕亮度调整色彩幅度，-100 为灰阶。':
    'Changes color amplitude around luminance; −100 produces grayscale.',
  自然饱和度: 'Vibrance',
  '较低饱和色获得较多调整；不含人物或肤色识别。':
    'Adjusts less-saturated colors more strongly; no person or skin detection.',
  色温: 'Temperature',
  '相对冷暖通道增益；正暖负冷，不是拍摄开尔文值。':
    'Relative warm/cool channel gain. Positive warms, negative cools; not capture temperature in kelvin.',
  色调: 'Tint',
  '相对绿—洋红轴；正值洋红、负值绿色。':
    'Relative green–magenta axis. Positive adds magenta, negative adds green.',
  锐化: 'Sharpening',
  '有限 3×3 邻域的阈值非锐化蒙版；不增加真实细节。':
    'Thresholded unsharp mask within a bounded 3×3 neighborhood; does not create real detail.',
  柔化: 'Softening',
  '有限 3×3 保边柔化；局部模式按手动选区作用，不检测皮肤。':
    'Edge-preserving 3×3 softening. Local mode uses the manual selection, without skin detection.',
  输入黑场: 'Input black',
  '每通道输入低端；须低于输入白场至少0.0001。':
    'Per-channel lower input bound; must be at least 0.0001 below input white.',
  输入白场: 'Input white',
  '每通道输入高端；越界值会裁切。': 'Per-channel upper input bound; values beyond it are clipped.',
  色阶伽马: 'Levels gamma',
  '归一化通道做 x^(1/gamma)，大于1提亮中间值。':
    'Applies x^(1/gamma) to normalized channels. Values above 1 brighten midtones.',
  输出黑场: 'Output black',
  '映射到输出低端；不得高于输出白场。': 'Lower output bound; cannot exceed output white.',
  输出白场: 'Output white',
  '映射到输出高端；可与低端相同得到常量。':
    'Upper output bound. Matching the lower bound produces a constant.',
  红色色相: 'Red hue',
  '相邻色段线性混合的色相偏移；正值沿RGB色相环递增。':
    'Hue shift with linear blending between adjacent bands; positive moves forward on the RGB hue wheel.',
  红色饱和: 'Red saturation',
  '负向去色，正向满饱和；灰色不按虚构色相分配。':
    'Negative removes color, positive increases saturation. Gray is not assigned an invented hue.',
  红色明度: 'Red lightness',
  '调整该色段的HSL明度，正向白、负向黑。':
    "Changes this band's HSL lightness: positive toward white, negative toward black.",
  橙色色相: 'Orange hue',
  橙色饱和: 'Orange saturation',
  橙色明度: 'Orange lightness',
  黄色色相: 'Yellow hue',
  黄色饱和: 'Yellow saturation',
  黄色明度: 'Yellow lightness',
  绿色色相: 'Green hue',
  绿色饱和: 'Green saturation',
  绿色明度: 'Green lightness',
  青色色相: 'Aqua hue',
  青色饱和: 'Aqua saturation',
  青色明度: 'Aqua lightness',
  蓝色色相: 'Blue hue',
  蓝色饱和: 'Blue saturation',
  蓝色明度: 'Blue lightness',
  紫色色相: 'Purple hue',
  紫色饱和: 'Purple saturation',
  紫色明度: 'Purple lightness',
  洋红色色相: 'Magenta hue',
  洋红色饱和: 'Magenta saturation',
  洋红色明度: 'Magenta lightness',
  阴影分级色相: 'Shadow grading hue',
  '选择染色色相；饱和为0时色相不产生效果。':
    'Choose a tint hue; hue has no effect at zero saturation.',
  阴影分级强度: 'Shadow grading strength',
  '加入有界的零亮度代理色偏；三个亮度区连续混合。':
    'Adds a bounded zero-luminance-proxy color offset; three tonal ranges blend continuously.',
  阴影分级明暗: 'Shadow grading light',
  '在该亮度区加入最多±0.2的编码通道偏移。':
    'Adds up to ±0.2 encoded-channel offset within this tonal range.',
  中间调分级色相: 'Midtone grading hue',
  中间调分级强度: 'Midtone grading strength',
  中间调分级明暗: 'Midtone grading light',
  高光分级色相: 'Highlight grading hue',
  高光分级强度: 'Highlight grading strength',
  高光分级明暗: 'Highlight grading light',
  分级平衡: 'Grading balance',
  '把中间锚点从0.25移至0.75；不改变中性分级。':
    'Moves the middle anchor from 0.25 to 0.75; neutral grading is unchanged.',
  纹理对比: 'Texture contrast',
  '3×3亮度高频有阈值增减；不识别人像或创造纹理。':
    'Thresholded adjustment of 3×3 high-frequency luminance; does not detect portraits or invent texture.',
  局部清晰度: 'Local clarity',
  '5×5亮度高频，按中间调权重增减；负值柔和局部明暗。':
    'Adjusts 5×5 high-frequency luminance with midtone weighting; negative values soften local tones.',
  黑白混合: 'Monochrome blend',
  '向线性Rec.709亮度灰阶混合，100为无彩色。':
    'Blends toward linear Rec.709 luminance grayscale; 100 removes color.',
  褪色: 'Fade',
  '抬黑压白，最大映射到0.12…0.88；不模拟胶片化学。':
    'Lifts blacks and lowers whites, up to a 0.12–0.88 range; does not simulate film chemistry.',
  暗角强度: 'Vignette strength',
  '正值使外部暗至−2EV，负值使外部亮至+2EV。':
    'Positive darkens outer areas to −2EV; negative brightens them to +2EV.',
  暗角中心X: 'Vignette center X',
  '完整已定向原图的归一化横坐标。':
    'Normalized horizontal coordinate in the complete, oriented source image.',
  暗角中心Y: 'Vignette center Y',
  '完整已定向原图的归一化纵坐标。':
    'Normalized vertical coordinate in the complete, oriented source image.',
  暗角横向半径: 'Vignette horizontal radius',
  '相对原图宽度的椭圆半径；裁切不重新解释。':
    'Ellipse radius relative to source width; cropping does not reinterpret it.',
  暗角纵向半径: 'Vignette vertical radius',
  '相对原图高度的椭圆半径。': 'Ellipse radius relative to source height.',
  暗角过渡: 'Vignette falloff',
  '平滑过渡的半径占比；0为硬边。':
    'Fraction of the radius used for smooth falloff; 0 creates a hard edge.',
  颗粒强度: 'Grain strength',
  '有界固定种子程序噪声，不等同真实胶片或相机噪声。':
    'Bounded procedural noise with a fixed seed; not real film or camera noise.',
  颗粒间距: 'Grain spacing',
  '格点间距按输入像素计；缩小预览只近似。':
    'Grid spacing in input pixels; reduced previews are approximate.',
  颗粒种子: 'Grain seed',
  '无符号32位整数；相同坐标与种子得到同一颗粒。':
    'Unsigned 32-bit integer. Identical coordinates and seed produce identical grain.',
  精细旋转: 'Fine rotation',
  '绕裁切画幅中心顺时针为正；透明区域保持透明。':
    'Positive rotates clockwise around the crop center; transparency is preserved.',
  水平透视: 'Horizontal perspective',
  '平面投影的水平倾斜；非三维重建。':
    'Horizontal tilt in a planar projection; not 3D reconstruction.',
  垂直透视: 'Vertical perspective',
  '平面投影的垂直倾斜。': 'Vertical tilt in a planar projection.',
  水平倾斜: 'Horizontal skew',
  '水平仿射剪切；接近奇异的组合会拒绝。':
    'Horizontal affine shear; near-singular combinations are rejected.',
  垂直倾斜: 'Vertical skew',
  '垂直仿射剪切。': 'Vertical affine shear.',
  横向缩放: 'Horizontal scale',
  '相对于裁切画幅宽度的缩放倍数。': 'Scale relative to the cropped frame width.',
  纵向缩放: 'Vertical scale',
  '相对于裁切画幅高度的缩放倍数。': 'Scale relative to the cropped frame height.',
  水平位移: 'Horizontal offset',
  '相对于裁切画幅宽度；保留画幅模式可见。':
    'Offset relative to cropped frame width; visible when retaining frame bounds.',
  垂直位移: 'Vertical offset',
  '相对于裁切画幅高度；保留画幅模式可见。':
    'Offset relative to cropped frame height; visible when retaining frame bounds.',
  明度降噪: 'Luminance noise reduction',
  '固定5×5边缘权重邻域，只混合亮度代理。':
    'Blends only the luminance proxy in a fixed, edge-weighted 5×5 neighborhood.',
  色彩降噪: 'Color noise reduction',
  '固定5×5邻域，独立平滑色度差值。':
    'Smooths chroma differences independently within a fixed 5×5 neighborhood.',
  红色色散: 'Red fringing',
  '相对于中心的径向红通道位移，负值反向。':
    'Radial red-channel offset from the center; negative reverses direction.',
  蓝色色散: 'Blue fringing',
  '相对于中心的径向蓝通道位移，负值反向。':
    'Radial blue-channel offset from the center; negative reverses direction.',
  '色散中心 X': 'Fringing center X',
  '原图横向归一化中心。': 'Normalized horizontal source-image center.',
  '色散中心 Y': 'Fringing center Y',
  '原图纵向归一化中心。': 'Normalized vertical source-image center.',
  红: 'Red',
  橙: 'Orange',
  黄: 'Yellow',
  绿: 'Green',
  青: 'Aqua',
  蓝: 'Blue',
  紫: 'Purple',
  洋红: 'Magenta',
  磨皮: 'Skin smoothing',
  '在面部皮肤选区内做保边柔化；保留眼睛、眉毛与嘴唇。':
    'Edge-preserving softening within facial skin selections; protects eyes, eyebrows, and lips.',
  纹理弱化: 'Texture reduction',
  '减弱选中皮肤的局部纹理；不承诺识别或消除全部皱纹。':
    'Reduces local skin texture; does not guarantee detection or removal of every wrinkle.',
  皮肤肌理: 'Skin texture',
  '双向改变皮肤局部高频对比，负值柔化，正值增强。':
    'Adjusts skin high-frequency contrast in both directions: negative softens, positive strengthens.',
  肤色明暗: 'Skin lightness',
  '双向调整局部线性曝光，避免预设一种理想肤色。':
    'Adjusts local linear exposure in both directions without prescribing an ideal skin tone.',
  匀肤: 'Even skin tone',
  '降低皮肤色度噪声和局部明度差异，不重绘五官。':
    'Reduces skin chroma noise and local brightness differences without repainting features.',
  柔化油光: 'Soften shine',
  '根据局部饱和度下降和亮度峰值衰减反光，保留皮肤基础光影。':
    'Reduces reflections using local saturation drops and brightness peaks while preserving underlying lighting.',
  淡化斑点: 'Reduce spots',
  '用多方向一致性找局部孤立明暗点，保护连续纹理与五官。':
    'Uses multidirectional consistency to find isolated light/dark spots while protecting continuous texture and facial features.',
  淡化色斑: 'Reduce discoloration',
  '根据周围同一皮肤区域的色度减弱局部色斑，可与肌理分开调整。':
    'Reduces local discoloration using surrounding skin chroma; independent of texture controls.',
  肤色冷暖: 'Skin warmth',
  '以识别或校正后的皮肤区域调整冷暖。': 'Adjusts warmth within detected or corrected skin regions.',
  气色: 'Complexion',
  '皮肤选区内的洋红—绿轴和饱和度微调。':
    'Fine-tunes the magenta–green axis and saturation within skin selections.',
  眼下明暗: 'Under-eye light',
  '在眼下小区域双向调整曝光，不假设所有暗部都是黑眼圈。':
    'Adjusts exposure in small under-eye areas; does not assume every shadow is a dark circle.',
  亮眼: 'Eye brightness',
  '在眼部关键点围合范围调整曝光与细节，保留眼形。':
    'Adjusts exposure and detail within eye landmark boundaries, preserving eye shape.',
  眉毛增强: 'Eyebrow definition',
  '仅眉毛范围内调整对比和细节。': 'Adjusts contrast and detail only within eyebrow regions.',
  鼻梁光影: 'Nose bridge lighting',
  '鼻梁范围的局部加深减淡；不是三维面部重建。':
    'Local dodge and burn along the nose bridge; not 3D facial reconstruction.',
  '瘦脸 / 宽脸': 'Slim / widen face',
  '按两侧面部轮廓生成相向或反向局部推移。':
    'Creates inward or outward local displacement along both facial contours.',
  '小脸 / 大脸': 'Smaller / larger face',
  '对脸部中心做有界收缩 / 膨胀。': 'Bounded pinch or expansion around the face center.',
  '窄脸 / 宽脸': 'Narrow / widen face',
  '沿脸颊中段改变宽度；边界由关键点限定。':
    'Changes width through the mid-cheek region within landmark boundaries.',
  下脸收窄: 'Lower-face width',
  '只改变下半脸轮廓，正负值可反向。':
    'Changes only the lower facial contour; positive and negative values reverse direction.',
  太阳穴: 'Temples',
  '在眉端附近做局部膨胀 / 收缩。': 'Local expansion or contraction near the brow ends.',
  颧骨: 'Cheekbones',
  '在颧骨区域做左右方向局部推移。': 'Local horizontal displacement around the cheekbones.',
  下颌角: 'Jaw corners',
  '在下颌两侧做局部水平推移。': 'Local horizontal displacement on both sides of the jaw.',
  下巴长短: 'Chin length',
  '沿面部轴线移动下巴区域。': 'Moves the chin region along the facial axis.',
  额头比例: 'Forehead proportion',
  '调整上额局部位置；不重建真实发际线。':
    'Adjusts local forehead position without reconstructing the true hairline.',
  眼睛大小: 'Eye size',
  '双眼分别按关键点中心做局部缩放。': 'Scales each eye locally around its landmark center.',
  眼间距: 'Eye spacing',
  '对两眼区域作相反方向的水平推移。':
    'Moves the two eye regions horizontally in opposite directions.',
  眼睛旋转: 'Eye rotation',
  '对双眼区域施加方向相反的有界旋转。':
    'Applies opposite bounded rotations to the two eye regions.',
  鼻翼宽度: 'Nose width',
  '鼻翼区域左右推移。': 'Moves the nose-wing regions horizontally.',
  鼻尖位置: 'Nose tip position',
  '在鼻尖小区域沿面部轴线推移。': 'Moves the small nose-tip region along the facial axis.',
  鼻长: 'Nose length',
  '沿鼻部轴线调整鼻部局部长度。': 'Adjusts local nose length along its axis.',
  嘴唇大小: 'Lip size',
  '对嘴唇区域局部收缩 / 膨胀，保留外部画面。':
    'Locally pinches or expands the lips while preserving the surrounding image.',
  嘴角: 'Mouth corners',
  '两侧嘴角的局部向上 / 向下推移。': 'Moves both mouth corners locally upward or downward.',
  眉毛粗细: 'Eyebrow thickness',
  眼宽: 'Eye width',
  '沿双眼轴调整内外眼角间的跨度。负值收窄，正值加宽。':
    'Change the distance between eye corners along the eye axis. Negative narrows and positive widens.',
  眼高: 'Eye height',
  '沿面部竖轴对向调整上下眼睑。负值收窄，正值加高。':
    'Move upper and lower eyelids along the face axis. Negative narrows and positive opens.',
  眼睑下至: 'Lower eyelid',
  '移动下眼睑的独立作用区。负值抬高，正值压低。':
    'Move the lower eyelid independently. Negative lifts and positive lowers.',
  虹膜大小: 'Iris size',
  '根据可见虹膜关键点局部缩放，作用范围由眼睑限制。':
    'Scale around visible iris landmarks within the eyelid boundary.',
  嘴宽度: 'Mouth width',
  '双向调整嘴角的横向跨度。': 'Increase or decrease the distance between the corners of the mouth.',
  丰上唇: 'Upper lip fullness',
  '独立调整上唇外缘厚度，限制范围以保护口腔。':
    'Adjust the outer upper lip within a bounded area to protect the mouth opening.',
  丰下唇: 'Lower lip fullness',
  '独立调整下唇外缘厚度，限制范围以保护口腔。':
    'Adjust the outer lower lip within a bounded area to protect the mouth opening.',
  眉毛位置: 'Eyebrow position',
  '沿面部竖轴移动眉形中心。负值下移，正值抬高。':
    'Move the brow center along the face axis. Negative lowers and positive raises.',
  '该部位的可见轮廓不足，无法精确塑形。':
    'The visible outline is insufficient for precise reshaping.',
  '局部缩放眉毛区域，不生成新毛发。':
    'Scales eyebrow regions locally without generating new hairs.',
  头部大小: 'Head size',
  '依据姿态耳部和肩部关键点定位头部后局部缩放。':
    'Locates and scales the head using ear and shoulder pose landmarks.',
  颈部比例: 'Neck proportion',
  '依据肩部和耳部锚点进行有界局部推移。':
    'Bounded local displacement using shoulder and ear anchors.',
  颈部宽度: 'Neck width',
  '颈部两侧局部推移，超出可见范围不猜测。':
    'Moves the neck sides locally; does not infer beyond visible boundaries.',
  肩宽: 'Shoulder width',
  '左右肩部区域沿肩轴相向或反向推移。':
    'Moves shoulder regions toward or away from each other along the shoulder axis.',
  手臂轮廓: 'Arm contour',
  '肩肘腕间的局部径向收缩 / 膨胀。':
    'Local radial pinch or expansion between shoulder, elbow, and wrist.',
  腰部轮廓: 'Waist contour',
  '肩—髋之间的局部径向收缩 / 膨胀。': 'Local radial pinch or expansion between shoulders and hips.',
  胯部轮廓: 'Hip contour',
  '髋关节两侧区域有界局部缩放。': 'Bounded local scaling on both sides of the hip joints.',
  腿部比例: 'Leg proportion',
  '依据髋膝踝锚点对膝踝局部作纵向推移；非人体三维重建。':
    'Moves knee and ankle regions vertically using hip, knee, and ankle anchors; not 3D body reconstruction.',
  腿部轮廓: 'Leg contour',
  '大腿与小腿分段局部收缩 / 膨胀。': 'Local pinch or expansion of upper and lower leg segments.',
  身形纵向: 'Body length',
  '依据肩髋膝踝分段纵向推移；边界采用钳位取样，需检查纹理拉伸。':
    'Segmented vertical displacement using shoulder, hip, knee, and ankle anchors. Boundaries use clamped sampling; inspect for stretched texture.',
  口红: 'Lipstick',
  '在嘴唇关键点蒙版内使用颜色混合；不涂满口腔。':
    'Blends color within the lip landmark mask without filling the mouth interior.',
  眼影: 'Eyeshadow',
  '眼睑上方柔边色彩叠加，独立于眼睛颜色。':
    'Soft-edged color above the eyelids, independent of eye color.',
  腮红: 'Blush',
  '双颊柔边叠色，强度可独立降低至零。':
    'Soft-edged cheek color; strength can be reduced independently to zero.',
  修容: 'Contour makeup',
  '脸部两侧柔光叠色，保留纹理。': 'Soft-light color on the face sides, preserving texture.',
  高光妆: 'Highlight makeup',
  '鼻梁和颊部柔光笔触，透明度独立。':
    'Soft-light strokes on the nose bridge and cheeks with independent opacity.',
  眉妆: 'Brow makeup',
  '眉毛范围内的乘色叠加，可换任意RGBA颜色。':
    'Multiply color within eyebrows; any RGBA color can be used.',
  卧蚕妆: 'Under-eye highlight',
  '眼下柔边高光，不改变原有几何。': 'Soft-edged under-eye highlights without geometry changes.',
};
