import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Check, TextB, TextItalic } from '@phosphor-icons/react';
import { t } from '../i18n';
import { IconButton } from './Ui';
import { sketchFonts, sketchTextRuns, type SketchText, type SketchTextRun, type SketchTextStyle } from './sketch-document';

export type SketchTextHandle = { read: () => SketchText };
const same = (a: SketchTextStyle, b: SketchTextStyle) =>
  a.color === b.color && a.size === b.size && a.family === b.family && a.weight === b.weight && a.italic === b.italic;

function readRuns(node: Node, inherited: SketchTextStyle, result: SketchTextRun[] = []) {
  if (node instanceof Text || node instanceof HTMLBRElement) {
    const text = node instanceof Text ? node.data : '\n';
    const last = result.at(-1);
    if (last && same(last.style, inherited)) last.text += text;
    else if (text) result.push({ text, style: inherited });
  } else {
    const style = node instanceof HTMLElement && node.dataset.sketchStyle
      ? JSON.parse(node.dataset.sketchStyle) as SketchTextStyle : inherited;
    node.childNodes.forEach((child) => readRuns(child, style, result));
  }
  return result;
}

function replaceRuns(node: HTMLElement, runs: SketchTextRun[]) {
  node.replaceChildren(...runs.map(({ text, style }) => {
    const span = document.createElement('span');
    span.dataset.sketchStyle = JSON.stringify(style);
    span.textContent = text;
    Object.assign(span.style, {
      fontFamily: sketchFonts[style.family],
      fontSize: style.size + 'px',
      fontWeight: String(style.weight),
      fontStyle: style.italic ? 'italic' : 'normal',
      color: style.color,
    });
    return span;
  }));
}

export function SketchTextEditor({ item, ref, onDone }: { item: SketchText; ref: Ref<SketchTextHandle>; onDone: () => void }) {
  const field = useRef<HTMLDivElement>(null);
  const initial = sketchTextRuns(item)[0]?.style ?? { color: item.color, size: item.size, family: 'sans', weight: 600, italic: false };
  const [style, setStyle] = useState(initial);
  const selected = useRef<[number, number] | null>(null);
  const selectionStart = useRef(0);
  function saveRange() {
    const selection = window.getSelection();
    const node = field.current;
    if (!selection?.rangeCount || !node) return;
    const range = selection.getRangeAt(0);
    if (!node.contains(range.commonAncestorContainer)) return;
    const before = document.createRange();
    before.selectNodeContents(node);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    selectionStart.current = start;
    selected.current = range.collapsed ? null : [start, start + range.toString().length];
    const runs = readRuns(node, style);
    let offset = 0;
    for (const run of runs) {
      offset += run.text.length;
      if (offset > start) { setStyle(run.style); break; }
    }
  }
  function restoreRange(start: number, end: number) {
    const node = field.current!;
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    range.selectNodeContents(node);
    let offset = 0;
    let started = false;
    for (let child = walk.nextNode(); child; child = walk.nextNode()) {
      const length = child.textContent?.length ?? 0;
      if (!started && start <= offset + length) {
        range.setStart(child, start - offset);
        started = true;
      }
      if (end <= offset + length) { range.setEnd(child, end - offset); break; }
      offset += length;
    }
    if (!started) range.collapse(false);
    node.focus({ preventScroll: true });
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }
  function format(change: Partial<SketchTextStyle>, focus = true) {
    const node = field.current!;
    const runs = readRuns(node, style);
    const [start, end] = selected.current ?? [0, Infinity];
    const next: SketchTextRun[] = [];
    let offset = 0;
    for (const run of runs) {
      const left = Math.max(0, Math.min(run.text.length, start - offset));
      const right = Math.max(left, Math.min(run.text.length, end - offset));
      if (left) next.push({ text: run.text.slice(0, left), style: run.style });
      if (right > left) next.push({ text: run.text.slice(left, right), style: { ...run.style, ...change } });
      if (right < run.text.length) next.push({ text: run.text.slice(right), style: run.style });
      offset += run.text.length;
    }
    setStyle({ ...style, ...change });
    replaceRuns(node, next);
    if (focus) restoreRange(...(selected.current ?? [selectionStart.current, selectionStart.current]));
  }
  useLayoutEffect(() => {
    const node = field.current!;
    replaceRuns(node, sketchTextRuns(item));
    restoreRange(item.text.length, item.text.length);
  }, [item]);
  useImperativeHandle(ref, () => ({
    read() {
      const runs = readRuns(field.current!, style);
      const text = runs.map((run) => run.text).join('');
      return { ...item, text, runs, color: style.color, size: style.size };
    },
  }));
  return (
    <div className="sketch-text-anchor" style={{ left: (item.at.x * 100) + '%', top: (item.at.y * 100) + '%' }} data-edge={item.at.x > 0.65} data-top={item.at.y < 0.16}>
      <div className="sketch-text-format" role="group" aria-label={t('草图文字样式')} onPointerDownCapture={saveRange}>
        <select aria-label={t('字体')} value={style.family} onChange={(e) => format({ family: e.target.value as SketchTextStyle['family'] })}>
          <option value="sans">{t('无衬线')}</option>
          <option value="serif">{t('衬线')}</option>
          <option value="mono">{t('等宽')}</option>
        </select>
        <input type="number" aria-label={t('字号')} min={8} max={150} step={1} value={Math.round(style.size)} onChange={(e) => { if (Number.isFinite(e.target.valueAsNumber)) format({ size: Math.max(8, Math.min(150, e.target.valueAsNumber)) }, false); }} />
        <input type="color" aria-label={t('文字颜色')} value={style.color.slice(0, 7)} onChange={(e) => format({ color: e.target.value }, false)} />
        <IconButton label={t('粗体')} aria-pressed={style.weight >= 650} onClick={() => format({ weight: style.weight >= 650 ? 400 : 750 })}><TextB size={16} /></IconButton>
        <IconButton label={t('斜体')} aria-pressed={style.italic} onClick={() => format({ italic: !style.italic })}><TextItalic size={16} /></IconButton>
        <IconButton label={t('完成文字')} onClick={onDone}><Check size={16} /></IconButton>
      </div>
      <div
        ref={field}
        className="sketch-text-input"
        role="textbox"
        aria-label={t('草图文字')}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={t('输入文字')}
        style={{ color: style.color, fontSize: style.size, fontFamily: sketchFonts[style.family], fontWeight: style.weight, fontStyle: style.italic ? 'italic' : 'normal' }}
        onMouseUp={saveRange}
        onKeyUp={saveRange}
        onBeforeInput={(event) => {
          const data = (event.nativeEvent as InputEvent).data;
          const length = field.current?.textContent?.length ?? 0;
          if (data && length + data.length - (window.getSelection()?.toString().length ?? 0) > 600) event.preventDefault();
        }}
        onPaste={(event) => {
          event.preventDefault();
          const remaining = Math.max(0, 600 - (field.current?.textContent?.length ?? 0));
          document.execCommand('insertText', false, event.clipboardData.getData('text/plain').slice(0, remaining));
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) onDone();
            else if ((field.current?.textContent?.length ?? 0) < 600) document.execCommand('insertText', false, '\n');
          }
        }}
      />
    </div>
  );
}
