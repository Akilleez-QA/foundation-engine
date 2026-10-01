import test from 'node:test';
import assert from 'node:assert/strict';
import { installLazyActionGamepad, type LazyActionGamepadOptions } from './lazy-action-gamepad';
import type { PadLike } from './gamepad';

const standard: PadLike = { index: 0, id: 'pad', connected: true, mapping: 'standard', buttons: [], axes: [] };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
type Loader = NonNullable<LazyActionGamepadOptions['load']>;

function rig(load: Loader, present = false) {
  const life = new AbortController();
  const win = new EventTarget();
  const errors: unknown[] = [];
  const o: LazyActionGamepadOptions = {
    signal: life.signal,
    win,
    doc: new EventTarget(),
    getPads: () => present ? [standard] : [],
    load,
    report(error) {
      errors.push(error);
      throw Error('reporter failed');
    },
    input: { padFrame() {}, cancel() {}, onCancel() { return () => {}; } },
    layers: {
      fromTop: () => [],
      escape: () => false,
      cycleFocus: () => false,
      onChange() { return () => {}; },
    },
    loop: { add() { throw Error('lazy wrapper must not create a ticker'); } },
  };
  const connect = (mapping = 'standard') => win.dispatchEvent(Object.assign(
    new Event('gamepadconnected'),
    { gamepad: { ...standard, mapping } },
  ));
  return { o, life, win, errors, connect };
}

test('controller adapter stays unloaded until an eligible connection and installs only once', async () => {
  let loads = 0, installs = 0;
  let installedSignal: AbortSignal | undefined;
  const r = rig(async () => {
    loads++;
    return {
      installActionGamepad(o) {
        installs++;
        installedSignal = o.signal;
        r.connect();
        return { family: null };
      },
    };
  });
  installLazyActionGamepad(r.o);
  await flush();
  assert.equal(loads, 0);
  r.connect('');
  await flush();
  assert.equal(loads, 0);
  r.connect();
  r.connect();
  await flush();
  assert.equal(loads, 1);
  assert.equal(installs, 1);
  r.connect();
  await flush();
  assert.equal(loads, 1);
  r.life.abort();
  assert.equal(installedSignal?.aborted, true);
});

test('already available controller starts loading and aborted import never installs', async () => {
  let resolve!: (adapter: Awaited<ReturnType<Loader>>) => void;
  let loads = 0, installs = 0;
  const r = rig(() => {
    loads++;
    return new Promise(r => { resolve = r; });
  }, true);
  installLazyActionGamepad(r.o);
  await flush();
  assert.equal(loads, 1);
  r.connect();
  assert.equal(loads, 1);
  r.life.abort();
  resolve({ installActionGamepad() { installs++; return { family: null }; } });
  await flush();
  assert.equal(installs, 0);
  r.connect();
  await flush();
  assert.equal(loads, 1);
});

test('abort before the import microtask prevents a disowned load', async () => {
  let loads = 0;
  const r = rig(async () => {
    loads++;
    return { installActionGamepad() { throw Error('must not install'); } };
  }, true);
  installLazyActionGamepad(r.o);
  r.life.abort();
  await flush();
  assert.equal(loads, 0);
  assert.deepEqual(r.errors, []);
});

test('failed import reports safely and later connection retries successfully', async () => {
  let loads = 0, installs = 0;
  const r = rig(async () => {
    if (++loads === 1) throw Error('chunk unavailable');
    return { installActionGamepad() { installs++; return { family: null }; } };
  }, true);
  installLazyActionGamepad(r.o);
  await flush();
  assert.equal(r.errors.length, 1);
  r.connect();
  await flush();
  assert.equal(loads, 2);
  assert.equal(installs, 1);
  r.life.abort();
});

test('partial installation is aborted on failure and reentrant app abort reaches its child owner', async () => {
  let installs = 0;
  const signals: AbortSignal[] = [];
  const r = rig(async () => ({
    installActionGamepad(o) {
      signals.push(o.signal);
      if (++installs === 1) throw Error('partial install');
      r.life.abort();
      assert.equal(o.signal.aborted, true);
      return { family: null };
    },
  }), true);
  installLazyActionGamepad(r.o);
  await flush();
  assert.equal(signals[0].aborted, true);
  assert.equal(r.errors.length, 1);
  r.connect();
  await flush();
  assert.equal(installs, 2);
  assert.equal(signals[1].aborted, true);
  r.connect();
  await flush();
  assert.equal(installs, 2);
});
