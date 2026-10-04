import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PerspectiveCamera} from 'three';
import {createQuality} from '../platform/render/quality';
import {livePixelRatio} from '../platform/render/quality-runtime';

// Execute the actual runtime resize registration against a native EventTarget and Three camera.
const source = readFileSync(new URL('./runtime.ts', import.meta.url), 'utf8');
const start = source.indexOf('      const resize = () => {'),
  end = source.indexOf('      sync();', start);
assert.ok(start > 0 && end > start);
const body = ts.transpile(
  `let dirty=false; const extensions=[]; ${source.slice(start, end)} return {dirty:()=>dirty,clean:()=>{dirty=false;}};`,
  {target: ts.ScriptTarget.ES2022},
);
function fixture(win = new EventTarget()) {
  const life = new AbortController(),
    cleanup: (() => void)[] = [],
    camera = new PerspectiveCamera();
  let leaving = false,
    calls = 0,
    invalidations = 0,
    refreshes = 0,
    disconnected = 0,
    observer!: () => void;
  const view = {clientWidth: 320, clientHeight: 200};
  class Observer {
    constructor(fn: () => void) {
      observer = fn;
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  }
  const renderer = {
    setSize(w: number, h: number, css: boolean) {
      assert.deepEqual([w, h, css], [Math.max(1, view.clientWidth), Math.max(1, view.clientHeight), false]);
      calls++;
    },
  };
  const api = new Function('actx', 'view', 'renderer', 'camera', 'sizes', 'ResizeObserver', 'doc', body)(
    {
      signal: life.signal,
      leaving: () => leaving,
      invalidate: () => invalidations++,
      own: (fn: () => void) => cleanup.push(fn),
    },
    view,
    renderer,
    camera,
    {refresh: () => refreshes++},
    Observer,
    {defaultView: win},
  );
  return {
    win,
    view,
    api,
    observer: () => observer(),
    leave: () => {
      leaving = true;
    },
    abort: () => life.abort(),
    cleanup: () => cleanup.forEach(fn => fn()),
    stats: () => ({calls, invalidations, refreshes, disconnected}),
    camera,
  };
}

test('DPR-only quality change invalidates the author scene without a CSS resize', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    win = new EventTarget();
  Object.defineProperty(globalThis, 'window', {configurable: true, value: win});
  const f = fixture(win),
    q = createQuality({devicePixelRatio: () => 2});
  let ratio = 0;
  const renderer = livePixelRatio(
    {
      setPixelRatio: (next: number) => {
        ratio = next;
      },
      getPixelRatio: () => ratio,
      dispose() {},
    },
    undefined,
    q,
  );
  try {
    f.api.clean();
    const before = f.stats();
    q.setPreset('low');
    await Promise.resolve();
    assert.equal(f.stats().calls, before.calls + 1);
    assert.equal(f.stats().invalidations, before.invalidations + 1);
    assert.equal(f.api.dirty(), true);
    assert.equal(f.camera.aspect, 1.6);
    const unchanged = f.stats();
    q.setKnob('frame-rate.cap', 60);
    await Promise.resolve();
    assert.deepEqual(f.stats(), unchanged);
  } finally {
    renderer.dispose();
    f.cleanup();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('scene resize keeps ResizeObserver and rejects leaving/aborted callbacks before touching the lease', () => {
  for (const retirement of ['leave', 'abort']) {
    const f = fixture();
    f.view.clientWidth = 400;
    f.observer();
    assert.equal(f.camera.aspect, 2);
    retirement === 'leave' ? f.leave() : f.abort();
    f.api.clean();
    const before = f.stats();
    f.win.dispatchEvent(new Event('resize'));
    f.observer();
    assert.deepEqual(f.stats(), before);
    assert.equal(f.api.dirty(), false);
    f.cleanup();
    assert.equal(f.stats().disconnected, 1);
    f.win.dispatchEvent(new Event('resize'));
    f.observer();
    assert.equal(f.stats().calls, before.calls);
  }
});

test('scene cleanup removes its window resize listener even before abort notification', () => {
  const f = fixture();
  f.cleanup();
  const before = f.stats();
  f.win.dispatchEvent(new Event('resize'));
  assert.deepEqual(f.stats(), before);
});

test('hidden zero-area scene clamps its drawing size and keeps a finite aspect', () => {
  const f = fixture();
  try {
    f.view.clientWidth = 0;
    f.view.clientHeight = 0;
    f.observer();
    assert.equal(f.camera.aspect, 1);
  } finally {
    f.cleanup();
  }
});
