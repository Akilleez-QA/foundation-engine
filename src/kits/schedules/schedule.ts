/**
 * kits/schedules/schedule.ts: authored day-cycle schedules for actors, evaluated against a caller-supplied game time.
 *
 * A calendar divides the game timeline (`GameClock.ut` seconds, or any creator time unit) into days of `dayLength`
 * starting at `epoch`; `cycleDays` days form a repeating pattern (a week, a three-day festival cycle). A schedule
 * lists variants in priority order. The first variant whose day list contains the current weekday and whose flag
 * conditions hold owns that whole day; its windows (half-open `[start, end)` seconds into the day, never
 * overlapping) name an anchor and an activity, optionally travelling `from` another anchor. Time not covered by a
 * window falls to the variant's idle entry, else the schedule's.
 *
 * Everything is pure: time and flags are inputs, nothing schedules, moves, saves or calls back. `placement` is
 * O(variants + flags + log windows). `catchUp` reports the window changes between two times in order, bounded by
 * `maxTransitions`, and always returns the exact placement at the later time.
 */

export const SCHEDULE_LIMITS = Object.freeze({
  /** Shortest and longest day, in time units. */
  minDayLength: 1,
  maxDayLength: 1e9,
  /** Longest repeating day pattern. */
  cycleDays: 366,
  /** Variants per schedule. */
  variants: 32,
  /** Windows per variant and across all variants of one schedule. */
  windowsPerVariant: 256,
  entries: 1024,
  /** Distinct flags one schedule may read. */
  flags: 32,
  /** Id, anchor, activity and flag text length. */
  textLength: 128,
  /** Default and largest number of transitions one catch-up reports. */
  defaultTransitions: 64,
  transitions: 4096,
  /** Largest |time - epoch| accepted, in time units. */
  span: 1e15,
  /** Largest roster. */
  actors: 1_048_576,
});

export interface ScheduleCalendarInput {
  /** Length of one day in time units (seconds when fed from `GameClock.ut`). */
  readonly dayLength: number;
  /** Time at which day 0 starts. Default 0. */
  readonly epoch?: number;
  /** Days in the repeating pattern; `weekday = dayIndex mod cycleDays`. Default 1 (every day alike). */
  readonly cycleDays?: number;
}
export interface ScheduleCalendar {
  readonly dayLength: number;
  readonly epoch: number;
  readonly cycleDays: number;
}

export interface ScheduleIdleInput {
  readonly id: string;
  readonly anchor: string;
  readonly activity: string;
}
export interface ScheduleWindowInput extends ScheduleIdleInput {
  /** Seconds into the day, `0 <= start < end <= dayLength`. A window crossing midnight is authored as two windows. */
  readonly start: number;
  readonly end: number;
  /** When present, the window is a travel segment from this anchor to `anchor`; `progress` runs 0..1 across it. */
  readonly from?: string;
}
export interface ScheduleVariantInput {
  readonly id: string;
  /** Weekdays (0..cycleDays-1) this variant may own. Absent: every day. */
  readonly days?: readonly number[];
  /** Flags that must all be true. */
  readonly when?: readonly string[];
  /** Flags that must all be false. */
  readonly unless?: readonly string[];
  /** Fallback for this variant's uncovered time. Absent: the schedule's idle entry. */
  readonly idle?: ScheduleIdleInput;
  readonly windows: readonly ScheduleWindowInput[];
}
export interface ScheduleInput {
  readonly id: string;
  /** Used for time no window covers and for days no variant owns. */
  readonly idle: ScheduleIdleInput;
  readonly variants: readonly ScheduleVariantInput[];
}

export interface ScheduleEntry {
  readonly id: string;
  readonly anchor: string;
  readonly activity: string;
  /** Travel origin, or null for a stationary entry. */
  readonly from: string | null;
  /** Window bounds in seconds into the day; an idle entry has none. */
  readonly start: number | null;
  readonly end: number | null;
}
export interface ScheduleVariant {
  readonly id: string;
  readonly days: readonly number[] | null;
  readonly when: readonly string[];
  readonly unless: readonly string[];
  readonly idle: ScheduleEntry;
  /** Sorted by start. */
  readonly windows: readonly ScheduleEntry[];
}
export interface Schedule {
  readonly id: string;
  readonly calendar: ScheduleCalendar;
  readonly idle: ScheduleEntry;
  readonly variants: readonly ScheduleVariant[];
  /** Every flag the schedule reads, in first-mention order; each is read once per evaluation. */
  readonly flags: readonly string[];
}

