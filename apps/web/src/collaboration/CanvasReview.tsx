import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChatTeardropDots, Circle, CornersOut, Diamond, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react';
import type { Point } from '@ai-xiutu/editor';
import { api, errorMessage, jsonRequest } from '../lib/api';
import { t } from '../i18n';
import type { Comment } from '../lib/types';
import { CommentDictation } from './CommentDictation';
import { useConfirmation } from '../components/ConfirmationDialog';
import './canvas-review.css';

export type CanvasReviewScope = {
  projectId: string;
  artworkId: string;
  revisionId: string;
  canComment: boolean;
  actorId: string;
  refresh: number;
};
type Shape = NonNullable<NonNullable<Comment['anchor']>['shape']>;
const shapes = [
  ['point', Circle, '圆点标记'],
  ['diamond', Diamond, '菱形标记'],
  ['frame', CornersOut, '方框标记'],
] as const;

export function useCanvasReview(scope: CanvasReviewScope | undefined) {
  const scopeKey = scope ? `${scope.actorId}/${scope.projectId}/${scope.artworkId}/${scope.revisionId}` : '';
  const [data, setData] = useState<{ key: string; notes: Comment[] }>({ key: '', notes: [] });
  const [open, setOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<Comment | null>(null);
  const [body, setBody] = useState('');
  const [shape, setShape] = useState<Shape>('point');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const key = useRef(scopeKey);
  key.current = scopeKey;
  const pending = useRef(false);
  useEffect(() => {
    setOpen(false); setPlacing(false); setShowHint(false); setPoint(null); setActive(''); setEditing(null); setBody(''); setError('');
  }, [scopeKey]);
  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ artworkId: scope.artworkId, revisionId: scope.revisionId });
    void api<{ comments: Comment[] }>(`/projects/${scope.projectId}/comments?${query}`, {
      signal: controller.signal,
    }).then(({ comments }) => {
      if (!controller.signal.aborted && key.current === scopeKey)
        setData({ key: scopeKey, notes: comments });
    }).catch((err) => {
      if (!controller.signal.aborted && key.current === scopeKey) setError(errorMessage(err));
    });
    return () => controller.abort();
  }, [scopeKey, scope?.refresh, reload]);
  const notes = data.key === scopeKey ? data.notes : [];
  const resetDraft = () => { setPoint(null); setEditing(null); setBody(''); setError(''); };
  const closeCard = () => { resetDraft(); setActive(''); setPlacing(false); setShowHint(false); };
  const begin = () => { closeCard(); setPlacing(true); setShowHint(true); };
  useEffect(() => {
    if (!showHint) return;
    const timeout = window.setTimeout(() => setShowHint(false), 7000);
    return () => window.clearTimeout(timeout);
  }, [showHint, scopeKey]);
  function pick(value: Point) {
    if (!open || !placing || !scope?.canComment) return false;
    setPoint(value);
    setPlacing(false);
    setShowHint(false);
    return true;
  }
  async function save() {
    if (!scope?.canComment || (!point && !editing) || !body.trim() || pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    try {
      const { comment } = editing
        ? await api<{ comment: Comment }>(`/comments/${editing.id}`, jsonRequest('PATCH', {
            expectedVersion: editing.bodyVersion, body: body.trim(),
          }))
        : await api<{ comment: Comment }>(`/projects/${scope.projectId}/comments`, jsonRequest('POST', {
            artworkId: scope.artworkId, revisionId: scope.revisionId, anchor: { ...point!, shape }, body: body.trim(),
          }));
      if (key.current !== scopeKey) return;
      setData((previous) => ({ key: scopeKey, notes: [
        ...(previous.key === scopeKey ? previous.notes.filter((note) => note.id !== comment.id) : []),
        comment,
      ] }));
      closeCard();
      setReload((value) => value + 1);
    } catch (err) {
      if (key.current === scopeKey) setError(errorMessage(err));
    } finally { pending.current = false; setBusy(false); }
  }
  function owns(note: Comment) { return !!scope?.canComment && note.authorId === scope.actorId; }
  async function remove(note: Comment) {
    if (!owns(note) || pending.current || key.current !== scopeKey) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await api(`/comments/${note.id}?expectedVersion=${note.bodyVersion}`, { method: 'DELETE' });
      if (key.current !== scopeKey) return;
      setData((value) => ({ key: scopeKey, notes: value.notes.filter((item) => item.id !== note.id) }));
      closeCard();
      setReload((value) => value + 1);
    } catch (err) {
      if (key.current === scopeKey) setError(errorMessage(err));
    } finally { pending.current = false; setBusy(false); }
  }
  return {
    enabled: Boolean(scope),
    open, placing: open && placing, showHint: open && showHint,
    point, notes, active, body, shape, error, busy, editing,
    canComment: Boolean(scope?.canComment), pick, begin, save, setBody, setShape,
    closeCard, owns, remove,
    dictate(text: string) { setBody((value) => [value.trimEnd(), text].filter(Boolean).join(' ').slice(0, 5000)); },
    edit(note: Comment) { if (owns(note)) { setEditing(note); setBody(note.body); setError(''); } },
    retry: () => { setError(''); setReload((value) => value + 1); },
    toggle() {
      setOpen(!open);
      if (!open && notes.length === 0 && scope?.canComment) begin();
      else closeCard();
    },
    select(id: string) { closeCard(); setActive(id === active ? '' : id); },
  };
}

