/**
 * Save store tests (ADR 0007, STANDARD chapter 8): legacy import, debounced autosave, migrations with backups,
 * quarantine, unavailable storage, newer data, multi-tab merges, drift from old tabs, export/import/reset round trips,
 * players, size budget, live bindings, batch, usage and registry validation. The example sections are in
 * ./test-sections.ts.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MemoryBackend} from './storage-port';
import {createSaveStore, playersSection, savePrefixes, type Timers} from './store';
import type {SaveSection} from './section';
import {sectionProblems} from './validate';
import {importJson} from './bindings';
import * as S from './test-sections';
import {must} from '../../testing/must';

const PREFIXES = savePrefixes();

/** Manual clock and timers: the debounce is deterministic. */
function fakeTimers() {
  let now = 0,
    id = 0;
  const q = new Map<number, {at: number; fn: () => void}>();
  const t: Timers & {advance(ms: number): void} = {
    now: () => now,
    set: (fn, ms) => {
      q.set(++id, {at: now + ms, fn});
      return id;
    },
    clear: h => {
      q.delete(h as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        q.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
  return t;
}
function setup(backend = new MemoryBackend(), tab = 0) {
  const timers = fakeTimers();
  const store = createSaveStore({
    local: backend.port(tab),
    session: new MemoryBackend().port(tab, 'session'),
    build: 'game@test',
    timers,
    legacyFiles: [S.legacyProfileFile],
    sections: S.allSections,
  });
  return {backend, timers, store};
}

// ---------------------------------------------------------------- data a game wrote before it adopted the store
function seedLegacy(b: MemoryBackend) {
  const look: S.Look = {theme: 'dark', playerName: 'Ada', color: '#ff8844'};
  const live: S.LiveRecord = {version: 4, progress: [2, 1, 0, 0, 0, 0]};
  const entries: [string, string][] = [
    ['game-live-1', JSON.stringify(live)],
    ['game-journal-1', JSON.stringify({version: 1, entries: {tutorial: {completed: true}, climb: {assisted: true}}})],
    ['game-look-1', JSON.stringify(look)],
    ['game-voice-1', 'brave'],
    ['game-wallet-1', JSON.stringify({balance: 12, owned: ['hat'], awards: ['a1']})],
    ['game-records-1', JSON.stringify({v: 1, slots: {first: {at: 5, from: 'hall'}}, unlocked: true})],
    ['game-stories-1', JSON.stringify([{id: 'm1', name: 'Ada', date: '9/1/2026'}])],
    ['game-best-1', '83.25'],
    ['game-audio', JSON.stringify({muted: false, music: 0.5})],
    ['game-comfort', JSON.stringify({still: true})],
  ];
  for (const [k, v] of entries) b.data.set(k, v);
  return {look, live, entries};
}

test('legacy data loads through its bindings; legacy keys are never modified', () => {
  const b = new MemoryBackend();
  const {look, live, entries} = seedLegacy(b);
  const {store} = setup(b);
  assert.equal(store.activePlayer(), '1');
  assert.deepEqual(store.players(), ['1']);
  const h = <T>(d: SaveSection<T>) => store.section(d).get();
  assert.deepEqual(h(S.look), look);
  assert.equal(h(S.voice), 'brave');
  assert.equal(h(S.journal).entries.climb?.assisted, true);
  assert.equal(h(S.wallet).balance, 12);
  assert.equal(h(S.records).unlocked, true);
  assert.equal(h(S.stories)[0]?.id, 'm1');
  assert.equal(h(S.best), 83.25);
  assert.deepEqual(h(S.liveRecord), live);
  assert.deepEqual(h(S.settings), {'sound.muted': false, 'sound.music': 0.5, 'comfort.calm': true});
  store.flush();
  for (const [k, v] of entries) assert.equal(b.data.get(k), v, k + ' must be untouched');
  assert.ok(b.data.has('game|p:1|demo.look'));
  assert.ok(!b.data.has('game|p:1|demo.live'), 'demo.live is a live binding: it stays on game-live-1');
});

test('debounced autosave: many updates, one write; unchanged values never write; max wait holds', () => {
  const {backend, timers, store} = setup();
  const w = store.section(S.wallet);
  const before = backend.writes;
  for (let i = 0; i < 50; i++) {
    w.update(d => {
      d.balance++;
    });
    timers.advance(100);
  } // 5 s of continuous changes
  const during = backend.writes - before;
  assert.ok(during >= 1 && during <= 2, 'max-wait forces a write during a long burst, got ' + during);
  timers.advance(1000);
  const after = backend.writes;
  assert.equal(w.get().balance, 50);
  assert.equal(JSON.parse(backend.data.get('game|p:1|demo.wallet')!).data.balance, 50);
  w.update(d => {
    d.balance = 50;
  });
  timers.advance(2000);
  assert.equal(backend.writes, after, 'identical bytes are not rewritten');
});

test('migration chain v1 → v3 runs once, keeps a pre-migration backup, and rejects gaps', () => {
  const b = new MemoryBackend();
  b.data.set('game|p:1|demo.garden', JSON.stringify({v: 1, by: 'game@old', data: {flowers: 3}}));
  const v3: SaveSection<{blooms: number; beds: string[]}> = {
    id: 'demo.garden',
    scope: 'player',
    version: 3,
    initial: () => ({blooms: 0, beds: []}),
    parse: r => {
      const o = r as {blooms: number; beds: string[]};
      if (!Number.isInteger(o?.blooms) || !Array.isArray(o.beds)) throw Error('bad garden');
      return {blooms: o.blooms, beds: [...o.beds]};
    },
    migrations: {
      1: (o: {flowers: number}) => ({blooms: o.flowers}),
      2: (o: {blooms: number}) => ({...o, beds: ['front']}),
    },
  };
  const {store} = setup(b);
  assert.deepEqual(store.section(v3).get(), {blooms: 3, beds: ['front']});
  store.flush();
  assert.equal(JSON.parse(b.data.get('game|p:1|demo.garden')!).v, 3);
  assert.equal(JSON.parse(b.data.get('game-bak|game|p:1|demo.garden|v1')!).data.flowers, 3);
  // a missing step is unreadable data, not a crash: it is quarantined
  const gap = {...v3, id: 'demo.gap', migrations: {2: must(v3.migrations![2], 'migration 2')}};
  b.data.set('game|p:1|demo.gap', JSON.stringify({v: 1, by: 'x', data: {flowers: 1}}));
  assert.deepEqual(store.section(gap).get(), {blooms: 0, beds: []});
  assert.equal(store.section(gap).status(), 'quarantined');
});

test('quarantine: unreadable bytes are copied aside before anything overwrites them, and never lost', () => {
  const b = new MemoryBackend();
  b.data.set('game|p:1|demo.look', '{"v":1,"data":{"theme":"not-a-theme"}}');
  const {store, timers} = setup(b);
  const d = store.section(S.look);
  assert.deepEqual(d.get(), S.look.initial());
  assert.equal(d.status(), 'quarantined');
  assert.equal(b.data.get('game-q|game|p:1|demo.look'), '{"v":1,"data":{"theme":"not-a-theme"}}');
  d.update(x => {
    x.playerName = 'New';
  });
  timers.advance(1500);
  assert.equal(d.status(), 'saved');
  assert.equal(
    b.data.get('game-q|game|p:1|demo.look'),
    '{"v":1,"data":{"theme":"not-a-theme"}}',
    'quarantine copy survives the new write',
  );
  assert.ok(store.quarantine().some(q => q.key === 'game-q|game|p:1|demo.look'));
});

test('quarantine copy fails (quota): the original is never overwritten; the tab keeps playing', () => {
  const b = new MemoryBackend();
  const bad = '{"v":1,"data":{"broken":true}}';
  b.data.set('game|p:1|demo.look', bad);
  b.failSet = k => k.startsWith('game-q|');
  const {store, timers} = setup(b);
  const d = store.section(S.look);
  d.update(x => {
    x.playerName = 'Kept in tab';
  });
  timers.advance(6000);
  assert.equal(b.data.get('game|p:1|demo.look'), bad);
  assert.equal(d.get().playerName, 'Kept in tab');
  b.failSet = () => false;
  timers.advance(6000); // storage recovers: copy first, then write
  assert.equal(b.data.get('game-q|game|p:1|demo.look'), bad);
  assert.equal(JSON.parse(b.data.get('game|p:1|demo.look')!).data.playerName, 'Kept in tab');
});

test('a transient read failure is never treated as "empty"', () => {
  const b = new MemoryBackend();
  seedLegacy(b);
  b.data.set('game|p:1|demo.wallet', JSON.stringify({v: 1, by: 'x', data: {balance: 99, owned: [], awards: []}}));
  b.failGet = k => k.startsWith('game|p:1|demo.wallet');
  const {store, timers} = setup(b);
  const w = store.section(S.wallet);
  assert.equal(w.status(), 'unavailable');
  w.update(x => {
    x.balance += 1;
    x.awards = ['new'];
  });
  timers.advance(6000);
  assert.equal(JSON.parse(b.data.get('game|p:1|demo.wallet')!).data.balance, 99, 'unseen data not overwritten');
  b.failGet = () => false;
  timers.advance(6000);
  const saved = JSON.parse(b.data.get('game|p:1|demo.wallet')!).data;
  assert.ok(saved.balance >= 99 && saved.awards.includes('new'), 'merged with what was on disk');
});

test('newer build data is read-only and never overwritten', () => {
  const b = new MemoryBackend();
  const future = JSON.stringify({v: 9, by: 'game@9', data: {whatever: 1}});
  b.data.set('game|p:1|demo.look', future);
  const {store, timers} = setup(b);
  const d = store.section(S.look);
  assert.equal(d.status(), 'newer');
  d.update(x => {
    x.playerName = 'x';
  });
  timers.advance(6000);
  assert.equal(b.data.get('game|p:1|demo.look'), future);
  const file = store.exportPlayer('1');
  assert.deepEqual(file.orphans?.['demo.look'], JSON.parse(future), 'export carries it verbatim');
});

test('multi-tab: progress merges, best time keeps the minimum', () => {
  const backend = new MemoryBackend();
  const A = setup(backend, 1),
    B = setup(backend, 2);
  A.store.section(S.records).update(p => {
    p.slots['first'] = {at: 1, from: 'hall'};
  });
  B.store.section(S.records).update(p => {
    p.slots['second'] = {at: 2, from: 'hall'};
    p.unlocked = true;
  });
  A.store.section(S.best).replace(90);
  B.store.section(S.best).replace(80);
  A.timers.advance(1500);
  B.timers.advance(1500);
  const stored = JSON.parse(backend.data.get('game|p:1|demo.records')!).data;
  assert.deepEqual(Object.keys(stored.slots).sort(), ['first', 'second']);
  assert.equal(stored.unlocked, true);
  assert.equal(JSON.parse(backend.data.get('game|p:1|demo.best')!).data, 80);
  // A (clean) follows B's write through the storage event
  assert.equal(A.store.section(S.best).get(), 80);
});

test('an old-build tab keeps writing the legacy key after the import: the change is folded in (drift)', () => {
  const b = new MemoryBackend();
  seedLegacy(b);
  const {store} = setup(b);
  store.section(S.stories).get();
  store.flush();
  const oldTab = b.port(9);
  oldTab.set(
    'game-stories-1',
    JSON.stringify([
      {id: 'm1', name: 'Ada', date: '9/1/2026'},
      {id: 'm2', name: 'Old tab', date: '9/2/2026'},
    ]),
  );
  assert.deepEqual(
    store
      .section(S.stories)
      .get()
      .map(r => r.id),
    ['m1', 'm2'],
  );
});

test('export is generated from the sections and round-trips through reset', () => {
  const b = new MemoryBackend();
  seedLegacy(b);
  const {store} = setup(b);
  const file = store.exportPlayer('1');
  for (const id of ['demo.look', 'demo.wallet', 'demo.records', 'demo.live', 'demo.journal'])
    assert.ok(id in file.sections, id);
  assert.ok(!('demo.settings' in file.sections), 'device sections are never exported');
  const text = JSON.stringify(file);
  const reset = store.resetAll();
  assert.ok(reset.removed > 0);
  assert.equal(
    [...b.data.keys()].filter(k => PREFIXES.reset.some(p => k.startsWith(p))).length,
    0,
    'reset clears every key under the prefixes',
  );
  const fresh = setup(b).store;
  const report = fresh.importPlayer(text, '1');
  assert.equal(report.format, 'engine-profile@2');
  const again = fresh.exportPlayer('1');
  assert.deepEqual(again.sections, file.sections);
  const third = setup(new MemoryBackend()).store;
  third.importPlayer(JSON.stringify(again), '1');
  assert.deepEqual(third.exportPlayer('1').sections, again.sections);
});

test('legacy export files import through their adapter; unknown sections are kept', () => {
  const text = JSON.stringify({
    format: 'game-legacy-file',
    version: 1,
    voice: 'dramatic',
    journal: {version: 1, entries: {tutorial: {assisted: true}}},
    best: 70,
    extra: {kept: true},
  });
  const {store, backend} = setup();
  const report = store.importPlayer(text);
  assert.equal(report.format, 'legacy');
  assert.equal(store.section(S.voice).get(), 'dramatic');
  assert.equal(store.section(S.journal).get().entries.tutorial?.assisted, true);
  assert.equal(store.section(S.best).get(), 70);
  assert.equal(
    report.sections['demo.unknown-extra'],
    'orphan-kept',
    'a section this build has not registered is stored, not dropped',
  );
  assert.ok(backend.data.has('game|p:1|demo.unknown-extra'));
  assert.throws(
    () =>
      store.importPlayer(
        JSON.stringify({format: 'game-legacy-file', version: 1, voice: 'shouty', journal: {version: 1, entries: {}}}),
      ),
    /voice/i,
  );
  assert.throws(() => store.importPlayer(JSON.stringify({format: 'something-else'})), /not a save file/);
});

test('orphan import reports exact retention and preserves conflicting bytes', () => {
  const {store, backend} = setup();
  const id = 'demo.unknown',
    key = 'game|p:1|' + id;
  const entry = {v: 1, data: {value: 7}},
    raw = JSON.stringify(entry);
  const file = (orphans: boolean) =>
    JSON.stringify({
      format: 'engine-profile',
      version: 2,
      sections: orphans ? {} : {[id]: entry},
      ...(orphans ? {orphans: {[id]: entry}} : {}),
    });
  try {
    for (const orphans of [false, true]) {
      backend.data.delete(key);
      assert.equal(store.importPlayer(file(orphans)).sections[id], 'orphan-kept');
      assert.equal(backend.data.get(key), raw);
      const writes = backend.writes;
      assert.equal(store.importPlayer(file(orphans)).sections[id], 'orphan-kept');
      assert.equal(backend.writes, writes, 'identical bytes require no write');
      // Even equivalent JSON with different bytes requires explicit reconciliation.
      for (const existing of [JSON.stringify(entry, null, 2), '{"v":2,"data":"other"}', 'corrupt']) {
        backend.data.set(key, existing);
        assert.equal(store.importPlayer(file(orphans)).sections[id], 'orphan-conflict');
        assert.equal(backend.data.get(key), existing);
        assert.equal(backend.writes, writes, 'conflicts must not overwrite');
      }
    }
  } finally {
    store.dispose();
  }
});

test('orphan import reports read/write failures and can retry the retained source file', () => {
  const {store, backend} = setup();
  const id = 'demo.unknown',
    key = 'game|p:1|' + id;
  const entry = {v: 1, data: 7};
  const file = JSON.stringify({format: 'engine-profile', version: 2, sections: {}, orphans: {[id]: entry}});
  try {
    backend.data.set(key, 'existing');
    backend.failGet = k => k === key;
    const writes = backend.writes;
    assert.equal(store.importPlayer(file).sections[id], 'orphan-failed');
    assert.equal(backend.data.get(key), 'existing');
    assert.equal(backend.writes, writes, 'an unreadable destination must not be written');
    backend.failGet = () => false;
    backend.data.delete(key);
    backend.failSet = k => k === key;
    assert.equal(store.importPlayer(file).sections[id], 'orphan-failed');
    assert.equal(backend.data.has(key), false);
    backend.failSet = () => false;
    assert.equal(store.importPlayer(file).sections[id], 'orphan-kept');
    assert.equal(backend.data.get(key), JSON.stringify(entry));
  } finally {
    store.dispose();
  }
});

test('known section/orphan overlap under the canonical id rejects before mutation, including aliases and newer versions', () => {
  const {store, backend} = setup();
  const aliased: SaveSection<number> = {
    id: 'demo.aliased',
    aliases: ['demo.old'],
    scope: 'player',
    version: 1,
    initial: () => 0,
    parse: raw => Number(raw),
  };
  const handle = store.section(aliased);
  try {
    // The orphan claims the section's own id: one report slot cannot hold both outcomes.
    for (const incomingId of ['demo.aliased', 'demo.old']) {
      for (const v of [1, 2]) {
        const before = [...backend.data],
          writes = backend.writes;
        const file = JSON.stringify({
          format: 'engine-profile',
          version: 2,
          sections: {
            'demo.voice': {v: 1, data: 'brave'},
            [incomingId]: {v, data: 7},
          },
          orphans: {'demo.aliased': {v: 3, data: 8}},
        });
        assert.throws(() => store.importPlayer(file), /also supplied as an orphan: demo\.aliased/);
        assert.equal(store.section(S.voice).get(), 'calm', 'earlier valid section was not published');
        assert.equal(handle.get(), 0);
        assert.deepEqual([...backend.data], before);
        assert.equal(backend.writes, writes);
      }
    }
  } finally {
    store.dispose();
  }
});

const renamed: SaveSection<number> = {
  id: 'demo.aliased',
  aliases: ['demo.old'],
  scope: 'player',
  version: 1,
  initial: () => 0,
  parse: raw => Number(raw),
};
function setupRenamed(backend = new MemoryBackend()) {
  const store = createSaveStore({
    local: backend.port(0),
    session: new MemoryBackend().port(0, 'session'),
    build: 'game@test',
    timers: fakeTimers(),
    legacyFiles: [S.legacyProfileFile],
    sections: [...S.allSections, renamed],
  });
  return {backend, store};
}

test('a renamed section round-trips: rename, export, import into a fresh store', () => {
  const a = setupRenamed();
  a.backend.data.set('game|p:1|demo.old', JSON.stringify({v: 1, data: 5})); // written under the old id
  let file;
  try {
    assert.equal(a.store.section(renamed).get(), 5, 'the alias key loads');
    a.store.flush('test');
    assert.equal(JSON.parse(a.backend.data.get('game|p:1|demo.aliased')!).data, 5, 'migrated to the canonical key');
    assert.ok(a.backend.data.has('game|p:1|demo.old'), 'the pre-rename key is kept for rollback');
    file = a.store.exportPlayer();
    assert.deepEqual(file.sections['demo.aliased'], {v: 1, data: 5});
    assert.equal(file.orphans?.['demo.old'], undefined, 'the stale alias key is not exported as an orphan');
    // The same file re-imports into the store that wrote it.
    assert.equal(a.store.importPlayer(JSON.stringify(file)).sections['demo.aliased'], 'saved');
  } finally {
    a.store.dispose();
  }
  const b = setupRenamed();
  try {
    const report = b.store.importPlayer(JSON.stringify(file));
    assert.equal(report.sections['demo.aliased'], 'saved');
    assert.equal(b.store.section(renamed).get(), 5);
    assert.equal(b.backend.data.has('game|p:1|demo.old'), false);
  } finally {
    b.store.dispose();
  }
});

test('a newer payload found only under an alias key exports under the canonical id', () => {
  const a = setupRenamed();
  const future = {v: 2, data: 'future'};
  a.backend.data.set('game|p:1|demo.old', JSON.stringify(future));
  try {
    assert.equal(a.store.section(renamed).get(), 0);
    const file = a.store.exportPlayer();
    assert.equal(file.sections['demo.aliased'], undefined);
    assert.deepEqual(file.orphans?.['demo.aliased'], future);
    assert.equal(file.orphans?.['demo.old'], undefined);
  } finally {
    a.store.dispose();
  }
});

test('an alias orphan beside its renamed section is superseded, not a conflict', () => {
  const {store, backend} = setupRenamed();
  const oldKey = 'game|p:1|demo.old';
  try {
    for (const [incomingId, v] of [
      ['demo.aliased', 1],
      ['demo.old', 1],
      ['demo.aliased', 2],
    ] as const) {
      backend.data.set(oldKey, 'local pre-rename bytes');
      const report = store.importPlayer(
        JSON.stringify({
          format: 'engine-profile',
          version: 2,
          sections: {[incomingId]: {v, data: 9}},
          orphans: {'demo.old': {v: 1, data: 4}},
        }),
      );
      assert.equal(report.sections['demo.old'], 'orphan-superseded');
      assert.equal(report.sections['demo.aliased'], v === 1 ? 'saved' : 'skipped-newer');
      assert.equal(backend.data.get(oldKey), 'local pre-rename bytes', 'a superseded orphan is never written');
      if (v === 1) assert.equal(store.section(renamed).get(), 9);
    }
    // Without the section in the file, the alias payload is an ordinary orphan again.
    backend.data.delete(oldKey);
    const report = store.importPlayer(
      JSON.stringify({format: 'engine-profile', version: 2, sections: {}, orphans: {'demo.old': {v: 1, data: 4}}}),
    );
    assert.equal(report.sections['demo.old'], 'orphan-kept');
    assert.equal(backend.data.get(oldKey), JSON.stringify({v: 1, data: 4}));
  } finally {
    store.dispose();
  }
});

test('a genuine unknown orphan conflict still fails beside a renamed section, leaves bytes intact and retries', () => {
  const {store, backend} = setupRenamed();
  const key = 'game|p:1|demo.unknown',
    entry = {v: 1, data: 'incoming'};
  const file = JSON.stringify({
    format: 'engine-profile',
    version: 2,
    sections: {'demo.aliased': {v: 1, data: 3}},
    orphans: {'demo.old': {v: 1, data: 1}, 'demo.unknown': entry},
  });
  try {
    backend.data.set(key, 'different local bytes');
    let report = store.importPlayer(file);
    assert.equal(report.sections['demo.unknown'], 'orphan-conflict');
    assert.equal(report.sections['demo.old'], 'orphan-superseded');
    assert.equal(backend.data.get(key), 'different local bytes');
    backend.data.delete(key);
    backend.failSet = k => k === key;
    assert.equal(store.importPlayer(file).sections['demo.unknown'], 'orphan-failed');
    assert.equal(backend.data.has(key), false);
    backend.failSet = () => false;
    report = store.importPlayer(file);
    assert.equal(report.sections['demo.unknown'], 'orphan-kept');
    assert.equal(backend.data.get(key), JSON.stringify(entry));
  } finally {
    store.dispose();
  }
});

test('unknown section payload retains existing precedence over a duplicate orphan input', () => {
  const {store, backend} = setup();
  const entry = {v: 1, data: 'section'};
  try {
    const report = store.importPlayer(
      JSON.stringify({
        format: 'engine-profile',
        version: 2,
        sections: {'demo.unknown': entry},
        orphans: {'demo.unknown': {v: 2, data: 'orphan'}},
      }),
    );
    assert.equal(report.sections['demo.unknown'], 'orphan-kept');
    assert.equal(backend.data.get('game|p:1|demo.unknown'), JSON.stringify(entry));
  } finally {
    store.dispose();
  }
});

test('orphan outcomes follow pending and newly registered known-owner writes', () => {
  for (const dynamic of [false, true])
    for (const occupied of [false, true]) {
      const {store, backend} = setup();
      const def: SaveSection<number> = {
        id: 'demo.owned',
        scope: 'player',
        version: 1,
        initial: () => 0,
        parse: raw => Number(raw),
      };
      const key = 'game|p:1|' + def.id;
      if (occupied) backend.data.set(key, JSON.stringify({v: 1, data: 3}));
      if (!dynamic) store.section(def).replace(2);
      const off = store.section(S.voice).subscribe(value => {
        if (dynamic && value === 'brave') store.section(def).replace(2);
      });
      try {
        const result = store.importPlayer(
          JSON.stringify({
            format: 'engine-profile',
            version: 2,
            sections: {'demo.voice': {v: 1, data: 'brave'}},
            orphans: {'demo.owned': {v: 1, data: 7}},
          }),
        );
        assert.equal(result.sections['demo.voice'], 'saved');
        assert.equal(result.sections['demo.owned'], 'orphan-conflict');
        assert.equal(JSON.parse(backend.data.get(key)!).data, 2, 'known local publication precedes orphan comparison');
        assert.equal(store.section(def).get(), 2);
      } finally {
        off();
        store.dispose();
      }
    }
});

test('registered newer orphan can still be retained by a clean owner', () => {
  const {store, backend} = setup();
  const entry = {v: 2, data: 'future-voice'};
  store.section(S.voice).get();
  try {
    const result = store.importPlayer(
      JSON.stringify({format: 'engine-profile', version: 2, sections: {}, orphans: {'demo.voice': entry}}),
    );
    assert.equal(result.sections['demo.voice'], 'orphan-kept');
    assert.equal(backend.data.get('game|p:1|demo.voice'), JSON.stringify(entry));
  } finally {
    store.dispose();
  }
});

test('N players: add one, switch, and sections stay per player', () => {
  const b = new MemoryBackend();
  seedLegacy(b);
  const {store} = setup(b);
  const id = store.addPlayer('Juniper');
  assert.equal(id, '2');
  const seen: string[] = [];
  store.onPlayerChanged(p => seen.push(p));
  const voiceNow: string[] = [];
  store.section(S.voice).subscribe(v => voiceNow.push(v));
  store.setActivePlayer('2');
  assert.deepEqual(seen, ['2']);
  assert.equal(store.section(S.voice).get(), 'calm');
  assert.deepEqual(voiceNow, ['calm']);
  store.section(S.voice).replace('dramatic');
  store.flush();
  assert.equal(store.section(S.voice).of('1').get(), 'brave');
  assert.equal(store.playerName('2'), 'Juniper');
  assert.deepEqual(
    JSON.parse(b.data.get('game|profile|profile.players')!).data.players.map((p: {id: string}) => p.id),
    ['1', '2'],
  );
  assert.equal(JSON.parse(b.data.get('game|profile|profile.players')!).data.active, '2');
});

test('every registered section key and legacy key sits under a reset prefix', () => {
  for (const def of [playersSection, ...S.allSections])
    for (const k of def.legacy?.keys('7') ?? [])
      assert.ok(
        PREFIXES.reset.some(p => k.startsWith(p)),
        k,
      );
});

test('a namespace keeps two games apart on one origin', () => {
  const b = new MemoryBackend();
  const one = createSaveStore({
    local: b.port(0),
    session: new MemoryBackend().port(0, 'session'),
    build: 'one@1',
    namespace: 'one',
    timers: fakeTimers(),
  });
  const two = createSaveStore({
    local: b.port(1),
    session: new MemoryBackend().port(1, 'session'),
    build: 'two@1',
    namespace: 'two',
    timers: fakeTimers(),
  });
  one.section(S.wallet).replace({balance: 1, owned: [], awards: []}, {now: true});
  two.section(S.wallet).replace({balance: 2, owned: [], awards: []}, {now: true});
  assert.ok(b.data.has('one|p:1|demo.wallet') && b.data.has('two|p:1|demo.wallet'));
  one.resetAll();
  assert.ok(!b.data.has('one|p:1|demo.wallet'));
  assert.ok(b.data.has('two|p:1|demo.wallet'), 'reset clears only its own namespace');
  assert.throws(() => savePrefixes('Bad Name'), /namespace/);
});

test('size budget: an oversized write is refused and kept in the tab', () => {
  const {store, timers, backend} = setup();
  const big: SaveSection<string> = {
    id: 'demo.big',
    scope: 'device',
    version: 1,
    initial: () => '',
    parse: r => String(r),
    maxChars: 1000,
  };
  const h = store.section(big);
  h.replace('x'.repeat(5000));
  timers.advance(2000);
  assert.equal(h.status(), 'session');
  assert.ok(!backend.data.has('game|device|demo.big'));
});

test('live binding: writes the pre-store format in place; an unreadable record is quarantined first', () => {
  const b = new MemoryBackend();
  const {live} = seedLegacy(b);
  b.data.set('game-live-1', '{"version":4,"broken":');
  const {store, timers} = setup(b);
  const f1 = store.section(S.liveRecord).of('1');
  assert.equal(f1.status(), 'quarantined');
  f1.replace(live);
  timers.advance(1500);
  assert.equal(b.data.get('game-q|game-live-1'), '{"version":4,"broken":');
  assert.equal(JSON.parse(b.data.get('game-live-1')!).version, 4, 'still the format older readers expect');
});

test('a brand-new player notices legacy data an old-build tab writes later', () => {
  const b = new MemoryBackend();
  const {store} = setup(b);
  store.section(S.best).replace(95);
  store.flush();
  b.port(5).set('game-best-1', '88');
  assert.equal(store.section(S.best).get(), 88);
});

test('get() is O(1): no parse, no clone, stable identity between changes', () => {
  const b = new MemoryBackend();
  seedLegacy(b);
  const {store} = setup(b);
  const d = store.section(S.look);
  const a = d.get();
  assert.equal(d.get(), a);
  assert.ok(Object.isFrozen(a));
  d.update(x => {
    x.playerName = 'Z';
  });
  assert.notEqual(d.get(), a);
});

test('batch groups scheduling: updates inside it land in one flush; it is not a transaction', () => {
  const {store, timers, backend} = setup();
  const w = store.section(S.wallet),
    v = store.section(S.voice);
  const before = backend.writes;
  store.batch(() => {
    w.update(d => {
      d.balance = 7;
    });
    timers.advance(3000); // no write while the batch is open, however long it runs
    assert.equal(backend.writes, before);
    v.replace('brave');
  });
  timers.advance(1000);
  assert.ok(backend.writes - before >= 2, 'both sections written, by the same flush, as separate envelopes');
  assert.throws(() =>
    store.batch(() => {
      w.update(d => {
        d.balance = 8;
      });
      throw Error('boom');
    }),
  );
  assert.equal(w.get().balance, 8, 'no rollback when the callback throws (ADR 0052)');
  timers.advance(1000);
  assert.equal(
    JSON.parse(backend.data.get('game|p:1|demo.wallet')!).data.balance,
    8,
    'scheduling resumes after a throw',
  );
});

test('the legacyKeys shorthand imports once and leaves the key untouched', () => {
  const b = new MemoryBackend();
  b.data.set('game-old-garden', JSON.stringify({blooms: 4}));
  const garden: SaveSection<{blooms: number}> = {
    id: 'demo.garden',
    scope: 'device',
    version: 1,
    initial: () => ({blooms: 0}),
    parse: r => {
      const o = r as {blooms: number};
      if (!Number.isInteger(o?.blooms)) throw Error('bad');
      return {blooms: o.blooms};
    },
    legacyKeys: ['game-old-garden'],
  };
  const {store} = setup(b);
  const h = store.section(garden);
  assert.equal(h.get().blooms, 4);
  assert.equal(store.section(garden).get(), h.get(), 'a second handle reads the same frozen value');
  h.update(d => {
    d.blooms = 5;
  });
  store.flush();
  assert.equal(b.data.get('game-old-garden'), JSON.stringify({blooms: 4}));
  assert.equal(JSON.parse(b.data.get('game|device|demo.garden')!).data.blooms, 5);
});

test('usage() counts every byte under the reset prefixes, per section', () => {
  const b = new MemoryBackend();
  seedLegacy(b);
  const {store} = setup(b);
  store.section(S.look).get();
  store.flush();
  const u = store.usage();
  assert.ok(u.chars > 0);
  assert.ok(must(u.sections['demo.look'], 'demo.look usage') > 0);
});

test('registry validation: the empty registry and the example sections pass; bad definitions are named', () => {
  assert.deepEqual(sectionProblems([]), []);
  assert.deepEqual(sectionProblems([playersSection, ...S.allSections]), []);
  const base = {scope: 'player' as const, initial: () => 0, parse: (r: unknown) => Number(r)};
  const problems = sectionProblems([
    {...base, id: 'demo.a', version: 3, migrations: {1: (x: unknown) => x}},
    {...base, id: 'demo.a', version: 1},
    {...base, id: 'NoNamespace', version: 0},
    {...base, id: 'demo.b', version: 1, aliases: ['demo.a']},
    {...base, id: 'demo.c', version: 1, legacy: {keys: p => ['my-key-' + p], fromVersion: 1, decode: () => 0}},
    {
      ...base,
      id: 'demo.d',
      version: 1,
      legacy: {mode: 'live', keys: p => ['game-d-' + p], fromVersion: 1, decode: () => 0},
    },
  ]);
  for (const want of [
    /demo.a: 2 sections share/,
    /demo.a: no migration from v2 to v3/,
    /NoNamespace: id must be/,
    /NoNamespace: version/,
    /demo.b: alias demo.a collides/,
    /demo.c: key my-key-7 is outside the reset prefixes/,
    /demo.d: a live or mirrored legacy binding needs encode/,
  ])
    assert.ok(
      problems.some(p => want.test(p)),
      String(want) + ' in ' + problems.join('; '),
    );
});

// ---------------------------------------------------------------- import + mirror bindings

const list: SaveSection<string[] | null> = {
  id: 'demo.list',
  scope: 'player',
  version: 1,
  initial: () => null,
  parse: r => {
    if (r === null) return null;
    if (!Array.isArray(r)) throw Error('Invalid list');
    return [...r] as string[];
  },
  merge: (a, b) => (a === null ? b : b === null ? a : [...new Set([...a, ...b])]),
  legacy: importJson(p => 'game-demo-list-' + p, {mirror: true}),
};

test('a mirrored import never reformats the old key; it writes it only when the value really changes', () => {
  const b = new MemoryBackend();
  b.data.set('game-demo-list-1', '[ "a",  "b" ]');
  const {store} = setup(b);
  const h = store.section(list).of('1');
  assert.deepEqual(h.get(), ['a', 'b']);
  store.flush();
  assert.equal(b.data.get('game-demo-list-1'), '[ "a",  "b" ]', 'same value: the old bytes stay');
  assert.deepEqual(JSON.parse(b.data.get('game|p:1|demo.list')!).data, ['a', 'b']);
  h.update(d => {
    d!.push('c');
  });
  store.flush();
  assert.equal(b.data.get('game-demo-list-1'), '["a","b","c"]', 'a real change is mirrored');
  assert.deepEqual(setup(b).store.section(list).of('1').get(), ['a', 'b', 'c'], 'no false drift after the mirror');
});

test('an old key that does not decode is its own quarantine: play continues, and the mirror never writes over it', () => {
  const b = new MemoryBackend();
  b.data.set('game-demo-list-1', '{"not":"a list"}');
  const {store} = setup(b);
  const h = store.section(list).of('1');
  assert.equal(h.get(), null);
  assert.equal(h.status(), 'quarantined');
  h.replace(['fresh'], {now: true});
  assert.equal(h.status(), 'saved');
  assert.equal(b.data.get('game-demo-list-1'), '{"not":"a list"}');
  assert.deepEqual(setup(b).store.section(list).of('1').get(), ['fresh']);
  assert.equal(b.data.get('game-demo-list-1'), '{"not":"a list"}');
});

test('before mirroring, a legacy write nobody announced is merged in, never overwritten', () => {
  const b = new MemoryBackend();
  b.data.set('game-demo-list-1', '["a"]');
  const {store} = setup(b);
  const h = store.section(list).of('1');
  h.get();
  store.flush();
  b.data.set('game-demo-list-1', '["a","old-tab"]'); // no storage event (same window, or a rollback)
  h.update(d => {
    d!.push('mine');
  });
  store.flush();
  assert.deepEqual(h.get(), ['a', 'old-tab', 'mine']);
  assert.deepEqual(JSON.parse(b.data.get('game-demo-list-1')!), ['a', 'old-tab', 'mine']);
});

test('a failed mirror write leaves the envelope describing the old key as it is, so no stale value comes back', () => {
  const b = new MemoryBackend();
  b.data.set('game-demo-list-1', '["a"]');
  const {store} = setup(b);
  const h = store.section(list).of('1');
  h.get();
  store.flush();
  b.failSet = k => k === 'game-demo-list-1';
  h.update(d => {
    d!.push('b');
  });
  store.flush();
  b.failSet = () => false;
  assert.equal(b.data.get('game-demo-list-1'), '["a"]');
  assert.deepEqual(
    setup(b).store.section(list).of('1').get(),
    ['a', 'b'],
    'the envelope wins; the stale old key is not drift',
  );
});

test('storage that could not be read is tried again at the next access, never kept as empty', () => {
  const b = new MemoryBackend();
  b.data.set('game-demo-list-1', '["kept"]');
  let blocked = true;
  b.failGet = () => blocked;
  const {store} = setup(b);
  const h = store.section(list).of('1');
  assert.equal(h.get(), null);
  assert.equal(h.status(), 'unavailable');
  blocked = false;
  assert.deepEqual(h.get(), ['kept']);
});

test('export notices a legacy write that no event announced after the section was first read', () => {
  const b = new MemoryBackend();
  const {store} = setup(b);
  assert.equal(store.section(list).of('1').get(), null); // read while nothing is stored
  b.data.set('game-demo-list-1', '["seeded"]'); // same tab: no storage event
  store.section(list); // (registered, as the game's registry does)
  assert.deepEqual(store.exportPlayer('1').sections['demo.list']?.data, ['seeded']);
  assert.deepEqual(store.section(list).of('1').get(), ['seeded']);
});

test('a legacy write after the import but before the first flush is the newer value, even for "latest wins" sections', () => {
  const latest: SaveSection<string | null> = {
    id: 'demo.latest',
    scope: 'player',
    version: 1,
    initial: () => null,
    parse: r => {
      if (r !== null && typeof r !== 'string') throw Error('Invalid');
      return r as string | null;
    },
    merge: (stored, incoming) => incoming ?? stored,
    legacy: importJson(p => 'game-demo-latest-' + p, {mirror: true}),
  };
  const b = new MemoryBackend();
  b.data.set('game-demo-latest-1', '"first"');
  const {store} = setup(b);
  assert.equal(store.section(latest).of('1').get(), 'first'); // imported; not flushed yet
  b.data.set('game-demo-latest-1', '"old-tab"'); // no event
  store.flush();
  assert.equal(b.data.get('game-demo-latest-1'), '"old-tab"', 'the import never writes its stale copy over it');
  assert.equal(setup(b).store.section(latest).of('1').get(), 'old-tab');
});

test('a key a binding only reads (encode gives undefined) is never written by the mirror', () => {
  const pair: SaveSection<{a: string; b: string | null}> = {
    id: 'demo.pair',
    scope: 'player',
    version: 1,
    initial: () => ({a: '', b: null}),
    parse: r => ({...(r as {a: string; b: string | null})}),
    legacy: {
      mode: 'import',
      mirror: true,
      fromVersion: 1,
      keys: p => ['game-demo-a-' + p, 'game-demo-b-' + p],
      decode: ([a, bb]) => ({a: a ?? '', b: bb}),
      encode: v => [(v as {a: string}).a, undefined],
    },
  };
  const b = new MemoryBackend();
  b.data.set('game-demo-a-1', 'x');
  b.data.set('game-demo-b-1', 'read-only');
  const {store} = setup(b);
  store
    .section(pair)
    .of('1')
    .update(v => {
      v.a = 'y';
      v.b = 'changed';
    });
  store.flush();
  assert.equal(b.data.get('game-demo-a-1'), 'y');
  assert.equal(b.data.get('game-demo-b-1'), 'read-only');
});

for (const operation of ['update', 'replace'] as const) {
  test(`${operation} retains its starting player when the parser switches the active player`, () => {
    const {store, backend} = setup();
    let switchOnParse = false;
    const second = store.addPlayer();
    const section: SaveSection<number> = {
      id: 'test.target',
      scope: 'player',
      version: 1,
      initial: () => 0,
      parse: raw => {
        if (switchOnParse) store.setActivePlayer(second);
        return Number(raw);
      },
    };
    const handle = store.section(section);
    handle.replace(10);
    handle.of(second).replace(100);
    const firstNotifications: number[] = [];
    handle.of('1').subscribe(value => firstNotifications.push(value));
    switchOnParse = true;
    if (operation === 'update') handle.update(value => value + 1, {now: true});
    else handle.replace(11, {now: true});
    assert.equal(store.activePlayer(), second);
    assert.equal(handle.of('1').get(), 11);
    assert.equal(handle.of(second).get(), 100);
    assert.deepEqual(firstNotifications, [11]);
    assert.equal(JSON.parse(backend.data.get('game|p:1|test.target')!).data, 11);
    store.dispose();
  });
}

test('update retains its original draft owner across an updater player switch, including explicit handles', () => {
  const {store} = setup();
  const section: SaveSection<number> = {
    id: 'test.target',
    scope: 'player',
    version: 1,
    initial: () => 0,
    parse: Number,
  };
  const handle = store.section(section);
  const second = store.addPlayer();
  handle.replace(10);
  handle.of(second).replace(100);
  handle.update(value => {
    store.setActivePlayer(second);
    return value + 1;
  });
  assert.equal(handle.of('1').get(), 11);
  assert.equal(handle.get(), 100);
  handle.of('1').update(value => {
    store.setActivePlayer('1');
    return value + 1;
  });
  assert.equal(handle.get(), 12);
  assert.equal(handle.of(second).get(), 100);
  store.dispose();
});

for (const operation of ['update', 'replace'] as const) {
  for (const retirement of ['reset', 'dispose'] as const) {
    test(`${operation} rejects a target retired by its parser through ${retirement}`, () => {
      const {store, backend} = setup();
      let retire = false;
      const section: SaveSection<number> = {
        id: 'test.target',
        scope: 'player',
        version: 1,
        initial: () => 0,
        parse: raw => {
          if (retire) {
            if (retirement === 'reset') store.resetAll();
            else store.dispose();
          }
          return Number(raw);
        },
      };
      const handle = store.section(section);
      handle.replace(10, {now: true});
      const writes = backend.writes;
      retire = true;
      assert.throws(
        () =>
          operation === 'update' ? handle.update(value => value + 1, {now: true}) : handle.replace(11, {now: true}),
        retirement === 'reset' ? /ownership changed/ : /SaveStore is disposed/,
      );
      assert.equal(backend.writes, writes);
      assert.equal(store.pending().scheduled, false);
      if (retirement === 'reset') assert.equal(backend.data.has('game|p:1|test.target'), false);
      else assert.equal(JSON.parse(backend.data.get('game|p:1|test.target')!).data, 10);
      store.dispose();
    });
  }
}

for (const retirement of ['reset', 'dispose'] as const) {
  test(`update stops before parsing when its updater retires the target through ${retirement}`, () => {
    const {store, backend} = setup();
    let parses = 0;
    const handle = store.section<number>({
      id: 'test.target',
      scope: 'player',
      version: 1,
      initial: () => 0,
      parse: raw => {
        parses++;
        return Number(raw);
      },
    });
    handle.replace(10, {now: true});
    const before = parses,
      writes = backend.writes;
    assert.throws(
      () =>
        handle.update(value => {
          if (retirement === 'reset') store.resetAll();
          else store.dispose();
          return value + 1;
        }),
      retirement === 'reset' ? /ownership changed/ : /SaveStore is disposed/,
    );
    assert.equal(parses, before);
    assert.equal(backend.writes, writes);
    store.dispose();
  });
}

for (const stage of ['parse', 'merge', 'mirror-encode', 'mirror-keys'] as const) {
  for (const recreate of [false, true]) {
    test(`flush cannot resurrect a cell reset by ${stage} (replacement: ${recreate})`, () => {
      const backend = new MemoryBackend();
      let store: ReturnType<typeof createSaveStore>,
        armed = false;
      const retire = () => {
        if (!armed) return;
        armed = false;
        store.resetAll();
        if (recreate) store.section(section).replace({n: 99}, {now: true});
      };
      const mirrored = stage.startsWith('mirror-');
      const section: SaveSection<{n: number}> = {
        id: 'test.flush-owner',
        scope: 'player',
        version: 1,
        flush: 'lazy',
        initial: () => ({n: 0}),
        parse(value) {
          if (stage === 'parse') retire();
          return value as {n: number};
        },
        merge(a, b) {
          if (stage === 'merge') retire();
          return {n: Math.max(a.n, b.n)};
        },
        ...(mirrored
          ? {
              legacy: {
                keys() {
                  if (stage === 'mirror-keys') retire();
                  return ['old-progress'];
                },
                fromVersion: 1,
                mirror: true,
                decode(raws: (string | null)[]) {
                  return JSON.parse(raws[0] ?? '{"n":0}');
                },
                encode(value: {n: number}) {
                  if (stage === 'mirror-encode') retire();
                  return [JSON.stringify(value)];
                },
              },
            }
          : {}),
      };
      store = createSaveStore({
        local: backend.port(),
        session: new MemoryBackend().port(0, 'session'),
        build: 'test',
        timers: fakeTimers(),
        sections: [section],
        legacyPrefixes: ['old-'],
      });
      store.section(section).replace({n: 2});
      const key = 'game|p:1|test.flush-owner';
      if (!mirrored) backend.data.set(key, JSON.stringify({v: 1, by: 'other', data: {n: 3}}));
      armed = true;
      const report = store.flush();
      assert.equal(armed, false, 'the authored callback must execute');
      assert.ok(report.skipped.includes(key));
      if (recreate) {
        assert.equal(JSON.parse(backend.data.get(key)!).data.n, 99);
        if (mirrored) assert.equal(JSON.parse(backend.data.get('old-progress')!).n, 99);
        assert.equal(store.section(section).get().n, 99);
      } else {
        assert.equal(backend.data.has(key), false);
        assert.equal(backend.data.has('old-progress'), false);
      }
      store.dispose();
    });
  }
}
