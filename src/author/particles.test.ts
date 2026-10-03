import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import { World } from '../core/ecs/world';
import { mulberry32 } from '../core/rng';
import { Transform, defineEntity, defineScene, defineSystem } from './defs';
import { Emitter, EMITTER_DEFAULTS, PARTICLE_LIMITS, burst, defineEmitter, emitterProblem, validateEmitter, type EmitterData } from './particles';
import { normalizeSceneParticles } from './particle-contract';
import { createParticleField, keeps, sceneParticles, type EmitterSlot, type ParticleFieldOptions } from './particle-sim';
import { testScene } from './testing';
import { compileGame } from './compile';
import { defineBuild } from './build';
import { defineAsset, defineGame } from './defs';

const STEP = 1 / 60;
const field = (o: Partial<ParticleFieldOptions> = {}) => {
  const reports: string[] = [];
  const f = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(7), report: e => reports.push(e.message), ...o });
  return { f, reports };
};
const run = (f: ReturnType<typeof createParticleField>, world: World, steps: number) => { for (let i = 0; i < steps; i++) f.step(world, STEP); };
const positions = (slot: EmitterSlot) => Array.from(slot.pool.pos.subarray(0, slot.pool.live * 3));
/** A renderer double that records the slots it was handed. */
function recorder() {
  const bound: EmitterSlot[] = [], released: EmitterSlot[] = [], draws: [EmitterSlot, number][] = [];
  return { bound, released, draws, renderer: { bind: (s: EmitterSlot) => { bound.push(s); }, draw: (s: EmitterSlot, n: number) => { draws.push([s, n]); }, release: (s: EmitterSlot) => { released.push(s); } } };
}

test('defineEmitter fills defaults, copies arrays and names the bad field', () => {
  const a = defineEmitter({ count: 4 }), b = defineEmitter({ count: 4 });
  assert.equal(a.value.max, EMITTER_DEFAULTS.max);
  assert.notEqual(a.value.size, b.value.size, 'arrays are never shared between initialisers');
  assert.notEqual(a.value.size, EMITTER_DEFAULTS.size);
  for (const [bad, field] of [
    [{ max: 0 }, 'max'], [{ max: PARTICLE_LIMITS.perEmitter + 1 }, 'max'], [{ count: 65 }, 'count'], [{ rate: -1 }, 'rate'],
    [{ lifetime: [0, 1] }, 'lifetime'], [{ lifetime: [2, 1] }, 'lifetime'], [{ speed: [Number.NaN, 1] }, 'speed'],
    [{ direction: [0, 0, 0] }, 'direction'], [{ spread: 4 }, 'spread'], [{ gravity: [0, 2000, 0] }, 'gravity'],
    [{ size: [] }, 'size'], [{ size: Array(9).fill(1) }, 'size'], [{ color: [0x1000000] }, 'color'], [{ opacity: [2] }, 'opacity'],
    [{ texture: 'Bad Id' }, 'texture'], [{ blending: 'multiply' }, 'blending'], [{ bursts: 1.5 }, 'bursts'],
  ] as [Partial<EmitterData>, string][]) assert.throws(() => defineEmitter(bad), new RegExp(`emitter: ${field}`), JSON.stringify(bad));
  assert.equal(emitterProblem(a.value), null);
  assert.throws(() => normalizeSceneParticles({ max: -1 }), /particles: max/);
  assert.throws(() => sceneParticles({ emitters: PARTICLE_LIMITS.emittersCap + 1 }), /particles: emitters/);
  assert.deepEqual(defineScene({ id: 'x', title: 'x', particles: sceneParticles({ max: 100 }) }).particles!.limits, { max: 100, emitters: PARTICLE_LIMITS.emitters });
  assert.throws(() => defineScene({ id: 'x', title: 'x', particles: { max: 100 } as never }), /particles must be sceneParticles/);
});

