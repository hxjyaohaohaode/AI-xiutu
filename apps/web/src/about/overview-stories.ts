import type { Locale } from '../i18n';

type StoryLabels = {
  original: string;
  adjusted: string;
  compare: string;
  tone: string;
  voiceStates: [string, string, string];
  voiceContext: string;
  voiceTitle: string;
  dialogueTitle: string;
  generationTitle: string;
  voiceDuration: string;
  recorded: string;
  imageAlt: string;
  desktop: [string, string];
  phone: [string, string];
  file: string;
};

/** Configured model for the recorded voice session. */
export const voiceExample = Object.freeze({ modelLabel: 'GPT-Realtime 2.1 Mini', voice: 'Marin', maxSeconds: 120 });

// The public preview replays these states from the recorded test call.
export const voiceReplay = {
  seconds: [5, 6, 7],
  prompt: '请用一句中文提醒我，如何检查陶瓷静物的高光。',
  answer: '你可以轻轻看一下陶瓷那一块的高光，像用眼睛扫过亮点一样，看看有没有过曝或者太白。再看整张画面有没有失去陶瓷表面的质感，确保高光只是恰到好处。',
} as const;

const labels: Record<Locale, StoryLabels> = {
  'zh-CN': {
    original: '原片',
    adjusted: '调色后',
    compare: '切换原片和调色结果',
    tone: '曲线与影调',
    voiceStates: ['正在听取', '助手回应', '麦克风关闭'],
    voiceContext: '可共享当前画面',
    voiceTitle: '语音通话',
    dialogueTitle: '对话调色',
    generationTitle: '从一段描述生成图片',
    voiceDuration: `${voiceExample.maxSeconds} 秒上限`,
    recorded: '实际请求实录',
    imageAlt: '海岸摄影展封面：蓝调时刻的灯塔和深青色海面',
    desktop: ['桌面', '画布、参数和 AI 对话并排'],
    phone: ['手机', '图片在上，工具在下，左右滑选'],
    file: '导出预览',
  },
  'zh-TW': {
    original: '原始照片',
    adjusted: '調色後',
    compare: '切換原始照片與調色結果',
    tone: '曲線與影調',
    voiceStates: ['正在聆聽', '助理回應', '麥克風關閉'],
    voiceContext: '可共享目前畫面',
    voiceTitle: '語音通話',
    dialogueTitle: '對話調色',
    generationTitle: '從一段描述生成圖片',
    voiceDuration: `${voiceExample.maxSeconds} 秒上限`,
    recorded: '實際請求實錄',
    imageAlt: '海岸攝影展封面：藍調時刻的燈塔和深青色海面',
    desktop: ['電腦', '畫布、參數與 AI 對話並排'],
    phone: ['手機', '圖片在上，工具在下，左右滑選'],
    file: '匯出預覽',
  },
  en: {
    original: 'Original',
    adjusted: 'Color grade',
    compare: 'Switch between the original and the color grade',
    tone: 'Tone and curves',
    voiceStates: ['Listening', 'Assistant speaking', 'Microphone off'],
    voiceContext: 'Share the active canvas',
    voiceTitle: 'Voice call',
    dialogueTitle: 'Color advice in chat',
    generationTitle: 'Generate an image from a prompt',
    voiceDuration: `${voiceExample.maxSeconds} s max`,
    recorded: 'Recorded from a real request',
    imageAlt: 'A lighthouse above deep teal water at blue hour, for a coastal photography exhibition',
    desktop: ['Desktop', 'Canvas, controls and AI side by side'],
    phone: ['Phone', 'Photo above, tools below. Swipe to switch.'],
    file: 'Export preview',
  },
};

export const overviewStories = (locale: Locale) => labels[locale];
export type OverviewStories = ReturnType<typeof overviewStories>;
