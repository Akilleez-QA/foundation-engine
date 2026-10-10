/**
 * Bounded, deterministic multi-track cue sequences (scripted scenes, staged events, tutorials, set pieces).
 *
 * A definition is a set of tracks (channels). Each track plays its cues in order; a cue lasts `ticks` fixed steps,
 * may wait for cues on other tracks (`after`, a barrier), may hold until the caller releases it (`hold`, for a
 * dialogue box or a player action), and may carry an `effect` identity that lands exactly once when the cue
 * completes. The runner owns no clock, callback, scheduler or persistence: the caller advances it with whole ticks
 * from its fixed-step system, applies the returned effect intents, and stores `snapshot()` in its own save section.
 */

export interface SequenceCue {
  readonly id: string;
  /** Whole fixed steps the cue lasts once started; 0 completes in the tick it starts (unless held). */
  readonly ticks: number;
  /** Cue ids (any track) that must have completed before this cue may start. */
  readonly after?: readonly string[];
  /** The cue also waits for `release(id)` while it is active. */
  readonly hold?: boolean;
  /** Creator effect identity returned once, when the cue completes. */
  readonly effect?: string;
  /** On `skip`: `land` (default) still returns the effect; `drop` discards it (presentation-only effects). */
  readonly onSkip?: 'land' | 'drop';
}
export interface SequenceTrack {
  readonly id: string;
  readonly cues: readonly SequenceCue[];
}
export interface SequenceDefinitionInput {
  readonly id: string;
  readonly tracks: readonly SequenceTrack[];
  /** Default true. */
  readonly skippable?: boolean;
}
export interface SequenceDefinition {
  readonly id: string;
  readonly tracks: readonly SequenceTrack[];
  readonly skippable: boolean;
  /** Changes whenever any timing, barrier, hold, effect or order changes; snapshots of another fingerprint refuse. */
  readonly fingerprint: string;
}

export const SEQUENCE_LIMITS = Object.freeze({
  tracks: 16,
  cuesPerTrack: 256,
  cues: 1024,
  after: 8,
  idLength: 256,
  /** Longest single cue, in ticks. */
  ticks: 2 ** 31 - 1,
  /** Default and largest per-call transition budget (a cue starting or completing is one transition). */
  transitions: 256,
  maxTransitions: 4096,
});

export type SequenceStatus = 'running' | 'finished' | 'skipped' | 'cancelled';

export type SequenceEvent =
  | {readonly kind: 'start'; readonly track: string; readonly cue: string; readonly tick: number}
  | {readonly kind: 'end'; readonly track: string; readonly cue: string; readonly tick: number}
  | {
      readonly kind: 'effect';
      readonly effect: string;
      readonly cue: string;
      /** `<session>/<cue>`: stable across snapshots, for the creator's own claim or receipt records. */
      readonly id: string;
      readonly tick: number;
    }
  | {readonly kind: 'finished'; readonly tick: number}
  | {readonly kind: 'skipped'; readonly tick: number};

export interface SequenceState {
  readonly version: 1;
  readonly definition: string;
  readonly fingerprint: string;
  readonly session: string;
  readonly status: SequenceStatus;
  readonly tick: number;
  /** Ticks accepted by an advance that stopped at its transition budget; consumed first by the next advance. */
  readonly owed: number;
  readonly tracks: readonly {readonly index: number; readonly startedAt: number | null}[];
  readonly released: readonly string[];
  /** Effect cues completed by `skip` whose effect was dropped (`onSkip: 'drop'`). */
  readonly dropped: readonly string[];
}

export interface SequenceActive {
  readonly track: string;
  readonly cue: string;
  readonly startedAt: number;
  readonly elapsed: number;
  readonly ticks: number;
  /** elapsed / ticks clamped to [0, 1]; 1 for zero-length cues. For interpolating cameras, actors or fades. */
  readonly alpha: number;
  /** True while only a missing `release` keeps the cue active. */
  readonly waiting: boolean;
}

