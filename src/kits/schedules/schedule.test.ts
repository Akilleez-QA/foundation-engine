import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mulberry32} from '../../core/rng';
import {
  createScheduleRoster,
  defineSchedule,
  defineScheduleCalendar,
  scheduleCatchUp,
  scheduleItineraryOrder,
  schedulePlacement,
  SCHEDULE_LIMITS,
  type Schedule,
  type ScheduleInput,
  type SchedulePlacement,
  type ScheduleWindowInput,
} from './index';

// A 24-unit day, a 7-day pattern; day 0 starts at time 1000.
const cal = defineScheduleCalendar({dayLength: 24, epoch: 1000, cycleDays: 7});
const w = (id: string, start: number, end: number, anchor: string, extra: Partial<ScheduleWindowInput> = {}) => ({
  id,
  start,
  end,
  anchor,
  activity: id,
  ...extra,
});
const baker: ScheduleInput = {
  id: 'baker',
  idle: {id: 'home', anchor: 'house', activity: 'rest'},
  variants: [
    {
      id: 'holiday',
      when: ['festival'],
      windows: [w('parade', 10, 14, 'square')],
    },
    {
      id: 'workday',
      days: [0, 1, 2, 3, 4],
      unless: ['sick'],
      windows: [
        w('commute', 6, 8, 'bakery', {from: 'house'}),
        w('bake', 8, 12, 'bakery'),
        w('lunch', 12, 13, 'tavern'),
        w('sell', 14, 18, 'bakery'),
      ],
    },
    {
      id: 'weekend',
      days: [5, 6],
      idle: {id: 'garden', anchor: 'yard', activity: 'garden'},
      windows: [w('market', 9, 11, 'square')],
    },
  ],
};
const at = (day: number, hour: number) => 1000 + day * 24 + hour;

