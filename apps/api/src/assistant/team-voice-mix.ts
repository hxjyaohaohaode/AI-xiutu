export const teamVoiceFrameMs = 20;
const frameBytes = teamVoiceFrameMs * 48;
// Keep at most 160 ms per speaker. A late packet must never build a recording.
const maxQueuedBytes = frameBytes * 8;
type Track = { bytes: Buffer; received: Float64Array; start: number; size: number };

export class TeamVoiceMixer {
  private readonly tracks = new Map<number, Track>();
  private readonly sum = new Int32Array(frameBytes / 2);
  constructor(private readonly now: () => number = () => performance.now()) {}

  push(speaker: number, packet: Buffer) {
    if (!packet.length) return;
    if (packet.length % 2) throw new RangeError('PCM16 packets require complete samples');
    const track = this.tracks.get(speaker) ?? {
      bytes: Buffer.alloc(maxQueuedBytes),
      received: new Float64Array(maxQueuedBytes / 2),
      start: 0,
      size: 0,
    };
    const input =
      packet.length > maxQueuedBytes ? packet.subarray(packet.length - maxQueuedBytes) : packet;
    const discard = Math.max(0, track.size + input.length - maxQueuedBytes);
    track.start = (track.start + discard) % maxQueuedBytes;
    track.size -= discard;
    const end = (track.start + track.size) % maxQueuedBytes;
    const first = Math.min(input.length, maxQueuedBytes - end),
      at = this.now();
    input.copy(track.bytes, end, 0, first);
    track.received.fill(at, end / 2, (end + first) / 2);
    if (first < input.length) {
      input.copy(track.bytes, 0, first);
      track.received.fill(at, 0, (input.length - first) / 2);
    }
    track.size += input.length;
    this.tracks.set(speaker, track);
  }

  drop(speaker: number) {
    this.tracks.delete(speaker);
  }

  clear() {
    this.tracks.clear();
  }

  take(allowed: ReadonlySet<number>) {
    const frames: { track: Track; bytes: number }[] = [];
    const now = this.now();
    for (const [speaker, track] of this.tracks) {
      if (!allowed.has(speaker)) {
        this.drop(speaker);
        continue;
      }
      // Event-loop stalls and permission pauses cannot turn queued speech into
      // delayed playback. Use a monotonic clock independently of queue capacity.
      while (track.size && now - track.received[track.start / 2]! > teamVoiceFrameMs * 8) {
        track.start = (track.start + 2) % maxQueuedBytes;
        track.size -= 2;
      }
      if (!track.size) {
        this.drop(speaker);
        continue;
      }
      frames.push({ track, bytes: Math.min(track.size, frameBytes) });
    }
    if (!frames.length) return;
    const output = Buffer.alloc(frameBytes);
    const sum = this.sum;
    sum.fill(0);
    let gain = 1;
    for (const { track, bytes } of frames) {
      for (let offset = 0; offset < bytes; offset += 2)
        sum[offset / 2]! += track.bytes.readInt16LE((track.start + offset) % maxQueuedBytes);
      track.start = (track.start + bytes) % maxQueuedBytes;
      track.size -= bytes;
    }
    for (const sample of sum) {
      if (sample > 32767) gain = Math.min(gain, 32767 / sample);
      if (sample < -32768) gain = Math.min(gain, -32768 / sample);
    }
    for (let i = 0; i < sum.length; i++) output.writeInt16LE(Math.round(sum[i]! * gain), i * 2);
    return output;
  }
}
