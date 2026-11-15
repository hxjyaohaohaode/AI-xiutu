import { getLocale, t } from '../i18n';
import conversationEn from './voice-openings/opening-en.mp3';
import previewEn from './voice-openings/opening-image-en.mp3';
import previewZh from './voice-openings/opening-image-zh.mp3';
import conversationZh from './voice-openings/opening-zh.mp3';

export async function prepareVoiceOpenings(audio: AudioContext) {
  const english = getLocale() === 'en';
  const decode = async (resource: string) => {
    const response = await fetch(resource, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('Voice opening unavailable');
    return audio.decodeAudioData(await response.arrayBuffer());
  };
  const [conversation, preview] = await Promise.all([
    decode(english ? conversationEn : conversationZh),
    decode(english ? previewEn : previewZh),
  ]);
  return {
    conversation: { audio: conversation, text: t('你好。你想先调整哪里？') },
    preview: { audio: preview, text: t('你好，我能看到当前图片。想先调整哪里？') },
  };
}
