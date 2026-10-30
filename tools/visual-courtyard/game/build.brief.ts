import {defineBuild} from '@engine';
export default defineBuild({
  goal: 'Show the visual-capability trial courtyard drawn with the author API and with the @kits/three escape hatch.',
  pitch: 'A night courtyard of lanterns: painted light pools before, real point lights, shadows and bloom after.',
  genre: 'explorer',
  coreLoop: ['walk around the courtyard', 'collect the embers', 'compare the lantern light'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check:
        'The kit draws custom-object lanterns with point lights, shadows and bloom, counts their draws and disposes everything on exit.',
      how: 'playtest',
      by: 'browser.mjs',
    },
    {
      id: 'S2',
      check:
        'Post-processing draws exactly 10, 1 and 0 post passes at full, basic and off, keeps scene draws equal, blooms at full and draws nothing while still.',
      how: 'playtest',
      by: 'post-browser.mjs',
    },
  ],
});
