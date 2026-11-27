import { useEffect, useRef, useState } from 'react';
import { api, withRequestDeadline } from '../lib/api';
import { t } from '../i18n';

export interface AssistantConnection {
  enabled: boolean;
  state: 'unconfigured' | 'not_checked' | 'reachable' | 'unreachable' | 'catalog_denied' | 'provider_error';
  httpStatus: number | null;
  checkedAt: string | null;
  retryAfterMs: number;
  stale: boolean;
}

export function AssistantConnectionStatus({ initial }: { initial: AssistantConnection }) {
  const [value, setValue] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    if (!initial.enabled) return;
    const controller = new AbortController();
    let busy = false;
    let canCheckAt = 0;
    let timer: number | undefined;
    async function check() {
      if (controller.signal.aborted || busy || document.hidden || Date.now() < canCheckAt) return;
      busy = true;
      setChecking(true);
      let interval = 5_000;
      try {
        const current = await withRequestDeadline(controller.signal, 6_000, (signal) =>
          api<AssistantConnection>('/assistant/connection', { signal, cache: 'no-store' }));
        if (controller.signal.aborted) return;
        setValue(current);
        setFailed(false);
        interval = current.retryAfterMs;
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        busy = false;
        if (!controller.signal.aborted) {
          setChecking(false);
          canCheckAt = Date.now() + interval;
          setCooldown(interval > 0);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => setCooldown(false), interval);
        }
      }
    }
    const refresh = () => { void check(); };
    retry.current = refresh;
    refresh();
    const polling = window.setInterval(refresh, 60_000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(polling);
      window.clearTimeout(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [initial.enabled]);
  if (!initial.enabled) return null;
  const label = failed ? '暂时无法读取模型连接状态'
    : value.state === 'reachable' ? '已连接 OpenAI 模型目录'
    : value.state === 'unreachable' ? '服务器暂时连不上 OpenAI'
    : value.state === 'catalog_denied' ? 'OpenAI 已响应，当前密钥无法读取模型目录'
    : value.state === 'provider_error' ? 'OpenAI 模型目录暂时无法读取'
    : '正在检查 OpenAI 连接';
  return (
    <div className="ai-availability" data-assistant-connection={failed ? 'unknown' : value.state} role="status">
      <span>{t(checking ? '正在检查 OpenAI 连接' : label)}</span>
      {(failed || ['unreachable', 'catalog_denied', 'provider_error'].includes(value.state)) &&
        <button type="button" disabled={checking || cooldown} onClick={() => retry.current()}>{t('重试连接')}</button>}
    </div>
  );
}
