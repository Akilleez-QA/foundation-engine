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

test('common scalar descriptors use component widths and dimensional mip extents', () => {
  for (const [format, channels] of [
    [T.RedFormat, 1],
    [T.RGFormat, 2],
    [T.RGBAFormat, 4],
  ] as const)
    for (const [type, scalar] of [
      [T.UnsignedByteType, 1],
      [T.HalfFloatType, 2],
      [T.FloatType, 4],
    ] as const)
      for (const volume of [false, true])
        for (const [width, height, depth] of [
          [2, 2, 3],
          [1, 1, 8],
          [7, 3, 5],
        ] as const) {
          const texture = volume
            ? new T.Data3DTexture(null, width, height, depth)
            : new T.DataArrayTexture(null, width, height, depth);
          texture.format = format;
          texture.type = type;
          const levels = Math.floor(Math.log2(Math.max(width, height, volume ? depth : 1))) + 1;
          const expected = Array.from(
            {length: levels},
            (_, i) =>
              Math.max(1, Math.floor(width / 2 ** i)) *
              Math.max(1, Math.floor(height / 2 ** i)) *
              (volume ? Math.max(1, Math.floor(depth / 2 ** i)) : depth) *
              channels *
              scalar,
          ).reduce((a, b) => a + b, 0);
          assert.equal(textureBytes(texture), expected);
          texture.generateMipmaps = true;
          assert.equal(textureBytes(texture), expected);
        }
  assert.equal(textureBytes(new T.DataTexture(null, 2, 2, T.RGBAFormat, T.FloatType)), 80);
  assert.equal(textureBytes(new T.DataArrayTexture(null, 2, 2, 3)), 60);
  assert.equal(textureBytes(new T.Data3DTexture(null, 2, 2, 3)), 52);
});

test('cube accounting requires six equal square faces and uses the parent descriptor', () => {
  const cube = new T.CubeTexture(Array.from({length: 6}, () => ({width: 16, height: 16})));
  assert.equal(textureBytes(cube), 8184);
  cube.images = Array.from({length: 6}, () => new T.DataTexture(null, 16, 16, T.RedFormat, T.FloatType));
  assert.equal(textureBytes(cube), 8184, 'face types do not override parent storage');
  cube.type = T.FloatType;
  assert.equal(textureBytes(cube), 32736);
  cube.images[5] = {width: 8, height: 8};
  assert.equal(textureBytes(cube), 0, 'heterogeneous cube retains unsupported legacy fallback');
  cube.images = Array.from({length: 5}, () => ({width: 16, height: 16}));
  assert.equal(textureBytes(cube), 0);
  cube.images = Array.from({length: 6}, () => ({width: 16, height: 8}));
  assert.equal(textureBytes(cube), 0);
  cube.images = Array.from({length: 6}, () => ({width: NaN, height: 16}));
  assert.ok(Number.isNaN(textureBytes(cube)));
});

test('unsupported descriptors retain compatibility fallback; invalid supported depth refuses', () => {
  const texture = new T.DataTexture(null, 2, 2, T.RGBAFormat, T.FloatType);
  texture.internalFormat = 'RGBA32F';
  assert.equal(textureBytes(texture), 20, 'override accounting remains unsupported');
  texture.internalFormat = null;
  texture.mipmaps = [{data: new Float32Array(16), width: 2, height: 2}];
  assert.equal(textureBytes(texture), 20, 'authored layouts remain unsupported');
  texture.mipmaps = [];
  texture.type = T.UnsignedShort4444Type;
  assert.equal(textureBytes(texture), 20);
  texture.format = T.DepthFormat;
  assert.equal(textureBytes(texture), 20);
  for (const depth of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.ok(Number.isNaN(textureBytes(new T.Data3DTexture(null, 2, 2, depth))));
  assert.equal(textureBytes(new T.DataArrayTexture(null, 2, 2, 0)), 0);
  assert.ok(!Number.isSafeInteger(textureBytes(new T.Data3DTexture(null, Number.MAX_SAFE_INTEGER, 2, 2))));
});
