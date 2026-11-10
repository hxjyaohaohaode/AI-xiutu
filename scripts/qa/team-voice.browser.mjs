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
vendor.on('connection', (ws) => {
  sockets.push(ws);
  ws.on('message', (raw) => {
    const event = JSON.parse(String(raw));
    inbound.push(event);
    if (event.type === 'session.start')
      ws.send(JSON.stringify({ type: 'session.started', session: { id: 'team-browser-live' } }));
    if (event.type === 'session.close')
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
            maxSeconds: 30,
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
      window.AudioWorkletNode = class extends Original {
        constructor(audio, name, options) {
          super(audio, name, options);
          window.teamVoiceWorklets.push(name);
        }
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (this.buffer?.sampleRate === 24000 && this.buffer.getChannelData(0).some(Boolean))
          window.teamVoicePlayback++;
        return start.apply(this, args);
      };
    }, Boolean(process.env.BROWSER_SPEECH_FIXTURE));
    page.on('pageerror', (error) => report.pageErrors.push(String(error)));
    page.on('websocket', (ws) => {
      if (ws.url().includes('/team-voice/stream'))
        ws.on('framereceived', ({ payload }) => {
          if (Buffer.isBuffer(payload)) frames.push(payload);
        });
    });
    await page.goto(origin);
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await page
      .locator('.sidebar')
      .getByRole('button', { name: /^V4 team/ })
      .click();
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await page
      .getByRole('navigation', { name: '项目', exact: true })
      .getByRole('button', { name: 'V4 project', exact: true })
      .click();
    await page
      .locator('.library-version-links')
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
      await owner.panel.getByLabel('团队语音模型').selectOption('gpt-live-1');
      await owner.panel.getByLabel('团队思考模型').selectOption(model);
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
      sockets[0].send(
        JSON.stringify({ type: 'session.output_audio.delta', delta: answer.toString('base64') }),
      );
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
  await check(
    'solo live call keeps captions and public search inside the conversation',
    async () => {
      const page = owner.page;
      await page.locator('.collaboration-summary').click();
      await page.getByRole('button', { name: 'AI共创', exact: true }).click();
      await page.getByRole('button', { name: '实时协作', exact: true }).click();
      const panel = page.locator('.live-assistant');
      await panel.getByLabel('思考与工具模型').selectOption(model);
      const sharing = panel.locator('.assistant-context > summary').filter({ hasText: '共享范围' });
      await sharing.click();
      await panel.getByLabel('允许公开网络检索，保留来源链接').check();
      await sharing.click();
      await panel.getByRole('button', { name: '开始实时通话', exact: true }).click();
      await panel.getByRole('button', { name: '打断播报', exact: true }).waitFor();
      await wait(
        async () => await panel.getByRole('button', { name: '打断播报', exact: true }).isEnabled(),
        'solo active',
      );
      assert.equal(sockets.length, 2);
      const voice = sockets[1];
      voice.send(JSON.stringify({ type: 'session.input_transcript.delta', delta: '看看光线。' }));
      voice.send(
        JSON.stringify({ type: 'session.output_transcript.delta', delta: '好，先看主光。' }),
      );
      const captions = panel.locator('[aria-label="实时字幕"]');
      await captions.getByText('看看光线。', { exact: false }).waitFor();
      await captions.getByText('好，先看主光。', { exact: false }).waitFor();
      await panel.getByRole('button', { name: '隐藏字幕', exact: true }).click();
      assert.equal(await captions.isVisible(), false);
      await panel.getByRole('button', { name: '打断播报', exact: true }).click();
      await wait(
        () => inbound.some((event) => event.type === 'session.instructions.append'),
        'manual interruption control',
      );
      await panel.getByText('通话中公开搜索', { exact: true }).click();
      await panel.getByLabel('通话公开检索查询词').fill('自然人像柔光');
      await panel.getByRole('button', { name: '搜索', exact: true }).click();
      await panel.getByRole('link', { name: '布光资料', exact: true }).waitFor();
      assert.deepEqual(publicQueries, ['自然人像柔光']);
      await panel.getByText('通话中公开搜索', { exact: true }).click();
      await panel.getByRole('button', { name: '显示字幕', exact: true }).click();
      await captions.getByText('好，先看主光。', { exact: false }).waitFor();
      for (const viewport of [
        { width: 1440, height: 960 },
        { width: 820, height: 1180 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await panel.evaluate((element) => {
          const scroll = element.closest('.ai-scroll');
          if (scroll) scroll.scrollTop = 0;
        });
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
        await page.screenshot({ path: resolve(artifact, 'solo-' + viewport.width + '.png') });
      }
      await panel.getByRole('button', { name: '结束实时通话', exact: true }).click();
      await panel.getByRole('button', { name: '开始实时通话', exact: true }).waitFor();
    },
  );
  assert.deepEqual(report.pageErrors, []);
} finally {
  await browser?.close();
  await vite?.close();
  await fixture?.close();
  for (const socket of vendor.clients) socket.terminate();
  await new Promise((done) => vendor.close(done));
  await writeFile(resolve(artifact, 'report.json'), JSON.stringify(report, null, 2));
}
