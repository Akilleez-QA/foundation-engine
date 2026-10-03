import test from 'node:test';
import assert from 'node:assert/strict';
import {createDependencyLease, type DependencyValue} from './dependency-lease';
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
test('critical closure gates readiness and releases dependents before prerequisites', async () => {
  const released: string[] = [];
  const d = createDependencyLease({
    nodes: [
      {id: 'frame', dependencies: [], bytes: 1},
      {id: 'collision', dependencies: ['frame'], bytes: 1},
      {id: 'decor', dependencies: ['frame'], bytes: 1},
    ],
    required: ['collision'],
    maxConcurrent: 2,
    maxPinnedBytes: 3,
    acquire: async id => {
      if (id === 'decor') throw Error('optional');
      return {
        bytes: 1,
        lease: {
          value: id,
          release() {
            released.push(id);
          },
        },
      };
    },
  });
  for (let i = 0; i < 6; i++) {
    d.pump(8);
    await flush();
  }
  assert.equal(d.status, 'partial');
  assert.equal(d.get('collision'), 'collision');
  d.dispose();
  assert.deepEqual(released, ['collision', 'frame']);
});
test('rejects cycles and pinned admission before calling loader; late completion disposed once', async () => {
  let acquired = 0;
  assert.throws(() =>
    createDependencyLease({
      nodes: [{id: 'a', dependencies: ['a'], bytes: 1}],
      required: ['a'],
      maxPinnedBytes: 1,
      maxConcurrent: 1,
      acquire: async () => {
        acquired++;
        throw Error();
      },
    }),
  );
  assert.equal(acquired, 0);
  let complete!: (v: DependencyValue<number>) => void,
    released = 0;
  const d = createDependencyLease<number>({
    nodes: [{id: 'a', dependencies: [], bytes: 1}],
    required: ['a'],
    maxPinnedBytes: 1,
    maxConcurrent: 1,
    acquire: () =>
      new Promise(r => {
        complete = r;
      }),
  });
  d.pump(1);
  await flush();
  d.dispose();
  complete({
    bytes: 1,
    lease: {
      value: 1,
      release() {
        released++;
      },
    },
  });
  await flush();
  assert.equal(released, 1);
  assert.equal(d.status, 'closed');
});
test('required failure closes all admission and releases ready prerequisites', async () => {
  let released = 0;
  const d = createDependencyLease({
    nodes: [
      {id: 'a', dependencies: [], bytes: 1},
      {id: 'b', dependencies: ['a'], bytes: 1},
    ],
    required: ['b'],
    maxPinnedBytes: 2,
    maxConcurrent: 1,
    acquire: async id => {
      if (id === 'b') throw Error('critical');
      return {
        bytes: 1,
        lease: {
          value: 1,
          release() {
            released++;
          },
        },
      };
    },
  });
  for (let i = 0; i < 6; i++) {
    d.pump(4);
    await flush();
  }
  assert.equal(d.status, 'failed');
  assert.equal(released, 1);
});
test('shared existing cache lease survives one closure owner leaving', async () => {
  const {LeaseCache} = await import('./lease-cache');
  let disposed = 0,
    loads = 0;
  const cache = new LeaseCache(
    {
      fetch: async () => {
        loads++;
        return {};
      },
      upload: d => d,
      discard() {},
      dispose() {
        disposed++;
      },
      bytes: () => 1,
    },
    {warmBytes: 0},
  );
  const make = () =>
    createDependencyLease({
      nodes: [{id: 'shared', dependencies: [], bytes: 1}],
      required: ['shared'],
      maxPinnedBytes: 1,
      maxConcurrent: 1,
      acquire: async (id, signal) => ({lease: await cache.acquire(id, signal), bytes: 1}),
    });
  const a = make(),
    b = make();
  a.pump(1);
  b.pump(1);
  await flush();
  await flush();
  a.pump(1);
  b.pump(1);
  assert.equal(a.status, 'ready');
  assert.equal(b.status, 'ready');
  assert.equal(loads, 1);
  a.dispose();
  assert.equal(disposed, 0);
  b.dispose();
  assert.equal(disposed, 1);
});
test('preparation awaits required dependencies without a second scheduler and abort rejects', async () => {
  const abort = new AbortController();
  let finish!: (v: DependencyValue<number>) => void;
  const d = createDependencyLease<number>({
    nodes: [{id: 'a', dependencies: [], bytes: 1}],
    required: ['a'],
    maxPinnedBytes: 1,
    maxConcurrent: 1,
    signal: abort.signal,
    acquire: () =>
      new Promise(r => {
        finish = r;
      }),
  });
  const pending = d.prepare(1);
  await flush();
  abort.abort();
  await assert.rejects(pending, /closed/);
  let released = 0;
  finish({
    bytes: 1,
    lease: {
      value: 1,
      release() {
        released++;
      },
    },
  });
  await flush();
  assert.equal(released, 1);
});

