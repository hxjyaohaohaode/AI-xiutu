import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import sharp from 'sharp';
import {
  ARK_IMAGE_ENDPOINT,
  MAX_ASR_RESPONSE_BYTES,
  MAX_IMAGE_RESPONSE_BYTES,
  MAX_WAV_BYTES,
  MultimodalProviderError,
  createArkImageProvider,
  createQwenSpeechProvider,
  getArkImageModels,
  validateArkImageInput,
  validateWav,
} from '../src/index.js';
import type { ImageGenerationInput } from '../src/index.js';

const arkEnv: NodeJS.ProcessEnv = {
  ARK_API_KEY: 'test-only-secret',
  ARK_IMAGE_MODELS_JSON: JSON.stringify([
    { id: 'ep-test-flash', profile: 'seedream-5-flash' },
    { id: 'ep-test-45', profile: 'seedream-4.5' },
  ]),
};
const asrEnv: NodeJS.ProcessEnv = {
  DASHSCOPE_API_KEY: 'test-only-secret',
  QWEN_ASR_MODELS: 'qwen3-asr-flash',
};
const request: ImageGenerationInput = {
  model: 'ep-test-flash',
  prompt: '一幅蓝色线条的静物草图',
  width: 1024,
  height: 1024,
};

function wav(samples = 16000): Uint8Array {
  const bytes = new Uint8Array(44 + samples * 2);
  const v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  v.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode('data'), 36);
  v.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1)
    v.setInt16(44 + i * 2, Math.round(1000 * Math.sin(i * 0.1)), true);
  return bytes;
}

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test-1', ...headers },
  });
function mock(handler: (url: string, init: RequestInit) => Promise<Response> | Response): {
  fetcher: typeof fetch;
  calls: () => number;
} {
  let calls = 0;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    return handler(String(input), init ?? {});
  }) as typeof fetch;
  return { fetcher, calls: () => calls };
}
const isOutcome =
  (outcome: 'rejected' | 'unknown', code?: string) =>
  (error: unknown): boolean =>
    error instanceof MultimodalProviderError &&
    error.outcome === outcome &&
    (!code || error.code === code);

let square1024: Buffer;
let square2048: Buffer;
let reference64: Buffer;
before(async () => {
  // Real, locally encoded image fixtures, with no supplier request.
  [square1024, square2048, reference64] = (await Promise.all(
    [1024, 2048, 64].map((size) =>
      sharp({
        create: { width: size, height: size, channels: 3, background: { r: 96, g: 128, b: 160 } },
      })
        .png()
        .toBuffer(),
    ),
  )) as [Buffer, Buffer, Buffer];
});

test('strict WAV validates actual duration including the 30-second boundary and typed-array offsets', () => {
  assert.deepEqual(validateWav(wav()), { durationSeconds: 1, sampleRate: 16000, channels: 1 });
  assert.deepEqual(validateWav(wav(480000)), {
    durationSeconds: 30,
    sampleRate: 16000,
    channels: 1,
  });
  const bytes = wav(8000);
  const wrapped = new Uint8Array(bytes.length + 32);
  wrapped.set(bytes, 16);
  assert.equal(validateWav(wrapped.subarray(16, 16 + bytes.length)).durationSeconds, 0.5);
  assert.ok(wav(480000).length <= MAX_WAV_BYTES);
  assert.throws(() => validateWav(wav(480001)), isOutcome('rejected', 'WAV_INVALID_DATA'));
});

test('WAV rejects compressed, stereo, wrong-rate, wrong-byte-rate, missing, truncated and oversized input', () => {
  const cases: Uint8Array[] = [
    new Uint8Array(),
    wav().slice(0, -1),
    new Uint8Array(MAX_WAV_BYTES + 1),
    wav(0),
  ];
  for (const [offset, value, width] of [
    [20, 3, 2],
    [22, 2, 2],
    [24, 44100, 4],
    [28, 1, 4],
    [32, 4, 2],
    [34, 32, 2],
    [16, 18, 4],
    [40, 0xffffffff, 4],
  ]) {
    const bytes = wav();
    const view = new DataView(bytes.buffer);
    if (width === 2) view.setUint16(offset!, value!, true);
    else view.setUint32(offset!, value!, true);
    cases.push(bytes);
  }
  const rf64 = wav();
  rf64.set(new TextEncoder().encode('RF64'), 0);
  cases.push(rf64);
  const badChunk = wav();
  badChunk.set(new TextEncoder().encode('LIST'), 36);
  cases.push(badChunk);
  for (const bytes of cases) assert.throws(() => validateWav(bytes), isOutcome('rejected'));
});

