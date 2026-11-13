import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
import {
  Check, TextAlignCenter, TextAlignLeft, TextAlignRight, TextB, TextItalic, TextUnderline, X,
} from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import { ChoiceSelect } from './ChoiceSelect';
import { WarmTooltip } from './control-motion';
import { IconButton } from './Ui';
import {
  defaultSketchTextLayout, sketchTextRuns, type SketchText, type SketchTextLayout, type SketchTextRun, type SketchTextStyle,
} from './sketch-document';
import { loadSketchFont, sketchFamily, sketchFontIds, sketchFonts, sketchFontWeight } from './sketch-typography';
import './sketch-fonts.css';
import './sketch-text.css';

export type SketchTextHandle = { read: () => SketchText };
const textLimit = 600;
const alignment = [
  ['left', '左对齐', TextAlignLeft],
  ['center', '居中对齐', TextAlignCenter],
  ['right', '右对齐', TextAlignRight],
] as const;
const weights = [
  [400, '常规'],
  [500, '中等'],
  [600, '半粗'],
  [700, '粗体'],
  [900, '特粗'],
] as const;

const sameStyle = (a: SketchTextStyle, b: SketchTextStyle) =>
  a.color === b.color && a.size === b.size && a.family === b.family && a.weight === b.weight &&
  a.italic === b.italic && !!a.underline === !!b.underline;

function appendRun(runs: SketchTextRun[], text: string, style: SketchTextStyle) {
  if (!text) return;
  const last = runs.at(-1);
  if (last && sameStyle(last.style, style)) last.text += text;
  else runs.push({ text, style });
}

function readRuns(node: Node, inherited: SketchTextStyle, result: SketchTextRun[] = []) {
  if (node instanceof Text || node instanceof HTMLBRElement) {
    appendRun(result, node instanceof Text ? node.data : '\n', inherited);
    return result;
  }
  const style = node instanceof HTMLElement && node.dataset.sketchStyle
    ? JSON.parse(node.dataset.sketchStyle) as SketchTextStyle : inherited;
  node.childNodes.forEach((child, index) => {
    const block = child instanceof HTMLElement && (child.tagName === 'DIV' || child.tagName === 'P');
    if (block && index > 0) appendRun(result, '\n', style);
    if (block && child.childNodes.length === 1 && child.firstChild instanceof HTMLBRElement) return;
    readRuns(child, style, result);
    if (block && child.nextSibling && child.nextSibling instanceof Text) appendRun(result, '\n', style);
  });
  return result;
}

function runAppearance(style: SketchTextStyle): CSSProperties {
  return {
    fontFamily: sketchFamily(style.family),
    fontSize: style.size,
    fontWeight: style.weight,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecorationLine: style.underline ? 'underline' : 'none',
    color: style.color,
  };
}

function runNode(text: string, style: SketchTextStyle) {
  const span = document.createElement('span');
  span.dataset.sketchStyle = JSON.stringify(style);
  span.textContent = text;
  Object.assign(span.style, runAppearance(style), { fontSize: style.size + 'px' });
  return span;
}

function replaceRuns(node: HTMLElement, runs: SketchTextRun[]) {
  node.replaceChildren(...runs.filter(({ text }) => text).map(({ text, style }) => runNode(text, style)));
}

function textOffset(field: HTMLElement, container: Node, offset: number) {
  const before = document.createRange();
  before.selectNodeContents(field);
  before.setEnd(container, offset);
  const fragment = document.createElement('div');
  fragment.append(before.cloneContents());
  const fallback = { family: 'sans', color: '#000000', size: 12, weight: 400, italic: false } as const;
  return readRuns(fragment, fallback).reduce((length, run) => length + run.text.length, 0);
}

