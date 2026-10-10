import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BVHLoader} from 'three/addons/loaders/BVHLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {objToGlb, plyToGlb} from './mesh.mjs';
import {bvhToGlb} from './bvh.mjs';
import {decodeBmp, decodePcx, imageToPng, readPalette} from './indexed.mjs';
import {readGlbJson} from './glb.mjs';
import {convert, parseArgs} from './cli.mjs';
import {readProvenance} from '../../scripts/lib/provenance.ts';

// ---- helpers ------------------------------------------------------------------------------------------------
const ab = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loadGlb = glb => new Promise((ok, fail) => new GLTFLoader().parse(ab(glb), '', ok, fail));
/** Read accessor `i` of a GLB as a plain array. */
function accessor(glb, i) {
  const json = readGlbJson(glb);
  const a = json.accessors[i],
    v = json.bufferViews[a.bufferView];
  const jsonLen = glb.readUInt32LE(12),
    bin = 20 + jsonLen + 8;
  const types = {5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array};
  const width = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[a.type];
  const T = types[a.componentType];
  return Array.from(
    new T(
      glb.buffer.slice(
        glb.byteOffset + bin + v.byteOffset,
        glb.byteOffset + bin + v.byteOffset + a.count * width * T.BYTES_PER_ELEMENT,
      ),
    ),
  );
}
async function validate(glb) {
  let validator;
  try {
    validator = await import('gltf-validator');
  } catch {
    return null; // not installed in this checkout: the GLTFLoader round trip still runs
  }
  const report = await validator.validateBytes(new Uint8Array(glb), {maxIssues: 50});
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages.slice(0, 5)));
  return report;
}
/** Decode our own PNG output (filter 0 rows only) to {width, height, colourType, palette, trns, rows}. */
function readPng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  const out = {idat: []};
  while (at < png.length) {
    const len = png.readUInt32BE(at),
      type = png.toString('latin1', at + 4, at + 8),
      data = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR')
      Object.assign(out, {width: data.readUInt32BE(0), height: data.readUInt32BE(4), colourType: data[9]});
    if (type === 'PLTE') out.palette = data;
    if (type === 'tRNS') out.trns = data;
    if (type === 'IDAT') out.idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(out.idat));
  const bpp = out.colourType === 6 ? 4 : 1,
    stride = out.width * bpp + 1;
  out.rows = [];
  for (let y = 0; y < out.height; y++) {
    assert.equal(raw[y * stride], 0);
    out.rows.push([...raw.subarray(y * stride + 1, (y + 1) * stride)]);
  }
  return out;
}
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// ---- OBJ / PLY ----------------------------------------------------------------------------------------------
const OBJ = `# a cube corner, quads and a triangle, two materials
mtllib cube.mtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 -1
usemtl red
f 1/1/1 4/4/1 3/3/1 2/2/1
usemtl blue
f -5/1 -4/2 -1/3
f 1 2 5
`;
const MTL = `newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1\nd 0.5\n`;

test('convert: OBJ becomes a valid GLB whose triangles match the three.js OBJ loader', async () => {
  const {glb, summary} = objToGlb(OBJ, name => (name === 'cube.mtl' ? Buffer.from(MTL) : null));
  await validate(glb);
  assert.deepEqual(summary, {vertices: 10, triangles: 4, primitives: 2}); // v/vt/vn tuples are distinct vertices
  const json = readGlbJson(glb);
  assert.deepEqual(
    json.materials.map(m => m.pbrMetallicRoughness.baseColorFactor),
    [
      [1, 0, 0, 1],
      [0, 0, 1, 0.5],
    ],
  );
  assert.equal(json.materials[1].alphaMode, 'BLEND');
  // Same triangles (as position triples, de-indexed) as three's loader.
  const ours = [];
  for (const prim of json.meshes[0].primitives) {
    const pos = accessor(glb, prim.attributes.POSITION),
      idx = accessor(glb, prim.indices);
    for (const i of idx) ours.push(pos.slice(i * 3, i * 3 + 3).join(','));
  }
  const theirs = [];
  new OBJLoader().parse(OBJ).traverse(o => {
    if (o.isMesh) {
      const p = o.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) theirs.push([p[i], p[i + 1], p[i + 2]].join(','));
    }
  });
  assert.deepEqual(ours, theirs);
  const scene = await loadGlb(glb);
  let meshes = 0;
  scene.scene.traverse(o => (meshes += o.isMesh ? 1 : 0));
  assert.equal(meshes, 2);
  // Byte-identical on a second run.
  assert.ok(objToGlb(OBJ, name => (name === 'cube.mtl' ? Buffer.from(MTL) : null)).glb.equals(glb));
});

