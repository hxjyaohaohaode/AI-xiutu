import type { MotionPhase } from './registry';

export type MotionSwitchState = { key: string; pendingKey: string; phase: MotionPhase };
export type MotionSwitchEvent =
  | { type: 'sync'; key: string; reduced: boolean }
  | { type: 'settled'; key: string; pendingKey: string; phase: MotionPhase };

/** Stamped completion events cannot resurrect an obsolete view after a rapid switch. */
export function reduceMotionSwitch(
  state: MotionSwitchState,
  event: MotionSwitchEvent,
): MotionSwitchState {
  if (event.type === 'sync') {
    if (event.reduced)
      return state.key === event.key && state.phase === 'idle'
        ? state
        : { key: event.key, pendingKey: event.key, phase: 'idle' };
    if (event.key !== state.key)
      return state.phase === 'exit' && state.pendingKey === event.key
        ? state
        : { ...state, pendingKey: event.key, phase: 'exit' };
    if (state.phase === 'exit' || state.phase === 'hidden')
      return { key: event.key, pendingKey: event.key, phase: 'enter' };
    return state;
  }
  if (
    event.key !== state.key ||
    event.pendingKey !== state.pendingKey ||
    event.phase !== state.phase
  )
    return state;
  return state.phase === 'exit'
    ? { key: state.pendingKey, pendingKey: state.pendingKey, phase: 'enter' }
    : state.phase === 'enter'
      ? { ...state, phase: 'idle' }
      : state;
}
