import test from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import * as T from 'three';
import { World } from '../core/ecs/world';
import { Transform } from './defs';
import { Model } from './model';
import { createSceneModels } from './scene-model';
import { createModelLibrary } from '../platform/assets/models';
async function waitFor(ready: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, 'model readiness deadline exceeded');
    await new Promise(r => setTimeout(r, 1));
  }
}
function fixture() {
  const world = new World(), scene = new T.Scene(), life = new AbortController(), errors: unknown[] = [];
  const source = new T.Group(), socket = new T.Bone(); socket.name = 'hand'; source.add(socket);
  const clip = new T.AnimationClip('wave', 1, [new T.VectorKeyframeTrack('hand.position', [0, 1], [0, 0, 0, 0, 2, 0])]);
  const library = createModelLibrary({ def: id => ({ id, kind: 'model', title: id, licence: 'original', provenance: {}, variants: [{ path: id + '.glb', format: 'glb' }] }), fetchBytes: async () => new ArrayBuffer(16), parse: async () => ({ scene: source.clone(true), animations: [clip] }) });
  const owner = createSceneModels({ world, scene, library, signal: life.signal, invalidate() {}, report: error => errors.push(error) });
  const e = world.spawn(Transform({x:3}), Model({asset:'model',clip:'wave',loop:false}));
  return { world, scene, life, errors, library, owner, e };
}
test('model playback moves owned named nodes, pauses, and never moves the actor transform', async () => {
  const f = fixture(); f.owner.sync(); await waitFor(() => f.owner.socket(f.e, 'hand') !== null); f.owner.sync(.25);
  assert.equal(f.owner.socket(f.e, 'hand')!.matrix[13], .5); assert.equal(f.owner.socket(f.e, 'hand')!.matrix[12], 3);
  assert.equal(f.world.get(f.e, Transform)!.x, 3);
  f.world.get(f.e, Model)!.playing = false; f.owner.sync(.25); assert.equal(f.owner.socket(f.e,'hand')!.matrix[13], .5);
  f.world.get(f.e, Model)!.playing = true; f.owner.sync(.25); assert.equal(f.owner.socket(f.e,'hand')!.matrix[13], 1);
  f.life.abort(); assert.equal(f.scene.children.length, 0); assert.equal(f.library.stats().instances, 0); assert.equal(f.owner.socket(f.e,'hand'), null); assert.deepEqual(f.errors, []);
});
test('replacement and despawn release instances and obsolete async results cannot attach', async () => {
  const f = fixture(); f.owner.sync(); f.world.get(f.e,Model)!.asset = 'replacement'; f.owner.sync(); await waitFor(() => f.owner.socket(f.e, 'hand') !== null); f.owner.sync();
  assert.equal(f.scene.children.length,1); assert.equal(f.library.stats().instances,1);
  f.world.despawn(f.e); f.owner.sync(); assert.equal(f.scene.children.length,0); assert.equal(f.library.stats().instances,0);
  f.owner.dispose(); f.owner.dispose(); assert.deepEqual(f.errors,[]);
});
test('ambiguous or absent node names cannot silently select a socket', async () => {
  const f=fixture();f.owner.sync();await waitFor(() => f.owner.socket(f.e, 'hand') !== null);assert.equal(f.owner.socket(f.e,'missing'),null);f.life.abort();
});

test('per-camera masks apply to animated descendants and update without mutating shared definitions', async () => {
  const f=fixture();f.owner.dispose();let mask=2;
  const owner=createSceneModels({world:f.world,scene:f.scene,library:f.library,signal:f.life.signal,invalidate(){},report:e=>f.errors.push(e),mask:()=>mask});
  owner.sync();await waitFor(() => owner.socket(f.e, 'hand') !== null);owner.sync(.1);
  must(f.scene.children[0],'model root').traverse(node=>assert.equal(node.layers.mask,2));
  mask=4;assert.equal(owner.sync(),true);must(f.scene.children[0],'model root').traverse(node=>assert.equal(node.layers.mask,4));owner.dispose();
});

