import {defineBuild} from '@engine';
export default defineBuild({
  goal: 'Walk over an authored surface whose rendered triangles and ground queries agree.',
  pitch: 'A ridge, a basin and a level pad share one terrain snapshot.',
  genre: 'terrain',
  coreLoop: ['choose a destination', 'walk over the landforms', 'inspect the level pad'],
  devices: {
    targets: ['desktop', 'laptop', 'tablet', 'phone'],
    minimum: 'phone',
    input: ['keyboard', 'pointer', 'touch', 'gamepad'],
  },
  quality: {views: [{id: 'yard-start', scene: 'yard', mode: 'reviewed'}]},
  success: [
    {
      id: 'S1',
      check: 'the moving character remains exactly one foot offset above the sampled surface',
      how: 'test',
      by: 'game/yard.test.ts',
    },
    {
      id: 'S2',
      check: 'the pad marker stands on the level pad and the pad excludes scatter',
      how: 'test',
      by: 'game/yard.test.ts',
    },
    {
      id: 'S3',
      check: 'pointer picking intersects terrain triangles instead of the zero height plane',
      how: 'test',
      by: 'game/yard.test.ts',
    },
    {
      id: 'S5',
      check: 'surface revision swaps render, contact and navigation epoch together',
      how: 'test',
      by: 'game/yard.test.ts',
    },
    {id: 'S4', check: 'the terrain yard stays within its measured scene budgets', how: 'gate'},
  ],
});
