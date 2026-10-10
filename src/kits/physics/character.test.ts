import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, Name, testScene, Transform, type ComponentInit} from '../../author';
import {Character} from '../character';
import {
  Collider,
  loadPhysics,
  PhysicsCharacter,
  physicsCharacterStats,
  physicsCharacterSystem,
  scenePhysics,
  type Rapier,
} from './index';

const FLOOR_TOP = 0.1;
const STAND = FLOOR_TOP + 0.55 + 0.35; // capsule centre resting on the floor (before the skin offset)

async function walk(
  extra: readonly (readonly ComponentInit<object>[])[],
  o: {
    hold?: number;
    seconds?: number;
    character?: Partial<ReturnType<typeof PhysicsCharacter.initial>>;
    startX?: number;
    startY?: number;
    maxCharacters?: number;
  } = {},
) {
  const physics = scenePhysics({limits: {maxCharacters: o.maxCharacters ?? 8}});
  const scene = defineScene({
    id: 'walk',
    title: 'Walk',
    prepare: (_ctx, signal) => physics.prepare(signal),
    exit: ctx => physics.exit(ctx),
    entities: [
      [
        Name({name: 'player'}),
        Transform({x: o.startX ?? -4, y: o.startY ?? STAND + 0.05}),
        PhysicsCharacter(o.character ?? {}),
      ],
      [Transform(), Collider({hx: 30, hy: FLOOR_TOP, hz: 30})],
      ...extra,
    ],
    systems: [physicsCharacterSystem(physics, {relative: 'world'}), physics.system],
  });
  const t = await testScene(scene);
  if (o.hold !== undefined) t.hold('character-x', o.hold);
  t.run(o.seconds ?? 3);
  const player = t.ctx.named('player')!;
  return {t, physics, player, tr: t.world.get(player, Transform)!, pc: t.world.get(player, PhysicsCharacter)!};
}

const ramp = (degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  // A long board whose low end meets the floor near x = 0 and rises towards +x.
  return [
    Transform({x: 4 * Math.cos(a), y: FLOOR_TOP + 4 * Math.sin(a) - 0.1, rz: a}),
    Collider({hx: 4, hy: 0.1, hz: 3}),
  ];
};

test('character adapter: gravity settles the character on the floor and it reports grounded', async () => {
  const {tr, pc, t} = await walk([], {startY: 3, seconds: 2});
  assert.ok(Math.abs(tr.y - STAND) < 0.05, `rests at ${tr.y}`);
  assert.equal(pc.grounded, true);
  assert.equal(pc.vy, 0);
  t.dispose();
});

test('character adapter: climbs a 20 degree slope within maxSlope', async () => {
  const {tr, t} = await walk([ramp(20)], {hold: 1, seconds: 3});
  assert.ok(tr.x > 3, `advanced to x=${tr.x}`);
  assert.ok(tr.y > STAND + 1, `climbed to y=${tr.y}`);
  t.dispose();
});

test('character adapter: a 60 degree slope steeper than maxSlope is not climbed', async () => {
  const {tr, t} = await walk([ramp(60)], {hold: 1, seconds: 3});
  assert.ok(tr.y < STAND + 0.5, `stayed low at y=${tr.y}`);
  assert.ok(tr.x < 1, `blocked near the foot at x=${tr.x}`);
  t.dispose();
});

test('character adapter: autostep climbs a 0.2 m step; with autostep off the step blocks', async () => {
  const step = [Transform({x: 2, y: FLOOR_TOP + 0.1}), Collider({hx: 1, hy: 0.1, hz: 3})];
  const up = await walk([step], {hold: 1, seconds: 1.2, startX: -1});
  assert.ok(up.tr.x > 1.2 && up.tr.x < 2.9, `on the step at x=${up.tr.x}`);
  assert.ok(up.tr.y > STAND + 0.15, `stands on the step at y=${up.tr.y}`);
  up.t.dispose();
  const blocked = await walk([step], {hold: 1, seconds: 2, startX: -1, character: {stepHeight: 0, snap: 0}});
  assert.ok(blocked.tr.x < 1 - 0.3, `blocked at x=${blocked.tr.x}`);
  assert.ok(blocked.tr.y < STAND + 0.1, `not lifted: y=${blocked.tr.y}`);
  blocked.t.dispose();
});

test('character adapter: an entity that also has the stock Character is refused (no double movement)', async () => {
  const physics = scenePhysics();
  const scene = defineScene({
    id: 'both',
    title: 'Both',
    prepare: (_c, s) => physics.prepare(s),
    exit: ctx => physics.exit(ctx),
    entities: [
      [Name({name: 'p'}), Transform({y: STAND}), PhysicsCharacter(), Character()],
      [Transform(), Collider({hx: 10, hy: FLOOR_TOP, hz: 10})],
    ],
    systems: [physicsCharacterSystem(physics, {relative: 'world'}), physics.system],
  });
  const t = await testScene(scene);
  t.hold('character-x', 1);
  t.run(0.5);
  assert.equal(t.world.get(t.ctx.named('p')!, Transform)!.x, 0);
  assert.deepEqual(physicsCharacterStats(t.world), {moved: 0, conflicts: 1, waiting: 0});
  t.dispose();
});

test('character adapter: characters beyond maxCharacters wait, counted; dispose frees each controller once', async () => {
  const r = await loadPhysics();
  const rapier = (r as {rapier: Rapier}).rapier;
  let freed = 0;
  const proto = rapier.KinematicCharacterController.prototype;
  const original = proto.free;
  proto.free = function (this: InstanceType<Rapier['KinematicCharacterController']>) {
    freed++;
    return original.call(this);
  };
  try {
    const second = [Name({name: 'second'}), Transform({x: 3, y: STAND}), PhysicsCharacter()];
    const {t, physics} = await walk([second], {hold: 1, seconds: 0.5, maxCharacters: 1});
    const pw = physics.of(t.ctx)!;
    assert.equal(pw.status().characters, 1);
    assert.equal(pw.status().refused['limit-characters'], 1);
    assert.deepEqual(physicsCharacterStats(t.world), {moved: 1, conflicts: 0, waiting: 1});
    t.dispose();
    assert.equal(freed, 1);
    assert.equal(pw.status().released.controllers, 1);
  } finally {
    proto.free = original;
  }
});

test('character adapter: restoring the ECS state and the physics snapshot replays the same walk exactly', async () => {
  const {t, physics, player} = await walk([ramp(20)], {hold: 1, seconds: 0.5});
  const pw = physics.of(t.ctx)!;
  const save = () =>
    JSON.stringify({
      tr: t.world.get(player, Transform),
      pc: t.world.get(player, PhysicsCharacter),
      physics: (pw.snapshot() as {text: string}).text,
    });
  const load = (text: string) => {
    const s = JSON.parse(text) as {tr: object; pc: object; physics: string};
    Object.assign(t.world.get(player, Transform)!, s.tr);
    Object.assign(t.world.get(player, PhysicsCharacter)!, s.pc);
    assert.equal(pw.restore(s.physics).status, 'restored');
  };
  const atK = save();
  t.hold('character-x', 0.3);
  t.run(0.6);
  const first = save();
  load(atK);
  t.run(0.6);
  assert.equal(save(), first);
  t.dispose();
});