test('convert: OBJ refusals name the line', () => {
  assert.throws(() => objToGlb('v 0 0 0\nf 1 2 3\n', () => null), /obj line 2: index 2 out of range/);
  assert.throws(() => objToGlb('v 0 0 x\n', () => null), /obj line 1: not a finite number/);
  assert.throws(() => objToGlb('v 0 0 0\n', () => null), /no faces/);
  assert.throws(
    () => objToGlb('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', () => null, {maxVertices: 2}),
    /more than 2 output vertices/,
  );
});

function plyAscii() {
  return `ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 255 0 0\n1 0 0 0 255 0\n1 1 0 0 0 255\n0 1 0 255 255 255\n4 0 1 2 3\n`;
}
function plyBinary(little) {
  const header = `ply\nformat binary_${little ? 'little' : 'big'}_endian 1.0\ncomment made by a test\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar uint vertex_indices\nelement extra 2\nproperty list uchar short junk\nend_header\n`;
  const body = Buffer.alloc(3 * 24 + 1 + 12 + 2 * (1 + 4));
  const dv = new DataView(body.buffer);
  const verts = [
    [0, 0, 0, 0, 0, 2],
    [2, 0, 0, 0, 0, 1],
    [0, 3, 0, 0, 0, 1],
  ];
  let at = 0;
  for (const v of verts)
    for (const c of v) {
      dv.setFloat32(at, c, little);
      at += 4;
    }
  body[at++] = 3;
  for (const i of [0, 1, 2]) {
    dv.setUint32(at, i, little);
    at += 4;
  }
  for (let e = 0; e < 2; e++) {
    body[at++] = 2;
    dv.setInt16(at, -1, little);
    dv.setInt16(at + 2, 7, little);
    at += 4;
  }
  return Buffer.concat([Buffer.from(header, 'latin1'), body]);
}

test('convert: PLY ascii and binary (both byte orders) become valid GLBs matching the three.js PLY loader', async () => {
  const ascii = plyToGlb(new Uint8Array(Buffer.from(plyAscii())));
  await validate(ascii.glb);
  assert.deepEqual(ascii.summary, {vertices: 4, triangles: 2, points: 0});
  const json = readGlbJson(ascii.glb);
  const prim = json.meshes[0].primitives[0];
  assert.deepEqual(
    accessor(ascii.glb, prim.attributes.COLOR_0),
    [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
  );
  assert.equal(json.accessors[prim.attributes.COLOR_0].normalized, true);
  const three = new PLYLoader().parse(plyAscii());
  assert.deepEqual(accessor(ascii.glb, prim.attributes.POSITION), Array.from(three.attributes.position.array));
  // Polygons are fan-triangulated from their first corner; three.js splits quads on the other diagonal.
  assert.deepEqual(accessor(ascii.glb, prim.indices), [0, 1, 2, 0, 2, 3]);
  assert.equal(three.index.count, 6);
  for (const little of [true, false]) {
    const bytes = plyBinary(little);
    const {glb} = plyToGlb(new Uint8Array(bytes));
    await validate(glb);
    const p = readGlbJson(glb).meshes[0].primitives[0];
    const ref = new PLYLoader().parse(ab(bytes));
    assert.deepEqual(accessor(glb, p.attributes.POSITION), Array.from(ref.attributes.position.array));
    assert.deepEqual(accessor(glb, p.attributes.NORMAL).slice(0, 3), [0, 0, 1]); // normalised
  }
  // A point cloud
  const points = plyToGlb(
    new Uint8Array(
      Buffer.from(
        'ply\nformat ascii 1.0\nelement vertex 2\nproperty double x\nproperty double y\nproperty double z\nend_header\n0 0 0\n1 2 3\n',
      ),
    ),
  );
  await validate(points.glb);
  assert.equal(readGlbJson(points.glb).meshes[0].primitives[0].mode, 0);
  assert.throws(
    () =>
      plyToGlb(
        new Uint8Array(
          Buffer.from(
            'ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n',
          ),
        ),
      ),
    /ends early/,
  );
  assert.throws(() => plyToGlb(new Uint8Array(Buffer.from('nope'))), /not a PLY/);
});

// ---- BVH ----------------------------------------------------------------------------------------------------
function makeBvh(frames, seed) {
  const r = lcg(seed);
  const rows = [];
  for (let f = 0; f < frames; f++) {
    const row = [r() * 10, 90 + r() * 5, r() * 10]; // root position
    for (let j = 0; j < 4; j++) for (let k = 0; k < 3; k++) row.push((r() - 0.5) * 170);
    rows.push(row.map(v => v.toFixed(4)).join(' '));
  }
  return `HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
  JOINT Spine
  {
    OFFSET 0 10 1
    CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT Chest
    {
      OFFSET 0 12 -1
      CHANNELS 3 Yrotation Xrotation Zrotation
      JOINT Head
      {
        OFFSET 0 8 2
        CHANNELS 3 Xrotation Yrotation Zrotation
        End Site
        {
          OFFSET 0 5 0
        }
      }
    }
  }
}
MOTION
Frames: ${frames}
Frame Time: 0.0333333
${rows.join('\n')}
`;
}
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function rot(q, v) {
  const p = qmul(qmul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]);
  return p.slice(0, 3);
}
/** World positions of every node at frame f, from a GLB's animation (forward kinematics over our own output). */
function world(glb, f) {
  const json = readGlbJson(glb);
  const local = json.nodes.map(n => ({t: n.translation, q: n.rotation}));
  for (const ch of json.animations[0].channels) {
    const out = accessor(glb, json.animations[0].samplers[ch.sampler].output);
    const w = ch.target.path === 'translation' ? 3 : 4;
    local[ch.target.node][ch.target.path === 'translation' ? 't' : 'q'] = out.slice(f * w, f * w + w);
  }
  const res = {};
  const visit = (i, pt, pq) => {
    const t = rot(pq, local[i].t).map((v, k) => v + pt[k]),
      q = qmul(pq, local[i].q);
    res[json.nodes[i].name] = t;
    for (const c of json.nodes[i].children ?? []) visit(c, t, q);
  };
  for (const r of json.scenes[0].nodes) visit(r, [0, 0, 0], [0, 0, 0, 1]);
  return res;
}

