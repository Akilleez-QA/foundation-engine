// Legacy-format decoders: every fixture is built here by an encoder written for the test (no game data), decoded,
// and compared with the values the encoder put in. Fuzz and bomb tests check that hostile input only ever produces an
// Error, quickly and within the declared output bounds.
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {deflateSync, inflateSync} from 'node:zlib';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {decodeLzssBlocks, decodeLz77} from './lzss.mjs';
import {readArchive, extractMember} from './archive.mjs';
import {decodeFrameSet, decodePlanarScreen, readVgaPalette} from './sprites.mjs';
import {decodeTim, decodeSpuAdpcm, decodeVag} from './psx.mjs';
import {readMovie, decodeCastBitmap, unpackBits} from './director.mjs';
import {createCinepak, decodeMovieFrame, readQuickTime} from './cinepak.mjs';
import {convert, parseArgs} from './cli.mjs';
import {readProvenance} from '../../scripts/lib/provenance.ts';

const lcg = seed => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
};
const be16 = v => [(v >> 8) & 255, v & 255];
const be32 = v => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const le16 = v => [v & 255, (v >> 8) & 255];
const le32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

const LZSS_REFUSAL = /exceeds the declared size|ends after|end marker|no output/;

// ---- encoders used to build fixtures ------------------------------------------------------------------------------
/** LZSS: one compressed block (greedy, non-overlapping matches against earlier output), then the end. */
function lzssBlock(data) {
  const body = [];
  let o = 0;
  while (o < data.length) {
    let flags = 0;
    const group = [];
    for (let bit = 0; bit < 8 && o < data.length; bit++) {
      let best = 0,
        bestFrom = 0;
      for (let d = 1; d <= Math.min(o, 4000); d++) {
        let L = 0;
        while (L < 18 && L < d && o + L < data.length && data[o - d + L] === data[o + L]) L++;
        if (L > best) {
          best = L;
          bestFrom = o - d;
        }
      }
      if (best >= 3) {
        const pos = (4078 + bestFrom) & 4095;
        group.push(pos & 255, ((pos >> 4) & 0xf0) | (best - 3));
        o += best;
      } else {
        flags |= 1 << bit;
        group.push(data[o++]);
      }
    }
    body.push(flags, ...group);
  }
  return [...be16(body.length), ...body];
}
/** LZ77: greedy with overlapping references (distance 1..2047, length 3..34). */
function lz77(data) {
  const out = [];
  let o = 0;
  while (o < data.length) {
    let flags = 0;
    const group = [];
    for (let bit = 7; bit >= 0 && o < data.length; bit--) {
      let best = 0,
        bestD = 0;
      for (let d = 1; d <= Math.min(o, 2047); d++) {
        let L = 0;
        while (L < 34 && o + L < data.length && data[o - d + L] === data[o + L]) L++;
        if (L > best) [best, bestD] = [L, d];
      }
      if (best >= 3) {
        flags |= 1 << bit;
        group.push(...be16(((0x22 - best) << 11) | bestD));
        o += best;
      } else group.push(data[o++]);
    }
    out.push(flags, ...group);
  }
  return Uint8Array.from(out);
}
const pstr = s => [s.length, ...Buffer.from(s, 'latin1')];

/** Archive layout 1: one directory with a stored member and an LZSS member. */
function archive1(files) {
  const head = [...be32(1), ...be32(0), ...be32(0), ...be32(0), ...pstr('ART\\SPRITES')];
  const dirSize = 4 + 12 + files.reduce((n, f) => n + 1 + f.name.length + 16, 0);
  let offset = head.length + dirSize;
  const dir = [...be32(files.length), ...be32(0), ...be32(0), ...be32(0)];
  const bodies = [];
  for (const f of files) {
    const body = f.lzss ? [...lzssBlock(f.data)] : [...f.data];
    dir.push(
      ...pstr(f.name),
      ...be32(f.lzss ? 0x40 : 0x20),
      ...be32(offset),
      ...be32(f.data.length),
      ...be32(f.lzss ? body.length : 0),
    );
    bodies.push(...body);
    offset += body.length;
  }
  return Uint8Array.from([...head, ...dir, ...bodies]);
}
/** Archive layout 2: zlib and stored members, directory and trailer at the end. */
function archive2(files) {
  const bodies = [],
    dir = [...le32(files.length)];
  for (const f of files) {
    const body = f.zlib ? [...deflateSync(Buffer.from(f.data))] : [...f.data];
    dir.push(
      ...le32(f.name.length),
      ...Buffer.from(f.name, 'latin1'),
      f.zlib ? 1 : 0,
      ...le32(f.data.length),
      ...le32(body.length),
      ...le32(bodies.length),
    );
    bodies.push(...body);
  }
  const total = bodies.length + dir.length + 8;
  return Uint8Array.from([...bodies, ...dir, ...le32(dir.length), ...le32(total)]);
}