test('a burst fires once per requested burst, at the emitter, and the pool is allocated once', () => {
  const world = new World(), { f } = field(), r = recorder();
  const g = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(7), report: () => {}, renderer: r.renderer });
  const e = world.spawn(Transform({ x: 2, y: 1 }), defineEmitter({ mode: 'burst', count: 10, bursts: 1, lifetime: [1, 1], speed: [0, 0] }));
  g.step(world, STEP);
  assert.equal(g.stats.live, 10); assert.equal(r.bound.length, 1);
  const slot = must(r.bound[0], 'bound slot 0'), arrays = [slot.pool.pos, slot.pool.offset, slot.pool.tint];
  assert.deepEqual(positions(slot).slice(0, 3), [2, 1, 0], 'zero speed: at the emitter');
  run(g, world, 10);
  assert.equal(g.stats.live, 10, 'no second burst without a request');
  assert.ok(burst(world, e)); assert.equal(burst(world, 999), false);
  g.step(world, STEP);
  assert.equal(g.stats.live, 20);
  assert.deepEqual([slot.pool.pos, slot.pool.offset, slot.pool.tint], arrays, 'same pool arrays: nothing reallocated');
  assert.equal(slot.pool.capacity, 64);
  void f;
});

test('determinism: the same seed gives the same particles; a different seed does not', () => {
  const make = (seed: number) => {
    const world = new World(), r = recorder();
    const f = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(seed), report: () => {}, renderer: r.renderer });
    world.spawn(Transform(), defineEmitter({ mode: 'continuous', rate: 120, max: 256, spread: Math.PI, gravity: [0, -9.8, 0], drag: .5 }));
    run(f, world, 90);
    return positions(must(r.bound[0], 'bound slot 0'));
  };
  const a = make(1), b = make(1), c = make(2);
  assert.ok(a.length > 0);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('continuous emission follows rate, stops with playing, and the entity despawns at a data-only time', () => {
  const world = new World(), { f } = field();
  const e = world.spawn(Transform(), defineEmitter({ mode: 'continuous', rate: 30, max: 64, lifetime: [.5, .5], despawn: true }));
  run(f, world, 60);
  assert.equal(f.stats.spawned, 30);
  assert.ok(f.busy(world));
  world.get(e, Emitter)!.playing = false;
  run(f, world, 29);
  assert.ok(world.exists(e), 'still finishing its particles');
  run(f, world, 2);
  assert.equal(world.exists(e), false, 'removed once the longest lifetime has passed');
  assert.equal(f.stats.emitters, 0); assert.equal(f.stats.live, 0);
  assert.equal(f.busy(world), false);
});

test('a burst prefab that waits for a trigger is not finished and not busy', () => {
  const world = new World(), { f } = field();
  const e = world.spawn(Transform(), defineEmitter({ mode: 'burst', count: 5, bursts: 0, despawn: true }));
  run(f, world, 120);
  assert.ok(world.exists(e)); assert.equal(f.busy(world), false);
  burst(world, e);
  assert.ok(f.busy(world), 'a pending burst is work');
});

test('quality thinning draws a deterministic subset of the reference particles; stream and despawn do not change', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(k => keeps(k, .5)), [false, true, false, true, false, true, false, true]);
  assert.equal([...Array(100).keys()].filter(k => keeps(k, .75)).length, 75);
  const make = (scale: number, essential = false) => {
    const world = new World(), r = recorder();
    const f = createParticleField({ limits: normalizeSceneParticles(undefined), scale, seed: mulberry32(3), report: () => {}, renderer: r.renderer });
    const e = world.spawn(Transform(), defineEmitter({ mode: 'burst', count: 8, bursts: 1, max: 8, lifetime: [1, 1], speed: [1, 2], spread: Math.PI, despawn: true, essential }));
    f.step(world, STEP);
    const pos = positions(must(r.bound[0], 'bound slot 0')), capacity = must(r.bound[0], 'bound slot 0').pool.capacity;
    let steps = 1; while (world.exists(e) && steps < 1000) { f.step(world, STEP); steps++; }
    return { pos, capacity, steps, stats: f.stats };
  };
  const full = make(1), half = make(.5), essential = make(.5, true);
  assert.equal(half.capacity, 4, 'the pool shrinks with the scale');
  assert.equal(half.pos.length, 4 * 3);
  // Kept spawn indices 1, 3, 5, 7 are the reference particles 1, 3, 5, 7 (in spawn order).
  const ref = [1, 3, 5, 7].flatMap(k => full.pos.slice(k * 3, k * 3 + 3));
  assert.deepEqual(half.pos, ref);
  assert.equal(half.steps, full.steps, 'despawn time is the same on every preset');
  assert.equal(half.stats.spawned, full.stats.spawned); assert.equal(half.stats.thinned, 4);
  assert.deepEqual(essential.pos, full.pos, 'essential emitters are never thinned');
});

