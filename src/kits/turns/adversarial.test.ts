import test from 'node:test';
import assert from 'node:assert/strict';
import {createTurnLog, type TurnLog, type TurnRules} from './index';
import {cardRules, limits, table, type Move, type Table} from './test-rules';

const withReduce = (reduce: TurnRules<Table, Move>['reduce']): TurnRules<Table, Move> => ({...cardRules(), reduce});

test('construction rejects bad limits, seeds, rules and initial states', () => {
  const ok = {rules: cardRules(), limits, seed: 1, initial: table};
  assert.throws(() => createTurnLog({...ok, limits: {...limits, maxCommands: 0}}));
  assert.throws(() => createTurnLog({...ok, limits: {...limits, state: {...limits.state, maxDepth: Infinity}}}));
  assert.throws(() => createTurnLog({...ok, seed: -1}));
  assert.throws(() => createTurnLog({...ok, seed: 2 ** 32}));
  assert.throws(() => createTurnLog({...ok, seed: ''}));
  assert.throws(() => createTurnLog({...ok, rules: {...cardRules(), id: ''}}));
  assert.throws(() => createTurnLog({...ok, initial: {...table, score: 1.5}}));
  // Validators must return literal true.
  assert.throws(() =>
    createTurnLog({
      ...ok,
      rules: {...cardRules(), validateState: (() => 1) as unknown as TurnRules<Table, Move>['validateState']},
    }),
  );
});

test('commands are captured: invalid, oversized and non-JSON commands change nothing', () => {
  const log = createTurnLog({rules: cardRules(), limits, seed: 1, initial: table}),
    before = log.read();
  const bad = [
    {type: 'teleport'},
    {type: 'play', card: 'x'.repeat(300)},
    {type: 'play', card: NaN},
  ] as unknown as Move[];
  for (const m of bad) assert.equal(log.submit(before.revision, m).status, 'invalid');
  const cyclic: Record<string, unknown> = {type: 'draw'};
  cyclic.self = cyclic;
  assert.equal(log.submit(before.revision, cyclic as unknown as Move).status, 'invalid');
  assert.equal(log.submit(before.revision, 10n as unknown as Move).status, 'invalid');
  assert.deepEqual(log.read(), before);
  // Caller mutation after submit cannot rewrite history.
  const move = {type: 'draw'} as {type: string};
  log.submit(before.revision, move as Move);
  move.type = 'shuffle';
  assert.deepEqual(log.commands(), [{type: 'draw'}]);
  assert.ok(Object.isFrozen(log.read().state));
});

test('reducer misbehaviour leaves the committed state, revision and history unchanged', () => {
  const cases: [TurnRules<Table, Move>['reduce'], string][] = [
    [() => ({accept: true, state: {...table, score: Infinity}}), 'invalid'],
    [() => ({accept: true, state: {...table, deck: Array(5000).fill(1)}}), 'invalid'],
    [() => ({accept: true, state: {deck: 'oops'} as unknown as Table}), 'invalid'],
    [() => undefined as unknown as {accept: false; reason: string}, 'invalid'],
    [() => ({accept: 'yes'}) as unknown as {accept: false; reason: string}, 'invalid'],
  ];
  for (const [reduce, status] of cases) {
    const log = createTurnLog({rules: withReduce(reduce), limits, seed: 1, initial: table}),
      before = log.read();
    assert.equal(log.submit(before.revision, {type: 'draw'}).status, status);
    assert.equal(log.preview({type: 'draw'}).status, status);
    assert.deepEqual(log.read(), before);
  }
});

test('a throwing or state-mutating reducer propagates, and the owner stays usable', () => {
  let explode = true;
  const rules = withReduce(ctx => {
    if (explode) throw Error('boom');
    return cardRules().reduce(ctx);
  });
  const log = createTurnLog({rules, limits, seed: 1, initial: table}),
    before = log.read();
  assert.throws(() => log.submit(before.revision, {type: 'draw'}), /boom/);
  assert.deepEqual(log.read(), before);
  explode = false;
  assert.equal(log.submit(before.revision, {type: 'draw'}).status, 'applied', 'busy guard released');
  const mutator = createTurnLog({
    rules: withReduce(({state}) => {
      (state.hand as number[]).push(1);
      return {accept: true, state};
    }),
    limits,
    seed: 1,
    initial: table,
  });
  assert.throws(() => mutator.submit(0, {type: 'draw'}), TypeError);
  assert.deepEqual(mutator.read().state, table);
});

test('reentrant calls from the reducer are busy; disposal inside the reducer prevents publication', () => {
  let log!: TurnLog<Table, Move>;
  const inner: string[] = [];
  log = createTurnLog({
    rules: withReduce(ctx => {
      inner.push(
        log.submit(log.read().revision, {type: 'draw'}).status,
        log.undo(log.read().revision).status,
        log.preview({type: 'draw'}).status,
      );
      return cardRules().reduce(ctx);
    }),
    limits,
    seed: 1,
    initial: table,
  });
  assert.equal(log.submit(0, {type: 'draw'}).status, 'applied');
  assert.deepEqual(inner, ['busy', 'busy', 'busy']);
  assert.equal(log.read().length, 1);

  let victim!: TurnLog<Table, Move>;
  victim = createTurnLog({
    rules: withReduce(ctx => {
      victim.dispose();
      return cardRules().reduce(ctx);
    }),
    limits,
    seed: 1,
    initial: table,
  });
  const before = victim.read();
  assert.equal(victim.submit(0, {type: 'draw'}).status, 'retired');
  assert.deepEqual(victim.read(), before);
  assert.equal(victim.redo(0).status, 'retired');
  assert.equal(victim.replay(0).status, 'retired');
});

test('the random stream is per position: a reducer cannot skew later commands by drawing more', () => {
  const greedy = withReduce(ctx => {
    if (ctx.command.type === 'draw') for (let i = 0; i < 1000; i++) ctx.random.next();
    return cardRules().reduce(ctx);
  });
  const a = createTurnLog({rules: cardRules(), limits, seed: 3, initial: table});
  const b = createTurnLog({rules: greedy, limits, seed: 3, initial: table});
  for (const log of [a, b]) {
    log.submit(log.read().revision, {type: 'draw'});
    log.submit(log.read().revision, {type: 'shuffle'});
  }
  // Draw consumed no randomness in `a` but 1000 numbers in `b`; the shuffle at position 1 is still identical.
  assert.notDeepEqual(a.read().state.deck, table.deck.slice(1));
  assert.equal(a.read().stateJson, b.read().stateJson);
});

test('replay rejects out-of-range cursors and snapshots are detached copies', () => {
  const log = createTurnLog({rules: cardRules(), limits, seed: 1, initial: table});
  log.submit(0, {type: 'draw'});
  for (const k of [-1, 2, 0.5, NaN]) assert.equal(log.replay(k).status, 'out-of-range');
  const snap = log.snapshot() as unknown as {commands: unknown[]};
  snap.commands.push({type: 'draw'});
  assert.equal(log.snapshot().commands.length, 1);
});
