import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, Name, testScene, Transform} from '../../author';
import {createBreadcrumbTrail, createCompanionRecovery} from './index';

const straightTrail = (length: number) => {
  const trail = createBreadcrumbTrail({capacity: 256, record: {mode: 'every-tick'}});
  for (let x = 0; x <= length; x++) trail.record({x, y: 0, z: 0, heading: 0});
  return trail; // newest crumb (the leader) at x = length
};
const options = {catchUpDistance: 2, teleportDistance: 10, landing: [3, 5, 8], stuckSeconds: 2, cooldown: 1};

test('close followers follow; lagging ones catch up with a boost that grows with distance', () => {
  const trail = straightTrail(30);
  const r = createCompanionRecovery(trail, options);
  assert.deepEqual(r.update(1, {position: [27, 0, 0], desired: [28, 0, 0], now: 0}), {kind: 'follow', boost: 1});
  const mid = r.update(1, {position: [22, 0, 0], desired: [28, 0, 0], now: 0.1});
  assert.equal(mid.kind, 'catch-up');
  assert.ok(mid.kind === 'catch-up' && Math.abs(mid.boost - 1.5) < 1e-12, 'halfway between catch-up and teleport');
  assert.deepEqual(r.update(2, {position: [0, 0, 0], desired: null, now: 0}), {kind: 'follow', boost: 1});
});

test('a follower far from the trail teleports to the first landing point that passes canLand', () => {
  const trail = straightTrail(30);
  const r = createCompanionRecovery(trail, options);
  const seen: number[] = [];
  const d = r.update(1, {
    position: [0, 0, 50],
    desired: [28, 0, 0],
    now: 0,
    canLand: p => (seen.push(p.x), p.x <= 25), // the nearest landing (x = 27) is visible to the camera
  });
  assert.deepEqual(seen, [27, 25]);
  assert.equal(d.kind, 'teleport');
  assert.ok(d.kind === 'teleport' && d.to.x === 25 && d.reason === 'distance');
  // Cooldown: a second stranding within a second does not teleport again.
  const again = r.update(1, {position: [0, 0, 50], desired: [28, 0, 0], now: 0.5});
  assert.equal(again.kind, 'stranded');
  assert.equal(r.update(1, {position: [0, 0, 50], desired: [28, 0, 0], now: 1.2}).kind, 'teleport');
});

test('a follower stuck behind an obstacle (no progress for stuckSeconds) is recovered even when not far', () => {
  const trail = straightTrail(30);
  const r = createCompanionRecovery(trail, options);
  const kinds: {kind: string; reason?: string; at: number}[] = [];
  for (let i = 0; i <= 30; i++) {
    const d = r.update(1, {position: [24.001, 0, 0], desired: [28, 0, 0], now: i / 10});
    kinds.push({kind: d.kind, at: i / 10, ...(d.kind === 'teleport' ? {reason: d.reason} : {})});
  }
  assert.deepEqual(
    kinds.find(k => k.kind === 'teleport'),
    {kind: 'teleport', at: 2, reason: 'stuck'},
    'after stuckSeconds without progress',
  );
  // Steady progress never counts as stuck.
  const moving = createCompanionRecovery(trail, options);
  let kind = '';
  for (let i = 0; i <= 60; i++)
    kind = moving.update(2, {position: [18 + i * 0.1, 0, 0], desired: [28, 0, 0], now: i / 10}).kind;
  assert.notEqual(kind, 'teleport');
});

test('no landing point passes: stranded with a boost, and a throwing canLand counts as refusal', () => {
  const trail = straightTrail(30);
  const r = createCompanionRecovery(trail, options);
  const d = r.update(1, {
    position: [0, 0, 50],
    desired: [28, 0, 0],
    now: 0,
    canLand: () => {
      throw new Error('collision query failed');
    },
  });
  assert.deepEqual(d, {kind: 'stranded', reason: 'distance', boost: 2});
  const empty = createBreadcrumbTrail({capacity: 4, record: {mode: 'every-tick'}});
  const none = createCompanionRecovery(empty, options);
  assert.equal(none.update(1, {position: [0, 0, 50], desired: [0, 0, 0], now: 0}).kind, 'stranded');
});

test('options and inputs are validated; followers are bounded', () => {
  const trail = straightTrail(5);
  assert.throws(() => createCompanionRecovery(trail, {...options, teleportDistance: 1}), RangeError);
  assert.throws(() => createCompanionRecovery(trail, {...options, landing: []}), RangeError);
  assert.throws(() => createCompanionRecovery({} as never, options), RangeError);
  const r = createCompanionRecovery(trail, {...options, maxFollowers: 1});
  r.update(1, {position: [0, 0, 0], desired: null, now: 1});
  assert.throws(() => r.update(2, {position: [0, 0, 0], desired: null, now: 1}), RangeError);
  assert.throws(() => r.update(1, {position: [0, 0, 0], desired: null, now: 0}), RangeError, 'time per follower');
  assert.throws(() => r.update(1, {position: [0, NaN, 0], desired: null, now: 2}), RangeError);
  assert.equal(r.remove(1), true);
});

test('composition: a companion that falls into a pit is recovered behind the leader on the trail', async () => {
  const trail = createBreadcrumbTrail({capacity: 128, record: {mode: 'moved', minDistance: 0.25}});
  const recovery = createCompanionRecovery(trail, {catchUpDistance: 1.5, teleportDistance: 6, landing: [2, 3, 4]});
  const decisions: string[] = [];
  const scene = defineScene({
    id: 'companion',
    title: 'Companion',
    entities: [
      [Name({name: 'leader'}), Transform()],
      [Name({name: 'buddy'}), Transform({x: -1})],
    ],
    systems: [
      defineSystem({
        id: 'walk',
        run(ctx) {
          const tr = ctx.world.get(ctx.named('leader')!, Transform)!;
          tr.x += 0.08;
          trail.record({x: tr.x, y: tr.y, z: tr.z, heading: tr.ry});
        },
      }),
      defineSystem({
        id: 'buddy',
        run(ctx, dt) {
          const tr = ctx.world.get(ctx.named('buddy')!, Transform)!;
          const target = trail.along(1);
          if (ctx.time.frame === 30) tr.y = -20; // falls into a pit
          const d = recovery.update(1, {
            position: [tr.x, tr.y, tr.z],
            desired: target ? [target.x, target.y, target.z] : null,
            now: ctx.time.t,
          });
          decisions.push(d.kind);
          if (d.kind === 'teleport') {
            tr.x = d.to.x;
            tr.y = d.to.y;
            tr.z = d.to.z;
          } else if (target && tr.y > -1) {
            const boost = d.kind === 'follow' ? 1 : d.boost;
            const step = Math.min(Math.hypot(target.x - tr.x, target.z - tr.z), 4.8 * boost * dt);
            tr.x += Math.sign(target.x - tr.x) * step;
          }
        },
      }),
    ],
  });
  const t = await testScene(scene);
  t.run(2);
  assert.ok(decisions.includes('teleport'));
  const buddy = t.world.get(t.ctx.named('buddy')!, Transform)!;
  const leader = t.world.get(t.ctx.named('leader')!, Transform)!;
  assert.equal(buddy.y, 0, 'back on the trail');
  assert.ok(leader.x - buddy.x > 0 && leader.x - buddy.x < 5, 'behind the leader, within reach');
});
