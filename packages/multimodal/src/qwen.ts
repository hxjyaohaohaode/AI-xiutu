import { postJson, record, reject, token, unknown } from './http.js';
import type { SpeechProvider } from './types.js';
import { validateWav } from './wav.js';

export const QWEN_ASR_LEGACY_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const MAX_ASR_RESPONSE_BYTES = 131_072;

function asrBaseUrl(env: NodeJS.ProcessEnv): string {
  const workspace = env.DASHSCOPE_WORKSPACE_ID;
  if (workspace && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workspace))
    reject('QWEN_WORKSPACE_CONFIG_INVALID');
  const value =
    env.QWEN_ASR_BASE_URL ??
    (workspace
      ? `https://${workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
      : QWEN_ASR_LEGACY_BASE_URL);
  if (
    value !== QWEN_ASR_LEGACY_BASE_URL &&
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com\/compatible-mode\/v1$/.test(
      value,
    )
  )
    reject('QWEN_ASR_ENDPOINT_NOT_ALLOWED');
  return value;
}

export function createQwenSpeechProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): SpeechProvider {
  const apiKey = token(env.DASHSCOPE_API_KEY);
  const baseUrl = asrBaseUrl(env);
  const raw = env.QWEN_ASR_MODELS ?? '';
  if (raw.length > 2048) reject('QWEN_ASR_MODEL_CONFIG_INVALID');
  const models = Object.freeze(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (
    models.length > 16 ||
    new Set(models).size !== models.length ||
    models.some((model) => !/^qwen3-asr-flash(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
  )
    reject('QWEN_ASR_MODEL_CONFIG_INVALID');
  const configured = Boolean(apiKey && models.length > 0);
  return {
    configured,
    models,
    async transcribe({ model, wav }) {
      if (!configured) reject('QWEN_ASR_NOT_CONFIGURED');
      if (!models.includes(model)) reject('QWEN_ASR_MODEL_NOT_ENABLED');
      validateWav(wav);
      const { data, requestId } = await postJson(
        `${baseUrl}/chat/completions`,
        apiKey,
        {
          model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: `data:audio/wav;base64,${Buffer.from(wav).toString('base64')}`,
                  },
                },
              ],
            },
          ],
          stream: false,
          asr_options: { enable_itn: false },
        },
        MAX_ASR_RESPONSE_BYTES,
        45_000,
        fetcher,
      );
      if (
        data.error ||
        !Array.isArray(data.choices) ||
        data.choices.length !== 1 ||
        !record(data.choices[0])
      )
        unknown('QWEN_ASR_RESULT_UNKNOWN', requestId);
      const choice = data.choices[0];
      if (
        choice.finish_reason !== 'stop' ||
        !record(choice.message) ||
        typeof choice.message.content !== 'string' ||
        choice.message.content.length > 10_000 ||
        Buffer.byteLength(choice.message.content, 'utf8') > 32_000
      )
        unknown('QWEN_ASR_OUTPUT_INVALID_OR_TRUNCATED', requestId);
      return { text: choice.message.content, requestId };
    },
  };
}
