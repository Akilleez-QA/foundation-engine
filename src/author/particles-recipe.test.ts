// The code of docs/recipes/hit-sparks-and-pickups.md, run headless (imports point at the author API's source instead of
// '@engine'). The last test checks that every `recipe:begin`…`recipe:end` block still appears in the recipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import { readFileSync } from 'node:fs';
import { burst, defineEmitter, defineEntity, defineInput, defineScene, defineSystem, Emitter, Name, sceneParticles, Shape, testScene, Transform } from './index';

// recipe:begin
const hitSparks = defineEntity({ id: 'hit-sparks', components: [
  defineEmitter({
    mode: 'burst', count: 24, bursts: 1, max: 24,
    lifetime: [.25, .5], speed: [3, 6], spread: Math.PI / 2, direction: [0, 1, 0],
    gravity: [0, -12, 0], drag: 1,
    size: [.12, .02], color: [0xfff4b0, 0xff8a1a, 0x7a1e00], opacity: [1, 0],
    despawn: true,
  }),
] });
// recipe:end
// recipe:begin
const coin = defineEntity({ id: 'coin', components: [
  Name({ name: 'coin' }), Transform({ y: .6 }), Shape({ kind: 'cylinder', size: [.5, .08, .5], color: 0xffd23a }),
  defineEmitter({ mode: 'continuous', rate: 6, max: 12, lifetime: [.6, 1], speed: [.2, .5], spread: Math.PI,
    size: [.08, 0], color: [0xffffff, 0xffe27a], opacity: [.9, 0] }),
] });
// recipe:end
// recipe:begin
const pickupBurst = defineEntity({ id: 'pickup-burst', components: [
  defineEmitter({ mode: 'burst', count: 32, bursts: 1, max: 32, lifetime: [.4, .7], speed: [1.5, 2.5], spread: Math.PI / 2,
    direction: [0, 1, 0], gravity: [0, -3, 0], size: [.14, .02], color: [0xffffff, 0xffd23a], opacity: [1, 0], despawn: true }),
] });
// recipe:end
// recipe:begin
const collect = defineSystem({ id: 'collect', run(ctx) {
  const e = ctx.named('coin');
  if (e === undefined || !ctx.input.pressed('use')) return;
  ctx.spawn(pickupBurst, Transform({ ...ctx.world.get(e, Transform)! }));
  ctx.world.despawn(e);
} });
// recipe:end
// recipe:begin
const trail = defineEmitter({ mode: 'continuous', rate: 80, max: 96, lifetime: [.3, .5], speed: [0, .2], spread: Math.PI,
  size: [.2, .04], color: [0x8fd8ff, 0x2a4cff], opacity: [.8, 0] });
// recipe:end
// recipe:begin
const smoke = defineEmitter({ mode: 'continuous', rate: 12, max: 48, lifetime: [2, 3], speed: [.4, .8], spread: .3, direction: [0, 1, 0],
  gravity: [.3, .2, 0], drag: .4, size: [.3, 1.2], color: [0x8a8a8a, 0x5a5a5a], opacity: [.5, .3, 0], blending: 'normal' });
// recipe:end
const use = defineInput({ id: 'use', label: 'Use', keys: ['KeyE'], pad: ['a'] });

test('recipe: hit sparks remove themselves; the pickup glitters, then bursts when collected; trail and smoke run', async () => {
  const level = defineScene({ id: 'level', title: 'Level', particles: sceneParticles(), entities: [coin, [Name({ name: 'ship' }), Transform(), trail], [Transform({ x: 3 }), smoke]], systems: [collect] });
  const t = await testScene(level, { seed: 1, inputs: [use] });
  const before = t.world.count;
  t.ctx.spawn(hitSparks, Transform({ y: 1 }));
  t.run(1 / 60);
  assert.equal(t.particles.stats!.emitters, 4);
  assert.ok(t.particles.stats!.live >= 24);
  t.run(1);
  assert.equal(t.world.count, before, 'the sparks removed themselves');
  t.press('use'); t.run(1 / 60);
  assert.equal(t.ctx.named('coin'), undefined);
  assert.equal(t.world.count, before, 'the coin became its burst');
  t.run(1);
  assert.equal(t.world.count, before - 1, 'the burst played out and removed itself');
  const ship = t.ctx.named('ship')!;
  t.ctx.world.get(ship, Emitter)!.playing = false;
  assert.equal(burst(t.ctx.world, ship), true);
  assert.deepEqual(t.particles.reports, []);
  t.dispose();
});

test('recipe: the definitions above are the recipe\'s code', () => {
  // Compare without comments, whitespace, separators, `export` or the `const x =` binding (the recipe shows some
  // emitters inline in an entity list).
  const norm = (code: string) => code.replace(/\/\/[^\n]*/g, '').replace(/\bexport\b/g, '').replace(/\bconst\s+\w+\s*=/g, '').replace(/[\s;,]/g, '');
  const recipe = readFileSync(new URL('../../docs/recipes/hit-sparks-and-pickups.md', import.meta.url), 'utf8');
  const code = norm([...recipe.matchAll(/```ts\n([\s\S]*?)```/g)].map(m => m[1]).join('\n'));
  const own = readFileSync(new URL(import.meta.url), 'utf8');
  const blocks = [...own.matchAll(/\/\/ recipe:begin\n([\s\S]*?)\/\/ recipe:end/g)].map(m => must(m[1], 'recipe block'));
  assert.equal(blocks.length, 6);
  for (const block of blocks) assert.ok(code.includes(norm(block)), `not in the recipe:\n${block}`);
});
