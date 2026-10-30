import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  computeNumericGolden,
  computeWorkloadDigests,
  fixedWorkload,
  floatWorkload,
  type NumericGolden,
} from './vectors';
import {createFixed, createWideFixed} from './fixed';
import {createFixedTrig} from './angle';
import {f32, pc24, createPrecision} from './precision';
import {createRollbackSyncTest} from '../rollback';
import {createDigestTrace, compareDigests} from '../replay';

const golden = JSON.parse(readFileSync(new URL('./numeric.golden.json', import.meta.url), 'utf8')) as NumericGolden;

test('numeric: the committed golden vectors and workload digests are exactly what this engine computes', () => {
  assert.equal(golden.format, 'foundation.numeric-golden');
  assert.equal(golden.version, 1);
  assert.deepEqual(computeNumericGolden(), golden.cases);
  assert.deepEqual(computeWorkloadDigests(), golden.workload);
  assert.ok(Object.values(golden.cases).reduce((n, rows) => n + rows.length, 0) >= 500);
});

test('numeric: a run gives the same state twice, and a different precision gives a different digest', () => {
  assert.deepEqual(fixedWorkload(300), fixedWorkload(300));
  assert.deepEqual(floatWorkload(f32, 300), floatWorkload(f32, 300));
  // An 11-bit significand is a different arithmetic: the digests must differ, or the workload proves nothing.
  assert.notEqual(floatWorkload(createPrecision({significandBits: 11}), 300).digest, floatWorkload(pc24, 300).digest);
});

/** A fixed-point lockstep simulation behind the rollback kit's save/load/step ports. */
function fixedSim() {
  const q = createFixed({wordBits: 32, fracBits: 16, overflow: 'saturate'});
  const wide = createWideFixed({wordBits: 64, fracBits: 32});
  const trig = createFixedTrig(q);
  let s = {x: [0, q.fromInt(10)], y: [0, 0], heading: [0, 32768], score: wide.encode(0n)};
  return {
    save: () => JSON.stringify(s),
    load: (text: string) => {
      s = JSON.parse(text);
    },
    step: (inputs: readonly string[]) => {
      for (let p = 0; p < 2; p++) {
        const turn = inputs[p] === 'L' ? 512 : inputs[p] === 'R' ? -512 : 0;
        s.heading[p] = trig.wrap(s.heading[p]! + turn);
        s.x[p] = q.add(s.x[p]!, q.mul(trig.cos(s.heading[p]!), q.fromNumber(0.25)));
        s.y[p] = q.add(s.y[p]!, q.mul(trig.sin(s.heading[p]!), q.fromNumber(0.25)));
      }
      const dist = q.sqrt(
        q.add(
          q.mul(q.sub(s.x[0]!, s.x[1]!), q.sub(s.x[0]!, s.x[1]!)),
          q.mul(q.sub(s.y[0]!, s.y[1]!), q.sub(s.y[0]!, s.y[1]!)),
        ),
      );
      s.score = wide.encode(
        wide.add(wide.decode(s.score), wide.div(wide.fromInt(1), wide.add(wide.one, BigInt(dist) << 16n))),
      );
    },
  };
}

test('numeric: a fixed-point simulation passes the rollback sync test and replays with matching digests', () => {
  const sim = fixedSim();
  const sync = createRollbackSyncTest({
    checkDistance: 7,
    maxStateBytes: 4096,
    maxInputBytes: 1,
    players: 2,
    ports: sim,
  });
  const pattern = ['L', 'R', '0', 'L', 'L', '0', 'R'];
  const trace = () =>
    createDigestTrace({identity: 'numeric-lockstep', every: 5, maxEntries: 200, maxDigestLength: 4096});
  const first = trace();
  for (let t = 0; t < 240; t++) {
    const r = sync.advance([pattern[t % 7]!, pattern[(t * 3) % 7]!]);
    assert.equal(r.status, 'checked', JSON.stringify(r));
    first.observe(t, () => sim.save());
  }
  sync.dispose();
  const again = fixedSim(),
    second = trace();
  for (let t = 0; t < 240; t++) {
    again.step([pattern[t % 7]!, pattern[(t * 3) % 7]!]);
    second.observe(t, () => again.save());
  }
  assert.equal(compareDigests(first.read(), second.read()).status, 'equal');
});
