import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import sharp from 'sharp';
import {
  createTencentSms,
  createSms,
  createTencentTextModerator,
  createTencentImageModerator,
  createTextModerator,
  createImageModerator,
  tc3Headers,
  ProviderError,
  type TencentCredentials,
} from '../src/index.js';

const env = {
  TENCENT_SECRET_ID: 'test-secret-id',
  TENCENT_SECRET_KEY: 'test-secret-key',
  TENCENT_SMS_APP_ID: '1400000000',
  TENCENT_SMS_SIGN_NAME: '测试签名',
  TENCENT_SMS_TEMPLATE_REGISTER: '1',
  TENCENT_SMS_TEMPLATE_LOGIN: '2',
  TENCENT_SMS_TEMPLATE_RESET: '3',
  TENCENT_MODERATION_BIZ_TYPE: 'text-test',
  TENCENT_IMAGE_MODERATION_BIZ_TYPE: 'image-test',
};
const phone = '+8613800000000';
const otp = { phone, code: '123456', purpose: 'register' as const, expiresMinutes: 10 };
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify({ Response: value }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const fetchAs = (fn: (url: string, init: RequestInit) => Promise<Response>) => fn as typeof fetch;
const unknown = (error: unknown) => error instanceof ProviderError && error.outcome === 'unknown';

test('Alibaba SMS Authentication binds each OTP purpose, signature and receipt without a fallback send', async () => {
  const aliEnv = {
    SMS_PROVIDER: 'alibaba-pnvs',
    ALIBABA_CLOUD_ACCESS_KEY_ID: 'testAccessKey',
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'testSecret',
    ALIBABA_SMS_SIGN_NAME: '测试签名',
    ALIBABA_SMS_TEMPLATE_REGISTER: '100001',
    ALIBABA_SMS_TEMPLATE_LOGIN: '100001',
    ALIBABA_SMS_TEMPLATE_RESET: '100003',
  };
  let attempts = 0;
  const adapter = createSms(
    aliEnv,
    fetchAs(async (url, options) => {
      attempts++;
      const request = new URL(url);
      assert.equal(request.origin, 'https://dypnsapi.aliyuncs.com');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      const headers = new Headers(options.headers);
      const signed = headers
        .get('authorization')!
        .match(/SignedHeaders=([^,]+),Signature=([a-f0-9]{64})$/)!;
      const entries = signed[1]!
        .split(';')
        .map((name) => `${name}:${headers.get(name)}\n`)
        .join('');
      const canonical = `POST\n/\n${request.search.slice(1)}\n${entries}\n${signed[1]}\n${headers.get('x-acs-content-sha256')}`;
      const signature = createHmac('sha256', aliEnv.ALIBABA_CLOUD_ACCESS_KEY_SECRET)
        .update(`ACS3-HMAC-SHA256\n${createHash('sha256').update(canonical).digest('hex')}`)
        .digest('hex');
      assert.equal(signed[2], signature);
      assert.equal(headers.get('x-acs-action'), 'SendSmsVerifyCode');
      const query = request.searchParams;
      assert.equal(query.get('PhoneNumber'), phone.slice(3));
      assert.equal(query.get('CountryCode'), '86');
      assert.equal(query.get('TemplateCode'), attempts === 3 ? '100003' : '100001');
      assert.deepEqual(JSON.parse(query.get('TemplateParam')!), { code: otp.code, min: '10' });
      assert.equal(query.get('AutoRetry'), '0');
      assert.equal(query.get('ReturnVerifyCode'), 'false');
      return Response.json({
        Code: 'OK',
        Success: true,
        RequestId: 'request-1',
        Model: { BizId: 'fixture^1', OutId: attempts === 4 ? 'unrelated' : query.get('OutId') },
      });
    }),
  );
  assert.equal(adapter.configured, true);
  for (const purpose of ['register', 'login', 'reset'] as const)
    assert.deepEqual(await adapter.send({ ...otp, purpose }), { requestId: 'request-1' });
  await assert.rejects(adapter.send(otp), unknown);
  await assert.rejects(adapter.send({ ...otp, phone: '+12025550123' }), {
    code: 'SMS_PHONE_UNSUPPORTED',
  });
  assert.equal(attempts, 4);
  const broken = createSms(
    aliEnv,
    fetchAs(async () => Response.json({ Code: 'InternalError', RequestId: 'r1' })),
  );
  await assert.rejects(broken.send(otp), unknown);
  assert.equal(createSms({ ...aliEnv, ALIBABA_SMS_TEMPLATE_RESET: '' }).configured, false);
});

test('Tencent adapters have no unconfigured delivery or moderation bypass', async () => {
  let calls = 0;
  const fetcher = fetchAs(async () => {
    calls++;
    throw new Error('must not call');
  });
  const sms = createTencentSms({}, fetcher);
  assert.equal(sms.configured, false);
  await assert.rejects(sms.send(otp), { code: 'SMS_NOT_CONFIGURED' });
  const text = createTencentTextModerator({}, fetcher);
  assert.equal(text.configured, false);
  await assert.rejects(text.check('text'), { code: 'MODERATION_NOT_CONFIGURED' });
  const image = createTencentImageModerator({}, fetcher);
  assert.equal(image.configured, false);
  await assert.rejects(image.check(Buffer.alloc(16), 'image/png'), {
    code: 'IMAGE_MODERATION_NOT_CONFIGURED',
  });
  assert.equal(calls, 0);
});

test('TC3 authorization binds exact body, action and UTC credential scope', () => {
  const input: TencentCredentials & Parameters<typeof tc3Headers>[0] = {
    secretId: 'AKIDtest',
    secretKey: 'test-key',
    service: 'sms',
    action: 'SendSms',
    version: '2021-01-11',
    region: 'ap-guangzhou',
    body: '{"message":"one"}',
    timestamp: 1551113065,
  };
  const first = tc3Headers(input);
  assert.equal(first.Host, 'sms.tencentcloudapi.com');
  assert.match(first.Authorization!, /Credential=AKIDtest\/2019-02-25\/sms\/tc3_request/);
  assert.match(first.Authorization!, /Signature=[a-f0-9]{64}$/);
  assert.deepEqual(first, tc3Headers({ ...input }));
  assert.notEqual(
    first.Authorization,
    tc3Headers({ ...input, body: '{"message":"two"}' }).Authorization,
  );
  assert.notEqual(
    first.Authorization,
    tc3Headers({ ...input, action: 'OtherAction' }).Authorization,
  );
});

test('SMS uses official fixed endpoint, one approved purpose template and exact recipient receipt', async () => {
  let calls = 0;
  const sms = createTencentSms(
    env,
    fetchAs(async (url, init) => {
      calls++;
      assert.equal(url, 'https://sms.tencentcloudapi.com/');
      assert.equal(init.redirect, 'error');
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.PhoneNumberSet, [phone]);
      assert.equal(body.TemplateId, '1');
      assert.deepEqual(body.TemplateParamSet, ['123456', '10']);
      assert.equal(body.SmsSdkAppId, env.TENCENT_SMS_APP_ID);
      assert.equal((init.headers as Record<string, string>)['X-TC-Action'], 'SendSms');
      return response({
        RequestId: 'request-1',
        SendStatusSet: [{ Code: 'Ok', PhoneNumber: phone }],
      });
    }),
  );
  assert.deepEqual(await sms.send(otp), { requestId: 'request-1' });
  assert.equal(calls, 1);
  const wrong = createTencentSms(
    env,
    fetchAs(async () =>
      response({
        RequestId: 'request-2',
        SendStatusSet: [{ Code: 'Ok', PhoneNumber: '+8613900000000' }],
      }),
    ),
  );
  await assert.rejects(wrong.send(otp), unknown);
});

