import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { MultimodalProviderError } from './http.js';
import { wavPcm16 } from './wav.js';

const endpoint = 'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate';

export async function translateOpenAIAudio(
  key: string,
  wav: Uint8Array,
  language: string,
  proxy?: string,
) {
  const pcm = Buffer.from(wavPcm16(wav));
  const input = Buffer.alloc(Math.floor((pcm.length / 2) * 1.5) * 2);
  for (let index = 0; index < input.length / 2; index++) {
    const source = (index * 2) / 3;
    const left = Math.floor(source);
    const a = pcm.readInt16LE(left * 2);
    const b = left * 2 + 2 < pcm.length ? pcm.readInt16LE(left * 2 + 2) : a;
    input.writeInt16LE(Math.round(a + (b - a) * (source - left)), index * 2);
  }
  return new Promise<{ bytes: Buffer; text: string; requestId: string }>((resolve, reject) => {
    const socket = new WebSocket(endpoint, {
      headers: { Authorization: `Bearer ${key}` },
      ...(proxy ? { agent: new HttpsProxyAgent(proxy) } : {}),
      followRedirects: false,
      handshakeTimeout: 10_000,
      maxPayload: 500_000,
      perMessageDeflate: false,
    });
    let done = false;
    let updated = false;
    let ending = false;
    let position = 0;
    let requestId = '';
    let text = '';
    let total = 0;
    const audio: Buffer[] = [];
    const finish = (code?: string, outcome: 'unknown' | 'rejected' = 'unknown') => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearInterval(pacing);
      socket.terminate();
      if (code) reject(new MultimodalProviderError(code, outcome, requestId));
      else resolve({ bytes: Buffer.concat(audio, total), text, requestId });
    };
    const deadline = setTimeout(() => finish('OPENAI_TRANSLATION_TIMEOUT'), 85_000);
    let pacing: NodeJS.Timeout | undefined;
    const send = (value: object) => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 150_000) {
        finish('OPENAI_TRANSLATION_NETWORK');
        return;
      }
      socket.send(JSON.stringify(value), (error) => {
        if (error) finish('OPENAI_TRANSLATION_NETWORK');
      });
    };
    socket.on('upgrade', ({ headers }) => {
      const value = headers['x-request-id'];
      if (typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,256}$/.test(value)) requestId = value;
    });
    socket.on('error', () => finish('OPENAI_TRANSLATION_NETWORK'));
    socket.on('close', () => finish('OPENAI_TRANSLATION_INTERRUPTED'));
    socket.on('open', () =>
      send({ type: 'session.update', session: { audio: { output: { language } } } }),
    );
    socket.on('message', (raw, binary) => {
      if (done) return;
      try {
        if (binary) throw new Error('Expected JSON');
        const event = JSON.parse(raw.toString());
        if (
          ['session.created', 'session.updated'].includes(event.type) &&
          !requestId &&
          typeof event.session?.id === 'string' &&
          /^[A-Za-z0-9._:/-]{1,256}$/.test(event.session.id)
        )
          requestId = event.session.id;
        if (event.type === 'error') {
          const definite =
            !updated &&
            ['invalid_value', 'invalid_parameter', 'invalid_request_error'].includes(
              event.error?.code ?? event.error?.type,
            );
          finish('OPENAI_TRANSLATION_REJECTED', definite ? 'rejected' : 'unknown');
        } else if (event.type === 'session.updated' && !updated) {
          updated = true;
          pacing = setInterval(() => {
            if (position >= input.length) {
              clearInterval(pacing);
              ending = true;
              send({ type: 'session.close' });
              return;
            }
            const chunk = input.subarray(position, position + 4800);
            position += chunk.length;
            send({ type: 'session.input_audio_buffer.append', audio: chunk.toString('base64') });
          }, 100);
        } else if (event.type === 'session.output_transcript.delta') {
          if (typeof event.delta !== 'string' || text.length + event.delta.length > 9000)
            throw new Error('Transcript limit');
          text += event.delta;
        } else if (event.type === 'session.output_audio.delta') {
          if (
            typeof event.delta !== 'string' ||
            event.sample_rate !== 24_000 ||
            event.channels !== 1
          )
            throw new Error('Audio format');
          const bytes = Buffer.from(event.delta, 'base64');
          total += bytes.length;
          if (
            !bytes.length ||
            bytes.length % 2 ||
            bytes.toString('base64') !== event.delta ||
            total > 4_320_000
          )
            throw new Error('Audio limit');
          audio.push(bytes);
        } else if (event.type === 'session.closed') {
          if (!ending || !audio.length) throw new Error('Incomplete translation');
          if (
            !requestId &&
            typeof event.session?.id === 'string' &&
            /^[A-Za-z0-9._:/-]{1,256}$/.test(event.session.id)
          )
            requestId = event.session.id;
          finish();
        }
      } catch {
        finish('OPENAI_TRANSLATION_INVALID');
      }
    });
  });
}
