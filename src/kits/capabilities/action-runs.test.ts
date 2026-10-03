import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionRuns } from './action-runs';
import { resolveAction } from '../combat';
import { defineScene, defineSystem, testScene } from '../../author';
import { must } from '../../testing/must';

const input = (id = 'scene-1:scan') => ({ id, owner: 'actor', readyAt: 2, expiresAt: 5 });

test('action timing separates readiness, acknowledgement, expiry and stable terminal identity', () => {
  const runs = createActionRuns({ now: 0, maxActions: 2 });
  const source = input();
  const admitted = runs.admit(source);
  assert.equal(admitted.kind, 'admitted');
  source.readyAt = -1;
  assert.equal(runs.get(source.id)?.readyAt, 2);
  assert.deepEqual(runs.acknowledge(source.id, 0), { kind: 'not-ready' });
  assert.deepEqual(runs.advance(1), []);
  const ready = must(runs.advance(2)[0], 'ready run');
  assert.equal(ready.state, 'ready');
  assert.equal(ready.revision, 1);
  assert.deepEqual(runs.acknowledge(ready.id, 0), { kind: 'stale' });
  assert.equal(runs.acknowledge(ready.id, 1).kind, 'applied');
  assert.equal(runs.get(ready.id)?.state, 'completed');
  assert.equal(ready.state, 'ready', 'previous snapshot is unchanged');
  assert.equal(runs.admit(input()).kind, 'duplicate');
  assert.equal(runs.admit({ ...input(), owner: 'other' }).kind, 'conflict');
  assert.equal(runs.acknowledge(ready.id, 2).kind, 'terminal');
  assert.equal(runs.admit(input('second')).kind, 'admitted');
  assert.equal(runs.admit(input('third')).kind, 'capacity');
  assert.equal(must(runs.advance(5)[0]).state, 'expired');
  assert.equal(runs.admit(input('late')).kind, 'expired');
  assert.equal(runs.size, 2);
});

test('action cancellation isolates owner and rejects late completion or reused identity', () => {
  const runs = createActionRuns({ now: 0 });
  runs.admit(input('old'));
  runs.admit({ ...input('other'), owner: 'other' });
  const pending = runs.get('old')!;
  assert.equal(runs.cancelOwner('actor').length, 1);
  assert.deepEqual(runs.cancelOwner('actor'), []);
  assert.equal(runs.acknowledge('old', pending.revision).kind, 'stale');
  assert.equal(runs.admit({ ...input('old'), readyAt: 3 }).kind, 'conflict');
  runs.admit(input('new'));
  assert.deepEqual(runs.advance(2).map(a => a.id), ['other', 'new']);
  assert.equal(runs.get('old')?.state, 'cancelled');
  assert.equal(runs.cancel('new', 1).kind, 'applied');
  assert.equal(runs.cancel('new', 2).kind, 'terminal');
  assert.equal(runs.cancel('unknown', 0).kind, 'missing');
});

test('action inputs, monotonic time and returned facts are validated and immutable', () => {
  for (const maxActions of [0, -1, 1.5, Infinity, 65537]) assert.throws(() => createActionRuns({ now: 0, maxActions }));
  assert.throws(() => createActionRuns({ now: NaN }));
  const runs = createActionRuns({ now: 0 });
  for (const bad of [{ id: '' }, { owner: 'x'.repeat(257) }, { readyAt: NaN }, { expiresAt: 2 }]) assert.throws(() => runs.admit({ ...input(), ...bad }));
  const a = runs.admit(input());
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(runs.get(input().id)));
  const events = runs.advance(2);
  assert.ok(Object.isFrozen(events));
  assert.ok(Object.isFrozen(events[0]));
  for (const now of [1, NaN, Infinity]) assert.throws(() => runs.advance(now));
  assert.equal(runs.now, 2);
  assert.equal(runs.get(input().id)?.state, 'ready');
  assert.throws(() => runs.acknowledge(input().id, -1));
  assert.throws(() => runs.cancelOwner(''));
  assert.deepEqual(runs.advance(2), []);
  const jumped = createActionRuns({ now: 0 });
  jumped.admit(input());
  assert.equal(must(jumped.advance(5)[0]).state, 'expired', 'jump across both boundaries never exposes ready');
});