type Review = ReturnType<typeof useCanvasReview>;
export function CanvasReviewToggle({ review, onOpen }: { review: Review; onOpen: () => void }) {
  return review.enabled && (
    <>
      <button type="button" className="canvas-review-toggle" aria-label={t('画布批注')}
        title={t('画布批注')} aria-pressed={review.open} onClick={() => {
          if (!review.open) onOpen();
          review.toggle();
        }}>
        <ChatTeardropDots size={18} />
        {review.notes.length > 0 && <span>{review.notes.length}</span>}
      </button>
      {review.open && review.canComment && !review.active && !review.point && (
        <button type="button" className="canvas-review-toggle" aria-label={t('添加批注')}
          title={t('添加批注')} aria-pressed={review.placing}
          onClick={review.placing ? review.closeCard : review.begin}>
          <Plus size={17} />
        </button>
      )}
    </>
  );
}

export function CanvasReviewPins({ review, map, zoom }: {
  review: Review;
  map: (point: Point) => Point | null;
  zoom: number;
}) {
  if (!review.open) return null;
  return (
    <div className="canvas-review-pins">
      {review.notes.map((note, index) => {
        if (!note.anchor) return null;
        let position: Point | null;
        try { position = map(note.anchor); } catch { return null; }
        if (!position || !Number.isFinite(position.x + position.y) ||
          position.x < 0 || position.y < 0 || position.x > 1 || position.y > 1) return null;
        const tint = ['#5846a0','#126956','#995520','#375b8e'][[...(note.authorId ?? '')]
          .reduce((sum, char) => (sum + char.charCodeAt(0)) % 4, 0)]!;
        return <button type="button" key={note.id} className="canvas-review-pin" data-shape={note.anchor.shape ?? 'point'}
          style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%`,
            '--review-tint': tint, '--review-scale': 1 / zoom } as CSSProperties}
          aria-label={note.body} aria-pressed={review.active === note.id}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); review.select(note.id); }}>
          <span>{index + 1}</span>
        </button>;
      })}
    </div>
  );
}

export function CanvasReviewCard({ review, frameTransform }: { review: Review; frameTransform: string }) {
  const id = useId();
  const confirmation = useConfirmation();
  const card = useRef<HTMLElement>(null);
  const note = review.notes.find((item) => item.id === review.active);
  useLayoutEffect(() => {
    const element = card.current;
    const stage = element?.offsetParent;
    if (!element || !(stage instanceof HTMLElement)) return;
    const pin = note && stage.querySelector('.canvas-review-pin[aria-pressed="true"]');
    if (!pin) {
      element.style.removeProperty('--review-card-left');
      element.style.removeProperty('--review-card-top');
      return;
    }
    const positionCard = () => {
      const bounds = stage.getBoundingClientRect();
      const target = pin.getBoundingClientRect();
      const gutter = 10;
      const maxLeft = Math.max(gutter, bounds.width - element.offsetWidth - gutter);
      const maxTop = Math.max(gutter, bounds.height - element.offsetHeight - 42);
      const right = target.right - bounds.left + gutter;
      const left = right <= maxLeft ? right : target.left - bounds.left - element.offsetWidth - gutter;
      element.style.setProperty('--review-card-left', Math.max(gutter, Math.min(maxLeft, left)) + 'px');
      element.style.setProperty('--review-card-top', Math.max(gutter, Math.min(maxTop, target.top - bounds.top)) + 'px');
    };
    positionCard();
    const resize = new ResizeObserver(positionCard);
    resize.observe(stage);
    resize.observe(element);
    return () => resize.disconnect();
  }, [note?.id, review.open, frameTransform]);
  if (!review.open || (!note && !review.editing && !review.point && !review.showHint && !review.error)) return null;
  return (
    <section className="canvas-review-card" ref={card} aria-label={t('画布批注')}>
      <div className="canvas-review-heading">
        <ChatTeardropDots size={17} />
        <strong>{note?.authorName ?? t('画布批注')}</strong>
        {note && !review.editing && review.owns(note) && <>
          <button type="button" aria-label={t('编辑批注')} disabled={review.busy} onClick={() => review.edit(note)}><PencilSimple size={15} /></button>
          <button type="button" aria-label={t('删除批注')} disabled={review.busy} onClick={async () => {
            if (await confirmation.confirm({ title: t('删除批注'), description: t('这条批注将从协作画布移除。'), confirmLabel: t('删除'), tone: 'danger' })) await review.remove(note);
          }}><Trash size={15} /></button>
        </>}
        <button type="button" aria-label={t('关闭')} onClick={review.closeCard}><X size={15} /></button>
      </div>
      {confirmation.dialog}
      {note && !review.editing && <p className="canvas-review-body">{note.body}</p>}
      {review.showHint && <p role="status">{t('点选照片上的批注位置')}</p>}
      {(review.point || review.editing) && (
        <form onSubmit={(event) => { event.preventDefault(); void review.save(); }}>
          {review.point && <div className="canvas-review-shapes" role="group" aria-label={t('标记形状')}>
            {shapes.map(([shape, Icon, label]) => (
              <button key={shape} type="button" aria-label={t(label)} aria-pressed={review.shape === shape}
                onClick={() => review.setShape(shape)}><Icon size={17} /></button>
            ))}
          </div>}
          <label className="sr-only" htmlFor={id}>{t('输入画布批注')}</label>
          <textarea autoFocus id={id} value={review.body} onChange={(event) => review.setBody(event.target.value)}
            rows={2} maxLength={5000} placeholder={t('输入画布批注')} />
          <div className="canvas-review-actions">
            <CommentDictation onText={review.dictate} disabled={review.busy} />
            <button type="submit" className="button button-primary" disabled={!review.body.trim() || review.busy}>
              {t(review.editing ? '保存批注' : '发表批注')}
            </button>
          </div>
        </form>
      )}
      {review.error && <div role="alert">{t(review.error)} <button type="button" onClick={review.retry}>{t('重试')}</button></div>}
      {!review.point && !review.placing && !review.editing && review.canComment &&
        <button type="button" className="text-button" onClick={review.begin}>{t('添加批注')}</button>}
    </section>
  );
}
