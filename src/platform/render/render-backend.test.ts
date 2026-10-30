import test from 'node:test';
import assert from 'node:assert/strict';
import {briefProblems, defineBuild, type BuildInput} from '../../author/build';
import {appRenderBackend, selectAppRenderBackend} from './app-renderer-pool';
import {webglBackend} from './backends/webgl/backend';
import {createRendererPool, type PoolBackend, type PoolRenderer} from './renderer-pool';
import {
  availableRenderBackend,
  DEFAULT_RENDER_BACKEND,
  RenderBackendUnavailableError,
  type RenderBackend,
  type RenderBackendCapabilities,
} from './render-backend';

const input = (): BuildInput => ({
  goal: 'Show one scene',
  pitch: 'A creator chooses the backend',
  genre: 'custom',
  coreLoop: ['Look'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard']},
  success: [{id: 'S1', check: 'The scene becomes visible', how: 'manual'}],
});

test('render backend: a brief that says nothing selects webgl2, and so does the app', () => {
  assert.equal(DEFAULT_RENDER_BACKEND, 'webgl2');
  assert.equal(defineBuild(input()).render.backend, 'webgl2');
  assert.equal(defineBuild({...input(), render: {}}).render.backend, 'webgl2');
  assert.equal(defineBuild({...input(), render: {backend: 'webgl2'}}).render.backend, 'webgl2');
  assert.equal(appRenderBackend(), 'webgl2');
  selectAppRenderBackend('webgl2');
  assert.equal(appRenderBackend(), 'webgl2');
  assert.equal(availableRenderBackend('webgl2'), 'webgl2');
});

test('render backend: webgpu is refused as not available yet, with a clear message and no fallback', () => {
  const message =
    /render\.backend 'webgpu' is not available yet: the WebGPU backend has not landed \(ADR 0078\)\. Select 'webgl2' \(the default\)/;
  assert.throws(() => defineBuild({...input(), render: {backend: 'webgpu'}}), message);
  assert.deepEqual(
    briefProblems({...input(), render: {backend: 'webgpu'}}).filter(p => p.startsWith('render.')).length,
    1,
  );
  assert.throws(
    () => selectAppRenderBackend('webgpu'),
    (e: unknown) => e instanceof RenderBackendUnavailableError && message.test(e.message) && e.backend === 'webgpu',
  );
  assert.throws(() => availableRenderBackend('webgpu'), RenderBackendUnavailableError);
  assert.equal(appRenderBackend(), 'webgl2', 'a refused selection leaves the default in place');
  assert.match(
    briefProblems({...input(), render: {backend: 'vulkan'}}).join('\n'),
    /render\.backend "vulkan" is unknown: expected 'webgl2' or 'webgpu'/,
  );
  assert.match(briefProblems({...input(), render: 'webgpu'}).join('\n'), /render: expected an object/);
});

/** Every member of the backend contract, checked exhaustively at compile time against the interface. */
const CONTRACT: Record<keyof PoolBackend, true> = {
  id: true,
  capabilities: true,
  lostEvent: true,
  restoredEvent: true,
  createRenderer: true,
  contextOf: true,
  createStageContext: true,
  track: true,
  deleteObject: true,
  isLost: true,
  lose: true,
  programsReady: true,
  frameReadiness: true,
};
const CAPABILITIES: Record<keyof RenderBackendCapabilities, true> = {
  multiCanvas: true,
  syncReadback: true,
  programIntrospection: true,
  multiDraw: true,
};

test('render backend: the WebGL2 implementation is exactly the backend contract', () => {
  const contract: RenderBackend<WebGL2RenderingContext, PoolRenderer> = webglBackend;
  assert.deepEqual(Object.keys(contract).sort(), Object.keys(CONTRACT).sort());
  const values: Record<string, unknown> = {...contract};
  for (const key of Object.keys(CONTRACT)) {
    const kind = typeof values[key];
    assert.ok(
      ['id', 'capabilities', 'lostEvent', 'restoredEvent'].includes(key) ? kind !== 'function' : kind === 'function',
      `${key} is ${kind}`,
    );
  }
  assert.equal(contract.id, 'webgl2');
  assert.deepEqual(Object.keys(contract.capabilities).sort(), Object.keys(CAPABILITIES).sort());
  assert.deepEqual(contract.capabilities, {
    multiCanvas: true,
    syncReadback: true,
    programIntrospection: true,
    multiDraw: true,
  });
  assert.equal(contract.lostEvent, 'webglcontextlost');
  assert.equal(contract.restoredEvent, 'webglcontextrestored');
});

/** A WebGL2 context stand-in: what the WebGL backend's tracking, loss and readiness call. */
function fakeContext() {
  const calls: string[] = [];
  let lost = false;
  const gl: Record<string, unknown> = {
    LINK_STATUS: 35714,
    linkProgram() {},
    useProgram() {},
    getProgramParameter: () => true,
    isContextLost: () => lost,
    getExtension: (name: string) =>
      name === 'WEBGL_lose_context'
        ? {
            loseContext() {
              calls.push('loseContext');
              lost = true;
            },
          }
        : null,
  };
  for (const kind of ['Texture', 'Buffer', 'Program']) {
    gl['create' + kind] = () => {
      calls.push('create' + kind);
      return {kind};
    };
    gl['delete' + kind] = () => {
      calls.push('delete' + kind);
    };
  }
  return {gl, calls};
}

test('render backend: the WebGL2 implementation tracks, deletes, loses and reports readiness through its context', async () => {
  const {gl: raw, calls} = fakeContext();
  const gl = raw as never as WebGL2RenderingContext;
  const objects = webglBackend.track(gl);
  const texture = (raw.createTexture as () => object)();
  (raw.createBuffer as () => object)();
  (raw.deleteBuffer as (o: object) => void)({});
  assert.deepEqual([...objects.live.values()], ['deleteTexture', 'deleteBuffer']);
  webglBackend.deleteObject(gl, 'deleteTexture', texture);
  assert.deepEqual(
    [...objects.live.values()],
    ['deleteBuffer'],
    'a delete through the tracked entry point leaves the sweep',
  );
  assert.equal(webglBackend.isLost(gl), false);
  const readiness = webglBackend.frameReadiness(gl, () => true);
  assert.equal(await readiness.wait(new AbortController().signal), 'retired', 'a retired lease waits for nothing');
  webglBackend.lose(gl);
  assert.equal(webglBackend.isLost(gl), true);
  assert.equal(
    await webglBackend.programsReady(gl, objects, new AbortController().signal),
    'retired',
    'a lost context has no programs to wait for',
  );
  assert.deepEqual(calls, ['createTexture', 'createBuffer', 'deleteBuffer', 'deleteTexture', 'loseContext']);
});

/** A canvas stand-in with the listener surface the pool uses. */
class Canvas {
  width = 300;
  height = 150;
  style: Record<string, string> = {};
  private listeners: {type: string; fn: (e: {preventDefault(): void}) => void}[] = [];
  addEventListener(type: string, fn: (e: {preventDefault(): void}) => void, o?: {signal?: AbortSignal}) {
    const l = {type, fn};
    this.listeners.push(l);
    o?.signal?.addEventListener('abort', () => {
      this.listeners = this.listeners.filter(x => x !== l);
    });
  }
  dispatch(type: string) {
    for (const l of [...this.listeners]) if (l.type === type) l.fn({preventDefault() {}});
  }
  getAttributeNames() {
    return [];
  }
  removeAttribute() {}
  remove() {}
}

test('render backend: the pool runs against any backend, through the contract only', () => {
  const log: string[] = [];
  const canvases: Canvas[] = [];
  const contexts = new Map<object, {lost: boolean}>();
  const backend: PoolBackend = {
    id: 'webgl2',
    capabilities: {multiCanvas: true, syncReadback: true, programIntrospection: true, multiDraw: true},
    lostEvent: 'fake-lost',
    restoredEvent: 'fake-restored',
    createRenderer(canvas, context) {
      const c =
        canvas ??
        (() => {
          const n = new Canvas();
          canvases.push(n);
          return n as never as HTMLCanvasElement;
        })();
      const gl =
        context ??
        (() => {
          const g = {} as WebGL2RenderingContext;
          contexts.set(g, {lost: false});
          return g;
        })();
      log.push(context ? 'renderer on pooled context' : 'renderer on new context');
      const r = {
        domElement: c,
        info: {memory: {textures: 0, geometries: 0}, programs: []},
        getContext: () => gl,
        dispose() {
          log.push('dispose');
        },
        forceContextLoss() {},
        resetState() {},
      };
      return r as never as PoolRenderer;
    },
    contextOf: r => r.getContext() as WebGL2RenderingContext,
    createStageContext() {
      throw Error('unused');
    },
    track() {
      log.push('track');
      const leaked = new Map<object, string>([[{}, 'deleteTexture']]);
      return {live: leaked, validation: {validate() {}, clear() {}}};
    },
    deleteObject(_gl, entry) {
      log.push(`delete ${entry}`);
    },
    isLost: gl => contexts.get(gl)?.lost ?? false,
    lose(gl) {
      log.push('lose');
      const c = contexts.get(gl);
      if (c) c.lost = true;
    },
    programsReady: () => Promise.resolve('ready'),
    frameReadiness: () => ({wait: () => Promise.resolve('ready'), retire() {}}),
  };
  const pool = createRendererPool({backend, pixelRatio: () => {}, shadows: () => {}});
  const host = {append() {}, prepend() {}} as never as HTMLElement;
  const lost: string[] = [];
  const first = pool.lease({role: 'world', host});
  assert.ok(first);
  first.onLost(() => lost.push('lost'));
  canvases[0]!.dispatch('webglcontextlost');
  assert.deepEqual(lost, [], "the pool listens for the backend's loss event, not WebGL's");
  canvases[0]!.dispatch('fake-lost');
  assert.deepEqual(lost, ['lost']);
  first.release();
  const second = pool.lease({role: 'world', host});
  assert.ok(second);
  second.release();
  pool.settle();
  assert.deepEqual(
    log,
    [
      'renderer on new context',
      'track',
      'dispose',
      'renderer on new context',
      'track',
      'dispose',
      'delete deleteTexture',
      'lose',
    ],
    'a lost context forgets its objects and is retired without another loss; a fresh one is swept, then retired through the backend',
  );
  assert.equal(pool.stats().losses, 1);
});
