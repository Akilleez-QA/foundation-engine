// The build brief: the contract this game is built against (AGENTS.md). GAME.md mirrors it at the top.
import { defineBuild } from '@engine';

export default defineBuild({
  goal: 'A starting point: one scene, one entity, one input, ready to grow into any game.',
  pitch: 'A cube that turns a quarter when you press Space, tap, or press the pad’s A button.',
  genre: 'blank',
  coreLoop: ['press the turn action', 'watch the cube turn a quarter', 'press again'],
  devices: { targets: ['desktop', 'laptop', 'tablet', 'phone'], minimum: 'phone', input: ['keyboard', 'pointer', 'touch', 'gamepad'] },
  quality: { views: [{ id: 'main-start', scene: 'main', mode: 'near' }] },
  success: [
    { id: 'S1', check: 'pressing turn rotates the cube a quarter turn within half a second', how: 'test', by: 'game/main.test.ts' },
    { id: 'S2', check: 'the main scene stays inside its budgets.json counts on the gate', how: 'gate' },
    { id: 'S3', check: 'a still scene draws no frames while idle (render on change)', how: 'gate' },
  ],
});
