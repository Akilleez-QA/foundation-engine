import test from 'node:test';
import assert from 'node:assert/strict';
import {createDependencyLease, type DependencyValue} from './dependency-lease';
import {createDependencyBudget} from './dependency-budget';
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const value = (id: string): DependencyValue<string> => ({bytes: 1, lease: {value: id, release() {}}});

test('M2 scheduled task interrupts immediate dependency preparation before completion', async () => {
  let count = 0,
    done = false;
  const nodes = Array.from({length: 256}, (_, i) => ({id: String(i), dependencies: [], bytes: 1}));
  const owner = createDependencyLease({
    nodes,
    required: nodes.map(n => n.id),
    maxConcurrent: 1,
    maxPinnedBytes: 256,
    acquire: async id => {
      count++;
      return value(id);
    },
  });
  const sentinel = new Promise<{count: number; done: boolean}>(resolve => setTimeout(() => resolve({count, done}), 0));
  const pending = owner.prepare(4).then(() => {
    done = true;
  });
  const observed = await sentinel;
  assert.ok(observed.count > 0 && observed.count < 256);
  assert.equal(observed.done, false);
  await pending;
  assert.equal(count, 256);
  owner.dispose();
});

test('M2 critical transitive closure precedes unresolved optional work, then explicit pump drains optional', async () => {
  const calls: string[] = [];
  let optional!: (v: DependencyValue<string>) => void;
  const owner = createDependencyLease({
    nodes: [
      {id: 'optional', dependencies: [], bytes: 1},
      {id: 'end', dependencies: ['left', 'right'], bytes: 1},
      {id: 'right', dependencies: ['base'], bytes: 1},
      {id: 'left', dependencies: ['base'], bytes: 1},
      {id: 'base', dependencies: [], bytes: 1},
    ],
    required: ['end'],
    maxConcurrent: 1,
    maxPinnedBytes: 5,
    acquire: async id => {
      calls.push(id);
      return id === 'optional'
        ? new Promise<DependencyValue<string>>(resolve => {
            optional = resolve;
          })
        : value(id);
    },
  });
  await owner.prepare(1);
  assert.deepEqual(calls, ['base', 'left', 'right', 'end']);
  owner.pump(5);
  await flush();
  assert.equal(calls.at(-1), 'optional');
  optional(value('optional'));
  await flush();
  owner.pump(2);
  assert.equal(owner.status, 'ready');
  owner.dispose();
});

test('M2 task-time abort cancels scheduled continuation and releases late acquisition exactly once', async () => {
  const controller = new AbortController(),
    budget = createDependencyBudget(2);
  let finish!: (v: DependencyValue<string>) => void,
    acquired = 0,
    released = 0,
    cancelled = 0;
  const owner = createDependencyLease({
    nodes: [
      {id: 'a', dependencies: [], bytes: 1},
      {id: 'b', dependencies: [], bytes: 1},
    ],
    required: ['a', 'b'],
    maxConcurrent: 1,
    maxPinnedBytes: 2,
    budget,
    signal: controller.signal,
    scheduleTask: resume => {
      const id = setTimeout(resume, 50);
      return () => {
        cancelled++;
        clearTimeout(id);
      };
    },
    acquire: async () => {
      acquired++;
      return new Promise<DependencyValue<string>>(r => {
        finish = r;
      });
    },
  });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(owner.prepare(1), /closed/);
  assert.equal(acquired, 1);
  assert.equal(cancelled, 1);
  assert.equal(budget.stats.reservedBytes, 2);
  finish({
    bytes: 1,
    lease: {
      value: 'a',
      release() {
        released++;
      },
    },
  });
  await flush();
  assert.equal(released, 1);
  assert.equal(budget.stats.reservedBytes, 0);
});

test('M2 blocked I/O sleeps without task polling and scheduler failure retires ownership', async () => {
  let scheduled = 0,
    resume!: () => void,
    finish!: (v: DependencyValue<string>) => void;
  const owner = createDependencyLease({
    nodes: [{id: 'a', dependencies: [], bytes: 1}],
    required: ['a'],
    maxConcurrent: 1,
    maxPinnedBytes: 1,
    scheduleTask: fn => {
      scheduled++;
      resume = fn;
      return () => {};
    },
    acquire: () =>
      new Promise<DependencyValue<string>>(r => {
        finish = r;
      }),
  });
  const pending = owner.prepare(1);
  await flush();
  resume();
  await flush();
  assert.equal(scheduled, 1);
  finish(value('a'));
  await pending;
  owner.dispose();
  const budget = createDependencyBudget(1);
  const failed = createDependencyLease({
    nodes: [{id: 'a', dependencies: [], bytes: 1}],
    required: ['a'],
    maxConcurrent: 1,
    maxPinnedBytes: 1,
    budget,
    scheduleTask() {
      throw Error('scheduler');
    },
    acquire: async () => value('a'),
  });
  await assert.rejects(failed.prepare(1), /scheduler/);
  await flush();
  assert.equal(failed.status, 'closed');
  assert.equal(budget.stats.reservedBytes, 0);
});

