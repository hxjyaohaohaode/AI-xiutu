import type { ProjectDocument } from '../lib/types';

export type DocumentDraftInput = Readonly<{
  actorId: string;
  projectId: string;
  projectTitle: string;
  base: Readonly<ProjectDocument> | null;
  title: string;
  body: string;
}>;

export type DocumentDraft = DocumentDraftInput &
  Readonly<{
    revision: number;
    lineage: number;
    capturedAt: number;
    saveState: 'idle' | 'pending' | 'unknown';
    saveRevision: number | null;
  }>;

type DraftWrite =
  { ok: true; draft: DocumentDraft } | { ok: false; reason: 'invalid' | 'capacity' };

const keyFor = (actorId: string, projectId: string) => JSON.stringify([actorId, projectId]);
const emptyDraftList: readonly DocumentDraft[] = Object.freeze([]);
export function isProjectDocument(value: unknown): value is ProjectDocument {
  if (!value || typeof value !== 'object') return false;
  const base = value as ProjectDocument;
  return (
    typeof base.id === 'string' &&
    base.id.length > 0 &&
    base.id.length <= 128 &&
    typeof base.title === 'string' &&
    base.title.length <= 120 &&
    typeof base.body === 'string' &&
    base.body.length <= 100000 &&
    Number.isSafeInteger(base.version) &&
    base.version > 0 &&
    typeof base.updatedAt === 'string' &&
    base.updatedAt.length <= 64 &&
    Number.isFinite(Date.parse(base.updatedAt))
  );
}
const validBase = (base: Readonly<ProjectDocument> | null) =>
  base === null || isProjectDocument(base);

export function projectDocumentsFromResponse(value: unknown): ProjectDocument[] {
  const response = value as { documents?: unknown } | null;
  if (
    !response ||
    !Array.isArray(response.documents) ||
    !response.documents.every(isProjectDocument) ||
    new Set(response.documents.map((item) => item.id)).size !== response.documents.length
  )
    throw new Error('文档列表响应不完整，已保留当前内容。');
  return response.documents;
}

export function isDocumentSaveReceipt(
  expected: DocumentDraft,
  value: unknown,
): value is ProjectDocument {
  if (!isProjectDocument(value)) return false;
  const saved = value as ProjectDocument;
  return (
    saved.title === expected.title.trim() &&
    saved.body === expected.body &&
    saved.version === (expected.base ? expected.base.version + 1 : 1) &&
    (!expected.base || saved.id === expected.base.id) &&
    Number.isFinite(Date.parse(saved.updatedAt))
  );
}

type SaveNotice = Readonly<{
  actorId: string;
  projectId: string;
  lineage: number;
  document: Readonly<ProjectDocument>;
}>;
type DiscardNotice = Readonly<{
  actorId: string;
  projectId: string;
  lineage: number;
  base: Readonly<ProjectDocument> | null;
}>;

/** Page-memory recovery only. Never serializes to browser storage or sends a request.
 * Capacity is a refusal, never an eviction: another project's unsaved work cannot
 * disappear merely because a new editor opens. An unmount performs no writes.
 */
export class DocumentDraftStore {
  private entries = new Map<string, DocumentDraft>();
  private listeners = new Set<() => void>();
  private saveListeners = new Set<(notice: SaveNotice) => void>();
  private discardListeners = new Set<(notice: DiscardNotice) => void>();
  private actorLists = new Map<string, readonly DocumentDraft[]>();
  private nextRevision = 0;

  constructor(
    private capacity = 24,
    private now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 24)
      throw new Error('Document draft capacity must be between 1 and 24');
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeSaves = (listener: (notice: SaveNotice) => void) => {
    this.saveListeners.add(listener);
    return () => {
      this.saveListeners.delete(listener);
    };
  };

  subscribeDiscards = (listener: (notice: DiscardNotice) => void) => {
    this.discardListeners.add(listener);
    return () => {
      this.discardListeners.delete(listener);
    };
  };

  private changed() {
    this.actorLists.clear();
    for (const listener of this.listeners) listener();
  }

  count = (actorId?: string | null) =>
    actorId === undefined
      ? this.entries.size
      : actorId
        ? [...this.entries.values()].filter((entry) => entry.actorId === actorId).length
        : 0;

  get(actorId: string | null, projectId: string): DocumentDraft | null {
    return actorId ? (this.entries.get(keyFor(actorId, projectId)) ?? null) : null;
  }

  list(actorId: string | null): readonly DocumentDraft[] {
    if (!actorId) return emptyDraftList;
    let items = this.actorLists.get(actorId);
    if (!items) {
      items = Object.freeze([...this.entries.values()].filter((item) => item.actorId === actorId));
      if (!items.length) return emptyDraftList;
      this.actorLists.set(actorId, items);
    }
    return items;
  }

