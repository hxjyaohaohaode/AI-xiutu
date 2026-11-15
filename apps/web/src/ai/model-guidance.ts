import { t } from '../i18n';
import type { AIModel, AIOperation } from './types';

const modelGuidance: Record<string, string> = {
  'gpt-6-astra': '旗舰推理，适合最复杂的任务',
  'gpt-6.1-sol': '接近旗舰，擅长复杂任务',
  'gpt-6.1-terra': '擅长看图推理和写作',
  'gpt-6-luna': '轻量快速，适合日常对话',
  'gpt-6-sol': '擅长编程和多步任务',
  'gpt-5.6-sol': '擅长复杂分析和专业工作',
  'gpt-5.6-terra': '适合分析、写作和日常协作',
  'gpt-5.6-luna': '快速处理简单任务',
  'gpt-5.5': '擅长编程和多步任务',
  'gpt-5.5-pro': '复杂推理，适合细致分析',
  'gpt-5.4': '擅长编程和多步任务',
  'gpt-5.4-mini': '快速看图和处理常用任务',
  'gpt-5.2': '擅长复杂分析和专业工作',
  'chat-latest': '响应快，适合日常问答',
  'gpt-image-2.6-sunburst': '擅长复杂细节和精确改图',
  'gpt-image-2.5-sunburst': '擅长复杂细节和精确改图',
  'gpt-image-2.6-flare': '出图快，适合反复试稿',
  'gpt-image-2.5-flare': '出图快，适合反复试稿',
  'gpt-image-1-mini': '轻量生图，适合快速草稿',
  'gpt-live-1': '自然交谈，支持随时打断',
  'gpt-realtime-2.1': '实时语音，擅长多步推理',
  'gpt-realtime-2.1-mini': '语音响应快，适合简短对话',
  'gpt-realtime-2': '适合需要推理的实时通话',
  'gpt-live-transcribe': '低延迟语音转文字',
  'gpt-4o-transcribe-diarize': '录音转文字并区分说话人',
  'tts-1-hd': '适合对音质有要求的朗读',
  'text-embedding-3-large': '适合精细的语义检索',
  'text-embedding-3-small': '适合常规语义检索',
  'gpt-realtime-translate': '边听边翻译，实时播报',
};

const taskGuidance: Partial<Record<AIOperation | 'realtime-voice', string>> = {
  'generate-text': '用于文案创作和润色',
  'edit-plan': '用于照片调节建议',
  speak: '把文字读成音频',
  transcribe: '把录音转换为文字',
  'audio-chat': '理解录音并回答',
  'realtime-voice': '适合实时语音对话',
  'web-search': '查询公开网页并附来源',
  embed: '把文本转成可检索的向量',
  'translate-audio': '翻译语音并播报',
};

export function preferredNarrationModel(models: readonly AIModel[]) {
  const available = models.filter((model) => model.enabled && !model.shutdownDate &&
    model.runtimeAvailable && model.runtimeOperations?.includes('speak'));
  return available.find((model) => model.id === 'gpt-4o-mini-tts') ??
    available.find((model) => model.id === 'tts-1-hd') ?? available[0];
}

export function describeModel(id: string, task?: AIOperation | 'realtime-voice', imageInput?: boolean) {
  const family = id.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{4})$/, '');
  const description = Object.hasOwn(modelGuidance, family) ? modelGuidance[family] : undefined;
  if (task === 'generate-image' && !imageInput && description === '擅长复杂细节和精确改图')
    return t('擅长复杂细节');
  if (description) return t(description);
  if (task === 'generate-image') return t(imageInput ? '支持文字生图与图片编辑' : '用于文字生图');
  return t((task && taskGuidance[task]) ?? (imageInput ? '支持文字和看图' : '支持文字对话'));
}
