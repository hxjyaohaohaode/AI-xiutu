import { listOpenAIProjectModels } from '@ai-xiutu/multimodal';

type State = 'unconfigured' | 'not_checked' | 'reachable' | 'unreachable' | 'catalog_denied' | 'provider_error';
type Sample = { state: State; httpStatus: number | null; checkedAt: number; expiresAt: number };

/** The fixed /v1/models request shares the official HTTP adapter's startup
 * egress configuration. No user input, provider response or key enters the DTO. */
export function createCatalogConnection(options: {
  key: string;
  live: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  let last: Sample | undefined;
  let pending: Promise<void> | undefined;
  let inventory: { ids: string[]; checkedAt: number } | undefined;
  function snapshot() {
    return {
      state: last?.state ?? (options.key ? 'not_checked' : 'unconfigured') as State,
      enabled: Boolean(options.key && options.live),
      httpStatus: last?.httpStatus ?? null,
      checkedAt: last ? new Date(last.checkedAt).toISOString() : null,
      retryAfterMs: last ? Math.max(0, last.expiresAt - now()) : 0,
      stale: Boolean(last && now() >= last.expiresAt),
    };
  }
  async function sample() {
    let status: number | null = null;
    let state: State;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 3000);
    try {
      const ids = await listOpenAIProjectModels(options.key, async (url, init) => {
        const response = await (options.fetcher ?? fetch)(url, {
          ...init, redirect: 'manual',
          signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        });
        status = response.status;
        return response;
      });
      inventory = { ids, checkedAt: now() };
      state = 'reachable';
    } catch {
      state = status === 401 || status === 403 ? 'catalog_denied' :
        status === null || timeout.aborted ? 'unreachable' : 'provider_error';
    }
    const checkedAt = now();
    last = { state, httpStatus: status, checkedAt, expiresAt: checkedAt + (state === 'reachable' ? 300_000 : 15_000) };
  }
  async function check(fixtureInventory = false) {
    if (options.key && (options.live || (fixtureInventory && options.fetcher)) &&
        (!last || last.expiresAt <= now())) {
      pending ??= sample().finally(() => { pending = undefined; });
      await pending;
    }
    return snapshot();
  }
  return {
    snapshot,
    check: () => check(),
    async inventory() {
      await check(true);
      return inventory && now() - inventory.checkedAt < 1_800_000 ? inventory : undefined;
    },
  };
}
