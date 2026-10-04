// The look (a helper file: no default export): one limited palette and the light for each scene. Scenes take their
// colours from here, never as loose hex numbers. The techniques: docs/recipes/art-direction.md.
import {defineEnvironment} from '@engine';

/** Few hues, each with a light and a dark step, and one warm accent for what the player should notice. */
export const palette = {
  grass: 0xa6cc5c,
  grassDark: 0x5f8c3e,
  leaf: 0x4f8f45,
  leafDark: 0x2f6338,
  wood: 0xb07a4c,
  woodDark: 0x5e3b26,
  roof: 0xc4563c,
  stone: 0xb3aca0,
  stoneDark: 0x6f6a66,
  path: 0xe0c08e,
  iron: 0x3a3f4a,
  slate: 0x6a8793,
  cream: 0xf5ecd9,
  bloom: 0xf07a6a,
  accent: 0xf2c14e,
  lantern: 0xffb45a,
} as const;

/** The garden: a low, warm late-afternoon sun that casts shadows, a cool sky fill, and a gradient sky whose horizon
 *  colour the haze takes, so the distance melts into it. */
export const goldenHour = defineEnvironment({
  background: 0xf4cfa0,
  sky: {kind: 'gradient', top: 0x7fa6d6, horizon: 0xf6d2a2, bottom: 0xb9a27a, exponent: 0.7},
  ambient: {sky: 0xa8c0e8, ground: 0x6b5638, intensity: 1.6},
  directional: {color: 0xffc47e, intensity: 3.4, position: [-7, 5, 5]},
  haze: {kind: 'exp2', color: 'sky', density: 0.028},
  points: [],
  pointSize: 1,
});

/** The shed: a dim warm fill and a soft key from the window side; the hanging lamp (a point light) does the rest. */
export const indoors = defineEnvironment({
  background: 0x1a1310,
  ambient: {sky: 0xffd9a8, ground: 0x3b2a1e, intensity: 1.6},
  directional: {color: 0xffe2b0, intensity: 1.4, position: [-3, 7, 5]},
  haze: {color: 0x1a1310, near: 16, far: 34},
  points: [],
  pointSize: 1,
});
