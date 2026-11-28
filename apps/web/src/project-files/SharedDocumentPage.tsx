import { useEffect, useMemo, useState } from 'react';
import { DownloadSimple, Eye, LockSimple } from '@phosphor-icons/react';
import { isPresentationBody, readPresentation, type DocumentFormat } from '@ai-xiutu/contracts';
import { readProjectSheet } from '@ai-xiutu/contracts/office-data';
import { t, useLocale } from '../i18n';
import { RichDocumentEditor } from './RichDocumentEditor';
import { PresentationEditor } from './PresentationEditor';
import { ProjectSheetEditor } from './ProjectSheetEditor';
import { OfficeAssetUrl } from './office-asset-url';
import './shared-document.css';

type Shared = {
  document: { title: string; body: string; formatting?: DocumentFormat | null; version: number; updatedAt: string };
  allowDownload: boolean;
  expiresAt: string | null;
};

/**
 * Public, read-only viewer for a document share link. Runs outside the signed-in
 * workspace: no session cookie is sent, nothing can be edited, and embedded
 * images load through the link-scoped route. Downloads are offered only when the
 * link allows them.
 */
export function SharedDocumentPage({ token }: { token: string }) {
  useLocale();
  const [state, setState] = useState<{ shared?: Shared; error?: string }>({});
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/v1/shared/documents/${encodeURIComponent(token)}`, { credentials: 'omit', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 429 ? 'RATE' : 'GONE');
        setState({ shared: (await response.json()) as Shared });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ error: error instanceof Error && error.message === 'RATE' ? 'rate' : 'gone' });
      });
    return () => controller.abort();
  }, [token]);
  const doc = state.shared?.document;
  useEffect(() => {
    if (doc) document.title = doc.title;
  }, [doc]);
  const assetUrl = useMemo(
    () => (assetId: string) => `/v1/shared/documents/${encodeURIComponent(token)}/assets/${assetId}`,
    [token],
  );
  const kind = !doc ? null : isPresentationBody(doc.body) ? 'pptx' : readProjectSheet(doc.body) ? 'xlsx' : 'docx';
  async function download() {
    if (!doc || !kind) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const [{ exportContent }, { setOfficePictureSource }] = await Promise.all([import('./export'), import('./office-images')]);
      setOfficePictureSource(assetUrl);
      const blob = await exportContent(kind, doc.title, doc.body, undefined, doc.formatting ?? null);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${doc.title}.${kind}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(false);
    }
  }
  if (state.error)
    return (
      <main className="shared-page shared-empty">
        <LockSimple size={36} aria-hidden />
        <h1>{t(state.error === 'rate' ? '打开次数过多，请稍后再试' : '链接无效或已失效')}</h1>
        <p>{t('请向分享者索取新的链接。')}</p>
      </main>
    );
  if (!doc)
    return (
      <main className="shared-page shared-empty" aria-busy="true">
        <p role="status">{t('读取中')}</p>
      </main>
    );
  const presentation = kind === 'pptx' ? readPresentation(doc.body) : null;
  const sheet = kind === 'xlsx' ? readProjectSheet(doc.body) : null;
  return (
    <OfficeAssetUrl.Provider value={assetUrl}>
      <main className="shared-page">
        <header className="shared-header">
          <div>
            <h1>{doc.title}</h1>
            <p>
              <span className="shared-badge">
                <Eye size={14} aria-hidden />
                {t('只读')}
              </span>
              {t('更新于 {v0}', { v0: new Date(doc.updatedAt).toLocaleString() })}
              {state.shared!.expiresAt && ' · ' + t('链接 {v0} 失效', { v0: new Date(state.shared!.expiresAt).toLocaleString() })}
            </p>
          </div>
          {state.shared!.allowDownload && (
            <button type="button" className="shared-download" disabled={downloading} onClick={() => void download()}>
              <DownloadSimple size={16} aria-hidden />
              {t('下载 {v0}', { v0: kind!.toUpperCase() })}
            </button>
          )}
        </header>
        {downloadError && <p role="alert" className="shared-error">{t(downloadError)}</p>}
        <article className="shared-body studio-view documents-view">
          {presentation ? (
            <PresentationEditor document={presentation} projectId="" sources={[]} readOnly onChange={() => false} />
          ) : sheet ? (
            <ProjectSheetEditor
              sheet={sheet}
              title={doc.title}
              readOnly
              onChange={() => false}
              onSource={() => {}}
              chart={doc.formatting?.layout?.chart ?? 'bar'}
              onChart={() => false}
            />
          ) : (
            <RichDocumentEditor body={doc.body} formatting={doc.formatting} readOnly onChange={() => false} assetUrl={assetUrl} />
          )}
        </article>
      </main>
    </OfficeAssetUrl.Provider>
  );
}
