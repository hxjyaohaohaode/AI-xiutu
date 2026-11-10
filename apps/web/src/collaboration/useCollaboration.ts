import { useCallback, useEffect, useRef, useState } from 'react';
import { parseEditorRecipe, type EditorRecipe, type Point } from '@ai-xiutu/editor';
import type {
  CollaborationCommand,
  CollaborationCommandResponse,
  CollaborationLease,
  CollaborationPollResponse,
  CollaborationSession,
  CollaborationSnapshot,
  CollaborationTarget,
} from '@ai-xiutu/contracts';
import { api, ApiError, errorMessage, jsonRequest } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import type { Artwork, Asset, Revision } from '../lib/types';
import type { EditorState } from '../editor/useEditor';
import {
  applyOperation,
  inverseOnLatest,
  mergeOwnDraft,
  operationBetween,
  operationTarget,
  same,
} from './model';

type Head = { artwork: Artwork; revision: Revision; asset: Asset };
type Snapshot = CollaborationSnapshot<Artwork, Revision, Asset>;
type CommandResult = CollaborationCommandResponse<Artwork, Revision, Asset>;
type Draft = {
  base: Head;
  recipe: EditorRecipe;
  committed: boolean;
  label: string;
  intent: 'edit' | 'undo' | 'redo';
};
type OwnEdit = { before: EditorRecipe; after: EditorRecipe; label: string };
type Status =
  | 'off'
  | 'connecting'
  | 'ready'
  | 'acquiring'
  | 'previewing'
  | 'saving'
  | 'reconnecting'
  | 'conflict'
  | 'forbidden';
