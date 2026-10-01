import { defineBuild } from '@engine';
export default defineBuild({
  goal: 'Complete a guided field survey with reliable cancellation, dialogue and persistent rewards.',
  pitch: 'Visit three stations on a small terrain; each arrival advances the survey exactly once.',
  genre: 'expedition', coreLoop: ['read the briefing', 'choose the next station', 'follow the route', 'collect the survey badge'],
  devices: { targets: ['desktop', 'laptop', 'tablet', 'phone'], minimum: 'phone', input: ['keyboard', 'pointer', 'touch', 'gamepad'] },
  quality: { views: [{ id: 'field-start', scene: 'field', mode: 'reviewed' }] },
  success: [
    { id: 'S1', check: 'route planning never counts as physical arrival', how: 'test', by: 'game/field.test.ts' },
    { id: 'S2', check: 'stopping cancels movement and permits a fresh route without losing collected stations', how: 'test', by: 'game/field.test.ts' },
    { id: 'S3', check: 'three arrivals award one badge and replay or reload cannot duplicate it', how: 'test', by: 'game/field.test.ts' },
    { id: 'S4', check: 'dialogue accepts only the current session revision and saved state restores', how: 'test', by: 'game/field.test.ts' },
    { id: 'S6', check: 'optional assistance and functional gear change pace without cosmetic mastery grants', how: 'test', by: 'game/field.test.ts' },
    { id: 'S7', check: 'survey, finite collection and crafting resume after exit without duplicate materials', how: 'test', by: 'game/resources-station.test.ts' },
    { id: 'S5', check: 'the field stays within measured per-scene budgets', how: 'gate' },
  ],
});
