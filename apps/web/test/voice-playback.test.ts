import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audiblePlayback,
  voicePlaybackTime,
  AI_VOICE_BUFFER_SECONDS,
  PEER_VOICE_BUFFER_SECONDS,
} from '../src/ai/voice-playback.ts';

test('AI bursts keep full sentences queued while peer speech keeps a short jitter window', () => {
  let end = 0;
  for (let i = 0; i < 90; i++) {
    const start = voicePlaybackTime(0, end, 0.12, AI_VOICE_BUFFER_SECONDS);
    assert.notEqual(start, null);
    end = start! + 0.12;
  }
  assert.ok(end > 10);
  assert.equal(voicePlaybackTime(0, end, 0.12, PEER_VOICE_BUFFER_SECONDS), null);
  assert.equal(voicePlaybackTime(0, 23.95, 0.12, AI_VOICE_BUFFER_SECONDS), null);
});

test('playback interruption reports the audible item and excludes silence gaps', () => {
  const spans = new Map([
    [1, { itemId: 'older', start: 1, duration: 0.125 }],
    [2, { itemId: 'older', start: 2, duration: 1 }],
    [3, { itemId: 'queued', start: 3, duration: 1 }],
  ]);
  const completed = new Map([['older', 0.25]]);
  assert.deepEqual(audiblePlayback(2.25, spans.values(), completed), {
    itemId: 'older',
    playedMs: 625,
  });
  assert.deepEqual(audiblePlayback(3.25, spans.values(), completed), {
    itemId: 'queued',
    playedMs: 250,
  });
  assert.equal(audiblePlayback(5, spans.values(), completed), null);
});