type Options = {
  editor: EditorState;
  artwork: Artwork | null;
  revision: Revision | null;
  asset: Asset | null;
  enabled: boolean;
  canEdit: boolean;
  tool: string;
  onHead: (head: Head) => void;
  prepareRecipe: (recipe: EditorRecipe) => Promise<EditorRecipe>;
  resolveReferences: (recipe: EditorRecipe, isCurrent: () => boolean) => Promise<Map<string, File>>;
};
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Network ownership applies to shared publication; unsent local pixels remain a recoverable draft. */
export function useCollaboration(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [status, setStatus] = useState<Status>('off'),
    [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [session, setSession] = useState<CollaborationSession | null>(null);
  const [remotePreview, setRemotePreview] = useState<EditorRecipe | null>(null);
  const [pendingCount, setPendingCount] = useState(0),
    [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [reconnectKey, setReconnectKey] = useState(0);
  const room = useRef<{
    id: string;
    epoch: number;
    source: number;
    controller: AbortController;
    session: CollaborationSession | null;
    cursor: string;
    sequence: number;
    previewSequence: number;
    reconnectRequested: boolean;
  } | null>(null);
  const connectionIdentity = useRef<{ id: string; source: number } | null>(null);
  const epoch = useRef(0),
    head = useRef<Head | null>(null),
    draft = useRef<Draft | null>(null),
    lease = useRef<CollaborationLease | null>(null);
  const processing = useRef(false),
    timer = useRef<number | null>(null),
    lastPreview = useRef(0),
    lastPresence = useRef(0);
  const activeFlush = useRef<Promise<void> | null>(null),
    flushRequested = useRef(false),
    lastFailure = useRef<unknown>(null),
    discardRequested = useRef(false);
  const lastCommand = useRef<{
    command: CollaborationCommand;
    before: Head;
    candidate: EditorRecipe;
    label: string;
    intent: Draft['intent'];
  } | null>(null);
  const presence = useRef<{ cursor: Point | null; selection: CollaborationTarget | null }>({
    cursor: null,
    selection: null,
  });
  const undo = useRef<OwnEdit[]>([]),
    redo = useRef<OwnEdit[]>([]),
    suspended = useRef(false);
  const isCurrent = (r: NonNullable<typeof room.current>) =>
    room.current === r &&
    !r.controller.signal.aborted &&
    !r.reconnectRequested &&
    r.source === latest.current.editor.getSourceIdentity();
  const endpoint = (r: NonNullable<typeof room.current>, suffix = '') =>
    `/artworks/${r.id}/collaboration${suffix}`;
  function updateHistory() {
    setHistoryState({ undo: undo.current.length, redo: redo.current.length });
  }
  function stateError(e: unknown) {
    lastFailure.current = e;
    setError(errorMessage(e));
    setStatus(
      e instanceof ApiError && (e.status === 401 || e.status === 403)
        ? 'forbidden'
        : e instanceof ApiError && e.status === 409
          ? 'conflict'
          : 'reconnecting',
    );
  }
  function recoverOwnership(
    e: unknown,
    r: NonNullable<typeof room.current>,
    failedLeaseId?: string,
  ) {
    if (!(e instanceof ApiError) || !isCurrent(r)) return;
    if (e.code === 'LEASE_EXPIRED' && lease.current?.id === failedLeaseId) {
      // A late renewal failure for an older lease must not clear a new owner proof.
      lease.current = null;
    }
    if (e.code === 'SESSION_EXPIRED') {
      // Reconnect once, preserving the draft and any command with an unknown
      // outcome. That command is retried with its original idempotency key.
      lease.current = null;
      r.reconnectRequested = true;
      setSession(null);
      setReconnectKey((n) => n + 1);
    }
  }
  async function release(r = room.current) {
    const owned = lease.current;
    if (!r?.session || !owned) return;
    // Keep the proof until release is acknowledged; a failed response is safe to retry.
    try {
      await api(endpoint(r, `/leases/${owned.id}`), {
        ...jsonRequest('DELETE', { sessionId: r.session.id, fence: owned.fence }),
        signal: r.controller.signal,
      });
    } catch (e) {
      if (!(e instanceof ApiError && (e.code === 'LEASE_EXPIRED' || e.code === 'SESSION_EXPIRED')))
        throw e;
    }
    if (lease.current?.id === owned.id) lease.current = null;
  }
  async function install(
    headValue: Head,
    candidate: EditorRecipe,
    r: NonNullable<typeof room.current>,
  ) {
    const raw = latest.current.editor;
    const before = raw.getRecipe();
    const missing =
      (candidate.schemaVersion === 3 || candidate.schemaVersion === 4) &&
      candidate.imageLayers.some((l) => !raw.getLayerFiles().has(l.sourceId));
    if (missing) {
      const refs = await latest.current.resolveReferences(candidate, () => isCurrent(r));
      if (!isCurrent(r)) return false;
      await raw.ensureLayerSources(refs, () => isCurrent(r));
    }
    if (!isCurrent(r) || raw.getRecipe() !== before) return false;
    head.current = headValue;
    raw.acceptRemoteRecipe(candidate);
    latest.current.onHead(headValue);
    return true;
  }
  async function receive(value: Snapshot, r: NonNullable<typeof room.current>) {
    if (!isCurrent(r)) return;
    setSnapshot(value);
    const current = head.current;
    if (value.revision && (!current || value.artwork.headVersion > current.artwork.headVersion)) {
      if (current && current.asset.id !== value.asset.id) {
        setStatus('conflict');
        setError('队员更换了底图。本地画面已保留，请导出或另存草稿后载入最新作品。');
        return;
      }
      const next: Head = { artwork: value.artwork, revision: value.revision, asset: value.asset };
      // An in-flight command will either return this head or rebase against it. Do not
      // race its acknowledgement or replace a live pointer gesture's recipe object.
      if (processing.current || lastCommand.current) return;
      if (draft.current) {
        try {
          mergeOwnDraft(
            draft.current.base.revision.recipe,
            draft.current.recipe,
            value.revision.recipe,
          );
          head.current = next;
          latest.current.onHead(next);
          // Keep the live pointer's local recipe identity. The authoritative command
          // rebases this one target onto the latest head when the gesture is confirmed.
        } catch (e) {
          setStatus('conflict');
          setError(errorMessage(e));
          return;
        }
      } else if (!(await install(next, parseEditorRecipe(value.revision.recipe), r))) return;
    }
    let preview = head.current?.revision.recipe;
    if (!draft.current && preview && !processing.current) {
      const ownSession = r.session?.id;
      try {
        let changed = false;
        for (const candidate of value.previews) {
          if (
            candidate.sessionId === ownSession ||
            candidate.baseVersion !== value.artwork.headVersion
          )
            continue;
          const next = applyOperation(preview, candidate.operation);
          if (
            (next.schemaVersion === 3 || next.schemaVersion === 4) &&
            next.imageLayers.some((l) => !latest.current.editor.getLayerFiles().has(l.sourceId))
          )
            continue;
          preview = next;
          changed = true;
        }
        setRemotePreview(changed ? preview : null);
      } catch {
        setRemotePreview(null);
      }
    } else setRemotePreview(null);
  }
  function schedule(delay = 0) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void flush();
    }, delay);
  }
  function flush(): Promise<void> {
    if (activeFlush.current) {
      flushRequested.current = true;
      return activeFlush.current;
    }
    flushRequested.current = false;
    const task = runFlush();
    activeFlush.current = task;
    void task.finally(() => {
      if (activeFlush.current !== task) return;
      activeFlush.current = null;
      if (flushRequested.current && draft.current && !lastFailure.current) schedule();
    });
    return task;
  }
  async function runFlush() {
    const r = room.current;
    if (
      !r?.session ||
      !isCurrent(r) ||
      processing.current ||
      suspended.current ||
      !draft.current ||
      !latest.current.canEdit
    )
      return;
    processing.current = true;
    lastFailure.current = null;
    let submittedLeaseId: string | undefined;
    try {
      let work = draft.current;
      if (work.committed && !lastCommand.current) {
        const prepared = await latest.current.prepareRecipe(work.recipe);
        if (!isCurrent(r)) return;
        if (draft.current !== work) {
          schedule();
          return;
        }
        if (!same(prepared, work.recipe)) {
          work.recipe = prepared;
          latest.current.editor.preview(prepared);
        }
      }
      let operation = operationBetween(work.base.revision.recipe, work.recipe);
      if (!operation && !lastCommand.current) {
        draft.current = null;
        setPendingCount(0);
        if (head.current)
          await install(head.current, parseEditorRecipe(head.current.revision.recipe), r);
        await release(r);
        setStatus('ready');
        return;
      }
      const target = lastCommand.current
        ? operationTarget(lastCommand.current.command.operation)
        : operationTarget(operation!);
      presence.current.selection = target;
      if (!lastCommand.current && (!lease.current || !same(lease.current.target, target))) {
        setStatus('acquiring');
        await release(r);
        const acquired = await api<{ lease: CollaborationLease }>(endpoint(r, '/leases'), {
          ...jsonRequest('POST', { sessionId: r.session.id, target }),
          signal: r.controller.signal,
        });
        if (!isCurrent(r)) return;
        lease.current = acquired.lease;
      }
      if (!isCurrent(r)) return;
      // Collapse pointer-move drafts while the lease request was travelling.
      if (!lastCommand.current && draft.current !== work) {
        schedule();
        return;
      }
      work = draft.current ?? work;
      const owned = lease.current;
      submittedLeaseId = lastCommand.current?.command.leaseId ?? owned?.id;
      if (!owned && !lastCommand.current) throw new Error('编辑权尚未取得，请重试同步。');
      if (work.committed || lastCommand.current) {
        setStatus('saving');
        if (!lastCommand.current)
          lastCommand.current = {
            command: {
              protocolVersion: 1,
              idempotencyKey: secureUuid(),
              sessionId: r.session.id,
              leaseId: owned!.id,
              fence: owned!.fence,
              baseVersion: work.base.artwork.headVersion,
              operation: operation!,
            },
            before: work.base,
            candidate: work.recipe,
            label: work.label,
            intent: work.intent,
          };
        const submitted = lastCommand.current;
        const result = await api<CommandResult>(endpoint(r, '/commands'), {
          ...jsonRequest('POST', submitted.command),
          signal: r.controller.signal,
        });
        if (!isCurrent(r)) return;
        lastCommand.current = null;
        const accepted: Head = {
          artwork: result.artwork,
          revision: result.revision,
          asset: result.asset,
        };
        r.cursor = result.cursor;
        const remaining = draft.current;
        head.current = accepted;
        latest.current.onHead(accepted);
        if (submitted.intent === 'edit') {
          const inverse = operationBetween(submitted.candidate, submitted.before.revision.recipe);
          const ownBefore = inverse
            ? applyOperation(result.revision.recipe, inverse)
            : result.revision.recipe;
          undo.current.push({
            before: ownBefore,
            after: result.revision.recipe,
            label: submitted.label,
          });
          redo.current = [];
        } else if (submitted.intent === 'undo') {
          const entry = undo.current.pop();
          if (entry) redo.current.push(entry);
        } else {
          const entry = redo.current.pop();
          if (entry) undo.current.push(entry);
        }
        updateHistory();
        if (remaining && !same(remaining.recipe, submitted.candidate)) {
          const merged = mergeOwnDraft(
            submitted.candidate,
            remaining.recipe,
            result.revision.recipe,
          );
          draft.current = { ...remaining, base: accepted, recipe: merged };
          latest.current.editor.preview(merged);
          setPendingCount(1);
        } else {
          draft.current = null;
          setPendingCount(0);
          await install(accepted, parseEditorRecipe(result.revision.recipe), r);
        }
        await release(r);
        setStatus('ready');
        setError(null);
        setRemotePreview(null);
        if (draft.current) schedule();
      } else {
        const elapsed = Date.now() - lastPreview.current;
        if (elapsed < 320) {
          schedule(320 - elapsed);
          return;
        }
        await api(endpoint(r, '/previews'), {
          ...jsonRequest('POST', {
            sessionId: r.session.id,
            leaseId: owned!.id,
            fence: owned!.fence,
            baseVersion: work.base.artwork.headVersion,
            sequence: ++r.previewSequence,
            operation,
          }),
          signal: r.controller.signal,
        });
        if (!isCurrent(r)) return;
        lastPreview.current = Date.now();
        setStatus('previewing');
        setError(null);
        if (draft.current !== work) schedule(320);
      }
    } catch (e) {
      if (isCurrent(r)) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) lastCommand.current = null;
        stateError(e);
        recoverOwnership(e, r, submittedLeaseId);
      }
    } finally {
      if (room.current === r) {
        processing.current = false;
        if (discardRequested.current && !lastCommand.current) {
          discardRequested.current = false;
          try {
            await release(r);
            if (isCurrent(r)) {
              setStatus('ready');
              setError(null);
            }
          } catch (e) {
            if (isCurrent(r)) stateError(e);
          }
        }
      }
    }
  }
  const queue = useCallback(
    (next: EditorRecipe, label: string, committed: boolean, intent: Draft['intent'] = 'edit') => {
      const r = room.current,
        current = head.current;
      if (!latest.current.enabled || !r || !current) return;
      const existing = draft.current;
      discardRequested.current = false;
      draft.current = { base: existing?.base ?? current, recipe: next, label, committed, intent };
      setPendingCount(1);
      setRemotePreview(null);
      if (!latest.current.canEdit) {
        draft.current.committed = false;
        setStatus('forbidden');
        setError('当前空间角色仅能查看；本地调整已保留，可以导出或另存到有编辑权限的项目。');
        return;
      }
      schedule(committed ? 0 : 80);
    },
    [],
  );
  useEffect(() => {
    const o = latest.current;
    if (!o.enabled || !o.artwork || !o.asset || !o.revision) {
      setStatus('off');
      setSession(null);
      setSnapshot(null);
      return;
    }
    const controller = new AbortController();
    const r = {
      id: o.artwork.id,
      epoch: ++epoch.current,
      source: o.editor.getSourceIdentity(),
      controller,
      session: null as CollaborationSession | null,
      cursor: '0',
      sequence: 0,
      previewSequence: 0,
      reconnectRequested: false,
    };
    const sameSource =
      connectionIdentity.current?.id === r.id && connectionIdentity.current.source === r.source;
    connectionIdentity.current = { id: r.id, source: r.source };
    if (!sameSource) {
      draft.current = null;
      setPendingCount(0);
      undo.current = [];
      redo.current = [];
      updateHistory();
    }
    head.current = { artwork: o.artwork, revision: o.revision, asset: o.asset };
    room.current = r;
    lease.current = null;
    processing.current = false;
    activeFlush.current = null;
    if (!sameSource) suspended.current = false;
    discardRequested.current = false;
    if (!sameSource) lastCommand.current = null;
    setStatus('connecting');
    setError(null);
    setSession(null);
    setSnapshot(null);
    setRemotePreview(null);
    async function connect() {
      try {
        const result = await api<{ session: CollaborationSession; snapshot: Snapshot }>(
          endpoint(r, '/sessions'),
          { ...jsonRequest('POST', { clientId: secureUuid() }), signal: controller.signal },
        );
        if (!isCurrent(r)) return;
        r.session = result.session;
        setSession(result.session);
        setStatus('ready');
        await receive(result.snapshot, r);
        if (draft.current) schedule();
        while (isCurrent(r)) {
          try {
            const p = new URLSearchParams({
              after: r.cursor,
              waitMs: '20000',
              knownVersion: String(head.current?.artwork.headVersion ?? 1),
            });
            const value = await api<CollaborationPollResponse<Artwork, Revision, Asset>>(
              endpoint(r, `?${p}`),
              { signal: controller.signal },
            );
            if (!isCurrent(r)) break;
            r.cursor = value.cursor;
            await receive(value.snapshot, r);
            if (!value.hasMore) await wait(150, controller.signal);
          } catch (e) {
            if (!isCurrent(r)) break;
            stateError(e);
            if (e instanceof ApiError && (e.status === 401 || e.status === 403)) break;
            await wait(2000, controller.signal);
          }
        }
      } catch (e) {
        if (isCurrent(r)) stateError(e);
      }
    }
    void connect();
    const heartbeat = window.setInterval(async () => {
      if (!r.session || !isCurrent(r)) return;
      let renewingLeaseId: string | undefined;
      try {
        await api(endpoint(r, `/sessions/${r.session.id}`), {
          ...jsonRequest('PATCH', {
            sequence: ++r.sequence,
            ...presence.current,
            tool: latest.current.tool,
          }),
          signal: controller.signal,
        });
        const own = lease.current;
        if (own) {
          renewingLeaseId = own.id;
          const renewed = await api<{ lease: CollaborationLease }>(
            endpoint(r, `/leases/${own.id}`),
            {
              ...jsonRequest('PATCH', { sessionId: r.session.id, fence: own.fence }),
              signal: controller.signal,
            },
          );
          if (isCurrent(r) && lease.current?.id === own.id) lease.current = renewed.lease;
        }
      } catch (e) {
        if (isCurrent(r)) {
          stateError(e);
          recoverOwnership(e, r, renewingLeaseId);
        }
      }
    }, 10_000);
    return () => {
      controller.abort();
      window.clearInterval(heartbeat);
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (r.session)
        void api(endpoint(r, `/sessions/${r.session.id}`), {
          ...jsonRequest('DELETE'),
          keepalive: true,
        }).catch(() => {});
      if (room.current === r) room.current = null;
    };
  }, [options.enabled, options.artwork?.id, options.editor.getSourceIdentity(), reconnectKey]);

  const setCursor = useCallback((cursor: Point | null) => {
    presence.current.cursor = cursor;
    const r = room.current;
    if (!r?.session || !isCurrent(r) || Date.now() - lastPresence.current < 280) return;
    lastPresence.current = Date.now();
    void api(endpoint(r, `/sessions/${r.session.id}`), {
      ...jsonRequest('PATCH', {
        sequence: ++r.sequence,
        ...presence.current,
        tool: latest.current.tool,
      }),
      signal: r.controller.signal,
    }).catch((e) => {
      if (isCurrent(r)) {
        stateError(e);
        recoverOwnership(e, r);
      }
    });
  }, []);
  const cancelPreview = useCallback(() => {
    if (!latest.current.enabled) {
      latest.current.editor.cancelPreview();
      return;
    }
    if (lastCommand.current) {
      setError('当前保存请求尚未确认，请等待确认后撤销，避免误判保存状态。');
      return;
    }
    // Lease acquisition and transient-preview requests may be cancelled locally.
    // Their late response must release the lease, not bring a discarded draft back.
    discardRequested.current = processing.current;
    draft.current = null;
    setPendingCount(0);
    if (head.current) latest.current.editor.acceptRemoteRecipe(head.current.revision.recipe);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (processing.current) return;
    void release()
      .then(() => {
        setStatus('ready');
        setError(null);
      })
      .catch(stateError);
  }, []);
  function historyMove(direction: 'undo' | 'redo') {
    if (direction === 'undo' && draft.current && !draft.current.committed && !lastCommand.current) {
      cancelPreview();
      return;
    }
    if (!options.enabled || !options.canEdit) {
      options.editor[direction]();
      if (options.enabled) queue(options.editor.getRecipe(), '本地撤销重做', false);
      return;
    }
    if (draft.current || processing.current || !head.current) {
      setError('先完成当前调整的同步或取消预览，再撤销已发布操作。');
      return;
    }
    const edit = (direction === 'undo' ? undo.current : redo.current).at(-1);
    if (!edit) return;
    try {
      const next =
        direction === 'undo'
          ? inverseOnLatest(edit.before, edit.after, head.current.revision.recipe)
          : inverseOnLatest(edit.after, edit.before, head.current.revision.recipe);
      options.editor.commit(next, `${direction === 'undo' ? '撤销' : '重做'}${edit.label}`);
      queue(next, edit.label, true, direction);
    } catch (e) {
      setError(errorMessage(e));
      setStatus('conflict');
    }
  }
  const editor: EditorState = {
    ...options.editor,
    preview(next) {
      options.editor.preview(next);
      queue(next, '实时调整', false);
    },
    commit(next, label = '调整照片') {
      options.editor.commit(next, label);
      queue(options.editor.getRecipe(), label, true);
    },
    commitCurrent(label = '调整照片') {
      options.editor.commitCurrent(label);
      queue(options.editor.getRecipe(), label, true);
    },
    cancelPreview,
    undo: () => historyMove('undo'),
    redo: () => historyMove('redo'),
    canUndo:
      options.enabled && options.canEdit
        ? (!!draft.current && !draft.current.committed && !lastCommand.current) ||
          (historyState.undo > 0 && !pendingCount)
        : options.editor.canUndo,
    canRedo:
      options.enabled && options.canEdit
        ? historyState.redo > 0 && !pendingCount
        : options.editor.canRedo,
    async importImageLayer(file) {
      await options.editor.importImageLayer(file);
      queue(options.editor.getRecipe(), '添加合成素材', true);
    },
    async importRecipe(file) {
      await options.editor.importRecipe(file);
      queue(options.editor.getRecipe(), '导入配方', true);
    },
    reset() {
      options.editor.reset();
      queue(options.editor.getRecipe(), '恢复原图', true);
    },
  };
  return {
    editor,
    enabled: options.enabled,
    status,
    error,
    snapshot,
    session,
    remotePreview,
    pendingCount,
    setCursor,
    retry() {
      setError(null);
      if (room.current?.session) {
        if (draft.current) schedule();
        else setStatus('ready');
      } else setReconnectKey((n) => n + 1);
    },
    reconnect() {
      setReconnectKey((n) => n + 1);
    },
    discardDraft: cancelPreview,
    async beforeExternalWrite() {
      if (draft.current || processing.current || lastCommand.current)
        throw new Error('当前协作调整尚未同步，请先完成同步或取消预览。');
      suspended.current = true;
      try {
        await release();
      } catch (e) {
        suspended.current = false;
        throw e;
      }
    },
    async afterExternalWrite() {
      suspended.current = false;
      if (draft.current) {
        schedule();
        return;
      }
      const r = room.current;
      if (!r?.session || !isCurrent(r)) return;
      // A normal poll may be waiting for its timeout. Refresh before enabling the
      // next AI action so it cannot capture the version preceding our own write.
      const next = await api<Head>(`/artworks/${r.id}`, { signal: r.controller.signal });
      if (!isCurrent(r) || draft.current || processing.current || lastCommand.current) return;
      if (next.asset.id !== head.current?.asset.id) {
        setStatus('conflict');
        setError('底图已更新，请重新打开作品后继续。');
        return;
      }
      if (next.artwork.headVersion > (head.current?.artwork.headVersion ?? 0))
        await install(next, parseEditorRecipe(next.revision.recipe), r);
    },
    async publishCurrent() {
      const r = room.current;
      function reject(message: string): never {
        const failure = new Error(message);
        stateError(failure);
        if (!latest.current.canEdit) setStatus('forbidden');
        throw failure;
      }
      if (!r?.session || !isCurrent(r)) reject('协作尚未连接；本地画面保留，请连接后再保存。');
      if (!latest.current.canEdit) reject('当前角色不能发布到共享作品，请另存到有编辑权限的项目。');
      if (suspended.current) reject('正在处理作品版本，请稍后再保存。');
      queue(latest.current.editor.getRecipe(), '保存调整', true);
      // Wait through an earlier preview flight. Returning from a busy flush does
      // not mean the requested recipe was acknowledged by the server.
      while (isCurrent(r) && (draft.current || lastCommand.current)) {
        await flush();
        if (lastFailure.current) throw lastFailure.current;
        if (draft.current && !draft.current.committed)
          reject('保存期间又开始了新的调整，当前预览仍保留；完成调整后再确认保存。');
      }
      if (!isCurrent(r)) reject('协作会话已改变，不能确认当前画面的保存状态。');
    },
  };
}
export type CollaborationState = ReturnType<typeof useCollaboration>;
