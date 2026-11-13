import { randomUUID } from 'node:crypto';
import { OPENAI_DECISIONS_MODEL, OPENAI_TRANSLATION_MODEL,
  type LiveDelegationOptions, type LiveTranslationOptions, type VoiceServerEvent } from '@ai-xiutu/contracts';
import { responsesParameters, voiceModel, type AssistantModelConfig, type LiveOptions } from './models.js';
import type { HistoryMessage } from './context-budget.js';

function boundedLiveText(value: string): string {
  let output = '';
  let bytes = 0;
  for (const character of value) {
    const count = Buffer.byteLength(character);
    if (bytes + count > 450) break;
    output += character;
    bytes += count;
  }
  return output;
}

export function liveContextAppend(
  channel: 'thinking' | 'commentary' | 'instructions',
  content: string,
  delegationId: string | null = null,
) {
  return {
    type: `session.${channel}.append`,
    event_id: `evt_${randomUUID()}`,
    delegation_id: delegationId,
    content: boundedLiveText(content),
  };
}

export const LIVE_URL = 'wss://api.openai.com/v1/live/sessions';
export function voiceEndpoint(modelId: string): string {
  if (modelId === OPENAI_TRANSLATION_MODEL)
    return 'wss://api.openai.com/v1/realtime/translations?model=' + OPENAI_TRANSLATION_MODEL;
  return voiceModel(modelId).protocol === 'live'
    ? LIVE_URL
    : `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(modelId)}`;
}
const voiceInstructions =
  '你是图片创作助手，跟随用户的语言，自然地短句交流。只有收到应用结果才能确认任务已保存、已生成或需要确认。画面共享有时效，涉及当前图像时使用最新获准快照。保留用户的模型与参数选择，禁止推断身份或医疗信息。';

export function liveOpeningText(options?: LiveOptions) {
  return options?.opening
    ? `请先问候用户，然后停下来倾听。问候内容：${options.opening}`
    : undefined;
}