test('legacy: LZSS blocks and LZ77 decode what the test encoders wrote, with stored blocks and initial-ring matches', () => {
  const r = lcg(1);
  const text = Buffer.from(
    'the quick brown fox jumps over the lazy dog; '.repeat(40) +
      Array.from({length: 300}, () => String.fromCharCode(97 + Math.floor(r() * 4))).join(''),
  );
  const data = Uint8Array.from(text);
  assert.deepEqual(decodeLzssBlocks(Uint8Array.from(lzssBlock(data)), data.length), data);
  // a stored block, then a compressed block whose first match reads the space-filled ring: "   " from position 0
  const stored = [...be16(0x10000 - 3), 65, 66, 67];
  const ring = [0x00, 0x00, 0x00]; // flags 0: a match at ring position 0, length 3
  const mixed = Uint8Array.from([...stored, ...be16(ring.length), ...ring]);
  assert.equal(Buffer.from(decodeLzssBlocks(mixed, 6)).toString('latin1'), 'ABC   ');
  assert.throws(() => decodeLzssBlocks(Uint8Array.from(lzssBlock(data)), data.length + 1), /ends after/);
  assert.throws(() => decodeLzssBlocks(Uint8Array.from(lzssBlock(data)), data.length - 1), /exceeds the declared size/);
  const lz = lz77(data);
  assert.deepEqual(decodeLz77(lz), data);
  assert.throws(
    () => decodeLz77(Uint8Array.from([0x80, ...be16(((0x22 - 5) << 11) | 1)])),
    /back from position 0/,
    'a reference before any output is refused',
  );
});

test('legacy: archives list and extract stored, LZSS and zlib members by normalised name', () => {
  const pixels = Uint8Array.from({length: 2000}, (_, i) => (i * 7) % 13);
  const note = Uint8Array.from(Buffer.from('hello archive'));
  const a1 = archive1([
    {name: 'Hero.FRM', data: pixels, lzss: true},
    {name: 'readme.txt', data: note},
  ]);
  const l1 = readArchive(a1);
  assert.equal(l1.layout, 1);
  assert.deepEqual(
    l1.members.map(m => [m.name, m.method]),
    [
      ['art\\sprites\\hero.frm', 'lzss'],
      ['art\\sprites\\readme.txt', 'stored'],
    ],
  );
  assert.deepEqual(extractMember(a1, l1, 'art/sprites/HERO.frm'), pixels);
  assert.deepEqual(extractMember(a1, l1, 'art\\sprites\\readme.txt'), note);
  const a2 = archive2([
    {name: '.\\data\\Map.bin', data: pixels, zlib: true},
    {name: 'data/plain.txt', data: note},
  ]);
  const l2 = readArchive(a2);
  assert.equal(l2.layout, 2);
  assert.deepEqual(extractMember(a2, l2, 'data\\map.bin'), pixels);
  assert.deepEqual(extractMember(a2, l2, 'DATA/PLAIN.TXT'), note);
  assert.throws(() => extractMember(a2, l2, 'nope'), /no member/);
});

/** A frame set: two distinct directions (others share), two frames each. */
function frameSet() {
  const frames = dir => [
    {w: 3, h: 2, shift: [1, -1], px: [0, 1, 2, 3, 4, 5].map(v => v + dir * 10)},
    {w: 2, h: 3, shift: [0, 2], px: [7, 8, 9, 10, 11, 12].map(v => v + dir * 10)},
  ];
  const encode = fs =>
    fs.flatMap(f => [
      ...be16(f.w),
      ...be16(f.h),
      ...be32(f.w * f.h),
      ...be16(f.shift[0] & 0xffff),
      ...be16(f.shift[1] & 0xffff),
      ...f.px,
    ]);
  const d0 = encode(frames(0)),
    d1 = encode(frames(1));
  const offsets = [0, d0.length, 0, 0, d0.length, 0];
  const head = [
    ...be32(4),
    ...be16(12),
    ...be16(1),
    ...be16(2),
    ...[1, 2, 3, 4, 5, 6].flatMap(be16),
    ...[-1, -2, 0, 0, 0, 7].flatMap(v => be16(v & 0xffff)),
    ...offsets.flatMap(be32),
    ...be32(d0.length + d1.length),
  ];
  return Uint8Array.from([...head, ...d0, ...d1]);
}

