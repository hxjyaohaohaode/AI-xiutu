import { createHash, createHmac, randomUUID } from 'node:crypto';
import sharp from 'sharp';

export type OtpPurpose = 'register' | 'login' | 'reset';
export interface SmsAdapter {
  configured: boolean;
  supportsPhone?(phone: string): boolean;
  send(input: {
    phone: string;
    code: string;
    purpose: OtpPurpose;
    expiresMinutes: number;
  }): Promise<{ requestId: string }>;
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    public outcome: 'rejected' | 'unknown',
    message = '外部服务未确认成功',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
export interface TencentCredentials {
  secretId: string;
  secretKey: string;
  token?: string;
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string) =>
  createHmac('sha256', key).update(value).digest();
const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const requestIdOf = (result: Record<string, unknown>) => {
  if (!isRequestId(result.RequestId))
    throw new ProviderError('PROVIDER_REQUEST_ID_MISSING', 'unknown');
  return result.RequestId;
};

/** TC3 signing follows Tencent Cloud API 3.0; no credential values are logged. */
export function tc3Headers(
  p: TencentCredentials & {
    service: 'sms' | 'tms' | 'ims';
    action: string;
    version: string;
    region: string;
    body: string;
    timestamp?: number;
  },
): Record<string, string> {
  const timestamp = p.timestamp ?? Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const host = `${p.service}.tencentcloudapi.com`;
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${p.action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(p.body)}`;
  const scope = `${date}/${p.service}/tc3_request`;
  const toSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${p.secretKey}`, date);
  const secretService = hmac(secretDate, p.service);
  const signature = createHmac('sha256', hmac(secretService, 'tc3_request'))
    .update(toSign)
    .digest('hex');
  return {
    'Content-Type': contentType,
    Host: host,
    'X-TC-Action': p.action,
    'X-TC-Version': p.version,
    'X-TC-Region': p.region,
    'X-TC-Timestamp': String(timestamp),
    Authorization: `TC3-HMAC-SHA256 Credential=${p.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    ...(p.token ? { 'X-TC-Token': p.token } : {}),
  };
}
async function readJson(
  response: Response,
  signal: AbortSignal,
  maxBytes = 256_000,
): Promise<Record<string, unknown>> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderError('RESPONSE_TOO_LARGE', 'unknown');
  }
  if (!response.body) throw new ProviderError('EMPTY_RESPONSE', 'unknown');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new ProviderError('PROVIDER_RESPONSE_TIMEOUT', 'unknown'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new ProviderError('RESPONSE_TOO_LARGE', 'unknown');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('PROVIDER_RESPONSE_INTERRUPTED', 'unknown');
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'unknown');
  }
}
export async function tencentRequest(
  p: TencentCredentials & {
    service: 'sms' | 'tms' | 'ims';
    action: string;
    version: string;
    region: string;
    payload: Record<string, unknown>;
  },
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const body = JSON.stringify(p.payload);
  const signal = AbortSignal.timeout(12_000);
  let response: Response;
  try {
    response = await fetcher(`https://${p.service}.tencentcloudapi.com/`, {
      method: 'POST',
      headers: tc3Headers({ ...p, body }),
      body,
      redirect: 'error',
      signal,
    });
  } catch {
    throw new ProviderError('PROVIDER_NETWORK_UNKNOWN', 'unknown');
  }
  const parsed = await readJson(response, signal);
  const result = parsed.Response;
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'unknown');
  const data = result as Record<string, unknown>;
  if (data.Error) {
    const error = data.Error as Record<string, unknown>;
    const code =
      typeof error.Code === 'string' && /^[A-Za-z0-9._]{1,120}$/.test(error.Code)
        ? error.Code
        : 'PROVIDER_ERROR';
    throw new ProviderError(
      code,
      response.status >= 500 ||
        [408, 429].includes(response.status) ||
        code.startsWith('InternalError')
        ? 'unknown'
        : 'rejected',
    );
  }
  if (!response.ok) throw new ProviderError('PROVIDER_HTTP_UNKNOWN', 'unknown');
  return data;
}
export function createTencentSms(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): SmsAdapter {
  const secretId = env.TENCENT_SECRET_ID ?? '';
  const secretKey = env.TENCENT_SECRET_KEY ?? '';
  const appId = env.TENCENT_SMS_APP_ID ?? '';
  const signName = env.TENCENT_SMS_SIGN_NAME ?? '';
  const templates: Record<OtpPurpose, string> = {
    register: env.TENCENT_SMS_TEMPLATE_REGISTER ?? '',
    login: env.TENCENT_SMS_TEMPLATE_LOGIN ?? '',
    reset: env.TENCENT_SMS_TEMPLATE_RESET ?? '',
  };
  const configured = Boolean(
    secretId && secretKey && appId && signName && Object.values(templates).every(Boolean),
  );
  return {
    configured,
    async send({ phone, code, purpose, expiresMinutes }) {
      if (!configured) throw new ProviderError('SMS_NOT_CONFIGURED', 'rejected');
      const parameters =
        env.TENCENT_SMS_CODE_ONLY === 'true' ? [code] : [code, String(expiresMinutes)];
      const result = await tencentRequest(
        {
          secretId,
          secretKey,
          service: 'sms',
          action: 'SendSms',
          version: '2021-01-11',
          region: env.TENCENT_SMS_REGION ?? 'ap-guangzhou',
          payload: {
            PhoneNumberSet: [phone],
            SmsSdkAppId: appId,
            SignName: signName,
            TemplateId: templates[purpose],
            TemplateParamSet: parameters,
          },
        },
        fetcher,
      );
      const statuses = result.SendStatusSet;
      if (!Array.isArray(statuses) || statuses.length !== 1)
        throw new ProviderError('SMS_STATUS_UNKNOWN', 'unknown');
      const status = statuses[0] as Record<string, unknown>;
      if (!status || typeof status !== 'object')
        throw new ProviderError('SMS_STATUS_UNKNOWN', 'unknown');
      if (status.Code !== 'Ok') {
        const code =
          typeof status.Code === 'string' && /^[A-Za-z0-9._]{1,120}$/.test(status.Code)
            ? status.Code
            : 'SMS_REJECTED';
        throw new ProviderError(code, code.startsWith('InternalError') ? 'unknown' : 'rejected');
      }
      if (status.PhoneNumber !== phone) throw new ProviderError('SMS_RECIPIENT_UNKNOWN', 'unknown');
      return { requestId: requestIdOf(result) };
    },
  };
}

