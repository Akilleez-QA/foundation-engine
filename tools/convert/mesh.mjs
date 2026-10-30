// tools/convert/mesh.mjs: Wavefront OBJ (+ MTL) and PLY to glTF meshes. Both formats are publicly documented; this is
// an independent implementation of the parts listed in tools/convert/README.md. Every refusal names the line or
// element, and nothing is written for an input that is refused.
import {createGltf, indexArray, TARGET} from './glb.mjs';

/** √(x² + y² + z²) from correctly rounded operations (Math.hypot is implementation-approximated). */
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

/** Area-weighted smooth normals for indexed triangles (positions as xyz floats). */
function smoothNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a],
      uy = positions[b + 1] - positions[a + 1],
      uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a],
      vy = positions[c + 1] - positions[a + 1],
      vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = len3(n[i], n[i + 1], n[i + 2]);
    if (l > 0) {
      n[i] /= l;
      n[i + 1] /= l;
      n[i + 2] /= l;
    } else n[i + 1] = 1; // degenerate: point up rather than write a zero normal (invalid in glTF)
  }
  return n;
}

/** A negative scale would mirror the mesh without reversing its winding, so only positive scales are accepted. */
function checkScale(scale) {
  if (!(scale > 0) || !Number.isFinite(scale)) throw Error('scale must be a positive number');
}

const finite = (v, where) => {
  if (!Number.isFinite(v)) throw Error(`${where}: not a finite number`);
  return v;
};

/** Parse an MTL library into {name: {color, opacity, map}}. */
export function parseMtl(text) {
  const materials = {};
  let current = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const parts = line.trim().split(/\s+/);
    const key = parts[0];
    if (!key || key.startsWith('#')) return;
    const where = `mtl line ${i + 1}`;
    if (key === 'newmtl') {
      current = materials[parts.slice(1).join(' ')] = {color: [0.8, 0.8, 0.8], opacity: 1, map: null};
    } else if (!current) return;
    else if (key === 'Kd') {
      if (parts.length < 4) throw Error(`${where}: Kd needs three values`); // `Kd spectral`/`xyz` forms are not read
      current.color = parts.slice(1, 4).map(v => finite(Number(v), where));
    } else if (key === 'd') current.opacity = finite(Number(parts[1]), where);
    else if (key === 'Tr') current.opacity = 1 - finite(Number(parts[1]), where);
    else if (key === 'map_Kd') current.map = parts[parts.length - 1]; // options before the file name are ignored
  });
  return materials;
}

/**
 * OBJ text to GLB. `readSibling(name)` returns the bytes of a referenced file (mtllib, map_Kd) or null.
 * Options: {normals: 'smooth' | 'none', scale: number, maxVertices: number}.
 */
