import { z } from 'zod';
import { voiceSessionFields, type AssistantSearchEvidence } from './assistant.js';
import { OPENAI_TRANSLATION_MODEL } from './openai-live.js';

export const TEAM_VOICE_PROTOCOL = 'xiutu-team-voice';
export const TEAM_VOICE_MAX_MEMBERS = 6;
export const TEAM_VOICE_MAX_PCM_BYTES = 9600;

export const teamVoiceInviteSchema = voiceSessionFields
  .pick({ idempotencyKey: true, modelId: true, backendModelId: true, voice: true, context: true })
  .extend({
    confirmed: z.literal(true),
    backendModelId: voiceSessionFields.shape.backendModelId.unwrap(),
    modelId: voiceSessionFields.shape.modelId.exclude([OPENAI_TRANSLATION_MODEL]),
  })
  .strict();

export const teamVoiceControlSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mute'), muted: z.boolean() }).strict(),
  z
    .object({ type: z.literal('ai-listen'), invitationId: z.string().uuid(), enabled: z.boolean() })
    .strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);
export type TeamVoiceControl = z.infer<typeof teamVoiceControlSchema>;
export type TeamVoiceAgentStatus =
  | { state: 'off'; lastOutcome?: 'closed' | 'failed' | 'unknown' }
  | {
      state: 'connecting' | 'active' | 'closing';
      hostSpeakerId: number;
      invitationId: string;
      modelId: string;
      contextReady: boolean;
    };
export type TeamVoiceEvent =
  | { type: 'joined'; speakerId: number; canInvite: boolean }
  | {
      type: 'roster';
      members: { speakerId: number; displayName: string; muted: boolean; listeningToAi: boolean }[];
      agent: TeamVoiceAgentStatus;
    }
  | {
      type: 'ai-transcript';
      role: 'user' | 'assistant';
      text: string;
      delta: boolean;
      itemId?: string;
      startMs?: number;
      endMs?: number;
    }
  | {
      type: 'ai-tool';
      name: 'consult_editor' | 'search_resources';
      state: 'running' | 'completed' | 'failed';
    }
  | { type: 'ai-result'; text: string; search?: AssistantSearchEvidence[] }
  | { type: 'ai-interrupted' }
  | { type: 'ai-context'; imageShared: boolean }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };
