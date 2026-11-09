import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { motionProfile, motionRegistry, type MotionRole } from '../src/motion/registry.ts';
test('component motion has explicit independently selected desktop, tablet and phone tracks', () => {
  const roles = Object.keys(motionRegistry) as MotionRole[];
  assert.ok(roles.length >= 50);
  const profiles = new Set<string>();
  for (const role of roles) {
    const definition = motionRegistry[role];
    assert.equal(motionProfile(role, 390), definition.phone);
    assert.equal(motionProfile(role, 844), definition.tablet);
    assert.equal(motionProfile(role, 1440), definition);
    profiles.add(
      JSON.stringify([
        definition.family,
        definition.entryMs,
        definition.exitMs,
        definition.delayMs,
        definition.blurPx,
        definition.x,
        definition.y,
      ]),
    );
    for (const width of [390, 844, 1440]) {
      const p = motionProfile(role, width);
      assert.ok(p.entryMs > 0 && p.entryMs <= 500);
      assert.ok(p.exitMs > 0 && p.exitMs <= 300);
      assert.ok(p.delayMs >= 0 && p.delayMs <= 100);
      if (p.pixelSafe) assert.equal(p.blurPx, 0, role + ' must never blur media');
    }
  }
  assert.ok(profiles.size >= 45, 'roles must not collapse into a single universal fade');
});
test('all media-containing wrappers keep zero blur in every breakpoint', () => {
  for (const role of [
    'panel-frame',
    'modal-frame',
    'drawing-frame',
    'artwork-media',
    'ai-result-media',
    'ai-reference',
  ] as MotionRole[])
    for (const width of [390, 844, 1440]) assert.equal(motionProfile(role, width).blurPx, 0, role);
});
test('CSS includes reduced-motion and gesture escape paths with hidden state inert support', () => {
  const css = readFileSync(new URL('../src/motion/motion.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /data-gesture='active'/);
  assert.match(css, /data-motion-state='hidden'/);
  for (const role of Object.keys(motionRegistry))
    assert.ok(css.includes(`[data-motion='${role}']`), role + ' missing CSS track');
});
