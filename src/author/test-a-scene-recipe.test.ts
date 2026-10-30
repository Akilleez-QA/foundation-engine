// The code of docs/recipes/test-a-scene.md, run headless (imports point at the author API's source instead of
// '@engine'), and the built-in cue table of docs/recipes/play-your-own-sounds.md, generated from CORE_CUES.
// FOUNDATION_WRITE_DOCS=1 rewrites that table in place instead of failing when it drifts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import { readFileSync, writeFileSync } from 'node:fs';
import { BUILT_IN_CUES, defineInput, defineScene, defineSystem, testScene } from './index';
import { CORE_CUES } from '../platform/audio/audio-output';

// recipe:begin
const open = defineInput({ id: 'open', label: 'Open', keys: ['KeyE'], pad: ['a'] });

const doors = defineSystem({ id: 'doors', run(ctx) {
  if (!ctx.input.pressed('open')) return;
  ctx.play('ui.success', { volume: .8 });
  ctx.scene.goto('hall', { from: 'door' });
} });

const door = defineScene({ id: 'door', title: 'Door', systems: [doors],
  enter(ctx) { ctx.state.from = ctx.scene.params.from ?? 'start'; } });
// recipe:end

test('recipe: a scene test reads enter, a press, the plays and the scene change', async () => {
  // recipe:begin
  const t = await testScene(door, { inputs: [open], params: { from: 'porch' }, seed: 1 });
  assert.equal(t.ctx.state.from, 'porch');                 // enter has run
  t.press('open'); t.run(1 / 60);                         // one frame with the press
  assert.deepEqual(t.plays, [{ id: 'ui.success', options: { volume: .8 } }]);
  assert.deepEqual(t.went, ['hall']);                     // the scene asked to go; it is still this scene
  t.dispose();
  // recipe:end
  assert.deepEqual(t.cues, ['ui.success']);
  assert.throws(() => t.run(1 / 60), /testScene: disposed/);
});

test('recipe: an unknown cue fails the frame that plays it, with the message the recipe shows', async () => {
  const lose = defineSystem({ id: 'lose', run(ctx) { ctx.play('ui.fail'); } });
  const t = await testScene(defineScene({ id: 'field', title: 'Field', systems: [lose] }));
  const recipe = readFileSync(new URL('../../docs/recipes/test-a-scene.md', import.meta.url), 'utf8');
  const shown = recipe.match(/```text\n(system lose failed: [^\n]*)\n```/)?.[1];
  assert.ok(shown, 'the recipe shows the failure');
  assert.throws(() => t.run(1 / 60), (error: Error) => { assert.equal(error.message, shown); return true; });
  t.dispose();
});

test('recipe: the definitions above are the recipe\'s code', () => {
  const norm = (code: string) => code.replace(/\/\/[^\n]*/g, '').replace(/^import[^\n]*$/gm, '').replace(/\b(export|default)\b/g, '').replace(/\bconst\s+\w+\s*=/g, '').replace(/[\s;,]/g, '');
  const recipe = readFileSync(new URL('../../docs/recipes/test-a-scene.md', import.meta.url), 'utf8');
  const code = norm([...recipe.matchAll(/```ts\n([\s\S]*?)```/g)].map(m => m[1]).join('\n'));
  const own = readFileSync(new URL(import.meta.url), 'utf8');
  const blocks = [...own.matchAll(/\/\/ recipe:begin\n([\s\S]*?)\/\/ recipe:end/g)].map(m => must(m[1], 'recipe block'));
  assert.equal(blocks.length, 2);
  for (const block of blocks) assert.ok(code.includes(norm(block)), `not in the recipe:\n${block}`);
});

test('recipe: the built-in cue table is generated from the audio module\'s cues', () => {
  const captions = JSON.parse(readFileSync(new URL('../platform/audio/strings/audio/en.json', import.meta.url), 'utf8')) as Record<string, string>;
  const rows = CORE_CUES.map(c => `| \`${c.id}\` | ${c.caption ? captions[c.caption] ?? c.caption : ''} | ${Math.round(c.duration * 1000)} ms |`);
  const table = ['| Id | Caption (English) | Length |', '|---|---|---|', ...rows].join('\n') + '\n';
  assert.deepEqual(BUILT_IN_CUES, CORE_CUES.map(c => c.id));
  const url = new URL('../../docs/recipes/play-your-own-sounds.md', import.meta.url);
  const doc = readFileSync(url, 'utf8');
  const block = /(<!-- built-in-cues:begin[^\n]*-->\n)([\s\S]*?)(<!-- built-in-cues:end -->)/;
  assert.match(doc, block, 'play-your-own-sounds.md keeps its built-in-cues markers');
  const current = doc.match(block)![2];
  if (current !== table && process.env.FOUNDATION_WRITE_DOCS === '1') { writeFileSync(url, doc.replace(block, (_, a, _b, c) => a + table + c)); return; }
  assert.equal(current, table, 'the built-in cue table is stale: run this test with FOUNDATION_WRITE_DOCS=1 to rewrite it');
});
