// Fault injection for the scene handover (ADR 0045 gates): a stale load, enter or ready, a player change
// mid-load and a failed first render each give no stale activation, no reward and no save write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandover, type HandoverDeps, type SceneEntry, type SceneRun, type SceneVisit } from './handover';
import type { SceneId } from './resolve';

const tick = () => new Promise(r => setTimeout(r, 0));
function gate<T = void>() { let open!: (v: T) => void, fail!: (e: unknown) => void; const p = new Promise<T>((res, rej) => { open = res; fail = rej; }); return { p, open, fail }; }

/** A world that records every effect: entries, activations, rewards/saves (written only by `arrive`) and leaves. */
function world(o: { render?: (visit: SceneVisit) => void | Promise<void> } = {}) {
  const log: string[] = [], saves: string[] = [], entered: string[] = [], failures: string[] = [];
  let player = '1', loading = 0;
  const deps: HandoverDeps = {
    player: () => player,
    firstRender: (_run, visit) => o.render?.(visit),
    loading: () => { loading++; },
    settled: () => { loading--; },
    entered: v => entered.push(`${v.scene}#${v.epoch}`),
    failed: (v, e) => failures.push(`${v.scene}:${(e as Error).message}`),
  };
  const scene = (id: string, x: { load?: () => unknown; enter?: (visit: SceneVisit) => Promise<void> | void; ready?: () => Promise<void> } = {}): SceneEntry => ({
    id: `scene.${id}` as SceneId, label: id,
    load: x.load ?? (() => Promise.resolve(id)),
    enter(_m, visit) {
      log.push('enter ' + id);
      const run: SceneRun = {
        activate: () => { log.push('activate ' + id); },
        arrive: () => { saves.push(`reward ${id} for player ${visit.player}`); },
        leave: reason => { log.push(`leave ${id} ${reason}`); },
        ...(x.ready ? { ready: x.ready() } : {}),
      };
      const pre = x.enter?.(visit);
      return pre ? pre.then(() => run) : run;
    },
  });
  return { deps, scene, log, saves, entered, failures, setPlayer: (p: string) => { player = p; }, loading: () => loading };
}

test('a stale load never enters; A→B→C with B completing last activates only C, once', async () => {
  const w = world(), h = createHandover(w.deps);
  const a = gate<string>(), b = gate<string>();
  const A = w.scene('a', { load: () => a.p }), B = w.scene('b', { load: () => b.p }), C = w.scene('c');
  const ra = h.go(A), rb = h.go(B), rc = h.go(C);
  assert.equal(await rc, 'activated');
  a.open('a'); b.open('b');
  assert.deepEqual([await ra, await rb], ['superseded', 'superseded']);
  assert.deepEqual(w.log, ['enter c', 'activate c']);
  assert.deepEqual(w.saves, ['reward c for player 1']);
  assert.deepEqual(w.entered, ['scene.c#3']);
  assert.equal(h.current()?.scene, 'scene.c');
  assert.equal(w.loading(), 0, 'every loading card settled');
});

test('a stale enter: the late run is left at once, never activated, no reward', async () => {
  const w = world(), h = createHandover(w.deps);
  const slow = gate();
  const A = w.scene('a', { enter: () => slow.p }), B = w.scene('b');
  const ra = h.go(A);
  await tick();
  assert.deepEqual(w.log, ['enter a']);
  assert.equal(await h.go(B), 'activated');
  slow.open();
  assert.equal(await ra, 'superseded');
  assert.deepEqual(w.log, ['enter a', 'enter b', 'activate b', 'leave a superseded']);
  assert.deepEqual(w.saves, ['reward b for player 1']);
});

test('a stale ready: the prepared run is left when superseded, and its late ready changes nothing', async () => {
  const w = world(), h = createHandover(w.deps);
  const ready = gate();
  const A = w.scene('a', { ready: () => ready.p }), B = w.scene('b');
  const ra = h.go(A);
  await tick();
  assert.equal(h.loading(), true);
  const rb = h.go(B);
  assert.deepEqual(w.log.slice(0, 2), ['enter a', 'leave a superseded'], 'superseding leaves the pending run immediately');
  ready.open();
  assert.deepEqual([await ra, await rb], ['superseded', 'activated']);
  assert.deepEqual(w.log, ['enter a', 'leave a superseded', 'enter b', 'activate b']);
  assert.deepEqual(w.saves, ['reward b for player 1']);
  assert.deepEqual(w.entered, ['scene.b#2']);
});

test('a player change mid-load: the old player\'s request never enters, writes nothing; the new player\'s visit does', async () => {
  const w = world(), h = createHandover(w.deps);
  const load = gate<string>();
  const A = w.scene('a', { load: () => load.p });
  const ra = h.go(A);
  w.setPlayer('2');
  load.open('a');
  assert.equal(await ra, 'superseded');
  assert.deepEqual(w.log, []);
  assert.deepEqual(w.saves, []);
  // The re-entry for the new player (today's synthetic hashchange) enters and rewards player 2 only.
  assert.equal(await h.go(A), 'activated');
  assert.deepEqual(w.saves, ['reward a for player 2']);
});

