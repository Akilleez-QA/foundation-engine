import test from 'node:test';
import assert from 'node:assert/strict';
import { installContextRecovery, type ContextRecoveryOptions, type RecoveryEvent } from './context-recovery';

/** Manual timers: `advance(ms)` runs everything due, in order. */
function fakeTimers() {
  let now = 0, seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn: () => void, ms: number) { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; },
    clear(h: unknown) { due.delete(h as number); },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        due.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
    get pending() { return due.size; },
  };
}

interface FakeCanvas {
  isConnected: boolean; parked: boolean; exempt: boolean; visible: boolean; engine: boolean; lost: boolean; ext: { loseContext(): void; restoreContext(): void };
  closest(sel: string): object | null; getClientRects(): unknown[]; getContext(kind: string): unknown;
}

function harness(extra: Partial<ContextRecoveryOptions> = {}) {
  const listeners: { type: string; fn: (e: unknown) => void; signal?: AbortSignal | undefined }[] = [];
  const canvases: FakeCanvas[] = [];
  const doc = {
    addEventListener(type: string, fn: (e: unknown) => void, o: { capture?: boolean; signal?: AbortSignal }) {
      assert.equal(o.capture, true, 'context events do not bubble: the layer listens in the capture phase');
      listeners.push({ type, fn, signal: o.signal });
    },
    querySelectorAll: (sel: string) => { assert.match(sel, /data-engine/); return canvases.filter(c => c.engine); },
  } as unknown as Document;
  const dispatch = (type: string, target: FakeCanvas) => {
    let prevented = false;
    const e = { type, target, preventDefault() { prevented = true; } };
    for (const l of [...listeners]) if (l.type === type && !l.signal?.aborted) l.fn(e);
    return prevented;
  };
  const canvas = (o: Partial<FakeCanvas> = {}): FakeCanvas => {
    const c: FakeCanvas = {
      isConnected: true, parked: false, exempt: false, visible: true, engine: true, lost: false,
      ext: { loseContext() { c.lost = true; dispatch('webglcontextlost', c); }, restoreContext() { c.lost = false; dispatch('webglcontextrestored', c); } },
      closest: sel => (sel.includes('renderer-pool') && c.parked ? {} : null),
      getClientRects: () => (c.visible ? [{}] : []),
      getContext: kind => (kind === 'webgl2' ? { isContextLost: () => c.lost, getExtension: () => c.ext } : null),
      ...o,
    };
    canvases.push(c);
    return c;
  };
  const timers = fakeTimers();
  const events: RecoveryEvent[] = [];
  let recreated = 0, steppedDown = 0, hidden = 0;
  let retry: (() => void) | null = null;
  const recovery = installContextRecovery({
    doc, timers,
    recreate: () => { recreated++; },
    exempt: c => (c as unknown as FakeCanvas).exempt,
    stepDown: () => { steppedDown++; },
    showBreak: r => { retry = r; return () => { hidden++; }; },
    emit: e => events.push(e),
    ...extra,
  });
  return {
    recovery, timers, events, canvas, dispatch,
    get recreated() { return recreated; }, get steppedDown() { return steppedDown; }, get hidden() { return hidden; },
    get retry() { return retry; },
  };
}

test('a loss restored within 3 s: lost then restored, nothing recreated', () => {
  const h = harness();
  const c = h.canvas();
  assert.equal(h.dispatch('webglcontextlost', c), true, 'preventDefault, so the browser may restore it');
  h.timers.advance(1);
  assert.deepEqual(h.events, ['lost']);
  h.timers.advance(2000);
  h.dispatch('webglcontextrestored', c);
  h.timers.advance(5000);
  assert.deepEqual(h.events, ['lost', 'restored']);
  assert.equal(h.recreated, 0);
  assert.deepEqual({ ...h.recovery.stats() }, { losses: 1, restored: 1, recreated: 0, breaks: 0, ignored: 0, pending: 0 });
});

test('no restore within 3 s: the scene is entered again (recreate)', () => {
  const h = harness();
  const c = h.canvas();
  h.dispatch('webglcontextlost', c);
  h.timers.advance(2999);
  assert.equal(h.recreated, 0);
  h.timers.advance(2);
  assert.equal(h.recreated, 1);
  assert.deepEqual(h.events, ['lost', 'recreated']);
  // A late restore of the retired canvas changes nothing.
  h.dispatch('webglcontextrestored', c);
  assert.deepEqual(h.events, ['lost', 'recreated']);
});

