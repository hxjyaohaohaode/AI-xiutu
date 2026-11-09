import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderTestMarkup } from './support/render.ts';
import { ParameterShelf, parameterControlScrollTop } from '../src/editor/ParameterShelf.tsx';

test('selecting a compact-panel parameter reveals its whole main control with bounded local scrolling', () => {
  const initial = {
    scrollTop: 0,
    viewportTop: 100,
    viewportHeight: 200,
    controlTop: 320,
    controlHeight: 58,
  };
  const below = parameterControlScrollTop(initial);
  assert.equal(below, 84);
  assert.equal(initial.controlTop + initial.controlHeight - below, 294);

  const above = parameterControlScrollTop({
    ...initial,
    scrollTop: 200,
    controlTop: 40,
  });
  assert.equal(above, 134);
  assert.equal(40 + (200 - above), 106);

  assert.equal(
    parameterControlScrollTop({
      ...initial,
      scrollTop: 73,
      controlTop: 130,
    }),
    73,
    'a visible control does not jump when selected again',
  );
  assert.equal(
    parameterControlScrollTop({
      ...initial,
      scrollTop: 2,
      controlTop: 100,
    }),
    0,
    'scrolling cannot invent space before the beginning of the panel',
  );
});

test('a control taller than an unusually short panel aligns its heading rather than oscillating', () => {
  const first = parameterControlScrollTop({
    scrollTop: 100,
    viewportTop: 50,
    viewportHeight: 60,
    controlTop: 80,
    controlHeight: 74,
  });
  assert.equal(first, 124);
  assert.equal(
    parameterControlScrollTop({
      scrollTop: first,
      viewportTop: 50,
      viewportHeight: 60,
      controlTop: 56,
      controlHeight: 74,
    }),
    first,
  );
});

test('the shelf retains named native controls, exact signed ranges, selected state and disabled availability', () => {
  let mutations = 0;
  const html = renderTestMarkup(
    createElement(ParameterShelf, {
      label: '影调精调',
      controls: [
        {
          id: 'exposure',
          label: '曝光',
          value: -0.35,
          min: -8,
          max: 8,
          step: 0.01,
          neutral: 0,
          unit: 'EV',
          description: '正负曝光均可连续微调。',
          onChange: () => {
            mutations++;
          },
          onReset: () => {
            mutations++;
          },
        },
        {
          id: 'restricted',
          label: '暂不可用',
          value: 0,
          min: -1,
          max: 1,
          step: 0.001,
          disabled: true,
          onChange: () => {
            mutations++;
          },
        },
      ],
      onCommit: () => {
        mutations++;
      },
    }),
  );
  assert.match(html, /aria-label="影调精调参数"/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.match(html, /aria-pressed="false" disabled=""/);
  const slider = html.match(/<input[^>]+type="range"[^>]*>/)?.[0];
  assert.ok(slider);
  assert.match(slider, /aria-label="曝光"/);
  assert.match(slider, /min="-8"/);
  assert.match(slider, /max="8"/);
  assert.match(slider, /step="0.01"/);
  assert.match(slider, /value="-0.35"/);
  assert.match(html, /aria-label="重置曝光"/);
  assert.match(html, /点击精确输入/);
  assert.equal(mutations, 0);
  assert.doesNotMatch(
    renderTestMarkup(
      createElement(ParameterShelf, {
        label: '空范围',
        controls: [],
      }),
    ),
    /type="range"/,
  );
});
