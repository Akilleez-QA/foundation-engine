import test from 'node:test';
import assert from 'node:assert/strict';
import {createRendererPool, type PoolRenderer, type RendererPoolOptions} from './renderer-pool';
import {must} from '../../testing/must';

/** A minimal element: children, attributes, listeners with AbortSignal removal. */
class El {
  children: El[] = [];
  parent: El | null = null;
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  hidden = false;
  width = 300;
  height = 150;
  onpointermove: unknown = null;
  listeners: {type: string; fn: (e: unknown) => void}[] = [];
  constructor(
    readonly tag: string,
    readonly root?: El,
  ) {}
  get isConnected(): boolean {
    let n: El | null = this;
    while (n) {
      if (n.tag === 'body') return true;
      n = n.parent;
    }
    return false;
  }
  append(c: El) {
    c.remove();
    c.parent = this;
    this.children.push(c);
  }
  prepend(c: El) {
    c.remove();
    c.parent = this;
    this.children.unshift(c);
  }
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  getAttributeNames() {
    return [...this.attrs.keys()];
  }
  addEventListener(type: string, fn: (e: unknown) => void, o?: {signal?: AbortSignal}) {
    const l = {type, fn};
    this.listeners.push(l);
    o?.signal?.addEventListener('abort', () => {
      this.listeners = this.listeners.filter(x => x !== l);
    });
  }
  dispatch(type: string) {
    const e = {type, preventDefault() {}};
    for (const l of [...this.listeners]) if (l.type === type) l.fn(e);
  }
  getBoundingClientRect() {
    return {left: 0, top: 0, width: 100, height: 100};
  }
}

interface FakeGL {
  lost: boolean;
  made: number;
  deleted: number;
  canvas: El;
  [k: string]: unknown;
}
function fakeGL(canvas: El): FakeGL {
  const gl: FakeGL = {
    lost: false,
    made: 0,
    deleted: 0,
    canvas,
    LINK_STATUS: 35714,
    linkProgram() {},
    useProgram() {},
    getProgramParameter: () => true,
    isContextLost: () => gl.lost,
    getExtension: () => ({
      loseContext() {
        gl.lost = true;
        canvas.dispatch('webglcontextlost');
      },
      restoreContext() {
        gl.lost = false;
        canvas.dispatch('webglcontextrestored');
      },
    }),
  };
  for (const k of [
    'Texture',
    'Buffer',
    'Framebuffer',
    'Renderbuffer',
    'VertexArray',
    'Program',
    'Shader',
    'Query',
    'Sampler',
  ]) {
    gl['create' + k] = () => {
      gl.made++;
      return {k};
    };
    gl['delete' + k] = () => {
      gl.deleted++;
    };
  }
  return gl;
}

function harness(extra: Partial<RendererPoolOptions> = {}) {
  const body = new El('body');
  const doc = {body, createElement: (t: string) => new El(t)} as unknown as Document;
  const contexts: FakeGL[] = [];
  const renderers: (PoolRenderer & {disposed: boolean; lostForced: boolean; toneMappingExposure: number})[] = [];
  const createRenderer = (canvas?: HTMLCanvasElement, context?: WebGL2RenderingContext): PoolRenderer => {
    const c = (canvas as unknown as El) ?? new El('canvas');
    let gl = context as unknown as FakeGL | undefined;
    if (!gl) {
      gl = fakeGL(c);
      contexts.push(gl);
    }
    const g = gl;
    const r = {
      domElement: c,
      disposed: false,
      lostForced: false,
      toneMappingExposure: 1,
      debug: {checkShaderErrors: true},
      shadowMap: {enabled: false, type: 0},
      info: {memory: {textures: 0, geometries: 0}, programs: []},
      getContext: () => g,
      dispose() {
        r.disposed = true;
      },
      forceContextLoss() {
        r.lostForced = true;
        g.lost = true;
      },
      resetState() {},
      /** A scene uploading something and never deleting it. */
      upload() {
        (g.createTexture as () => unknown)();
        r.info.memory.textures++;
      },
    };
    renderers.push(r as never);
    return r as unknown as PoolRenderer;
  };
  const pool = createRendererPool({
    createRenderer,
    pixelRatio: () => {},
    doc,
    nextFrame: fn => {
      fn();
      return () => {};
    },
    ...extra,
  });
  const host = () => {
    const h = new El('div');
    body.append(h);
    return h as unknown as HTMLElement;
  };
  return {pool, body, contexts, renderers, host};
}

