export const AI_VOICE_BUFFER_SECONDS = 24;
export const PEER_VOICE_BUFFER_SECONDS = 0.45;

export function voicePlaybackTime(
  now: number,
  previousEnd: number,
  duration: number,
  budget: number,
) {
  const start = Math.max(now + 0.025, previousEnd);
  return start + duration - now <= budget ? start : null;
}

export interface PlaybackSpan {
  itemId?: string;
  start: number;
  duration: number;
}

/** Use the audio clock and the item actually playing when the listener interrupts. */
export function audiblePlayback(
  now: number,
  spans: Iterable<PlaybackSpan>,
  completed: ReadonlyMap<string, number>,
) {
  const scheduled = [...spans];
  const pending = scheduled.filter((span) => now < span.start + span.duration);
  const audible = pending.find((span) => span.start <= now) ?? pending[0];
  if (!audible?.itemId) return null;
  let seconds = completed.get(audible.itemId) ?? 0;
  for (const span of scheduled)
    if (span.itemId === audible.itemId)
      seconds += Math.min(span.duration, Math.max(0, now - span.start));
  return { itemId: audible.itemId, playedMs: Math.floor(seconds * 1000) };
}
