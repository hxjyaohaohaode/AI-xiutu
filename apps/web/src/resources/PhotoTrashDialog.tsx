import { useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, Trash } from '@phosphor-icons/react';
import type { PhotoTrashEntry, PhotoTrashPage } from '@ai-xiutu/contracts';
import { ApiError, api, errorMessage, formatDate, jsonRequest } from '../lib/api';
import { t } from '../i18n';
import { Busy, EmptyState, InlineError, Modal } from '../components/Ui';
import { useConfirmation } from '../components/ConfirmationDialog';
import { AssetThumbnail } from './AssetThumbnail';
import { removeLocalPhoto, listLocalPhotoTrash, type LocalPhotoTrashEntry } from './localPhotoTrash';

type TrashRow =
  | { kind: 'local'; id: string; expiresAt: number; photo: LocalPhotoTrashEntry }
  | { kind: 'cloud'; id: string; expiresAt: number; photo: PhotoTrashEntry };

export function PhotoTrashDialog({
  owner, actorId, onClose, onCloudRestored, onCloudPurged, onLocalRestore, refreshToken,
}: {
  owner: string;
  actorId: string | null;
  onClose: () => void;
  onCloudRestored: (photo: PhotoTrashEntry) => void;
  onCloudPurged?: () => void;
  onLocalRestore: (photo: LocalPhotoTrashEntry) => Promise<boolean>;
  refreshToken: number;
}) {
  const confirmation = useConfirmation();
  const [local, setLocal] = useState<LocalPhotoTrashEntry[]>([]);
  const [cloud, setCloud] = useState<PhotoTrashPage>({ items: [], nextCursor: null });
  const [localError, setLocalError] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const active = useRef(false);
  const restoring = useRef(false);
  const readingMore = useRef<AbortController | null>(null);
  const current = useRef(0);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      readingMore.current?.abort();
    };
  }, []);
  useEffect(() => {
    const sequence = ++current.current;
    const controller = new AbortController();
    readingMore.current?.abort();
    setLoadingMore(false);
    setLoading(true);
    setLocalError(null);
    setCloudError(null);
    const readCloud = actorId
      ? api<PhotoTrashPage>('/photo-trash', { signal: controller.signal })
      : Promise.resolve({ items: [], nextCursor: null });
    void Promise.allSettled([listLocalPhotoTrash(owner), readCloud]).then(([device, server]) => {
      if (controller.signal.aborted || sequence !== current.current) return;
      if (device.status === 'fulfilled') setLocal(device.value);
      else setLocalError(t('无法读取本机回收站，请重试。'));
      if (server.status === 'fulfilled') setCloud(server.value);
      else {
        setCloudError(errorMessage(server.reason));
        if (server.reason instanceof ApiError && [401, 403].includes(server.reason.status))
          setCloud({ items: [], nextCursor: null });
      }
      setLoading(false);
    });
    return () => controller.abort();
  }, [actorId, owner, reload, refreshToken]);

  const rows: TrashRow[] = [
    ...cloud.items.map((photo): TrashRow => ({
      kind: 'cloud', id: photo.token, expiresAt: Date.parse(photo.expiresAt), photo,
    })),
    ...local.map((photo): TrashRow => ({ kind: 'local', id: photo.id, expiresAt: photo.expiresAt, photo })),
  ].sort((a, b) => b.expiresAt - a.expiresAt);
  const nearestExpiry = Math.min(...rows.map((item) => item.expiresAt));
  useEffect(() => {
    if (!Number.isFinite(nearestExpiry)) return;
    const timer = window.setTimeout(() => {
      // Cloud restore is still enforced by the server clock. Keep the visible list current.
      const now = Date.now();
      setCloud((page) => ({ ...page, items: page.items.filter((item) => Date.parse(item.expiresAt) > now) }));
      setLocal((items) => items.filter((item) => item.expiresAt > now));
    }, Math.max(0, nearestExpiry - Date.now()) + 20);
    return () => window.clearTimeout(timer);
  }, [nearestExpiry]);

  async function loadMore() {
    if (!cloud.nextCursor || loading || readingMore.current) return;
    const sequence = current.current;
    const controller = new AbortController();
    readingMore.current = controller;
    setLoadingMore(true);
    setCloudError(null);
    try {
      const next = await api<PhotoTrashPage>(
        '/photo-trash?cursor=' + encodeURIComponent(cloud.nextCursor), { signal: controller.signal },
      );
      if (controller.signal.aborted || sequence !== current.current) return;
      setCloud((page) => {
        const known = new Set(page.items.map((photo) => photo.token));
        return { items: [...page.items, ...next.items.filter((photo) => !known.has(photo.token))], nextCursor: next.nextCursor };
      });
    } catch (error) {
      if (!controller.signal.aborted && active.current) setCloudError(errorMessage(error));
    } finally {
      if (readingMore.current === controller) {
        readingMore.current = null;
        if (active.current) setLoadingMore(false);
      }
    }
  }

  async function restore(row: TrashRow) {
    if (restoring.current) return;
    restoring.current = true;
    setPending(row.id);
    setActionError(null);
    try {
      if (row.kind === 'local') {
        if (await onLocalRestore(row.photo) && active.current)
          setLocal((items) => items.filter((item) => item.id !== row.id));
        return;
      }
      await api(
        `/photo-trash/${row.photo.kind}/${row.photo.id}/restore`,
        jsonRequest('POST', { token: row.photo.token }),
      );
      if (!active.current) return;
      setCloud((page) => ({ ...page, items: page.items.filter((item) => item.token !== row.id) }));
      onCloudRestored(row.photo);
    } catch (error) {
      if (!active.current) return;
      setActionError(errorMessage(error));
      if (error instanceof ApiError && [403, 404, 409, 410].includes(error.status))
        setReload((value) => value + 1);
    } finally {
      restoring.current = false;
      if (active.current) setPending(null);
    }
  }

  async function purge(row: TrashRow) {
    if (restoring.current) return;
    const title = row.kind === 'local' ? row.photo.file.name : row.photo.title;
    if (!(await confirmation.confirm({
      title: '永久删除',
      description: t('永久删除「{title}」后无法恢复。', { title }),
      confirmLabel: '永久删除', tone: 'danger',
    })) || !active.current || restoring.current) return;
    restoring.current = true;
    setPending(row.id);
    setActionError(null);
    try {
      if (row.kind === 'local') {
        await removeLocalPhoto(owner, row.id);
        if (active.current) setLocal((items) => items.filter((item) => item.id !== row.id));
      } else {
        await api('/photo-trash/' + row.photo.kind + '/' + row.photo.id + '?token=' + row.photo.token,
          jsonRequest('DELETE'));
        if (!active.current) return;
        setCloud((page) => ({ ...page, items: page.items.filter((item) => item.token !== row.id) }));
        onCloudPurged?.();
      }
    } catch (error) {
      if (!active.current) return;
      setActionError(errorMessage(error));
      if (error instanceof ApiError && [403, 404, 409, 410].includes(error.status)) setReload((value) => value + 1);
    } finally {
      restoring.current = false;
      if (active.current) setPending(null);
    }
  }

  return (<>
    <Modal title={t('回收站')} subtitle={t('删除后保留 48 小时，到期自动清理。')}
      profile="detail" className="photo-trash-dialog"
      onClose={onClose}>
      <InlineError message={actionError} />
      <InlineError message={localError} />
      <InlineError message={cloudError} />
      {(localError || cloudError) && (
        <button type="button" className="text-button" onClick={() => setReload((value) => value + 1)}>
          {t('重试')}
        </button>
      )}
      {loading && !rows.length ? <Busy label={t('正在读取回收站')} /> : null}
      {!loading && !rows.length && !localError && !cloudError && (
        <EmptyState icon={<Trash size={26} />} title={t('回收站为空')} />
      )}
      {!!rows.length && (
        <ul className="photo-trash-list">
          {rows.map((row) => (
            <li key={row.id}>
              {row.kind === 'local' ? <LocalThumbnail file={row.photo.file} />
                : <AssetThumbnail src={row.photo.thumbnailUrl ?? null} />}
              <div>
                <strong>{row.kind === 'local' ? row.photo.file.name : row.photo.title}</strong>
                <small>{row.kind === 'local' ? t('本机照片') : row.photo.projectTitle + ' · ' +
                  t(row.photo.kind === 'artwork' ? '作品' : '原图')}</small>
                <small>{t('{v0} 到期', { v0: formatDate(new Date(row.expiresAt).toISOString()) })}</small>
              </div>
              <div className="trash-card-actions">
                <button type="button" className="button button-secondary" disabled={!!pending}
                  onClick={() => void restore(row)}>
                  {pending === row.id ? <Busy label="" /> : <ArrowCounterClockwise size={16} aria-hidden />}
                  {t('恢复')}
                </button>
                <button type="button" className="icon-button trash-card-purge" disabled={!!pending}
                  aria-label={t('永久删除') + ' · ' + (row.kind === 'local' ? row.photo.file.name : row.photo.title)}
                  title={t('永久删除')} onClick={() => void purge(row)}><Trash size={17} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cloud.nextCursor && (
        <button type="button" className="button button-secondary" disabled={loading || loadingMore || !!pending}
          onClick={() => void loadMore()}>
          {loadingMore ? <Busy /> : t('载入更多')}
        </button>
      )}
    </Modal>
    {confirmation.dialog}
  </>);
}

function LocalThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return <AssetThumbnail src={url} />;
}
