import {test} from 'node:test';
import assert from 'node:assert/strict';
import {World, component} from '../../core/ecs/world';
import {createSystemRunner} from '../../core/ecs/systems';
import {createChunkStore} from '../../core/save/chunk-store';
import {memoryChunkPort} from '../../core/save/chunk-port';
import {createRegionActivation, createRegionUpdateResult, type RegionActivationLimits} from './index';

const limits: RegionActivationLimits = {
  cellSize: 32,
  minX: 0,
  minY: 0,
  maxX: 256,
  maxY: 256,
  maxRegions: 64,
  activateRadius: 8,
  releaseRadius: 24,
  lingerUpdates: 1,
  maxObservers: 2,
  maxActive: 16,
  maxPins: 2,
  maxActivationsPerUpdate: 4,
  maxDeactivationsPerUpdate: 4,
  maxCellsPerObserver: 9,
};

test('consumer 1: a fixed-step system ticks only creatures in active regions and catches up dormant time on wake', () => {
  const world = new World();
  const Creature = component('creature', {x: 0, y: 0, hunger: 0, catchUp: 0});
  const Player = component('player', {x: 16, y: 16});
  const acts = createRegionActivation(limits),
    out = createRegionUpdateResult(limits);
  const near = world.spawn(Creature({x: 20, y: 20})),
    far = world.spawn(Creature({x: 200, y: 200}));
  const player = world.spawn(Player({x: 16, y: 16}));
  acts.addObserver(player, 16, 16);
  const runner = createSystemRunner<null>(
    [
      {
        id: 'region-activation',
        run() {
          const p = world.get(player, Player)!;
          acts.moveObserver(player, p.x, p.y);
          acts.update(out);
          // Creator catch-up policy: a waking region's creatures absorb the dormant span in one bounded step.
          for (let k = 0; k < out.activatedCount; k++) {
            const region = out.activated[k]!,
              span = out.dormantFor[k]!;
            if (span <= 0) continue;
            for (const [, c] of world.query(Creature))
              if (acts.regionAt(c.x, c.y) === region) {
                c.catchUp += span;
                c.hunger += Math.min(span, 10);
              }
          }
        },
      },
      {
        id: 'creatures',
        run() {
          for (const [, c] of world.query(Creature)) if (acts.isActive(acts.regionAt(c.x, c.y))) c.hunger++;
        },
      },
    ],
    {step: 1 / 10, maxSteps: 4},
  );
  for (let i = 0; i < 5; i++) runner.frame(null, 1 / 10);
  assert.equal(world.get(near, Creature)!.hunger, 5, 'the near region is simulated every step');
  assert.equal(world.get(far, Creature)!.hunger, 0, 'the far region is never ticked while dormant');
  // Walk to the far creature: the home region lingers for one update, then sleeps.
  world.get(player, Player)!.x = 200;
  world.get(player, Player)!.y = 200;
  for (let i = 0; i < 5; i++) runner.frame(null, 1 / 10);
  const farState = world.get(far, Creature)!;
  assert.equal(farState.hunger, 5);
  assert.equal(world.get(near, Creature)!.hunger, 6, 'lingerUpdates 1: one more simulated step, then dormant');
  // Come back: the near region wakes and catches up by its dormant span (bounded by the creator's rule).
  world.get(player, Player)!.x = 16;
  world.get(player, Player)!.y = 16;
  runner.frame(null, 1 / 10);
  const nearState = world.get(near, Creature)!;
  assert.equal(nearState.catchUp, 4, 'deactivated at update 7, woken at update 11');
  assert.equal(nearState.hunger, 6 + 4 + 1);
  assert.equal(runner.stats.dropped, 0);
});

test('consumer 2: region records load and save through the chunk store; epochs refuse a load that finishes late', async () => {
  const store = await createChunkStore(memoryChunkPort(), {schema: 1});
  const acts = createRegionActivation(limits),
    out = createRegionUpdateResult(limits);
  const loaded = new Map<number, number>(); // region -> visit count held in memory while active
  const pending: Promise<void>[] = [];
  const key = (region: number) => `region:${region}`;
  const revision = new Map<number, number>();
  function apply(result: typeof out) {
    for (let k = 0; k < result.deactivatedCount; k++) {
      const region = result.deactivated[k]!,
        visits = loaded.get(region);
      if (visits === undefined) continue; // its load never completed
      loaded.delete(region);
      const next = (revision.get(region) ?? 0) + 1;
      revision.set(region, next);
      pending.push(
        store.write([{key: key(region), revision: next, data: Uint8Array.of(visits)}]).then(r => {
          assert.equal(r.status, 'saved');
        }),
      );
    }
    for (let k = 0; k < result.activatedCount; k++) {
      const region = result.activated[k]!,
        epoch = acts.epochOf(region);
      pending.push(
        store.read(key(region)).then(r => {
          if (acts.epochOf(region) !== epoch || !acts.isActive(region)) return; // stale: region slept meanwhile
          loaded.set(region, (r.status === 'found' ? r.data[0]! : 0) + 1);
        }),
      );
    }
  }
  const settle = async () => {
    await Promise.all(pending.splice(0));
  };
  acts.addObserver(1, 16, 16);
  apply(acts.update(out));
  await settle();
  assert.equal(loaded.get(0), 1);
  // Leave and let region 0 sleep: its state is written.
  acts.moveObserver(1, 240, 240);
  apply(acts.update(out));
  apply(acts.update(out));
  await settle();
  assert.equal(loaded.has(0), false);
  // Return, then leave again before the load resolves: the late result is refused by epoch, nothing leaks.
  acts.moveObserver(1, 16, 16);
  apply(acts.update(out));
  acts.moveObserver(1, 240, 240);
  apply(acts.update(out));
  apply(acts.update(out));
  await settle();
  assert.equal(loaded.has(0), false, 'the stale load did not resurrect a dormant region');
  // A normal visit resumes from the saved count.
  acts.moveObserver(1, 16, 16);
  apply(acts.update(out));
  await settle();
  assert.equal(loaded.get(0), 2);
  store.close();
});