test('legacy: frame sets become a sprite sheet with frame rectangles; VGA palettes scale and unmapped entries clear', () => {
  const pal = new Uint8Array(768 + 32768);
  for (let i = 0; i < 256; i++) pal.set([i % 64, 63 - (i % 64), 32], i * 3);
  pal.set([70, 0, 0], 255 * 3); // unmapped
  const palette = readVgaPalette(pal);
  assert.deepEqual(palette[1], [4, 251, 130, 255]);
  assert.deepEqual(palette[255], [0, 0, 0, 0]);
  const {image, meta} = decodeFrameSet(frameSet(), palette);
  assert.equal(image.width, 6); // two columns of the widest frame (3)
  assert.equal(image.height, 6); // two distinct directions of the tallest frame (3)
  assert.deepEqual(meta.directionRow, [0, 1, 0, 0, 1, 0]);
  assert.equal(meta.fps, 12);
  assert.deepEqual(meta.frames[3], {row: 1, col: 1, x: 3, y: 3, w: 2, h: 3, shift: [0, 2]});
  assert.deepEqual([...image.indices.subarray(0, 3)], [0, 1, 2]);
  assert.equal(image.indices[3 * 6 + 3], 17);
  assert.equal(image.palette[0][3], 0, 'index 0 is transparent');
  assert.throws(() => decodeFrameSet(frameSet().subarray(0, 70), palette), /outside the file|run past/);
});

test('legacy: planar screens decode their bit planes and 12-bit palette', () => {
  const type = 4;
  const r = lcg(3);
  const indices = Uint8Array.from({length: 64000}, (_, i) => ((i >> 5) + (i % 320 < 160 ? 0 : 5)) & 15);
  indices[1] = Math.floor(r() * 16);
  const planes = new Uint8Array(8000 * type);
  for (let p = 0; p < 64000; p++)
    for (let j = 0; j < type; j++) if ((indices[p] >> j) & 1) planes[j * 8000 + (p >> 3)] |= 0x80 >> (p & 7);
  const packed = lz77(planes);
  const palette = Array.from({length: 16}, (_, i) => ((i & 15) << 8) | ((15 - i) << 4) | 3);
  const file = Uint8Array.from([...be16(type), 0, 0, ...be16(packed.length), ...palette.flatMap(be16), ...packed]);
  const img = decodePlanarScreen(file);
  assert.deepEqual(img.indices, indices);
  assert.deepEqual(img.palette[2], [34, 221, 51, 255]);
  assert.equal(img.palette[0][3], 0);
  assert.throws(
    () => decodePlanarScreen(Uint8Array.from([...be16(4), 0, 0, ...be16(4), ...palette.flatMap(be16), 0, 1, 2, 3])),
    /unpacks to/,
  );
});

/** TIM builder. */
function tim(mode, words, height, data, clut) {
  const blockOf = (x, y, w, h, bytes) => [
    ...le32(12 + bytes.length),
    ...le16(x),
    ...le16(y),
    ...le16(w),
    ...le16(h),
    ...bytes,
  ];
  const out = [...le32(0x10), ...le32(mode | (clut ? 8 : 0))];
  if (clut) out.push(...blockOf(0, 480, clut.words, clut.rows, clut.bytes));
  out.push(...blockOf(320, 0, words, height, data));
  return Uint8Array.from(out);
}

