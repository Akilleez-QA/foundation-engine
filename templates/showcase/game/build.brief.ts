// The build brief: the contract this game is built against (AGENTS.md). GAME.md mirrors it at the top.
import {defineBuild} from '@engine';

export default defineBuild({
  goal: 'Show how good a small game can look with the author API alone: palette, light presets, haze, camera, low-poly forms, baked light, textures and particles.',
  pitch:
    'A lantern-lit courtyard at night with six embers to find, and a garden through the gate whose sundial turns the light.',
  genre: 'showcase',
  coreLoop: [
    'walk around the courtyard',
    'walk into an ember to take it',
    'go through the gate to the garden',
    'turn the sundial to change the light',
  ],
  devices: {
    targets: ['desktop', 'laptop', 'tablet', 'phone'],
    minimum: 'phone',
    input: ['keyboard', 'pointer', 'touch', 'gamepad'],
  },
  quality: {
    views: [
      {id: 'courtyard-start', scene: 'courtyard', mode: 'near'},
      {id: 'garden-start', scene: 'garden', mode: 'near'},
    ],
  },
  success: [
    {
      id: 'S1',
      check: 'holding up moves the player away from the camera and the courtyard walls stop them',
      how: 'test',
      by: 'game/courtyard.test.ts',
    },
    {
      id: 'S2',
      check: 'walking into an ember takes it, counts it and remembers it after a reload',
      how: 'test',
      by: 'game/courtyard.test.ts',
    },
    {
      id: 'S3',
      check: 'the gate leads to the garden, and using the sundial moves the garden to the next light preset',
      how: 'test',
      by: 'game/garden.test.ts',
    },
    {
      id: 'S4',
      check: "both scenes pass the art-direction look checklist on play:snap's desktop and phone pictures",
      how: 'manual',
    },
    {id: 'S5', check: 'both scenes stay inside their budgets.json counts on the gate', how: 'gate'},
  ],
});