test('M2 pump schedules no task; count bounds do not preempt acquisition callbacks', async () => {
  let scheduled = 0,
    acquired = 0;
  const owner = createDependencyLease({
    nodes: [{id: 'a', dependencies: [], bytes: 1}],
    required: ['a'],
    maxConcurrent: 1,
    maxPinnedBytes: 1,
    scheduleTask() {
      scheduled++;
      return () => {};
    },
    acquire: async () => {
      for (let i = 0; i < 1000; i++) acquired++;
      return value('a');
    },
  });
  assert.equal(owner.pump(0), 0);
  assert.equal(owner.pump(1), 1);
  await flush();
  assert.equal(acquired, 1000);
  assert.equal(scheduled, 0);
  owner.pump(1);
  owner.dispose();
});

test('M2 optional work fills spare capacity while reserving one slot for a pending critical chain', async () => {
  const calls: string[] = [],
    finish = new Map<string, (v: DependencyValue<string>) => void>();
  const owner = createDependencyLease({
    nodes: [
      {id: 'decor-a', dependencies: [], bytes: 1},
      {id: 'decor-b', dependencies: [], bytes: 1},
      {id: 'decor-c', dependencies: [], bytes: 1},
      {id: 'end', dependencies: ['base'], bytes: 1},
      {id: 'base', dependencies: [], bytes: 1},
    ],
    required: ['end'],
    maxConcurrent: 3,
    maxPinnedBytes: 5,
    acquire: async id => {
      calls.push(id);
      return new Promise<DependencyValue<string>>(resolve => finish.set(id, resolve));
    },
  });
  owner.pump(5);
  await flush();
  assert.deepEqual(calls, ['base', 'decor-a', 'decor-b']);
  finish.get('base')!(value('base'));
  await flush();
  owner.pump(10);
  await flush();
  assert.equal(calls.at(-1), 'end');
  assert.equal(calls.includes('decor-c'), false, 'optional cannot take the critical slot');
  finish.get('end')!(value('end'));
  await flush();
  owner.pump(10);
  await flush();
  assert.equal(calls.at(-1), 'decor-c', 'last slot becomes available after critical readiness');
  owner.dispose();
  for (const id of ['decor-a', 'decor-b', 'decor-c']) finish.get(id)!(value(id));
  await flush();
  assert.equal(owner.stats.active, 0);
});

for (const dispose of [false, true])
  test(`M2 throwing task cancellation settles and cleans up every waiter on ${dispose ? 'dispose' : 'resume'}`, async () => {
    const budget = createDependencyBudget(1),
      resumes: (() => void)[] = [];
    let finish!: (v: DependencyValue<string>) => void,
      released = 0;
    const owner = createDependencyLease({
      nodes: [{id: 'a', dependencies: [], bytes: 1}],
      required: ['a'],
      maxPinnedBytes: 1,
      maxConcurrent: 1,
      budget,
      scheduleTask: resume => {
        resumes.push(resume);
        return () => {
          throw Error('cancel failure');
        };
      },
      acquire: () =>
        new Promise<DependencyValue<string>>(resolve => {
          finish = resolve;
        }),
    });
    const first = owner.prepare(1),
      second = owner.prepare(1);
    const assertions = [assert.rejects(first, /cancel failure/), assert.rejects(second, /cancel failure/)];
    await flush();
    if (dispose) owner.dispose();
    else resumes[0]!();
    await Promise.all(assertions);
    assert.equal(owner.status, 'closed');
    assert.equal(budget.stats.reservedBytes, 1);
    finish({
      bytes: 1,
      lease: {
        value: 'a',
        release() {
          released++;
        },
      },
    });
    await flush();
    assert.equal(released, 1);
    assert.equal(budget.stats.reservedBytes, 0);
  });
