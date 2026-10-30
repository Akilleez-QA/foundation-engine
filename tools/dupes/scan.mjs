// tools/dupes/scan.mjs: find duplicate and near-duplicate files in a game's assets or any source tree.
//
// Four kinds of match, cheapest first:
//   exact      identical bytes (SHA-256), reported with the git blob id, so a match can be checked against any
//              repository history with `git cat-file -p <blob>` or found in another tree by blob comparison
//   geometry   GLB models whose mesh data is identical (vertex attributes, indices as values, sparse data and morph
//              targets, in any mesh or primitive order) while the files differ: renamed nodes, other materials,
//              another exporter's JSON, 16- versus 32-bit indices
//   image      decodable PNGs whose 128-bit difference hashes (horizontal and vertical neighbours of a 9x9 grid)
//              are within a Hamming distance: resized, recompressed or slightly retouched copies. Flat images (no
//              structure to compare) are skipped with that reason rather than matched to each other.
//   text       source and data files whose comment-free token shingles have a high estimated Jaccard similarity
//              (MinHash with banded locality-sensitive hashing; large families are compared against anchors, so the
//              work stays near linear)
// The scan only reads. Bounds: maxFiles; maxBytes per file for near comparison (larger files get exact hashing only);
// image groups and text groups above 200 members report their score as null instead of comparing every pair.
// Unreadable folders and files, and undecodable or compressed content, are skipped with the reason, never fatal.
import {createHash} from 'node:crypto';
import {closeSync, openSync, readSync, readdirSync, statSync} from 'node:fs';
import {extname, join, relative, sep} from 'node:path';
import {decodePng} from './png-decode.mjs';

export const DEFAULTS = Object.freeze({
  maxFiles: 50_000,
  maxBytes: 64 * 1024 * 1024,
  minBytes: 1,
  imageDistance: 10,
  textSimilarity: 0.85,
  near: true,
  crossOnly: false,
  /** Folder names skipped at any depth, and folder paths (with '/') skipped at any depth. Files are never skipped. */
  ignore: ['node_modules', '.git', 'dist', 'playtest', 'perf/runs'],
});
const IMAGE_BITS = 128;
const SCORE_LIMIT = 200; // groups larger than this report a null score instead of all-pairs comparison
const TEXT = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.json',
  '.glsl',
  '.wgsl',
  '.vert',
  '.frag',
  '.css',
  '.html',
  '.md',
  '.txt',
  '.py',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.java',
  '.go',
  '.lua',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.svg',
  '.obj',
  '.mtl',
  '.bvh',
  '.ply',
]);

/**
 * Every regular file under `root` (relative, '/'-separated, sorted). Symbolic links inside the tree are skipped (the
 * root itself may be one). Ignored folders are skipped by name or by path suffix. A folder that cannot be read is
 * recorded in `skipped`.
 */
export function listFiles(root, {ignore = DEFAULTS.ignore, maxFiles = DEFAULTS.maxFiles} = {}, skipped = []) {
  const out = [];
  const names = new Set(ignore.filter(i => !i.includes('/'))),
    paths = ignore.filter(i => i.includes('/'));
  const ignored = rel => {
    const base = rel.split('/').pop();
    return names.has(base) || paths.some(p => rel === p || rel.endsWith(`/${p}`));
  };
  const walk = dir => {
    let entries;
    try {
      entries = readdirSync(dir, {withFileTypes: true});
    } catch (error) {
      skipped.push({
        file: relative(root, dir).split(sep).join('/') || '.',
        reason: `folder not readable: ${error.code ?? error.message}`,
      });
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = join(dir, e.name);
      const rel = relative(root, full).split(sep).join('/');
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!ignored(rel)) walk(full);
      } else if (e.isFile()) {
        if (out.length >= maxFiles)
          throw Error(`more than ${maxFiles} files under ${root}; narrow the paths or raise --max-files`);
        out.push(rel);
      }
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  else out.push('');
  return out;
}

