
import { useEffect, useState } from 'react';
import { ArrowRight, Images, Trash } from '@phosphor-icons/react';
import { api, errorMessage } from '../lib/api';
import type { Artwork } from '../lib/types';
import { t } from '../i18n';
import { InlineError } from '../components/Ui';
import { AssetThumbnail } from './AssetThumbnail';

type Card = Artwork & { width: number; height: number; projectTitle: string; projectRole: string };
type Page = { items: Card[]; nextCursor: string | null };
const empty: Page = { items: [], nextCursor: null };

export function SavedWorks({
  active, spaceId, projectId, actorId, query, refreshToken, withdrawn,
  onOpen, onTrash, deleting,
}: {
  active: boolean; spaceId?: string; projectId?: string; actorId: string | null;
  query: string; refreshToken: number; withdrawn: ReadonlySet<string>;
  onOpen: (work: Artwork) => void; onTrash: (work: Artwork) => void; deleting: boolean;
}) {
  const params = new URLSearchParams(projectId ? { projectId } : spaceId ? { spaceId } : {});
  if (query.trim()) params.set('query', query.trim().slice(0, 100));
  const endpoint = spaceId || projectId ? '/artworks?' + params : null;
  const key = JSON.stringify([actorId, endpoint, refreshToken]);
  const [result, setResult] = useState<{ key: string; page: Page } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState<{ key: string; value: string } | null>(null);
  const [settled, setSettled] = useState('');
  const next = cursor?.key === key ? cursor.value : null;
  const request = JSON.stringify([key, next, attempt]);
  const page = result?.key === key ? result.page : empty;
  useEffect(() => {
    if (!active || !endpoint || !actorId) return;
    const controller = new AbortController();
    api<Page>(endpoint + (next ? '&cursor=' + encodeURIComponent(next) : ''), { signal: controller.signal }).then(
      (value) => {
        if (controller.signal.aborted) return;
        setResult((old) => ({ key, page: next && old?.key === key
          ? { items: [...old.page.items, ...value.items.filter((item) => !old.page.items.some((prior) => item.id === prior.id))], nextCursor: value.nextCursor }
          : value }));
        setError(null);
      },
      (failure) => { if (!controller.signal.aborted) setError({ key: request, message: errorMessage(failure) }); },
    ).finally(() => { if (!controller.signal.aborted) setSettled(request); });
    return () => controller.abort();
  }, [active, endpoint, actorId, request]);
  const cards = page.items.filter((item) => !withdrawn.has(item.id));
  if (!active || !endpoint || !actorId) return null;
  return (
    <section className="library-saved-works" aria-label={t('已保存作品')} aria-busy={settled !== request}>
      {error?.key === request && <>
        <InlineError message={error.message} />
        <button className="text-button" type="button" onClick={() => setAttempt((n) => n + 1)}>{t('重试')}</button>
      </>}
      {!cards.length && settled === request && error?.key !== request &&
        <p className="saved-works-empty"><Images size={22} /> {t(query.trim()
          ? '没有符合搜索条件的作品' : '还没有已保存的作品。编辑照片后保存，即可在其他设备查看。')}</p>}
      <ul className="saved-works-grid">
        {cards.map((work) => <li key={work.id} data-artwork-id={work.id}>
          <button className="saved-work-open" type="button" onClick={() => onOpen(work)}>
            <AssetThumbnail src={'/v1/assets/' + work.assetId + '/thumbnail'} />
            <span><strong>{work.title}</strong><small>{work.projectTitle} · V{work.headVersion}</small></span>
          </button>
          {['owner', 'admin', 'editor'].includes(work.projectRole) && <button type="button"
            className="icon-button saved-work-trash" disabled={deleting}
            aria-label={t('删除作品') + ' · ' + work.title} title={t('移入回收站')}
            onClick={() => onTrash(work)}><Trash size={16} /></button>}
        </li>)}
      </ul>
      {page.nextCursor && <button className="text-button" type="button" disabled={settled !== request}
        onClick={() => setCursor({ key, value: page.nextCursor! })}>
        {t('载入更多')} <ArrowRight size={15} />
      </button>}
    </section>
  );
}
