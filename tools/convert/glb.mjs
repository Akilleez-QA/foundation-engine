// tools/convert/glb.mjs: a small deterministic glTF 2.0 binary (GLB) writer for the converters. It packs typed arrays
// into one buffer (each view 4-byte aligned), writes accessors with the min/max glTF requires for positions and
// animation inputs, and emits the JSON with a fixed key order, so the same input gives the same bytes.

const GL = {BYTE: 5120, UNSIGNED_BYTE: 5121, SHORT: 5122, UNSIGNED_SHORT: 5123, UNSIGNED_INT: 5125, FLOAT: 5126};
const COMPONENT = new Map([
  [Int8Array, GL.BYTE],
  [Uint8Array, GL.UNSIGNED_BYTE],
  [Int16Array, GL.SHORT],
  [Uint16Array, GL.UNSIGNED_SHORT],
  [Uint32Array, GL.UNSIGNED_INT],
  [Float32Array, GL.FLOAT],
]);
const WIDTH = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};
export const TARGET = {ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963};

/** Accumulates a glTF document and its single binary buffer. */
export function createGltf(generator) {
  const json = {
    asset: {version: '2.0', generator},
    scene: 0,
    scenes: [{nodes: []}],
    nodes: [],
    meshes: [],
    materials: [],
    images: [],
    textures: [],
    samplers: [],
    animations: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const chunks = [];
  let length = 0;

  function view(bytes, target) {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      length += pad;
    }
    const entry = {buffer: 0, byteOffset: length, byteLength: bytes.byteLength};
    if (target) entry.target = target;
    chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    length += bytes.byteLength;
    json.bufferViews.push(entry);
    return json.bufferViews.length - 1;
  }

  /**
   * Add an accessor over `array` (a typed array) of `type` (SCALAR, VEC2…). `bounds` writes min/max (required for
   * POSITION and animation inputs); `normalized` marks integer colours.
   */
  function accessor(array, type, {target, bounds = false, normalized = false} = {}) {
    const componentType = COMPONENT.get(array.constructor);
    if (componentType === undefined) throw Error(`unsupported accessor array ${array.constructor.name}`);
    const width = WIDTH[type];
    if (!width || array.length % width) throw Error(`accessor length ${array.length} is not a multiple of ${type}`);
    if (array.length === 0) throw Error('an accessor needs at least one element');
    for (let i = 0; i < array.length; i++)
      if (!Number.isFinite(array[i])) throw Error(`accessor value ${i} is not finite`);
    const entry = {bufferView: view(array, target), componentType, count: array.length / width, type};
    if (normalized) entry.normalized = true;
    if (bounds) {
      const min = new Array(width).fill(Infinity),
        max = new Array(width).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        const c = i % width,
          v = array[i];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
      // glTF compares bounds with the stored (float32) values; Math.fround keeps them exact.
      entry.min = min.map(v => (componentType === GL.FLOAT ? Math.fround(v) : v));
      entry.max = max.map(v => (componentType === GL.FLOAT ? Math.fround(v) : v));
    }
    json.accessors.push(entry);
    return json.accessors.length - 1;
  }

  /** Embed an image (PNG or JPEG bytes) and return a texture index. */
  function texture(bytes, mimeType, name) {
    json.images.push({bufferView: view(bytes), mimeType, ...(name ? {name} : {})});
    if (json.samplers.length === 0) json.samplers.push({magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497});
    json.textures.push({sampler: 0, source: json.images.length - 1});
    return json.textures.length - 1;
  }

  /** The GLB bytes. Empty top-level arrays are left out, as glTF requires. */
  function toGlb() {
    const doc = {};
    for (const [key, value] of Object.entries(json)) if (!Array.isArray(value) || value.length) doc[key] = value;
    if (length) doc.buffers = [{byteLength: length + ((4 - (length % 4)) % 4)}];
    else delete doc.buffers;
    let text = JSON.stringify(doc);
    while (Buffer.byteLength(text) % 4) text += ' ';
    const jsonBytes = Buffer.from(text, 'utf8');
    const binLength = doc.buffers ? doc.buffers[0].byteLength : 0;
    const total = 12 + 8 + jsonBytes.length + (binLength ? 8 + binLength : 0);
    const out = Buffer.alloc(total);
    out.writeUInt32LE(0x46546c67, 0); // 'glTF'
    out.writeUInt32LE(2, 4);
    out.writeUInt32LE(total, 8);
    out.writeUInt32LE(jsonBytes.length, 12);
    out.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
    jsonBytes.copy(out, 20);
    if (binLength) {
      let at = 20 + jsonBytes.length;
      out.writeUInt32LE(binLength, at);
      out.writeUInt32LE(0x004e4942, at + 4); // 'BIN\0'
      at += 8;
      for (const c of chunks) {
        out.set(c, at);
        at += c.byteLength;
      }
    }
    return out;
  }

  return {json, accessor, texture, toGlb};
}

/** The smallest index array type for `count` vertices. */
export function indexArray(indices, count) {
  return count <= 65535 ? Uint16Array.from(indices) : Uint32Array.from(indices);
}

/** Read the JSON chunk of a GLB (for tests and summaries). */
export function readGlbJson(bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.readUInt32LE(0) !== 0x46546c67) throw Error('not a GLB');
  const n = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
}
