import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LocalRecording,
  type LocalRecordingClip,
  type LocalRecordingPhase,
} from '../src/ai/local-recording.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function fixture() {
  let stops = 0;
  const media = {
    getTracks: () => [
      {
        stop: () => {
          stops++;
        },
      },
    ],
  } as unknown as MediaStream;
  const recorder = {
    state: 'inactive' as RecordingState,
    mimeType: 'audio/webm',
    ondataavailable: null as MediaRecorder['ondataavailable'],
    onerror: null as MediaRecorder['onerror'],
    onstop: null as MediaRecorder['onstop'],
    start() {
      this.state = 'recording';
    },
    stop() {
      this.state = 'inactive';
      this.onstop?.call(this as unknown as MediaRecorder, new Event('stop'));
    },
  };
  const phases: LocalRecordingPhase[] = [];
  const ready: (LocalRecordingClip | null)[] = [];
  const errors: unknown[] = [];
  const callbacks = {
    phase: (value: LocalRecordingPhase) => phases.push(value),
    elapsed() {},
    stream() {},
    ready: (clip: LocalRecordingClip | null) => ready.push(clip),
    error: (error: unknown) => errors.push(error),
  };
  return {
    media,
    recorder,
    phases,
    ready,
    errors,
    callbacks,
    get stops() {
      return stops;
    },
  };
}
const clip: LocalRecordingClip = {
  wav: new Blob(['actual audio'], { type: 'audio/wav' }),
  base64: 'YWN0dWFsIGF1ZGlv',
  seconds: 1.5,
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('cancel during microphone permission stops the late stream without activating or encoding it', async () => {
  const f = fixture();
  const media = deferred<MediaStream>();
  let opened = 0,
    encoded = 0;
  const take = new LocalRecording(f.callbacks, {
    media: () => media.promise,
    recorder: () => {
      opened++;
      return f.recorder as unknown as MediaRecorder;
    },
    encode: async () => {
      encoded++;
      return clip;
    },
  });
  const starting = take.start();
  take.cancel();
  media.resolve(f.media);
  await starting;
  assert.equal(f.stops, 1);
  assert.equal(opened, 0);
  assert.equal(encoded, 0);
  assert.equal(f.phases.at(-1), 'idle');
  assert.ok(f.ready.every((value) => value === null));
});

test('cancel after stop prevents a late WAV conversion from restoring a sendable clip', async () => {
  const f = fixture();
  const conversion = deferred<LocalRecordingClip>();
  const take = new LocalRecording(f.callbacks, {
    media: async () => f.media,
    recorder: () => f.recorder as unknown as MediaRecorder,
    encode: () => conversion.promise,
  });
  await take.start();
  take.finish();
  take.cancel();
  conversion.resolve(clip);
  await settle();
  assert.equal(f.stops, 1);
  assert.equal(f.phases.at(-1), 'idle');
  assert.ok(f.ready.every((value) => value === null));
});

test('one take requests one microphone and produces one clip only after explicit stop', async () => {
  const f = fixture();
  let permissions = 0,
    conversions = 0;
  const take = new LocalRecording(f.callbacks, {
    media: async () => {
      permissions++;
      return f.media;
    },
    recorder: () => f.recorder as unknown as MediaRecorder,
    encode: async () => {
      conversions++;
      return clip;
    },
  });
  await take.start();
  await take.start();
  assert.equal(permissions, 1);
  assert.equal(f.phases.at(-1), 'recording');
  assert.ok(f.ready.every((value) => value === null));
  take.finish();
  take.finish();
  await settle();
  assert.equal(conversions, 1);
  assert.equal(f.stops, 1);
  assert.equal(f.phases.at(-1), 'ready');
  assert.deepEqual(f.ready.filter(Boolean), [clip]);
});

test('oversized local audio is discarded and never sent to conversion', async () => {
  const f = fixture();
  let conversions = 0;
  const take = new LocalRecording(f.callbacks, {
    media: async () => f.media,
    recorder: () => f.recorder as unknown as MediaRecorder,
    encode: async () => {
      conversions++;
      return clip;
    },
  });
  await take.start();
  f.recorder.ondataavailable?.call(
    f.recorder as unknown as MediaRecorder,
    { data: new Blob([new Uint8Array(6 * 1024 * 1024 + 1)]) } as BlobEvent,
  );
  await settle();
  assert.equal(f.stops, 1);
  assert.equal(conversions, 0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.phases.at(-1), 'idle');
  assert.ok(f.ready.every((value) => value === null));
});