  put(input: DocumentDraftInput): DraftWrite {
    if (
      typeof input.actorId !== 'string' ||
      !input.actorId ||
      input.actorId.length > 128 ||
      typeof input.projectId !== 'string' ||
      !input.projectId ||
      input.projectId.length > 128 ||
      typeof input.projectTitle !== 'string' ||
      input.projectTitle.length > 120 ||
      typeof input.title !== 'string' ||
      input.title.length > 120 ||
      typeof input.body !== 'string' ||
      input.body.length > 100000 ||
      !validBase(input.base)
    )
      return { ok: false, reason: 'invalid' };
    const key = keyFor(input.actorId, input.projectId);
    const previous = this.entries.get(key);
    if (
      previous &&
      (previous.base?.id !== input.base?.id || previous.base?.version !== input.base?.version)
    )
      return { ok: false, reason: 'invalid' };
    if (!previous && this.entries.size >= this.capacity) return { ok: false, reason: 'capacity' };
    const revision = ++this.nextRevision;
    const draft: DocumentDraft = Object.freeze({
      ...input,
      base: input.base ? Object.freeze({ ...input.base }) : null,
      revision,
      lineage: previous?.lineage ?? revision,
      capturedAt: this.now(),
      saveState: previous?.saveState ?? 'idle',
      saveRevision: previous?.saveRevision ?? null,
    });
    this.entries.set(key, draft);
    this.changed();
    return { ok: true, draft };
  }

  private replace(current: DocumentDraft, patch: Partial<DocumentDraft>) {
    const draft = Object.freeze({ ...current, ...patch, revision: ++this.nextRevision });
    this.entries.set(keyFor(current.actorId, current.projectId), draft);
    this.changed();
    return draft;
  }

  beginSave(expected: DocumentDraft): boolean {
    const current = this.get(expected.actorId, expected.projectId);
    if (
      !current ||
      current.revision !== expected.revision ||
      current.saveState === 'pending' ||
      (!current.base && current.saveState === 'unknown')
    )
      return false;
    this.replace(current, { saveState: 'pending', saveRevision: expected.revision });
    return true;
  }

  finishUnconfirmedSave(expected: DocumentDraft, definitive: boolean) {
    const current = this.get(expected.actorId, expected.projectId);
    if (
      !current ||
      current.lineage !== expected.lineage ||
      current.saveRevision !== expected.revision
    )
      return;
    this.replace(current, {
      saveState: definitive ? 'idle' : 'unknown',
      saveRevision: definitive ? null : current.saveRevision,
    });
  }

  remove(actorId: string, projectId: string, revision: number): boolean {
    const key = keyFor(actorId, projectId);
    if (this.entries.get(key)?.revision !== revision) return false;
    this.entries.delete(key);
    this.changed();
    return true;
  }

  /** Explicit user discard is distinct from successful-save cleanup. A matching
   * active editor must release its copy too; a different lineage stays intact.
   */
  discard(actorId: string, projectId: string, revision: number): boolean {
    const key = keyFor(actorId, projectId);
    const current = this.entries.get(key);
    if (!current || current.revision !== revision || current.saveState === 'pending') return false;
    this.entries.delete(key);
    this.actorLists.clear();
    const notice: DiscardNotice = Object.freeze({
      actorId,
      projectId,
      lineage: current.lineage,
      base: current.base,
    });
    for (const listener of this.discardListeners) listener(notice);
    this.changed();
    return true;
  }

  clearActor(actorId: string) {
    let changed = false;
    for (const [key, entry] of this.entries) {
      if (entry.actorId === actorId) {
        this.entries.delete(key);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** A real save acknowledgement may clear the submitted text or advance the
   * base of text typed in flight. It cannot resurrect an explicitly discarded
   * draft or adopt the version of a different editing lineage.
   */
  acknowledgeSave(
    expected: DocumentDraft,
    saved: ProjectDocument,
  ): 'cleared' | 'retained' | 'stale' {
    const current = this.get(expected.actorId, expected.projectId);
    if (
      !current ||
      current.lineage !== expected.lineage ||
      current.saveRevision !== expected.revision ||
      !isDocumentSaveReceipt(expected, saved) ||
      current.base?.id !== expected.base?.id ||
      current.base?.version !== expected.base?.version
    )
      return 'stale';
    const clean = current.title.trim() === saved.title && current.body === saved.body;
    if (clean) {
      this.remove(current.actorId, current.projectId, current.revision);
    } else
      this.replace(current, {
        base: Object.freeze({ ...saved }),
        saveState: 'idle',
        saveRevision: null,
      });
    // A remounted editor can adopt this acknowledged base without replacing
    // its text. A cleared actor or a different lineage never receives a notice.
    const notice = Object.freeze({
      actorId: current.actorId,
      projectId: current.projectId,
      lineage: current.lineage,
      document: Object.freeze({ ...saved }),
    });
    for (const listener of this.saveListeners) listener(notice);
    return clean ? 'cleared' : 'retained';
  }
}

export function serializeDocumentDraft(draft: DocumentDraft): string {
  return (
    JSON.stringify(
      {
        format: 'project-document-draft',
        formatVersion: 1,
        projectId: draft.projectId,
        projectTitle: draft.projectTitle,
        documentId: draft.base?.id ?? null,
        baseVersion: draft.base?.version ?? null,
        saveState: draft.saveState,
        title: draft.title,
        body: draft.body,
        capturedAt: new Date(draft.capturedAt).toISOString(),
      },
      null,
      2,
    ) + '\n'
  );
}

export const documentDrafts = new DocumentDraftStore();
export const subscribeDocumentDrafts = documentDrafts.subscribe;
export const getDocumentDraftCount = documentDrafts.count;
export const clearDocumentDraftsForActor = (actorId: string) => documentDrafts.clearActor(actorId);
