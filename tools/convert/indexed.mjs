// tools/convert/indexed.mjs: palette (indexed-colour) images to PNG. Readers for PCX (ZSoft's published format: 8-bit
// single-plane with a trailing 256-colour palette, or 8-bit 3/4-plane true colour), BMP (Windows bitmap: 1/4/8-bit
// palettised, optionally RLE8/RLE4, and 24/32-bit), and raw index bytes with a separate palette (raw RGB triplets,
// 6-bit VGA triplets, JASC-PAL or GIMP .gpl text). Indexed sources stay indexed (PNG colour type 3) unless asked
// otherwise, so the palette survives for palette-swap effects. Independent implementations.
import {encodeIndexed, encodeRgba} from './png.mjs';

const MAX_PIXELS = 1 << 26; // 64 Mpx: a refusal, not a resize

function checkSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw Error(`bad image size ${width}x${height}`);
  if (width > 32768 || height > 32768 || width * height > MAX_PIXELS)
    throw Error(`image ${width}x${height} exceeds the limits`);
}

/** Palette from a file: raw 768-byte RGB (or `sixBit` VGA values 0..63), JASC-PAL or GIMP palette text. */
export function readPalette(bytes, {sixBit = false} = {}) {
  const text = Buffer.from(bytes).toString('latin1');
  if (text.startsWith('JASC-PAL')) {
    const lines = text.split(/\r?\n/).map(l => l.trim());
    const count = Number(lines[2]);
    if (!Number.isInteger(count) || count < 1 || count > 256) throw Error('JASC-PAL colour count must be 1..256');
    return lines.slice(3, 3 + count).map((l, i) => {
      const c = l.split(/\s+/).map(Number);
      if (c.length < 3 || c.some(v => !Number.isInteger(v) || v < 0 || v > 255))
        throw Error(`JASC-PAL entry ${i} is not three 0..255 values`);
      return [c[0], c[1], c[2], 255];
    });
  }
  if (text.startsWith('GIMP Palette')) {
    const out = [];
    for (const l of text.split(/\r?\n/).slice(1)) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)/.exec(l);
      if (m) out.push([+m[1], +m[2], +m[3], 255]);
    }
    if (out.length < 1 || out.length > 256 || out.flat().some(v => v > 255))
      throw Error('GIMP palette must have 1..256 colours of 0..255');
    return out;
  }
  if (bytes.length % 3 || bytes.length < 3 || bytes.length > 768)
    throw Error('a raw palette is 3..768 bytes of RGB triplets');
  const out = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const c = [bytes[i], bytes[i + 1], bytes[i + 2]];
    if (sixBit) {
      if (c.some(v => v > 63)) throw Error(`6-bit palette entry ${i / 3} has a value above 63`);
      for (let k = 0; k < 3; k++) c[k] = (c[k] << 2) | (c[k] >> 4); // 0..63 → 0..255, endpoints exact
    }
    out.push([...c, 255]);
  }
  return out;
}