test('calendar and schedule definitions refuse broken contracts before returning anything', () => {
  assert.throws(() => defineScheduleCalendar({dayLength: 0}), RangeError);
  assert.throws(() => defineScheduleCalendar({dayLength: SCHEDULE_LIMITS.maxDayLength * 2}), RangeError);
  assert.throws(() => defineScheduleCalendar({dayLength: Number.NaN}), RangeError);
  assert.throws(() => defineScheduleCalendar({dayLength: 24, cycleDays: 0}), RangeError);
  assert.throws(() => defineScheduleCalendar({dayLength: 24, cycleDays: 367}), RangeError);
  assert.throws(() => defineScheduleCalendar({dayLength: 24, epoch: Number.POSITIVE_INFINITY}), RangeError);
  const one = (windows: ScheduleWindowInput[], extra = {}) =>
    defineSchedule(cal, {
      id: 's',
      idle: {id: 'i', anchor: 'a', activity: 'x'},
      variants: [{id: 'v', windows, ...extra}],
    });
  assert.throws(() => one([w('a', 1, 5, 'p'), w('b', 4, 6, 'p')]), /overlap/);
  assert.throws(() => one([w('a', 5, 5, 'p')]), /start < end/);
  assert.throws(() => one([w('a', 20, 25, 'p')]), /start < end/);
  assert.throws(() => one([w('a', -1, 2, 'p')]), RangeError);
  assert.throws(() => one([w('a', 1, 2, 'p'), w('a', 3, 4, 'p')]), /duplicate entry id/);
  assert.throws(() => one([w('i', 1, 2, 'p')]), /duplicate entry id/);
  assert.throws(() => one([], {days: [7]}), /day must be/);
  assert.throws(() => one([], {days: []}), RangeError);
  assert.throws(() => one([w('a', 1, 2, '')]), /anchor/);
  assert.throws(() => one([], {when: Array.from({length: 33}, (_, k) => `f${k}`)}), RangeError);
  assert.throws(
    () =>
      defineSchedule(cal, {
        id: 's',
        idle: {id: 'i', anchor: 'a', activity: 'x'},
        variants: [
          {id: 'v', windows: []},
          {id: 'v', windows: []},
        ],
      }),
    /duplicate variant/,
  );
  const tooMany = Array.from({length: 257}, (_, k) => w(`w${k}`, k * 0.05, k * 0.05 + 0.01, 'p'));
  assert.throws(() => one(tooMany), RangeError);
  // Touching windows are allowed; definitions are frozen and sorted.
  const ok = one([w('b', 4, 6, 'p'), w('a', 1, 4, 'p')]);
  assert.deepEqual(
    ok.variants[0]!.windows.map(x => x.id),
    ['a', 'b'],
  );
  assert.ok(Object.isFrozen(ok) && Object.isFrozen(ok.variants[0]!.windows) && Object.isFrozen(ok.idle));
  const s = defineSchedule(cal, baker);
  assert.throws(() => schedulePlacement(s, Number.NaN), RangeError);
  assert.throws(() => schedulePlacement(s, Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => schedulePlacement(s, 1e16), RangeError);
  assert.throws(() => scheduleCatchUp(s, 0, Number.NaN), RangeError);
  assert.throws(() => scheduleCatchUp(s, 0, 10, undefined, {maxTransitions: 4097}), RangeError);
});

test('placement resolves windows, idle gaps, travel progress, day wrap and times before the epoch', () => {
  const s = defineSchedule(cal, baker);
  const p = (t: number, flags?: ReadonlySet<string>) => schedulePlacement(s, t, flags);
  const commute = p(at(1, 7));
  assert.equal(commute.entry.id, 'commute');
  assert.equal(commute.travel, true);
  assert.equal(commute.entry.from, 'house');
  assert.equal(commute.progress, 0.5);
  assert.equal(commute.windowStart, at(1, 6));
  assert.equal(commute.windowEnd, at(1, 8));
  // Half-open windows: the end belongs to the next occupant.
  assert.equal(p(at(1, 8)).entry.id, 'bake');
  assert.equal(p(at(1, 12)).entry.id, 'lunch');
  // A gap falls to idle, bounded by its neighbours within the day.
  const gap = p(at(1, 13.5));
  assert.equal(gap.idle, true);
  assert.equal(gap.entry.id, 'home');
  assert.equal(gap.windowStart, at(1, 13));
  assert.equal(gap.windowEnd, at(1, 14));
  const night = p(at(1, 20));
  assert.equal(night.entry.anchor, 'house');
  assert.equal(night.windowEnd, at(2, 0), 'idle is clipped at the day end');
  // Weekend: its own idle entry and window.
  assert.equal(p(at(5, 10)).entry.id, 'market');
  assert.equal(p(at(5, 3)).entry.id, 'garden');
  assert.equal(p(at(5, 3)).variant, 'weekend');
  // The day wraps at dayLength; weekday repeats every 7 days.
  const later = p(at(7 * 1000 + 1, 9));
  assert.equal(later.weekday, 1);
  assert.equal(later.entry.id, 'bake');
  // Before the epoch: negative day indices keep a nonnegative weekday.
  const before = p(at(-2, 10));
  assert.equal(before.dayIndex, -2);
  assert.equal(before.weekday, 5);
  assert.equal(before.entry.id, 'market');
  assert.ok(Object.isFrozen(commute));
});

test('conditional variants: priority order, when/unless, flags read once, malformed flags refused', () => {
  const s = defineSchedule(cal, baker);
  assert.deepEqual(s.flags, ['festival', 'sick']);
  const reads: string[] = [];
  const flags = (f: string) => {
    reads.push(f);
    return f === 'festival';
  };
  const p = schedulePlacement(s, at(2, 11), flags);
  assert.equal(p.variant, 'holiday');
  assert.equal(p.entry.id, 'parade');
  assert.deepEqual(reads, ['festival', 'sick'], 'each flag read exactly once');
  // Holiday owns the whole day: its gaps use the schedule idle, not the workday windows.
  assert.equal(schedulePlacement(s, at(2, 9), flags).entry.id, 'home');
  // Sick on a workday: no variant owns it, the schedule idle applies all day.
  const sick = schedulePlacement(s, at(2, 9), new Set(['sick']));
  assert.equal(sick.variant, null);
  assert.equal(sick.entry.id, 'home');
  assert.equal(sick.windowStart, at(2, 0));
  assert.equal(sick.windowEnd, at(3, 0));
  assert.throws(() => schedulePlacement(s, at(2, 9), (): boolean => JSON.parse('1')), TypeError);
  reads.length = 0;
  scheduleCatchUp(s, at(0, 0), at(30, 0), flags);
  assert.deepEqual(reads, ['festival', 'sick'], 'catch-up reads flags once for the whole span');
});

test('catch-up reports ordered transitions across days, merges idle across midnight, and is exact at the end', () => {
  const s = defineSchedule(cal, baker);
  const r = scheduleCatchUp(s, at(4, 17), at(5, 12));
  assert.equal(r.truncated, false);
  assert.equal(r.rewound, false);
  assert.deepEqual(
    r.transitions.map(t => [t.at - 1000, t.entry.id, t.idle]),
    [
      [4 * 24 + 18, 'home', true],
      [5 * 24 + 0, 'garden', true],
      [5 * 24 + 9, 'market', false],
      [5 * 24 + 11, 'garden', true],
    ],
  );
  assert.deepEqual(r.final, schedulePlacement(s, at(5, 12)));
  // Endpoints: from is exclusive, to inclusive.
  assert.deepEqual(
    scheduleCatchUp(s, at(1, 8), at(1, 12)).transitions.map(t => t.entry.id),
    ['lunch'],
  );
  // Idle time crossing midnight under the same idle entry is one occupancy.
  assert.deepEqual(
    scheduleCatchUp(s, at(1, 19), at(2, 7)).transitions.map(t => t.entry.id),
    ['commute'],
  );
  // A full-day window begins again every day.
  const allDay = defineSchedule(defineScheduleCalendar({dayLength: 10}), {
    id: 'guard',
    idle: {id: 'off', anchor: 'barracks', activity: 'rest'},
    variants: [{id: 'v', windows: [w('watch', 0, 10, 'gate')]}],
  });
  assert.deepEqual(
    scheduleCatchUp(allDay, 5, 35).transitions.map(t => t.at),
    [10, 20, 30],
  );
  const back = scheduleCatchUp(s, at(3, 0), at(1, 9));
  assert.equal(back.rewound, true);
  assert.equal(back.transitions.length, 0);
  assert.equal(back.final.entry.id, 'bake');
});

test('catch-up overflow is truncated with the exact final state, and long skips stay bounded', () => {
  const s = defineSchedule(cal, baker);
  const r = scheduleCatchUp(s, at(0, 0), at(700, 13.5), undefined, {maxTransitions: 5});
  assert.equal(r.transitions.length, 5);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.final, schedulePlacement(s, at(700, 13.5)));
  assert.equal(scheduleCatchUp(s, at(0, 0), at(1, 0), undefined, {maxTransitions: 0}).truncated, true);
  // A billion-day skip of a busy schedule stops at the limit.
  const huge = scheduleCatchUp(s, at(0, 0), at(1e9, 3), undefined, {maxTransitions: 4096});
  assert.equal(huge.transitions.length, 4096);
  assert.equal(huge.truncated, true);
  assert.ok(huge.daysVisited <= huge.transitions.length + 2, `visited ${huge.daysVisited} days`);
  // A schedule with no change at all stops after one pattern cycle, not after a billion days.
  const still = defineSchedule(cal, {
    id: 'statue',
    idle: {id: 'stand', anchor: 'plinth', activity: 'stand'},
    variants: [],
  });
  const none = scheduleCatchUp(still, at(0, 0), at(1e9, 3));
  assert.equal(none.transitions.length, 0);
  assert.equal(none.truncated, false);
  assert.equal(none.final.entry.id, 'stand');
  assert.equal(none.daysVisited, 0, 'a schedule that never changes visits no day');
  // Changes only once per pattern cycle are still all found.
  const weekly = defineSchedule(cal, {
    id: 'weekly',
    idle: {id: 'home', anchor: 'house', activity: 'rest'},
    variants: [{id: 'v', days: [3], windows: [w('church', 10, 11, 'chapel')]}],
  });
  const wk = scheduleCatchUp(weekly, at(0, 0), at(70, 0));
  assert.equal(wk.transitions.length, 20);
  assert.equal(wk.daysVisited, 10, 'only the changing weekday of each pattern cycle is visited');
});

