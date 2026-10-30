// The look (a helper file: no default export): one limited palette and the light presets. Scenes take their colours
// and environments from here, never as loose hex numbers, so the whole game stays in one key.
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
  ink: 0x3f5f96,
  water: 0x3f8fb0,
  cream: 0xf5ecd9,
  bloom: 0xf07a6a,
  accent: 0xf2c14e,
  lantern: 0xffb45a,
} as const;

/** Late-afternoon sun: low, warm key light against a cool sky fill; a gradient sky, and haze in its horizon colour
 *  swallows the distance. */
export const goldenHour = defineEnvironment({
  background: 0xf4cfa0,
  sky: {kind: 'gradient', top: 0x7fa6d6, horizon: 0xf4cfa0, bottom: 0xb9a27a, exponent: 0.7},
  ambient: {sky: 0xa8c0e8, ground: 0x6b5638, intensity: 1.6},
  directional: {color: 0xffc47e, intensity: 3.4, position: [-7, 5, 5]},
  haze: {color: 'sky', near: 20, far: 48},
  points: [],
  pointSize: 1,
});

/** Flat, soft, even light: a cloudy day. Little sun, a strong sky fill, grey-blue haze close in. */
export const overcast = defineEnvironment({
  background: 0xc5ced4,
  sky: {kind: 'gradient', top: 0x9aa8b4, horizon: 0xc5ced4, bottom: 0x8a8f86},
  ambient: {sky: 0xe8eef2, ground: 0x8a8f86, intensity: 2.6},
  directional: {color: 0xf2f4f7, intensity: 0.9, position: [2, 10, 3]},
  haze: {color: 'sky', near: 14, far: 40},
  points: [],
  pointSize: 1,
});

/** Night: a cold, dim key light, deep blue fill, a starry gradient sky and haze in its horizon colour. Keep what matters
 *  bright. */
export const moonlight = defineEnvironment({
  background: 0x0f1834,
  sky: {
    kind: 'gradient',
    top: 0x050a1f,
    horizon: 0x1b2550,
    bottom: 0x0f1834,
    exponent: 0.6,
    stars: {count: 300, seed: 3},
  },
  ambient: {sky: 0x5a6fae, ground: 0x1a1d2a, intensity: 1.5},
  directional: {color: 0xaec4ff, intensity: 1.6, position: [5, 8, -4]},
  haze: {color: 'sky', near: 14, far: 36},
  points: [],
  pointSize: 1,
});

/** A neutral studio: white key light from the front left, even fill, no haze. For checking forms and colours. */
export const studio = defineEnvironment({
  background: 0x2a2e35,
  ambient: {sky: 0xffffff, ground: 0x4a4640, intensity: 1.8},
  directional: {color: 0xffffff, intensity: 2.4, position: [-3, 6, 5]},
  haze: null,
  points: [],
  pointSize: 1,
});

/** The courtyard's night: a deep gradient sky with a moon and stars, haze in the sky's horizon colour, a dim blue
 *  fill, and a cold moon that casts shadows. The lanterns are point lights in the scene. */
export const lanternNight = defineEnvironment({
  background: 0x0a1028,
  sky: {
    kind: 'gradient',
    top: 0x03061a,
    horizon: 0x1f2a5a,
    bottom: 0x0a1028,
    exponent: 0.6,
    discs: [{direction: [-0.45, 0.5, -0.75], size: 4, color: 0xe6ecff, glow: 0.5}],
    stars: {count: 400, seed: 7},
  },
  ambient: {sky: 0x5a6fae, ground: 0x2a2433, intensity: 0.5},
  directional: {color: 0xa8bcff, intensity: 0.7, position: [-4, 8, -6], shadow: {extent: 13}},
  haze: {kind: 'exp2', color: 'sky', density: 0.028},
  points: [],
  pointSize: 1,
});

/** The presets in the order the sundial cycles them. */
export const LOOKS = [goldenHour, overcast, moonlight, studio] as const;
