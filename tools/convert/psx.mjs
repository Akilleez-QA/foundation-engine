// tools/convert/psx.mjs: two formats of a 1990s console's development kit, decoded independently from what community
// reconstructions document:
//
//   TIM images (little-endian): u32 id 0x10, u32 flags (bits 0–2 pixel mode: 0 = 4-bit, 1 = 8-bit indexed,
//     2 = 15-bit direct, 3 = 24-bit; bit 3 = a colour table follows); each block is u32 size (including its 12-byte
//     header), u16 x, u16 y, u16 width in 16-bit words, u16 height, then the data. Colours are 15-bit
//     (bits 0–4 red, 5–9 green, 10–14 blue, bit 15 the semi-transparency flag); the all-zero word is transparent.
//   VAG / SPU ADPCM sound: an optional 48-byte big-endian header ("VAGp", version, reserved, data size, sample rate,
//     reserved, 16-byte name), then 16-byte frames: shift (low nibble) and filter (high nibble), a flags byte
//     (bit 0 end, bit 1 repeat, bit 2 loop start) and 28 four-bit samples, low nibble first, predicted from the two
//     previous outputs with the five standard filter pairs. Two predictions exist in practice and differ by a few
//     least significant bits: 'rounded' (+32 before >> 6, clamped history; the hardware model of emulators and the
//     default) and 'truncated' (division toward zero, unclamped history; what common software decoders produce).
import {encodeWav} from './wav.mjs';

const u16 = (b, at) => b[at] | (b[at + 1] << 8);
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

function block(b, at) {
  if (at + 12 > b.length) throw Error('TIM block header runs past the file');
  const size = u32(b, at),
    words = u16(b, at + 8),
    height = u16(b, at + 10);
  if (size < 12 || at + size > b.length) throw Error('TIM block size runs past the file');
  if (words === 0 || height === 0 || words > 1024 || height > 512)
    throw Error(`TIM block ${words}x${height} words is outside the 1024 × 512 frame buffer`);
  if (words * height * 2 !== size - 12) throw Error('TIM block size disagrees with its dimensions');
  return {x: u16(b, at + 4), y: u16(b, at + 6), words, height, data: b.subarray(at + 12, at + size), end: at + size};
}
const expand = v => (v << 3) | (v >> 2);
const colour = (word, opaque) => [
  expand(word & 31),
  expand((word >> 5) & 31),
  expand((word >> 10) & 31),
  word === 0 && !opaque ? 0 : 255,
];

/**
 * A TIM to an image. Indexed modes stay indexed with the chosen colour-table row (`clutRow`, default 0); direct modes
 * give RGBA. `opaque` keeps the all-zero colour opaque black instead of transparent. meta records the frame-buffer
 * placement and every colour-table row as raw 16-bit words (the semi-transparency bit is game draw state).
 */
export function decodeTim(b, {clutRow = 0, opaque = false} = {}) {
  if (b.length < 8 || u32(b, 0) !== 0x10) throw Error('not a TIM (id 0x10)');
  const flags = u32(b, 4),
    mode = flags & 7;
  if (flags & ~0x0b || mode > 3) throw Error(`unsupported TIM flags ${flags.toString(16)}`);
  let at = 8;
  let rows = [];
  let clut = null;
  if (flags & 8) {
    if (mode > 1) throw Error('a colour table on a direct-colour TIM');
    clut = block(b, at);
    const colours = mode === 0 ? 16 : 256;
    if (clut.words % colours) throw Error('TIM colour table width is not a multiple of the colour count');
    for (let r = 0; r < (clut.words * clut.height) / colours; r++) {
      const row = [];
      for (let i = 0; i < colours; i++) row.push(u16(clut.data, (r * colours + i) * 2));
      rows.push(row);
    }
    at = clut.end;
  }
  if (mode < 2 && !rows.length) throw Error('an indexed TIM without a colour table (shared tables are not supported)');
  const img = block(b, at);
  const width = [img.words * 4, img.words * 2, img.words, Math.floor((img.words * 2) / 3)][mode];
  if (width === 0) throw Error('empty TIM image');
  const height = img.height,
    rowBytes = img.words * 2;
  const meta = {mode, x: img.x, y: img.y, clut: clut ? {x: clut.x, y: clut.y, rows} : null};
  if (mode < 2) {
    if (!Number.isInteger(clutRow) || clutRow < 0 || clutRow >= rows.length)
      throw Error(`colour table row ${clutRow} is outside 0..${rows.length - 1}`);
    const indices = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        indices[y * width + x] =
          mode === 0 ? (img.data[y * rowBytes + (x >> 1)] >> ((x & 1) * 4)) & 15 : img.data[y * rowBytes + x];
    return {image: {width, height, indices, palette: rows[clutRow].map(w => colour(w, opaque))}, meta};
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4,
        s = y * rowBytes;
      if (mode === 2) rgba.set(colour(u16(img.data, s + x * 2), opaque), o);
      else rgba.set([img.data[s + x * 3], img.data[s + x * 3 + 1], img.data[s + x * 3 + 2], 255], o);
    }
  return {image: {width, height, rgba}, meta};
}

