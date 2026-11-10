import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';

/** Read-only side cards never retain a previous account/space's value while the next request loads. */
export function useUsageResource<T>(path: string | null, identity: string, refresh: string) {
  const key = JSON.stringify([identity, path, refresh]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    loading: boolean;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setSnapshot({ key, data: null, error: null, loading: !!path });
    if (path)
      api<T>(path, { signal: controller.signal })
        .then((data) => {
          if (current) setSnapshot({ key, data, error: null, loading: false });
        })
        .catch((error: unknown) => {
          if (current && !controller.signal.aborted)
            setSnapshot({ key, data: null, error: errorMessage(error), loading: false });
        });
    return () => {
      current = false;
      controller.abort();
    };
  }, [key, path]);
  return snapshot?.key === key ? snapshot : { key, data: null, error: null, loading: !!path };
}
