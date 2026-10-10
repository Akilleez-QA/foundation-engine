import {test} from 'node:test';
import assert from 'node:assert/strict';
import {World, component} from '../../core/ecs/world';
import {createSystemRunner} from '../../core/ecs/systems';
import {createInterestResult, createInterestSets, createSpatialGrid} from '../spatial/index';
import {createCadence, createCadenceResult} from './index';

test('consumer 1: a fixed-step system thinks near agents every tick and far agents every 8, integrating elapsed ticks', () => {
  const world = new World();
  const Agent = component('agent', {x: 0, v: 1, thinks: 0, period: 1});
  const limits = {maxMembers: 64, maxDuePerTake: 64, maxPeriod: 8};
  const cadence = createCadence(limits),
    out = createCadenceResult(limits);
  const agents = Array.from({length: 40}, (_, i) => world.spawn(Agent({x: i * 10})));
  // Creator policy: period by distance to the origin (where the observer stands).
  const periodFor = (x: number) => (x < 100 ? 1 : 8);
  for (const e of agents) {
    const a = world.get(e, Agent)!;
    a.period = periodFor(a.x);
    cadence.add(e, a.period);
  }
  let tick = 0;
  const runner = createSystemRunner<null>(
    [
      {
        id: 'think',
        run() {
          tick++;
          cadence.take(tick, out);
          for (let k = 0; k < out.count; k++) {
            const e = out.ids[k]!,
              a = world.get(e, Agent)!;
            a.x += a.v * out.elapsed[k]!; // elapsed ticks since this agent last thought
            a.thinks++;
            const p = periodFor(a.x);
            if (p !== a.period) cadence.setPeriod(e, (a.period = p)); // crossed a distance band
          }
        },
      },
    ],
    {step: 1 / 20, maxSteps: 4},
  );
  for (let i = 0; i < 80; i++) runner.frame(null, 1 / 20);
  const near = world.get(agents[0]!, Agent)!,
    far = world.get(agents[30]!, Agent)!;
  assert.equal(near.thinks, 80, 'near agents think every tick');
  assert.ok(far.thinks <= 11 && far.thinks >= 9, `far agents think about every 8 ticks (${far.thinks})`);
  // Integration by elapsed keeps far agents consistent: displacement = ticks up to their last serve.
  assert.ok(far.x - 300 <= 80 && far.x - 300 > 80 - 8);
  assert.equal(runner.stats.dropped, 0);
});

test('consumer 2: interest-set members get refresh cadence by distance band; leaving removes the schedule', () => {
  const grid = createSpatialGrid({
    cellSize: 16,
    minX: 0,
    minY: 0,
    maxX: 512,
    maxY: 512,
    maxEntries: 256,
    maxCells: 1024,
    maxCellsPerQuery: 256,
  });
  const il = {
    enterRadius: 96,
    exitRadius: 104,
    holdUpdates: 0,
    maxObservers: 1,
    maxRelevant: 32,
    maxCandidates: 128,
    maxPrioritized: 1,
  };
  const sets = createInterestSets(grid, il),
    iout = createInterestResult(il);
  const cl = {maxMembers: 32, maxDuePerTake: 32, maxPeriod: 6};
  const refresh = createCadence(cl),
    cout = createCadenceResult(cl);
  for (let id = 1; id <= 20; id++) grid.insert(id, 10 + id * 8, 10);
  sets.addObserver(0, 10, 10);
  const refreshed = new Map<number, number>();
  const band = (id: number) => (grid.distanceSquared(id, 10, 10) <= 32 * 32 ? 1 : 6);
  for (let t = 1; t <= 30; t++) {
    sets.update(0, iout);
    for (let k = 0; k < iout.enteredCount; k++) refresh.add(iout.entered[k]!, band(iout.entered[k]!));
    for (let k = 0; k < iout.leftCount; k++) refresh.remove(iout.left[k]!);
    refresh.take(t, cout);
    for (let k = 0; k < cout.count; k++) refreshed.set(cout.ids[k]!, (refreshed.get(cout.ids[k]!) ?? 0) + 1);
    if (t === 15) sets.moveObserver(0, 500, 500); // everything leaves
  }
  assert.equal(refreshed.get(1), 15, 'near members refresh every tick while relevant');
  assert.ok((refreshed.get(10) ?? 0) >= 2 && (refreshed.get(10) ?? 0) <= 3, 'far members refresh about every 6 ticks');
  assert.equal(refreshed.has(15), false, 'never-relevant ids are never scheduled');
  assert.equal(refresh.stats.members, 0, 'left members were removed with the interest set');
});
