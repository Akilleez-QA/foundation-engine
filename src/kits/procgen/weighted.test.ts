import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseWeighted, createChoiceHistory, type WeightedCandidate, type ChoicePreparation} from './weighted';
import {createSaveableRng} from '../../core/rng';
import {createObjectiveRun} from '../objectives';
import {defineSaveSection} from '../../author';
import {authorSaveHandle} from '../../author/save-handle';
import {createSaveStore} from '../../core/save/store';
import {MemoryBackend} from '../../core/save/storage-port';

const bounds = {maxCandidates: 8, maxIdLength: 32};
const options = {...bounds, maxLabels: 2, windowSize: 2};
const candidates = ['a', 'b', 'c', 'd'].map(id => ({id, weight: 1, eligible: true}));
function ticket(result: ChoicePreparation) {
  if (result.status !== 'prepared') throw new Error(`Expected prepared, got ${result.status}`);
  return result.ticket;
}
const zero = {next: () => 0};

test('half-open endpoints and zero weights select only the intended eligible interval', () => {
  const rows = [{id: 'zero', weight: 0, eligible: true}, ...candidates.slice(0, 2)];
  for (const [unit, expected] of [
    [0, 'a'],
    [0.499999, 'a'],
    [0.5, 'b'],
    [1 - Number.EPSILON, 'b'],
  ] as const)
    assert.equal(chooseWeighted(rows, {next: () => unit}, bounds), expected);
  assert.equal(
    chooseWeighted([{id: 'tiny', weight: Number.MIN_VALUE, eligible: true}], {next: () => 0.9}, bounds),
    'tiny',
  );
  assert.equal(
    chooseWeighted(
      rows.map(row => ({...row, eligible: row.id === 'b'})),
      zero,
      bounds,
    ),
    'b',
  );
});

test('empty, excluded and zero pools consume no draw; invalid input fails before drawing', () => {
  let draws = 0;
  const rng = {
    next: () => {
      draws++;
      return 0;
    },
  };
  for (const rows of [
    [],
    candidates.map(row => ({...row, weight: 0})),
    candidates.map(row => ({...row, eligible: false})),
  ])
    assert.equal(chooseWeighted(rows, rng, bounds), null);
  for (const rows of [
    [...candidates, candidates[0]!],
    candidates.map(row => ({...row, weight: NaN})),
    candidates.map(row => ({...row, weight: -1})),
    candidates.map(row => ({...row, weight: Number.MAX_VALUE})),
    [
      {id: 'big', weight: 1e100, eligible: true},
      {id: 'small', weight: 1, eligible: true},
    ],
    Array(9).fill(candidates[0]),
  ])
    assert.throws(() => chooseWeighted(rows, rng, bounds));
  assert.equal(draws, 0);
  for (const invalid of [-1, 1, Infinity, NaN])
    assert.throws(() => chooseWeighted(candidates, {next: () => invalid}, bounds));
});

test('preparation is isolated from committed history and stale/copied attempts cannot publish', () => {
  const owner = createChoiceHistory(options);
  const before = owner.snapshot();
  const rng = createSaveableRng('proposal');
  const initialRng = rng.state();
  const first = ticket(owner.prepare('rooms', candidates, rng));
  const preparedRng = rng.state();
  assert.notEqual(preparedRng, initialRng);
  assert.deepEqual(owner.snapshot(), before);
  assert.equal(owner.commit({...first}), false);
  assert.equal(
    owner.prepare('other', candidates, {
      next: () => {
        throw Error('busy draw');
      },
    }).status,
    'busy',
  );
  assert.equal(owner.cancel(first), true);
  assert.equal(rng.state(), preparedRng, 'cancel does not rewind borrowed RNG');
  const second = ticket(owner.prepare('rooms', candidates, zero));
  assert.equal(owner.commit(first), false);
  assert.equal(owner.commit(second), true);
  assert.equal(owner.commit(second), false);
  assert.deepEqual(owner.snapshot().histories, [{label: 'rooms', ids: ['a']}]);
});

test('oldest eviction stays inside its label and saturated admission consumes no RNG', () => {
  const owner = createChoiceHistory(options);
  for (const label of ['rooms', 'events', 'rooms', 'rooms'])
    owner.commit(ticket(owner.prepare(label, candidates, zero)));
  assert.deepEqual(owner.snapshot().histories, [
    {label: 'rooms', ids: ['b', 'c']},
    {label: 'events', ids: ['a']},
  ]);
  const rng = createSaveableRng(5),
    state = rng.state(),
    before = owner.snapshot();
  assert.equal(owner.prepare('overflow', candidates, rng).status, 'saturated');
  assert.equal(rng.state(), state);
  assert.deepEqual(owner.snapshot(), before);
  assert.equal(owner.clear('rooms'), true);
  assert.equal(owner.prepare('overflow', candidates, rng).status, 'prepared');
});

test('window one evicts its oldest and exhausted eligibility stays empty until creator intervention', () => {
  const owner = createChoiceHistory({...options, windowSize: 1});
  owner.commit(ticket(owner.prepare('one', candidates, zero)));
  owner.commit(ticket(owner.prepare('one', candidates, zero)));
  assert.deepEqual(owner.snapshot().histories[0]?.ids, ['b']);
  assert.equal(
    owner.prepare('one', [candidates[1]!], {
      next: () => {
        throw Error('unexpected draw');
      },
    }).status,
    'empty',
  );
  owner.clear('one');
  assert.equal(owner.prepare('one', [candidates[1]!], zero).status, 'prepared');
});