const pnvsHost = 'dypnsapi.aliyuncs.com';
const mainlandMobile = /^\+861[3-9]\d{9}$/;
const encodeRpcValue = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Send the application's one-time code using Alibaba Cloud's SMS Authentication templates. */
export function createAlibabaSms(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): SmsAdapter {
  const accessKey = env.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim() ?? '';
  const secret = env.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim() ?? '';
  const token = env.ALIBABA_CLOUD_SECURITY_TOKEN?.trim();
  const signName = env.ALIBABA_SMS_SIGN_NAME?.trim() ?? '';
  const templates: Record<OtpPurpose, string> = {
    register: env.ALIBABA_SMS_TEMPLATE_REGISTER?.trim() ?? '',
    login: env.ALIBABA_SMS_TEMPLATE_LOGIN?.trim() ?? '',
    reset: env.ALIBABA_SMS_TEMPLATE_RESET?.trim() ?? '',
  };
  const configured = Boolean(
    /^[A-Za-z0-9]{8,128}$/.test(accessKey) &&
    secret &&
    signName &&
    Object.values(templates).every((template) => /^\d{1,24}$/.test(template)),
  );
  const supportsPhone = (phone: string) => mainlandMobile.test(phone);
  return {
    configured,
    supportsPhone,
    async send({ phone, code, purpose, expiresMinutes }) {
      if (!configured) throw new ProviderError('SMS_NOT_CONFIGURED', 'rejected');
      if (!supportsPhone(phone)) throw new ProviderError('SMS_PHONE_UNSUPPORTED', 'rejected');
      if (
        !/^\d{6}$/.test(code) ||
        !Number.isInteger(expiresMinutes) ||
        expiresMinutes < 1 ||
        expiresMinutes > 10 ||
        !Object.hasOwn(templates, purpose)
      )
        throw new ProviderError('SMS_PARAMETERS_INVALID', 'rejected');

      const outId = randomUUID();
      const query = Object.entries({
        AutoRetry: '0',
        CountryCode: '86',
        Interval: '60',
        OutId: outId,
        PhoneNumber: phone.slice(3),
        ReturnVerifyCode: 'false',
        SignName: signName,
        TemplateCode: templates[purpose],
        TemplateParam: JSON.stringify({ code, min: String(expiresMinutes) }),
        ValidTime: String(expiresMinutes * 60),
      })
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, value]) => `${name}=${encodeRpcValue(value)}`)
        .join('&');
      const payloadHash = sha256('');
      const headers: Record<string, string> = {
        host: pnvsHost,
        'x-acs-action': 'SendSmsVerifyCode',
        'x-acs-content-sha256': payloadHash,
        'x-acs-date': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        'x-acs-signature-nonce': randomUUID(),
        'x-acs-version': '2017-05-25',
      };
      if (token) headers['x-acs-security-token'] = token;
      const names = Object.keys(headers).sort();
      const signedHeaders = names.join(';');
      const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
      const request = `POST\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
      const algorithm = 'ACS3-HMAC-SHA256';
      const signature = hmac(secret, `${algorithm}\n${sha256(request)}`).toString('hex');
      headers.authorization = `${algorithm} Credential=${accessKey},SignedHeaders=${signedHeaders},Signature=${signature}`;

      const signal = AbortSignal.timeout(12_000);
      let response: Response;
      try {
        response = await fetcher(`https://${pnvsHost}/?${query}`, {
          method: 'POST',
          headers,
          redirect: 'error',
          signal,
        });
      } catch {
        throw new ProviderError('PROVIDER_NETWORK_UNKNOWN', 'unknown');
      }
      const data = await readJson(response, signal);
      const receipt = data.Model as Record<string, unknown> | undefined;
      if (response.ok && data.Code === 'OK' && data.Success === true) {
        // PNVS can return the request ID only inside Model.
        const requestId = isRequestId(data.RequestId) ? data.RequestId : requestIdOf(receipt ?? {});
        if (
          typeof receipt?.BizId === 'string' &&
          /^[A-Za-z0-9._:^|-]{1,128}$/.test(receipt.BizId) &&
          (receipt.OutId === undefined || receipt.OutId === outId)
        )
          return { requestId };
      }
      if (
        isRequestId(data.RequestId) &&
        response.status < 500 &&
        ![408, 429].includes(response.status) &&
        data.Success !== true &&
        typeof data.Code === 'string' &&
        /^[A-Za-z0-9._]{1,120}$/.test(data.Code) &&
        data.Code !== 'OK' &&
        !/internal|timeout|unknown|system|serviceunavailable/i.test(data.Code)
      )
        throw new ProviderError(data.Code, 'rejected');
      throw new ProviderError('SMS_STATUS_UNKNOWN', 'unknown');
    },
  };
}