test('shared closure admission rejects before acquiring and returns capacity after dispose', async () => {
  const {createDependencyBudget} = await import('./dependency-budget');
  const budget = createDependencyBudget(3);
  let acquired = 0;
  const make = () =>
    createDependencyLease({
      nodes: [{id: 'a', dependencies: [], bytes: 2}],
      required: ['a'],
      maxPinnedBytes: 2,
      maxConcurrent: 1,
      budget,
      acquire: async () => {
        acquired++;
        return {bytes: 1, lease: {value: 1, release() {}}};
      },
    });
  const first = make();
  assert.throws(make, /admission exceeded/);
  assert.equal(acquired, 0);
  await first.prepare();
  assert.equal(budget.stats.reservedBytes, 2);
  assert.equal(acquired, 1);
  first.dispose();
  const next = make();
  await next.prepare();
  next.dispose();
  assert.equal(acquired, 2);
  assert.equal(budget.stats.reservedBytes, 0);
  assert.equal(budget.stats.owners, 0);
});
test('cancelled in-flight ownership holds shared capacity until its late value is released', async () => {
  const {createDependencyBudget} = await import('./dependency-budget');
  const budget = createDependencyBudget(2);
  let finish!: (value: DependencyValue<number>) => void,
    released = 0;
  const d = createDependencyLease({
    nodes: [{id: 'a', dependencies: [], bytes: 2}],
    required: ['a'],
    maxPinnedBytes: 2,
    maxConcurrent: 1,
    budget,
    acquire: () =>
      new Promise<DependencyValue<number>>(resolve => {
        finish = resolve;
      }),
  });
  d.pump(1);
  await flush();
  d.dispose();
  d.dispose();
  assert.equal(d.stats.active, 1);
  assert.equal(d.stats.reservedBytes, 2);
  assert.throws(() => budget.reserve(1), /admission exceeded/);
  finish({
    bytes: 2,
    lease: {
      value: 1,
      release() {
        released++;
        assert.equal(budget.stats.reservedBytes, 2);
        throw Error('release');
      },
    },
  });
  await flush();
  assert.equal(released, 1);
  assert.equal(d.stats.releaseErrors, 1);
  assert.equal(d.stats.active, 0);
  assert.equal(d.stats.reservedBytes, 0);
  assert.equal(budget.stats.reservedBytes, 0);
});
test('critical failure releases completed values but retains other outstanding admission', async () => {
  const {createDependencyBudget} = await import('./dependency-budget');
  const budget = createDependencyBudget(3);
  let reject!: (error: Error) => void,
    released = 0;
  const d = createDependencyLease({
    nodes: [
      {id: 'a', dependencies: [], bytes: 1},
      {id: 'b', dependencies: [], bytes: 1},
      {id: 'c', dependencies: [], bytes: 1},
    ],
    required: ['a'],
    maxPinnedBytes: 3,
    maxConcurrent: 3,
    budget,
    acquire: async id => {
      if (id === 'a') throw Error('required');
      if (id === 'c')
        return new Promise<DependencyValue<number>>((_resolve, r) => {
          reject = r;
        });
      return {
        bytes: 1,
        lease: {
          value: 1,
          release() {
            released++;
            throw Error('release');
          },
        },
      };
    },
  });
  d.pump(3);
  await flush();
  d.pump(3);
  assert.equal(d.status, 'failed');
  assert.equal(released, 0);
  assert.equal(d.stats.active, 1);
  assert.equal(budget.stats.reservedBytes, 3);
  reject(Error('late failure'));
  await flush();
  assert.equal(d.stats.active, 0);
  assert.equal(budget.stats.reservedBytes, 0);
  assert.equal(released, 1);
  assert.equal(d.stats.releaseErrors, 1);
});
test('aborted and invalid closures never reserve shared capacity', async () => {
  const {createDependencyBudget} = await import('./dependency-budget');
  const budget = createDependencyBudget(1);
  let acquired = 0;
  const options = {
    nodes: [{id: 'a', dependencies: [], bytes: 1}],
    required: ['a'],
    maxPinnedBytes: 1,
    maxConcurrent: 1,
    budget,
    acquire: async () => {
      acquired++;
      throw Error('unexpected');
    },
  };
  assert.throws(() => createDependencyLease({...options, required: ['missing']}), /missing critical/);
  const abort = new AbortController();
  abort.abort();
  const d = createDependencyLease({...options, signal: abort.signal});
  await assert.rejects(d.prepare(), /closed/);
  assert.equal(acquired, 0);
  assert.equal(budget.stats.owners, 0);
});
test('dispose before queued acquire executes releases admission only after cancellation settles', async () => {
  const {createDependencyBudget} = await import('./dependency-budget');
  const budget = createDependencyBudget(1);
  let acquired = 0;
  const d = createDependencyLease({
    nodes: [{id: 'a', dependencies: [], bytes: 1}],
    required: ['a'],
    maxPinnedBytes: 1,
    maxConcurrent: 1,
    budget,
    acquire: async () => {
      acquired++;
      throw Error('unexpected');
    },
  });
  d.pump(1);
  d.dispose();
  assert.equal(budget.stats.reservedBytes, 1);
  await flush();
  assert.equal(acquired, 0);
  assert.equal(budget.stats.reservedBytes, 0);
});
test('dispose releases unpublished completed dependents before their published prerequisites', async () => {
  const released: string[] = [];
  const d = createDependencyLease({
    nodes: [
      {id: 'a', dependencies: [], bytes: 1},
      {id: 'b', dependencies: ['a'], bytes: 1},
    ],
    required: ['b'],
    maxPinnedBytes: 2,
    maxConcurrent: 1,
    acquire: async id => ({
      bytes: 1,
      lease: {
        value: id,
        release() {
          released.push(id);
        },
      },
    }),
  });
  d.pump(2);
  await flush();
  d.pump(4);
  await flush();
  assert.equal(d.get('a'), 'a');
  assert.equal(d.get('b'), undefined);
  d.dispose();
  assert.deepEqual(released, ['b', 'a']);
  assert.equal(d.stats.active, 0);
});
test('one-work preparation starts independent required acquisition despite unresolved optional work', async () => {
  let optional!: (value: DependencyValue<number>) => void;
  const d = createDependencyLease({
    nodes: [
      {id: 'optional', dependencies: [], bytes: 1},
      {id: 'required', dependencies: [], bytes: 1},
    ],
    required: ['required'],
    maxPinnedBytes: 2,
    maxConcurrent: 2,
    acquire: async id =>
      id === 'optional'
        ? new Promise<DependencyValue<number>>(r => {
            optional = r;
          })
        : {bytes: 1, lease: {value: 1, release() {}}},
  });
  await d.prepare(1);
  assert.equal(d.status, 'partial');
  assert.equal(d.get('required'), 1);
  d.pump(4);
  await flush();
  d.dispose();
  optional({bytes: 1, lease: {value: 1, release() {}}});
  await flush();
});
test('depth limit is independent of declaration order and checked before shared admission', async () => {
  const {createDependencyBudget} = await import('./dependency-budget');
  const budget = createDependencyBudget(100);
  const nodes = Array.from({length: 66}, (_, i) => ({id: String(i), dependencies: i ? [String(i - 1)] : [], bytes: 1}));
  for (const rows of [nodes, [...nodes].reverse()])
    assert.throws(
      () =>
        createDependencyLease({
          nodes: rows,
          required: ['65'],
          maxPinnedBytes: 100,
          maxConcurrent: 1,
          budget,
          acquire: async () => {
            throw Error('unexpected');
          },
        }),
      /invalid graph/,
    );
  assert.equal(budget.stats.owners, 0);
});
test('cancellation aborts before cleanup and holds prerequisites through late dependent completion', async () => {
  const {createDependencyBudget} = await import('./dependency-budget');
  const budget = createDependencyBudget(2);
  let prerequisiteAlive = false,
    finish!: (value: DependencyValue<string>) => void;
  const released: string[] = [];
  const d = createDependencyLease({
    nodes: [
      {id: 'a', dependencies: [], bytes: 1},
      {id: 'b', dependencies: ['a'], bytes: 1},
    ],
    required: ['b'],
    maxPinnedBytes: 2,
    maxConcurrent: 1,
    budget,
    acquire: async (id, signal) => {
      if (id === 'a') {
        prerequisiteAlive = true;
        return {
          bytes: 1,
          lease: {
            value: id,
            release() {
              assert.equal(signal.aborted, false);
              prerequisiteAlive = false;
              released.push(id);
            },
          },
        };
      }
      signal.addEventListener('abort', () => assert.equal(prerequisiteAlive, true), {once: true});
      return new Promise<DependencyValue<string>>(resolve => {
        finish = resolve;
      });
    },
  });
  d.pump(2);
  await flush();
  d.pump(4);
  await flush();
  d.dispose();
  assert.equal(prerequisiteAlive, true);
  assert.equal(d.get('a'), undefined);
  assert.equal(budget.stats.reservedBytes, 2);
  assert.equal(released.length, 0);
  finish({
    bytes: 1,
    lease: {
      value: 'b',
      release() {
        assert.equal(prerequisiteAlive, true);
        released.push('b');
        throw Error('cleanup failure');
      },
    },
  });
  await flush();
  assert.equal(prerequisiteAlive, false);
  assert.deepEqual(released, ['b', 'a']);
  assert.equal(d.stats.releaseErrors, 1);
  assert.equal(budget.stats.reservedBytes, 0);
});
test('invalid optional value cleanup can cancel reentrantly without admitting more work', async () => {
  const {createDependencyBudget} = await import('./dependency-budget');
  const budget = createDependencyBudget(2);
  let acquired = 0;
  const d = createDependencyLease({
    nodes: [
      {id: 'invalid', dependencies: [], bytes: 1},
      {id: 'next', dependencies: [], bytes: 1},
    ],
    required: [],
    maxPinnedBytes: 2,
    maxConcurrent: 1,
    budget,
    acquire: async () => {
      acquired++;
      return {
        bytes: 2,
        lease: {
          value: 1,
          release() {
            d.dispose();
            assert.equal(d.pump(4), 0);
          },
        },
      };
    },
  });
  d.pump(1);
  await flush();
  d.pump(4);
  await flush();
  assert.equal(d.status, 'closed');
  assert.equal(acquired, 1);
  assert.equal(d.stats.active, 0);
  assert.equal(budget.stats.owners, 0);
});
test('ordinary cleanup tolerates reentrant disposal and throwing release without a shared budget', async () => {
  const released: string[] = [];
  const d = createDependencyLease({
    nodes: [
      {id: 'a', dependencies: [], bytes: 1},
      {id: 'b', dependencies: ['a'], bytes: 1},
    ],
    required: ['b'],
    maxPinnedBytes: 2,
    maxConcurrent: 1,
    acquire: async id => ({
      bytes: 1,
      lease: {
        value: id,
        release() {
          released.push(id);
          d.dispose();
          assert.equal(d.pump(3), 0);
          throw Error('cleanup');
        },
      },
    }),
  });
  await d.prepare(1);
  d.dispose();
  d.dispose();
  assert.deepEqual(released, ['b', 'a']);
  assert.deepEqual(d.stats, {reservedBytes: 0, active: 0, ready: 0, releaseErrors: 2});
});
for (const publishDependent of [false, true])
  test(`signal-bound cache leases release in dependency order with dependent published=${publishDependent}`, async () => {
    const {LeaseCache} = await import('./lease-cache');
    const released: string[] = [];
    const cache = new LeaseCache(
      {
        fetch: async (key: string) => ({key}),
        upload: value => value,
        discard() {},
        dispose(value) {
          released.push(value.key);
        },
        bytes: () => 1,
      },
      {warmBytes: 0},
    );
    const d = createDependencyLease({
      nodes: [
        {id: 'a', dependencies: [], bytes: 1},
        {id: 'b', dependencies: ['a'], bytes: 1},
      ],
      required: ['b'],
      maxPinnedBytes: 2,
      maxConcurrent: 1,
      acquire: async (id, signal) => ({bytes: 1, lease: await cache.acquire(id, signal)}),
    });
    d.pump(2);
    await flush();
    await flush();
    d.pump(4);
    await flush();
    await flush();
    assert.equal(cache.refs('a'), 1);
    assert.equal(cache.refs('b'), 1);
    if (publishDependent) d.pump(2);
    assert.equal(d.get('b') !== undefined, publishDependent);
    d.dispose();
    assert.deepEqual(released, ['b', 'a']);
    assert.equal(cache.residentBytes(), 0);
  });
