export const VOICE_SUBMISSION_CHANGED = 'xiutu:voice-submission-changed';

export function voiceSubmissionStorageKey(actorId: string, kind: 'individual' | 'team') {
  return `xiutu:${kind === 'team' ? 'team-voice' : 'voice'}-submission:${actorId}`;
}

/** A browser-local guard; the server remains the account-wide admission authority. */
export function assertNoOtherVoiceSubmission(
  storage: Pick<Storage, 'getItem'>,
  actorId: string,
  kind: 'individual' | 'team',
) {
  const other = kind === 'team' ? 'individual' : 'team';
  if (storage.getItem(voiceSubmissionStorageKey(actorId, other)))
    throw new Error(
      other === 'team'
        ? '上次团队 AI 邀请仍待确认，请先核对原通话。'
        : '上次个人 AI 通话仍待确认，请先核对原通话。',
    );
}

export function notifyVoiceSubmissionChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VOICE_SUBMISSION_CHANGED));
}
