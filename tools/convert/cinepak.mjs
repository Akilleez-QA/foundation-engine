// tools/convert/cinepak.mjs: frames of Cinepak ("cvid") video in QuickTime movies, decoded to RGBA images.
// The QuickTime container is read from its published file-format description (atoms: moov/trak/mdia/minf/stbl with
// stsd, stsz, stsc, stco/co64, stss); the codec independently from what community reconstructions document:
//
//   frame: u8 flags (bit 0 set = inter frame), u24 size, u16 width, u16 height, u16 strip count, then strips of
//     u16 id, u16 size (with its 12-byte header), u16 top, left, bottom, right; strips stack downward by height, and
//     on a key frame each strip after the first starts from the previous strip's codebooks
//   chunks in a strip: u16 id, u16 size (with its 4-byte header). 0x2000-series ids load a codebook (0x0200 = V1,
//     else V4; 0x0100 = partial update with 32-bit selection masks, MSB first; 0x0400 = 4-byte luma-only entries,
//     else 6 bytes: four luma, signed U, signed V). 0x3000-series ids code 4×4 blocks in raster order (0x0100 = a
//     per-block "coded" flag; 0x0200 = all blocks V1, otherwise a flag picks V4); flags come from 32-bit words read
//     MSB first, interleaved with the index bytes
//   V1: one entry's 2×2 luma upscaled over the block; V4: four entries, one per 2×2 quadrant
//   colour: r = y + 2v, g = y − u/2 − v, b = y + 2u, clamped to 0..255 and truncated

const MAX_PIXELS = 1 << 24;

// ---- QuickTime --------------------------------------------------------------------------------------------------
function atoms(b, start, end) {
  const out = [];
  let at = start;
  while (at + 8 <= end) {
    let size = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      const big = b.readBigUInt64BE(at + 8);
      if (big > BigInt(end - at)) throw Error(`atom ${type} runs past its parent`);
      size = Number(big);
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) throw Error(`atom ${type} at ${at} runs past its parent`);
    out.push({type, start: at + header, end: at + size});
    at += size;
  }
  return out;
}
const child = (b, a, type) => atoms(b, a.start, a.end).find(x => x.type === type);

