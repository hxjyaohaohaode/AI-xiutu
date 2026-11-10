import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate } from '../lib/api';
import type { MemberActivity } from '@ai-xiutu/contracts';
import { Busy, InlineError } from '../components/Ui';
type Activity = MemberActivity;
const kindLabels: Record<string, string> = {
  'role-changed': '变更角色',
  'owner-transferred': '移交所有权',
  'member.joined': '加入团队',
  'member.removed': '移除成员',
  'member.left': '离开团队',
  'member.role_changed': '变更角色',
  'owner.transferred': '移交所有权',
  joined: '加入团队',
  removed: '移除成员',
  left: '离开团队',
  role_changed: '变更角色',
  owner_transferred: '移交所有权',
};
export function TeamActivity({
  spaceId,
  refreshToken = 0,
}: {
  spaceId: string;
  refreshToken?: number;
}) {
  const [items, setItems] = useState<Activity[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const generation = useRef(0),
    moreLock = useRef(false);
  useEffect(() => {
    const id = ++generation.current,
      controller = new AbortController();
    setBusy(true);
    setItems([]);
    setCursor(null);
    setError(null);
    moreLock.current = false;
    api<{ activities: Activity[]; nextCursor: string | null }>(
      `/spaces/${spaceId}/activity?limit=30`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (id === generation.current) {
          setItems(result.activities);
          setCursor(result.nextCursor);
        }
      })
      .catch((e) => {
        if (id === generation.current && e.name !== 'AbortError') setError(errorMessage(e));
      })
      .finally(() => {
        if (id === generation.current) setBusy(false);
      });
    return () => controller.abort();
  }, [spaceId, refreshToken]);
  async function more() {
    if (!cursor || moreLock.current) return;
    moreLock.current = true;
    const id = generation.current;
    setBusy(true);
    try {
      const result = await api<{ activities: Activity[]; nextCursor: string | null }>(
        `/spaces/${spaceId}/activity?limit=30&cursor=${encodeURIComponent(cursor)}`,
      );
      if (id === generation.current) {
        setItems((old) => [
          ...old,
          ...result.activities.filter((n) => !old.some((p) => p.id === n.id)),
        ]);
        setCursor(result.nextCursor);
      }
    } catch (e) {
      if (id === generation.current) setError(errorMessage(e));
    } finally {
      if (id === generation.current) {
        moreLock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="team-activity" aria-label="成员动态" data-motion="team-activity">
      <InlineError message={error} />
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.actorName ?? '系统'}</strong>
              <span>{kindLabels[item.kind] ?? item.kind}</span>
              {item.targetName && <span>{item.targetName}</span>}
            </div>
            {(item.previousRole || item.role) && (
              <small>
                {item.previousRole ?? '—'} → {item.role ?? '—'}
              </small>
            )}
            <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
          </li>
        ))}
      </ol>
      {busy && <Busy label="读取成员动态" />}
      {!busy && !items.length && !error && <p className="quiet-copy">当前没有可显示的成员动态。</p>}
      {cursor && (
        <button className="button button-secondary" disabled={busy} onClick={() => void more()}>
          更多动态
        </button>
      )}
    </section>
  );
}
