type WorkerEndpoint = Pick<Worker, 'onmessage' | 'onmessageerror' | 'onerror' | 'terminate'>;
type WorkerRef<T extends WorkerEndpoint> = { current: T | null };

/** Invalidate ownership before terminating so already queued callbacks are harmless. */
export function releaseWorker<T extends WorkerEndpoint>(owner: WorkerRef<T>) {
  const instance = owner.current;
  owner.current = null;
  if (!instance) return;
  instance.onmessage = null;
  instance.onmessageerror = null;
  instance.onerror = null;
  instance.terminate();
}

/** Creation is explicit: a failed worker is never restarted by an error callback. */
export function ensureWorker<T extends WorkerEndpoint, Reply>(
  owner: WorkerRef<T>,
  create: () => T,
  onMessage: (data: Reply) => void,
  onFailure: () => void,
): T {
  if (owner.current) return owner.current;
  const instance = create();
  owner.current = instance;
  instance.onmessage = (event: MessageEvent<Reply>) => {
    if (owner.current === instance) onMessage(event.data);
  };
  const fail = () => {
    if (owner.current !== instance) return;
    releaseWorker(owner);
    onFailure();
  };
  instance.onerror = fail;
  instance.onmessageerror = fail;
  return instance;
}
