// Original CC0 textures for the explorer template, painted pixel by pixel here: no downloaded artwork, no image tools.
// Writes game/public/textures/explorer/{planks,crate}.png (128 × 128 RGB, about 20 KiB each). Seeded, so a re-run
// writes the same bytes. Run: node game/tools/generate-textures.mjs
import {mkdirSync, writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';

const out = new URL('../public/textures/explorer/', import.meta.url);

/** Write `name` as a size × size RGB PNG; paint(x, y) returns [r, g, b] in 0…255. */
export function png(name, size, paint) {
  const crc = bytes => {
    let n = 0xffffffff;
    for (const x of bytes) {
      n ^= x;
      for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, bytes) => {
    const head = Buffer.alloc(8),
      tail = Buffer.alloc(4);
    head.writeUInt32BE(bytes.length);
    head.write(type, 4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), bytes])));
    return Buffer.concat([head, bytes, tail]);
  };
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = paint(x, y).map(v => Math.max(0, Math.min(255, Math.round(v))));
      rows.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  mkdirSync(out, {recursive: true});
  const file = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(new URL(name, out), file);
}

/** A seeded hash in [0, 1) for integer coordinates: the same grain every run. */
const hash = (x, y, seed = 0) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Wood: four vertical boards per tile, each its own shade, with grain streaks, dark seams and two nails. */
function wood(x, y, size, base) {
  const boards = 4,
    w = size / boards,
    board = Math.floor(x / w),
    u = x - board * w;
  const shade = 0.86 + 0.2 * hash(board, 7, 1);
  const grain = 0.93 + 0.07 * Math.sin((x * 0.9 + Math.sin(y * 0.05 + board) * 3) * 1.7) + 0.05 * (hash(x, y) - 0.5);
  let k = shade * grain;
  if (u < 1.5 || u > w - 1) k *= 0.45; // the seam between boards
  for (const ny of [size * 0.14, size * 0.86]) if (Math.hypot(u - w / 2, y - ny) < 1.8) k *= 0.5; // nails
  return base.map(v => v * k);
}

const WOOD = [196, 148, 104];
png('planks.png', 128, (x, y) => wood(x, y, 128, WOOD));

/** A crate: planks behind a lighter frame and a diagonal brace. */
png('crate.png', 128, (x, y) => {
  const edge = 14,
    frame = x < edge || y < edge || x >= 128 - edge || y >= 128 - edge,
    brace = Math.abs(x - y) < edge * 0.7;
  const c =
    frame || brace
      ? WOOD.map(v => v * 1.08 * (0.95 + 0.05 * hash(x >> 2, y)))
      : wood(y, x, 128, WOOD).map(v => v * 0.8);
  const rim =
    x === edge || y === edge || x === 127 - edge || y === 127 - edge || x === 0 || y === 0 || x === 127 || y === 127;
  return rim ? c.map(v => v * 0.55) : c;
});
