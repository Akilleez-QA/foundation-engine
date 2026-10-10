import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  bayerMatrix,
  buildPaletteLut,
  ditherThreshold,
  nearestPaletteIndex,
  resolveRetroLook,
  retroReference,
  retroTargetSize,
} from './look';

test('look validation fills defaults and refuses malformed settings', () => {
  const d = resolveRetroLook();
  assert.deepEqual(
    {...d},
    {width: 320, pixelAspect: 1, palette: null, levels: 32, dither: 'bayer4', ditherAmount: 1, lutSize: 32},
  );
  assert.ok(Object.isFrozen(d));
  for (const bad of [
    {width: 8},
    {width: 320.5},
    {pixelAspect: 5},
    {palette: [0xffffff]},
    {palette: [0, 0x1000000]},
    {palette: new Array(257).fill(0)},
    {levels: 1},
    {dither: 'noise'},
    {ditherAmount: 2},
    {lutSize: 65},
  ])
    assert.throws(() => resolveRetroLook(bad as never), RangeError, JSON.stringify(bad));
});

test('target size keeps the view aspect and widens pixels by pixelAspect (the column look)', () => {
  assert.deepEqual(retroTargetSize(resolveRetroLook({width: 320}), 1920, 1080), {width: 320, height: 180});
  assert.deepEqual(retroTargetSize(resolveRetroLook({width: 320, pixelAspect: 2}), 1920, 1080), {
    width: 320,
    height: 360,
  });
  assert.deepEqual(retroTargetSize(resolveRetroLook({width: 160, pixelAspect: 0.5}), 800, 600), {
    width: 160,
    height: 60,
  });
});

test('Bayer matrices are permutations with the classic recursive layout', () => {
  assert.deepEqual([...bayerMatrix(2)], [0, 2, 3, 1]);
  assert.deepEqual([...bayerMatrix(4)], [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
  for (const n of [2, 4, 8] as const) {
    const m = bayerMatrix(n);
    assert.deepEqual(
      [...m].sort((a, b) => a - b),
      Array.from({length: n * n}, (_, i) => i),
    );
  }
  const look = resolveRetroLook({dither: 'bayer4'});
  let sum = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += ditherThreshold(look, x, y);
  assert.ok(Math.abs(sum) < 1e-12, 'thresholds are centred on zero');
  assert.equal(ditherThreshold(look, -1, -1), ditherThreshold(look, 3, 3), 'negative coordinates wrap');
});

test('the palette lookup table holds the brute-force nearest colour of every cell centre', () => {
  const palette = [0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, 0x7f7f7f, 0x3a2f1e, 0xc0ffee];
  const n = 8;
  const lut = buildPaletteLut(palette, n);
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const rgb = [r, g, b].map(i => (i / (n - 1)) * 255);
        let best = -1,
          bestD = Infinity;
        palette.forEach((c, i) => {
          const d =
            2 * (((c >> 16) & 255) - rgb[0]!) ** 2 +
            4 * (((c >> 8) & 255) - rgb[1]!) ** 2 +
            3 * ((c & 255) - rgb[2]!) ** 2;
          if (d < bestD) ((bestD = d), (best = i));
        });
        const o = ((b * n + g) * n + r) * 4;
        const c = palette[best]!;
        assert.deepEqual([lut[o], lut[o + 1], lut[o + 2], lut[o + 3]], [(c >> 16) & 255, (c >> 8) & 255, c & 255, 255]);
      }
  assert.equal(nearestPaletteIndex([0x101010, 0x101010], 16, 16, 16), 0, 'ties go to the lowest index');
});

test('reference quantisation: exact levels without dither; dithered gradients average back to the input', () => {
  const flat = resolveRetroLook({levels: 5, dither: 'none'});
  assert.deepEqual(retroReference(flat, [0.1, 0.5, 0.9], 0, 0), [0, 0.5, 1]);
  const dithered = resolveRetroLook({levels: 2, dither: 'bayer8'});
  for (const v of [0.1, 0.3, 0.5, 0.77]) {
    let sum = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += retroReference(dithered, [v, v, v], x, y)[0];
    assert.ok(Math.abs(sum / 64 - v) <= 1 / 64 + 1e-9, `average of an 8×8 tile of ${v} is ${sum / 64}`);
  }
  const twoTone = resolveRetroLook({palette: [0x000000, 0xffffff], dither: 'bayer4', lutSize: 16});
  const lut = buildPaletteLut(twoTone.palette!, 16);
  const outs = new Set<number>();
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) outs.add(retroReference(twoTone, [0.5, 0.5, 0.5], x, y, lut)[0]);
  assert.deepEqual([...outs].sort(), [0, 1], 'a mid grey dithers between the two palette colours');
  const none = resolveRetroLook({palette: [0x000000, 0xffffff], dither: 'none'});
  assert.deepEqual(retroReference(none, [0.2, 0.2, 0.2], 0, 0), [0, 0, 0]);
  assert.deepEqual(retroReference(none, [0.8, 0.8, 0.8], 0, 0), [1, 1, 1]);
});