test('five world leases in a row share one context, each with a fresh renderer', () => {
  const {pool, contexts, renderers, host} = harness();
  for (let i = 0; i < 5; i++) {
    const s = pool.lease({role: 'world', host: host()})!;
    assert.ok(s.pooled);
    s.release();
  }
  assert.equal(contexts.length, 1);
  assert.equal(pool.stats().created, 1);
  assert.equal(renderers.length, 5);
  assert.ok(
    renderers.every(r => r.disposed && !r.lostForced),
    'every lease renderer disposed, the context kept',
  );
});

test('a lease moves the canvas into its host; a release parks it as a fresh canvas', () => {
  const {pool, body, host} = harness();
  const h = host();
  const s = pool.lease({role: 'world', host: h, insert: 'prepend'})!;
  const canvas = s.canvas as unknown as El;
  assert.equal(canvas.parent, h as unknown as El);
  canvas.setAttribute('aria-label', 'home');
  canvas.style.cursor = 'pointer';
  canvas.width = 1280;
  canvas.onpointermove = () => {};
  s.release();
  assert.equal(canvas.parent?.dataset.rendererPool, 'parking');
  assert.ok(canvas.isConnected, 'parked in the page');
  assert.deepEqual(canvas.getAttributeNames(), []);
  assert.equal(canvas.width, 300);
  assert.equal(canvas.height, 150);
  assert.equal(canvas.onpointermove, null, 'handler properties do not follow the canvas to the next scene');
  assert.ok(body.children.length >= 1);
});

test('the render profile is reset on every acquire (nothing bleeds between scenes)', () => {
  const {pool, host} = harness();
  const a = pool.lease({role: 'world', host: host(), profile: {toneMappingExposure: 1.3}})!;
  assert.equal(a.renderer.toneMappingExposure, 1.3);
  a.renderer.toneMappingExposure = 7;
  a.renderer.localClippingEnabled = true;
  a.release();
  const b = pool.lease({role: 'world', host: host()})!;
  assert.notEqual(b.renderer, a.renderer);
  assert.equal(b.renderer.toneMappingExposure, 1, 'a fresh renderer: three defaults');
  assert.equal(b.renderer.localClippingEnabled, undefined);
});

test('a release deletes the GL objects its lease left behind, and audits them', () => {
  const {pool, contexts, renderers, host} = harness();
  const s = pool.lease({role: 'world', host: host()})!;
  const r = renderers[0] as unknown as {upload(): void};
  r.upload();
  r.upload();
  s.release();
  assert.equal(contexts[0]!.deleted, 2);
  assert.deepEqual(pool.stats().lastRelease, {textures: 2, geometries: 0, programs: 0, glObjects: 2});
});

test('a second world lease while one is held overflows to its own context and frees it', () => {
  const {pool, contexts, renderers, host} = harness();
  const a = pool.lease({role: 'world', host: host()})!;
  const b = pool.lease({role: 'world', host: host()})!;
  assert.ok(!b.pooled);
  assert.equal(contexts.length, 2);
  b.release();
  assert.ok(renderers[1]!.lostForced);
  a.release();
  assert.equal(pool.stats().overflows, 1);
  assert.equal(pool.stats().contexts, 1);
});

