import { memo, useState, type ReactNode } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { messageBlocks, messageLink } from './message-format';
import './assistant-reading.css';

function inline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const tokens = /`[^`\n]+`|\*\*[^*\n]+\*\*|(?<!!)\[[^\]\n]+\]\([^\s)]+\)/g;
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    if (match.index > cursor) result.push(text.slice(cursor, match.index));
    const value = match[0];
    if (value.startsWith('`')) result.push(<code key={match.index}>{value.slice(1, -1)}</code>);
    else if (value.startsWith('**'))
      result.push(<strong key={match.index}>{value.slice(2, -2)}</strong>);
    else {
      const split = value.indexOf('](');
      const href = messageLink(value.slice(split + 2, -1));
      result.push(
        href ? (
          <a key={match.index} href={href} target="_blank" rel="noreferrer noopener">
            {value.slice(1, split)}
          </a>
        ) : (
          value
        ),
      );
    }
    cursor = match.index + value.length;
  }
  if (cursor < text.length) result.push(text.slice(cursor));
  return result;
}

/** Keeps the message owner mounted while streaming. No HTML, remote images or executable UI. */
export const AssistantText = memo(function AssistantText({ text }: { text: string }) {
  return (
    <div className="assistant-prose">
      {messageBlocks(text).map((block) => {
        const key = `${block.line}:${block.kind}`;
        if (block.kind === 'code')
          return (
            <div className="assistant-code" key={key}>
              {block.language && <span className="assistant-code-language">{block.language}</span>}
              <pre tabIndex={0}>
                <code>{block.text}</code>
              </pre>
            </div>
          );
        if (block.kind === 'heading') return <h4 key={key}>{inline(block.text)}</h4>;
        if (block.kind === 'quote') return <blockquote key={key}>{inline(block.text)}</blockquote>;
        if (block.kind === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag key={key}>
              {block.items.map((item, index) => (
                <li key={index} value={item.number}>
                  {inline(item.text)}
                </li>
              ))}
            </Tag>
          );
        }
        if (block.kind === 'table')
          return (
            <div key={key} className="assistant-table-scroll" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, index) => (
                      <th key={index} scope="col">
                        {inline(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, column) => (
                        <td key={column}>{inline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return <p key={key}>{inline(block.text)}</p>;
      })}
    </div>
  );
});

export function CopyMessage({ text }: { text: string }) {
  const locale = useLocale();
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const copied = copiedText === text;
  const copy =
    locale === 'en'
      ? { action: 'Copy response', done: 'Copied', failed: 'Select the text to copy.' }
      : locale === 'zh-TW'
        ? { action: '複製回覆', done: '已複製', failed: '請選取文字後複製。' }
        : { action: '复制回复', done: '已复制', failed: '请选中文字后复制。' };
  return (
    <div className="assistant-message-actions">
      <button
        type="button"
        aria-label={copied ? copy.done : copy.action}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopiedText(text);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        <span>{copied ? copy.done : copy.action}</span>
      </button>
      {failed && <span role="status">{copy.failed}</span>}
    </div>
  );
}