/** SHA-256 and git blob id (SHA-1 of "blob <size>\0" + bytes) of a file, reading it in chunks. */
function digests(path, size) {
  const sha = createHash('sha256'),
    blob = createHash('sha1');
  blob.update(`blob ${size}\0`);
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, 1 << 20) || 1);
    let at = 0;
    while (at < size) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, size - at), at);
      if (n === 0) throw Error('file shrank while reading');
      sha.update(buf.subarray(0, n));
      blob.update(buf.subarray(0, n));
      at += n;
    }
  } finally {
    closeSync(fd);
  }
  return {sha256: sha.digest('hex'), blob: blob.digest('hex')};
}
function readAll(path, size) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size);
    let at = 0;
    while (at < size) {
      const n = readSync(fd, buf, at, size - at, at);
      if (n === 0) throw Error('file shrank while reading');
      at += n;
    }
    return buf;
  } finally {
    closeSync(fd);
  }
}

// ---- geometry fingerprint ---------------------------------------------------------------------------------------
const COMPRESSED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression'];
/**
 * SHA-256 over a GLB's mesh data, independent of JSON layout, buffer interleaving, index width and mesh or primitive
 * order; null if not a GLB with meshes. Throws (the scan records the reason) for compressed geometry, external
 * buffers or malformed accessors, which it cannot compare.
 */
export function geometryFingerprint(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) return null;
  const jsonLen = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLen > bytes.length) return null;
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
  if (!Array.isArray(json.meshes) || json.meshes.length === 0) return null;
  const used = [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])];
  const compressed = COMPRESSED.find(e => used.includes(e));
  if (compressed) throw Error(`compressed geometry (${compressed}) is not compared`);
  const binAt = 20 + jsonLen;
  const bin =
    binAt + 8 <= bytes.length ? bytes.subarray(binAt + 8, binAt + 8 + bytes.readUInt32LE(binAt)) : Buffer.alloc(0);
  const WIDTH = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16};
  const SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
  const READ = {
    5120: 'readInt8',
    5121: 'readUInt8',
    5122: 'readInt16LE',
    5123: 'readUInt16LE',
    5125: 'readUInt32LE',
    5126: 'readFloatLE',
  };
  const view = (index, need) => {
    const v = json.bufferViews?.[index];
    if (!v) throw Error(`bufferView ${index} missing`);
    if ((v.buffer ?? 0) !== 0 || json.buffers?.[v.buffer ?? 0]?.uri !== undefined)
      throw Error('only GLB-embedded buffers are compared');
    if ((v.byteOffset ?? 0) + need > bin.length) throw Error(`bufferView ${index} runs past the buffer`);
    return v;
  };
  /** The values of an accessor as numbers (sparse substitution applied), plus its shape. */
  const values = index => {
    const a = json.accessors?.[index];
    if (!a || !WIDTH[a.type] || !SIZE[a.componentType] || !Number.isInteger(a.count) || a.count < 0)
      throw Error(`accessor ${index} is malformed`);
    const width = WIDTH[a.type],
      elem = width * SIZE[a.componentType];
    if (a.count * width > 1 << 26) throw Error(`accessor ${index} is too large to compare`);
    const out = new Float64Array(a.count * width);
    if (a.bufferView !== undefined) {
      const stride = json.bufferViews?.[a.bufferView]?.byteStride || elem;
      const v = view(a.bufferView, (a.byteOffset ?? 0) + (a.count ? stride * (a.count - 1) + elem : 0));
      const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
      for (let i = 0; i < a.count; i++)
        for (let c = 0; c < width; c++)
          out[i * width + c] = bin[READ[a.componentType]](start + i * stride + c * SIZE[a.componentType]);
    }
    if (a.sparse) {
      const {count, indices, values: vals} = a.sparse;
      const iv = view(indices.bufferView, (indices.byteOffset ?? 0) + count * SIZE[indices.componentType]);
      const vv = view(vals.bufferView, (vals.byteOffset ?? 0) + count * elem);
      for (let k = 0; k < count; k++) {
        const target = bin[READ[indices.componentType]](
          (iv.byteOffset ?? 0) + (indices.byteOffset ?? 0) + k * SIZE[indices.componentType],
        );
        if (target >= a.count) throw Error(`accessor ${index} sparse index out of range`);
        for (let c = 0; c < width; c++)
          out[target * width + c] = bin[READ[a.componentType]](
            (vv.byteOffset ?? 0) + (vals.byteOffset ?? 0) + (k * width + c) * SIZE[a.componentType],
          );
      }
    }
    // Indices are compared as values (16- or 32-bit storage is layout); attributes keep their component type.
    return {type: a.type, normalized: !!a.normalized, componentType: a.componentType, values: out};
  };
  const digestOf = (label, index, asIndex) => {
    const {type, normalized, componentType, values: v} = values(index);
    const h = createHash('sha256');
    h.update(`${label}:${type}:${asIndex ? 'index' : componentType}:${normalized ? 1 : 0}:${v.length};`);
    h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
    return h.digest('hex');
  };
  const primitives = [];
  for (const mesh of json.meshes)
    for (const p of mesh.primitives ?? []) {
      const parts = [`mode:${p.mode ?? 4}`];
      for (const name of Object.keys(p.attributes ?? {}).sort()) parts.push(digestOf(name, p.attributes[name], false));
      if (p.indices !== undefined) parts.push(digestOf('indices', p.indices, true));
      (p.targets ?? []).forEach((t, k) => {
        for (const name of Object.keys(t).sort()) parts.push(digestOf(`target${k}.${name}`, t[name], false));
      });
      primitives.push(createHash('sha256').update(parts.join('|')).digest('hex'));
    }
  return createHash('sha256').update(primitives.sort().join('|')).digest('hex');
}

