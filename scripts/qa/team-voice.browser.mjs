/** Two real Chromium pages, actual AudioWorklet with a synthetic microphone, local vendor protocol. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import WebSocket, { WebSocketServer } from 'ws';
import { adjustUnits, transaction } from '@ai-xiutu/db';
import { assistantModelConfigSchema } from '@ai-xiutu/assistant';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  process.env.CI !== 'true' ||
  process.env.NODE_ENV === 'production' ||
  !databaseUrl ||
  !decodeURIComponent(new URL(databaseUrl).pathname).includes('test')
)
  throw new Error('Team voice QA requires CI=true and a disposable TEST_DATABASE_URL');
process.env.NODE_ENV = 'test';
const port = Number(process.env.BROWSER_WEB_PORT ?? 4186);
const origin = 'http://127.0.0.1:' + port;
const artifact = resolve(process.env.BROWSER_ARTIFACT_DIR ?? 'artifacts/browser-team-voice');
await mkdir(artifact, { recursive: true });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const report = { cases: [], pageErrors: [], provider: 'local WebSocket fixture', paidCalls: 0 };
const publicQueries = [];
const model = 'team-browser-' + randomUUID();
const vendor = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise((done) => vendor.once('listening', done));
const sockets = [],
  inbound = [];
let holdSoloReady = false,
  holdSoloClose = false;
vendor.on('connection', (ws) => {
  const solo = sockets.length > 0;
  sockets.push(ws);
  ws.on('message', (raw) => {
    const event = JSON.parse(String(raw));
    inbound.push(event);
    if (event.type === 'session.start' && (!solo || !holdSoloReady))
      ws.send(JSON.stringify({ type: 'session.started', session: { id: 'team-browser-live' } }));
    if (event.type === 'session.close' && (!solo || !holdSoloClose))
      ws.send(JSON.stringify({ type: 'session.closed', usage: { seconds: 5 } }));
  });
});
let fixture, browser, vite;
const wait = async (read, label, limit = 18_000) => {
  const expires = Date.now() + limit;
  do {
    const value = await read();
    if (value) return value;
    await delay(50);
  } while (Date.now() < expires);
  throw new Error('Timed out: ' + label);
};
async function check(name, run) {
  try {
    await run();
    report.cases.push({ name, state: 'passed' });
    console.log('Passed: ' + name);
  } catch (error) {
    report.cases.push({ name, state: 'failed', message: String(error) });
    throw error;
  }
}
async function openAssistant(page) {
  await page.locator('[data-dock-tool="ai"]:visible').click();
  await page.getByLabel('向智能体描述修改需求').waitFor();
  return page.locator('.live-assistant');
}
async function openAssistantSettings(page) {
  const workspace = page.locator('.voice-call-workspace');
  const trigger = workspace.getByRole('button', { name: '助手设置', exact: true });
  if (!(await trigger.isVisible())) {
    await workspace.getByRole('button', { name: '通话工具', exact: true }).click();
  }
  await trigger.click();
  const settings = page.getByRole('region', { name: '助手设置', exact: true });
  await settings.waitFor();
  assert.equal(await page.getByRole('dialog', { name: '助手设置', exact: true }).count(), 0);
  return settings;
}
async function choose(scope, label, option) {
  const control = scope.getByRole('combobox', { name: label, exact: true });
  await control.click();
  const list = scope.getByRole('listbox', { name: label, exact: true });
  await list.getByText(option, { exact: true }).click();
  await list.waitFor({ state: 'hidden' });
}
async function closeAIPanel(page) {
  const mobile = page
    .locator('.live-assistant')
    .getByRole('button', { name: '返回编辑器', exact: true });
  if (await mobile.isVisible()) await mobile.click();
  else
    await page
      .locator('[data-panel-id="ai"]')
      .getByRole('button', { name: '收起AI 助手，可从工具栏重新打开', exact: true })
      .click();
}
async function changeView(page, label) {
  const direct = page
    .getByRole('navigation', { name: '工作视图', exact: true })
    .getByRole('button', { name: label, exact: true });
  if (await direct.isVisible()) await direct.click();
  else {
    const compact = page.getByRole('button', { name: '切换工作视图', exact: true });
    await (await compact.isVisible() ? compact : page.getByRole('button', { name: '项目与用量', exact: true })).click();
    await page
      .getByRole('navigation', { name: '切换工作视图', exact: true })
      .getByRole('button', { name: new RegExp('^' + label) })
      .click();
  }
}
try {
  fixture = await collaborationFixture(databaseUrl, {
    origin,
    assistant: {
      env: {
        AI_ASSISTANT_ENABLED: 'true',
        AI_VOICE_ENABLED: 'true',
        OPENAI_API_KEY: 'local-team-browser-only',
      },
      connectVoice() {
        return new WebSocket('ws://127.0.0.1:' + vendor.address().port);
      },
      textModerator: {
        configured: true,
        async check(text) {
          return { decision: 'passed', inputHash: sha(text), requestId: 'team-qa-text' };
        },
      },
      imageModerator: {
        configured: true,
        async check(bytes) {
          return { decision: 'passed', inputHash: sha(bytes), requestId: 'team-qa-image' };
        },
      },
      fetcher: async (_url, init) => {
        const body = JSON.parse(init.body);
        const output = [];
        if (typeof body.input === 'string') {
          publicQueries.push(body.input);
          output.push({ type: 'web_search_call', status: 'completed' });
        }
        output.push({
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: '柔光参考已找到。',
              annotations:
                typeof body.input === 'string'
                  ? [
                      {
                        type: 'url_citation',
                        url: 'https://example.com/lighting',
                        title: '布光资料',
                        start_index: 0,
                        end_index: 4,
                      },
                    ]
                  : [],
            },
          ],
        });
        return Response.json({
          status: 'completed',
          output,
          usage: { input_tokens: 20, output_tokens: 8 },
        });
      },
    },
  });
  for (const [id, operation] of [
    [model, 'assistant-turn'],
    ['gpt-live-1', 'realtime-voice'],
  ])
    await fixture.db.query(
      'INSERT INTO assistant_model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config',
      [
        id,
        JSON.stringify(
          assistantModelConfigSchema.parse({
            enabled: true,
            provider: 'openai',
            operations: [operation],
            label: operation === 'assistant-turn' ? '本地团队思考模型' : '本地 Live 协议',
            unitCost: 5,
            // Responsive checks and screenshots run while the disposable call is active.
            maxSeconds: 180,
            imageInput: true,
            webSearch: operation === 'assistant-turn',
          }),
        ),
      ],
    );
  await transaction(fixture.db, (tx) =>
    adjustUnits(tx, {
      spaceId: fixture.teamId,
      actorId: fixture.actors.operator.id,
      units: 100,
      reason: 'team browser QA',
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    }),
  );
  await fixture.app.listen({ port: 0, host: '127.0.0.1' });
  process.env.PORT = String(fixture.app.server.address().port);
  vite = await createServer({
    cacheDir: resolve(artifact, 'vite-cache'),
    configFile: resolve('apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || undefined,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...(process.env.BROWSER_SPEECH_FIXTURE
        ? ['--use-file-for-fake-audio-capture=' + resolve(process.env.BROWSER_SPEECH_FIXTURE)]
        : []),
    ],
  });
  report.browser = browser.version();
  async function open(actor, viewport) {
    const context = await browser.newContext({
      viewport,
      permissions: ['microphone'],
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: 'xiutu_session', value: fixture.actors[actor].cookie.split('=')[1], url: origin },
    ]);
    const page = await context.newPage();
    const frames = [];
    await page.addInitScript((useNativeCaptions) => {
      if (!useNativeCaptions) {
        Object.defineProperty(window, 'SpeechRecognition', {
          value: undefined,
          configurable: true,
        });
        Object.defineProperty(window, 'webkitSpeechRecognition', {
          value: undefined,
          configurable: true,
        });
      }
      const Original = window.AudioWorkletNode;
      window.teamVoiceWorklets = [];
      window.teamVoicePlayback = 0;
      window.teamVoiceAiSpans = [];
      window.AudioWorkletNode = class extends Original {
        constructor(audio, name, options) {
          super(audio, name, options);
          window.teamVoiceWorklets.push(name);
        }
      };
      const start = AudioBufferSourceNode.prototype.start;
      const stop = AudioBufferSourceNode.prototype.stop;
      const aiNodes = new WeakMap();
      AudioBufferSourceNode.prototype.start = function (...args) {
        const samples = this.buffer?.sampleRate === 24000 ? this.buffer.getChannelData(0) : null;
        if (samples?.some(Boolean)) window.teamVoicePlayback++;
        if (samples?.[0] === 0x2c2c / 32768 && samples[1] === -0x2c2c / 32768) {
          const span = { at: args[0], duration: this.buffer.duration, stopped: false };
          aiNodes.set(this, span);
          window.teamVoiceAiSpans.push(span);
        }
        return start.apply(this, args);
      };
      AudioBufferSourceNode.prototype.stop = function (...args) {
        const span = aiNodes.get(this);
        if (span) span.stopped = true;
        return stop.apply(this, args);
      };
    }, Boolean(process.env.BROWSER_SPEECH_FIXTURE));
    page.on('pageerror', (error) => report.pageErrors.push(String(error)));
    page.on('websocket', (ws) => {
      if (ws.url().includes('/team-voice/stream'))
        ws.on('framereceived', ({ payload }) => {
          if (Buffer.isBuffer(payload)) frames.push(payload);
        });
    });
    const session = await context.request.get(origin + '/v1/session');
    assert.equal(session.status(), 200, 'the studio should reach the isolated account service');
    assert.equal(
      (await session.json()).user?.id,
      fixture.actors[actor].id,
      'the expected actor is logged in',
    );
    const navigation = await page.goto(`${origin}/#/studio`, { waitUntil: 'domcontentloaded' });
    assert.ok(navigation?.ok(), 'the studio document loads');
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await page
      .locator('dialog.sidebar-navigation-modal')
      .getByRole('button', { name: /^V4 team/ })
      .click();
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await page
      .getByRole('navigation', { name: '项目', exact: true })
      .getByRole('button', { name: 'V4 project', exact: true })
      .click();
    await page
      .locator('.library-reference-masonry')
      .getByRole('button', { name: /Collaborative portrait/ })
      .click();
    await page.locator('.collaboration-status[data-state="ready"]').waitFor();
    await page.locator('.collaboration-summary').click();
    const panel = page.getByRole('region', { name: '团队语音' });
    await panel.getByRole('button', { name: '加入团队语音', exact: true }).click();
    await panel.getByRole('button', { name: '离开团队语音', exact: true }).waitFor();
    return { page, panel, frames };
  }
  const owner = await open('owner', { width: 1440, height: 960 });
  const editor = await open('editor', { width: 390, height: 844 });
  const hasMic = (frame) =>
    frame.length > 2 && frame.readUInt16LE(0) > 0 && frame.subarray(2).some((byte) => byte !== 0);
  const audibleToAi = (event) =>
    event.type === 'session.input_audio.append' &&
    Buffer.from(event.audio, 'base64').some((byte) => byte !== 0);
  await check('peer browser microphones relay PCM to a separate team page', async () => {
    for (const { panel } of [owner, editor])
      await panel.getByRole('button', { name: '开启麦克风', exact: true }).click();
    for (const target of [owner, editor]) {
      await target.panel.getByRole('button', { name: '关闭麦克风', exact: true }).waitFor();
      await wait(() => target.frames.some(hasMic), 'room PCM from actual AudioWorklet');
      assert.ok(
        await target.page.evaluate(() => window.teamVoiceWorklets.includes('editor-microphone')),
      );
      await wait(
        () => target.page.evaluate(() => window.teamVoicePlayback > 0),
        'non-silent audio scheduled',
      );
    }
    assert.equal(sockets.length, 0);
  });
  await check('members-only captions are optional and do not add a voice provider', async () => {
    const button = editor.panel.getByRole('button', { name: '显示字幕', exact: true });
    await button.click();
    const captions = editor.panel.locator('[aria-label="实时字幕"]');
    await captions.waitFor();
    if (process.env.BROWSER_SPEECH_FIXTURE) {
      await wait(
        async () => !(await captions.innerText()).includes('正在启动'),
        'native recognizer availability',
      );
      await delay(4000);
      report.nativeMemberCaptions = await captions.innerText();
    } else {
      await captions.getByText('当前浏览器不支持本机成员字幕。', { exact: true }).waitFor();
    }
    await editor.panel.getByRole('button', { name: '隐藏字幕', exact: true }).click();
    assert.equal(await captions.isVisible(), false);
    assert.equal(sockets.length, 0);
  });
  await check(
    'open microphones share continuous audio with one invited AI after consent',
    async () => {
      await owner.panel.getByText('邀请 AI 加入', { exact: true }).click();
      await choose(owner.panel, '团队语音模型', '本地 Live 协议');
      await choose(owner.panel, '团队思考模型', '本地团队思考模型');
      await owner.panel.getByRole('button', { name: '确认邀请 AI' }).click();
      await editor.panel.getByText('团队 AI 已加入', { exact: true }).waitFor();
      await wait(
        () => inbound.some((event) => event.type === 'session.input_audio.append'),
        'synthetic idle PCM',
      );
      assert.ok(!inbound.some(audibleToAi), 'voice in room reaches peers before AI opt-in');
      const consent = (target) =>
        target.panel.getByRole('checkbox', { name: '允许本轮 AI 听我的麦克风' });
      assert.equal(await consent(editor).isChecked(), false);
      await consent(editor).click();
      await consent(owner).click();
      await wait(() => inbound.some(audibleToAi), 'actual microphone reaches invited AI');
      await wait(
        async () =>
          (await editor.panel.getByText('麦克风开启 · AI 可听见', { exact: true }).count()) === 2,
        'both microphones simultaneously authorized',
      );
      const beforeContinued = inbound.filter(audibleToAi).length;
      await wait(
        () => inbound.filter(audibleToAi).length > beforeContinued + 12,
        'continuous frames without a held button',
      );
      await owner.panel.getByRole('button', { name: '同步 AI 画面' }).click();
      await owner.panel.getByText('AI 已同步参数', { exact: true }).waitFor();
      await editor.panel.getByText('AI 已同步参数', { exact: true }).waitFor();
      const answer = Buffer.alloc(1920, 44);
      answer.writeInt16LE(-0x2c2c, 2);
      const chunk = JSON.stringify({
        type: 'session.output_audio.delta',
        delta: answer.toString('base64'),
      });
      const chunkCount = 40;
      for (let i = 0; i < chunkCount; i++) sockets[0].send(chunk);
      sockets[0].send(
        JSON.stringify({ type: 'session.output_transcript.delta', delta: '请先保留原图。' }),
      );
      sockets[0].send(
        JSON.stringify({ type: 'session.input_transcript.delta', delta: '一起看曝光。' }),
      );
      await wait(
        () =>
          [owner, editor].every(({ frames }) =>
            frames.some((f) => f.readUInt16LE(0) === 0 && f.subarray(2).equals(answer)),
          ),
        'both receive AI speaker',
      );
      report.aiPlayback = [];
      for (const { page } of [owner, editor]) {
        await wait(
          () => page.evaluate((count) => window.teamVoiceAiSpans.length === count, chunkCount),
          'full shared AI utterance scheduled',
        );
        const spans = await page.evaluate(() => window.teamVoiceAiSpans);
        for (const [index, span] of spans.entries()) {
          assert.equal(
            span.stopped,
            false,
            'AI audio was not cleared by the short peer jitter buffer',
          );
          if (index > 0)
            assert.ok(Math.abs(span.at - spans[index - 1].at - spans[index - 1].duration) < 0.005);
        }
        report.aiPlayback.push({
          chunks: spans.length,
          durationMs: 1000 * spans.reduce((total, span) => total + span.duration, 0),
        });
      }
      const captions = editor.panel.locator('[aria-label="实时字幕"]');
      await captions.getByText('请先保留原图。', { exact: false }).waitFor();
      await captions.getByText('一起看曝光。', { exact: false }).waitFor();
      await editor.panel.getByRole('button', { name: '隐藏字幕', exact: true }).click();
      assert.equal(await captions.isVisible(), false);
      const peerBefore = editor.frames.filter(hasMic).length;
      await wait(
        () => editor.frames.filter(hasMic).length > peerBefore + 5,
        'captions toggle leaves peer audio active',
      );
      await editor.panel.getByRole('button', { name: '显示字幕', exact: true }).click();
      await captions.getByText('请先保留原图。', { exact: false }).waitFor();
      for (const [target, viewport] of [
        [owner, { width: 1440, height: 960 }],
        [editor, { width: 390, height: 844 }],
        [owner, { width: 820, height: 1180 }],
        [editor, { width: 844, height: 390 }],
      ]) {
        await target.page.setViewportSize(viewport);
        assert.ok(
          await target.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
        await target.page.screenshot({
          path: resolve(artifact, 'team-' + target.page.viewportSize().width + '.png'),
        });
      }
      await changeView(owner.page, '文档');
      const ongoing = owner.page.getByRole('region', { name: '当前团队通话', exact: true });
      await ongoing.getByText('麦克风已开启', { exact: true }).waitFor();
      assert.equal(
        await ongoing.getByRole('button', { name: '关闭麦克风', exact: true }).isEnabled(),
        true,
      );
      assert.equal(
        await ongoing.getByRole('button', { name: '离开通话', exact: true }).isEnabled(),
        true,
      );
      await ongoing.getByRole('button', { name: '返回精修', exact: true }).click();
      await owner.page.locator('.collaboration-summary').click();
      await owner.panel.getByText('团队 AI 已加入', { exact: true }).waitFor();
      await consent(editor).click();
      await consent(owner).click();
      await wait(
        async () => !(await consent(editor).isChecked()) && !(await consent(owner).isChecked()),
        'both consent withdrawals acknowledged',
      );
      await delay(250);
      assert.ok(
        !inbound.slice(-8).some(audibleToAi),
        'revoking both inputs leaves only silence for AI',
      );
      await owner.panel.getByRole('button', { name: '离开团队语音', exact: true }).click();
      await wait(
        async () => !(await editor.panel.getByText('团队 AI 已加入', { exact: true }).count()),
        'AI closes when its host leaves',
      );
      assert.equal(
        await editor.panel.getByRole('button', { name: '离开团队语音', exact: true }).count(),
        1,
      );
    },
  );
  await check('an unresolved team invitation blocks a new solo paid request', async () => {
    const page = owner.page;
    await owner.panel.getByRole('status', { name: '团队 AI 邀请恢复' }).waitFor();
    await page.locator('.collaboration-summary').click();
    const panel = await openAssistant(page);
    await panel
      .locator('.ai-pending-strip')
      .getByText('语音结果待确认，暂停发起新通话', { exact: true })
      .waitFor();
    await panel.getByRole('button', { name: '核对请求', exact: true }).click();
    const recovery = page.getByRole('dialog', { name: '核对原请求', exact: true });
    await recovery.getByRole('heading', { name: '原团队 AI 邀请仍待确认', exact: true }).waitFor();
    await recovery.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await recovery.waitFor({ state: 'hidden' });
    await panel.getByRole('button', { name: '打开实时语音', exact: true }).click();
    assert.equal(
      await page.locator('.voice-call-workspace').getByRole('button', { name: '开始实时通话', exact: true }).isEnabled(),
      false,
    );
    assert.equal(
      sockets.length,
      1,
      'no second provider call is dispatched for the unresolved host',
    );
  });
  await check(
    'solo live call keeps captions and public search inside the conversation',
    async () => {
      // The original host intentionally left before a terminal receipt. Keep its
      // checkpoint intact; the independent member never initiated the paid invite.
      const page = editor.page;
      await editor.panel.getByRole('button', { name: '离开团队语音', exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator('.collaboration-summary').click();
      const panel = await openAssistant(page);
      await panel.getByRole('button', { name: '打开实时语音', exact: true }).click();
      const callWorkspace = page.locator('.voice-call-workspace');
      const dismissCall = () =>
        callWorkspace.getByRole('button', { name: '收起语音通话', exact: true }).click();
      const settings = await openAssistantSettings(page);
      await choose(settings, '助手模型', '本地团队思考模型');
      await choose(settings, '语音模型', '本地 Live 协议');
      const sharing = settings
        .locator('.assistant-context > summary')
        .filter({ hasText: '共享范围' });
      await sharing.click();
      await settings.getByLabel('允许公开网络检索，保留来源链接').check();
      await sharing.click();
      await settings.getByRole('button', { name: '返回对话', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
      const beforeSoloStarts = inbound.filter((event) => event.type === 'session.start').length;
      holdSoloReady = true;
      await callWorkspace.getByRole('button', { name: '开始实时通话', exact: true }).click();
      const connecting = callWorkspace.locator('.assistant-call.connecting .assistant-call-status');
      await connecting.waitFor();
      assert.equal(await connecting.innerText(), '连接中');
      const endCall = callWorkspace.getByRole('button', { name: '结束实时通话', exact: true });
      const hangupExposed = () =>
        endCall.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return !!hit && button.contains(hit);
        });
      assert.ok(await hangupExposed(), 'hang-up is reachable when the call starts');
      await wait(() => sockets.length === 2, 'solo provider connection');
      await wait(
        () =>
          inbound.filter((event) => event.type === 'session.start').length === beforeSoloStarts + 1,
        'the solo handshake reached the local provider before readiness is released',
      );
      assert.equal(sockets.length, 2);
      const voice = sockets[1];
      const beforeHiddenFrames = inbound.filter(
        (event) => event.type === 'session.input_audio.append',
      ).length;
      await dismissCall();
      await closeAIPanel(page);
      const ongoing = page.locator('.ai-activity-banner');
      await ongoing.getByText('AI 语音正在连接', { exact: true }).waitFor();
      assert.equal(
        await ongoing.getByRole('button', { name: '静音麦克风', exact: true }).isEnabled(),
        false,
        'mute is unavailable before the provider is ready',
      );
      assert.equal(
        await ongoing.getByRole('button', { name: '结束实时通话', exact: true }).isEnabled(),
        true,
        'a pending connection can be ended without reopening the panel',
      );
      holdSoloReady = false;
      voice.send(JSON.stringify({ type: 'session.started', session: { id: 'team-browser-live' } }));
      await ongoing.getByText('AI 通话进行中', { exact: true }).waitFor();
      assert.equal(await panel.count(), 1, 'voice owner stays mounted while its panel is hidden');
      assert.equal(await panel.isVisible(), false);
      await wait(
        () =>
          inbound.filter((event) => event.type === 'session.input_audio.append').length >
          beforeHiddenFrames + 4,
        'microphone continues with an explicit activity banner',
      );
      assert.equal(voice.readyState, WebSocket.OPEN);
      const beforeMute = inbound.filter(
        (event) => event.type === 'session.input_audio.mute',
      ).length;
      await ongoing.getByRole('button', { name: '静音麦克风', exact: true }).click();
      await ongoing.getByText('AI 麦克风已静音', { exact: true }).waitFor();
      await wait(
        () =>
          inbound.filter((event) => event.type === 'session.input_audio.mute').length ===
          beforeMute + 1,
        'the existing voice connection receives the banner mute',
      );
      assert.equal(await panel.getAttribute('data-in-call'), 'true');
      assert.equal(await callWorkspace.isVisible(), false);
      const beforeUnmute = inbound.filter(
        (event) => event.type === 'session.input_audio.unmute',
      ).length;
      await ongoing.getByRole('button', { name: '开启麦克风', exact: true }).click();
      await ongoing.getByText('AI 通话进行中', { exact: true }).waitFor();
      await wait(
        () =>
          inbound.filter((event) => event.type === 'session.input_audio.unmute').length ===
          beforeUnmute + 1,
        'the banner resumes the original microphone',
      );
      await ongoing.getByRole('button', { name: '返回通话', exact: true }).click();
      await endCall.waitFor();
      assert.equal(sockets.length, 2, 'returning never creates another provider connection');
      assert.ok(await hangupExposed(), 'hang-up is reachable after returning');
      report.soloPanelRestore = {
        retainedMountedOwner: true,
        continuedPcm: true,
        additionalConnections: 0,
        connectingControlsChecked: true,
        bannerMuteAndUnmute: true,
      };
      voice.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: '看看光线。' }));
      voice.send(
        JSON.stringify({ type: 'session.output_transcript.delta', delta: '好，先看主光。' }),
      );
      const captions = callWorkspace.locator('[aria-label="实时字幕"]');
      await captions.getByText('看看光线。', { exact: false }).waitFor();
      await captions.getByText('好，先看主光。', { exact: false }).waitFor();
      const callTools = callWorkspace.getByRole('button', { name: '通话工具', exact: true });
      assert.equal(await callTools.getAttribute('aria-expanded'), 'false');
      assert.equal(await callWorkspace.locator('.voice-composer').count(), 0);
      await callTools.click();
      await callWorkspace.getByRole('button', { name: '隐藏字幕', exact: true }).click();
      assert.equal(await captions.isVisible(), false);
      await callWorkspace.getByRole('button', { name: '打断播报', exact: true }).click();
      await wait(
        () => inbound.some((event) => event.type === 'session.instructions.append'),
        'manual interruption control',
      );
      const details = callWorkspace.getByRole('button', { name: '通话详情', exact: true });
      await details.click();
      await callWorkspace.getByText('通话中公开搜索', { exact: true }).click();
      await callWorkspace.getByLabel('通话公开检索查询词').fill('自然人像柔光');
      await callWorkspace.getByRole('button', { name: '搜索', exact: true }).click();
      await callWorkspace.getByRole('link', { name: '布光资料', exact: true }).waitFor();
      assert.deepEqual(publicQueries, ['自然人像柔光']);
      await details.click();
      await callWorkspace.getByRole('button', { name: '显示字幕', exact: true }).click();
      await captions.getByText('好，先看主光。', { exact: false }).waitFor();
      await callWorkspace.getByRole('button', { name: '补充文字', exact: true }).click();
      const supplement = '通话补充：保留当前画面，稍后再调整。';
      const composerControls = {
        input: callWorkspace.getByLabel('向智能体描述修改需求', { exact: true }),
        settings: callWorkspace.getByRole('button', { name: '助手设置', exact: true }),
        preview: callWorkspace.getByRole('button', { name: '当前预览', exact: true }),
        send: callWorkspace.getByRole('button', { name: '发送协作请求', exact: true }),
      };
      await composerControls.input.fill(supplement);
      assert.equal(await composerControls.send.isEnabled(), true);
      const readControlGeometry = (control) =>
        control.evaluate((element) => {
          const rect = (node) => {
            const { x, y, top, right, bottom, left, width, height } = node.getBoundingClientRect();
            return { x, y, top, right, bottom, left, width, height };
          };
          const box = rect(element);
          const clip = { top: 0, right: innerWidth, bottom: innerHeight, left: 0 };
          const ancestors = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const bounds = rect(parent);
            const viewport = {
              left: bounds.left + parent.clientLeft,
              top: bounds.top + parent.clientTop,
              right: bounds.left + parent.clientLeft + parent.clientWidth,
              bottom: bounds.top + parent.clientTop + parent.clientHeight,
            };
            if (/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX)) {
              clip.left = Math.max(clip.left, viewport.left);
              clip.right = Math.min(clip.right, viewport.right);
            }
            if (/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY)) {
              clip.top = Math.max(clip.top, viewport.top);
              clip.bottom = Math.min(clip.bottom, viewport.bottom);
            }
            ancestors.push({
              tag: parent.tagName,
              className: parent.className,
              overflowX: style.overflowX,
              overflowY: style.overflowY,
              scrollTop: parent.scrollTop,
              scrollLeft: parent.scrollLeft,
              clientHeight: parent.clientHeight,
              scrollHeight: parent.scrollHeight,
            });
          }
          const call = element
            .closest('.live-assistant')
            ?.querySelector(':scope > .assistant-call');
          const stickyCall =
            call && !call.contains(element) && getComputedStyle(call).position === 'sticky'
              ? rect(call)
              : null;
          if (stickyCall && stickyCall.right > box.left && stickyCall.left < box.right)
            clip.top = Math.max(clip.top, Math.min(clip.bottom, stickyCall.bottom));
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return {
            box,
            clip,
            stickyCall,
            ancestors,
            visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
            centerExposed: hit === element || element.contains(hit),
          };
        });
      const assertControlExposed = (geometry, name, viewport) => {
        const { box, clip } = geometry;
        const minimum = name === 'input' || viewport.width >= 700 ? 36 : 40;
        assert.ok(
          geometry.visible && box.width >= minimum && box.height >= minimum,
          `${name} keeps its full-size visible control at ${viewport.width}px`,
        );
        assert.ok(
          box.left >= clip.left - 1 &&
            box.top >= clip.top - 1 &&
            box.right <= clip.right + 1 &&
            box.bottom <= clip.bottom + 1,
          `${name} fits the effective ancestor clip and sticky call at ${viewport.width}px`,
        );
        assert.ok(geometry.centerExposed, `${name} is not covered at ${viewport.width}px`);
      };
      report.soloControlMeasurements = [];
      for (const viewport of [
        { width: 1440, height: 960 },
        { width: 820, height: 1180 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        assert.ok(await hangupExposed(), 'hang-up is exposed at ' + viewport.width + 'px');
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
        const measurement = { viewport, revealed: [], composer: {}, hangup: null };
        report.soloControlMeasurements.push(measurement);
        const reveal = async (name, control) => {
          const before = await readControlGeometry(control);
          // Centre the actual control using the browser's scrolling behaviour.
          // This also gives sticky call controls room above the composer.
          await control.evaluate((element) =>
            element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }),
          );
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          const after = await readControlGeometry(control);
          measurement.revealed.push({ name, before, after });
          // scrollIntoView can programmatically move overflow:hidden ancestors.
          // Such movement would hide the original reachability defect from QA.
          for (let i = 0; i < after.ancestors.length; i++) {
            const ancestor = after.ancestors[i];
            const old = before.ancestors[i];
            assert.ok(old && old.tag === ancestor.tag, 'scrolling keeps the control ancestry');
            if (Math.abs(ancestor.scrollTop - old.scrollTop) > 1)
              assert.match(
                ancestor.overflowY,
                /^(auto|scroll|overlay)$/,
                'only user-scrollable ancestors move vertically',
              );
            if (Math.abs(ancestor.scrollLeft - old.scrollLeft) > 1)
              assert.match(
                ancestor.overflowX,
                /^(auto|scroll|overlay)$/,
                'only user-scrollable ancestors move horizontally',
              );
          }
          assertControlExposed(after, name, viewport);
          return after;
        };
        try {
          for (const [name, control] of Object.entries(composerControls))
            await reveal(name, control);
          // At the final composer position, the input and every requested tool
          // must be exposed together, rather than each passing at a different scroll offset.
          for (const [name, control] of Object.entries(composerControls)) {
            const geometry = await readControlGeometry(control);
            measurement.composer[name] = geometry;
            assertControlExposed(geometry, name, viewport);
          }
          assert.equal(await composerControls.input.inputValue(), supplement);
          assert.equal(await composerControls.send.isEnabled(), true);
          await page.screenshot({ path: resolve(artifact, 'solo-' + viewport.width + '.png') });
          measurement.hangup = await reveal('hangup', endCall);
          assert.ok(await hangupExposed(), 'hang-up remains reachable after composer scrolling');
          assert.equal(await endCall.isEnabled(), true);
          await page.screenshot({
            path: resolve(artifact, 'solo-' + viewport.width + '-call-controls.png'),
          });
        } catch (error) {
          await page
            .screenshot({ path: resolve(artifact, 'solo-' + viewport.width + '-failure.png') })
            .catch(() => {});
          throw error;
        }
      }
      holdSoloClose = true;
      const beforeSoloClose = inbound.filter((event) => event.type === 'session.close').length;
      await dismissCall();
      await closeAIPanel(page);
      await ongoing.getByRole('button', { name: '结束实时通话', exact: true }).click();
      await ongoing.getByText('AI 通话正在结束', { exact: true }).waitFor();
      assert.equal(
        await ongoing.getByRole('button', { name: '结束实时通话', exact: true }).isEnabled(),
        false,
        'ending cannot dispatch another close while settlement is pending',
      );
      assert.equal(
        await ongoing.getByRole('button', { name: /^(静音麦克风|开启麦克风)$/ }).isEnabled(),
        false,
      );
      await wait(
        () =>
          inbound.filter((event) => event.type === 'session.close').length === beforeSoloClose + 1,
        'the banner ends the original provider session exactly once',
      );
      holdSoloClose = false;
      voice.send(JSON.stringify({ type: 'session.closed', usage: { seconds: 5 } }));
      await ongoing.waitFor({ state: 'hidden' });
      await openAssistant(page);
      await panel.getByRole('button', { name: '打开实时语音', exact: true }).click();
      await callWorkspace.getByRole('button', { name: '开始实时通话', exact: true }).waitFor();
      assert.equal(sockets.length, 2, 'ending and returning never prepare a replacement call');
      report.soloPanelRestore.bannerEndAndSettlement = true;
    },
  );
  assert.deepEqual(report.pageErrors, []);
} finally {
  await writeFile(resolve(artifact, 'report.json'), JSON.stringify(report, null, 2));
  for (const socket of vendor.clients) socket.terminate();
  await browser?.close();
  await vite?.close();
  await fixture?.close();
  await new Promise((done) => vendor.close(done));
}