/** PCX → {width, height, indices, palette} or {width, height, rgba}. */
export function decodePcx(bytes) {
  if (bytes.length < 128 || bytes[0] !== 0x0a) throw Error('not a PCX file');
  const encoding = bytes[2],
    bpp = bytes[3];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const xmin = dv.getUint16(4, true),
    ymin = dv.getUint16(6, true),
    xmax = dv.getUint16(8, true),
    ymax = dv.getUint16(10, true);
  const planes = bytes[65],
    bytesPerLine = dv.getUint16(66, true);
  const width = xmax - xmin + 1,
    height = ymax - ymin + 1;
  checkSize(width, height);
  if (bpp !== 8 || ![1, 3, 4].includes(planes))
    throw Error(`PCX with ${bpp} bits × ${planes} planes is not supported (8-bit 1, 3 or 4 planes)`);
  if (bytesPerLine < width || bytesPerLine > width + 8)
    throw Error(`PCX bytes per line ${bytesPerLine} does not fit width ${width}`);
  // RLE expands at most 63 times: a header that claims more pixels than the file can hold is refused before allocating.
  if (bytesPerLine * planes * height > (bytes.length - 128) * 63)
    throw Error('PCX header claims more data than the file holds');
  const scan = new Uint8Array(bytesPerLine * planes * height);
  let at = 128,
    o = 0;
  while (o < scan.length) {
    if (at >= bytes.length) throw Error('PCX image data ends early');
    let b = bytes[at++];
    let run = 1;
    if (encoding === 1 && (b & 0xc0) === 0xc0) {
      run = b & 0x3f;
      if (at >= bytes.length) throw Error('PCX run ends early');
      b = bytes[at++];
    }
    for (let k = 0; k < run && o < scan.length; k++) scan[o++] = b;
  }
  const line = bytesPerLine * planes;
  if (planes === 1) {
    const tail = bytes.length - 769;
    if (tail < at || bytes[tail] !== 0x0c) throw Error('8-bit PCX has no trailing 256-colour palette');
    const palette = [];
    for (let i = 0; i < 256; i++)
      palette.push([bytes[tail + 1 + i * 3], bytes[tail + 2 + i * 3], bytes[tail + 3 + i * 3], 255]);
    const indices = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) indices.set(scan.subarray(y * line, y * line + width), y * width);
    return {width, height, indices, palette};
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++)
        rgba[(y * width + x) * 4 + c] = c < planes ? scan[y * line + c * bytesPerLine + x] : 255;
  return {width, height, rgba};
}

/** BMP → {width, height, indices, palette} or {width, height, rgba}. */
export function decodeBmp(bytes) {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw Error('not a BMP file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataOffset = dv.getUint32(10, true),
    headerSize = dv.getUint32(14, true);
  if (headerSize < 40) throw Error('OS/2 BMP headers are not supported');
  const width = dv.getInt32(18, true),
    rawHeight = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true),
    compression = dv.getUint32(30, true);
  const height = Math.abs(rawHeight),
    topDown = rawHeight < 0;
  checkSize(width, height);
  if (![1, 4, 8, 24, 32].includes(bpp)) throw Error(`BMP with ${bpp} bits per pixel is not supported`);
  const rle = compression === 1 || compression === 2;
  if (!(
    compression === 0 ||
    (compression === 1 && bpp === 8) ||
    (compression === 2 && bpp === 4) ||
    (compression === 3 && bpp === 32)
  ))
    throw Error(`BMP compression ${compression} with ${bpp} bits is not supported`);
  const rowOf = y => (topDown ? y : height - 1 - y);
  if (bpp <= 8) {
    let colours = dv.getUint32(46, true) || 1 << bpp;
    if (colours > 1 << bpp) throw Error('BMP palette is larger than its bit depth allows');
    const palAt = 14 + headerSize;
    if (palAt + colours * 4 > bytes.length) throw Error('BMP palette ends early');
    const palette = [];
    for (let i = 0; i < colours; i++)
      palette.push([bytes[palAt + i * 4 + 2], bytes[palAt + i * 4 + 1], bytes[palAt + i * 4], 255]);
    const indices = new Uint8Array(width * height);
    if (rle) decodeRle(bytes, dataOffset, width, height, bpp, (x, y, v) => (indices[rowOf(y) * width + x] = v));
    else {
      const stride = Math.ceil((width * bpp) / 32) * 4;
      if (dataOffset + stride * height > bytes.length) throw Error('BMP pixel data ends early');
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const bit = x * bpp,
            byte = bytes[dataOffset + y * stride + (bit >> 3)];
          indices[rowOf(y) * width + x] = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        }
    }
    for (const i of indices)
      if (i >= colours) throw Error(`BMP pixel uses index ${i} beyond its ${colours}-colour palette`);
    return {width, height, indices, palette};
  }
  const stride = Math.ceil((width * bpp) / 32) * 4;
  if (dataOffset + stride * height > bytes.length) throw Error('BMP pixel data ends early');
  const rgba = new Uint8Array(width * height * 4);
  // Byte positions of R, G, B (and A) in a pixel: BGR(A) by default; BI_BITFIELDS masks when given, which must each
  // select one whole byte (other masks, such as 5-6-5 or 10-bit channels, are refused rather than misread).
  let order = [2, 1, 0],
    alphaAt = -1;
  if (compression === 3) {
    if (54 + 12 > bytes.length) throw Error('BMP colour masks end early');
    const masks = [0, 4, 8].map(k => dv.getUint32(54 + k, true));
    const alphaMask = headerSize >= 56 ? dv.getUint32(54 + 12, true) : 0;
    const byteOf = m => [0xff, 0xff00, 0xff0000, 0xff000000].indexOf(m >>> 0);
    order = masks.map(byteOf);
    if (order.some(b => b < 0)) throw Error('BMP colour masks that are not whole bytes are not supported');
    if (alphaMask) {
      alphaAt = byteOf(alphaMask);
      if (alphaAt < 0) throw Error('BMP alpha mask is not a whole byte');
    }
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = dataOffset + y * stride + x * (bpp / 8),
        d = (rowOf(y) * width + x) * 4;
      rgba[d] = bytes[s + order[0]];
      rgba[d + 1] = bytes[s + order[1]];
      rgba[d + 2] = bytes[s + order[2]];
      rgba[d + 3] = alphaAt >= 0 ? bytes[s + alphaAt] : 255;
    }
  return {width, height, rgba};
}

