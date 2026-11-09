export async function recordingToWav(
  blob: Blob,
): Promise<{ wav: Blob; base64: string; seconds: number }> {
  if (blob.size > 6 * 1024 * 1024) throw new Error('录音超过本地处理限制，请录制更短的内容。');
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration < 0.1 || decoded.duration > 32)
      throw new Error('录音长度无效，请控制在 30 秒以内。');
    const frames = Math.min(480_000, Math.ceil(decoded.duration * 16_000));
    const offline = new OfflineAudioContext(1, frames, 16_000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    ascii(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16_000, true);
    view.setUint32(28, 32_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]!));
      view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    const bytes = new Uint8Array(buffer);
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192)
      parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    return {
      wav: new Blob([buffer], { type: 'audio/wav' }),
      base64: btoa(parts.join('')),
      seconds: frames / 16_000,
    };
  } finally {
    await context.close();
  }
}
