import { createSurface } from '@kits/terrain';

/** One authored region in metres. Camera changes never regenerate its contact surface. */
export const createRegion = (revision = 1) => createSurface({
  id: 'terrain-yard', revision, seed: 17,
  originX: -12, originZ: -12, spacing: 0.5, cellsX: 48, cellsZ: 48, baseHeight: revision === 1 ? 0 : 0.5,
  layers: [
    { kind: 'radial', x: -5, z: -4, radius: 7, height: 3.5 },
    { kind: 'radial', x: 5, z: -5, radius: 4, height: -1.4 },
    { kind: 'noise', amplitude: 0.12, frequency: 0.7 },
  ],
  pads: [{ x: 3, z: 4, radius: 2.5, feather: 1.5, height: 0.55, material: 1, excluded: true }],
});

export const region = createRegion();
