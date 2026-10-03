import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../core/rng';
import { createInputHistory } from './history';
import type { InputHistory, InputHistoryOptions, SequenceStep } from './types';
import { must } from '../../testing/must';

const ACTIONS = ['up', 'down', 'left', 'right', 'p', 'k'] as const;
const make = (o: Partial<InputHistoryOptions> = {}) => createInputHistory({ actions: ACTIONS, capacity: 32, ...o });
/** Record frames start.. from a list of held-name arrays. */
const feed = (h: InputHistory, frames: readonly (readonly string[])[], start = h.latest() + 1) =>
  frames.forEach((names, i) => assert.equal(h.record(start + i, h.mask(names)).status, 'recorded'));

test('INPUT-HISTORY options: bounded, distinct actions, capacity and disjoint known opposite pairs', () => {
  const bad: unknown[] = [null, {}, { actions: [], capacity: 4 }, { actions: ['a', 'a'], capacity: 4 }, { actions: [''], capacity: 4 },
    { actions: Array.from({ length: 33 }, (_, i) => `a${i}`), capacity: 4 }, { actions: ['a'], capacity: 0 }, { actions: ['a'], capacity: 3601 },
    { actions: ['a'], capacity: 1.5 }, { actions: ['a', 'b'], capacity: 4, opposites: [{ a: 'a', b: 'a', policy: 'neutral' }] },
    { actions: ['a', 'b'], capacity: 4, opposites: [{ a: 'a', b: 'c', policy: 'neutral' }] },
    { actions: ['a', 'b'], capacity: 4, opposites: [{ a: 'a', b: 'b', policy: 'up-wins' }] },
    { actions: ['a', 'b', 'c'], capacity: 4, opposites: [{ a: 'a', b: 'b', policy: 'last' }, { a: 'b', b: 'c', policy: 'last' }] }];
  for (const o of bad) assert.throws(() => createInputHistory(o as InputHistoryOptions), RangeError);
  const wide = createInputHistory({ actions: Array.from({ length: 32 }, (_, i) => `a${i}`), capacity: 4 });
  assert.equal(wide.record(0, 0xffffffff).status, 'recorded', 'all 32 bits usable');
  assert.equal(wide.heldAt(0), 0xffffffff);
  const supplied = ['x', 'y'];
  const h = createInputHistory({ actions: supplied, capacity: 4 });
  supplied.push('z');
  assert.deepEqual(h.actions, ['x', 'y']);
  assert.ok(Object.isFrozen(h) && Object.isFrozen(h.actions));
});

test('INPUT-HISTORY record: contiguous frames only, exact press/release edges, refusals change nothing', () => {
  const h = make();
  assert.equal(h.record(-1, 0).status, 'invalid');
  assert.equal(h.record(1.5, 0).status, 'invalid');
  assert.equal(h.record(0, 1 << 6).status, 'invalid', 'a bit beyond the declared actions');
  assert.equal(h.record(0, 0, -1).status, 'invalid');
  const r = h.record(100, h.mask(['down']));
  assert.deepEqual({ ...r }, { status: 'recorded', frame: 100, held: h.mask(['down']), pressed: h.mask(['down']), released: 0 });
  assert.equal(h.record(100, 0).status, 'stale');
  assert.equal(h.record(99, 0).status, 'stale');
  assert.equal(h.record(102, 0).status, 'gap');
  assert.equal(h.latest(), 100);
  feed(h, [['down', 'right'], ['right'], []]);
  assert.deepEqual(h.names(h.heldAt(101)), ['down', 'right']);
  assert.ok(h.pressed('right', 101) && !h.pressed('down', 101));
  assert.ok(h.released('down', 102) && h.released('right', 103) && !h.released('right', 102));
  assert.ok(!h.held('right') && h.held('right', 102));
  assert.throws(() => h.held('jump'), RangeError);
  assert.throws(() => h.heldAt(99), RangeError, 'never recorded');
  assert.throws(() => h.heldAt(104), RangeError, 'future');
});

test('INPUT-HISTORY taps: a press released within one tick is held for exactly one frame (negative edge next frame)', () => {
  const h = make();
  feed(h, [[]]);
  assert.equal(h.record(1, 0, h.mask(['p'])).status, 'recorded');
  assert.equal(h.record(2, 0).status, 'recorded');
  assert.ok(h.pressed('p', 1) && h.held('p', 1) && h.released('p', 2));
  // A tap while already held adds no second edge.
  feed(h, [['k']]);
  assert.equal(h.record(4, h.mask(['k']), h.mask(['k'])).status, 'recorded');
  assert.ok(!h.pressed('k', 4));
});

