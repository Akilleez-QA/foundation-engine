// Flipbook (sprite-sheet) particles: the UV and frame maths, the grid cap, and that frame choice is deterministic from
// the particles' own stream with and without a seed, never from the gameplay `ctx.random`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {must} from '../testing/must';
import {World} from '../core/ecs/world';
import {mulberry32, createRng, deriveSeed} from '../core/rng';
import {createRunRandom} from '../core/run-random';
import {Transform, defineScene, defineSystem} from './defs';
import {
  Emitter,
  PARTICLE_LIMITS,
  defineEmitter,
  emitterProblem,
  validateEmitter,
  flipbookFrame,
  flipbookUv,
  type EmitterData,
  type EmitterFrames,
} from './particles';
import {normalizeSceneParticles} from './particle-contract';
import {createParticleField, sceneParticles, type EmitterSlot} from './particle-sim';
import {createSceneParticles} from './scene-particles';
import {testScene} from './testing';

const STEP = 1 / 60;
const sheet = (frames: EmitterFrames, extra: Partial<EmitterData> = {}) =>
  defineEmitter({
    mode: 'continuous',
    rate: 60,
    max: 128,
    lifetime: [1, 1.5],
    texture: 'sheet',
    frames,
    ...extra,
  });

/** Steps a field fed by `seed` and returns, per drawn frame, the frame index of every live particle. */
function frames(seed: () => number, init = sheet({cols: 4, rows: 4, fps: 12, mode: 'random-start'}), steps = 60) {
  const world = new World(),
    bound: EmitterSlot[] = [];
  const f = createParticleField({
    limits: normalizeSceneParticles(undefined),
    scale: 1,
    seed,
    report: e => assert.fail(e.message),
    renderer: {bind: s => void bound.push(s), draw: () => {}, release: () => {}},
  });
  world.spawn(Transform(), init);
  const out: number[][] = [];
  for (let i = 0; i < steps; i++) {
    f.step(world, STEP);
    f.interpolate(1);
    const p = must(bound[0], 'bound slot').pool;
    out.push(Array.from(p.frame.subarray(0, p.live)));
  }
  f.dispose();
  return out;
}

test('flipbook UV maths: frame 0 is the top-left cell; frames run left to right, then down; every cell is its own', () => {
  // A 4 × 2 sheet: v is up (textures are uploaded flipped), so the top row spans v in [0.5, 1].
  assert.deepEqual(flipbookUv(0, 4, 2, 0, 0), [0, 0.5]);
  assert.deepEqual(flipbookUv(0, 4, 2, 1, 1), [0.25, 1]);
  assert.deepEqual(flipbookUv(3, 4, 2, 1, 1), [1, 1]);
  assert.deepEqual(flipbookUv(4, 4, 2, 0, 0), [0, 0]);
  assert.deepEqual(flipbookUv(7, 4, 2, 1, 1), [1, 0.5]);
  // The cap grid: 256 distinct cells that tile [0, 1]².
  const seen = new Set<string>();
  let area = 0;
  for (let f = 0; f < 256; f++) {
    const [u0, v0] = flipbookUv(f, 16, 16, 0, 0),
      [u1, v1] = flipbookUv(f, 16, 16, 1, 1);
    assert.ok(u0 >= 0 && v0 >= 0 && u1 <= 1 && v1 <= 1, `frame ${f} inside the sheet`);
    seen.add(`${u0},${v0}`);
    area += (u1 - u0) * (v1 - v0);
  }
  assert.equal(seen.size, 256);
  assert.ok(Math.abs(area - 1) < 1e-9);
  // A 1 × 1 grid is the whole texture, as without frames.
  assert.deepEqual(flipbookUv(0, 1, 1, 0.25, 0.75), [0.25, 0.75]);
});

test('flipbook frame maths: over-life spans the life once; loop and random-start wrap at fps', () => {
  // over-life: 4 frames over a 2 s life; fps is ignored.
  assert.deepEqual(
    [0, 0.49, 0.5, 1.2, 1.99, 2, 3].map(age => flipbookFrame('over-life', 4, 999, age, 2, 0)),
    [0, 0, 1, 2, 3, 3, 3],
  );
  // loop: 10 fps over 4 frames, from frame 0 at birth.
  assert.deepEqual(
    [0, 0.09, 0.1, 0.35, 0.4, 0.95].map(age => flipbookFrame('loop', 4, 10, age, 5, 0)),
    [0, 0, 1, 3, 0, 1],
  );
  // random-start: the same, offset by the start frame chosen at spawn.
  assert.deepEqual(
    [0, 0.1, 0.2].map(age => flipbookFrame('random-start', 4, 10, age, 5, 3)),
    [3, 0, 1],
  );
  assert.equal(flipbookFrame('loop', 1, 30, 7, 9, 0), 0, 'a single frame never moves');
});