export function voiceStartEvent(
  modelId: string,
  voice: string,
  maxOutputTokens: number,
  team = false,
  effort?: AssistantModelConfig['voiceReasoningEffort'],
  options?: Pick<AssistantModelConfig, 'live' | 'realtime'>,
  native?: {
    delegation?: LiveDelegationOptions;
    translation?: LiveTranslationOptions;
    backend?: { id: string; model: AssistantModelConfig };
    webSearch?: boolean;
  },
) {
  const profile = voiceModel(modelId);
  if (profile.protocol === 'translation') {
    const translation = native?.translation;
    if (!translation) throw new Error('TRANSLATION_OPTIONS_REQUIRED');
    return {
      type: 'session.update',
      session: { audio: {
        input: {
          ...(translation.sourceTranscript ? { transcription: { model: 'gpt-realtime-whisper' } } : {}),
          ...(translation.noiseReduction !== undefined ? { noise_reduction: translation.noiseReduction
            ? { type: translation.noiseReduction, ...(translation.noiseStrength !== undefined
              ? { strength: translation.noiseStrength } : {}) } : null } : {}),
        },
        output: { language: translation.language },
      } },
    };
  }
  if (!(profile.voices as readonly string[]).includes(voice)) throw new Error('VOICE_NOT_ALLOWED');
  if (effort && !(profile.reasoning as readonly string[]).includes(effort))
    throw new Error('VOICE_REASONING_NOT_ALLOWED');
  const instructions = team
    ? voiceInstructions +
      ' 你在多人语音会议中。成员可同时说话，你收到的是已授权的合流音频，不保证识别发言者。成员彼此讨论时以聆听为主。被问到、需要澄清或有已完成的协作结果时简短加入。有人打断时跟随最新需求。'
    : voiceInstructions + ' 支持双向实时交流。有人打断时跟随最新需求。';
  if (profile.protocol === 'live') {
    const opening = liveOpeningText(options?.live);
    const selected = native?.delegation;
    const mode = selected?.type ?? 'client';
    const backend = native?.backend;
    let delegation: Record<string, unknown> = {
      type: 'client',
      ...(options?.live?.acknowledgementDelayMs !== undefined
        ? { acknowledgement_delay_ms: options.live.acknowledgementDelayMs }
        : {}),
    };
    if (selected?.type === 'responses' && backend) {
      const parameters = responsesParameters(backend.model);
      const effort = selected.effort ?? parameters.reasoning?.effort;
      const summary = parameters.reasoning?.summary;
      const verbosity = selected.verbosity ?? parameters.text?.verbosity;
      delegation = {
        type: 'responses',
        responses: {
          model: backend.id,
          instructions: 'Give concise photo and creative guidance. Do not claim edits or writes. ' +
            (selected.prompt ?? ''),
          max_output_tokens: selected.maxOutputTokens ?? backend.model.maxOutputTokens,
          service_tier: selected.serviceTier ?? 'default',
          ...(effort && effort !== 'max' || summary ? { reasoning: {
            ...(effort && effort !== 'max' ? { effort } : {}),
            ...(summary ? { summary } : {}),
          } } : {}),
          ...(verbosity ? { text: { verbosity } } : {}),
          ...(native?.webSearch ? { tools: [{ type: 'web_search' }], tool_choice: 'auto' } : {}),
        },
      };
    } else if (selected?.type === 'decisions') {
      delegation = { type: 'decisions', decisions: { model: OPENAI_DECISIONS_MODEL, questions: selected.questions } };
    }
    const delegationPolicy = mode === 'client'
      ? 'Backend tools: 查看授权画面与参数、搜素材、规划修图或生图。'
      : mode === 'responses'
        ? 'Use the native Responses backend for reasoning and factual questions. The backend can advise. It does not edit the project.'
        : 'Use the native Decisions backend to classify the latest user request. Wait for its results. Do not execute actions.';
    return {
      type: 'session.start',
      session: {
        model: modelId,
        store: false,
        instructions: `${instructions}\nBackchannel policy: 适度回应，等用户讲完具体要求。\nInterruption policy: 被打断时停止播报，听取最新纠正。\nDelegation policy:\n${delegationPolicy}\nGenerate <|SpawnThinking|> when: 用户要求看图、搜索、制作、编辑，或纠正正在处理的目标。\nDo not generate <|SpawnThinking|> when: 可直接回答寒暄、闲聊，或需先澄清对象。收到后端结果再说明执行状态。${options?.live?.prompt ? `\nVoice style: ${options.live.prompt}` : ''}`,
        ...(opening
          ? { input: [{ role: 'developer', content: [{ type: 'input_text', text: opening }] }] }
          : {}),
        audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice } },
        delegation,
        ...(selected?.type === 'decisions' && selected.trigger ? { triggers: [{
          type: 'decisions',
          event_type: selected.trigger === 'input' ? 'session.input_transcript.delta' : 'session.output_transcript.delta',
          decisions: { questions: selected.questions },
        }] } : {}),
      },
    };
  }
  const realtime = options?.realtime;
  const vad = realtime?.turnDetection;
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      model: modelId,
      instructions: `${instructions} 涉及图片内容、编辑、素材或生成时调用 consult_editor。`,
      output_modalities: ['audio'],
      max_output_tokens: Math.min(maxOutputTokens, 4096),
      ...(effort ? { reasoning: { effort } } : {}),
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: {
            model: realtime?.transcriptionModel ?? 'gpt-4o-mini-transcribe',
            ...(realtime?.language ? { language: realtime.language } : {}),
            ...(realtime?.prompt ? { prompt: realtime.prompt } : {}),
            ...(realtime?.delay ? { delay: realtime.delay } : {}),
          },
          ...(realtime?.noiseReduction !== undefined
            ? {
                noise_reduction: realtime.noiseReduction ? { type: realtime.noiseReduction } : null,
              }
            : {}),
          turn_detection:
            vad?.type === 'semantic_vad'
              ? {
                  type: 'semantic_vad',
                  eagerness: vad.eagerness ?? 'auto',
                  create_response: false,
                  interrupt_response: true,
                }
              : {
                  type: 'server_vad',
                  threshold: vad?.threshold ?? 0.5,
                  prefix_padding_ms: vad?.prefixPaddingMs ?? 300,
                  silence_duration_ms: vad?.silenceDurationMs ?? 600,
                  create_response: false,
                  interrupt_response: true,
                },
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          voice,
          ...(realtime?.outputSpeed !== undefined ? { speed: realtime.outputSpeed } : {}),
        },
      },
      tools: [
        {
          type: 'function',
          name: 'consult_editor',
          description:
            'Ask the authorized backend agent to see the current shared image, research resources, propose edits, or prepare a generation draft. Never changes pixels automatically.',
          parameters: {
            type: 'object',
            properties: { request: { type: 'string' } },
            required: ['request'],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: 'auto',
    },
  };
}
export function voiceAudioEvent(modelId: string, pcm: string) {
  const bytes = Buffer.from(pcm, 'base64');
  if (!bytes.length || bytes.length > 9600 || bytes.length % 2 || bytes.toString('base64') !== pcm)
    throw new Error('INVALID_PCM');
  if (modelId === OPENAI_TRANSLATION_MODEL)
    return { type: 'session.input_audio_buffer.append', audio: pcm };
  return {
    type:
      voiceModel(modelId).protocol === 'live'
        ? 'session.input_audio.append'
        : 'input_audio_buffer.append',
    audio: pcm,
  };
}
export function voiceTextEvents(modelId: string, text: string) {
  if (voiceModel(modelId).protocol === 'live')
    return [liveContextAppend('thinking', `用户键入：${text}`)];
  return [
    {
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    },
    { type: 'response.create' },
  ];
}
export function voiceResultEvents(modelId: string, callId: string, text: string, applied = false) {
  if (voiceModel(modelId).protocol === 'live')
    return [
      liveContextAppend('commentary', text, callId.startsWith('typed_') ? null : callId || null),
    ];
  return [
    {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify({
          summary: text.slice(0, 6000),
          actionStatus: applied ? 'applied' : 'pending_user_confirmation',
        }),
      },
    },
    { type: 'response.create' },
  ];
}
/** Provider messages are reduced to a small app protocol; configuration, instructions,
 * function arguments and any future vendor fields never pass through blindly. */