test('INPUT-HISTORY baseline: reset decides whether input held at the start counts as a press', () => {
  const h = make();
  h.reset(h.mask(['p']));
  feed(h, [['p']], 0);
  assert.equal(h.pressed('p', 0), false, 'held across the reset is not a new press');
  h.reset();
  feed(h, [['p']], 0);
  assert.equal(h.pressed('p', 0), true);
  assert.throws(() => h.reset(1 << 10), RangeError);
});

test('INPUT-HISTORY buffer windows: latest edge inside the window, consumption, and no answers from evicted frames', () => {
  const h = make({ capacity: 8 });
  feed(h, [[], [], ['p'], ['p'], [], [], []], 10); // press at 12, release at 14, latest 16
  assert.equal(h.lastEdge('p', 'press', 5), 12);
  assert.equal(h.lastEdge('p', 'press', 4), -1);
  assert.equal(h.lastEdge('p', 'release', 3), 14);
  assert.equal(h.lastEdge('p', 'press', 3, 13), 12);
  assert.equal(h.lastEdge('p', 'press', 8, 11), -1, 'frames before the first record are no edge, not an error');
  assert.equal(h.consume('p', 12), true);
  assert.equal(h.consume('p', 12), false, 'consumed once');
  assert.equal(h.consume('p', 13), false, 'no edge there');
  assert.equal(h.lastEdge('p', 'press', 5), -1, 'a consumed press does not fire a buffer twice');
  assert.equal(h.lastEdge('p', 'press', 5, undefined, true), 12);
  feed(h, [[], [], []]); // latest 19, oldest 12
  assert.equal(h.oldest(), 12);
  assert.throws(() => h.lastEdge('p', 'press', 8, 18), RangeError, 'window reaches evicted frame 11');
  assert.throws(() => h.lastEdge('p', 'press', 9), RangeError, 'within beyond capacity');
  assert.throws(() => h.lastEdge('p', 'press', 0), RangeError);
  assert.throws(() => h.lastEdge('p', 'press', 2, 20), RangeError, 'future frame');
  assert.throws(() => h.lastEdge('p', 'tap' as 'press', 2), RangeError);
  assert.throws(() => h.heldAt(11), RangeError, 'evicted');
  assert.equal(createInputHistory({ actions: ['a'], capacity: 4 }).lastEdge('a', 'press', 4), -1, 'empty history');
});

test('INPUT-HISTORY opposite cleaning: neutral, last, first, fixed priority and same-frame ties', () => {
  const run = (policy: 'neutral' | 'last' | 'first' | 'a' | 'b', frames: (readonly string[])[]) => {
    const h = make({ opposites: [{ a: 'left', b: 'right', policy }, { a: 'up', b: 'down', policy: 'neutral' }] });
    feed(h, frames, 0);
    return frames.map((_, f) => h.names(h.heldAt(f)).join('+'));
  };
  const frames = [['left'], ['left', 'right'], ['right'], ['left', 'right'], ['left', 'right', 'up', 'down']];
  assert.deepEqual(run('neutral', frames), ['left', '', 'right', '', '']);
  assert.deepEqual(run('last', frames), ['left', 'right', 'right', 'left', 'left'], 'frame 3 re-presses left after right');
  assert.deepEqual(run('first', frames), ['left', 'left', 'right', 'right', 'right']);
  assert.deepEqual(run('a', frames), ['left', 'left', 'right', 'left', 'left']);
  assert.deepEqual(run('b', frames), ['left', 'right', 'right', 'right', 'right']);
  assert.deepEqual(run('last', [['left', 'right']]), [''], 'pressed on the same frame: neutral');
  // Edges follow the cleaned history: under 'last', right taking over releases left.
  const h = make({ opposites: [{ a: 'left', b: 'right', policy: 'last' }] });
  feed(h, [['left'], ['left', 'right']], 0);
  assert.ok(h.released('left', 1) && h.pressed('right', 1));
});

const QCF: SequenceStep[] = [{ all: ['down'], none: ['right'] }, { all: ['down', 'right'] }, { all: ['right'], none: ['down'], pressed: ['p'] }];