test('a scene aborted before loading completes never publishes a node', async () => {
  const f = fixture(); f.owner.dispose();
  const lease = await f.library.model('model', { signal: new AbortController().signal });
  let arrive!: () => void, released = 0;
  const library = { ...f.library, model: () => new Promise<typeof lease>(resolve => { arrive = () => resolve({ ...lease, release() { released++; lease.release(); } }); }) };
  const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal, invalidate() {}, report: e => f.errors.push(e) });
  owner.sync(); f.life.abort(); arrive(); await waitFor(() => released === 1);
  assert.equal(f.scene.children.length, 0); assert.equal(f.library.stats().instances, 0); assert.deepEqual(f.errors, []);
});

test('masked rotation overrides preserve native animated translation and removal restores clip pose',async()=>{
 const f=fixture();f.owner.sync();await waitFor(() => f.owner.socket(f.e, 'hand') !== null);f.owner.sync(.25);
 const data=f.world.get(f.e,Model)!;data.pose=[{node:'hand',rotation:[0,0,Math.sin(.25),Math.cos(.25)]}];
 f.owner.sync(.1);const posed=f.owner.socket(f.e,'hand')!.matrix;assert.ok(Math.abs(must(posed[13])-.7)<1e-6);assert.ok(Math.abs(must(posed[0])-Math.cos(.5))<1e-6);
 data.pose=[];f.owner.sync(0);const restored=f.owner.socket(f.e,'hand')!.matrix;assert.ok(Math.abs(must(restored[13])-.7)<1e-6);assert.equal(restored[0],1);f.owner.dispose();
});

test('scene disposal drains all instances and leases after cleanup throws, and repeated disposal is inert', async () => {
  for (const viaAbort of [false, true]) {
    const f = fixture(); f.owner.dispose();
    let released = 0, instances = 0, reports = 0;
    const library = { ...f.library, async model(...args: Parameters<typeof f.library.model>) {
      const lease = await f.library.model(...args);
      return { ...lease, value: { ...lease.value, releaseInstance(instance: T.Object3D) {
        lease.value.releaseInstance(instance); instances++;
        if (instances === 1) throw Error('instance cleanup failed');
      } }, release() { released++; lease.release(); } };
    } };
    const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal, invalidate() {}, report() { reports++; throw Error('reporter failed'); } });
    const second = f.world.spawn(Transform(), Model({ asset: 'second' }));
    owner.sync(); await waitFor(() => owner.socket(f.e, 'hand') !== null && owner.socket(second, 'hand') !== null);
    if (viaAbort) f.life.abort();
    else assert.throws(() => owner.dispose(), AggregateError);
    assert.equal(instances, 2); assert.equal(released, 2);
    assert.equal(f.scene.children.length, 0); assert.equal(f.library.stats().instances, 0);
    assert.equal(f.library.stats().residentMiB, 0);
    assert.equal(reports, viaAbort ? 1 : 0);
    owner.dispose(); assert.equal(instances, 2); assert.equal(released, 2);
  }
});

test('async publication failure cleans the adopted lease even when reporting throws', async () => {
  const f = fixture(); f.owner.dispose(); let reports = 0;
  const owner = createSceneModels({ world: f.world, scene: f.scene, library: f.library, signal: f.life.signal,
    invalidate() { throw Error('publication failed'); }, report() { reports++; throw Error('report failed'); } });
  owner.sync(); await waitFor(() => reports === 1);
  assert.equal(f.scene.children.length, 0); assert.equal(f.library.stats().instances, 0);
  assert.equal(f.library.stats().residentMiB, 0); owner.dispose();
});