export function normalizeVoiceEvent(raw: Record<string, any>): VoiceServerEvent | null {
  const timing = {
    ...(typeof raw.item_id === 'string' ? { itemId: raw.item_id.slice(0, 128) } : {}),
    ...(Number.isFinite(raw.start_ms) && raw.start_ms >= 0 ? { startMs: raw.start_ms } : {}),
    ...(Number.isFinite(raw.end_ms) && raw.end_ms >= 0 ? { endMs: raw.end_ms } : {}),
  };
  if (
    ['response.output_audio.delta', 'session.output_audio.delta'].includes(raw.type) &&
    typeof raw.delta === 'string' &&
    raw.delta.length <= 300_000
  )
    return {
      type: 'audio',
      pcm: raw.delta,
      ...(typeof raw.item_id === 'string' ? { itemId: raw.item_id } : {}),
    };
  if (
    ['response.output_audio_transcript.delta', 'session.output_transcript.delta'].includes(
      raw.type,
    ) &&
    typeof raw.delta === 'string'
  )
    return {
      type: 'transcript',
      role: 'assistant',
      text: raw.delta.slice(0, 8000),
      delta: true,
      ...timing,
    };
  if (
    [
      'session.input_transcript.delta',
      'conversation.item.input_audio_transcription.delta',
    ].includes(raw.type) &&
    typeof raw.delta === 'string'
  )
    return {
      type: 'transcript',
      role: 'user',
      text: raw.delta.slice(0, 8000),
      delta: true,
      ...timing,
    };
  if (
    [
      'conversation.item.input_audio_transcription.completed',
      'response.output_audio_transcript.done',
    ].includes(raw.type) &&
    typeof raw.transcript === 'string'
  )
    return {
      type: 'transcript',
      role: raw.type === 'response.output_audio_transcript.done' ? 'assistant' : 'user',
      text: raw.transcript.slice(0, 8000),
      delta: false,
      ...timing,
    };
  if (raw.type === 'input_audio_buffer.speech_started')
    return { type: 'interrupted', bySpeech: true };
  return null;
}

/** Preserve contiguous transcript fragments and timing for a delegated turn.
 * Prefixing every token with a role would corrupt ordinary spoken sentences. */