/** Flag source: a set of true flags, or a predicate. Absent: every flag false. */
export type ScheduleFlags = ReadonlySet<string> | ((flag: string) => boolean);

export interface SchedulePlacement {
  readonly schedule: string;
  readonly time: number;
  readonly dayIndex: number;
  readonly weekday: number;
  readonly timeOfDay: number;
  /** Owning variant, or null when no variant owns the day. */
  readonly variant: string | null;
  readonly entry: ScheduleEntry;
  /** True when the time is not covered by a window (the idle entry applies). */
  readonly idle: boolean;
  /** True for a travel window (`entry.from` set). */
  readonly travel: boolean;
  /**
   * Bounds of the occupying window on the timeline. For idle time they are the gap within this day only (clipped to
   * the day's start and end), so `windowEnd` is always the next time the day's occupant can change.
   */
  readonly windowStart: number;
  readonly windowEnd: number;
  /** Fraction of the window elapsed, in [0, 1). */
  readonly progress: number;
}

export interface ScheduleTransition {
  /** Timeline time at which the occupant changed. */
  readonly at: number;
  readonly dayIndex: number;
  readonly weekday: number;
  readonly variant: string | null;
  readonly entry: ScheduleEntry;
  readonly idle: boolean;
}

export interface ScheduleCatchUp {
  /** Occupant changes with `from < at <= to`, in time order, at most `maxTransitions`. */
  readonly transitions: readonly ScheduleTransition[];
  /** More changes happened after the last reported one; `final` is still exact. */
  readonly truncated: boolean;
  /** `to < from` (an earlier save loaded): nothing is reported, `final` is the placement at `to`. */
  readonly rewound: boolean;
  /** The placement at `to`. */
  readonly final: SchedulePlacement;
}

function fail(message: string): never {
  throw new RangeError(`schedules: ${message}`);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
function text(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > SCHEDULE_LIMITS.textLength)
    fail(`${what} must be 1-${SCHEDULE_LIMITS.textLength} characters`);
  return v;
}
function plain(v: unknown, what: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(`${what} must be an object`);
  return v as Record<string, unknown>;
}
function list(v: unknown, what: string, max: number, min = 0): readonly unknown[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(`${what} must be an array of ${min}-${max} items`);
  return v.slice();
}

/** Validate and freeze a calendar. Throws `RangeError` on a broken contract. */
export function defineScheduleCalendar(input: ScheduleCalendarInput): ScheduleCalendar {
  const o = plain(input, 'calendar');
  const dayLength = o.dayLength,
    epoch = o.epoch ?? 0,
    cycleDays = o.cycleDays ?? 1;
  if (!finite(dayLength) || dayLength < SCHEDULE_LIMITS.minDayLength || dayLength > SCHEDULE_LIMITS.maxDayLength)
    fail(`dayLength must be ${SCHEDULE_LIMITS.minDayLength}..${SCHEDULE_LIMITS.maxDayLength}`);
  if (!finite(epoch) || Math.abs(epoch) > SCHEDULE_LIMITS.span) fail('epoch must be finite');
  if (!intIn(cycleDays, 1, SCHEDULE_LIMITS.cycleDays))
    fail(`cycleDays must be an integer 1..${SCHEDULE_LIMITS.cycleDays}`);
  return Object.freeze({dayLength, epoch, cycleDays});
}

function idleEntry(v: unknown, what: string, ids: Set<string>): ScheduleEntry {
  const o = plain(v, what);
  const id = text(o.id, `${what} id`);
  if (ids.has(id)) fail(`duplicate entry id '${id}'`);
  ids.add(id);
  return Object.freeze({
    id,
    anchor: text(o.anchor, `${what} anchor`),
    activity: text(o.activity, `${what} activity`),
    from: null,
    start: null,
    end: null,
  });
}

/**
 * Validate, sort and freeze a schedule. Overlapping windows within a variant, unknown weekdays, duplicate entry or
 * variant ids and out-of-range bounds throw `RangeError`; nothing is returned on failure.
 */
