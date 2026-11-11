export type OpsReadScope = Readonly<{ tab: string; query: string }>;

/** Read-only ownership. Cancelling an observation never claims a server write was cancelled. */
export class OpsReadCoordinator {
  private current: AbortController | null = null;

  cancel() {
    this.current?.abort();
    this.current = null;
  }

  async run<T>(
    scope: OpsReadScope,
    read: (scope: OpsReadScope, signal: AbortSignal) => Promise<T>,
    handlers: {
      current: (scope: OpsReadScope) => boolean;
      value: (value: T) => void;
      error: (error: unknown) => void;
      settled: () => void;
    },
  ) {
    this.cancel();
    const owner = new AbortController();
    const snapshot = { ...scope };
    this.current = owner;
    const current = () =>
      this.current === owner && !owner.signal.aborted && handlers.current(snapshot);
    try {
      const value = await read(snapshot, owner.signal);
      if (current()) handlers.value(value);
    } catch (error) {
      if (current()) handlers.error(error);
    } finally {
      if (current()) handlers.settled();
      if (this.current === owner) this.current = null;
    }
  }
}