test('INPUT-HISTORY sequences: a lenient motion within its window, maxGap, consumption and the latest match', () => {
  const h = make();
  const qcf = h.sequence(QCF);
  feed(h, [[], ['down'], ['down'], ['down', 'right'], [], ['right'], ['right', 'p'], []], 0);
  assert.deepEqual({ ...h.match(qcf, { within: 8 })! }, { start: 2, end: 6 });
  assert.deepEqual({ ...h.match(qcf, { within: 6 })! }, { start: 2, end: 6 });
  assert.equal(h.match(qcf, { within: 5 }), null, 'the down frames fall outside the window');
  assert.equal(h.match(qcf, { within: 8, maxGap: 2 }), null, 'neutral frame 4 makes a 3-frame gap');
  assert.deepEqual({ ...h.match(qcf, { within: 8, maxGap: 3 })! }, { start: 2, end: 6 });
  assert.equal(h.match(qcf, { within: 3, at: 6 }), null);
  h.consume('p', 6);
  assert.equal(h.match(qcf, { within: 8 }), null, 'the button press is spent');
  assert.throws(() => h.match(make().sequence(QCF), { within: 8 }), RangeError, 'foreign sequence');
  assert.throws(() => h.match(qcf, { within: 8, maxGap: 9 }), RangeError);
  assert.throws(() => h.sequence([]), RangeError);
  assert.throws(() => h.sequence([{}]), RangeError);
  assert.throws(() => h.sequence([{ all: ['p'], none: ['p'] }]), RangeError);
  assert.throws(() => h.sequence(Array.from({ length: 17 }, () => ({ all: ['p'] }))), RangeError);
  assert.throws(() => h.sequence([{ all: ['jump'] }]), RangeError);
});

test('INPUT-HISTORY sequences: maxGap prefers a later step choice when the earliest one is too far', () => {
  const h = make();
  const seq = h.sequence([{ pressed: ['p'] }, { pressed: ['k'] }]);
  // p at 0, p again at 5, k at 7: greedy-earliest (0 -> 7) violates maxGap 3; (5 -> 7) satisfies it.
  feed(h, [['p'], [], [], [], [], ['p'], [], ['k']], 0);
  assert.deepEqual({ ...h.match(seq, { within: 8, maxGap: 3 })! }, { start: 5, end: 7 });
});

/** Exhaustive oracle: does an increasing assignment of steps to frames with gaps <= maxGap exist? Latest end. */
function bruteForce(h: InputHistory, steps: SequenceStep[], lo: number, hi: number, maxGap: number): number | null {
  const ok = (s: SequenceStep, f: number) => {
    const has = (names: readonly string[] | undefined, test: (n: string) => boolean) => (names ?? []).every(test);
    return has(s.all, n => h.held(n, f)) && has(s.none, n => !h.held(n, f)) && has(s.released, n => h.released(n, f))
      && has(s.pressed, n => h.pressed(n, f) && h.lastEdge(n, 'press', 1, f) === f);
  };
  const ends = (i: number, prev: number): number[] => {
    const out: number[] = [];
    for (let f = i === 0 ? lo : prev + 1; f <= (i === 0 ? hi : Math.min(hi, prev + maxGap)); f++)
      if (ok(must(steps[i]), f)) out.push(...(i === steps.length - 1 ? [f] : ends(i + 1, f)));
    return out;
  };
  const all = ends(0, -1);
  return all.length ? Math.max(...all) : null;
}

test('INPUT-HISTORY sequences agree with an exhaustive oracle on seeded random histories', () => {
  const rng = createRng('input-history-oracle');
  const pool: SequenceStep[] = [{ all: ['down'] }, { all: ['down', 'right'] }, { all: ['right'], none: ['down'] }, { pressed: ['p'] },
    { released: ['k'] }, { all: ['left'], pressed: ['k'] }, { none: ['up', 'down'] }];
  let matched = 0, checks = 0;
  for (let trial = 0; trial < 300; trial++) {
    const h = make({ capacity: 24 });
    const length = rng.int(4, 24);
    for (let f = 0; f < length; f++) h.record(f, rng.int(0, (1 << ACTIONS.length) - 1) & rng.int(0, (1 << ACTIONS.length) - 1));
    if (rng.next() < 0.3) for (let f = 0; f < length; f++) h.consume('p', f);
    const steps = Array.from({ length: rng.int(1, 4) }, () => rng.pick(pool));
    const within = rng.int(1, length), maxGap = rng.int(1, within), at = rng.int(within - 1, length - 1);
    const got = h.match(h.sequence(steps), { within, maxGap, at });
    const want = bruteForce(h, steps, Math.max(0, at - within + 1), at, maxGap);
    assert.equal(got?.end ?? null, want, `trial ${trial}`);
    if (got) {
      matched++;
      assert.ok(got.start <= got.end && got.start >= at - within + 1);
    }
    checks++;
  }
  assert.equal(checks, 300);
  assert.ok(matched > 30 && matched < 290, `oracle cases exercise both outcomes (${matched})`);
});

