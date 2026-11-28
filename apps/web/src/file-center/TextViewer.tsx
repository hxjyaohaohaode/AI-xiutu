import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MagnifyingGlass, CaretUp, CaretDown, TextAlignLeft } from '@phosphor-icons/react';
import { t } from '../i18n';
import { formatBytes, LIMITS } from './kinds';

/**
 * Text and code viewer for files of any size. The file is decoded in windows
 * (LIMITS.textWindow at a time) with a streaming decoder, so a 2 GB log opens
 * instantly and loads further on request; only the visible lines are rendered.
 */

const LINE = 20;

export async function sniffEncoding(head: Uint8Array): Promise<string> {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8';
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  // Trim a possibly split trailing UTF-8 sequence before the strict check.
  let end = head.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = head[end - i]!;
    if ((b & 0xc0) === 0xc0) {
      end -= i;
      break;
    }
    if ((b & 0x80) === 0) break;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, end));
    return 'utf-8';
  } catch {
    return 'gb18030';
  }
}

/** True when the first bytes look like text (no NUL, few control characters). */
export function looksLikeText(head: Uint8Array) {
  if (!head.length) return true;
  let control = 0;
  for (const b of head.subarray(0, 4096)) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / Math.min(head.length, 4096) < 0.02;
}

const keywords =
  /^(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|new|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|interface|type|enum|public|private|protected|static|readonly|def|lambda|pass|yield|with|as|elif|None|True|False|null|undefined|true|false|this|self|package|struct|impl|fn|mut|pub|use|mod|match|go|func|defer|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|GROUP|ORDER|BY|LIMIT)$/;
const token = /(\/\/.*$|#(?![0-9a-f]{3,8}\b).*$|--\s.*$|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w$]*\b)/g;

/** Light, line-local highlighting: comments, strings, numbers, keywords. */
function highlight(line: string, code: boolean): ReactNode {
  if (!code || line.length > 2000) return line || ' ';
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(token)) {
    const text = m[0];
    const i = m.index!;
    if (i > last) out.push(line.slice(last, i));
    const cls = /^(\/\/|#|--|\/\*)/.test(text) ? 'c' : /^["'`]/.test(text) ? 's' : /^\d/.test(text) ? 'n' : keywords.test(text) ? 'k' : '';
    out.push(cls ? <span key={i} className={'tk-' + cls}>{text}</span> : text);
    last = i + text.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out.length ? out : ' ';
}

export function TextViewer({ blob, code, onMeta }: { blob: Blob; code: boolean; onMeta?: (meta: Record<string, string>) => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [wrap, setWrap] = useState(false);
  const decoder = useRef<TextDecoder | null>(null);
  const carry = useRef('');
  const scroller = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ from: 0, to: 80 });
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState(0);
  const [finding, setFinding] = useState(false);

  async function loadNext(start: number) {
    setLoading(true);
    const end = Math.min(blob.size, start + LIMITS.textWindow);
    const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
    if (!decoder.current) {
      const encoding = await sniffEncoding(bytes);
      decoder.current = new TextDecoder(encoding);
      onMeta?.({ 编码: encoding.toUpperCase() });
    }
    const text = carry.current + decoder.current.decode(bytes, { stream: end < blob.size }).replace(/\r\n?/g, '\n');
    const parts = text.split('\n');
    carry.current = end < blob.size ? parts.pop() ?? '' : '';
    setLines((prev) => (start === 0 ? parts : [...prev, ...parts]));
    setLoaded(end);
    setLoading(false);
  }
  useEffect(() => {
    decoder.current = null;
    carry.current = '';
    setLines([]);
    void loadNext(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);
  useEffect(() => {
    if (!loading) onMeta?.({ 行数: lines.length.toLocaleString() + (loaded < blob.size ? '+' : '') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const matches = useMemo(() => {
    if (!query) return [];
    const needle = query.toLocaleLowerCase();
    const out: number[] = [];
    for (let i = 0; i < lines.length && out.length < 5000; i++) if (lines[i]!.toLocaleLowerCase().includes(needle)) out.push(i);
    return out;
  }, [lines, query]);
  const active = matches.length ? matches[Math.min(hit, matches.length - 1)] : -1;
  useEffect(() => {
    if (active < 0 || !scroller.current) return;
    scroller.current.scrollTop = Math.max(0, active * LINE - scroller.current.clientHeight / 3);
  }, [active]);

  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const from = Math.max(0, Math.floor(el.scrollTop / LINE) - 40);
    setRange({ from, to: from + Math.ceil(el.clientHeight / LINE) + 80 });
  };
  useLayoutEffect(measure, [lines.length]);

  const gutter = String(lines.length).length;
  const visible = wrap ? lines.slice(0, 3000) : lines.slice(range.from, range.to);
  const offset = wrap ? 0 : range.from;
  return (
    <div className="fc-text">
      <div className="fc-text-bar">
        <span>
          {loaded < blob.size
            ? t('已载入 {v0} / {v1}', { v0: formatBytes(loaded), v1: formatBytes(blob.size) })
            : t('{v0} 行', { v0: lines.length.toLocaleString() })}
        </span>
        <button type="button" aria-pressed={finding} onClick={() => setFinding(!finding)}>
          <MagnifyingGlass size={15} />
          {t('查找')}
        </button>
        <button type="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)} title={wrap ? undefined : t('自动换行时最多显示 3000 行')}>
          <TextAlignLeft size={15} />
          {t('自动换行')}
        </button>
      </div>
      {finding && (
        <div className="fc-find" role="search">
          <input
            autoFocus
            type="search"
            value={query}
            placeholder={t('在已载入的内容中查找')}
            aria-label={t('查找')}
            onChange={(e) => {
              setQuery(e.target.value);
              setHit(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setHit((h) => (matches.length ? (h + (e.shiftKey ? matches.length - 1 : 1)) % matches.length : 0));
            }}
          />
          <span aria-live="polite">{query ? (matches.length ? `${Math.min(hit, matches.length - 1) + 1} / ${matches.length}` : t('无结果')) : ''}</span>
          <button type="button" aria-label={t('上一个')} disabled={!matches.length} onClick={() => setHit((h) => (h + matches.length - 1) % matches.length)}>
            <CaretUp size={14} />
          </button>
          <button type="button" aria-label={t('下一个')} disabled={!matches.length} onClick={() => setHit((h) => (h + 1) % matches.length)}>
            <CaretDown size={14} />
          </button>
        </div>
      )}
      <div ref={scroller} className={'fc-code' + (wrap ? ' is-wrap' : '')} onScroll={wrap ? undefined : measure} tabIndex={0} aria-label={t('文件内容')}>
        <div style={wrap ? undefined : { height: lines.length * LINE, position: 'relative' }}>
          <div style={wrap ? undefined : { transform: `translateY(${offset * LINE}px)` }}>
            {visible.map((line, i) => {
              const n = offset + i;
              return (
                <div key={n} className={'fc-line' + (n === active ? ' is-hit' : '')} style={{ ['--gutter' as string]: `${gutter + 1}ch` }}>
                  <i aria-hidden>{n + 1}</i>
                  <span>{highlight(line, code)}</span>
                </div>
              );
            })}
          </div>
        </div>
        {loaded < blob.size && (
          <button type="button" className="fc-more" disabled={loading} onClick={() => void loadNext(loaded)}>
            {loading ? t('读取中') : t('继续载入 {v0}', { v0: formatBytes(Math.min(LIMITS.textWindow, blob.size - loaded)) })}
          </button>
        )}
      </div>
    </div>
  );
}
