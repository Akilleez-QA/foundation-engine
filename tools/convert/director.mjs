// tools/convert/director.mjs: bitmap cast members of 1990s multimedia-authoring movies ("RIFX" big-endian, "XFIR"
// little-endian with reversed tags). Independent implementation of what community reconstructions document:
//
//   file: tag, u32 size, form type; at 0x18 the offset of the resource map ("mmap": u32 size, u16 header length,
//     u16 entry length, u32 capacity, u32 used, then from 24 bytes past the chunk header `used` 20-byte entries of
//     tag, u32 size, u32 offset, u16 flags, i16 unused, u32 link)
//   "KEY*": u16 header length, u16 entry length, u32 capacity, u32 used, entries of u32 child, u32 owner, tag —
//     which chunk (BITD, CLUT, …) belongs to which cast member resource
//   "CAS*": u32 per cast slot, the resource index of its "CASt" record (0 = empty)
//   "CASt": either u32 kind, u32 info length, u32 data length, info, data (later layout) or u16 data length,
//     u32 info length, data (whose first byte is the kind), info (earlier layout); a bitmap's data starts u16 pitch
//     (top bit a flag), i16 top, left, bottom, right, then at 0x12 the registration y and x, at 0x17 the bit depth and
//     a palette member reference at 0x1a (later) or 0x18 (earlier)
//   "BITD": rows of `pitch` bytes, PackBits-like (n < 0x80: n + 1 literals; n ≥ 0x80: 0x101 − n repeats) unless the
//     payload already holds the whole image; 1-bit pixels map to index 0 (set, black) or 255 (clear, white)
//   "CLUT": 6 bytes per colour, the high byte of each 16-bit component
//
// Only 1/2/4/8-bit bitmaps are decoded. The authoring tool's built-in system palettes are not included: a member
// whose palette reference is not a CLUT in the file needs --palette, or uses a grey ramp with a warning.

const MAX_PIXELS = 1 << 24;

function view(bytes, little) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (at, n) => {
    if (!Number.isInteger(at) || at < 0 || at + n > bytes.length) throw Error(`movie data ends early at byte ${at}`);
  };
  return {
    u16: at => (check(at, 2), d.getUint16(at, little)),
    i16: at => (check(at, 2), d.getInt16(at, little)),
    u32: at => (check(at, 4), d.getUint32(at, little)),
    tag(at) {
      check(at, 4);
      const t = Buffer.from(bytes.subarray(at, at + 4)).toString('latin1');
      return little ? [...t].reverse().join('') : t;
    },
  };
}

/** Parse a movie's resource map, key table and cast table. */
export function readMovie(bytes) {
  const magic = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (magic !== 'RIFX' && magic !== 'XFIR') throw Error('not a RIFX/XFIR movie');
  const little = magic === 'XFIR';
  const r = view(bytes, little);
  const mmap = r.u32(0x18);
  if (r.tag(mmap) !== 'mmap') throw Error('the resource map is missing');
  const used = r.u32(mmap + 16);
  if (used > 1 << 20) throw Error(`resource map lists ${used} entries`);
  const resources = [];
  for (let i = 0; i < used; i++) {
    const e = mmap + 8 + 24 + i * 20;
    resources.push({tag: r.tag(e), size: r.u32(e + 4), offset: r.u32(e + 8)});
  }
  const data = index => {
    const res = resources[index];
    if (!res) throw Error(`resource ${index} does not exist`);
    const start = res.offset + 8;
    if (start + res.size > bytes.length) throw Error(`resource ${index} (${res.tag}) lies outside the file`);
    return bytes.subarray(start, start + res.size);
  };
  const find = tag => resources.findIndex(x => x.tag === tag);
  const keyAt = find('KEY*'),
    casAt = find('CAS*');
  if (keyAt < 0 || casAt < 0) throw Error('the key table or cast table is missing');
  const key = data(keyAt),
    k = view(key, little);
  const headerLen = k.u16(0),
    entryLen = k.u16(2),
    keyUsed = k.u32(8);
  if (entryLen < 12 || keyUsed > 1 << 20) throw Error('key table header is implausible');
  const children = new Map(); // `${owner}/${tag}` → child resource
  for (let i = 0; i < keyUsed; i++) {
    const e = headerLen + i * entryLen;
    const id = `${k.u32(e + 4)}/${k.tag(e + 8)}`;
    if (!children.has(id)) children.set(id, k.u32(e));
  }
  const cas = data(casAt),
    c = view(cas, little);
  const members = [];
  for (let slot = 0; slot < Math.floor(cas.length / 4); slot++) {
    const res = c.u32(slot * 4);
    if (!res) continue;
    try {
      members.push({number: slot + 1, resource: res, ...castMember(data(res), little)});
    } catch {
      members.push({number: slot + 1, resource: res, kind: 0});
    }
  }
  return {little, resources, members, data, child: (owner, tag) => children.get(`${owner}/${tag}`)};
}

