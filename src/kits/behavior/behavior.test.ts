import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRng, createSaveableRng} from '../../core/rng';
import {BehaviorError, createBehavior, defineBehaviorTree, type BehaviorStatus, type NodeInput} from './index';

/** A scripted action: returns the queued statuses in order, then `success`; records starts and aborts. */
function scripted(log: string[], name: string, statuses: BehaviorStatus[]) {
  let queue = [...statuses];
  return {
    tick: (ctx: {first: boolean}) => {
      if (ctx.first) {
        log.push(`start:${name}`);
        queue = [...statuses];
      }
      return queue.shift() ?? 'success';
    },
    abort: () => log.push(`abort:${name}`),
  };
}

test('definitions refuse unknown types, missing children, bad fields and limits', () => {
  assert.throws(() => defineBehaviorTree({type: 'nope'} as never), /unknown node type/);
  assert.throws(() => defineBehaviorTree({type: 'sequence', children: []}), /at least one child/);
  assert.throws(() => defineBehaviorTree({type: 'wait', ticks: 0}), /ticks/);
  assert.throws(() => defineBehaviorTree({type: 'action', action: 'a', extra: 1} as never), /unexpected field/);
  assert.throws(
    () => defineBehaviorTree({type: 'shuffle', children: [{type: 'wait', ticks: 1}], weights: [0]}),
    /weights/,
  );
  let deep: NodeInput = {type: 'wait', ticks: 1};
  for (let i = 0; i < 70; i++) deep = {type: 'invert', child: deep};
  assert.throws(() => defineBehaviorTree(deep), /too deep/);
  const tree = defineBehaviorTree({
    type: 'sequence',
    children: [
      {type: 'action', action: 'go'},
      {type: 'condition', check: 'ok'},
    ],
  });
  assert.deepEqual([tree.actions, tree.conditions], [['go'], ['ok']]);
  assert.throws(
    () => createBehavior(tree, {actions: {go: () => 'success'}}, {agent: 'a'}),
    /no handler for condition ok/,
  );
});

test('a sequence resumes at its running child across ticks', () => {
  const log: string[] = [];
  const tree = defineBehaviorTree({
    type: 'sequence',
    children: [
      {type: 'action', action: 'a'},
      {type: 'action', action: 'b'},
    ],
  });
  const bt = createBehavior(
    tree,
    {actions: {a: scripted(log, 'a', ['success']), b: scripted(log, 'b', ['running', 'running', 'success'])}},
    {agent: 'unit-1'},
  );
  assert.equal(bt.tick({now: 0}).status, 'running');
  assert.deepEqual(bt.running(), [0, 2]);
  assert.equal(bt.tick({now: 1}).status, 'running');
  assert.equal(bt.tick({now: 2}).status, 'success');
  assert.deepEqual(log, ['start:a', 'start:b'], 'a is not re-run while b resumes');
  assert.deepEqual(bt.running(), []);
});

test('a reactive selector aborts its running lower-priority child when a higher one succeeds', () => {
  const log: string[] = [];
  const tree = defineBehaviorTree({
    type: 'selector',
    reactive: true,
    children: [
      {
        type: 'sequence',
        name: 'flee',
        children: [
          {type: 'check', key: 'danger', op: 'eq', value: true},
          {type: 'action', action: 'run'},
        ],
      },
      {type: 'action', action: 'idle', name: 'idle'},
    ],
  });
  const bt = createBehavior(
    tree,
    {actions: {run: scripted(log, 'run', ['running']), idle: scripted(log, 'idle', ['running', 'running', 'running'])}},
    {agent: 'a'},
  );
  bt.tick({now: 0});
  bt.tick({now: 1});
  bt.set('danger', true);
  const traced = bt.tick({now: 2, trace: true});
  assert.equal(traced.status, 'running');
  assert.deepEqual(log, ['start:idle', 'start:run', 'abort:idle']);
  assert.deepEqual(
    traced.trace!.map(r => `${r.name ?? r.type}:${r.status}`),
    ['check:success', 'action:running', 'flee:running', 'idle:aborted', 'selector:running'],
  );
});

