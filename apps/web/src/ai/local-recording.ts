import { recordingToWav } from '../lib/audio';

export type LocalRecordingPhase = 'idle' | 'preparing' | 'recording' | 'ready';
export type LocalRecordingClip = Awaited<ReturnType<typeof recordingToWav>>;
interface RecordingCallbacks {
  phase: (phase: LocalRecordingPhase) => void;
  elapsed: (seconds: number) => void;
  stream: (stream: MediaStream | null) => void;
  ready: (clip: LocalRecordingClip | null) => void;
  error: (error: unknown) => void;
}
interface RecordingEnvironment {
  media: () => Promise<MediaStream>;
  recorder: (stream: MediaStream) => MediaRecorder;
  encode: (blob: Blob) => Promise<LocalRecordingClip>;
  now: () => number;
}
const environment: RecordingEnvironment = {
  media: () =>
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      video: false,
    }),
  recorder: (stream) => {
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    return new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  },
  encode: recordingToWav,
  now: () => performance.now(),
};

/** One local take owns its permission promise, recorder and conversion. A cancelled
 * owner can never deliver a late stream/clip into a newer take. No server calls. */
export class LocalRecording {
  private live = true;
  private started = false;
  private encoding = false;
  private media: MediaStream | null = null;
  private instance: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private dependencies: RecordingEnvironment;
  constructor(
    private callbacks: RecordingCallbacks,
    dependencies: Partial<RecordingEnvironment> = {},
  ) {
    this.dependencies = { ...environment, ...dependencies };
  }
  async start() {
    if (!this.live || this.started) return;
    this.started = true;
    this.callbacks.ready(null);
    this.callbacks.phase('preparing');
    try {
      const media = await this.dependencies.media();
      if (!this.live) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      this.media = media;
      const recorder = this.dependencies.recorder(media);
      this.instance = recorder;
      recorder.ondataavailable = (event) => {
        if (!this.live || this.encoding) return;
        this.bytes += event.data.size;
        if (this.bytes > 6 * 1024 * 1024) {
          this.fail(new Error('录音过大，已停止。请重新录制较短的内容。'));
          return;
        }
        if (event.data.size) this.chunks.push(event.data);
      };
      recorder.onerror = () => this.fail(new Error('麦克风录制中断，请重新录制。'));
      recorder.onstop = () => {
        void this.finalize();
      };
      recorder.start(500);
      this.callbacks.elapsed(0);
      this.callbacks.stream(media);
      this.callbacks.phase('recording');
      const started = this.dependencies.now();
      this.interval = setInterval(() => {
        if (this.live && !this.encoding)
          this.callbacks.elapsed(Math.min(30, (this.dependencies.now() - started) / 1000));
      }, 200);
      this.timer = setTimeout(() => this.finish(), 30_000);
    } catch (error) {
      this.fail(error);
    }
  }
  finish() {
    if (!this.live || this.encoding) return;
    if (!this.instance) {
      this.cancel();
      return;
    }
    this.clearTimers();
    if (this.instance.state !== 'inactive') {
      this.callbacks.phase('preparing');
      try {
        this.instance.stop();
      } catch (error) {
        this.fail(error);
        return;
      }
    }
    this.releaseMedia();
  }
  cancel() {
    if (!this.live) return;
    this.live = false;
    this.clearTimers();
    if (this.instance) {
      this.instance.onstop = null;
      this.instance.onerror = null;
      this.instance.ondataavailable = null;
      try {
        if (this.instance.state !== 'inactive') this.instance.stop();
      } catch {
        /* Tracks still stop below. */
      }
    }
    this.releaseMedia();
    this.chunks = [];
    this.callbacks.ready(null);
    this.callbacks.phase('idle');
  }
  private clearTimers() {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.interval !== null) clearInterval(this.interval);
    this.timer = this.interval = null;
  }
  private releaseMedia() {
    this.media?.getTracks().forEach((track) => track.stop());
    this.media = null;
    this.callbacks.stream(null);
  }
  private fail(error: unknown) {
    if (!this.live) return;
    this.cancel();
    this.callbacks.error(error);
  }
  private async finalize() {
    if (!this.live || this.encoding || !this.instance) return;
    this.encoding = true;
    this.clearTimers();
    this.releaseMedia();
    this.callbacks.phase('preparing');
    try {
      const result = await this.dependencies.encode(
        new Blob(this.chunks, { type: this.instance.mimeType }),
      );
      if (!this.live) return;
      this.callbacks.elapsed(result.seconds);
      this.callbacks.ready(result);
      this.callbacks.phase('ready');
      this.live = false;
      this.chunks = [];
    } catch (error) {
      this.fail(error);
    }
  }
}