test('the shader samples the same cell as flipbookUv, and only flipbook emitters get the frame attribute', () => {
  const scene = new T.Scene(),
    life = new AbortController(),
    world = new World();
  const view = createSceneParticles({
    scene,
    library: null,
    signal: life.signal,
    changed: () => {},
    report: assert.fail,
  });
  const field = createParticleField({
    limits: normalizeSceneParticles(undefined),
    scale: 1,
    seed: mulberry32(1),
    report: e => assert.fail(e.message),
    renderer: view,
  });
  world.spawn(
    Transform(),
    sheet({cols: 8, rows: 4, count: 30, mode: 'over-life'}, {mode: 'burst', bursts: 1, count: 5}),
  );
  world.spawn(Transform(), defineEmitter({mode: 'burst', bursts: 1, count: 5}));
  field.step(world, STEP);
  field.interpolate(1);
  const [flip, plain] = scene.children as T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>[];
  assert.ok(flip && plain);
  assert.deepEqual(flip.material.defines, {FLIPBOOK: ''});
  assert.equal(flip.material.uniforms.grid!.value.x, 8);
  assert.equal(flip.material.uniforms.grid!.value.y, 4);
  const frame = flip.geometry.getAttribute('frame') as T.InstancedBufferAttribute;
  assert.equal(frame.itemSize, 1);
  assert.deepEqual(frame.updateRanges, [{start: 0, count: 5}]);
  assert.match(flip.material.vertexShader, /floor\(\(frame \+ 0\.5\) \/ grid\.x\)/);
  assert.match(flip.material.vertexShader, /vec2\(frame - row \* grid\.x, grid\.y - 1\.0 - row\) \+ uv\) \/ grid/);
  // The default emitter keeps the plain program and its three attributes: its output is unchanged.
  assert.deepEqual(plain.material.defines ?? {}, {});
  assert.equal(plain.geometry.getAttribute('frame'), undefined);
  assert.deepEqual(Object.keys(plain.geometry.attributes).sort(), ['offset', 'position', 'size', 'tint', 'uv']);
  assert.equal(scene.children.length, 2, 'one mesh, one draw, per emitter');
  field.dispose();
  view.dispose();
  life.abort();
});

test('the flipbook grid is capped at 16 × 16: larger sheets and bad frames are refused with a clear message', () => {
  const ok = sheet({cols: 16, rows: 16, fps: 30, mode: 'loop'});
  assert.equal(ok.value.frames!.cols, 16);
  for (const [frames, message] of [
    [{cols: 17, rows: 1, mode: 'over-life'}, /at most 16×16 frames/],
    [{cols: 32, rows: 8, mode: 'over-life'}, /at most 16×16 frames/],
    [{cols: 4, rows: 0, mode: 'over-life'}, /frames\.cols and frames\.rows must be integers in \[1, 16\]/],
    [{cols: 2.5, rows: 2, mode: 'over-life'}, /frames\.cols and frames\.rows/],
    [{cols: 4, rows: 4, count: 17, mode: 'over-life'}, /frames\.count/],
    [{cols: 4, rows: 4, count: 0, mode: 'over-life'}, /frames\.count/],
    [{cols: 4, rows: 4, mode: 'pingpong'}, /frames\.mode/],
    [{cols: 4, rows: 4, mode: 'loop'}, /frames\.fps is required/],
    [{cols: 4, rows: 4, fps: 0, mode: 'loop'}, /frames\.fps must be in \(0, 120\]/],
    [{cols: 4, rows: 4, fps: PARTICLE_LIMITS.frameFps + 1, mode: 'random-start'}, /frames\.fps/],
  ] as const) {
    // Written over a valid sheet's frames (Object.assign takes any fields), so bad values need no type escape.
    const data = sheet({cols: 1, rows: 1, mode: 'over-life'}).value;
    Object.assign(must(data.frames, 'frames'), frames);
    assert.match(must(emitterProblem(data), 'problem'), message);
    assert.throws(() => validateEmitter(data), message);
  }
  assert.throws(() => sheet({cols: 17, rows: 1, mode: 'over-life'}), /at most 16×16 frames/);
  assert.throws(
    () => defineEmitter({frames: {cols: 2, rows: 2, mode: 'over-life'}}),
    /frames needs a texture: the sprite sheet/,
  );
  // Data mutated past the cap at run time is reported once and frozen (nothing drawn), like any invalid field.
  const world = new World(),
    reports: string[] = [],
    draws: number[] = [];
  const f = createParticleField({
    limits: normalizeSceneParticles(undefined),
    scale: 1,
    seed: mulberry32(3),
    report: e => reports.push(e.message),
    renderer: {bind: () => {}, draw: (_, n) => void draws.push(n), release: () => {}},
  });
  const e = world.spawn(Transform(), sheet({cols: 4, rows: 4, mode: 'over-life'}));
  must(world.get(e, Emitter), 'emitter').frames!.cols = 64;
  for (let i = 0; i < 5; i++) f.step(world, STEP);
  f.interpolate(1);
  assert.equal(reports.length, 1);
  assert.match(must(reports[0], 'report'), /at most 16×16 frames/);
  assert.equal(f.stats.live, 0);
  assert.deepEqual(draws, []);
  // A grid change within the cap restarts the emitter with a pool of the new shape.
  must(world.get(e, Emitter), 'emitter').frames!.cols = 8;
  f.step(world, STEP);
  assert.ok(f.stats.live > 0);
  assert.equal(emitterProblem(must(world.get(e, Emitter), 'emitter')), null);
  f.dispose();
});