test('convert: BVH rotations and translations match the three.js BVH loader frame by frame', async () => {
  const text = makeBvh(30, 5);
  const {glb, summary} = bvhToGlb(text);
  await validate(glb);
  assert.deepEqual(summary, {joints: 4, frames: 30, duration: 29 * 0.0333333, folded: 0});
  const ref = new BVHLoader().parse(text);
  const json = readGlbJson(glb);
  for (const ch of json.animations[0].channels) {
    const node = json.nodes[ch.target.node].name;
    const ours = accessor(glb, json.animations[0].samplers[ch.sampler].output);
    const track = ref.clip.tracks.find(
      t => t.name === `${node}.${ch.target.path === 'translation' ? 'position' : 'quaternion'}`,
    );
    assert.ok(track, `three has a track for ${node} ${ch.target.path}`);
    const w = ch.target.path === 'translation' ? 3 : 4;
    for (let f = 0; f < 30; f++) {
      const a = ours.slice(f * w, f * w + w),
        b = Array.from(track.values.slice(f * w, f * w + w));
      const sign = w === 4 && a.reduce((s, v, k) => s + v * b[k], 0) < 0 ? -1 : 1;
      a.forEach((v, k) =>
        assert.ok(Math.abs(v - sign * b[k]) < 1e-5, `${node} ${ch.target.path} frame ${f}: ${a} vs ${b}`),
      );
    }
  }
  const loaded = await loadGlb(glb);
  assert.equal(loaded.animations[0].tracks.length, json.animations[0].channels.length);
  assert.ok(bvhToGlb(text).glb.equals(glb), 'byte-identical on a second run');
});