export function createSms(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch) {
  const provider = env.SMS_PROVIDER?.trim() || 'tencent';
  if (provider === 'alibaba-pnvs') return createAlibabaSms(env, fetcher);
  if (provider === 'tencent') return createTencentSms(env, fetcher);
  throw new ProviderError('SMS_PROVIDER_INVALID', 'rejected');
}

export interface ModerationResult {
  decision: 'passed' | 'blocked' | 'review';
  requestId: string;
  inputHash: string;
}
export interface TextModerator {
  configured: boolean;
  check(text: string, requestId?: string): Promise<ModerationResult>;
}
/** Explicit TEXT moderation only. This is not an image/audio/video moderation adapter. */
export function createTencentTextModerator(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): TextModerator {
  const secretId = env.TENCENT_SECRET_ID ?? '';
  const secretKey = env.TENCENT_SECRET_KEY ?? '';
  const bizType = env.TENCENT_MODERATION_BIZ_TYPE ?? '';
  const configured = Boolean(secretId && secretKey && bizType);
  return {
    configured,
    async check(text, requestId) {
      if (!configured) throw new ProviderError('MODERATION_NOT_CONFIGURED', 'rejected');
      if (!text.length || Array.from(text).length > 10_000)
        throw new ProviderError('MODERATION_INPUT_LIMIT', 'rejected');
      const result = await tencentRequest(
        {
          secretId,
          secretKey,
          service: 'tms',
          action: 'TextModeration',
          version: '2020-12-29',
          region: env.TENCENT_MODERATION_REGION ?? 'ap-guangzhou',
          payload: {
            Content: Buffer.from(text, 'utf8').toString('base64'),
            Type: 'TEXT',
            BizType: bizType,
            ...(requestId ? { DataId: requestId } : {}),
          },
        },
        fetcher,
      );
      const suggestion = result.Suggestion;
      if (!['Pass', 'Block', 'Review'].includes(String(suggestion)))
        throw new ProviderError('MODERATION_INCOMPLETE', 'unknown');
      return {
        decision: suggestion === 'Pass' ? 'passed' : suggestion === 'Block' ? 'blocked' : 'review',
        requestId: requestIdOf(result),
        inputHash: sha256(text),
      };
    },
  };
}
export interface ImageModerator {
  configured: boolean;
  check(bytes: Uint8Array, mime: string, requestId?: string): Promise<ModerationResult>;
}
export function createTencentImageModerator(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): ImageModerator {
  const secretId = env.TENCENT_SECRET_ID ?? '';
  const secretKey = env.TENCENT_SECRET_KEY ?? '';
  const bizType = env.TENCENT_IMAGE_MODERATION_BIZ_TYPE ?? '';
  const configured = Boolean(secretId && secretKey && bizType);
  return {
    configured,
    async check(bytes, mime, requestId) {
      if (!configured) throw new ProviderError('IMAGE_MODERATION_NOT_CONFIGURED', 'rejected');
      // The official bound is on BASE64 content, not the raw image byte length.
      if (
        bytes.byteLength < 16 ||
        Math.ceil(bytes.byteLength / 3) * 4 >= 10 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(mime)
      )
        throw new ProviderError('IMAGE_MODERATION_INPUT_LIMIT', 'rejected');
      let meta;
      try {
        meta = await sharp(Buffer.from(bytes), {
          limitInputPixels: 40_000_000,
          animated: true,
          failOn: 'warning',
        }).metadata();
      } catch {
        throw new ProviderError('IMAGE_MODERATION_INVALID_IMAGE', 'rejected');
      }
      const actualMime = meta.format === 'jpeg' ? 'image/jpeg' : `image/${meta.format}`;
      if (
        actualMime !== mime ||
        (meta.pages ?? 1) > 1 ||
        !meta.width ||
        !meta.height ||
        meta.width <= 50 ||
        meta.height <= 50 ||
        meta.width >= 10000 ||
        meta.height >= 10000 ||
        Math.max(meta.width / meta.height, meta.height / meta.width) >= 90
      )
        throw new ProviderError('IMAGE_MODERATION_INPUT_LIMIT', 'rejected');
      if (requestId && !/^[A-Za-z0-9_@#-]{1,64}$/.test(requestId))
        throw new ProviderError('IMAGE_MODERATION_INVALID_DATA_ID', 'rejected');
      const result = await tencentRequest(
        {
          secretId,
          secretKey,
          service: 'ims',
          action: 'ImageModeration',
          version: '2020-12-29',
          region: env.TENCENT_MODERATION_REGION ?? 'ap-guangzhou',
          payload: {
            FileContent: Buffer.from(bytes).toString('base64'),
            Type: 'IMAGE',
            BizType: bizType,
            ...(requestId ? { DataId: requestId } : {}),
          },
        },
        fetcher,
      );
      const suggestion = result.Suggestion;
      if (!['Pass', 'Block', 'Review'].includes(String(suggestion)))
        throw new ProviderError('IMAGE_MODERATION_INCOMPLETE', 'unknown');
      return {
        decision: suggestion === 'Pass' ? 'passed' : suggestion === 'Block' ? 'blocked' : 'review',
        requestId: requestIdOf(result),
        inputHash: createHash('sha256').update(bytes).digest('hex'),
      };
    },
  };
}

type OpenAIModerationInput =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

async function openAIReview(
  key: string,
  model: string,
  input: OpenAIModerationInput,
  inputHash: string,
  fetcher: typeof fetch,
): Promise<ModerationResult> {
  if (!key) throw new ProviderError('MODERATION_NOT_CONFIGURED', 'rejected');
  const signal = AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await fetcher('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: [input] }),
      redirect: 'error',
      signal,
    });
  } catch {
    throw new ProviderError('MODERATION_UNAVAILABLE', 'unknown');
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderError(
      'MODERATION_UNAVAILABLE',
      response.status >= 500 ? 'unknown' : 'rejected',
    );
  }
  const data = await readJson(response, signal);
  const result = Array.isArray(data.results) && data.results.length === 1 ? data.results[0] : null;
  if (
    !result ||
    typeof result.flagged !== 'boolean' ||
    typeof data.id !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(data.id)
  )
    throw new ProviderError('MODERATION_INCOMPLETE', 'unknown');
  return { decision: result.flagged ? 'blocked' : 'passed', requestId: data.id, inputHash };
}