test('INPUT-HISTORY snapshots: exact round trip through JSON, after wrap-around, and identical continuation', () => {
  const rng = createRng(3);
  const a = make({ capacity: 8, opposites: [{ a: 'left', b: 'right', policy: 'last' }] });
  for (let f = 0; f < 21; f++) a.record(f, rng.int(0, 63));
  a.consume('p', a.lastEdge('p', 'press', 8, undefined, true) >= 0 ? a.lastEdge('p', 'press', 8, undefined, true) : 20);
  const text = JSON.stringify(a.save());
  const b = make({ capacity: 8, opposites: [{ a: 'left', b: 'right', policy: 'last' }] });
  b.load(JSON.parse(text));
  assert.equal(JSON.stringify(b.save()), text);
  for (let f = 21; f < 40; f++) {
    const mask = rng.int(0, 63);
    assert.deepEqual({ ...b.record(f, mask) }, { ...a.record(f, mask) });
    assert.equal(b.lastEdge('p', 'press', 8), a.lastEdge('p', 'press', 8));
  }
  // Loading an empty snapshot clears.
  const empty = make({ capacity: 8, opposites: [{ a: 'left', b: 'right', policy: 'last' }] }).save();
  b.load(empty);
  assert.equal(b.latest(), -1);
});

test('INPUT-HISTORY snapshots: tampered or foreign data is refused and leaves the history unchanged', () => {
  const h = make({ capacity: 8 });
  feed(h, [['down'], ['down', 'p'], ['p'], []], 0);
  const good = h.save(), before = JSON.stringify(good);
  const tamper = (patch: Record<string, unknown>) => ({ ...JSON.parse(before), ...patch });
  const cases = [
    null, tamper({ v: 2 }), tamper({ config: make({ capacity: 9 }).save().config }), tamper({ first: 2, latest: 1 }),
    tamper({ latest: 4 }), tamper({ held: [1, 2, 3] }), tamper({ press: [0, 0, 0, 0] }), tamper({ held: [2, 2, 1 << 9, 0] }),
    tamper({ consumed: [0, 0, 16, 0] }), tamper({ prevHeld: 1 }), tamper({ lastRawPress: [0] }), tamper({ lastRawPress: [9, -1, -1, -1, -1, -1] }),
    tamper({ held: [2, 2.5, 16, 0] }),
  ];
  for (const snapshot of cases) {
    assert.throws(() => h.load(snapshot as never), RangeError);
    assert.equal(JSON.stringify(h.save()), before);
  }
  assert.ok(Object.isFrozen(good) && Object.isFrozen(good.held));
});

test('INPUT-HISTORY reset baseline is cleaned like a frame: opposites held across a reset report no false edges', () => {
  for (const policy of ['neutral', 'last', 'first', 'a', 'b'] as const) {
    const h = make({ opposites: [{ a: 'left', b: 'right', policy }] });
    const both = h.mask(['left', 'right']);
    h.reset(both);
    const r = h.record(0, both);
    assert.equal(r.status, 'recorded');
    assert.deepEqual({ pressed: (r as { pressed: number }).pressed, released: (r as { released: number }).released }, { pressed: 0, released: 0 }, policy);
    // Letting go of one side afterwards is an ordinary change from the cleaned baseline.
    const after = h.record(1, h.mask(['right']));
    const expectPress = policy === 'b' ? 0 : h.mask(['right']);
    assert.equal((after as { pressed: number }).pressed, expectPress, policy);
  }
});

test('INPUT-HISTORY frames before the first record are outside every window: no edges and no sequence steps', () => {
  const h = make();
  feed(h, [[], ['p']], 5);
  const idle = h.sequence([{ none: ['p'] }, { pressed: ['p'] }]);
  const quiet = h.sequence([{ none: ['p'] }]);
  assert.deepEqual({ ...h.match(idle, { within: 8 })! }, { start: 5, end: 6 }, 'the step before the press can only use recorded frame 5');
  assert.deepEqual({ ...h.match(quiet, { within: 8, at: 5 })! }, { start: 5, end: 5 }, 'never a frame before the first record');
  const late = make();
  feed(late, [['p']], 5);
  assert.equal(late.match(late.sequence([{ none: ['p'] }, { pressed: ['p'] }]), { within: 8 }), null, 'an unrecorded frame does not satisfy `none`');
  assert.equal(late.lastEdge('p', 'press', 8), 5);
});

test('INPUT-HISTORY edge queries: an omitted frame on an empty history is false, an explicit frame must be retained', () => {
  const h = make();
  assert.equal(h.held('p'), false);
  assert.equal(h.pressed('p'), false);
  assert.equal(h.released('p'), false);
  for (const query of [() => h.held('p', 0), () => h.pressed('p', 0), () => h.released('p', 3), () => h.heldAt(0)])
    assert.throws(query, RangeError);
  assert.throws(() => h.held('jump'), RangeError, 'an unknown action throws even when empty');
  feed(h, [['p']], 0);
  assert.equal(h.pressed('p'), true);
  assert.throws(() => h.pressed('p', 1), RangeError);
});
