import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as RichNode, MarkType } from 'prosemirror-model';
import { documentIndents } from '@ai-xiutu/contracts';
import { documentSchema } from '@ai-xiutu/contracts/rich-document';

/**
 * Block styles are stored as Markdown-compatible line prefixes so the plain-text
 * body, server step validation, DOCX/PPTX export and older documents stay one
 * format. The editor renders them like Google Docs styles via decorations.
 */
export const blockStyles = ['paragraph', 'h1', 'h2', 'h3', 'quote', 'bullet', 'ordered', 'check'] as const;
export type BlockStyle = (typeof blockStyles)[number];

const prefixPattern = /^(?:(#{1,6}) |> |- \[([ xX])\] |(\d{1,5})\. |[-*+] )/;

export function blockStyleOf(text: string): { style: BlockStyle; prefix: string; checked?: boolean } {
  const match = prefixPattern.exec(text);
  if (!match) return { style: 'paragraph', prefix: '' };
  const prefix = match[0];
  if (match[1]) {
    const level = match[1].length;
    return { style: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', prefix };
  }
  if (prefix.startsWith('>')) return { style: 'quote', prefix };
  if (match[2] !== undefined) return { style: 'check', prefix, checked: match[2] !== ' ' };
  if (match[3]) return { style: 'ordered', prefix };
  return { style: 'bullet', prefix };
}

const prefixFor = (style: BlockStyle, number = 1): string =>
  ({
    paragraph: '',
    h1: '# ',
    h2: '## ',
    h3: '### ',
    quote: '> ',
    bullet: '- ',
    ordered: `${number}. `,
    check: '- [ ] ',
  })[style];

type Dispatch = (tr: Transaction) => void;

/** Paragraph positions touched by the selection (at least the caret's paragraph). */
function selectedParagraphs(state: EditorState) {
  const { from, to } = state.selection;
  const found: { pos: number; node: RichNode }[] = [];
  state.doc.nodesBetween(from, Math.max(from, to), (node, pos) => {
    if (node.type.name === 'paragraph') found.push({ pos, node });
    return node.type.name === 'doc';
  });
  return found;
}

/**
 * Applies a block style to every selected paragraph. Re-applying the current
 * style toggles back to body text, like the list buttons in Docs and Word.
 * Ordered lists are renumbered from 1 across the selection.
 */
export function setBlockStyle(style: BlockStyle) {
  return (state: EditorState, dispatch?: Dispatch) => {
    const paragraphs = selectedParagraphs(state);
    if (!paragraphs.length) return false;
    const toggleOff =
      style !== 'paragraph' &&
      paragraphs.every(({ node }) => blockStyleOf(node.textContent).style === style);
    if (!dispatch) return true;
    const tr = state.tr;
    paragraphs.forEach(({ pos, node }, index) => {
      const current = blockStyleOf(node.textContent);
      const next = toggleOff ? '' : prefixFor(style, index + 1);
      const start = tr.mapping.map(pos) + 1;
      if (current.prefix === next) return;
      if (current.prefix) tr.delete(start, start + current.prefix.length);
      if (next) tr.insertText(next, start);
    });
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Toggles the checkbox of the checklist item that starts at `paragraphPos`. */
export function toggleCheck(state: EditorState, paragraphPos: number, dispatch: Dispatch) {
  const node = state.doc.nodeAt(paragraphPos);
  if (!node || node.type.name !== 'paragraph') return false;
  const block = blockStyleOf(node.textContent);
  if (block.style !== 'check') return false;
  const at = paragraphPos + 1 + 3; // "- [" then the state character
  dispatch(state.tr.insertText(block.checked ? ' ' : 'x', at, at + 1));
  return true;
}

export function changeIndent(delta: 1 | -1) {
  return (state: EditorState, dispatch?: Dispatch) => {
    const paragraphs = selectedParagraphs(state);
    const levels = (level: number | null) => {
      const next = Math.max(0, Math.min(documentIndents.at(-1)!, (level ?? 0) + delta));
      return next === 0 ? null : next;
    };
    if (!paragraphs.some(({ node }) => levels(node.attrs.indent) !== node.attrs.indent)) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    for (const { pos, node } of paragraphs)
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: levels(node.attrs.indent) });
    dispatch(tr);
    return true;
  };
}

/** Tab/Shift-Tab indent only inside list items, so Tab still leaves plain paragraphs. */
export function listIndent(delta: 1 | -1) {
  return (state: EditorState, dispatch?: Dispatch) => {
    const style = blockStyleOf(state.selection.$from.parent.textContent).style;
    if (style !== 'bullet' && style !== 'ordered' && style !== 'check') return false;
    return changeIndent(delta)(state, dispatch);
  };
}

/**
 * Enter at the end of a list item continues the list; Enter on an empty item
 * ends it (both match Docs/Word). Other paragraphs use the default split.
 */
export function continueList(state: EditorState, dispatch?: Dispatch) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph') return false;
  const text = $from.parent.textContent;
  const block = blockStyleOf(text);
  if (block.style !== 'bullet' && block.style !== 'ordered' && block.style !== 'check') return false;
  if ($from.parentOffset !== text.length) return false;
  if (!dispatch) return true;
  const start = $from.before();
  if (text === block.prefix) {
    dispatch(state.tr.delete(start + 1, start + 1 + block.prefix.length));
    return true;
  }
  const number = block.style === 'ordered' ? Number(/^(\d+)/.exec(text)![1]) + 1 : 1;
  const next = block.style === 'check' ? '- [ ] ' : prefixFor(block.style, number);
  const tr = state.tr.split($from.pos, 1, [
    { type: documentSchema.nodes.paragraph!, attrs: { ...$from.parent.attrs } },
  ]);
  tr.insertText(next, tr.selection.from);
  dispatch(tr.scrollIntoView());
  return true;
}

/** Removes inline formatting (not links) and paragraph spacing/indent from the selection. */
export function clearFormatting(state: EditorState, dispatch?: Dispatch) {
  const { from, to, empty } = state.selection;
  if (!dispatch) return true;
  const tr = state.tr;
  const kinds = ['bold', 'italic', 'underline', 'strike', 'color', 'highlight', 'script', 'font', 'size'];
  if (empty) tr.setStoredMarks([]);
  else for (const name of kinds) tr.removeMark(from, to, documentSchema.marks[name] as MarkType);
  for (const { pos, node } of selectedParagraphs(state))
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: null, spacing: null, after: null, align: null });
  dispatch(tr);
  return true;
}

