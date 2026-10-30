import test from 'node:test';
import assert from 'node:assert/strict';
import {cubeLutText, LUT_MAX_BYTES, lutBytes, parseCubeLut} from './lut';

test('cubeLutText writes a table parseCubeLut reads back, red fastest', () => {
  const text = cubeLutText((r, g, b) => [r, g * 0.5, 1 - b], {size: 3, title: 'warm "night"'});
  assert.match(text, /^TITLE "warm night"\nLUT_3D_SIZE 3\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n/);
  const lut = parseCubeLut(text);
  assert.equal(lut.size, 3);
  assert.equal(lut.title, 'warm night');
  assert.equal(lut.data.length, 27 * 3);
  // Row 1 is r = 0.5, g = 0, b = 0; row 3 is r = 0, g = 0.5, b = 0; row 9 is r = 0, g = 0, b = 0.5.
  assert.deepEqual([...lut.data.slice(3, 6)], [0.5, 0, 1]);
  assert.deepEqual([...lut.data.slice(9, 12)], [0, 0.25, 1]);
  assert.deepEqual([...lut.data.slice(27, 30)], [0, 0, 0.5]);
  assert.equal(cubeLutText((r, g, b) => [r, g, b]).split('\n').length, 3 + 33 ** 3 + 1, 'default side 33');
  assert.equal(lutBytes(33), 33 ** 3 * 8);
});

test('parseCubeLut skips comments and other keywords, accepts CRLF, and names the line of any error', () => {
  const ok = '# made by hand\r\nLUT_3D_SIZE 2\r\nLUT_IN_VIDEO_RANGE\r\n' + '0 0 0\n'.repeat(8);
  assert.equal(parseCubeLut(ok).size, 2);
  const bad: [string, RegExp][] = [
    ['LUT_1D_SIZE 16\n', /line 1: a 1D table is not supported/],
    ['LUT_3D_SIZE 1\n', /line 1: LUT_3D_SIZE must be an integer from 2 to 65/],
    ['LUT_3D_SIZE 66\n', /from 2 to 65/],
    ['LUT_3D_SIZE 2.5\n', /must be an integer/],
    ['0 0 0\n', /line 1: a table row before LUT_3D_SIZE/],
    ['LUT_3D_SIZE 2\nDOMAIN_MAX 2 2 2\n', /line 2: DOMAIN_MAX must be 1 1 1/],
    ['LUT_3D_SIZE 2\n0 0\n', /line 2: a row must be three numbers/],
    ['LUT_3D_SIZE 2\n0 nan 0\n', /line 2: "nan" is not a finite number/],
    ['LUT_3D_SIZE 2\n' + '0 0 0\n'.repeat(9), /line 10: more than 2³ rows/],
    ['LUT_3D_SIZE 2\n' + '0 0 0\n'.repeat(7), /7 rows, expected 2³ = 8/],
    ['LUT_3D_SIZE 2\nLUT_3D_SIZE 2\n', /line 2: LUT_3D_SIZE given twice/],
    ['TITLE "empty"\n', /no LUT_3D_SIZE/],
  ];
  for (const [text, re] of bad) assert.throws(() => parseCubeLut(text, 'luts/x.cube'), re, text);
  assert.throws(() => parseCubeLut(' '.repeat(LUT_MAX_BYTES + 1)), /larger than/);
});

test('cubeLutText refuses a bad size or a non-finite colour', () => {
  assert.throws(() => cubeLutText(() => [0, 0, 0], {size: 1}), /size must be an integer from 2 to 65/);
  assert.throws(() => cubeLutText(() => [0, Number.NaN, 0], {size: 2}), /must return three finite numbers/);
});
