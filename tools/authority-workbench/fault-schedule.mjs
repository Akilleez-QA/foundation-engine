// Seeded fault schedules for the authority workbench fault harness (NW-09).
// Pure data: a seed deterministically produces a list of steps. No I/O, clock or
// global random source. The harness (fault-harness.mjs) interprets the steps.

/** 32-bit string/number hash (FNV-1a), used to derive independent sub-streams. */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.join('\u0000')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Small seeded generator (mulberry32). Returns numbers uniform in [0, 1). */
export function createRandom(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw Error('fault schedule: seed');
  let state = hashSeed('seed', String(seed));
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.freeze({
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: list => list[Math.floor(next() * list.length)],
  });
}

/** Independent stream for one consumer (link, client retry) so schedules do not share draws. */
export const deriveRandom = (seed, label) => createRandom(hashSeed(String(seed), label) % 0x7fffffff);

export const CLIENTS = Object.freeze(['a', 'b']);
export const NET_MODES = Object.freeze(['delay', 'reorder', 'duplicate', 'drop']);

// Relative weights of step kinds. Inputs dominate so faults hit live commands.
const WEIGHTS = Object.freeze([
  ['input', 34],
  ['operator', 4],
  ['idle', 8],
  ['net', 14],
  ['disconnect', 4],
  ['replace', 2],
  ['hold-commit', 4],
  ['restart', 2],
  ['storage', 4],
  ['clock', 4],
  ['slow', 4],
  ['revoke', 1],
]);
const TOTAL = WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

function action(r) {
  let roll = r.next() * TOTAL;
  let kind = WEIGHTS[0][0];
  for (const [k, w] of WEIGHTS) {
    if (roll < w) {
      kind = k;
      break;
    }
    roll -= w;
  }
  const c = r.pick(CLIENTS);
  switch (kind) {
    case 'input': {
      const add = r.int(-3, 3);
      return {t: 'input', c, add: add === 0 ? 1 : add};
    }
    case 'operator':
      return {t: 'operator', add: r.int(1, 3)};
    case 'idle':
      return {t: 'idle'};
    case 'net':
      return {t: 'net', c, dir: r.pick(['up', 'down']), mode: r.pick(NET_MODES), count: r.int(1, 4)};
    case 'disconnect':
      return {t: 'disconnect', c};
    case 'replace':
      return {t: 'replace', c};
    case 'hold-commit':
      return {
        t: 'hold-commit',
        steps: r.int(1, 4),
        then: r.pick(['release', 'crash', 'drop-client']),
        c,
      };
    case 'restart':
      return {t: 'restart', down: r.int(0, 3)};
    case 'storage':
      return {
        t: 'storage',
        when: r.pick(['before', 'after']),
        recovery: r.pick(['recover', 'restart']),
        after: r.int(1, 5),
      };
    case 'clock': {
      const target = r.pick(['host', ...CLIENTS]);
      // Mostly modest skew either way; occasionally a forward jump past the host idle timeout.
      const delta = r.next() < 0.15 ? 16000 : r.int(-2000, 2000);
      return {t: 'clock', target, delta};
    }
    case 'slow':
      return {t: 'slow', c, steps: r.int(2, 12)};
    case 'revoke':
      return {t: 'revoke', c};
    default:
      throw Error(`fault schedule: ${kind}`);
  }
}

/** Deterministic schedule for a seed. Each step carries an action and a virtual time advance. */
export function generateSchedule({seed, steps}) {
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > 100000) throw Error('fault schedule: steps');
  const r = createRandom(seed);
  const out = [];
  for (let i = 0; i < steps; i++) out.push(Object.freeze({dt: r.int(20, 120), ...action(r)}));
  return Object.freeze(out);
}

/** Readable one-line description of a step for traces and repro output. */
export function describeStep(step) {
  const {dt, t, ...rest} = step;
  const fields = Object.entries(rest)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return `${t}${fields ? ' ' + fields : ''} (+${dt}ms)`;
}

/**
 * Bounded delta-debugging shrink. `fails(schedule)` resolves to a failure (any
 * truthy value whose `invariant` must match the original) or null. Removes chunks of
 * decreasing size while the same invariant still fails. Returns the smallest schedule
 * found and the number of runs spent.
 */
export async function shrinkSchedule(schedule, fails, {maxRuns = 200, invariant} = {}) {
  let current = [...schedule],
    runs = 0;
  const same = failure => failure && (invariant === undefined || failure.invariant === invariant);
  let chunk = Math.max(1, Math.floor(current.length / 2));
  while (chunk >= 1 && runs < maxRuns) {
    let removed = false;
    for (let start = 0; start < current.length && runs < maxRuns;) {
      const candidate = [...current.slice(0, start), ...current.slice(start + chunk)];
      if (candidate.length === 0) {
        start += chunk;
        continue;
      }
      runs++;
      if (same(await fails(candidate))) {
        current = candidate;
        removed = true;
      } else start += chunk;
    }
    if (!removed) chunk = Math.floor(chunk / 2);
  }
  return {schedule: Object.freeze(current), runs};
}
