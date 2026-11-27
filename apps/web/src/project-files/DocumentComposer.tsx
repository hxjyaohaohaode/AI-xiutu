import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChartLine,
  Eye,
  ListBullets,
  PencilSimple,
  SlidersHorizontal,
  TextH,
} from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import { contentBlocks } from './content';
import { chartSvg } from './chart';
import { editSelection, headingScales, type FormatCommand } from './formatting';
import { officeLayout } from './office-layout';
import {
  documentFonts as officeFonts,
  officeSizes,
  officeSpacing,
  documentAlignments as officeAlignment,
  officeCharts,
  defaultLayout,
  withDocumentLayout,
  rebaseDocumentFormat,
  type DocumentFormat,
  type DocumentLayout,
} from '@ai-xiutu/contracts';
import './document-composer.css';

const alignmentNames = { left: '左对齐', center: '居中对齐', right: '右对齐', justify: '两端对齐' };
const chartNames = { bar: '条形图', line: '折线图' };
const actions = [
  { command: 'heading', label: '小标题', Icon: TextH },
  { command: 'list', label: '项目符号', Icon: ListBullets },
] as const;

function DocumentPreview({
  text,
  layout,
  title,
  charts,
  formatting,
}: {
  text: string;
  layout: DocumentLayout;
  title: string;
  charts: boolean;
  formatting?: DocumentFormat | null;
}) {
  const blocks = useMemo(() => contentBlocks(text), [text]);
  const rich = useMemo(
    () => officeLayout(text, formatting ?? { version: 1, paragraphs: [] }),
    [text, formatting],
  );
  const paragraphStyle = (line: number) => {
    const p = rich.paragraph(line, '');
    return { textAlign: p.align, marginBlockEnd: p.after != null ? p.after + 'pt' : undefined };
  };
  function inline(value: string, line: number) {
    return rich.paragraph(line, value).runs.map(({ text, style }, i) => (
      <span
        key={i}
        style={{
          fontFamily: style.font,
          fontSize: style.size && style.size + 'pt',
          textDecoration: style.underline ? 'underline' : undefined,
        }}
      >
        {style.bold ? (
          <strong>{style.italic ? <em>{text}</em> : text}</strong>
        ) : style.italic ? (
          <em>{text}</em>
        ) : (
          text
        )}
      </span>
    ));
  }
  const graph = useMemo(() => {
    if (!charts) return null;
    try {
      const svg = chartSvg(
        title,
        blocks.filter((block) => block.kind === 'table'),
        layout.chart,
      );
      return { href: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : '文件导出失败。' };
    }
  }, [charts, title, blocks, layout.chart]);
  if (graph)
    return graph.href ? (
      <img className="office-chart-preview" alt={t('图表预览')} src={graph.href} />
    ) : (
      <p role="status">{t(graph.error!)}</p>
    );
  if (!blocks.length) return <p>{t('输入项目说明、参考要求或交付文案…')}</p>;
  let truncated = false;
  return (
    <article
      className="office-prose"
      aria-label={t('排版预览')}
      style={{
        fontFamily: `"${layout.font}", sans-serif`,
        fontSize: layout.size + 'pt',
        lineHeight: layout.line,
        textAlign: layout.align,
      }}
    >
      {blocks.slice(0, 200).map((block) => {
        if (block.kind === 'table') {
          if (block.rows.length > 24 || block.headers.length > 16) truncated = true;
          return (
            <div key={block.line} className="office-table-scroll">
              <table>
                <thead>
                  <tr>
                    {block.headers.slice(0, 16).map((cell, i) => (
                      <th scope="col" key={i}>
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.slice(0, 24).map((row, i) => (
                    <tr key={i}>
                      {row.slice(0, 16).map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.kind === 'heading') {
          const Heading = (['h2', 'h3', 'h4', 'h5', 'h6', 'h6'] as const)[(block.level ?? 1) - 1]!;
          return (
            <Heading
              key={block.line}
              style={{
                ...paragraphStyle(block.line),
                fontSize: headingScales[(block.level ?? 1) - 1] + 'em',
              }}
            >
              {inline(block.text, block.line)}
            </Heading>
          );
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          if (block.items.length > 300) truncated = true;
          return (
            <List key={block.line}>
              {block.items.slice(0, 300).map((item, i) => (
                <li key={i} value={item.number} style={paragraphStyle(block.line + i)}>
                  {inline(item.text, block.line + i)}
                </li>
              ))}
            </List>
          );
        }
        if (block.kind === 'code')
          return (
            <pre key={block.line}>
              <code>{block.text}</code>
            </pre>
          );
        if (block.kind === 'quote')
          return <blockquote key={block.line}>{inline(block.text, block.line)}</blockquote>;
        return block.text.split('\n').map((line, i) => (
          <p key={block.line + i} style={paragraphStyle(block.line + i)}>
            {inline(line, block.line + i)}
          </p>
        ));
      })}
      {(truncated || blocks.length > 200) && (
        <small>{t('预览仅显示部分内容，导出按完整正文处理。')}</small>
      )}
    </article>
  );
}

export function DocumentComposer({
  body,
  title,
  readOnly,
  onChange,
  formatting,
  richEditor,
  onRich,
}: {
  body: string;
  title: string;
  readOnly: boolean;
  formatting?: DocumentFormat | null;
  richEditor?: ReactNode;
  onRich?: () => void;
  onChange: (body: string, formatting: DocumentFormat | null) => boolean;
}) {
  useLocale();
  const layout = formatting?.layout ?? defaultLayout,
    text = body;
  const [mode, setMode] = useState<'edit' | 'preview' | 'chart'>('edit');
  const [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const restoreSelection = useRef<{ text: string; start: number; end: number } | null>(null);
  useEffect(() => {
    setNotice('');
  }, [body]);
  useLayoutEffect(() => {
    const pending = restoreSelection.current;
    if (!pending || !box.current) return;
    restoreSelection.current = null;
    if (pending.text === text) {
      box.current.focus({ preventScroll: true });
      box.current.setSelectionRange(pending.start, pending.end);
    }
  }, [text]);
  const update = (value: string, style: DocumentLayout) => {
    if (value.length > 100000) {
      setNotice('文字超过草稿保留范围，本次输入未应用。');
      return false;
    }
    return onChange(
      value,
      withDocumentLayout(rebaseDocumentFormat(text, value, formatting), style),
    );
  };
  function apply(command: FormatCommand) {
    const input = box.current;
    if (readOnly || !input) return;
    const change = editSelection(text, input.selectionStart, input.selectionEnd, command);
    if (change && update(change.text, layout)) restoreSelection.current = change;
  }
  function setView(next: 'edit' | 'preview' | 'chart') {
    setMode(mode === next ? 'edit' : next);
  }
  return (
    <section className="office-composer" aria-label={t('文档内容与排版')}>
      <div className="office-toolbar" role="group" aria-label={t('文字格式')}>
        {mode === 'edit' && onRich && !readOnly && (
          <button type="button" onClick={onRich}>
            {t('文字排版')}
          </button>
        )}
        {mode === 'edit' &&
          !richEditor &&
          !readOnly &&
          actions.map(({ command, label, Icon }) => (
            <button
              key={command}
              type="button"
              aria-label={t(label)}
              title={t(label)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(command)}
            >
              <Icon size={18} />
            </button>
          ))}
        {!readOnly && (
          <button
            type="button"
            aria-label={t('排版设置')}
            title={t('排版设置')}
            aria-expanded={settings}
            onClick={() => setSettings(!settings)}
          >
            <SlidersHorizontal size={18} />
          </button>
        )}
        <button
          type="button"
          aria-pressed={mode === 'preview'}
          aria-label={t('排版预览')}
          onClick={() => setView('preview')}
        >
          {mode === 'preview' ? <PencilSimple size={17} /> : <Eye size={17} />}
          {mode === 'preview' ? t('编辑正文') : t('预览')}
        </button>
        <button
          type="button"
          aria-label={t('图表预览')}
          title={t('图表预览')}
          aria-pressed={mode === 'chart'}
          onClick={() => setView('chart')}
        >
          <ChartLine size={18} />
        </button>
      </div>
      {settings && !readOnly && (
        <div className="office-settings">
          <label>
            {t('全文字体')}
            <select
              aria-label={t('全文字体')}
              value={layout.font}
              onChange={(e) =>
                update(text, { ...layout, font: officeFonts[e.target.selectedIndex]! })
              }
            >
              {officeFonts.map((font) => (
                <option key={font}>{font}</option>
              ))}
            </select>
          </label>
          <label>
            {t('正文字号')}
            <select
              aria-label={t('正文字号')}
              value={layout.size}
              onChange={(e) =>
                update(text, { ...layout, size: officeSizes[e.target.selectedIndex]! })
              }
            >
              {officeSizes.map((size) => (
                <option key={size} value={size}>
                  {size} pt
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('行距')}
            <select
              aria-label={t('行距')}
              value={layout.line}
              onChange={(e) =>
                update(text, { ...layout, line: officeSpacing[e.target.selectedIndex]! })
              }
            >
              {officeSpacing.map((line) => (
                <option key={line} value={line}>
                  {line}×
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('全文对齐')}
            <select
              aria-label={t('全文对齐')}
              value={layout.align}
              onChange={(e) =>
                update(text, { ...layout, align: officeAlignment[e.target.selectedIndex]! })
              }
            >
              {officeAlignment.map((align) => (
                <option key={align} value={align}>
                  {t(alignmentNames[align])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('图表类型')}
            <select
              aria-label={t('图表类型')}
              value={layout.chart}
              onChange={(e) =>
                update(text, { ...layout, chart: officeCharts[e.target.selectedIndex]! })
              }
            >
              {officeCharts.map((chart) => (
                <option key={chart} value={chart}>
                  {t(chartNames[chart])}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {richEditor && <div hidden={mode !== 'edit'}>{richEditor}</div>}
      {mode === 'edit' ? (
        !richEditor && (
          <textarea
            ref={box}
            aria-label={t('文档内容')}
            placeholder={t('输入项目说明、参考要求或交付文案…')}
            value={text}
            readOnly={readOnly}
            maxLength={100000}
            onKeyDown={(event) => {
              if (
                readOnly ||
                event.nativeEvent.isComposing ||
                event.altKey ||
                event.shiftKey ||
                !(event.ctrlKey || event.metaKey)
              )
                return;
              const key = event.key.toLowerCase();
              if (key === 'b' || key === 'i') {
                event.preventDefault();
                apply(key === 'b' ? 'bold' : 'italic');
              }
            }}
            onChange={(e) => update(e.target.value, layout)}
          />
        )
      ) : (
        <DocumentPreview
          formatting={formatting}
          text={text}
          title={title}
          layout={layout}
          charts={mode === 'chart'}
        />
      )}
      {notice && <p role="alert">{t(notice)}</p>}
    </section>
  );
}