test('legacy: TIM images in all four pixel modes, colour-table rows and zero transparency', () => {
  const rgb15 = (r, g, b, stp = 0) => r | (g << 5) | (b << 10) | (stp << 15);
  const clutRows = [
    Array.from({length: 16}, (_, i) => (i === 0 ? 0 : rgb15(i, 31 - i, 2))),
    Array.from({length: 16}, (_, i) => rgb15(31, i, 0, 1)),
  ];
  const four = tim(0, 1, 2, [0x10, 0x32, 0x54, 0x76], {words: 16, rows: 2, bytes: clutRows.flat().flatMap(le16)});
  const a = decodeTim(four);
  assert.deepEqual([...a.image.indices], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(a.image.palette[0], [0, 0, 0, 0]);
  assert.deepEqual(a.image.palette[1], [8, 247, 16, 255]);
  assert.equal(decodeTim(four, {clutRow: 1}).image.palette[0][0], 255);
  assert.deepEqual(a.meta.clut.rows[1][3], clutRows[1][3]);
  assert.throws(() => decodeTim(four, {clutRow: 2}), /outside/);
  const eight = tim(1, 1, 1, [9, 200], {
    words: 256,
    rows: 1,
    bytes: Array.from({length: 256}, (_, i) => rgb15(i & 31, 0, 0)).flatMap(le16),
  });
  assert.deepEqual([...decodeTim(eight).image.indices], [9, 200]);
  const direct = decodeTim(tim(2, 2, 1, [...le16(rgb15(31, 0, 0)), ...le16(0)]));
  assert.deepEqual([...direct.image.rgba], [255, 0, 0, 255, 0, 0, 0, 0]);
  assert.deepEqual([...decodeTim(tim(2, 1, 1, le16(0)), {opaque: true}).image.rgba], [0, 0, 0, 255]);
  const rgb24 = decodeTim(tim(3, 3, 1, [1, 2, 3, 4, 5, 6]));
  assert.deepEqual([...rgb24.image.rgba], [1, 2, 3, 255, 4, 5, 6, 255]);
  assert.throws(() => decodeTim(tim(1, 1, 1, [0, 0])), /without a colour table/);
});

test('legacy: SPU ADPCM frames decode with the five filters, loop flags and a WAV container', () => {
  const frame = (shift, filter, flags, nibbles) => {
    const b = [shift | (filter << 4), flags];
    for (let i = 0; i < 28; i += 2) b.push((nibbles[i] & 15) | ((nibbles[i + 1] & 15) << 4));
    return b;
  };
  const n1 = Array.from({length: 28}, (_, i) => [1, 7, 8, 15][i % 4]); // +1, +7, −8, −1
  const data = Uint8Array.from([...frame(0, 0, 4, n1), ...frame(2, 1, 3, Array(28).fill(0))]);
  const {samples, loop} = decodeSpuAdpcm(data);
  assert.deepEqual([...samples.subarray(0, 4)], [4096, 28672, -32768, -4096]);
  // filter 1: s = 0 + (60·h1 + 32) >> 6, starting from h1 = last sample of frame 0
  let h1 = samples[27];
  for (let i = 28; i < 32; i++) {
    h1 = Math.max(-32768, Math.min(32767, (60 * h1 + 32) >> 6));
    assert.equal(samples[i], h1);
  }
  assert.deepEqual(loop, {start: 0, end: 56});
  const name = Buffer.alloc(16);
  name.write('test tone');
  const vag = Uint8Array.from([
    ...Buffer.from('VAGp'),
    ...be32(3),
    ...be32(0),
    ...be32(data.length),
    ...be32(22050),
    ...Array(12).fill(0),
    ...name,
    ...data,
  ]);
  const {wav, meta} = decodeVag(vag);
  assert.equal(meta.name, 'test tone');
  assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.equal(wav.readInt16LE(44 + 2), 28672);
  assert.throws(() => decodeVag(data), /needs --rate/);
  assert.equal(decodeVag(data, {rate: 8000}).meta.samples, 56);
});

/** A movie with one 8-bit packed bitmap, one 1-bit bitmap and a CLUT member. */
function movie(little) {
  const tag = t => [...(little ? [...Buffer.from(t, 'latin1')].reverse() : Buffer.from(t, 'latin1'))];
  const u16 = little ? le16 : be16,
    u32 = little ? le32 : be32;
  const castBitmap = (w, h, pitch, depth, paletteRef) => {
    const spec = [
      ...u16(pitch | 0x8000),
      ...u16(0),
      ...u16(0),
      ...u16(h),
      ...u16(w),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...u16(1),
      ...u16(2),
      0,
      depth,
      0xff,
      0xff,
      ...u16(paletteRef),
    ];
    return [...u32(1), ...u32(0), ...u32(spec.length), ...spec];
  };
  const castClut = [...u32(4), ...u32(0), ...u32(0)];
  const pixels8 = [5, 6, 7, 7, 7, 7, 7, 7]; // 4 × 2, pitch 4
  const bitd8 = [0x01, 5, 6, 0xfb, 7]; // two literals, six repeats: shorter than the image, so it is unpacked
  const bitd1 = [0b10100000, 0b01000000]; // 3 × 2, pitch 1 (stored flat)
  const clut = [];
  for (let i = 0; i < 256; i++) clut.push(...u16(i << 8), ...u16((255 - i) << 8), ...u16(0x1234));
  const chunks = [
    ['CASt', castBitmap(4, 2, 4, 8, 3)],
    ['BITD', bitd8],
    ['CASt', castClut],
    ['CLUT', clut],
    ['CASt', castBitmap(3, 2, 1, 1, 0)],
    ['BITD', bitd1],
  ];
  // resources: 0 = mmap placeholder, 1 KEY*, 2 CAS*, 3.. chunks
  const key = [
    ...u16(12),
    ...u16(12),
    ...u32(3),
    ...u32(3),
    ...u32(4),
    ...u32(3),
    ...tag('BITD'),
    ...u32(6),
    ...u32(5),
    ...tag('CLUT'),
    ...u32(8),
    ...u32(7),
    ...tag('BITD'),
  ];
  const cas = [...u32(3), ...u32(0), ...u32(5), ...u32(7)]; // slot 1 bitmap, 2 empty, 3 clut, 4 one-bit
  const all = [['KEY*', key], ['CAS*', cas], ...chunks];
  const mmapEntries = 1 + all.length;
  const mmapSize = 24 + mmapEntries * 20;
  const mmapAt = 12 + 16;
  let at = mmapAt + 8 + mmapSize;
  const entries = [[...tag('mmap'), ...u32(mmapSize), ...u32(mmapAt), 0, 0, 0, 0, 0, 0, 0, 0]];
  const bodies = [];
  for (const [t, body] of all) {
    entries.push([...tag(t), ...u32(body.length), ...u32(at), 0, 0, 0, 0, 0, 0, 0, 0]);
    bodies.push(...tag(t), ...u32(body.length), ...body);
    at += 8 + body.length;
  }
  const imap = [...tag('imap'), ...u32(8), ...u32(1), ...u32(mmapAt)];
  const mmap = [
    ...tag('mmap'),
    ...u32(mmapSize),
    ...u16(24),
    ...u16(20),
    ...u32(mmapEntries),
    ...u32(mmapEntries),
    ...Array(12).fill(0),
    ...entries.flat(),
  ];
  const head = [...tag('RIFX'), ...u32(0), ...tag('MV93')];
  return {bytes: Uint8Array.from([...head, ...imap, ...mmap, ...bodies]), pixels8};
}

test('legacy: movie bitmaps decode in both byte orders with packed rows, 1-bit pixels and the referenced CLUT', () => {
  assert.deepEqual([...unpackBits(Uint8Array.from([0x80, 9]), 200).bytes.subarray(0, 129)], Array(129).fill(9));
  for (const little of [false, true]) {
    const {bytes, pixels8} = movie(little);
    const m = readMovie(bytes);
    assert.deepEqual(
      m.members.map(x => x.number),
      [1, 3, 4],
    );
    const a = decodeCastBitmap(m, 1);
    assert.deepEqual([...a.image.indices], pixels8);
    assert.equal(a.meta.palette, 'member 3');
    assert.deepEqual(a.image.palette[5], [5, 250, 0x12, 255]); // the high byte of each 16-bit value, in either byte order
    assert.deepEqual(a.meta.registration, [2, 1]);
    const b = decodeCastBitmap(m, 4);
    assert.deepEqual([...b.image.indices], [0, 255, 0, 255, 0, 255]);
    assert.throws(() => decodeCastBitmap(m, 3), /not a bitmap/);
  }
});

/** A QuickTime movie with two Cinepak frames: a V1 key frame and an inter frame recoding one block with V4. */
function cinepakMovie() {
  const atom = (type, ...parts) => {
    const body = parts.flatMap(p => (Array.isArray(p) ? p : [...p]));
    return [...be32(8 + body.length), ...Buffer.from(type, 'latin1'), ...body];
  };
  const w = 8,
    h = 4;
  const entry = (y, u, v) => [...y, u & 255, v & 255];
  const v1 = [entry([10, 20, 30, 40], 0, 0), entry([100, 100, 100, 100], 10, -10)];
  const v1Chunk = [...be16(0x2200), ...be16(4 + v1.flat().length), ...v1.flat()];
  const vec = [...be16(0x3200), ...be16(4 + 2), 0, 1];
  const strip = (body, height) => [
    ...be16(0x1000),
    ...be16(12 + body.length),
    ...be16(0),
    ...be16(0),
    ...be16(height),
    ...be16(w),
    ...body,
  ];
  const frame = (flags, strips) => {
    const s = strips.flat();
    return [flags, 0, ...be16(10 + s.length), ...be16(w), ...be16(h), ...be16(strips.length), ...s];
  };
  const key = frame(0, [strip([...v1Chunk, ...vec], 4)]);
  const v4 = entry([200, 0, 50, 250], -20, 20);
  const v4Chunk = [...be16(0x2000), ...be16(4 + 6), ...v4];
  // skip flags + V4 selector: block 0 skipped (0), block 1 coded (1) with V4 (1): bits 0,1,1 → 0x60000000
  const inter = [...be16(0x3100), ...be16(4 + 4 + 4), ...be32(0x60000000), 0, 0, 0, 0];
  const second = frame(1, [strip([...v4Chunk, ...inter], 4)]);
  const mdat = [...key, ...second];
  const mdatAt = 8; // after the mdat header at the start of the file
  const stsdEntry = [
    ...be32(86),
    ...Buffer.from('cvid'),
    ...Array(6).fill(0),
    ...be16(1),
    ...Array(16).fill(0),
    ...be16(w),
    ...be16(h),
    ...Array(50).fill(0),
  ];
  const stbl = atom(
    'stbl',
    atom('stsd', be32(0), be32(1), stsdEntry),
    atom('stsz', be32(0), be32(0), be32(2), be32(key.length), be32(second.length)),
    atom('stsc', be32(0), be32(1), be32(1), be32(2), be32(1)),
    atom('stco', be32(0), be32(1), be32(mdatAt)),
    atom('stss', be32(0), be32(1), be32(1)),
  );
  const moov = atom(
    'moov',
    atom(
      'trak',
      atom(
        'mdia',
        atom('hdlr', be32(0), Buffer.from('mhlr'), Buffer.from('vide'), Array(12).fill(0)),
        atom('minf', stbl),
      ),
    ),
  );
  return Uint8Array.from([...atom('mdat', mdat), ...moov]);
}
const yuv = (y, u, v) => [
  Math.min(255, Math.max(0, y + 2 * v)),
  Math.min(255, Math.max(0, Math.trunc(y - u / 2 - v))),
  Math.min(255, Math.max(0, y + 2 * u)),
  255,
];

test('legacy: Cinepak frames decode from a QuickTime sample table, V1 upscaling, V4 quadrants and inter frames', () => {
  const file = cinepakMovie();
  const qt = readQuickTime(file);
  assert.deepEqual([qt.codec, qt.width, qt.height, qt.samples.map(s => s.sync)], ['cvid', 8, 4, [true, false]]);
  const f0 = decodeMovieFrame(file, 0).image;
  const px = (img, x, y) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
  assert.deepEqual(px(f0, 0, 0), yuv(10, 0, 0));
  assert.deepEqual(px(f0, 3, 3), yuv(40, 0, 0));
  assert.deepEqual(px(f0, 2, 1), yuv(20, 0, 0));
  assert.deepEqual(px(f0, 5, 2), yuv(100, 10, -10));
  const f1 = decodeMovieFrame(file, 1);
  assert.equal(f1.meta.keyFrame, 0);
  assert.deepEqual(px(f1.image, 0, 0), yuv(10, 0, 0), 'the skipped block keeps the key frame');
  assert.deepEqual(px(f1.image, 4, 0), yuv(200, -20, 20));
  assert.deepEqual(px(f1.image, 5, 1), yuv(250, -20, 20));
  assert.throws(
    () => createCinepak(8, 4).decode(Uint8Array.from([1, 0, 0, 10, 0, 8, 0, 4, 0, 0])),
    /inter frame before any key frame/,
  );
});

// ---- bombs and fuzz ---------------------------------------------------------------------------------------------
test('legacy: declared sizes bound every decompressor (no bombs)', () => {
  const zeros = Buffer.alloc(1 << 20);
  const bomb = archive2([{name: 'a', data: new Uint8Array(16), zlib: false}]);
  // rewrite the member as zlib data that inflates to 1 MiB while declaring 16 bytes
  const z = [...deflateSync(zeros)];
  const fake = Uint8Array.from([
    ...z,
    ...le32(1),
    1,
    0,
    0,
    0,
    'a'.charCodeAt(0),
    1,
    ...le32(16),
    ...le32(z.length),
    ...le32(0),
  ]);
  const dirLen = fake.length - z.length;
  const withTrailer = Uint8Array.from([...fake, ...le32(dirLen), ...le32(fake.length + 8)]);
  assert.throws(
    () => extractMember(withTrailer, readArchive(withTrailer), 'a'),
    /larger than its declared|inflates to/,
  );
  assert.ok(bomb.length > 0);
  assert.throws(() => decodeLzssBlocks(new Uint8Array(4), 2 ** 40), /outside/);
  // a long run of repeats against a small allowance
  const many = Uint8Array.from([
    0xff,
    ...Array(8)
      .fill(0)
      .flatMap(() => be16(((0x22 - 34) << 11) | 1)),
  ]);
  assert.throws(
    () => decodeLz77(Uint8Array.from([0x00, 1, 2, 3, 4, 5, 6, 7, 8, ...many]), {maxOutput: 100}),
    /exceeds 100/,
  );
  assert.throws(
    () =>
      decodeTim(
        Uint8Array.from([
          ...le32(0x10),
          ...le32(2),
          ...le32(12 + 2),
          ...le16(0),
          ...le16(0),
          ...le16(4000),
          ...le16(4000),
          0,
          0,
        ]),
      ),
    /frame buffer/,
  );
  assert.throws(() => createCinepak(1 << 13, 1 << 13), /not allowed/);
  assert.throws(() => decodeSpuAdpcm(new Uint8Array(16 * 10), {maxSamples: 100}), /more than 100/);
  void inflateSync;
});

test('legacy: mutated fixtures only ever produce a result or an Error, quickly', () => {
  const pal = Array.from({length: 256}, (_, i) => [i, i, i, 255]);
  const fixtures = [
    [
      'archive1',
      archive1([{name: 'x.bin', data: Uint8Array.from({length: 600}, (_, i) => i % 9), lzss: true}]),
      b => extractMember(b, readArchive(b), 'art\\sprites\\x.bin'),
    ],
    [
      'archive2',
      archive2([{name: 'x', data: new Uint8Array(500).fill(3), zlib: true}]),
      b => extractMember(b, readArchive(b), 'x'),
    ],
    ['frames', frameSet(), b => decodeFrameSet(b, pal)],
    [
      'planar',
      (() => {
        const packed = lz77(new Uint8Array(8000).fill(0x55));
        return Uint8Array.from([...be16(1), 0, 0, ...be16(packed.length), 0, 0, 0x0f, 0xff, ...packed]);
      })(),
      b => decodePlanarScreen(b),
    ],
    ['tim', tim(0, 1, 2, [0x10, 0x32, 0x54, 0x76], {words: 16, rows: 1, bytes: Array(32).fill(1)}), b => decodeTim(b)],
    [
      'vag',
      Uint8Array.from([
        ...Buffer.from('VAGp'),
        ...Array(8).fill(0),
        ...be32(32),
        ...be32(8000),
        ...Array(28).fill(0),
        ...Array(32).fill(0x31),
      ]),
      b => decodeVag(b),
    ],
    ['director', movie(false).bytes, b => decodeCastBitmap(readMovie(b), 1)],
    ['cinepak', cinepakMovie(), b => decodeMovieFrame(b, 1)],
  ];
  const r = lcg(2026);
  for (const [name, base, run] of fixtures) {
    run(base); // the fixture itself decodes
    const started = Date.now();
    for (let i = 0; i < 400; i++) {
      const b = Uint8Array.from(base);
      const edits = 1 + Math.floor(r() * 4);
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(r() * b.length);
        b[at] = r() < 0.3 ? 0xff : Math.floor(r() * 256);
      }
      const cut = r() < 0.2 ? b.subarray(0, Math.floor(r() * b.length)) : b;
      try {
        run(cut);
      } catch (error) {
        assert.ok(error instanceof Error, `${name}: threw a non-Error`);
        assert.doesNotMatch(
          String(error.message),
          /Invalid array length|Array buffer allocation|Maximum call stack/,
          `${name}: ${error.message}`,
        );
      }
    }
    assert.ok(Date.now() - started < 20000, `${name} fuzz took ${Date.now() - started} ms`);
  }
});

