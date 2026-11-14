import { t } from '../i18n';
import type { AIOperation } from './types';

const modelGuidance: Record<string, string> = {
  'gpt-6-astra': '旗舰推理，适合最复杂的任务',
  'gpt-6.1-sol': '接近 Astra，复杂任务成本更低',
  'gpt-6.1-terra': '擅长看图推理和写作',
  'gpt-6-luna': '轻量快速，适合日常对话',
  'gpt-6-sol': '通用推理，适合多步任务',
  'gpt-image-2.6-sunburst': '擅长复杂细节和精确改图',
  'gpt-image-2.5-sunburst': '擅长复杂细节和精确改图',
  'gpt-image-2.6-flare': '出图快，适合反复试稿',
  'gpt-image-2.5-flare': '出图快，适合反复试稿',
  'gpt-image-1-mini': '轻量生图，适合快速草稿',
  'gpt-live-1': '自然交谈，支持随时打断',
  'gpt-realtime-2.1': '实时语音，擅长多步推理',
  'gpt-realtime-2.1-mini': '语音响应快，成本较低',
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
  'translate-audio': '翻译语音并播报',
};

export function describeModel(id: string, task?: AIOperation | 'realtime-voice', imageInput?: boolean) {
  const family = id.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{4})$/, '');
  const description = Object.hasOwn(modelGuidance, family) ? modelGuidance[family] : undefined;
  if (task === 'generate-image' && !imageInput && description === '擅长复杂细节和精确改图')
    return t('擅长复杂细节');
  if (description) return t(description);
  if (task === 'generate-image') return t(imageInput ? '支持文字生图与图片编辑' : '用于文字生图');
  return t((task && taskGuidance[task]) ?? (imageInput ? '支持文字和看图' : '支持文字对话'));
}
