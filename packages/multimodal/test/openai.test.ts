import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import sharp from 'sharp';
import {
  OPENAI_IMAGE_GENERATIONS_ENDPOINT,
  OPENAI_IMAGE_EDITS_ENDPOINT,
  MultimodalProviderError,
  createOpenAIFileTranscriber,
  createOpenAIImageProvider,
  getOpenAIImageModels,
  describeOpenAIImageModel,
  type ImageGenerationInput,
} from '../src/index.js';

test('OpenAI file transcription validates the chosen model before forwarding hints and timestamps', async () => {
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(38, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(2, 40);
  let sent = 0;
  const transcriber = createOpenAIFileTranscriber(
    {
      OPENAI_API_KEY: 'test-key',
      OPENAI_TRANSCRIPTION_MODELS: 'whisper-1,gpt-4o-transcribe-diarize',
    },
    async (url, request) => {
      sent++;
      assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
      const form = request?.body;
      assert.ok(form instanceof FormData);
      assert.equal(form.get('language'), 'en');
      assert.equal(form.get('temperature'), '0');
      assert.equal(form.get('prompt'), 'A sample.');
      assert.equal(form.get('response_format'), 'verbose_json');
      assert.deepEqual(form.getAll('timestamp_granularities[]'), ['word', 'segment']);
      return Response.json({
        text: 'Hello',
        words: [{ start: 0, end: 0.2, word: 'Hello' }],
        segments: [{ start: 0, end: 0.3, text: 'Hello' }],
      });
    },
  );
  await assert.rejects(
    transcriber.transcribe({
      model: 'gpt-4o-transcribe-diarize',
      wav,
      options: { prompt: 'A sample.' },
    }),
    { code: 'OPENAI_TRANSCRIPTION_OPTIONS_UNSUPPORTED' },
  );
  assert.equal(sent, 0);
  const answer = await transcriber.transcribe({
    model: 'whisper-1',
    wav,
    options: { language: 'en', temperature: 0, prompt: 'A sample.', timestamps: 'both' },
  });
  assert.equal(sent, 1);
  assert.equal(answer.timestamps?.word?.[0]?.text, 'Hello');
  assert.equal(answer.timestamps?.segment?.[0]?.end, 0.3);
});

const model = 'gpt-image-2.5-sunburst';
const env: NodeJS.ProcessEnv = {
  OPENAI_IMAGE_ENABLED: 'true',
  OPENAI_API_KEY: 'injected-test-key-not-live',
  OPENAI_IMAGE_MODELS: `${model},gpt-image-2.6-flare,gpt-image-2`,
};
const input: ImageGenerationInput = {
  model,
  prompt: '在淡蓝背景上绘制一只陶瓷花瓶',
  width: 1024,
  height: 1024,
};
let png: Buffer;
let jpeg: Buffer;
let webp: Buffer;
let reference: Buffer;
let guide: Buffer;
let transparentPng: Buffer;
before(async () => {
  const square = {
    create: {
      width: 1024,
      height: 1024,
      channels: 3 as const,
      background: { r: 120, g: 150, b: 210 },
    },
  };
  png = await sharp(square).png().toBuffer();
  jpeg = await sharp(square).jpeg().toBuffer();
  webp = await sharp(square).webp().toBuffer();
  reference = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#90a0b0' } })
    .png()
    .toBuffer();
  guide = await sharp({
    create: { width: 96, height: 96, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  transparentPng = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
});
function response(images: Buffer[], extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      data: images.map((bytes) => ({ b64_json: bytes.toString('base64') })),
      ...extra,
    }),
    { headers: { 'content-type': 'application/json', 'x-request-id': 'req-openai-contract-1' } },
  );
}
const outcome = (kind: 'rejected' | 'unknown', code?: string) => (error: unknown) =>
  error instanceof MultimodalProviderError &&
  error.outcome === kind &&
  (!code || error.code === code);

test('OpenAI adapter is disabled without explicit enable/key/model allowlist and refuses arbitrary endpoints', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    throw new Error('no live calls');
  }) as typeof fetch;
  for (const config of [
    {},
    { ...env, OPENAI_IMAGE_ENABLED: 'false' },
    { ...env, OPENAI_API_KEY: '' },
    { ...env, OPENAI_IMAGE_MODELS: '' },
  ]) {
    const provider = createOpenAIImageProvider(config, fetcher);
    assert.equal(provider.configured, false);
    await assert.rejects(
      provider.generate(input),
      outcome('rejected', 'OPENAI_IMAGE_NOT_CONFIGURED'),
    );
  }
  assert.equal(calls, 0);
  assert.throws(
    () =>
      createOpenAIImageProvider(
        { ...env, OPENAI_BASE_URL: 'https://attacker.invalid/v1' },
        fetcher,
      ),
    outcome('rejected', 'OPENAI_ENDPOINT_NOT_ALLOWED'),
  );
  assert.equal(
    getOpenAIImageModels({ OPENAI_IMAGE_MODELS: 'chatgpt-image-latest' })[0]?.id,
    'chatgpt-image-latest',
  );
  assert.throws(
    () => getOpenAIImageModels({ OPENAI_IMAGE_MODELS: 'gpt-image-1' }),
    outcome('rejected', 'OPENAI_MODEL_NOT_SUPPORTED'),
  );
  assert.throws(
    () => getOpenAIImageModels({ OPENAI_IMAGE_MODELS: `${model},${model}` }),
    outcome('rejected', 'OPENAI_MODEL_CONFIG_INVALID'),
  );
});

