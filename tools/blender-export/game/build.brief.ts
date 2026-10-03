import { defineBuild } from '@engine';
export default defineBuild({ goal: 'Demonstrate a reproducible original Blender asset in the stock model loader.',
  pitch: 'A metre block rests on its base pivot and turns on input.', genre: 'blank',
  coreLoop: ['inspect the block', 'turn it', 'inspect the base pivot'],
  devices: { targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer'] },
  success: [{ id: 'S1', check: 'The exported GLB has the declared scale, pivot, material and geometry bounds.', how: 'test', by: 'verify.test.mjs' }],
});
