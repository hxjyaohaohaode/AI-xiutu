import { contentBlocks } from './content';

export type FileFormat = 'docx' | 'pptx' | 'xlsx' | 'svg';

export async function exportContent(
  format: FileFormat,
  title: string,
  body: string,
  cover?: string,
) {
  if (body.length > 100000) throw new Error('内容超过 100000 字符，请分段导出。');
  const unsupportedXml = /[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
  if (unsupportedXml.test(title) || unsupportedXml.test(body))
    throw new Error('内容包含文件格式不支持的字符，请清理后导出。');
  const blocks = contentBlocks(body, format === 'xlsx' || format === 'svg');
  if (format === 'docx') return (await import('./office')).wordDocument(title, blocks);
  if (format === 'pptx') return (await import('./office')).presentation(title, blocks, cover);
  const tables = blocks.filter((block) => block.kind === 'table');
  if (format === 'xlsx') return (await import('./workbook')).workbook(tables);
  const { chartSvg } = await import('./chart');
  return new Blob([chartSvg(title, tables)], { type: 'image/svg+xml;charset=utf-8' });
}
