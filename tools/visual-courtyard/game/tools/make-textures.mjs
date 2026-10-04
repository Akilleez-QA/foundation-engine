// Generates the courtyard fixture's CC0 textures (cobbles, brick) into ../public/textures (not committed: the browser
// check runs this first). Run: node tools/visual-courtyard/game/tools/make-textures.mjs
import {mkdirSync, writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
const crcTable = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = b => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type),
    len = Buffer.alloc(4),
    c = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};
function png(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) raw[y * (w * 3 + 1) + 1 + x * 3 + k] = px(x, y)[k];
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
let s = 7;
const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
const noise = Array.from({length: 256 * 256}, rnd);
const clamp = v => Math.max(0, Math.min(255, v | 0));
// Cobbles: Voronoi cells with dark mortar.
const seeds = Array.from({length: 40}, () => [rnd() * 256, rnd() * 256, 0.75 + rnd() * 0.35]);
const cobble = png(256, 256, (x, y) => {
  let d1 = 1e9,
    d2 = 1e9,
    tone = 1;
  for (const [sx, sy, t] of seeds)
    for (const ox of [-256, 0, 256])
      for (const oy of [-256, 0, 256]) {
        const d = Math.hypot(x - sx - ox, y - sy - oy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          tone = t;
        } else if (d < d2) d2 = d;
      }
  const edge = Math.min(1, (d2 - d1) / 6),
    n = noise[y * 256 + x] * 30;
  const v = (120 * tone + n) * (0.25 + 0.75 * edge);
  return [clamp(v * 1.02), clamp(v * 0.97), clamp(v * 0.9)];
});
// Brick: running bond, warm clay, pale mortar.
const brick = png(256, 256, (x, y) => {
  const row = Math.floor(y / 32),
    bx = (x + (row % 2) * 32) % 64,
    by = y % 32;
  const mortar = bx < 3 || by < 3,
    id = Math.floor((x + (row % 2) * 32) / 64) + row * 7,
    t = 0.8 + (((id * 2654435761) % 1000) / 1000) * 0.35;
  const n = noise[y * 256 + x] * 25;
  return mortar
    ? [clamp(90 + n), clamp(85 + n), clamp(78 + n)]
    : [clamp(150 * t + n), clamp(78 * t + n), clamp(58 * t + n)];
});
mkdirSync(new URL('../public/textures/', import.meta.url), {recursive: true});
writeFileSync(new URL('../public/textures/cobbles.png', import.meta.url), cobble);
writeFileSync(new URL('../public/textures/brick.png', import.meta.url), brick);
console.log('wrote cobbles.png, brick.png');