test('convert: BVH retargeting renames by bone map and folds unmapped joints without moving the mapped ones', () => {
  const text = makeBvh(12, 9);
  const full = bvhToGlb(text, {scale: 0.01});
  const mapped = bvhToGlb(text, {scale: 0.01, boneMap: {Hips: 'pelvis', Chest: 'chest', Head: 'head'}}); // Spine folded
  assert.equal(mapped.summary.folded, 1);
  const names = readGlbJson(mapped.glb).nodes.map(n => n.name);
  assert.deepEqual(names, ['pelvis', 'chest', 'head']);
  for (let f = 0; f < 12; f++) {
    const a = world(full.glb, f),
      b = world(mapped.glb, f);
    for (const [src, dst] of [
      ['Hips', 'pelvis'],
      ['Chest', 'chest'],
      ['Head', 'head'],
    ])
      a[src].forEach((v, k) => assert.ok(Math.abs(v - b[dst][k]) < 1e-5, `${src} frame ${f}`));
  }
  const still = bvhToGlb(text, {rootTranslation: 'horizontal-none'});
  const w0 = world(still.glb, 0).Hips,
    w5 = world(still.glb, 5).Hips;
  assert.equal(w0[0], w5[0]);
  assert.equal(w0[2], w5[2]);
  assert.throws(() => bvhToGlb(text, {boneMap: {Tail: 'tail'}}), /does not have/);
  assert.throws(() => bvhToGlb(text, {boneMap: {Hips: 'a', Head: 'a'}}), /two joints to one target/);
  assert.throws(() => bvhToGlb(text.replace('Frames: 12', 'Frames: 13')), /fewer values/);
  assert.throws(
    () => bvhToGlb(text.replace('Zrotation Xrotation Yrotation\n  JOINT', 'Zrotation Wrotation Yrotation\n  JOINT')),
    /unknown channel/,
  );
});

