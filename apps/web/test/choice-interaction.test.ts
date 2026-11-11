import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceChoiceSearch,
  choiceCursor,
  choicePointerMoved,
  choiceScrollTarget,
  choiceSearchActive,
  findChoice,
  moveChoice,
  type ChoiceOption,
} from '../src/components/choice-model.ts';

const choices: ChoiceOption[] = [
  { value: 'unavailable', label: 'Amber unavailable', disabled: true },
  { value: 'amber', label: 'Amber' },
  { value: 'azure', label: 'Azure' },
  { value: 'blue', label: 'Blue' },
];

test('an open selector follows the focused model identity across server reordering', () => {
  assert.equal(choiceCursor(choices, 'azure', 'amber'), 2);
  const reordered = [choices[2]!, choices[0]!, choices[3]!, choices[1]!];
  const cursor = choiceCursor(reordered, 'azure', 'amber');
  assert.equal(cursor, 0);
  assert.equal(reordered[cursor]?.value, 'azure');
  assert.equal(moveChoice(reordered, cursor, 1), 2, 'navigation skips the unavailable model');
});

test('removed or newly disabled choices fall back to an enabled value without committing one', () => {
  const changed = choices.map((option) =>
    option.value === 'azure' ? { ...option, disabled: true } : option,
  );
  assert.equal(choiceCursor(changed, 'azure', 'amber'), 1);
  assert.equal(
    choiceCursor(
      changed.filter((option) => option.value !== 'amber'),
      'azure',
      'amber',
    ),
    2,
  );
  assert.equal(
    choiceCursor(
      choices.map((option) => ({ ...option, disabled: true })),
      'azure',
      'amber',
    ),
    -1,
  );
  assert.equal(choiceCursor([], 'azure', 'amber'), -1);
});

test('typeahead cycles case-insensitive repeated letters and resets after inactivity', () => {
  const first = advanceChoiceSearch(choices, { text: '', time: 0 }, 'a', 1_000, 3);
  assert.equal(first.index, 1);
  const repeated = advanceChoiceSearch(choices, first.search, 'A', 1_080, first.index);
  assert.equal(repeated.index, 2);
  const refined = advanceChoiceSearch(choices, repeated.search, 'm', 1_160, repeated.index);
  assert.equal(refined.index, 1);
  const reset = advanceChoiceSearch(choices, refined.search, 'b', 2_000, refined.index);
  assert.equal(reset.index, 3);
  assert.equal(choiceSearchActive(reset.search, 2_699), true);
  assert.equal(choiceSearchActive(reset.search, 2_700), false);
  assert.equal(choiceSearchActive(reset.search, 1_900), false);
});

test('typeahead accepts normalized full-width text and native Chinese labels', () => {
  assert.equal(findChoice(choices, 'ＡＺ', -1), 2);
  assert.equal(findChoice(choices, 'Amber', 42), 1);
  assert.equal(
    findChoice(
      [
        { value: 'off', label: '人像增强', disabled: true },
        { value: 'on', label: '人像精修' },
      ],
      '人像',
      -1,
    ),
    1,
  );
});

test('stationary hover cannot take keyboard ownership after scrolling the menu', () => {
  assert.equal(choicePointerMoved(null, { x: 40, y: 90 }), false);
  assert.equal(choicePointerMoved({ x: 40, y: 90 }, { x: 40, y: 90 }), false);
  assert.equal(choicePointerMoved({ x: 40, y: 90 }, { x: 41, y: 90 }), true);
  assert.equal(choicePointerMoved({ x: 40, y: 90 }, { x: 40, y: 89 }), true);
});

test('keyboard scrolling reveals measured wrapped rows without moving an already visible option', () => {
  const viewport = { scrollTop: 0, clientHeight: 100, scrollHeight: 350, inset: 5 };
  assert.equal(choiceScrollTarget(viewport, { top: 5, height: 44 }), 0);
  assert.equal(choiceScrollTarget(viewport, { top: 200, height: 70 }), 175);
  assert.equal(choiceScrollTarget({ ...viewport, scrollTop: 175 }, { top: 200, height: 70 }), 175);
  assert.equal(choiceScrollTarget({ ...viewport, scrollTop: 175 }, { top: 5, height: 44 }), 0);
  assert.equal(choiceScrollTarget(viewport, { top: 295, height: 50 }), 250);
  assert.equal(
    choiceScrollTarget(viewport, { top: 100, height: 160 }),
    95,
    'a taller row exposes its start',
  );
  assert.equal(choiceScrollTarget({ ...viewport, clientHeight: 400 }, { top: 295, height: 50 }), 0);
});