test('overload: a full pool drops and counts; extra bursts in one step are dropped and counted', () => {
  const world = new World(), { f } = field();
  const e = world.spawn(Transform(), defineEmitter({ mode: 'burst', count: 8, max: 10, bursts: 1, lifetime: [5, 5] }));
  f.step(world, STEP);
  burst(world, e); f.step(world, STEP);
  assert.equal(f.stats.live, 10); assert.equal(f.stats.dropped, 6);
  burst(world, e, PARTICLE_LIMITS.burstsPerStep + 3); f.step(world, STEP);
  assert.equal(f.stats.dropped, 6 + 3 * 8 + PARTICLE_LIMITS.burstsPerStep * 8, 'per-step cap, then a full pool');
});

test('scene admission refuses over-limit emitters once, draws nothing for them, and admits them when capacity frees', () => {
  const world = new World(), r = recorder(), reports: string[] = [];
  const f = createParticleField({ limits: normalizeSceneParticles({ max: 100, emitters: 2 }), scale: 1, seed: mulberry32(1), report: e => reports.push(e.message), renderer: r.renderer });
  const a = world.spawn(Transform(), defineEmitter({ max: 60 }));
  world.spawn(Transform(), defineEmitter({ max: 60 }));
  world.spawn(Transform(), defineEmitter({ max: 30 }));
  run(f, world, 5);
  assert.equal(f.stats.emitters, 2, 'a (60) and c (30) fit; b (60) does not');
  assert.equal(f.stats.reserved, 90);
  assert.equal(reports.length, 1); assert.match(must(reports[0], 'report 0'), /refused/);
  world.despawn(a); f.step(world, STEP);
  assert.equal(f.stats.emitters, 2); assert.equal(f.stats.reserved, 90, 'b admitted with the capacity a freed');
  assert.equal(r.released.length, 1); assert.equal(reports.length, 1);
  const g = field({ limits: normalizeSceneParticles({ emitters: 0 }) });
  world.spawn(Transform(), defineEmitter({})); run(g.f, world, 3);
  assert.equal(g.f.stats.emitters, 0); assert.equal(g.f.stats.refused, 3, 'every refused emitter is counted');
  assert.equal(g.reports.length, 1, 'one report per visit, however many are refused');
});

test('invalid data freezes the emitter with one report per problem, and it resumes when fixed', () => {
  const world = new World(), { f, reports } = field();
  const e = world.spawn(Transform(), defineEmitter({ mode: 'continuous', rate: 60 }));
  run(f, world, 10);
  const before = f.stats.spawned;
  world.get(e, Emitter)!.rate = Number.NaN;
  run(f, world, 10);
  assert.equal(f.stats.spawned, before); assert.equal(reports.length, 1); assert.match(must(reports[0], 'report 0'), /rate/);
  world.get(e, Emitter)!.rate = 60;
  run(f, world, 10);
  assert.ok(f.stats.spawned > before); assert.equal(f.stats.invalid, 1);
});