export function objToGlb(text, readSibling, options = {}) {
  const {normals = 'smooth', scale = 1, maxVertices = 1 << 24, generator = 'foundation tools/convert obj'} = options;
  checkScale(scale);
  const v = [],
    vt = [],
    vn = [];
  const groups = new Map(); // material name -> {keys: Map, positions, uvs, normals, indices}
  let material = '',
    materials = {};
  let total = 0;
  const groupFor = name => {
    let g = groups.get(name);
    if (!g)
      groups.set(
        name,
        (g = {keys: new Map(), position: [], uv: [], normal: [], indices: [], hasUv: false, hasNormal: false}),
      );
    return g;
  };
  const resolve = (index, length, where) => {
    const n = Number(index);
    if (!Number.isInteger(n) || n === 0) throw Error(`${where}: bad index ${index}`);
    const r = n < 0 ? length + n : n - 1;
    if (r < 0 || r >= length) throw Error(`${where}: index ${index} out of range (${length} defined)`);
    return r;
  };
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    while (line.endsWith('\\') && li + 1 < lines.length) line = line.slice(0, -1) + ' ' + lines[++li];
    const parts = line.trim().split(/\s+/);
    const key = parts[0];
    const where = `obj line ${li + 1}`;
    if (!key || key.startsWith('#')) continue;
    if (key === 'v') {
      if (parts.length < 4) throw Error(`${where}: a vertex needs x, y and z`);
      v.push(parts.slice(1, 4).map(x => finite(Number(x), where) * scale));
    } else if (key === 'vt') {
      if (parts.length < 2) throw Error(`${where}: a texture coordinate needs u`);
      vt.push([finite(Number(parts[1]), where), finite(Number(parts[2] ?? 0), where)]);
    } else if (key === 'vn') {
      if (parts.length < 4) throw Error(`${where}: a normal needs x, y and z`);
      vn.push(parts.slice(1, 4).map(x => finite(Number(x), where)));
    } else if (key === 'usemtl') material = parts.slice(1).join(' ');
    else if (key === 'mtllib') {
      for (const name of parts.slice(1)) {
        const bytes = readSibling(name);
        if (bytes) materials = {...materials, ...parseMtl(Buffer.from(bytes).toString('utf8'))};
      }
    } else if (key === 'f') {
      if (parts.length < 4) throw Error(`${where}: a face needs at least 3 vertices`);
      const g = groupFor(material);
      const corners = parts.slice(1).map(token => {
        const [pi, ti, ni] = token.split('/');
        const p = resolve(pi, v.length, where);
        const t = ti ? resolve(ti, vt.length, where) : -1;
        const n = ni ? resolve(ni, vn.length, where) : -1;
        const id = `${p}/${t}/${n}`;
        let out = g.keys.get(id);
        if (out === undefined) {
          out = g.keys.size;
          if (++total > maxVertices) throw Error(`more than ${maxVertices} output vertices`);
          g.keys.set(id, out);
          g.position.push(...v[p]);
          g.uv.push(...(t >= 0 ? [vt[t][0], 1 - vt[t][1]] : [0, 0])); // OBJ v is up; glTF v is down
          g.normal.push(...(n >= 0 ? vn[n] : [0, 0, 0]));
          if (t >= 0) g.hasUv = true;
          if (n >= 0) g.hasNormal = true;
          else g.missingNormal = true;
        }
        return out;
      });
      for (let k = 1; k + 1 < corners.length; k++) g.indices.push(corners[0], corners[k], corners[k + 1]); // fan
    }
    // o, g, s, l, p and other statements are accepted and ignored (see README).
  }
  if (groups.size === 0) throw Error('the OBJ has no faces');
  const doc = createGltf(generator);
  const primitives = [];
  const materialIndex = new Map();
  let triangles = 0;
  for (const [name, g] of groups) {
    const positions = Float32Array.from(g.position);
    let normalArray = null;
    if (g.hasNormal) {
      normalArray = Float32Array.from(g.normal);
      // Corners without a `vn` (a group that mixes both) get the smooth normal instead of an arbitrary one.
      const smooth = g.missingNormal ? smoothNormals(positions, g.indices) : null;
      for (let i = 0; i < normalArray.length; i += 3) {
        const l = len3(normalArray[i], normalArray[i + 1], normalArray[i + 2]);
        if (l > 0) for (let c = 0; c < 3; c++) normalArray[i + c] /= l;
        else if (smooth) normalArray.set(smooth.subarray(i, i + 3), i);
        else normalArray[i + 1] = 1;
      }
    } else if (normals === 'smooth') normalArray = smoothNormals(positions, g.indices);
    const attributes = {POSITION: doc.accessor(positions, 'VEC3', {target: TARGET.ARRAY_BUFFER, bounds: true})};
    if (normalArray) attributes.NORMAL = doc.accessor(normalArray, 'VEC3', {target: TARGET.ARRAY_BUFFER});
    if (g.hasUv) attributes.TEXCOORD_0 = doc.accessor(Float32Array.from(g.uv), 'VEC2', {target: TARGET.ARRAY_BUFFER});
    const prim = {
      attributes,
      indices: doc.accessor(indexArray(g.indices, g.keys.size), 'SCALAR', {target: TARGET.ELEMENT_ARRAY_BUFFER}),
    };
    if (!materialIndex.has(name)) {
      const m = materials[name] ?? {color: [0.8, 0.8, 0.8], opacity: 1, map: null};
      const pbr = {
        baseColorFactor: [...m.color.map(c => Math.min(1, Math.max(0, c))), Math.min(1, Math.max(0, m.opacity))],
        metallicFactor: 0,
        roughnessFactor: 1,
      };
      if (m.map && g.hasUv) {
        const mime = /\.png$/i.test(m.map) ? 'image/png' : /\.jpe?g$/i.test(m.map) ? 'image/jpeg' : null;
        const bytes = mime ? readSibling(m.map) : null; // only image names are read at all
        if (bytes) {
          const b = new Uint8Array(bytes);
          const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
          const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
          if ((mime === 'image/png' && !png) || (mime === 'image/jpeg' && !jpeg))
            throw Error(`texture ${m.map} is not a ${mime === 'image/png' ? 'PNG' : 'JPEG'} file`);
          pbr.baseColorTexture = {index: doc.texture(b, mime, m.map)};
        }
      }
      doc.json.materials.push({
        name: name || 'default',
        pbrMetallicRoughness: pbr,
        ...(m.opacity < 1 ? {alphaMode: 'BLEND'} : {}),
      });
      materialIndex.set(name, doc.json.materials.length - 1);
    }
    prim.material = materialIndex.get(name);
    primitives.push(prim);
    triangles += g.indices.length / 3;
  }
  doc.json.meshes.push({primitives});
  doc.json.nodes.push({mesh: 0, name: 'mesh'});
  doc.json.scenes[0].nodes.push(0);
  return {glb: doc.toGlb(), summary: {vertices: total, triangles, primitives: primitives.length}};
}

