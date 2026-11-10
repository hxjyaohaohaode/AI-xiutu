interface LocalSpeechEngine {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(track: MediaStreamTrack): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type Language = { langs: string[]; processLocally: true };
interface LocalSpeechConstructor {
  new (): LocalSpeechEngine;
  available(
    options: Language,
  ): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  install(options: Language): Promise<boolean>;
}

/** A listener can caption the received tracks locally. The AI and local mic
 * never feed this recognition track. The browser is required to stay on-device. */
export class PeerCaptions {
  private recognition?: LocalSpeechEngine;
  private restart?: ReturnType<typeof setTimeout>;
  private closed = false;
  private lastStart = 0;

  constructor(
    private readonly track: MediaStreamTrack,
    private readonly caption: (text: string) => void,
    private readonly status: (message: string) => void,
  ) {}

  async start() {
    const win = window as Window & {
      SpeechRecognition?: LocalSpeechConstructor;
      webkitSpeechRecognition?: LocalSpeechConstructor;
    };
    const Engine = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Engine || typeof Engine.available !== 'function' || typeof Engine.install !== 'function')
      throw new Error('当前浏览器不支持本机成员字幕。');
    const recognition = new Engine();
    if (!('processLocally' in recognition)) throw new Error('当前浏览器不支持本机成员字幕。');
    recognition.processLocally = true;
    if (recognition.processLocally !== true) throw new Error('无法启用本机成员字幕。');
    recognition.lang = navigator.language || 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    const options: Language = { langs: [recognition.lang], processLocally: true };
    const availability = await Engine.available(options);
    if (this.closed) return;
    if (availability === 'unavailable') throw new Error('当前设备没有此语言的本机字幕。');
    if (availability !== 'available') {
      this.status('正在准备本机字幕语言包');
      if (!(await Engine.install(options))) throw new Error('本机字幕语言包暂不可用。');
    }
    if (this.closed) return;
    this.recognition = recognition;
    const listen = () => {
      if (this.closed) return;
      this.lastStart = Date.now();
      try {
        recognition.start(this.track);
      } catch {
        this.status('本机字幕无法读取会议音频。');
        this.close();
      }
    };
    recognition.onresult = (event) => {
      if (this.closed) return;
      const last = event.results[event.results.length - 1]?.[0]?.transcript;
      if (last?.trim()) this.caption(last);
    };
    recognition.onerror = (event) => {
      if (this.closed || event.error === 'no-speech') return;
      this.status('本机字幕暂不可用，语音通话可继续。');
      this.close();
    };
    recognition.onend = () => {
      if (!this.closed)
        this.restart = setTimeout(listen, Math.max(250, 1000 - (Date.now() - this.lastStart)));
    };
    this.status('');
    listen();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.restart);
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onerror = null;
      this.recognition.onresult = null;
      this.recognition.abort();
    }
    this.track.stop();
  }
}