test('changing max, texture or blending rebuilds the emitter; replacing the component too', () => {
  const world = new World(), r = recorder();
  const f = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(1), report: () => {}, renderer: r.renderer });
  const e = world.spawn(Transform(), defineEmitter({ mode: 'continuous' }));
  run(f, world, 2);
  world.get(e, Emitter)!.blending = 'normal'; f.step(world, STEP);
  assert.equal(r.bound.length, 2); assert.equal(r.released.length, 1); assert.equal(must(r.bound[1], 'bound slot 1').blending, 'normal');
  world.add(e, defineEmitter({ mode: 'continuous', max: 8, count: 4 })); f.step(world, STEP);
  assert.equal(r.bound.length, 3); assert.equal(must(r.bound[2], 'bound slot 2').pool.capacity, 8);
  world.remove(e, Emitter); f.step(world, STEP);
  assert.equal(r.released.length, 3); assert.equal(f.stats.emitters, 0);
  f.dispose(); f.dispose();
});

test('interpolation and curves: alpha blends the last two steps; size, colour and opacity follow life; idle writes nothing', () => {
  const world = new World(), r = recorder();
  const f = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(1), report: () => {}, renderer: r.renderer });
  world.spawn(Transform(), defineEmitter({ mode: 'burst', count: 1, bursts: 1, speed: [6, 6], spread: 0, direction: [1, 0, 0], lifetime: [1, 1],
    size: [1, 0], color: [0xffffff, 0x000000], opacity: [1, 0] }));
  assert.equal(f.interpolate(.5), false, 'nothing admitted yet');
  f.step(world, STEP); f.step(world, STEP);
  const s = must(r.bound[0], 'bound slot 0'), p = s.pool;
  assert.ok(f.interpolate(0));
  assert.ok(Math.abs(must(p.offset[0])) < 1e-6, 'alpha 0: the previous step (spawned there)');
  f.interpolate(1);
  assert.ok(Math.abs(must(p.offset[0]) - .1) < 1e-6, 'alpha 1: the current step (6 m/s × 1/60 s)');
  f.interpolate(.5);
  assert.ok(Math.abs(must(p.offset[0]) - .05) < 1e-6);
  const t = .5 / 60;
  assert.ok(Math.abs(must(p.size[0]) - (1 - t)) < 1e-6); assert.ok(Math.abs(must(p.tint[3]) - (1 - t)) < 1e-6);
  assert.ok(must(p.tint[0]) < 1 && must(p.tint[0]) > .9, 'linear colour, between the keys');
  assert.deepEqual(r.draws.at(-1)!.slice(1), [1]);
  run(f, world, 60);
  assert.ok(f.interpolate(1), 'one write to hide the last particle');
  assert.equal(r.draws.at(-1)![1], 0);
  const draws = r.draws.length;
  assert.equal(f.interpolate(1), false, 'idle: no write, no redraw'); assert.equal(r.draws.length, draws);
});

test('direction follows the transform rotation', () => {
  const world = new World(), r = recorder();
  const f = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(1), report: () => {}, renderer: r.renderer });
  world.spawn(Transform({ rz: -Math.PI / 2 }), defineEmitter({ mode: 'burst', count: 1, bursts: 1, speed: [60, 60], spread: 0, direction: [0, 1, 0] }));
  f.step(world, STEP);
  const [x, y] = positions(must(r.bound[0], 'bound slot 0'));
  assert.equal(x, 0); assert.equal(y, 0);
  f.step(world, STEP);
  const [x2, y2] = positions(must(r.bound[0], 'bound slot 0'));
  assert.ok(Math.abs(must(x2) - 1) < 1e-9 && Math.abs(must(y2)) < 1e-9, `up rotated -90° about z points along +x (${x2}, ${y2})`);
});