/** RLE8/RLE4 (bottom-up rows; y here counts stored rows). */
function decodeRle(bytes, at, width, height, bpp, put) {
  let x = 0,
    y = 0;
  const need = n => {
    if (at + n > bytes.length) throw Error('BMP RLE data ends early');
  };
  const set = v => {
    if (x < width && y < height) put(x, y, v);
    x++;
  };
  for (;;) {
    need(2);
    const count = bytes[at++],
      value = bytes[at++];
    if (count > 0) {
      for (let k = 0; k < count; k++) set(bpp === 8 ? value : k & 1 ? value & 15 : value >> 4);
    } else if (value === 0) {
      x = 0;
      y++;
    } else if (value === 1) return;
    else if (value === 2) {
      need(2);
      x += bytes[at++];
      y += bytes[at++];
    } else {
      const n = value,
        len = bpp === 8 ? n : Math.ceil(n / 2);
      need(len);
      for (let k = 0; k < n; k++)
        set(bpp === 8 ? bytes[at + k] : k & 1 ? bytes[at + (k >> 1)] & 15 : bytes[at + (k >> 1)] >> 4);
      at += len + (len & 1); // runs are word aligned
    }
    if (y > height) throw Error('BMP RLE data runs past the image');
  }
}

/** Raw index bytes (one byte per pixel, top row first) with a palette. */
export function decodeRaw(bytes, {width, height, palette}) {
  checkSize(width, height);
  if (bytes.length !== width * height)
    throw Error(`raw data has ${bytes.length} bytes; ${width}x${height} needs exactly ${width * height}`);
  return {width, height, indices: Uint8Array.from(bytes.subarray(0, width * height)), palette};
}

/**
 * Encode a decoded image as PNG. Options: transparent (palette index made fully transparent), output ('indexed' keeps
 * the palette; 'rgba' expands it).
 */
export function imageToPng(image, {transparent = null, output = 'indexed'} = {}) {
  if (!['indexed', 'rgba'].includes(output)) throw Error('output must be indexed or rgba');
  if (!image.indices && transparent !== null) throw Error('--transparent applies to palette images only');
  if (!image.indices)
    return {
      png: encodeRgba(image.width, image.height, image.rgba),
      summary: {width: image.width, height: image.height, colourType: 'rgba'},
    };
  const palette = image.palette.map(c => [...c]);
  if (transparent !== null) {
    if (!Number.isInteger(transparent) || transparent < 0 || transparent >= palette.length)
      throw Error(`transparent index ${transparent} is outside the palette`);
    palette[transparent][3] = 0;
  }
  for (const i of image.indices)
    if (i >= palette.length) throw Error(`pixel index ${i} is beyond the ${palette.length}-colour palette`);
  const summary = {width: image.width, height: image.height, colours: palette.length, colourType: output};
  if (output === 'indexed') return {png: encodeIndexed(image.width, image.height, image.indices, palette), summary};
  const rgba = new Uint8Array(image.width * image.height * 4);
  image.indices.forEach((i, p) => rgba.set(palette[i], p * 4));
  return {png: encodeRgba(image.width, image.height, rgba), summary};
}
