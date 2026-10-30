import {defineBuild} from '@engine';
export default defineBuild({
  goal: 'Show pose-to-pose clips exported from Blender playing in the stock model loader.',
  pitch: 'A robot walks by its declared stride and waves; a six-legged creature scuttles and strikes.',
  genre: 'blank',
  coreLoop: ['watch the clips loop', 'trigger the wave or the strike', 'watch them return'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Each exported GLB has every declared clip, closed loops and planted feet within tolerance.',
      how: 'test',
      by: 'validate.test.mjs',
    },
    {
      id: 'S2',
      check:
        'In the browser the clips play by name with their declared durations, loops have no seam pop and the strike event fires once at its time.',
      how: 'test',
      by: 'browser.mjs',
    },
  ],
});
