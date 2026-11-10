export const RANGE_KEYS = new Set([
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
  'ArrowUp',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export type RangeCompletion = {
  action: 'commit' | 'cancel';
  initial: number;
  changed: boolean;
};

export type RangeNumberResult =
  | { status: 'valid'; value: number }
  | { status: 'disabled' }
  | { status: 'stale' }
  | { status: 'invalid' };

/** A typed draft never overwrites a value changed while the input was open. */
export function resolveRangeNumber({
  draft,
  initial,
  current,
  min,
  max,
  integer = false,
  disabled = false,
}: {
  draft: string;
  initial: number;
  current: number;
  min: number;
  max: number;
  integer?: boolean;
  disabled?: boolean;
}): RangeNumberResult {
  if (disabled) return { status: 'disabled' };
  if (initial !== current) return { status: 'stale' };
  const value = draft.trim() === '' ? NaN : Number(draft);
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    return { status: 'invalid' };
  return { status: 'valid', value };
}

/** One pointer or keyboard gesture owns a preview. Late events cannot commit a cancelled edit. */
export class RangeGesture {
  private gesture:
    | { kind: 'pointer'; id: number; initial: number; latest: number }
    | { kind: 'keyboard'; keys: Set<string>; initial: number; latest: number }
    | null = null;

  get active() {
    return this.gesture !== null;
  }
  get pointerId() {
    return this.gesture?.kind === 'pointer' ? this.gesture.id : null;
  }
  beginPointer(id: number, value: number, primary = true): boolean {
    if (!primary || this.gesture) return false;
    this.gesture = { kind: 'pointer', id, initial: value, latest: value };
    return true;
  }
  beginKey(key: string, value: number): boolean {
    if (!RANGE_KEYS.has(key) || this.gesture?.kind === 'pointer') return false;
    if (!this.gesture)
      this.gesture = { kind: 'keyboard', keys: new Set(), initial: value, latest: value };
    this.gesture.keys.add(key);
    return true;
  }
  change(value: number) {
    if (this.gesture && Number.isFinite(value)) this.gesture.latest = value;
  }
  endPointer(id: number, cancel = false): RangeCompletion | null {
    if (this.gesture?.kind !== 'pointer' || this.gesture.id !== id) return null;
    return this.finish(cancel ? 'cancel' : 'commit');
  }
  endKey(key: string): RangeCompletion | null {
    if (this.gesture?.kind !== 'keyboard' || !this.gesture.keys.delete(key)) return null;
    return this.gesture.keys.size ? null : this.finish('commit');
  }
  cancel(): RangeCompletion | null {
    return this.finish('cancel');
  }
  commit(): RangeCompletion | null {
    return this.finish('commit');
  }
  discard() {
    this.gesture = null;
  }
  private finish(action: RangeCompletion['action']): RangeCompletion | null {
    const active = this.gesture;
    if (!active) return null;
    this.gesture = null;
    return { action, initial: active.initial, changed: active.initial !== active.latest };
  }
}
