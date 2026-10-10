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
  /** Every anchor an entry names (as destination or travel origin), sorted. */
  readonly anchors: readonly string[];
  /**
   * Shortest authored segment (window, gap or day). Times whose float resolution cannot keep segments of this length
   * apart are refused (see `SCHEDULE_LIMITS` and the README's time-resolution rule).
   */
  readonly shortestSegment: number;
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
   * Bounds of the occupying window on the timeline, `windowStart <= time < windowEnd`. For idle time they are the gap
   * within this day only (clipped to the day's start and end), so `windowEnd` is always the next time the occupant
   * can change and is strictly later than `time`: waking at `windowEnd` always makes progress.
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
  /**
   * Days whose boundaries were examined (a deterministic work count). Every visited day except the first and last
   * reports at least one change, so this is at most `transitions.length + 2`.
   */
  readonly daysVisited: number;
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

/** Derived lookup data, kept off the frozen public record. Presence also proves the schedule came from defineSchedule. */
interface Compiled {
  /** Per variant: membership by weekday, or null for every day. */
  readonly days: readonly (Uint8Array | null)[];
  /** Per variant: unsigned bit masks over `schedule.flags`. */
  readonly when: readonly number[];
  readonly unless: readonly number[];
}
const compiled = new WeakMap<Schedule, Compiled>();
function compiledOf(schedule: Schedule): Compiled {
  const c = typeof schedule === 'object' && schedule !== null ? compiled.get(schedule) : undefined;
  if (!c) throw new TypeError('schedules: use a schedule returned by defineSchedule');
  return c;
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
  const anchors = new Set<string>([idle.anchor]);
  const variantIds = new Set<string>();
  let total = 0;
  let shortest = cal.dayLength;
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
    anchors.add(vIdle.anchor);
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
        const entry = Object.freeze({
          id: wid,
          anchor: text(w.anchor, `window '${wid}' anchor`),
          activity: text(w.activity, `window '${wid}' activity`),
          from: w.from === undefined ? null : text(w.from, `window '${wid}' from`),
          start,
          end,
        });
        anchors.add(entry.anchor);
        if (entry.from !== null) anchors.add(entry.from);
        return entry;
      })
      .sort((a, b) => a.start! - b.start!);
    let cursor = 0;
    for (const w of windows) {
      if (w.start! < cursor) fail(`window '${w.id}' overlaps the window before it in variant '${vid}'`);
      if (w.start! > cursor) shortest = Math.min(shortest, w.start! - cursor);
      shortest = Math.min(shortest, w.end! - w.start!);
      cursor = w.end!;
    }
    if (cursor > 0 && cursor < cal.dayLength) shortest = Math.min(shortest, cal.dayLength - cursor);
    return Object.freeze({id: vid, days, when, unless, idle: vIdle, windows: Object.freeze(windows)});
  });
  // Even times near the epoch must resolve every segment; otherwise no time could be evaluated.
  if (4 * ulp2(Math.abs(cal.epoch) + 2 * cal.dayLength) > shortest)
    fail(
      `the shortest segment (${shortest}) is below the float resolution of this calendar near its epoch ` +
        `(|epoch| + 2 * dayLength); lengthen it or move the epoch toward 0`,
    );
  const mask = (names: readonly string[]) => names.reduce((m, f) => (m | (1 << flags.indexOf(f))) >>> 0, 0);
  const schedule: Schedule = Object.freeze({
    id,
    calendar: cal,
    idle,
    variants: Object.freeze(variants),
    flags: Object.freeze(flags),
    anchors: Object.freeze([...anchors].sort()),
    shortestSegment: shortest,
  });
  compiled.set(
    schedule,
    Object.freeze({
      days: variants.map(v => {
        if (v.days === null) return null;
        const set = new Uint8Array(cal.cycleDays);
        for (const d of v.days) set[d] = 1;
        return set;
      }),
      when: variants.map(v => mask(v.when)),
      unless: variants.map(v => mask(v.unless)),
    }),
  );
  return schedule;
}

