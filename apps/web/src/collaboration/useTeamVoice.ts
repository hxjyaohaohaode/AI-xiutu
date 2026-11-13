import { useEffect, useRef, useState } from 'react';
import {
  TEAM_VOICE_PROTOCOL,
  type TeamVoiceControl,
  type TeamVoiceEvent,
} from '@ai-xiutu/contracts';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { voiceErrorMessage } from '../ai/voice-error';
import { appendCaption, type CaptionState } from '../ai/VoiceCaptions';
import {
  AI_VOICE_BUFFER_SECONDS,
  PEER_VOICE_BUFFER_SECONDS,
  voicePlaybackTime,
} from '../ai/voice-playback';
import { PeerCaptions } from './peerCaptions';
import {
  clearTeamVoiceSubmission,
  freezeTeamVoiceSubmission,
  isTeamVoiceAdmissionRejected,
  readTeamVoiceSubmission,
  saveTeamVoiceSubmission,
  TeamVoiceAdmissionObserver,
  type TeamVoiceSubmission,
} from '../ai/teamVoiceSubmission';
import { readVoiceSubmission, type VoiceSubmission } from '../ai/voiceSubmission';
import { VOICE_SUBMISSION_CHANGED } from '../ai/voiceSubmissionStorage';

class TeamVoiceTransport {
  private socket?: WebSocket;
  private audio?: AudioContext;
  private speakerMix?: DynamicsCompressorNode;
  private captionBus?: MediaStreamAudioDestinationNode;
  private peerCaptions?: PeerCaptions;
  private stream?: MediaStream;
  private capture?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private silentOutput?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private joinDeadline?: ReturnType<typeof setTimeout>;
  private closed = false;
  private captureGeneration = 0;
  private readonly playback = new Map<
    number,
    { next: number; nodes: Set<AudioBufferSourceNode> }
  >();

  constructor(
    private readonly event: (event: TeamVoiceEvent) => void,
    private readonly disconnected: () => void,
  ) {}

