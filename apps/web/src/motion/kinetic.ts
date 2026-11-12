/** Presentation-only springs. Values written to the editor never pass through this scheduler. */
export type SpringOptions = {
  stiffness?: number;
  damping?: number;
  mass?: number;
  precision?: number;
};
export type SpringState = { value: number; velocity: number };

const defaults = { stiffness: 320, damping: 30, mass: 1, precision: 0.002 };
type Settings = typeof defaults;

/** Small bounded substeps remain stable after a slow render or a resumed tab. */
export function stepSpring(
  state: SpringState,
  target: number,
  seconds: number,
  options: SpringOptions = {},
): SpringState {
  const settings = { ...defaults, ...options };
  const duration = Math.max(0, Math.min(0.05, seconds));
  const steps = Math.max(1, Math.ceil(duration * 240));
  const dt = duration / steps;
  let { value, velocity } = state;
  for (let index = 0; index < steps; index++) {
    velocity +=
      (((target - value) * settings.stiffness - velocity * settings.damping) / settings.mass) * dt;
    value += velocity * dt;
  }
  return { value, velocity };
}

const moving = new Set<KineticValue>();
let frame: number | null = null;
let previousTime: number | null = null;
let observingVisibility = false;
let ticking = false;

function stopClock() {
  if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  frame = null;
  previousTime = null;
  if (observingVisibility) document.removeEventListener('visibilitychange', onVisibility);
  observingVisibility = false;
}
function onVisibility() {
  if (document.visibilityState !== 'hidden') return;
  for (const value of [...moving]) value.jump(value.target);
  stopClock();
}
function tick(time: number) {
  frame = null;
  ticking = true;
  const seconds = previousTime === null ? 1 / 60 : Math.max(0, (time - previousTime) / 1000);
  previousTime = time;
  for (const value of [...moving]) value.advance(seconds);
  ticking = false;
  if (moving.size) frame = requestAnimationFrame(tick);
  else stopClock();
}
function wake(value: KineticValue) {
  moving.add(value);
  if (frame !== null || ticking) return;
  if (typeof document !== 'undefined' && !observingVisibility) {
    document.addEventListener('visibilitychange', onVisibility);
    observingVisibility = true;
  }
  frame = requestAnimationFrame(tick);
}

export class KineticValue {
  value: number;
  velocity = 0;
  target: number;
  private reduced = false;
  private settings: Settings;
  private listeners = new Set<(value: number, velocity: number) => void>();

  constructor(initial: number, options: SpringOptions = {}) {
    this.value = this.target = Number.isFinite(initial) ? initial : 0;
    this.settings = { ...defaults, ...options };
  }
  configure(options: SpringOptions) {
    this.settings = { ...this.settings, ...options };
    return this;
  }
  subscribe(listener: (value: number, velocity: number) => void) {
    this.listeners.add(listener);
    listener(this.value, this.velocity);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setReduced(reduced: boolean) {
    this.reduced = reduced;
    if (reduced) this.jump(this.target);
  }
  setTarget(target: number) {
    if (!Number.isFinite(target)) return;
    this.target = target;
    if (
      this.reduced ||
      typeof requestAnimationFrame !== 'function' ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    ) {
      this.jump(target);
      return;
    }
    if (
      Math.abs(target - this.value) <= this.settings.precision &&
      Math.abs(this.velocity) <= this.settings.precision
    ) {
      this.jump(target);
      return;
    }
    wake(this);
  }
  jump(value: number) {
    if (!Number.isFinite(value)) return;
    this.target = this.value = value;
    this.velocity = 0;
    moving.delete(this);
    for (const listener of this.listeners) listener(value, 0);
    if (!moving.size) stopClock();
  }
  /** Remove pending work on unmount; the same object can resume after a StrictMode setup. */
  stop() {
    moving.delete(this);
    this.velocity = 0;
    if (!moving.size) stopClock();
  }
  dispose() {
    this.stop();
    this.listeners.clear();
  }
  advance(seconds: number) {
    const next = stepSpring(this, this.target, seconds, this.settings);
    if (
      Math.abs(next.value - this.target) <= this.settings.precision &&
      Math.abs(next.velocity) <= this.settings.precision
    ) {
      this.jump(this.target);
      return;
    }
    this.value = next.value;
    this.velocity = next.velocity;
    for (const listener of this.listeners) listener(this.value, this.velocity);
  }
}
