export const teamVoiceFrameMs = 20;
const frameBytes = teamVoiceFrameMs * 48;
// Keep at most 160 ms per speaker. A late packet must never build a recording.
const maxQueuedBytes = frameBytes * 8;

export class TeamVoiceMixer {
  private readonly tracks = new Map<number, Buffer>();

  push(speaker: number, packet: Buffer) {
    const previous = this.tracks.get(speaker) ?? Buffer.alloc(0);
    const queued = Buffer.concat([previous, packet]);
    this.tracks.set(speaker, queued.subarray(Math.max(0, queued.length - maxQueuedBytes)));
  }

  drop(speaker: number) {
    this.tracks.delete(speaker);
  }

  clear() {
    this.tracks.clear();
  }

  take(allowed: ReadonlySet<number>) {
    const frames: Buffer[] = [];
    for (const [speaker, queued] of this.tracks) {
      if (!allowed.has(speaker)) {
        this.drop(speaker);
        continue;
      }
      frames.push(queued.subarray(0, frameBytes));
      if (queued.length > frameBytes) this.tracks.set(speaker, queued.subarray(frameBytes));
      else this.drop(speaker);
    }
    if (!frames.length) return;
    const output = Buffer.alloc(frameBytes);
    if (frames.length === 1) {
      frames[0]!.copy(output);
      return output;
    }
    const sum = new Int32Array(frameBytes / 2);
    let gain = 1;
    for (const frame of frames)
      for (let offset = 0; offset < frame.length; offset += 2)
        sum[offset / 2]! += frame.readInt16LE(offset);
    for (const sample of sum) {
      if (sample > 32767) gain = Math.min(gain, 32767 / sample);
      if (sample < -32768) gain = Math.min(gain, -32768 / sample);
    }
    for (let i = 0; i < sum.length; i++) output.writeInt16LE(Math.round(sum[i]! * gain), i * 2);
    return output;
  }
}
