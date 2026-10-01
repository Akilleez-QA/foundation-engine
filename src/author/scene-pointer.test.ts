import test from 'node:test';
import assert from 'node:assert/strict';
import { bindScenePointer } from './scene-pointer';
import { ev, ptr } from '../testing/input-fakes';

function setup() {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { defaultView: win, hidden: false });
  let owns = true, presses = 0, blocked = 0;
  const captured = new Set<number>();
  const canvas = Object.assign(new EventTarget(), { ownerDocument: doc,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture: (id: number) => captured.add(id), hasPointerCapture: (id: number) => captured.has(id), releasePointerCapture: (id: number) => captured.delete(id),
  });
  const abort = new AbortController();
  const g = bindScenePointer(canvas as unknown as HTMLCanvasElement, { signal: abort.signal, owns: () => owns, press: () => { presses++; }, canceled: () => {}, blocked: () => { blocked++; }, invalidate: () => {} });
  return { g, doc, win, abort, captured, setOwns: (v: boolean) => { owns = v; }, get presses() { return presses; }, get blocked() { return blocked; },
    fire: (type: string, id = 1, extra = {}) => (type === 'pointerup' ? doc : canvas).dispatchEvent(ptr(type, id, 25, 75, extra)) };
}

test('scene pointer cancels on every lifecycle interruption and requires a fresh down', () => {
  const end: ((s: ReturnType<typeof setup>) => void)[] = [
    s => s.fire('pointercancel'), s => s.fire('lostpointercapture'), s => s.fire('pointermove', 1, { buttons: 0 }),
    s => s.win.dispatchEvent(ev('blur')), s => s.win.dispatchEvent(ev('pagehide')), s => s.win.dispatchEvent(ev('resize')),
    s => { s.doc.hidden = true; s.doc.dispatchEvent(ev('visibilitychange')); },
    s => { s.setOwns(false); s.g.sync(); },
  ];
  for (const stop of end) {
    const s = setup(); s.fire('pointerdown'); assert.equal(s.g.pointer.down, true); stop(s);
    assert.equal(s.g.pointer.down, false); assert.equal(s.g.pointer.pressed, false); assert.equal(s.captured.size, 0);
    s.setOwns(true); s.doc.hidden = false; s.g.sync(); s.fire('pointermove'); s.fire('pointerup');
    assert.equal(s.g.pointer.down, false); assert.equal(s.presses, 1);
    s.fire('pointerdown'); assert.equal(s.presses, 2); s.abort.abort();
  }
});
test('scene pointer ignores secondary fingers and non-primary buttons', () => {
  const s = setup(); s.fire('pointerdown', 1, { button: 2 }); assert.equal(s.presses, 0);
  s.fire('pointerdown'); s.fire('pointerdown', 2); s.fire('pointerup', 2); assert.equal(s.g.pointer.down, true);
  s.fire('pointerup'); assert.equal(s.g.pointer.down, false); assert.equal(s.g.pointer.pressed, true);
  assert.deepEqual([s.g.pointer.x, s.g.pointer.y], [-.5, -.5]); s.abort.abort();
});
test('blocking emits once per transition, disposal prevents future input', () => {
  const s = setup(); s.setOwns(false); s.g.sync(); s.g.sync(); assert.equal(s.blocked, 1);
  s.fire('pointerdown'); assert.equal(s.presses, 0); s.setOwns(true); s.g.sync(); s.g.dispose();
  s.fire('pointerdown'); assert.equal(s.presses, 0); s.abort.abort();
});