/** Reference model: sample every integer time and detect occupant changes directly. */
function bruteTransitions(s: Schedule, from: number, to: number): string[] {
  const key = (t: number) => {
    const p = schedulePlacement(s, t);
    return p.idle ? `idle:${p.entry.id}` : `${p.dayIndex}:${p.entry.id}`;
  };
  const out: string[] = [];
  let prev = key(from);
  for (let t = from + 1; t <= to; t++) {
    const k = key(t);
    if (k !== prev) out.push(`${t}:${schedulePlacement(s, t).entry.id}`);
    prev = k;
  }
  return out;
}

test('catch-up matches a brute-force occupant-change model on 300 random schedules', () => {
  const rnd = mulberry32(117);
  const int = (n: number) => Math.floor(rnd() * n);
  let seen = 0,
    midnight = 0;
  for (let trial = 0; trial < 300; trial++) {
    const dayLength = 4 + int(20);
    const cycleDays = 1 + int(4);
    const c = defineScheduleCalendar({dayLength, epoch: int(50) - 25, cycleDays});
    let n = 0;
    const variants = Array.from({length: int(4)}, (_, v) => {
      const windows: ScheduleWindowInput[] = [];
      let t = int(3);
      while (t < dayLength && windows.length < 6) {
        const end = Math.min(dayLength, t + 1 + int(5));
        if (rnd() < 0.7) windows.push(w(`w${n++}`, t, end, `a${int(3)}`));
        t = rnd() < 0.5 ? end : end + int(3);
      }
      return {
        id: `v${v}`,
        ...(rnd() < 0.6 ? {days: [int(cycleDays)]} : {}),
        ...(rnd() < 0.3 ? {idle: {id: `idle${v}`, anchor: 'b', activity: 'x'}} : {}),
        windows,
      };
    });
    const s = defineSchedule(c, {id: 's', idle: {id: 'idle', anchor: 'h', activity: 'x'}, variants});
    const from = int(200) - 100;
    const to = from + int(dayLength * cycleDays * 3);
    const got = scheduleCatchUp(s, from, to, undefined, {maxTransitions: 4096});
    assert.deepEqual(
      got.transitions.map(t => `${t.at}:${t.entry.id}`),
      bruteTransitions(s, from, to),
      `trial ${trial}`,
    );
    assert.deepEqual(got.final, schedulePlacement(s, to));
    seen += got.transitions.length;
    if (got.transitions.some(t => t.at === c.epoch + Math.ceil((t.at - c.epoch) / dayLength) * dayLength)) midnight++;
  }
  assert.ok(seen > 1000 && midnight > 20, `model exercised (${seen} transitions, ${midnight} at midnight)`);
});

