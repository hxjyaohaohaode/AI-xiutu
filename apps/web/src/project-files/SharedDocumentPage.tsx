import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CaretLeft,
  CaretRight,
  Check,
  CornersOut,
  DownloadSimple,
  Eye,
  FileDoc,
  FilePpt,
  FileXls,
  LinkSimple,
  ListBullets,
  LockSimple,
  X,
} from '@phosphor-icons/react';
import {
  isPresentationBody,
  readPresentation,
  type DocumentFormat,
  type PresentationDoc,
} from '@ai-xiutu/contracts';
import { readProjectSheet } from '@ai-xiutu/contracts/office-data';
import { t, useLocale } from '../i18n';
import { RichDocumentEditor } from './RichDocumentEditor';
import { SlideContent, slidePosition } from './PresentationEditor';
import { ProjectSheetEditor } from './ProjectSheetEditor';
import { OfficeAssetUrl } from './office-asset-url';
import { blockStyleOf } from './rich-commands';
import './shared-document.css';

type Shared = {
  document: { title: string; body: string; formatting?: DocumentFormat | null; version: number; updatedAt: string };
  allowDownload: boolean;
  expiresAt: string | null;
};

/** Read-only slide viewer: stage, thumbnail rail, keyboard navigation and full-screen presenting. */
function SlideViewer({ deck }: { deck: PresentationDoc }) {
  const [page, setPage] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const last = deck.slides.length - 1;
  const go = useCallback((n: number) => setPage((p) => Math.max(0, Math.min(last, typeof n === 'number' ? n : p))), [last]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) setPage((p) => Math.min(last, p + 1));
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) setPage((p) => Math.max(0, p - 1));
      else if (e.key === 'Home') setPage(0);
      else if (e.key === 'End') setPage(last);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [last]);
  useEffect(() => {
    const exit = () => setPresenting(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', exit);
    return () => document.removeEventListener('fullscreenchange', exit);
  }, []);
  const slide = deck.slides[page]!;
  const render = (index: number, className: string) => {
    const s = deck.slides[index]!;
    return (
      <div className={'slide-canvas ' + className} style={{ backgroundColor: s.background }}>
        {s.elements.map((element) => (
          <div className="slide-object" key={element.id} style={slidePosition(element)}>
            <SlideContent element={element} />
          </div>
        ))}
      </div>
    );
  };
  return (
    <div className="sv">
      <div className="sv-main">
        <div ref={stage} className={'sv-stage' + (presenting ? ' sv-presenting' : '')} onClick={() => presenting && go(page + 1)}>
          {render(page, 'sv-slide')}
          {presenting && (
            <span className="sv-counter" aria-live="polite">
              {page + 1} / {deck.slides.length}
            </span>
          )}
        </div>
        <div className="sv-bar">
          <button type="button" onClick={() => go(page - 1)} disabled={page === 0} aria-label={t('上一页')}>
            <CaretLeft size={18} />
          </button>
          <span aria-live="polite">
            {page + 1} / {deck.slides.length} · {slide.name}
          </span>
          <button type="button" onClick={() => go(page + 1)} disabled={page === last} aria-label={t('下一页')}>
            <CaretRight size={18} />
          </button>
          <button
            type="button"
            className="sv-present"
            onClick={() => void stage.current?.requestFullscreen?.().then(() => setPresenting(true)).catch(() => {})}
          >
            <CornersOut size={16} aria-hidden />
            {t('全屏演示')}
          </button>
        </div>
      </div>
      <nav className="sv-rail" aria-label={t('幻灯片列表')}>
        {deck.slides.map((s, i) => (
          <button key={s.id} type="button" aria-current={i === page ? 'page' : undefined} onClick={() => go(i)} aria-label={`${i + 1} · ${s.name}`}>
            <span className="sv-index">{i + 1}</span>
            {render(i, 'sv-thumb')}
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * Public, read-only viewer for a document share link. Runs outside the signed-in
 * workspace: no session cookie is sent, nothing can be edited, and embedded
 * images load through the link-scoped route. Downloads appear only when allowed.
 */
export function SharedDocumentPage({ token }: { token: string }) {
  useLocale();
  const [state, setState] = useState<{ shared?: Shared; error?: string }>({});
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(() => window.innerWidth > 1100);
  const [progress, setProgress] = useState(0);
  const [activeHeading, setActiveHeading] = useState(0);
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/v1/shared/documents/${encodeURIComponent(token)}`, { credentials: 'omit', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 429 ? 'RATE' : 'GONE');
        setState({ shared: (await response.json()) as Shared });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error: error instanceof Error && error.message === 'RATE' ? 'rate' : 'gone' });
      });
    return () => controller.abort();
  }, [token]);
  const doc = state.shared?.document;
  useEffect(() => {
    if (doc) document.title = doc.title;
  }, [doc]);
  const assetUrl = useMemo(() => (assetId: string) => `/v1/shared/documents/${encodeURIComponent(token)}/assets/${assetId}`, [token]);
  const kind = !doc ? null : isPresentationBody(doc.body) ? 'pptx' : readProjectSheet(doc.body) ? 'xlsx' : 'docx';
  const headings = useMemo(
    () =>
      kind === 'docx' && doc
        ? doc.body.split('\n').flatMap((line) => {
            const block = blockStyleOf(line);
            return block.style === 'h1' || block.style === 'h2' || block.style === 'h3'
              ? [{ level: Number(block.style[1]), text: line.slice(block.prefix.length).trim() }]
              : [];
          }).filter((h) => h.text)
        : [],
    [doc, kind],
  );
  // Reading progress and the heading currently in view.
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      const nodes = article.current?.querySelectorAll<HTMLElement>('.doc-h1, .doc-h2, .doc-h3') ?? [];
      let current = 0;
      nodes.forEach((node, i) => {
        if (node.getBoundingClientRect().top < 140) current = i;
      });
      setActiveHeading(current);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [doc]);
  function jump(index: number) {
    const node = article.current?.querySelectorAll<HTMLElement>('.doc-h1, .doc-h2, .doc-h3')[index];
    node?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if (window.innerWidth <= 1100) setOutlineOpen(false);
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard denied: the address bar still holds the link. */
    }
  }
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
      <main className="sp sp-empty">
        <div className="sp-empty-card">
          <span className="sp-empty-icon" aria-hidden>
            <LockSimple size={30} weight="duotone" />
          </span>
          <h1>{t(state.error === 'rate' ? '打开次数过多，请稍后再试' : '链接无效或已失效')}</h1>
          <p>{t(state.error === 'rate' ? '为保护分享内容，短时间内的访问次数有限制。' : '链接可能已被停用、已过期，或分享者关闭了链接分享。请向分享者索取新的链接。')}</p>
        </div>
      </main>
    );
  if (!doc)
    return (
      <main className="sp sp-empty" aria-busy="true">
        <div className="sp-skeleton" role="status" aria-label={t('读取中')}>
          <i />
          <i />
          <i />
          <i />
        </div>
      </main>
    );
  const presentation = kind === 'pptx' ? readPresentation(doc.body) : null;
  const sheet = kind === 'xlsx' ? readProjectSheet(doc.body) : null;
  const KindIcon = kind === 'pptx' ? FilePpt : kind === 'xlsx' ? FileXls : FileDoc;
  const updated = new Date(doc.updatedAt).toLocaleString();
  return (
    <OfficeAssetUrl.Provider value={assetUrl}>
      <div className="sp">
        <header className="sp-bar">
          <div className="sp-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />
          <span className={'sp-kind sp-kind-' + kind} aria-hidden>
            <KindIcon size={18} weight="duotone" />
          </span>
          <div className="sp-heading">
            <h1>{doc.title}</h1>
            <p>
              <span className="sp-pill">
                <Eye size={13} aria-hidden />
                {t('只读')}
              </span>
              <span>{t('更新于 {v0}', { v0: updated })}</span>
            </p>
          </div>
          <div className="sp-actions">
            {headings.length > 1 && (
              <button type="button" className="sp-icon" aria-pressed={outlineOpen} aria-label={t('文档大纲')} title={t('文档大纲')} onClick={() => setOutlineOpen(!outlineOpen)}>
                <ListBullets size={18} />
              </button>
            )}
            <button type="button" className="sp-button" aria-label={t(copied ? '已复制' : '复制链接')} onClick={() => void copyLink()}>
              {copied ? <Check size={16} aria-hidden /> : <LinkSimple size={16} aria-hidden />}
              <span>{t(copied ? '已复制' : '复制链接')}</span>
            </button>
            {state.shared!.allowDownload && (
              <button type="button" className="sp-button sp-primary" aria-label={t('下载 {v0}', { v0: kind!.toUpperCase() })} disabled={downloading} onClick={() => void download()}>
                <DownloadSimple size={16} aria-hidden />
                <span>{t('下载 {v0}', { v0: kind!.toUpperCase() })}</span>
              </button>
            )}
          </div>
        </header>
        {downloadError && <p role="alert" className="sp-error">{t(downloadError)}</p>}
        <div className={'sp-layout' + (outlineOpen && headings.length > 1 ? ' sp-with-outline' : '')}>
          {outlineOpen && headings.length > 1 && (
            <nav className="sp-outline" aria-label={t('文档大纲')}>
              <div className="sp-outline-head">
                <span>{t('目录')}</span>
                <button type="button" className="sp-icon sp-outline-close" aria-label={t('关闭')} onClick={() => setOutlineOpen(false)}>
                  <X size={16} />
                </button>
              </div>
              <ol>
                {headings.map((h, i) => (
                  <li key={i} data-level={h.level} aria-current={i === activeHeading ? 'location' : undefined}>
                    <button type="button" onClick={() => jump(i)}>{h.text}</button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <main ref={article} className={'sp-content studio-view documents-view sp-' + kind}>
            {presentation ? (
              <SlideViewer deck={presentation} />
            ) : sheet ? (
              <div className="sp-sheet">
                <ProjectSheetEditor sheet={sheet} title={doc.title} readOnly onChange={() => false} onSource={() => {}}
                  chart={doc.formatting?.layout?.chart ?? 'bar'} onChart={() => false} />
              </div>
            ) : (
              <RichDocumentEditor body={doc.body} formatting={doc.formatting} readOnly onChange={() => false} assetUrl={assetUrl} />
            )}
          </main>
        </div>
        <footer className="sp-footer">
          <LockSimple size={13} aria-hidden />
          <span>{t('只读分享：访问者无法编辑，也看不到项目中的其他内容。')}</span>
          {state.shared!.expiresAt && <span>{t('链接 {v0} 失效', { v0: new Date(state.shared!.expiresAt).toLocaleString() })}</span>}
        </footer>
      </div>
    </OfficeAssetUrl.Provider>
  );
}