  async prepare() {
    if (!window.isSecureContext || !window.AudioContext)
      throw new Error('团队语音需要 HTTPS 和 Web Audio');
    this.audio = new AudioContext({ latencyHint: 'interactive' });
    this.speakerMix = this.audio.createDynamicsCompressor();
    this.speakerMix.threshold.value = -10;
    this.speakerMix.ratio.value = 4;
    this.speakerMix.connect(this.audio.destination);
    await this.audio.resume();
  }
  connect(path: string, ticket: string) {
    if (this.closed || !/^\/v1\/artworks\/[a-f0-9-]{36}\/team-voice\/stream$/.test(path))
      throw new Error('团队语音连接无效');
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, [TEAM_VOICE_PROTOCOL, ticket]);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.joinDeadline = setTimeout(() => this.disconnect(), 10_000);
    socket.onmessage = (message) => {
      if (this.closed) return;
      if (message.data instanceof ArrayBuffer) {
        this.play(message.data);
        return;
      }
      try {
        const event = JSON.parse(String(message.data)) as TeamVoiceEvent;
        if (event.type === 'joined') clearTimeout(this.joinDeadline);
        if (event.type === 'ai-interrupted') this.clearSpeaker(0);
        if (event.type === 'roster') {
          const present = new Set(event.members.map((member) => member.speakerId));
          for (const speaker of this.playback.keys())
            if (speaker !== 0 && !present.has(speaker)) this.clearSpeaker(speaker);
        }
        this.event(event);
      } catch {
        this.disconnect();
      }
    };
    socket.onclose = () => this.disconnect();
    socket.onerror = () => this.disconnect();
    this.timer = setInterval(() => this.send({ type: 'ping' }), 10_000);
  }
  send(packet: TeamVoiceControl) {
    const ws = this.socket;
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 48_000) {
      this.disconnect();
      return;
    }
    ws.send(JSON.stringify(packet));
  }
  async microphone(enabled: boolean) {
    if (!enabled) {
      this.stopCapture();
      this.send({ type: 'mute', muted: true });
      return;
    }
    if (this.stream) return;
    const audio = this.audio,
      generation = ++this.captureGeneration;
    if (!audio || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)
      throw new Error('当前设备无法使用麦克风');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    try {
      await audio.audioWorklet.addModule(new URL('../ai/capture-worklet.js', import.meta.url).href);
      if (this.closed || generation !== this.captureGeneration) throw new Error('团队通话已离开');
      this.stream = stream;
      const capture = (this.capture = new AudioWorkletNode(audio, 'editor-microphone'));
      const source = (this.source = audio.createMediaStreamSource(stream));
      const output = (this.silentOutput = audio.createGain());
      output.gain.value = 0;
      source.connect(capture).connect(output).connect(audio.destination);
      capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const ws = this.socket;
        if (
          generation === this.captureGeneration &&
          ws?.readyState === WebSocket.OPEN &&
          ws.bufferedAmount < 14_400
        )
          ws.send(event.data);
      };
      this.send({ type: 'mute', muted: false });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      if (generation === this.captureGeneration) this.stopCapture();
      throw error;
    }
  }
  private play(frame: ArrayBuffer) {
    const audio = this.audio;
    if (!audio || frame.byteLength < 4 || frame.byteLength % 2) return;
    const data = new DataView(frame),
      speakerId = data.getUint16(0, true);
    const clock = this.playback.get(speakerId) ?? {
      next: 0,
      nodes: new Set<AudioBufferSourceNode>(),
    };
    this.playback.set(speakerId, clock);
    if (speakerId !== 0 && clock.next > audio.currentTime + PEER_VOICE_BUFFER_SECONDS) {
      for (const node of clock.nodes) node.stop();
      clock.nodes.clear();
      clock.next = 0;
    }
    const sampleCount = (frame.byteLength - 2) / 2;
    const start =
      speakerId === 0
        ? voicePlaybackTime(
            audio.currentTime,
            clock.next,
            sampleCount / 24_000,
            AI_VOICE_BUFFER_SECONDS,
          )
        : Math.max(audio.currentTime + 0.025, clock.next);
    if (start === null) return;
    const buffer = audio.createBuffer(1, sampleCount, 24000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = data.getInt16(2 + i * 2, true) / 32768;
    const node = audio.createBufferSource();
    node.buffer = buffer;
    node.connect(this.speakerMix ?? audio.destination);
    if (speakerId !== 0 && this.captionBus) node.connect(this.captionBus);
    clock.next = start + buffer.duration;
    clock.nodes.add(node);
    node.onended = () => clock.nodes.delete(node);
    node.start(start);
  }
  private clearSpeaker(speaker: number) {
    const clock = this.playback.get(speaker);
    if (!clock) return;
    for (const node of clock.nodes) node.stop();
    this.playback.delete(speaker);
  }
  async captionPeers(caption: (text: string) => void, status: (message: string) => void) {
    if (this.closed || this.peerCaptions || !this.audio) return;
    const bus = (this.captionBus = this.audio.createMediaStreamDestination());
    bus.channelCount = 1;
    const track = bus.stream.getAudioTracks()[0]!;
    for (const [speaker, clock] of this.playback)
      if (speaker !== 0) for (const node of clock.nodes) node.connect(bus);
    const captions = (this.peerCaptions = new PeerCaptions(track, caption, status));
    try {
      await captions.start();
    } catch (error) {
      if (this.peerCaptions === captions) {
        this.stopPeerCaptions();
        status(voiceErrorMessage(error));
      }
    }
  }
  stopPeerCaptions() {
    if (!this.captionBus) return;
    for (const [speaker, clock] of this.playback)
      if (speaker !== 0) for (const node of clock.nodes) node.disconnect(this.captionBus);
    this.peerCaptions?.close();
    this.peerCaptions = undefined;
    this.captionBus = undefined;
  }
  private stopCapture() {
    this.captureGeneration++;
    this.capture?.port.close();
    this.capture?.disconnect();
    this.source?.disconnect();
    this.silentOutput?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.capture = undefined;
    this.source = undefined;
    this.silentOutput = undefined;
    this.stream = undefined;
  }
  private disconnect() {
    if (this.closed) return;
    this.dispose();
    this.disconnected();
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.joinDeadline);
    this.stopCapture();
    this.stopPeerCaptions();
    this.socket?.close();
    void this.audio?.close().catch(() => undefined);
    this.playback.clear();
  }
}

