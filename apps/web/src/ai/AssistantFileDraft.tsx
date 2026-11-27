import { useMemo, useState } from 'react';
import { FileText } from '@phosphor-icons/react';
import type { AssistantProjectFile } from '@ai-xiutu/contracts';
import { documentDrafts } from '../account/document-drafts';
import { MotionDetails } from '../motion/Presence';
import { ExportContent } from '../project-files/ExportContent';
import { chartDataUrl, isolatedOfficeChart, readProjectSheet, snapshotSvg } from '@ai-xiutu/contracts/office-data';
import { t } from '../i18n';
import type { Project } from '../lib/types';
import type { CaptureProjectCover } from '../project-files/cover';
import { AssistantText } from './AssistantText';

export function AssistantFileDraft({
  file,
  actorId,
  project,
  openDocuments,
  captureCover,
}: {
  file: AssistantProjectFile;
  actorId: string | null;
  project: Project | null;
  openDocuments?: () => void;
  captureCover?: CaptureProjectCover;
}) {
  const [message, setMessage] = useState('');
  const canEdit = actorId && project && ['owner', 'admin', 'editor'].includes(project.role);
  const sheet = file.format === 'xlsx' ? readProjectSheet(file.body)?.table : null;
  const chart = useMemo(() => {
    try {
      const snapshot = isolatedOfficeChart(file.body);
      return snapshot && { title: snapshot.title, url: chartDataUrl(snapshotSvg(snapshot)) };
    } catch { return null; }
  }, [file.body]);

  function stage() {
    if (!actorId || !project || !canEdit) return;
    if (documentDrafts.get(actorId, project.id)) {
      setMessage('项目已有草稿，请先保存或导出该草稿。');
      return;
    }
    const result = documentDrafts.put({
      actorId, projectId: project.id, projectTitle: project.title,
      base: null, title: file.title, body: file.body,
    });
    if (!result.ok) {
      setMessage('草稿保留空间不足，请先处理已有草稿。');
      return;
    }
    setMessage('已载入项目草稿，可以在项目文档中继续编辑。');
    openDocuments?.();
  }

  return (
    <MotionDetails className="assistant-file-draft">
      <summary><FileText size={17} aria-hidden /> <span>{file.title}</span> <span>{file.format.toUpperCase()}</span></summary>
      {chart ? <img className="office-chart-preview" src={chart.url} alt={chart.title} /> : sheet ? (
        <div className="office-table-scroll">
          <table aria-label={file.title}>
            <thead><tr>{sheet.headers.map((cell, index) => <th key={index} scope="col">{cell}</th>)}</tr></thead>
            <tbody>{sheet.rows.map((row, index) =>
              <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>,
            )}</tbody>
          </table>
        </div>
      ) : <AssistantText text={file.body} />}
      <div className="assistant-message-actions">
        <ExportContent title={file.title} body={file.body} captureCover={captureCover}
          formats={chart ? [file.format, 'svg', 'png'] : file.format === 'xlsx' ? ['xlsx', 'svg'] : [file.format]} />
        {canEdit && (
          <button type="button" className="text-button" onClick={stage}>{t('载入项目草稿')}</button>
        )}
      </div>
      {message && <p role="status">{t(message)}</p>}
    </MotionDetails>
  );
}