test('decorators: repeat, retry, timeout, cooldown, guard, invert, wait and parallel', () => {
  const counter = (log: string[]) => ({tick: () => (log.push('x'), 'success' as const)});
  const run = (node: NodeInput, ticks: number, handlers = {}) => {
    const bt = createBehavior(defineBehaviorTree(node), handlers, {agent: 'a'});
    const statuses: string[] = [];
    for (let i = 0; i < ticks; i++) statuses.push(bt.tick({now: i}).status);
    return statuses;
  };
  const log: string[] = [];
  assert.deepEqual(
    run({type: 'repeat', times: 3, child: {type: 'action', action: 'x'}}, 3, {actions: {x: counter(log)}}),
    ['running', 'running', 'success'],
  );
  assert.equal(log.length, 3, 'one child run per tick');
  let fails = 0;
  assert.deepEqual(
    run({type: 'retry', times: 2, child: {type: 'condition', check: 'c'}}, 2, {
      conditions: {c: () => (fails++, false)},
    }),
    ['running', 'failure'],
  );
  assert.deepEqual(run({type: 'timeout', ticks: 2, child: {type: 'wait', ticks: 5}}, 3), [
    'running',
    'running',
    'failure',
  ]);
  assert.deepEqual(run({type: 'cooldown', ticks: 2, child: {type: 'wait', ticks: 1}}, 6), [
    'running',
    'success',
    'failure',
    'failure',
    'running',
    'success',
  ]);
  assert.deepEqual(run({type: 'invert', child: {type: 'check', key: 'k', op: 'missing'}}, 1), ['failure']);
  assert.deepEqual(run({type: 'succeed', child: {type: 'check', key: 'k', op: 'exists'}}, 1), ['success']);
  assert.deepEqual(run({type: 'fail', child: {type: 'wait', ticks: 1}}, 2), ['running', 'failure']);
  assert.deepEqual(
    run(
      {
        type: 'parallel',
        succeed: 'any',
        children: [
          {type: 'wait', ticks: 2},
          {type: 'wait', ticks: 5},
        ],
      },
      3,
    ),
    ['running', 'running', 'success'],
  );
  assert.deepEqual(
    run(
      {
        type: 'parallel',
        children: [
          {type: 'wait', ticks: 1},
          {type: 'fail', child: {type: 'wait', ticks: 2}},
        ],
      },
      3,
    ),
    ['running', 'running', 'failure'],
  );
  const glog: string[] = [];
  let allowed = true;
  const bt = createBehavior(
    defineBehaviorTree({type: 'guard', check: 'allowed', child: {type: 'action', action: 'work'}}),
    {conditions: {allowed: () => allowed}, actions: {work: scripted(glog, 'work', ['running', 'running', 'running'])}},
    {agent: 'a'},
  );
  bt.tick({now: 0});
  allowed = false;
  assert.equal(bt.tick({now: 1}).status, 'failure');
  assert.deepEqual(glog, ['start:work', 'abort:work']);
});

test('blackboard: set and check nodes, handler writes, bounds and value validation', () => {
  const bt = createBehavior(
    defineBehaviorTree({
      type: 'sequence',
      children: [
        {type: 'set', key: 'mode', value: 'search'},
        {type: 'action', action: 'count'},
        {type: 'check', key: 'seen', op: 'ge', value: 2},
      ],
    }),
    {actions: {count: ctx => (ctx.set('seen', ((ctx.get('seen') as number | undefined) ?? 0) + 1), 'success')}},
    {agent: 'a', maxKeys: 2},
  );
  assert.equal(bt.tick({now: 0}).status, 'failure');
  assert.equal(bt.tick({now: 1}).status, 'success');
  assert.deepEqual(bt.blackboard(), {mode: 'search', seen: 2});
  assert.throws(() => bt.set('third', 1), /full/);
  assert.throws(() => bt.set('mode', Number.NaN), /invalid blackboard value/);
});

