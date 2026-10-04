// The hand-packed KTX2 fixture decodes with the real Basis transcoder vendored in three: every texel of every level
// matches, and it transcodes to each GPU family KTX2Loader can choose. This is the fixture's provenance check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInThisContext} from 'node:vm';
import {expectedTexel, levelSides, quadrantKtx2, quadGlb} from './ktx2-fixture';
import {validateEmbeddedGlb} from '../platform/assets/models';

interface Ktx2File {
  isValid(): boolean;
  isUASTC(): boolean;
  getHasAlpha(): boolean;
  getLevels(): number;
  getWidth(): number;
  startTranscoding(): boolean;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(
    dst: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    a: 0,
    b: -1,
    c: -1,
  ): number;
  close(): void;
  delete(): void;
}
interface Basis {
  initializeBasis(): void;
  KTX2File: new (bytes: Uint8Array) => Ktx2File;
}

/** Basis transcoder target formats (the values of three's `KTX2Loader.TranscoderFormat`). */
const F = {ETC1: 0, ETC2: 1, BC1: 2, BC3: 3, BC7_M5: 7, ASTC_4x4: 10, RGBA32: 13} as const;
const require = createRequire(import.meta.url);
const basisDir = require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js').replace(/[^/\\]+$/, '');
async function transcoder(): Promise<Basis> {
  const source = readFileSync(basisDir + 'basis_transcoder.js', 'utf8');
  const factory = runInThisContext(`(function (require, __dirname, __filename) {${source}\nreturn BASIS;})`) as (
    req: NodeJS.Require,
    dir: string,
    file: string,
  ) => (module: {wasmBinary: Uint8Array}) => Promise<Basis>;
  const basis = await factory(
    require,
    basisDir,
    basisDir + 'basis_transcoder.js',
  )({
    wasmBinary: readFileSync(basisDir + 'basis_transcoder.wasm'),
  });
  basis.initializeBasis();
  return basis;
}

test('the hand-packed UASTC fixture decodes texel-exact with the vendored Basis transcoder', async () => {
  const basis = await transcoder(),
    file = new basis.KTX2File(quadrantKtx2(64));
  try {
    assert.ok(file.isValid());
    assert.ok(file.isUASTC());
    assert.equal(file.getHasAlpha(), false);
    assert.equal(file.getWidth(), 64);
    assert.equal(file.getLevels(), 7);
    assert.ok(file.startTranscoding());
    const RGBA32 = F.RGBA32;
    levelSides(64).forEach((side, level) => {
      const out = new Uint8Array(file.getImageTranscodedSizeInBytes(level, 0, 0, RGBA32));
      assert.equal(out.byteLength, side * side * 4);
      assert.ok(file.transcodeImage(out, level, 0, 0, RGBA32, 0, -1, -1));
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++)
          assert.deepEqual(
            [...out.subarray((y * side + x) * 4, (y * side + x) * 4 + 4)],
            [...expectedTexel(side, x, y)],
          );
    });
    // Each block-compressed family KTX2Loader may pick for an opaque UASTC image.
    for (const [format, bytesPerBlock] of [
      [F.ASTC_4x4, 16],
      [F.BC7_M5, 16],
      [F.ETC2, 16],
      [F.ETC1, 8],
      [F.BC1, 8],
      [F.BC3, 16],
    ] as const) {
      const out = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, format));
      assert.equal(out.byteLength, 16 * 16 * bytesPerBlock, `format ${format}`);
      assert.ok(file.transcodeImage(out, 0, 0, 0, format, 0, -1, -1), `format ${format}`);
    }
  } finally {
    file.close();
    file.delete();
  }
});

test('the quad GLB names its KTX2 image through KHR_texture_basisu and passes the embedded-model policy', () => {
  const glb = validateEmbeddedGlb(quadGlb(quadrantKtx2(64)));
  assert.deepEqual(glb.ktx2, [0]);
  assert.deepEqual(validateEmbeddedGlb(quadGlb(new Uint8Array(8), {ktx2: false})).ktx2, []);
});