test('a stale publication catch cannot retire a reentrant replacement', async () => {
  const f = fixture(); f.owner.dispose(); let invalidations = 0;
  const owner = createSceneModels({ world: f.world, scene: f.scene, library: f.library, signal: f.life.signal,
    invalidate() {
      if (++invalidations !== 1) return;
      f.world.get(f.e, Model)!.asset = 'replacement'; owner.sync();
      throw Error('obsolete publication failed');
    }, report: error => f.errors.push(error) });
  owner.sync(); await waitFor(() => invalidations === 2 && owner.socket(f.e, 'hand') !== null);
  assert.equal(f.scene.children.length, 1); assert.equal(f.library.stats().instances, 1);
  assert.equal(f.errors.length, 1); owner.dispose(); assert.equal(f.library.stats().instances, 0);
});

test('reentrant instantiate, added event and mask retirement cannot publish an orphan', async () => {
  for (const phase of ['instantiate', 'added', 'mask'] as const) {
    const f = fixture(); f.owner.dispose(); let instanceReleased = 0, leaseReleased = 0, invalidated = 0;
    const library = { ...f.library, async model(...args: Parameters<typeof f.library.model>) {
      const lease = await f.library.model(...args);
      return { ...lease, value: { ...lease.value, instantiate() {
        const instance = lease.value.instantiate();
        if (phase === 'instantiate') f.life.abort();
        if (phase === 'added') instance.addEventListener('added', () => f.life.abort());
        return instance;
      }, releaseInstance(instance: T.Object3D) { instanceReleased++; lease.value.releaseInstance(instance); } },
      release() { leaseReleased++; lease.release(); } };
    } };
    const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal,
      invalidate() { invalidated++; }, report: e => f.errors.push(e), mask() { if (phase === 'mask') f.life.abort(); return 1; } });
    owner.sync(); await waitFor(() => instanceReleased === 1 && leaseReleased === 1);
    assert.equal(f.scene.children.length, 0, phase); assert.equal(f.library.stats().instances, 0, phase);
    assert.equal(invalidated, 0, phase); assert.equal(owner.socket(f.e, 'hand'), null);
    owner.dispose(); assert.equal(instanceReleased, 1); assert.equal(leaseReleased, 1); assert.deepEqual(f.errors, []);
  }
});

test('replacement cleanup reentry cannot overwrite a pending slot or strand a lease', async () => {
  const f = fixture(); f.owner.dispose(); let loads = 0, releases = 0, reentered = 0;
  const library = { ...f.library, async model(...args: Parameters<typeof f.library.model>) {
    loads++;
    const lease = await f.library.model(...args);
    return { ...lease, value: { ...lease.value, releaseInstance(instance: T.Object3D) {
      lease.value.releaseInstance(instance); reentered++; owner.sync();
    } }, release() { releases++; lease.release(); } };
  } };
  const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal, invalidate() {}, report: e => f.errors.push(e) });
  owner.sync(); await waitFor(() => owner.socket(f.e, 'hand') !== null);
  f.world.get(f.e, Model)!.asset = 'replacement'; owner.sync();
  await waitFor(() => owner.socket(f.e, 'hand') !== null);
  assert.equal(loads, 2); assert.equal(releases, 1); assert.equal(reentered, 1);
  owner.dispose(); assert.equal(releases, 2); assert.equal(f.library.stats().residentMiB, 0); assert.deepEqual(f.errors, []);
});

test('instance added callback sync cannot observe partially initialized playback', async () => {
  const f = fixture(); f.owner.dispose(); let reentered = 0;
  const library = { ...f.library, async model(...args: Parameters<typeof f.library.model>) {
    const lease = await f.library.model(...args);
    return { ...lease, value: { ...lease.value, instantiate() {
      const instance = lease.value.instantiate();
      instance.addEventListener('added', () => { reentered++; owner.sync(); });
      return instance;
    } } };
  } };
  const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal, invalidate() {}, report: e => f.errors.push(e) });
  owner.sync(); await waitFor(() => owner.socket(f.e, 'hand') !== null);
  assert.equal(reentered, 1); assert.deepEqual(f.errors, []);
  owner.sync(.25); assert.equal(owner.socket(f.e, 'hand')!.matrix[13], .5);
  owner.dispose(); assert.equal(f.library.stats().instances, 0);
});

