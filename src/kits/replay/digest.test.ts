import test from 'node:test';
import assert from 'node:assert/strict';
import {compareDigests, createDigestTrace, type DigestTraceOptions} from './digest';
import {digestJson, hashText} from './hash';

const base: DigestTraceOptions = {identity: 'run', every: 1, maxEntries: 100, maxDigestLength: 32};
function trace(ticks: number, value: (tick: number) => string, o: Partial<DigestTraceOptions> = {}, first = 0) {
  const t = createDigestTrace({...base, ...o});
  for (let i = first; i < first + ticks; i++) t.observe(i, () => value(i));
  return t.read();
}
const same = (t: number) => `s${t}`;
const breaksAt = (k: number) => (t: number) => (t >= k ? `x${t}` : `s${t}`);

test('SIM-01 digest: the cadence decides which ticks call the creator digest', () => {
  let calls = 0;
  const t = createDigestTrace({...base, every: 4});
  const results = Array.from({length: 10}, (_, i) =>
    t.observe(i, () => {
      calls++;
      return `d${i}`;
    }),
  );
  assert.equal(calls, 3);
  assert.deepEqual(results, [
    'sampled',
    'skipped',
    'skipped',
    'skipped',
    'sampled',
    'skipped',
    'skipped',
    'skipped',
    'sampled',
    'skipped',
  ]);
  assert.deepEqual(t.read().entries, [
    [0, 'd0'],
    [4, 'd4'],
    [8, 'd8'],
  ]);
  assert.equal(t.read().lastTick, 9);
});

test('SIM-01 digest: the ring keeps the newest samples and counts what it evicted', () => {
  const s = trace(10, same, {maxEntries: 3});
  assert.deepEqual(s.entries, [
    [7, 's7'],
    [8, 's8'],
    [9, 's9'],
  ]);
  assert.equal(s.dropped, 7);
  assert.equal(s.firstTick, 0);
});

test('SIM-01 digest: identical traces are equal over their whole range', () => {
  assert.deepEqual(compareDigests(trace(50, same), trace(50, same)), {
    status: 'equal',
    from: 0,
    through: 49,
    samples: 50,
  });
});

test('SIM-01 digest: the first divergent tick is reported exactly at cadence 1', () => {
  const r = compareDigests(trace(50, same), trace(50, breaksAt(37)));
  assert.equal(r.status, 'diverged');
  if (r.status === 'diverged') {
    assert.equal(r.tick, 37);
    assert.equal(r.after, 36);
    assert.equal(r.exact, true);
    assert.equal(r.a, 's37');
    assert.equal(r.b, 'x37');
  }
});

test('SIM-01 digest: at a coarser cadence the divergence is bracketed between samples', () => {
  const r = compareDigests(trace(50, same, {every: 10}), trace(50, breaksAt(37), {every: 10}));
  assert.equal(r.status, 'diverged');
  if (r.status === 'diverged') {
    assert.equal(r.tick, 40);
    assert.equal(r.after, 30);
    assert.equal(r.exact, true);
  }
});

test('SIM-01 digest: evicted history is never a silent pass', () => {
  const equalTail = compareDigests(trace(50, same, {maxEntries: 5}), trace(50, same));
  assert.equal(equalTail.status, 'inconclusive');
  if (equalTail.status === 'inconclusive') assert.equal(equalTail.reason, 'history-dropped');
  // A divergence inside the retained window is real, but it may not be the first: not exact.
  const late = compareDigests(trace(50, same, {maxEntries: 5}), trace(50, breaksAt(47)));
  assert.equal(late.status, 'diverged');
  if (late.status === 'diverged') {
    assert.equal(late.tick, 47);
    assert.equal(late.exact, false);
  }
  // A divergence that was evicted from one ring is not visible in the overlap: inconclusive, not equal.
  assert.equal(
    compareDigests(trace(50, breaksAt(10), {maxEntries: 5}), trace(50, breaksAt(10))).status,
    'inconclusive',
  );
});