test('roster bounds actors, replaces, refuses foreign schedules and closes', () => {
  const s = defineSchedule(cal, baker);
  const roster = createScheduleRoster({maxActors: 2});
  assert.throws(() => createScheduleRoster({maxActors: 0}), RangeError);
  assert.equal(roster.assign(1, s), 'assigned');
  assert.equal(roster.assign(2, s), 'assigned');
  assert.equal(roster.assign(3, s), 'saturated');
  assert.equal(roster.size, 2);
  assert.equal(roster.assign(2, s), 'replaced');
  assert.throws(() => roster.assign(-1, s), TypeError);
  assert.throws(() => roster.assign(4, {...s}), TypeError);
  const fake = Object.freeze({...s, shortestSegment: Number.NaN});
  assert.throws(() => roster.assign(4, fake), TypeError, 'a hand-built frozen schedule is refused');
  assert.throws(() => schedulePlacement(fake, 0), TypeError);
  assert.throws(() => scheduleCatchUp(fake, 0, 1), TypeError);
  assert.deepEqual(roster.actors(), [1, 2]);
  assert.deepEqual(roster.actorsMentioning('tavern'), [1, 2]);
  assert.deepEqual(roster.actorsMentioning('nowhere'), []);
  assert.equal(roster.placement(1, at(1, 9))?.entry.id, 'bake');
  assert.equal(roster.placement(3, at(1, 9)), null);
  assert.equal(roster.catchUp(1, at(1, 9), at(1, 13))?.transitions.length, 2);
  assert.equal(roster.unassign(2), 'removed');
  assert.deepEqual(roster.actorsMentioning('tavern'), [1]);
  assert.equal(roster.unassign(2), 'absent');
  roster.dispose();
  roster.dispose();
  assert.equal(roster.assign(1, s), 'closed');
  assert.equal(roster.placement(1, at(1, 9)), null);
  assert.equal(roster.size, 0);
});