export function defineSchedule(calendar: ScheduleCalendar, input: ScheduleInput): Schedule {
  const cal = defineScheduleCalendar(calendar);
  const o = plain(input, 'schedule');
  const id = text(o.id, 'schedule id');
  const ids = new Set<string>();
  const flags: string[] = [];
  const note = (v: unknown, what: string): readonly string[] => {
    if (v === undefined) return Object.freeze([]);
    const out = list(v, what, SCHEDULE_LIMITS.flags).map(f => text(f, 'flag'));
    for (const f of out) if (!flags.includes(f)) flags.push(f);
    if (flags.length > SCHEDULE_LIMITS.flags) fail(`a schedule reads at most ${SCHEDULE_LIMITS.flags} flags`);
    return Object.freeze(out);
  };
  const idle = idleEntry(o.idle, 'idle', ids);
  const variantIds = new Set<string>();
  let total = 0;
  const variants = list(o.variants, 'variants', SCHEDULE_LIMITS.variants).map((raw, k): ScheduleVariant => {
    const v = plain(raw, `variant ${k}`);
    const vid = text(v.id, 'variant id');
    if (variantIds.has(vid)) fail(`duplicate variant id '${vid}'`);
    variantIds.add(vid);
    let days: readonly number[] | null = null;
    if (v.days !== undefined) {
      const d = list(v.days, `variant '${vid}' days`, cal.cycleDays, 1);
      for (const day of d)
        if (!intIn(day, 0, cal.cycleDays - 1)) fail(`variant '${vid}' day must be 0..${cal.cycleDays - 1}`);
      days = Object.freeze([...new Set(d as number[])].sort((a, b) => a - b));
    }
    const when = note(v.when, `variant '${vid}' when`);
    const unless = note(v.unless, `variant '${vid}' unless`);
    const vIdle = v.idle === undefined ? idle : idleEntry(v.idle, `variant '${vid}' idle`, ids);
    const rows = list(v.windows, `variant '${vid}' windows`, SCHEDULE_LIMITS.windowsPerVariant);
    total += rows.length;
    if (total > SCHEDULE_LIMITS.entries) fail(`a schedule has at most ${SCHEDULE_LIMITS.entries} windows`);
    const windows = rows
      .map((r, j): ScheduleEntry => {
        const w = plain(r, `variant '${vid}' window ${j}`);
        const wid = text(w.id, 'window id');
        if (ids.has(wid)) fail(`duplicate entry id '${wid}'`);
        ids.add(wid);
        const start = w.start,
          end = w.end;
        if (!finite(start) || !finite(end) || start < 0 || end > cal.dayLength || !(start < end))
          fail(`window '${wid}' needs 0 <= start < end <= dayLength`);
        return Object.freeze({
          id: wid,
          anchor: text(w.anchor, `window '${wid}' anchor`),
          activity: text(w.activity, `window '${wid}' activity`),
          from: w.from === undefined ? null : text(w.from, `window '${wid}' from`),
          start,
          end,
        });
      })
      .sort((a, b) => a.start! - b.start!);
    for (let j = 1; j < windows.length; j++)
      if (windows[j]!.start! < windows[j - 1]!.end!)
        fail(`windows '${windows[j - 1]!.id}' and '${windows[j]!.id}' overlap in variant '${vid}'`);
    return Object.freeze({id: vid, days, when, unless, idle: vIdle, windows: Object.freeze(windows)});
  });
  return Object.freeze({id, calendar: cal, idle, variants: Object.freeze(variants), flags: Object.freeze(flags)});
}

/** Read each flag the schedule mentions exactly once. A non-boolean predicate result throws `TypeError`. */
function readFlags(schedule: Schedule, flags: ScheduleFlags | undefined): ReadonlySet<string> {
  const on = new Set<string>();
  if (flags === undefined || schedule.flags.length === 0) return on;
  const isSet = flags instanceof Set;
  if (!isSet && typeof flags !== 'function') throw new TypeError('schedules: flags must be a Set or a predicate');
  for (const f of schedule.flags) {
    const v: unknown = isSet ? flags.has(f) : (flags as (flag: string) => boolean)(f);
    if (typeof v !== 'boolean') throw new TypeError(`schedules: flag '${f}' must read as a boolean`);
    if (v) on.add(f);
  }
  return on;
}