function fail(message: string): never {
  throw new RangeError(`sequence: ${message}`);
}
const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= SEQUENCE_LIMITS.idLength;
const safeCount = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;

/** 64-bit two-lane hash over UTF-16 units: detects accidental change, not deliberate forgery. */
function fingerprintOf(text: string): string {
  let a = 0x9e3779b9,
    b = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Validate, snapshot and freeze a definition. Throws `RangeError` before returning anything. */
export function defineSequence(input: SequenceDefinitionInput): SequenceDefinition {
  if (!input || typeof input !== 'object') fail('definition must be an object');
  const id = input.id,
    tracksIn = input.tracks,
    skippableIn = input.skippable;
  if (!isId(id)) fail('definition id must be 1-256 characters');
  if (skippableIn !== undefined && typeof skippableIn !== 'boolean') fail('skippable must be a boolean');
  if (!Array.isArray(tracksIn) || tracksIn.length < 1 || tracksIn.length > SEQUENCE_LIMITS.tracks)
    fail(`a definition has 1-${SEQUENCE_LIMITS.tracks} tracks`);
  const trackIds = new Set<string>(),
    cueIds = new Map<string, {track: number; index: number}>();
  const tracks: SequenceTrack[] = [];
  let total = 0;
  (tracksIn as readonly SequenceTrack[]).forEach((t, ti) => {
    if (!t || typeof t !== 'object') fail('a track must be an object');
    const tid = t.id,
      cuesIn = t.cues;
    if (!isId(tid) || trackIds.has(tid)) fail('track ids must be unique, 1-256 characters');
    trackIds.add(tid);
    if (!Array.isArray(cuesIn) || cuesIn.length < 1 || cuesIn.length > SEQUENCE_LIMITS.cuesPerTrack)
      fail(`a track has 1-${SEQUENCE_LIMITS.cuesPerTrack} cues`);
    total += cuesIn.length;
    if (total > SEQUENCE_LIMITS.cues) fail(`a definition has at most ${SEQUENCE_LIMITS.cues} cues`);
    const cues: SequenceCue[] = [];
    (cuesIn as readonly SequenceCue[]).forEach((c, ci) => {
      if (!c || typeof c !== 'object') fail('a cue must be an object');
      const cid = c.id,
        ticks = c.ticks,
        after = c.after,
        hold = c.hold,
        effect = c.effect,
        onSkip = c.onSkip;
      if (!isId(cid) || cueIds.has(cid)) fail('cue ids must be unique across the definition, 1-256 characters');
      if (!safeCount(ticks, SEQUENCE_LIMITS.ticks)) fail(`cue ${cid}: ticks must be an integer in [0, 2^31 - 1]`);
      if (hold !== undefined && typeof hold !== 'boolean') fail(`cue ${cid}: hold must be a boolean`);
      if (effect !== undefined && !isId(effect)) fail(`cue ${cid}: effect must be 1-256 characters`);
      if (onSkip !== undefined && onSkip !== 'land' && onSkip !== 'drop') fail(`cue ${cid}: onSkip is land or drop`);
      if (onSkip !== undefined && effect === undefined) fail(`cue ${cid}: onSkip needs an effect`);
      let deps: string[] = [];
      if (after !== undefined) {
        if (!Array.isArray(after) || after.length > SEQUENCE_LIMITS.after)
          fail(`cue ${cid}: after lists at most ${SEQUENCE_LIMITS.after} cues`);
        deps = [...(after as readonly string[])];
        if (!deps.every(isId) || new Set(deps).size !== deps.length) fail(`cue ${cid}: after must be unique cue ids`);
        if (deps.includes(cid)) fail(`cue ${cid}: a cue cannot wait for itself`);
      }
      cueIds.set(cid, {track: ti, index: ci});
      const cue: SequenceCue = Object.freeze({
        id: cid,
        ticks,
        after: Object.freeze(deps),
        hold: hold === true,
        ...(effect === undefined ? {} : {effect, onSkip: onSkip ?? 'land'}),
      });
      cues.push(cue);
    });
    tracks.push(Object.freeze({id: tid, cues: Object.freeze(cues)}));
  });
  // Every barrier names a known cue, and track order plus barriers form no cycle (otherwise nothing could finish).
  const indegree = new Map<string, number>(),
    edges = new Map<string, string[]>();
  for (const t of tracks)
    t.cues.forEach((c, i) => {
      indegree.set(c.id, (indegree.get(c.id) ?? 0) + (i > 0 ? 1 : 0) + c.after!.length);
      if (i > 0) edges.set(t.cues[i - 1]!.id, [...(edges.get(t.cues[i - 1]!.id) ?? []), c.id]);
      for (const d of c.after!) {
        if (!cueIds.has(d)) fail(`cue ${c.id}: after names unknown cue ${d}`);
        edges.set(d, [...(edges.get(d) ?? []), c.id]);
      }
    });
  const ready = [...indegree].filter(([, n]) => n === 0).map(([k]) => k);
  let visited = 0;
  while (ready.length) {
    const k = ready.pop()!;
    visited++;
    for (const next of edges.get(k) ?? []) {
      const n = indegree.get(next)! - 1;
      indegree.set(next, n);
      if (n === 0) ready.push(next);
    }
  }
  if (visited !== total) fail('barriers and track order form a cycle; the sequence could never finish');
  const skippable = skippableIn ?? true;
  const fingerprint = fingerprintOf(JSON.stringify({id, skippable, tracks}));
  return Object.freeze({id, tracks: Object.freeze(tracks), skippable, fingerprint});
}

const STATUSES: readonly SequenceStatus[] = ['running', 'finished', 'skipped', 'cancelled'];
const STATE_KEYS = [
  'definition',
  'dropped',
  'fingerprint',
  'owed',
  'released',
  'session',
  'status',
  'tick',
  'tracks',
  'version',
];

/**
 * Validate an untrusted snapshot against a definition (for a save section's `parse`). Each field is read once.
 * Throws on any inconsistency; returns a frozen plain copy.
 */
export function parseSequenceState(def: SequenceDefinition, raw: unknown): SequenceState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype)
    fail('state must be a plain object');
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  if (keys.length !== STATE_KEYS.length || keys.some((k, i) => k !== STATE_KEYS[i]))
    fail('state has unexpected fields');
  const version = r.version,
    definition = r.definition,
    fingerprint = r.fingerprint,
    session = r.session,
    status = r.status,
    tick = r.tick,
    owed = r.owed,
    tracksIn = r.tracks,
    releasedIn = r.released,
    droppedIn = r.dropped;
  if (version !== 1) fail('unknown state version');
  if (definition !== def.id || fingerprint !== def.fingerprint) fail('state belongs to another definition or edit');
  if (!isId(session)) fail('state session must be 1-256 characters');
  if (!STATUSES.includes(status as SequenceStatus)) fail('unknown state status');
  if (!safeCount(tick) || !safeCount(owed) || tick + owed > Number.MAX_SAFE_INTEGER) fail('invalid state time');
  if (owed > 0 && status !== 'running') fail('only a running sequence can owe ticks');
  if (!Array.isArray(tracksIn) || tracksIn.length !== def.tracks.length) fail('state tracks do not match');
  const position = new Map<string, {track: number; index: number}>();
  def.tracks.forEach((t, ti) => t.cues.forEach((c, ci) => position.set(c.id, {track: ti, index: ci})));
  const tracks = (tracksIn as unknown[]).map((entry, ti) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('state track must be an object');
    const e = entry as Record<string, unknown>;
    const ek = Object.keys(e).sort();
    if (ek.length !== 2 || ek[0] !== 'index' || ek[1] !== 'startedAt') fail('state track has unexpected fields');
    const index = e.index,
      startedAt = e.startedAt;
    const len = def.tracks[ti]!.cues.length;
    if (!safeCount(index, len)) fail('state cue index out of range');
    if (startedAt !== null && !(safeCount(startedAt) && startedAt <= (tick as number)))
      fail('state start tick out of range');
    if (index === len && startedAt !== null) fail('a completed track has no active cue');
    return Object.freeze({index, startedAt: startedAt as number | null});
  });
  const complete = (cue: string) => {
    const p = position.get(cue)!;
    return p.index < tracks[p.track]!.index;
  };
  def.tracks.forEach((t, ti) => {
    const {index, startedAt} = tracks[ti]!;
    // Completed and started cues must have had every barrier satisfied.
    t.cues.forEach((c, ci) => {
      if ((ci < index || (ci === index && startedAt !== null)) && !c.after!.every(complete))
        fail(`state reaches cue ${c.id} before its barrier`);
    });
  });
  const allDone = tracks.every((t, i) => t.index === def.tracks[i]!.cues.length);
  if ((status === 'finished' || status === 'skipped') && !allDone) fail('a finished state has incomplete cues');
  if (status === 'running' && allDone) fail('a running state has no remaining cues');
  const list = (v: unknown, what: string): string[] => {
    if (!Array.isArray(v) || v.length > SEQUENCE_LIMITS.cues) fail(`state ${what} must be an array`);
    const ids = [...(v as unknown[])];
    if (!ids.every(id => isId(id) && position.has(id)) || new Set(ids).size !== ids.length)
      fail(`state ${what} must name unique cues`);
    return ids as string[];
  };
  const released = list(releasedIn, 'released');
  for (const id of released) {
    const p = position.get(id)!,
      t = tracks[p.track]!;
    if (!def.tracks[p.track]!.cues[p.index]!.hold || t.index !== p.index || t.startedAt === null)
      fail(`state releases cue ${id}, which is not an active held cue`);
  }
  const dropped = list(droppedIn, 'dropped');
  if (dropped.length && status !== 'skipped') fail('only a skipped sequence drops effects');
  for (const id of dropped) {
    const p = position.get(id)!,
      cue = def.tracks[p.track]!.cues[p.index]!;
    if (cue.onSkip !== 'drop') fail(`state drops cue ${id}, whose effect cannot be dropped`);
  }
  return Object.freeze({
    version: 1,
    definition: def.id,
    fingerprint: def.fingerprint,
    session,
    status: status as SequenceStatus,
    tick,
    owed,
    tracks: Object.freeze(tracks),
    released: Object.freeze(released),
    dropped: Object.freeze(dropped),
  });
}