test('legacy: the CLI lists containers, writes sidecar metadata and a receipt that passes the provenance check', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'legacy-'));
  try {
    const pal = new Uint8Array(768);
    for (let i = 0; i < 256; i++) pal.set([i >> 2, i >> 2, i >> 2], i * 3);
    writeFileSync(join(dir, 'color.pal'), pal);
    writeFileSync(join(dir, 'hero.frm'), frameSet());
    writeFileSync(join(dir, 'pack.dat'), archive2([{name: 'hero.frm', data: frameSet(), zlib: true}]));
    const listed = convert(parseArgs(['archive', 'pack.dat', '--list']), dir);
    assert.deepEqual(
      listed.list.members.map(m => m.name),
      ['hero.frm'],
    );
    convert(parseArgs(['archive', 'pack.dat', 'out/hero.frm', '--member', 'HERO.FRM', '--no-provenance']), dir);
    assert.deepEqual(readFileSync(join(dir, 'out/hero.frm')), Buffer.from(frameSet()));
    const r = convert(
      parseArgs([
        'frames',
        'out/hero.frm',
        'game/public/sprites/hero.png',
        '--palette',
        'color.pal',
        '--six-bit',
        '--author',
        'Test',
        '--licence',
        'CC0-1.0',
      ]),
      dir,
    );
    assert.ok(existsSync(r.meta));
    assert.equal(JSON.parse(readFileSync(r.meta, 'utf8')).fps, 12);
    const receipt = JSON.parse(readFileSync(r.receipt, 'utf8'));
    assert.deepEqual(
      receipt.inputs.map(i => i.path),
      ['out/hero.frm', 'color.pal'],
    );
    assert.deepEqual(
      readProvenance(join(dir, 'game')).assets.map(a => a.problems),
      [[]],
    );
    assert.throws(() => convert(parseArgs(['tim', 'hero.frm', 'x.png', '--no-provenance']), dir), /not a TIM/);
    assert.throws(
      () => convert(parseArgs(['vag', 'hero.frm', 'x.png', '--no-provenance', '--rate', '8000']), dir),
      /converts to .wav/,
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ---- external oracle (runs only where ffmpeg is installed; nothing from it is committed) --------------------------
const ffmpeg = spawnSync('ffmpeg', ['-hide_banner', '-version'], {encoding: 'utf8'}).status === 0;

test(
  'legacy oracle: Cinepak frames from an independent encoder match an independent decoder within 1 level',
  {skip: !ffmpeg && 'ffmpeg not installed'},
  () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'cvid-'));
    try {
      const mov = join(dir, 'c.mov'),
        raw = join(dir, 'c.rgba');
      const run = args =>
        assert.equal(
          spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]).status,
          0,
          args.join(' '),
        );
      run(['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10', '-frames:v', '12', '-c:v', 'cinepak', '-f', 'mov', mov]);
      run(['-i', mov, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
      const bytes = new Uint8Array(readFileSync(mov)),
        ref = readFileSync(raw);
      const size = 96 * 64 * 4;
      assert.equal(ref.length, size * 12);
      for (let f = 0; f < 12; f++) {
        const {image} = decodeMovieFrame(bytes, f);
        let worst = 0;
        for (let i = 0; i < size; i++)
          if (i % 4 !== 3) worst = Math.max(worst, Math.abs(image.rgba[i] - ref[f * size + i]));
        assert.ok(worst <= 1, `frame ${f}: worst channel difference ${worst}`); // chroma halving rounds differently
      }
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  },
);

