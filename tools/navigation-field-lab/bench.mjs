import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createNavigationGraph, createPathSearch} from '../../src/kits/navigation/search.ts';
import {prepareFieldTopology, createReverseField} from './field.mjs';

const width = 32;
const nodes = Array.from({length: width * width}, (_, i) => {
  const x = i % width,
    z = Math.floor(i / width),
    edges = [];
  for (const [dx, dz] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const a = x + dx,
      b = z + dz;
    if (a >= 0 && b >= 0 && a < width && b < width) edges.push({to: String(b * width + a), cost: 1});
  }
  return {id: String(i), edges};
});
const graph = createNavigationGraph(nodes),
  goal = String(width * width - 1);
const estimates = Object.fromEntries(
  nodes.map((node, i) => [node.id, 2 * (width - 1) - (i % width) - Math.floor(i / width)]),
);
const runBaseline = (starts, heuristic = false) => {
  let work = 0;
  const results = [];
  for (const start of starts) {
    const search = createPathSearch(graph, start, goal, heuristic ? estimates : {});
    while (search.result.status === 'pending') work += search.step(256).work;
    results.push(search.result);
  }
  return {work, results};
};
const runShared = starts => {
  const topology = prepareFieldTopology(graph, 1),
    field = createReverseField(topology, goal);
  let work = 0;
  while (field.status === 'pending') work += field.step(256).work;
  return {work, results: starts.map(start => field.route(start, 1)), typedBytes: field.typedBytes};
};
const rows = [];
for (const [scenario, agents] of [
  ['near', 1],
  ['spread', 1],
  ['spread', 8],
  ['spread', 64],
  ['spread', 256],
]) {
  const starts = Array.from({length: agents}, (_, i) =>
    String(scenario === 'near' ? width * width - 2 : (i * 37) % (width * width - 1)),
  );
  const a = runBaseline(starts),
    b = runShared(starts),
    c = runBaseline(starts, true);
  assert.deepEqual(
    c.results.map(r => [r.status, r.cost]),
    a.results.map(r => [r.status, r.cost]),
  );
  assert.deepEqual(
    b.results.map(r => [r.status, r.cost]),
    a.results.map(r => [r.status, r.cost]),
  );
  for (let i = 0; i < 3; i++) {
    runBaseline(starts);
    runShared(starts);
    runBaseline(starts, true);
  }
  const times = {baseline: [], shared: [], astar: []};
  for (let sample = 0; sample < 9; sample++) {
    for (const name of sample % 2 ? ['shared', 'astar', 'baseline'] : ['baseline', 'astar', 'shared']) {
      const begin = performance.now();
      name === 'shared' ? runShared(starts) : runBaseline(starts, name === 'astar');
      times[name].push(performance.now() - begin);
    }
  }
  const med = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  rows.push({
    scenario,
    agents,
    baselineMedianMs: med(times.baseline),
    astarMedianMs: med(times.astar),
    sharedMedianMs: med(times.shared),
    baselineWork: a.work,
    astarWork: c.work,
    sharedBuildWork: b.work,
    fieldTypedBytes: b.typedBytes,
    samplesMs: times,
  });
}
const files = [
  'tools/navigation-field-lab/field.mjs',
  'tools/navigation-field-lab/bench.mjs',
  'src/kits/navigation/search.ts',
];
const hashes = Object.fromEntries(
  files.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
);
const report = {
  node: process.version,
  cpu: cpus()[0]?.model,
  width,
  nodes: nodes.length,
  goal,
  warmups: 3,
  samples: 9,
  hashes,
  rows,
  scope:
    'Serial Node CPU experiment. Includes per-batch reverse topology creation, field construction and route copies; common immutable input graph creation excluded for both. Logical work excludes preparation and route copies on shared path; use elapsed timings for total cost comparison. No browser/physical device or production ownership acceptance.',
};
writeFileSync(new URL('./evidence.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    rows.map(({samplesMs, ...row}) => row),
    null,
    2,
  ),
);
