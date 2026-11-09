import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rgba, hex, hsv, hsl, fromHsv, fromHsl } from '../src/components/color-model.ts';

test('RGBA8 colors round-trip through both numeric color spaces without channel or alpha drift', () => {
  const channels = [0, 1, 7, 31, 63, 127, 191, 254, 255];
  for (const r of channels)
    for (const g of channels)
      for (const b of channels) {
        const color = { r, g, b, a: 43 / 255 };
        assert.deepEqual(fromHsv(hsv(color), color.a), color);
        assert.deepEqual(fromHsl(hsl(color), color.a), color);
      }
});

test('continuous hue reaches every sector rather than snapping to the quick swatches', () => {
  const colors = new Set<string>();
  for (let hue = 0; hue < 360; hue += 0.5) colors.add(hex(fromHsv({ h: hue, s: 1, v: 1 }, 1)));
  assert.equal(colors.size, 720);
  assert.equal(hex(fromHsv({ h: 0, s: 1, v: 1 }, 1)), '#FF0000FF');
  assert.equal(hex(fromHsv({ h: 120, s: 1, v: 1 }, 1)), '#00FF00FF');
  assert.equal(hex(fromHsv({ h: 240, s: 1, v: 1 }, 1)), '#0000FFFF');
  assert.deepEqual(
    fromHsv({ h: -60, s: 0.75, v: 0.6 }, 1),
    fromHsv({ h: 300, s: 0.75, v: 0.6 }, 1),
  );
  assert.deepEqual(fromHsv({ h: 360, s: 1, v: 1 }, 1), fromHsv({ h: 0, s: 1, v: 1 }, 1));
});

test('HEX shorthand and every alpha byte preserve precise RGBA data', () => {
  assert.equal(hex(rgba('#abc')), '#AABBCCFF');
  assert.equal(hex(rgba('#a1b2')), '#AA11BB22');
  assert.equal(hex(rgba('1938ad42')), '#1938AD42');
  for (let alpha = 0; alpha <= 255; alpha++) {
    const color = { r: 13, g: 221, b: 87, a: alpha / 255 };
    assert.deepEqual(rgba(hex(color)), color);
  }
  for (const gray of [0, 1, 127, 254, 255]) {
    const converted = hsl({ r: gray, g: gray, b: gray, a: 1 });
    assert.equal(converted.s, 0);
    assert.ok(Number.isFinite(converted.l));
  }
});
