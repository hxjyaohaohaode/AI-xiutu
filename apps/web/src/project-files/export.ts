import { documentFormatSchema, formatMatchesBody, defaultLayout, type DocumentFormat } from '@ai-xiutu/contracts';
import { officeLayout } from './office-layout';
import { contentBlocks } from './content';

export type FileFormat = 'docx' | 'pptx' | 'xlsx' | 'svg';

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
  const blocks = contentBlocks(body, format === 'xlsx' || format === 'svg');
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
  const { chartSvg } = await import('./chart');
  return new Blob([chartSvg(title, tables, page.chart)], { type: 'image/svg+xml;charset=utf-8' });
}