test('determinism with a seed: the same seed picks the same frames; another seed picks others; Math.random is never used', () => {
  const real = Math.random;
  Math.random = () => assert.fail('particles must not use Math.random');
  try {
    const seeded = (seed: number) => {
      const rng = createRng(deriveSeed(seed >>> 0, 'particles')); // as the runtime does with ?seed=
      return frames(() => rng.next());
    };
    const a = seeded(7),
      b = seeded(7),
      c = seeded(8);
    assert.ok(a.flat().length > 30);
    assert.ok(new Set(a.flat()).size > 4, 'random starts cover several frames');
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  } finally {
    Math.random = real;
  }
});

test('determinism without a seed: the visit stream drives the frames; same stream state, same frames', () => {
  // Without ?seed= the runtime seeds emitters from the named visit stream `scene.<id>.particles`.
  const unseeded = (now: number) => {
    const stream = createRunRandom(() => now).stream('scene.s.particles', 'player');
    return frames(() => stream.next());
  };
  assert.deepEqual(unseeded(1000), unseeded(1000));
  assert.notDeepEqual(unseeded(1000), unseeded(2000));
});

test('over-life and loop take no extra random draw: their motion is identical to the same emitter without frames', () => {
  const positions = (frames: EmitterFrames | null) => {
    const world = new World(),
      bound: EmitterSlot[] = [];
    const f = createParticleField({
      limits: normalizeSceneParticles(undefined),
      scale: 1,
      seed: mulberry32(11),
      report: e => assert.fail(e.message),
      renderer: {bind: s => void bound.push(s), draw: () => {}, release: () => {}},
    });
    world.spawn(
      Transform(),
      defineEmitter({mode: 'continuous', rate: 90, max: 128, spread: Math.PI, texture: 'sheet', frames}),
    );
    for (let i = 0; i < 45; i++) f.step(world, STEP);
    const p = must(bound[0], 'slot').pool;
    return Array.from(p.pos.subarray(0, p.live * 3));
  };
  const plain = positions(null);
  assert.deepEqual(positions({cols: 4, rows: 4, mode: 'over-life'}), plain);
  assert.deepEqual(positions({cols: 4, rows: 4, fps: 24, mode: 'loop'}), plain);
  // over-life frames follow age / life; loop frames follow age × fps.
  const life = frames(mulberry32(5), sheet({cols: 2, rows: 2, mode: 'over-life'}, {lifetime: [1, 1]}), 70);
  const last = must(life.at(-1), 'last frame');
  assert.ok(last.every(f => f >= 0 && f <= 3) && new Set(last).size === 4, 'over-life shows every frame across ages');
});

test('a random-start flipbook leaves the gameplay random stream unchanged, with and without a testScene seed', async () => {
  const play = async (effects: boolean, seed?: number) => {
    const out: number[] = [];
    const roll = defineSystem({id: 'roll', run: ctx => void out.push(ctx.random())});
    const entities = effects ? [[Transform(), sheet({cols: 4, rows: 4, fps: 20, mode: 'random-start'})]] : [];
    const t = await testScene(
      defineScene({id: 's', title: 'S', particles: sceneParticles(), entities: entities as never, systems: [roll]}),
      seed === undefined ? {} : {seed},
    );
    t.run(0.5);
    if (effects) assert.ok(t.particles.stats!.spawned > 0);
    assert.deepEqual(t.particles.reports, []);
    t.dispose();
    return out;
  };
  assert.deepEqual(await play(true, 42), await play(false, 42));
  assert.deepEqual(await play(true), await play(false));
});
