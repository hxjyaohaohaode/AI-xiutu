import type { VoiceClientEvent, VoiceServerEvent, VoiceContext } from '@ai-xiutu/contracts';
import { prepareVoiceOpenings } from './voice-opening';
import {
  AI_VOICE_BUFFER_SECONDS,
  audiblePlayback,
  voicePlaybackTime,
  type PlaybackSpan,
} from './voice-playback';

export class EditorVoiceClient {
  private socket: WebSocket | null = null;
  private audio: AudioContext | null = null;
  private capture: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private speaker: GainNode | null = null;
  private microphoneTimer: ReturnType<typeof setTimeout> | undefined;
  private cancelMicrophone: (() => void) | null = null;
  private playback = new Map<AudioBufferSourceNode, PlaybackSpan>();
  private completed = new Map<string, number>();
  private openings: Awaited<ReturnType<typeof prepareVoiceOpenings>> | null = null;
  private nextAudioTime = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private failureReported = false;
  private congestedSince: number | undefined;
  private ready = false;
  private outputPaused = false;
  private blockedItems = new Set<string>();
  private ending = false;
  private serverClosed = false;
  private disposed = false;
  constructor(
    private onEvent: (event: VoiceServerEvent) => void,
    private onFailure: (message: string) => void,
    private readonly translation = false,
  ) {}
  get microphoneStream() {
    return this.stream;
  }
  async prepareMicrophone() {
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.AudioWorkletNode
    )
      throw new Error('实时通话需要 HTTPS、麦克风权限和支持 AudioWorklet 的浏览器。');
    const request = navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    this.stream = await new Promise<MediaStream>((resolve, reject) => {
      let cancelled = false;
      const cancel = (message: string) => {
        cancelled = true;
        reject(new Error(message));
      };
      this.cancelMicrophone = () => cancel('通话已取消');
      this.microphoneTimer = setTimeout(() =>
        cancel('等待麦克风授权超时。请在浏览器中允许麦克风后再通话。'), 20_000);
      void request.then((stream) => {
        if (cancelled) stream.getTracks().forEach((track) => track.stop());
        else resolve(stream);
      }, reject);
    }).finally(() => {
      clearTimeout(this.microphoneTimer);
      this.cancelMicrophone = null;
    });
    if (this.disposed) {
      this.stream.getTracks().forEach((track) => track.stop());
      throw new Error('通话已取消');
    }
    this.audio = new AudioContext({ latencyHint: 'interactive' });
    await this.audio.resume();
    try {
      const [openings] = await Promise.all([
        this.translation ? null : prepareVoiceOpenings(this.audio),
        this.audio.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url)),
      ]);
      this.openings = openings;
    } catch (cause) {
      throw new Error('无法初始化麦克风音频。请刷新页面后重试。', { cause });
    }
    if (this.disposed || !this.audio) throw new Error('通话已取消');
    const speaker = this.audio.createGain();
    speaker.gain.value = 1.5;
    const limiter = this.audio.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;
    speaker.connect(limiter);
    limiter.connect(this.audio.destination);
    this.speaker = speaker;

    this.capture = new AudioWorkletNode(this.audio, 'editor-microphone');
    const input = this.audio.createMediaStreamSource(this.stream);
    const silence = this.audio.createGain();
    silence.gain.value = 0;
    input.connect(this.capture);
    this.capture.connect(silence);
    silence.connect(this.audio.destination);
    this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.ready || this.disposed) return;
      const bytes = new Uint8Array(event.data);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      this.send({ type: 'audio', pcm: btoa(binary) });
    };
  }
  connect(path: string, ticket: string) {
    if (this.disposed || !this.audio || !/^\/v1\/voice-sessions\/[0-9a-f-]{36}\/stream$/.test(path))
      throw new Error('通话连接参数无效');
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(url, ['xiutu-voice', ticket]);
    this.readyTimer = setTimeout(() => {
      this.fail('实时语音连接未就绪，请检查网络后核验原会话。');
    }, 30_000);
    this.socket.onmessage = (message) => {
      if (this.disposed) return;
      try {
        const event = JSON.parse(String(message.data)) as VoiceServerEvent;
        if (event.type === 'ready') {
          if (this.ready || this.ending) return;
          clearTimeout(this.readyTimer);
          this.ready = true;
          this.onEvent(event);
          const opening = event.opening && this.openings?.[event.opening];
          if (opening) {
            this.scheduleAudio(opening.audio);
            this.onEvent({ type: 'transcript', role: 'assistant', text: opening.text, delta: false, itemId: 'opening' });
          }
          return;
        }
        if (event.type === 'transcript' && event.role === 'user') this.outputPaused = false;
        if (
          event.type === 'audio' &&
          !this.outputPaused &&
          (!event.itemId || !this.blockedItems.has(event.itemId))
        )
          this.enqueueAudio(event.pcm, event.itemId);
        if (event.type === 'interrupted') {
          const heard =
            this.audio &&
            audiblePlayback(this.audio.currentTime, this.playback.values(), this.completed);
          if (event.bySpeech && heard) this.send({ type: 'playback-cut', ...heard });
          this.blockPendingAudio();
          this.clearPlayback();
        }
        if (event.type === 'closed') {
          clearTimeout(this.readyTimer);
          this.serverClosed = true;
          this.ready = false;
          clearInterval(this.heartbeat);
          clearTimeout(this.disconnectTimer);
          this.stream?.getTracks().forEach((track) => track.stop());
          this.onEvent(event);
          const remaining = this.translation && this.audio?.state === 'running'
            ? this.nextAudioTime - this.audio.currentTime
            : 0;
          if (remaining > 0) {
            this.disconnectTimer = setTimeout(() => this.dispose(), Math.ceil(remaining * 1000) + 30);
          } else {
            this.dispose();
          }
          return;
        }
        this.onEvent(event);
      } catch {
        this.fail('语音事件无法解析，连接已停止。');
      }
    };
    this.socket.onclose = () => {
      if (!this.disposed && !this.serverClosed) {
        this.fail('实时连接已断开，没有自动重拨；请查看会话和额度状态。');
      }
    };
    this.socket.onerror = () => {
      this.fail('无法连接实时语音服务；请检查网络与服务器配置。');
    };
    this.heartbeat = setInterval(() => this.send({ type: 'ping' }), 10_000);
  }
  private fail(message: string) {
    if (this.failureReported || this.disposed || this.serverClosed) return;
    this.failureReported = true;
    try { this.onFailure(message); }
    finally { this.dispose(); }
  }
  private enqueueAudio(base64: string, itemId?: string) {
    if (!this.audio || this.disposed) return;
    const binary = atob(base64);
    if (!binary.length || binary.length % 2 || binary.length > 225000)
      throw new Error('Invalid audio');
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const values = new DataView(bytes.buffer);
    const buffer = this.audio.createBuffer(1, bytes.length / 2, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = values.getInt16(i * 2, true) / 32768;
    this.scheduleAudio(buffer, itemId);
  }
  private scheduleAudio(buffer: AudioBuffer, itemId?: string) {
    if (!this.audio || !this.speaker || this.disposed) return;
    const start = voicePlaybackTime(
      this.audio.currentTime,
      this.nextAudioTime,
      buffer.duration,
      AI_VOICE_BUFFER_SECONDS,
    );
    if (start === null) {
      this.interrupt();
      this.onEvent({
        type: 'error',
        code: 'VOICE_OUTPUT_BUFFER',
        message: '这段播报过长，已停止播放。可以继续通话或让助手简短回答。',
      });
      return;
    }
    const source = this.audio.createBufferSource();
    source.buffer = buffer;
    source.connect(this.speaker);
    this.nextAudioTime = start + buffer.duration;
    this.playback.set(source, { itemId, start, duration: buffer.duration });
    source.onended = () => {
      if (!this.playback.delete(source) || !itemId) return;
      this.completed.set(itemId, (this.completed.get(itemId) ?? 0) + buffer.duration);
      if (this.completed.size > 32) this.completed.delete(this.completed.keys().next().value!);
    };
    source.start(start);
  }
  private clearPlayback() {
    for (const source of this.playback.keys()) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.playback.clear();
    this.nextAudioTime = 0;
  }
  private blockPendingAudio() {
    for (const { itemId } of this.playback.values()) {
      if (itemId) this.blockedItems.add(itemId);
    }
    while (this.blockedItems.size > 32)
      this.blockedItems.delete(this.blockedItems.values().next().value!);
  }
  send(event: VoiceClientEvent) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.disposed) return;
    if (this.socket.bufferedAmount > 2_000_000) {
      this.fail('上行网络拥塞，通话已停止。');
      return;
    }
    if (event.type === 'audio') {
      if (this.socket.bufferedAmount > 160_000) {
        // Obsolete microphone frames cannot be replayed as live speech.
        const now = performance.now();
        this.congestedSince ??= now;
        if (now - this.congestedSince >= 3000) this.fail('上行网络拥塞，通话已停止。');
        return;
      }
      this.congestedSince = undefined;
    }
    if (event.type === 'text' || event.type === 'search') this.outputPaused = false;
    this.socket.send(JSON.stringify(event));
  }
  updateContext(context: VoiceContext, contextTag: string) {
    this.send({ type: 'context', context, contextTag });
  }
  mute(muted: boolean) {
    this.capture?.port.postMessage({ muted });
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.send({ type: 'mute', muted });
  }
  interrupt() {
    this.outputPaused = !this.translation;
    this.blockPendingAudio();
    const heard =
      this.audio && audiblePlayback(this.audio.currentTime, this.playback.values(), this.completed);
    this.send({
      type: 'interrupt',
      ...heard,
    });
    this.clearPlayback();
  }
  end() {
    if (this.disposed || this.ending) return;
    this.ending = true;
    clearTimeout(this.readyTimer);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.dispose();
      return;
    }
    this.ready = false;
    this.mute(true);
    this.send({ type: 'end' });
    if (!this.translation) this.clearPlayback();
    this.disconnectTimer = setTimeout(() => {
      this.onFailure('通话最终状态尚未确认，请查看用量记录。');
      this.dispose();
    }, 12_000);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    clearTimeout(this.readyTimer);
    this.cancelMicrophone?.();
    clearInterval(this.heartbeat);
    clearTimeout(this.disconnectTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.capture?.disconnect();
    this.capture = null;
    this.clearPlayback();
    this.speaker?.disconnect();
    this.speaker = null;
    void this.audio?.close();
    this.audio = null;
    this.socket?.close(1000);
    this.socket = null;
  }
}
