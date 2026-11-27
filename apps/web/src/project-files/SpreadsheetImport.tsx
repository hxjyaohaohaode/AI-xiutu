import { useEffect, useRef, useState } from 'react';
import { UploadSimple } from '@phosphor-icons/react';
import { Modal } from '../components/Ui';
import { t } from '../i18n';
import type { selectSpreadsheetRange } from './spreadsheet';

type Selection = ReturnType<typeof selectSpreadsheetRange>;
type Sheet = { name: string; bounds: string };
type Result = { sheets?: Sheet[]; selection?: Selection; error?: string; ticket?: number };

export function SpreadsheetImport({ disabled, onImport }: {
  disabled: boolean;
  onImport: (draft: { title: string; body: string }) => Promise<boolean>;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);
  const request = useRef(0);
  const [file, setFile] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheet, setSheet] = useState(0);
  const [range, setRange] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  function stop() {
    request.current++;
    worker.current?.terminate();
    worker.current = null;
  }
  useEffect(() => stop, []);
  function close() {
    stop();
    setFile('');
    setSelection(null);
    setError('');
    setSheets([]);
    setApplying(false);
  }
  function select(index: number, value: string) {
    setSheet(index);
    setRange(value);
    setSelection(null);
    setError('');
    worker.current?.postMessage({ sheet: index, range: value, ticket: ++request.current });
  }
  async function open(source: File | undefined) {
    if (!source || disabled) return;
    close();
    setFile(source.name);
    if (source.size > 4 * 1024 * 1024 || source.size === 0) {
      setError('表格超出本机导入限额，请在源文件中另存所需区域。');
      return;
    }
    const ticket = request.current;
    try {
      const reader = new Worker(new URL('./spreadsheet.worker.ts', import.meta.url), { type: 'module' });
      worker.current = reader;
      reader.onmessage = ({ data }: MessageEvent<Result>) => {
        if (reader !== worker.current || (data.ticket !== undefined && data.ticket !== request.current)) return;
        if (data.error) setError(data.error);
        if (data.sheets?.length) {
          setSheets(data.sheets);
          select(0, data.sheets[0]!.bounds);
        } else if (data.selection) setSelection(data.selection);
      };
      reader.onerror = () => { if (worker.current === reader) setError('无法读取表格文件。'); };
      const bytes = await source.arrayBuffer();
      if (reader === worker.current) reader.postMessage({ name: source.name, bytes }, [bytes]);
    } catch {
      if (request.current === ticket) setError('无法读取表格文件。');
    }
  }
  async function apply() {
    if (!selection || disabled || applying) return;
    setApplying(true);
    try { if (await onImport({ title: selection.title, body: selection.body })) close(); }
    finally { setApplying(false); }
  }
  return <>
    <input ref={picker} type="file" accept=".xlsx,.csv,.tsv" hidden onChange={(event) => {
      const source = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      void open(source);
    }} />
    <button type="button" className="text-button" disabled={disabled} onClick={() => picker.current?.click()}>
      <UploadSimple size={17} />{t('导入表格')}
    </button>
    {file && <Modal title={t('导入表格')} subtitle={file} onClose={close}>
      <div className="stack-form spreadsheet-import">
      {sheets.length > 1 && <label>{t('工作表')}
        <select aria-label={t('工作表')} value={sheet} onChange={(event) => { const i = Number(event.target.value); select(i, sheets[i]!.bounds); }}>
          {sheets.map((item, i) => <option key={item.name} value={i}>{item.name}</option>)}
        </select>
      </label>}
      {sheets.length > 0 && <label>{t('数据区域')}
        <input aria-label={t('数据区域')} value={range} placeholder={sheets[sheet]?.bounds}
          onChange={(event) => select(sheet, event.target.value)} />
      </label>}
      {selection && <>
        <div className="document-sheet-preview"><table aria-label={t('表格预览')}><tbody>
          {selection.preview.map((row, i) => <tr key={i}>{row.map((cell, j) => i === 0
            ? <th key={j} scope="col">{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}
        </tbody></table></div>
        <p>{t('{rows} 行 · {columns} 列', { rows: selection.rows, columns: selection.columns })}
          {selection.formulas > 0 && ' · ' + t('公式采用文件中已保存的结果')}</p>
        {Array.from(selection.body).length > 5000 && <p>{t('可保存为项目文档。引用给 AI 时，请先将所选区域缩小至 5000 字符以内。')}</p>}
      </>}
      {!error && !selection && <p role="status">{t('正在读取')}</p>}
      {error && <p role="alert">{t(error)}</p>}
      <button type="button" className="button button-primary" disabled={disabled || !selection || applying}
        onClick={() => void apply()}>{t('导入为项目文档')}</button>
      </div>
    </Modal>}
  </>;
}