function restoreRange(field: HTMLElement, start: number, end: number) {
  const length = field.textContent?.length ?? 0;
  start = Math.min(start, length);
  end = Math.min(end, length);
  const walk = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  range.selectNodeContents(field);
  let offset = 0;
  let started = false;
  for (let child = walk.nextNode(); child; child = walk.nextNode()) {
    const length = child.textContent?.length ?? 0;
    if (!started && start <= offset + length) {
      range.setStart(child, start - offset);
      started = true;
    }
    if (end <= offset + length) {
      range.setEnd(child, end - offset);
      break;
    }
    offset += length;
  }
  if (!started) range.collapse(false);
  field.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function NumericField({ label, unit, value, min, max, step = 1, onChange }: {
  label: string; unit?: string; value: number; min: number; max: number; step?: number;
  onChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const apply = (number: number) => onChange(Math.min(max, Math.max(min, number)));
  return (
    <label className="sketch-number">
      <span>{label}</span>
      <WarmTooltip content={label} placement="bottom">
        <input type="number" aria-label={label} min={min} max={max} step={step}
          value={editing ?? Number(value.toFixed(2))}
          onChange={(event) => {
            const { value: next, valueAsNumber } = event.currentTarget;
            setEditing(next);
            if (Number.isFinite(valueAsNumber) && valueAsNumber >= min && valueAsNumber <= max)
              onChange(valueAsNumber);
          }}
          onBlur={(event) => {
            if (Number.isFinite(event.currentTarget.valueAsNumber)) apply(event.currentTarget.valueAsNumber);
            setEditing(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur();
          }}
        />
      </WarmTooltip>
      {unit && <span aria-hidden="true">{unit}</span>}
    </label>
  );
}

export function SketchTextEditor({ item, ref, onDone, onCancel }: {
  item: SketchText;
  ref: Ref<SketchTextHandle>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const locale = useLocale();
  const field = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState(() => sketchTextRuns(item)[0]?.style ?? {
    family: 'sans', color: item.color, size: item.size, weight: 600, italic: false,
  });
  const [layout, setLayout] = useState(() => item.layout ?? defaultSketchTextLayout);
  const selection = useRef<[number, number]>([item.text.length, item.text.length]);
  const textStyle = useRef(style);
  textStyle.current = style;
  const fontOptions = useMemo(() => sketchFontIds.map((font) => ({
    value: font,
    label: t(sketchFonts[font].label),
  })), [locale]);
  const fontWeights = Array.from(new Set([...weights.map(([weight]) => sketchFontWeight(style.family, weight)), style.weight]))
    .sort((a, b) => a - b).map((weight) => {
      const name = weights.find(([value]) => value === weight)?.[1];
      return { value: String(weight), label: name ? t(name) + ' ' + weight : String(weight) };
    });

  function saveRange() {
    const node = field.current;
    const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
    if (!node || !range || !node.contains(range.commonAncestorContainer)) return;
    const start = textOffset(node, range.startContainer, range.startOffset);
    selection.current = [start, textOffset(node, range.endContainer, range.endOffset)];
    const styleElement = (range.startContainer instanceof HTMLElement
      ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>('[data-sketch-style]');
    if (styleElement && node.contains(styleElement)) {
      const selectedStyle = JSON.parse(styleElement.dataset.sketchStyle!) as SketchTextStyle;
      setStyle(selectedStyle);
    }
  }

  function format(change: Partial<SketchTextStyle>, focus = true) {
    const node = field.current!;
    const [start, end] = selection.current;
    const next: SketchTextRun[] = [];
    let offset = 0;
    for (const run of readRuns(node, textStyle.current)) {
      const left = start === end ? 0 : Math.max(0, Math.min(run.text.length, start - offset));
      const right = start === end ? run.text.length : Math.max(left, Math.min(run.text.length, end - offset));
      appendRun(next, run.text.slice(0, left), run.style);
      appendRun(next, run.text.slice(left, right), { ...run.style, ...change });
      appendRun(next, run.text.slice(right), run.style);
      offset += run.text.length;
    }
    setStyle({ ...textStyle.current, ...change });
    replaceRuns(node, next);
    if (focus) restoreRange(node, start, end);
  }

  function insertPlain(text: string) {
    const node = field.current!;
    const active = window.getSelection();
    if (!active?.rangeCount || !node.contains(active.getRangeAt(0).commonAncestorContainer)) return;
    const range = active.getRangeAt(0);
    const remaining = textLimit - (node.textContent?.length ?? 0) + range.toString().length;
    const value = text.replace(/\r\n?/g, '\n').slice(0, Math.max(0, remaining));
    if (!value) return;
    const at = textOffset(node, range.startContainer, range.startOffset);
    const inserted = document.createTextNode(value);
    range.deleteContents();
    range.insertNode(inserted);
    range.setStart(inserted, inserted.length);
    range.collapse(true);
    active.removeAllRanges();
    active.addRange(range);
    selection.current = [at + value.length, at + value.length];
  }

  useLayoutEffect(() => {
    const node = field.current!;
    replaceRuns(node, sketchTextRuns(item));
    restoreRange(node, item.text.length, item.text.length);
    const selectionChanged = () => {
      if (document.activeElement === node) saveRange();
    };
    document.addEventListener('selectionchange', selectionChanged);
    const normalizeBlocks = () => {
      if (!node.querySelector('div, p, br')) return;
      const current = window.getSelection();
      const range = current?.rangeCount ? current.getRangeAt(0) : null;
      const start = range && node.contains(range.startContainer)
        ? textOffset(node, range.startContainer, range.startOffset) : node.textContent?.length ?? 0;
      const runs = readRuns(node, textStyle.current);
      replaceRuns(node, runs);
      restoreRange(node, start, start);
      selection.current = [start, start];
    };
    const input = (event: InputEvent) => {
      if (event.isComposing) return;
      if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
        event.preventDefault();
        insertPlain('\n');
      } else if (event.inputType.startsWith('format')) {
        event.preventDefault();
      } else if (event.data && (node.textContent?.length ?? 0) + event.data.length -
        (window.getSelection()?.toString().length ?? 0) > textLimit) {
        event.preventDefault();
      }
    };
    const afterInput = (event: Event) => {
      if (!(event as InputEvent).isComposing) normalizeBlocks();
    };
    node.addEventListener('beforeinput', input);
    node.addEventListener('input', afterInput);
    node.addEventListener('compositionend', normalizeBlocks);
    return () => {
      document.removeEventListener('selectionchange', selectionChanged);
      node.removeEventListener('beforeinput', input);
      node.removeEventListener('input', afterInput);
      node.removeEventListener('compositionend', normalizeBlocks);
    };
  }, [item]);

  useLayoutEffect(() => {
    const frame = layer.current!;
    const toolbar = panel.current!;
    const node = field.current!;
    const drawing = frame.closest('.drawing-modal');
    const drawingTools = drawing?.querySelector('.drawing-tool-area');
    const drawingActions = drawing?.querySelector('.drawing-actions');
    function positionPanel() {
      const area = frame.getBoundingClientRect();
      const text = node.getBoundingClientRect();
      const tools = drawingTools?.getBoundingClientRect();
      const actions = drawingActions?.getBoundingClientRect();
      const top = Math.max(9, tools ? tools.bottom - area.top + 7 : 9);
      const bottom = Math.min(area.height - 8, actions ? actions.top - area.top - 7 : area.height - 8);
      const panelHeight = toolbar.offsetHeight;
      const above = text.top - area.top - panelHeight - 8;
      const below = text.bottom - area.top + 8;
      const y = above >= top ? above : below + panelHeight <= bottom ? below : Math.max(top, bottom - panelHeight);
      toolbar.style.top = Math.round(y) + 'px';
    }
    const observer = new ResizeObserver(positionPanel);
    [frame, toolbar, node, drawingTools, drawingActions].forEach((element) => element && observer.observe(element));
    positionPanel();
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    read() {
      let remaining = textLimit;
      const runs = readRuns(field.current!, textStyle.current).flatMap((run) => {
        const text = run.text.slice(0, remaining);
        remaining -= text.length;
        return text ? [{ ...run, text }] : [];
      });
      return { ...item, layout, text: runs.map((run) => run.text).join(''), runs, color: style.color, size: style.size };
    },
  }));

  const specimen = locale === 'en' ? 'Light & Tone' : locale === 'zh-TW' ? '光影手記 Aa' : '光影手记 Aa';
  const preview = (field.current?.textContent ?? '').trim().split(/\s*\n\s*/, 1)[0]?.slice(0, 22);
  const layoutStyle = { ...runAppearance({ ...style, underline: false }), textAlign: layout.align, lineHeight: layout.lineHeight,
    letterSpacing: layout.letterSpacing };
  return (
    <div ref={layer} className="sketch-text-layer"
      style={{ '--sketch-text-x': item.at.x * 100 + '%', '--sketch-text-y': item.at.y * 100 + '%' } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}>
      <div ref={field} className="sketch-text-input" role="textbox" aria-label={t('草图文字')}
        aria-multiline="true" contentEditable suppressContentEditableWarning
        data-placeholder={t('输入文字')} style={layoutStyle} onBlur={saveRange}
        onPaste={(event) => {
          event.preventDefault();
          insertPlain(event.clipboardData.getData('text/plain'));
        }}
        onDrop={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          const command = event.ctrlKey || event.metaKey;
          if (event.key === 'Enter') {
            event.preventDefault();
            if (command) onDone();
            else insertPlain('\n');
          } else if (command && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            saveRange();
            if (event.key.toLowerCase() === 'b') format({ weight: style.weight >= 650 ? 400 : 700 });
            if (event.key.toLowerCase() === 'i') format({ italic: !style.italic });
            if (event.key.toLowerCase() === 'u') format({ underline: !style.underline });
          }
        }}
      />
      <div ref={panel} className="sketch-text-format" role="group" aria-label={t('草图文字样式')} onPointerDownCapture={saveRange}>
        <div className="sketch-format-main">
          <ChoiceSelect className="sketch-font-choice" size="compact" ariaLabel={t('字体')} value={style.family}
            options={fontOptions} onValueChange={(family) => {
              const weight = sketchFontWeight(family, style.weight);
              format({ family, weight }, false);
              void loadSketchFont(family, style.size, weight, style.italic, field.current?.textContent || specimen)
                .catch(() => undefined);
            }}
            renderOptionLabel={(option, selectedValue) => {
              const font = sketchFonts[option.value];
              const demo = 'preview' in font ? font.preview : font.family;
              return <span className="sketch-font-specimen" style={{ fontFamily: demo }}>
                <span>{option.label}</span>
                {!selectedValue && <small aria-hidden="true">{'preview' in font ? '光影 Aa' : preview || specimen}</small>}
              </span>;
            }} />
          <NumericField label={t('字号')} value={style.size} min={8} max={400} onChange={(size) => format({ size }, false)} />
          <WarmTooltip content={t('文字颜色')} placement="bottom">
            <input className="sketch-ink" type="color" aria-label={t('文字颜色')} value={style.color.slice(0, 7)}
              onChange={(event) => format({ color: event.currentTarget.value }, false)} />
          </WarmTooltip>
          <div className="sketch-type-toggles">
            <WarmTooltip content={t('粗体')} placement="bottom">
              <IconButton label={t('粗体')} aria-pressed={style.weight >= 650}
                onClick={() => format({ weight: style.weight >= 650 ? 400 : 700 })}><TextB size={16} /></IconButton>
            </WarmTooltip>
            <WarmTooltip content={t('斜体')} placement="bottom">
              <IconButton label={t('斜体')} aria-pressed={style.italic}
                onClick={() => format({ italic: !style.italic })}><TextItalic size={16} /></IconButton>
            </WarmTooltip>
            <WarmTooltip content={t('下划线')} placement="bottom">
              <IconButton label={t('下划线')} aria-pressed={!!style.underline}
                onClick={() => format({ underline: !style.underline })}><TextUnderline size={16} /></IconButton>
            </WarmTooltip>
          </div>
          <WarmTooltip content={t('完成文字')} placement="bottom">
            <IconButton label={t('完成文字')} className="sketch-text-done" onClick={onDone}><Check size={17} /></IconButton>
          </WarmTooltip>
          <WarmTooltip content={t('取消文字编辑')} placement="bottom">
            <IconButton label={t('取消文字编辑')} onClick={onCancel}><X size={15} /></IconButton>
          </WarmTooltip>
        </div>
        <div className="sketch-format-layout">
          <div className="sketch-text-alignment" role="group" aria-label={t('文字对齐')}>
            {alignment.map(([align, label, Glyph]) => (
              <WarmTooltip key={align} content={t(label)} placement="bottom">
                <IconButton label={t(label)} aria-pressed={layout.align === align}
                  onClick={() => setLayout((current) => ({ ...current, align }))}><Glyph size={16} /></IconButton>
              </WarmTooltip>
            ))}
          </div>
          <ChoiceSelect className="sketch-font-weight" size="compact" ariaLabel={t('字重')} value={String(style.weight)}
            options={fontWeights} onValueChange={(weight) => format({ weight: Number(weight) }, false)}
            renderOptionLabel={(option) => <span style={{ fontWeight: Number(option.value) }}>{option.label}</span>} />
          <NumericField label={t('字距')} value={layout.letterSpacing} min={-4} max={24} step={0.5} unit="px"
            onChange={(letterSpacing) => setLayout((current) => ({ ...current, letterSpacing }))} />
          <NumericField label={t('行距')} value={layout.lineHeight} min={0.8} max={3} step={0.05} unit="×"
            onChange={(lineHeight) => setLayout((current) => ({ ...current, lineHeight }))} />
        </div>
      </div>
    </div>
  );
}
