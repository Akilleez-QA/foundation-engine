/**
 * testing/ktx2-fixture.ts: a tiny, deterministic KTX2 (Basis Universal UASTC) texture and a textured quad GLB that
 * uses it through `KHR_texture_basisu`, for the model library's KTX2 tests and the KTX2 browser check.
 *
 * Provenance: written by this file, not by an encoder. KTX-Software (`ktx create`) and glTF-Transform were not
 * available where the fixture was made, so the texture is packed by hand from UASTC's solid-colour block mode (mode 8:
 * a 5-bit mode code, 0x17, then 8-bit R, G, B, A), which needs no encoder: every 4×4 block is one colour. The KTX2
 * container (identifier, header, index, one level row per mip, a basic data format descriptor with colour model
 * KHR_DF_MODEL_UASTC) follows the KTX 2.0 specification. `ktx2-fixture.test.ts` decodes the result with the real Basis
 * transcoder vendored in three (`examples/jsm/libs/basis/`) and checks every texel of every level.
 *
 * The image is four solid quadrants (red, green, blue, white; top-left first) with a full mip chain; levels too small
 * for quadrants are one mid-grey block. The quad is a 1×1 square in the XY plane facing +Z, unlit
 * (`KHR_materials_unlit`), so drawn pixels are the texture's colours. Licence: CC0-1.0, like the repository's other
 * generated fixtures.
 */

export type Rgba = readonly [number, number, number, number];

/** The four quadrant colours, top-left, top-right, bottom-left, bottom-right (sRGB). */
export const QUADRANTS: readonly Rgba[] = [
  [230, 40, 40, 255],
  [40, 200, 60, 255],
  [40, 80, 230, 255],
  [245, 245, 245, 255],
];
/** The colour of levels too small to hold four quadrants of whole blocks. */
export const SMALL_LEVEL: Rgba = [128, 128, 128, 255];

/** UASTC mode 8 (solid colour): the mode code and its length in bits. */
const SOLID = {code: 0x17, bits: 5};

function writeBits(block: Uint8Array, at: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) if ((value >>> i) & 1) block[(at + i) >>> 3]! |= 1 << ((at + i) & 7);
}

/** One 16-byte UASTC block of a single colour. */
export function solidBlock([r, g, b, a]: Rgba): Uint8Array {
  const block = new Uint8Array(16);
  writeBits(block, 0, SOLID.bits, SOLID.code);
  [r, g, b, a].forEach((v, i) => writeBits(block, SOLID.bits + 8 * i, 8, v));
  return block;
}

/** The colour of texel (x, y) of a `size`-wide level (quadrants, or one grey block when too small). */
export function expectedTexel(size: number, x: number, y: number): Rgba {
  if (size < 8) return SMALL_LEVEL;
  return QUADRANTS[(y < size / 2 ? 0 : 2) + (x < size / 2 ? 0 : 1)]!;
}

/** Level sides of a full chain for a square `size` (a power of two). */
export const levelSides = (size: number): number[] =>
  Array.from({length: 32 - Math.clz32(size)}, (_, level) => Math.max(1, size >>> level));

/** A square UASTC KTX2 image (`size` a power of two, at least 8), with a full mip chain. */
export function quadrantKtx2(size = 64, o: {srgb?: boolean} = {}): Uint8Array {
  if (size < 8 || size & (size - 1)) throw Error('ktx2 fixture: size must be a power of two, at least 8');
  const levels = levelSides(size).map(side => {
    const blocks = Math.ceil(side / 4),
      data = new Uint8Array(blocks * blocks * 16);
    for (let by = 0; by < blocks; by++)
      for (let bx = 0; bx < blocks; bx++)
        data.set(solidBlock(expectedTexel(side, bx * 4, by * 4)), (by * blocks + bx) * 16);
    return data;
  });
  // Basic data format descriptor: one block, one sample (UASTC RGB, so no alpha), BT.709 primaries.
  const dfdBlock = 24 + 16,
    dfdTotal = 4 + dfdBlock,
    dfd = new DataView(new ArrayBuffer(dfdTotal));
  dfd.setUint32(0, dfdTotal, true);
  dfd.setUint32(4, 0, true); // vendor 0 (Khronos), descriptor type 0 (basic)
  dfd.setUint32(8, 2 | (dfdBlock << 16), true); // version 2, block size
  dfd.setUint8(12, 166); // KHR_DF_MODEL_UASTC
  dfd.setUint8(13, 1); // KHR_DF_PRIMARIES_BT709
  dfd.setUint8(14, o.srgb === false ? 1 : 2); // KHR_DF_TRANSFER_LINEAR / _SRGB
  dfd.setUint8(16, 3); // texel block 4×4 (dimension − 1)
  dfd.setUint8(17, 3);
  dfd.setUint8(20, 16); // bytesPlane0
  dfd.setUint16(28, 0, true); // sample bit offset
  dfd.setUint8(30, 127); // bit length − 1
  dfd.setUint8(31, 0); // KHR_DF_CHANNEL_UASTC_RGB
  dfd.setUint32(40, 0xffffffff, true); // sample upper
  const header = 12 + 9 * 4 + 4 * 4 + 2 * 8,
    levelIndex = levels.length * 24,
    dfdAt = header + levelIndex;
  // Level data, smallest level first, each aligned to 16 bytes (a multiple of the UASTC block size).
  const offsets: number[] = new Array<number>(levels.length);
  let end = dfdAt + dfdTotal;
  for (let i = levels.length - 1; i >= 0; i--) {
    end = Math.ceil(end / 16) * 16;
    offsets[i] = end;
    end += levels[i]!.byteLength;
  }
  const out = new Uint8Array(end),
    view = new DataView(out.buffer);
  out.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  // vkFormat UNDEFINED, typeSize 1, width, height, depth 0, layers 0, faces 1, levels, no supercompression.
  [0, 1, size, size, 0, 0, 1, levels.length, 0].forEach((v, i) => view.setUint32(12 + 4 * i, v, true));
  view.setUint32(48, dfdAt, true);
  view.setUint32(52, dfdTotal, true);
  // Key/value data and supercompression global data: none.
  levels.forEach((level, i) => {
    const row = header + 24 * i;
    view.setBigUint64(row, BigInt(offsets[i]!), true);
    view.setBigUint64(row + 8, BigInt(level.byteLength), true);
    view.setBigUint64(row + 16, BigInt(level.byteLength), true);
    out.set(level, offsets[i]);
  });
  out.set(new Uint8Array(dfd.buffer), dfdAt);
  return out;
}

