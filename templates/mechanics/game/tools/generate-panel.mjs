// Original CC0 panel texture for the Material demonstration, no external image tooling or artwork.
// 32×32 RGBA: a light plate with a darker seam and four rivets; it tiles seamlessly with `repeat`.
import {writeFileSync, mkdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
const out = new URL('../public/textures/mechanics/', import.meta.url);
mkdirSync(out, {recursive: true});
const crc = b => {
  let n = 0xffffffff;
  for (const x of b) {
    n ^= x;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
};
const chunk = (name, bytes) => {
  const type = Buffer.from(name),
    h = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  h.writeUInt32BE(bytes.length);
  tail.writeUInt32BE(crc(Buffer.concat([type, bytes])));
  return Buffer.concat([h, type, bytes, tail]);
};
const S = 32,
  pixels = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    const o = y * (S * 4 + 1) + 1 + x * 4;
    let c = [214, 226, 232];
    if (x === 0 || y === 0 || x === S - 1 || y === S - 1) c = [92, 112, 126];
    else if ((x + y) % 7 === 0) c = [200, 214, 222];
    for (const [rx, ry] of [
      [5, 5],
      [S - 6, 5],
      [5, S - 6],
      [S - 6, S - 6],
    ])
      if (Math.hypot(x - rx, y - ry) <= 1.6) c = [120, 138, 150];
    pixels.set([...c, 255], o);
  }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(
  new URL('panel.png', out),
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