type Roster = Extract<TeamVoiceEvent, { type: 'roster' }>;
const emptyRoster: Roster = { type: 'roster', members: [], agent: { state: 'off' } };
export function useTeamVoice(artworkId: string | undefined, actorId: string | undefined) {
  const [state, setState] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [speaker, setSpeaker] = useState<number>();
  const [canInvite, setCanInvite] = useState(false);
  const [roster, setRoster] = useState<Roster>(emptyRoster);
  const [muted, setMuted] = useState(true);
  const [pendingConsent, setPendingConsent] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  const [captions, setCaptions] = useState<CaptionState>({});
  const [peerCaptions, setPeerCaptions] = useState<CaptionState>({});
  const [peerCaptionStatus, setPeerCaptionStatus] = useState('');
  const [agentResult, setAgentResult] = useState<Extract<TeamVoiceEvent, { type: 'ai-result' }>>();
  const [agentTool, setAgentTool] = useState<Extract<TeamVoiceEvent, { type: 'ai-tool' }>>();
  const [contextStatus, setContextStatus] = useState('');
  const [pendingInvitation, setPendingInvitation] = useState<TeamVoiceSubmission | null>(null);
  const [pendingIndividualVoice, setPendingIndividualVoice] = useState<VoiceSubmission | null>(
    null,
  );
  const [invitationReady, setInvitationReady] = useState(false);
  const [invitationError, setInvitationError] = useState('');
  const transport = useRef<TeamVoiceTransport | undefined>(undefined);
  const admission = useRef<{
    actorId: string;
    idempotencyKey: string;
    connection: TeamVoiceTransport;
    observer: TeamVoiceAdmissionObserver;
  } | null>(null);
  const inviting = useRef<string | null>(null);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const currentActor = useRef(actorId);
  currentActor.current = actorId;
  const micPending = useRef(false);
  const consentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentArtwork = useRef(artworkId);
  currentArtwork.current = artworkId;
  function restoreInvitations() {
    if (currentActor.current !== actorId) return;
    setInvitationReady(false);
    if (!actorId) {
      setPendingInvitation(null);
      setPendingIndividualVoice(null);
      setInvitationError('');
      return;
    }
    try {
      setPendingInvitation(readTeamVoiceSubmission(localStorage, actorId));
      setPendingIndividualVoice(readVoiceSubmission(localStorage, actorId));
      setInvitationError('');
      setInvitationReady(true);
    } catch (error) {
      setInvitationError(errorMessage(error));
    }
  }
  function markAdmissionUnknown(observed: NonNullable<typeof admission.current>) {
    observed.observer.invalidate();
    const saved = readTeamVoiceSubmission(localStorage, observed.actorId);
    if (saved?.idempotencyKey === observed.idempotencyKey && saved.state !== 'unknown')
      saveTeamVoiceSubmission(localStorage, { ...saved, state: 'unknown' });
  }
  function detachAdmission() {
    const observed = admission.current;
    admission.current = null;
    if (!observed) return;
    try {
      markAdmissionUnknown(observed);
    } catch (error) {
      setInvitationError(errorMessage(error));
      setInvitationReady(false);
    }
  }
  const stop = () => {
    detachAdmission();
    // Any unfinished POST is protected by its actor's checkpoint. It must not
    // keep a different account or a later connection's UI operation busy.
    inviting.current = null;
    const existing = transport.current;
    transport.current = undefined;
    existing?.dispose();
    clearTimeout(consentTimer.current);
    setState('idle');
    setSpeaker(undefined);
    setMuted(true);
    setPendingConsent(null);
    setCanInvite(false);
    setRoster(emptyRoster);
    setCaptions({});
    setPeerCaptions({});
    setPeerCaptionStatus('');
    setAgentResult(undefined);
    setAgentTool(undefined);
    setContextStatus('');
  };
  useEffect(() => {
    restoreInvitations();
    const changed = () => restoreInvitations();
    window.addEventListener(VOICE_SUBMISSION_CHANGED, changed);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener(VOICE_SUBMISSION_CHANGED, changed);
      window.removeEventListener('storage', changed);
    };
  }, [actorId]);
  useEffect(() => {
    stop();
    setMessage('');
    return () => {
      detachAdmission();
      clearTimeout(consentTimer.current);
      transport.current?.dispose();
    };
  }, [artworkId, actorId]);
  async function join() {
    if (!actorId || currentActor.current !== actorId || !artworkId || transport.current) return;
    setState('connecting');
    setMessage('');
    let ownSpeaker: number | undefined;
    const connection = new TeamVoiceTransport(
      (event) => {
        if (
          transport.current !== connection ||
          currentArtwork.current !== artworkId ||
          currentActor.current !== actorId
        )
          return;
        if (event.type === 'joined') {
          ownSpeaker = event.speakerId;
          setSpeaker(event.speakerId);
          setCanInvite(event.canInvite);
          setState('connected');
        }
        if (event.type === 'roster') {
          const observed = admission.current;
          if (observed?.connection === connection && observed.actorId === currentActor.current) {
            try {
              const saved = readTeamVoiceSubmission(localStorage, observed.actorId);
              if (
                !saved ||
                saved.idempotencyKey !== observed.idempotencyKey ||
                saved.state === 'unknown'
              ) {
                observed.observer.invalidate();
                admission.current = null;
              } else {
                const result = observed.observer.observe(event.agent);
                if (result.kind === 'resolved') {
                  clearTeamVoiceSubmission(localStorage, saved);
                  admission.current = null;
                } else if (result.kind === 'unknown') {
                  markAdmissionUnknown(observed);
                  admission.current = null;
                } else if (
                  result.kind === 'bound' &&
                  (saved.invitationId !== result.invitationId || saved.state !== result.state)
                ) {
                  saveTeamVoiceSubmission(localStorage, {
                    ...saved,
                    invitationId: result.invitationId,
                    state: result.state,
                  });
                }
              }
            } catch (error) {
              observed.observer.invalidate();
              setInvitationError(errorMessage(error));
              setInvitationReady(false);
            }
          }
          setRoster(event);
          const acknowledged = event.members.find(
            (peer) => peer.speakerId === ownSpeaker,
          )?.listeningToAi;
          setPendingConsent((pending) =>
            event.agent.state !== 'active' || pending === acknowledged ? null : pending,
          );
          if (event.agent.state === 'off' || event.agent.state === 'connecting') {
            setCaptions({});
            setAgentResult(undefined);
            setAgentTool(undefined);
          }
          if (event.agent.state !== 'off' && !event.agent.contextReady) {
            setCaptions({});
            setAgentResult(undefined);
            setAgentTool(undefined);
          }
          if (event.agent.state !== 'off') {
            connection.stopPeerCaptions();
            setPeerCaptions({});
            setPeerCaptionStatus('');
          }
        }
        if (event.type === 'error') {
          setMessage(event.message);
          if (event.code === 'CONTEXT_OR_ACCESS_REJECTED') setContextStatus('同步未完成');
        }
        if (event.type === 'ai-transcript') setCaptions((old) => appendCaption(old, event));
        if (event.type === 'ai-result') setAgentResult(event);
        if (event.type === 'ai-tool') setAgentTool(event);
        if (event.type === 'ai-context')
          setContextStatus(event.imageShared ? 'AI 已同步画面' : 'AI 已同步参数');
      },
      () => {
        if (transport.current === connection && currentActor.current === actorId) {
          stop();
          setMessage(ownSpeaker === undefined
            ? '团队语音连接未完成，请重试。'
            : '团队语音已断开，可以重新加入');
        }
      },
    );
    transport.current = connection;
    try {
      await connection.prepare();
      if (
        transport.current !== connection ||
        currentArtwork.current !== artworkId ||
        currentActor.current !== actorId
      )
        return;
      const result = await api<{ ticket: string; path: string }>(
        '/artworks/' + artworkId + '/team-voice/join',
        { ...jsonRequest('POST', {}), signal: AbortSignal.timeout(10_000) },
      );
      if (
        transport.current !== connection ||
        currentArtwork.current !== artworkId ||
        currentActor.current !== actorId
      )
        return;
      connection.connect(result.path, result.ticket);
    } catch (error) {
      if (transport.current === connection && currentActor.current === actorId) {
        stop();
        setMessage(voiceErrorMessage(error));
      }
    }
  }
  async function toggleMic() {
    const connection = transport.current;
    if (!connection || state !== 'connected' || micPending.current) return;
    micPending.current = true;
    try {
      await connection.microphone(muted);
      if (transport.current === connection) setMuted(!muted);
    } catch (error) {
      if (transport.current === connection) setMessage(voiceErrorMessage(error));
    } finally {
      micPending.current = false;
    }
  }
  async function inviteAgent(body: unknown) {
    const connection = transport.current;
    if (
      !actorId ||
      !artworkId ||
      currentActor.current !== actorId ||
      currentArtwork.current !== artworkId ||
      state !== 'connected' ||
      !connection ||
      speaker === undefined ||
      !canInvite ||
      !invitationReady
    )
      throw new Error('请先加入团队语音，并确认当前账号可邀请 AI。');
    if (inviting.current) throw new Error('正在核对本次邀请，请稍候。');
    const agent = rosterRef.current.agent;
    if (agent.state !== 'off') throw new Error('当前团队通话已有 AI 会话。');
    if (agent.lastOutcome === 'unknown')
      throw new Error('上一轮团队 AI 费用待核验，暂不能重新邀请。');
    if (readTeamVoiceSubmission(localStorage, actorId))
      throw new Error('原团队 AI 邀请仍待确认，请先核对用量并联系平台运营。');
    const frozen = freezeTeamVoiceSubmission({ actorId, artworkId, body });
    // The individual voice guard is checked again by save before any POST.
    saveTeamVoiceSubmission(localStorage, frozen);
    const observed = {
      actorId,
      idempotencyKey: frozen.idempotencyKey,
      connection,
      observer: new TeamVoiceAdmissionObserver(speaker, frozen.modelId),
    };
    admission.current = observed;
    inviting.current = frozen.idempotencyKey;
    try {
      const response = await api<{ state: string }>(
        '/artworks/' + artworkId + '/team-voice/agent',
        { method: 'POST', body: frozen.requestBody },
      );
      if (!response || !['connecting', 'active', 'closing'].includes(response.state))
        throw new Error('团队 AI 回执不完整，原请求已保留待核验。');
      // {state} has no session ID. It cannot be substituted for an active roster
      // observation, and a late response cannot recreate a resolved checkpoint.
      const saved = readTeamVoiceSubmission(localStorage, actorId);
      if (saved?.idempotencyKey === frozen.idempotencyKey && saved.state === 'unconfirmed')
        saveTeamVoiceSubmission(localStorage, { ...saved, state: 'accepted' });
    } catch (error) {
      const saved = readTeamVoiceSubmission(localStorage, actorId);
      if (saved?.idempotencyKey === frozen.idempotencyKey) {
        if (isTeamVoiceAdmissionRejected(error) && !observed.observer.observedActive)
          clearTeamVoiceSubmission(localStorage, saved);
        else markAdmissionUnknown(observed);
      }
      observed.observer.invalidate();
      if (admission.current === observed) admission.current = null;
      throw error;
    } finally {
      if (inviting.current === frozen.idempotencyKey) inviting.current = null;
    }
  }
  function listenToAi(enabled: boolean) {
    const connection = transport.current;
    if (!connection || pendingConsent !== null || roster.agent.state !== 'active') return;
    setPendingConsent(enabled);
    connection.send({ type: 'ai-listen', invitationId: roster.agent.invitationId, enabled });
  }
  function captionPeers(visible: boolean) {
    const connection = transport.current;
    if (!connection) return;
    if (!visible) {
      connection.stopPeerCaptions();
      setPeerCaptions({});
      setPeerCaptionStatus('');
      return;
    }
    setPeerCaptionStatus('正在启动本机成员字幕');
    void connection.captionPeers(
      (text) => setPeerCaptions({ user: { role: 'user', text: text.slice(-360), delta: false } }),
      setPeerCaptionStatus,
    );
  }
  useEffect(() => {
    if (pendingConsent === null) return;
    const connection = transport.current;
    consentTimer.current = setTimeout(() => {
      if (connection !== transport.current) return;
      stop();
      setMessage('麦克风授权未得到确认，已退出团队语音。');
    }, 3500);
    return () => clearTimeout(consentTimer.current);
  }, [pendingConsent]);
  return {
    actorId,
    artworkId,
    state,
    speaker,
    canInvite,
    roster,
    muted,
    pendingConsent,
    message,
    captions,
    peerCaptions,
    peerCaptionStatus,
    agentResult,
    agentTool,
    contextStatus,
    pendingInvitation,
    pendingIndividualVoice,
    invitationReady,
    invitationError,
    restoreInvitations,
    inviteAgent,
    join,
    leave: stop,
    toggleMic,
    listenToAi,
    captionPeers,
    setMessage,
    setContextStatus,
    ownership(id: string) {
      const connection = transport.current;
      return () =>
        !!connection &&
        connection === transport.current &&
        currentArtwork.current === id &&
        currentActor.current === actorId;
    },
  };
}
export type TeamVoiceState = ReturnType<typeof useTeamVoice>;