// ---- image difference hash --------------------------------------------------------------------------------------
const GRID = 9;
/**
 * 128-bit difference hash as {hi, lo} BigInts: a 9x9 grid of box-averaged luma (over a mid-grey backdrop, so
 * transparency is what a viewer sees), comparing horizontal neighbours (64 bits) and vertical neighbours (64 bits).
 * Images smaller than the grid repeat their pixels. Returns {flat: true} when the grid's luma range is under 2 levels,
 * and null when the PNG is not decodable.
 */
export function imageHash(bytes) {
  const img = decodePng(bytes);
  if (!img) return null;
  const cells = new Float64Array(GRID * GRID);
  for (let cy = 0; cy < GRID; cy++) {
    const y0 = Math.floor((cy * img.height) / GRID),
      y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * img.height) / GRID));
    for (let cx = 0; cx < GRID; cx++) {
      const x0 = Math.floor((cx * img.width) / GRID),
        x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * img.width) / GRID));
      let sum = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4,
            a = img.rgba[i + 3] / 255;
          sum += (0.299 * img.rgba[i] + 0.587 * img.rgba[i + 1] + 0.114 * img.rgba[i + 2]) * a + 128 * (1 - a);
        }
      cells[cy * GRID + cx] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  let lo = Infinity,
    hi = -Infinity;
  for (const c of cells) {
    lo = Math.min(lo, c);
    hi = Math.max(hi, c);
  }
  if (hi - lo < 2) return {flat: true, width: img.width, height: img.height};
  let h = 0n,
    v = 0n;
  for (let y = 0; y < GRID - 1; y++)
    for (let x = 0; x < GRID - 1; x++) {
      h = (h << 1n) | (cells[y * GRID + x] > cells[y * GRID + x + 1] ? 1n : 0n);
      v = (v << 1n) | (cells[y * GRID + x] > cells[(y + 1) * GRID + x] ? 1n : 0n);
    }
  return {hash: (h << 64n) | v, width: img.width, height: img.height};
}
const popcount = v => {
  let n = 0;
  while (v) {
    v &= v - 1n;
    n++;
  }
  return n;
};

// ---- text shingles --------------------------------------------------------------------------------------------
const HASHES = 64,
  BANDS = 16,
  ROWS = HASHES / BANDS,
  ANCHORS = 16;
function fnv(s, seed) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
const TOKEN =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\d[\w.]*|[^\s\w]/g;
/** Tokens with block and line comments removed (string literals are kept whole, so `//` inside one survives). */
export function tokens(text) {
  return (text.match(TOKEN) ?? []).filter(t => !t.startsWith('/*') && !t.startsWith('//'));
}
/** MinHash signature of 5-token shingles; null when the file is too short to compare meaningfully. */
export function textSignature(text) {
  const t = tokens(text);
  if (t.length < 30) return null;
  const sig = new Uint32Array(HASHES).fill(0xffffffff);
  for (let i = 0; i + 5 <= t.length; i++) {
    const shingle = t.slice(i, i + 5).join('\u0001');
    const base = fnv(shingle, 0);
    for (let k = 0; k < HASHES; k++) {
      const v = (Math.imul(base ^ (k * 0x9e3779b1), 0x85ebca6b) ^ fnv(shingle, k + 1)) >>> 0;
      if (v < sig[k]) sig[k] = v;
    }
  }
  return sig;
}
const similarity = (a, b) => {
  let same = 0;
  for (let k = 0; k < HASHES; k++) if (a[k] === b[k]) same++;
  return same / HASHES;
};