test('a lost context is never handed on: the next lease recreates it', () => {
  const {pool, contexts, host} = harness();
  const a = pool.lease({role: 'world', host: host()})!;
  let heard = 0;
  a.onLost(() => heard++);
  (contexts[0]!.getExtension as () => {loseContext(): void})().loseContext();
  assert.equal(heard, 1);
  assert.equal(pool.state, 'lost');
  a.release();
  const b = pool.lease({role: 'world', host: host()})!;
  assert.equal(contexts.length, 2);
  assert.notEqual(b.canvas, a.canvas);
  assert.equal(pool.state, 'ok');
  assert.equal(pool.stats().losses, 1);
  b.release();
});

test('a parked context lost (then restored) before the next lease', () => {
  const {pool, contexts, host} = harness();
  pool.lease({role: 'world', host: host()})!.release();
  const ext = (contexts[0]!.getExtension as () => {loseContext(): void})();
  ext.loseContext();
  const b = pool.lease({role: 'world', host: host()})!;
  assert.equal(contexts.length, 2, 'a lost parked context is retired');
  b.release();
});

test('settle retires a parked world context (a staged scene brought its own renderer); a leased one stays', () => {
  const {pool, contexts, host} = harness();
  const a = pool.lease({role: 'world', host: host()})!;
  pool.settle();
  assert.equal(pool.stats().contexts, 1);
  a.release();
  pool.settle();
  assert.equal(pool.stats().contexts, 0);
  assert.ok(contexts[0]!.lost, 'forceContextLoss path: the context is released at once');
  assert.ok(!(a.canvas as unknown as El).isConnected);
  pool.lease({role: 'world', host: host()})!.release();
  assert.equal(contexts.length, 2);
});

test('the recycle valve retires a context whose lease left too much behind', () => {
  const {pool, contexts, renderers, host} = harness({valve: {textures: 1, geometries: 100, every: 0}});
  const s = pool.lease({role: 'world', host: host()})!;
  const r = renderers[0] as unknown as {upload(): void};
  r.upload();
  r.upload();
  s.release();
  assert.equal(pool.stats().recycles, 1);
  assert.ok(contexts[0]!.lost);
  pool.lease({role: 'world', host: host()})!.release();
  assert.equal(contexts.length, 2);
});

test('the lower-tier valve recycles every N leases', () => {
  const {pool, contexts, host} = harness({valve: {textures: 1e9, geometries: 1e9, every: 3}});
  for (let i = 0; i < 6; i++) pool.lease({role: 'world', host: host()})!.release();
  assert.equal(contexts.length, 2);
  assert.equal(pool.stats().recycles, 2);
});

test('a lease owned by a context is released with it; release is idempotent', () => {
  const {pool, host} = harness();
  const owned: {dispose(): void}[] = [];
  const s = pool.lease({
    role: 'world',
    host: host(),
    ctx: {
      own: d => {
        owned.push(d);
        return d;
      },
    },
  })!;
  assert.equal(owned[0], s);
  owned[0]!.dispose();
  s.release();
  assert.equal(pool.stats().leases, 1);
  assert.equal(pool.stats().contexts, 1);
});

test('hold: nothing to hold without a leased, live world context', async () => {
  const {pool, host} = harness();
  assert.equal(await pool.hold(), null);
  pool.lease({role: 'world', host: host()})!.release();
  assert.equal(await pool.hold(), null);
});

test('lease returns null (acquire rejects) when WebGL cannot start', async () => {
  const pool = createRendererPool({
    createRenderer: () => {
      throw Error('no webgl');
    },
    pixelRatio: () => {},
  });
  assert.equal(pool.lease({role: 'world', host: {} as HTMLElement}), null);
  await assert.rejects(pool.acquire({role: 'world', host: {} as HTMLElement}));
});