function castMember(cd, little) {
  const r = view(cd, little);
  let kind, spec, paletteAt;
  if (cd.length >= 12 && cd.length === 12 + r.u32(4) + r.u32(8)) {
    kind = r.u32(0);
    spec = cd.subarray(12 + r.u32(4));
    paletteAt = 0x1a;
  } else if (cd.length >= 6 && cd.length === 6 + r.u16(0) + r.u32(2)) {
    spec = cd.subarray(8, 6 + r.u16(0));
    kind = cd[6];
    paletteAt = 0x18;
  } else throw Error('cast record matches neither layout');
  const m = {kind};
  if (kind === 1 && spec.length >= 10) {
    const s = view(spec, little);
    m.pitch = s.u16(0) & 0x7fff;
    const top = s.i16(2),
      left = s.i16(4),
      bottom = s.i16(6),
      right = s.i16(8);
    m.width = Math.max(0, right - left);
    m.height = Math.max(0, bottom - top);
    m.registration = spec.length >= 0x16 ? [s.i16(0x14) - left, s.i16(0x12) - top] : [0, 0];
    m.depth = spec.length >= 0x18 ? spec[0x17] : 0;
    m.palette = spec.length >= paletteAt + 2 ? s.i16(paletteAt) : 0;
    if (m.depth === 0 && m.width > 0) m.depth = m.pitch >= m.width ? 8 : 1;
  }
  return m;
}

/** PackBits-like unpacking to exactly `want` bytes (short input leaves the rest unfilled and is reported). */
export function unpackBits(src, want) {
  const out = new Uint8Array(want);
  let o = 0,
    p = 0;
  while (p < src.length && o < want) {
    const n = src[p++];
    if (n < 0x80) {
      const count = Math.min(n + 1, want - o, src.length - p);
      out.set(src.subarray(p, p + count), o);
      o += count;
      p += n + 1;
    } else {
      if (p >= src.length) break;
      const b = src[p++];
      const count = Math.min(0x101 - n, want - o);
      out.fill(b, o, o + count);
      o += count;
    }
  }
  return {bytes: out, filled: o};
}

/** CLUT chunk to [r, g, b, a] entries (at most 256). */
export function readClut(d, little) {
  const out = [];
  for (let i = 0; i < Math.min(256, Math.floor(d.length / 6)); i++) {
    const comp = k => (little ? d[i * 6 + k * 2 + 1] : d[i * 6 + k * 2]);
    out.push([comp(0), comp(1), comp(2), 255]);
  }
  return out;
}

/**
 * One bitmap member to an indexed image. Palette: `palette` if given, else the member's referenced CLUT, else the
 * first CLUT in the file, else a grey ramp (meta.palette says which). `transparent` makes one index transparent.
 */
export function decodeCastBitmap(movie, number, {palette = null} = {}) {
  const m = movie.members.find(x => x.number === number);
  if (!m) throw Error(`no cast member ${number}`);
  if (m.kind !== 1) throw Error(`cast member ${number} is not a bitmap (kind ${m.kind})`);
  const {width, height, depth} = m;
  if (!width || !height || width * height > MAX_PIXELS)
    throw Error(`bitmap ${number} size ${width}x${height} is not allowed`);
  if (![1, 2, 4, 8].includes(depth))
    throw Error(`bitmap ${number} has ${depth}-bit pixels; 1, 2, 4 and 8 are supported`);
  const minStride = Math.ceil((width * depth) / 8);
  const stride = Math.max(m.pitch, minStride);
  if (stride > minStride + 16)
    throw Error(`bitmap ${number} row pitch ${m.pitch} is far wider than its ${width} pixels`);
  const childIndex = movie.child(m.resource, 'BITD');
  if (childIndex === undefined) throw Error(`bitmap ${number} has no pixel data`);
  const raw = movie.data(childIndex);
  const want = stride * height;
  let packed;
  if (raw.length >= want) packed = raw.subarray(0, want);
  else {
    const u = unpackBits(raw, want);
    if (u.filled < want) throw Error(`bitmap ${number} pixel data unpacks to ${u.filled} of ${want} bytes`);
    packed = u.bytes;
  }
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const row = y * stride;
      let v;
      if (depth === 8) v = packed[row + x];
      else {
        const per = 8 / depth,
          byte = packed[row + Math.floor(x / per)],
          shift = 8 - depth * ((x % per) + 1);
        v = (byte >> shift) & ((1 << depth) - 1);
        if (depth === 1) v = v ? 0x00 : 0xff; // a set bit is black (index 0), a clear bit white (index 255)
      }
      indices[y * width + x] = v;
    }
  let pal = palette,
    source = 'given';
  if (!pal) {
    const ref = m.palette > 0 ? movie.members.find(x => x.number === m.palette) : null;
    const refClut = ref ? movie.child(ref.resource, 'CLUT') : undefined;
    const first = movie.resources.findIndex(x => x.tag === 'CLUT');
    if (refClut !== undefined) {
      pal = readClut(movie.data(refClut), movie.little);
      source = `member ${m.palette}`;
    } else if (depth === 1) {
      pal = Array.from({length: 256}, (_, i) => (i === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
      source = '1-bit';
    } else if (first >= 0) {
      pal = readClut(movie.data(first), movie.little);
      source = 'first CLUT in the file';
    } else {
      pal = Array.from({length: 256}, (_, i) => [i, i, i, 255]);
      source = 'grey ramp (no palette found; pass --palette)';
    }
  }
  while (pal.length < 256) pal = [...pal, [pal.length, pal.length, pal.length, 255]]; // a short table keeps the grey ramp
  return {
    image: {width, height, indices, palette: pal.slice(0, 256)},
    meta: {member: number, registration: m.registration, depth, palette: source},
  };
}