/** Validate the flag source (always) and read each mentioned flag once into a bit mask. */
function readFlags(schedule: Schedule, flags: ScheduleFlags | undefined): number {
  if (flags === undefined) return 0;
  const isSet = flags instanceof Set;
  if (!isSet && typeof flags !== 'function')
    throw new TypeError('schedules: flags must be a Set or a predicate function');
  let on = 0;
  schedule.flags.forEach((f, k) => {
    // A Set is read through its own `has`; a Proxy around a Set is not a Set receiver: pass a predicate instead.
    const v: unknown = isSet ? flags.has(f) : (flags as (flag: string) => boolean)(f);
    if (typeof v !== 'boolean') throw new TypeError(`schedules: flag '${f}' must read as a boolean`);
    if (v) on = (on | (1 << k)) >>> 0;
  });
  return on;
}

function owns(c: Compiled, k: number, on: number, weekday: number): boolean {
  const days = c.days[k];
  if (days && days[weekday] === 0) return false;
  const when = c.when[k]!;
  return (on & when) >>> 0 === when && (on & c.unless[k]!) >>> 0 === 0;
}
/** Owning variant index for a weekday, or -1. O(variants). */
function ownerOn(schedule: Schedule, c: Compiled, on: number, weekday: number): number {
  for (let k = 0; k < schedule.variants.length; k++) if (owns(c, k, on, weekday)) return k;
  return -1;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
/** The one expression for where day `d` starts on the timeline. Strictly increasing in `d` within the span. */
const dayStartOf = (cal: ScheduleCalendar, d: number) => cal.epoch + d * cal.dayLength;
/** Conservative unit in the last place (twice the true one) of a positive magnitude. */
const ulp2 = (x: number) => 2 ** (Math.floor(Math.log2(Math.max(x, Number.MIN_VALUE))) - 51);

/**
 * Validate a time against the span and the schedule's resolution: every authored segment must stay at least four of
 * these conservative units long at this magnitude, so every boundary below is strictly ordered on the timeline.
 */
function checkTime(schedule: Schedule, time: number, what: string): void {
  const cal = schedule.calendar;
  if (!finite(time)) fail(`${what} must be finite`);
  if (Math.abs(time - cal.epoch) > SCHEDULE_LIMITS.span) fail(`|${what} - epoch| must be <= ${SCHEDULE_LIMITS.span}`);
  const magnitude = Math.max(Math.abs(time), Math.abs(cal.epoch)) + 2 * cal.dayLength;
  if (4 * ulp2(magnitude) > schedule.shortestSegment)
    fail(
      `${what} ${time}: float spacing at magnitude ${magnitude} cannot resolve this schedule's shortest segment ` +
        `(${schedule.shortestSegment}); use a time closer to 0 or longer segments`,
    );
}

/** Day index containing `time`: `dayStartOf(d) <= time < dayStartOf(d + 1)`, using the same expression. */
function dayIndexOf(cal: ScheduleCalendar, time: number): number {
  let d = Math.floor((time - cal.epoch) / cal.dayLength);
  while (time < dayStartOf(cal, d)) d--;
  while (time >= dayStartOf(cal, d + 1)) d++;
  return d;
}

/** Timeline position of an authored time of day `b` on the day starting at `start` (next day at `next`). */
const boundary = (cal: ScheduleCalendar, start: number, next: number, b: number) =>
  b >= cal.dayLength ? next : Math.min(start + b, next);

/** Index of the last window whose timeline start is at or before `time`, or -1. O(log n). */
function lastStartingBy(
  cal: ScheduleCalendar,
  windows: readonly ScheduleEntry[],
  start: number,
  next: number,
  time: number,
): number {
  let lo = 0,
    hi = windows.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (boundary(cal, start, next, windows[mid]!.start!) <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function place(schedule: Schedule, c: Compiled, on: number, time: number): SchedulePlacement {
  const cal = schedule.calendar;
  const dayIndex = dayIndexOf(cal, time);
  const start = dayStartOf(cal, dayIndex),
    next = dayStartOf(cal, dayIndex + 1);
  const weekday = mod(dayIndex, cal.cycleDays);
  const k = ownerOn(schedule, c, on, weekday);
  const variant = k < 0 ? null : schedule.variants[k]!;
  const windows = variant?.windows ?? [];
  const at = (b: number) => boundary(cal, start, next, b);
  const j = lastStartingBy(cal, windows, start, next, time);
  const w = j >= 0 ? windows[j]! : null;
  let entry: ScheduleEntry, lo: number, hi: number, idle: boolean;
  if (w && time < at(w.end!)) {
    entry = w;
    lo = at(w.start!);
    hi = at(w.end!);
    idle = false;
  } else {
    entry = variant?.idle ?? schedule.idle;
    lo = w ? at(w.end!) : start;
    hi = windows[j + 1] ? at(windows[j + 1]!.start!) : next;
    idle = true;
  }
  const progress = Math.min(Math.max((time - lo) / (hi - lo), 0), 1 - Number.EPSILON);
  return Object.freeze({
    schedule: schedule.id,
    time,
    dayIndex,
    weekday,
    timeOfDay: Math.min(Math.max(time - start, 0), cal.dayLength),
    variant: variant?.id ?? null,
    entry,
    idle,
    travel: entry.from !== null,
    windowStart: lo,
    windowEnd: hi,
    progress,
  });
}

/**
 * Where and doing what the schedule puts its actor at `time`. The time is validated before flags are read; flags are
 * then read once. Throws `RangeError` for a non-finite, out-of-span or unresolvable time and `TypeError` for a
 * schedule not returned by `defineSchedule` or a malformed flag source.
 */
export function schedulePlacement(schedule: Schedule, time: number, flags?: ScheduleFlags): SchedulePlacement {
  const c = compiledOf(schedule);
  checkTime(schedule, time, 'time');
  return place(schedule, c, readFlags(schedule, flags), time);
}

export interface ScheduleCatchUpOptions {
  /** Most transitions reported. Default 64, at most 4,096. */
  readonly maxTransitions?: number;
}

/**
 * The occupant changes between `from` (exclusive) and `to` (inclusive), in order, and the exact placement at `to`.
 *
 * A change is reported at every window start (each day it occurs, so a whole-day window or a midnight-crossing pair
 * of windows reports one at midnight even with the same anchor) and wherever idle time begins after a window or the
 * idle entry itself changes; idle time continuing across midnight under the same idle entry is one occupancy. Every
 * reported `at` is a boundary `schedulePlacement` agrees with: `schedulePlacement(at).entry` is the reported entry.
 * Flags are read once for the whole span: if they changed during it, split the call at the change. Work: weekday
 * owners and the next changing weekday are resolved once per call (O(cycleDays x variants)); days with no change are
 * jumped over, so each visited day after the first reports at least one change, and work is
 * O(cycleDays x variants + log windows + maxTransitions).
 */
export function scheduleCatchUp(
  schedule: Schedule,
  from: number,
  to: number,
  flags?: ScheduleFlags,
  options: ScheduleCatchUpOptions = {},
): ScheduleCatchUp {
  const c = compiledOf(schedule);
  checkTime(schedule, from, 'from');
  checkTime(schedule, to, 'to');
  const max = options?.maxTransitions ?? SCHEDULE_LIMITS.defaultTransitions;
  if (!intIn(max, 0, SCHEDULE_LIMITS.transitions)) fail(`maxTransitions must be 0..${SCHEDULE_LIMITS.transitions}`);
  const on = readFlags(schedule, flags);
  const final = place(schedule, c, on, to);
  if (to < from)
    return Object.freeze({transitions: Object.freeze([]), truncated: false, rewound: true, final, daysVisited: 0});
  const cal = schedule.calendar,
    n = cal.cycleDays;
  const owner = Int16Array.from({length: n}, (_, wd) => ownerOn(schedule, c, on, wd));
  const variantOf = (wd: number) => (owner[wd]! < 0 ? null : schedule.variants[owner[wd]!]!);
  const idleOf = (wd: number) => variantOf(wd)?.idle ?? schedule.idle;
  // Occupant at the end of a weekday: an idle entry id, or null when a window runs to the end of the day.
  const endKey = (wd: number): string | null => {
    const ws = variantOf(wd)?.windows ?? [];
    return ws.length && ws[ws.length - 1]!.end === cal.dayLength ? null : idleOf(wd).id;
  };
  const changes = Uint8Array.from({length: n}, (_, wd) =>
    (variantOf(wd)?.windows.length ?? 0) > 0 || idleOf(wd).id !== endKey(mod(wd - 1, n)) ? 1 : 0,
  );
  // Days from each weekday to the next weekday with a change (0 when it has one), or -1 when none ever changes.
  const ahead = new Int32Array(n).fill(-1);
  for (let pass = 0; pass < 2; pass++)
    for (let wd = n - 1; wd >= 0; wd--) {
      if (changes[wd]) ahead[wd] = 0;
      else {
        const nx = ahead[(wd + 1) % n]!;
        if (nx >= 0) ahead[wd] = nx + 1;
      }
    }
  const out: ScheduleTransition[] = [];
  const firstDay = dayIndexOf(cal, from),
    lastDay = dayIndexOf(cal, to);
  let truncated = false;
  let day = firstDay,
    daysVisited = 0;
  while (day <= lastDay) {
    const weekday = mod(day, n);
    const skip = ahead[weekday]!;
    if (skip < 0) break;
    if (skip > 0) {
      day += skip;
      continue;
    }
    daysVisited++;
    const start = dayStartOf(cal, day),
      next = dayStartOf(cal, day + 1);
    const variant = variantOf(weekday);
    const windows = variant?.windows ?? [];
    const idle = idleOf(weekday);
    const emit = (tod: number, entry: ScheduleEntry, isIdle: boolean): boolean => {
      const at = boundary(cal, start, next, tod);
      if (at <= from) return true;
      if (at > to) return false;
      if (out.length >= max) {
        truncated = true;
        return false;
      }
      out.push(Object.freeze({at, dayIndex: day, weekday, variant: variant?.id ?? null, entry, idle: isIdle}));
      return true;
    };
    let going = true;
    // Midnight: a window starting at 0 always begins a new occupancy; idle begins one if the idle entry changed.
    const w0 = windows[0];
    if (w0 && w0.start === 0) going = emit(0, w0, false);
    else if (endKey(mod(weekday - 1, n)) !== idle.id) going = emit(0, idle, true);
    // On the first day, skip windows whose changes are all at or before `from` (O(log n)).
    let j = day === firstDay ? Math.max(lastStartingBy(cal, windows, start, next, from), 0) : 0;
    for (; going && j < windows.length; j++) {
      const w = windows[j]!;
      if (w.start! > 0) going = emit(w.start!, w, false);
      const following = windows[j + 1];
      if (going && w.end! < cal.dayLength && !(following && following.start === w.end))
        going = emit(w.end!, idle, true);
    }
    if (!going) break;
    day++;
  }
  return Object.freeze({transitions: Object.freeze(out), truncated, rewound: false, final, daysVisited});
}

/** Plain order data accepted by the itinerary kit's `edit({type: 'insert', order})`. */
export interface ScheduleItineraryOrder {
  readonly tag: string;
  readonly destination: {readonly id: string; readonly generation: number};
  /**
   * Absolute deadline: `ceil(windowEnd)` on the timeline, so it does not go stale as time passes. For idle time it is
   * the end of today's gap (idle is clipped at midnight); reissue the order at the next wake.
   */
  readonly value: number;
}

/**
 * The itinerary order that moves an actor to a placement's anchor. `generation` is the creator's destination
 * generation (bumped when the anchor's meaning changes); pass the itinerary's `maxTextLength` to refuse an anchor or
 * tag it would reject. Throws `RangeError` for invalid options, an over-long anchor or a negative deadline.
 */
export function scheduleItineraryOrder(
  placement: SchedulePlacement,
  options: {readonly tag: string; readonly generation: number; readonly maxTextLength?: number},
): ScheduleItineraryOrder {
  const o = plain(options, 'itinerary options');
  const tag = text(o.tag, 'itinerary tag');
  if (!intIn(o.generation, 0, Number.MAX_SAFE_INTEGER)) fail('generation must be a nonnegative safe integer');
  const limit = o.maxTextLength ?? SCHEDULE_LIMITS.textLength;
  if (!intIn(limit, 1, Number.MAX_SAFE_INTEGER)) fail('maxTextLength must be a positive safe integer');
  const anchor = placement.entry.anchor;
  if (tag.length > limit || anchor.length > limit) fail(`tag and anchor must fit maxTextLength ${limit}`);
  const value = Math.ceil(placement.windowEnd);
  if (!intIn(value, 0, Number.MAX_SAFE_INTEGER)) fail('the window deadline must be a nonnegative safe integer');
  return Object.freeze({tag, destination: Object.freeze({id: anchor, generation: o.generation}), value});
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
  /** Every assigned actor, ascending. O(actors log actors); allocates. */
  actors(): readonly number[];
  /**
   * Actors whose schedule names `anchor` as a destination or travel origin, ascending: the only candidates that can be
   * at (or travelling from or to) it. O(k log k) for k candidates; allocates.
   */
  actorsMentioning(anchor: string): readonly number[];
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

/** A bounded actor-to-schedule table with an anchor index. The caller owns actors, entities, positions and saves. */
export function createScheduleRoster(limits: ScheduleRosterLimits): ScheduleRoster {
  const o = plain(limits, 'roster limits');
  const maxActors = o.maxActors;
  if (!intIn(maxActors, 1, SCHEDULE_LIMITS.actors)) fail(`maxActors must be 1..${SCHEDULE_LIMITS.actors}`);
  const frozen = Object.freeze({maxActors});
  const table = new Map<number, Schedule>();
  const byAnchor = new Map<string, Set<number>>();
  let closed = false;
  const check = (actor: number) => {
    if (!intIn(actor, 0, Number.MAX_SAFE_INTEGER))
      throw new TypeError('schedules: actor must be a nonnegative safe integer');
  };
  const index = (actor: number, schedule: Schedule, add: boolean) => {
    for (const a of schedule.anchors) {
      let set = byAnchor.get(a);
      if (add) {
        if (!set) byAnchor.set(a, (set = new Set()));
        set.add(actor);
      } else if (set) {
        set.delete(actor);
        if (set.size === 0) byAnchor.delete(a);
      }
    }
  };
  const sorted = (values: Iterable<number>) => Object.freeze([...values].sort((a, b) => a - b));
  return Object.freeze({
    limits: frozen,
    get size() {
      return table.size;
    },
    assign(actor: number, schedule: Schedule) {
      check(actor);
      compiledOf(schedule);
      if (closed) return 'closed' as const;
      const previous = table.get(actor);
      if (!previous && table.size >= maxActors) return 'saturated' as const;
      if (previous) index(actor, previous, false);
      table.set(actor, schedule);
      index(actor, schedule, true);
      return previous ? ('replaced' as const) : ('assigned' as const);
    },
    unassign(actor: number) {
      check(actor);
      if (closed) return 'closed' as const;
      const previous = table.get(actor);
      if (!previous) return 'absent' as const;
      index(actor, previous, false);
      table.delete(actor);
      return 'removed' as const;
    },
    scheduleOf(actor: number) {
      check(actor);
      return closed ? null : (table.get(actor) ?? null);
    },
    actors: () => sorted(closed ? [] : table.keys()),
    actorsMentioning(anchor: string) {
      text(anchor, 'anchor');
      return sorted(closed ? [] : (byAnchor.get(anchor) ?? []));
    },
    placement(actor: number, time: number, flags?: ScheduleFlags) {
      check(actor);
      const s = closed ? undefined : table.get(actor);
      return s ? schedulePlacement(s, time, flags) : null;
    },
    catchUp(actor: number, from: number, to: number, flags?: ScheduleFlags, options?: ScheduleCatchUpOptions) {
      check(actor);
      const s = closed ? undefined : table.get(actor);
      return s ? scheduleCatchUp(s, from, to, flags, options) : null;
    },
    dispose() {
      closed = true;
      table.clear();
      byAnchor.clear();
    },
  });
}
