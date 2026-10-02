// NW-09 seeded fault-schedule harness: CI-sized fixed seeds, determinism and repro.
// Process-scope loopback evidence only; see docs/guides/network-fault-schedule.md.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule, createRandom, shrinkSchedule, describeStep } from './fault-schedule.mjs';
import { runFaultSchedule, DEFAULT_SEEDS, DEFAULT_STEPS } from './fault-harness.mjs';

const version = process.versions.node.split('.').map(Number);
const supported = version[0] > 22 || (version[0] === 22 && version[1] >= 13);
const optional = (name, timeout, fn) =>
  test(name, { skip: supported ? false : 'Optional SQLite reference requires Node >=22.13', timeout }, fn);

// Every run checks that it released its sockets, servers and timers and fails if not. Should
// one still leak after such a failure, this unref'd guard ends the file's process instead of
// letting it hang; it never fires when the process exits on its own.
after(() => { setTimeout(() => process.exit(process.exitCode ?? 1), 5000).unref(); });

test('NW09: a seed yields the same schedule every time and different seeds differ', () => {
  const a = generateSchedule({ seed: 7, steps: 200 });
  assert.deepEqual(generateSchedule({ seed: 7, steps: 200 }), a);
  assert.notDeepEqual(generateSchedule({ seed: 8, steps: 200 }), a);
  assert.ok(Object.isFrozen(a) && a.every(Object.isFrozen));
  const kinds = new Set(a.map((s) => s.t));
  for (const k of ['input', 'net', 'disconnect', 'hold-commit', 'storage', 'clock', 'slow']) assert.ok(kinds.has(k), k);
  assert.ok(a.every((s) => s.dt >= 20 && s.dt <= 120));
  assert.match(describeStep(a[0]), /\(\+\d+ms\)$/);
  const r = createRandom(1), values = Array.from({ length: 1000 }, r.next);
  assert.ok(values.every((v) => v >= 0 && v < 1));
  assert.throws(() => createRandom(-1));
  assert.throws(() => generateSchedule({ seed: 1, steps: 0 }));
});

test('NW09: shrinking keeps only the steps a failure needs, within its run bound', async () => {
  const schedule = generateSchedule({ seed: 3, steps: 64 }).map((s, i) => ({ ...s, i }));
  const fails = async (candidate) =>
    candidate.some((s) => s.i === 17) && candidate.some((s) => s.i === 40) ? { invariant: 'x' } : null;
  const { schedule: minimal, runs } = await shrinkSchedule(schedule, fails, { invariant: 'x' });
  assert.deepEqual(minimal.map((s) => s.i), [17, 40]);
  assert.ok(runs <= 200);
  const bounded = await shrinkSchedule(schedule, fails, { invariant: 'x', maxRuns: 3 });
  assert.equal(bounded.runs, 3);
  const other = await shrinkSchedule(schedule, async () => ({ invariant: 'y' }), { invariant: 'x' });
  assert.equal(other.schedule.length, schedule.length, 'a different invariant is not the same failure');
});

optional('NW09: fixed seeds keep every invariant under combined faults and exercise each fault kind', 120000, async () => {
  const total = {};
  for (let seed = 1; seed <= DEFAULT_SEEDS; seed++) {
    const result = await runFaultSchedule({ seed, schedule: generateSchedule({ seed, steps: DEFAULT_STEPS }) });
    assert.equal(result.ok, true, `seed ${seed}: ${JSON.stringify(result.failure)}\n${result.trace.slice(-8).join('\n')}`);
    assert.match(result.trace.at(-1), /^converged/);
    for (const [k, v] of Object.entries(result.stats)) if (typeof v === 'number') total[k] = (total[k] ?? 0) + v;
  }
  // The evidence is not vacuous: every fault family fired and commands still committed.
  for (const k of ['commits', 'restarts', 'crashes', 'storageBeforeCommit', 'storageAfterCommit', 'recoveries',
    'overflowCloses', 'baselineTimeouts', 'replaced', 'revoked', 'dropped', 'duplicated', 'delayed'])
    assert.ok(total[k] > 0, `${k} never exercised: ${JSON.stringify(total)}`);
});

optional('NW09: one seed replays to an identical trace fingerprint', 60000, async () => {
  const schedule = generateSchedule({ seed: 5, steps: DEFAULT_STEPS });
  const first = await runFaultSchedule({ seed: 5, schedule });
  const second = await runFaultSchedule({ seed: 5, schedule });
  assert.equal(first.ok, true);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.deepEqual(second.trace, first.trace);
});

for (const kind of ['state', 'receipt']) {
  optional(`NW09: injected durable ${kind} corruption fails at its step, reproduces exactly and shrinks`, 120000, async () => {
    const schedule = [...generateSchedule({ seed: 11, steps: 80 })];
    schedule.splice(60, 0, { t: 'sabotage', kind, dt: 50 });
    await assert.rejects(runFaultSchedule({ seed: 11, schedule: { length: 1 } }));
    const unarmed = await runFaultSchedule({ seed: 11, schedule });
    assert.equal(unarmed.failure.invariant, 'schedule', 'sabotage requires explicit opt-in');
    const first = await runFaultSchedule({ seed: 11, schedule, allowSabotage: true });
    const expected = kind === 'state' ? 'state-history' : 'receipt-immutable';
    assert.equal(first.ok, false);
    assert.equal(first.failure.step, 60);
    assert.equal(first.failure.invariant, expected, first.failure.detail);
    const again = await runFaultSchedule({ seed: 11, schedule, allowSabotage: true });
    assert.deepEqual(again.failure, first.failure);
    assert.equal(again.fingerprint, first.fingerprint);
    const { schedule: minimal } = await shrinkSchedule(schedule,
      async (candidate) => (await runFaultSchedule({ seed: 11, schedule: candidate, allowSabotage: true })).failure,
      { invariant: expected, maxRuns: 60 });
    assert.ok(minimal.length < 10, `shrunk to ${minimal.length}`);
    assert.ok(minimal.some((s) => s.t === 'sabotage'));
  });
}

optional('NW09: an adapter that commits before its fault hook and reports rejected fails storage-outcome', 60000, async () => {
  // Expected outcomes come from the authority's own CAS base, never from storage itself.
  const schedule = generateSchedule({ seed: 2, steps: DEFAULT_STEPS });
  await assert.rejects(runFaultSchedule({ seed: 2, schedule, defect: 'unknown-defect' }));
  const first = await runFaultSchedule({ seed: 2, schedule, defect: 'hooks-after-commit-rejected' });
  assert.equal(first.ok, false);
  assert.equal(first.failure.invariant, 'storage-outcome', first.failure.detail);
  assert.match(first.failure.detail, /^before-commit failure: storage r(\d+), expected r(\d+)$/);
  const [, stored, expected] = first.failure.detail.match(/r(\d+), expected r(\d+)/).map(Number);
  assert.equal(stored, expected + 1, 'the defective adapter wrote although it reported rejected');
  const again = await runFaultSchedule({ seed: 2, schedule, defect: 'hooks-after-commit-rejected' });
  assert.deepEqual(again.failure, first.failure);
  const healthy = await runFaultSchedule({ seed: 2, schedule });
  assert.equal(healthy.ok, true, JSON.stringify(healthy.failure));
});
