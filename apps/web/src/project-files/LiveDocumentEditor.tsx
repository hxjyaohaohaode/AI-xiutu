import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import {
  documentFormatSchema,
  formatMatchesBody,
  writeOfficeBlock,
  type OfficeBlock,
} from '@ai-xiutu/contracts';
import {
  documentSchema,
  liveMaxSteps,
  restoreDocumentStep,
  validatedRichContent,
  type SerializedStep,
} from '@ai-xiutu/contracts/rich-document';
import { api, ApiError, errorMessage, jsonRequest, withRequestDeadline } from '../lib/api';
import type { ProjectDocument } from '../lib/types';
import { t, useLocale } from '../i18n';
import { ExportContent } from './ExportContent';
import { OfficeInsert } from './OfficeInsert';
import {
  receivedDocumentStep,
  RichDocumentEditor,
  type RichDocumentContent,
} from './RichDocumentEditor';

type Snapshot = { kind: 'snapshot'; document: ProjectDocument; epoch: number; version: number };
type Delta = {
  kind: 'steps';
  epoch: number;
  version: number;
  documentVersion: number;
  updatedAt: string;
  steps: SerializedStep[];
  clients: string[];
  more: boolean;
};
type Sync = Snapshot | Delta;
type SaveState = 'connecting' | 'ready' | 'sending' | 'offline' | 'blocked' | 'reset';
const stateText: Record<SaveState, string> = {
  connecting: '正在连接共编',
  ready: '云端已同步',
  sending: '正在同步修改',
  offline: '连接中断，修改保留在此页',
  blocked: '共编已暂停',
  reset: '云端正文已重置，可取回本机修改',
};

function readRecovery(key: string): RichDocumentContent | null {
  try {
    const json = sessionStorage.getItem(key);
    if (!json || json.length > 450000) return null;
    const value: unknown = JSON.parse(json);
    if (
      !value ||
      typeof value !== 'object' ||
      !('body' in value) ||
      typeof value.body !== 'string' ||
      value.body.length > 100000
    )
      return null;
    const rawFormat = 'formatting' in value ? value.formatting : null;
    const result = documentFormatSchema.nullish().safeParse(rawFormat);
    return result.success && (!result.data || formatMatchesBody(value.body, result.data))
      ? { body: value.body, formatting: result.data ?? null }
      : null;
  } catch {
    return null;
  }
}

