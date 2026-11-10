# V4 接触表人工视觉复核：第 51–67 张

## 范围与方法

按 `docs/verification/v4-image-sweep.json` 的路径字典序，实际逐张打开零基索引 51–67 共 17 张。查看使用实际渲染 JPEG，未通过参数数值推断图像效果。当前文件哈希记录时间：2026-11-10T05:17:18.648737+00:00。

每个渲染输入的长边不超过 320px，接触表单格通常为 160×128；不能把本记录称为原尺寸全像素人工验收。含人像表的现有遮罩/颈部问题已经明确提出，修正后必须保留前后证据，不能替换本次观察。以下 SHA 是本次实际查看版本，不代表未来重跑后相同文件名内容不变。

## 51 — portrait-color-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-color-1.jpg`  
SHA-256：`1bf81bbad1b908d253b63cbc3b69ae10b5033d39ae7b56b60c99399b9bec1ad8`

饱和度负端变为灰度，正端红色背景、蓝色衣服和皮肤颜色增强；自然饱和度与完全去饱和不同。色温与色调的冷暖、绿洋红方向可以实际区分。极值出现强烈偏色，不能称为自然肤色。

## 52 — portrait-curve-mask-paint.jpg

路径：`artifacts/editor-v4-sweep/portrait-curve-mask-paint.jpg`  
SHA-256：`2c799553bd633090cf56cd340ac29fb5e79e30de1009b4ddc2826b4f3084b998`

RGB、红绿蓝曲线表现不同；局部组合有不同覆盖位置。普通、正片叠底、滤色、柔光、差值及色相等混合笔迹外观可区分，中性格完整。缩图不能证明蒙版边界的每一个像素；强曲线出现明显裁切。末行未填满属于排版留白。

## 53 — portrait-detail-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-detail-1.jpg`  
SHA-256：`2767707170b69d4168fc3808c4901e8bbc41c75233ffaa428d4054cb4668fe4f`

锐化与柔化的差别较细，零值保留图像，没有看到意外几何变化。接触表不足以判定毛孔保留、锐化光晕和原尺寸细节。

## 54 — portrait-detail-v2-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-detail-v2-1.jpg`  
SHA-256：`4bd4e5ed3d74339fb871a0f70a98eb9d3b50b5e0f4adee9f645e363f1e5b543e`

纹理、清晰度负端更柔，正端局部反差增加。当前显示尺度不能据此判定原像素的纹理保真或噪声收益。

## 55 — portrait-effects-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-effects-1.jpg`  
SHA-256：`fa3a6bd4cfbafc7afd4aa1dbc9550886d8fdf0aeadbe2363e5aafd4c118b66f8`

黑白逐步去色，褪色抬黑；晕影正负和中心、半径变化可见，最小羽化的边界更硬。强颗粒可以看见，种子与粒度的细微区别不可在此尺度充分判断。长标签有截断，实际数值应查原始数据。

## 56 — portrait-face-1-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-face-1-1.jpg`  
SHA-256：`3abc4679c9d1a96681eed8e4960ce82ac54d49ffc752c3fb5f1c139ca8b0a875`

实际观察到 skinLight 正负极值的额头出现近直线的明暗分界，已作为缺陷交给引擎修正，不能记为美肤画质通过。脸部纹理、平滑及色温有作用，但强瘦脸等导致明显非自然形变。单条皱纹、痘痘识别与神经修复不由此表证明。该表为修正前记录；后续新 SHA 与修正后观察须单列。

## 57 — portrait-face-1-2.jpg

路径：`artifacts/editor-v4-sweep/portrait-face-1-2.jpg`  
SHA-256：`d877f02183361041be84d78738b1ad21f3b0fcf76cbe074cfca3314be9b46f0f`

脸型、下颌、下巴、额头、眼距等正负变化可见，零值保持人像。faceNarrow、vFace、jaw、forehead 的极端形变会让脸侧和额头轮廓明显弯曲；邻近背景也会受影响。不能称为自然脸型、背景完全固定或商用品质。

## 58 — portrait-face-1-3.jpg

路径：`artifacts/editor-v4-sweep/portrait-face-1-3.jpg`  
SHA-256：`f3e2ff09a05f1cb12fd4ee49b28dd96de8cadc4a9fedee3beec4297456af7ab7`

鼻长、唇大小、嘴角与眉毛有不同变化，鼻长负端会明显扭曲鼻口。唇妆、眼影、腮红和眉色逐步增强；腮红强端呈清楚的斑块。高光、修容与卧蚕的微细效果在接触表不足以严格判断。没有把颜色叠加说成真实三维美妆重建。

## 59 — portrait-grading-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-grading-1.jpg`  
SHA-256：`0b691a95c658d06ca23f360efbfffab5cc447966f556a107fe451e05fcdc3e5c`

