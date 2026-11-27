import { strToU8, zipSync } from 'fflate';
import { chartSeries, numericCell, xml, type DataTable } from './content';

const office = 'http://schemas.openxmlformats.org/officeDocument/2006';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006';
const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const mime = 'application/vnd.openxmlformats-officedocument.';
const relationships = (targets: [string, string][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${targets
    .map(
      ([type, target], i) =>
        `<Relationship Id="rId${i + 1}" Type="${office}/relationships/${type}" Target="${target}"/>`,
    )
    .join('')}</Relationships>`;

function columnName(index: number) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function chartXml(table: DataTable, series: ReturnType<typeof chartSeries>[number], sheet: string) {
  const col = columnName(series.column);
  const range = (letter: string) => `${sheet}!$${letter}$2:$${letter}$${table.rows.length + 1}`;
  const cached = (values: string[]) =>
    `<c:ptCount val="${values.length}"/>${values
      .map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`)
      .join('')}`;
  const title = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xml(series.name)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
  return `<c:chartSpace xmlns:c="${drawing}/chart" xmlns:a="${drawing}/main"><c:chart>${title}<c:plotArea><c:layout/>
    <c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/>
    <c:tx><c:strRef><c:f>${sheet}!$${col}$1</c:f><c:strCache>${cached([series.name])}</c:strCache></c:strRef></c:tx>
    <c:spPr><a:solidFill><a:srgbClr val="267A77"/></a:solidFill></c:spPr>
    <c:cat><c:strRef><c:f>${range('A')}</c:f><c:strCache>${cached(table.rows.map((r) => r[0]))}</c:strCache></c:strRef></c:cat>
    <c:val><c:numRef><c:f>${range(col)}</c:f><c:numCache><c:formatCode>${series.percent ? '0.##%' : 'General'}</c:formatCode>${cached(series.values.map(String))}</c:numCache></c:numRef></c:val>
    </c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart>
    <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx>
    <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="${series.percent ? '0.##%' : 'General'}" sourceLinked="0"/><c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx>
    </c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}

export function workbook(tables: DataTable[]) {
  if (!tables.length) throw new Error('请提供含表头的 Markdown、CSV 或制表符数据。');
  const files: Record<string, Uint8Array> = {};
  const overrides: string[] = [];
  function add(path: string, content: string, type?: string) {
    files[path] = strToU8(declaration + content);
    if (type) overrides.push(`<Override PartName="/${path}" ContentType="${mime}${type}"/>`);
  }
  const sheets: string[] = [];
  const styles = `<styleSheet xmlns="${spreadsheet}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.#############%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF267A77"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  add('xl/styles.xml', styles, 'spreadsheetml.styles+xml');
  const bookRels: [string, string][] = [];
  let chartId = 0;
  tables.forEach((table, index) => {
    const num = index + 1,
      name = 'Data' + num;
    const all = [table.headers, ...table.rows];
    const widths = table.headers.map(() => 12);
    const rows = all
      .map(
        (cells, r) =>
          `<row r="${r + 1}">${cells
            .map((text, c) => {
              if (text.length > 32767) throw new Error('单元格超过 Excel 的 32767 字符限制。');
              const location = columnName(c) + (r + 1);
              const value = r > 0 ? numericCell(text) : null;
              widths[c] = Math.min(
                54,
                Math.max(
                  widths[c],
                  Array.from(text).reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) + 3,
                ),
              );
              if (value)
                return `<c r="${location}" s="${value.percent ? 2 : 0}"><v>${value.value}</v></c>`;
              return `<c r="${location}" t="inlineStr" s="${r === 0 ? 1 : 0}"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
            })
            .join('')}</row>`,
      )
      .join('');
    const cols = widths
      .map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`)
      .join('');
    const series = chartSeries(table);
    const refs: [string, string][] = [];
    const anchors = series.map((value, i) => {
      chartId++;
      add(`xl/charts/chart${chartId}.xml`, chartXml(table, value, name), 'drawingml.chart+xml');
      refs.push(['chart', `../charts/chart${chartId}.xml`]);
      return `<xdr:oneCellAnchor><xdr:from><xdr:col>${table.headers.length + 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${i * 18}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="5300000" cy="2950000"/>
      <xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 1}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${drawing}/chart"><c:chart xmlns:c="${drawing}/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`;
    });
    if (anchors.length) {
      add(
        `xl/drawings/drawing${num}.xml`,
        `<xdr:wsDr xmlns:xdr="${drawing}/spreadsheetDrawing" xmlns:a="${drawing}/main" xmlns:r="${office}/relationships">${anchors.join('')}</xdr:wsDr>`,
        'drawing+xml',
      );
      add(`xl/drawings/_rels/drawing${num}.xml.rels`, relationships(refs));
      add(
        `xl/worksheets/_rels/sheet${num}.xml.rels`,
        relationships([['drawing', `../drawings/drawing${num}.xml`]]),
      );
    }
    add(
      `xl/worksheets/sheet${num}.xml`,
      `<worksheet xmlns="${spreadsheet}" xmlns:r="${office}/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${columnName(table.headers.length - 1)}${all.length}"/>${anchors.length ? '<drawing r:id="rId1"/>' : ''}</worksheet>`,
      'spreadsheetml.worksheet+xml',
    );
    sheets.push(`<sheet name="${name}" sheetId="${num}" r:id="rId${num}"/>`);
    bookRels.push(['worksheet', `worksheets/sheet${num}.xml`]);
  });
  bookRels.push(['styles', 'styles.xml']);
  add(
    'xl/workbook.xml',
    `<workbook xmlns="${spreadsheet}" xmlns:r="${office}/relationships"><sheets>${sheets.join('')}</sheets></workbook>`,
    'spreadsheetml.sheet.main+xml',
  );
  add('_rels/.rels', relationships([['officeDocument', 'xl/workbook.xml']]));
  add('xl/_rels/workbook.xml.rels', relationships(bookRels));
  add(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`,
  );
  return new Blob([new Uint8Array(zipSync(files))], { type: mime + 'spreadsheetml.sheet' });
}
