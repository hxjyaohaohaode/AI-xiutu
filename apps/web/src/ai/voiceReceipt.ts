import type { TeamVoiceSubmission } from './teamVoiceSubmission';
import type { VoiceSubmission } from './voiceSubmission';

export interface VoiceReceipt {
  id: string;
  actorId: string;
  idempotencyKey: string;
  projectId: string;
  teamArtworkId: string | null;
  state: 'prepared' | 'connecting' | 'active' | 'closed' | 'failed' | 'unknown';
  holdState: 'held' | 'unknown' | 'released' | 'settled';
}

export function isSettledVoiceReceipt(
  saved: VoiceSubmission | TeamVoiceSubmission,
  receipt: VoiceReceipt | null,
): boolean {
  if (!receipt || receipt.actorId !== saved.actorId || receipt.idempotencyKey !== saved.idempotencyKey)
    return false;
  const matches = saved.schema === 'voice-session-v1'
    ? receipt.projectId === saved.projectId && receipt.teamArtworkId === null &&
      (!saved.sessionId || receipt.id === saved.sessionId)
    : receipt.teamArtworkId === saved.artworkId;
  return matches && (receipt.state === 'closed' || receipt.state === 'failed') &&
    (receipt.holdState === 'released' || receipt.holdState === 'settled');
}
