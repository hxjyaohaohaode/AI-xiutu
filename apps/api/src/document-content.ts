import {
  isPresentationBody,
  officeBlockPrefix,
  readOfficeBlock,
  readPresentation,
} from '@ai-xiutu/contracts';
import type { Queryable } from '@ai-xiutu/db';
import { HttpError } from './core.js';

export const documentDto = (d: Record<string, any>) => ({
  id: d.id,
  projectId: d.project_id,
  title: d.title,
  body: d.body,
  ...(d.formatting ? { formatting: d.formatting } : {}),
  version: d.version,
  authorId: d.author_id,
  createdAt: d.created_at,
  updatedAt: d.updated_at,
});

export const isOfficeProse = (body: string) =>
  !isPresentationBody(body) &&
  !/^(?:> Formulas v1 [^\n]*\n\n)?(?:> [^\n]*\n> SHA-256 [a-f0-9]{64}\n(?:> [^\n]*\n)?\n)?`{3,}sheet-tsv\n/.test(
    body,
  );

export async function validateDocumentContent(tx: Queryable, projectId: string, body: string) {
  const assets = new Set<string>();
  const audio = new Set<string>();
  const sources = new Map<string, { id: string; version: number }>();
  const addSource = ({ documentId, version }: { documentId: string; version: number }) =>
    sources.set(documentId + ':' + version, { id: documentId, version });
  if (isPresentationBody(body)) {
    const presentation = readPresentation(body);
    if (!presentation) throw new HttpError(400, 'PRESENTATION_INVALID', '演示的画布或内容格式无效');
    for (const page of presentation.slides)
      for (const element of page.elements) {
        if (element.kind === 'image') assets.add(element.assetId);
        if (element.kind === 'chart' && element.chart.source) addSource(element.chart.source);
      }
  } else if (body.includes(officeBlockPrefix)) {
    for (const line of body.split(/\r\n?|\n/)) {
      const block = readOfficeBlock(line);
      if (block?.kind === 'image') assets.add(block.assetId);
      if (block?.kind === 'audio') audio.add(block.id);
      if (block?.kind === 'reference') addSource(block);
      if (block?.kind === 'chart' && block.chart.source) addSource(block.chart.source);
    }
  }
  if (assets.size) {
    const visible = await tx.query(
      'SELECT id FROM assets WHERE id=ANY($1::uuid[]) AND project_id=$2 AND deleted_at IS NULL FOR SHARE',
      [[...assets], projectId],
    );
    if (visible.rowCount !== assets.size)
      throw new HttpError(400, 'OFFICE_ASSET_UNAVAILABLE', '有图片已不在当前项目中');
  }
  if (audio.size) {
    const visible = await tx.query(
      'SELECT id FROM office_audio WHERE id=ANY($1::uuid[]) AND project_id=$2',
      [[...audio], projectId],
    );
    if (visible.rowCount !== audio.size)
      throw new HttpError(400, 'OFFICE_AUDIO_UNAVAILABLE', '有音频不在当前项目中');
  }
  if (sources.size) {
    const refs = [...sources.values()];
    const visible = await tx.query(
      `SELECT d.id FROM unnest($1::uuid[],$2::integer[]) as refs(id,version)
       JOIN documents d ON d.id=refs.id AND d.project_id=$3
       JOIN document_versions v ON v.document_id=d.id AND v.version=refs.version`,
      [refs.map((r) => r.id), refs.map((r) => r.version), projectId],
    );
    if (visible.rowCount !== refs.length)
      throw new HttpError(400, 'OFFICE_CHART_SOURCE_UNAVAILABLE', '有图表的来源版本不在当前项目中');
  }
}
