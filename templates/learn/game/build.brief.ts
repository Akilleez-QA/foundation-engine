// The build brief: the contract this game is built against (AGENTS.md). GAME.md mirrors it at the top.
import { defineBuild } from '@engine';

export default defineBuild({
  goal: 'A short interactive lesson that explains why we have day and night.',
  pitch: 'A teacher and a classmate at a chalkboard, then a spinning Earth you turn yourself, then three questions.',
  audience: { ages: [8, 11], kids: true, notes: 'Primary school; reads short sentences; may play without sound.' },
  genre: 'learn',
  coreLoop: ['watch and listen to a short board step', 'answer or try something', 'get kind feedback or a hint', 'go on to the next step'],
  devices: { targets: ['desktop', 'laptop', 'tablet', 'phone'], minimum: 'tablet', input: ['keyboard', 'pointer', 'touch', 'gamepad'] },
  quality: { views: [{ id: 'day-night-start', scene: 'day-night', mode: 'near' }] },
  performance: { perScene: { draws: 40, triangles: 60_000 } },
  modes: ['learn'],
  constraints: { content: ['original words and pictures only', 'no timers, no scores, nothing lost for a wrong answer'], ip: ['no third-party characters'] },
  pedagogy: { maxPassiveActions: 3 },
  success: [
    { id: 'S1', check: 'every objective is taught by a scene and checked by a question or the sim, and no scene has more than three passive steps in a row', how: 'test', by: 'game/day-night.test.ts' },
    { id: 'S2', check: 'turning the Earth past half a turn in the sim puts the marker in night and meets the second objective', how: 'test', by: 'game/day-night.test.ts' },
    { id: 'S3', check: 'a wrong quiz answer gets kind feedback and a hint before the answer is ever shown', how: 'test', by: 'game/day-night.test.ts' },
    { id: 'S4', check: 'the lesson plays from the first board to the end of the quiz in a browser with keys only', how: 'playtest', by: 'game/playtest/lesson.json' },
    { id: 'S5', check: 'the lesson scene stays inside its budgets.json counts, and the learn runtime is not in the first-load bundle', how: 'gate' },
  ],
});
