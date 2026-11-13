import type { Locale } from '../i18n';
import { recordedExamples } from './recorded-examples';
import { voiceReplay } from './overview-stories';

type Item = [title: string, detail: string];
type AboutDetails = {
  local: string;
  localValues: Item[];
  portraitTitle: [string, string];
  portraitIntro: string;
  portraits: Item[];
  sketchSteps: Item[];
  sketchCards: Item[];
  layerCards: string[];
  featureStrip: string;
  close: string;
  openImage: string;
  assistantUser: string;
  assistantName: string;
  dialoguePrompt: string;
  dialogueReply: string;
  generationPrompt: string;
  imageQuality: string;
  generationStages: Item[];
  voiceLead: string;
  voiceControls: Record<'ended' | 'replay' | 'hideCaptions' | 'showCaptions' | 'mute' | 'unmute' | 'end', string>;
  voiceReplay: string;
  voiceTranscript: [string, string];
  canvasReview: string;
  reviewQueue: string;
  libraryWall: string;
  folderName: string;
  closing: string[];
};

const copy: Record<Locale, AboutDetails> = {
  'zh-CN': {
    local: '三处选区，分别调整',
    localValues: [['罐身高光', '−22'], ['窗边曝光', '+0.28 EV'], ['背景阴影', '+18']],
    portraitTitle: ['人像识别后，', '逐处细调。'],
    portraitIntro: '先确认要处理的人，再从美肤、面部、身形或美妆切入。每个参数可以单独调回零，也能随时和原片对照。',
    portraits: [
      ['美肤与质感', '调整肤质平滑与纹理，放大检查皮肤细节。'],
      ['面部微调', '沿识别到的轮廓调眼睛、眉形和嘴部，先看局部，再退回全图。'],
      ['身形与姿态', '识别身体位置后，针对当前人物调整比例。'],
      ['局部美妆', '选择对应的面部区域，在单独的控制项里调节强度。'],
    ],
    sketchSteps: [
      ['画笔与橡皮', '先用笔迹标出轮廓，需要时局部擦除。'],
      ['文字、形状和图片', '选中元素，在画布上移动、缩放或调整叠放顺序。'],
      ['草图作为参考', '下载草图、在工作台继续编辑，或主动发给 AI 作参考。'],
    ],
    sketchCards: [
      ['笔触粗细', '换不同笔宽，分别画轮廓线和强调线。'],
      ['局部擦除', '用橡皮擦修掉多余笔迹。'],
      ['形状定位', '用矩形、椭圆或三角形搭出基本构图。'],
      ['编辑文字', '移动或缩放选中的文字元素。'],
      ['选色与配色', '用快捷色或完整色谱设置当前颜色。'],
      ['放置图片', '将图片作为可移动的草图元素。'],
      ['元素不透明度', '分别调整叠放元素的透明程度。'],
      ['撤销与重做', '回到上一笔，再恢复刚才的编辑。'],
      ['调整叠放顺序', '把文字、图片和图形上移或下移。'],
      ['发送草图参考', '用当前草图向 AI 传达构图和位置。'],
    ],
    layerCards: ['图片元素', '画笔与擦除', '文字元素', '形状定位'],
    featureStrip: '草图工具示意',
    close: '关闭',
    openImage: '查看大图',
    assistantUser: '你',
    assistantName: '创作助手',
    dialoguePrompt: recordedExamples.dialogue.prompt,
    dialogueReply: recordedExamples.dialogue.answer.replaceAll('**', ''),
    generationPrompt: recordedExamples.image.prompt,
    imageQuality: '低质量档',
    generationStages: [['写下要求', '描述光线、主体和留白。'], ['确认设置', '选择模型、尺寸、质量和张数。'], ['查看结果', '检查生成图，再决定是否用于作品。']],
    voiceLead: '在同一通话里补充想法，也可以把当前画面共享给助手。',
    voiceControls: {
      ended: "通话已结束",
      replay: "重播片段",
      hideCaptions: "隐藏字幕",
      showCaptions: "显示字幕",
      mute: "静音回放",
      unmute: "恢复麦克风状态",
      end: "结束回放",
    },
    voiceReplay: '通话实录',
    voiceTranscript: [voiceReplay.prompt, voiceReplay.answer],
    canvasReview: '在图上定位批注',
    reviewQueue: '讨论与任务进度',
    libraryWall: '浏览项目样例',
    folderName: '创作参考',
    closing: ['把光影调到刚好', '画下还没成形的想法', '让版本留在作品里', '把选定的一版交付'],
  },
  'zh-TW': {
    local: '三處選區，分別調整',
    localValues: [['罐身亮部', '−22'], ['窗邊曝光', '+0.28 EV'], ['背景陰影', '+18']],
    portraitTitle: ['人像辨識後，', '逐處細調。'],
    portraitIntro: '先確認要處理的人，再從美膚、臉部、身形或美妝切入。每個參數可以單獨調回零，也能隨時和原始照片對照。',
    portraits: [
      ['美膚與質感', '調整肌膚平滑與紋理，放大檢查肌膚細節。'],
      ['臉部微調', '沿辨識到的輪廓調整眼睛、眉形和嘴部，先看局部，再回到全圖。'],
      ['身形與姿態', '辨識身體位置後，針對目前人物調整比例。'],
      ['局部美妝', '選取對應的臉部區域，在獨立控制項調整強度。'],
    ],
    sketchSteps: [
      ['畫筆與橡皮擦', '先用筆觸標出輪廓，需要時局部擦除。'],
      ['文字、形狀和圖片', '選取元素，在畫布上移動、縮放或調整堆疊順序。'],
      ['以草圖作為參考', '下載草圖、在工作台繼續編輯，或主動傳給 AI 作為參考。'],
    ],
    sketchCards: [
      ['筆觸粗細', '切換筆寬，分別畫輪廓線和強調線。'],
      ['局部擦除', '用橡皮擦修掉多餘筆觸。'],
      ['形狀定位', '用矩形、橢圓或三角形搭出基本構圖。'],
      ['編輯文字', '移動或縮放選取的文字元素。'],
      ['選色與配色', '用快捷色或完整色譜設定目前顏色。'],
      ['放置圖片', '將圖片作為可移動的草圖元素。'],
      ['元素不透明度', '分別調整堆疊元素的透明程度。'],
      ['復原與重做', '回到上一筆，再恢復剛才的編輯。'],
      ['調整堆疊順序', '把文字、圖片和圖形上移或下移。'],
      ['傳送草圖參考', '用目前草圖向 AI 傳達構圖和位置。'],
    ],
    layerCards: ['圖片元素', '畫筆與擦除', '文字元素', '形狀定位'],
    featureStrip: '草圖工具示意',
    close: '關閉',
    openImage: '檢視大圖',
    assistantUser: '你',
    assistantName: '創作助理',
    dialoguePrompt: '看這張泳池照片。保留水面的藍和牆面的暖色，用一句中文給一個曝光與亮部建議，請勿自動修改。',
    dialogueReply: '建議將曝光略微調低（−0.3 到 −0.6 EV），同時壓低亮部（−10% 到 −20%），保留水面的通透藍色和牆面的暖色層次，並減少頂光處容易過曝的反光。',
    generationPrompt: '為一場海岸攝影展生成一張方形封面：藍調時刻的燈塔、深青色海面和遠處一點琥珀光。上方留白，請勿加字。',
    imageQuality: '低品質',
    generationStages: [['寫下要求', '描述光線、主體和留白。'], ['確認設定', '選擇模型、尺寸、品質和張數。'], ['查看結果', '檢查生成的圖片，再決定是否用於作品。']],
    voiceLead: '在同一通話中補充想法，也可以把目前畫面共享給助理。',
    voiceControls: {
      ended: "通話已結束",
      replay: "重播片段",
      hideCaptions: "隱藏字幕",
      showCaptions: "顯示字幕",
      mute: "靜音回放",
      unmute: "恢復麥克風狀態",
      end: "結束回放",
    },
    voiceReplay: '通話實錄',
    voiceTranscript: ['請用一句中文提醒我，如何檢查陶瓷靜物的亮部。', '可以輕輕看一下陶瓷的亮部，像用眼睛掃過亮點一樣，看看有沒有過曝或太白。再看看整張畫面有沒有失去陶瓷表面的質感，讓亮部恰到好處。'],
    canvasReview: '在圖上定位註解',
    reviewQueue: '討論與任務進度',
    libraryWall: '瀏覽專案範例',
    folderName: '創作參考',
    closing: ['把光影調到剛好', '畫下還沒成形的想法', '讓版本留在作品裡', '把選定的一版交付'],
  },
  en: {
    local: 'Three selections, three adjustments',
    localValues: [['Vase highlights', '−22'], ['Window exposure', '+0.28 EV'], ['Background shadows', '+18']],
    portraitTitle: ['Detect the subject.', 'Refine the details.'],
    portraitIntro: 'Confirm who you want to edit, then work on skin, facial features, body or makeup. Reset individual controls or compare with the original at any time.',
    portraits: [
      ['Skin and texture', 'Adjust smoothing and texture. Zoom in to check the skin detail.'],
      ['Facial features', 'Adjust the eyes, brows and mouth along the detected contours, then review the full frame.'],
      ['Body and pose', 'Detect the body position before adjusting the selected subject’s proportions.'],
      ['Makeup', 'Choose the relevant facial area and tune its intensity with a separate control.'],
    ],
    sketchSteps: [
      ['Brush and eraser', 'Draw the outline, then erase individual marks as needed.'],
      ['Text, shapes and images', 'Select, move, resize or reorder elements directly on the canvas.'],
      ['Sketch as reference', 'Download the sketch, continue editing it or send it to AI as a reference.'],
    ],
    sketchCards: [
      ['Stroke width', 'Change the brush size for fine outlines and stronger marks.'],
      ['Erase a detail', 'Remove a stray mark with the eraser.'],
      ['Place shapes', 'Use rectangles, ellipses or triangles to set up the composition.'],
      ['Edit text', 'Move or resize the selected text element.'],
      ['Choose a color', 'Pick a swatch or set a color in the full palette.'],
      ['Place an image', 'Add an image as a movable sketch element.'],
      ['Element opacity', 'Set the transparency of overlapping elements.'],
      ['Undo and redo', 'Return to the previous stroke, then bring it back.'],
      ['Reorder elements', 'Move text, images and shapes up or down in the stack.'],
      ['Send a sketch reference', 'Use the current sketch to show AI the composition and placement.'],
    ],
    layerCards: ['Image element', 'Brush and eraser', 'Text element', 'Shape placement'],
    featureStrip: 'Sketch tool illustrations',
    close: 'Close',
    openImage: 'Enlarge image',
    assistantUser: 'You',
    assistantName: 'Creative assistant',
    dialoguePrompt: 'Look at this pool photo. In one sentence, suggest exposure and highlight settings that keep the water blue and the wall warm. Leave the edit for me.',
    dialogueReply: 'Lower exposure slightly (−0.3 to −0.6 EV) and pull back highlights (−10% to −20%) to keep the blue water clear, preserve the warm tones of the wall and reduce the risk of clipped reflections from overhead light.',
    generationPrompt: 'Create a square cover for a coastal photography exhibition. A lighthouse at blue hour, deep teal water and a distant point of amber light. Leave room at the top and omit text.',
    imageQuality: 'Low quality',
    generationStages: [['Write the brief', 'Describe the subject, light and space for a title.'], ['Check the settings', 'Choose the model, dimensions, quality and count.'], ['Review the image', 'Inspect the result and decide whether to use it.']],
    voiceLead: 'Talk through changes and choose when to share the current canvas with the assistant.',
    voiceControls: {
      ended: "Call ended",
      replay: "Replay excerpt",
      hideCaptions: "Hide captions",
      showCaptions: "Show captions",
      mute: "Mute replay",
      unmute: "Restore microphone state",
      end: "End replay",
    },
    voiceReplay: 'Recorded call',
    voiceTranscript: ['In one sentence, remind me how to check the highlights on the ceramic still life.', 'Scan the brightest parts of the ceramic for clipping or white patches. Then look at the whole image to check that the glaze still has texture and the highlights feel balanced.'],
    canvasReview: 'Comments on the canvas',
    reviewQueue: 'Discussion and task progress',
    libraryWall: 'Browse project examples',
    folderName: 'Creative references',
    closing: ['Get the light just right', 'Sketch an idea in progress', 'Keep versions with the work', 'Deliver the edit you chose'],
  },
};

export const aboutDetails = (locale: Locale) => copy[locale];
export type AboutDetailsCopy = ReturnType<typeof aboutDetails>;
