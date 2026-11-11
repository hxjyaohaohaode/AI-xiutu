/** Orders browser observations; it never grants access or replaces server authorization. */
export type SessionSnapshot = Readonly<{ epoch: number; actor: string | null }>;
export type SessionRead = SessionSnapshot & Readonly<{ sequence: number }>;
export type SessionMutation = SessionSnapshot & Readonly<{ kind: 'logout' }>;

export class SessionFence {
  private epoch = 0;
  private actor: string | null = null;
  private sequence = 0;
  private mutation: SessionMutation | null = null;

  snapshot(): SessionSnapshot {
    return { epoch: this.epoch, actor: this.actor };
  }

  isCurrent(owner: SessionSnapshot): boolean {
    return owner.epoch === this.epoch && owner.actor === this.actor;
  }

  get busy(): boolean {
    return this.mutation !== null;
  }

  /** Opening an explicit auth flow supersedes any earlier background session read. */
  invalidateReads() {
    ++this.sequence;
  }

  read(): SessionRead | null {
    if (this.mutation) return null;
    return { ...this.snapshot(), sequence: ++this.sequence };
  }

  ownsRead(read: SessionRead): boolean {
    return !this.mutation && this.isCurrent(read) && read.sequence === this.sequence;
  }

  /** Same-actor membership refreshes do not invalidate an active auth intent. */
  acceptRead(read: SessionRead, actor: string | null): boolean {
    if (!this.ownsRead(read)) return false;
    ++this.sequence;
    if (actor !== this.actor) this.replace(actor);
    return true;
  }

  replace(actor: string | null) {
    this.actor = actor;
    ++this.epoch;
    ++this.sequence;
    this.mutation = null;
  }

  beginLogout(): SessionMutation | null {
    if (this.mutation || this.actor === null) return null;
    ++this.epoch;
    ++this.sequence;
    this.mutation = { ...this.snapshot(), kind: 'logout' };
    return this.mutation;
  }

  ownsLogout(owner: SessionMutation): boolean {
    return this.mutation === owner && this.isCurrent(owner);
  }

  finishLogout(owner: SessionMutation, actor: string | null): boolean {
    if (!this.ownsLogout(owner)) return false;
    this.replace(actor);
    return true;
  }

  releaseLogout(owner: SessionMutation): boolean {
    if (!this.ownsLogout(owner)) return false;
    this.mutation = null;
    ++this.epoch;
    ++this.sequence;
    return true;
  }
}