test('admission captures getters once and prevents reentrant mutation before publication', () => {
  const runs = createActionRuns({ now: 0 });
  let reads = 0;
  const value = { ...input(), get owner() { reads++; assert.throws(() => runs.advance(3), /reentrant/); return 'actor'; } };
  assert.equal(runs.admit(value).kind, 'admitted');
  assert.equal(reads, 1);
  assert.equal(runs.now, 0);
  assert.throws(() => runs.admit({ ...input('bad'), get owner(): string { runs.cancelOwner('actor'); return 'actor'; } }), /reentrant/);
  assert.equal(runs.size, 1);
  assert.equal(runs.admit(input('recovered')).kind, 'admitted');
});

test('intended-use: delayed probe composes with creator resolution, decline/retry and owner cancellation', () => {
  const runs = createActionRuns({ now: 0 });
  let acceptedTags = 0, allowPublication = false;
  const attempt = (id: string) => {
    const action = runs.get(id);
    if (action?.state !== 'ready') return null;
    return resolveAction({ id, target: 'sample', amount: 1 }, {
      eligible: () => true, hit: () => true, mitigate: amount => amount,
      commit(result) {
        // Prepare a pure candidate first. Acknowledge and assign synchronously, without a yield.
        const candidate = acceptedTags + result.applied;
        if (!allowPublication || runs.acknowledge(id, action.revision).kind !== 'applied') return false;
        acceptedTags = candidate;
        return true;
      },
    });
  };
  runs.admit(input('cancelled'));
  const late = runs.get('cancelled')!;
  runs.cancelOwner('actor');
  runs.admit(input('current'));
  assert.equal(attempt('current'), null);
  runs.advance(2);
  assert.equal(runs.acknowledge(late.id, late.revision).kind, 'stale');
  assert.equal(attempt('cancelled'), null);
  assert.equal(attempt('current'), null, 'creator declined publication');
  assert.equal(runs.get('current')?.state, 'ready', 'declined outcome remains retryable');
  allowPublication = true;
  assert.equal(attempt('current')?.applied, 1);
  assert.equal(attempt('current'), null);
  assert.equal(acceptedTags, 1);
  runs.admit(input('expired'));
  runs.advance(5);
  assert.equal(attempt('expired'), null);
  assert.equal(acceptedTags, 1);
});


test('headless scene supplies action time and retires runs on exit without a second clock', async () => {
  const runs = createActionRuns({ now: 0 });
  runs.admit({ id: 'scene-1:calibration', owner: 'instrument', readyAt: .5, expiresAt: 2 });
  let accepted = 0;
  const scene = await testScene(defineScene({ id: 'action-consumer', title: 'action.title',
    systems: [defineSystem({ id: 'action-consumer', phase: 'frame', run(ctx) {
      runs.advance(ctx.time.t);
      const ready = runs.get('scene-1:calibration');
      if (ready?.state === 'ready' && runs.acknowledge(ready.id, ready.revision).kind === 'applied') accepted++;
    } })],
    exit() { runs.cancelOwner('instrument'); },
  }));
  scene.run(.25);
  assert.equal(accepted, 0);
  scene.run(.3);
  assert.equal(accepted, 1);
  assert.equal(runs.now, scene.ctx.time.t);
  runs.admit({ id: 'scene-1:later', owner: 'instrument', readyAt: 1, expiresAt: 2 });
  const late = runs.get('scene-1:later')!;
  scene.dispose();
  runs.advance(1.5);
  assert.equal(runs.get(late.id)?.state, 'cancelled');
  assert.equal(runs.acknowledge(late.id, late.revision).kind, 'stale');
  assert.equal(accepted, 1);
});