export interface AdvanceResult {
  /** `partial`: the transition budget stopped this call; the rest is owed to the next advance. */
  readonly status: SequenceStatus | 'partial';
  readonly events: readonly SequenceEvent[];
}

/**
 * One run of a sequence. `session` namespaces effect ids (use a unique run identity, such as a save slot and
 * scene visit). `restored` continues a validated snapshot of the same definition and session.
 */
export function createSequence(
  def: SequenceDefinition,
  session: string,
  restored?: SequenceState | null,
  options: {readonly maxTransitions?: number} = {},
) {
  if (!def || typeof def.fingerprint !== 'string') fail('use defineSequence for the definition');
  if (!isId(session)) fail('session must be 1-256 characters');
  const maxTransitions = options.maxTransitions ?? SEQUENCE_LIMITS.transitions;
  if (!Number.isSafeInteger(maxTransitions) || maxTransitions < 1 || maxTransitions > SEQUENCE_LIMITS.maxTransitions)
    fail(`maxTransitions must be an integer in [1, ${SEQUENCE_LIMITS.maxTransitions}]`);
  const start = restored ? parseSequenceState(def, restored) : null;
  if (start && start.session !== session) fail('state belongs to another session');
  let status: SequenceStatus = start?.status ?? 'running',
    tick = start?.tick ?? 0,
    owed = start?.owed ?? 0;
  const tracks = def.tracks.map((_, i) => ({...(start?.tracks[i] ?? {index: 0, startedAt: null as number | null})}));
  const released = new Set(start?.released ?? []),
    dropped = new Set(start?.dropped ?? []);
  const position = new Map<string, {track: number; index: number}>();
  def.tracks.forEach((t, ti) => t.cues.forEach((c, ci) => position.set(c.id, {track: ti, index: ci})));
  const complete = (cue: string) => {
    const p = position.get(cue)!;
    return p.index < tracks[p.track]!.index;
  };
  const allDone = () => tracks.every((t, i) => t.index === def.tracks[i]!.cues.length);

  /**
   * Start and complete everything due at `now`, in track declaration order, until nothing changes or the budget is
   * spent. Returns the remaining budget (negative never). `force` completes started cues regardless of time/hold.
   */
  function settle(now: number, budget: number, events: SequenceEvent[], force: 'skip' | null): number {
    // One transition at a time, always the first eligible one in track declaration order. The choice depends only
    // on the state, so the order of same-tick events is identical however a caller's budget splits the work.
    for (;;) {
      let moved = false;
      for (let ti = 0; ti < def.tracks.length && !moved; ti++) {
        const t = def.tracks[ti]!,
          s = tracks[ti]!;
        if (s.index >= t.cues.length) continue;
        const c = t.cues[s.index]!;
        if (s.startedAt === null) {
          if (!c.after!.every(complete)) continue;
          if (budget === 0) return 0;
          budget--;
          s.startedAt = now;
          if (!force) events.push(Object.freeze({kind: 'start', track: t.id, cue: c.id, tick: now}));
          moved = true;
          continue;
        }
        const due = force || (now - s.startedAt >= c.ticks && (!c.hold || released.has(c.id)));
        if (!due) continue;
        if (budget === 0) return 0;
        budget--;
        s.index++;
        s.startedAt = null;
        released.delete(c.id);
        if (!force) events.push(Object.freeze({kind: 'end', track: t.id, cue: c.id, tick: now}));
        if (c.effect !== undefined) {
          if (force && c.onSkip === 'drop') dropped.add(c.id);
          else
            events.push(
              Object.freeze({kind: 'effect', effect: c.effect, cue: c.id, id: `${session}/${c.id}`, tick: now}),
            );
        }
        moved = true;
      }
      if (!moved) return budget;
    }
  }
  function nextDue(): number {
    let next = Infinity;
    def.tracks.forEach((t, ti) => {
      const s = tracks[ti]!;
      if (s.startedAt === null || s.index >= t.cues.length) return;
      const c = t.cues[s.index]!;
      if (c.hold && !released.has(c.id)) return;
      next = Math.min(next, s.startedAt + c.ticks);
    });
    return next;
  }

  const runner = {
    definition: def,
    session,
    /** Advance by whole ticks. Owed ticks from an earlier partial call are consumed first. Performs no callbacks. */
    advance(ticks: number): AdvanceResult {
      if (!safeCount(ticks)) fail('advance takes a nonnegative safe integer of ticks');
      if (status !== 'running') return Object.freeze({status, events: Object.freeze([])});
      const target = tick + owed + ticks;
      if (!Number.isSafeInteger(target)) fail('sequence time would leave the safe-integer range');
      const events: SequenceEvent[] = [];
      let now = tick,
        budget = maxTransitions;
      for (;;) {
        budget = settle(now, budget, events, null);
        if (allDone()) {
          status = 'finished';
          tick = target;
          owed = 0;
          events.push(Object.freeze({kind: 'finished', tick: now}));
          break;
        }
        if (budget === 0) {
          // Stop at a consistent point; the rest of this call's time is owed.
          tick = now;
          owed = target - now;
          return Object.freeze({status: 'partial', events: Object.freeze(events)});
        }
        const next = nextDue();
        if (next > target) {
          tick = target;
          owed = 0;
          break;
        }
        now = next;
      }
      return Object.freeze({status, events: Object.freeze(events)});
    },
    /** Release the active held cue `cue`; it completes on the next advance (advance(0) applies it now). */
    release(cue: string): 'released' | 'not-active' | 'inactive' {
      const p = position.get(cue);
      if (!p || !def.tracks[p.track]!.cues[p.index]!.hold) fail(`release names no held cue: ${String(cue)}`);
      if (status !== 'running') return 'inactive';
      const s = tracks[p.track]!;
      if (s.index !== p.index || s.startedAt === null) return 'not-active';
      released.add(cue);
      return 'released';
    },
    /**
     * Complete every remaining cue at once. Effects with `onSkip: 'land'` are returned (each still exactly once);
     * `drop` effects are recorded as dropped. No start/end presentation events are returned.
     */
    skip(): {readonly status: 'skipped' | 'refused' | 'inactive'; readonly events: readonly SequenceEvent[]} {
      if (status !== 'running') return Object.freeze({status: 'inactive', events: Object.freeze([])});
      if (!def.skippable) return Object.freeze({status: 'refused', events: Object.freeze([])});
      const events: SequenceEvent[] = [];
      // Bounded by the definition: at most two transitions per cue.
      settle(tick, 2 * SEQUENCE_LIMITS.cues + 2, events, 'skip');
      status = 'skipped';
      owed = 0;
      released.clear();
      events.push(Object.freeze({kind: 'skipped', tick}));
      return Object.freeze({status: 'skipped', events: Object.freeze(events)});
    },
    /** Stop without landing anything further. Returns the effect cues that will now never land. */
    cancel(): readonly string[] {
      if (status !== 'running') return Object.freeze([]);
      status = 'cancelled';
      owed = 0;
      released.clear();
      const never: string[] = [];
      def.tracks.forEach((t, ti) =>
        t.cues.forEach((c, ci) => {
          if (ci >= tracks[ti]!.index && c.effect !== undefined) never.push(c.id);
        }),
      );
      return Object.freeze(never);
    },
    /** The active cue of a track (for interpolation), or null when it waits on a barrier or has finished. */
    active(track: string): SequenceActive | null {
      const ti = def.tracks.findIndex(t => t.id === track);
      if (ti < 0) fail(`unknown track ${String(track)}`);
      const s = tracks[ti]!,
        t = def.tracks[ti]!;
      if (status !== 'running' || s.startedAt === null || s.index >= t.cues.length) return null;
      const c = t.cues[s.index]!,
        elapsed = tick - s.startedAt;
      return Object.freeze({
        track,
        cue: c.id,
        startedAt: s.startedAt,
        elapsed,
        ticks: c.ticks,
        alpha: c.ticks === 0 ? 1 : Math.min(1, elapsed / c.ticks),
        waiting: c.hold === true && !released.has(c.id) && elapsed >= c.ticks,
      });
    },
    /** True once `cue` has completed (by time, release or skip). */
    completed(cue: string): boolean {
      if (!position.has(cue)) fail(`unknown cue ${String(cue)}`);
      return complete(cue);
    },
    get status(): SequenceStatus {
      return status;
    },
    get tick(): number {
      return tick;
    },
    get owed(): number {
      return owed;
    },
    /** Plain, frozen data for the creator's save section. Store it together with the effects it reports applied. */
    snapshot(): SequenceState {
      return parseSequenceState(def, {
        version: 1,
        definition: def.id,
        fingerprint: def.fingerprint,
        session,
        status,
        tick,
        owed,
        tracks: tracks.map(t => ({index: t.index, startedAt: t.startedAt})),
        released: [...released],
        dropped: [...dropped],
      });
    },
  };
  return runner;
}
export type SequenceRunner = ReturnType<typeof createSequence>;