test('a player change during ready or the first render leaves the run with player-changed and writes nothing', async () => {
  const ready = gate(), render = gate();
  const w = world({ render: () => render.p }), h = createHandover(w.deps);
  const r1 = h.go(w.scene('a', { ready: () => ready.p }));
  await tick(); w.setPlayer('2'); ready.open();
  assert.equal(await r1, 'superseded');
  w.setPlayer('1');
  const r2 = h.go(w.scene('b'));
  await tick(); w.setPlayer('3'); render.open();
  assert.equal(await r2, 'superseded');
  assert.deepEqual(w.log, ['enter a', 'leave a player-changed', 'enter b', 'leave b player-changed']);
  assert.deepEqual([w.saves, w.entered], [[], []]);
});

test('a failed first render: no activation, reward or entered event; the run is left and the failure reported once', async () => {
  const w = world({ render: v => { if (v.scene === 'scene.broken') throw Error('shader link failed'); } }), h = createHandover(w.deps);
  assert.equal(await h.go(w.scene('broken')), 'failed');
  assert.deepEqual(w.log, ['enter broken', 'leave broken failed']);
  assert.deepEqual([w.saves, w.entered, w.failures], [[], [], ['scene.broken:shader link failed']]);
  assert.equal(h.current(), null);
  assert.equal(h.loading(), false);
});

test('an asynchronous render failure after a newer request is obsolete: ignored, never reported over the new scene', async () => {
  const render = gate();
  const w = world({ render: v => v.scene === 'scene.a' ? render.p : undefined }), h = createHandover(w.deps);
  const ra = h.go(w.scene('a'));
  await tick();
  assert.equal(await h.go(w.scene('b')), 'activated');
  render.fail(Error('late'));
  assert.equal(await ra, 'superseded');
  assert.deepEqual(w.failures, []);
  assert.deepEqual(w.saves, ['reward b for player 1']);
});

test('a throwing enter, a rejected ready and a failed load each fail only the current request, and retry works', async () => {
  const w = world(), h = createHandover(w.deps);
  let attempts = 0;
  const flaky = w.scene('flaky', { load: () => ++attempts === 1 ? Promise.reject(Error('offline')) : Promise.resolve('m') });
  assert.equal(await h.go(flaky), 'failed');
  assert.equal(await h.go(flaky), 'activated', 'a failed fetch is retried by the next navigation');
  const throwing: SceneEntry = { id: 'scene.t', label: 't', load: () => 1, enter: () => { throw Error('boom'); } };
  assert.equal(await h.go(throwing), 'failed');
  assert.equal(await h.go(w.scene('r', { ready: () => Promise.reject(Error('asset')) })), 'failed');
  assert.deepEqual(w.failures, ['scene.flaky:offline', 'scene.t:boom', 'scene.r:asset']);
  assert.deepEqual(w.saves, ['reward flaky for player 1']);
});

test('activate may navigate: the first run is left and never drains its rewards', async () => {
  const w = world(), h = createHandover(w.deps);
  const B = w.scene('b');
  const A: SceneEntry = { id: 'scene.a', label: 'a', load: () => 1, enter: () => ({
    activate: () => { void h.go(B); },
    arrive: () => { w.saves.push('reward a'); },
    leave: r => { w.log.push('leave a ' + r); },
  }) };
  assert.equal(await h.go(A), 'superseded');
  await tick();
  assert.deepEqual(w.saves, ['reward b for player 1']);
  assert.ok(w.log.includes('leave a superseded'));
});

test('a synchronous load enters in the same call (a hub scene); the departing run leaves before the next enters', () => {
  const w = world(), h = createHandover(w.deps);
  const hub = w.scene('hub', { load: () => 'm' });
  void h.go(hub);
  assert.deepEqual(w.log, ['enter hub', 'activate hub']);
  void h.go(hub);
  assert.deepEqual(w.log.slice(2), ['leave hub route', 'enter hub', 'activate hub']);
  h.leave();
  assert.deepEqual(w.log.slice(5), ['leave hub route']);
});

test('the module is fetched once; preload fetches without entering; five failure/retry cycles leak nothing', async () => {
  let loads = 0, fail = true;
  const w = world({ render: () => { if (fail) throw Error('lost'); } }), h = createHandover(w.deps);
  const A = w.scene('a', { load: () => { loads++; return Promise.resolve('m'); } });
  h.preload(A);
  await tick();
  assert.deepEqual(w.log, []);
  for (let i = 0; i < 5; i++) assert.equal(await h.go(A), 'failed');
  fail = false;
  assert.equal(await h.go(A), 'activated');
  assert.equal(loads, 1);
  const log: readonly string[] = w.log as string[];
  const enters = log.filter(l => l.startsWith('enter')).length, leaves = log.filter(l => l.startsWith('leave')).length;
  assert.equal(enters - leaves, 1, 'every failed run was left; only the activated one is live');
  assert.deepEqual(w.saves, ['reward a for player 1']);
});