test(
  'legacy oracle: SPU ADPCM with truncated prediction equals an independent decoder sample for sample',
  {skip: !ffmpeg && 'ffmpeg not installed'},
  () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vag-'));
    try {
      const r = lcg(7);
      const body = new Uint8Array(400 * 16);
      for (let f = 0; f < 400; f++) {
        body[f * 16] = Math.floor(r() * 13) | (Math.floor(r() * 5) << 4);
        for (let i = 2; i < 16; i++) body[f * 16 + i] = Math.floor(r() * 256);
      }
      const vag = Uint8Array.from([
        ...Buffer.from('VAGp'),
        ...be32(32),
        ...be32(0),
        ...be32(body.length),
        ...be32(22050),
        ...Array(28).fill(0),
        ...body,
      ]);
      writeFileSync(join(dir, 't.vag'), vag);
      assert.equal(
        spawnSync('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'vag',
          '-i',
          join(dir, 't.vag'),
          '-f',
          's16le',
          join(dir, 't.pcm'),
        ]).status,
        0,
      );
      const ref = readFileSync(join(dir, 't.pcm'));
      const {wav, meta} = decodeVag(vag, {prediction: 'truncated'});
      assert.equal(meta.samples, ref.length / 2);
      assert.ok(wav.subarray(44).equals(ref));
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  },
);

