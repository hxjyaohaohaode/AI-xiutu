import { navigationAiV2English } from './navigation-ai-v2-messages';
import { nativeGradeEnglish } from './native-grade-messages';
import { viewsRedesignEnglish } from './views-redesign-messages';
import { restorationEnglish } from './restoration-messages';
import { aiRedesignEnglish } from './ai-redesign-messages';
import { finalEnglish } from './final-messages';
import { appEnglish } from './app-messages';
import { residualEnglish } from './residual-messages';
import { additionalEnglish } from './additional-messages';
import { registryEnglish } from './registry-messages';
import { aiEnglish } from './ai-messages';
import { usageEnglish } from './usage-messages';
import { workspaceEnglish } from './workspace-messages';
import { accountEnglish } from './account-messages';
import { operationsEnglish } from './operations-messages';
import { coreEnglish } from './core-messages';
import { libraryEnglish } from './library-messages';
import { editorEnglish } from './editor-messages';

/** Application-authored copy only. Source keys keep migration reviewable. */
export const english: Readonly<Record<string, string>> = {
  '画布批注': 'Canvas comments',
  '圆点标记': 'Round marker',
  '菱形标记': 'Diamond marker',
  '方框标记': 'Frame marker',
  '点选照片上的批注位置': 'Choose a spot on the photo',
  '标记形状': 'Marker shape',
  '输入画布批注': 'Write a canvas comment',
  '发表批注': 'Post comment',
  '添加批注': 'Add comment',
  '收起语音通话': 'Minimize voice call',
  ...navigationAiV2English,
  ...appEnglish,
  ...residualEnglish,
  ...additionalEnglish,
  ...registryEnglish,
  ...aiEnglish,
  ...usageEnglish,
  ...workspaceEnglish,
  ...accountEnglish,
  ...operationsEnglish,
  ...coreEnglish,
  ...libraryEnglish,
  ...editorEnglish,
  ...finalEnglish,
  ...aiRedesignEnglish,
  ...nativeGradeEnglish,
  ...restorationEnglish,
  ...viewsRedesignEnglish,
  "模型列表加载失败": "Couldn't load models",
  "重新加载": "Reload",
  "无法读取参考图，请重新选择。": "Couldn't read the reference image. Choose it again.",
  "参考图已保留，生图时使用": "Reference kept for image generation",
  "模型与参数": "Model and parameters",
  "单边上限": "Maximum edge",
  "退出": "Sign out",
  "草图文字样式": "Sketch text style",
  "字体": "Typeface",
  "无衬线": "Sans serif",
  "衬线": "Serif",
  "等宽": "Monospace",
  "字号": "Font size",
  "文字颜色": "Text color",
  "粗体": "Bold",
  "斜体": "Italic",
  "完成文字": "Finish editing text",
  "重置当前构图参数": "Reset this set of geometry controls",
  "图层预览": "Layer previews",
  "返回编辑器": "Back to editor",
  '电影 {v0}': 'Cinema {v0}',
  四角: 'Corners',
  缩放: 'Scale',
  草图添加元素: 'Add sketch elements',
  裁切像素: 'Crop dimensions',
  笔触粗细: 'Stroke width',
  '发给 AI': 'Send to AI',
  下载: 'Download',
  编辑界面截图: 'Editor screenshot',
  照片预览: 'Photo preview',
  移除附件: 'Remove attachment',
  查看附件: 'View attachment',
  '已替换底图，可在「对比」中恢复上一版本。': 'Source replaced. Restore the previous version in Compare.',
  '请选择支持图片的模型，或移除附件。': 'Choose a model that accepts images, or remove the attachment.',
  '确认 AI 调整': 'Apply AI adjustments',
  本地编辑: 'Local editing',
  格式像素上限: 'Pixel limits by format',
  '高精度导入暂不可用，普通图片仍可在本地编辑。':
    'High-precision import is unavailable. Standard images can still be edited locally.',
  '与 PSD 合成图；RAW / EXR / Radiance 暂不可用。':
    'and PSD composites; RAW, EXR and Radiance are currently unavailable.',
  '原件和派生图计入空间存储。关闭后暂停上传，已开始的处理会继续。':
    'Originals and derived images use workspace storage. Closing pauses uploads; processing already started continues.',
  语言: 'Language',
  简体中文: 'Simplified Chinese',
  繁體中文: 'Traditional Chinese',
};
