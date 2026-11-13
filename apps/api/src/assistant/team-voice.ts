import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import type { Database } from '@ai-xiutu/db';
import {
  assistantContextSchema,
  TEAM_VOICE_MAX_MEMBERS,
  TEAM_VOICE_MAX_PCM_BYTES,
  TEAM_VOICE_PROTOCOL,
  teamVoiceControlSchema,
  teamVoiceInviteSchema,
  type AssistantContext,
  type TeamVoiceAgentStatus,
  type TeamVoiceEvent,
  type VoiceServerEvent,
} from '@ai-xiutu/contracts';
import type { AppConfig } from '../config.js';
import { hash, HttpError, id, opaqueToken, rateLimit, requireUser } from '../core.js';
import { TeamVoiceMixer, teamVoiceFrameMs } from './team-voice-mix.js';

const upgradePath = /^\/v1\/artworks\/([0-9a-f-]{36})\/team-voice\/stream$/;
const ticketMs = 30_000;
const accessMs = 2_500;
const silence = Buffer.alloc(teamVoiceFrameMs * 48).toString('base64');
type MemberAccess = {
  project_id: string;
  space_id: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  display_name: string;
  asset_id: string;
  head_version: number;
};
interface Peer {
  actorId: string;
  authHash: string;
  access: MemberAccess;
  ws: WebSocket;
  speakerId: number;
  muted: boolean;
  authorizedAt: number;
  lastPing: number;
  windowStart: number;
  windowBytes: number;
}
interface AgentConnection {
  audio(pcm: string): void;
  ping(): void;
  invalidate(): void;
  update(context: AssistantContext, tag: string): void;
  end(): void;
}
interface AgentLease {
  host: Peer;
  invitationId: string;
  modelId: string;
  state: 'connecting' | 'active' | 'closing';
  listeners: Set<number>;
  mixer: TeamVoiceMixer;
  silenceUntil: number;
  contextReady: boolean;
  expectedVersion: number;
  assetId: string;
  contextTag?: string;
  lastContextSent?: number;
  lastPing?: number;
  connection?: AgentConnection;
}
interface Room {
  id: string;
  peers: Map<string, Peer>;
  agent?: AgentLease;
  lastOutcome?: 'closed' | 'failed' | 'unknown';
}
interface AgentFactory {
  ready(): boolean;
  start(input: {
    actorId: string;
    authHash: string;
    projectId: string;
    artworkId: string;
    request: unknown;
    stillWanted(): boolean;
    event(event: VoiceServerEvent): void;
  }): Promise<AgentConnection>;
}
const canInvite = (peer: Peer) => peer.access.role !== 'viewer';
const active = (peer: Peer) =>
  peer.ws.readyState === WebSocket.OPEN && Date.now() - peer.authorizedAt <= accessMs;

