/**
 * kits/replay/digest.ts: periodic state digests and the first-divergence comparator.
 *
 * The creator supplies `digest()` over their own state; the trace supplies the cadence (`every`), a ring of the
 * newest `maxEntries` samples and an optional bounded detail window. Nothing here reads a clock or schedules work:
 * the caller observes ticks from its existing fixed-step owner.
 */

export interface DigestDetailWindow {
  /** First and last tick (inclusive) whose detail text is kept. */
  readonly from: number;
  readonly to: number;
  /** Total UTF-16 code units of detail text kept; later detail is dropped and `detailTruncated` is set. */
  readonly maxChars: number;
}
export interface DigestTraceOptions {
  /** Configuration identity. Traces with different identities are incomparable. */
  readonly identity: string;
  /** Sample ticks divisible by `every` (1 = every tick). */
  readonly every: number;
  /** Ring capacity: the newest samples kept. Older samples are evicted and counted in `dropped`. */
  readonly maxEntries: number;
  /** Longest accepted digest string. A longer digest fails the trace (it is never silently cut). */
  readonly maxDigestLength: number;
  readonly detail?: DigestDetailWindow;
}
export type DigestEntry = readonly [tick: number, digest: string];
export interface DigestSnapshot {
  readonly identity: string;
  readonly every: number;
  readonly status: 'ok' | 'failed';
  readonly reason: string | null;
  /** First observed tick, or -1 before any observation. */
  readonly firstTick: number;
  /** Last observed tick (sampled or not), or -1. */
  readonly lastTick: number;
  /** Samples evicted from the ring. When non-zero, earlier history is gone and comparisons say so. */
  readonly dropped: number;
  /** Retained samples, oldest first. */
  readonly entries: readonly DigestEntry[];
  readonly details: readonly DigestEntry[];
  readonly detailTruncated: boolean;
}
export type ObserveResult = 'sampled' | 'skipped' | 'failed';
export interface DigestTrace {
  /** Observe the state after `tick`. Ticks must be contiguous. `digest` is called only on sampled ticks. */
  observe(tick: number, digest: () => string, detail?: () => string): ObserveResult;
  read(): DigestSnapshot;
}

const tickOk = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
export const identityOk = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 512;

export function captureDigestOptions(o: DigestTraceOptions): DigestTraceOptions {
  if (!identityOk(o.identity))
    throw Error('replay digest: identity must be a non-empty string of at most 512 characters');
  if (!positive(o.every) || !positive(o.maxEntries) || !positive(o.maxDigestLength))
    throw Error('replay digest: every, maxEntries and maxDigestLength must be positive safe integers');
  const d = o.detail;
  if (d && (!tickOk(d.from) || !tickOk(d.to) || d.to < d.from || !positive(d.maxChars)))
    throw Error('replay digest: invalid detail window');
  return Object.freeze({
    identity: o.identity,
    every: o.every,
    maxEntries: o.maxEntries,
    maxDigestLength: o.maxDigestLength,
    ...(d ? {detail: Object.freeze({from: d.from, to: d.to, maxChars: d.maxChars})} : {}),
  });
}

