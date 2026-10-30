/**
 * The settings contract test, plus the settings section
 * over a real save store and the definition checks.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  coreSettings,
  createSettings,
  settingProblems,
  settingsValuesSection,
  type SettingDef,
  type StoredSettings,
} from './settings';
import {MemoryBackend} from '../save/storage-port';
import {createSaveStore} from '../save/store';

test('settings: sparse storage, platform defaults, body-class projection, validation', () => {
  let data: StoredSettings = {'sound.music': 0.5, 'comfort.large-type': 'yes'};
  const subs = new Set<(v: StoredSettings) => void>(),
    classes = new Map<string, boolean>();
  const store = {
    get: () => data,
    update(fn: (d: StoredSettings) => StoredSettings | void) {
      const d = {...data};
      data = fn(d) ?? d;
      subs.forEach(f => f(data));
      return 'saved' as const;
    },
    subscribe(fn: (v: StoredSettings) => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
  const s = createSettings(
    coreSettings,
    store,
    {prefersReducedMotion: true, coarsePointer: false},
    {dom: {toggleClass: (c, on) => classes.set(c, on)}},
  );
  assert.equal(s.get('sound.music'), 0.5);
  assert.equal(s.get('comfort.large-type'), false, 'invalid stored value → default');
  assert.equal(s.get('comfort.calm'), true, 'calm defaults to prefers-reduced-motion');
  assert.equal(classes.get('still-mode'), true);
  const seen: boolean[] = [];
  s.subscribe('comfort.calm', v => seen.push(v));
  s.set('comfort.calm', false);
  assert.deepEqual(seen, [false]);
  assert.equal(classes.get('still-mode'), false);
  s.set('sound.music', 0.24);
  assert.ok(!('sound.music' in data), 'default values are not stored');
  assert.throws(() => s.set('sound.music', 7));
});

test('settings over a real save store: one sparse device envelope, settings.changed once per change, other tabs followed', () => {
  const b = new MemoryBackend();
  const timers = {set: () => 0, clear: () => {}, now: () => 0};
  const open = (tab: number) =>
    createSaveStore({
      local: b.port(tab),
      session: new MemoryBackend().port(tab, 'session'),
      build: 'game@test',
      timers,
      sections: [settingsValuesSection],
    });
  const A = open(1),
    B = open(2);
  const events: unknown[] = [];
  const env = {prefersReducedMotion: false, coarsePointer: false};
  const sa = createSettings(coreSettings, A.section(settingsValuesSection), env, {
    events: {emit: (_k, p) => events.push(p)},
  });
  const sb = createSettings(coreSettings, B.section(settingsValuesSection), env);
  sa.set('comfort.calm', true);
  sa.set('sound.voice', 0.5);
  assert.deepEqual(events, [
    {id: 'comfort.calm', value: true},
    {id: 'sound.voice', value: 0.5},
  ]);
  A.flush();
  assert.deepEqual(JSON.parse(b.data.get('game|device|settings.values')!).data, {
    'comfort.calm': true,
    'sound.voice': 0.5,
  });
  assert.equal(sb.get('comfort.calm'), true, 'the other tab follows through the storage event');
  const aborted = new AbortController();
  const heard: number[] = [];
  sa.subscribe('sound.music', v => heard.push(v), aborted.signal);
  aborted.abort();
  sa.set('sound.music', 0.9);
  assert.deepEqual(heard, []);
  sa.reset('sound');
  assert.equal(sa.get('sound.voice'), 0.8);
  assert.equal(sa.get('comfort.calm'), true, 'reset clears one section only');
  assert.equal(sa.defs('comfort').length, 2);
});

test('definition checks: every core default is legal; bad definitions are named', () => {
  for (const env of [
    {prefersReducedMotion: true, coarsePointer: true},
    {prefersReducedMotion: false, coarsePointer: false},
  ])
    assert.deepEqual(settingProblems(coreSettings, env), []);
  const bad = [
    {
      id: 'sound.music',
      section: 'sound',
      type: 'range',
      range: {min: 0, max: 1, step: 0.01},
      label: 'x',
      scope: 'device',
      default: 2,
    },
    {id: 'sound.music', section: 'comfort', type: 'bool', label: 'x', scope: 'device', default: false},
  ] as unknown as SettingDef[];
  const p = settingProblems(bad, {prefersReducedMotion: false, coarsePointer: false});
  assert.ok(p.some(x => /default is not a legal value/.test(x)));
  assert.ok(p.some(x => /duplicate id/.test(x)));
  assert.ok(p.some(x => /must start with its section/.test(x)));
});

test('throwing settings observers do not strand independent delivery or body projection', () => {
  const backend = new MemoryBackend();
  const store = createSaveStore({
    local: backend.port(1),
    session: new MemoryBackend().port(1, 'session'),
    build: 'game@test',
    timers: {set: () => 0, clear() {}, now: () => 0},
    sections: [settingsValuesSection],
  });
  const classes = new Map<string, boolean>();
  const first = Error('event observer'),
    second = Error('setting observer');
  const heard: boolean[] = [];
  const settings = createSettings(
    coreSettings,
    store.section(settingsValuesSection),
    {prefersReducedMotion: false, coarsePointer: false},
    {
      dom: {
        toggleClass: (name, on) => {
          classes.set(name, on);
        },
      },
      events: {
        emit: () => {
          throw first;
        },
      },
    },
  );
  settings.subscribe('comfort.large-type', () => {
    throw second;
  });
  settings.subscribe('comfort.large-type', value => heard.push(value));
  try {
    assert.throws(
      () => settings.set('comfort.large-type', true),
      error => {
        assert.deepEqual((error as AggregateError).errors, [first, second]);
        return true;
      },
    );
    assert.equal(settings.get('comfort.large-type'), true);
    assert.equal(classes.get('large-type'), true);
    assert.deepEqual(heard, [true]);
    store.flush();
    assert.equal(JSON.parse(backend.data.get('game|device|settings.values')!).data['comfort.large-type'], true);
  } finally {
    store.dispose();
  }
});

test('nested settings changes suppress stale delivery and project latest values despite throwing listeners', () => {
  const backend = new MemoryBackend();
  const store = createSaveStore({
    local: backend.port(1),
    session: new MemoryBackend().port(1, 'session'),
    build: 'game@test',
    timers: {set: () => 0, clear() {}, now: () => 0},
    sections: [settingsValuesSection],
  });
  const classes = new Map<string, boolean>(),
    heard: boolean[] = [];
  const failure = Error('nested listener failed');
  const settings = createSettings(
    coreSettings,
    store.section(settingsValuesSection),
    {prefersReducedMotion: false, coarsePointer: false},
    {
      dom: {
        toggleClass: (name, on) => {
          classes.set(name, on);
        },
      },
    },
  );
  settings.subscribe('comfort.large-type', value => {
    if (value) settings.set('comfort.large-type', false);
    else throw failure;
  });
  settings.subscribe('comfort.large-type', value => heard.push(value));
  try {
    assert.throws(
      () => settings.set('comfort.large-type', true),
      error => error === failure,
    );
    assert.equal(settings.get('comfort.large-type'), false);
    assert.equal(classes.get('large-type'), false);
    assert.deepEqual(heard, [false], 'outer true must not follow nested false');
  } finally {
    store.dispose();
  }
});

test('an unrelated nested setting change does not suppress current subscriber delivery', () => {
  const backend = new MemoryBackend();
  const store = createSaveStore({
    local: backend.port(1),
    session: new MemoryBackend().port(1, 'session'),
    build: 'game@test',
    timers: {set: () => 0, clear() {}, now: () => 0},
    sections: [settingsValuesSection],
  });
  const settings = createSettings(coreSettings, store.section(settingsValuesSection), {
    prefersReducedMotion: false,
    coarsePointer: false,
  });
  const heard: boolean[] = [];
  settings.subscribe('comfort.large-type', () => settings.set('comfort.calm', true));
  settings.subscribe('comfort.large-type', value => heard.push(value));
  try {
    settings.set('comfort.large-type', true);
    assert.deepEqual(heard, [true]);
  } finally {
    store.dispose();
  }
});
