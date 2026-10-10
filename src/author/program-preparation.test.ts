import test from 'node:test';
import assert from 'node:assert/strict';
import {must} from '../testing/must';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {FrameReadinessError} from '../platform/render/frame-readiness';
import {ProgramLinkError} from '../platform/render/program-validation';
// Execute the actual runtime preparation/restore blocks with a controllable pool,
// without creating a GPU context or reimplementing their lifetime logic.
const source = readFileSync(new URL('./runtime.ts', import.meta.url), 'utf8');
// Markers tolerate the whitespace a formatter may add or remove; each must be found, or the fixture runs nothing.
const find = (marker: string | RegExp, from = 0) => {
  const i = typeof marker === 'string' ? source.indexOf(marker, from) : from + source.slice(from).search(marker);
  assert.ok(i >= from, `runtime.ts marker ${String(marker).trim()}`);
  return i;
};
const prepare = source.slice(find(/ {6}let programsPrepared ?= ?false,/), find('      return {\n        ready,'));
const restore = source.slice(
  find('        contextRestored() {'),
  find('\n      };\n    },', find('        contextRestored() {')),
);
const draw = source.slice(find('        render(f: FrameInfo) {'), find('        activate() {'));
const step = source.slice(find('        update(f: FrameInfo) {'), find('        render(f: FrameInfo) {'));
// The runtime's own arrival callback (it runs the scene's enter()), cut from the enterActivity call: the last
// property, on one line or several, up to the call's closing `});`.
const arriveAt = find('    arrive: () =>'),
  arrival = source.slice(arriveAt, find('\n  });', arriveAt)).replace(/,\s*$/, '');