test('legacy review regressions: bounded walk-back, pitch, block over-reads, size plausibility, names and CLI', () => {
  // L1: a literal flag after a block-ending match never reads the next block's descriptor
  assert.throws(
    () => decodeLzssBlocks(Uint8Array.from([0, 3, 0x02, 0xee, 0x00, 0xff, 0xfe, 0x41, 0x42]), 6),
    LZSS_REFUSAL,
  );
  // L2: a declared size the input cannot encode is refused before allocating
  assert.throws(() => decodeLzssBlocks(new Uint8Array(4), 1 << 20), /input bytes can encode/);
  assert.equal(decodeLz77(Uint8Array.from([0x00, 65])).length, 1);
  // L4: chained `.\` segments and directory names ending in a separator
  assert.equal(readArchive(archive2([{name: 'a\\.\\.\\b', data: Uint8Array.of(1)}])).members[0].name, 'a\\b');
  // M2: a row pitch far wider than the image is refused before unpacking
  const {bytes} = movie(false);
  const m = readMovie(bytes);
  m.members[0].pitch = 32767;
  assert.throws(() => decodeCastBitmap(m, 1), /far wider/);
  // M1: a frame far from any key frame is refused, not decoded thousands of times
  const file = cinepakMovie();
  assert.throws(() => decodeMovieFrame(file, 1, {maxDecoded: 1}), /more than 1 frames after its key frame/);
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'legacy-cli-'));
  try {
    writeFileSync(join(dir, 'a.dat'), archive2([{name: 'x', data: Uint8Array.of(1)}]));
    assert.throws(() => parseArgs(['archive', 'a.dat', 'out.bin', '--list']), /no output/);
    // a stale sidecar is removed when the new conversion writes none
    writeFileSync(join(dir, 'x.meta.json'), '{"stale":true}');
    convert(parseArgs(['archive', 'a.dat', 'x.bin', '--member', 'x', '--no-provenance']), dir);
    assert.equal(existsSync(join(dir, 'x.meta.json')), false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
