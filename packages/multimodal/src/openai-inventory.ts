import { getJson, record, unknown } from './http.js';

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

/** Discovery only. Visibility alone provides neither a routing rule nor permission to charge. */
export async function listOpenAIProjectModels(key: string, fetcher: typeof fetch = fetch) {
  const payload = await getJson(OPENAI_MODELS_URL, key, 512_000, 8000, fetcher);
  if (payload.object !== 'list' || !Array.isArray(payload.data) || payload.data.length > 2000)
    unknown('OPENAI_MODEL_LIST_INVALID');
  const ids = new Set<string>();
  for (const item of payload.data) {
    if (
      !record(item) ||
      typeof item.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(item.id)
    )
      unknown('OPENAI_MODEL_LIST_INVALID');
    ids.add(item.id);
  }
  return [...ids].sort();
}
