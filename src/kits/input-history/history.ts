import type {
  EdgeKind, InputHistory, InputHistoryOptions, InputHistorySnapshot, InputSequence, MatchOptions, OppositePolicy,
  RecordResult, SequenceStep,
} from './types';

export const INPUT_HISTORY_LIMITS = Object.freeze({ maxActions: 32, maxCapacity: 3600, maxOpposites: 16, maxSteps: 16, maxIdLength: 64 });
const POLICIES: readonly OppositePolicy[] = ['neutral', 'last', 'first', 'a', 'b'];
const STALE = Object.freeze({ status: 'stale' as const });
const GAP = Object.freeze({ status: 'gap' as const });
const INVALID = Object.freeze({ status: 'invalid' as const });
const frameNumber = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

interface Compiled extends InputSequence { readonly all: Uint32Array; readonly none: Uint32Array; readonly pressed: Uint32Array; readonly released: Uint32Array }

/**
 * Optional per-tick action history for frame-exact input: bit masks in fixed typed-array rings, press/release
 * edges, short-tap capture, opposite-action (SOCD) cleaning, buffered edge queries, bounded sequence matching
 * and consumption marks, with a validated snapshot for rollback. Owns no device, clock or scheduler: the caller
 * records one mask per fixed tick (or per rollback frame) and queries it from the same simulation.
 */
