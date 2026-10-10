import test from 'node:test';
import assert from 'node:assert/strict';
import {createLossyLink, type LossyLinkOptions} from './lossy-link';

const clean: Omit<LossyLinkOptions, 'seed'> = {loss: 0, duplicate: 0, reorder: 0, latency: [2, 2]};
/** Send 0..count-1 from a to b, one per time unit, then collect everything delivered by `until`. */
const drive = (o: LossyLinkOptions, count: number, until = count + 1000) => {
  const link = createLossyLink<number>(o);
  for (let t = 0; t < count; t++) link.send('a', 'b', t, t, 10);
  const got: {t: number; m: number}[] = [];
  for (let t = 0; t <= until; t++) for (const m of link.receive('b', t)) got.push({t, m});
  return {got, stats: link.read()};
};

test('LOSSY LINK refuses invalid options before any work', () => {
  const bad: unknown[] = [
    null,
    {...clean, seed: 1.5},
    {...clean, seed: 1, loss: -0.1},
    {...clean, seed: 1, duplicate: 2},
    {...clean, seed: 1, reorder: Number.NaN},
    {...clean, seed: 1, latency: [3, 2]},
    {...clean, seed: 1, latency: [0]},
    {...clean, seed: 1, latency: [-1, 2]},
    {...clean, seed: 1, bandwidth: 0},
    {...clean, seed: 1, maxInFlight: 0},
  ];
  for (const o of bad) assert.throws(() => createLossyLink(o as LossyLinkOptions), /lossy link: invalid options/);
  const link = createLossyLink({...clean, seed: 1});
  assert.throws(() => link.send('a', 'b', 1, Number.NaN), /invalid send/);
  assert.throws(() => link.send('a', 'b', 1, 0, -1), /invalid send/);
});

test('LOSSY LINK a clean link delivers every message once, in order, after exactly the latency', () => {
  const {got, stats} = drive({...clean, seed: 3}, 50);
  assert.deepEqual(
    got.map(g => g.m),
    Array.from({length: 50}, (_, i) => i),
  );
  assert.ok(got.every(g => g.t === g.m + 2));
  assert.equal(stats.delivered, 50);
  assert.equal(stats.inFlight, 0);
});

test('LOSSY LINK the same seed replays the same losses, duplicates, reorders and timings', () => {
  const o: LossyLinkOptions = {seed: 77, loss: 0.2, duplicate: 0.2, reorder: 0.3, latency: [1, 5]};
  assert.deepEqual(drive(o, 400), drive(o, 400));
  assert.notDeepEqual(drive(o, 400).got, drive({...o, seed: 78}, 400).got);
});

test('LOSSY LINK loss, duplication, reordering and jitter happen at about the configured rates', () => {
  const {got, stats} = drive({seed: 5, loss: 0.25, duplicate: 0.1, reorder: 0.2, latency: [1, 4]}, 4000);
  assert.ok(Math.abs(stats.lost / 4000 - 0.25) < 0.03, `lost ${stats.lost}`);
  assert.ok(stats.duplicated > 250 && stats.duplicated < 360, `duplicated ${stats.duplicated}`);
  assert.ok(stats.reordered > 600, `reordered ${stats.reordered}`);
  const seen = got.map(g => g.m);
  let inversions = 0;
  for (let i = 1; i < seen.length; i++) if (seen[i]! < seen[i - 1]!) inversions++;
  assert.ok(inversions > 100, 'messages arrive out of order');
  assert.ok(seen.length > new Set(seen).size, 'some messages arrive twice');
  // Latency stays within [min, max + max + 1] (reordering adds up to max + 1).
  for (const g of got) assert.ok(g.t - g.m >= 1 && g.t - g.m <= 9, `latency ${g.t - g.m}`);
});

test('LOSSY LINK the bandwidth cap and the in-flight bound drop sends over them', () => {
  const link = createLossyLink<string>({...clean, seed: 1, bandwidth: 100, maxInFlight: 5});
  assert.equal(link.send('a', 'b', 'x', 0, 60), 'sent');
  assert.equal(link.send('a', 'b', 'y', 0, 60), 'dropped', 'over 100 bytes in one time unit');
  assert.equal(link.send('a', 'c', 'z', 0, 60), 'sent', 'the cap is per directed link');
  assert.equal(link.send('a', 'b', 'w', 1, 60), 'sent', 'the cap resets each time unit');
  for (let t = 2; t < 6; t++) link.send('a', 'b', 'v', t, 1);
  const s = link.read();
  assert.equal(s.overBandwidth, 1);
  assert.equal(s.overflow, 2, 'at most 5 in flight');
  assert.equal(s.inFlight, 5);
});

test('LOSSY LINK cut drops everything in flight to and from an endpoint', () => {
  const link = createLossyLink<number>({...clean, seed: 1});
  link.send(1, 2, 1, 0);
  link.send(2, 3, 2, 0);
  link.send(3, 4, 3, 0);
  link.cut(2);
  assert.deepEqual(link.receive(2, 10), []);
  assert.deepEqual(link.receive(3, 10), []);
  assert.deepEqual(link.receive(4, 10), [3]);
});