test('restore validates bounds/configuration/dense data atomically and retires pending attempts', () => {
  const owner = createChoiceHistory(options);
  owner.commit(ticket(owner.prepare('one', candidates, zero)));
  const original = owner.snapshot();
  const pending = ticket(owner.prepare('one', candidates, zero));
  const mutations = [
    {...original, version: 2},
    {...original, options: {...options, maxLabels: 1}},
    {...original, histories: [{label: 'one', ids: ['a', 'a']}]},
    {...original, histories: [{label: 'one', ids: ['a', 'b', 'c']}]},
    {
      ...original,
      histories: [
        {label: 'one', ids: ['a']},
        {label: 'one', ids: ['b']},
      ],
    },
  ];
  for (const value of mutations) {
    assert.throws(() => owner.restore(value));
    assert.deepEqual(owner.snapshot(), original);
  }
  const iterable: unknown[] = [];
  Object.defineProperty(iterable, Symbol.iterator, {
    value: () => {
      throw Error('iterator ran');
    },
  });
  assert.throws(() => owner.restore({...original, histories: iterable}), /dense/);
  assert.equal(owner.commit(pending), true);
  const old = ticket(owner.prepare('one', candidates, zero));
  assert.equal(owner.restore(JSON.parse(JSON.stringify(original))), true);
  assert.equal(owner.commit(old), false);
  assert.throws(() => {
    (original.histories[0]!.ids as string[]).push('mutated');
  });
});

test('RNG callback reentrancy refuses mutation; cancellation/disposal prevents publication', () => {
  const owner = createChoiceHistory(options);
  assert.throws(
    () =>
      owner.prepare('a', candidates, {
        next: () => {
          owner.clear('a');
          return 0;
        },
      }),
    /reentrant/,
  );
  assert.deepEqual(owner.snapshot().histories, []);
  assert.equal(
    owner.prepare('a', candidates, {
      next: () => {
        owner.dispose();
        return 0;
      },
    }).status,
    'disposed',
  );
  assert.equal(
    owner.prepare('a', candidates, {
      next: () => {
        throw Error('disposed draw');
      },
    }).status,
    'disposed',
  );
  assert.equal(owner.restore({}), false);
  owner.dispose();
});

test('room-theme consumer uses creator eligibility, commits only accepted generation, and keeps recent variety', () => {
  const owner = createChoiceHistory(options),
    rng = createSaveableRng('room-layout');
  const rooms: string[] = [];
  for (let i = 0; i < 6; i++) {
    const pool = candidates.map(row => ({...row, eligible: row.id !== 'd'}));
    const planned = ticket(owner.prepare('rooms', pool, rng));
    if (i === 0) {
      owner.cancel(planned);
      continue;
    } // downstream geometry rejected
    assert.ok(!rooms.slice(-2).includes(planned.id));
    assert.equal(owner.commit(planned), true);
    rooms.push(planned.id);
  }
  assert.equal(rooms.length, 5);
  assert.ok(!rooms.includes('d'));
});

test('objective consumer admits an eligible activity before recording selection history', () => {
  const owner = createChoiceHistory(options);
  const run = createObjectiveRun({runId: 'activity-run', requirements: [{id: 'done', event: 'completed', target: 1}]});
  const planned = ticket(owner.prepare('activities', candidates, createSaveableRng('activity')));
  assert.deepEqual(owner.snapshot().histories, []);
  assert.equal(run.record({runId: 'activity-run', eventId: planned.id, event: 'completed', amount: 1}), 'accepted');
  assert.equal(owner.commit(planned), true);
  assert.equal(owner.commit(planned), false);
  assert.equal(owner.snapshot().histories[0]?.ids.length, 1);
});

test('existing SaveStore preserves RNG plus committed history continuation in one creator envelope', () => {
  const owner = createChoiceHistory(options),
    rng = createSaveableRng('saved');
  for (let i = 0; i < 3; i++) owner.commit(ticket(owner.prepare('rooms', candidates, rng)));
  const section = defineSaveSection({id: 'weighted-test.run', scope: 'device', initial: {json: ''}});
  const backend = new MemoryBackend();
  const open = (tab: number) =>
    createSaveStore({
      local: backend.port(tab),
      session: new MemoryBackend().port(tab, 'session'),
      namespace: 'weighted-test',
      build: 'test',
      timers: {set: () => 0, clear: () => {}, now: () => 0},
    });
  const first = open(0);
  assert.equal(
    authorSaveHandle(first, section).update(
      draft => {
        draft.json = JSON.stringify({history: owner.snapshot(), random: rng.state()});
      },
      {now: true},
    ),
    'saved',
  );
  first.dispose();
  const second = open(1);
  const saved: {history: unknown; random: number} = JSON.parse(authorSaveHandle(second, section).get().json);
  const restored = createChoiceHistory(options),
    resumedRng = createSaveableRng(0);
  restored.restore(saved.history);
  resumedRng.restore(saved.random);
  for (let i = 0; i < 12; i++) {
    const a = ticket(owner.prepare('rooms', candidates, rng)),
      b = ticket(restored.prepare('rooms', candidates, resumedRng));
    assert.equal(a.id, b.id);
    owner.commit(a);
    restored.commit(b);
    assert.deepEqual(owner.snapshot(), restored.snapshot());
    assert.equal(rng.state(), resumedRng.state());
  }
  second.dispose();
});