阴影、中间调、高光的色相与亮度改变作用于不同明暗范围；阴影色染较明显，高光变化较细。色相 0 与 360 外观相近。强色染、抬黑和压暗的代价可见，不能当作丢失高光恢复。

## 60 — portrait-hsl-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-hsl-1.jpg`  
SHA-256：`17ac61beeb4920bf3750a605682fd34be9cc5a58d2e4865d828ae4982e5da2eb`

红色段主要改变红背景和部分皮肤，橙色段明显改变皮肤颜色。负饱和度去色，正向更鲜艳；亮度极值会丢失皮肤与背景细节。绿等占比小的色段变化较弱，不等于控件无效，也不能据此证明所有颜色的精度。

## 61 — portrait-hsl-2.jpg

路径：`artifacts/editor-v4-sweep/portrait-hsl-2.jpg`  
SHA-256：`5eb846bc4b0d3f3ad279a38b9ae16c470e9a5e21212b04cbf368c86fc756356c`

青蓝色段可明显改变衣服与旗帜。青蓝明度极端提亮时，西服出现斑驳色块与纹理损失，这是明确的极值画质风险。紫、洋红色段在这幅图中的作用较少；缩图不足以验证连续色阶。

## 62 — portrait-levels-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-levels-1.jpg`  
SHA-256：`e53ab3a1bf7b1336ad51b824b4b8295b07e232ac0ddcaddd29f5ac180bac24ed`

输入黑点高端大面积压黑，输入白点低端大面积裁白，Gamma 由暗向亮。outputBlack=1 为纯白，outputWhite=0 为纯黑，属于被设定的恒定输出，不是加载失败。中性与正常端点保留原图。

## 63 — portrait-light-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-light-1.jpg`  
SHA-256：`3623b3c47077cf8d7bde4753f36034f328786a03f531170904eac9e0ea0d2678`

曝光 -3 至 +3 的方向明显，+3 裁切大量高光；亮度与对比度的外观区别可见。阴影、黑色、白色分别影响不同明暗区域，高光变化较弱。中性格完整；不声称能够恢复源图已丢失的信息。

## 64 — portrait-optics-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-optics-1.jpg`  
SHA-256：`e1bf64c59791855028003bb32dd39b41aaf6e302e2d3c814b4398ad225af833a`

降噪行差异小，不能判定收益与细节损失。红/蓝色散的正负端有清楚的反向彩边，中心 X/Y 移动改变分离位置，中性格正常。强色散是允许的失真，不是自动相机校正质量的证明。

## 65 — portrait-transform-1.jpg

路径：`artifacts/editor-v4-sweep/portrait-transform-1.jpg`  
SHA-256：`b09fdaba370490337bb52311f8dc585e204d61fa820d5bd150357c9dcb06c3be`

旋转、水平/垂直透视、剪切、非等比缩放均有相应方向与外观。translateX/Y 的 ±1、±2 实际完全移出固定画幅，格内没有人像；这是给定构图的空输出，不能写成“所有图片均非空”。灰色底不能代替透明 alpha 验证。

## 66 — pose-body-1-1.jpg

路径：`artifacts/editor-v4-sweep/pose-body-1-1.jpg`  
SHA-256：`d64d29cdf03c53b9812f18cb1237ec0815c93dcb9050a1d456b4b045c34f0b00`

小头、颈宽、肩、腰、腿等有局部外形改变，正负端不同，中性保留瑜伽姿势。人物在接触表中很小，颈部和细肢体无法作像素级质量判断，也不足以支持自然美体结论。此表含旧 neckLength 方案；已因其他人像上的明确脸部牵动缺陷进入修正/能力禁用流程。

## 67 — pose-curve-mask-paint.jpg

路径：`artifacts/editor-v4-sweep/pose-curve-mask-paint.jpg`  
SHA-256：`712eacb42b36ed545ec9c27bbf92f7905d22c0fb0ecdbc7775a0f6810b545e09`

曲线与四通道调色、组合蒙版的提亮区域，以及 16 类混合笔迹的明暗色相有可见区别。柔光较轻，差值/排除产生青绿等颜色，中性完整。最后一行留白属于排版，不是渲染丢图；原像素边界和公式正确性需要独立自动检查。

## 结论边界

17 张均已真实打开。可见的功能方向、极值裁切、颜色变化与构图变化有记录；没有把全黑/全白、主动移出画幅与运行故障混为一谈。额头硬边属于明确需修正项；颈长牵动脸部是其他组与本组共同跟踪的问题。强脸部形变、极端 HSL 明度的斑驳以及缩图无法评价的细纹理仍是质量边界。

本记录不覆盖真实设备 UI、真实付费模型、实时语音听感、自动人像识别的总体准确率、商业美颜等价性或任意图片的视觉结果。自动像素一致性、真实浏览器工作流和人工图像复核分别记录，不能互相替代。