const pad4 = (n: number) => (4 - (n % 4)) % 4;

/**
 * A GLB with one unlit square textured by `image`. `ktx2: true` names the image through `KHR_texture_basisu` (required,
 * no fallback source), as `gltf-transform ktx` writes it; `false` uses it as a plain `image/png` source.
 */
export function quadGlb(image: Uint8Array, o: {ktx2?: boolean} = {}): ArrayBuffer {
  const ktx2 = o.ktx2 ?? true;
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const parts = [positions, uvs, indices, image].map(p => new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
  const views: {buffer: number; byteOffset: number; byteLength: number}[] = [];
  let length = 0;
  for (const part of parts) {
    views.push({buffer: 0, byteOffset: length, byteLength: part.byteLength});
    length += part.byteLength + pad4(part.byteLength);
  }
  const extensions = ['KHR_materials_unlit', ...(ktx2 ? ['KHR_texture_basisu'] : [])];
  const json = {
    asset: {version: '2.0', generator: 'Foundation Engine KTX2 test fixture (src/testing/ktx2-fixture.ts)'},
    extensionsUsed: extensions,
    extensionsRequired: extensions,
    scene: 0,
    scenes: [{nodes: [0]}],
    nodes: [{name: 'quad', mesh: 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0, TEXCOORD_0: 1}, indices: 2, material: 0}]}],
    materials: [
      {
        name: 'quadrants',
        pbrMetallicRoughness: {baseColorTexture: {index: 0}, metallicFactor: 0, roughnessFactor: 1},
        extensions: {KHR_materials_unlit: {}},
      },
    ],
    textures: [ktx2 ? {sampler: 0, extensions: {KHR_texture_basisu: {source: 0}}} : {sampler: 0, source: 0}],
    samplers: [{magFilter: 9728, minFilter: 9987, wrapS: 33071, wrapT: 33071}],
    images: [{bufferView: 3, mimeType: ktx2 ? 'image/ktx2' : 'image/png'}],
    accessors: [
      {bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0]},
      {bufferView: 1, componentType: 5126, count: 4, type: 'VEC2'},
      {bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR'},
    ],
    bufferViews: views,
    buffers: [{byteLength: length}],
  };
  const text = new TextEncoder().encode(JSON.stringify(json)),
    jsonLength = text.byteLength + pad4(text.byteLength),
    total = 12 + 8 + jsonLength + 8 + length,
    out = new Uint8Array(total),
    view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // glTF
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // JSON
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  const binAt = 20 + jsonLength;
  view.setUint32(binAt, length, true);
  view.setUint32(binAt + 4, 0x004e4942, true); // BIN
  parts.forEach((part, i) => out.set(part, binAt + 8 + views[i]!.byteOffset));
  return out.buffer;
}

/**
 * Rewrites header words of a KTX2 image copy (offset → value), for refusal tests: e.g. `{12: 37}` sets vkFormat.
 */
export function editKtx2(image: Uint8Array, words: Record<number, number>): Uint8Array {
  const copy = new Uint8Array(image),
    view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  for (const [at, value] of Object.entries(words)) view.setUint32(Number(at), value, true);
  return copy;
}
