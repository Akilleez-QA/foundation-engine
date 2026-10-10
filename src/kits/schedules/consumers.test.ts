import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClock} from '../../core/clock';
import {createItinerary, type ItineraryTicket} from '../itinerary/index';
import {
  createRegionActivation,
  createRegionUpdateResult,
  type RegionActivationLimits,
} from '../region-activation/index';
import {
  createScheduleRoster,
  defineSchedule,
  defineScheduleCalendar,
  scheduleCatchUp,
  scheduleItineraryOrder,
  schedulePlacement,
  type ScheduleInput,
  type SchedulePlacement,
} from './index';

// One game day is an hour of UT; day 0 starts at UT 0.
const DAY = 3600;
const calendar = defineScheduleCalendar({dayLength: DAY, cycleDays: 1});
const h = (hours: number) => (hours / 24) * DAY;
const anchors: Record<string, {x: number; y: number}> = {
  house: {x: 5, y: 5},
  field: {x: 25, y: 5},
  well: {x: 35, y: 5},
  tavern: {x: 45, y: 5},
};
const farmer: ScheduleInput = {
  id: 'farmer',
  idle: {id: 'home', anchor: 'house', activity: 'rest'},
  variants: [
    {
      id: 'day',
      windows: [
        {id: 'walk-out', start: h(6), end: h(7), anchor: 'field', activity: 'walk', from: 'house'},
        {id: 'plough', start: h(7), end: h(12), anchor: 'field', activity: 'plough'},
        {id: 'water', start: h(12), end: h(13), anchor: 'well', activity: 'drink'},
        {id: 'harvest', start: h(13), end: h(18), anchor: 'field', activity: 'harvest'},
        {id: 'drink', start: h(19), end: h(22), anchor: 'tavern', activity: 'drink'},
      ],
    },
  ],
};

test('composes with the core GameClock: wakes at windowEnd through clock.schedule and catches up a loaded jump', () => {
  const s = defineSchedule(calendar, farmer);
  const {clock, driver} = createClock({realNow: () => 0, state: {ut: h(5), lastRealMs: 0}});
  const seen: string[] = [];
  const follow = () => {
    const p = schedulePlacement(s, clock.ut);
    seen.push(p.entry.id);
    // Only the actor's next change is scheduled: no per-frame evaluation.
    clock.schedule(p.windowEnd, follow);
  };
  follow();
  clock.requestWarp({owner: 'test', rate: 100, mode: 'rails'});
  while (clock.ut < h(14)) driver.advance(0.25);
  assert.deepEqual(seen, ['home', 'walk-out', 'plough', 'water', 'harvest']);
  // A load jumps UT forward two days (the clock never jumps on its own; restore is the load path).
  const before = clock.ut;
  driver.restore({ut: 2 * DAY + h(12.5), lastRealMs: 0});
  const skipped = scheduleCatchUp(s, before, clock.ut, undefined, {maxTransitions: 8});
  assert.equal(skipped.truncated, true);
  assert.deepEqual(
    skipped.transitions.map(t => t.entry.id),
    ['home', 'drink', 'home', 'walk-out', 'plough', 'water', 'harvest', 'home'],
  );
  assert.equal(skipped.final.entry.id, 'water', 'teleport target is exact despite truncation');
  assert.equal(skipped.final.dayIndex, 2);
});

test('composes with the itinerary kit: each scheduled window becomes an order the itinerary controller runs', () => {
  const s = defineSchedule(calendar, farmer);
  const route = createItinerary({maxOrders: 4, maxTextLength: 32, tags: ['visit']});
  const arrived: string[] = [];
  let ticket: ItineraryTicket | null = null;
  let current: string | null = null;
  // The creator's step: when the scheduled anchor changes, hand the itinerary a new order and start it.
  const step = (ut: number) => {
    const p = schedulePlacement(s, ut);
    if (p.entry.anchor !== current) {
      current = p.entry.anchor;
      route.cancel();
      const snap = route.snapshot();
      for (const o of snap.orders) route.edit(route.snapshot().revision, {type: 'remove', id: o.id, current: 'stop'});
      const order = scheduleItineraryOrder(p, {tag: 'visit', generation: 0});
      assert.equal(route.edit(route.snapshot().revision, {type: 'insert', index: 0, order}), 'accepted');
      const id = route.snapshot().orders[0]!.id;
      assert.equal(route.start(route.snapshot().revision, id), 'accepted');
      ticket = route.begin();
      assert.ok(ticket);
      assert.equal(ticket.order.destination.id, p.entry.anchor);
      assert.ok(ticket.order.value <= p.windowEnd - ut + 1);
    }
    // Movement adapter: a travel window arrives when its progress completes; a stationary one at once.
    if (ticket && (!p.travel || p.progress > 0.9) && route.check(ticket)) {
      assert.equal(route.finish(ticket), true);
      arrived.push(ticket.order.destination.id);
      ticket = null;
    }
  };
  for (let ut = h(5); ut <= h(23); ut += h(0.05)) step(ut);
  assert.deepEqual(arrived, ['house', 'field', 'well', 'field', 'house', 'tavern', 'house']);
  // A schedule change mid-travel revokes the outstanding attempt rather than letting it complete.
  current = null;
  step(h(6.1));
  const stale = ticket;
  assert.ok(stale);
  current = null;
  step(h(12.5));
  assert.equal(route.check(stale), false);
  route.dispose();
});

