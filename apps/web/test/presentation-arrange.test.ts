import assert from 'node:assert/strict';
import test from 'node:test';
import { alignElements, distributeElements, matchSize } from '../src/project-files/presentation-arrange';
import { newBox } from '../src/project-files/presentation-model';

const box = (x: number, y: number, width: number, height: number) => ({ ...newBox(width, height), x, y });

test('one object aligns to the slide; several align to their shared bounds', () => {
  const a = box(100, 100, 200, 100);
  const [centred] = alignElements([a], [a.id], 'center');
  assert.equal(centred!.x, 700); // (1600 - 200) / 2
  const [bottom] = alignElements([a], [a.id], 'bottom');
  assert.equal(bottom!.y, 800);
  const b = box(500, 300, 100, 50);
  const aligned = alignElements([a, b], [a.id, b.id], 'right');
  assert.deepEqual(aligned.map((e) => e.x + e.width), [600, 600]);
  const middle = alignElements([a, b], [a.id, b.id], 'middle');
  assert.deepEqual(middle.map((e) => e.y + e.height / 2), [225, 225]);
});

test('distribution keeps the outer objects and equalises every gap', () => {
  const items = [box(0, 0, 100, 50), box(150, 0, 200, 50), box(900, 0, 100, 50), box(400, 400, 50, 50)];
  const ids = items.slice(0, 3).map((e) => e.id);
  const spread = distributeElements(items, ids, 'horizontal');
  const [l, m, r] = spread.slice(0, 3);
  assert.equal(l!.x, 0);
  assert.equal(r!.x, 900);
  assert.equal(m!.x - (l!.x + l!.width), r!.x - (m!.x + m!.width)); // equal gaps
  assert.equal(spread[3], items[3]); // unselected untouched
  assert.equal(distributeElements(items, ids.slice(0, 2), 'horizontal'), items); // needs 3+
});

test('match size copies the first selected object and keeps objects on the slide', () => {
  const a = box(0, 0, 300, 120),
    b = box(1500, 0, 50, 40);
  const [, sized] = matchSize([a, b], [a.id, b.id], 'width');
  assert.equal(sized!.width, 300);
  assert.equal(sized!.x, 1300); // clamped inside the 1600-wide slide
});