test('a throwing handler leaves memory and blackboard as they were', () => {
  let explode = false;
  const bt = createBehavior(
    defineBehaviorTree({
      type: 'sequence',
      children: [
        {type: 'set', key: 'step', value: 1},
        {type: 'wait', ticks: 1},
        {type: 'action', action: 'risky'},
      ],
    }),
    {
      actions: {
        risky: () => {
          if (explode) throw new Error('boom');
          return 'running';
        },
      },
    },
    {agent: 'a'},
  );
  bt.tick({now: 0});
  const before = bt.snapshot();
  explode = true;
  assert.throws(() => bt.tick({now: 1}), /boom/);
  assert.deepEqual(bt.snapshot(), before);
  assert.throws(() => bt.tick({now: -1}), BehaviorError);
  explode = false;
  bt.tick({now: 5});
  assert.throws(() => bt.tick({now: 4}), /backwards/);
  const reenter = createBehavior(
    defineBehaviorTree({type: 'action', action: 'r'}),
    {actions: {r: () => (reenter.set('k', 1), 'success')}},
    {agent: 'a'},
  );
  assert.throws(() => reenter.tick({now: 0}), /reentrant/);
});

test('shuffle draws its order from the tick random source; seeded runs repeat', () => {
  const tree = defineBehaviorTree({
    type: 'shuffle',
    weights: [1, 2, 3],
    children: [
      {type: 'action', action: 'a'},
      {type: 'action', action: 'b'},
      {type: 'action', action: 'c'},
    ],
  });
  const pickSequence = (seed: number) => {
    const picks: string[] = [];
    const rng = createRng(seed);
    const fail = (id: string) => () => (picks.push(id), 'failure' as const);
    const bt = createBehavior(tree, {actions: {a: fail('a'), b: fail('b'), c: fail('c')}}, {agent: 'a'});
    for (let i = 0; i < 20; i++) bt.tick({now: i, random: rng.next});
    return picks.join('');
  };
  assert.equal(pickSequence(3), pickSequence(3));
  assert.notEqual(pickSequence(3), pickSequence(4));
  const bt = createBehavior(
    tree,
    {actions: {a: () => 'success', b: () => 'success', c: () => 'success'}},
    {agent: 'a'},
  );
  assert.throws(() => bt.tick({now: 0}), /random source/);
});

test('snapshot and restore resume mid-run identically; mismatched snapshots are refused', () => {
  const node: NodeInput = {
    type: 'repeat',
    times: null,
    child: {
      type: 'sequence',
      children: [
        {
          type: 'shuffle',
          children: [
            {type: 'wait', ticks: 2},
            {type: 'wait', ticks: 3},
          ],
        },
        {type: 'cooldown', ticks: 4, child: {type: 'action', action: 'act'}},
        {type: 'action', action: 'act'},
      ],
    },
  };
  const tree = defineBehaviorTree(node);
  const make = (log: string[]) =>
    createBehavior(
      tree,
      {actions: {act: ctx => (log.push(`${ctx.now}:${ctx.node}`), ctx.now % 5 === 0 ? 'running' : 'success')}},
      {agent: 'a'},
    );
  const logA: string[] = [];
  const a = make(logA);
  const rngA = createSaveableRng(9);
  for (let i = 0; i < 8; i++) a.tick({now: i, random: rngA.next});
  // Save the tree and its random stream together, as a save section would.
  const saved = JSON.parse(JSON.stringify(a.snapshot()));
  const savedRng = rngA.state();
  assert.ok(saved.memory.length > 1, 'saved mid-run');
  const mark = logA.length;
  const tailA: string[] = [];
  for (let i = 8; i < 40; i++) tailA.push(a.tick({now: i, random: rngA.next}).status);
  const logB: string[] = [];
  const b = make(logB);
  b.restore(saved);
  const rngB = createSaveableRng(0);
  rngB.restore(savedRng);
  const tailB: string[] = [];
  for (let i = 8; i < 40; i++) tailB.push(b.tick({now: i, random: rngB.next}).status);
  assert.deepEqual(tailB, tailA);
  assert.deepEqual(logB, logA.slice(mark));
  const other = createBehavior(defineBehaviorTree({type: 'wait', ticks: 1}), {}, {agent: 'a'});
  assert.throws(() => other.restore(saved), /different tree/);
  assert.throws(() => make([]).restore({...saved, agent: 'b'}), /another agent/);
  const orphan = structuredClone(saved);
  orphan.memory = orphan.memory.filter((m: {node: number}) => m.node !== 0);
  if (orphan.memory.length) assert.throws(() => make([]).restore(orphan), /ancestor chains/);
});