test('WAV rejects appended data, duplicate chunks and forged RIFF lengths', () => {
  const first = wav(10);
  const duplicate = new Uint8Array(first.length + 10);
  duplicate.set(first);
  duplicate.set(new TextEncoder().encode('data'), first.length);
  const view = new DataView(duplicate.buffer);
  view.setUint32(4, duplicate.length - 8, true);
  view.setUint32(first.length + 4, 2, true);
  assert.throws(() => validateWav(duplicate), isOutcome('rejected', 'WAV_INVALID_DATA'));
  const extra = new Uint8Array(first.length + 1);
  extra.set(first);
  assert.throws(() => validateWav(extra), isOutcome('rejected', 'WAV_INVALID_RIFF'));
  const odd = wav(10);
  new DataView(odd.buffer).setUint32(40, 19, true);
  assert.throws(() => validateWav(odd), isOutcome('rejected'));
});

test('provider setup has no implicit enabled model or endpoint bypass', () => {
  const never = mock(() => {
    throw new Error('must not send');
  });
  assert.equal(createArkImageProvider({}, never.fetcher).configured, false);
  assert.equal(createQwenSpeechProvider({}, never.fetcher).configured, false);
  assert.throws(
    () =>
      createArkImageProvider(
        { ...arkEnv, ARK_IMAGE_ENDPOINT: 'http://127.0.0.1/generate' },
        never.fetcher,
      ),
    isOutcome('rejected'),
  );
  for (const bad of [
    'https://evil.test/compatible-mode/v1',
    'https://dashscope.aliyuncs.com@evil.test/compatible-mode/v1',
    'https://x.cn-beijing.maas.aliyuncs.com.evil.test/compatible-mode/v1',
    'https://x.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    'https://dashscope.aliyuncs.com/compatible-mode/v1?next=evil',
  ]) {
    assert.throws(
      () => createQwenSpeechProvider({ ...asrEnv, QWEN_ASR_BASE_URL: bad }, never.fetcher),
      isOutcome('rejected', 'QWEN_ASR_ENDPOINT_NOT_ALLOWED'),
    );
  }
  assert.throws(
    () =>
      createQwenSpeechProvider(
        { ...asrEnv, QWEN_ASR_MODELS: 'qwen3-asr-flash-filetrans' },
        never.fetcher,
      ),
    isOutcome('rejected'),
  );
  assert.throws(
    () => createArkImageProvider({ ...arkEnv, ARK_API_KEY: 'bad\r\nsecret' }, never.fetcher),
    isOutcome('rejected'),
  );
  assert.equal(never.calls(), 0);
});

test('Ark audited profiles enforce request dimensions, reference types and model allowlists before dispatch', async () => {
  const never = mock(() => {
    throw new Error('must not send');
  });
  const provider = createArkImageProvider(arkEnv, never.fetcher);
  assert.ok(Object.isFrozen(provider.models));
  assert.ok(Object.isFrozen(provider.models[0]));
  assert.equal(provider.models[0]!.maxPixels, 4624220);
  provider.validate({ ...request, width: 1280, height: 720 });
  provider.validate({ ...request, model: 'ep-test-45', width: 2048, height: 2048 });
  provider.validate({ ...request, reference: { bytes: reference64, mime: 'image/png' } });
  for (const input of [
    { ...request, model: 'not-enabled' },
    { ...request, width: 512, height: 512 },
    { ...request, width: 8192, height: 8192 },
    { ...request, width: NaN },
    { ...request, width: 8192, height: 128 },
    { ...request, prompt: '' },
    { ...request, model: 'ep-test-45' },
    { ...request, reference: { bytes: reference64, mime: 'image/jpeg' as const } },
    { ...request, reference: { bytes: new Uint8Array([0, 1, 2]), mime: 'image/png' as const } },
  ])
    await assert.rejects(provider.generate(input), isOutcome('rejected'));
  assert.equal(never.calls(), 0);
  assert.throws(
    () => getArkImageModels({ ARK_IMAGE_MODELS_JSON: '[{"id":"x","profile":"anything"}]' }),
    isOutcome('rejected'),
  );
  assert.throws(
    () =>
      getArkImageModels({
        ARK_IMAGE_MODELS_JSON:
          '[{"id":"x","profile":"seedream-5-flash"},{"id":"x","profile":"seedream-5-pro"}]',
      }),
    isOutcome('rejected'),
  );
  validateArkImageInput(request, getArkImageModels(arkEnv));
});

