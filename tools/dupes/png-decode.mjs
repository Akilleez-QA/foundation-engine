// tools/dupes/png-decode.mjs: a small PNG decoder (ISO/IEC 15948) to RGBA8 for the image comparison: every colour type,
// bit depths 1–16, all five row filters and Adam7 interlacing. Returns null for anything it cannot decode (an
// unsupported or corrupt file is skipped by the scan, never fatal). Bounds: 2^26 pixels.
import {inflateSync} from 'node:zlib';

const MAX_PIXELS = 1 << 26;
const CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4};
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

export function decodePng(bytes) {
  try {
    return decode(bytes);
  } catch {
    return null;
  }
}

function decode(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((v, i) => bytes[i] !== v)) return null;
  let at = 8,
    width = 0,
    height = 0,
    depth = 0,
    type = 0,
    interlace = 0,
    palette = null,
    trns = null;
  const idat = [];
  while (at + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(at),
      name = bytes.toString('latin1', at + 4, at + 8);
    if (at + 12 + len > bytes.length) return null;
    const data = bytes.subarray(at + 8, at + 8 + len);
    if (name === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    at += 12 + len;
  }
  if (!width || !height || width * height > MAX_PIXELS || !CHANNELS[type] || ![1, 2, 4, 8, 16].includes(depth))
    return null;
  if (type === 3 && !palette) return null;
  const channels = CHANNELS[type],
    bitsPerPixel = channels * depth,
    bpp = Math.max(1, bitsPerPixel >> 3);
  // The exact size of the filtered data: anything that inflates further is refused (no decompression bombs).
  let expected = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((width - x0) / dx),
      ph = Math.ceil((height - y0) / dy);
    if (pw > 0 && ph > 0) expected += ph * (1 + Math.ceil((pw * bitsPerPixel) / 8));
  }
  const raw = inflateSync(Buffer.concat(idat), {maxOutputLength: expected});
  const rgba = new Uint8Array(width * height * 4);
  let offset = 0;
  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx),
      ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPerPixel) / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      if (offset + 1 + stride > raw.length) return null;
      const filter = raw[offset],
        line = Uint8Array.from(raw.subarray(offset + 1, offset + 1 + stride));
      offset += 1 + stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0,
          b = prev[i],
          c = i >= bpp ? prev[i - bpp] : 0;
        let p;
        if (filter === 0) p = 0;
        else if (filter === 1) p = a;
        else if (filter === 2) p = b;
        else if (filter === 3) p = (a + b) >> 1;
        else if (filter === 4) {
          const q = a + b - c,
            pa = Math.abs(q - a),
            pb = Math.abs(q - b),
            pc = Math.abs(q - c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        } else return null;
        line[i] = (line[i] + p) & 255;
      }
      for (let x = 0; x < pw; x++) {
        const sample = k => {
          if (depth === 16) return line[(x * channels + k) * 2];
          if (depth === 8) return line[x * channels + k];
          const bit = (x * channels + k) * depth;
          const v = (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
          return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
        };
        const o = ((y0 + y * dy) * width + (x0 + x * dx)) * 4;
        let r, g, bl, al;
        if (type === 3) {
          const i = sample(0);
          if (i * 3 + 2 >= palette.length) return null;
          [r, g, bl] = [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]];
          al = trns && i < trns.length ? trns[i] : 255;
        } else if (type === 0 || type === 4) {
          r = g = bl = sample(0);
          al = type === 4 ? sample(1) : 255;
        } else {
          r = sample(0);
          g = sample(1);
          bl = sample(2);
          al = type === 6 ? sample(3) : 255;
        }
        rgba.set([r, g, bl, al], o);
      }
      prev = line;
    }
  }
  return {width, height, rgba};
}