test('production state is frozen, factual and side effect free across requested and adopted assets', async () => {
  const f = fixture();
  const initial = f.owner.state(f.e), stats = f.library.stats();
  assert.deepEqual(initial, { status: 'loading', requestedAsset: 'model', adoptedAsset: null });
  assert.ok(Object.isFrozen(initial));
  for (let i = 0; i < 100; i++) f.owner.state(f.e);
  assert.deepEqual(f.library.stats(), stats);
  assert.equal(f.scene.children.length, 0);
  f.owner.sync(); await waitFor(() => f.owner.state(f.e).status === 'ready');
  assert.deepEqual(f.owner.state(f.e), { status: 'ready', requestedAsset: 'model', adoptedAsset: 'model' });
  f.world.get(f.e, Model)!.asset = 'replacement';
  assert.deepEqual(f.owner.state(f.e), { status: 'loading', requestedAsset: 'replacement', adoptedAsset: 'model' });
  assert.equal(initial.status, 'loading');
  f.owner.sync(); await waitFor(() => f.owner.state(f.e).status === 'ready');
  assert.equal(f.owner.state(f.e).adoptedAsset, 'replacement');
  f.world.despawn(f.e);
  assert.deepEqual(f.owner.state(f.e), { status: 'absent', requestedAsset: null, adoptedAsset: null });
  f.owner.dispose();
});

test('production state retains load and post-lease failures without automatic retry', async () => {
  for (const failure of ['load', 'instantiate', 'publication'] as const) {
    const f = fixture(); f.owner.dispose(); let requests = 0;
    const library = { ...f.library, async model(...args: Parameters<typeof f.library.model>) {
      requests++;
      if (failure === 'load') throw Error('load rejected');
      const lease = await f.library.model(...args);
      return failure === 'instantiate' ? { ...lease, value: { ...lease.value, instantiate() { throw Error('instantiate rejected'); } } } : lease;
    } };
    const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal,
      invalidate() { if (failure === 'publication') throw Error('publication rejected'); }, report: error => f.errors.push(error) });
    owner.sync(); await waitFor(() => owner.state(f.e).status === 'failed');
    assert.deepEqual(owner.state(f.e), { status: 'failed', requestedAsset: 'model', adoptedAsset: null });
    for (let i = 0; i < 10; i++) { owner.sync(); owner.state(f.e); }
    assert.equal(requests, 1, failure);
    assert.equal(f.library.stats().instances, 0); assert.equal(f.library.stats().residentMiB, 0);
    assert.equal(f.scene.children.length, 0);
    f.world.despawn(f.e); owner.sync();
    assert.equal(owner.state(f.e).status, 'absent'); owner.dispose();
  }
});

test('scene admission failure stays synchronous and state queries do not invent observations', async () => {
  const f = fixture(); f.owner.dispose();
  const owner = createSceneModels({ world: f.world, scene: f.scene, library: f.library, signal: f.life.signal, maxInstances: 1, invalidate() {}, report: error => f.errors.push(error) });
  owner.sync(); await waitFor(() => owner.state(f.e).status === 'ready');
  const candidate = f.world.spawn(Transform(), Model({ asset: 'candidate', visible: false }));
  assert.equal(owner.state(candidate).status, 'loading');
  assert.throws(() => owner.sync(), /instance budget/);
  assert.equal(owner.state(candidate).status, 'loading');
  assert.equal(owner.state(f.e).status, 'ready');
  assert.equal(f.library.stats().instances, 1);
  f.world.despawn(candidate); owner.dispose();
  assert.equal(owner.state(f.e).status, 'absent');
});

