/** Raw microphone capture. No MediaRecorder, no upload-after-recording path. */
class EditorMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tail = [];
    this.position = 0;
    this.pending = [];
    this.muted = false;
    this.port.onmessage = (event) => {
      this.muted = event.data?.muted === true;
      if (this.muted) {
        this.tail = [];
        this.position = 0;
        this.pending = [];
      }
    };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || this.muted) return true;
    const samples = this.tail.concat(Array.from(input));
    const step = sampleRate / 24000;
    while (this.position + 1 < samples.length) {
      const index = Math.floor(this.position),
        fraction = this.position - index;
      const value = Math.max(
        -1,
        Math.min(1, samples[index] * (1 - fraction) + samples[index + 1] * fraction),
      );
      this.pending.push(Math.round(value < 0 ? value * 32768 : value * 32767));
      this.position += step;
      if (this.pending.length === 480) {
        const frame = new ArrayBuffer(960),
          view = new DataView(frame);
        this.pending.forEach((sample, i) => view.setInt16(i * 2, sample, true));
        this.port.postMessage(frame, [frame]);
        this.pending = [];
      }
    }
    const consumed = Math.min(Math.floor(this.position), samples.length);
    this.tail = samples.slice(consumed);
    this.position -= consumed;
    return true;
  }
}
registerProcessor('editor-microphone', EditorMicrophone);