test('composes with region activation: a dormant actor appears at its scheduled place when its region wakes', () => {
  const limits: RegionActivationLimits = {
    cellSize: 10,
    minX: 0,
    minY: 0,
    maxX: 50,
    maxY: 10,
    maxRegions: 5,
    activateRadius: 1,
    releaseRadius: 2,
    lingerUpdates: 0,
    maxObservers: 1,
    maxActive: 5,
    maxPins: 1,
    maxActivationsPerUpdate: 5,
    maxDeactivationsPerUpdate: 5,
    maxCellsPerObserver: 9,
  };
  const regions = createRegionActivation(limits);
  const out = createRegionUpdateResult(limits);
  const roster = createScheduleRoster({maxActors: 8});
  const s = defineSchedule(calendar, farmer);
  const nightOwl = defineSchedule(calendar, {
    id: 'owl',
    idle: {id: 'perch', anchor: 'tavern', activity: 'watch'},
    variants: [],
  });
  roster.assign(1, s);
  roster.assign(2, nightOwl);
  const live = new Map<number, {x: number; y: number; entry: string; lastUt: number}>();
  const positionOf = (p: SchedulePlacement) => {
    const to = anchors[p.entry.anchor]!;
    if (!p.travel) return to;
    const from = anchors[p.entry.from!]!;
    return {x: from.x + (to.x - from.x) * p.progress, y: from.y + (to.y - from.y) * p.progress};
  };
  const dormantSince = new Map<number, number>([
    [1, 0],
    [2, 0],
  ]);
  const wake = (ut: number) => {
    regions.update(out);
    for (let k = 0; k < out.activatedCount; k++) {
      const region = out.activated[k]!;
      for (const actor of [1, 2]) {
        if (live.has(actor)) continue;
        const p = roster.placement(actor, ut)!; // O(variants + log windows) per dormant actor
        const at = positionOf(p);
        if (regions.regionAt(at.x, at.y) !== region) continue;
        // Optional side effects of the skipped time, bounded, then teleport to the exact current entry.
        const skipped = roster.catchUp(actor, dormantSince.get(actor)!, ut)!;
        live.set(actor, {...at, entry: p.entry.id, lastUt: skipped.final.time});
      }
    }
    for (let k = 0; k < out.deactivatedCount; k++)
      for (const [actor, a] of live)
        if (regions.regionAt(a.x, a.y) === out.deactivated[k]) {
          live.delete(actor);
          dormantSince.set(actor, ut);
        }
  };
  // Observer at the house at 05:00: only region 0 is active; the farmer (at home) spawns, the owl does not.
  regions.addObserver(0, 5, 5);
  wake(h(5));
  assert.deepEqual([...live.keys()], [1]);
  // The observer walks to the field at 06:30 and the house sleeps: the farmer is dormant mid-commute.
  regions.moveObserver(0, 25, 5);
  wake(h(6.5));
  assert.equal(live.has(1), false, 'farmer was in the sleeping house region, now dormant');
  // Time passes with no schedule work for dormant actors. At 08:00 the field region is active; the next update
  // re-checks dormant actors and the farmer appears ploughing the field, not where it was last seen.
  regions.moveObserver(0, 45, 5);
  wake(h(7.9));
  assert.deepEqual([...live.keys()], [2], 'only the owl is at the tavern');
  regions.moveObserver(0, 25, 5);
  wake(h(8));
  const farmerNow = live.get(1);
  assert.ok(farmerNow);
  assert.equal(farmerNow.entry, 'plough');
  assert.deepEqual({x: farmerNow.x, y: farmerNow.y}, anchors.field);
  const skipped = scheduleCatchUp(s, h(6.5), h(8));
  assert.deepEqual(
    skipped.transitions.map(t => t.entry.id),
    ['plough'],
  );
  regions.dispose();
  roster.dispose();
});
