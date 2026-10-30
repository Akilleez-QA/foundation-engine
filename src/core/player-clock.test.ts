import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerClock, CLOCK_RECORD_EVERY_S} from './player-clock';
import {clockSection} from './clock-section';
import {gameSeconds} from './clock';
import {MemoryBackend} from './save/storage-port';
import {createSaveStore, playersSection} from './save/store';

const quiet = {set: () => 0, clear: () => {}, now: () => 0};
const open = (disk: MemoryBackend) =>
  createSaveStore({
    local: disk.port(),
    session: new MemoryBackend().port(0, 'session'),
    build: 'game@test',
    timers: quiet,
    sections: [clockSection],
  });
const KEY = (p: string) => 'game|p:' + p + '|core.clock';
const TODAY = Date.UTC(2026, 8, 26, 18, 0, 0);

test("a new player starts at today's date, and nothing is written until their clock runs", () => {
  const disk = new MemoryBackend(),
    store = open(disk),
    pc = createPlayerClock(store, {realNow: () => TODAY});
  assert.equal(pc.clock.ut, gameSeconds(TODAY));
  assert.ok(Math.abs(pc.clock.ut / (365.25 * 86400) - 56.73) < 0.01, 'about 56.7 years after the Unix epoch');
  store.flush();
  assert.equal(disk.data.get(KEY('1')), undefined, 'an existing save gains no key just by loading');
  pc.dispose();
  store.dispose();
});

test('UT persists per player, across a reload and a player switch', () => {
  let real = TODAY;
  const disk = new MemoryBackend(),
    store = open(disk);
  store.section(playersSection).update(r => ({...r, players: [{id: '1'}, {id: '2'}]}));
  const pc = createPlayerClock(store, {realNow: () => real});
  const start = pc.clock.ut;
  pc.clock.requestWarp({owner: 'test', rate: 1000, mode: 'rails'});
  for (let i = 0; i < 60; i++) {
    pc.driver.advance(0.25);
    real += 250;
  } // 15 s real at ×1000
  assert.equal(pc.clock.ut - start, 15_000);
  assert.ok(disk.data.get(KEY('1')) === undefined, 'recorded, not yet written: the section flushes at flush points');
  store.flush();
  const onDisk = JSON.parse(disk.data.get(KEY('1'))!).data.ut;
  assert.ok(
    onDisk - start >= CLOCK_RECORD_EVERY_S * 1000 && onDisk - start <= 15_000,
    'recorded after 10 s of running time',
  );

  // Switch: player 1's time is recorded; player 2 has none, so starts at the real date.
  real += 60_000;
  store.setActivePlayer('2');
  assert.equal(pc.clock.ut, gameSeconds(real), "a new player starts at today's date");
  assert.equal(pc.clock.warp, 1, "the previous timeline's warp ended");
  pc.driver.advance(0.2);
  store.flush();
  assert.equal(JSON.parse(disk.data.get(KEY('1'))!).data.ut, start + 15_000, 'player 1 written exactly at the switch');
  pc.record();
  store.flush();
  const p2 = JSON.parse(disk.data.get(KEY('2'))!).data.ut;
  assert.ok(Math.abs(p2 - (gameSeconds(real) + 0.2)) < 1e-6);

  // Back to player 1: their own time, not player 2's and not the real date.
  store.setActivePlayer('1');
  assert.equal(pc.clock.ut, start + 15_000);
  pc.dispose();
  store.dispose();

  // A reload: the clock continues where each player left it; UT did not run while the app was closed.
  real += 86_400_000;
  const again = open(disk),
    pc2 = createPlayerClock(again, {realNow: () => real});
  assert.equal(again.activePlayer(), '1');
  assert.equal(pc2.clock.ut, start + 15_000, 'player 1 after a reload a day later');
  again.setActivePlayer('2');
  assert.ok(Math.abs(pc2.clock.ut - p2) < 1e-6, 'player 2 after a reload');
  pc2.dispose();
  again.dispose();
});

test('the clock section: null is a player whose time never started; bad data is rejected', () => {
  assert.equal(clockSection.initial(), null);
  assert.equal(clockSection.parse(null), null);
  assert.deepEqual(clockSection.parse({ut: 1.5e9, lastRealMs: 5}), {ut: 1.5e9, lastRealMs: 5});
  assert.throws(() => clockSection.parse({ut: 'soon', lastRealMs: null}));
  assert.throws(() => clockSection.parse({ut: 1, lastRealMs: 'x'}));
});

test('a scheduled player switch preserves the new saved timeline and records only the old event time', () => {
  const disk = new MemoryBackend(),
    store = open(disk);
  const second = store.addPlayer();
  store.section(clockSection).of('1').replace({ut: 10, lastRealMs: 100});
  store.section(clockSection).of(second).replace({ut: 500, lastRealMs: 900});
  const pc = createPlayerClock(store, {realNow: () => 1234, recordEveryS: 0.01});
  try {
    pc.clock.schedule(10.1, () => store.setActivePlayer(second));
    assert.deepEqual(pc.driver.advance(0.2), {from: 500, to: 500, realDt: 0, warp: 1});
    assert.equal(store.activePlayer(), second);
    assert.deepEqual(pc.driver.snapshot(), {ut: 500, lastRealMs: 900});
    assert.equal(store.section(clockSection).of('1').get()!.ut, 10.1);
    assert.deepEqual(store.section(clockSection).of(second).get(), {ut: 500, lastRealMs: 900});
  } finally {
    pc.dispose();
    store.dispose();
  }
});
