import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererPool, type PoolRenderer } from './renderer-pool';

/** A canvas stand-in: size, listeners, a recording 2D context. */
class Canvas {
  width = 300; height = 150; parent: Host | null = null; style: Record<string, string> = {};
  listeners: { type: string; fn: (e: { preventDefault(): void }) => void; signal?: AbortSignal }[] = [];
  draws: unknown[][] = [];
  ctx2d = { globalCompositeOperation: 'source-over', drawImage: (...a: unknown[]) => { this.draws.push(a); } };
  getContext(kind: string) { return kind === '2d' ? this.ctx2d : null; }
  addEventListener(type: string, fn: (e: { preventDefault(): void }) => void, o?: { signal?: AbortSignal }) {
    if (o?.signal?.aborted) return;
    this.listeners.push({ type, fn, signal: o?.signal });
  }
  dispatch(type: string) { for (const l of [...this.listeners]) if (l.type === type && !l.signal?.aborted) l.fn({ preventDefault() {} }); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
}
class Host { children: Canvas[] = []; append(c: Canvas) { c.remove(); c.parent = this; this.children.push(c); } prepend(c: Canvas) { c.remove(); c.parent = this; this.children.unshift(c); } }

interface FakeGL { lost: boolean; made: number; deleted: number; canvas: Canvas; [k: string]: unknown }
function fakeGL(canvas: Canvas): FakeGL {
  const gl: FakeGL = {
    lost: false, made: 0, deleted: 0, canvas,
    LINK_STATUS:35714,linkProgram(){},useProgram(){},getProgramParameter:()=>true,
    isContextLost: () => gl.lost,
    getExtension: () => ({ loseContext() { gl.lost = true; canvas.dispatch('webglcontextlost'); }, restoreContext() { gl.lost = false; canvas.dispatch('webglcontextrestored'); } }),
  };
  for (const k of ['Texture', 'Buffer', 'Program']) {
    gl['create' + k] = () => { gl.made++; return { k }; };
    gl['delete' + k] = () => { gl.deleted++; };
  }
  return gl;
}

type FakeRenderer = PoolRenderer & { log: string[]; disposed: boolean; target: unknown; clearSet: [number, number] | null; upload(): void; setSize(w: number, h: number): void };

function harness() {
  const contexts: FakeGL[] = [];
  const renderers: FakeRenderer[] = [];
  const log: string[] = [];
  const doc = { body: new Host(), createElement: () => new Canvas() } as unknown as Document;
  const pool = createRendererPool({
    doc, pixelRatio: () => {}, nextFrame: fn => { fn(); return () => {}; },
    createStageContext: antialias => { const canvas = new Canvas(); const gl = fakeGL(canvas); gl.antialias = antialias; contexts.push(gl); return { canvas: canvas as unknown as HTMLCanvasElement, gl: gl as unknown as WebGL2RenderingContext }; },
    createRenderer: (canvas, context) => {
      const view = canvas as unknown as Canvas, g = context as unknown as FakeGL;
      const id = renderers.length;
      const r: FakeRenderer = {
        domElement: canvas!, log, disposed: false, target: null, clearSet: null,
        info: { memory: { textures: 0, geometries: 0 }, programs: [] },
        getContext: () => context!,
        dispose() { r.disposed = true; log.push(`dispose${id}`); },
        forceContextLoss() { log.push(`lose${id}`); g.lost = true; },
        resetState() { r.target = null; log.push(`reset${id}`); },
        render() { log.push(`render${id}`); },
        getRenderTarget: () => r.target,
        setRenderTarget(t: unknown) { r.target = t; },
        setClearColor(c: number, a: number) { r.clearSet = [c, a]; },
        setSize(w: number, h: number) { view.width = w; view.height = h; },
        upload() { (g.createTexture as () => unknown)(); r.info.memory.textures++; },
      } as unknown as FakeRenderer;
      renderers.push(r);
      return r;
    },
  });
  return { pool, contexts, renderers, log };
}
const flushMicrotasks = () => new Promise<void>(r => setTimeout(r, 0));

test('stage views share one context: the projector sky and its panorama, each with its own renderer and canvas', () => {
  const { pool, contexts, renderers } = harness();
  const host = new Host();
  const sky = pool.lease({ role: 'stage', host: host as unknown as HTMLElement })!;
  const panorama = pool.lease({ role: 'stage', host: host as unknown as HTMLElement, insert: 'prepend' })!;
  assert.equal(contexts.length, 1);
  assert.equal(pool.stats().contexts, 1);
  assert.equal(renderers.length, 2);
  assert.notEqual(sky.canvas, panorama.canvas);
  assert.equal(sky.role, 'stage');
  assert.deepEqual(host.children, [panorama.canvas, sky.canvas]);
  sky.release(); panorama.release();
  assert.equal(pool.stats().contexts, 1, 'the idle stage context is parked, not lost');
  pool.lease({ role: 'stage' })!.release();
  assert.equal(contexts.length, 1, 'the next panel reuses it');
});

test('a render is copied from the lower-left of the shared buffer into the view canvas', async () => {
  const { pool, contexts, renderers } = harness();
  const a = pool.lease({ role: 'stage' })!;
  renderers[0]!.setSize(200, 100);
  a.renderer.render({} as never, {} as never);
  const shared = contexts[0]!.canvas;
  assert.ok(shared.width >= 200 && shared.height >= 100, 'the shared buffer fits the view');
  await flushMicrotasks();
  const view = a.canvas as unknown as Canvas;
  assert.equal(view.draws.length, 1);
  assert.deepEqual(view.draws[0]!.slice(1), [0, shared.height - 100, 200, 100, 0, 0, 200, 100]);
  assert.equal(view.ctx2d.globalCompositeOperation, 'source-over');
  a.release();
});

test('another view drawing first copies the pending one out and resets the state cache (render target kept)', () => {
  const { pool, renderers, log } = harness();
  const a = pool.lease({ role: 'stage' })!, b = pool.lease({ role: 'stage' })!;
  renderers[0]!.setSize(10, 10); renderers[1]!.setSize(20, 20);
  a.renderer.render({} as never, {} as never);
  const target = {};
  renderers[1]!.target = target;
  b.renderer.render({} as never, {} as never);
  assert.equal((a.canvas as unknown as Canvas).draws.length, 1, 'a was copied before b drew');
  assert.equal(renderers[1]!.target, target, 'the render target survives the state reset');
  assert.deepEqual(log.filter(x => x.startsWith('reset') || x.startsWith('render')), ['reset0', 'render0', 'reset1', 'render1']);
  a.renderer.render({} as never, {} as never);
  assert.ok(log.includes('reset0') && log.lastIndexOf('reset0') > log.indexOf('render1'), 'a takes the context back');
  a.release(); b.release();
});

test('an opaque view clears to opaque black; a transparent one keeps alpha 0', () => {
  const { pool, renderers } = harness();
  pool.lease({ role: 'stage' })!;
  pool.lease({ role: 'stage', alpha: true })!;
  assert.deepEqual(renderers[0]!.clearSet, [0, 1]);
  assert.equal(renderers[1]!.clearSet, null);
});

test('renderer.dispose() ends the lease; forceContextLoss never loses the shared context; a late frame draws nothing', async () => {
  const { pool, contexts, renderers, log } = harness();
  const a = pool.lease({ role: 'stage' })!;
  a.renderer.forceContextLoss();
  assert.ok(!contexts[0]!.lost);
  a.renderer.dispose();
  assert.ok(renderers[0]!.disposed);
  a.release();
  assert.equal(log.filter(x => x === 'dispose0').length, 1, 'three disposed once');
  a.renderer.render({} as never, {} as never);
  assert.ok(!log.includes('render0'));
  await flushMicrotasks();
  assert.equal((a.canvas as unknown as Canvas).draws.length, 0);
});

test('GL objects left behind are swept once no view is left, not while another view still draws', () => {
  const { pool, contexts, renderers } = harness();
  const a = pool.lease({ role: 'stage' })!, b = pool.lease({ role: 'stage' })!;
  renderers[0]!.upload(); renderers[1]!.upload();
  a.release();
  assert.equal(contexts[0]!.deleted, 0, 'b\'s objects are still in use');
  b.release();
  assert.equal(contexts[0]!.deleted, 2);
  assert.equal(pool.stats().lastRelease!.glObjects, 2);
});

test('settle retires an idle stage context, never a leased one', () => {
  const { pool, contexts } = harness();
  const a = pool.lease({ role: 'stage' })!;
  pool.settle();
  assert.ok(!contexts[0]!.lost);
  a.release();
  pool.settle();
  assert.ok(contexts[0]!.lost);
  assert.equal(pool.stats().contexts, 0);
});

test('antialias picks the stage context; an idle one of the other kind is retired, not kept alongside', () => {
  const { pool, contexts } = harness();
  pool.lease({ role: 'stage', antialias: false })!.release();
  const b = pool.lease({ role: 'stage' })!;
  assert.equal(contexts.length, 2);
  assert.ok(contexts[0]!.lost);
  assert.equal(pool.stats().contexts, 1);
  b.release();
});

test('context loss is forwarded to every view; a lost context is never handed to a new lease', () => {
  const { pool, contexts } = harness();
  const a = pool.lease({ role: 'stage' })!;
  let heard = 0; a.onLost(() => heard++);
  (contexts[0]!.getExtension as () => { loseContext(): void })().loseContext();
  assert.equal(heard, 1);
  const b = pool.lease({ role: 'stage' })!;
  assert.equal(contexts.length, 2);
  a.release(); b.release();
  assert.equal(pool.stats().contexts, 1);
});

test('world and stage leases are independent', () => {
  const { pool } = harness();
  const s = pool.lease({ role: 'stage' })!;
  assert.equal(pool.stats().leases, 1);
  s.release();
});

test('a world lease (a scene change) retires an idle stage context, never a leased one', () => {
  const { pool, contexts } = harness();
  const held = pool.lease({ role: 'stage' })!;
  pool.lease({ role: 'world', host: new Host() as unknown as HTMLElement });
  assert.ok(!contexts[0]!.lost, 'a leased stage context stays');
  held.release();
  pool.lease({ role: 'world', host: new Host() as unknown as HTMLElement });
  assert.ok(contexts[0]!.lost, 'the idle one is not kept across the scene change');
});

test('shared stage validation survives one view release but retires all old programs on loss',()=>{
 const {pool,contexts}=harness(),a=pool.lease({role:'stage'})!,b=pool.lease({role:'stage'})!;
 const gl=contexts[0]! as unknown as WebGL2RenderingContext;
 const program=gl.createProgram()!;gl.linkProgram(program);gl.useProgram(program);
 a.release();assert.doesNotThrow(()=>gl.useProgram(program));
 const fake=contexts[0]!;fake.lost=true;fake.canvas.dispatch('webglcontextlost');fake.lost=false;fake.canvas.dispatch('webglcontextrestored');
 assert.throws(()=>gl.useProgram(program),/retired/);assert.throws(()=>gl.linkProgram(program),/retired/);
 const fresh=gl.createProgram()!;gl.linkProgram(fresh);assert.doesNotThrow(()=>gl.useProgram(fresh));b.release();
});
