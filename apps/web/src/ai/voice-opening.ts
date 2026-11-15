import { getLocale, t } from '../i18n';

const clips = {
  en: {
    conversation: new URL('./voice-openings/opening-en.mp3', import.meta.url),
    preview: new URL('./voice-openings/opening-image-en.mp3', import.meta.url),
  },
  zh: {
    conversation: new URL('./voice-openings/opening-zh.mp3', import.meta.url),
    preview: new URL('./voice-openings/opening-image-zh.mp3', import.meta.url),
  },
};

export async function prepareVoiceOpenings(audio: AudioContext) {
  const selected = getLocale() === 'en' ? clips.en : clips.zh;
  const decode = async (resource: URL) => {
    const response = await fetch(resource, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('Voice opening unavailable');
    return audio.decodeAudioData(await response.arrayBuffer());
  };
  const [conversation, preview] = await Promise.all([
    decode(selected.conversation),
    decode(selected.preview),
  ]);
  return {
    conversation: { audio: conversation, text: t('你好。你想先调整哪里？') },
    preview: { audio: preview, text: t('你好，我能看到当前图片。想先调整哪里？') },
  };
}