test('itinerary order helper gives an absolute deadline and refuses what the itinerary would reject', () => {
  const s = defineSchedule(cal, baker);
  const p = schedulePlacement(s, at(1, 6.5));
  const order = scheduleItineraryOrder(p, {tag: 'visit', generation: 3});
  assert.deepEqual(order, {tag: 'visit', destination: {id: 'bakery', generation: 3}, value: at(1, 8)});
  // The same window evaluated later gives the same deadline: the value does not go stale.
  assert.equal(scheduleItineraryOrder(schedulePlacement(s, at(1, 7.9)), {tag: 'visit', generation: 3}).value, at(1, 8));
  assert.throws(() => scheduleItineraryOrder(p, {tag: '', generation: 0}), RangeError);
  assert.throws(() => scheduleItineraryOrder(p, {tag: 'visit', generation: -1}), RangeError);
  assert.throws(() => scheduleItineraryOrder(p, {tag: 'visit', generation: 0, maxTextLength: 5}), /maxTextLength/);
  const early = defineSchedule(defineScheduleCalendar({dayLength: 24, cycleDays: 7}), baker);
  assert.throws(() => scheduleItineraryOrder(schedulePlacement(early, -30), {tag: 'visit', generation: 0}), RangeError);
});

/** Walk a clock-style follow loop (wake at windowEnd) and record occupant changes the way catch-up defines them. */
function follow(s: Schedule, from: number, to: number) {
  const key = (p: SchedulePlacement) => (p.idle ? `idle:${p.entry.id}` : `${p.dayIndex}:${p.entry.id}`);
  let p = schedulePlacement(s, from);
  let prev = key(p);
  const changes: [number, string][] = [];
  for (let steps = 0; p.windowEnd <= to; steps++) {
    assert.ok(steps < 100000, 'follow loop bounded');
    const next = schedulePlacement(s, p.windowEnd);
    assert.ok(next.windowEnd > p.windowEnd, `strict progress at ${p.windowEnd}`);
    assert.ok(next.windowStart <= next.time && next.time < next.windowEnd);
    const k = key(next);
    if (k !== prev) changes.push([next.time, next.entry.id]);
    prev = k;
    p = next;
  }
  return changes;
}

test('C1 regression: non-dyadic boundaries make strict progress and catch-up agrees with placement', () => {
  // Reported repros: a wake at windowEnd returned the same occupant at the same time, and a transition's entry
  // disagreed with the placement at that instant.
  const c1 = defineScheduleCalendar({dayLength: 1.1, epoch: 0.3});
  const a = defineSchedule(c1, {
    id: 'a',
    idle: {id: 'home', anchor: 'h', activity: 'x'},
    variants: [{id: 'v', windows: [w('work', 0.2, 0.7, 'p')]}],
  });
  assert.ok(follow(a, 0.31, 6).length > 8);
  const b = defineSchedule(c1, {
    id: 'b',
    idle: {id: 'home', anchor: 'h', activity: 'x'},
    variants: [{id: 'v', windows: [w('work', 0.7, 1.1, 'p')]}],
  });
  const r = scheduleCatchUp(b, 3.5, 4.3);
  for (const t of r.transitions) assert.equal(schedulePlacement(b, t.at).entry.id, t.entry.id);
  assert.ok(r.transitions.length > 0);
  assert.deepEqual(r.final, schedulePlacement(b, 4.3));
});

test('C1 fuzz: decimal day lengths, epochs and bounds, near zero and near 1e15', () => {
  const rnd = mulberry32(0x5eed);
  const dec = (n: number, places: number) => Math.round(rnd() * n * 10 ** places) / 10 ** places;
  let checked = 0;
  for (let trial = 0; trial < 400; trial++) {
    const large = trial % 4 === 3;
    const dayLength = large ? 3000 + dec(90000, 3) : 1 + dec(30, 3);
    const unit = large ? 2 : dayLength / 50; // segments stay resolvable at the chosen magnitude
    const epoch = large ? dec(1e6, 3) - 5e5 : dec(10, 3) - 5;
    const c = defineScheduleCalendar({dayLength, epoch, cycleDays: 1 + Math.floor(rnd() * 3)});
    let n = 0;
    const variants = Array.from({length: 1 + Math.floor(rnd() * 3)}, (_, v) => {
      const windows: ScheduleWindowInput[] = [];
      let t = rnd() < 0.3 ? 0 : unit + dec(dayLength / 4, 3);
      while (t + unit < dayLength && windows.length < 5) {
        const end = Math.min(dayLength, t + unit + dec(dayLength / 4, 3));
        if (dayLength - end > 0 && dayLength - end < unit) break;
        windows.push(w(`w${n++}`, t, end, 'p'));
        t = rnd() < 0.4 ? end : end + unit + dec(dayLength / 6, 3);
      }
      return {id: `v${v}`, ...(rnd() < 0.5 ? {days: [Math.floor(rnd() * c.cycleDays)]} : {}), windows};
    });
    const s = defineSchedule(c, {id: 's', idle: {id: 'idle', anchor: 'h', activity: 'x'}, variants});
    const base = large ? (rnd() < 0.5 ? 1 : -1) * (1e15 - 1e6 - dayLength * 20) : dec(20, 3) - 10;
    const from = base + dec(dayLength, 3);
    const to = from + dec(dayLength * 6, 3);
    const changes = follow(s, from, to);
    const got = scheduleCatchUp(s, from, to, undefined, {maxTransitions: 4096});
    assert.deepEqual(
      got.transitions.map(t => [t.at, t.entry.id]),
      changes,
      `trial ${trial}`,
    );
    for (const t of got.transitions) assert.equal(schedulePlacement(s, t.at).entry, t.entry);
    checked += changes.length;
  }
  assert.ok(checked > 1500, `exercised ${checked} transitions`);
});

