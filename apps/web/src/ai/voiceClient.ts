import type { VoiceClientEvent, VoiceServerEvent, AssistantContext } from '@ai-xiutu/contracts';

export class EditorVoiceClient {
  private socket: WebSocket | null = null;
  private audio: AudioContext | null = null;
  private capture: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private playback = new Set<AudioBufferSourceNode>();
  private nextAudioTime = 0;
  private currentItemId = '';
  private itemStartTime = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private outputPaused = false;
  private blockedItem = '';
  private ending = false;
  private disposed = false;
  constructor(
    private onEvent: (event: VoiceServerEvent) => void,
    private onFailure: (message: string) => void,
  ) {}
  async prepareMicrophone() {
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.AudioWorkletNode
    )
      throw new Error('实时通话需要 HTTPS、麦克风权限和支持 AudioWorklet 的浏览器。');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (this.disposed) {
      this.stream.getTracks().forEach((track) => track.stop());
      throw new Error('通话已取消');
    }
    this.audio = new AudioContext({ latencyHint: 'interactive' });
    await this.audio.resume();
    await this.audio.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url).href);
    if (this.disposed || !this.audio) throw new Error('通话已取消');
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
    this.socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as VoiceServerEvent;
        if (event.type === 'ready') this.ready = true;
        if (event.type === 'transcript' && event.role === 'user') this.outputPaused = false;
        if (
          event.type === 'audio' &&
          !this.outputPaused &&
          (!event.itemId || event.itemId !== this.blockedItem)
        )
          this.enqueueAudio(event.pcm, event.itemId);
        if (event.type === 'interrupted') {
          this.blockedItem = this.currentItemId;
          this.clearPlayback();
        }
        if (event.type === 'closed') {
          this.onEvent(event);
          this.dispose();
          return;
        }
        this.onEvent(event);
      } catch {
        this.onFailure('语音事件无法解析，连接已停止。');
        this.dispose();
      }
    };
    this.socket.onclose = () => {
      if (!this.disposed) {
        this.onFailure('实时连接已断开，没有自动重拨；请查看会话和额度状态。');
        this.dispose();
      }
    };
    this.socket.onerror = () => {
      this.onFailure('无法连接实时语音服务；请检查网络与服务器配置。');
    };
    this.heartbeat = setInterval(() => this.send({ type: 'ping' }), 10_000);
  }
  private enqueueAudio(base64: string, itemId?: string) {
    if (!this.audio || this.disposed) return;
    const binary = atob(base64);
    if (!binary.length || binary.length % 2 || binary.length > 225000)
      throw new Error('Invalid audio');
    if (this.nextAudioTime - this.audio.currentTime > 3) {
      this.onFailure('播放队列延迟过大，已停止通话以免继续计费。');
      this.end();
      return;
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const values = new DataView(bytes.buffer);
    const buffer = this.audio.createBuffer(1, bytes.length / 2, 24000),
      channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = values.getInt16(i * 2, true) / 32768;
    const source = this.audio.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audio.destination);
    const start = Math.max(this.audio.currentTime + 0.025, this.nextAudioTime);
    if (itemId && itemId !== this.currentItemId) {
      this.currentItemId = itemId;
      this.itemStartTime = start;
    }
    this.nextAudioTime = start + buffer.duration;
    this.playback.add(source);
    source.onended = () => this.playback.delete(source);
    source.start(start);
  }
  private clearPlayback() {
    for (const source of this.playback) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.playback.clear();
    this.nextAudioTime = 0;
  }
  send(event: VoiceClientEvent) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.disposed) return;
    if (this.socket.bufferedAmount > 256_000) {
      this.onFailure('上行网络拥塞，通话已停止。');
      this.dispose();
      return;
    }
    if (event.type === 'text') this.outputPaused = false;
    this.socket.send(JSON.stringify(event));
  }
  updateContext(context: AssistantContext) {
    this.send({ type: 'context', context });
  }
  mute(muted: boolean) {
    this.capture?.port.postMessage({ muted });
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.send({ type: 'mute', muted });
  }
  interrupt() {
    const playedMs = this.audio
      ? Math.max(0, Math.floor((this.audio.currentTime - this.itemStartTime) * 1000))
      : 0;
    this.outputPaused = true;
    this.blockedItem = this.currentItemId;
    this.send({
      type: 'interrupt',
      ...(this.currentItemId ? { itemId: this.currentItemId, playedMs } : {}),
    });
    this.clearPlayback();
  }
  end() {
    if (this.disposed || this.ending) return;
    this.ending = true;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.dispose();
      return;
    }
    this.ready = false;
    this.mute(true);
    this.send({ type: 'end' });
    this.clearPlayback();
    this.disconnectTimer = setTimeout(() => {
      this.onFailure('通话最终状态尚未确认，请查看用量记录。');
      this.dispose();
    }, 12_000);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    clearInterval(this.heartbeat);
    clearTimeout(this.disconnectTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.capture?.disconnect();
    this.capture = null;
    this.clearPlayback();
    void this.audio?.close();
    this.audio = null;
    this.socket?.close(1000);
    this.socket = null;
  }
}
