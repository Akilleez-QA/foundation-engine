import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {Resvg} from '@resvg/resvg-js';
import {scan, geometryFingerprint, textSignature} from './scan.mjs';
import {decodePng} from './png-decode.mjs';
import {run} from './cli.mjs';

function tree(files) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'dupes-'));
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), {recursive: true});
    writeFileSync(join(dir, path), bytes);
  }
  return dir;
}
/** A minimal GLB: one triangle; `name` and `extra` change only the JSON. */
function glb(positions, {name = 'mesh', extra = {}} = {}) {
  const bin = Buffer.from(new Float32Array(positions).buffer);
  const json = {
    asset: {version: '2.0', generator: name},
    meshes: [{name, primitives: [{attributes: {POSITION: 0}}]}],
    accessors: [{bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3'}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: bin.length}],
    buffers: [{byteLength: bin.length}],
    ...extra,
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + 8 + bin.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, Buffer.from(text), binHead, bin]);
}
/** An RGBA PNG (filter 0) from a pixel function. */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const crcTable = Array.from({length: 256}, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = b => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const SOURCE = `
export function stepBodies(bodies, dt) {
  for (const body of bodies) {
    body.vx += body.ax * dt; // integrate
    body.vy += body.ay * dt;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    if (body.y < 0) { body.y = 0; body.vy = -body.vy * body.restitution; }
  }
  return bodies.filter(b => b.alive);
}
`;
const REFORMATTED = SOURCE.replace(/\n {4}/g, '\n\t\t')
  .replace('// integrate', '/* explicit Euler */')
  .replace('return', '\n  return');
const OTHER = `
export class Inventory {
  constructor(capacity) { this.capacity = capacity; this.items = new Map(); }
  add(id, count) { const have = this.items.get(id) ?? 0; if (have + count > this.capacity) return false; this.items.set(id, have + count); return true; }
  remove(id) { return this.items.delete(id); }
}
`;

test('dupes: exact copies are grouped with their git blob id; mesh data, images and text find near copies', () => {
  const gradient = (x, y) => [x * 4, y * 4, 128, 255];
  const dir = tree({
    'models/crate.glb': glb([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    'models/crate-copy.glb': glb([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    'models/crate-renamed.glb': glb([0, 0, 0, 1, 0, 0, 0, 1, 0], {
      name: 'Crate_final',
      extra: {materials: [{name: 'wood'}]},
    }),
    'models/other.glb': glb([0, 0, 0, 2, 0, 0, 0, 1, 0]),
    'textures/a.png': png(64, 48, gradient),
    'textures/a-retouched.png': png(64, 48, (x, y) => {
      const [r, g, b, a] = gradient(x, y);
      return [r, Math.min(255, g + ((x * 7 + y * 3) % 5)), b, a]; // faint noise
    }),
    'textures/checker.png': png(64, 48, (x, y) => (((x >> 3) + (y >> 3)) & 1 ? [255, 255, 255, 255] : [0, 0, 0, 255])),
    'src/physics.mjs': SOURCE,
    'src/physics-old.mjs': REFORMATTED,
    'src/inventory.mjs': OTHER,
  });
  try {
    const r = scan([{root: dir, label: 'a'}]);
    assert.equal(r.files, 10);
    assert.equal(r.exact.length, 1);
    assert.deepEqual(r.exact[0].members, ['a:models/crate-copy.glb', 'a:models/crate.glb']);
    const blob = execFileSync('git', ['hash-object', join(dir, 'models/crate.glb')], {encoding: 'utf8'}).trim();
    assert.equal(r.exact[0].blob, blob, 'the blob id is what git computes');
    // Near matches use one representative per exact group (the first path), so the exact copy is not repeated here.
    assert.deepEqual(r.geometry, [{members: ['a:models/crate-copy.glb', 'a:models/crate-renamed.glb']}]);
    assert.deepEqual(
      r.image.map(g => g.members),
      [['a:textures/a-retouched.png', 'a:textures/a.png']],
    );
    assert.deepEqual(
      r.text.map(g => g.members),
      [['a:src/physics-old.mjs', 'a:src/physics.mjs']],
    );
    assert.ok(r.text[0].minSimilarity >= 0.85);
    const quick = scan([{root: dir, label: 'a'}], {near: false});
    assert.deepEqual([quick.geometry, quick.image, quick.text], [[], [], []]);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('dupes: --against reports only matches that cross the two trees, and --fail-on sets the exit status', async () => {
  const a = tree({
    'x.txt': 'shared licence text\n'.repeat(20),
    'y.txt': 'inside a only\n'.repeat(20),
    'y2.txt': 'inside a only\n'.repeat(20),
  });
  const b = tree({'vendor/x-copy.txt': 'shared licence text\n'.repeat(20)});
  try {
    const crossed = await run([a, '--against', b, '--json']);
    assert.deepEqual(
      crossed.report.exact.map(g => g.members),
      [['a:x.txt', 'b:vendor/x-copy.txt']],
    );
    assert.equal(crossed.status, 0);
    const strict = await run([a, '--fail-on', 'exact']);
    assert.equal(strict.status, 1);
    assert.match(strict.text, /exact duplicates: 1 group/);
    const clean = await run([b, '--fail-on', 'near']);
    assert.equal(clean.status, 0);
    await assert.rejects(run([a, '--fail-on', 'maybe']), /exact or near/);
    await assert.rejects(run([join(a, 'missing')]), /does not exist/);
  } finally {
    rmSync(a, {recursive: true, force: true});
    rmSync(b, {recursive: true, force: true});
  }
});

test('dupes: the PNG decoder matches a real renderer on every filter, interlaced and palette images', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="37" height="23"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="37" height="23" fill="url(#g)"/><circle cx="12" cy="11" r="8" fill="#0c3"/></svg>`;
  const rendered = new Resvg(svg).render();
  const bytes = rendered.asPng();
  const decoded = decodePng(Buffer.from(bytes));
  assert.equal(decoded.width, 37);
  // Opaque, so resvg's premultiplied pixels equal the PNG's straight alpha; tRNS alpha is covered below.
  assert.deepEqual(
    Buffer.from(decoded.rgba),
    Buffer.from(rendered.pixels),
    'resvg PNG (adaptive filters) decodes to its pixels',
  );
  // Interlaced and palette images: our decoder must give the same pixels as the non-interlaced RGBA original.
  const pixels = Buffer.from(rendered.pixels);
  for (const variant of [adam7(37, 23, pixels), palette4(37, 23)]) {
    const d = decodePng(variant.bytes);
    assert.ok(d, variant.name);
    assert.deepEqual(Buffer.from(d.rgba), variant.expected, variant.name);
  }
  assert.equal(decodePng(Buffer.from('not a png')), null);
  assert.equal(decodePng(Buffer.concat([Buffer.from(bytes).subarray(0, 40)])), null, 'truncated');
});

/** Adam7-interlaced RGBA8 PNG of `pixels` with filter 1 (Sub) on every row. */
function adam7(width, height, pixels) {
  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ];
  const rows = [];
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx),
      ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    for (let y = 0; y < ph; y++) {
      const line = Buffer.alloc(pw * 4);
      for (let x = 0; x < pw; x++)
        pixels.copy(
          line,
          x * 4,
          ((y0 + y * dy) * width + x0 + x * dx) * 4,
          ((y0 + y * dy) * width + x0 + x * dx) * 4 + 4,
        );
      const sub = Buffer.alloc(pw * 4 + 1);
      sub[0] = 1;
      for (let i = 0; i < line.length; i++) sub[i + 1] = (line[i] - (i >= 4 ? line[i - 4] : 0)) & 255;
      rows.push(sub);
    }
  }
  return {name: 'adam7', bytes: wrapPng(width, height, 8, 6, Buffer.concat(rows), 1), expected: pixels};
}
/** A 4-bit palette PNG with tRNS. */
function palette4(width, height) {
  const pal = [
    [10, 20, 30],
    [200, 100, 50],
    [0, 255, 0],
  ];
  const stride = Math.ceil(width / 2);
  const raw = Buffer.alloc((stride + 1) * height);
  const expected = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (x + y) % 3;
      raw[y * (stride + 1) + 1 + (x >> 1)] |= x & 1 ? i : i << 4;
      expected.set([...pal[i], i === 1 ? 77 : 255], (y * width + x) * 4);
    }
  return {
    name: 'palette4',
    bytes: wrapPng(width, height, 4, 3, raw, 0, Buffer.from(pal.flat()), Buffer.from([255, 77])),
    expected,
  };
}
function wrapPng(width, height, depth, type, raw, interlace, plte, trns) {
  const crcTable = Array.from({length: 256}, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = b => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(t, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = type;
  ihdr[12] = interlace;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(plte ? [chunk('PLTE', plte)] : []),
    ...(trns ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('dupes: fingerprints ignore layout but not content', () => {
  assert.equal(
    geometryFingerprint(glb([0, 0, 0, 1, 0, 0, 0, 1, 0])),
    geometryFingerprint(glb([0, 0, 0, 1, 0, 0, 0, 1, 0], {name: 'x'})),
  );
  assert.notEqual(
    geometryFingerprint(glb([0, 0, 0, 1, 0, 0, 0, 1, 0])),
    geometryFingerprint(glb([0, 0, 0, 1, 0, 0, 0, 1, 1e-6])),
  );
  assert.equal(geometryFingerprint(Buffer.from('nope')), null);
  assert.equal(textSignature('too short'), null);
  const a = textSignature(SOURCE),
    b = textSignature(REFORMATTED),
    c = textSignature(OTHER);
  let ab = 0,
    ac = 0;
  for (let k = 0; k < a.length; k++) {
    ab += a[k] === b[k] ? 1 : 0;
    ac += a[k] === c[k] ? 1 : 0;
  }
  assert.ok(ab / a.length > 0.85 && ac / a.length < 0.2, `${ab} vs ${ac}`);
});

// ---- review regressions -----------------------------------------------------------------------------------------
import {symlinkSync, chmodSync} from 'node:fs';
import {tokens, imageHash} from './scan.mjs';

/** A PNG chunk appended before IEND so files differ in bytes but not in pixels. */
function withText(pngBytes, text) {
  const iend = pngBytes.length - 12;
  const data = Buffer.from(`Comment\0${text}`, 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  data.copy(chunk, 8);
  return Buffer.concat([pngBytes.subarray(0, iend), chunk, pngBytes.subarray(iend)]); // CRC unchecked by the decoder
}

test('dupes review: a decompression bomb is refused at the exact filtered size', () => {
  const width = 4096,
    height = 4096;
  const raw = Buffer.alloc((width + 1) * height * 4); // four times the real size of an 8-bit grey image
  const bomb = wrapPng(width, height, 8, 0, raw, 0);
  const started = Date.now();
  assert.equal(decodePng(bomb), null);
  assert.ok(Date.now() - started < 5000);
  assert.ok(decodePng(wrapPng(width, 2, 8, 0, Buffer.alloc((width + 1) * 2), 0)), 'the exact size still decodes');
});

test('dupes review: large families are grouped, identical hashes are collapsed, and scores cover every pair', () => {
  const body = SOURCE.repeat(3);
  const files = {};
  for (let i = 0; i < 300; i++) files[`copies/c${i}.ts`] = `${body}\nexport const id${i} = ${i};\n`;
  const base = png(32, 32, (x, y) => [x * 8, y * 8, (x * y) & 255, 255]);
  for (let i = 0; i < 400; i++) files[`same/i${i}.png`] = withText(base, String(i));
  for (let i = 0; i < 50; i++) files[`flat/f${i}.png`] = png(16, 16, () => [i * 5, 0, 0, 255]);
  const dir = tree(files);
  try {
    const started = Date.now();
    const r = scan([{root: dir, label: 'a'}]);
    assert.ok(Date.now() - started < 30000);
    assert.equal(r.text.length, 1);
    assert.equal(r.text[0].members.length, 300);
    assert.equal(r.text[0].minSimilarity, null, 'a group over 200 members reports no score');
    assert.equal(r.image.length, 1);
    assert.equal(r.image[0].members.length, 400);
    assert.equal(r.skipped.filter(s => /flat image/.test(s.reason)).length, 50, 'flat images are skipped, not matched');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
  // A chain a–b–c where a and c are farther apart than the threshold reports the farthest pair.
  const grad = k => (x, y) => [Math.min(255, x * 8 + (x > 16 + k ? 60 : 0)), y * 8, 0, 255];
  const chain = tree({'k0.png': png(32, 32, grad(0)), 'k4.png': png(32, 32, grad(4)), 'k8.png': png(32, 32, grad(8))});
  try {
    const r = scan([{root: chain, label: 'a'}], {imageDistance: 15});
    assert.ok(r.image.length >= 1, 'the variants are linked');
    for (const g of r.image) {
      let worst = 0;
      const hashes = g.members.map(m => imageHash(readFileSync(join(chain, m.slice(2)))).hash);
      for (const a of hashes)
        for (const b of hashes) worst = Math.max(worst, [...(a ^ b).toString(2)].filter(c => c === '1').length);
      assert.equal(g.maxDistance, worst);
    }
  } finally {
    rmSync(chain, {recursive: true, force: true});
  }
});

test('dupes review: small, flat and vertical-only images hash by their structure', () => {
  assert.equal(imageHash(png(4, 4, () => [255, 0, 0, 255])).flat, true);
  const checker = imageHash(png(4, 4, (x, y) => ((x + y) & 1 ? [255, 255, 0, 255] : [0, 0, 255, 255])));
  assert.ok(!checker.flat && checker.hash !== 0n);
  const sky = imageHash(png(32, 32, (x, y) => [y * 8, y * 8, 255, 255]));
  const skyFlipped = imageHash(png(32, 32, (x, y) => [255 - y * 8, 255 - y * 8, 255, 255]));
  assert.ok(sky.hash !== skyFlipped.hash, 'vertical structure counts');
});

test('dupes review: geometry compares sparse data, morph targets and index values, and skips compressed meshes', () => {
  const base = glb([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const withSparse = (v, extra = {}) => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const bin = Buffer.concat([
      Buffer.from(new Float32Array(positions).buffer),
      Buffer.from(new Uint16Array([1, 0]).buffer),
      Buffer.from(new Float32Array([v, v, v]).buffer),
    ]);
    return rawGlb(
      {
        asset: {version: '2.0'},
        meshes: [{primitives: [{attributes: {POSITION: 0}, ...extra}]}],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            sparse: {count: 1, indices: {bufferView: 1, componentType: 5123}, values: {bufferView: 2}},
          },
        ],
        bufferViews: [
          {buffer: 0, byteOffset: 0, byteLength: 36},
          {buffer: 0, byteOffset: 36, byteLength: 2},
          {buffer: 0, byteOffset: 40, byteLength: 12},
        ],
        buffers: [{byteLength: bin.length}],
      },
      Buffer.concat([bin.subarray(0, 38), Buffer.alloc(2), bin.subarray(38)]),
    );
  };
  assert.notEqual(geometryFingerprint(withSparse(5)), geometryFingerprint(withSparse(9)));
  assert.notEqual(geometryFingerprint(withSparse(5)), geometryFingerprint(base));
  assert.notEqual(
    geometryFingerprint(withSparse(5, {targets: [{POSITION: 0}]})),
    geometryFingerprint(withSparse(5)),
    'morph targets count',
  );
  // 16- and 32-bit indices of the same triangle are the same geometry
  const indexed = (Type, componentType) => {
    const pos = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const idx = Buffer.from(new Type([0, 1, 2]).buffer);
    const pad = Buffer.alloc((4 - (idx.length % 4)) % 4);
    return rawGlb(
      {
        asset: {version: '2.0'},
        meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
        accessors: [
          {bufferView: 0, componentType: 5126, count: 3, type: 'VEC3'},
          {bufferView: 1, componentType, count: 3, type: 'SCALAR'},
        ],
        bufferViews: [
          {buffer: 0, byteOffset: 0, byteLength: 36},
          {buffer: 0, byteOffset: 36, byteLength: idx.length},
        ],
        buffers: [{byteLength: 36 + idx.length + pad.length}],
      },
      Buffer.concat([pos, idx, pad]),
    );
  };
  assert.equal(geometryFingerprint(indexed(Uint16Array, 5123)), geometryFingerprint(indexed(Uint32Array, 5125)));
  assert.throws(
    () =>
      geometryFingerprint(
        rawGlb(
          {
            asset: {version: '2.0'},
            extensionsUsed: ['KHR_draco_mesh_compression'],
            meshes: [{primitives: [{attributes: {}}]}],
          },
          Buffer.alloc(0),
        ),
      ),
    /compressed geometry/,
  );
});
function rawGlb(json, bin) {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const parts = [Buffer.alloc(20), Buffer.from(text)];
  parts[0].writeUInt32LE(0x46546c67, 0);
  parts[0].writeUInt32LE(2, 4);
  parts[0].writeUInt32LE(text.length, 12);
  parts[0].writeUInt32LE(0x4e4f534a, 16);
  if (bin.length) {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(bin.length, 0);
    h.writeUInt32LE(0x004e4942, 4);
    parts.push(h, bin);
  }
  const out = Buffer.concat(parts);
  out.writeUInt32LE(out.length, 8);
  return out;
}

test('dupes review: unreadable folders, symlinked roots, ignore rules, tokens and CLI statuses', async () => {
  const dir = tree({
    'a/dist': 'same text same text same text\n',
    'a/dist2': 'same text same text same text\n',
    'a/locked/x.txt': 'x',
    'a/sub/perf/runs/r.txt': 'r',
    'single.txt': 'one',
  });
  try {
    chmodSync(join(dir, 'a/locked'), 0o000);
    symlinkSync(join(dir, 'a'), join(dir, 'link'));
    const r = scan([{root: join(dir, 'link'), label: 'a'}]);
    assert.deepEqual(
      r.exact.map(g => g.members),
      [['a:dist', 'a:dist2']],
      'a file named dist is scanned; the symlinked root is followed',
    );
    if (process.getuid?.() !== 0) assert.ok(r.skipped.some(s => s.file === 'locked' && /not readable/.test(s.reason)));
    assert.ok(
      !r.skipped.some(s => /perf/.test(s.file)) && !JSON.stringify(r).includes('r.txt'),
      'nested perf/runs is ignored',
    );
    const one = await run([join(dir, 'single.txt'), join(dir, 'single.txt')]);
    assert.match(one.text, /exact duplicates: 1 group/);
    assert.doesNotMatch(one.text, /\/\//);
    await assert.rejects(run([dir, '--fail-on', 'near', '--no-near']), /needs the near comparison/);
    await assert.rejects(run([dir, '--image-distance', '16']), /in \[0, 15\]/);
  } finally {
    chmodSync(join(dir, 'a/locked'), 0o755);
    rmSync(dir, {recursive: true, force: true});
  }
  assert.deepEqual(tokens('const url = "http://x"; // note\n# Heading\n'), [
    'const',
    'url',
    '=',
    '"http://x"',
    ';',
    '#',
    'Heading',
  ]);
});
