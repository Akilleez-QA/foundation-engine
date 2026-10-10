// tools/convert/png.mjs: a minimal PNG encoder (RGBA8 or palette-indexed with transparency), written from the PNG
// specification (ISO/IEC 15948). Filter type 0 on every row and zlib from node:zlib, so the bytes depend only on the
// pixels and on the zlib build bundled with Node.
import {deflateSync} from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ihdr(width, height, depth, colourType) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 32768 ||
    height > 32768
  )
    throw Error(`image size ${width}x${height} is outside 1..32768`);
  const h = Buffer.alloc(13);
  h.writeUInt32BE(width, 0);
  h.writeUInt32BE(height, 4);
  h[8] = depth;
  h[9] = colourType;
  return chunk('IHDR', h);
}
function idat(rows, rowBytes, height) {
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) rows(y, raw, y * (rowBytes + 1) + 1); // byte 0 of each row is filter 0
  return chunk('IDAT', deflateSync(raw, {level: 9}));
}

/** PNG bytes of 8-bit RGBA pixels (width·height·4 bytes, top row first). */
export function encodeRgba(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw Error('RGBA length does not match the size');
  return Buffer.concat([
    SIGNATURE,
    ihdr(width, height, 8, 6),
    idat((y, out, at) => out.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), at), width * 4, height),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * PNG bytes of 8-bit palette indices (top row first). `palette` is [r, g, b, a] per entry (1..256 entries); trailing
 * opaque entries are left out of tRNS, and tRNS is omitted when every entry is opaque.
 */
export function encodeIndexed(width, height, indices, palette) {
  if (indices.length !== width * height) throw Error('index length does not match the size');
  if (palette.length < 1 || palette.length > 256) throw Error('a palette has 1..256 entries');
  for (let i = 0; i < indices.length; i++)
    if (indices[i] >= palette.length)
      throw Error(`pixel ${i} uses index ${indices[i]} beyond the ${palette.length}-entry palette`);
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach(([r, g, b], i) => plte.set([r, g, b], i * 3));
  let alphaCount = 0;
  palette.forEach(([, , , a], i) => {
    if (a !== 255) alphaCount = i + 1;
  });
  const parts = [SIGNATURE, ihdr(width, height, 8, 3), chunk('PLTE', plte)];
  if (alphaCount) parts.push(chunk('tRNS', Uint8Array.from(palette.slice(0, alphaCount).map(p => p[3]))));
  parts.push(
    idat((y, out, at) => out.set(indices.subarray(y * width, (y + 1) * width), at), width, height),
    chunk('IEND', new Uint8Array(0)),
  );
  return Buffer.concat(parts);
}