export function LiveDocumentEditor(props: {
  document: ProjectDocument;
  actorId: string;
  projectId: string;
  readOnly: boolean;
  sources: ProjectDocument[];
  onReference: (id: string, version: number) => void;
  onCloud: (document: ProjectDocument) => void;
  onPending: (pending: boolean) => void;
  onClose: (recovery?: RichDocumentContent) => boolean;
}) {
  useLocale();
  const tag = useRef(crypto.randomUUID());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [content, setContent] = useState<RichDocumentContent>(props.document);
  const [state, setState] = useState<SaveState>('connecting');
  const [notice, setNotice] = useState('');
  const key =
    'xiutu-document-live:' + [props.actorId, props.projectId, props.document.id].join('/');
  const [recovery, setRecovery] = useState(() => readRecovery(key));
  const view = useRef<EditorView | null>(null),
    baseline = useRef<Snapshot | null>(null);
  const lastSent = useRef<{ signature: string; mutationId: string } | null>(null);
  const pending = useRef(false),
    lastContent = useRef<RichDocumentContent>(props.document);
  const latest = useRef(props);
  latest.current = props;
  const [revision, reload] = useState(0);

  function onTransaction(editor: EditorView, current: RichDocumentContent) {
    lastContent.current = current;
    setContent(current);
    if (!sendableSteps(editor.state)) return;
    pending.current = true;
    latest.current.onPending(true);
    setState((previous) => (previous === 'ready' ? 'sending' : previous));
    try {
      sessionStorage.setItem(key, JSON.stringify(current));
    } catch {
      setNotice(t('浏览器未能保留本机恢复副本。请在退出前确认同步。'));
    }
  }

  useEffect(() => {
    const controller = new AbortController(),
      route = '/documents/' + props.document.id + '/live';
    let timer: ReturnType<typeof setTimeout>,
      stopped = false,
      failures = 0;
    baseline.current = null;
    setSnapshot(null);
    setState('connecting');
    function schedule(callback: () => void, ms: number) {
      if (!stopped && !controller.signal.aborted) timer = setTimeout(callback, ms);
    }
    function showSnapshot(packet: Snapshot) {
      baseline.current = packet;
      lastSent.current = null;
      lastContent.current = packet.document;
      setSnapshot(packet);
      setContent(packet.document);
      setState('ready');
      latest.current.onCloud(packet.document);
    }
    async function pump() {
      const base = baseline.current,
        editor = view.current;
      const after = base && editor ? getVersion(editor.state) : undefined;
      if (base && after === undefined) {
        schedule(pump, 150);
        return;
      }
      try {
        const path =
          after !== undefined && base ? route + '?epoch=' + base.epoch + '&after=' + after : route;
        const packet = await withRequestDeadline(controller.signal, 8000, (signal) =>
          api<Sync>(path, { signal, cache: 'no-store' }),
        );
        if (controller.signal.aborted) return;
        failures = 0;
        if (packet.kind === 'snapshot') {
          if (pending.current) {
            setState('reset');
            stopped = true;
          } else showSnapshot(packet);
          return;
        }
        if (
          !editor ||
          !base ||
          packet.epoch !== base.epoch ||
          packet.version !== after! + packet.steps.length ||
          packet.clients.length !== packet.steps.length
        )
          throw new Error('收到的共编操作与当前游标不一致。');
        if (packet.steps.length) {
          editor.dispatch(
            receiveTransaction(
              editor.state,
              packet.steps.map(restoreDocumentStep),
              packet.clients,
              {
                mapSelectionBackward: true,
              },
            ).setMeta(receivedDocumentStep, true),
          );
          if (getVersion(editor.state) !== packet.version) {
            stopped = true;
            setState('reset');
            return;
          }
          lastSent.current = null;
        }
        const draft = sendableSteps(editor.state);
        if (packet.more) return;
        if (!draft) {
          if (pending.current) {
            pending.current = false;
            latest.current.onPending(false);
            try {
              sessionStorage.removeItem(key);
            } catch {
              /* browser privacy mode */
            }
          }
          if (packet.documentVersion !== base.document.version) {
            const document = {
              ...base.document,
              ...validatedRichContent(editor.state.doc, base.document.formatting),
              version: packet.documentVersion,
              updatedAt: packet.updatedAt,
            };
            baseline.current = { ...base, document, version: packet.version };
            latest.current.onCloud(document);
          }
          setState('ready');
          setNotice('');
          return;
        }
        if (latest.current.readOnly) {
          stopped = true;
          setState('blocked');
          return;
        }
        setState('sending');
        const steps = draft.steps
          .slice(0, liveMaxSteps)
          .map((step) => step.toJSON() as SerializedStep);
        const signature = JSON.stringify([
          packet.epoch,
          packet.version,
          packet.documentVersion,
          steps,
        ]);
        if (lastSent.current?.signature !== signature)
          lastSent.current = { signature, mutationId: crypto.randomUUID() };
        await withRequestDeadline(controller.signal, 10000, (signal) =>
          api(route, {
            ...jsonRequest('POST', {
              epoch: packet.epoch,
              version: packet.version,
              expectedVersion: packet.documentVersion,
              clientId: tag.current,
              mutationId: lastSent.current!.mutationId,
              steps,
            }),
            signal,
          }),
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        if (
          error instanceof ApiError &&
          ['DOCUMENT_SYNC_REQUIRED', 'VERSION_CONFLICT'].includes(error.code)
        )
          return;
        if (
          error instanceof ApiError &&
          (error.status === 0 ||
            error.status === 408 ||
            error.status === 429 ||
            error.status >= 500)
        ) {
          failures++;
          setState('offline');
        } else {
          stopped = true;
          setState('blocked');
          setNotice(errorMessage(error));
        }
      } finally {
        schedule(pump, failures ? Math.min(7500, 800 * 2 ** Math.min(failures, 3)) : 650);
      }
    }
    void pump();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [props.document.id, props.actorId, props.projectId, revision, key]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!pending.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  function leave(saved?: RichDocumentContent) {
    if (!latest.current.onClose(saved ?? (pending.current ? lastContent.current : undefined)))
      return;
    pending.current = false;
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* browser privacy mode */
    }
  }
  function insertBlock(block: OfficeBlock) {
    const editor = view.current;
    if (!editor || !editor.editable) return false;
    const before = editor.state.doc;
    editor.dispatch(
      editor.state.tr.insert(
        before.content.size,
        documentSchema.nodes.office_block!.create({ data: writeOfficeBlock(block) }),
      ),
    );
    return before !== editor.state.doc;
  }
  const readOnly = props.readOnly || state === 'blocked' || state === 'reset' || !!recovery;
  return (
    <section className="office-live" aria-label={t('实时共编')}>
      <div className="office-live-status" data-state={state}>
        <span role="status">{t(stateText[state])}</span>
        <button type="button" className="text-button" onClick={() => leave()}>
          {t('退出共编')}
        </button>
        {state === 'blocked' && !pending.current && !props.readOnly && (
          <button type="button" className="text-button" onClick={() => reload((n) => n + 1)}>
            {t('重新连接')}
          </button>
        )}
      </div>
      {recovery && (
        <div className="office-live-recovery">
          <button type="button" className="text-button" onClick={() => leave(recovery)}>
            {t('载入本机未同步稿')}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setRecovery(null);
              if (!pending.current)
                try {
                  sessionStorage.removeItem(key);
                } catch {
                  /* browser privacy mode */
                }
            }}
          >
            {t('继续编辑云端文档')}
          </button>
        </div>
      )}
      {snapshot && !readOnly && (
        <OfficeInsert
          projectId={props.projectId}
          documents={props.sources.filter((doc) => doc.id !== props.document.id)}
          onInsert={insertBlock}
        />
      )}
      {snapshot && (
        <RichDocumentEditor
          key={snapshot.epoch + ':' + snapshot.version}
          body={snapshot.document.body}
          formatting={snapshot.document.formatting}
          onChange={() => true}
          readOnly={readOnly}
          onReference={props.onReference}
          live={{
            version: snapshot.version,
            clientId: props.actorId + '/' + tag.current,
            onAttach: (editor) => {
              view.current = editor;
            },
            onTransaction,
          }}
        />
      )}
      {notice && <p role="alert">{t(notice)}</p>}
      <div className="office-live-export">
        <ExportContent
          title={snapshot?.document.title ?? props.document.title}
          body={content.body}
          formatting={content.formatting}
        />
      </div>
    </section>
  );
}