export function createInputHistory(options: InputHistoryOptions): InputHistory {
  if (options === null || typeof options !== 'object') throw RangeError('input history: invalid options');
  const actionsIn = options.actions, capacity = options.capacity, oppositesIn = options.opposites ?? [];
  if (!Array.isArray(actionsIn) || actionsIn.length < 1 || actionsIn.length > INPUT_HISTORY_LIMITS.maxActions)
    throw RangeError('input history: 1-32 actions required');
  const actions = Object.freeze([...actionsIn]);
  const bit = new Map<string, number>();
  for (const [i, id] of actions.entries()) {
    if (typeof id !== 'string' || id.length === 0 || id.length > INPUT_HISTORY_LIMITS.maxIdLength || bit.has(id))
      throw RangeError('input history: action ids must be distinct non-empty strings');
    bit.set(id, (1 << i) >>> 0);
  }
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > INPUT_HISTORY_LIMITS.maxCapacity)
    throw RangeError('input history: capacity must be an integer in 1..3600');
  const all = actions.length === 32 ? 0xffffffff : ((1 << actions.length) - 1) >>> 0;
  if (!Array.isArray(oppositesIn) || oppositesIn.length > INPUT_HISTORY_LIMITS.maxOpposites) throw RangeError('input history: at most 16 opposite pairs');
  const used = new Set<string>();
  const pairs = oppositesIn.map(pair => {
    const a = pair?.a, b = pair?.b, policy = pair?.policy;
    if (!bit.has(a) || !bit.has(b) || a === b || used.has(a) || used.has(b) || !POLICIES.includes(policy))
      throw RangeError('input history: opposite pairs need two distinct known actions, each in one pair, and a known policy');
    used.add(a); used.add(b);
    return Object.freeze({ a, b, policy, ia: actions.indexOf(a), ib: actions.indexOf(b) });
  });
  const config = JSON.stringify({ actions, capacity, opposites: pairs.map(p => [p.a, p.b, p.policy]) });

  const held = new Uint32Array(capacity), press = new Uint32Array(capacity), release = new Uint32Array(capacity), consumed = new Uint32Array(capacity);
  const lastRawPress = new Float64Array(actions.length).fill(-1);
  const scratchA = new Float64Array(capacity), scratchB = new Float64Array(capacity);
  const compiled = new WeakSet<object>();
  let first = -1, latest = -1, prevRaw = 0, prevHeld = 0;

  const validMask = (m: unknown): m is number => Number.isSafeInteger(m) && (m as number) >= 0 && (m as number) <= 0xffffffff && (((m as number) & ~all) >>> 0) === 0;
  const bitOf = (action: string) => {
    const b = bit.get(action);
    if (b === undefined) throw RangeError(`input history: unknown action ${String(action).slice(0, 64)}`);
    return b;
  };
  const oldest = () => latest < 0 ? -1 : Math.max(first, latest - capacity + 1);
  const slot = (frame: number) => {
    if (!frameNumber(frame) || latest < 0 || frame > latest || frame < oldest())
      throw RangeError('input history: frame not retained');
    return frame % capacity;
  };
  /** The searched window [lo, at], clipped at the first recorded frame; throws if it reaches evicted frames. */
  const window = (within: number, at: number | undefined): [number, number] | null => {
    if (!Number.isSafeInteger(within) || within < 1 || within > capacity) throw RangeError('input history: within must be in 1..capacity');
    if (latest < 0) return null;
    const end = at ?? latest;
    if (!frameNumber(end) || end > latest) throw RangeError('input history: at must be a recorded frame');
    if (end < first) return null;
    const lo = Math.max(end - within + 1, first);
    if (lo < oldest()) throw RangeError('input history: window reaches evicted frames');
    return [lo, end];
  };
  const maskOf = (names: readonly string[] | undefined) => {
    if (names === undefined) return 0;
    if (!Array.isArray(names)) throw RangeError('input history: names must be an array');
    let m = 0;
    for (const n of names) m = (m | bitOf(n)) >>> 0;
    return m;
  };

  const history: InputHistory = {
    actions, capacity,
    mask: names => maskOf(names),
    names(mask) {
      if (!validMask(mask)) throw RangeError('input history: invalid mask');
      return Object.freeze(actions.filter((_, i) => (mask >>> i) & 1));
    },
    reset(baseline = 0) {
      if (!validMask(baseline)) throw RangeError('input history: invalid baseline');
      first = -1; latest = -1; prevRaw = baseline; prevHeld = baseline;
      held.fill(0); press.fill(0); release.fill(0); consumed.fill(0); lastRawPress.fill(-1);
    },
    record(frame, heldMask, taps = 0): RecordResult {
      if (!frameNumber(frame) || !validMask(heldMask) || !validMask(taps)) return INVALID;
      if (latest >= 0) {
        if (frame <= latest) return STALE;
        if (frame !== latest + 1) return GAP;
      }
      const raw = (heldMask | taps) >>> 0;
      const rawPressed = (raw & ~prevRaw) >>> 0;
      for (let i = 0; i < actions.length; i++) if ((rawPressed >>> i) & 1) lastRawPress[i] = frame;
      let clean = raw;
      for (const p of pairs) {
        const ba = (1 << p.ia) >>> 0, bb = (1 << p.ib) >>> 0;
        if ((raw & ba) === 0 || (raw & bb) === 0) continue;
        const ta = lastRawPress[p.ia], tb = lastRawPress[p.ib];
        const keep = p.policy === 'a' ? ba : p.policy === 'b' ? bb
          : ta === tb || p.policy === 'neutral' ? 0
          : p.policy === 'last' ? (ta > tb ? ba : bb) : (ta < tb ? ba : bb);
        clean = (clean & ~(ba | bb) | keep) >>> 0;
      }
      const s = frame % capacity;
      held[s] = clean; press[s] = (clean & ~prevHeld) >>> 0; release[s] = (prevHeld & ~clean) >>> 0; consumed[s] = 0;
      if (latest < 0) first = frame;
      latest = frame; prevRaw = raw; prevHeld = clean;
      return Object.freeze({ status: 'recorded' as const, frame, held: clean, pressed: press[s], released: release[s] });
    },
    latest: () => latest,
    oldest,
    heldAt: frame => held[slot(frame)],
    held: (action, frame = latest) => { const b = bitOf(action); return latest >= 0 && (held[slot(frame)] & b) !== 0; },
    pressed: (action, frame = latest) => { const b = bitOf(action); return latest >= 0 && (press[slot(frame)] & b) !== 0; },
    released: (action, frame = latest) => { const b = bitOf(action); return latest >= 0 && (release[slot(frame)] & b) !== 0; },
    lastEdge(action, edge: EdgeKind, within, at, includeConsumed = false) {
      const b = bitOf(action);
      if (edge !== 'press' && edge !== 'release') throw RangeError('input history: edge must be press or release');
      const range = window(within, at);
      if (!range) return -1;
      for (let f = range[1]; f >= range[0]; f--) {
        const s = f % capacity;
        const edges = edge === 'release' ? release[s] : includeConsumed ? press[s] : (press[s] & ~consumed[s]) >>> 0;
        if (edges & b) return f;
      }
      return -1;
    },
    consume(action, frame) {
      const b = bitOf(action), s = slot(frame);
      if ((press[s] & b) === 0 || (consumed[s] & b) !== 0) return false;
      consumed[s] = (consumed[s] | b) >>> 0;
      return true;
    },
    sequence(steps: readonly SequenceStep[]) {
      if (!Array.isArray(steps) || steps.length < 1 || steps.length > INPUT_HISTORY_LIMITS.maxSteps) throw RangeError('input history: 1-16 steps required');
      const n = steps.length;
      const out = { steps: n, all: new Uint32Array(n), none: new Uint32Array(n), pressed: new Uint32Array(n), released: new Uint32Array(n) };
      steps.forEach((step, i) => {
        if (step === null || typeof step !== 'object') throw RangeError('input history: invalid step');
        out.all[i] = maskOf(step.all); out.none[i] = maskOf(step.none); out.pressed[i] = maskOf(step.pressed); out.released[i] = maskOf(step.released);
        if ((out.all[i] | out.none[i] | out.pressed[i] | out.released[i]) === 0) throw RangeError('input history: a step needs at least one condition');
        if ((out.all[i] & out.none[i]) !== 0 || (out.pressed[i] & out.none[i]) !== 0) throw RangeError('input history: a step can never match');
      });
      const frozen = Object.freeze(out);
      compiled.add(frozen);
      return frozen;
    },
    match(sequence: InputSequence, o: MatchOptions) {
      if (!compiled.has(sequence)) throw RangeError('input history: sequence was not compiled by this history');
      if (o === null || typeof o !== 'object') throw RangeError('input history: invalid match options');
      const within = o.within, maxGap = o.maxGap ?? o.within;
      if (!Number.isSafeInteger(maxGap) || maxGap < 1 || maxGap > within) throw RangeError('input history: maxGap must be in 1..within');
      const range = window(within, o.at);
      if (!range) return null;
      const seq = sequence as Compiled, [lo, end] = range, n = end - lo + 1;
      const satisfied = (i: number, f: number) => {
        const s = f % capacity, h = held[s], p = (press[s] & ~consumed[s]) >>> 0, r = release[s];
        return (h & seq.all[i]) === seq.all[i] && (h & seq.none[i]) === 0 && (p & seq.pressed[i]) === seq.pressed[i] && (r & seq.released[i]) === seq.released[i];
      };
      let prev = scratchA, cur = scratchB;
      for (let k = 0; k < n; k++) cur[k] = satisfied(0, lo + k) ? lo + k : -1;
      for (let i = 1; i < seq.steps; i++) {
        const swap = prev; prev = cur; cur = swap;
        let lastFrame = -1, lastStart = -1;
        for (let k = 0; k < n; k++) {
          const f = lo + k;
          cur[k] = lastFrame >= 0 && f - lastFrame <= maxGap && satisfied(i, f) ? lastStart : -1;
          if (prev[k] >= 0) { lastFrame = f; lastStart = prev[k]; }
        }
      }
      for (let k = n - 1; k >= 0; k--) if (cur[k] >= 0) return Object.freeze({ start: cur[k], end: lo + k });
      return null;
    },
    save(): InputHistorySnapshot {
      const out = { held: [] as number[], press: [] as number[], release: [] as number[], consumed: [] as number[] };
      if (latest >= 0) for (let f = oldest(); f <= latest; f++) {
        const s = f % capacity;
        out.held.push(held[s]); out.press.push(press[s]); out.release.push(release[s]); out.consumed.push(consumed[s]);
      }
      return Object.freeze({ v: 1 as const, config, first, latest, prevRaw, prevHeld, lastRawPress: Object.freeze(Array.from(lastRawPress)),
        held: Object.freeze(out.held), press: Object.freeze(out.press), release: Object.freeze(out.release), consumed: Object.freeze(out.consumed) });
    },
    load(snapshot: InputHistorySnapshot) {
      const bad = (why: string): never => { throw RangeError(`input history: invalid snapshot (${why})`); };
      if (snapshot === null || typeof snapshot !== 'object') bad('type');
      const { v, first: f0, latest: f1, prevRaw: pr, prevHeld: ph } = snapshot;
      if (v !== 1) bad('version');
      if (snapshot.config !== config) bad('config');
      const empty = f0 === -1 && f1 === -1;
      if (!empty && !(frameNumber(f0) && frameNumber(f1) && f0 <= f1)) bad('frames');
      if (!validMask(pr) || !validMask(ph)) bad('masks');
      const count = empty ? 0 : f1 - Math.max(f0, f1 - capacity + 1) + 1;
      const arrays = [snapshot.held, snapshot.press, snapshot.release, snapshot.consumed];
      if (!arrays.every(a => Array.isArray(a) && a.length === count)) bad('lengths');
      const [h, p, r, c] = arrays.map(a => Array.from(a as readonly number[]));
      for (let k = 0; k < count; k++) {
        if (![h[k], p[k], r[k], c[k]].every(validMask)) bad('masks');
        if ((p[k] & ~h[k]) >>> 0 || (r[k] & h[k]) >>> 0 || (c[k] & ~p[k]) >>> 0) bad('edges');
        if (k > 0 && (p[k] !== ((h[k] & ~h[k - 1]) >>> 0) || r[k] !== ((h[k - 1] & ~h[k]) >>> 0))) bad('edges');
      }
      if (count > 0 && (ph !== h[count - 1] || (ph & ~pr) >>> 0)) bad('latest');
      const lrp = snapshot.lastRawPress;
      if (!Array.isArray(lrp) || lrp.length !== actions.length || !lrp.every(t => t === -1 || (frameNumber(t) && t <= f1))) bad('press frames');
      first = f0; latest = f1; prevRaw = pr; prevHeld = ph;
      held.fill(0); press.fill(0); release.fill(0); consumed.fill(0);
      for (let k = 0; k < count; k++) { const s = (f1 - count + 1 + k) % capacity; held[s] = h[k]; press[s] = p[k]; release[s] = r[k]; consumed[s] = c[k]; }
      lastRawPress.set(lrp);
    },
  };
  return Object.freeze(history);
}
