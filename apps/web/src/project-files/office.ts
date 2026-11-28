import { defaultLayout, documentHighlightCss, readOfficeBlock, type OfficeBlock } from '@ai-xiutu/contracts';
import { headingScales } from './formatting';
import type { OfficeLayout } from './office-layout';
import type { IParagraphOptions } from 'docx';
import type pptxgen from 'pptxgenjs';
import type { MessageBlock } from '@ai-xiutu/contracts/office-data';
import { chartSeries } from '@ai-xiutu/contracts/office-data';
import { snapshotSvg } from '@ai-xiutu/contracts/office-data';
import { loadOfficePicture, officePng } from './office-images';

export async function wordDocument(title: string, blocks: MessageBlock[], layout?: OfficeLayout, pageStyle = defaultLayout) {
  let textLines = 0;
  const count = (text: string) => {
    textLines += 1 + (text.match(/\n/g)?.length ?? 0);
    if (textLines > 6000)
      throw new Error('Word 内容超过 6000 行（含表格单元格），请分段导出。');
  };
  for (const block of blocks) {
    if (block.kind === 'table') {
      if (block.headers.length > 63) throw new Error('表格列数超过文档格式限制，请使用 Excel。');
      block.headers.forEach(count);
      block.rows.forEach((row) => row.forEach(count));
    } else if (block.kind === 'list') block.items.forEach((item) => count(item.text));
    else count(block.text);
  }
  const {
    Document,
    Packer,
    Paragraph,
    HeadingLevel,
    TextRun,
    ImageRun,
    ExternalHyperlink,
    Table,
    TableRow,
    TableCell,
    WidthType,
    LineRuleType,
  } = await import('docx');
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];
  const face = (font: string) => ({ ascii: font, hAnsi: font, eastAsia: font, cs: font });
  const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
  const lines = (text: string) =>
    text.split('\n').map((line, index) => new TextRun({ text: line, break: index ? 1 : 0 }));
  function formatted(text: string, line: number, extra: IParagraphOptions = {}, prefix = '', code = false) {
    const p = layout?.paragraph(line, text, undefined, code);
    const runs = (p?.runs ?? [{text,style:{}}]).map(({text, style}) => {
      const run = new TextRun({
        text, bold: style.bold, italics: style.italic, underline: style.underline || style.link ? {} : undefined,
        strike: style.strike, color: style.color?.slice(1) ?? (style.link ? '175CD3' : undefined),
        highlight: style.highlight, superScript: style.script === 'super', subScript: style.script === 'sub',
        font: face(style.font ?? (code ? 'Courier New' : pageStyle.font)), size: style.size == null ? undefined : style.size * 2,
      });
      // Links stay editable hyperlinks in Word; only validated http(s)/mailto targets reach here.
      return style.link ? new ExternalHyperlink({ link: style.link, children: [run] }) : run;
    });
    const spacing = {
      ...(extra.spacing ?? {}),
      ...(p?.after !== undefined ? { after: p.after * 20 } : {}),
      ...(p?.spacing ? { line: Math.round(240 * p.spacing), lineRule: LineRuleType.AUTO } : {}),
    };
    return new Paragraph({ ...extra, ...(p?.align ? {alignment: p.align === 'justify' ? 'both' : p.align} : {}),
      ...(Object.keys(spacing).length ? { spacing } : {}),
      ...(p?.indent ? { indent: { left: 720 * p.indent } } : {}),
      children: [...(prefix ? [new TextRun(prefix)] : []), ...runs] });
  }
  let media = 0;
  async function embedded(block: OfficeBlock) {
    if (block.kind === 'note') {
      children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: block.text, italics: true })] }));
      return;
    }
    if (block.kind === 'audio' || block.kind === 'reference') {
      const url = block.kind === 'audio' ? '/v1/office-audio/' + block.id :
        '/v1/documents/' + block.documentId + '/versions/' + block.version;
      const text = block.title + (block.kind === 'reference' ? ' · v' + block.version : '');
      const run = new TextRun({ text, style: 'Hyperlink' });
      children.push(new Paragraph({ children: [typeof location === 'undefined' ? run :
        new ExternalHyperlink({ link: new URL(url, location.origin).href, children: [run] })] }));
      return;
    }
    if (++media > 32) throw new Error('Word 最多导出 32 张嵌入图片和图表，请分段导出。');
    const image = await officePng(block.kind === 'chart'
      ? new Blob([snapshotSvg(block.chart)], { type: 'image/svg+xml' }) : await loadOfficePicture(block.assetId));
    const scale = Math.min(1, 576 / image.width, 440 / image.height);
    const title = block.kind === 'chart' ? block.chart.title : block.title;
    children.push(new Paragraph({
      alignment: 'center',
      children: [new ImageRun({
        type: 'png', data: Uint8Array.from(atob(image.url.split(',')[1]!), ch => ch.charCodeAt(0)),
        transformation: { width: Math.round(image.width * scale), height: Math.round(image.height * scale) },
        altText: { name: title, description: title, title },
      })],
    }));
  }
  for (const block of blocks) {
    if (block.kind === 'table') {
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
      block.items.forEach((item, i) =>
        children.push(formatted(item.text, block.line + i, block.ordered ? {} : { bullet: { level: 0 } },
          block.ordered ? item.number + '. ' : '')));
    } else if (block.kind === 'heading') {
      children.push(formatted(block.text, block.line, { heading: headings[(block.level ?? 1) - 1] }));
    } else if (layout) {
      const words = block.text.split('\n');
      for (let i = 0; i < words.length; i++) {
        const text = words[i]!, attachment = block.kind === 'paragraph' ? readOfficeBlock(text) : null;
        if (attachment) await embedded(attachment);
        else children.push(formatted(text, block.line + i + (block.kind === 'code' ? 1 : 0),
          block.kind === 'quote' ? { indent: {left:360} } : {}, '', block.kind === 'code'));
      }
    } else children.push(new Paragraph({ children: lines(block.text) }));
  }
  return Packer.toBlob(
    new Document({
      title,
      styles: {
        default: {
          ...Object.fromEntries(headingScales.map((scale, i) => ['heading' + (i + 1), {
            run: { size: Math.round(pageStyle.size * scale * 2), bold: true, color: '223632', font: face(pageStyle.font) },
          }])),
          document: {
            run: { font: face(pageStyle.font), size: Math.round(pageStyle.size * 2), color: '223632' },
            paragraph: { alignment: pageStyle.align === 'justify' ? 'both' : pageStyle.align, spacing: { after: 140, line: Math.round(pageStyle.line * 240), lineRule: LineRuleType.AUTO } },
          },
        },
      },
      sections: [{ children }],
    }),
  );
}

