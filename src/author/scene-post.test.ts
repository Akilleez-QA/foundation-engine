import test from 'node:test';
import assert from 'node:assert/strict';
import type * as T from 'three';
import {createScenePost, type ScenePostOptions} from './scene-post';
import type {PostPlan} from '../platform/render/post/settings';
import type {PostPipeline} from '../platform/render/backends/webgl/post';
import {ProgramLinkError} from '../platform/render/program-validation';
import {defineScene} from './defs';
import {testScene} from './testing';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const scene = {} as T.Object3D,
  camera = {} as T.Camera;

function harness(o: Partial<ScenePostOptions> & {unsupported?: string | null; fail?: unknown} = {}) {
  const plans: (PostPlan | null)[] = [],
    reports: unknown[] = [],
    events: string[] = [];
  let loads = 0,
    changed = 0,
    resolveLoad!: () => void;
  const pipeline: PostPipeline & {throwOnRender?: unknown} = {
    render(_s, _c, plan) {
      if (pipeline.throwOnRender) throw pipeline.throwOnRender;
      plans.push(plan);
      events.push(`render ${plan.mode}`);
    },
    compile(_s, _c, plan) {
      events.push(`compile ${plan.mode}`);
    },
    stats: () => ({targetBytes: 100, allocations: 1, width: 1, height: 1, samples: 0, frames: plans.length, draws: 0}),
    dispose: () => events.push('dispose'),
  };
  const gate = new Promise<void>(resolve => {
    resolveLoad = resolve;
  });
  const controller = new AbortController();
  const post = createScenePost({
    renderer: {} as T.WebGLRenderer,
    backend: 'webgl2',
    signal: controller.signal,
    samples: () => 0,
    load: async () => {
      loads++;
      await gate;
      if (o.fail) throw o.fail;
      return {
        createWebGLPost: () => pipeline,
        postUnsupported: () => o.unsupported ?? null,
      } as unknown as typeof import('../platform/render/backends/webgl/post');
    },
    changed: () => changed++,
    report: error => reports.push(error),
    ...o,
  });
  return {
    post,
    pipeline,
    plans,
    reports,
    events,
    controller,
    arrive: async () => {
      resolveLoad();
      await turn();
    },
    get loads() {
      return loads;
    },
    get changed() {
      return changed;
    },
  };
}

test('a scene without post settings loads nothing and draws direct', async () => {
  const h = harness();
  assert.equal(h.post.sync(undefined, 'full'), false);
  assert.equal(h.post.render(scene, camera), false);
  await h.arrive();
  assert.equal(h.loads, 0, 'no chunk request');
  assert.equal(h.post.stats().state, 'idle');
});

test('settings request the chunk once; it draws direct until arrival, then the plan changes once (one redraw)', async () => {
  const h = harness();
  assert.equal(h.post.sync({vignette: {amount: 0.3}}, 'basic'), false, 'still off until the chunk arrives');
  assert.equal(h.post.render(scene, camera), false);
  h.post.sync({vignette: {amount: 0.3}}, 'basic');
  assert.equal(h.loads, 1);
  await h.arrive();
  assert.equal(h.changed, 1, 'arrival asks for one frame');
  const settings = {vignette: {amount: 0.3}};
  assert.equal(h.post.sync(settings, 'basic'), true);
  assert.equal(h.post.sync(settings, 'basic'), false, 'nothing changed: no redraw');
  assert.equal(h.post.sync({vignette: {amount: 0.3}}, 'basic'), false, 'an equal copy is no change');
  assert.equal(h.post.render(scene, camera), true);
  assert.equal(h.plans[0]!.mode, 'basic');
  assert.equal(h.post.sync(settings, 'full'), true, 'the knob moved');
  assert.equal(h.post.sync(settings, 'off'), true);
  assert.equal(h.post.render(scene, camera), false, 'off draws direct');
  assert.equal(h.post.sync({vignette: {amount: 0.5}}, 'off'), false, 'a change at off changes no picture');
  assert.equal(h.post.sync({vignette: {amount: 0.5}}, 'full'), true);
  assert.equal(h.post.stats().drawsPerFrame, 10);
  assert.equal(h.post.sync(undefined, 'full'), true, 'settings removed');
  assert.equal(h.post.render(scene, camera), false);
});