function openAIModerationModel(env: NodeJS.ProcessEnv) {
  const model = env.OPENAI_MODERATION_MODEL?.trim() || 'omni-moderation-latest';
  if (!['omni-moderation-latest', 'omni-moderation-2024-09-26'].includes(model))
    throw new ProviderError('MODERATION_MODEL_CONFIG_INVALID', 'rejected');
  return model;
}

export function createTextModerator(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): TextModerator {
  if (env.AI_MODERATION_PROVIDER !== 'openai') return createTencentTextModerator(env, fetcher);
  const key = env.OPENAI_API_KEY?.trim() ?? '';
  const model = openAIModerationModel(env);
  return {
    configured: !!key,
    check(text) {
      if (!text.length || Array.from(text).length > 10_000)
        return Promise.reject(new ProviderError('MODERATION_INPUT_LIMIT', 'rejected'));
      return openAIReview(key, model, { type: 'text', text }, sha256(text), fetcher);
    },
  };
}

export function createImageModerator(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): ImageModerator {
  if (env.AI_MODERATION_PROVIDER !== 'openai') return createTencentImageModerator(env, fetcher);
  const key = env.OPENAI_API_KEY?.trim() ?? '';
  const model = openAIModerationModel(env);
  return {
    configured: !!key,
    async check(bytes, mime) {
      if (!key) throw new ProviderError('IMAGE_MODERATION_NOT_CONFIGURED', 'rejected');
      if (
        bytes.byteLength < 16 ||
        Math.ceil(bytes.byteLength / 3) * 4 >= 10 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(mime)
      )
        throw new ProviderError('IMAGE_MODERATION_INPUT_LIMIT', 'rejected');
      const buffer = Buffer.from(bytes);
      const meta = await sharp(buffer, {
        limitInputPixels: 40_000_000,
        animated: true,
        failOn: 'warning',
      })
        .metadata()
        .catch(() => {
          throw new ProviderError('IMAGE_MODERATION_INVALID_IMAGE', 'rejected');
        });
      if (mime !== 'image/' + meta.format || (meta.pages ?? 1) > 1 || !meta.width || !meta.height)
        throw new ProviderError('IMAGE_MODERATION_INVALID_IMAGE', 'rejected');
      const url = 'data:' + mime + ';base64,' + buffer.toString('base64');
      return openAIReview(
        key,
        model,
        { type: 'image_url', image_url: { url } },
        createHash('sha256').update(buffer).digest('hex'),
        fetcher,
      );
    },
  };
}