test('OpenAI generation uses the fixed real Images JSON protocol and returns all requested raster outputs', async () => {
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++;
    assert.equal(url, OPENAI_IMAGE_GENERATIONS_ENDPOINT);
    assert.equal(init?.redirect, 'error');
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer injected-test-key-not-live',
    );
    assert.ok(init?.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model,
      prompt: input.prompt,
      size: '1024x1024',
      quality: 'max',
      background: 'transparent',
      output_format: 'png',
      n: 2,
      moderation: 'auto',
      stream: false,
      safety_identifier: 'a'.repeat(64),
    });
    return response([transparentPng, transparentPng], {
      output_format: 'png',
      size: '1024x1024',
      usage: { input_tokens: 23, output_tokens: 99, total_tokens: 122, secret: 'not exposed' },
    });
  }) as typeof fetch;
  const result = await createOpenAIImageProvider(env, fetcher).generate({
    ...input,
    safetyIdentifier: 'a'.repeat(64),
    imageOptions: { quality: 'max', background: 'transparent', n: 2 },
  });
  assert.equal(calls, 1);
  assert.equal(result.images?.length, 2);
  assert.equal(result.requestId, 'req-openai-contract-1');
  assert.deepEqual(result.usage, { input_tokens: 23, output_tokens: 99, total_tokens: 122 });
  assert.deepEqual(result.bytes, transparentPng);
});

test('OpenAI edit protocol sends exact normalized reference and markup bytes, with 2.6 complexity', async () => {
  const fetcher = (async (url, init) => {
    assert.equal(url, OPENAI_IMAGE_EDITS_ENDPOINT);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.images, [
      { image_url: `data:image/png;base64,${reference.toString('base64')}` },
    ]);
    assert.deepEqual(body.markup, {
      image_url: `data:image/png;base64,${guide.toString('base64')}`,
    });
    assert.equal(body.complexity, 'medium');
    assert.equal(body.input_fidelity, undefined);
    assert.equal(body.mask, undefined);
    return response([png]);
  }) as typeof fetch;
  const result = await createOpenAIImageProvider(env, fetcher).generate({
    ...input,
    model: 'gpt-image-2.6-flare',
    references: [{ bytes: reference, mime: 'image/png' }],
    markup: { bytes: guide, mime: 'image/png' },
    imageOptions: { complexity: 'medium' },
  });
  assert.equal(result.mime, 'image/png');
});