test('pending dependent abort cannot auto-release its signal-bound cached prerequisite', async () => {
  const {LeaseCache} = await import('./lease-cache');
  const {createDependencyBudget} = await import('./dependency-budget');
  const budget = createDependencyBudget(2),
    released: string[] = [];
  let finish!: () => void,
    observedAbort = false;
  const cache = new LeaseCache(
    {
      fetch: async (key: string) => ({key}),
      upload: value => value,
      discard() {},
      dispose(value) {
        released.push(value.key);
      },
      bytes: () => 1,
    },
    {warmBytes: 0},
  );
  const d = createDependencyLease({
    nodes: [
      {id: 'a', dependencies: [], bytes: 1},
      {id: 'b', dependencies: ['a'], bytes: 1},
    ],
    required: ['b'],
    maxPinnedBytes: 2,
    maxConcurrent: 1,
    budget,
    acquire: async (id, signal) => {
      if (id === 'a') return {bytes: 1, lease: await cache.acquire(id, signal)};
      await new Promise<void>(resolve => {
        finish = resolve;
        signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            assert.equal(cache.refs('a'), 1);
          },
          {once: true},
        );
      });
      assert.equal(cache.refs('a'), 1);
      return {
        bytes: 1,
        lease: {
          value: {key: id},
          release() {
            assert.equal(cache.refs('a'), 1);
            released.push(id);
          },
        },
      };
    },
  });
  d.pump(2);
  await flush();
  await flush();
  d.pump(4);
  await flush();
  d.dispose();
  assert.equal(observedAbort, true);
  assert.equal(cache.refs('a'), 1);
  assert.equal(budget.stats.reservedBytes, 2);
  assert.equal(released.length, 0);
  finish();
  await flush();
  assert.deepEqual(released, ['b', 'a']);
  assert.equal(budget.stats.reservedBytes, 0);
  assert.equal(cache.residentBytes(), 0);
});