export interface DocumentStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  paragraphs: number;
  readingMinutes: number;
}

/**
 * Counts like Google Docs' word count: each CJK ideograph, kana or hangul
 * syllable counts as one word; other scripts count whitespace-separated runs.
 */
export function documentStats(doc: RichNode): DocumentStats {
  let words = 0,
    characters = 0,
    charactersNoSpaces = 0,
    paragraphs = 0;
  doc.forEach((node) => {
    if (node.type.name !== 'paragraph') return;
    const text = node.textContent.replace(prefixPattern, '');
    if (text.trim()) paragraphs++;
    const glyphs = Array.from(text);
    characters += glyphs.length;
    charactersNoSpaces += glyphs.filter((c) => !/\s/u.test(c)).length;
    const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
    words += cjk?.length ?? 0;
    words += text
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
      .split(/\s+/)
      .filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
  });
  // ~300 CJK characters or ~230 Latin words per minute.
  return {
    words,
    characters,
    charactersNoSpaces,
    paragraphs,
    readingMinutes: Math.max(1, Math.round(words / 260)),
  };
}

export interface OutlineItem {
  level: 1 | 2 | 3;
  text: string;
  pos: number;
}

export function documentOutline(doc: RichNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph') return;
    const block = blockStyleOf(node.textContent);
    if (block.style === 'h1' || block.style === 'h2' || block.style === 'h3') {
      const text = node.textContent.slice(block.prefix.length).trim();
      if (text) items.push({ level: Number(block.style[1]) as 1 | 2 | 3, text, pos: offset });
    }
  });
  return items;
}

export interface FindMatch {
  from: number;
  to: number;
}

/** Case-insensitive literal search inside paragraphs (embedded blocks are skipped). */
export function findMatches(doc: RichNode, query: string, caseSensitive = false): FindMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: FindMatch[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph' || matches.length >= 1000) return;
    const hay = caseSensitive ? node.textContent : node.textContent.toLocaleLowerCase();
    for (let i = hay.indexOf(needle); i >= 0 && matches.length < 1000; i = hay.indexOf(needle, i + needle.length))
      matches.push({ from: offset + 1 + i, to: offset + 1 + i + needle.length });
  });
  return matches;
}

/** Replaces matches back-to-front so earlier positions stay valid; keeps the first run's marks. */
export function replaceMatches(state: EditorState, matches: FindMatch[], replacement: string) {
  const tr = state.tr;
  for (const { from, to } of [...matches].sort((a, b) => b.from - a.from)) {
    const marks = state.doc.resolve(from + 1).marks();
    if (replacement) tr.replaceWith(from, to, documentSchema.text(replacement, marks));
    else tr.delete(from, to);
  }
  return tr;
}

export function selectMatch(state: EditorState, match: FindMatch) {
  return state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to)).scrollIntoView();
}

export const findKey = new PluginKey<{ query: string; active: number; caseSensitive: boolean }>('rich-find');

/**
 * Visual layer: heading/quote/list paragraph classes, dimmed syntax prefixes,
 * clickable checkboxes and find highlights. Decorations never change content.
 */
export function richDecorations() {
  return new Plugin<{ query: string; active: number; caseSensitive: boolean }>({
    key: findKey,
    state: {
      init: () => ({ query: '', active: -1, caseSensitive: false }),
      apply: (tr, value) => tr.getMeta(findKey) ?? value,
    },
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.forEach((node, offset) => {
          if (node.type.name !== 'paragraph') return;
          const block = blockStyleOf(node.textContent);
          if (block.style === 'paragraph') return;
          decorations.push(
            Decoration.node(offset, offset + node.nodeSize, {
              class: `doc-block doc-${block.style}${block.checked ? ' doc-checked' : ''}`,
            }),
          );
          const start = offset + 1;
          if (block.style === 'check')
            decorations.push(
              Decoration.inline(start, start + block.prefix.length, {
                class: 'doc-checkbox',
                'data-paragraph': String(offset),
                role: 'checkbox',
                'aria-checked': String(Boolean(block.checked)),
              }),
            );
          else
            decorations.push(
              Decoration.inline(start, start + block.prefix.length, {
                class:
                  block.style === 'bullet'
                    ? 'doc-bullet-mark'
                    : block.style === 'ordered'
                      ? 'doc-number'
                      : 'doc-syntax',
              }),
            );
        });
        const find = findKey.getState(state);
        if (find?.query) {
          findMatches(state.doc, find.query, find.caseSensitive).forEach((match, index) =>
            decorations.push(
              Decoration.inline(match.from, match.to, {
                class: index === find.active ? 'doc-find doc-find-active' : 'doc-find',
              }),
            ),
          );
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