test('OpenAI mask requires a matching transparent PNG and never silently flattens a guide', async () => {
  let calls = 0;
  const fetcher = (async (_url, init) => {
    calls++;
    assert.ok(JSON.parse(String(init?.body)).mask);
    return response([png]);
  }) as typeof fetch;
  const provider = createOpenAIImageProvider(env, fetcher);
  const refs = [{ bytes: reference, mime: 'image/png' as const }];
  await provider.generate({
    ...input,
    references: refs,
    mask: { bytes: guide, mime: 'image/png' },
  });
  await assert.rejects(
    provider.generate({
      ...input,
      references: refs,
      mask: { bytes: reference, mime: 'image/png' },
    }),
    outcome('rejected', 'OPENAI_GUIDE_NEEDS_TRANSPARENCY'),
  );
  assert.throws(
    () => provider.validate({ ...input, mask: { bytes: guide, mime: 'image/png' } }),
    outcome('rejected', 'OPENAI_GUIDE_REQUIRES_REFERENCE'),
  );
  assert.throws(
    () =>
      provider.validate({
        ...input,
        references: refs,
        mask: { bytes: guide, mime: 'image/png' },
        markup: { bytes: guide, mime: 'image/png' },
      }),
    outcome('rejected', 'OPENAI_MASK_MARKUP_EXCLUSIVE'),
  );
  assert.equal(calls, 1);
});

test('OpenAI profiles enforce real quality, format dependencies, current size evidence and batch budgets locally', () => {
  const provider = createOpenAIImageProvider(env, (async () => {
    throw new Error('no network');
  }) as typeof fetch);
  provider.validate({
    ...input,
    width: 3840,
    height: 2160,
    imageOptions: { n: 2, quality: 'xhigh' },
  });
  provider.validate({ ...input, model: 'gpt-image-2.6-flare', width: 1536, height: 864 });
  provider.validate({ ...input, model: 'gpt-image-2.6-flare', width: 3840, height: 2160 });
  for (const invalid of [
    { ...input, width: 1001 },
    { ...input, width: 3840, height: 3840 },
    { ...input, imageOptions: { n: 5 } },
    { ...input, width: 3840, height: 2160, imageOptions: { n: 3 } },
    { ...input, imageOptions: { outputFormat: 'png', outputCompression: 60 } },
    { ...input, imageOptions: { outputFormat: 'jpeg', background: 'transparent' } },
    { ...input, imageOptions: { complexity: 'high' } },
    { ...input, model: 'gpt-image-2', imageOptions: { quality: 'max' } },
    { ...input, model: 'gpt-image-2.6-flare', width: 3840, height: 2176 },
    { ...input, imageOptions: { outputFormat: 'svg' } },
    { ...input, imageOptions: { partialImages: 1 } },
  ])
    assert.throws(() => provider.validate(invalid as ImageGenerationInput), outcome('rejected'));
  const profile = describeOpenAIImageModel('gpt-image-2.6-flare')!;
  assert.equal(profile.parameterCapabilities?.size.allowedSizes, undefined);
  assert.match(profile.parameterCapabilities?.size.reason ?? '', /实验性/);
  assert.equal(profile.parameterCapabilities?.svg.supported, false);
  assert.equal(profile.parameterCapabilities?.gif.supported, false);
  assert.equal(profile.parameterCapabilities?.stream.supported, true);
  assert.equal(profile.parameterCapabilities?.partialImages.supported, false);
  assert.equal(describeOpenAIImageModel('gpt-image-1.5')?.parameterCapabilities?.stream.supported, false);
});

test('OpenAI Images uses the actual auto dimensions and validates fidelity only for supported edits', async () => {
  const provider = createOpenAIImageProvider(
    { ...env, OPENAI_IMAGE_MODELS: 'gpt-image-1.5,gpt-image-1-mini' },
    (async (url, init) => {
      assert.equal(url, OPENAI_IMAGE_EDITS_ENDPOINT);
      assert.match(String(init?.body), /"size":"auto"/);
      assert.match(String(init?.body), /"input_fidelity":"high"/);
      assert.match(String(init?.body), /"moderation":"low"/);
      return response([png], { size: '1024x1024' });
    }) as typeof fetch,
  );
  const edit = {
    ...input,
    model: 'gpt-image-1.5',
    width: 1536,
    height: 1024,
    references: [{ bytes: reference, mime: 'image/png' as const }],
    imageOptions: {
      size: 'auto' as const,
      inputFidelity: 'high' as const,
      moderation: 'low' as const,
    },
  };
  assert.equal((await provider.generate(edit)).images?.length, 1);
  assert.throws(
    () => provider.validate({ ...edit, model: 'gpt-image-1-mini' }),
    outcome('rejected', 'OPENAI_INPUT_FIDELITY_NOT_SUPPORTED'),
  );
  assert.throws(
    () => provider.validate({ ...edit, references: [] }),
    outcome('rejected', 'OPENAI_INPUT_FIDELITY_NOT_SUPPORTED'),
  );
});

