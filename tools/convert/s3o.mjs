// tools/convert/s3o.mjs: S3O unit models (the piece-hierarchy format of an open-source real-time-strategy engine) to
// GLB. Independent implementation from the format's published structure: a little-endian header ("Spring unit\0",
// version, radius, height, centre, root piece offset, collision offset, two texture-name offsets), and pieces with a
// name, child offsets, 32-byte vertices (position, normal, uv), a primitive type (0 triangles, 1 strips with
// 0xffffffff restarts, 2 quads), a 32-bit index table and an offset from the parent piece.
//
// Output: one glTF node per piece (translation = piece offset, names kept, so the engine can address pieces), a mesh
// for each piece that has geometry, and one material that records the two texture names in `extras` (they are usually
// DDS/TGA, which core glTF cannot embed: convert them with `image` or another tool and assign them in the game).
import {createGltf, indexArray, TARGET} from './glb.mjs';

const MAGIC = 'Spring unit\0';
const HEADER = 52,
  PIECE = 52,
  VERTEX = 32;

/** S3O bytes to GLB. Options: flipV (default true: texture v measured from the bottom becomes glTF's top-left). */
export function s3oToGlb(bytes, options = {}) {
  const {
    flipV = true,
    scale = 1,
    maxPieces = 1024,
    maxVertices = 1 << 22,
    generator = 'foundation tools/convert s3o',
  } = options;
  if (!(scale > 0) || !Number.isFinite(scale)) throw Error('scale must be a positive number');
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < HEADER || b.toString('latin1', 0, 12) !== MAGIC)
    throw Error('not an S3O file (missing "Spring unit" header)');
  const version = b.readInt32LE(12);
  if (version !== 0) throw Error(`S3O version ${version} is not supported (0 only)`);
  const at = (offset, size, what) => {
    if (!Number.isInteger(offset) || offset < 0 || offset + size > b.length)
      throw Error(`${what} at ${offset} lies outside the file`);
    return offset;
  };
  const string = (offset, what) => {
    if (offset === 0) return '';
    at(offset, 1, what);
    const end = b.indexOf(0, offset);
    if (end < 0 || end - offset > 256) throw Error(`${what} is not a terminated name`);
    return b.toString('latin1', offset, end);
  };
  const header = {
    radius: b.readFloatLE(16),
    height: b.readFloatLE(20),
    mid: [b.readFloatLE(24), b.readFloatLE(28), b.readFloatLE(32)],
    root: b.readInt32LE(36),
    texture1: string(b.readInt32LE(44), 'texture 1 name'),
    texture2: string(b.readInt32LE(48), 'texture 2 name'),
  };
  const doc = createGltf(generator);
  doc.json.materials.push({
    name: 's3o',
    pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1},
    extras: {s3oTextures: [header.texture1, header.texture2]},
  });
  const visited = new Set();
  let pieces = 0,
    vertices = 0,
    triangles = 0;
  function piece(offset, depth) {
    at(offset, PIECE, 'piece');
    if (visited.has(offset)) throw Error(`piece at ${offset} is referenced twice (a cycle or shared piece)`);
    visited.add(offset);
    if (++pieces > maxPieces) throw Error(`more than ${maxPieces} pieces`);
    if (depth > 64) throw Error('piece hierarchy deeper than 64');
    const name = string(b.readInt32LE(offset), 'piece name') || `piece${pieces}`;
    const numChildren = b.readInt32LE(offset + 4),
      childTable = b.readInt32LE(offset + 8),
      numVertices = b.readInt32LE(offset + 12),
      vertexAt = b.readInt32LE(offset + 16),
      primitive = b.readInt32LE(offset + 24),
      indexCount = b.readInt32LE(offset + 28),
      indexAt = b.readInt32LE(offset + 32);
    const translation = [0, 1, 2].map(k => b.readFloatLE(offset + 40 + k * 4) * scale);
    if (numChildren < 0 || numVertices < 0 || indexCount < 0) throw Error(`piece ${name} has a negative count`);
    vertices += numVertices;
    if (vertices > maxVertices) throw Error(`more than ${maxVertices} vertices`);
    const node = {name, ...(translation.some(v => v !== 0) ? {translation} : {})};
    doc.json.nodes.push(node);
    const index = doc.json.nodes.length - 1;
    if (numVertices > 0 && indexCount > 0) {
      at(vertexAt, numVertices * VERTEX, `piece ${name} vertices`);
      at(indexAt, indexCount * 4, `piece ${name} index table`);
      const pos = new Float32Array(numVertices * 3),
        nrm = new Float32Array(numVertices * 3),
        uv = new Float32Array(numVertices * 2);
      for (let i = 0; i < numVertices; i++) {
        const v = vertexAt + i * VERTEX;
        for (let k = 0; k < 3; k++) {
          pos[i * 3 + k] = b.readFloatLE(v + k * 4) * scale;
          nrm[i * 3 + k] = b.readFloatLE(v + 12 + k * 4);
        }
        uv[i * 2] = b.readFloatLE(v + 24);
        uv[i * 2 + 1] = flipV ? 1 - b.readFloatLE(v + 28) : b.readFloatLE(v + 28);
        const nx = nrm[i * 3],
          ny = nrm[i * 3 + 1],
          nz = nrm[i * 3 + 2];
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nrm.set(l > 0 ? [nx / l, ny / l, nz / l] : [0, 1, 0], i * 3);
        for (const k of [0, 1, 2])
          if (!Number.isFinite(pos[i * 3 + k])) throw Error(`piece ${name} vertex ${i} is not finite`);
      }
      const raw = [];
      for (let i = 0; i < indexCount; i++) raw.push(b.readUInt32LE(indexAt + i * 4));
      const tri = [];
      const check = v => {
        if (v >= numVertices) throw Error(`piece ${name} index ${v} beyond its ${numVertices} vertices`);
        return v;
      };
      if (primitive === 0) {
        if (raw.length % 3) throw Error(`piece ${name}: triangle list length ${raw.length} is not a multiple of 3`);
        for (const v of raw) tri.push(check(v));
      } else if (primitive === 2) {
        if (raw.length % 4) throw Error(`piece ${name}: quad list length ${raw.length} is not a multiple of 4`);
        for (let i = 0; i < raw.length; i += 4) {
          const [a, c1, c2, d] = raw.slice(i, i + 4).map(check);
          tri.push(a, c1, c2, a, c2, d);
        }
      } else if (primitive === 1) {
        let strip = [];
        const flush = () => {
          for (let i = 0; i + 2 < strip.length; i++) {
            const [a, c1, c2] = i % 2 ? [strip[i + 1], strip[i], strip[i + 2]] : [strip[i], strip[i + 1], strip[i + 2]];
            if (a !== c1 && c1 !== c2 && a !== c2) tri.push(a, c1, c2); // degenerate joins are dropped
          }
          strip = [];
        };
        for (const v of raw) v === 0xffffffff ? flush() : strip.push(check(v));
        flush();
      } else throw Error(`piece ${name}: primitive type ${primitive} is not 0, 1 or 2`);
      if (tri.length) {
        doc.json.meshes.push({
          name,
          primitives: [
            {
              attributes: {
                POSITION: doc.accessor(pos, 'VEC3', {target: TARGET.ARRAY_BUFFER, bounds: true}),
                NORMAL: doc.accessor(nrm, 'VEC3', {target: TARGET.ARRAY_BUFFER}),
                TEXCOORD_0: doc.accessor(uv, 'VEC2', {target: TARGET.ARRAY_BUFFER}),
              },
              indices: doc.accessor(indexArray(tri, numVertices), 'SCALAR', {target: TARGET.ELEMENT_ARRAY_BUFFER}),
              material: 0,
            },
          ],
        });
        node.mesh = doc.json.meshes.length - 1;
        triangles += tri.length / 3;
      }
    }
    if (numChildren > 0) {
      at(childTable, numChildren * 4, `piece ${name} child table`);
      node.children = [];
      for (let i = 0; i < numChildren; i++) node.children.push(piece(b.readInt32LE(childTable + i * 4), depth + 1));
    }
    return index;
  }
  doc.json.scenes[0].nodes.push(piece(header.root, 0));
  if (triangles === 0) throw Error('the S3O has no triangles');
  // Keep the format's collision sphere and height: game code may use them for selection or physics.
  doc.json.scenes[0].extras = {
    s3o: {radius: header.radius * scale, height: header.height * scale, mid: header.mid.map(v => v * scale)},
  };
  return {
    glb: doc.toGlb(),
    summary: {pieces, vertices, triangles, textures: [header.texture1, header.texture2].filter(Boolean)},
  };
}
