import { useEffect, useRef, useState } from 'react';
import {
  TEAM_VOICE_PROTOCOL,
  type TeamVoiceControl,
  type TeamVoiceEvent,
} from '@ai-xiutu/contracts';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { appendCaption, type CaptionState } from '../ai/VoiceCaptions';
import { PeerCaptions } from './peerCaptions';

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
    socket.onmessage = (message) => {
      if (this.closed) return;
      if (message.data instanceof ArrayBuffer) {
        this.play(message.data);
        return;
      }
      try {
        const event = JSON.parse(String(message.data)) as TeamVoiceEvent;
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
    if (clock.next > audio.currentTime + 0.45) {
      for (const node of clock.nodes) node.stop();
      clock.nodes.clear();
      clock.next = 0;
    }
    const sampleCount = (frame.byteLength - 2) / 2;
    const buffer = audio.createBuffer(1, sampleCount, 24000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = data.getInt16(2 + i * 2, true) / 32768;
    const node = audio.createBufferSource();
    node.buffer = buffer;
    node.connect(this.speakerMix ?? audio.destination);
    if (speakerId !== 0 && this.captionBus) node.connect(this.captionBus);
    const start = Math.max(audio.currentTime + 0.025, clock.next);
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
        status(errorMessage(error));
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
    this.stopCapture();
    this.stopPeerCaptions();
    this.socket?.close();
    void this.audio?.close().catch(() => undefined);
    this.playback.clear();
  }
}

type Roster = Extract<TeamVoiceEvent, { type: 'roster' }>;
const emptyRoster: Roster = { type: 'roster', members: [], agent: { state: 'off' } };
export function useTeamVoice(artworkId: string | undefined) {
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
  const transport = useRef<TeamVoiceTransport | undefined>(undefined);
  const micPending = useRef(false);
  const consentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentArtwork = useRef(artworkId);
  currentArtwork.current = artworkId;
  const stop = () => {
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
    stop();
    setMessage('');
    return () => {
      clearTimeout(consentTimer.current);
      transport.current?.dispose();
    };
  }, [artworkId]);
  async function join() {
    if (!artworkId || transport.current) return;
    setState('connecting');
    setMessage('');
    let ownSpeaker: number | undefined;
    const connection = new TeamVoiceTransport(
      (event) => {
        if (transport.current !== connection || currentArtwork.current !== artworkId) return;
        if (event.type === 'joined') {
          ownSpeaker = event.speakerId;
          setSpeaker(event.speakerId);
          setCanInvite(event.canInvite);
          setState('connected');
        }
        if (event.type === 'roster') {
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
        if (transport.current === connection) {
          stop();
          setMessage('团队语音已断开，可以重新加入');
        }
      },
    );
    transport.current = connection;
    try {
      await connection.prepare();
      if (transport.current !== connection || currentArtwork.current !== artworkId) return;
      const result = await api<{ ticket: string; path: string }>(
        '/artworks/' + artworkId + '/team-voice/join',
        jsonRequest('POST', {}),
      );
      if (transport.current !== connection || currentArtwork.current !== artworkId) return;
      connection.connect(result.path, result.ticket);
    } catch (error) {
      if (transport.current === connection) {
        stop();
        setMessage(errorMessage(error));
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
      if (transport.current === connection) setMessage(errorMessage(error));
    } finally {
      micPending.current = false;
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
        !!connection && connection === transport.current && currentArtwork.current === id;
    },
  };
}
export type TeamVoiceState = ReturnType<typeof useTeamVoice>;
