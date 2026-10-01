import test from 'node:test';
import assert from 'node:assert/strict';
import type * as T from 'three';
import { createRendererPool, type PoolRenderer } from './renderer-pool';
import { createSnapshots } from './pool-snapshot';

/** Just enough of an element and a GL context for the pool and the snapshot role. */
class El {
  children: El[] = []; parent: El | null = null; attrs = new Map<string, string>(); style: Record<string, string> = {};
  dataset: Record<string, string> = {}; hidden = false; width = 300; height = 150;
  constructor(readonly tag: string) {}
  get isConnected(): boolean { let n: El | null = this; while (n) { if (n.tag === 'body') return true; n = n.parent; } return false; }
  append(c: El) { c.remove(); c.parent = this; this.children.push(c); }
  prepend(c: El) { this.append(c); }
  remove() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  getAttributeNames() { return [...this.attrs.keys()]; }
  addEventListener() {}
}
interface FakeGL { lost: boolean; id: number; [k: string]: unknown }
let glIds = 0;
function fakeGL(): FakeGL {
  const gl: FakeGL = { lost: false, id: ++glIds, isContextLost: () => gl.lost, getExtension: () => ({ loseContext() { gl.lost = true; } }) };
  for (const k of ['Texture', 'Buffer', 'Framebuffer', 'Renderbuffer', 'VertexArray', 'Program', 'Shader', 'Query', 'Sampler']) {
    gl['create' + k] = () => ({ k }); gl['delete' + k] = () => {};
  }
  return gl;
}

type Fake = PoolRenderer & { gl: FakeGL; disposed: boolean; resets: number; target: unknown; log: string[] };
function harness() {
  const body = new El('body');
  const doc = { body, createElement: (t: string) => new El(t) } as unknown as Document;
  const worldContexts: FakeGL[] = [], utilityContexts: FakeGL[] = [];
  const renderers: Fake[] = [];
  const fake = (canvas: El, gl: FakeGL): Fake => {
    const r = {
      domElement: canvas, gl, disposed: false, resets: 0, target: null as unknown, log: [] as string[],
      shadowMap: { enabled: false, type: 0 }, info: { memory: { textures: 0, geometries: 0 }, programs: [] },
      getContext: () => gl, dispose() { r.disposed = true; }, forceContextLoss() { gl.lost = true; },
      resetState() { r.resets++; r.log.push('reset'); },
      setRenderTarget(t: unknown) { r.target = t; r.log.push(t ? 'target' : 'screen'); },
      setClearColor() {}, clear() { r.log.push('clear'); },
      readRenderTargetPixels(_t: unknown, _x: number, _y: number, w: number, h: number, buf: Uint8Array) { buf.fill(7, 0, w * h * 4); r.log.push('read'); },
    };
    renderers.push(r as unknown as Fake);
    return r as unknown as Fake;
  };
  const pool = createRendererPool({
    doc, pixelRatio: () => {}, nextFrame: fn => { fn(); return () => {}; },
    createRenderer: (canvas, context) => {
      let gl = context as unknown as FakeGL | undefined;
      if (!gl) { gl = fakeGL(); worldContexts.push(gl); }
      return fake((canvas as unknown as El) ?? new El('canvas'), gl);
    },
  });
  const timers: (() => void)[] = [];
  const outputs: { pixels: Uint8Array; w: number; h: number }[] = [];
  const snaps = createSnapshots(pool, {
    createContext: () => { const gl = fakeGL(); utilityContexts.push(gl); return { canvas: new El('canvas') as unknown as HTMLCanvasElement, gl: gl as unknown as WebGL2RenderingContext }; },
    createTarget: s => ({ ...s, disposed: false, dispose() { (this as { disposed: boolean }).disposed = true; } }) as unknown as T.WebGLRenderTarget,
    output: (pixels, s) => { outputs.push({ pixels, w: s.width, h: s.height }); return {} as HTMLCanvasElement; },
    setTimer: fn => { timers.push(fn); return timers.length - 1; },
    clearTimer: t => { if (typeof t === 'number') timers[t] = () => {}; },
  });
  const host = () => { const h = new El('div'); body.append(h); return h as unknown as HTMLElement; };
  return { pool, snaps, worldContexts, utilityContexts, renderers, timers, outputs, host };
}

