import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityHost, type ActivityContext} from '../../core/activity/activity';
import {FrameLoop} from '../../core/activity/loop';
import {World, component} from '../../core/ecs/world';
import {createAssignments} from '../assignments/ledger';
import {createNavigationGraph} from './search';
import {createDistanceField, type FieldSearch, type NavigationField} from './field';

// Fixture-only publication record: the creator owns accepted topology/goals and adoption.
// This is deliberately not another exported dependency or scheduling owner.
for (const consumer of ['exit-choice', 'service-claim'] as const) {
  test(`${consumer}: actual activity lifetime rejects replaced and completed stale fields`, async () => {
    const pending = new Map<number, (t: number) => void>();
    let serial = 0,
      time = 0;
    const layers = {
      coverage: () => 'top' as const,
      onChange: () => () => {},
      closeOwned: () => {},
      push: () => {
        throw Error('fixture uses no visual layer');
      },
    };
    const errors: unknown[] = [];
    const loop = new FrameLoop({
      layers,
      calm: () => false,
      now: () => time,
      scheduler: {
        request: fn => {
          pending.set(++serial, fn);
          return serial;
        },
        cancel: id => {
          pending.delete(id);
        },
      },
    });
    const host = new ActivityHost({loop, layers, calm: () => false, report: (_, e) => errors.push(e)});
    const graph = createNavigationGraph([
      {
        id: 'origin',
        edges: [
          {to: 'east', cost: 1},
          {to: 'west', cost: 2},
        ],
      },
      {id: 'east', edges: []},
      {id: 'west', edges: []},
    ]);
    const world = new World();
    const Choice = component('field-choice', {next: ''});
    const agents = [world.spawn(Choice()), world.spawn(Choice())];
    const claims = createAssignments();
    const actor = claims.addActor('delivery');
    const east = claims.addTarget('east', 1),
      west = claims.addTarget('west', 1);
    assert.ok(actor.status === 'added' && east.status === 'added' && west.status === 'added');
    type Record = {search: FieldSearch; graph: typeof graph; goals: readonly string[]; owner: ActivityContext};
    let current: Record | undefined,
      context: ActivityContext | undefined,
      applied = 0;
    let accepted: NavigationField | undefined;
    const replace = (goals: readonly string[], topology = graph) => {
      if (!context) throw Error('consumer has no visit');
      current?.search.cancel();
      current = {graph: topology, goals, owner: context, search: createDistanceField(topology, goals)};
      return current;
    };
    const adopt = (record: Record) => {
      if (
        !context ||
        context.leaving() ||
        context.signal.aborted ||
        record.owner !== context ||
        current !== record ||
        record.search.result.status !== 'complete'
      )
        return false;
      accepted = record.search.result.field;
      applied++;
      return true;
    };
    const run = await host.start(
      {
        id: 'field-consumer',
        kind: 'scene',
        enter(ctx) {
          context = ctx;
          ctx.own(() => current?.search.cancel());
          return {
            frameMode: 'continuous',
            update() {
              const record = current;
              if (record?.search.result.status === 'pending') {
                record.search.step(2);
                adopt(record);
              }
            },
          };
        },
      },
      undefined,
    );
    const pump = () => {
      time += 16;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const fn of callbacks) fn(time);
    };
    const oldPending = replace(['east']);
    pump();
    assert.equal(oldPending.search.result.status, 'pending');
    const newerGraph = createNavigationGraph(graph.nodes);
    const first = replace(['west'], newerGraph);
    assert.equal(oldPending.search.result.status, 'cancelled');
    assert.equal(adopt(oldPending), false);
    for (let i = 0; i < 100 && !accepted; i++) pump();
    assert.equal(applied, 1);
    assert.equal(accepted?.graph, newerGraph);
    assert.equal(accepted?.get('origin')?.status, 'reachable');
    if (consumer === 'exit-choice') {
      const label = accepted!.get('origin');
      assert.ok(label?.status === 'reachable');
      for (const agent of agents) world.get(agent, Choice)!.next = label.next;
      assert.deepEqual(
        agents.map(a => world.get(a, Choice)!.next),
        ['west', 'west'],
      );
    } else {
      const label = accepted!.get('origin');
      assert.ok(label?.status === 'reachable');
      const result = claims.claim(actor.handle, label.next === 'west' ? west.handle : east.handle);
      assert.equal(result.status, 'claimed');
      assert.equal(claims.snapshot().claims[0]?.target, 'west');
    }
    // A complete snapshot survives cancellation as data, but cannot replace newer authority.
    replace(['east']);
    assert.equal(first.search.result.status, 'complete');
    assert.equal(adopt(first), false);
    const retained = current!;
    while (retained.search.result.status === 'pending') retained.search.step(10);
    run.stop('replaced');
    await run.done;
    assert.equal(adopt(retained), false, 'completed old result refused after actual owner retirement');
    const replacement = await host.start(
      {
        id: 'field-consumer',
        kind: 'scene',
        enter(ctx) {
          context = ctx;
          ctx.own(() => current?.search.cancel());
          return {};
        },
      },
      undefined,
    );
    assert.equal(adopt(retained), false, 'same-name new visit cannot adopt the old record');
    const pendingAtExit = replace(['east']);
    pendingAtExit.search.step(1);
    replacement.stop('exit');
    await replacement.done;
    assert.equal(pendingAtExit.search.result.status, 'cancelled');
    assert.equal(applied, 1);
    assert.deepEqual(errors, []);
    claims.dispose();
    loop.dispose();
  });
}