test('a moving continuous emitter spreads its spawns along its path (a trail)', () => {
  const world = new World(), r = recorder();
  const f = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(1), report: () => {}, renderer: r.renderer });
  const e = world.spawn(Transform(), defineEmitter({ mode: 'continuous', rate: 240, speed: [0, 0], lifetime: [1, 1] }));
  f.step(world, STEP);
  world.get(e, Transform)!.x = 4;
  f.step(world, STEP);
  const xs = positions(must(r.bound[0], 'bound slot 0')).filter((_, i) => i % 3 === 0).slice(4).sort((a, b) => a - b);
  assert.deepEqual(xs, [1, 2, 3, 4], 'four spawns spread over the 4 m moved');
});

test('validateEmitter accepts every documented default', () => { validateEmitter(Emitter.initial()); });

test('testScene steps particles like a visit: bursts, despawn, admission reports and quality scale', async () => {
  const spark = [Transform({ y: 1 }), defineEmitter({ mode: 'burst', count: 12, bursts: 1, lifetime: [.2, .4], despawn: true })] as const;
  const scene = defineScene({ id: 'fx', title: 'FX', particles: sceneParticles({ emitters: 1 }), entities: [[...spark], [...spark]] });
  const t = await testScene(scene, { seed: 5 });
  t.run(1 / 60);
  assert.equal(t.particles.stats!.emitters, 1); assert.equal(t.particles.stats!.live, 12);
  assert.equal(t.particles.reports.length, 1);
  assert.equal(t.world.count, 1, 'the refused one-shot dropped its burst and removed itself at once');
  assert.equal(t.particles.stats!.dropped, 12);
  t.run(.5);
  assert.equal(t.world.count, 0);
  assert.equal(t.particles.stats!.spawned, 12, 'the refused burst never fires late');
  t.dispose();
  const low = await testScene(defineScene({ id: 'fx', title: 'FX', particles: sceneParticles(), entities: [[...spark]] }), { seed: 5, particleScale: .5 });
  low.run(1 / 60);
  assert.equal(low.particles.stats!.live, 6);
  low.dispose();
  // Without sceneParticles(): nothing is simulated (no draw), the entity stays, and one report says why.
  const none = await testScene(defineScene({ id: 'fx', title: 'FX', entities: [[...spark]] }), { seed: 5 });
  none.run(1);
  assert.equal(none.particles.stats, null); assert.equal(none.world.count, 1);
  assert.equal(none.particles.reports.length, 1); assert.match(must(none.particles.reports[0], 'report 0'), /no particles/);
  none.dispose();
});

test('a scene\'s emitter textures must name texture assets of the game', () => {
  const brief = defineBuild({ goal: 'g', genre: 'blank', pitch: 'p', coreLoop: ['a'], devices: { targets: ['desktop'], minimum: 'desktop', input: ['keyboard'] }, success: [{ id: 'S1', check: 'c', how: 'manual' }] });
  const game = defineGame({ id: 'g', title: 'G', version: '1.0.0', firstScene: 'fx' });
  const scene = defineScene({ id: 'fx', title: 'FX', entities: [[Transform(), defineEmitter({ texture: 'spark' })]] });
  assert.throws(() => compileGame({ brief, game, defs: [scene] }), /emitter texture 'spark' has no defineAsset/);
  const spark = defineAsset({ id: 'spark', type: 'texture', url: '/spark.png', licence: 'CC0-1.0', author: 'a', source: 's' });
  assert.doesNotThrow(() => compileGame({ brief, game, defs: [scene, spark] }));
});

test('H1: particles never draw from the gameplay random stream: ctx.random() is identical with and without emitters', async () => {
  const sparks = defineEntity({ id: 'sparks', components: [defineEmitter({ mode: 'burst', count: 4, max: 4, bursts: 1, despawn: true })] });
  const play = async (effects: boolean) => {
    const out: number[] = [];
    let n = 0;
    const roll = defineSystem({ id: 'roll', run(ctx) {
      n++;
      // Spawn one-shot effects every few ticks, and rebuild a continuous one (re-admission).
      if (effects && n % 3 === 0) ctx.spawn(sparks, Transform({ x: n }));
      out.push(ctx.random());
    } });
    const entities = effects ? [[Transform(), defineEmitter({ mode: 'continuous', rate: 30 })]] : [];
    const t = await testScene(defineScene({ id: 's', title: 'S', particles: sceneParticles(), entities: entities as never, systems: [roll] }), { seed: 42 });
    t.run(.5);
    if (effects) { assert.ok(t.particles.stats!.spawned > 0); for (const [, d] of t.world.query(Emitter)) d.blending = 'normal'; }
    t.run(.5);
    t.dispose();
    return out;
  };
  const without = await play(false), withEffects = await play(true);
  assert.equal(without.length, 60);
  assert.deepEqual(withEffects, without);
});