/** A bounded digest trace. Memory: at most `maxEntries` digests of `maxDigestLength` plus `detail.maxChars`. */
export function createDigestTrace(options: DigestTraceOptions): DigestTrace {
  const o = captureDigestOptions(options);
  const ring: DigestEntry[] = [];
  let head = 0,
    dropped = 0,
    firstTick = -1,
    lastTick = -1;
  let status: DigestSnapshot['status'] = 'ok',
    reason: string | null = null;
  const details: DigestEntry[] = [];
  let detailChars = 0,
    detailTruncated = false;
  const fail = (why: string): ObserveResult => {
    if (status === 'ok') {
      status = 'failed';
      reason = why;
    }
    return 'failed';
  };
  return {
    observe(tick, digest, detail) {
      if (status !== 'ok') return 'failed';
      if (!tickOk(tick) || (lastTick >= 0 && tick !== lastTick + 1)) return fail('tick-order');
      if (firstTick < 0) firstTick = tick;
      lastTick = tick;
      if (tick % o.every !== 0) return 'skipped';
      let value: unknown;
      try {
        value = digest();
      } catch {
        return fail('digest-threw');
      }
      if (typeof value !== 'string' || value.length === 0) return fail('digest-not-string');
      if (value.length > o.maxDigestLength) return fail('digest-too-long');
      const entry: DigestEntry = Object.freeze([tick, value] as const);
      if (ring.length < o.maxEntries) ring.push(entry);
      else {
        ring[head] = entry;
        head = (head + 1) % o.maxEntries;
        dropped++;
      }
      const w = o.detail;
      if (w && detail && !detailTruncated && tick >= w.from && tick <= w.to) {
        let text: unknown;
        try {
          text = detail();
        } catch {
          return fail('detail-threw');
        }
        if (typeof text !== 'string') return fail('detail-not-string');
        if (detailChars + text.length > w.maxChars) detailTruncated = true;
        else {
          detailChars += text.length;
          details.push(Object.freeze([tick, text] as const));
        }
      }
      return 'sampled';
    },
    read() {
      return Object.freeze({
        identity: o.identity,
        every: o.every,
        status,
        reason,
        firstTick,
        lastTick,
        dropped,
        entries: Object.freeze([...ring.slice(head), ...ring.slice(0, head)]),
        details: Object.freeze([...details]),
        detailTruncated,
      });
    },
  };
}

export type DigestComparison =
  /** Every sample from the same first tick through the same last tick matched; nothing was evicted. */
  | Readonly<{status: 'equal'; from: number; through: number; samples: number}>
  /**
   * The first retained sample that differs. The true first divergent tick lies in (`after`, `tick`]; with
   * `every: 1` and `exact: true` it is `tick`. `exact` is false when earlier samples were evicted from either ring.
   */
  | Readonly<{
      status: 'diverged';
      tick: number;
      after: number;
      exact: boolean;
      a: string;
      b: string;
      detail: Readonly<{a: string | null; b: string | null}>;
    }>
  /** The overlapping samples matched, but history was evicted or the traces cover different ranges: not a pass. */
  | Readonly<{
      status: 'inconclusive';
      reason: 'history-dropped' | 'range-differs';
      from: number;
      through: number;
      samples: number;
    }>
  | Readonly<{status: 'incomparable'; reason: 'identity' | 'cadence' | 'failed' | 'no-overlap'}>;

/**
 * Compare two traces sample by sample. `through` limits the comparison to ticks <= through (both traces must have
 * observed it for `equal`). Bounded by the retained entries: O(a.entries + b.entries).
 */
export function compareDigests(
  a: DigestSnapshot,
  b: DigestSnapshot,
  options: {through?: number} = {},
): DigestComparison {
  if (a.identity !== b.identity) return Object.freeze({status: 'incomparable', reason: 'identity'});
  if (a.every !== b.every) return Object.freeze({status: 'incomparable', reason: 'cadence'});
  if (a.status !== 'ok' || b.status !== 'ok') return Object.freeze({status: 'incomparable', reason: 'failed'});
  if (options.through !== undefined && !tickOk(options.through)) throw Error('replay digest: through must be a tick');
  const through = options.through ?? Math.min(a.lastTick, b.lastTick);
  const other = new Map<number, string>();
  for (const [t, d] of b.entries) if (t <= through) other.set(t, d);
  const detailOf = (s: DigestSnapshot, tick: number) => s.details.find(([t]) => t === tick)?.[1] ?? null;
  let samples = 0,
    from = -1,
    after = Math.max(a.firstTick, b.firstTick) - 1;
  for (const [tick, digest] of a.entries) {
    if (tick > through) break;
    const theirs = other.get(tick);
    if (theirs === undefined) continue;
    if (from < 0) from = tick;
    if (theirs !== digest) {
      const evicted = (s: DigestSnapshot) => s.dropped > 0 && s.entries.length > 0 && s.entries[0]![0] <= tick; // non-empty: checked first
      return Object.freeze({
        status: 'diverged',
        tick,
        after,
        exact: !evicted(a) && !evicted(b) && a.firstTick === b.firstTick,
        a: digest,
        b: theirs,
        detail: Object.freeze({a: detailOf(a, tick), b: detailOf(b, tick)}),
      });
    }
    samples++;
    after = tick;
  }
  if (samples === 0) return Object.freeze({status: 'incomparable', reason: 'no-overlap'});
  const last = after;
  if (a.dropped > 0 || b.dropped > 0)
    return Object.freeze({status: 'inconclusive', reason: 'history-dropped', from, through: last, samples});
  const sameRange =
    options.through === undefined ? a.lastTick === b.lastTick : a.lastTick >= through && b.lastTick >= through;
  if (a.firstTick !== b.firstTick || !sameRange) {
    return Object.freeze({status: 'inconclusive', reason: 'range-differs', from, through: last, samples});
  }
  return Object.freeze({status: 'equal', from, through: last, samples});
}

