import {test} from 'node:test';
import assert from 'node:assert/strict';
import {World, component} from '../../core/ecs/world';
import {createSystemRunner} from '../../core/ecs/systems';
import {
  POOL_EVICTED,
  createEntityPool,
  createPoolResult,
  despawnPooled,
  spawnPooled,
  type EntityPoolLimits,
  type PoolEvictedEvent,
} from './index';

test('consumer 1: a fixed-step spawner keeps a triangle budget, evicting far debris before near debris, with events', () => {
  // Creator policy: each class charges its triangle count against a scene budget's triangle headroom.
  const triangleHeadroom = 6000;
  const limits: EntityPoolLimits = {
    maxMembers: 64,
    maxCost: triangleHeadroom,
    maxEvictionsPerAdmit: 32,
    classes: {
      spark: {priority: 0, evictable: true, cost: 20, max: 16, replaceOwn: true},
      debris: {priority: 1, evictable: true, cost: 400, order: 'score'},
      enemy: {priority: 5, cost: 1200, max: 3},
    },
  };
  const world = new World();
  const Pos = component('pos', {x: 0});
  const pool = createEntityPool(limits),
    out = createPoolResult(limits);
  const seen: PoolEvictedEvent[] = [];
  let tick = 0;
  const runner = createSystemRunner<null>(
    [
      {
        id: 'spawn',
        run() {
          tick++;
          // Every tick: two sparks; every 5th: a debris chunk farther out; every 20th: an enemy.
          for (let i = 0; i < 2; i++) spawnPooled(world, pool, 'spark', [Pos({x: 0})], out);
          if (tick % 5 === 0) {
            const e = spawnPooled(world, pool, 'debris', [Pos({x: tick})], out);
            if (e !== undefined) pool.setScore(e, -tick); // farther (larger x) evicted first
          }
          if (tick % 20 === 0) spawnPooled(world, pool, 'enemy', [Pos({x: 0})], out);
        },
      },
      {
        id: 'react',
        run() {
          for (const ev of world.read<PoolEvictedEvent>(POOL_EVICTED)) {
            assert.equal(world.exists(ev.entity), false, 'evicted entities are despawned before the event is read');
            seen.push(ev);
          }
          world.clearEvents();
        },
      },
    ],
    {step: 1 / 60, maxSteps: 4},
  );
  for (let i = 0; i < 120; i++) runner.frame(null, 1 / 60);
  assert.equal(tick, 120);
  const s = pool.stats();
  assert.ok(pool.cost <= triangleHeadroom, 'the triangle headroom is never exceeded');
  assert.equal(s.classes.enemy!.live, 3, 'enemies are admitted up to their class max');
  assert.equal(s.classes.enemy!.refused, 3, 'the fourth to sixth enemies are refused (class max)');
  assert.equal(
    s.classes.spark!.admitted + s.classes.spark!.refused,
    240,
    'every spark request is admitted or counted refused',
  );
  assert.equal(world.count, pool.size, 'every live entity is pooled and every member is alive');
  assert.ok(s.classes.debris!.evicted > 0 && s.classes.spark!.evicted > 0);
  // Remaining debris are the nearest ones: far debris went first.
  const xs = [...world.query(Pos)].map(([e, p]) => (pool.classOf(e) === 'debris' ? p.x : -1)).filter(x => x >= 0);
  const evictedDebris = seen.filter(e => e.class === 'debris').length;
  assert.equal(evictedDebris, s.classes.debris!.evicted, 'one event per eviction');
  assert.ok(xs.length > 0 && Math.max(...xs) < 120, `kept debris are the near ones (${xs})`);
  assert.ok(
    seen.every(e => e.by !== 'spark' || e.class === 'spark'),
    'sparks only ever replace sparks',
  );
  assert.equal(runner.stats.dropped, 0);
});

test('consumer 2: owner recovery — entities despawned outside the pool are swept; despawnPooled releases', () => {
  const limits: EntityPoolLimits = {maxMembers: 8, classes: {prop: {priority: 0, evictable: true}}};
  const world = new World();
  const pool = createEntityPool(limits),
    out = createPoolResult(limits);
  const es = Array.from({length: 8}, () => spawnPooled(world, pool, 'prop', [], out)!);
  despawnPooled(world, pool, es[0]!);
  world.despawn(es[1]!); // a system forgot to release
  world.despawn(es[2]!);
  assert.equal(pool.size, 7);
  assert.equal(
    pool.sweep(e => world.exists(e), 8),
    2,
  );
  assert.equal(pool.size, world.count);
  // A refused spawn spawns nothing.
  const strict = createEntityPool({maxMembers: 1, classes: {a: {priority: 0}}});
  const before = world.count;
  assert.notEqual(spawnPooled(world, strict, 'a', [], out), undefined);
  assert.equal(spawnPooled(world, strict, 'a', [], out), undefined);
  assert.equal(out.status, 'refused');
  assert.equal(world.count, before + 1);
});