/** The visit's post-processing seam (scene-post.ts): `render` returns true when it drew the frame itself. */
interface PostStub {
  compile(): void;
  settled(ms: number): Promise<void>;
  render(): boolean;
}
const noPost = (): PostStub => ({compile() {}, settled: () => Promise.resolve(), render: () => false});
function fixture(
  frameReady?: () => Promise<string>,
  tap: {running(): boolean} | null = null,
  arrive = true,
  post: PostStub = noPost(),
) {
  const cards: unknown[] = [],
    layers: {modal?: string}[] = [];
  let compileError: Error | undefined, renderError: Error | undefined;
  const doc = {
    createElement: () => ({
      children: [] as unknown[],
      setAttribute() {},
      addEventListener() {},
      append(...nodes: unknown[]) {
        this.children.push(...nodes);
      },
      remove() {},
    }),
  };
  const pending: {resolve: (result: string) => void; reject: (error: Error) => void}[] = [],
    owner = new AbortController(),
    view = {dataset: {} as Record<string, string>, append: (node: unknown) => cards.push(node)},
    log: unknown[] = [];
  let compiled = 0,
    invalidated = 0,
    directRenders = 0,
    lost = false;
  const run = ts.transpile(
    `const POST_WAIT_MS=4000;const drawOverride=()=>false;let gpuTimer=null,dirty=true,frame=0,t=0,calm=false,frameMs=0,steps=0;const pressed={clear(){},endFrame(){}},gestures={sync(){},pointer:{pressed:false}},runner={frame(){steps++;},alpha:0},ctx={},particles={interpolate:()=>false};const three={},camera={},visit={current:()=>true};let arrived=false,activityStart,tapArrive,ctxRef=ctx,enteredAt=-1;scene.enter=()=>{enteredAt=steps;};${prepare}\nreturn {ready,state:()=>programsPrepared,steps:()=>steps,redraw:()=>{dirty=true;},enteredAt:()=>enteredAt,${arrival},${step}${draw}${restore}};`,
    {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None},
  );
  const api = new Function(
    'actx',
    'view',
    'renderer',
    'surface',
    'sync',
    's',
    'scene',
    'ProgramLinkError',
    'doc',
    'failureText',
    'FrameReadinessError',
    'tap',
    'post',
    run,
  )(
    {
      signal: owner.signal,
      leaving: () => owner.signal.aborted,
      invalidate: () => invalidated++,
      own: () => {},
      layer: (l: {modal?: string}) => layers.push(l),
      runId: 'run-test',
    },
    view,
    {
      compile: () => {
        compiled++;
        if (compileError) throw compileError;
      },
      render: () => {
        if (renderError) throw renderError;
        directRenders++;
      },
      getContext: () => ({isContextLost: () => lost}),
    },
    {frameReady, programsReady: () => new Promise<string>((resolve, reject) => pending.push({resolve, reject}))},
    () => {},
    {log: {error: (...args: unknown[]) => log.push(args)}},
    {id: 'test'},
    ProgramLinkError,
    doc,
    (key: string) => key,
    FrameReadinessError,
    tap,
    post,
  );
  if (arrive) api.arrive();
  return {
    api,
    pending,
    owner,
    view,
    log,
    cards,
    layers,
    compileThrows: (e: Error) => {
      compileError = e;
    },
    renderThrows: (e: Error) => {
      renderError = e;
    },
    lose: () => {
      lost = true;
    },
    get compiled() {
      return compiled;
    },
    get directRenders() {
      return directRenders;
    },
    get invalidated() {
      return invalidated;
    },
  };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
test('actual author runtime remains unprepared until pool readiness and rejects retired initial readiness', async () => {
  const f = fixture();
  assert.equal(f.compiled, 1);
  assert.equal(f.api.state(), false);
  f.pending[0]!.resolve('ready');
  await f.api.ready;
  assert.equal(f.api.state(), true);
  assert.equal(f.view.dataset.programReadiness, 'ready');
  const retired = fixture();
  retired.owner.abort();
  retired.pending[0]!.resolve('ready');
  await assert.rejects(retired.api.ready, /retired/);
  assert.equal(retired.api.state(), false);
});
test('actual restore fences stale outcomes and marks current failure as degraded without indefinite blank', async () => {
  const f = fixture();
  f.pending[0]!.resolve('ready');
  await f.api.ready;
  f.api.contextRestored();
  f.api.contextRestored();
  f.pending[1]!.reject(Error('old'));
  await turn();
  assert.equal(f.api.state(), false);
  assert.equal(f.log.length, 0);
  f.pending[2]!.reject(Error('driver'));
  await turn();
  assert.equal(f.api.state(), true);
  assert.equal(f.view.dataset.programReadiness, 'degraded');
  assert.equal(f.log.length, 1);
  f.api.contextRestored();
  f.lose();
  f.pending[3]!.reject(Error('lost'));
  await turn();
  assert.equal(f.api.state(), false, 'lost context never takes fallback');
  assert.equal(f.log.length, 1);
});

test('initial first draw failures reject ready, and synchronous restore link failures show owned recovery', async () => {
  const first = fixture();
  first.renderThrows(new ProgramLinkError('bad draw', []));
  first.pending[0]!.resolve('ready');
  await assert.rejects(first.api.ready, ProgramLinkError);
  assert.equal(first.api.state(), false);
  const restored = fixture();
  restored.pending[0]!.resolve('ready');
  await restored.api.ready;
  restored.compileThrows(new ProgramLinkError('bad restore', []));
  assert.doesNotThrow(() => restored.api.contextRestored());
  await turn();
  assert.equal(restored.api.state(), false);
  assert.equal(restored.view.dataset.programReadiness, 'failed');
  assert.equal(restored.cards.length, 1);
  assert.equal(must(restored.layers[0], 'layer').modal, 'scope');
  restored.api.contextRestored();
  await turn();
  assert.equal(restored.cards.length, 1, 'one owned recovery surface');
});

test('later generated shader failure stops rendering and surfaces one owned recovery card', async () => {
  const f = fixture();
  f.pending[0]!.resolve('ready');
  await f.api.ready;
  f.renderThrows(new ProgramLinkError('late variant', []));
  assert.equal(f.api.render(), false);
  assert.equal(f.api.state(), false);
  assert.equal(f.view.dataset.programReadiness, 'failed');
  assert.equal(f.cards.length, 1);
  assert.equal(f.api.render(), false);
  assert.equal(f.cards.length, 1);
  const ordinary = fixture();
  ordinary.pending[0]!.resolve('ready');
  await ordinary.api.ready;
  ordinary.renderThrows(Error('unrelated'));
  assert.throws(() => ordinary.api.render(), /unrelated/);
  assert.equal(ordinary.cards.length, 0);
});

test('actual author admission waits for initial GPU completion and refuses a retired frame', async () => {
  let resolve!: (value: string) => void;
  const f = fixture(
    () =>
      new Promise<string>(r => {
        resolve = r;
      }),
  );
  f.pending[0]!.resolve('ready');
  await turn();
  assert.equal(f.api.state(), false);
  resolve('ready');
  await f.api.ready;
  assert.equal(f.api.state(), true);
  const retired = fixture(() => Promise.resolve('retired'));
  retired.pending[0]!.resolve('ready');
  await assert.rejects(retired.api.ready, /frame preparation retired/);
  assert.equal(retired.api.state(), false);
  const failed = fixture(() => Promise.reject(new FrameReadinessError('fence failed')));
  failed.pending[0]!.resolve('ready');
  await assert.rejects(failed.api.ready, FrameReadinessError);
});

test('bounded initial preparation failure degrades to first-draw compilation instead of refusing the scene', async () => {
  const f = fixture();
  f.pending[0]!.reject(Error('Program readiness capacity exceeded'));
  await f.api.ready;
  assert.equal(f.api.state(), true);
  assert.equal(f.view.dataset.programReadiness, 'degraded');
  assert.equal(f.log.length, 1);
  assert.equal(f.cards.length, 0);
  const link = fixture();
  link.pending[0]!.reject(new ProgramLinkError('bad link', []));
  await assert.rejects(link.api.ready, ProgramLinkError);
  assert.equal(link.api.state(), false);
  assert.equal(link.log.length, 0);
  const retired = fixture();
  retired.owner.abort();
  retired.pending[0]!.reject(Error('timed out'));
  await assert.rejects(retired.api.ready, /timed out/);
  assert.equal(retired.api.state(), false);
  assert.equal(retired.log.length, 0);
});

test('systems do not step before initial preparation settles, so they cannot run long before scene arrival', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) f.api.update({dt: 0.016, calm: false});
  assert.equal(f.api.steps(), 0);
  f.pending[0]!.resolve('ready');
  await f.api.ready;
  f.api.update({dt: 0.016, calm: false});
  assert.equal(f.api.steps(), 1);
  const degraded = fixture();
  degraded.pending[0]!.reject(Error('Program readiness timed out'));
  await degraded.api.ready;
  degraded.api.update({dt: 0.016, calm: false});
  assert.equal(degraded.api.steps(), 1);
  const restored = fixture();
  restored.pending[0]!.resolve('ready');
  await restored.api.ready;
  restored.api.contextRestored();
  restored.api.update({dt: 0.016, calm: false});
  assert.equal(restored.api.steps(), 1, 'restore preparation does not pause started systems');
});

