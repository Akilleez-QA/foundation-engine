import test from 'node:test';
import assert from 'node:assert/strict';
import { component, World } from './world';
import { createSystemRunner } from './systems';

const Position = component('position', { x: 0, y: 0 });
const Velocity = component('velocity', { x: 0, y: 0 });
const Tag = component('tag', { name: '' });

test('components: defaults are copied per entity; an initialiser merges a partial', () => {
  assert.throws(() => component('Bad Name', {}), /kebab-case/);
  assert.deepEqual(Position({ x: 2 }).value, { x: 2, y: 0 });
  const w = new World();
  const a = w.spawn(Position()), b = w.spawn(Position());
  w.get(a, Position)!.x = 5;
  assert.equal(w.get(b, Position)!.x, 0, 'defaults are never shared');
  assert.equal(Position.id, 'position');
});

test('world: spawn, add, remove, despawn; queries iterate in spawn order with live values', () => {
  const w = new World();
  const a = w.spawn(Position({ x: 1 }), Velocity({ x: 1 })), b = w.spawn(Position({ x: 10 })), c = w.spawn(Position(), Velocity({ y: 2 }), Tag({ name: 'c' }));
  assert.deepEqual([...w.query(Position, Velocity)].map(([e]) => e), [a, c]);
  for (const [, p, v] of w.query(Position, Velocity)) { p.x += v.x; p.y += v.y; }
  assert.deepEqual(w.get(a, Position), { x: 2, y: 0 });
  assert.deepEqual(w.first(Tag)?.[1], { name: 'c' });
  w.remove(c, Velocity); assert.equal(w.has(c, Velocity), false);
  w.add(b, Velocity({ x: -1 })); assert.deepEqual([...w.query(Velocity)].map(([e]) => e), [a, b]);
  w.despawn(a); assert.equal(w.exists(a), false); assert.equal(w.count, 2);
  assert.deepEqual([...w.query(Tag, Velocity)], []);
  assert.throws(() => w.add(a, Tag()), /does not exist/);
  const v = w.version; w.touch(); assert.equal(w.version, v + 1);
});

test('world: resources and per-frame events', () => {
  const w = new World();
  w.resources.score = 3;
  w.emit('hit', { by: 1 }); w.emit('hit', { by: 2 });
  assert.deepEqual(w.read('hit'), [{ by: 1 }, { by: 2 }]);
  w.clearEvents(); assert.deepEqual(w.read('hit'), []);
  assert.equal(w.resources.score, 3);
});

test('runner: fixed steps are frame-rate independent; frame systems run once; a throwing system is isolated', () => {
  const at30 = { t: 0, frames: 0 }, at144 = { t: 0, frames: 0 };
  const mk = () => createSystemRunner<{ t: number; frames: number }>([
    { id: 'clock', run: (c, dt) => { c.t += dt; } },
    { id: 'draw', phase: 'frame', run: c => { c.frames++; } },
  ], { step: 1 / 60 });
  const slow = mk(), fast = mk();
  for (let i = 0; i < 30; i++) slow.frame(at30, 1 / 30);
  for (let i = 0; i < 144; i++) fast.frame(at144, 1 / 144);
  assert.ok(Math.abs(at30.t - 1) < 1e-9 && Math.abs(at144.t - 1) < 1 / 60 + 1e-9, `${at30.t} ${at144.t}`);
  assert.equal(slow.stats.steps, 60);
  assert.equal(at30.frames, 30);
  const errors: string[] = [];
  const r = createSystemRunner<{ n: number }>([{ id: 'bad', run: () => { throw Error('x'); } }, { id: 'good', run: c => { c.n++; } }], { report: id => errors.push(id) });
  const ctx = { n: 0 }; r.frame(ctx, 1 / 60);
  assert.deepEqual([errors, ctx.n], [['bad'], 1]);
  const spiral = createSystemRunner<object>([{ id: 's', run() {} }], { step: 0.01, maxSteps: 3 });
  assert.equal(spiral.frame({}, 0.5), 3); assert.equal(spiral.stats.dropped, 47, 'a long frame drops what it cannot step');
  assert.throws(() => createSystemRunner([{ id: 'a', run() {} }, { id: 'a', run() {} }]), /two systems/);
});

test('runner: throwing diagnostics cannot strand either lane or corrupt subsequent frame accounting', () => {
  const fixedError = Error('fixed failure'), frameError = Error('frame failure');
  const reports: { id: string; error: unknown }[] = [];
  const calls: string[] = [];
  let after = 0;
  const runner = createSystemRunner([
    { id: 'fixed-failure', run() { throw fixedError; } },
    { id: 'fixed-sibling', run() { calls.push('fixed'); } },
    { id: 'frame-failure', phase: 'frame', run() { throw frameError; } },
    { id: 'frame-sibling', phase: 'frame', run() { calls.push('frame'); } },
  ], {
    step: 0.25,
    maxSteps: 2,
    report(id, error) {
      reports.push({ id, error });
      throw Error('diagnostic sink failure');
    },
    after() { after++; },
  });

  assert.equal(runner.frame({}, 0.875), 2);
  assert.deepEqual(calls, ['fixed', 'fixed', 'frame']);
  assert.deepEqual(runner.stats, { frames: 1, steps: 2, dropped: 1, errors: 3 });
  assert.equal(runner.alpha, 0.5);
  assert.equal(after, 1);

  assert.equal(runner.frame({}, 0.125), 1);
  assert.deepEqual(calls, ['fixed', 'fixed', 'frame', 'fixed', 'frame']);
  assert.deepEqual(runner.stats, { frames: 2, steps: 3, dropped: 1, errors: 5 });
  assert.equal(runner.alpha, 0);
  assert.equal(after, 2);
  assert.deepEqual(reports, [
    { id: 'fixed-failure', error: fixedError },
    { id: 'fixed-failure', error: fixedError },
    { id: 'frame-failure', error: frameError },
    { id: 'fixed-failure', error: fixedError },
    { id: 'frame-failure', error: frameError },
  ]);
});
