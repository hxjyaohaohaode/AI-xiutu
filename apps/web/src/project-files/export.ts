import { documentFormatSchema, formatMatchesBody, defaultLayout, isPresentationBody, readPresentation, type DocumentFormat } from '@ai-xiutu/contracts';
import { officeLayout } from './office-layout';
import { calculatedTable, chartSvg, contentBlocks, isolatedOfficeChart, readProjectSheet, snapshotSvg } from '@ai-xiutu/contracts/office-data';

export type FileFormat = 'docx' | 'pptx' | 'xlsx' | 'svg' | 'png';

async function chartFile(svgText: string, format: 'svg' | 'png') {
  const vector = new Blob([svgText], { type: 'image/svg+xml' });
  if (format === 'svg') return vector;
  const { officePng } = await import('./office-images');
  const raster = await officePng(vector);
  const encoded = raster.url.slice('data:image/png;base64,'.length);
  return new Blob([Uint8Array.from(atob(encoded), value => value.charCodeAt(0))], { type: 'image/png' });
}

export async function exportContent(
  format: FileFormat,
  title: string,
  body: string,
  cover?: string,
  formatting?: DocumentFormat | null,
) {
  if (body.length > 100000) throw new Error('内容超过 100000 字符，请分段导出。');
  const unsupportedXml = /[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
  if (unsupportedXml.test(title) || unsupportedXml.test(body))
    throw new Error('内容包含文件格式不支持的字符，请清理后导出。');
  if (format === 'svg' || format === 'png') {
    const chart = isolatedOfficeChart(body);
    if (chart) return chartFile(snapshotSvg(chart), format);
  }
  if (isPresentationBody(body)) {
    const deck = readPresentation(body);
    if (!deck || format !== 'pptx') throw new Error('请选择 PowerPoint 格式导出此演示。');
    return (await import('./presentation-export')).exportPresentation(title, deck);
  }
  const sheet = readProjectSheet(body)?.table;
  const blocks = sheet ? [format === 'xlsx' ? sheet : calculatedTable(sheet)] :
    contentBlocks(body, format === 'xlsx' || format === 'svg' || format === 'png');
  if (formatting && (!documentFormatSchema.safeParse(formatting).success || !formatMatchesBody(body, formatting)))
      throw new Error('文字排版与正文不匹配');
  const page = formatting?.layout ?? defaultLayout;
  if (format === 'docx' || format === 'pptx') {
    const layout = officeLayout(body, formatting ?? {version:1,paragraphs:[]});
    const content = layout ? layout.withBlankLines(blocks) : blocks;
    const office = await import('./office');
    return format === 'docx' ? office.wordDocument(title, content, layout, page) : office.presentation(title, content, cover, layout, page);
  }
  const tables = blocks.filter((block) => block.kind === 'table');
  if (format === 'xlsx') return (await import('./workbook')).workbook(tables, page.chart);
  return chartFile(chartSvg(title, tables, page.chart), format);
}