test('H2: sustained one-shot hits over the scene limit stay bounded: entities, reports and spawned particles', async () => {
  const fx = defineEntity({ id: 'fx', components: [defineEmitter({ mode: 'burst', count: 8, max: 8, bursts: 1, lifetime: [1, 1], despawn: true })] });
  const hit = defineSystem({ id: 'hit', run(ctx) { ctx.spawn(fx, Transform()); } });
  const t = await testScene(defineScene({ id: 's', title: 'S', particles: sceneParticles(), systems: [hit] }), { seed: 1 });
  const counts: number[] = [];
  for (let s = 0; s < 10; s++) { t.run(1); counts.push(t.world.count); }
  const stats = t.particles.stats!;
  // 16 admitted at a time, each living 1 s plus its own step: entities stay near the emitter limit.
  assert.ok(Math.max(...counts) <= 16 + 1, `entities bounded (${counts})`);
  assert.ok(must(counts[9]) <= must(counts[1]) + 1, 'no growth over time');
  assert.equal(t.particles.reports.length, 1, 'one refusal report per visit');
  assert.ok(stats.refused > 400 && stats.dropped === stats.refused * 8, 'every refused burst is dropped and counted');
  t.dispose();
});

test('H2: a refused burst never fires late at a stale position; a refused continuous emitter starts when capacity frees', async () => {
  const fx = defineEntity({ id: 'fx', components: [defineEmitter({ mode: 'burst', count: 8, max: 8, bursts: 1, lifetime: [1, 1] })] });
  const t = await testScene(defineScene({ id: 's', title: 'S', particles: sceneParticles({ emitters: 1 }) }), { seed: 1 });
  const first = t.ctx.spawn(fx, Transform({ x: 0 }));
  const second = t.ctx.spawn(fx, Transform({ x: 100 }));
  t.run(1 / 60);
  t.world.despawn(first);
  t.run(1.2);
  assert.equal(t.particles.stats!.spawned, 8, 'the second hit was dropped, not fired 1.2 s late');
  assert.equal(t.particles.stats!.emitters, 1, 'it was admitted when capacity freed, with nothing pending');
  burst(t.world, second); t.run(1 / 60);
  assert.equal(t.particles.stats!.spawned, 16, 'a new request after admission fires normally');
  t.dispose();
  const u = await testScene(defineScene({ id: 's', title: 'S', particles: sceneParticles({ emitters: 1 }) }), { seed: 1 });
  const a = u.ctx.spawn(fx, Transform());
  u.ctx.spawn(defineEntity({ id: 'jet', components: [defineEmitter({ mode: 'continuous', rate: 60 })] }), Transform());
  u.run(.5); assert.equal(u.particles.stats!.spawned, 8);
  u.world.despawn(a); u.run(.5);
  assert.ok(u.particles.stats!.spawned > 8, 'the waiting continuous emitter started');
  u.dispose();
});

