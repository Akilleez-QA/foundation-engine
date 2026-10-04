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
  ink: 0x2f4670,
  water: 0x3f8fb0,
  cream: 0xf5ecd9,
  bloom: 0xf07a6a,
  accent: 0xf2c14e,
  lantern: 0xffb45a,
} as const;

/** Late-afternoon sun: low, warm key light against a cool sky fill; warm haze swallows the distance. */
export const goldenHour = defineEnvironment({
  background: 0xf4cfa0,
  ambient: {sky: 0xa8c0e8, ground: 0x6b5638, intensity: 1.6},
  directional: {color: 0xffc47e, intensity: 3.4, position: [-7, 5, 5]},
  haze: {color: 0xf4cfa0, near: 20, far: 48},
  points: [],
  pointSize: 1,
});

/** Flat, soft, even light: a cloudy day. Little sun, a strong sky fill, grey-blue haze close in. */
export const overcast = defineEnvironment({
  background: 0xc5ced4,
  ambient: {sky: 0xe8eef2, ground: 0x8a8f86, intensity: 2.6},
  directional: {color: 0xf2f4f7, intensity: 0.9, position: [2, 10, 3]},
  haze: {color: 0xc5ced4, near: 14, far: 40},
  points: [],
  pointSize: 1,
});

/** Night: a cold, dim key light, deep blue fill, dark haze and a few stars. Keep what matters bright. */
export const moonlight = defineEnvironment({
  background: 0x0f1834,
  ambient: {sky: 0x5a6fae, ground: 0x1a1d2a, intensity: 1.5},
  directional: {color: 0xaec4ff, intensity: 1.6, position: [5, 8, -4]},
  haze: {color: 0x0f1834, near: 14, far: 36},
  points: [
    {direction: [0.2, 1, -0.4], color: 0xffffff},
    {direction: [-0.5, 0.8, -0.3], color: 0xdde6ff},
    {direction: [0.6, 0.7, -0.6], color: 0xffeecc},
    {direction: [-0.2, 0.6, -0.8], color: 0xffffff},
    {direction: [0.8, 0.9, -0.2], color: 0xdde6ff},
  ],
  pointSize: 2,
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

/** Night for a scene whose lanterns are baked into its vertex colours (forms.ts bakeLight): an even, nearly white fill
 *  so the baked colours show as painted, a faint cold moon for the facets, and deep blue haze at the edges. */
export const bakedNight = defineEnvironment({
  background: 0x0c1430,
  ambient: {sky: 0xe4e9ff, ground: 0xb8ab9c, intensity: 2.5},
  directional: {color: 0x9fb4ff, intensity: 0.8, position: [-4, 8, -6]},
  haze: {color: 0x0c1430, near: 20, far: 44},
  // Stars low over the far wall, where a looking-down camera can still see sky. Placed by a fixed rule, not at random.
  points: Array.from({length: 70}, (_, i) => ({
    direction: [Math.cos(3.3 + i * 0.045) * 2, 0.12 + ((i * 0.618) % 1) * 0.5, Math.sin(3.3 + i * 0.045) * 2 - 1.6] as [
      number,
      number,
      number,
    ],
    color: i % 5 ? 0xd8e0ff : 0xffe9c0,
  })),
  pointSize: 2,
});

/** The presets in the order the sundial cycles them. */
export const LOOKS = [goldenHour, overcast, moonlight, studio] as const;