export class VoiceTranscriptBuffer {
  private segments: Extract<VoiceServerEvent, { type: 'transcript' }>[] = [];
  push(event: Extract<VoiceServerEvent, { type: 'transcript' }>) {
    const index = event.itemId
      ? this.segments.findLastIndex(
          (item) => item.role === event.role && item.itemId === event.itemId,
        )
      : event.delta
        ? this.segments.findLastIndex(
            (item) =>
              item.role === event.role &&
              item.delta &&
              !item.itemId &&
              (event.startMs === undefined ||
                item.endMs === undefined ||
                event.startMs <= item.endMs + 1200) &&
              (event.endMs === undefined ||
                item.startMs === undefined ||
                event.endMs >= item.startMs - 1200),
          )
        : -1;
    const previous = this.segments[index];
    if (previous && event.delta) {
      if (!previous.delta) return;
      const before =
        event.startMs !== undefined &&
        previous.startMs !== undefined &&
        event.startMs < previous.startMs;
      previous.text = (before ? event.text + previous.text : previous.text + event.text).slice(
        -8000,
      );
      if (event.startMs !== undefined)
        previous.startMs = Math.min(previous.startMs ?? event.startMs, event.startMs);
      if (event.endMs !== undefined)
        previous.endMs = Math.max(previous.endMs ?? event.endMs, event.endMs);
    } else if (previous) this.segments[index] = { ...previous, ...event };
    else this.segments.push({ ...event });
    while (
      this.segments.length > 48 ||
      this.segments.reduce((total, segment) => total + segment.text.length, 0) > 24000
    )
      this.segments.shift();
  }
  clear() {
    this.segments = [];
  }
  latestUser(throughMs?: number, itemId?: string) {
    const recent = this.segments.filter(
      (segment) =>
        segment.role === 'user' &&
        (!itemId || segment.itemId === itemId) &&
        (throughMs === undefined || segment.startMs === undefined || segment.startMs <= throughMs),
    );
    return recent.reduce<(typeof recent)[number] | undefined>(
      (last, segment) =>
        last?.endMs !== undefined && segment.endMs !== undefined && segment.endMs < last.endMs
          ? last
          : segment,
      undefined,
    );
  }
  history(throughMs?: number, omitLatestUser = false): HistoryMessage[] {
    const latest = omitLatestUser ? this.latestUser(throughMs) : undefined;
    const history: HistoryMessage[] = [];
    let remaining = 12_000;
    for (let i = this.segments.length - 1; i >= 0 && remaining > 0; i--) {
      const segment = this.segments[i]!;
      if (segment === latest || (throughMs !== undefined && (segment.startMs ?? 0) > throughMs))
        continue;
      const content = segment.text.slice(-Math.min(remaining, 2500)).trim();
      if (!content) continue;
      history.unshift({ role: segment.role, content });
      remaining -= content.length;
    }
    return history;
  }
  discardAssistant(itemId: string) {
    this.segments = this.segments.filter(
      (item) => item.role !== 'assistant' || item.itemId !== itemId,
    );
  }
  toString() {
    return this.segments.map((segment) => `${segment.role}: ${segment.text}`).join('\n');
  }
}

/** Shared pure resampler used by the microphone worklet tests. Carries a sample
 * boundary across chunks; setting an AudioContext rate alone is not resampling. */
export class PcmResampler {
  private tail: number[] = [];
  private position = 0;
  constructor(
    readonly sourceRate: number,
    readonly targetRate = 24000,
  ) {
    if (
      !Number.isFinite(sourceRate) ||
      sourceRate < 8000 ||
      sourceRate > 192000 ||
      !Number.isFinite(targetRate) ||
      targetRate < 8000 ||
      targetRate > 96000
    )
      throw new Error('SAMPLE_RATE_INVALID');
  }
  push(chunk: Float32Array): Int16Array {
    const samples = this.tail.concat(Array.from(chunk));
    const output: number[] = [];
    const step = this.sourceRate / this.targetRate;
    while (this.position + 1 < samples.length) {
      const index = Math.floor(this.position);
      const ratio = this.position - index;
      const value = Math.max(
        -1,
        Math.min(1, samples[index]! * (1 - ratio) + samples[index + 1]! * ratio),
      );
      output.push(Math.round(value < 0 ? value * 32768 : value * 32767));
      this.position += step;
    }
    const consumed = Math.min(Math.floor(this.position), samples.length);
    this.tail = samples.slice(consumed);
    this.position -= consumed;
    return Int16Array.from(output);
  }
}