test('M1: rebuilding a burst emitter (blending, texture, max or a replaced component) never re-fires old bursts', async () => {
  const s = defineScene({ id: 's', title: 'S', particles: sceneParticles(), entities: [[Transform(), defineEmitter({ mode: 'burst', count: 10, max: 40, lifetime: [5, 5] })]] as never });
  const t = await testScene(s, { seed: 1 });
  const [e] = must([...t.world.query(Emitter)][0], 'an emitter entity');
  burst(t.world, e, 3); t.run(1 / 60);
  assert.equal(t.particles.stats!.spawned, 30);
  t.world.get(e, Emitter)!.blending = 'normal'; t.run(1 / 60);
  t.world.add(e, Emitter({ ...t.world.get(e, Emitter)!, max: 20 })); t.run(1 / 60);
  assert.equal(t.particles.stats!.spawned, 30, 'restarts kept the burst count');
  burst(t.world, e); t.run(1 / 60);
  assert.equal(t.particles.stats!.spawned, 40);
  t.dispose();
});

test('a renderer that cannot bind an emitter is reported once and not retried every step', () => {
  const world = new World(), reports: string[] = [];
  let binds = 0;
  const f = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(1), report: e => reports.push(e.message),
    renderer: { bind: () => { binds++; throw Error('no GPU'); }, draw: () => {}, release: () => {} } });
  world.spawn(Transform(), defineEmitter({ mode: 'continuous' }));
  run(f, world, 30);
  assert.equal(binds, 1); assert.deepEqual(reports, ['no GPU']); assert.equal(f.stats.emitters, 0);
});

test('N1: testScene accepts any numeric seed (wrapped to 32 bits), with and without particles', async () => {
  for (const seed of [Date.now(), -1, 2 ** 32, 2 ** 53 + 2, 1.5, 0]) {
    for (const particles of [undefined, sceneParticles()]) {
      const t = await testScene(defineScene({ id: 's', title: 'S', particles, entities: particles ? [[Transform(), defineEmitter({ mode: 'continuous', rate: 30 })]] as never : [] }), { seed });
      t.run(2 / 60);
      assert.equal(typeof t.ctx.random(), 'number');
      t.dispose();
    }
  }
  // Equal 32-bit seeds give equal particles.
  const positions = async (seed: number) => {
    const t = await testScene(defineScene({ id: 's', title: 'S', particles: sceneParticles(), entities: [[Transform(), defineEmitter({ mode: 'burst', count: 3, bursts: 1, spread: Math.PI })]] as never }), { seed });
    t.run(1 / 60); const s = t.particles.stats!; t.dispose(); return s;
  };
  assert.deepEqual(await positions(2 ** 32 + 7), await positions(7));
});

test('refusals are reported once per cause and counted by cause', () => {
  const world = new World(), { f, reports } = field({ limits: normalizeSceneParticles({ max: 100, emitters: 2 }) });
  world.spawn(Transform(), defineEmitter({ max: 60 }));
  world.spawn(Transform(), defineEmitter({ max: 60 }));   // particles: 120 > 100
  world.spawn(Transform(), defineEmitter({ max: 70 }));   // particles again: counted, not reported
  run(f, world, 2);
  assert.equal(reports.length, 1); assert.match(must(reports[0], 'report 0'), /reserved particles/);
  world.spawn(Transform(), defineEmitter({ max: 10 }));   // fits: 2 emitters admitted
  world.spawn(Transform(), defineEmitter({ max: 1 }));    // emitters limit: a different cause, reported
  run(f, world, 2);
  assert.equal(reports.length, 2); assert.match(must(reports[1], 'report 1'), /limit of 2 emitters/);
  assert.deepEqual(f.stats.refusals, { emitters: 1, particles: 2 }); assert.equal(f.stats.refused, 3);
});

test('bindFailed from a lazy renderer releases the slot and the emitter is not re-admitted', () => {
  const world = new World(), r = recorder(), reports: string[] = [];
  const f = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(1), report: e => reports.push(e.message), renderer: r.renderer });
  world.spawn(Transform(), defineEmitter({ mode: 'continuous' }));
  f.step(world, STEP);
  f.bindFailed(must(r.bound[0], 'bound slot 0'), Error('late bind'));
  run(f, world, 10);
  assert.equal(f.stats.emitters, 0); assert.equal(r.bound.length, 1); assert.equal(r.released.length, 1); assert.deepEqual(reports, ['late bind']);
});
