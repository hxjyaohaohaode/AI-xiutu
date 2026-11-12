import test from 'node:test';
import assert from 'node:assert/strict';
import { KineticValue, stepSpring } from '../src/motion/kinetic.ts';

function clock() {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const queue = new Map<number, FrameRequestCallback>();
  let id = 0,
    time = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const next = ++id;
    queue.set(next, callback);
    return next;
  };
  globalThis.cancelAnimationFrame = (handle) => {
    queue.delete(handle);
  };
  return {
    queue,
    frame() {
      time += 1000 / 60;
      const jobs = [...queue.values()];
      queue.clear();
      for (const callback of jobs) callback(time);
    },
    settle() {
      for (let at = 0; queue.size && at < 600; at++) this.frame();
      assert.equal(queue.size, 0, 'the scheduler must sleep after settling');
    },
    restore() {
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}

test('presentation springs share one frame, settle exactly, and sleep', () => {
  const frames = clock();
  const a = new KineticValue(0),
    b = new KineticValue(100);
  try {
    a.setTarget(230);
    b.setTarget(-40);
    assert.equal(frames.queue.size, 1);
    frames.frame();
    assert.ok(a.value > 0 && a.value < 230);
    assert.ok(b.value < 100);
    frames.settle();
    assert.equal(a.value, 230);
    assert.equal(b.value, -40);
    assert.equal(a.velocity, 0);
    assert.equal(b.velocity, 0);
  } finally {
    a.dispose();
    b.dispose();
    frames.restore();
  }
});

test('a dynamic reduced-motion change snaps current work and later updates without frames', () => {
  const frames = clock(),
    value = new KineticValue(0);
  try {
    value.setTarget(1);
    frames.frame();
    assert.ok(value.value < 1);
    value.setReduced(true);
    assert.equal(value.value, 1);
    assert.equal(frames.queue.size, 0);
    value.setTarget(0);
    assert.equal(value.value, 0);
    assert.equal(frames.queue.size, 0);
    value.setReduced(false);
    value.setTarget(1);
    assert.equal(frames.queue.size, 1);
    value.stop();
    assert.equal(frames.queue.size, 0);
  } finally {
    value.dispose();
    frames.restore();
  }
});

test('work scheduled from a paint callback does not create a second animation clock', () => {
  const frames = clock(),
    a = new KineticValue(0),
    b = new KineticValue(0);
  let started = false;
  const unsubscribe = a.subscribe((value) => {
    if (value > 0 && !started) {
      started = true;
      b.setTarget(5);
    }
  });
  try {
    a.setTarget(10);
    frames.frame();
    assert.equal(frames.queue.size, 1);
    frames.settle();
    assert.equal(b.value, 5);
    unsubscribe();
    a.setTarget(30);
    a.dispose();
    assert.equal(frames.queue.size, 0);
  } finally {
    unsubscribe();
    a.dispose();
    b.dispose();
    frames.restore();
  }
});

test('a long suspended frame cannot destabilize the presentation integrator', () => {
  const state = stepSpring({ value: -20, velocity: 1200 }, 1, 400);
  assert.ok(Number.isFinite(state.value) && Number.isFinite(state.velocity));
  assert.ok(Math.abs(state.value) < 100);
  assert.deepEqual(stepSpring({ value: 2, velocity: 0 }, 2, 1), { value: 2, velocity: 0 });
});