/** Variant owning each weekday under fixed flags (index into variants, or -1). O(cycleDays x variants). */
function ownersFor(schedule: Schedule, on: ReadonlySet<string>): Int16Array {
  const out = new Int16Array(schedule.calendar.cycleDays).fill(-1);
  schedule.variants.forEach((v, k) => {
    if (!v.when.every(f => on.has(f)) || v.unless.some(f => on.has(f))) return;
    if (v.days === null) {
      for (let d = 0; d < out.length; d++) if (out[d] === -1) out[d] = k;
    } else for (const d of v.days) if (out[d] === -1) out[d] = k;
  });
  return out;
}

function ownerOn(schedule: Schedule, on: ReadonlySet<string>, weekday: number): number {
  for (let k = 0; k < schedule.variants.length; k++) {
    const v = schedule.variants[k]!;
    if (v.days !== null && !v.days.includes(weekday)) continue;
    if (v.when.every(f => on.has(f)) && !v.unless.some(f => on.has(f))) return k;
  }
  return -1;
}

interface DayTime {
  dayIndex: number;
  weekday: number;
  dayStart: number;
  timeOfDay: number;
}
function dayOf(cal: ScheduleCalendar, time: number): DayTime {
  if (!finite(time)) fail('time must be finite');
  const rel = time - cal.epoch;
  if (Math.abs(rel) > SCHEDULE_LIMITS.span) fail(`|time - epoch| must be <= ${SCHEDULE_LIMITS.span}`);
  let dayIndex = Math.floor(rel / cal.dayLength);
  let dayStart = cal.epoch + dayIndex * cal.dayLength;
  // Guard rounding at day edges so 0 <= timeOfDay < dayLength always holds.
  if (time < dayStart) dayStart = cal.epoch + --dayIndex * cal.dayLength;
  else if (time - dayStart >= cal.dayLength) dayStart = cal.epoch + ++dayIndex * cal.dayLength;
  const weekday = ((dayIndex % cal.cycleDays) + cal.cycleDays) % cal.cycleDays;
  return {dayIndex, weekday, dayStart, timeOfDay: Math.min(Math.max(time - dayStart, 0), cal.dayLength)};
}

