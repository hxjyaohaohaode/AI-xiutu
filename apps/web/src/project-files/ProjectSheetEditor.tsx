import { officeCharts, type DocumentLayout } from '@ai-xiutu/contracts';
import { useMemo, useState } from 'react';
import { ChartBar, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { chartNames, chartSvg } from '@ai-xiutu/contracts/office-data';
import { columnName, editProjectCell, expandProjectSheet, type ProjectSheet } from '@ai-xiutu/contracts/office-data';
import { calculateSheet, calculatedCellText, calculatedTable } from '@ai-xiutu/contracts/office-data';
import { t } from '../i18n';
import './project-sheet.css';

export function ProjectSheetEditor({
  sheet,
  title,
  readOnly,
  onChange,
  onSource, chart, onChart,
}: {
  sheet: ProjectSheet;
  title: string;
  readOnly: boolean;
  onChange: (body: string) => boolean;
  onSource: () => void; chart: DocumentLayout['chart']; onChart: (chart: DocumentLayout['chart']) => boolean;
}) {
  const [page, setPage] = useState(0),
    [column, setColumn] = useState(0);
  const [showChart, setShowChart] = useState(false),
    [error, setError] = useState('');
  const [headerDraft, setHeaderDraft] = useState<{ col: number; value: string } | null>(null);
  const [selection, setSelection] = useState({ row: 1, col: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const { table } = sheet;
  const results = useMemo(() => calculateSheet(table), [table]);
  const selectedAddress = columnName(selection.col) + (selection.row + 1);
  const activeCalculation = results.get(selectedAddress);
  const rowsPerPage = 12,
    colsPerPage = 6;
  const rows = table.rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const cols = table.headers
    .slice(column * colsPerPage, (column + 1) * colsPerPage)
    .map((_, i) => column * colsPerPage + i);
  const preview = useMemo(() => {
    if (!showChart) return null;
    try {
      return {
        src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(chartSvg(title, [calculatedTable(table, results)], chart)),
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : '' };
    }
  }, [table, results, showChart, title, chart]);
  function write(row: number, col: number, value: string) {
    if (readOnly) return;
    if (!row && !value.trim()) {
      setHeaderDraft({ col, value });
      return;
    }
    const next = editProjectCell(sheet, row, col, value);
    if (!next || !onChange(next)) {
      setError(t('表格内容超过保存范围。'));
      return;
    }
    setHeaderDraft(null);
    setError('');
  }
  const raw = (row: number, col: number) =>
    table.formulas?.[columnName(col) + (row + 1)] ??
      (row ? table.rows[row - 1]?.[col] : table.headers[col]) ?? '';
  function expand(dimension: 'row' | 'column') {
    const added = expandProjectSheet(sheet, dimension, t('数据') + ' ' + columnName(table.headers.length));
    if (!added || !onChange(added)) setError(t('表格内容超过保存范围。'));
    else setError('');
  }
  const cell = (row: number, col: number, value: string) => {
    const address = columnName(col) + (row + 1);
    const calculation = results.get(address);
    const shown = calculation && editing !== address ? calculatedCellText(calculation.value) : raw(row, col);
    return <textarea
      rows={1}
      aria-label={address}
      aria-invalid={!!calculation?.value && typeof calculation.value === 'object'}
      title={calculation ? calculatedCellText(calculation.value) : undefined}
      data-selected={address === selectedAddress}
      readOnly={readOnly}
      value={!row && headerDraft?.col === col ? headerDraft.value : calculation ? shown : value}
      onChange={(e) => write(row, col, e.target.value)}
      onFocus={() => { setSelection({ row, col }); setEditing(address); }}
      onBlur={() => {
        setEditing(null);
        if (!row && headerDraft?.col === col) {
          setHeaderDraft(null);
          setError(t('表头不能为空。'));
        }
      }}
    />;
  };
  return (
    <section className="project-sheet" aria-label={t('工作表')}>
      <div className="project-sheet-bar">
        {sheet.filename && sheet.range && <span>{sheet.filename} · {sheet.range}</span>}
        <button type="button" className="text-button" onClick={onSource}>
          {t('正文')}
        </button>
        {showChart && !readOnly && <select aria-label={t('图表类型')} value={chart}
          onChange={e => onChart(officeCharts[e.target.selectedIndex]!)}>
          {officeCharts.map(kind => <option key={kind} value={kind}>{t(chartNames[kind])}</option>)}
        </select>}
        <button
          type="button"
          className="text-button"
          aria-pressed={showChart}
          onClick={() => setShowChart(!showChart)}
        >
          <ChartBar size={17} />
          {t('图表预览')}
        </button>
        {!readOnly && <>
          <button type="button" className="text-button" onClick={() => expand('row')}>{t('添加行')}</button>
          <button type="button" className="text-button" onClick={() => expand('column')}>{t('添加列')}</button>
        </>}
      </div>
      <div className="project-sheet-formula">
        <label htmlFor="project-sheet-expression">{selectedAddress}</label>
        <span aria-hidden="true">ƒx</span>
        <input id="project-sheet-expression" aria-label={t('公式栏')} readOnly={readOnly}
          value={raw(selection.row, selection.col)} placeholder={t('公式以 = 开头')}
          onChange={e => write(selection.row, selection.col, e.target.value)} />
        {activeCalculation && <output aria-live="polite">{calculatedCellText(activeCalculation.value)}</output>}
      </div>
      <div className="project-sheet-scroll">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} scope="col">
                  {cell(0, c, table.headers[c]!)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={page * rowsPerPage + i}>
                {cols.map((c) => (
                  <td key={c}>{cell(1 + page * rowsPerPage + i, c, r[c]!)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(table.rows.length > rowsPerPage || table.headers.length > colsPerPage) && (
        <div className="project-sheet-pages">
          {table.rows.length > rowsPerPage && (
            <>
              <button
                type="button"
                aria-label={t('上一页')}
                disabled={!page}
                onClick={() => setPage(page - 1)}
              >
                <CaretLeft />
              </button>
              <span>
                {page * rowsPerPage + 1}–{Math.min((page + 1) * rowsPerPage, table.rows.length)} /{' '}
                {table.rows.length}
              </span>
              <button
                type="button"
                aria-label={t('下一页')}
                disabled={(page + 1) * rowsPerPage >= table.rows.length}
                onClick={() => setPage(page + 1)}
              >
                <CaretRight />
              </button>
            </>
          )}
          {table.headers.length > colsPerPage && (
            <>
              <button
                type="button"
                aria-label={t('上一组列')}
                disabled={!column}
                onClick={() => setColumn(column - 1)}
              >
                <CaretLeft />
              </button>
              <span>
                {columnName(cols[0]!)}–{columnName(cols[cols.length - 1]!)}
              </span>
              <button
                type="button"
                aria-label={t('下一组列')}
                disabled={(column + 1) * colsPerPage >= table.headers.length}
                onClick={() => setColumn(column + 1)}
              >
                <CaretRight />
              </button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {preview?.src && <img src={preview.src} alt={t('当前工作表图表')} />}
      {preview?.error && <p role="status">{t(preview.error)}</p>}
    </section>
  );
}
