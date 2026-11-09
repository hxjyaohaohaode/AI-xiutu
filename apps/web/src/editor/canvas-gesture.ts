/** Shared by the viewport capture handlers and the edit-start path. Two-finger
 * navigation remains available when no editing transaction owns a pointer. */
export class CanvasPointerOwnership {
  private readonly pointers = new Set<number>();
  private suppressed = false;

  down(pointerId: number, editingPointer: number | null): 'allow' | 'block' | 'cancel-edit' {
    this.pointers.add(pointerId);
    if (this.suppressed) return 'block';
    if (editingPointer === null) return 'allow';
    if (editingPointer === pointerId) return 'block';
    // A captured edit pointer may have started before a viewport remount.
    this.pointers.add(editingPointer);
    this.suppressed = true;
    return 'cancel-edit';
  }

  canStart(pointerId: number): boolean {
    return !this.suppressed && this.pointers.size === 1 && this.pointers.has(pointerId);
  }

  get blocked(): boolean {
    return this.suppressed;
  }

  /** Return the state before release so the final suppressed up cannot commit. */
  up(pointerId: number): boolean {
    const blocked = this.suppressed;
    this.pointers.delete(pointerId);
    if (!this.pointers.size) this.suppressed = false;
    return blocked;
  }

  reset(): void {
    this.pointers.clear();
    this.suppressed = false;
  }
}

export interface CanvasEditSnapshot<T> {
  identity: number;
  base: T;
  rollback?: T;
  lastPreview: T;
}

/** Cancellation may only roll back the preview it still owns, never a newer
 * source, an undo, a different control's update, or an imported AI candidate. */
export function ownedCanvasRollback<T>(
  state: CanvasEditSnapshot<T>,
  sourceIdentity: number,
  current: T,
): T | null {
  return state.identity === sourceIdentity && state.lastPreview === current
    ? (state.rollback ?? state.base)
    : null;
}