test('late failed candidate cannot overwrite replacement or report a retired visit ready', async () => {
  const f = fixture(); f.owner.dispose(); let reject!: (error: Error) => void;
  const library = { ...f.library, model(id: string, options: Parameters<typeof f.library.model>[1]) {
    return id === 'model' ? new Promise<Awaited<ReturnType<typeof f.library.model>>>((_resolve, fail) => { reject = fail; }) : f.library.model(id, options);
  } };
  const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal, invalidate() {}, report: error => f.errors.push(error) });
  owner.sync(); f.world.get(f.e, Model)!.asset = 'replacement'; owner.sync();
  await waitFor(() => owner.state(f.e).status === 'ready');
  reject(Error('obsolete load failed')); await waitFor(() => f.errors.length === 1);
  assert.deepEqual(owner.state(f.e), { status: 'ready', requestedAsset: 'replacement', adoptedAsset: 'replacement' });
  f.life.abort(); assert.equal(owner.state(f.e).status, 'absent');
  assert.equal(f.library.stats().instances, 0);
});

test('failed publication cleanup and reporter reentry cannot restart the failed request', async () => {
  const f = fixture(); f.owner.dispose(); let requests = 0, releases = 0;
  const library = { ...f.library, async model(...args: Parameters<typeof f.library.model>) {
    requests++; const lease = await f.library.model(...args);
    return { ...lease, value: { ...lease.value, releaseInstance(instance: T.Object3D) {
      releases++; lease.value.releaseInstance(instance); owner.sync(); throw Error('cleanup failed');
    } } };
  } };
  const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal,
    invalidate() { throw Error('publication failed'); }, report(error) { f.errors.push(error); owner.sync(); } });
  owner.sync(); await waitFor(() => owner.state(f.e).status === 'failed');
  assert.equal(requests, 1); assert.equal(releases, 1); assert.equal(f.errors.length, 2);
  assert.equal(f.library.stats().residentMiB, 0); assert.equal(f.scene.children.length, 0);
  owner.dispose();
});

test('cancelled model candidate capacity is reusable before new admission and late leases release', async () => {
  const f = fixture(); f.owner.dispose(); let arrive: (() => void) | undefined, lateReleased = 0;
  const library = { ...f.library, async model(id: string, options: Parameters<typeof f.library.model>[1]) {
    if (id !== 'candidate') return f.library.model(id, options);
    // Simulate a provider that completes despite cancellation; the scene owner must drop it.
    const lease = await f.library.model(id, { signal: new AbortController().signal });
    return new Promise<typeof lease>(resolve => { arrive = () => resolve({ ...lease, release() { lateReleased++; lease.release(); } }); });
  } };
  const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal, maxInstances: 2,
    invalidate() {}, report: error => f.errors.push(error) });
  try {
    owner.sync(); await waitFor(() => owner.state(f.e).status === 'ready');
    const acceptedRoot = must(f.scene.children[0], 'accepted root');
    const candidate = f.world.spawn(Transform(), Model({ asset: 'candidate', visible: false }));
    owner.sync(); await waitFor(() => arrive !== undefined);
    f.world.despawn(candidate);
    const replacement = f.world.spawn(Transform(), Model({ asset: 'replacement', visible: false }));
    assert.doesNotThrow(() => owner.sync());
    await waitFor(() => owner.state(replacement).status === 'ready');
    assert.equal(owner.state(f.e).status, 'ready'); assert.ok(f.scene.children.includes(acceptedRoot));
    assert.equal(f.scene.children.length, 2); assert.equal(f.library.stats().instances, 2);
    arrive!(); await waitFor(() => lateReleased === 1);
    assert.equal(owner.state(candidate).status, 'absent'); assert.equal(owner.state(replacement).status, 'ready');
    assert.equal(f.scene.children.length, 2); assert.deepEqual(f.errors, []);
  } finally { owner.dispose(); arrive?.(); }
  await waitFor(() => lateReleased === 1);
  assert.equal(f.library.stats().instances, 0); assert.equal(f.library.stats().residentMiB, 0);
});