test('shell handover and probes do not construct a pool, then address the existing render owner', async () => {
  const {getAppRendererPool, settleAppRendererPool, rendererPoolStats} = await import('./app-renderer-pool');
  assert.equal(rendererPoolStats(), undefined);
  settleAppRendererPool();
  settleAppRendererPool();
  assert.equal(rendererPoolStats(), undefined, 'nonrendering scene handovers leave the pool absent');

  const {pool, contexts, host} = harness();
  let constructions = 0;
  const factory = () => {
    constructions++;
    return pool;
  };
  assert.equal(getAppRendererPool(factory), pool);
  assert.equal(getAppRendererPool(factory), pool);
  assert.equal(constructions, 1);
  const {appRenderers, rendererPoolStats: legacyStats} = await import('./renderer-pool');
  assert.equal(appRenderers(), pool, 'render consumers share the same owner as shell diagnostics');
  assert.deepEqual(legacyStats(), rendererPoolStats());

  const lease = pool.lease({role: 'world', host: host()})!;
  settleAppRendererPool();
  assert.equal(rendererPoolStats()?.contexts, 1, 'active lease survives handover settlement');
  lease.release();
  settleAppRendererPool();
  assert.equal(rendererPoolStats()?.contexts, 0, 'released surface is retired by the original owner');
  assert.equal(must(contexts[0]).lost, true);
  assert.equal(constructions, 1);
});

