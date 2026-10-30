// tools/convert/sprites.mjs: two palette sprite formats of 1990s games, decoded to the indexed images the `image`
// path already writes as PNG. Independent implementations of what community reconstructions document:
//
//   frame sets (big-endian): u32 version, u16 frames per second (0 means 10), u16 action frame, u16 frames per
//     direction, six i16 centre x, six i16 centre y, six u32 offsets of each direction's frames (relative to the end
//     of the 62-byte header; equal offsets share frames), u32 data size; each frame is i16 width, i16 height, u32
//     size, i16 shift x, i16 shift y and width·height palette indices (index 0 is transparent)
//   planar screens: u16 type (log2 of the colour count), u16 reserved, u16 packed length, 2^type big-endian
//     12-bit colours (0x0RGB), then LZ77 data that unpacks to `type` bit planes of 8,000 bytes (320 × 200, MSB is the
//     leftmost pixel); colour 0 is transparent
//
// A 6-bit VGA palette (768 bytes of 0..63 components, optionally followed by a 32,768-byte reverse table, which is
// ignored) is read by readVgaPalette; components above 63 mark an unmapped entry, which becomes transparent black.
import {decodeLz77} from './lzss.mjs';

const MAX_PIXELS = 1 << 24;

/** A 6-bit VGA palette (768 bytes or more) as [r, g, b, a] entries; unmapped entries are transparent black. */
export function readVgaPalette(bytes) {
  if (bytes.length < 768) throw Error('a 6-bit VGA palette needs 768 bytes');
  const out = [];
  for (let i = 0; i < 256; i++) {
    const c = [bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2]];
    out.push(c.some(v => v > 63) ? [0, 0, 0, 0] : [...c.map(v => (v << 2) | (v >> 4)), 255]);
  }
  return out;
}

/**
 * A frame set to one indexed sprite sheet: one row per distinct direction, one column per frame, each cell as large
 * as the largest frame, frames placed top-left. Returns {image, meta}; meta lists fps, action frame, per-direction
 * centres and per-frame rectangles and shifts, so a game can rebuild the animation.
 */
export function decodeFrameSet(bytes, palette) {
  if (bytes.length < 62) throw Error('frame set shorter than its 62-byte header');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fps = v.getUint16(4) || 10,
    actionFrame = v.getUint16(6),
    perDirection = v.getUint16(8);
  if (perDirection === 0 || perDirection > 1024) throw Error(`frames per direction ${perDirection} is outside 1..1024`);
  const centres = [0, 1, 2, 3, 4, 5].map(d => [v.getInt16(10 + d * 2), v.getInt16(22 + d * 2)]);
  const offsets = [0, 1, 2, 3, 4, 5].map(d => v.getUint32(34 + d * 4));
  const distinct = [...new Set(offsets)];
  const directions = distinct.map(off => {
    let at = 62 + off;
    const frames = [];
    for (let f = 0; f < perDirection; f++) {
      if (at + 12 > bytes.length) throw Error(`frame ${f} header lies outside the file`);
      const w = v.getInt16(at),
        h = v.getInt16(at + 2),
        shift = [v.getInt16(at + 8), v.getInt16(at + 10)];
      if (w < 0 || h < 0 || w * h > MAX_PIXELS) throw Error(`frame ${f} size ${w}x${h} is not allowed`);
      if (at + 12 + w * h > bytes.length) throw Error(`frame ${f} pixels run past the file`);
      frames.push({w, h, shift, pixels: bytes.subarray(at + 12, at + 12 + w * h)});
      at += 12 + w * h;
    }
    return frames;
  });
  const cellW = Math.max(1, ...directions.flat().map(f => f.w)),
    cellH = Math.max(1, ...directions.flat().map(f => f.h));
  const width = cellW * perDirection,
    height = cellH * directions.length;
  if (width > 32768 || height > 32768 || width * height > MAX_PIXELS)
    throw Error(`sprite sheet ${width}x${height} exceeds the limits`);
  const indices = new Uint8Array(width * height);
  const rects = [];
  directions.forEach((frames, row) =>
    frames.forEach((f, col) => {
      for (let y = 0; y < f.h; y++)
        indices.set(f.pixels.subarray(y * f.w, (y + 1) * f.w), (row * cellH + y) * width + col * cellW);
      rects.push({row, col, x: col * cellW, y: row * cellH, w: f.w, h: f.h, shift: f.shift});
    }),
  );
  const pal = palette.map(c => [...c]);
  pal[0] = [pal[0][0], pal[0][1], pal[0][2], 0];
  return {
    image: {width, height, indices, palette: pal},
    meta: {
      fps,
      actionFrame,
      framesPerDirection: perDirection,
      directionRow: offsets.map(o => distinct.indexOf(o)),
      centres,
      frames: rects,
    },
  };
}

/** A planar 320 × 200 screen with its embedded 12-bit palette to an indexed image. */
export function decodePlanarScreen(bytes) {
  if (bytes.length < 6) throw Error('planar screen shorter than its header');
  const type = (bytes[0] << 8) | bytes[1],
    packed = (bytes[4] << 8) | bytes[5];
  if (type < 1 || type > 8) throw Error(`plane count ${type} is outside 1..8`);
  const colours = 1 << type;
  const palEnd = 6 + colours * 2;
  if (palEnd > bytes.length) throw Error('palette runs past the file');
  const palette = [];
  for (let i = 0; i < colours; i++) {
    const word = ((bytes[6 + i * 2] << 8) | bytes[7 + i * 2]) & 0x0fff;
    const nib = s => ((word >> s) & 15) * 17; // 4-bit to 8-bit with exact endpoints
    palette.push([nib(8), nib(4), nib(0), i === 0 ? 0 : 255]);
  }
  const PLANE = 8000;
  const data = decodeLz77(bytes.subarray(palEnd), {
    length: Math.min(packed, bytes.length - palEnd),
    maxOutput: PLANE * type,
  });
  if (data.length < PLANE * type) throw Error(`planar data unpacks to ${data.length} bytes; ${PLANE * type} needed`);
  const indices = new Uint8Array(64000);
  for (let p = 0; p < 64000; p++) {
    const byte = p >> 3,
      bit = 7 - (p & 7);
    let index = 0;
    for (let j = 0; j < type; j++) index |= ((data[j * PLANE + byte] >> bit) & 1) << j;
    indices[p] = index;
  }
  return {width: 320, height: 200, indices, palette};
}