export async function presentation(title: string, blocks: MessageBlock[], cover?: string, layout?: OfficeLayout, pageStyle = defaultLayout) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.title = title;
  const ink = '213935';
  const fontFace = pageStyle.font;
  const bodySize = Math.round(18 * pageStyle.size / defaultLayout.size);
  deck.theme = { headFontFace: fontFace, bodyFontFace: fontFace };
  let headingLine = -1;
  let heading = title,
    pageCount = 0,
    pageLines = 0,
    repeatedHeadingLength = 0;
  let page: ReturnType<typeof deck.addSlide> | undefined;
  function newPage() {
    if (++pageCount > 180) throw new Error('演示文稿超过 180 页，请按章节导出。');
    repeatedHeadingLength += heading.length;
    if (repeatedHeadingLength > 1_000_000)
      throw new Error('演示文稿的重复标题过长，请缩短标题或按章节导出。');
    const slide = deck.addSlide();
    slide.background = { color: 'F9FCFB' };
    const headingStyle = layout?.paragraph(headingLine, heading);
    slide.addText(headingStyle ? slideRuns(headingStyle.runs) : heading, {
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
      breakLine: false, align: headingStyle?.align, paraSpaceAfter: headingStyle?.after,
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
  function slideRuns(runs: ReturnType<OfficeLayout['paragraph']>['runs']): pptxgen.TextProps[] {
    return runs.map(({ text, style }) => ({text, options: {bold:style.bold,italic:style.italic,
      underline:style.underline || style.link ? {style:'sng'} : undefined, fontFace:style.font, fontSize:style.size,
      strike: style.strike ? 'sngStrike' : undefined, color: style.color?.slice(1) ?? (style.link ? '175CD3' : undefined),
      highlight: style.highlight ? documentHighlightCss[style.highlight].slice(1) : undefined,
      superscript: style.script === 'super', subscript: style.script === 'sub',
      ...(style.link ? { hyperlink: { url: style.link } } : {})}}));
  }
  function paragraph(text: string, line: number, prefix = '', code = false) {
    text.split('\n').forEach((source, i) => {
      const style = layout?.paragraph(line + i, source, undefined, code);
      const parts = style?.runs ?? [{text:source,style:{}}];
      const runs = prefix ? [{text:prefix,style:{}}, ...parts] : parts;
      // Bound each editable text box by glyph widths and the largest point size.
      let textRuns: typeof runs = [], width = 0, maxSize = 18;
      function flush() {
        const height = Math.max(1,Math.ceil(width / 77)) * Math.max(maxSize,bodySize) / 18 * pageStyle.line + .65;
        const after = (style?.after ?? 0) / 72 / .41;
        if (!page || pageLines + height > 12) page = newPage();
        if (textRuns.length) page.addText(slideRuns(textRuns), {
          x: .7, y: 1.76 + pageLines * .41, w: 11.85, h: Math.min(height,12) * .41,
          margin: 0, fontFace: code ? 'Courier New' : fontFace, fontSize: bodySize, lineSpacingMultiple: pageStyle.line, color: ink, fit: 'shrink', valign: 'top',
          align: style?.align ?? pageStyle.align, paraSpaceAfter: style?.after,
        });
        pageLines += height + after;
        textRuns = []; width = 0; maxSize = 18;
      }
      for (const run of runs) {
        let part = '';
        for (const glyph of run.text) {
          const pointSize = run.style.size ?? bodySize;
          const widthUnits = (glyph.codePointAt(0)! > 255 ? 2 : 1) * pointSize / 18;
          if (width && (Math.ceil((width + widthUnits) / 77) * Math.max(pointSize,maxSize) * pageStyle.line / 18 > 10 || width >= 350)) {
            if (part) textRuns.push({text:part,style:run.style});
            flush(); part = '';
          }
          maxSize = Math.max(maxSize,pointSize);
          width += widthUnits; part += glyph;
        }
        if (part) textRuns.push({text:part,style:run.style});
      }
      if (textRuns.length || layout) flush();
    });
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
      headingLine = block.line;
      page = undefined;
      pendingHeading = true;
    } else if (block.kind === 'table') {
      pendingHeading = false;
      if (
        block.headers.length > 10 || block.headers.some((s) => Array.from(s).length > 100) ||
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
          // Native, editable PowerPoint charts where the series maps 1:1; other kinds use bars.
          const native = pageStyle.chart === 'line' ? deck.ChartType.line
            : pageStyle.chart === 'area' ? deck.ChartType.area
            : pageStyle.chart === 'donut' ? deck.ChartType.doughnut : deck.ChartType.bar;
          slide.addChart(
            native,
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
              chartColors: pageStyle.chart === 'donut'
                ? ['237973', '447BC2', 'BA684A', '6C63A8', '9E7584', '607747', 'A37721', '437E95']
                : ['267A77'],
              ...(pageStyle.chart === 'donut' ? { holeSize: 58, showPercent: true, showLegend: true } : {}),
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
      block.items.forEach((item, i) => paragraph(item.text, block.line + i, block.ordered ? item.number + '. ' : '• '));
    } else {
      pendingHeading = false;
      paragraph(block.text, block.line + (block.kind === 'code' ? 1 : 0), '', block.kind === 'code');
    }
  }
  if (pendingHeading || pageCount === 0) newPage();
  const bytes = (await deck.write({ outputType: 'arraybuffer', compression: true })) as ArrayBuffer;
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