export function registerTeamVoice(
  app: FastifyInstance,
  db: Database,
  config: AppConfig,
  factory: AgentFactory,
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: TEAM_VOICE_MAX_PCM_BYTES,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.has(TEAM_VOICE_PROTOCOL) ? TEAM_VOICE_PROTOCOL : false,
  });
  const rooms = new Map<string, Room>();
  const actorRooms = new Map<string, Room>();
  const tickets = new Map<
    string,
    { artworkId: string; actorId: string; authHash: string; expires: number }
  >();
  let accepting = true,
    checking = false,
    handshakes = 0;

  async function access(
    artworkId: string,
    actorId: string,
    authHash: string,
  ): Promise<MemberAccess> {
    const result = await db.query<MemberAccess>(
      'SELECT a.project_id,p.space_id,m.role,u.display_name,a.asset_id,a.head_version ' +
        'FROM artworks a JOIN projects p ON p.id=a.project_id JOIN spaces s ON s.id=p.space_id ' +
        'JOIN memberships m ON m.space_id=p.space_id AND m.user_id=$2 ' +
        "JOIN users u ON u.id=m.user_id AND u.status='active' " +
        'JOIN sessions se ON se.user_id=u.id AND se.token_hash=$3 AND se.expires_at>clock_timestamp() ' +
        'JOIN assets src ON src.id=a.asset_id AND src.deleted_at IS NULL ' +
        "WHERE a.id=$1 AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND s.kind='team'",
      [artworkId, actorId, authHash],
    );
    if (!result.rows[0])
      throw new HttpError(404, 'TEAM_VOICE_UNAVAILABLE', '作品或团队语音不可访问');
    return result.rows[0];
  }
  function write(peer: Peer, data: string | Buffer) {
    if (!active(peer)) return;
    if (peer.ws.bufferedAmount > 256_000) {
      peer.ws.close(1008, 'slow consumer');
      return;
    }
    peer.ws.send(data);
  }
  const send = (peer: Peer, event: TeamVoiceEvent) => write(peer, JSON.stringify(event));
  function broadcast(room: Room, event: TeamVoiceEvent) {
    const serialized = JSON.stringify(event);
    for (const peer of room.peers.values()) write(peer, serialized);
  }
  function roster(room: Room) {
    const agent: TeamVoiceAgentStatus = room.agent
      ? {
          state: room.agent.state,
          hostSpeakerId: room.agent.host.speakerId,
          modelId: room.agent.modelId,
          invitationId: room.agent.invitationId,
          contextReady: room.agent.contextReady,
        }
      : { state: 'off', lastOutcome: room.lastOutcome };
    broadcast(room, {
      type: 'roster',
      agent,
      members: [...room.peers.values()].map((peer) => ({
        speakerId: peer.speakerId,
        displayName: peer.access.display_name,
        muted: peer.muted,
        listeningToAi: room.agent?.listeners.has(peer.speakerId) ?? false,
      })),
    });
  }
  function audio(room: Room, speakerId: number, bytes: Buffer, exclude?: Peer) {
    const frame = Buffer.allocUnsafe(bytes.length + 2);
    frame.writeUInt16LE(speakerId, 0);
    bytes.copy(frame, 2);
    for (const peer of room.peers.values()) if (peer !== exclude) write(peer, frame);
  }
  function pauseContext(room: Room, lease: AgentLease) {
    lease.contextReady = false;
    lease.mixer.clear();
    broadcast(room, { type: 'ai-interrupted' });
  }
  function endAgent(room: Room, lease: AgentLease) {
    if (room.agent !== lease || lease.state === 'closing') return;
    lease.state = 'closing';
    lease.listeners.clear();
    pauseContext(room, lease);
    roster(room);
    lease.connection?.end();
  }
  function prune(room: Room) {
    if (!room.peers.size && !room.agent) rooms.delete(room.id);
  }
  function leave(room: Room, peer: Peer) {
    if (room.peers.get(peer.actorId) !== peer) return;
    room.peers.delete(peer.actorId);
    actorRooms.delete(peer.actorId);
    const lease = room.agent;
    if (lease?.host === peer) endAgent(room, lease);
    else if (lease) {
      lease.listeners.delete(peer.speakerId);
      lease.mixer.drop(peer.speakerId);
    }
    roster(room);
    prune(room);
  }
  function eventFromAgent(room: Room, lease: AgentLease, event: VoiceServerEvent) {
    if (room.agent !== lease) return;
    if (event.type === 'closed') {
      broadcast(room, { type: 'ai-interrupted' });
      room.agent = undefined;
      room.lastOutcome = event.state;
      roster(room);
      prune(room);
      return;
    }
    if (lease.state === 'closing') return;
    if (event.type === 'ready') {
      lease.state = 'active';
      roster(room);
    }
    if (event.type === 'audio') {
      if (!lease.contextReady) return;
      const bytes = Buffer.from(event.pcm, 'base64');
      if (bytes.length > 0 && bytes.length % 2 === 0 && bytes.length <= 240_000)
        audio(room, 0, bytes);
    }
    if (lease.contextReady && event.type === 'transcript')
      broadcast(room, { ...event, type: 'ai-transcript' });
    if (lease.contextReady && event.type === 'assistant-result')
      broadcast(room, { type: 'ai-result', text: event.text, search: event.search });
    if (
      lease.contextReady &&
      event.type === 'tool' &&
      (event.name === 'consult_editor' || event.name === 'search_resources')
    )
      broadcast(room, { type: 'ai-tool', name: event.name, state: event.state });
    if (event.type === 'interrupted') broadcast(room, { type: 'ai-interrupted' });
    if (
      event.type === 'context' &&
      event.accepted &&
      lease.contextTag &&
      event.contextTag === lease.contextTag &&
      lease.expectedVersion === lease.host.access.head_version &&
      lease.assetId === lease.host.access.asset_id
    ) {
      lease.contextTag = undefined;
      lease.contextReady = true;
      roster(room);
      broadcast(room, { type: 'ai-context', imageShared: event.imageShared });
    }
    if (event.type === 'error') {
      if (event.code === 'VOICE_DELEGATION_LIMIT') broadcast(room, event);
      else send(lease.host, event);
    }
  }
  function receive(room: Room, peer: Peer, bytes: Buffer, isBinary: boolean) {
    if (!active(peer)) return;
    const now = Date.now();
    if (now - peer.windowStart >= 1000) {
      peer.windowStart = now;
      peer.windowBytes = 0;
    }
    peer.windowBytes += bytes.length + 100;
    if (peer.windowBytes > 88_000) return peer.ws.close(1008, 'voice rate exceeded');
    const lease = room.agent;
    if (isBinary) {
      if (
        peer.muted ||
        !bytes.length ||
        bytes.length % 2 ||
        bytes.length > TEAM_VOICE_MAX_PCM_BYTES
      )
        return;
      audio(room, peer.speakerId, bytes, peer);
      if (
        lease?.state === 'active' &&
        lease.contextReady &&
        lease.listeners.has(peer.speakerId) &&
        active(lease.host)
      ) {
        lease.mixer.push(peer.speakerId, bytes);
      }
      return;
    }
    let packet;
    try {
      packet = teamVoiceControlSchema.parse(JSON.parse(bytes.toString()));
    } catch {
      return peer.ws.close(1008, 'invalid voice control');
    }
    if (packet.type === 'ping') {
      peer.lastPing = now;
      send(peer, { type: 'pong' });
    } else if (packet.type === 'mute') {
      peer.muted = packet.muted;
      if (peer.muted) lease?.mixer.drop(peer.speakerId);
      roster(room);
    } else if (lease?.state === 'active' && lease.invitationId === packet.invitationId) {
      if (packet.enabled) lease.listeners.add(peer.speakerId);
      else {
        lease.listeners.delete(peer.speakerId);
        lease.mixer.drop(peer.speakerId);
      }
      roster(room);
    }
  }

  const upkeep = setInterval(() => {
    if (checking) return;
    checking = true;
    const now = Date.now();
    for (const [ticket, info] of tickets) if (info.expires <= now) tickets.delete(ticket);
    void Promise.allSettled(
      [...rooms.values()].flatMap((room) =>
        [...room.peers.values()].map(async (peer) => {
          try {
            if (now - peer.lastPing > 25_000) throw new Error('heartbeat expired');
            peer.access = await access(room.id, peer.actorId, peer.authHash);
            peer.authorizedAt = Date.now();
            const lease = room.agent;
            if (lease?.host === peer) {
              if (!canInvite(peer)) endAgent(room, lease);
              else if (
                lease.contextReady &&
                (lease.expectedVersion !== peer.access.head_version ||
                  lease.assetId !== peer.access.asset_id)
              ) {
                pauseContext(room, lease);
                lease.connection?.invalidate();
                roster(room);
              }
            }
          } catch {
            peer.ws.close(1008, 'voice access changed');
            leave(room, peer);
          }
        }),
      ),
    ).finally(() => {
      checking = false;
    });
  }, 1000);
  const pacing = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const lease = room.agent;
      if (lease?.state !== 'active' || !active(lease.host)) continue;
      if (!lease.lastPing || now - lease.lastPing > 10_000) {
        lease.connection?.ping();
        lease.lastPing = now;
      }
      const allowed = new Set<number>();
      if (lease.contextReady)
        for (const peer of room.peers.values())
          if (lease.listeners.has(peer.speakerId) && !peer.muted && active(peer))
            allowed.add(peer.speakerId);
      const frame = lease.mixer.take(allowed);
      if (frame) {
        lease.connection?.audio(frame.toString('base64'));
        lease.silenceUntil = now + 800;
      } else if (lease.modelId === 'gpt-live-1' || lease.silenceUntil > now) {
        lease.connection?.audio(silence);
      }
    }
  }, teamVoiceFrameMs);
  upkeep.unref();
  pacing.unref();
  app.addHook('preClose', async () => {
    accepting = false;
    clearInterval(upkeep);
    clearInterval(pacing);
    tickets.clear();
    for (const room of rooms.values()) if (room.agent) endAgent(room, room.agent);
    for (const peer of wss.clients) peer.terminate();
  });
  app.addHook('onClose', async () => {
    wss.close();
  });

  app.post('/v1/artworks/:artworkId/team-voice/join', async (req) => {
    const user = requireUser(req),
      artworkId = id.parse((req.params as any).artworkId);
    const authHash = hash(req.cookies.xiutu_session ?? '');
    await rateLimit(db, 'team-voice-join:' + user.id, 20, 60);
    await access(artworkId, user.id, authHash);
    if (!accepting || tickets.size >= 128 || actorRooms.size + handshakes >= 72)
      throw new HttpError(429, 'TEAM_VOICE_BUSY', '团队语音连接已满');
    if (actorRooms.has(user.id))
      throw new HttpError(409, 'TEAM_VOICE_ALREADY_JOINED', '请先离开现有团队通话');
    const ticket = opaqueToken();
    tickets.set(hash(ticket), {
      artworkId,
      actorId: user.id,
      authHash,
      expires: Date.now() + ticketMs,
    });
    return {
      ticket,
      path: '/v1/artworks/' + artworkId + '/team-voice/stream',
      expiresInSeconds: ticketMs / 1000,
    };
  });

  async function connected(req: import('fastify').FastifyRequest) {
    const user = requireUser(req),
      artworkId = id.parse((req.params as any).artworkId);
    const authHash = hash(req.cookies.xiutu_session ?? '');
    const current = await access(artworkId, user.id, authHash);
    const room = rooms.get(artworkId),
      peer = room?.peers.get(user.id);
    if (!room || !peer || peer.authHash !== authHash || !active(peer))
      throw new HttpError(409, 'TEAM_VOICE_JOIN_REQUIRED', '请先加入该作品的团队通话');
    peer.access = current;
    peer.authorizedAt = Date.now();
    return { room, peer };
  }
  async function contextFor(room: Room, peer: Peer, shared?: AssistantContext) {
    if (
      shared &&
      (shared.artworkId !== room.id ||
        shared.assetId !== peer.access.asset_id ||
        shared.expectedVersion !== peer.access.head_version)
    )
      throw new HttpError(409, 'TEAM_VOICE_CONTEXT_CHANGED', '作品版本已更新，请重新同步画面');
    if (shared) return shared;
    const { rows } = await db.query(
      'SELECT recipe FROM revisions WHERE artwork_id=$1 AND version=$2',
      [room.id, peer.access.head_version],
    );
    return assistantContextSchema.parse({
      artworkId: room.id,
      assetId: peer.access.asset_id,
      expectedVersion: peer.access.head_version,
      recipe: rows[0]?.recipe,
    });
  }
  app.post('/v1/artworks/:artworkId/team-voice/agent', { bodyLimit: 4_000_000 }, async (req) => {
    const { room, peer } = await connected(req);
    if (!canInvite(peer))
      throw new HttpError(403, 'TEAM_VOICE_AGENT_FORBIDDEN', '仅编辑成员可为团队邀请 AI');
    if (!factory.ready()) throw new HttpError(503, 'VOICE_NOT_CONFIGURED', '实时 AI 通话尚未配置');
    const body = teamVoiceInviteSchema.parse(req.body);
    const context = await contextFor(room, peer, body.context);
    await rateLimit(db, 'team-voice-ai:' + peer.actorId, 12, 3600);
    if (!active(peer) || room.peers.get(peer.actorId) !== peer)
      throw new HttpError(409, 'TEAM_VOICE_JOIN_REQUIRED', '团队通话已断开');
    if (room.agent) throw new HttpError(409, 'TEAM_VOICE_AGENT_BUSY', '当前团队通话已有 AI 会话');
    const lease: AgentLease = {
      host: peer,
      invitationId: randomUUID(),
      state: 'connecting',
      modelId: body.modelId,
      listeners: new Set(),
      mixer: new TeamVoiceMixer(),
      silenceUntil: 0,
      contextReady: true,
      expectedVersion: context.expectedVersion,
      assetId: context.assetId,
    };
    room.agent = lease;
    room.lastOutcome = undefined;
    roster(room);
    try {
      lease.connection = await factory.start({
        actorId: peer.actorId,
        authHash: peer.authHash,
        projectId: peer.access.project_id,
        artworkId: room.id,
        request: {
          idempotencyKey: body.idempotencyKey,
          modelId: body.modelId,
          backendModelId: body.backendModelId,
          voice: body.voice,
          context,
          scope: {
            spaceIds: [peer.access.space_id],
            referenceAssetIds: [],
            allowWebSearch: false,
            usePersonalMemory: false,
          },
        },
        stillWanted: () =>
          accepting && room.agent === lease && lease.state !== 'closing' && active(peer),
        event: (event) => eventFromAgent(room, lease, event),
      });
      if (lease.state === 'closing') lease.connection.end();
      return { state: lease.state };
    } catch (error) {
      if (room.agent === lease) {
        room.agent = undefined;
        room.lastOutcome = 'failed';
        roster(room);
        prune(room);
      }
      throw error;
    }
  });
  app.put(
    '/v1/artworks/:artworkId/team-voice/agent/context',
    { bodyLimit: 4_000_000 },
    async (req) => {
      const { room, peer } = await connected(req);
      const lease = room.agent;
      if (lease?.host !== peer || lease.state !== 'active' || !lease.connection)
        throw new HttpError(403, 'TEAM_VOICE_AGENT_FORBIDDEN', '仅邀请者可更新 AI 画面');
      if (lease.lastContextSent && Date.now() - lease.lastContextSent < 2600)
        throw new HttpError(429, 'TEAM_VOICE_CONTEXT_RATE', '请稍后再同步画面');
      lease.lastContextSent = Date.now();
      const shared = req.body ? assistantContextSchema.parse(req.body) : undefined;
      const context = await contextFor(room, peer, shared);
      if (!active(peer) || room.agent !== lease || lease.state !== 'active')
        throw new HttpError(409, 'TEAM_VOICE_CONTEXT_CHANGED', '团队通话已变化');
      pauseContext(room, lease);
      lease.expectedVersion = context.expectedVersion;
      lease.assetId = context.assetId;
      lease.contextTag = randomUUID();
      roster(room);
      lease.connection.update(context, lease.contextTag);
      return { submitted: true };
    },
  );
  app.delete('/v1/artworks/:artworkId/team-voice/agent', async (req) => {
    const { room, peer } = await connected(req);
    if (room.agent) {
      if (room.agent.host !== peer && !['owner', 'admin'].includes(peer.access.role))
        throw new HttpError(403, 'TEAM_VOICE_AGENT_FORBIDDEN', '仅邀请者或管理员可结束 AI 通话');
      endAgent(room, room.agent);
    }
    return { ok: true };
  });

  return {
    upgrade(path: string, request: IncomingMessage, socket: Duplex, head: Buffer) {
      const match = upgradePath.exec(path);
      if (!match) return false;
      let upgraded = false;
      handshakes++;
      void (async () => {
        const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
          .split(',')
          .map((value) => value.trim());
        const auth = /(?:^|;\s*)xiutu_session=([A-Za-z0-9_-]{40,64})(?:;|$)/.exec(
          request.headers.cookie ?? '',
        )?.[1];
        if (
          !accepting ||
          handshakes > 16 ||
          !config.origins.includes(request.headers.origin ?? '') ||
          !auth ||
          protocols.length !== 2 ||
          protocols[0] !== TEAM_VOICE_PROTOCOL ||
          !/^[A-Za-z0-9_-]{43}$/.test(protocols[1]!)
        )
          throw new Error('voice handshake denied');
        const ticketKey = hash(protocols[1]!),
          authHash = hash(auth);
        const ticket = tickets.get(ticketKey);
        if (
          !ticket ||
          ticket.artworkId !== match[1] ||
          ticket.authHash !== authHash ||
          ticket.expires <= Date.now()
        )
          throw new Error('voice ticket denied');
        const permission = await access(ticket.artworkId, ticket.actorId, authHash);
        if (
          !accepting ||
          socket.destroyed ||
          tickets.get(ticketKey) !== ticket ||
          actorRooms.has(ticket.actorId) ||
          actorRooms.size >= 72
        )
          throw new Error('voice capacity');
        const room: Room = rooms.get(ticket.artworkId) ?? {
          id: ticket.artworkId,
          peers: new Map(),
        };
        if (room.peers.size >= TEAM_VOICE_MAX_MEMBERS) throw new Error('room full');
        wss.handleUpgrade(request, socket, head, (ws) => {
          upgraded = true;
          tickets.delete(ticketKey);
          const used = new Set([...room.peers.values()].map((peer) => peer.speakerId));
          const speakerId = Array.from({ length: TEAM_VOICE_MAX_MEMBERS }, (_, i) => i + 1).find(
            (slot) => !used.has(slot),
          )!;
          const peer: Peer = {
            actorId: ticket.actorId,
            authHash,
            access: permission,
            ws,
            speakerId,
            authorizedAt: Date.now(),
            lastPing: Date.now(),
            muted: true,
            windowStart: Date.now(),
            windowBytes: 0,
          };
          rooms.set(room.id, room);
          room.peers.set(peer.actorId, peer);
          actorRooms.set(peer.actorId, room);
          ws.on('close', () => leave(room, peer));
          ws.on('error', () => {
            ws.terminate();
            leave(room, peer);
          });
          ws.on('message', (bytes, binary) => {
            try {
              receive(
                room,
                peer,
                Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as ArrayBuffer),
                binary,
              );
            } catch {
              ws.close(1011, 'voice processing failed');
            }
          });
          send(peer, { type: 'joined', speakerId, canInvite: canInvite(peer) });
          roster(room);
        });
      })()
        .catch(() => {
          if (!socket.destroyed) {
            if (upgraded) socket.destroy();
            else
              socket.end(
                'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
              );
          }
        })
        .finally(() => {
          handshakes--;
        });
      return true;
    },
  };
}
