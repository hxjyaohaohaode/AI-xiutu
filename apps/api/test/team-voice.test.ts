import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { adjustUnits, transaction } from '@ai-xiutu/db';
import { TEAM_VOICE_PROTOCOL, type TeamVoiceEvent } from '@ai-xiutu/contracts';
import { assistantModelConfigSchema } from '@ai-xiutu/assistant';
import { collaborationFixture } from './collaboration-fixture.js';
import { TeamVoiceMixer } from '../src/assistant/team-voice-mix.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
async function waitFor<T>(read: () => T, accept: (value: T) => unknown) {
  const deadline = Date.now() + 7000;
  do {
    const value = read();
    if (accept(value)) return value;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for team audio state');
}
function stream(ws: WebSocket) {
  const messages: TeamVoiceEvent[] = [],
    frames: Buffer[] = [];
  ws.on('message', (data, binary) => {
    if (binary) frames.push(Buffer.from(data as Buffer));
    else messages.push(JSON.parse(String(data)));
  });
  ws.on('error', () => {});
  return {
    ws,
    messages,
    frames,
    send(event: object) {
      ws.send(JSON.stringify(event));
    },
    async wait<T extends TeamVoiceEvent['type']>(
      type: T,
      accepts: (event: Extract<TeamVoiceEvent, { type: T }>) => boolean = () => true,
    ) {
      type Event = Extract<TeamVoiceEvent, { type: T }>;
      const event = await waitFor(
        () =>
          messages.findLast((item): item is Event => item.type === type && accepts(item as Event)),
        (item) => item !== undefined,
      );
      return event!;
    },
    frame(id: number, pcm: Buffer) {
      return waitFor(
        () => frames.find((bytes) => bytes.readUInt16LE(0) === id && bytes.subarray(2).equals(pcm)),
        Boolean,
      );
    },
  };
}

function tone(sample: number, frames = 1) {
  const pcm = Buffer.alloc(frames * 960);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(sample, i);
  return pcm;
}

test('room mix preserves solo PCM, adds overlapping speakers and bounds unplayed frames', () => {
  const mix = new TeamVoiceMixer(() => 0);
  const allowed = new Set([1, 2]);
  const solo = tone(-17281);
  mix.push(1, solo);
  assert.deepEqual(mix.take(allowed), solo);
  mix.push(1, tone(8900));
  mix.push(2, tone(-4400));
  assert.deepEqual(mix.take(allowed), tone(4500));
  mix.push(1, tone(30000));
  mix.push(2, tone(30000));
  assert.deepEqual(mix.take(allowed), tone(32767));
  mix.push(1, tone(-30000));
  mix.push(2, tone(-30000));
  assert.deepEqual(mix.take(allowed), tone(-32768));
  mix.push(1, tone(300, 8));
  mix.push(1, tone(400, 3));
  for (let i = 0; i < 5; i++) assert.deepEqual(mix.take(allowed), tone(300));
  for (let i = 0; i < 3; i++) assert.deepEqual(mix.take(allowed), tone(400));
  assert.equal(mix.take(allowed), undefined);
  mix.push(1, tone(900, 2));
  mix.drop(1);
  mix.push(2, tone(800, 2));
  assert.equal(mix.take(new Set([1])), undefined);
  assert.equal(mix.take(allowed), undefined);
  mix.push(1, tone(700).subarray(0, 96));
  assert.deepEqual(
    mix.take(allowed),
    Buffer.concat([tone(700).subarray(0, 96), Buffer.alloc(864)]),
  );
});

test('team PCM ring expires stale speech after stalls, keeps newly received samples and never retains revoked tracks', () => {
  let now = 0;
  const mix = new TeamVoiceMixer(() => now),
    allowed = new Set([1, 2]);
  mix.push(1, tone(100, 4));
  now = 161;
  assert.equal(mix.take(allowed), undefined);
  mix.push(1, tone(200, 8));
  now += 20;
  mix.push(1, tone(300, 4));
  for (let i = 0; i < 4; i++) assert.deepEqual(mix.take(allowed), tone(200));
  now += 145;
  assert.deepEqual(mix.take(allowed), tone(300));
  assert.deepEqual(mix.take(allowed), tone(300));
  mix.push(2, tone(800));
  assert.deepEqual(mix.take(new Set([1])), tone(300));
  mix.clear();
  assert.equal(mix.take(allowed), undefined);
  assert.throws(() => mix.push(1, Buffer.alloc(3)), /complete samples/);
});

test(
  'team voice routes only authorized peer and opted-in AI audio and closes under revocation',
  { skip: !databaseUrl },
  async () => {
    const vendor = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((ready) => vendor.once('listening', ready));
    const address = vendor.address();
    if (!address || typeof address === 'string') throw new Error('Fixture address');
    const vendorEvents: any[] = [],
      sockets: WebSocket[] = [];
    vendor.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', (bytes) => {
        const event = JSON.parse(String(bytes));
        vendorEvents.push(event);
        if (event.type === 'session.start')
          socket.send(
            JSON.stringify({ type: 'session.started', session: { id: 'team-local-live' } }),
          );
        if (event.type === 'session.close')
          socket.send(JSON.stringify({ type: 'session.closed', usage: { seconds: 4 } }));
      });
    });
    const model = 'team-local-' + randomUUID();
    let modelRequests = 0;
    const f = await collaborationFixture(databaseUrl!, {
      assistant: {
        env: {
          NODE_ENV: 'test',
          AI_ASSISTANT_ENABLED: 'true',
          AI_VOICE_ENABLED: 'true',
          OPENAI_API_KEY: 'team-voice-test-only',
        },
        connectVoice() {
          return new WebSocket('ws://127.0.0.1:' + address.port);
        },
        textModerator: {
          configured: true,
          async check(text) {
            return { decision: 'passed', inputHash: hash(text), requestId: 'team-test' };
          },
        },
        imageModerator: {
          configured: true,
          async check(bytes) {
            return { decision: 'passed', inputHash: hash(bytes), requestId: 'team-test' };
          },
        },
        fetcher: async () => {
          modelRequests++;
          return Response.json(
            {
              status: 'completed',
              output: [
                {
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: '先看现有画面，再决定曝光。' }],
                },
              ],
              usage: { input_tokens: 50, output_tokens: 20 },
            },
            { headers: { 'x-request-id': 'team-test-responses' } },
          );
        },
      },
    });
    const connected: WebSocket[] = [];
    try {
      for (const [id, operation] of [
        [model, 'assistant-turn'],
        ['gpt-live-1', 'realtime-voice'],
      ])
        await f.db.query(
          'INSERT INTO assistant_model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config',
          [
            id,
            JSON.stringify(
              assistantModelConfigSchema.parse({
                enabled: true,
                provider: 'openai',
                operations: [operation],
                unitCost: 5,
                maxSeconds: 30,
                maxDelegations: 2,
              }),
            ),
          ],
        );
      await transaction(f.db, (tx) =>
        adjustUnits(tx, {
          spaceId: f.teamId,
          actorId: f.actors.operator.id,
          units: 50,
          reason: 'team voice fixture',
          idempotencyKey: randomUUID(),
          requestHash: randomUUID(),
        }),
      );
      const path = '/v1/artworks/' + f.artwork.artwork.id + '/team-voice';
      const url = (await f.app.listen({ port: 0, host: '127.0.0.1' })).replace(/^http/, 'ws');
      const open = (
        actor: 'owner' | 'editor' | 'viewer',
        ticket: string,
        streamPath: string,
        origin = f.origin,
      ) => {
        const ws = new WebSocket(url + streamPath, [TEAM_VOICE_PROTOCOL, ticket], {
          origin,
          headers: { cookie: f.actors[actor].cookie },
        });
        connected.push(ws);
        return stream(ws);
      };
      assert.equal((await f.call('POST', path + '/join', {}, 'outsider')).statusCode, 404);
      const joined = async (actor: 'owner' | 'editor' | 'viewer') => {
        const r = await f.call('POST', path + '/join', {}, actor);
        assert.equal(r.statusCode, 200, r.body);
        const data = r.json();
        const socket = open(actor, data.ticket, data.path);
        const initial = await socket.wait('joined');
        return { ...socket, speakerId: initial.speakerId, canInvite: initial.canInvite, data };
      };
      const owner = await joined('owner');
      const editor = await joined('editor');
      const viewer = await joined('viewer');
      assert.equal(viewer.canInvite, false);
      await owner.wait('roster', (event) => event.members.length === 3);
      const replay = open('owner', owner.data.ticket, owner.data.path);
      await waitFor(
        () => replay.ws.readyState,
        (state) => state === WebSocket.CLOSED,
      );
      const pcm = Buffer.alloc(960, 37);
      editor.ws.send(pcm);
      await delay(80);
      assert.equal(owner.frames.length, 0, 'rooms join listening-only');
      editor.send({ type: 'mute', muted: false });
      await owner.wait('roster', (event) =>
        event.members.some((item: any) => item.speakerId === editor.speakerId && !item.muted),
      );
      editor.ws.send(pcm);
      await owner.frame(editor.speakerId, pcm);
      await viewer.frame(editor.speakerId, pcm);
      assert.equal(editor.frames.length, 0, 'the sender never hears its own PCM relay');
      assert.equal(sockets.length, 0, 'peer-only voice does not contact OpenAI');

      const invite = {
        confirmed: true,
        idempotencyKey: randomUUID(),
        modelId: 'gpt-live-1',
        backendModelId: model,
        voice: 'marin',
      };
      assert.equal((await f.call('POST', path + '/agent', invite, 'viewer')).statusCode, 403);
      const started = await f.call('POST', path + '/agent', invite);
      assert.equal(started.statusCode, 200, started.body);
      const active = await viewer.wait('roster', (event) => event.agent.state === 'active');
      assert.equal(active.agent.state, 'active');
      const invitationId = active.agent.invitationId;
      assert.equal(
        (
          await f.call(
            'POST',
            path + '/agent',
            { ...invite, idempotencyKey: randomUUID() },
            'editor',
          )
        ).statusCode,
        409,
      );
      const marker = pcm.toString('base64');
      editor.ws.send(pcm);
      await delay(120);
      assert.ok(
        !vendorEvents.some((event) => event.audio === marker),
        'audio reaches AI only with per-member consent',
      );
      editor.send({ type: 'ai-listen', invitationId: randomUUID(), enabled: true });
      editor.ws.send(pcm);
      await delay(120);
      assert.ok(
        !vendorEvents.some((event) => event.audio === marker),
        'another invitation cannot authorize audio',
      );
      editor.send({ type: 'ai-listen', invitationId, enabled: true });
      owner.send({ type: 'mute', muted: false });
      owner.send({ type: 'ai-listen', invitationId, enabled: true });
      await owner.wait(
        'roster',
        (event) => event.members.filter((peer) => peer.listeningToAi && !peer.muted).length === 2,
      );
      editor.ws.send(pcm);
      await waitFor(() => vendorEvents.some((event) => event.audio === marker), Boolean);
      const editorTone = tone(-1900, 6),
        ownerTone = tone(7600, 6);
      editor.ws.send(editorTone);
      owner.ws.send(ownerTone);
      await viewer.frame(editor.speakerId, editorTone);
      await viewer.frame(owner.speakerId, ownerTone);
      await waitFor(
        () => vendorEvents.some((event) => event.audio === tone(5700).toString('base64')),
        Boolean,
      );
      editor.send({ type: 'ai-listen', invitationId, enabled: false });
      const withdrawn = tone(9178);
      editor.ws.send(withdrawn);
      await owner.frame(editor.speakerId, withdrawn);
      await delay(150);
      assert.ok(!vendorEvents.some((event) => event.audio === withdrawn.toString('base64')));
      const response = Buffer.alloc(1920, 54);
      sockets[0]!.send(
        JSON.stringify({ type: 'session.output_audio.delta', delta: response.toString('base64') }),
      );
      await owner.frame(0, response);
      await editor.frame(0, response);
      await viewer.frame(0, response);
      sockets[0]!.send(
        JSON.stringify({ type: 'session.input_transcript.delta', delta: '查看当前作品曝光' }),
      );
      sockets[0]!.send(
        JSON.stringify({
          type: 'session.delegation.created',
          delegation: { id: 'team-delegation', target: 'client' },
        }),
      );
      await viewer.wait(
        'ai-transcript',
        (event) => event.role === 'user' && event.text === '查看当前作品曝光',
      );
      await viewer.wait('ai-result', (event) => event.text.includes('先看现有画面'));
      assert.equal(modelRequests, 1);
      assert.equal((await f.call('PUT', path + '/agent/context', {}, 'editor')).statusCode, 403);
      const newer = await f.call('POST', '/v1/artworks/' + f.artwork.artwork.id + '/revisions', {
        expectedVersion: f.artwork.artwork.headVersion,
        recipe: { ...f.recipe, adjustments: { ...f.recipe.adjustments, exposure: 0.5 } },
        label: 'Team edit during voice',
      });
      assert.equal(newer.statusCode, 201, newer.body);
      await viewer.wait(
        'roster',
        (event) => event.agent.state === 'active' && event.agent.contextReady === false,
      );
      const blocked = tone(9201);
      owner.ws.send(blocked);
      await viewer.frame(owner.speakerId, blocked);
      await delay(140);
      assert.ok(!vendorEvents.some((event) => event.audio === blocked.toString('base64')));
      assert.equal((await f.call('PUT', path + '/agent/context')).statusCode, 200);
      await viewer.wait('ai-context', (event) => event.imageShared === false);
      editor.send({ type: 'ai-listen', invitationId, enabled: true });
      await owner.wait(
        'roster',
        (event) =>
          event.agent.state === 'active' &&
          event.agent.contextReady &&
          event.members.filter((peer) => peer.listeningToAi && !peer.muted).length === 2,
      );
      await f.db.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
        f.teamId,
        f.actors.editor.id,
      ]);
      await waitFor(
        () => editor.ws.readyState,
        (state) => state === WebSocket.CLOSED,
      );
      await owner.wait(
        'roster',
        (event) =>
          event.members.length === 2 &&
          event.agent.state === 'active' &&
          event.members.every((peer) => peer.speakerId !== editor.speakerId),
      );
      assert.equal((await f.call('DELETE', path + '/agent', undefined, 'viewer')).statusCode, 403);
      assert.equal((await f.call('DELETE', path + '/agent')).statusCode, 200);
      await viewer.wait(
        'roster',
        (event) => event.agent.state === 'off' && event.agent.lastOutcome === 'closed',
      );
      const billing = (
        await f.db.query(
          'SELECT v.actor_id,v.state,v.usage,h.space_id,h.state AS hold_state FROM voice_sessions v JOIN quota_holds h ON h.id=v.hold_id WHERE v.project_id=$1',
          [f.projectId],
        )
      ).rows[0]!;
      assert.equal(billing.actor_id, f.actors.owner.id);
      assert.equal(billing.space_id, f.teamId);
      assert.equal(billing.hold_state, 'settled');
      assert.equal(billing.usage.voiceChannel, 'team');
      const peerPcm = Buffer.alloc(960, 67);
      owner.ws.send(peerPcm);
      await viewer.frame(owner.speakerId, peerPcm);
      assert.equal(sockets.length, 1);
    } finally {
      for (const ws of connected) ws.terminate();
      try {
        await f.db.query('DELETE FROM assistant_model_configs WHERE id=$1', [model]);
      } finally {
        await f.close();
      }
      for (const ws of vendor.clients) ws.terminate();
      await new Promise<void>((resolve) => vendor.close(() => resolve()));
    }
  },
);
