// tools/convert/lzss.mjs: two small dictionary decompressors used by 1990s game data, written independently from the
// format descriptions that community reconstructions document (see README "Legacy formats").
//
//   decodeLzssBlocks  blocks of a 16-bit big-endian length: positive = that many bytes of LZSS (4,096-byte ring
//                     filled with spaces, writes start at 4,078, flag byte read LSB first with 1 = literal, a match is
//                     a 12-bit absolute ring position and a 4-bit length + 3), negative = that many stored bytes,
//                     zero = end
//   decodeLz77        flag byte read MSB first with 1 = back reference; a reference is a 16-bit big-endian word whose
//                     top 5 bits give 34 − length and low 11 bits the distance back into the output
//
// Both take the exact output size from their container and stop with an error rather than produce more: a hostile
// stream cannot grow the output past what the caller allowed (no decompression bombs).

/** LZSS blocks to exactly `size` bytes (the container's declared uncompressed size). */
export function decodeLzssBlocks(input, size, {maxOutput = 1 << 28} = {}) {
  if (!Number.isSafeInteger(size) || size < 0 || size > maxOutput)
    throw Error(`LZSS output size ${size} is outside 0..${maxOutput}`);
  // At most 18 output bytes per 2 input bytes (plus stored bytes 1:1): a size beyond that cannot be honest.
  if (size > input.length * 9 + 18)
    throw Error(`LZSS output size ${size} is more than ${input.length} input bytes can encode`);
  const out = new Uint8Array(size);
  let o = 0,
    p = 0;
  const N = 4096,
    F = 18;
  while (o < size) {
    if (p + 2 > input.length) throw Error(`LZSS stream ends after ${o} of ${size} bytes`);
    const descr = (input[p] << 8) | input[p + 1];
    p += 2;
    const signed = descr & 0x8000 ? descr - 0x10000 : descr;
    if (signed === 0) throw Error(`LZSS end marker after ${o} of ${size} bytes`);
    const length = Math.abs(signed);
    if (p + length > input.length) throw Error('LZSS block runs past the input');
    if (signed < 0) {
      if (o + length > size) throw Error('LZSS stored block exceeds the declared size');
      out.set(input.subarray(p, p + length), o);
      o += length;
      p += length;
      continue;
    }
    // One compressed block of `length` input bytes; the ring is fresh for every block.
    const blockStart = o;
    const ring = new Uint8Array(N + F).fill(0x20);
    let r = N - F,
      read = 0,
      flags = 0;
    const end = p + length;
    const put = b => {
      if (o >= size) throw Error('LZSS data exceeds the declared size');
      out[o++] = b;
      ring[r] = b;
      r = (r + 1) & (N - 1);
    };
    for (;;) {
      flags >>>= 1;
      if ((flags & 0x100) === 0) {
        if (read >= length) break;
        flags = input[p + read++] | 0xff00;
        if (read >= length) break;
      }
      if (flags & 1) {
        if (read >= length) break; // never read past the block, even if flag bits remain
        put(input[p + read++]);
        if (read >= length) break;
      } else {
        if (read >= length) break;
        const lo = input[p + read++];
        if (read >= length) break;
        const hi = input[p + read++];
        const at = lo | ((hi & 0xf0) << 4),
          count = (hi & 0x0f) + 3;
        for (let k = 0; k < count; k++) put(ring[(at + k) & (N - 1)]);
      }
    }
    if (o === blockStart) throw Error('LZSS block produces no output');
    p = end;
  }
  return out;
}

/** LZ77 with MSB-first flags over `input[0..length)`, at most `maxOutput` bytes out. */
export function decodeLz77(input, {length = input.length, maxOutput = 1 << 24} = {}) {
  if (length > input.length) throw Error(`LZ77 stream claims ${length} bytes; ${input.length} present`);
  const out = new Uint8Array(Math.min(maxOutput, length * 17 + 8)); // at most 34 bytes per 2-byte reference
  maxOutput = out.length;
  let o = 0,
    p = 0;
  while (p < length) {
    const flags = input[p++];
    for (let bit = 7; bit >= 0 && p < length; bit--) {
      if ((flags >> bit) & 1) {
        if (p + 2 > length) throw Error('LZ77 reference runs past the input');
        const word = (input[p] << 8) | input[p + 1];
        p += 2;
        const count = 0x22 - (word >> 11),
          distance = word & 0x7ff;
        if (distance > o) throw Error(`LZ77 reference ${distance} back from position ${o}`);
        if (distance === 0) continue; // copies nothing, as the reference decoder does
        if (o + count > maxOutput) throw Error(`LZ77 output exceeds ${maxOutput} bytes`);
        for (let k = 0; k < count; k++, o++) out[o] = out[o - distance];
      } else {
        if (o >= maxOutput) throw Error(`LZ77 output exceeds ${maxOutput} bytes`);
        out[o++] = input[p++];
      }
    }
  }
  return out.slice(0, o);
}