/** Structural check of a decoded snapshot (e.g. from a replay log). Throws on anything inconsistent. */
export function checkDigestSnapshot(value: unknown, maxEntries: number, maxDigestLength: number): DigestSnapshot {
  const v = value as Record<string, unknown>;
  const bad = (why: string): never => {
    throw Error(`replay digest: ${why}`);
  };
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('snapshot');
  if (!identityOk(v.identity) || !positive(v.every)) bad('identity or cadence');
  if (v.status !== 'ok' && v.status !== 'failed') bad('status');
  if (!(v.reason === null || typeof v.reason === 'string')) bad('reason');
  const first = v.firstTick,
    last = v.lastTick;
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    (first as number) < -1 ||
    (last as number) < (first as number)
  )
    bad('range');
  if (!tickOk(v.dropped)) bad('dropped');
  const rows = (x: unknown, limit: number): DigestEntry[] => {
    if (!Array.isArray(x) || x.length > limit) bad('entries');
    let prev = -1;
    return (x as unknown[]).map(item => {
      const r = item as unknown[];
      if (!Array.isArray(r) || r.length !== 2 || !tickOk(r[0]) || typeof r[1] !== 'string' || r[0] <= prev)
        bad('entry');
      prev = r[0] as number;
      return Object.freeze([r[0] as number, r[1] as string] as const);
    });
  };
  const entries = rows(v.entries, maxEntries),
    details = rows(v.details, Number.MAX_SAFE_INTEGER);
  for (const [t, d] of entries)
    if (
      d.length === 0 ||
      d.length > maxDigestLength ||
      t % (v.every as number) !== 0 ||
      t < (first as number) ||
      t > (last as number)
    )
      bad('entry range');
  // The retained entries must be exactly the newest samples the cadence implies: no sample removed or added. A failed
  // trace may lack its final sample (the digest that failed).
  const every = v.every as number,
    f = first as number,
    l = last as number,
    dropped = v.dropped as number;
  const firstSample = f < 0 ? 0 : Math.ceil(f / every) * every;
  const samples = f < 0 || firstSample > l ? 0 : Math.floor((l - firstSample) / every) + 1;
  const kept = entries.length + dropped;
  if (!(kept === samples || (v.status === 'failed' && kept === samples - 1))) bad('sample count');
  entries.forEach(([t], i) => {
    if (t !== firstSample + (dropped + i) * every) bad('sample sequence');
  });
  for (const [t] of details) if (t < f || t > l) bad('detail range');
  if (typeof v.detailTruncated !== 'boolean') bad('detailTruncated');
  return Object.freeze({
    identity: v.identity as string,
    every: v.every as number,
    status: v.status as 'ok' | 'failed',
    reason: v.reason as string | null,
    firstTick: first as number,
    lastTick: last as number,
    dropped: v.dropped as number,
    entries: Object.freeze(entries),
    details: Object.freeze(details),
    detailTruncated: v.detailTruncated as boolean,
  });
}