test('a deliberate release (forceContextLoss, then the canvas removed in the same task) is not a failure', () => {
  const h = harness();
  const c = h.canvas();
  h.dispatch('webglcontextlost', c);
  c.isConnected = false;
  h.timers.advance(10_000);
  assert.equal(h.recreated, 0);
  assert.deepEqual(h.events, []);
  assert.equal(h.recovery.stats().ignored, 1);
  // …and it does not count toward the two-failure break.
  const d = h.canvas();
  h.dispatch('webglcontextlost', d);
  h.timers.advance(1);
  assert.equal(h.recovery.stats().breaks, 0);
});

test('parked pool canvases and exempt (staged) canvases are left alone', () => {
  const h = harness();
  const parked = h.canvas({ parked: true }), staged = h.canvas({ exempt: true });
  assert.equal(h.dispatch('webglcontextlost', parked), false);
  assert.equal(h.dispatch('webglcontextlost', staged), false, 'the staged scene handles (and prevents) its own loss');
  h.timers.advance(10_000);
  assert.equal(h.recreated, 0);
  assert.equal(h.timers.pending, 0);
});

test('a canvas that leaves the page while waiting is not recreated', () => {
  const h = harness();
  const c = h.canvas();
  h.dispatch('webglcontextlost', c);
  h.timers.advance(1);
  c.isConnected = false;
  h.timers.advance(5000);
  assert.equal(h.recreated, 0);
});

test('two failures within 60 s: one tier down and the break layer; Try again recreates', () => {
  const h = harness();
  const a = h.canvas();
  h.dispatch('webglcontextlost', a);
  h.timers.advance(3001);
  assert.equal(h.recreated, 1);
  const b = h.canvas();
  h.timers.advance(20_000);
  h.dispatch('webglcontextlost', b);
  h.timers.advance(1);
  assert.equal(h.steppedDown, 1);
  assert.deepEqual(h.events, ['lost', 'recreated', 'lost', 'break']);
  h.timers.advance(10_000);
  assert.equal(h.recreated, 1, 'the break waits for the child');
  h.retry!();
  assert.equal(h.hidden, 1);
  assert.equal(h.recreated, 2);
});

test('failures more than 60 s apart each just recreate', () => {
  const h = harness();
  for (let i = 0; i < 3; i++) {
    h.dispatch('webglcontextlost', h.canvas());
    h.timers.advance(61_000);
  }
  assert.equal(h.recreated, 3);
  assert.equal(h.steppedDown, 0);
  assert.equal(h.recovery.stats().breaks, 0);
});

test('without a break layer the second failure still steps down and recreates', () => {
  const h = harness({ showBreak: undefined });
  h.dispatch('webglcontextlost', h.canvas());
  h.timers.advance(3001);
  h.dispatch('webglcontextlost', h.canvas());
  h.timers.advance(1);
  assert.equal(h.steppedDown, 1);
  assert.equal(h.recreated, 2);
});

test('loseContext loses the frontmost visible three.js canvas the layer owns and returns its restore', () => {
  const h = harness();
  const back = h.canvas(), front = h.canvas();
  h.canvas({ visible: false }); h.canvas({ exempt: true }); h.canvas({ engine: false }); h.canvas({ parked: true });
  const restore = h.recovery.loseContext();
  assert.ok(restore);
  assert.equal(front.lost, true);
  assert.equal(back.lost, false);
  h.timers.advance(1);
  restore!();
  assert.equal(front.lost, false);
  assert.deepEqual(h.events, ['lost', 'restored']);
  front.visible = back.visible = false;
  assert.equal(h.recovery.loseContext(), null, 'nothing to lose');
});

test('dispose stops listening and clears its timers', () => {
  const h = harness();
  h.dispatch('webglcontextlost', h.canvas());
  h.recovery.dispose();
  assert.equal(h.timers.pending, 0);
  assert.equal(h.dispatch('webglcontextlost', h.canvas()), false);
  h.timers.advance(10_000);
  assert.equal(h.recreated, 0);
});
