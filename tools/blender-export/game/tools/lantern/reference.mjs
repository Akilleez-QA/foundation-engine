// Draws the lantern's front-view concept silhouette, lantern.front.png, from the design outline in centimetres:
// a 19 cm base plate 3 cm deep, a 13 cm chimney to 20 cm, a roof narrowing from 19 cm to 6 cm at 26 cm, and a ring
// handle (4.8 cm outer, 3.2 cm inner radius) centred at 30 cm. It is the creator's target shape for the silhouette check
// in lantern.contract.json, drawn from the design, not rendered from the model. Original GPL-3.0-only project content.
//   node tools/blender-export/game/tools/lantern/reference.mjs
import {writeFileSync} from 'node:fs';
import {encodeMaskPng} from '../../../../../scripts/asset-silhouette.mjs';

const PX = 4, // pixels per centimetre
  width = 26 * PX,
  height = 38 * PX,
  inside = new Uint8Array(width * height);
const shape = (x, y) =>
  (y <= 3 && Math.abs(x) <= 9.5) ||
  (y > 3 && y <= 20 && Math.abs(x) <= 6.5) ||
  (y > 20 && y <= 26 && Math.abs(x) <= 9.5 - ((y - 20) / 6) * 6.5) ||
  (Math.hypot(x, y - 30) <= 4.8 && Math.hypot(x, y - 30) >= 3.2);
for (let row = 0; row < height; row++)
  for (let col = 0; col < width; col++) {
    const x = (col + 0.5) / PX - 13, // centimetres from the centre line
      y = (height - row - 0.5) / PX - 2; // centimetres above the ground, 2 cm margin
    inside[row * width + col] = Number(y >= 0 && shape(x, y));
  }
writeFileSync(new URL('./lantern.front.png', import.meta.url), encodeMaskPng({width, height, inside}));