test('SIM-01 digest: different ranges are inconclusive unless a common horizon is named', () => {
  const r = compareDigests(trace(50, same), trace(40, same));
  assert.equal(r.status, 'inconclusive');
  if (r.status === 'inconclusive') assert.equal(r.reason, 'range-differs');
  assert.deepEqual(compareDigests(trace(50, same), trace(40, same), {through: 39}), {
    status: 'equal',
    from: 0,
    through: 39,
    samples: 40,
  });
  assert.equal(compareDigests(trace(50, same), trace(40, same), {through: 45}).status, 'inconclusive');
  assert.equal(compareDigests(trace(40, same, {}, 10), trace(50, same)).status, 'inconclusive', 'different first tick');
  assert.throws(() => compareDigests(trace(5, same), trace(5, same), {through: -1}), /through/);
});

test('SIM-01 digest: traces for another identity, cadence or a failed trace are incomparable', () => {
  assert.deepEqual(compareDigests(trace(5, same), trace(5, same, {identity: 'other'})), {
    status: 'incomparable',
    reason: 'identity',
  });
  assert.deepEqual(compareDigests(trace(5, same), trace(5, same, {every: 2})), {
    status: 'incomparable',
    reason: 'cadence',
  });
  assert.deepEqual(
    compareDigests(
      trace(5, same),
      trace(5, () => 'x'.repeat(40)),
    ),
    {status: 'incomparable', reason: 'failed'},
  );
  assert.deepEqual(compareDigests(trace(5, same), trace(5, same, {}, 100)), {
    status: 'incomparable',
    reason: 'no-overlap',
  });
});

test('SIM-01 digest: out-of-order ticks and bad digests fail the trace instead of being skipped', () => {
  const t = createDigestTrace(base);
  t.observe(0, () => 'a');
  assert.equal(
    t.observe(2, () => 'b'),
    'failed',
  );
  assert.equal(t.read().reason, 'tick-order');
  assert.equal(
    t.observe(1, () => 'b'),
    'failed',
    'a failed trace stays failed',
  );
  for (const [digest, reason] of [
    [
      () => {
        throw Error('x');
      },
      'digest-threw',
    ],
    [() => '', 'digest-not-string'],
    [() => 'x'.repeat(33), 'digest-too-long'],
  ] as const) {
    const u = createDigestTrace(base);
    assert.equal(u.observe(0, digest as () => string), 'failed');
    assert.equal(u.read().reason, reason);
  }
  assert.throws(() => createDigestTrace({...base, every: 0}), /positive/);
  assert.throws(() => createDigestTrace({...base, identity: ''}), /identity/);
  assert.throws(() => createDigestTrace({...base, detail: {from: 5, to: 4, maxChars: 1}}), /detail/);
});

test('SIM-01 digest: the detail window is bounded and reported at the divergent tick', () => {
  const o = {detail: {from: 30, to: 40, maxChars: 30}};
  const a = createDigestTrace({...base, ...o}),
    b = createDigestTrace({...base, ...o});
  for (let i = 0; i < 50; i++) {
    a.observe(
      i,
      () => `s${i}`,
      () => `a${i}`,
    );
    b.observe(
      i,
      () => (i >= 33 ? `x${i}` : `s${i}`),
      () => `b${i}`,
    );
  }
  assert.equal(a.read().details.length, 10, '3 characters each, 30 kept');
  assert.equal(a.read().detailTruncated, true);
  const r = compareDigests(a.read(), b.read());
  assert.equal(r.status, 'diverged');
  if (r.status === 'diverged') assert.deepEqual(r.detail, {a: 'a33', b: 'b33'});
});

test('SIM-01 hash: canonical digests ignore key order and whitespace, and see any value change', () => {
  const limits = {maxBytes: 1024, maxNodes: 64, maxDepth: 8};
  assert.equal(digestJson('{"a":1,"b":[1,2]}', limits), digestJson('{ "b": [1, 2], "a": 1 }', limits));
  assert.notEqual(digestJson('{"a":1,"b":[1,2]}', limits), digestJson('{"a":1,"b":[2,1]}', limits));
  assert.notEqual(digestJson('{"a":0.1}', limits), digestJson('{"a":0.10000000000000002}', limits));
  assert.match(hashText(''), /^[0-9a-f]{16}$/);
  assert.notEqual(hashText('ab'), hashText('ba'));
  assert.throws(() => digestJson('{"a":', limits));
});
