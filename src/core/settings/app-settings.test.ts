/**
 * Step 02.s7 exit tests for the running game's settings service: Calm is one central value (body class,
 * `reducedMotion()` and subscribers change in the same frame), the platform is queried once and never inside a
 * frame, and the service follows the store the game's boot installs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../save/storage-port';
import { createSaveStore } from '../save/store';
import { installAppSaveStore, resetAppSaveStoreForTests } from '../save/app-store';
import { appSettings, resetAppSettingsForTests, settingsMatchMediaCalls } from './app-settings';
import { settingsValuesSection } from './settings';
import { reducedMotion } from '../../platform/ui/activity-frames';
import { createLoop } from '../../platform/ui/runtime';

const quiet = { set: () => 0, clear() {}, now: () => 0 };
const open = (disk: MemoryBackend) => installAppSaveStore(createSaveStore({ local: disk.port(), session: new MemoryBackend().port(0, 'session'), build: 'game@test', timers: quiet, sections: [settingsValuesSection] }));

/** A platform with a live reduced-motion preference and a body whose classes are recorded. */
function platform(os = false) {
  const classes = new Set<string>();
  let listener: ((e: { matches: boolean }) => void) | undefined;
  const g = globalThis as Record<string, unknown>;
  const saved = ['matchMedia', 'document'].map(k => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
  Object.defineProperty(g, 'matchMedia', { configurable: true, value: (q: string) => ({
    matches: q.includes('reduced-motion') ? os : false,
    addEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => { if (q.includes('reduced-motion')) listener = fn; },
  }) });
  Object.defineProperty(g, 'document', { configurable: true, value: { body: { classList: { toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c: string) => classes.has(c) } } } });
  return {
    classes,
    setOs(on: boolean) { os = on; listener?.({ matches: on }); },
    restore() { for (const [k, d] of saved) { if (d) Object.defineProperty(g, k, d); else Reflect.deleteProperty(g, k); } resetAppSettingsForTests(); resetAppSaveStoreForTests(); },
  };
}

test('toggling Calm updates the body class, reducedMotion() and subscribers in the same frame', () => {
  const p = platform(false);
  try {
    open(new MemoryBackend());
    const s = appSettings(), heard: boolean[] = [];
    s.subscribe('comfort.calm', v => heard.push(v));
    assert.equal(reducedMotion(), false); assert.equal(p.classes.has('still-mode'), false);
    s.set('comfort.calm', true);
    assert.deepEqual(heard, [true]); assert.equal(reducedMotion(), true); assert.equal(p.classes.has('still-mode'), true);
    s.set('comfort.large-type', true); assert.equal(p.classes.has('large-type'), true, 'the one writer of large-type too');
    s.set('comfort.calm', false);
    assert.deepEqual(heard, [true, false]); assert.equal(reducedMotion(), false); assert.equal(p.classes.has('still-mode'), false);
  } finally { p.restore(); }
});

test('the OS preference is the default, followed live, and a family choice wins over it', () => {
  const p = platform(true);
  try {
    open(new MemoryBackend());
    const s = appSettings();
    assert.equal(reducedMotion(), true, 'default: the OS preference'); assert.equal(p.classes.has('still-mode'), true);
    p.setOs(false); assert.equal(reducedMotion(), false, 'followed live'); assert.equal(p.classes.has('still-mode'), false);
    p.setOs(true); s.set('comfort.calm', false); assert.equal(reducedMotion(), false, 'Calm turned off by the family');
    p.setOs(false); p.setOs(true); assert.equal(reducedMotion(), false, 'and it stays their choice');
  } finally { p.restore(); }
});

test('no matchMedia call inside a frame: the platform is queried twice, once per preference, ever', () => {
  const p = platform(false);
  try {
    open(new MemoryBackend());
    appSettings();
    assert.equal(settingsMatchMediaCalls(), 2);
    let frames = 0, pending: FrameRequestCallback | undefined, t = 0;
    const loop = createLoop({ scheduler: { request: cb => { pending = cb; return 1; }, cancel: () => { pending = undefined; } } });
    loop.add({ owner: 'test', mode: 'continuous', render: f => { frames++; if (f.calm !== reducedMotion()) throw Error('frame.calm differs'); } });
    for (let i = 0; i < 120; i++) { const cb = pending; pending = undefined; cb?.(t += 16); if (i === 60) appSettings().set('comfort.calm', true); }
    assert.ok(frames > 100, 'the frames ran');
    assert.equal(settingsMatchMediaCalls(), 2, 'still two after 120 frames and a Calm toggle');
  } finally { p.restore(); }
});

test('the service follows the store the game installs, and writes one sparse envelope', () => {
  const p = platform(false);
  try {
    const first = new MemoryBackend(); first.data.set('game|device|settings.values', JSON.stringify({ v: 1, by: 'x', data: { 'comfort.large-type': true } }));
    open(first);
    const s = appSettings();
    assert.equal(s.get('comfort.large-type'), true, 'read from the first store');
    const disk = new MemoryBackend(); disk.data.set('game|device|settings.values', JSON.stringify({ v: 1, by: 'x', data: { 'sound.music': 0.5 } }));
    const store = open(disk);
    assert.equal(s.get('sound.music'), 0.5, 'reads the new store');
    const heard: number[] = []; s.subscribe('sound.music', v => heard.push(v));
    s.set('sound.music', 0.7); assert.deepEqual(heard, [0.7], 'subscribed to the new store');
    const before = disk.writes; store.flush();
    assert.equal(disk.writes - before, 1, 'one envelope write');
    assert.deepEqual(JSON.parse(disk.data.get('game|device|settings.values')!).data, { 'sound.music': 0.7 });
    s.set('sound.music', 0.7); assert.equal(store.flush().written.length, 0, 'an unchanged value writes nothing');
  } finally { p.restore(); }
});