test('times too large to resolve a schedule are refused, not silently merged', () => {
  const fine = defineSchedule(defineScheduleCalendar({dayLength: 1.1, epoch: 0.3}), {
    id: 'fine',
    idle: {id: 'home', anchor: 'h', activity: 'x'},
    variants: [{id: 'v', windows: [w('work', 0.2, 0.7, 'p')]}],
  });
  assert.equal(fine.shortestSegment, 0.2);
  assert.throws(() => schedulePlacement(fine, 1e15), /cannot resolve this schedule's shortest segment \(0\.2\)/);
  assert.throws(() => scheduleCatchUp(fine, 0, 1e15), /to 1000000000000000: float spacing/);
  // A segment no time could resolve is refused at definition, not at the first evaluation.
  assert.throws(
    () =>
      defineSchedule(defineScheduleCalendar({dayLength: 24}), {
        id: 'tiny',
        idle: {id: 'home', anchor: 'h', activity: 'x'},
        variants: [{id: 'v', windows: [w('blink', 1, 1 + 1e-14, 'p')]}],
      }),
    /shortest segment .* below the float resolution/,
  );
  assert.equal(schedulePlacement(fine, 1e12).schedule, 'fine');
  const coarse = defineSchedule(defineScheduleCalendar({dayLength: 86400, cycleDays: 7}), baker);
  assert.equal(schedulePlacement(coarse, 1e15 - 1).schedule, 'baker');
});

test('flag sources are validated before use, after times, and a Proxy around a Set is documented as refused', () => {
  const plainSchedule = defineSchedule(cal, {id: 'p', idle: {id: 'i', anchor: 'a', activity: 'x'}, variants: []});
  assert.throws(() => schedulePlacement(plainSchedule, 0, 'yes' as never), TypeError);
  let reads = 0;
  const s = defineSchedule(cal, baker);
  assert.throws(() => schedulePlacement(s, Number.NaN, () => (reads++, true)), RangeError);
  assert.throws(() => scheduleCatchUp(s, 0, Number.NaN, () => (reads++, true)), RangeError);
  assert.equal(reads, 0, 'times are validated before any flag is read');
  assert.throws(() => schedulePlacement(s, 0, new Proxy(new Set<string>(), {})), TypeError);
  const real = new Set(['festival']);
  assert.equal(
    schedulePlacement(s, at(2, 11), f => real.has(f)).variant,
    'holiday',
    'wrap other sources in a predicate',
  );
});

test('catch-up worst case stays bounded: 366-day pattern, 4,096 transitions, span 1e15', () => {
  const year = defineScheduleCalendar({dayLength: 86400, cycleDays: 366});
  const rare = defineSchedule(year, {
    id: 'rare',
    idle: {id: 'home', anchor: 'h', activity: 'x'},
    variants: [{id: 'v', days: [365], windows: [w('fair', 3600, 7200, 'square')]}],
  });
  const r = scheduleCatchUp(rare, -9e14, 9e14, undefined, {maxTransitions: 4096});
  assert.equal(r.transitions.length, 4096);
  assert.equal(r.truncated, true);
  for (let k = 1; k < r.transitions.length; k++) assert.ok(r.transitions[k]!.at > r.transitions[k - 1]!.at);
  // Deterministic work bound instead of wall-clock time: 2,048 fair days give 4,096 changes (two each), and one more
  // fair day is visited where the limit is reached.
  assert.equal(r.daysVisited, 2049);
});
