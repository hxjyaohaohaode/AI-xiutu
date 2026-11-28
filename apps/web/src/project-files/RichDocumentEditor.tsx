import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  TextB,
  TextItalic,
  TextUnderline,
  TextStrikethrough,
  TextSuperscript,
  TextSubscript,
  LinkSimple,
  TextAlignLeft,
  TextAlignCenter,
  TextAlignRight,
  TextAlignJustify,
  ListBullets,
  ListNumbers,
  ListChecks,
  TextIndent,
  TextOutdent,
  Eraser,
  MagnifyingGlass,
  SidebarSimple,
  HighlighterCircle,
  Minus,
  Plus,
  ArrowUp,
  ArrowDown,
  X,
  ArrowCounterClockwise,
  ArrowClockwise,
} from '@phosphor-icons/react';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { baseKeymap, toggleMark, chainCommands } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { Slice, Fragment, DOMSerializer, type Mark } from 'prosemirror-model';
import { collab } from 'prosemirror-collab';
import {
  defaultLayout,
  withDocumentLayout,
  documentFonts,
  documentFontCss,
  documentSizes,
  documentAlignments,
  documentColors,
  documentHighlights,
  documentHighlightCss,
  documentLineSpacing,
  documentGaps,
  isDocumentLink,
  documentLinkTarget,
  sameDocumentFormat,
  readOfficeBlock,
  writeOfficeBlock,
  type DocumentFormat,
  type OfficeChartSnapshot,
} from '@ai-xiutu/contracts';
import { documentSchema, readRichDocument, validatedRichContent } from '@ai-xiutu/contracts/rich-document';
import { t, useLocale } from '../i18n';
import { snapshotTable } from '@ai-xiutu/contracts/office-data';
import { mountChart } from './chart-view';
import {
  blockStyleOf,
  blockStyles,
  changeIndent,
  clearFormatting,
  continueList,
  documentOutline,
  documentStats,
  findKey,
  findMatches,
  listIndent,
  replaceMatches,
  richDecorations,
  selectMatch,
  setBlockStyle,
  toggleCheck,
  type BlockStyle,
} from './rich-commands';
import 'prosemirror-view/style/prosemirror.css';
import './rich-document.css';

export type RichDocumentContent = { body: string; formatting?: DocumentFormat | null };
type Content = RichDocumentContent;
type Props = Content & { readOnly: boolean; onChange: (next: Content) => boolean;
  onReference?: (id: string, version: number) => void;
  /** Project documents offered as internal link targets (titles only; opening is scoped by the API). */
  documents?: readonly { id: string; title: string }[];
  /** Follows a `doc:` link. Absent (e.g. the public share viewer): such links are shown but inert. */
  onOpenDocument?: (id: string, heading?: string) => void;
  /** Scrolls to this heading once it exists (arrival from a `doc:<id>#heading` link). */
  focusHeading?: string;
  /** Overrides embedded image URLs (the public share viewer). */
  assetUrl?: (assetId: string) => string;
  live?: {
  version: number; clientId: string;
  onAttach: (view: EditorView | null) => void;
  onTransaction: (view: EditorView, content: Content) => void;
} };
export const receivedDocumentStep = 'xiutu-received-document-step';
const ChartDesigner = lazy(() => import('./ChartDesigner').then((m) => ({ default: m.ChartDesigner })));
const alignOptions = [
  ['left', '左对齐', TextAlignLeft],
  ['center', '居中', TextAlignCenter],
  ['right', '右对齐', TextAlignRight],
  ['justify', '两端对齐', TextAlignJustify],
] as const;
const styleLabels: Record<BlockStyle, string> = {
  paragraph: '正文',
  h1: '标题 1',
  h2: '标题 2',
  h3: '标题 3',
  quote: '引用',
  bullet: '项目符号列表',
  ordered: '编号列表',
  check: '清单',
};
const colorNames: Record<(typeof documentColors)[number], string> = {
  '#1F2937': '墨黑',
  '#6B7280': '灰色',
  '#B42318': '红色',
  '#B54708': '橙色',
  '#027A48': '绿色',
  '#175CD3': '蓝色',
  '#6941C6': '紫色',
  '#C11574': '洋红',
};
const highlightNames: Record<(typeof documentHighlights)[number], string> = {
  yellow: '黄色',
  green: '绿色',
  cyan: '青色',
  magenta: '粉色',
  lightGray: '浅灰',
};
type Panel = 'color' | 'highlight' | 'link' | null;
type LinkMode = 'web' | 'heading' | 'document';