test('invalid runtime settings are reported once and the last valid ones stay', async () => {
  const h = harness();
  h.post.sync({vignette: {amount: 0.3}}, 'basic');
  await h.arrive();
  h.post.sync({vignette: {amount: 0.3}}, 'basic');
  const bad = {vignette: {amount: 7}};
  assert.equal(h.post.sync(bad, 'basic'), false);
  assert.equal(h.post.sync(bad, 'basic'), false);
  assert.equal(h.reports.length, 1);
  assert.match(String(h.reports[0]), /ctx\.view\.post\.vignette\.amount/);
  h.post.render(scene, camera);
  assert.equal(h.plans.at(-1)!.vignette.amount, 0.3);
});

test('a failed load, an unsupported context or another backend is reported once and the scene stays direct', async () => {
  for (const o of [{fail: Error('chunk 404')}, {unsupported: 'post: no float colour buffer'}]) {
    const h = harness(o);
    h.post.sync({}, 'full');
    await h.arrive();
    assert.equal(h.post.stats().state, 'failed');
    assert.equal(h.post.sync({}, 'full'), false);
    assert.equal(h.post.render(scene, camera), false);
    assert.equal(h.reports.length, 1, JSON.stringify(o));
    assert.equal(h.loads, 1, 'never retried in the visit');
  }
  const gpu = harness({backend: 'webgpu'});
  gpu.post.sync({}, 'full');
  await gpu.arrive();
  assert.equal(gpu.loads, 0, 'no WebGL chunk for another backend');
  assert.match(String(gpu.reports[0]), /no implementation for the webgpu backend yet/);
  assert.equal(gpu.post.render(scene, camera), false);
});

test('a pipeline error falls back to direct for the visit; a shader link failure stays the scene failure', async () => {
  const h = harness();
  h.post.sync({}, 'full');
  await h.arrive();
  h.post.sync({}, 'full');
  h.pipeline.throwOnRender = new ProgramLinkError('bad', []);
  assert.throws(() => h.post.render(scene, camera), ProgramLinkError);
  h.pipeline.throwOnRender = Error('framebuffer incomplete');
  assert.equal(h.post.render(scene, camera), false, 'the caller draws this frame direct');
  assert.equal(h.post.stats().state, 'failed');
  assert.equal(h.reports.length, 1);
  assert.deepEqual(h.events.slice(-1), ['dispose'], 'its targets are released');
  assert.equal(h.post.sync({}, 'full'), false);
});

test('settled waits for the chunk, at most the bound; dispose releases the pipeline and ignores a late arrival', async () => {
  const h = harness();
  assert.equal(await Promise.race([h.post.settled(10_000).then(() => 'settled'), turn().then(() => 'idle')]), 'settled');
  h.post.sync({}, 'basic');
  const t0 = Date.now();
  await h.post.settled(30);
  assert.ok(Date.now() - t0 >= 25, 'bounded wait');
  await h.arrive();
  await h.post.settled(10_000);
  h.post.sync({}, 'basic');
  h.post.dispose();
  h.post.dispose();
  assert.deepEqual(h.events, ['dispose']);
  assert.equal(h.post.render(scene, camera), false);
  const late = harness();
  late.post.sync({}, 'basic');
  late.post.dispose();
  await late.arrive();
  assert.equal(late.changed, 0);
  assert.equal(late.post.stats().state, 'loading');
});

test('defineScene validates view.post and keeps a copy; testScene exposes it on ctx.view', async () => {
  assert.throws(
    () => defineScene({id: 'bad-post', title: 'Bad', view: {post: {bloom: {strength: 9}}}}),
    /scene bad-post: view\.post\.bloom\.strength must be a number from 0 to 3/,
  );
  const post = {bloom: {strength: 0.8}, vignette: {amount: 0.4}};
  const def = defineScene({id: 'lit', title: 'Lit', view: {post}});
  post.bloom.strength = 2;
  assert.equal((def.view!.post!.bloom as {strength: number}).strength, 0.8);
  const t = await testScene(def);
  assert.deepEqual(t.ctx.view.post, {bloom: {strength: 0.8}, vignette: {amount: 0.4}});
  t.dispose();
});
