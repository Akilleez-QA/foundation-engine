// Headless CPU micro-benchmark for the optional spatial grid (src/kits/spatial). Node only: no browser, renderer,
// ECS frame loop or worker. Timings are this machine's wall clock, not a frame budget or device certification.
//
//   node --import tsx tools/spatial-bench/bench.mjs            (default cases: 1,000 and 10,000 entries)
//   node --import tsx tools/spatial-bench/bench.mjs --quick    (fewer ticks)
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {createQueryResult, createSpatialGrid} from '../../src/kits/spatial/grid.ts';
import {createInterestResult, createInterestSets} from '../../src/kits/spatial/interest.ts';
import {mulberry32} from '../../src/core/rng.ts';

const percentile = (samples, p) =>
  [...samples].sort((a, b) => a - b)[Math.max(0, Math.ceil(samples.length * p) - 1)] ?? 0;

/**
 * One case: `entries` agents random-walking on a square sized for constant density (about one per 100 square
 * units), so 10x entries is 10x area. Per tick: move every agent, one k-nearest neighbour query per agent (the
 * steering pattern: k = 6 within 8 units), and `observers` interest circles of radius 64. `warmup` ticks run
 * first and are excluded from timings and work counts.
 */
export function runCase({
  entries,
  ticks = 60,
  warmup = 10,
  observers = 64,
  cellSize = 16,
  neighbours = 6,
  neighbourRadius = 8,
  interestRadius = 64,
  seed = 1,
}) {
  const side = Math.ceil(Math.sqrt(entries * 100)),
    random = mulberry32(seed);
  const columns = Math.ceil(side / cellSize);
  const grid = createSpatialGrid({
    cellSize,
    minX: 0,
    minY: 0,
    maxX: side,
    maxY: side,
    maxEntries: entries,
    maxCells: columns * columns,
    maxCellsPerQuery: 100,
  });
  const xs = new Float64Array(entries),
    ys = new Float64Array(entries);
  for (let i = 0; i < entries; i++) {
    xs[i] = random() * side;
    ys[i] = random() * side;
    if (grid.insert(i, xs[i], ys[i]) !== 'inserted') throw Error('insert refused');
  }
  const near = new Float64Array(neighbours),
    seen = new Float64Array(4096),
    res = createQueryResult();
  const tick = {move: [], neighbours: [], interest: []};
  const work = {
    neighbourCells: 0,
    neighbourExamined: 0,
    neighbourFound: 0,
    interestCells: 0,
    interestExamined: 0,
    interestFound: 0,
    refused: 0,
  };
  for (let t = -warmup; t < ticks; t++) {
    if (t === 0) {
      for (const k in tick) tick[k].length = 0;
      for (const k in work) work[k] = 0;
    }
    let start = performance.now();
    for (let i = 0; i < entries; i++) {
      xs[i] = Math.min(side, Math.max(0, xs[i] + (random() - 0.5) * 2));
      ys[i] = Math.min(side, Math.max(0, ys[i] + (random() - 0.5) * 2));
      grid.move(i, xs[i], ys[i]);
    }
    tick.move.push(performance.now() - start);
    start = performance.now();
    for (let i = 0; i < entries; i++) {
      const r = grid.queryNearest(xs[i], ys[i], neighbourRadius, near, i, res);
      work.neighbourCells += r.cellsVisited;
      work.neighbourExamined += r.entriesExamined;
      work.neighbourFound += r.count;
      if (r.status !== 'complete') work.refused++;
    }
    tick.neighbours.push(performance.now() - start);
    start = performance.now();
    for (let o = 0; o < observers; o++) {
      const i = (o * 7919) % entries,
        r = grid.queryCircle(xs[i], ys[i], interestRadius, seen, res);
      work.interestCells += r.cellsVisited;
      work.interestExamined += r.entriesExamined;
      work.interestFound += r.count;
      if (r.status !== 'complete') work.refused++;
    }
    tick.interest.push(performance.now() - start);
  }
  // Brute-force reference for the neighbour pass on one tick: what the grid avoids (O(n^2) distance tests).
  let bruteMs = null;
  if (entries <= 10000) {
    const start = performance.now(),
      r2 = neighbourRadius * neighbourRadius;
    let found = 0;
    for (let i = 0; i < entries; i++)
      for (let j = 0; j < entries; j++) if (i !== j && (xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2 <= r2) found++;
    bruteMs = performance.now() - start;
    if (found < 0) throw Error('unreachable');
  }
  const stat = s => ({
    medianMs: +percentile(s, 0.5).toFixed(3),
    p95Ms: +percentile(s, 0.95).toFixed(3),
    maxMs: +Math.max(...s).toFixed(3),
  });
  const queries = entries * ticks,
    interest = observers * ticks;
  grid.dispose();
  return {
    entries,
    ticks,
    side,
    cellSize,
    cells: columns * columns,
    observers,
    moveAll: stat(tick.move),
    neighbourPass: stat(tick.neighbours),
    interestPass: stat(tick.interest),
    perNeighbourQuery: {
      cells: +(work.neighbourCells / queries).toFixed(2),
      examined: +(work.neighbourExamined / queries).toFixed(2),
      found: +(work.neighbourFound / queries).toFixed(2),
    },
    perInterestQuery: {
      cells: +(work.interestCells / interest).toFixed(2),
      examined: +(work.interestExamined / interest).toFixed(2),
      found: +(work.interestFound / interest).toFixed(2),
    },
    refused: work.refused,
    bruteForceNeighbourPassMs: bruteMs === null ? null : +bruteMs.toFixed(3),
  };
}

/**
 * SC-02 case: the same constant-density motion, plus `observers` interest sets (enter 48, exit 56, one hold
 * update, a send budget of 64) whose observers follow an entity. Per tick: move every entity and observer, then
 * update every observer's set. Reports the update pass, per-update work and event counts, and one tick of the
 * brute-force equivalent (every observer tests every entity).
 */
export function runInterestCase({
  entries,
  ticks = 60,
  warmup = 10,
  observers = 100,
  cellSize = 16,
  enterRadius = 48,
  exitRadius = 56,
  maxRelevant = 64,
  seed = 2,
}) {
  const side = Math.ceil(Math.sqrt(entries * 100)),
    random = mulberry32(seed),
    columns = Math.ceil(side / cellSize);
  const grid = createSpatialGrid({
    cellSize,
    minX: 0,
    minY: 0,
    maxX: side,
    maxY: side,
    maxEntries: entries,
    maxCells: columns * columns,
    maxCellsPerQuery: 100,
  });
  const limits = {
    enterRadius,
    exitRadius,
    holdUpdates: 1,
    maxObservers: observers,
    maxRelevant,
    maxCandidates: 1024,
    maxPrioritized: 1,
  };
  const sets = createInterestSets(grid, limits),
    out = createInterestResult(limits);
  const xs = new Float64Array(entries),
    ys = new Float64Array(entries);
  for (let i = 0; i < entries; i++) {
    xs[i] = random() * side;
    ys[i] = random() * side;
    grid.insert(i, xs[i], ys[i]);
  }
  const follow = o => (o * 7919) % entries;
  for (let o = 0; o < observers; o++) sets.addObserver(o, xs[follow(o)], ys[follow(o)], follow(o));
  const pass = [],
    work = {updates: 0, candidates: 0, relevant: 0, entered: 0, left: 0, overBudget: 0, incomplete: 0};
  for (let t = -warmup; t < ticks; t++) {
    if (t === 0) {
      pass.length = 0;
      for (const k in work) work[k] = 0;
    }
    for (let i = 0; i < entries; i++) {
      xs[i] = Math.min(side, Math.max(0, xs[i] + (random() - 0.5) * 2));
      ys[i] = Math.min(side, Math.max(0, ys[i] + (random() - 0.5) * 2));
      grid.move(i, xs[i], ys[i]);
    }
    for (let o = 0; o < observers; o++) sets.moveObserver(o, xs[follow(o)], ys[follow(o)]);
    const start = performance.now();
    for (let o = 0; o < observers; o++) {
      const r = sets.update(o, out);
      work.updates++;
      work.candidates += r.candidates;
      work.relevant += r.relevantCount;
      work.entered += r.enteredCount;
      work.left += r.leftCount;
      if (r.status === 'over-budget') work.overBudget++;
      else if (r.status !== 'complete') work.incomplete++;
    }
    pass.push(performance.now() - start);
  }
  const start = performance.now(),
    e2 = enterRadius * enterRadius;
  let found = 0;
  for (let o = 0; o < observers; o++) {
    const x = xs[follow(o)],
      y = ys[follow(o)];
    for (let i = 0; i < entries; i++) if ((xs[i] - x) ** 2 + (ys[i] - y) ** 2 <= e2) found++;
  }
  const bruteMs = performance.now() - start;
  if (found < 0) throw Error('unreachable');
  sets.dispose();
  grid.dispose();
  const per = k => +(work[k] / work.updates).toFixed(2);
  return {
    entries,
    observers,
    ticks,
    enterRadius,
    exitRadius,
    maxRelevant,
    updatePass: {
      medianMs: +percentile(pass, 0.5).toFixed(3),
      p95Ms: +percentile(pass, 0.95).toFixed(3),
      maxMs: +Math.max(...pass).toFixed(3),
    },
    perUpdate: {candidates: per('candidates'), relevant: per('relevant'), entered: per('entered'), left: per('left')},
    overBudgetUpdates: work.overBudget,
    incompleteUpdates: work.incomplete,
    bruteForceDistancePassMs: +bruteMs.toFixed(3),
  };
}

export function runSpatialBench({quick = false} = {}) {
  const ticks = quick ? 10 : 60;
  return {
    scope:
      'Node headless CPU micro-benchmark of the spatial grid and interest sets only; no browser, ECS, rendering, worker or device evidence',
    node: process.version,
    cases: [1000, 10000].map(entries => runCase({entries, ticks})),
    interestCases: [1000, 10000].map(entries => runInterestCase({entries, ticks})),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.stdout.write(`${JSON.stringify(runSpatialBench({quick: process.argv.includes('--quick')}), null, 2)}\n`);
