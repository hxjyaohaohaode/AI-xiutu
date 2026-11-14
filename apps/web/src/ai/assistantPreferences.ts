import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { assistantPreferencesSchema, defaultAssistantPreferences, type AssistantPreferences } from '@ai-xiutu/contracts';
import { api, jsonRequest } from '../lib/api';

type Snapshot = { actorId: string; version: number; value: AssistantPreferences };
type Record = { snapshot?: Snapshot; pending?: Promise<void>; subscribers: Set<() => void>; stop?: () => void };
const records = new Map<string, Record>();
const endpoint = '/me/assistant-preferences';

function record(actor: string) {
  let value = records.get(actor);
  if (!value) {
    value = { subscribers: new Set() };
    records.set(actor, value);
  }
  return value;
}
function accept(actor: string, incoming: Snapshot) {
  const entry = record(actor);
  if (incoming.actorId !== actor || (entry.snapshot && entry.snapshot.version >= incoming.version)) return;
  entry.snapshot = incoming;
  entry.subscribers.forEach((notify) => notify());
}
function legacy(actor: string) {
  const key = 'xiutu:assistant-preferences:' + actor;
  try {
    const value = localStorage.getItem(key);
    const result = value && assistantPreferencesSchema.safeParse(JSON.parse(value));
    return result && result.success ? { key, value: result.data } : null;
  } catch { return null; }
}
function refresh(actor: string) {
  const entry = record(actor);
  if (entry.pending) return;
  entry.pending = (async () => {
    const snapshot = await api<Snapshot>(endpoint);
    if (snapshot.actorId !== actor) return;
    const previous = legacy(actor);
    const fresh = previous && snapshot.version === 0
      ? await api<Snapshot>(endpoint, jsonRequest('PATCH', { actorId: actor, patch: previous.value, initialize: true }))
      : snapshot;
    accept(actor, fresh);
    if (previous && fresh.actorId === actor) {
      try { localStorage.removeItem(previous.key); } catch { /* Cloud state is authoritative. */ }
    }
  })().catch(() => undefined).finally(() => { entry.pending = undefined; });
}
function watch(actor: string, notify: () => void) {
  const entry = record(actor);
  entry.subscribers.add(notify);
  if (!entry.stop) {
    const update = () => { if (document.visibilityState === 'visible') refresh(actor); };
    const interval = window.setInterval(update, 4000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    entry.stop = () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
      entry.stop = undefined;
    };
  }
  return () => {
    entry.subscribers.delete(notify);
    if (!entry.subscribers.size) entry.stop?.();
  };
}

export function useAssistantPreferences(actor: string | null, active = true) {
  const subscribe = useCallback((notify: () => void) => actor && active ? watch(actor, notify) : () => {}, [actor, active]);
  const preferences = useSyncExternalStore(
    subscribe,
    () => (actor ? records.get(actor)?.snapshot?.value : undefined) ?? defaultAssistantPreferences,
    () => defaultAssistantPreferences,
  );
  useEffect(() => { if (actor && active) refresh(actor); }, [actor, active]);
  return [preferences, async (patch: Partial<AssistantPreferences>) => {
    if (!actor) return;
    accept(actor, await api<Snapshot>(endpoint, jsonRequest('PATCH', { actorId: actor, patch })));
  }] as const;
}
