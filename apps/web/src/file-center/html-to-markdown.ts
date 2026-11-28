import { cleanText } from './convert';

/**
 * Converts an HTML page to the project's Markdown-based document format using
 * the browser's inert DOMParser (scripts never run, nothing is fetched). Keeps
 * headings, paragraphs, lists, block quotes, code, tables, emphasis and http(s)
 * links; drops scripts, styles, forms and media.
 */
export function htmlToMarkdown(html: string): { title: string; body: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,template,iframe,object,embed,form,svg,canvas,video,audio').forEach((n) => n.remove());
  const lines: string[] = [];
  const text = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
    if (!(node instanceof Element)) return '';
    const inner = [...node.childNodes].map(text).join('');
    const tag = node.tagName.toLowerCase();
    if (tag === 'strong' || tag === 'b') return inner.trim() ? `**${inner.trim()}**` : '';
    if (tag === 'em' || tag === 'i') return inner.trim() ? `*${inner.trim()}*` : '';
    if (tag === 'code') return '`' + inner.replace(/`/g, "'") + '`';
    if (tag === 'br') return ' ';
    if (tag === 'a') {
      const href = node.getAttribute('href') ?? '';
      return /^https?:\/\//i.test(href) && inner.trim() ? `[${inner.trim()}](${href})` : inner;
    }
    return inner;
  };
  const block = (node: Element) => {
    const tag = node.tagName.toLowerCase();
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) return void lines.push('#'.repeat(Number(heading[1])) + ' ' + text(node).trim(), '');
    if (tag === 'p') {
      const value = text(node).trim();
      if (value) lines.push(value, '');
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      [...node.children].filter((c) => c.tagName === 'LI').forEach((li, i) => lines.push((tag === 'ol' ? `${i + 1}. ` : '- ') + text(li).trim()));
      lines.push('');
      return;
    }
    if (tag === 'blockquote') return void lines.push('> ' + text(node).trim(), '');
    if (tag === 'pre') return void lines.push('```', (node.textContent ?? '').replace(/\n$/, ''), '```', '');
    if (tag === 'hr') return void lines.push('---', '');
    if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map((tr) =>
        [...tr.querySelectorAll('th,td')].map((cell) => text(cell).trim().replace(/\|/g, '｜')),
      );
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
        lines.push('| ' + pad(rows[0]!).join(' | ') + ' |', '| ' + Array(width).fill('---').join(' | ') + ' |');
        rows.slice(1).forEach((r) => lines.push('| ' + pad(r).join(' | ') + ' |'));
        lines.push('');
      }
      return;
    }
    // Containers: recurse into block children; loose text becomes a paragraph.
    const blocks = [...node.children].some((c) => /^(P|H[1-6]|UL|OL|TABLE|PRE|BLOCKQUOTE|DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|NAV|ASIDE|HR)$/.test(c.tagName));
    if (blocks) [...node.children].forEach(block);
    else {
      const value = text(node).trim();
      if (value) lines.push(value, '');
    }
  };
  if (doc.body) [...doc.body.children].forEach(block);
  const body = cleanText(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
  return { title: (doc.title || '').trim().slice(0, 120), body };
}

/** Preview wrapper: a strict CSP blocks scripts and every network request from the page. */
export function sandboxedHtml(html: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + csp) : csp + html;
}