test('a dev/test tick tap holds the fixed lane until it reports running (SIM-01)', async () => {
  let running = false;
  const f = fixture(undefined, {running: () => running});
  f.pending[0]!.resolve('ready');
  await f.api.ready;
  f.api.update({dt: 0.016, calm: false});
  assert.equal(f.api.steps(), 0, 'held before arrival');
  running = true;
  f.api.update({dt: 0.016, calm: false});
  assert.equal(f.api.steps(), 1);
  running = false;
  f.api.update({dt: 0.016, calm: false});
  assert.equal(f.api.steps(), 1, 'held again after a replay ends');
});

test('no system steps before arrival runs enter(), on a first entry or a re-entry, even once preparation settled', async () => {
  // Re-entering a scene (goto to itself, restart, the next level) is a fresh visit with fresh state, like a first entry:
  // the router's first-render frames run update() between preparation and arrival, and must not step systems there.
  const f = fixture(undefined, null, false);
  f.pending[0]!.resolve('ready');
  await f.api.ready;
  for (let i = 0; i < 3; i++) f.api.update({dt: 0.016, calm: false});
  assert.equal(f.api.steps(), 0, 'first-render frames before arrival step no system');
  f.api.arrive();
  assert.equal(f.api.enteredAt(), 0, 'enter() ran before any step');
  f.api.update({dt: 0.016, calm: false});
  assert.equal(f.api.steps(), 1, 'systems step once arrived');
});

test('a scene with post waits (bounded) for its chunk, compiles its passes and draws its frames through it', async () => {
  let settle!: () => void;
  const calls: string[] = [];
  let drawsThrough = true;
  const f = fixture(undefined, null, true, {
    compile: () => calls.push('compile'),
    settled: ms => {
      calls.push(`settled ${ms}`);
      return new Promise<void>(resolve => {
        settle = resolve;
      });
    },
    render: () => {
      calls.push('render');
      return drawsThrough;
    },
  });
  assert.deepEqual(calls, ['compile'], 'post compiles with the scene (a no-op until its chunk is ready)');
  f.pending[0]!.resolve('ready');
  await turn();
  assert.deepEqual(calls, ['compile', 'settled 4000'], 'the first picture waits for the chunk, at most 4 s');
  assert.equal(f.api.state(), false);
  settle();
  await f.api.ready;
  assert.deepEqual(calls, ['compile', 'settled 4000', 'compile', 'render']);
  assert.equal(f.directRenders, 0, 'post drew the initial frame');
  assert.equal(f.api.render(), true);
  assert.equal(f.directRenders, 0);
  assert.equal(f.api.render(), false, 'nothing changed: nothing is drawn (render on change)');
  drawsThrough = false;
  f.api.redraw();
  assert.equal(f.api.render(), true);
  assert.equal(f.directRenders, 1, 'post off (or failed): the scene draws direct');
});
