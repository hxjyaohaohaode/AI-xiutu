import type { MessageBlock } from '../ai/message-format';
import { chartSeries } from './content';

export async function wordDocument(title: string, blocks: MessageBlock[]) {
  const {
    Document,
    Packer,
    Paragraph,
    HeadingLevel,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
  } = await import('docx');
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];
  const lines = (text: string) =>
    text.split('\n').map((line, index) => new TextRun({ text: line, break: index ? 1 : 0 }));
  for (const block of blocks) {
    if (block.kind === 'table') {
      if (block.headers.length > 63) throw new Error('表格列数超过文档格式限制，请使用 Excel。');
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [block.headers, ...block.rows].map(
            (row, index) =>
              new TableRow({
                tableHeader: !index,
                children: row.map(
                  (cell) =>
                    new TableCell({
                      ...(index === 0 ? { shading: { fill: 'E2F2EF' } } : {}),
                      children: [new Paragraph({ children: lines(cell) })],
                    }),
                ),
              }),
          ),
        }),
      );
    } else if (block.kind === 'list') {
      for (const item of block.items)
        children.push(
          new Paragraph(
            block.ordered
              ? { text: `${item.number}. ${item.text}` }
              : { text: item.text, bullet: { level: 0 } },
          ),
        );
    } else if (block.kind === 'heading')
      children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1 }));
    else children.push(new Paragraph({ children: lines(block.text) }));
  }
  return Packer.toBlob(
    new Document({
      title,
      styles: {
        default: {
          document: {
            run: { font: 'Aptos', size: 23, color: '223632' },
            paragraph: { spacing: { after: 140 } },
          },
        },
      },
      sections: [{ children }],
    }),
  );
}

export async function presentation(title: string, blocks: MessageBlock[], cover?: string) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.title = title;
  const ink = '213935';
  const fontFace = 'Aptos';
  let heading = title,
    pageCount = 0,
    pageLines = 0;
  let page: ReturnType<typeof deck.addSlide> | undefined;
  function newPage() {
    if (++pageCount > 180) throw new Error('演示文稿超过 180 页，请按章节导出。');
    const slide = deck.addSlide();
    slide.background = { color: 'F9FCFB' };
    slide.addText(heading, {
      x: 0.65,
      y: 0.38,
      w: 12.05,
      h: 1,
      margin: 0,
      fit: 'shrink',
      fontFace,
      fontSize: 31,
      bold: true,
      color: ink,
      valign: 'middle',
      breakLine: false,
    });
    slide.addShape(deck.ShapeType.line, {
      x: 0.65,
      y: 1.42,
      w: 12.05,
      h: 0,
      line: { color: 'BFD8D2', width: 1 },
    });
    slide.addText(String(pageCount), {
      x: 11.95,
      y: 7.08,
      w: 0.75,
      h: 0.2,
      margin: 0,
      fontFace,
      fontSize: 10,
      color: '657A75',
      align: 'right',
    });
    pageLines = 0;
    return slide;
  }
  function paragraph(text: string) {
    // CJK glyphs use roughly twice the horizontal advance of Latin glyphs.
    const parts: string[] = [];
    let chunk = '',
      width = 0;
    for (const glyph of text) {
      if (width >= 350 || glyph === '\n') {
        if (chunk) parts.push(chunk);
        chunk = '';
        width = 0;
      }
      if (glyph !== '\n') {
        chunk += glyph;
        width += glyph.codePointAt(0)! > 255 ? 2 : 1;
      }
    }
    if (chunk) parts.push(chunk);
    for (const part of parts) {
      const widthUnits = Array.from(part).reduce(
        (n, ch) => n + (ch.codePointAt(0)! > 255 ? 2 : 1),
        0,
      );
      const height = Math.ceil(widthUnits / 77) + 0.65;
      if (!page || pageLines + height > 12) page = newPage();
      page.addText(part, {
        x: 0.7,
        y: 1.76 + pageLines * 0.41,
        w: 11.85,
        h: height * 0.41,
        margin: 0,
        fontFace,
        fontSize: 18,
        valign: 'top',
        color: ink,
        fit: 'shrink',
      });
      pageLines += height;
    }
  }
  if (cover) {
    const prefix = 'data:image/jpeg;base64,';
    if (cover.length > 3_000_000 || !cover.startsWith(prefix))
      throw new Error('浏览器未能编码共享预览。');
    const { MAX_HEADER_BYTES, readImageHeader } = await import('@ai-xiutu/editor');
    const bytes = Uint8Array.from(atob(cover.slice(prefix.length)), (ch) => ch.charCodeAt(0));
    const image = readImageHeader(bytes.subarray(0, MAX_HEADER_BYTES), { maxDimension: 1024 });
    if (image.format !== 'jpeg') throw new Error('浏览器未能编码共享预览。');
    const scale = Math.min(12 / image.width, 5.35 / image.height);
    const w = scale * image.width,
      h = scale * image.height;
    newPage().addImage({
      data: cover,
      x: (13.333 - w) / 2,
      y: 1.6 + (5.35 - h) / 2,
      w,
      h,
      altText: title,
    });
  }
  let pendingHeading = false;
  for (const block of blocks) {
    if (block.kind === 'heading') {
      if (pendingHeading) newPage();
      heading = block.text;
      page = undefined;
      pendingHeading = true;
    } else if (block.kind === 'table') {
      pendingHeading = false;
      if (
        block.headers.length > 10 ||
        block.rows.some((r) => r.some((s) => Array.from(s).length > 100))
      )
        throw new Error('表格过宽或单元格过长，请使用 Excel 或 Word 导出。');
      const chunkSize = 7;
      for (let row = 0; row < Math.max(block.rows.length, 1); row += chunkSize) {
        const slide = newPage();
        const cells = [
          block.headers.map((text) => ({
            text,
            options: { bold: true, color: 'FFFFFF', fill: { color: '267A77' } },
          })),
          ...block.rows.slice(row, row + chunkSize).map((r) => r.map((text) => ({ text }))),
        ];
        slide.addTable(cells, {
          x: 0.7,
          y: 1.74,
          w: 11.9,
          fontFace,
          fontSize: 14,
          color: ink,
          border: { type: 'solid', pt: 0.5, color: 'D6E2DF' },
          margin: 0.065,
          autoPage: false,
        });
      }
      if (block.rows.length >= 2 && block.rows.length <= 20) {
        for (const series of chartSeries(block)) {
          const slide = newPage();
          slide.addChart(
            deck.ChartType.bar,
            [{ name: series.name, labels: block.rows.map((r) => r[0]), values: series.values }],
            {
              x: 0.7,
              y: 1.65,
              w: 11.9,
              h: 5,
              barDir: 'col',
              showTitle: true,
              title: series.name,
              showLegend: false,
              chartColors: ['267A77'],
              catAxisLabelFontSize: 12,
              valAxisLabelFontSize: 12,
              valAxisLabelFormatCode: series.percent ? '0.##%' : 'General',
            },
          );
        }
      }
      page = undefined;
    } else if (block.kind === 'list') {
      pendingHeading = false;
      for (const item of block.items)
        paragraph((block.ordered ? `${item.number}. ` : '• ') + item.text);
    } else {
      pendingHeading = false;
      paragraph(block.text);
    }
  }
  if (pendingHeading || pageCount === 0) newPage();
  const bytes = (await deck.write({ outputType: 'arraybuffer', compression: true })) as ArrayBuffer;
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
