// The build brief: the contract this game is built against (AGENTS.md). GAME.md mirrors it at the top.
import { defineBuild } from '@engine';

export default defineBuild({
  goal: 'A small explorable world: walk around, use things, go through a door into another scene and back.',
  pitch: 'A garden and a shed. Find the three things you can use: the bench, the lamp and the crate.',
  genre: 'explorer',
  coreLoop: ['move around the scene', 'walk up to something and see its prompt', 'use it', 'go through the door to the next scene'],
  devices: { targets: ['desktop', 'laptop', 'tablet', 'phone'], minimum: 'phone', input: ['keyboard', 'pointer', 'touch', 'gamepad'] },
  quality: { views: [{ id: 'garden-start', scene: 'garden', mode: 'near' }, { id: 'shed-start', scene: 'shed', mode: 'near' }] },
  success: [
    { id: 'S1', check: 'holding up moves the player away from the camera and the garden walls stop them', how: 'test', by: 'game/garden.test.ts' },
    { id: 'S2', check: 'standing by the bench shows its prompt and using it counts one of three things', how: 'test', by: 'game/garden.test.ts' },
    { id: 'S3', check: 'the shed door leads into the shed and its door back arrives beside the garden door', how: 'playtest', by: 'playtest/door.json' },
    { id: 'S4', check: 'using all three things shows the found-everything banner, and it stays after a reload', how: 'test', by: 'game/garden.test.ts' },
    { id: 'S5', check: 'both scenes stay inside their budgets.json counts on the gate', how: 'gate' },
  ],
});