/** Index of the last window starting at or before `tod`, or -1. O(log n). */
function lastStartingBy(windows: readonly ScheduleEntry[], tod: number): number {
  let lo = 0,
    hi = windows.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (windows[mid]!.start! <= tod) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function place(schedule: Schedule, on: ReadonlySet<string>, time: number): SchedulePlacement {
  const cal = schedule.calendar;
  const d = dayOf(cal, time);
  const k = ownerOn(schedule, on, d.weekday);
  const variant = k < 0 ? null : schedule.variants[k]!;
  const windows = variant?.windows ?? [];
  const j = lastStartingBy(windows, d.timeOfDay);
  const w = j >= 0 ? windows[j]! : null;
  let entry: ScheduleEntry, lo: number, hi: number, idle: boolean;
  if (w && d.timeOfDay < w.end!) {
    entry = w;
    lo = w.start!;
    hi = w.end!;
    idle = false;
  } else {
    entry = variant?.idle ?? schedule.idle;
    lo = w ? w.end! : 0;
    hi = windows[j + 1]?.start ?? cal.dayLength;
    idle = true;
  }
  const progress = Math.min(Math.max((d.timeOfDay - lo) / (hi - lo), 0), 1 - Number.EPSILON);
  return Object.freeze({
    schedule: schedule.id,
    time,
    dayIndex: d.dayIndex,
    weekday: d.weekday,
    timeOfDay: d.timeOfDay,
    variant: variant?.id ?? null,
    entry,
    idle,
    travel: entry.from !== null,
    windowStart: d.dayStart + lo,
    windowEnd: d.dayStart + hi,
    progress,
  });
}

/**
 * Where and doing what the schedule puts its actor at `time`. Flags are read once. Throws `RangeError` for a
 * non-finite or out-of-span time.
 */
export function schedulePlacement(schedule: Schedule, time: number, flags?: ScheduleFlags): SchedulePlacement {
  if (!finite(time)) fail('time must be finite');
  return place(schedule, readFlags(schedule, flags), time);
}

export interface ScheduleCatchUpOptions {
  /** Most transitions reported. Default 64, at most 4,096. */
  readonly maxTransitions?: number;
}

/**
 * The occupant changes between `from` (exclusive) and `to` (inclusive), in order, and the exact placement at `to`.
 *
 * A change is reported at every window start (each day it occurs) and wherever idle time begins after a window or
 * the idle entry itself changes; idle time continuing across midnight under the same idle entry is one occupancy.
 * Flags are read once for the whole span: if they changed during it, split the call at the change. At most
 * `maxTransitions` are reported (`truncated` beyond). Work is bounded: weekday owners are resolved once per call,
 * and once a full cycle of days passes with no change the scan stops, because the pattern repeats.
 */
export function scheduleCatchUp(
  schedule: Schedule,
  from: number,
  to: number,
  flags?: ScheduleFlags,
  options: ScheduleCatchUpOptions = {},
): ScheduleCatchUp {
  if (!finite(from) || !finite(to)) fail('catch-up times must be finite');
  const max = options.maxTransitions ?? SCHEDULE_LIMITS.defaultTransitions;
  if (!intIn(max, 0, SCHEDULE_LIMITS.transitions)) fail(`maxTransitions must be 0..${SCHEDULE_LIMITS.transitions}`);
  const on = readFlags(schedule, flags);
  const final = place(schedule, on, to);
  dayOf(schedule.calendar, from);
  if (to < from) return Object.freeze({transitions: Object.freeze([]), truncated: false, rewound: true, final});
  const cal = schedule.calendar;
  const owners = ownersFor(schedule, on);
  const out: ScheduleTransition[] = [];
  const first = dayOf(cal, from),
    last = dayOf(cal, to);
  let truncated = false;
  // Occupant key at the end of the previous day: an idle entry id, or null after an authored window.
  const endKey = (weekday: number): string | null => {
    const k = owners[weekday]!;
    const v = k < 0 ? null : schedule.variants[k]!;
    const tail = v?.windows[v.windows.length - 1];
    return tail && tail.end === cal.dayLength ? null : (v?.idle ?? schedule.idle).id;
  };
  let quiet = 0;
  for (let day = first.dayIndex; day <= last.dayIndex; day++) {
    const weekday = (((day - first.dayIndex + first.weekday) % cal.cycleDays) + cal.cycleDays) % cal.cycleDays;
    const dayStart = cal.epoch + day * cal.dayLength;
    const k = owners[weekday]!;
    const variant = k < 0 ? null : schedule.variants[k]!;
    const windows = variant?.windows ?? [];
    const idle = variant?.idle ?? schedule.idle;
    const prevKey = endKey((weekday - 1 + cal.cycleDays) % cal.cycleDays);
    let emitted = 0;
    const emit = (tod: number, entry: ScheduleEntry, isIdle: boolean): boolean => {
      const at = dayStart + tod;
      if (at <= from) return true;
      if (at > to) return false;
      if (out.length >= max) {
        truncated = true;
        return false;
      }
      out.push(Object.freeze({at, dayIndex: day, weekday, variant: variant?.id ?? null, entry, idle: isIdle}));
      emitted++;
      return true;
    };
    let going = true;
    // Midnight: a window starting at 0 always begins a new occupancy; idle begins one if the idle entry changed.
    const w0 = windows[0];
    if (w0 && w0.start === 0) going = emit(0, w0, false);
    else if (prevKey !== idle.id) going = emit(0, idle, true);
    // On the first day skip windows that ended at or before `from` (O(log n)).
    let j = day === first.dayIndex ? Math.max(lastStartingBy(windows, first.timeOfDay), 0) : 0;
    for (; going && j < windows.length; j++) {
      const w = windows[j]!;
      if (w.start! > 0) going = emit(w.start!, w, false);
      const next = windows[j + 1];
      if (going && w.end! < cal.dayLength && !(next && next.start === w.end)) going = emit(w.end!, idle, true);
    }
    if (!going) break;
    quiet = emitted === 0 && day > first.dayIndex ? quiet + 1 : 0;
    // A whole cycle without a change: the repeating pattern has none left before `to`.
    if (quiet >= cal.cycleDays) break;
  }
  return Object.freeze({transitions: Object.freeze(out), truncated, rewound: false, final});
}

/** Plain order data accepted by the itinerary kit's `edit({type: 'insert', order})`. */
export interface ScheduleItineraryOrder {
  readonly tag: string;
  readonly destination: {readonly id: string; readonly generation: number};
  /** Whole time units left until the window ends (rounded up): a deadline the movement adapter may use. */
  readonly value: number;
}

/**
 * The itinerary order that moves an actor to a placement's anchor. `generation` is the creator's destination
 * generation (bumped when the anchor's meaning changes). Throws `RangeError` for invalid tag or generation.
 */
export function scheduleItineraryOrder(
  placement: SchedulePlacement,
  options: {readonly tag: string; readonly generation: number},
): ScheduleItineraryOrder {
  const tag = text(options?.tag, 'itinerary tag');
  if (!intIn(options.generation, 0, Number.MAX_SAFE_INTEGER)) fail('generation must be a nonnegative safe integer');
  const value = Math.max(0, Math.ceil(placement.windowEnd - placement.time));
  return Object.freeze({
    tag,
    destination: Object.freeze({id: placement.entry.anchor, generation: options.generation}),
    value: Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER,
  });
}

export interface ScheduleRosterLimits {
  /** Most actors with an assigned schedule. Positive safe integer <= SCHEDULE_LIMITS.actors. */
  readonly maxActors: number;
}
export interface ScheduleRoster {
  readonly limits: ScheduleRosterLimits;
  readonly size: number;
  /** Assign or replace an actor's schedule. Full roster: `saturated`, nothing changes. */
  assign(actor: number, schedule: Schedule): 'assigned' | 'replaced' | 'saturated' | 'closed';
  unassign(actor: number): 'removed' | 'absent' | 'closed';
  scheduleOf(actor: number): Schedule | null;
  /** O(1) lookup plus `schedulePlacement`; null for an unassigned actor or a closed roster. */
  placement(actor: number, time: number, flags?: ScheduleFlags): SchedulePlacement | null;
  catchUp(
    actor: number,
    from: number,
    to: number,
    flags?: ScheduleFlags,
    options?: ScheduleCatchUpOptions,
  ): ScheduleCatchUp | null;
  /** Terminal and idempotent. */
  dispose(): void;
}

/** A bounded actor-to-schedule table. The caller owns actors, their entities, positions and persistence. */
export function createScheduleRoster(limits: ScheduleRosterLimits): ScheduleRoster {
  const o = plain(limits, 'roster limits');
  const maxActors = o.maxActors;
  if (!intIn(maxActors, 1, SCHEDULE_LIMITS.actors)) fail(`maxActors must be 1..${SCHEDULE_LIMITS.actors}`);
  const frozen = Object.freeze({maxActors});
  const table = new Map<number, Schedule>();
  let closed = false;
  const id = (actor: number) => {
    if (!intIn(actor, 0, Number.MAX_SAFE_INTEGER))
      throw new TypeError('schedules: actor must be a nonnegative safe integer');
  };
  const known = new WeakSet<Schedule>();
  return Object.freeze({
    limits: frozen,
    get size() {
      return table.size;
    },
    assign(actor: number, schedule: Schedule) {
      id(actor);
      if (closed) return 'closed' as const;
      if (!known.has(schedule)) {
        if (!Object.isFrozen(schedule) || !Object.isFrozen(schedule.variants) || !Object.isFrozen(schedule.calendar))
          throw new TypeError('schedules: assign a schedule from defineSchedule');
        known.add(schedule);
      }
      const had = table.has(actor);
      if (!had && table.size >= maxActors) return 'saturated' as const;
      table.set(actor, schedule);
      return had ? ('replaced' as const) : ('assigned' as const);
    },
    unassign(actor: number) {
      id(actor);
      if (closed) return 'closed' as const;
      return table.delete(actor) ? ('removed' as const) : ('absent' as const);
    },
    scheduleOf(actor: number) {
      id(actor);
      return closed ? null : (table.get(actor) ?? null);
    },
    placement(actor: number, time: number, flags?: ScheduleFlags) {
      id(actor);
      const s = closed ? undefined : table.get(actor);
      return s ? schedulePlacement(s, time, flags) : null;
    },
    catchUp(actor: number, from: number, to: number, flags?: ScheduleFlags, options?: ScheduleCatchUpOptions) {
      id(actor);
      const s = closed ? undefined : table.get(actor);
      return s ? scheduleCatchUp(s, from, to, flags, options) : null;
    },
    dispose() {
      closed = true;
      table.clear();
    },
  });
}