// ---- union-find --------------------------------------------------------------------------------------------------
function unionFind() {
  const parent = new Map();
  const find = x => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  return {
    union(a, b) {
      const ra = find(a),
        rb = find(b);
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    },
    groups() {
      const g = new Map();
      for (const x of parent.keys()) {
        const r = find(x);
        if (!g.has(r)) g.set(r, []);
        g.get(r).push(x);
      }
      return [...g.values()]
        .filter(m => m.length > 1)
        .map(m => m.sort())
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    },
  };
}

/**
 * Scan `roots` ([{root, label}]). With `crossOnly`, report only groups whose members come from more than one root
 * (compare a tree against another). Returns {files, bytes, skipped, exact, geometry, image, text}; members are
 * `label:path` ids (path is relative to its root; '' when the root is a single file).
 */
export function scan(roots, options = {}) {
  const o = {...DEFAULTS, ...options};
  if (!(o.imageDistance >= 0 && o.imageDistance < IMAGE_BITS / 8))
    throw Error(`imageDistance must be in 0..${IMAGE_BITS / 8 - 1} (of ${IMAGE_BITS} bits)`);
  const files = [];
  const skipped = [];
  const labelOf = new Map();
  for (const {root, label} of roots)
    for (const rel of listFiles(root, o, skipped)) {
      const full = rel ? join(root, rel) : root;
      const id = `${label}:${rel}`;
      let size;
      try {
        size = statSync(full).size;
      } catch (error) {
        skipped.push({file: id, reason: `not readable: ${error.code ?? error.message}`});
        continue;
      }
      if (size < o.minBytes) continue;
      files.push({id, full, size, label, ext: extname(full).toLowerCase()});
      labelOf.set(id, label);
      if (files.length > o.maxFiles)
        throw Error(`more than ${o.maxFiles} files; narrow the paths or raise --max-files`);
    }
  const bySha = new Map();
  for (const f of files) {
    try {
      Object.assign(f, digests(f.full, f.size));
    } catch (error) {
      skipped.push({file: f.id, reason: String(error.code ?? error.message)});
      continue;
    }
    if (!bySha.has(f.sha256)) bySha.set(f.sha256, []);
    bySha.get(f.sha256).push(f);
  }
  const crossOk = members => !o.crossOnly || new Set(members.map(m => labelOf.get(m))).size > 1;
  const exact = [...bySha.values()]
    .filter(g => g.length > 1 && crossOk(g.map(f => f.id)))
    .map(g => ({
      blob: g[0].blob,
      sha256: g[0].sha256,
      bytes: g[0].size,
      wasted: g[0].size * (g.length - 1),
      members: g.map(f => f.id).sort(),
    }))
    .sort((a, b) => b.wasted - a.wasted || (a.members[0] < b.members[0] ? -1 : 1));
  const report = {
    files: files.length,
    bytes: files.reduce((n, f) => n + f.size, 0),
    skipped,
    exact,
    geometry: [],
    image: [],
    text: [],
  };
  if (!o.near) return report;

  // One representative per exact group: near matches between exact copies are already reported.
  const unique = [...bySha.values()].map(g => g[0]);
  const geometry = new Map(),
    images = [],
    texts = [];
  for (const f of unique) {
    const near = f.ext === '.glb' || f.ext === '.png' || TEXT.has(f.ext);
    if (!near) continue;
    if (f.size > o.maxBytes) {
      skipped.push({file: f.id, reason: `above ${o.maxBytes} bytes: exact comparison only`});
      continue;
    }
    try {
      if (f.ext === '.glb') {
        const g = geometryFingerprint(readAll(f.full, f.size));
        if (g) (geometry.get(g) ?? geometry.set(g, []).get(g)).push(f);
      } else if (f.ext === '.png') {
        const h = imageHash(readAll(f.full, f.size));
        if (!h) skipped.push({file: f.id, reason: 'PNG not decodable for the image comparison'});
        else if (h.flat) skipped.push({file: f.id, reason: 'flat image (one tone): not compared for similarity'});
        else images.push({f, hash: h.hash});
      } else {
        const sig = textSignature(readAll(f.full, f.size).toString('utf8'));
        if (sig) texts.push({f, sig});
      }
    } catch (error) {
      skipped.push({file: f.id, reason: String(error.message)});
    }
  }
  report.geometry = [...geometry.values()]
    .filter(g => g.length > 1)
    .map(g => ({members: g.map(f => f.id).sort()}))
    .filter(g => crossOk(g.members))
    .sort((a, b) => (a.members[0] < b.members[0] ? -1 : 1));

  // Images: identical hashes collapse first, so a thousand look-alikes cost one comparison, not a million.
  const byHash = new Map();
  for (const im of images) (byHash.get(im.hash) ?? byHash.set(im.hash, []).get(im.hash)).push(im.f.id);
  const hashes = [...byHash.keys()];
  const imageSets = unionFind();
  for (const ids of byHash.values()) for (let i = 1; i < ids.length; i++) imageSets.union(ids[0], ids[i]);
  const link = (a, b) => {
    if (popcount(a ^ b) <= o.imageDistance) imageSets.union(byHash.get(a)[0], byHash.get(b)[0]);
  };
  if (hashes.length <= 2000)
    for (let i = 0; i < hashes.length; i++) for (let j = i + 1; j < hashes.length; j++) link(hashes[i], hashes[j]);
  else {
    // Pigeonhole: two 128-bit hashes with at most 15 differing bits agree exactly on at least one of sixteen 8-bit
    // slices, so bucketing distinct hashes by each slice finds every pair within imageDistance ≤ 15.
    const done = new Set();
    for (let s = 0; s < 16; s++) {
      const buckets = new Map();
      for (const h of hashes) {
        const k = Number((h >> BigInt(s * 8)) & 0xffn);
        (buckets.get(k) ?? buckets.set(k, []).get(k)).push(h);
      }
      for (const b of buckets.values())
        for (let i = 0; i < b.length; i++)
          for (let j = i + 1; j < b.length; j++) {
            const key = `${b[i]}:${b[j]}`;
            if (done.has(key)) continue;
            if (done.size < 5_000_000) done.add(key);
            link(b[i], b[j]);
          }
    }
  }
  const hashOf = new Map(images.map(im => [im.f.id, im.hash]));
  report.image = imageSets
    .groups()
    .filter(crossOk)
    .map(members => {
      if (members.length > SCORE_LIMIT) return {members, maxDistance: null};
      let worst = 0; // over every pair, not only the linking ones: a chain can join images farther apart
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++)
          worst = Math.max(worst, popcount(hashOf.get(members[i]) ^ hashOf.get(members[j])));
      return {members, maxDistance: worst};
    });

  // Text: LSH bands find candidate pairs; a crowded bucket (a large family of copies) is compared against a few
  // anchors instead of all pairs, so every member is still linked to its family.
  const textSets = unionFind();
  const textSeen = new Set();
  const compare = (x, y) => {
    const key = x.f.id < y.f.id ? `${x.f.id}\n${y.f.id}` : `${y.f.id}\n${x.f.id}`;
    if (textSeen.has(key)) return;
    if (textSeen.size < 5_000_000) textSeen.add(key);
    if (similarity(x.sig, y.sig) >= o.textSimilarity) textSets.union(x.f.id, y.f.id);
  };
  for (let b = 0; b < BANDS; b++) {
    const buckets = new Map();
    for (const t of texts) {
      const key = Array.from(t.sig.subarray(b * ROWS, (b + 1) * ROWS)).join(',');
      (buckets.get(key) ?? buckets.set(key, []).get(key)).push(t);
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      if (bucket.length <= SCORE_LIMIT) {
        for (let i = 0; i < bucket.length; i++)
          for (let j = i + 1; j < bucket.length; j++) compare(bucket[i], bucket[j]);
      } else
        for (let a = 0; a < ANCHORS; a++)
          for (let j = 0; j < bucket.length; j++) if (j !== a) compare(bucket[a], bucket[j]);
    }
  }
  const sigOf = new Map(texts.map(t => [t.f.id, t.sig]));
  report.text = textSets
    .groups()
    .filter(crossOk)
    .map(members => {
      if (members.length > SCORE_LIMIT) return {members, minSimilarity: null};
      let least = 1;
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++)
          least = Math.min(least, similarity(sigOf.get(members[i]), sigOf.get(members[j])));
      return {members, minSimilarity: Math.round(least * 1000) / 1000};
    });
  return report;
}
