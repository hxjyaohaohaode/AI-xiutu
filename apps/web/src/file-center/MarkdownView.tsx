import { Fragment, type ReactNode } from 'react';
import { messageBlocks, messageLink } from '@ai-xiutu/contracts/office-data';
import { formattedRuns } from '../project-files/formatting';

/**
 * Safe Markdown rendering: parsed into blocks and rendered as React elements.
 * No HTML from the file is ever injected; links are limited to http(s)/mailto
 * and open in a new tab without a referrer.
 */
function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  // [label](url) links first, then the shared bold/italic/code subset.
  let rest = text,
    key = 0;
  const link = /\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/;
  while (rest) {
    const match = link.exec(rest);
    const before = match ? rest.slice(0, match.index) : rest;
    for (const run of formattedRuns(before)) {
      const node = run.code ? <code>{run.text}</code> : run.text;
      parts.push(
        <Fragment key={key++}>
          {run.bold && run.italic ? <strong><em>{node}</em></strong> : run.bold ? <strong>{node}</strong> : run.italic ? <em>{node}</em> : node}
        </Fragment>,
      );
    }
    if (!match) break;
    const href = messageLink(match[2]!) ?? (/^mailto:/.test(match[2]!) ? match[2]! : null);
    parts.push(
      href ? (
        <a key={key++} href={href} target="_blank" rel="noopener noreferrer nofollow">{match[1]}</a>
      ) : (
        <Fragment key={key++}>{match[0]}</Fragment>
      ),
    );
    rest = rest.slice(match.index + match[0].length);
  }
  return parts;
}

export function MarkdownView({ text }: { text: string }) {
  const lines = text.split(/\r\n?|\n/);
  return (
    <div className="md-view">
      {messageBlocks(text, 24).map((block, i) => {
        if (block.kind === 'heading') {
          const level = Math.min(6, (/^\s{0,3}(#{1,6})/.exec(lines[block.line] ?? '')?.[1]?.length ?? 2));
          const Tag = `h${level}` as 'h1';
          return <Tag key={i}>{inline(block.text)}</Tag>;
        }
        if (block.kind === 'code')
          return (
            <pre key={i} data-language={block.language || undefined}>
              <code>{block.text}</code>
            </pre>
          );
        if (block.kind === 'quote') return <blockquote key={i}>{inline(block.text)}</blockquote>;
        if (block.kind === 'list') {
          const items = block.items.map((item, j) => {
            const check = /^\[([ xX])\]\s+(.*)$/.exec(item.text);
            return (
              <li key={j} className={check ? 'md-check' : undefined}>
                {check ? (
                  <>
                    <input type="checkbox" checked={check[1] !== ' '} readOnly tabIndex={-1} aria-hidden />
                    {inline(check[2]!)}
                  </>
                ) : (
                  inline(item.text)
                )}
              </li>
            );
          });
          return block.ordered ? <ol key={i} start={block.items[0]?.number}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        if (block.kind === 'table')
          return (
            <div key={i} className="md-table">
              <table>
                <thead>
                  <tr>{block.headers.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r}>{row.map((cell, c) => <td key={c}>{inline(cell)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return (
          <p key={i}>
            {block.text.split('\n').map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
