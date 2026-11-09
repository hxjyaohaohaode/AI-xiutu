import { createHash, createHmac } from 'node:crypto';
import sharp from 'sharp';

export type OtpPurpose = 'register' | 'login' | 'reset';
export interface SmsAdapter {
  configured: boolean;
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
const requestIdOf = (result: Record<string, unknown>) => {
  if (typeof result.RequestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(result.RequestId))
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