test('removed model or transform retires its ready slot before capacity is reused', async () => {
  for (const removed of [Model, Transform]) {
    const f = fixture(); f.owner.dispose();
    const owner = createSceneModels({ world: f.world, scene: f.scene, library: f.library, signal: f.life.signal, maxInstances: 2,
      invalidate() {}, report: error => f.errors.push(error) });
    try {
      const candidate = f.world.spawn(Transform(), Model({ asset: 'candidate' }));
      owner.sync(); await waitFor(() => owner.state(f.e).status === 'ready' && owner.state(candidate).status === 'ready');
      f.world.remove(candidate, removed);
      const replacement = f.world.spawn(Transform(), Model({ asset: 'replacement' }));
      assert.doesNotThrow(() => owner.sync());
      await waitFor(() => owner.state(replacement).status === 'ready');
      assert.equal(owner.state(candidate).status, 'absent'); assert.equal(f.library.stats().instances, 2);
      assert.equal(f.scene.children.length, 2); assert.deepEqual(f.errors, []);
    } finally { owner.dispose(); }
    assert.equal(f.library.stats().instances, 0); assert.equal(f.library.stats().residentMiB, 0);
  }
});

test('cleanup retiring an already inspected entity cannot block admissible models at the cap', async () => {
  const f = fixture(); f.owner.dispose();
  const owner = createSceneModels({ world: f.world, scene: f.scene, library: f.library, signal: f.life.signal,
    maxInstances: 2, invalidate() {}, report: error => f.errors.push(error) });
  try {
    const departing = f.world.spawn(Transform({ x: 2 }), Model({ asset: 'departing' }));
    owner.sync(); await waitFor(() => owner.state(f.e).status === 'ready' && owner.state(departing).status === 'ready');
    f.scene.children.find(node => node.position.x === 2)!.addEventListener('removed', () => { f.world.despawn(f.e); });
    f.world.despawn(departing);
    const first = f.world.spawn(Transform(), Model({ asset: 'first-new' }));
    const second = f.world.spawn(Transform(), Model({ asset: 'second-new' }));
    assert.doesNotThrow(() => owner.sync());
    await waitFor(() => owner.state(first).status === 'ready' && owner.state(second).status === 'ready');
    assert.equal(f.world.count, 2); assert.equal(f.scene.children.length, 2);
    assert.equal(f.library.stats().instances, 2); assert.deepEqual(f.errors, []);
  } finally { owner.dispose(); }
  assert.equal(f.library.stats().instances, 0); assert.equal(f.library.stats().residentMiB, 0);
});


test('capacity cleanup can cancel the pending admission without requesting its asset', async () => {
  const f = fixture(); f.owner.dispose(); const requests: string[] = [];
  const library = { ...f.library, model(...args: Parameters<typeof f.library.model>) {
    requests.push(args[0]); return f.library.model(...args);
  } };
  const owner = createSceneModels({ world: f.world, scene: f.scene, library, signal: f.life.signal,
    maxInstances: 2, invalidate() {}, report: error => f.errors.push(error) });
  try {
    const departing = f.world.spawn(Transform({ x: 2 }), Model({ asset: 'departing' }));
    owner.sync(); await waitFor(() => owner.state(f.e).status === 'ready' && owner.state(departing).status === 'ready');
    const accepted = f.scene.children.find(node => node.position.x !== 2)!;
    f.scene.children.find(node => node.position.x === 2)!.addEventListener('removed', () => { f.world.despawn(f.e); });
    f.world.despawn(departing);
    const first = f.world.spawn(Transform(), Model({ asset: 'first-new' }));
    const cancelled = f.world.spawn(Transform(), Model({ asset: 'cancelled-new' }));
    accepted.addEventListener('removed', () => { f.world.despawn(cancelled); });
    assert.doesNotThrow(() => owner.sync());
    await waitFor(() => owner.state(first).status === 'ready');
    assert.equal(owner.state(cancelled).status, 'absent');
    assert.ok(!requests.includes('cancelled-new'));
    assert.equal(f.library.stats().instances, 1); assert.deepEqual(f.errors, []);
  } finally { owner.dispose(); }
  assert.equal(f.library.stats().instances, 0); assert.equal(f.library.stats().residentMiB, 0);
});
