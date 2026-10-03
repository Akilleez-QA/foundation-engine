// Node micro-benchmark for the optional deterministic maths (src/core/dmath.ts) against the engine's Math. Timings
// are this machine's wall clock in one JIT, not a frame budget or a device certification.
//
//   node --import tsx tools/dmath-bench/bench.mjs
import {performance} from 'node:perf_hooks';
import {timings} from './workload.ts';

const rows = timings(() => performance.now());
console.log(
  `node ${process.versions.node} (V8 ${process.versions.v8}), ns per call, best of 3 rounds of 400,000 calls`,
);
console.log('| function | dmath ns | Math ns | dmath / Math |');
console.log('|---|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.fn} | ${r.dmathNs} | ${r.mathNs} | ${r.ratio} |`);
