import assert from 'node:assert/strict';
import test from 'node:test';
import {World, component} from '../../core/ecs/world';
import {createSystemRunner} from '../../core/ecs/systems';
import {createWorkRoster, type WorkTicket} from './index';

test('perception uses existing World and runner; replacement during work refuses the old effect', () => {
  const world = new World(),
    Observation = component('observation', {x: 0, near: false, samples: 0});
  const roster = createWorkRoster({maxEntries: 3, maxIdLength: 8});
  const entities = new Map<WorkTicket, number>();
  const register = (id: string) => {
    const result = roster.add(id);
    assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') throw Error('full');
    const entity = world.spawn(Observation({x: id === 'b' ? 20 : 2}));
    entities.set(result.ticket, entity);
    return result.ticket;
  };
  const a = register('a'),
    b = register('b'),
    c = register('c');
  let replace = false,
    replacement: WorkTicket | undefined;
  const runner = createSystemRunner([
    {
      id: 'perception',
      run() {
        const visits = roster.take(1);
        if (visits.status !== 'ready') return;
        for (const ticket of visits.tickets) {
          const entity = entities.get(ticket)!;
          const near = Math.abs(world.get(entity, Observation)!.x) < 5; // Creator distance policy.
          if (replace) {
            replace = false;
            roster.remove(ticket);
            entities.delete(ticket);
            world.despawn(entity);
            replacement = register(ticket.id);
          }
          if (!roster.check(ticket) || !world.exists(entity)) continue;
          const state = world.get(entity, Observation)!;
          state.near = near;
          state.samples++;
          world.touch();
        }
      },
    },
  ]);
  for (let i = 0; i < 3; i++) runner.frame(null, 1 / 60);
  for (const ticket of [a, b, c]) assert.equal(world.get(entities.get(ticket)!, Observation)!.samples, 1);
  assert.equal(world.get(entities.get(a)!, Observation)!.near, true);
  assert.equal(world.get(entities.get(b)!, Observation)!.near, false);
  replace = true;
  runner.frame(null, 1 / 60);
  assert.equal(roster.check(a), false);
  assert.ok(replacement);
  assert.equal(world.get(entities.get(replacement)!, Observation)!.samples, 0);
  for (let i = 0; i < 3; i++) runner.frame(null, 1 / 60);
  assert.equal(world.get(entities.get(replacement)!, Observation)!.samples, 1);
  roster.dispose();
  for (const entity of entities.values()) world.despawn(entity);
  entities.clear();
  runner.frame(null, 1 / 60);
  assert.equal(world.first(Observation), undefined);
  assert.equal(runner.stats.errors, 0);
});

test('inspection retains its own revision authority and lifecycle, independently of membership', () => {
  const roster = createWorkRoster({maxEntries: 2, maxIdLength: 8});
  const sites = new Map<WorkTicket, {revision: number; wear: number; inspected: number}>();
  for (const id of ['press', 'lathe']) {
    const result = roster.add(id);
    if (result.status !== 'accepted') throw Error('admission');
    sites.set(result.ticket, {revision: 1, wear: 4, inspected: 0});
  }
  const pending: {ticket: WorkTicket; revision: number; wear: number}[] = [];
  const runner = createSystemRunner([
    {
      id: 'inspection',
      run() {
        const visits = roster.take(1);
        if (visits.status !== 'ready') return;
        for (const ticket of visits.tickets) {
          const site = sites.get(ticket)!;
          pending.push({ticket, revision: site.revision, wear: site.wear});
        }
      },
    },
  ]);
  const apply = (result: (typeof pending)[number]) => {
    if (!roster.check(result.ticket)) return false;
    const site = sites.get(result.ticket)!;
    if (site.revision !== result.revision) return false;
    site.inspected = result.wear;
    site.revision++;
    return true;
  };
  runner.frame(null, 1 / 60);
  runner.frame(null, 1 / 60);
  const old = pending[0]!,
    other = pending[1]!,
    site = sites.get(old.ticket)!;
  site.wear = 9;
  site.revision++;
  runner.frame(null, 1 / 60);
  const fresh = pending[2]!;
  assert.equal(apply(fresh), true);
  assert.equal(roster.check(old.ticket), true, 'membership is not result freshness');
  assert.equal(apply(old), false);
  assert.equal(apply(fresh), false, 'consumer revision also prevents duplicate application');
  assert.equal(site.inspected, 9);
  assert.equal(apply(other), true);
  roster.dispose();
  sites.clear();
  assert.equal(apply(fresh), false);
  runner.frame(null, 1 / 60);
  assert.equal(pending.length, 3);
  assert.equal(runner.stats.errors, 0);
});