// ---- PLY ------------------------------------------------------------------------------------------------------
const PLY_TYPES = {
  char: ['getInt8', 1],
  int8: ['getInt8', 1],
  uchar: ['getUint8', 1],
  uint8: ['getUint8', 1],
  short: ['getInt16', 2],
  int16: ['getInt16', 2],
  ushort: ['getUint16', 2],
  uint16: ['getUint16', 2],
  int: ['getInt32', 4],
  int32: ['getInt32', 4],
  uint: ['getUint32', 4],
  uint32: ['getUint32', 4],
  float: ['getFloat32', 4],
  float32: ['getFloat32', 4],
  double: ['getFloat64', 8],
  float64: ['getFloat64', 8],
};

function parsePlyHeader(bytes) {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1 << 16)).toString('latin1');
  const m = /(^|\n)end_header\r?\n/.exec(head);
  const end = m ? m.index + m[1].length : -1;
  if (!head.startsWith('ply') || end < 0)
    throw Error('not a PLY file (missing "ply" or "end_header" in the first 64 KiB)');
  const bodyStart = end + head.slice(end).indexOf('\n') + 1;
  let format = null;
  const elements = [];
  head
    .slice(0, end)
    .split(/\r?\n/)
    .forEach((line, i) => {
      const p = line.trim().split(/\s+/);
      const where = `ply header line ${i + 1}`;
      if (p[0] === 'format') {
        if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(p[1]))
          throw Error(`${where}: unknown format ${p[1]}`);
        format = p[1];
      } else if (p[0] === 'element') {
        const count = Number(p[2]);
        if (!Number.isSafeInteger(count) || count < 0) throw Error(`${where}: bad element count`);
        elements.push({name: p[1], count, properties: []});
      } else if (p[0] === 'property') {
        const el = elements.at(-1);
        if (!el) throw Error(`${where}: property before any element`);
        if (p[1] === 'list') {
          if (!PLY_TYPES[p[2]] || !PLY_TYPES[p[3]]) throw Error(`${where}: unknown list types`);
          el.properties.push({name: p[4], list: true, countType: p[2], type: p[3]});
        } else {
          if (!PLY_TYPES[p[1]]) throw Error(`${where}: unknown type ${p[1]}`);
          el.properties.push({name: p[2], list: false, type: p[1]});
        }
      }
    });
  if (!format) throw Error('PLY header has no format line');
  return {format, elements, bodyStart};
}

