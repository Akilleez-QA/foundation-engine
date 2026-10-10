// scripts/perf/ecs-queries.ts (`npx tsx scripts/perf/ecs-queries.ts`): a local microbenchmark of World queries,
// uncached against cached, at 1k and 10k entities, plus the structural-change cost a cached query adds. Numbers are
// machine- and runtime-specific (one Node process, warm JIT); they indicate order of magnitude, not a budget.
import {component, World} from '../../src/core/ecs/world';

const A = component('bench-a', {n: 0});
const B = component('bench-b', {n: 0});
const C = component('bench-c', {n: 0});

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
function time(repeats: number, body: () => void): number {
  for (let i = 0; i < 3; i++) body(); // warm up
  const samples: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now();
    body();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}
/** Entities with A; half also with B; a quarter also with C, so query(A, B) matches half. */
function populate(w: World, n: number): void {
  for (let i = 0; i < n; i++) {
    const e = w.spawn(A({n: i}));
    if (i % 2 === 0) w.add(e, B());
    if (i % 4 === 0) w.add(e, C());
  }
}

const rows: string[][] = [];
for (const n of [1_000, 10_000]) {
  const w = new World();
  populate(w, n);
  const cached = w.cachedQuery(A, B);
  let sink = 0;
  const passes = 50;
  const uncachedMs = time(15, () => {
    for (let p = 0; p < passes; p++) for (const [, a] of w.query(A, B)) sink += a.n;
  });
  const cachedMs = time(15, () => {
    for (let p = 0; p < passes; p++) for (const [, a] of cached) sink += a.n;
  });
  // Churn: despawn and respawn 1% of entities between passes (each pass then rebuilds the cached order once).
  const churnPass = (q?: {[Symbol.iterator](): Iterator<unknown[]>}) => {
    const live = [...w.query(A)].map(r => r[0]);
    for (let p = 0; p < passes; p++) {
      for (let k = 0; k < n / 100; k++) {
        w.despawn(live[(p * 97 + k * 31) % live.length]!);
        const e = w.spawn(A({n: k}), B());
        live[(p * 97 + k * 31) % live.length] = e;
      }
      for (const row of q ?? w.query(A, B)) sink += (row[1] as {n: number}).n;
    }
  };
  const churnUncachedMs = time(7, () => churnPass());
  const churnCachedMs = time(7, () => churnPass(cached));
  cached.dispose();
  // Structural-change cost with and without one cached query and tracking registered.
  const spawnCost = (setup: (w: World) => void) =>
    time(9, () => {
      const x = new World();
      setup(x);
      populate(x, n);
      for (const [e] of [...x.query(A)]) x.despawn(e);
    });
  const plainMs = spawnCost(() => {});
  const trackedMs = spawnCost(x => {
    x.cachedQuery(A, B);
    x.trackChanges(A, B, C);
  });
  if (sink === -1) console.log(sink);
  const per = (ms: number) => ((ms * 1e6) / passes / (n / 2)).toFixed(1);
  rows.push([
    String(n),
    `${per(uncachedMs)} ns`,
    `${per(cachedMs)} ns`,
    `${(uncachedMs / cachedMs).toFixed(2)}x`,
    `${(churnUncachedMs / churnCachedMs).toFixed(2)}x`,
    `${plainMs.toFixed(2)} ms`,
    `${trackedMs.toFixed(2)} ms`,
  ]);
}
const head = [
  'entities',
  'query(A,B)/row',
  'cached/row',
  'speed-up',
  'speed-up with 1% churn/pass',
  'spawn+despawn all',
  'same, cached query + 3 tracked types',
];
console.log(`Local, unofficial (Node ${process.version}); query(A, B) matches half the entities.`);
console.log(
  [head, ...rows]
    .map(r => `| ${r.join(' | ')} |`)
    .join('\n')
    .replace(/\n/, `\n|${head.map(() => ' --- ').join('|')}|\n`),
);
