import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  TextB,
  TextItalic,
  TextUnderline,
  ArrowCounterClockwise,
  ArrowClockwise,
} from '@phosphor-icons/react';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { Slice, Fragment, DOMSerializer } from 'prosemirror-model';
import { collab } from 'prosemirror-collab';
import {
  defaultLayout,
  withDocumentLayout,
  documentFonts,
  documentSizes,
  documentGaps,
  documentAlignments,
  sameDocumentFormat,
  readOfficeBlock,
  type DocumentFormat,
} from '@ai-xiutu/contracts';
import { documentSchema, readRichDocument, validatedRichContent } from '@ai-xiutu/contracts/rich-document';
import { t, useLocale } from '../i18n';
import { chartDataUrl, snapshotSvg } from '@ai-xiutu/contracts/office-data';
import 'prosemirror-view/style/prosemirror.css';
import './rich-document.css';

export type RichDocumentContent = { body: string; formatting?: DocumentFormat | null };
type Content = RichDocumentContent;
type Props = Content & { readOnly: boolean; onChange: (next: Content) => boolean;
  onReference?: (id: string, version: number) => void;
  live?: {
  version: number; clientId: string;
  onAttach: (view: EditorView | null) => void;
  onTransaction: (view: EditorView, content: Content) => void;
} };
export const receivedDocumentStep = 'xiutu-received-document-step';
const alignLabels = { left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' };
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
  useLayoutEffect(() => {
    if (!target.current) return;
    const mark = (name: string) =>
      toggleMark(documentSchema.marks[name]!, null, { removeWhenPresent: false });
    const v = new EditorView(target.current, {
      state: EditorState.create({
        doc: readRichDocument(latest.current.body, latest.current.formatting),
        plugins: [
          history(),
          ...(latest.current.live ? [collab({ version: latest.current.live.version, clientID: latest.current.live.clientId })] : []),
          keymap({
            'Mod-b': mark('bold'),
            'Mod-i': mark('italic'),
            'Mod-u': mark('underline'),
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
        office_block(node) {
          const dom = DOMSerializer.fromSchema(documentSchema).serializeNode(node) as HTMLElement;
          const block = readOfficeBlock(node.attrs.data);
          if (block?.kind === 'chart') {
            try {
              const image = document.createElement('img');
              image.src = chartDataUrl(snapshotSvg(block.chart));
              image.alt = block.chart.title;
              dom.prepend(image);
            } catch { dom.textContent = t('图表数据不可用'); }
          }
          return { dom };
        },
      },
      // Intercept before the default HTML clipboard parser touches external markup.
      handleDOMEvents: {
        click(_, event) {
          const target = event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-office-reference]') : null;
          const id = target?.dataset.officeReference, version = Number(target?.dataset.officeVersion);
          if (!id || !version || !latest.current.onReference) return false;
          event.preventDefault();
          latest.current.onReference(id, version);
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

  const v = view.current,
    state = v?.state,
    selection = state?.selection;
  let activeMarks = state?.storedMarks ?? selection?.$from.marks() ?? [];
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
  function inline(name: 'font' | 'size', value: string) {
    if (!v || props.readOnly) return;
    const { from, to, empty } = v.state.selection,
      tr = v.state.tr,
      type = documentSchema.marks[name]!;
    const mark = value ? type.create({ value: name === 'size' ? Number(value) : value }) : null;
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
  function paragraph(name: 'align' | 'after', value: string) {
    if (!v || props.readOnly) return;
    const { from, to, $from, empty } = v.state.selection,
      tr = v.state.tr;
    const update = (pos: number) => {
      const node = tr.doc.nodeAt(pos)!;
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        [name]: value === '' ? null : name === 'after' ? Number(value) : value,
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
  return (
    <div className="project-rich-document">
      {!props.readOnly && (
        <div className="project-format-tools" role="toolbar" aria-label={t('文字排版')}>
          {(
            [
              ['bold', '加粗', TextB],
              ['italic', '斜体', TextItalic],
              ['underline', '下划线', TextUnderline],
            ] as const
          ).map(([name, label, Icon]) => (
            <button
              key={name}
              type="button"
              aria-label={t(label)}
              title={t(label)}
              aria-pressed={activeMarks.some((m) => m.type.name === name)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (v) {
                  toggleMark(documentSchema.marks[name]!, null, { removeWhenPresent: false })(
                    v.state,
                    v.dispatch,
                  );
                  v.focus();
                }
              }}
            >
              <Icon size={17} />
            </button>
          ))}
          <select
            aria-label={t('字体')}
            title={t('字体')}
            value={activeMarks.find((m) => m.type.name === 'font')?.attrs.value ?? ''}
            onChange={(e) => inline('font', e.target.value)}
          >
            <option value="">{t('默认字体')}</option>
            {documentFonts.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <select
            aria-label={t('字号')}
            title={t('字号')}
            value={activeMarks.find((m) => m.type.name === 'size')?.attrs.value ?? ''}
            onChange={(e) => inline('size', e.target.value)}
          >
            <option value="">{t('字号')}</option>
            {documentSizes.map((s) => (
              <option key={s} value={s}>
                {s} pt
              </option>
            ))}
          </select>
          <select
            aria-label={t('段落对齐')}
            title={t('段落对齐')}
            value={selection?.$from.parent.attrs.align ?? 'left'}
            onChange={(e) => paragraph('align', e.target.value === 'left' ? '' : e.target.value)}
          >
            {documentAlignments.map((a) => (
              <option value={a} key={a}>
                {t(alignLabels[a])}
              </option>
            ))}
          </select>
          <select
            aria-label={t('段后间距')}
            title={t('段后间距')}
            value={selection?.$from.parent.attrs.after ?? ''}
            onChange={(e) => paragraph('after', e.target.value)}
          >
            <option value="">{t('段后间距')}</option>
            {documentGaps.map((g) => (
              <option value={g} key={g}>
                {g} pt
              </option>
            ))}
          </select>
          {(
            [
              [undo, '撤销', ArrowCounterClockwise],
              [redo, '重做', ArrowClockwise],
            ] as const
          ).map(([command, label, Icon]) => (
            <button
              key={label}
              type="button"
              aria-label={t(label)}
              title={t(label)}
              disabled={!state || !command(state)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (v) {
                  command(v.state, v.dispatch);
                  v.focus();
                }
              }}
            >
              <Icon size={17} />
            </button>
          ))}
        </div>
      )}
      <div
        ref={target}
        style={{
          fontFamily: page.font,
          fontSize: page.size + 'pt',
          lineHeight: page.line,
          textAlign: page.align,
        }}
      />
      {pasteError && <p role="alert">{pasteError}</p>}
    </div>
  );
}