const K0 = [0, 60, 115, 98, 122],
  K1 = [0, 0, -52, -55, -60];
/**
 * SPU ADPCM frames to 16-bit samples, stopping after the first frame flagged end (or at the data's end). Returns
 * {samples, loop: {start, end} | null}. Filter nibbles above 4 are clamped to 4; shifts apply as given.
 */
export function decodeSpuAdpcm(data, {maxSamples = 1 << 26, prediction = 'rounded'} = {}) {
  if (prediction !== 'rounded' && prediction !== 'truncated') throw Error(`prediction must be rounded or truncated`);
  const frames = Math.floor(data.length / 16);
  if (frames * 28 > maxSamples) throw Error(`more than ${maxSamples} samples`);
  const out = new Int16Array(frames * 28);
  let h1 = 0,
    h2 = 0,
    n = 0,
    loopStart = null,
    loop = null;
  for (let f = 0; f < frames; f++) {
    const at = f * 16,
      shift = data[at] & 15,
      filter = Math.min(4, data[at] >> 4), // larger filters are clamped, as the reference decoders do
      flags = data[at + 1];
    if (flags & 4) loopStart = n;
    for (let i = 0; i < 28; i++) {
      const nibble = (data[at + 2 + (i >> 1)] >> ((i & 1) * 4)) & 15;
      let s = ((nibble << 28) >> 16) >> shift; // the nibble as the top of a signed 16-bit value
      if (prediction === 'rounded') {
        // The sound processor as hardware emulators model it: rounded prediction, clamped history.
        s += (K0[filter] * h1 + K1[filter] * h2 + 32) >> 6;
        s = Math.max(-32768, Math.min(32767, s));
        h2 = h1;
        h1 = s;
        out[n++] = s;
      } else {
        // Common software decoders: prediction truncated toward zero, the unclamped sum kept as history.
        s += Math.trunc((K0[filter] * h1 + K1[filter] * h2) / 64);
        h2 = h1;
        h1 = s;
        out[n++] = Math.max(-32768, Math.min(32767, s));
      }
    }
    if (flags & 1) {
      if (flags & 2) loop = {start: loopStart ?? 0, end: n};
      break;
    }
  }
  return {samples: out.subarray(0, n), loop};
}

/** A VAG file (or headerless ADPCM with `rate`) to {wav, meta}. */
export function decodeVag(b, {rate, prediction = 'rounded'} = {}) {
  let data = b,
    sampleRate = rate,
    name = null;
  if (b.length >= 48 && b[0] === 0x56 && b[1] === 0x41 && b[2] === 0x47 && b[3] === 0x70) {
    const be = at => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
    const size = be(12);
    sampleRate = rate ?? be(16);
    const nameBytes = b.subarray(32, 48);
    const z = nameBytes.indexOf(0);
    name = Buffer.from(nameBytes.subarray(0, z < 0 ? 16 : z)).toString('latin1');
    data = b.subarray(48, Math.min(b.length, 48 + size));
  } else if (!rate) throw Error('headerless ADPCM needs --rate');
  if (!Number.isInteger(sampleRate) || sampleRate < 1000 || sampleRate > 192000)
    throw Error(`sample rate ${sampleRate} is outside 1000..192000`);
  const {samples, loop} = decodeSpuAdpcm(data, {prediction});
  if (!samples.length) throw Error('no ADPCM frames');
  return {wav: encodeWav(samples, sampleRate), meta: {sampleRate, name, samples: samples.length, loop}};
}