export function RichDocumentEditor(props: Props) {
  const locale = useLocale();
  const page = props.formatting?.layout ?? defaultLayout;
  const target = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const last = useRef<Content>(props);
  const [, redraw] = useState(0);
  const [pasteError, setPasteError] = useState('');
  const [panel, setPanelState] = useState<Panel>(null);
  const [panelAt, setPanelAt] = useState({ left: 0, top: 0 });
  const root = useRef<HTMLDivElement>(null);
  // Popovers live outside the scrolling toolbar and are placed under their button.
  const setPanel = (next: Panel) => {
    const anchor = next && root.current?.querySelector<HTMLElement>(`[data-panel="${next}"]`);
    if (anchor && root.current) {
      const box = anchor.getBoundingClientRect(), frame = root.current.getBoundingClientRect();
      const width = next === 'link' ? 300 : 200;
      setPanelAt({
        left: Math.max(0, Math.min(box.left - frame.left, frame.width - width)),
        top: box.bottom - frame.top + 6,
      });
    }
    setPanelState(next);
  };
  const [linkDraft, setLinkDraft] = useState('');
  const [linkMode, setLinkMode] = useState<LinkMode>('web');
  const [linkQuery, setLinkQuery] = useState('');
  const follow = useRef<(href: string) => void>(() => undefined);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [active, setActive] = useState(0);
  const [outline, setOutline] = useState(false);
  const openFind = useRef<() => void>(() => {});
  openFind.current = () => setFinding(true);
  const [designing, setDesigning] = useState<{ pos: number; chart: OfficeChartSnapshot } | null>(null);
  const openDesigner = useRef<(target: { pos: number; chart: OfficeChartSnapshot }) => void>(() => {});
  openDesigner.current = setDesigning;
  useLayoutEffect(() => {
    if (!target.current) return;
    const mark = (name: string, attrs?: Record<string, unknown>) =>
      toggleMark(documentSchema.marks[name]!, attrs ?? null, { removeWhenPresent: false });
    const v = new EditorView(target.current, {
      state: EditorState.create({
        doc: readRichDocument(latest.current.body, latest.current.formatting),
        plugins: [
          history(),
          richDecorations(),
          ...(latest.current.live ? [collab({ version: latest.current.live.version, clientID: latest.current.live.clientId })] : []),
          keymap({
            'Mod-b': mark('bold'),
            'Mod-i': mark('italic'),
            'Mod-u': mark('underline'),
            'Mod-Shift-x': mark('strike'),
            'Mod-.': mark('script', { value: 'super' }),
            'Mod-,': mark('script', { value: 'sub' }),
            'Mod-Alt-0': setBlockStyle('paragraph'),
            'Mod-Alt-1': setBlockStyle('h1'),
            'Mod-Alt-2': setBlockStyle('h2'),
            'Mod-Alt-3': setBlockStyle('h3'),
            'Mod-Shift-7': setBlockStyle('ordered'),
            'Mod-Shift-8': setBlockStyle('bullet'),
            'Mod-Shift-9': setBlockStyle('check'),
            'Mod-]': changeIndent(1),
            'Mod-[': changeIndent(-1),
            'Mod-\\': clearFormatting,
            Tab: listIndent(1),
            'Shift-Tab': listIndent(-1),
            Enter: chainCommands(continueList, baseKeymap.Enter!),
            'Mod-f': () => {
              openFind.current();
              return true;
            },
            'Mod-z': undo,
            'Mod-y': redo,
            'Shift-Mod-z': redo,
          }),
          keymap(baseKeymap),
        ],
      }),
      editable: () => !latest.current.readOnly,
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('文档内容') },
      nodeViews: {
        office_block(node, _view, getPos) {
          const dom = DOMSerializer.fromSchema(documentSchema).serializeNode(node) as HTMLElement;
          const block = readOfficeBlock(node.attrs.data);
          if (block?.kind === 'image' && latest.current.assetUrl) {
            const image = dom.querySelector('img');
            if (image) image.src = latest.current.assetUrl(block.assetId);
          }
          if (block?.kind !== 'chart') return { dom };
          // Interactive chart: hover values and legend toggles stay local to this view;
          // persistent changes go through the designer as one validated document step.
          dom.replaceChildren();
          dom.classList.add('office-chart');
          const host = document.createElement('div');
          const mount = mountChart(host, block.chart, {
            label: (action, name) => t(action === 'hide' ? '隐藏 {v0}' : '显示 {v0}', { v0: name }),
          });
          dom.append(host);
          if (!latest.current.readOnly) {
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'office-chart-edit';
            edit.textContent = t('编辑图表');
            edit.addEventListener('click', (event) => {
              event.preventDefault();
              const pos = getPos();
              if (pos !== undefined) openDesigner.current({ pos, chart: block.chart });
            });
            dom.append(edit);
          }
          return {
            dom,
            stopEvent: (event) => event.target instanceof Node && dom.contains(event.target) && event.type !== 'dragstart',
            ignoreMutation: () => true,
            destroy: () => mount.destroy(),
          };
        },
      },
      // Intercept before the default HTML clipboard parser touches external markup.
      handleDOMEvents: {
        mousedown(editor, event) {
          const box = event.target instanceof Element ? event.target.closest<HTMLElement>('.doc-checkbox') : null;
          if (!box || latest.current.readOnly) return false;
          event.preventDefault();
          return toggleCheck(editor.state, Number(box.dataset.paragraph), editor.dispatch);
        },
        click(_, event) {
          // Links: read-only views follow on click; editors follow on Ctrl/Cmd+click (as in Docs and Word).
          const link = event.target instanceof Element ? event.target.closest<HTMLElement>('a[data-doc-link], a[href]') : null;
          if (link) {
            if (!latest.current.readOnly && !event.metaKey && !event.ctrlKey) return false;
            event.preventDefault();
            follow.current(link.dataset.docLink ?? link.getAttribute('href') ?? '');
            return true;
          }
          const target = event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-office-reference]') : null;
          const id = target?.dataset.officeReference, version = Number(target?.dataset.officeVersion);
          if (!id || !version || !latest.current.onReference) return false;
          event.preventDefault();
          latest.current.onReference(id, version);
          return true;
        },
        keydown(_, event) {
          const link = event.target instanceof Element ? event.target.closest<HTMLElement>('a[data-doc-link]') : null;
          if (!link || event.key !== 'Enter' || !latest.current.readOnly) return false;
          event.preventDefault();
          follow.current(link.dataset.docLink ?? '');
          return true;
        },
        paste(editor, event) {
          if (!event.clipboardData) return false;
          event.preventDefault();
          insertPlain(editor, event.clipboardData.getData('text/plain'));
          return true;
        },
        drop(editor, event) {
          if (editor.dragging || !event.dataTransfer) return false;
          event.preventDefault();
          const point = editor.posAtCoords({ left: event.clientX, top: event.clientY });
          if (point) insertPlain(editor, event.dataTransfer.getData('text/plain'), point.pos);
          return true;
        },
      },
      dispatchTransaction(tr) {
        if (tr.docChanged && latest.current.readOnly && !tr.getMeta(receivedDocumentStep)) return;
        const next = v.state.apply(tr);
        let data: Content | undefined;
        if (tr.docChanged) {
          try { data = validatedRichContent(next.doc, latest.current.formatting); }
          catch {
            setPasteError(t('文字超过草稿保留范围，本次输入未应用。'));
            return;
          }
          if (!latest.current.onChange(data)) return;
          last.current = data;
        }
        v.updateState(next);
        if (data) latest.current.live?.onTransaction(v, data);
        redraw((n) => n + 1);
      },
    });
    function insertPlain(editor: EditorView, text: string, pos?: number) {
      if (!text || latest.current.readOnly) return;
      if (text.length > 100000) {
        setPasteError(t('文字超过草稿保留范围，本次输入未应用。'));
        return;
      }
      setPasteError('');
      const nodes = text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((s) =>
          documentSchema.nodes.paragraph!.create(null, s ? documentSchema.text(s) : undefined),
        );
      const tr = editor.state.tr;
      if (pos !== undefined) tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
      editor.dispatch(
        tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 1, 1)).scrollIntoView(),
      );
    }
    view.current = v;
    latest.current.live?.onAttach(v);
    last.current = latest.current;
    redraw((n) => n + 1);
    return () => {
      view.current = null;
      latest.current.live?.onAttach(null);
      v.destroy();
    };
  }, []);
  useLayoutEffect(() => {
    const v = view.current;
    if (
      !v || props.live ||
      (props.body === last.current.body &&
        sameDocumentFormat(
          withDocumentLayout(props.formatting, defaultLayout),
          withDocumentLayout(last.current.formatting, defaultLayout),
        ))
    )
      return;
    // Switching document or replacing a conflicted version must clear undo history as well.
    v.updateState(
      EditorState.create({
        doc: readRichDocument(props.body, props.formatting),
        plugins: v.state.plugins,
      }),
    );
    last.current = props;
    redraw((n) => n + 1);
  }, [props.body, props.formatting, props.live]);
  useEffect(() => {
    view.current?.setProps({
      editable: () => !latest.current.readOnly,
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-readonly': String(props.readOnly),
        'aria-label': t('文档内容'),
      },
    });
  }, [props.readOnly, locale]);
  useEffect(() => {
    if (props.focusHeading) scrollToHeading(props.focusHeading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusHeading]);

  const v = view.current,
    state = v?.state,
    selection = state?.selection;
  // Find highlights are view-only plugin state; publishing them is a meta-only transaction.
  const matches = state && finding ? findMatches(state.doc, query, caseSensitive) : [];
  const current = matches.length ? Math.min(active, matches.length - 1) : -1;
  const findState = state ? findKey.getState(state) : undefined;
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const next = { query: finding ? query : '', active: current, caseSensitive };
    if (findState && findState.query === next.query && findState.active === next.active && findState.caseSensitive === next.caseSensitive)
      return;
    editor.dispatch(editor.state.tr.setMeta(findKey, next).setMeta('addToHistory', false));
  });

  let activeMarks: readonly Mark[] = state?.storedMarks ?? selection?.$from.marks() ?? [];
  if (state && selection && !selection.empty) {
    let first = true;
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (!node.isText) return;
      activeMarks = first
        ? node.marks
        : activeMarks.filter((mark) => node.marks.some((other) => mark.eq(other)));
      first = false;
    });
  }
  const markValue = (name: string) => activeMarks.find((m) => m.type.name === name)?.attrs;
  const has = (name: string, value?: string) =>
    activeMarks.some((m) => m.type.name === name && (value === undefined || m.attrs.value === value));
  const parent = selection?.$from.parent;
  const block = parent?.type.name === 'paragraph' ? blockStyleOf(parent.textContent) : null;
  const stats = state ? documentStats(state.doc) : null;
  const selectedWords =
    state && selection && !selection.empty
      ? documentStats(
          documentSchema.nodes.doc!.create(null, [
            documentSchema.nodes.paragraph!.create(
              null,
              state.doc.textBetween(selection.from, selection.to, ' ')
                ? documentSchema.text(state.doc.textBetween(selection.from, selection.to, ' '))
                : undefined,
            ),
          ]),
        ).words
      : 0;
  const headings = state ? documentOutline(state.doc) : [];

  function run(command: (s: EditorState, d?: EditorView['dispatch']) => boolean) {
    if (!v || props.readOnly) return;
    command(v.state, v.dispatch);
    v.focus();
  }
  function inline(name: 'font' | 'size' | 'color' | 'highlight', value: string | number | null) {
    if (!v || props.readOnly) return;
    const { from, to, empty } = v.state.selection,
      tr = v.state.tr,
      type = documentSchema.marks[name]!;
    const mark = value !== null && value !== '' ? type.create({ value }) : null;
    if (empty) {
      tr.removeStoredMark(type);
      if (mark) tr.addStoredMark(mark);
    } else {
      tr.removeMark(from, to, type);
      if (mark) tr.addMark(from, to, mark);
    }
    v.dispatch(tr);
    v.focus();
  }
  function stepSize(direction: 1 | -1) {
    const now = Number(markValue('size')?.value ?? page.size);
    const sizes = [...documentSizes];
    const next = direction > 0 ? sizes.find((s) => s > now) : [...sizes].reverse().find((s) => s < now);
    if (next) inline('size', next);
  }
  function script(value: 'super' | 'sub') {
    run(toggleMark(documentSchema.marks.script!, { value }, { removeWhenPresent: false }));
  }
  function paragraph(name: 'align' | 'spacing' | 'after', value: string) {
    if (!v || props.readOnly) return;
    const { from, to, $from, empty } = v.state.selection,
      tr = v.state.tr;
    const update = (pos: number) => {
      const node = tr.doc.nodeAt(pos)!;
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        [name]: value === '' ? null : name === 'spacing' || name === 'after' ? Number(value) : value,
      });
    };
    if (empty) update($from.before());
    else
      v.state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === 'paragraph') {
          update(pos);
          return false;
        }
      });
    v.dispatch(tr);
    v.focus();
  }
  function openLink() {
    const existing = markValue('link')?.href as string | undefined;
    const target = existing ? documentLinkTarget(existing) : null;
    setLinkMode(target?.kind === 'heading' ? 'heading' : target?.kind === 'document' ? 'document' : 'web');
    setLinkQuery('');
    setLinkDraft(target?.kind === 'external' ? existing! : 'https://');
    setPanel(panel === 'link' ? null : 'link');
  }
  function linkLabel(href: string) {
    const target = documentLinkTarget(href);
    if (!target) return href;
    if (target.kind === 'heading') return t('本文') + ' · ' + target.heading;
    if (target.kind === 'document') {
      const title = props.documents?.find((d) => d.id === target.id)?.title ?? t('项目文档');
      return target.heading ? title + ' · ' + target.heading : title;
    }
    return target.href.replace(/^mailto:/, '').replace(/^https?:\/\//, '');
  }
  function scrollToHeading(text: string) {
    const editor = view.current;
    const item = editor && documentOutline(editor.state.doc).find((h) => h.text === text);
    if (!editor || !item) return false;
    editor.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(item.pos + 1))).scrollIntoView());
    (editor.nodeDOM(item.pos) as HTMLElement | null)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    return true;
  }
  follow.current = (href: string) => {
    const target = documentLinkTarget(href);
    if (!target) return;
    if (target.kind === 'external') window.open(target.href, '_blank', 'noopener,noreferrer');
    else if (target.kind === 'heading') scrollToHeading(target.heading);
    else latest.current.onOpenDocument?.(target.id, target.heading);
  };
  function applyLink(remove = false, explicit?: { href: string; label: string }) {
    if (!v || props.readOnly) return;
    const href = explicit?.href ?? linkDraft.trim();
    if (!remove && !isDocumentLink(href)) return;
    let { from, to, empty } = v.state.selection;
    const type = documentSchema.marks.link!;
    if (empty) {
      // Extend to the existing link around the caret, as Docs does when editing a link.
      const $pos = v.state.selection.$from;
      const linked = $pos.parent.childAfter($pos.parentOffset).node ?? $pos.parent.childBefore($pos.parentOffset).node;
      const markHere = linked?.marks.find((m) => m.type === type);
      if (!markHere) {
        if (remove) return setPanel(null);
        const text = explicit?.label || href;
        const tr = v.state.tr.insertText(text, from).addMark(from, from + text.length, type.create({ href }));
        v.dispatch(tr);
        setPanel(null);
        return v.focus();
      }
      const start = $pos.start();
      let pos = 0;
      $pos.parent.forEach((child, offset) => {
        if (child === linked) pos = offset;
      });
      from = start + pos;
      to = from + linked!.nodeSize;
      empty = false;
    }
    const tr = v.state.tr.removeMark(from, to, type);
    if (!remove) tr.addMark(from, to, type.create({ href }));
    v.dispatch(tr);
    setPanel(null);
    v.focus();
  }
  function moveMatch(direction: 1 | -1) {
    if (!v || !matches.length) return;
    const next = (current + direction + matches.length) % matches.length;
    setActive(next);
    v.dispatch(selectMatch(v.state, matches[next]!));
  }
  function replace(all: boolean) {
    if (!v || props.readOnly || !matches.length) return;
    v.dispatch(replaceMatches(v.state, all ? matches : [matches[current]!], replacement));
  }
  function jump(pos: number) {
    if (!v) return;
    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(pos + 1))).scrollIntoView());
    v.focus();
  }
  const tool = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    options: { pressed?: boolean; disabled?: boolean; shortcut?: string; panel?: Panel } = {},
  ) => (
    <button
      type="button"
      data-panel={options.panel ?? undefined}
      aria-expanded={options.panel ? panel === options.panel : undefined}
      aria-label={label}
      title={options.shortcut ? `${label} (${options.shortcut})` : label}
      aria-pressed={options.pressed}
      disabled={options.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  const colorValue = markValue('color')?.value as string | undefined;
  const highlightValue = markValue('highlight')?.value as (typeof documentHighlights)[number] | undefined;
  return (
    <div ref={root} className={'project-rich-document' + (outline ? ' with-outline' : '')}
      onKeyDown={(e) => { if (e.key === 'Escape' && panel) { setPanel(null); v?.focus(); } }}>
      {!props.readOnly && (
        <div className="project-format-tools" role="toolbar" aria-label={t('文字排版')}>
          <div className="format-group">
            {tool(t('撤销'), <ArrowCounterClockwise size={17} />, () => run(undo), { disabled: !state || !undo(state), shortcut: 'Ctrl+Z' })}
            {tool(t('重做'), <ArrowClockwise size={17} />, () => run(redo), { disabled: !state || !redo(state), shortcut: 'Ctrl+Y' })}
          </div>
          <div className="format-group">
            <select
              className="format-style"
              aria-label={t('段落样式')}
              title={t('段落样式')}
              value={block?.style ?? 'paragraph'}
              onChange={(e) => run(setBlockStyle(e.target.value as BlockStyle))}
            >
              {blockStyles.map((style) => (
                <option key={style} value={style}>
                  {t(styleLabels[style])}
                </option>
              ))}
            </select>
          </div>
          <div className="format-group">
            <select
              className="format-font"
              aria-label={t('字体')}
              title={t('字体')}
              value={markValue('font')?.value ?? ''}
              onChange={(e) => inline('font', e.target.value)}
            >
              <option value="">{t('默认字体')}</option>
              {documentFonts.map((f) => (
                <option key={f} style={{ fontFamily: documentFontCss(f) }}>{f}</option>
              ))}
            </select>
            {tool(t('减小字号'), <Minus size={15} />, () => stepSize(-1))}
            <select
              className="format-size"
              aria-label={t('字号')}
              title={t('字号')}
              value={markValue('size')?.value ?? ''}
              onChange={(e) => inline('size', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{page.size}</option>
              {documentSizes.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {tool(t('增大字号'), <Plus size={15} />, () => stepSize(1))}
          </div>
          <div className="format-group">
            {(
              [
                ['bold', '加粗', TextB, 'Ctrl+B'],
                ['italic', '斜体', TextItalic, 'Ctrl+I'],
                ['underline', '下划线', TextUnderline, 'Ctrl+U'],
                ['strike', '删除线', TextStrikethrough, 'Ctrl+Shift+X'],
              ] as const
            ).map(([name, label, Icon, shortcut]) => (
              <span key={name}>
                {tool(t(label), <Icon size={17} />, () => run(toggleMark(documentSchema.marks[name]!, null, { removeWhenPresent: false })), {
                  pressed: has(name),
                  shortcut,
                })}
              </span>
            ))}
            <div className="format-popover-anchor">
              {tool(
                t('文字颜色'),
                <span className="format-color-glyph" style={{ borderColor: colorValue ?? 'currentColor' }}>A</span>,
                () => setPanel(panel === 'color' ? null : 'color'),
                { pressed: panel === 'color', panel: 'color' },
              )}
            </div>
            <div className="format-popover-anchor">
              {tool(
                t('突出显示'),
                <HighlighterCircle size={17} weight={highlightValue ? 'fill' : 'regular'}
                  color={highlightValue ? documentHighlightCss[highlightValue] : undefined} />,
                () => setPanel(panel === 'highlight' ? null : 'highlight'),
                { pressed: panel === 'highlight', panel: 'highlight' },
              )}
            </div>
            {tool(t('上标'), <TextSuperscript size={17} />, () => script('super'), { pressed: has('script', 'super'), shortcut: 'Ctrl+.' })}
            {tool(t('下标'), <TextSubscript size={17} />, () => script('sub'), { pressed: has('script', 'sub'), shortcut: 'Ctrl+,' })}
            <div className="format-popover-anchor">
              {tool(t('插入链接'), <LinkSimple size={17} />, openLink, { pressed: has('link') || panel === 'link', panel: 'link' })}
            </div>
          </div>
          <div className="format-group" role="radiogroup" aria-label={t('段落对齐')}>
            {alignOptions.map(([value, label, Icon]) => (
              <span key={value}>
                {tool(t(label), <Icon size={17} />, () => paragraph('align', value === 'left' ? '' : value), {
                  pressed: (parent?.attrs.align ?? 'left') === value,
                })}
              </span>
            ))}
            <select
              aria-label={t('行距')}
              title={t('行距')}
              value={parent?.attrs.spacing ?? ''}
              onChange={(e) => paragraph('spacing', e.target.value)}
            >
              <option value="">{t('行距')}</option>
              {documentLineSpacing.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <select
              aria-label={t('段后间距')}
              title={t('段后间距')}
              value={parent?.attrs.after ?? ''}
              onChange={(e) => paragraph('after', e.target.value)}
            >
              <option value="">{t('段后间距')}</option>
              {documentGaps.map((g) => (
                <option value={g} key={g}>{g} pt</option>
              ))}
            </select>
          </div>
          <div className="format-group">
            {tool(t('项目符号列表'), <ListBullets size={17} />, () => run(setBlockStyle('bullet')), { pressed: block?.style === 'bullet', shortcut: 'Ctrl+Shift+8' })}
            {tool(t('编号列表'), <ListNumbers size={17} />, () => run(setBlockStyle('ordered')), { pressed: block?.style === 'ordered', shortcut: 'Ctrl+Shift+7' })}
            {tool(t('清单'), <ListChecks size={17} />, () => run(setBlockStyle('check')), { pressed: block?.style === 'check', shortcut: 'Ctrl+Shift+9' })}
            {tool(t('减少缩进'), <TextOutdent size={17} />, () => run(changeIndent(-1)), { disabled: !state || !changeIndent(-1)(state), shortcut: 'Ctrl+[' })}
            {tool(t('增加缩进'), <TextIndent size={17} />, () => run(changeIndent(1)), { disabled: !state || !changeIndent(1)(state), shortcut: 'Ctrl+]' })}
          </div>
          <div className="format-group">
            {tool(t('清除格式'), <Eraser size={17} />, () => run(clearFormatting), { shortcut: 'Ctrl+\\' })}
            {tool(t('查找和替换'), <MagnifyingGlass size={17} />, () => setFinding(!finding), { pressed: finding, shortcut: 'Ctrl+F' })}
            {tool(t('文档大纲'), <SidebarSimple size={17} />, () => setOutline(!outline), { pressed: outline })}
          </div>
        </div>
      )}
              {panel === 'color' && (
                <div className="format-popover" style={panelAt} role="menu" aria-label={t('文字颜色')}>
                  <button type="button" role="menuitem" className="format-swatch-reset" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { inline('color', null); setPanel(null); }}>{t('默认颜色')}</button>
                  <div className="format-swatches">
                    {documentColors.map((color) => (
                      <button key={color} type="button" role="menuitemradio" aria-checked={colorValue === color}
                        aria-label={t(colorNames[color])} title={t(colorNames[color])} style={{ background: color }}
                        onMouseDown={(e) => e.preventDefault()} onClick={() => { inline('color', color); setPanel(null); }} />
                    ))}
                  </div>
                </div>
              )}
              {panel === 'highlight' && (
                <div className="format-popover" style={panelAt} role="menu" aria-label={t('突出显示')}>
                  <button type="button" role="menuitem" className="format-swatch-reset" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { inline('highlight', null); setPanel(null); }}>{t('无')}</button>
                  <div className="format-swatches">
                    {documentHighlights.map((name) => (
                      <button key={name} type="button" role="menuitemradio" aria-checked={highlightValue === name}
                        aria-label={t(highlightNames[name])} title={t(highlightNames[name])}
                        style={{ background: documentHighlightCss[name] }}
                        onMouseDown={(e) => e.preventDefault()} onClick={() => { inline('highlight', name); setPanel(null); }} />
                    ))}
                  </div>
                </div>
              )}
              {panel === 'link' && (
                <form className="format-popover format-link" style={panelAt} onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
                  <div className="format-link-tabs" role="tablist" aria-label={t('链接类型')}>
                    {(['web', 'heading', 'document'] as const).map((mode) => (
                      <button key={mode} type="button" role="tab" aria-selected={linkMode === mode} onClick={() => { setLinkMode(mode); setLinkQuery(''); }}>
                        {t(mode === 'web' ? '网址' : mode === 'heading' ? '本文标题' : '项目文档')}
                      </button>
                    ))}
                  </div>
                  {linkMode === 'heading' && (
                    <ul className="format-link-list" aria-label={t('本文标题')}>
                      {headings.length ? headings.map((item) => (
                        <li key={item.pos}>
                          <button type="button" data-level={item.level} onClick={() => applyLink(false, { href: '#' + item.text.slice(0, 200), label: item.text })}>
                            {item.text}
                          </button>
                        </li>
                      )) : <li className="format-link-empty">{t('添加标题后会显示在这里。')}</li>}
                    </ul>
                  )}
                  {linkMode === 'document' && (
                    <>
                      <input type="search" aria-label={t('搜索文档')} placeholder={t('搜索文档')} value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} autoFocus />
                      <ul className="format-link-list" aria-label={t('项目文档')}>
                        {(props.documents ?? []).filter((d) => d.title.toLocaleLowerCase().includes(linkQuery.trim().toLocaleLowerCase())).slice(0, 50).map((d) => (
                          <li key={d.id}>
                            <button type="button" onClick={() => applyLink(false, { href: 'doc:' + d.id, label: d.title })}>{d.title}</button>
                          </li>
                        ))}
                        {!props.documents?.length && <li className="format-link-empty">{t('项目中还没有其他文档。')}</li>}
                      </ul>
                    </>
                  )}
                  {linkMode !== 'web' && has('link') && <button type="button" className="text-button" onClick={() => applyLink(true)}>{t('移除链接')}</button>}
                  {linkMode === 'web' && <>
                  <input
                    autoFocus
                    type="url"
                    inputMode="url"
                    aria-label={t('链接地址')}
                    placeholder="https://"
                    value={linkDraft}
                    onChange={(e) => setLinkDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setPanel(null); v?.focus(); } }}
                  />
                  <button type="submit" className="text-button" disabled={!isDocumentLink(linkDraft.trim())}>{t('应用')}</button>
                  {has('link') && <button type="button" className="text-button" onClick={() => applyLink(true)}>{t('移除链接')}</button>}
                  {linkDraft.trim() && !isDocumentLink(linkDraft.trim()) && (
                    <small role="status">{t('仅支持 https、http 或 mailto 链接。')}</small>
                  )}
                  </>}
                </form>
              )}
      {finding && (
        <div className="doc-find-bar" role="search" aria-label={t('查找和替换')}>
          <input
            autoFocus
            aria-label={t('查找')}
            placeholder={t('查找')}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); moveMatch(e.shiftKey ? -1 : 1); }
              if (e.key === 'Escape') { setFinding(false); v?.focus(); }
            }}
          />
          <span className="doc-find-count" aria-live="polite">
            {query ? t('{v0}/{v1}', { v0: matches.length ? current + 1 : 0, v1: matches.length }) : ''}
          </span>
          {tool(t('上一个'), <ArrowUp size={15} />, () => moveMatch(-1), { disabled: !matches.length })}
          {tool(t('下一个'), <ArrowDown size={15} />, () => moveMatch(1), { disabled: !matches.length })}
          <label className="doc-find-case">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
            {t('区分大小写')}
          </label>
          {!props.readOnly && (
            <>
              <input aria-label={t('替换为')} placeholder={t('替换为')} value={replacement}
                onChange={(e) => setReplacement(e.target.value)} />
              <button type="button" className="text-button" disabled={!matches.length} onClick={() => replace(false)}>{t('替换')}</button>
              <button type="button" className="text-button" disabled={!matches.length} onClick={() => replace(true)}>{t('全部替换')}</button>
            </>
          )}
          {tool(t('关闭查找'), <X size={15} />, () => { setFinding(false); v?.focus(); })}
        </div>
      )}
      <div className="doc-body">
        {outline && (
          <nav className="doc-outline" aria-label={t('文档大纲')}>
            <h3>{t('大纲')}</h3>
            {headings.length ? (
              <ol>
                {headings.map((item) => (
                  <li key={item.pos} data-level={item.level}>
                    <button type="button" onClick={() => jump(item.pos)}>{item.text}</button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>{t('添加标题后会显示在这里。')}</p>
            )}
          </nav>
        )}
        <div
          className="doc-page"
          ref={target}
          style={{
            fontFamily: documentFontCss(page.font),
            fontSize: page.size + 'pt',
            lineHeight: page.line,
            textAlign: page.align,
          }}
        />
      </div>
      {stats && (
        <div className="doc-status" aria-live="polite">
          <span>{t('{v0} 字', { v0: stats.words })}</span>
          <span>{t('{v0} 个字符', { v0: stats.characters })}</span>
          <span>{t('约 {v0} 分钟阅读', { v0: stats.readingMinutes })}</span>
          {selectedWords > 0 && <span>{t('已选 {v0} 字', { v0: selectedWords })}</span>}
        </div>
      )}
      {!props.readOnly && v && selection?.empty && !panel && markValue('link')?.href && (() => {
        const href = markValue('link')!.href as string;
        const frame = root.current?.getBoundingClientRect();
        let at = { left: 0, top: 0 };
        try {
          const c = v.coordsAtPos(selection.from);
          if (frame) at = { left: Math.max(0, Math.min(c.left - frame.left, frame.width - 280)), top: c.bottom - frame.top + 6 };
        } catch { /* position unavailable during reconfiguration */ }
        const kind = documentLinkTarget(href)?.kind;
        return (
          <div className="doc-link-bubble" style={at} role="group" aria-label={t('链接')} onMouseDown={(e) => e.preventDefault()}>
            <span className="doc-link-bubble-target" data-kind={kind}>{linkLabel(href)}</span>
            <button type="button" disabled={kind === 'document' && !props.onOpenDocument} onClick={() => follow.current(href)}>{t('打开')}</button>
            <button type="button" onClick={openLink}>{t('编辑')}</button>
            <button type="button" onClick={() => applyLink(true)}>{t('移除')}</button>
          </div>
        );
      })()}
      {pasteError && <p role="alert">{pasteError}</p>}
      {designing && (
        <Suspense fallback={null}>
          <ChartDesigner
            table={snapshotTable(designing.chart)}
            initial={designing.chart}
            source={designing.chart.source}
            confirmLabel="保存图表"
            onCancel={() => setDesigning(null)}
            onConfirm={(chart) => {
              const editor = view.current;
              const node = editor?.state.doc.nodeAt(designing.pos);
              if (editor && node?.type.name === 'office_block' && !props.readOnly)
                editor.dispatch(
                  editor.state.tr.setNodeMarkup(designing.pos, undefined, {
                    data: writeOfficeBlock({ kind: 'chart', chart }),
                  }),
                );
              setDesigning(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
