import { useEffect, useState } from 'react';
import { Copy, LinkSimple, Trash, X, Check, Globe, LockSimple } from '@phosphor-icons/react';
import { t } from '../i18n';
import { api, errorMessage, jsonRequest } from '../lib/api';
import './share-dialog.css';

type Access = { userId: string; name: string; role: string; access: 'edit' | 'comment' | 'view'; you: boolean };
type Link = {
  id: string;
  allowDownload: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdBy: string | null;
};
type Sharing = { canManage: boolean; linksAllowed: boolean; role: string; access: Access[]; links: Link[] };

const accessLabel = { edit: '可编辑', comment: '可评论', view: '可查看' } as const;
const roleLabel: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '编辑者',
  reviewer: '评论者',
  viewer: '查看者',
};
const expiryOptions = [
  [7, '7 天后失效'],
  [1, '1 天后失效'],
  [30, '30 天后失效'],
  [90, '90 天后失效'],
  [null, '长期有效'],
] as const;

export const sharedDocumentUrl = (token: string) =>
  `${location.origin}${location.pathname}#/shared/${encodeURIComponent(token)}`;

/**
 * Share dialog modelled on Google Docs: who already has access (from space roles)
 * and read-only links with expiry, download permission and revocation. The token
 * is shown once after creation; later only its metadata is listed.
 */
export function ShareDialog({ documentId, title, onClose }: { documentId: string; title: string; onClose: () => void }) {
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expires, setExpires] = useState<number | null>(7);
  const [allowDownload, setAllowDownload] = useState(false);
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const load = async () => {
    try {
      setSharing(await api<Sharing>(`/documents/${documentId}/sharing`));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);
  async function create() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ link: Link; token: string }>(
        `/documents/${documentId}/share-links`,
        jsonRequest('POST', { expiresInDays: expires, allowDownload }),
      );
      setFresh({ id: result.link.id, url: sharedDocumentUrl(result.token) });
      setCopied(false);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    try {
      await api(`/documents/${documentId}/share-links/${id}`, jsonRequest('DELETE'));
      if (fresh?.id === id) setFresh(null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError(t('浏览器未允许复制，请手动选择链接。'));
    }
  }
  const format = (value: string) => new Date(value).toLocaleString();
  const active = sharing?.links.filter((l) => !l.revokedAt && (!l.expiresAt || new Date(l.expiresAt) > new Date())) ?? [];
  return (
    <div className="share-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="share-dialog" role="dialog" aria-modal="true" aria-label={t('分享“{v0}”', { v0: title })}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header>
          <h2>{t('分享“{v0}”', { v0: title })}</h2>
          <button type="button" className="share-close" aria-label={t('关闭')} onClick={onClose} autoFocus>
            <X size={18} />
          </button>
        </header>
        {!sharing && !error && <p className="share-muted">{t('读取中')}</p>}
        {sharing && (
          <>
            <section aria-label={t('有权访问的成员')}>
              <h3>{t('有权访问的成员')}</h3>
              <ul className="share-people">
                {sharing.access.map((person) => (
                  <li key={person.userId}>
                    <span className="share-avatar" aria-hidden>{Array.from(person.name)[0] ?? '?'}</span>
                    <span className="share-name">
                      {person.name}
                      {person.you && <small>{t('（你）')}</small>}
                      <small>{t(roleLabel[person.role] ?? person.role)}</small>
                    </span>
                    <span className={'share-access share-' + person.access}>{t(accessLabel[person.access])}</span>
                  </li>
                ))}
              </ul>
              <p className="share-muted">{t('成员权限跟随空间角色，在团队设置中调整。')}</p>
            </section>
            <section aria-label={t('链接分享')}>
              <h3>{t('链接分享')}</h3>
              {!sharing.linksAllowed ? (
                <p className="share-note">
                  <LockSimple size={16} aria-hidden />
                  {t('空间策略尚未允许文档链接分享。所有者或管理员可在团队设置中开启。')}
                </p>
              ) : !sharing.canManage ? (
                <p className="share-note">
                  <LockSimple size={16} aria-hidden />
                  {t('只有编辑者可以创建或停用分享链接。')}
                </p>
              ) : (
                <>
                  <div className="share-create">
                    <Globe size={18} aria-hidden />
                    <div>
                      <strong>{t('任何拿到链接的人都可以查看')}</strong>
                      <span className="share-muted">{t('只读，不能编辑、评论或看到项目其他内容。')}</span>
                    </div>
                  </div>
                  <div className="share-options">
                    <select aria-label={t('链接有效期')} value={expires ?? ''}
                      onChange={(e) => setExpires(e.target.value === '' ? null : Number(e.target.value))}>
                      {expiryOptions.map(([value, label]) => (
                        <option key={label} value={value ?? ''}>{t(label)}</option>
                      ))}
                    </select>
                    <label className="share-check">
                      <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
                      {t('允许下载文件')}
                    </label>
                    <button type="button" className="button button-primary" disabled={busy} onClick={() => void create()}>
                      <LinkSimple size={16} aria-hidden />
                      {t('创建链接')}
                    </button>
                  </div>
                  {fresh && (
                    <div className="share-fresh" role="status">
                      <input readOnly aria-label={t('分享链接')} value={fresh.url} onFocus={(e) => e.currentTarget.select()} />
                      <button type="button" className="button button-secondary" onClick={() => void copy(fresh.url)}>
                        {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                        {t(copied ? '已复制' : '复制链接')}
                      </button>
                      <small>{t('链接只显示这一次，请现在复制保存。')}</small>
                    </div>
                  )}
                  {active.length > 0 && (
                    <ul className="share-links" aria-label={t('有效链接')}>
                      {active.map((link) => (
                        <li key={link.id}>
                          <span>
                            {link.expiresAt ? t('{v0} 失效', { v0: format(link.expiresAt) }) : t('长期有效')}
                            {' · '}
                            {t(link.allowDownload ? '可下载' : '仅查看')}
                            {' · '}
                            {t('{v0} 次打开', { v0: link.viewCount })}
                          </span>
                          <small>{t('{v0} 于 {v1} 创建', { v0: link.createdBy ?? '', v1: format(link.createdAt) })}</small>
                          <button type="button" className="share-revoke" disabled={busy} onClick={() => void revoke(link.id)}
                            aria-label={t('停用此链接')} title={t('停用此链接')}>
                            <Trash size={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          </>
        )}
        {error && <p role="alert" className="share-error">{t(error)}</p>}
      </div>
    </div>
  );
}
