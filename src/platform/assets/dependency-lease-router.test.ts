import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandover, type SceneEntry} from '../../core/router/handover';
import {createDependencyLease, type DependencyValue} from './dependency-lease';
import {createDependencyBudget} from './dependency-budget';
import {LeaseCache} from './lease-cache';
const tick = () => new Promise<void>(r => setTimeout(r, 0));
test('router critical readiness prevents early activation and superseded closure releases late completion', async () => {
  const activated: string[] = [],
    released: string[] = [];
  let finish!: (v: DependencyValue<string>) => void;
  const h = createHandover({player: () => 'p', firstRender() {}});
  const pending: SceneEntry = {
    id: 'scene.pending',
    label: 'pending',
    load: () => null,
    enter(_module, visit) {
      const owner = createDependencyLease({
        nodes: [{id: 'contact', dependencies: [], bytes: 1}],
        required: ['contact'],
        maxPinnedBytes: 1,
        maxConcurrent: 1,
        signal: visit.signal,
        acquire: () =>
          new Promise<DependencyValue<string>>(r => {
            finish = r;
          }),
      });
      return {
        ready: owner.prepare(1),
        activate() {
          assert.equal(owner.get('contact'), 'ready');
          activated.push('pending');
        },
        leave() {
          owner.dispose();
        },
      };
    },
  };
  const next: SceneEntry = {
    id: 'scene.next',
    label: 'next',
    load: () => null,
    enter: () => ({
      activate() {
        activated.push('next');
      },
      leave() {},
    }),
  };
  const request = h.go(pending);
  await tick();
  assert.deepEqual(activated, []);
  assert.equal(await h.go(next), 'activated');
  finish({
    bytes: 1,
    lease: {
      value: 'ready',
      release() {
        released.push('late');
      },
    },
  });
  assert.equal(await request, 'superseded');
  await tick();
  assert.deepEqual(activated, ['next']);
  assert.deepEqual(released, ['late']);
  h.leave();
});
test('critical preparation failure never activates a destination', async () => {
  let activated = false;
  const h = createHandover({player: () => 'p', firstRender() {}});
  const outcome = await h.go({
    id: 'scene.failed',
    label: 'failed',
    load: () => null,
    enter(_module, visit) {
      const owner = createDependencyLease({
        nodes: [{id: 'contact', dependencies: [], bytes: 1}],
        required: ['contact'],
        maxPinnedBytes: 1,
        maxConcurrent: 1,
        signal: visit.signal,
        acquire: async () => {
          throw Error('failed');
        },
      });
      return {
        ready: owner.prepare(1),
        activate() {
          activated = true;
        },
        leave() {
          owner.dispose();
        },
      };
    },
  });
  assert.equal(outcome, 'failed');
  assert.equal(activated, false);
});
test('dependency preflight retains prior run until critical contact is ready, then releases before entering', async () => {
  const events: string[] = [];
  let finish!: (v: DependencyValue<string>) => void;
  let closure!: ReturnType<typeof createDependencyLease<string>>;
  const h = createHandover({player: () => 'p', firstRender() {}});
  await h.go({
    id: 'scene.previous',
    label: 'previous',
    load: () => null,
    enter: () => ({
      leave() {
        events.push('old-left');
      },
    }),
  });
  const pending = h.go({
    id: 'scene.destination',
    label: 'destination',
    load: () => null,
    prepare(_module, visit) {
      closure = createDependencyLease({
        nodes: [{id: 'contact', dependencies: [], bytes: 1}],
        required: ['contact'],
        maxPinnedBytes: 1,
        maxConcurrent: 1,
        signal: visit.signal,
        acquire: () =>
          new Promise<DependencyValue<string>>(r => {
            finish = r;
          }),
      });
      return closure.prepare(1);
    },
    enter() {
      events.push('new-entered');
      assert.equal(closure.get('contact'), 'ready');
      return {
        leave() {
          closure.dispose();
        },
      };
    },
  });
  await tick();
  assert.deepEqual(events, []);
  assert.equal(h.current()?.scene, 'scene.previous');
  finish({bytes: 1, lease: {value: 'ready', release() {}}});
  assert.equal(await pending, 'activated');
  assert.deepEqual(events, ['old-left', 'new-entered']);
  h.leave();
});
test('failed dependency preflight leaves the previous run alive', async () => {
  let left = false;
  const h = createHandover({player: () => 'p', firstRender() {}});
  await h.go({
    id: 'scene.previous',
    label: 'previous',
    load: () => null,
    enter: () => ({
      leave() {
        left = true;
      },
    }),
  });
  const outcome = await h.go({
    id: 'scene.failed',
    label: 'failed',
    load: () => null,
    prepare(_module, visit) {
      return createDependencyLease({
        nodes: [{id: 'contact', dependencies: [], bytes: 1}],
        required: ['contact'],
        maxPinnedBytes: 1,
        maxConcurrent: 1,
        signal: visit.signal,
        acquire: async () => {
          throw Error('contact failed');
        },
      }).prepare(1);
    },
    enter() {
      throw Error('must not enter');
    },
  });
  assert.equal(outcome, 'failed');
  assert.equal(left, false);
  assert.equal(h.current()?.scene, 'scene.previous');
  h.leave();
});