test('network errors, streamed interruption, invalid envelopes and large responses stay unknown without retries', async () => {
  const results: Array<() => Promise<Response>> = [
    async () => {
      throw new Error('disconnected');
    },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"Response":'));
            controller.error(new Error('stream lost'));
          },
        }),
      ),
    async () => new Response('null'),
    async () => new Response('{"Response":[]}'),
    async () => new Response('invalid json'),
    async () => new Response('{}', { headers: { 'content-length': '300000' } }),
  ];
  for (const produce of results) {
    let calls = 0;
    const sms = createTencentSms(
      env,
      fetchAs(async () => {
        calls++;
        return produce();
      }),
    );
    await assert.rejects(sms.send(otp), unknown);
    assert.equal(calls, 1);
  }
});

test('definite Tencent client rejection differs from ambiguous internal failure', async () => {
  const rejected = createTencentSms(
    env,
    fetchAs(async () =>
      response({
        Error: { Code: 'InvalidParameterValue.TemplateId', Message: 'raw upstream text' },
      }),
    ),
  );
  await assert.rejects(
    rejected.send(otp),
    (e) =>
      e instanceof ProviderError && e.outcome === 'rejected' && !e.message.includes('raw upstream'),
  );
  const internal = createTencentSms(
    env,
    fetchAs(async () =>
      response({ Error: { Code: 'InternalError', Message: 'raw server details' } }),
    ),
  );
  await assert.rejects(internal.send(otp), unknown);
  const missingReceipt = createTencentSms(
    env,
    fetchAs(async () => response({ SendStatusSet: [{ Code: 'Ok', PhoneNumber: phone }] })),
  );
  await assert.rejects(missingReceipt.send(otp), unknown);
});