test('Ark single-image request sends real official fields with reference bytes and keeps AI watermark', async () => {
  const transport = mock((url, init) => {
    assert.equal(url, ARK_IMAGE_ENDPOINT);
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'POST');
    assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    assert.equal(body.model, request.model);
    assert.equal(body.prompt, request.prompt);
    assert.equal(body.size, '1024x1024');
    assert.equal(body.response_format, 'b64_json');
    assert.equal(body.watermark, true);
    assert.equal(body.stream, undefined);
    assert.equal(body.sequential_image_generation, undefined);
    assert.equal(body.n, undefined);
    assert.equal(body.image, `data:image/png;base64,${reference64.toString('base64')}`);
    return reply({
      data: [{ b64_json: square1024.toString('base64'), size: '1024x1024', output_format: 'png' }],
    });
  });
  const result = await createArkImageProvider(arkEnv, transport.fetcher).generate({
    ...request,
    reference: { bytes: reference64, mime: 'image/png' },
  });
  assert.equal(result.mime, 'image/png');
  assert.equal(result.requestId, 'req-test-1');
  assert.deepEqual(result.bytes, square1024);
  assert.equal(transport.calls(), 1);
});

test('Ark older group-capable profiles explicitly disable multiple output and streaming', async () => {
  const transport = mock((_url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    assert.equal(body.sequential_image_generation, 'disabled');
    assert.equal(body.stream, false);
    return reply({ data: [{ b64_json: square2048.toString('base64'), size: '2048x2048' }] });
  });
  const result = await createArkImageProvider(arkEnv, transport.fetcher).generate({
    ...request,
    model: 'ep-test-45',
    width: 2048,
    height: 2048,
  });
  assert.equal(result.mime, 'image/png');
  assert.equal(transport.calls(), 1);
});

test('Ark rejects URL-only output, extra images, malformed base64 and wrong real dimensions as unknown', async () => {
  for (const body of [
    { data: [{ url: 'http://169.254.169.254/latest/meta-data/' }] },
    {
      data: [
        { b64_json: square1024.toString('base64') },
        { b64_json: square1024.toString('base64') },
      ],
    },
    { data: [{ b64_json: 'abc=' }] },
    { data: [{ b64_json: '!!!!' }] },
    { data: [{ b64_json: square2048.toString('base64') }] },
    { data: [{ b64_json: square1024.toString('base64'), output_format: 'jpeg' }] },
    { data: [{ error: { code: 'some_generation_failure' } }] },
  ]) {
    const transport = mock(() => reply(body));
    await assert.rejects(
      createArkImageProvider(arkEnv, transport.fetcher).generate(request),
      isOutcome('unknown'),
    );
    assert.equal(transport.calls(), 1, 'must never fetch a returned URL or retry generation');
  }
});

test('HTTP refusal is distinguished from uncertain billing and raw provider error text is not propagated', async () => {
  for (const [status, outcome] of [
    [400, 'rejected'],
    [403, 'rejected'],
    [429, 'unknown'],
    [500, 'unknown'],
    [503, 'unknown'],
  ] as const) {
    const transport = mock(() =>
      reply({ error: { code: 'UPSTREAM_CODE', message: 'secret-token-or-raw-prompt' } }, status),
    );
    try {
      await createArkImageProvider(arkEnv, transport.fetcher).generate(request);
      assert.fail('should throw');
    } catch (error) {
      assert.ok(error instanceof MultimodalProviderError);
      assert.equal(error.outcome, outcome);
      assert.equal(error.requestId, 'req-test-1');
      assert.equal(error.message.includes('secret-token'), false);
    }
    assert.equal(transport.calls(), 1);
  }
  const network = mock(() => {
    throw new TypeError('connection lost');
  });
  await assert.rejects(
    createArkImageProvider(arkEnv, network.fetcher).generate(request),
    isOutcome('unknown', 'PROVIDER_NETWORK_UNKNOWN'),
  );
  assert.equal(network.calls(), 1);
});

