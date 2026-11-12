import type { Locale } from '../i18n';

type StoryLabels = {
  original: string;
  adjusted: string;
  compare: string;
  tone: string;
  mask: string;
  layers: string;
  layerNames: [string, string, string, string];
  galleryNames: [string, string, string, string, string, string];
  galleryArrows: [string, string];
  voiceDemo: string;
  voiceStates: [string, string, string];
  voiceDetails: [string, string, string];
  voiceContext: string;
  voiceTitle: string;
  dialogueTitle: string;
  generationTitle: string;
  outputLimit: string;
  voiceDuration: string;
  recorded: string;
  imageAlt: string;
  smallPreview: string;
  reviewDemo: string;
  editors: [string, string, string];
  reviewNotes: [string, string, string];
  desktop: [string, string];
  phone: [string, string];
  tablet: string;
  file: string;
};

/** Configured model for the recorded voice session. */
export const voiceExample = Object.freeze({ modelLabel: 'GPT-Realtime mini', voice: 'Marin', maxSeconds: 35 });

const labels: Record<Locale, StoryLabels> = {
  'zh-CN': {
    original: '原片',
    adjusted: '调色后',
    compare: '切换原片和调色结果',
    tone: '曲线与影调',
    mask: '局部选区',
    layers: '底图、笔迹与文字，分层保留',
    layerNames: ['秋日工作室 · 底图', '手绘笔迹', '标题文字', '图形图层'],
    galleryNames: ['浪线 · 摄影素材', '晚春花房 · 手机构图', '夏日水面 · 调色素材', '局部选区', '草图图层', '桌面工作台'],
    galleryArrows: ['上一张素材', '下一张素材'],
    voiceDemo: '语音通话示例',
    voiceStates: ['正在听取', '助手回应', '麦克风关闭'],
    voiceDetails: ['可以继续说话或输入文字', '播放回答时仍可查看当前照片', '可在同一通话里继续打字'],
    voiceContext: '可共享当前画面',
    voiceTitle: '语音通话',
    dialogueTitle: '对话调色',
    generationTitle: '从一段描述生成图片',
    outputLimit: '输出上限',
    voiceDuration: `${voiceExample.maxSeconds} 秒上限`,
    recorded: '实际请求实录',
    imageAlt: '海岸摄影展封面：蓝调时刻的灯塔和深青色海面',
    smallPreview: '在编辑器查看参数与生成结果',
    reviewDemo: '画布批注与协作光标示例',
    editors: ['林青 · 精修', '许舟 · 审阅', '林青 · 精修'],
    reviewNotes: ['左侧拱门提一点暗部，留住石纹', '窗口压一点高光，保留暖色', '地面的光带保留，导出一版对照'],
    desktop: ['桌面', '画布、参数和 AI 对话并排'],
    phone: ['手机', '图片在上，工具在下，左右滑选'],
    tablet: '平板 · 画布与当前参数',
    file: '导出预览',
  },
  'zh-TW': {
    original: '原始照片',
    adjusted: '調色後',
    compare: '切換原始照片與調色結果',
    tone: '曲線與影調',
    mask: '局部選區',
    layers: '底圖、筆跡與文字，分層保留',
    layerNames: ['秋日工作室 · 底圖', '手繪筆跡', '標題文字', '圖形圖層'],
    galleryNames: ['浪線 · 攝影素材', '晚春花房 · 手機構圖', '夏日水面 · 調色素材', '局部選區', '草圖圖層', '電腦工作台'],
    galleryArrows: ['上一張素材', '下一張素材'],
    voiceDemo: '語音通話範例',
    voiceStates: ['正在聆聽', '助理回應', '麥克風關閉'],
    voiceDetails: ['可以繼續說話或輸入文字', '播放回答時仍可查看目前照片', '可在同一通話裡繼續打字'],
    voiceContext: '可共享目前畫面',
    voiceTitle: '語音通話',
    dialogueTitle: '對話調色',
    generationTitle: '從一段描述生成圖片',
    outputLimit: '輸出上限',
    voiceDuration: `${voiceExample.maxSeconds} 秒上限`,
    recorded: '實際請求實錄',
    imageAlt: '海岸攝影展封面：藍調時刻的燈塔和深青色海面',
    smallPreview: '在編輯器檢視參數與生成結果',
    reviewDemo: '畫布註解與協作游標範例',
    editors: ['林青 · 精修', '許舟 · 審閱', '林青 · 精修'],
    reviewNotes: ['左側拱門提一點暗部，留住石紋', '窗口壓一點高光，保留暖色', '地面的光帶保留，匯出一版對照'],
    desktop: ['電腦', '畫布、參數與 AI 對話並排'],
    phone: ['手機', '圖片在上，工具在下，左右滑選'],
    tablet: '平板 · 畫布與目前參數',
    file: '匯出預覽',
  },
  en: {
    original: 'Original',
    adjusted: 'Color grade',
    compare: 'Switch between the original and the color grade',
    tone: 'Tone and curves',
    mask: 'Local mask',
    layers: 'Keep the photo, strokes and title on separate layers',
    layerNames: ['Autumn studio · base photo', 'Brush marks', 'Title text', 'Shape layer'],
    galleryNames: ['Atlantic shore · photograph', 'Tulips · phone framing', 'Summer pool · color study', 'Local masks', 'Sketch layers', 'Desktop editor'],
    galleryArrows: ['Previous asset', 'Next asset'],
    voiceDemo: 'Voice call example',
    voiceStates: ['Listening', 'Assistant speaking', 'Microphone off'],
    voiceDetails: ['Keep talking or type a message', 'See the active photo while audio plays', 'Keep typing in the same call'],
    voiceContext: 'Share the active canvas',
    voiceTitle: 'Voice call',
    dialogueTitle: 'Color advice in chat',
    generationTitle: 'Generate an image from a prompt',
    outputLimit: 'Output limit',
    voiceDuration: `${voiceExample.maxSeconds} s max`,
    recorded: 'Recorded from a real request',
    imageAlt: 'A lighthouse above deep teal water at blue hour, for a coastal photography exhibition',
    smallPreview: 'Model settings and result in the editor',
    reviewDemo: 'Canvas comments and collaborator cursors',
    editors: ['Lin · Retouch', 'Xu · Review', 'Lin · Retouch'],
    reviewNotes: ['Lift the arch shadows; keep the stone texture', 'Soften the window highlights and keep the warmth', 'Keep the light on the floor; export a comparison'],
    desktop: ['Desktop', 'Canvas, controls and AI side by side'],
    phone: ['Phone', 'Photo above, tools below. Swipe to switch.'],
    tablet: 'Tablet · Canvas and active controls',
    file: 'Export preview',
  },
};

export const overviewStories = (locale: Locale) => labels[locale];
export type OverviewStories = ReturnType<typeof overviewStories>;
