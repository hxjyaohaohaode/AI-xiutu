import { useEffect, useState } from 'react';
import { defaultLayout, readPresentation } from '@ai-xiutu/contracts';
import { Busy, InlineError, Modal } from '../components/Ui';
import { api, errorMessage } from '../lib/api';
import { t, useLocale } from '../i18n';
import { projectDocumentsFromResponse } from '../account/document-drafts';
import type { ProjectDocument } from '../lib/types';
import { DocumentPreview } from './DocumentComposer';
import { PresentationPreview } from './PresentationEditor';

export function OfficeReferenceDialog({
  id,
  version,
  onClose,
}: {
  id: string;
  version: number;
  onClose: () => void;
}) {
  useLocale();
  const [value, setValue] = useState<ProjectDocument | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<{ document: unknown }>('/documents/' + id + '/versions/' + version, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        const [document] = projectDocumentsFromResponse({ documents: [response.document] });
        if (document?.id !== id || document.version !== version)
          throw new Error('无法读取引用版本。');
        setValue(document);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [id, version]);
  const deck = value && readPresentation(value.body);
  return (
    <Modal
      title={value?.title ?? t('引用文档')}
      subtitle={t('版本 {v0}', { v0: version })}
      wide
      onClose={onClose}
    >
      {value ? (
        deck ? (
          <PresentationPreview document={deck} />
        ) : (
          <DocumentPreview
            text={value.body}
            title={value.title}
            charts={false}
            formatting={value.formatting}
            layout={value.formatting?.layout ?? defaultLayout}
          />
        )
      ) : error ? (
        <InlineError message={error} />
      ) : (
        <Busy label={t('读取中')} />
      )}
    </Modal>
  );
}
