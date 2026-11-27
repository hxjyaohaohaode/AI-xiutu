import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import { t } from '../i18n';
import { useConfirmation } from './ConfirmationDialog';

type Invitation = {
  id: string;
  role: 'admin' | 'editor' | 'reviewer' | 'viewer';
  uses: number;
  maxUses: number;
  expiresAt: string;
};
type Page = { invitations: Invitation[]; nextCursor: string | null };
const labels = {
  admin: '团队管理员',
  editor: '可以编辑作品',
  reviewer: '可以审阅',
  viewer: '仅浏览',
} as const;

export function TeamInvitations({
  spaceId,
  refresh,
  onRevoke,
}: {
  spaceId: string;
  refresh: number;
  onRevoke: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Invitation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirmation = useConfirmation();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setCursor(null);
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    if (!cursor) setItems([]);
    void api<Page>(`/spaces/${spaceId}/invitations${cursor ? '?cursor=' + cursor : ''}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems((old) =>
          cursor
            ? [...old, ...page.invitations.filter((row) => !old.some((o) => o.id === row.id))]
            : page.invitations,
        );
        setNext(page.nextCursor);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [spaceId, cursor, refresh, reload, open]);

  async function revoke(row: Invitation) {
    if (
      !(await confirmation.confirm({
        title: t('撤销团队邀请'),
        description: t('撤销后，这个邀请码将立即失效。'),
        confirmLabel: t('撤销'),
      }))
    )
      return;
    if (!mounted.current) return;
    setBusy(true);
    setError('');
    try {
      await api(`/spaces/${spaceId}/invitations/${row.id}`, jsonRequest('DELETE'));
      if (mounted.current) {
        setCursor(null);
        setReload((n) => n + 1);
        onRevoke(row.id);
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div>
      <button
        className="text-button"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setCursor(null);
          setOpen(!open);
        }}
      >
        {t('有效邀请')}
      </button>
      {open && (
        <div aria-busy={loading}>
          {items.map((row) => (
            <div key={row.id} className="invite-actions">
              <span>
                {t(labels[row.role])} · {row.uses}/{row.maxUses} · {formatDate(row.expiresAt)}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void revoke(row)}
              >
                {t('撤销')}
              </button>
            </div>
          ))}
          {loading && <span role="status">{t('正在读取')}</span>}
          {!loading && !error && !items.length && <span>{t('暂无有效邀请')}</span>}
          {error && (
            <div role="alert">
              {error}{' '}
              <button className="text-button" type="button" onClick={() => setReload((n) => n + 1)}>
                {t('重试')}
              </button>
            </div>
          )}
          {!loading && next && !error && (
            <button className="text-button" type="button" onClick={() => setCursor(next)}>
              {t('加载更多')}
            </button>
          )}
        </div>
      )}
      {confirmation.dialog}
    </div>
  );
}