/** The first video track's sample table: {codec, width, height, samples: [{offset, size, sync}]}. */
export function readQuickTime(bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = atoms(b, 0, b.length).find(a => a.type === 'moov');
  if (!moov) throw Error('no movie atom (moov)');
  for (const trak of atoms(b, moov.start, moov.end).filter(a => a.type === 'trak')) {
    const mdia = child(b, trak, 'mdia');
    const hdlr = mdia && child(b, mdia, 'hdlr');
    if (!hdlr || b.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue;
    const minf = child(b, mdia, 'minf'),
      stbl = minf && child(b, minf, 'stbl');
    if (!stbl) throw Error('video track without a sample table');
    const stsd = child(b, stbl, 'stsd');
    if (!stsd || stsd.end - stsd.start < 8 + 36) throw Error('missing sample description');
    const entry = stsd.start + 8;
    const codec = b.toString('latin1', entry + 4, entry + 8);
    const width = b.readUInt16BE(entry + 32),
      height = b.readUInt16BE(entry + 34);
    const stsz = child(b, stbl, 'stsz');
    if (!stsz) throw Error('missing sample sizes');
    const uniform = b.readUInt32BE(stsz.start + 4),
      count = b.readUInt32BE(stsz.start + 8);
    if (count > 1 << 20) throw Error(`${count} samples`);
    if (!uniform && stsz.start + 12 + count * 4 > stsz.end) throw Error('sample size table runs short');
    const sizes = Array.from({length: count}, (_, i) => uniform || b.readUInt32BE(stsz.start + 12 + i * 4));
    const stco = child(b, stbl, 'stco'),
      co64 = child(b, stbl, 'co64');
    const chunkCount = stco || co64 ? b.readUInt32BE((stco ?? co64).start + 4) : 0;
    if (!chunkCount || chunkCount > 1 << 20) throw Error('missing or implausible chunk offsets');
    const chunkOffsets = Array.from({length: chunkCount}, (_, i) =>
      stco ? b.readUInt32BE(stco.start + 8 + i * 4) : Number(b.readBigUInt64BE(co64.start + 8 + i * 8)),
    );
    const stsc = child(b, stbl, 'stsc');
    if (!stsc) throw Error('missing sample-to-chunk table');
    const runs = Array.from({length: b.readUInt32BE(stsc.start + 4)}, (_, i) => ({
      first: b.readUInt32BE(stsc.start + 8 + i * 12),
      per: b.readUInt32BE(stsc.start + 12 + i * 12),
    }));
    const stss = child(b, stbl, 'stss');
    const sync = stss
      ? new Set(
          Array.from({length: b.readUInt32BE(stss.start + 4)}, (_, i) => b.readUInt32BE(stss.start + 8 + i * 4) - 1),
        )
      : null;
    const samples = [];
    let s = 0;
    if (runs.length > chunkCount) throw Error('sample-to-chunk table is longer than the chunk table');
    let ri = -1;
    for (let c = 0; c < chunkCount && s < count; c++) {
      while (ri + 1 < runs.length && runs[ri + 1].first <= c + 1) ri++; // runs are in chunk order: one pass
      const run = runs[ri];
      if (!run || run.per === 0 || run.per > count) throw Error('sample-to-chunk table is inconsistent');
      let at = chunkOffsets[c];
      for (let k = 0; k < run.per && s < count; k++, s++) {
        if (at + sizes[s] > b.length) throw Error(`sample ${s} lies outside the file`);
        samples.push({offset: at, size: sizes[s], sync: sync ? sync.has(s) : true});
        at += sizes[s];
      }
    }
    if (samples.length !== count) throw Error(`chunk table places ${samples.length} of ${count} samples`);
    return {codec, width, height, samples};
  }
  throw Error('no video track');
}

// ---- Cinepak ----------------------------------------------------------------------------------------------------
const emptyBook = () => Array.from({length: 256}, () => ({y: [0, 0, 0, 0], u: 0, v: 0}));
const clamp = x => (x < 0 ? 0 : x > 255 ? 255 : x);

export function createCinepak(width, height) {
  if (!width || !height || width * height > MAX_PIXELS) throw Error(`frame ${width}x${height} is not allowed`);
  const state = {width, height, rgba: new Uint8Array(width * height * 4), strips: [], decoded: false};
  const put = (x, y, l, u, v) => {
    if (x >= state.width || y >= state.height) return;
    const o = (y * state.width + x) * 4;
    state.rgba[o] = clamp(l + 2 * v);
    state.rgba[o + 1] = clamp(l - (u >> 1) - v); // integer halving of the signed chroma
    state.rgba[o + 2] = clamp(l + 2 * u);
    state.rgba[o + 3] = 255;
  };
  function loadBook(book, d, lumaOnly, partial) {
    const stride = lumaOnly ? 4 : 6;
    const read = o => ({
      y: [d[o], d[o + 1], d[o + 2], d[o + 3]],
      u: lumaOnly ? 0 : (d[o + 4] << 24) >> 24,
      v: lumaOnly ? 0 : (d[o + 5] << 24) >> 24,
    });
    if (!partial) {
      for (let i = 0; i < Math.min(256, Math.floor(d.length / stride)); i++) book[i] = read(i * stride);
      return;
    }
    let off = 0,
      index = 0;
    while (index < 256 && off + 4 <= d.length) {
      const mask = ((d[off] << 24) | (d[off + 1] << 16) | (d[off + 2] << 8) | d[off + 3]) >>> 0;
      off += 4;
      for (let bit = 0; bit < 32 && index < 256; bit++, index++)
        if (mask & (0x80000000 >>> bit)) {
          if (off + stride > d.length) return;
          book[index] = read(off);
          off += stride;
        }
    }
  }
  function vectors(id, d, books, y0, y1) {
    const skip = (id & 0x0100) !== 0,
      v1Only = (id & 0x0200) !== 0;
    let cur = 0,
      flags = 0,
      mask = 0;
    const flag = () => {
      mask >>>= 1;
      if (mask === 0) {
        if (cur + 4 > d.length) return null;
        flags = ((d[cur] << 24) | (d[cur + 1] << 16) | (d[cur + 2] << 8) | d[cur + 3]) >>> 0;
        cur += 4;
        mask = 0x80000000;
      }
      return (flags & mask) !== 0;
    };
    for (let by = y0; by < y1; by += 4)
      for (let bx = 0; bx < state.width; bx += 4) {
        if (skip) {
          const f = flag();
          if (f === null) return;
          if (!f) continue;
        }
        let v4 = false;
        if (!v1Only) {
          const f = flag();
          if (f === null) return;
          v4 = f;
        }
        if (v4) {
          if (cur + 4 > d.length) return;
          for (let q = 0; q < 4; q++) {
            const e = books.v4[d[cur + q]];
            const qx = (q & 1) * 2,
              qy = (q >> 1) * 2;
            for (let dy = 0; dy < 2; dy++)
              for (let dx = 0; dx < 2; dx++) put(bx + qx + dx, by + qy + dy, e.y[dy * 2 + dx], e.u, e.v);
          }
          cur += 4;
        } else {
          if (cur >= d.length) return;
          const e = books.v1[d[cur++]];
          for (let qy = 0; qy < 2; qy++)
            for (let qx = 0; qx < 2; qx++)
              for (let dy = 0; dy < 2; dy++)
                for (let dx = 0; dx < 2; dx++) put(bx + qx * 2 + dx, by + qy * 2 + dy, e.y[qy * 2 + qx], e.u, e.v);
        }
      }
  }
  /** Decode one sample into the retained frame. */
  function decode(d) {
    if (d.length < 10) throw Error('Cinepak frame shorter than its header');
    const key = (d[0] & 1) === 0;
    const w = (d[4] << 8) | d[5],
      h = (d[6] << 8) | d[7],
      strips = (d[8] << 8) | d[9];
    if (w && h && (w !== state.width || h !== state.height)) {
      if (w * h > MAX_PIXELS) throw Error(`frame ${w}x${h} is not allowed`);
      Object.assign(state, {width: w, height: h, rgba: new Uint8Array(w * h * 4), decoded: false});
    }
    if (!key && !state.decoded) throw Error('an inter frame before any key frame');
    if (strips > 32) throw Error(`${strips} strips`);
    while (state.strips.length < strips) state.strips.push({v1: emptyBook(), v4: emptyBook()});
    let off = 10,
      y0 = 0;
    for (let s = 0; s < strips && off + 12 <= d.length; s++) {
      const len = (d[off + 2] << 8) | d[off + 3],
        top = (d[off + 4] << 8) | d[off + 5],
        bottom = (d[off + 8] << 8) | d[off + 9];
      const end = Math.min(off + Math.max(len, 12), d.length);
      const y1 = Math.min(y0 + Math.max(0, bottom - top), state.height);
      if (key && s > 0)
        state.strips[s] = {
          v1: state.strips[s - 1].v1.map(e => ({...e})),
          v4: state.strips[s - 1].v4.map(e => ({...e})),
        };
      const books = state.strips[s];
      let c = off + 12;
      while (c + 4 <= end) {
        const id = (d[c] << 8) | d[c + 1],
          clen = (d[c + 2] << 8) | d[c + 3];
        const bodyEnd = Math.min(c + Math.max(clen, 4), end);
        const body = d.subarray(c + 4, bodyEnd);
        if ((id & 0xf000) === 0x2000)
          loadBook(id & 0x0200 ? books.v1 : books.v4, body, (id & 0x0400) !== 0, (id & 0x0100) !== 0);
        else if ((id & 0xf000) === 0x3000) vectors(id, body, books, y0, y1);
        c = bodyEnd;
      }
      y0 = y1;
      off = end;
      if (y0 >= state.height) break;
    }
    state.decoded = true;
  }
  return {
    decode,
    get frame() {
      return {width: state.width, height: state.height, rgba: state.rgba};
    },
  };
}

/** Frame `index` of a Cinepak QuickTime movie, decoded forward from the nearest earlier key frame. */
export function decodeMovieFrame(bytes, index = 0, {maxDecoded = 4096} = {}) {
  const qt = readQuickTime(bytes);
  if (qt.codec !== 'cvid') throw Error(`video codec ${qt.codec} is not Cinepak (cvid)`);
  if (!Number.isInteger(index) || index < 0 || index >= qt.samples.length)
    throw Error(`frame ${index} is outside 0..${qt.samples.length - 1}`);
  let start = index;
  // Walk back to a key frame: the table's sync flag, or a frame whose own header says it is a key frame.
  const isKey = i => qt.samples[i].sync || (qt.samples[i].size > 0 && (bytes[qt.samples[i].offset] & 1) === 0);
  while (start > 0 && !isKey(start)) {
    start--;
    if (index - start >= maxDecoded)
      throw Error(`frame ${index} is more than ${maxDecoded} frames after its key frame`);
  }
  const dec = createCinepak(qt.width, qt.height);
  for (let i = start; i <= index; i++) {
    const s = qt.samples[i];
    dec.decode(bytes.subarray(s.offset, s.offset + s.size));
  }
  const {width, height, rgba} = dec.frame;
  return {
    image: {width, height, rgba: Uint8Array.from(rgba)},
    meta: {frame: index, frames: qt.samples.length, keyFrame: start},
  };
}
