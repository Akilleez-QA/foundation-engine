/**
 * The clock contract test, over the driver split of
 * ADR 0033: time is stepped through `driver`, never through the `clock` service. Plus the ADR 0033 additions.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClock, clockSection, gameSeconds} from './clock';
import {MemoryBackend} from './save/storage-port';
import {createSaveStore} from './save/store';

test('clock: pause owners, warp authority under a policy, events clamp a tick, catch-up is explicit', () => {
  let real = 1_000_000;
  const {clock: c, driver} = createClock({realNow: () => real, state: {ut: 0, lastRealMs: null}});
  c.setPolicy({maxRate: (_ut, mode) => (mode === 'rails' ? 100000 : 4)});
  assert.equal(c.requestWarp({owner: 'landing', rate: 10, mode: 'physics'}), 4);
  c.releaseWarp('landing');
  const fired: number[] = [];
  c.schedule(5, () => fired.push(c.ut));
  c.requestWarp({owner: 'map', rate: 100, mode: 'rails'});
  c.pause('dialog');
  assert.equal(driver.advance(0.1).to, 0);
  c.resume('dialog');
  const t = driver.advance(0.1);
  assert.equal(t.to, 10);
  assert.deepEqual(fired, [5]);
  assert.equal(driver.advance(10).to - 10, 0.25 * 100, 'a stalled frame is clamped to 0.25 s real');
  const got: number[] = [];
  c.onCatchUp(x => got.push(x.awayRealS));
  real += 3_600_000;
  driver.resumeFromAway('load');
  assert.deepEqual(got, [3600]);
  assert.equal(c.ut, 35, 'UT does not jump while away (KSP model)');
  c.warpTo(1000, {lead: 10});
  assert.ok(c.warp > 1);
  for (let i = 0; i < 200 && c.warp > 1; i++) driver.advance(0.1);
  assert.equal(c.warp, 100, 'warpTo releases its own request at the target; the map keeps its own');
});

test('the service cannot step time; only the driver can (ADR 0033)', () => {
  const {clock} = createClock({realNow: () => 0, state: {ut: 0, lastRealMs: null}});
  for (const k of ['advance', 'resumeFromAway', 'snapshot', 'restore'])
    assert.ok(!(k in clock), k + ' is not on GameClock');
  // @ts-expect-error advance is not part of GameClock
  assert.equal(clock.advance, undefined);
});

test('an event that changes warp ends the tick at the event; same-time events keep their order', () => {
  const {clock: c, driver} = createClock({realNow: () => 0, state: {ut: 0, lastRealMs: null}});
  c.requestWarp({owner: 'map', rate: 100, mode: 'rails'});
  const order: string[] = [];
  c.schedule(3, () => order.push('a'));
  c.schedule(3, () => order.push('b'));
  c.schedule(4, () => {
    order.push('stop');
    c.releaseWarp('map');
  });
  c.schedule(8, () => order.push('later'));
  const t = driver.advance(0.1);
  assert.deepEqual(order, ['a', 'b', 'stop']);
  assert.equal(t.to, 4);
  assert.equal(t.clampedBy, 4);
  assert.equal(c.warp, 1);
  const aborted = new AbortController();
  c.schedule(4.05, () => order.push('aborted'), aborted.signal);
  aborted.abort();
  driver.advance(0.1);
  assert.deepEqual(order, ['a', 'b', 'stop'], 'an aborted schedule never fires');
  assert.throws(() => c.requestWarp({owner: 'x', rate: 3, mode: 'rails'}), /not a step/);
});

test('catch-up is capped at 7 days; a new player starts at the real date; calendar and realUt read realNow', () => {
  let real = Date.UTC(2026, 8, 26, 20, 0, 0);
  const persisted: unknown[] = [];
  const {clock, driver} = createClock({realNow: () => real, persist: s => persisted.push(s)});
  assert.equal(clock.ut, gameSeconds(real), 'a new player starts at the real date (Unix seconds by default)');
  assert.equal(clock.calendar().toISOString(), '2026-09-26T20:00:00.000Z');
  assert.equal(gameSeconds(Date.UTC(1970, 0, 1, 0, 0, 5)), 5, 'the default timeline is Unix seconds');
  const caps: number[] = [];
  clock.onCatchUp(c => caps.push(c.cappedS));
  driver.advance(0.1);
  real += 30 * 24 * 3600 * 1000;
  driver.resumeFromAway('visible');
  assert.deepEqual(caps, [7 * 24 * 3600]);
  assert.equal(persisted.length, 1);
  assert.equal(clock.realUt(), gameSeconds(real), 'real time moved even though UT did not');
  assert.ok(clock.ut < clock.realUt());
});

test('restore loads another player and drops the previous timeline; core.clock round-trips through the store', () => {
  const {clock, driver} = createClock({realNow: () => 5, state: {ut: 100, lastRealMs: 1}});
  let fired = false;
  clock.schedule(150, () => {
    fired = true;
  });
  clock.requestWarp({owner: 'map', rate: 1000, mode: 'rails'});
  driver.restore({ut: 500, lastRealMs: null});
  assert.equal(clock.ut, 500);
  assert.equal(clock.warp, 1);
  driver.advance(0.1);
  assert.equal(fired, false);
  const b = new MemoryBackend();
  const store = createSaveStore({
    local: b.port(),
    session: new MemoryBackend().port(0, 'session'),
    build: 'game@test',
    timers: {set: () => 0, clear: () => {}, now: () => 0},
    sections: [clockSection],
  });
  store.section(clockSection).replace(driver.snapshot());
  store.flush();
  assert.deepEqual(JSON.parse(b.data.get('game|p:1|core.clock')!).data, {ut: 500.1, lastRealMs: 5});
  assert.throws(() => clockSection.parse({ut: 'soon', lastRealMs: null}));
});

test('a scheduled timeline restore stops the old advance without consuming new timeline events', () => {
  const {clock, driver} = createClock({realNow: () => 1234, state: {ut: 10, lastRealMs: null}});
  const restored = {ut: 500, lastRealMs: 900};
  const fired: string[] = [];
  clock.schedule(10.1, () => {
    driver.restore(restored);
    clock.schedule(500.1, () => fired.push('new'));
  });
  clock.schedule(10.15, () => fired.push('old'));
  assert.deepEqual(driver.advance(0.2), {from: 500, to: 500, realDt: 0, warp: 1});
  assert.deepEqual(driver.snapshot(), restored);
  assert.deepEqual(fired, []);
  driver.advance(0.2);
  assert.deepEqual(fired, ['new']);
  assert.equal(clock.ut, 500.2);
});

test('a policy callback restore cannot publish the old timeline warp or elapsed time', () => {
  const {clock, driver} = createClock({realNow: () => 1234, state: {ut: 10, lastRealMs: null}});
  let restore = false;
  clock.requestWarp({owner: 'old', rate: 100, mode: 'rails'});
  clock.setPolicy({
    maxRate() {
      if (restore) {
        restore = false;
        driver.restore({ut: 500, lastRealMs: 900});
      }
      return 100;
    },
  });
  restore = true;
  assert.deepEqual(driver.advance(0.2), {from: 500, to: 500, realDt: 0, warp: 1});
  assert.deepEqual(driver.snapshot(), {ut: 500, lastRealMs: 900});
  assert.equal(clock.warp, 1);
});

test('realNow observes advanced UT while a restore from that hook retains its new checkpoint', () => {
  let armed = false;
  const observed: number[] = [];
  const {clock, driver} = createClock({
    state: {ut: 10, lastRealMs: null},
    realNow: () => {
      if (armed) {
        observed.push(clock.ut);
        driver.restore({ut: 500, lastRealMs: 900});
      }
      return 1234;
    },
  });
  armed = true;
  assert.deepEqual(driver.advance(0.2), {from: 500, to: 500, realDt: 0, warp: 1});
  assert.deepEqual(observed, [10.2]);
  assert.deepEqual(driver.snapshot(), {ut: 500, lastRealMs: 900});
});