// ---- indexed images -----------------------------------------------------------------------------------------
function makePcx(width, height, indices, palette) {
  const header = Buffer.alloc(128);
  header[0] = 0x0a;
  header[1] = 5;
  header[2] = 1;
  header[3] = 8;
  header.writeUInt16LE(width - 1, 8);
  header.writeUInt16LE(height - 1, 10);
  header[65] = 1;
  const bpl = width + (width & 1);
  header.writeUInt16LE(bpl, 66);
  const body = [];
  for (let y = 0; y < height; y++) {
    const row = [...indices.slice(y * width, (y + 1) * width), ...(width & 1 ? [0] : [])];
    for (let x = 0; x < row.length;) {
      let run = 1;
      while (x + run < row.length && row[x + run] === row[x] && run < 63) run++;
      if (run > 1 || (row[x] & 0xc0) === 0xc0) body.push(0xc0 | run, row[x]);
      else body.push(row[x]);
      x += run;
    }
  }
  const pal = Buffer.alloc(769);
  pal[0] = 0x0c;
  palette.forEach((c, i) => pal.set(c.slice(0, 3), 1 + i * 3));
  return Buffer.concat([header, Buffer.from(body), pal]);
}
function makeBmp8(width, height, indices, palette, rle = false) {
  const stride = Math.ceil(width / 4) * 4;
  let pixels;
  if (rle) {
    const out = [];
    for (let y = height - 1; y >= 0; y--) {
      for (let x = 0; x < width; x++) out.push(1, indices[y * width + x]);
      out.push(0, 0);
    }
    out.push(0, 1);
    pixels = Buffer.from(out);
  } else {
    pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) pixels[(height - 1 - y) * stride + x] = indices[y * width + x];
  }
  const palBytes = Buffer.alloc(palette.length * 4);
  palette.forEach(([r, g, b], i) => palBytes.set([b, g, r, 0], i * 4));
  const head = Buffer.alloc(54);
  head.write('BM', 0, 'latin1');
  head.writeUInt32LE(54 + palBytes.length + pixels.length, 2);
  head.writeUInt32LE(54 + palBytes.length, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(width, 18);
  head.writeInt32LE(height, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(8, 28);
  head.writeUInt32LE(rle ? 1 : 0, 30);
  head.writeUInt32LE(palette.length, 46);
  return Buffer.concat([head, palBytes, pixels]);
}

test('convert: PCX and BMP palette images keep their palette and indices in an indexed PNG', () => {
  const width = 7,
    height = 5;
  const palette = Array.from({length: 16}, (_, i) => [i * 16, 255 - i * 16, (i * 37) & 255, 255]);
  const indices = Uint8Array.from({length: width * height}, (_, i) => (i * 7 + (i >> 3)) % 16);
  for (const [name, image] of [
    ['pcx', decodePcx(new Uint8Array(makePcx(width, height, indices, palette)))],
    ['bmp', decodeBmp(new Uint8Array(makeBmp8(width, height, indices, palette)))],
    ['bmp-rle8', decodeBmp(new Uint8Array(makeBmp8(width, height, indices, palette, true)))],
  ]) {
    assert.deepEqual([...image.indices], [...indices], name);
    const png = readPng(imageToPng(image, {transparent: 3}).png);
    assert.equal(png.colourType, 3);
    assert.deepEqual(png.rows.flat(), [...indices], `${name} rows`);
    assert.deepEqual(
      [...png.palette.subarray(0, 48)],
      palette.flatMap(c => c.slice(0, 3)),
      `${name} palette`,
    );
    assert.deepEqual([...png.trns], [255, 255, 255, 0], `${name} transparency stops at the last transparent entry`);
    const rgba = readPng(imageToPng(image, {output: 'rgba'}).png);
    assert.equal(rgba.colourType, 6);
    assert.deepEqual(rgba.rows[0].slice(0, 4), palette[indices[0]]);
  }
  assert.throws(() => decodePcx(new Uint8Array(10)), /not a PCX/);
  assert.throws(
    () => imageToPng({width: 1, height: 1, indices: Uint8Array.of(5), palette: [[0, 0, 0, 255]]}),
    /beyond/,
  );
});

test('convert: palettes read raw, 6-bit VGA, JASC-PAL and GIMP formats', () => {
  assert.deepEqual(readPalette(Uint8Array.of(0, 32, 63), {sixBit: true}), [[0, 130, 255, 255]]);
  assert.deepEqual(readPalette(Uint8Array.of(1, 2, 3, 4, 5, 6)), [
    [1, 2, 3, 255],
    [4, 5, 6, 255],
  ]);
  assert.deepEqual(readPalette(Buffer.from('JASC-PAL\r\n0100\r\n2\r\n1 2 3\r\n4 5 6\r\n')), [
    [1, 2, 3, 255],
    [4, 5, 6, 255],
  ]);
  assert.deepEqual(readPalette(Buffer.from('GIMP Palette\nName: x\n#\n  9  8  7\tname\n')), [[9, 8, 7, 255]]);
  assert.throws(() => readPalette(Uint8Array.of(64, 0, 0), {sixBit: true}), /above 63/);
  assert.throws(() => readPalette(Uint8Array.of(1, 2)), /3\.\.768/);
});

// ---- CLI and provenance -------------------------------------------------------------------------------------
test('convert: the CLI writes the output and a provenance receipt atomically, and refuses without author and licence', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'convert-'));
  try {
    writeFileSync(join(dir, 'cube.obj'), OBJ);
    writeFileSync(join(dir, 'cube.mtl'), MTL);
    assert.throws(() => convert(parseArgs(['obj', 'cube.obj', 'out/cube.glb']), dir), /--author and --licence/);
    assert.equal(existsSync(join(dir, 'out/cube.glb')), false);
    const r = convert(
      parseArgs(['obj', 'cube.obj', 'out/cube.glb', '--author', 'Test Author', '--licence', 'CC0-1.0', '--scale', '2']),
      dir,
    );
    const glb = readFileSync(r.output);
    const receipt = JSON.parse(readFileSync(r.receipt, 'utf8'));
    assert.equal(receipt.sha256, await_hash(glb));
    assert.equal(receipt.origin, 'hand');
    assert.equal(receipt.artifact, 'cube.glb');
    assert.equal(receipt.generator, 'tools/convert obj --scale 2');
    assert.deepEqual(
      receipt.inputs.map(i => i.path),
      ['cube.obj', 'cube.mtl'],
    );
    for (const field of ['origin', 'author', 'licence', 'source', 'sha256', 'tool', 'generator'])
      assert.ok(receipt[field], field);
    // The receipt is what lint:provenance reads: a converted file under a game's public/ has no problems.
    const shipped = convert(
      parseArgs([
        'image',
        'tiles.pcx',
        'game/public/textures/tiles.png',
        '--author',
        'A',
        '--licence',
        'CC-BY-4.0',
        '--origin',
        'library',
        '--source',
        'https://example.org/tiles',
      ]),
      (writeFileSync(
        join(dir, 'tiles.pcx'),
        makePcx(
          2,
          2,
          [0, 1, 1, 0],
          [
            [0, 0, 0, 255],
            [255, 255, 255, 255],
          ],
        ),
      ),
      dir),
    );
    assert.ok(shipped.receipt);
    const report = readProvenance(join(dir, 'game'));
    assert.deepEqual(
      report.assets.map(a => [a.path, a.problems]),
      [['textures/tiles.png', []]],
    );
    // A receipt belonging to another artifact is never overwritten.
    writeFileSync(join(dir, 'out/cube.provenance.json'), JSON.stringify({artifact: 'cube.png'}));
    assert.throws(
      () => convert(parseArgs(['obj', 'cube.obj', 'out/cube.glb', '--author', 'A', '--licence', 'CC0-1.0']), dir),
      /belongs to cube.png/,
    );
    assert.throws(() => parseArgs(['obj', 'a', 'b', '--colour', 'x']), /unknown option/);
    assert.throws(
      () => convert(parseArgs(['obj', 'cube.obj', 'out/cube.png', '--no-provenance']), dir),
      /converts to .glb/,
    );
    assert.throws(
      () => convert(parseArgs(['obj', 'cube.obj', 'out/x.glb', '--no-provenance', '--max-bytes', '10']), dir),
      /above --max-bytes/,
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
import {createHash} from 'node:crypto';
function await_hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('convert: review regressions — malformed geometry, colours by declared type, empty and non-finite data are refused', async () => {
  assert.throws(() => objToGlb('v 0 0\nv 1 0\nv 0 1\nf 1 2 3\n', () => null), /obj line 1: a vertex needs x, y and z/);
  assert.throws(
    () => objToGlb(OBJ, n => (n === 'cube.mtl' ? Buffer.from('newmtl red\nKd 0.5\n') : null)),
    /Kd needs three values/,
  );
  assert.throws(() => objToGlb(OBJ, () => null, {scale: -1}), /scale must be a positive/);
  // A group mixing corners with and without normals gets smooth normals where the file has none.
  const mixed = objToGlb('v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvn 0 0 1\nf 1//1 2//1 3//1\nf 2 4 3\n', () => null);
  await validate(mixed.glb);
  const header = names =>
    `ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\n${names}end_header\n`;
  // float colours that happen to be 0 or 1 stay floats (1.0 is white, not 1/255)
  const floats = plyToGlb(
    new Uint8Array(
      Buffer.from(
        header('property float red\nproperty float green\nproperty float blue\n') + '0 0 0 1 1 1\n1 0 0 0 1 0\n',
      ),
    ),
  );
  await validate(floats.glb);
  const fj = readGlbJson(floats.glb);
  const fc = fj.accessors[fj.meshes[0].primitives[0].attributes.COLOR_0];
  assert.equal(fc.componentType, 5126);
  assert.deepEqual(accessor(floats.glb, fj.meshes[0].primitives[0].attributes.COLOR_0).slice(0, 4), [1, 1, 1, 1]);
  // ushort colours are scaled by 65535; a float alpha beside uchar RGB is scaled per channel
  const mixedTypes = plyToGlb(
    new Uint8Array(
      Buffer.from(
        header('property ushort red\nproperty ushort green\nproperty ushort blue\nproperty float alpha\n') +
          '0 0 0 65535 0 32768 0.5\n1 0 0 0 65535 0 1\n',
      ),
    ),
  );
  await validate(mixedTypes.glb);
  const mj = readGlbJson(mixedTypes.glb);
  const mc = accessor(mixedTypes.glb, mj.meshes[0].primitives[0].attributes.COLOR_0);
  assert.equal(mc[0], 1);
  assert.equal(mc[3], 0.5);
  assert.throws(
    () =>
      plyToGlb(
        new Uint8Array(
          Buffer.from(
            header('property float red\nproperty float green\nproperty float blue\n') + '0 0 0 2 0 0\n1 0 0 0 0 0\n',
          ),
        ),
      ),
    /outside its range/,
  );
  assert.throws(
    () =>
      plyToGlb(
        new Uint8Array(
          Buffer.from(
            'ply\nformat ascii 1.0\nelement vertex 0\nproperty float x\nproperty float y\nproperty float z\nend_header\n',
          ),
        ),
      ),
    /no vertices/,
  );
  assert.throws(
    () =>
      plyToGlb(
        new Uint8Array(Buffer.from(header('property float s\nproperty float t\n') + '0 0 0 nan 0\n1 0 0 0 0\n')),
      ),
    /uv 0: not a finite/,
  );
  // `comment end_header` is a comment, not the end of the header
  const commented = plyToGlb(
    new Uint8Array(
      Buffer.from(
        'ply\nformat ascii 1.0\ncomment end_header\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n1 2 3\n',
      ),
    ),
  );
  await validate(commented.glb);
});

test('convert: review regressions — BVH sample cap, constant tracks, distinct key times', async () => {
  const joints =
    Array.from({length: 40}, (_, i) => `JOINT j${i}\n{\nOFFSET 0 1 0\nCHANNELS 0\n`).join('') + '}\n'.repeat(40);
  const heavy = `HIERARCHY\nROOT r\n{\nOFFSET 0 0 0\nCHANNELS 0\n${joints}}\nMOTION\nFrames: 200000\nFrame Time: 0.01\n`;
  assert.throws(() => bvhToGlb(heavy), /joint samples/);
  const text = makeBvh(10, 3).replace('CHANNELS 3 Xrotation Yrotation Zrotation', 'CHANNELS 0');
  const {glb} = bvhToGlb(text.replace(/^(.*)$/gm, l => (/^[-\d]/.test(l) ? l.split(' ').slice(0, 12).join(' ') : l)));
  await validate(glb);
  const json = readGlbJson(glb);
  const head = json.nodes.findIndex(n => n.name === 'Head');
  const ch = json.animations[0].channels.find(c => c.target.node === head && c.target.path === 'rotation');
  assert.equal(
    json.accessors[json.animations[0].samplers[ch.sampler].input].count,
    1,
    'a constant rotation is one key',
  );
  assert.throws(() => bvhToGlb(makeBvh(3, 1).replace('Frame Time: 0.0333333', 'Frame Time: 1e-50')), /too small/);
});

test('convert: review regressions — image bounds, BMP colour masks, raw length and transparency on true colour', () => {
  // A PCX whose bytes-per-line claims far more than its width
  const pcx = makePcx(1, 1, [0], [[0, 0, 0, 255]]);
  pcx.writeUInt16LE(60000, 66);
  assert.throws(() => decodePcx(new Uint8Array(pcx)), /bytes per line/);
  const tall = makePcx(1, 1, [0], [[0, 0, 0, 255]]);
  tall.writeUInt16LE(30000, 10); // height 30001 from a few bytes
  assert.throws(() => decodePcx(new Uint8Array(tall)), /claims more data/);
  // 32-bit BI_BITFIELDS with RGBA byte order
  const head = Buffer.alloc(54 + 16);
  head.write('BM', 0, 'latin1');
  head.writeUInt32LE(head.length + 4, 2);
  head.writeUInt32LE(head.length, 10);
  head.writeUInt32LE(56, 14);
  head.writeInt32LE(1, 18);
  head.writeInt32LE(1, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(32, 28);
  head.writeUInt32LE(3, 30);
  [0xff, 0xff00, 0xff0000, 0xff000000].forEach((m, i) => head.writeUInt32LE(m, 54 + i * 4));
  const rgbaBmp = decodeBmp(new Uint8Array(Buffer.concat([head, Buffer.from([10, 20, 30, 40])])));
  assert.deepEqual([...rgbaBmp.rgba], [10, 20, 30, 40]);
  head.writeUInt32LE(0xf800, 54);
  assert.throws(() => decodeBmp(new Uint8Array(Buffer.concat([head, Buffer.from([10, 20, 30, 40])]))), /whole bytes/);
  assert.throws(() => imageToPng(rgbaBmp, {transparent: 0}), /palette images only/);
});

test('convert: review regressions — referenced files stay inside the input folder; AI origins need their receipt fields', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'convert-'));
  try {
    mkdirSync(join(dir, 'in'));
    mkdirSync(join(dir, 'secret'));
    writeFileSync(join(dir, 'secret/key.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    writeFileSync(join(dir, 'in/m.obj'), 'mtllib m.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nusemtl a\nf 1/1 2/1 3/1\n');
    writeFileSync(join(dir, 'in/m.mtl'), 'newmtl a\nKd 1 1 1\nmap_Kd ../secret/key.png\n');
    assert.throws(
      () => convert(parseArgs(['obj', 'in/m.obj', 'out/m.glb', '--no-provenance']), dir),
      /outside the input's folder/,
    );
    writeFileSync(join(dir, 'in/m.mtl'), 'newmtl a\nKd 1 1 1\n');
    assert.throws(
      () =>
        convert(
          parseArgs([
            'obj',
            'in/m.obj',
            'out/m.glb',
            '--author',
            'A',
            '--licence',
            'CC0-1.0',
            '--origin',
            'ai-generator',
          ]),
          dir,
        ),
      /receipt would be incomplete: .*model/,
    );
    assert.equal(existsSync(join(dir, 'out/m.glb')), false);
    const ok = convert(
      parseArgs([
        'obj',
        'in/m.obj',
        'out/m.glb',
        '--author',
        'A',
        '--licence',
        'CC0-1.0',
        '--origin',
        'ai-generator',
        '--model',
        'Some model 1',
        '--prompt',
        'a ramp',
        '--human-edits',
        'none',
        '--weights-licence',
        'proprietary service',
        '--output-licence',
        'service terms',
      ]),
      dir,
    );
    assert.ok(ok.receipt);
    assert.throws(
      () => convert(parseArgs(['obj', 'in/m.obj', 'out/n.glb', '--author', ' ', '--licence', 'CC0-1.0']), dir),
      /--author and --licence/,
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---- S3O ----------------------------------------------------------------------------------------------------------
import {s3oToGlb} from './s3o.mjs';
/** A synthetic S3O: a root quad piece with one child strip piece (with a restart). */
function makeS3o() {
  const parts = [];
  let size = 52;
  const place = buf => {
    const offset = size;
    parts.push(buf);
    size += buf.length;
    return offset;
  };
  const cstr = s => place(Buffer.from(s + '\0', 'latin1'));
  const verts = list => {
    const b = Buffer.alloc(list.length * 32);
    list.forEach(([x, y, z, u, v], i) => {
      [x, y, z, 0, 0, 2, u, v].forEach((f, k) => b.writeFloatLE(f, i * 32 + k * 4));
    });
    return place(b);
  };
  const table = list => {
    const b = Buffer.alloc(list.length * 4);
    list.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4));
    return place(b);
  };
  const piece = ({name, children = [], v, prim, idx, off}) => {
    const nameAt = cstr(name);
    const vAt = verts(v),
      iAt = table(idx),
      cAt = children.length ? table(children) : 0;
    const p = Buffer.alloc(52);
    [nameAt, children.length, cAt, v.length, vAt, 0, prim, idx.length, iAt, 0].forEach((n, k) =>
      p.writeInt32LE(n, k * 4),
    );
    off.forEach((f, k) => p.writeFloatLE(f, 40 + k * 4));
    return place(p);
  };
  const quad = [
    [0, 0, 0, 0, 0],
    [1, 0, 0, 1, 0],
    [1, 1, 0, 1, 1],
    [0, 1, 0, 0, 1],
  ];
  const strip = [...quad, [2, 0, 0, 0, 0], [2, 1, 0, 0, 1]];
  const child = piece({name: 'turret', v: strip, prim: 1, idx: [0, 1, 3, 2, 0xffffffff, 1, 4, 2, 5], off: [0, 2, 0]});
  const root = piece({name: 'base', v: quad, prim: 2, idx: [0, 1, 2, 3], off: [0, 0, 0], children: [child]});
  const t1 = cstr('unit_tex1.dds');
  const head = Buffer.alloc(52);
  head.write('Spring unit\0', 0, 'latin1');
  [0].forEach(() => head.writeInt32LE(0, 12));
  [10, 5, 0, 2, 0].forEach((f, k) => head.writeFloatLE(f, 16 + k * 4));
  [root, 0, t1, 0].forEach((n, k) => head.writeInt32LE(n, 36 + k * 4));
  return Buffer.concat([head, ...parts]);
}

test('convert: S3O pieces become named glTF nodes with triangulated quads and strips', async () => {
  const bytes = makeS3o();
  const {glb, summary} = s3oToGlb(new Uint8Array(bytes));
  await validate(glb);
  assert.deepEqual(summary, {pieces: 2, vertices: 10, triangles: 6, textures: ['unit_tex1.dds']});
  const json = readGlbJson(glb);
  assert.deepEqual(
    json.nodes.map(n => n.name),
    ['base', 'turret'],
  );
  assert.deepEqual(json.nodes[1].translation, [0, 2, 0]);
  assert.deepEqual(json.nodes[0].children, [1]);
  assert.deepEqual(json.materials[0].extras.s3oTextures, ['unit_tex1.dds', '']);
  // Strips 0,1,3,2 and (after the restart) 1,4,2,5: odd triangles swap their first two corners to keep the winding.
  const idx = accessor(glb, json.meshes[1].primitives[0].indices);
  assert.deepEqual(idx, [0, 1, 3, 3, 1, 2, 1, 4, 2, 2, 4, 5]);
  const uv = accessor(glb, json.meshes[0].primitives[0].attributes.TEXCOORD_0);
  assert.deepEqual(uv.slice(0, 4), [0, 1, 1, 1], 'v is flipped to glTF orientation');
  const loaded = await loadGlb(glb);
  assert.ok(loaded.scene.getObjectByName('turret'));
  assert.ok(s3oToGlb(new Uint8Array(bytes)).glb.equals(glb));
  const broken = Buffer.from(bytes);
  broken.writeInt32LE(1 << 30, 36);
  assert.throws(() => s3oToGlb(new Uint8Array(broken)), /outside the file/);
  assert.throws(() => s3oToGlb(new Uint8Array(Buffer.from('nope'))), /not an S3O/);
});
