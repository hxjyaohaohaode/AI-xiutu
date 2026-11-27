import { useEffect, useRef, useState } from 'react';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { Busy, InlineError, Modal } from '../components/Ui';
import { projectDocumentsFromResponse } from '../account/document-drafts';
import { t } from '../i18n';
import { api, errorMessage, formatDate } from '../lib/api';
import type { ProjectDocument } from '../lib/types';
import { ExportContent } from './ExportContent';

type VersionSummary = {
  version: number;
  title: string;
  createdAt: string;
  authorName: string;
};

export function DocumentHistory({
  document,
  canRestore,
  onDraft,
}: {
  document: ProjectDocument;
  canRestore: boolean;
  onDraft: (snapshot: ProjectDocument) => boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="text-button document-history-button" onClick={() => setOpen(true)}>
        <ClockCounterClockwise size={17} aria-hidden />
        {t('版本历史')}
      </button>
      {open && (
        <DocumentHistoryDialog
          document={document}
          canRestore={canRestore}
          onDraft={onDraft}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DocumentHistoryDialog({
  document,
  canRestore,
  onDraft,
  onClose,
}: {
  document: ProjectDocument;
  canRestore: boolean;
  onDraft: (snapshot: ProjectDocument) => boolean;
  onClose: () => void;
}) {
  const route = '/documents/' + document.id + '/versions';
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ProjectDocument | null>(null);
  const [reading, setReading] = useState(false);
  const previewRequest = useRef<AbortController | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api<{ versions: VersionSummary[]; nextBeforeVersion: number | null }>(
      route + (before === null ? '' : '?beforeVersion=' + before),
      { signal: controller.signal, cache: 'no-store' },
    ).then(page => {
      if (controller.signal.aborted) return;
      setVersions(items => before === null ? page.versions : [
        ...items, ...page.versions.filter(item => !items.some(old => old.version === item.version)),
      ]);
      setNext(page.nextBeforeVersion);
    }).catch(error => {
      if (!controller.signal.aborted) setError(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [route, before, refresh]);

  useEffect(() => () => previewRequest.current?.abort(), []);

  async function preview(version: number) {
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setReading(true);
    setError('');
    setSelected(null);
    try {
      const result = await api<{ document: unknown }>(route + '/' + version, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (controller.signal.aborted) return;
      const [snapshot] = projectDocumentsFromResponse({ documents: [result.document] });
      if (snapshot?.id !== document.id || snapshot.version !== version)
        throw new Error('该版本暂时无法读取。');
      setSelected(snapshot);
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setReading(false);
    }
  }

  return (
    <Modal title={t('版本历史')} subtitle={document.title} wide onClose={onClose}>
      <div className="document-history">
        <div className="document-history-list" aria-label={t('版本历史')}>
          {versions.map(version => (
            <button
              className="document-row"
              type="button"
              key={version.version}
              aria-pressed={selected?.version === version.version}
              onClick={() => void preview(version.version)}
            >
              <span>
                {t('版本 {v0}', { v0: version.version })} · {version.title}
                <small>{version.authorName} · {formatDate(version.createdAt)}</small>
              </span>
            </button>
          ))}
          {loading && <Busy label={t('读取中')} />}
          {!loading && next !== null && (
            <button type="button" className="text-button" onClick={() => setBefore(next)}>
              {t('加载更多')}
            </button>
          )}
          {!loading && error && (
            <button type="button" className="text-button" onClick={() => setRefresh(value => value + 1)}>
              {t('重试')}
            </button>
          )}
        </div>
        <div className="document-history-preview">
          {!reading && !selected && <p>{t('选择一个版本查看正文与导出选项。')}</p>}
          {reading && <Busy label={t('读取中')} />}
          {selected && (
            <>
              <h3>{selected.title}</h3>
              <pre tabIndex={0}>{selected.body}</pre>
              <div className="document-history-actions">
                <ExportContent title={selected.title} body={selected.body} formatting={selected.formatting} />
                {canRestore && selected.version < document.version && (
                  <button type="button" className="button button-primary" onClick={() => {
                    if (onDraft(selected)) onClose();
                  }}>
                    {t('载入为草稿')}
                  </button>
                )}
              </div>
              {!canRestore && selected.version < document.version && <p>{t('先保存当前草稿，再载入历史版本。')}</p>}
            </>
          )}
          <InlineError message={error} />
        </div>
      </div>
    </Modal>
  );
}