test('failed candidate cleanup preserves the active scene shared lease through retries and final retirement', async () => {
  const loads: string[] = [],
    disposed: string[] = [],
    budget = createDependencyBudget(4),
    cache = new LeaseCache(
      {
        async fetch(key: string) {
          loads.push(key);
          return {key, usable: true};
        },
        upload: value => value,
        discard() {},
        dispose(value) {
          value.usable = false;
          disposed.push(value.key);
        },
        bytes: () => 1,
      },
      {warmBytes: 0},
    );
  const acquire = async (id: string, signal: AbortSignal) => ({lease: await cache.acquire(id, signal), bytes: 1});
  let active!: ReturnType<typeof createDependencyLease<{key: string; usable: boolean}>>,
    leaves = 0;
  const h = createHandover({player: () => 'p', firstRender() {}});
  try {
    assert.equal(
      await h.go({
        id: 'scene.active',
        label: 'active',
        load: () => null,
        prepare(_module, visit) {
          active = createDependencyLease({
            nodes: [{id: 'shared', dependencies: [], bytes: 1}],
            required: ['shared'],
            maxPinnedBytes: 1,
            maxConcurrent: 1,
            budget,
            signal: visit.signal,
            acquire,
          });
          return active.prepare(1);
        },
        enter: () => ({
          leave() {
            leaves++;
            active.dispose();
          },
        }),
      }),
      'activated',
    );
    const original = active.get('shared')!,
      originalVisit = h.current()!;
    for (let attempt = 0; attempt < 3; attempt++) {
      let fail!: (error: Error) => void, admitted!: () => void;
      const reachedFinal = new Promise<void>(resolve => {
        admitted = resolve;
      });
      const request = h.go({
        id: 'scene.candidate',
        label: 'candidate',
        load: () => null,
        prepare(_module, visit) {
          return createDependencyLease({
            nodes: [
              {id: 'shared', dependencies: [], bytes: 1},
              {id: 'private', dependencies: ['shared'], bytes: 1},
              {id: 'final', dependencies: ['private'], bytes: 1},
            ],
            required: ['final'],
            maxPinnedBytes: 3,
            maxConcurrent: 1,
            budget,
            signal: visit.signal,
            acquire: (id, signal) =>
              id === 'final'
                ? new Promise<DependencyValue<{key: string; usable: boolean}>>((_resolve, reject) => {
                    fail = reject;
                    admitted();
                  })
                : acquire(id, signal),
          }).prepare(1);
        },
        enter() {
          throw Error('failed candidate must not enter');
        },
      });
      await reachedFinal;
      assert.equal(cache.info('shared')?.refs, 2);
      assert.equal(budget.stats.reservedBytes, 4);
      fail(Error('final dependency unavailable'));
      assert.equal(await request, 'failed');
      assert.equal(h.current(), originalVisit);
      assert.equal(originalVisit.current(), true);
      assert.equal(active.get('shared'), original);
      assert.equal(original.usable, true);
      assert.equal(leaves, 0);
      assert.equal(cache.info('shared')?.refs, 1);
      assert.equal(cache.info('private'), undefined);
      assert.equal(budget.stats.reservedBytes, 1);
      assert.deepEqual(disposed, Array(attempt + 1).fill('private'));
    }
    assert.deepEqual(loads, ['shared', 'private', 'private', 'private']);
    h.leave();
    h.leave();
    assert.equal(leaves, 1);
    assert.equal(original.usable, false);
    assert.equal(cache.info('shared'), undefined);
    assert.equal(budget.stats.reservedBytes, 0);
    assert.deepEqual(disposed, ['private', 'private', 'private', 'shared']);
  } finally {
    h.leave();
    cache.evictWarm();
  }
});
