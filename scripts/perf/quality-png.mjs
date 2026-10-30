// Dependency-free PNG codec for Chromium's 8-bit RGB/RGBA screenshots. Reject unsupported/corrupt evidence.
import {deflateSync, inflateSync} from 'node:zlib';
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const type = Buffer.from(name),
    out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length);
  type.copy(out, 4);
  bytes.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([type, bytes])), bytes.length + 8);
  return out;
}
function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 40_000_000)
    throw Error('PNG dimensions must be positive integers, at most 40 million pixels');
}
export function encodePng({width, height, data}) {
  dimensions(width, height);
  if (data.length !== width * height * 4) throw Error('RGBA byte length does not match dimensions');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    Buffer.from(data.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function decodePng(input) {
  const bytes = Buffer.from(input);
  if (!bytes.subarray(0, 8).equals(signature)) throw Error('Invalid PNG signature');
  let offset = 8,
    header,
    ended = false,
    idatEnded = false;
  const parts = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw Error('Truncated PNG chunk');
    const size = bytes.readUInt32BE(offset),
      end = offset + 12 + size;
    if (end > bytes.length) throw Error('Truncated PNG payload');
    const type = bytes.toString('ascii', offset + 4, offset + 8),
      data = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
      throw Error(`PNG CRC mismatch: ${type}`);
    if (!header && type !== 'IHDR') throw Error('PNG must start with IHDR');
    if (type === 'IHDR') {
      if (header || size !== 13) throw Error('Invalid PNG IHDR');
      header = {width: data.readUInt32BE(0), height: data.readUInt32BE(4), channels: data[9] === 2 ? 3 : 4};
      dimensions(header.width, header.height);
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12])
        throw Error('Unsupported PNG: require non-interlaced 8-bit RGB/RGBA');
    } else if (type === 'IDAT') {
      if (idatEnded) throw Error('Non-contiguous PNG IDAT');
      parts.push(data);
    } else if (type === 'IEND') {
      if (size || !parts.length || end !== bytes.length) throw Error('Invalid PNG IEND');
      ended = true;
      break;
    } else {
      if (parts.length) idatEnded = true;
      if (type === 'tRNS' || (type[0] === type[0].toUpperCase() && type !== 'PLTE'))
        throw Error(`Unsupported PNG chunk: ${type}`);
    }
    offset = end;
  }
  if (!ended) throw Error('Missing PNG IEND');
  const {width, height, channels} = header,
    stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts), {maxOutputLength: (stride + 1) * height});
  if (raw.length !== (stride + 1) * height) throw Error('PNG scanline length mismatch');
  const scan = Buffer.alloc(stride * height),
    rgba = Buffer.alloc(width * height * 4, 255);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      x = Math.abs(p - a),
      y = Math.abs(p - b),
      z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error(`Invalid PNG filter ${filter}`);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x,
        a = x >= channels ? scan[i - channels] : 0,
        b = y ? scan[i - stride] : 0,
        c = y && x >= channels ? scan[i - stride - channels] : 0;
      scan[i] = raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
    }
  }
  for (let p = 0; p < width * height; p++) for (let c = 0; c < channels; c++) rgba[p * 4 + c] = scan[p * channels + c];
  return {width, height, data: rgba};
}
export function comparePixels(base, head, mode) {
  if (!['identical', 'near', 'reviewed'].includes(mode)) throw Error(`Unknown quality guard mode: ${mode}`);
  if (base.width !== head.width || base.height !== head.height)
    throw Error(`Image dimensions differ: ${base.width}×${base.height} vs ${head.width}×${head.height}`);
  dimensions(base.width, base.height);
  const pixels = base.width * base.height;
  if (base.data.length !== pixels * 4 || head.data.length !== pixels * 4) throw Error('Incomplete RGBA evidence');
  const diff = Buffer.alloc(pixels * 4);
  let different = 0,
    beyondTolerance = 0,
    maxChannelDelta = 0;
  for (let p = 0; p < pixels; p++) {
    let delta = 0;
    for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(base.data[p * 4 + c] - head.data[p * 4 + c]));
    if (delta) different++;
    if (delta > 2) beyondTolerance++;
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    diff[p * 4] = delta ? 255 : 0;
    diff[p * 4 + 1] = delta && delta <= 2 ? 160 : 0;
    diff[p * 4 + 3] = 255;
  }
  const limit = mode === 'near' ? Math.floor(pixels / 1000) : 0;
  return {
    mode,
    pixels,
    different,
    beyondTolerance,
    maxChannelDelta,
    limit,
    pass: mode === 'identical' ? different === 0 : mode === 'near' ? beyondTolerance <= limit : false,
    diff: {width: base.width, height: base.height, data: diff},
  };
}