test('text moderation binds exact UTF-8 bytes and keeps Review distinct from Pass', async () => {
  const content = '中文测试 abc';
  const text = createTencentTextModerator(
    env,
    fetchAs(async (url, init) => {
      assert.equal(url, 'https://tms.tencentcloudapi.com/');
      const body = JSON.parse(String(init.body));
      assert.equal(Buffer.from(body.Content, 'base64').toString('utf8'), content);
      assert.equal(body.Type, 'TEXT');
      return response({ RequestId: 'tms-1', Suggestion: 'Review' });
    }),
  );
  const result = await text.check(content, 'data-1');
  assert.equal(result.decision, 'review');
  assert.equal(result.inputHash, createHash('sha256').update(content).digest('hex'));
  const invalid = createTencentTextModerator(
    env,
    fetchAs(async () => response({ RequestId: 'tms-2', Suggestion: 'Unknown' })),
  );
  await assert.rejects(invalid.check(content), unknown);
});

test('image moderation hashes the exact file and refuses small, mismatched or oversized content before external dispatch', async () => {
  const bytes = await sharp({
    create: { width: 64, height: 80, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  let calls = 0;
  const image = createTencentImageModerator(
    env,
    fetchAs(async (url, init) => {
      calls++;
      assert.equal(url, 'https://ims.tencentcloudapi.com/');
      const body = JSON.parse(String(init.body));
      assert.equal(body.Type, 'IMAGE');
      assert.deepEqual(Buffer.from(body.FileContent, 'base64'), bytes);
      return response({ RequestId: 'ims-1', Suggestion: 'Pass' });
    }),
  );
  const result = await image.check(bytes, 'image/png', 'job-1');
  assert.equal(result.decision, 'passed');
  assert.equal(result.inputHash, createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(image.check(bytes, 'image/jpeg'), { code: 'IMAGE_MODERATION_INPUT_LIMIT' });
  const small = await sharp({
    create: { width: 50, height: 80, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  await assert.rejects(image.check(small, 'image/png'), { code: 'IMAGE_MODERATION_INPUT_LIMIT' });
  await assert.rejects(image.check(Buffer.alloc(7_864_320), 'image/png'), {
    code: 'IMAGE_MODERATION_INPUT_LIMIT',
  });
  assert.equal(calls, 1);
});

test('OpenAI moderation binds the exact submitted text and image and fails closed on incomplete receipts', async () => {
  const config = { AI_MODERATION_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only' };
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#426fa1' } })
    .png()
    .toBuffer();
  const seen: { type: string; text?: string; image_url?: { url: string } }[] = [];
  const fetcher = fetchAs(async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/moderations');
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, 'omni-moderation-latest');
    seen.push(body.input[0]);
    return Response.json(
      seen.length === 3
        ? { id: 'missing-decision', results: [{}] }
        : { id: 'review-' + seen.length, results: [{ flagged: seen.length === 2 }] },
    );
  });
  const text = createTextModerator(config, fetcher);
  const image = createImageModerator(config, fetcher);
  const exact = ' Warm shadows · 冷暖 ';
  const hash = (input: Buffer | string) => createHash('sha256').update(input).digest('hex');
  assert.deepEqual(await text.check(exact), {
    decision: 'passed',
    requestId: 'review-1',
    inputHash: hash(exact),
  });
  assert.equal(seen[0]?.text, exact);
  await assert.rejects(image.check(png, 'image/jpeg'), { code: 'IMAGE_MODERATION_INVALID_IMAGE' });
  assert.equal(seen.length, 1, 'wrong image format is rejected before dispatch');
  assert.deepEqual(await image.check(png, 'image/png'), {
    decision: 'blocked',
    requestId: 'review-2',
    inputHash: hash(png),
  });
  assert.deepEqual(Buffer.from(seen[1]?.image_url?.url.split(',')[1] ?? '', 'base64'), png);
  await assert.rejects(text.check('no complete receipt'), unknown);
  assert.equal(seen.length, 3, 'unknown result is never retried automatically');
});