test('OpenAI JPEG and WebP compression is transmitted and decoded as the requested real format', async () => {
  for (const [format, bytes] of [
    ['jpeg', jpeg],
    ['webp', webp],
  ] as const) {
    const provider = createOpenAIImageProvider(env, (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.output_compression, 72);
      assert.equal(body.output_format, format);
      return response([bytes], { output_format: format });
    }) as typeof fetch);
    const result = await provider.generate({
      ...input,
      imageOptions: { outputFormat: format, outputCompression: 72, background: 'opaque' },
    });
    assert.equal(result.mime, `image/${format}`);
  }
});
test('OpenAI image streams require an authenticated terminal image before any result is returned', async () => {
  const model = 'gpt-image-2.6-flare';
  const partial = { type: 'image_generation.partial_image', partial_image_index: 0, b64_json: png.toString('base64') };
  const completed = {
    type: 'image_generation.completed',
    b64_json: png.toString('base64'),
    size: '1024x1024',
    output_format: 'png',
  };
  let events = [partial, completed];
  const provider = createOpenAIImageProvider(
    { ...env, OPENAI_IMAGE_PARTIALS_ENABLED: 'true' },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.stream, true);
      assert.equal(body.partial_images, 1);
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream', 'x-request-id': 'image-stream-fixture' },
      });
    },
  );
  const options = { ...input, model, imageOptions: { stream: true, partialImages: 1, n: 1 } };
  assert.throws(
    () => provider.validate({ ...options, imageOptions: { ...options.imageOptions, n: 2 } }),
    { code: 'OPENAI_STREAM_REQUIRES_ONE_IMAGE' },
  );
  assert.equal((await provider.generate(options)).requestId, 'image-stream-fixture');
  events = [partial];
  await assert.rejects(provider.generate(options), { code: 'OPENAI_IMAGE_STREAM_INCOMPLETE' });
});
test('explicit transparency checks actual decoded alpha, not a filename or response declaration', async () => {
  const provider = createOpenAIImageProvider(env, (async () =>
    response([png], { background: 'transparent' })) as typeof fetch);
  await assert.rejects(
    provider.generate({ ...input, imageOptions: { background: 'transparent' } }),
    outcome('unknown', 'OPENAI_OUTPUT_NOT_TRANSPARENT'),
  );
});

test('OpenAI ambiguous or partially completed batch responses stay unknown, preserve request receipt and never retry', async () => {
  const cases = [
    () => response([]),
    () => response([png, png]),
    () =>
      new Response(JSON.stringify({ data: [{ url: 'https://elsewhere.invalid/image.png' }] }), {
        headers: { 'x-request-id': 'req-known' },
      }),
    () => response([png], { output_format: 'jpeg' }),
    () => response([png], { size: '1536x1024' }),
    () =>
      new Response('{"error":{"code":"rate_limit"}}', {
        status: 429,
        headers: { 'x-request-id': 'req-known' },
      }),
    () =>
      new Response('{"error":{"code":"internal"}}', {
        status: 500,
        headers: { 'x-request-id': 'req-known' },
      }),
    () =>
      new Response('{}', {
        headers: { 'x-request-id': 'req-known', 'content-length': '999999999' },
      }),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('interrupted'));
          },
        }),
        { headers: { 'x-request-id': 'req-known' } },
      ),
  ];
  for (const make of cases) {
    let calls = 0;
    const provider = createOpenAIImageProvider(env, (async () => {
      calls++;
      return make();
    }) as typeof fetch);
    await assert.rejects(
      provider.generate(input),
      (error: unknown) =>
        outcome('unknown')(error) && Boolean((error as MultimodalProviderError).requestId),
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const rejected = createOpenAIImageProvider(env, (async () => {
    calls++;
    return new Response('{"error":{"code":"invalid_request"}}', {
      status: 400,
      headers: { 'x-request-id': 'req-rejected' },
    });
  }) as typeof fetch);
  await assert.rejects(rejected.generate(input), outcome('rejected', 'PROVIDER_REQUEST_REJECTED'));
  assert.equal(calls, 1);
});
