import { type DocumentLayout } from '../document-format.js';
import {
  officeChartSnapshotSchema,
  readOfficeBlock,
  readPresentation,
  type OfficeChartSnapshot,
} from '../office-content.js';
import { contentBlocks } from './content.js';
import { readProjectSheet } from './project-sheet.js';
import { calculatedTable } from './formulas.js';
import { usedChartTable, type DataTable } from './table.js';
import { snapshotSvg } from './chart.js';

export function officeDataTable(body: string): DataTable | null {
  const sheet = readProjectSheet(body);
  if (sheet) return calculatedTable(sheet.table);
  const tables = contentBlocks(body, true).filter((block) => block.kind === 'table');
  return tables.length === 1 ? tables[0]! : null;
}

export function isolatedOfficeChart(body: string): OfficeChartSnapshot | null {
  const block = readOfficeBlock(body);
  if (block?.kind === 'chart') return block.chart;
  const deck = readPresentation(body);
  const elements = deck?.slides.length === 1 ? deck.slides[0]!.elements : [];
  return elements.length === 1 && elements[0]!.kind === 'chart' ? elements[0]!.chart : null;
}

export function createChartSnapshot(
  table: DataTable,
  title: string,
  kind: DocumentLayout['chart'],
  source?: OfficeChartSnapshot['source'],
): OfficeChartSnapshot {
  const used = usedChartTable(table);
  const snapshot = officeChartSnapshotSchema.safeParse({
    title,
    kind,
    headers: used.headers,
    rows: used.rows,
    textCells: [...(used.textCells ?? [])].filter((index) => index >= used.headers.length),
    source,
  });
  if (!snapshot.success) throw new Error('插入图表最多支持 256 行、16 列，请检查数据或缩小范围。');
  snapshotSvg(snapshot.data);
  return snapshot.data;
}