test('a snapshot while a scene holds the world context creates 0 contexts and draws into a target on it', () => {
  const { pool, snaps, worldContexts, utilityContexts, renderers, outputs, host } = harness();
  const scene = pool.lease({ role: 'world', host: host() })!;
  const before = pool.stats().created;
  let drawn: unknown = null;
  for (let i = 0; i < 4; i++) assert.ok(snaps.canvas({ width: 8, height: 4 }, (_r, target) => { drawn = target; }));
  assert.equal(pool.stats().created, before, 'no context created');
  assert.equal(utilityContexts.length, 0);
  assert.equal(worldContexts.length, 1);
  const snap = renderers.at(-1)!;
  assert.equal(snap.gl, worldContexts[0], 'the snapshot renderer is bound to the world context');
  assert.notEqual(snap, scene.renderer as unknown as Fake, 'never the scene renderer');
  assert.equal(renderers.length, 2, 'one snapshot renderer serves the whole batch');
  assert.ok(drawn && (drawn as { disposed: boolean }).disposed, 'each target is freed');
  assert.equal(outputs.length, 4);
  assert.equal(outputs[0]!.pixels.length, 8 * 4 * 4);
  assert.equal(snaps.stats().onWorld, 4);
});

test('the scene renderer has its GL state cache reset after every snapshot', () => {
  const { pool, snaps, host } = harness();
  const scene = pool.lease({ role: 'world', host: host() })!.renderer as unknown as Fake;
  snaps.canvas({ width: 2, height: 2 }, () => {});
  assert.equal(scene.resets, 1);
  assert.deepEqual(scene.log, ['reset', 'screen'], 'reset, then its own framebuffer and viewport restored');
});

test('the snapshot renderer lets go of the world context before a release sweeps it and before the next lease', () => {
  const { pool, snaps, renderers, host } = harness();
  const a = pool.lease({ role: 'world', host: host() })!;
  snaps.canvas({ width: 2, height: 2 }, () => {});
  const snapA = renderers.at(-1)!;
  a.release();
  assert.ok(snapA.disposed, 'disposed at the release');
  pool.lease({ role: 'world', host: host() });
  snaps.canvas({ width: 2, height: 2 }, () => {});
  assert.notEqual(renderers.at(-1), snapA, 'a fresh snapshot renderer for the next visit');
});

test('a parked world context still serves snapshots (no utility context)', () => {
  const { pool, snaps, utilityContexts, host } = harness();
  pool.lease({ role: 'world', host: host() })!.release();
  const before = pool.stats().created;
  assert.ok(snaps.canvas({ width: 2, height: 2 }, () => {}));
  assert.equal(pool.stats().created, before);
  assert.equal(utilityContexts.length, 0);
});

test('without a world, the utility context is made once, lingers 8 s after the last snapshot, then is retired', () => {
  const { pool, snaps, utilityContexts, timers } = harness();
  for (let i = 0; i < 3; i++) snaps.canvas({ width: 2, height: 2 }, () => {});
  assert.equal(utilityContexts.length, 1);
  assert.equal(pool.stats().contexts, 1, 'counted in the pool');
  assert.equal(pool.stats().created, 1);
  for (const t of timers.slice(0, -1)) t();
  assert.equal(utilityContexts[0]!.lost, false, 'earlier timers were superseded');
  timers.at(-1)!();
  assert.equal(utilityContexts[0]!.lost, true, 'retired after the linger');
  assert.equal(pool.stats().contexts, 0);
});

test('a world lease retires the utility context: 0 extra contexts while the world exists', () => {
  const { pool, snaps, utilityContexts, host } = harness();
  snaps.canvas({ width: 2, height: 2 }, () => {});
  pool.lease({ role: 'world', host: host() });
  assert.equal(utilityContexts[0]!.lost, true);
  assert.equal(pool.stats().contexts, 1, 'the world only');
  snaps.canvas({ width: 2, height: 2 }, () => {});
  assert.equal(utilityContexts.length, 1, 'no new utility context');
  assert.equal(pool.stats().contexts, 1);
});

test('a failing draw returns null and still restores the scene renderer', () => {
  const { pool, snaps, host } = harness();
  const scene = pool.lease({ role: 'world', host: host() })!.renderer as unknown as Fake;
  assert.equal(snaps.canvas({ width: 2, height: 2 }, () => { throw Error('bad model'); }), null);
  assert.equal(scene.resets, 1);
});

test('a lost utility context is replaced on the next snapshot', () => {
  const { snaps, utilityContexts } = harness();
  snaps.canvas({ width: 2, height: 2 }, () => {});
  utilityContexts[0]!.lost = true;
  assert.ok(snaps.canvas({ width: 2, height: 2 }, () => {}));
  assert.equal(utilityContexts.length, 2);
});