test('response readers reject announced excess, streamed excess, invalid JSON and interrupted bodies', async () => {
  const large = mock(() =>
    reply({}, 200, { 'content-length': String(MAX_IMAGE_RESPONSE_BYTES + 1) }),
  );
  await assert.rejects(
    createArkImageProvider(arkEnv, large.fetcher).generate(request),
    isOutcome('unknown', 'PROVIDER_RESPONSE_TOO_LARGE'),
  );
  const responses = [
    new Response(new Uint8Array(MAX_ASR_RESPONSE_BYTES + 1)),
    new Response('not-json'),
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('read interrupted'));
        },
      }),
    ),
  ];
  for (const response of responses) {
    const transport = mock(() => response);
    await assert.rejects(
      createQwenSpeechProvider(asrEnv, transport.fetcher).transcribe({
        model: 'qwen3-asr-flash',
        wav: wav(10),
      }),
      isOutcome('unknown'),
    );
    assert.equal(transport.calls(), 1);
  }
});

test('Qwen transcription uses allowed Beijing workspace endpoint and base64 WAV, never a public audio URL', async () => {
  const input = wav(100);
  const transport = mock((url, init) => {
    assert.equal(
      url,
      'https://test-space.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{
        role: string;
        content: Array<{ type: string; input_audio: { data: string } }>;
      }>;
      stream: boolean;
      asr_options: { enable_itn: boolean };
    };
    assert.equal(body.model, 'qwen3-asr-flash');
    assert.equal(body.stream, false);
    assert.equal(body.asr_options.enable_itn, false);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0]!.role, 'user');
    assert.equal(body.messages[0]!.content[0]!.type, 'input_audio');
    assert.equal(
      body.messages[0]!.content[0]!.input_audio.data,
      `data:audio/wav;base64,${Buffer.from(input).toString('base64')}`,
    );
    return reply({
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: '请稍微提高亮度。' } },
      ],
    });
  });
  const result = await createQwenSpeechProvider(
    { ...asrEnv, DASHSCOPE_WORKSPACE_ID: 'test-space' },
    transport.fetcher,
  ).transcribe({ model: 'qwen3-asr-flash', wav: input });
  assert.deepEqual(result, { text: '请稍微提高亮度。', requestId: 'req-test-1' });
  assert.equal(transport.calls(), 1);
});

test('Qwen rejects unsafe input locally and treats truncated/malformed transcription as unknown', async () => {
  const never = mock(() => {
    throw new Error('must not send');
  });
  const provider = createQwenSpeechProvider(asrEnv, never.fetcher);
  await assert.rejects(
    provider.transcribe({ model: 'qwen3-asr-flash-realtime', wav: wav(10) }),
    isOutcome('rejected'),
  );
  await assert.rejects(
    provider.transcribe({ model: 'qwen3-asr-flash', wav: new Uint8Array([0, 1, 2]) }),
    isOutcome('rejected'),
  );
  assert.equal(never.calls(), 0);
  for (const choice of [
    { finish_reason: 'length', message: { content: 'unfinished' } },
    { finish_reason: 'stop', message: { content: 'a'.repeat(10_001) } },
    {
      finish_reason: 'stop',
      message: { content: [{ text: 'not the documented string contract' }] },
    },
  ]) {
    const transport = mock(() => reply({ choices: [choice] }));
    await assert.rejects(
      createQwenSpeechProvider(asrEnv, transport.fetcher).transcribe({
        model: 'qwen3-asr-flash',
        wav: wav(10),
      }),
      isOutcome('unknown'),
    );
    assert.equal(transport.calls(), 1);
  }
  const silence = mock(() =>
    reply({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }),
  );
  assert.equal(
    (
      await createQwenSpeechProvider(asrEnv, silence.fetcher).transcribe({
        model: 'qwen3-asr-flash',
        wav: wav(10),
      })
    ).text,
    '',
  );
});