test('world program readiness retires on release before context handoff', async () => {
  const h = harness(),
    surface = h.pool.lease({role: 'world', host: h.host()})!;
  const gl = surface.renderer.getContext() as unknown as FakeGL;
  gl.getExtension = (name: string) => (name === 'KHR_parallel_shader_compile' ? {COMPLETION_STATUS_KHR: 0x91b1} : null);
  gl.getProgramParameter = () => false;
  (gl.createProgram as () => object)();
  const oldRequest = globalThis.setTimeout,
    oldCancel = globalThis.clearTimeout;
  let scheduled: (() => void) | undefined;
  globalThis.setTimeout = ((fn: () => void) => {
    scheduled = fn;
    return 1;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = () => {
    scheduled = undefined;
  };
  try {
    const ready = surface.programsReady!(new AbortController().signal);
    surface.release();
    assert.equal(await ready, 'retired');
    assert.equal(scheduled, undefined);
    const successor = h.pool.lease({role: 'world', host: h.host()})!;
    assert.equal(await successor.programsReady!(new AbortController().signal), 'ready');
    successor.release();
  } finally {
    globalThis.setTimeout = oldRequest;
    globalThis.clearTimeout = oldCancel;
  }
});

test('world readiness is one pending operation per lease and context restore gets a fresh lifetime', async () => {
  const h = harness(),
    surface = h.pool.lease({role: 'world', host: h.host()})!;
  const gl = surface.renderer.getContext() as unknown as FakeGL;
  gl.getExtension = () => ({COMPLETION_STATUS_KHR: 0x91b1});
  const stale = (gl.createProgram as () => object)();
  gl.getProgramParameter = () => false;
  const oldRequest = globalThis.setTimeout,
    oldCancel = globalThis.clearTimeout;
  let serial = 0;
  const frames = new Map<number, () => void>();
  globalThis.setTimeout = ((fn: () => void) => {
    frames.set(++serial, fn);
    return serial;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    frames.delete(id);
  }) as unknown as typeof clearTimeout;
  try {
    const first = surface.programsReady!(new AbortController().signal),
      second = surface.programsReady!(new AbortController().signal);
    assert.equal(await first, 'retired');
    assert.equal(frames.size, 1);
    gl.lost = true;
    gl.canvas.dispatch('webglcontextlost');
    assert.equal(await second, 'retired');
    assert.equal(frames.size, 0);
    gl.lost = false;
    gl.canvas.dispatch('webglcontextrestored');
    const fresh = (gl.createProgram as () => object)();
    gl.getProgramParameter = (program: object) => {
      assert.notEqual(program, stale, 'invalid pre-loss handle must not be queried');
      assert.equal(program, fresh);
      return true;
    };
    assert.equal(await surface.programsReady!(new AbortController().signal), 'ready');
  } finally {
    surface.release();
    globalThis.setTimeout = oldRequest;
    globalThis.clearTimeout = oldCancel;
  }
});

test('overflow world readiness retires without a frame on loss and restores independently', async () => {
  const h = harness(),
    primary = h.pool.lease({role: 'world', host: h.host()})!,
    overflow = h.pool.lease({role: 'world', host: h.host()})!;
  assert.equal(primary.pooled, true);
  assert.equal(overflow.pooled, false);
  const gl = overflow.renderer.getContext() as unknown as FakeGL,
    primaryGl = primary.renderer.getContext() as unknown as FakeGL;
  gl.getExtension = () => ({COMPLETION_STATUS_KHR: 0x91b1});
  gl.getProgramParameter = () => false;
  const stale = (gl.createProgram as () => object)();
  primaryGl.getExtension = () => null;
  let losses = 0,
    restores = 0;
  overflow.onLost(() => losses++);
  overflow.onRestored(() => restores++);
  const oldRequest = globalThis.setTimeout,
    oldCancel = globalThis.clearTimeout;
  const frames = new Map<number, () => void>();
  let serial = 0;
  globalThis.setTimeout = ((fn: () => void) => {
    frames.set(++serial, fn);
    return serial;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    frames.delete(id);
  }) as unknown as typeof clearTimeout;
  try {
    const pending = overflow.programsReady!(new AbortController().signal);
    assert.equal(frames.size, 1);
    gl.lost = true;
    gl.canvas.dispatch('webglcontextlost');
    assert.equal(await pending, 'retired');
    assert.equal(frames.size, 0, 'no scheduled task is needed to retire a hidden tab');
    assert.equal(losses, 1);
    assert.equal(
      await primary.programsReady!(new AbortController().signal),
      'unsupported',
      'separate live world owner unaffected',
    );
    gl.lost = false;
    gl.canvas.dispatch('webglcontextrestored');
    assert.equal(restores, 1);
    const fresh = (gl.createProgram as () => object)();
    gl.getProgramParameter = (program: object) => {
      assert.notEqual(program, stale);
      assert.equal(program, fresh);
      return true;
    };
    assert.equal(await overflow.programsReady!(new AbortController().signal), 'ready');
    overflow.release();
    gl.canvas.dispatch('webglcontextlost');
    gl.canvas.dispatch('webglcontextrestored');
    assert.equal(losses, 1);
    assert.equal(restores, 1);
    assert.equal(await overflow.programsReady!(new AbortController().signal), 'retired');
  } finally {
    overflow.release();
    primary.release();
    globalThis.setTimeout = oldRequest;
    globalThis.clearTimeout = oldCancel;
  }
});

test('world diagnostics policy permits explicit full checks and a failure-only production policy', () => {
  const full = harness({programDiagnostics: 'full'}),
    a = full.pool.lease({role: 'world', host: new El('host') as never});
  assert.equal(full.renderers[0]!.debug!.checkShaderErrors, true);
  a?.release();
  const light = harness({programDiagnostics: 'failure-only'}),
    b = light.pool.lease({role: 'world', host: new El('host') as never});
  assert.equal(light.renderers[0]!.debug!.checkShaderErrors, false);
  b?.release();
});

test('world frame completion retires synchronously on release and context loss', async () => {
  for (const mode of ['release', 'loss']) {
    const f = harness(),
      surface = f.pool.lease({role: 'world', host: new El('host') as never})!,
      gl = f.contexts[0]!;
    let polls = 0,
      deletes = 0;
    Object.assign(gl, {
      SYNC_GPU_COMMANDS_COMPLETE: 1,
      fenceSync: () => ({}),
      flush() {},
      deleteSync() {
        deletes++;
      },
      clientWaitSync() {
        polls++;
        return 0;
      },
    });
    const pending = surface.frameReady!(new AbortController().signal);
    if (mode === 'release') surface.release();
    else {
      gl.lost = true;
      gl.canvas.dispatch('webglcontextlost');
    }
    assert.equal(await pending, 'retired');
    assert.equal(polls, 0);
    assert.equal(deletes, mode === 'release' ? 1 : 0);
    surface.release();
  }
});