test('review: abort handlers run after commit, so a rolled-back tick never resurrects aborted work', () => {
  const log: string[] = [];
  let boom = false;
  const tree = defineBehaviorTree({
    type: 'parallel',
    children: [
      {
        type: 'selector',
        reactive: true,
        children: [
          {type: 'check', key: 'go', op: 'eq', value: true},
          {type: 'action', action: 'move'},
        ],
      },
      {type: 'action', action: 'risky'},
    ],
  });
  const bt = createBehavior(
    tree,
    {
      actions: {
        move: {tick: ctx => (log.push(`move first=${ctx.first}`), 'running'), abort: () => log.push('move abort')},
        risky: () => {
          if (boom) throw new Error('boom');
          return 'running';
        },
      },
    },
    {agent: 'a'},
  );
  bt.tick({now: 0});
  bt.set('go', true);
  boom = true;
  assert.throws(() => bt.tick({now: 1}), /boom/);
  assert.deepEqual(log, ['move first=true'], 'no abort handler ran for the rolled-back tick');
  bt.set('go', false);
  boom = false;
  bt.tick({now: 2});
  assert.deepEqual(log, ['move first=true', 'move first=false']);
});

test('review: parallel stops at its decision; contexts die with their tick; reads inside a tick throw', () => {
  const log: string[] = [];
  let stash: {set(k: string, v: number): void} | null = null;
  const bt = createBehavior(
    defineBehaviorTree({
      type: 'parallel',
      succeed: 'any',
      children: [
        {type: 'action', action: 'quick'},
        {type: 'action', action: 'slow'},
      ],
    }),
    {
      actions: {
        quick: ctx => ((stash = ctx), 'success'),
        slow: () => (log.push('slow'), 'running'),
      },
    },
    {agent: 'a'},
  );
  assert.equal(bt.tick({now: 0}).status, 'success');
  assert.deepEqual(log, [], 'a decided parallel starts no later child');
  assert.throws(() => stash!.set('leak', 1), /outside its tick/);
  const reader = createBehavior(
    defineBehaviorTree({type: 'action', action: 'r'}),
    {actions: {r: () => (reader.snapshot(), 'success')}},
    {agent: 'a'},
  );
  assert.throws(() => reader.tick({now: 0}), /reentrant/);
  assert.throws(() => bt.tick(null as never), /tick takes/);
});

test('review: restore refuses states no tick can produce', () => {
  const tree = defineBehaviorTree({
    type: 'sequence',
    children: [
      {type: 'wait', ticks: 5},
      {
        type: 'parallel',
        children: [
          {type: 'wait', ticks: 3},
          {type: 'wait', ticks: 4},
        ],
      },
    ],
  });
  const bt = createBehavior(tree, {}, {agent: 'a'});
  bt.tick({now: 0});
  const saved = JSON.parse(JSON.stringify(bt.snapshot()));
  const fresh = () => createBehavior(tree, {}, {agent: 'a'});
  const tamper = (
    f: (s: {
      memory: {node: number; cursor: number; results: number[] | null; count: number; since: number; order: null}[];
    }) => void,
  ) => {
    const copy = structuredClone(saved);
    f(copy);
    return copy;
  };
  assert.doesNotThrow(() => fresh().restore(saved));
  assert.throws(
    () =>
      fresh().restore(
        tamper(s => s.memory.push({node: 2, cursor: 0, count: 0, since: 0, order: null, results: [0, 0]})),
      ),
    /cursor/,
  );
  assert.throws(() => fresh().restore(tamper(s => (s.memory[0]!.cursor = 1))), /cursor/);
  bt.tick({now: 5});
  const par = JSON.parse(JSON.stringify(bt.snapshot()));
  const p = par.memory.find((m: {node: number}) => m.node === 2);
  p.results = null;
  assert.throws(() => fresh().restore(par), /results/);
});