/** PLY (ascii or binary) to GLB: triangles when the file has faces, points otherwise. */
export function plyToGlb(bytes, options = {}) {
  const {normals = 'smooth', scale = 1, maxVertices = 1 << 24, generator = 'foundation tools/convert ply'} = options;
  checkScale(scale);
  const {format, elements, bodyStart} = parsePlyHeader(bytes);
  if (!elements.some(e => e.name === 'vertex')) throw Error('PLY has no vertex element');
  const data = {};
  if (format === 'ascii') {
    const tokens = Buffer.from(bytes.buffer, bytes.byteOffset + bodyStart, bytes.byteLength - bodyStart)
      .toString('latin1')
      .split(/\s+/)
      .filter(Boolean);
    let t = 0;
    const next = () => {
      if (t >= tokens.length) throw Error('PLY body ends early');
      return Number(tokens[t++]);
    };
    for (const el of elements) data[el.name] = readElement(el, next, maxVertices);
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const little = format === 'binary_little_endian';
    let at = bodyStart;
    const read = type => {
      const [fn, size] = PLY_TYPES[type];
      if (at + size > bytes.byteLength) throw Error('PLY body ends early');
      const v = view[fn](at, little);
      at += size;
      return v;
    };
    for (const el of elements) data[el.name] = readElement(el, read, maxVertices);
  }
  const vertex = data.vertex;
  if (!vertex || !vertex.x || !vertex.y || !vertex.z) throw Error('PLY has no vertex element with x, y and z');
  const count = vertex.x.length;
  if (count === 0) throw Error('PLY has no vertices');
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = finite(vertex.x[i], `vertex ${i}`) * scale;
    positions[i * 3 + 1] = finite(vertex.y[i], `vertex ${i}`) * scale;
    positions[i * 3 + 2] = finite(vertex.z[i], `vertex ${i}`) * scale;
  }
  const indices = [];
  const face = data.face;
  const list = face && (face.vertex_indices ?? face.vertex_index);
  if (list)
    list.forEach((poly, f) => {
      if (poly.length < 3) throw Error(`face ${f} has fewer than 3 vertices`);
      for (const k of poly)
        if (!Number.isInteger(k) || k < 0 || k >= count) throw Error(`face ${f} uses vertex ${k} of ${count}`);
      for (let k = 1; k + 1 < poly.length; k++) indices.push(poly[0], poly[k], poly[k + 1]);
    });
  const doc = createGltf(generator);
  const attributes = {POSITION: doc.accessor(positions, 'VEC3', {target: TARGET.ARRAY_BUFFER, bounds: true})};
  if (vertex.nx && vertex.ny && vertex.nz) {
    const n = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = finite(vertex.nx[i], `normal ${i}`),
        y = finite(vertex.ny[i], `normal ${i}`),
        z = finite(vertex.nz[i], `normal ${i}`);
      const l = len3(x, y, z);
      if (l > 0) n.set([x / l, y / l, z / l], i * 3);
      else n[i * 3 + 1] = 1;
    }
    attributes.NORMAL = doc.accessor(n, 'VEC3', {target: TARGET.ARRAY_BUFFER});
  } else if (indices.length && normals === 'smooth')
    attributes.NORMAL = doc.accessor(smoothNormals(positions, indices), 'VEC3', {target: TARGET.ARRAY_BUFFER});
  const u = vertex.s ?? vertex.u ?? vertex.texture_u,
    w = vertex.t ?? vertex.v ?? vertex.texture_v;
  if (u && w) {
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) uv.set([finite(u[i], `uv ${i}`), 1 - finite(w[i], `uv ${i}`)], i * 2);
    attributes.TEXCOORD_0 = doc.accessor(uv, 'VEC2', {target: TARGET.ARRAY_BUFFER});
  }
  if (vertex.red && vertex.green && vertex.blue) {
    // Each channel is scaled by its own declared type (uchar /255, ushort /65535, float as is), never guessed from
    // its values; byte colours stay bytes when every channel is a byte type.
    const vertexEl = elements.find(e => e.name === 'vertex');
    const typeOf = name => vertexEl.properties.find(p => p.name === name)?.type;
    const names = ['red', 'green', 'blue', ...(vertex.alpha ? ['alpha'] : [])];
    const SCALE = {uchar: 255, uint8: 255, ushort: 65535, uint16: 65535, float: 1, float32: 1, double: 1, float64: 1};
    const scales = names.map(n => {
      const sc = SCALE[typeOf(n)];
      if (!sc) throw Error(`PLY colour ${n} has type ${typeOf(n)}; use uchar, ushort or float`);
      return sc;
    });
    const bytesOnly = scales.every(sc => sc === 255);
    const colours = bytesOnly ? new Uint8Array(count * 4) : new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 4; c++) {
        if (c === 3 && !vertex.alpha) {
          colours[i * 4 + 3] = bytesOnly ? 255 : 1;
          continue;
        }
        const raw = vertex[names[c]][i];
        const value = bytesOnly ? raw : finite(raw, `colour ${i}`) / scales[c];
        if (!(value >= 0 && value <= (bytesOnly ? 255 : 1)))
          throw Error(`vertex ${i} ${names[c]} ${raw} is outside its range`);
        colours[i * 4 + c] = value;
      }
    }
    // Byte colours must be 4-byte aligned per element in glTF, so RGB always gets an opaque alpha.
    attributes.COLOR_0 = doc.accessor(colours, 'VEC4', {target: TARGET.ARRAY_BUFFER, normalized: bytesOnly});
  }
  const prim = {attributes, mode: indices.length ? 4 : 0};
  if (indices.length)
    prim.indices = doc.accessor(indexArray(indices, count), 'SCALAR', {target: TARGET.ELEMENT_ARRAY_BUFFER});
  doc.json.materials.push({
    name: 'default',
    pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1},
  });
  prim.material = 0;
  doc.json.meshes.push({primitives: [prim]});
  doc.json.nodes.push({mesh: 0, name: 'mesh'});
  doc.json.scenes[0].nodes.push(0);
  return {
    glb: doc.toGlb(),
    summary: {vertices: count, triangles: indices.length / 3, points: indices.length ? 0 : count},
  };
}

function readElement(el, read, maxVertices) {
  if (el.count > maxVertices) throw Error(`element ${el.name} has ${el.count} entries, above the ${maxVertices} limit`);
  if (el.properties.length === 0) return {}; // nothing stored per entry: nothing to read
  const out = {};
  for (const p of el.properties) out[p.name] = [];
  for (let i = 0; i < el.count; i++)
    for (const p of el.properties) {
      if (p.list) {
        const n = read(p.countType);
        if (!Number.isInteger(n) || n < 0 || n > 1024)
          throw Error(`element ${el.name} ${i}: list length ${n} outside 0..1024`);
        const items = new Array(n);
        for (let k = 0; k < n; k++) items[k] = read(p.type);
        out[p.name].push(items);
      } else out[p.name].push(read(p.type));
    }
  return out;
}
