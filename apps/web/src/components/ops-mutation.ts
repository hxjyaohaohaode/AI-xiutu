/** One mounted operations panel owns one write at a time. Cancelling ownership
 * does not cancel or retry the server write; it only discards stale UI work. */
export class OpsMutationOwner {
  private active = false;
  private current: object | null = null;

  get mounted() {
    return this.active;
  }

  get busy() {
    return this.current !== null;
  }

  mount() {
    this.active = true;
  }

  unmount() {
    this.active = false;
    this.current = null;
  }

  async run<Input, Result>(
    input: Input,
    work: (snapshot: Input, current: () => boolean) => Promise<Result | undefined>,
    handlers: {
      current: () => boolean;
      started: () => void;
      value: (value: Result) => void;
      error: (error: unknown) => void;
      settled: () => void;
    },
  ): Promise<boolean> {
    if (!this.active || this.current) return false;
    const snapshot = structuredClone(input);
    const owner = {};
    this.current = owner;
    const owns = () => this.active && this.current === owner;
    const current = () => owns() && handlers.current();
    handlers.started();
    try {
      const value = await work(snapshot, current);
      if (value !== undefined && current()) handlers.value(value);
    } catch (error) {
      if (current()) handlers.error(error);
    } finally {
      if (owns()) {
        this.current = null;
        handlers.settled();
      }
    }
    return true;
  }
}
