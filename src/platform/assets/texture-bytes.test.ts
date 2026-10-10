import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {textureBytes} from './texture-bytes';

test('ordinary image accounting sums independently clamped mip dimensions', () => {
  for (const [width, height, expected] of [
    [512, 1, 4092],
    [1, 512, 4092],
    [64, 64, 21844],
    [3, 3, 40],
    [5, 3, 72],
    [1, 1, 4],
  ]) {
    const texture = new T.Texture({width, height});
    assert.equal(textureBytes(texture), expected);
    texture.generateMipmaps = false;
    assert.equal(textureBytes(texture), expected, 'full-chain policy even without generated mips');
  }
  // Independent closed-form level dimensions, rather than the implementation's iterative recurrence.
  for (let width = 1; width <= 41; width++)
    for (let height = 1; height <= 37; height++) {
      const count = Math.floor(Math.log2(Math.max(width, height))) + 1;
      const expected = Array.from(
        {length: count},
        (_, level) => 4 * Math.max(1, Math.floor(width / 2 ** level)) * Math.max(1, Math.floor(height / 2 ** level)),
      ).reduce((sum, bytes) => sum + bytes, 0);
      assert.equal(textureBytes(new T.Texture({width, height})), expected);
    }
});

test('malformed dimensions cannot make mip accounting loop or report usable bytes', () => {
  for (const width of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.ok(Number.isNaN(textureBytes(new T.Texture({width, height: 1}))));
  assert.equal(textureBytes(new T.Texture()), 0, 'unpopulated texture retains its existing empty estimate');
});
