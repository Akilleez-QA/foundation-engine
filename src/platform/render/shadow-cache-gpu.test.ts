import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {
  createShadowGPUCache,
  shadowGPURevisionSupported,
  SHADOW_GPU_THREE_REVISION,
  type ShadowPass,
} from './shadow-cache-gpu';
import {scheduleShadows} from './shadows';
import {adoptStaticShadowCache} from './shadow-cache-policy';
import {markReferenceShadowLight} from './shadow-technique';
import {must} from '../../testing/must';

function fixture(approved = true) {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(),
    light = new T.DirectionalLight();
  light.castShadow = true;
  light.position.set(3, 8, 4);
  light.shadow.mapSize.set(32, 32);
  scene.add(light, light.target);
  const fixed = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()),
    moving = fixed.clone();
  fixed.castShadow = moving.castShadow = true;
  scene.add(fixed, moving);
  const renderer = {
    shadowMap: {type: T.PCFShadowMap, needsUpdate: false},
    capabilities: {maxTextureSize: 4096},
    clippingPlanes: [],
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: () => {},
    info: {render: {calls: 0}},
    getContext: () => ({isContextLost: () => false}),
  } as unknown as T.WebGLRenderer;
  let proof = approved;
  const gpu = createShadowGPUCache(renderer, {approved: () => proof});
  gpu.declareStatic(fixed);
  const passes: {target: T.RenderTarget; casters: T.Object3D[]}[] = [];
  let fail = false;
  const pass: ShadowPass = () => {
    if (!light.shadow.map) {
      light.shadow.map = new T.WebGLRenderTarget(32, 32);
      light.shadow.map.depthTexture = new T.DepthTexture(32, 32, T.UnsignedIntType);
    }
    const casters: T.Object3D[] = [];
    scene.traverseVisible(o => {
      if (o.castShadow && (o as T.Mesh).isMesh) casters.push(o);
    });
    passes.push({target: light.shadow.map, casters});
    renderer.info.render.calls += casters.length;
    if (fail && casters.includes(fixed) && !casters.includes(moving)) {
      fail = false;
      throw Error('injected rebuild failure');
    }
    light.shadow.needsUpdate = false;
    renderer.shadowMap.needsUpdate = false;
  };
  const frame = () => {
    scene.updateMatrixWorld(true);
    light.shadow.needsUpdate = true;
    gpu.render(pass, [light], scene, camera);
  };
  return {
    scene,
    camera,
    light,
    fixed,
    moving,
    renderer,
    gpu,
    passes,
    pass,
    frame,
    fail: () => {
      fail = true;
    },
    proof: (value: boolean) => {
      proof = value;
    },
  };
}
test('GPU adapter uses a static-only target then composite + movers; never copies full depth', () => {
  const f = fixture();
  f.frame();
  const final = f.light.shadow.map;
  assert.deepEqual(must(f.passes[0]).casters, [f.fixed, f.moving]);
  assert.deepEqual(must(f.passes[1]).casters, [f.fixed]);
  assert.notEqual(must(f.passes[1]).target, final);
  assert.equal(must(f.passes[2]).target, final);
  assert.equal((must(f.passes[2]).casters[0] as T.Mesh).material instanceof T.ShaderMaterial, true);
  assert.equal(((must(f.passes[2]).casters[0] as T.Mesh).material as T.Material).shadowSide, T.DoubleSide);
  assert.equal(must(f.passes[2]).casters.length, 2);
  assert.equal(must(f.passes[2]).casters[1], f.moving);
  assert.equal(f.light.shadow.map, final);
  assert.equal(f.scene.children.length, 4);
  assert.ok(f.fixed.castShadow && f.moving.castShadow);
  f.moving.position.x = 2;
  f.frame();
  assert.equal(f.passes.length, 4);
  assert.equal(f.gpu.cache.stats.hits, 1);
  assert.deepEqual(f.gpu.stats, {staticRebuildDraws: 1, dynamicDraws: 2, compositeDraws: 2, fullDraws: 2, failures: 0});
  assert.equal(f.gpu.residentBytes(), 32 * 32 * 8 + 36);
  f.gpu.invalidate();
  assert.equal(f.gpu.residentBytes(), 32 * 32 * 8 + 36, 'invalid but allocated attachments still count');
  f.gpu.dispose();
  assert.equal(f.gpu.residentBytes(), 0);
});
test('first frame after static/light/size/membership mutation rebuilds before presentation', () => {
  const f = fixture();
  f.frame();
  for (const mutate of [
    () => {
      f.fixed.position.x++;
    },
    () => {
      f.light.position.x++;
    },
    () => {
      f.light.shadow.camera.near += 0.1;
    },
    () => {
      f.light.shadow.mapSize.set(64, 64);
    },
    () => {
      f.gpu.demote(f.fixed);
      f.gpu.declareStatic(f.moving);
    },
  ]) {
    const before = f.passes.length;
    mutate();
    f.frame();
    assert.equal(f.passes.length - before, 2);
    assert.equal(f.passes.at(-1)!.target, f.light.shadow.map);
  }
  assert.equal(f.gpu.residentBytes(), 64 * 64 * 8 + 36);
});
test('failed rebuild restores objects and target and renders full in the same frame', () => {
  const f = fixture();
  f.frame();
  const final = f.light.shadow.map;
  f.gpu.invalidate();
  f.fail();
  f.frame();
  assert.equal(f.gpu.stats.failures, 1);
  assert.deepEqual(f.passes.at(-1)!.casters, [f.fixed, f.moving]);
  assert.equal(f.light.shadow.map, final);
  assert.equal(f.scene.children.length, 4);
  assert.ok(f.fixed.castShadow && f.moving.castShadow);
  assert.equal(f.gpu.cache.residentBytes(), 0);
  f.frame();
  assert.equal(f.gpu.cache.stats.rebuilds, 2, 'failed path stays conventional');
  f.gpu.contextRestored();
  f.frame();
  assert.equal(f.gpu.cache.stats.rebuilds, 3);
});
test('unproved modes, context loss, proof withdrawal and filter transitions use full quality', () => {
  const f = fixture(false);
  f.frame();
  assert.equal(f.gpu.residentBytes(), 0);
  f.proof(true);
  f.frame();
  assert.ok(f.gpu.residentBytes() > 0);
  f.proof(false);
  f.frame();
  assert.equal(f.gpu.residentBytes(), 36);
  f.proof(true);
  f.frame();
  assert.equal(f.gpu.cache.stats.rebuilds, 2);
  f.gpu.contextLost();
  f.frame();
  assert.equal(f.gpu.cache.residentBytes(), 0);
  f.gpu.contextRestored();
  f.frame();
  assert.equal(f.gpu.cache.stats.rebuilds, 3);
  f.renderer.shadowMap.type = T.VSMShadowMap;
  f.frame();
  assert.deepEqual(f.passes.at(-1)!.casters, [f.fixed, f.moving]);
  f.renderer.shadowMap.type = T.PCFShadowMap;
  const n = f.passes.length;
  f.frame();
  assert.equal(f.passes.length, n + 1, 'filter transition is stock');
  f.frame();
  assert.equal(f.passes.length, n + 3, 'next due frame rebuilds');
});
test('private adapters never transfer a target or membership between instances; removal releases storage', () => {
  const a = fixture(),
    b = fixture();
  a.frame();
  b.frame();
  assert.notEqual(must(a.passes[1]).target, must(b.passes[1]).target);
  a.gpu.dispose();
  assert.ok(b.gpu.residentBytes() > 36);
  b.gpu.render(() => {}, [], b.scene, b.camera);
  assert.equal(b.gpu.residentBytes(), 36);
  b.gpu.dispose();
});
test('post-shadow hooks are unsafe even when art declares the caster static', () => {
  const f = fixture();
  f.fixed.onAfterShadow = () => {};
  f.frame();
  assert.equal(f.gpu.cache.classify(f.fixed).moving, true);
  assert.equal(f.gpu.residentBytes(), 0);
});

test('scheduler adopts the adapter, leaves idle maps alone and disposes caches with its renderer', () => {
  const f = fixture();
  f.gpu.dispose();
  Object.assign(f.renderer.shadowMap, {enabled: true, autoUpdate: true, render: f.pass});
  f.renderer.dispose = () => {};
  const scheduler = scheduleShadows(f.renderer, {
    technique: 'authored',
    quality: {knob: () => 'high'} as never,
    staticCache: {approved: () => true},
  });
  scheduler.cache.declareStatic(f.fixed);
  const frame = () => {
    f.scene.updateMatrixWorld(true);
    f.renderer.shadowMap.render([f.light], f.scene, f.camera);
  };
  frame();
  const calls = f.renderer.info.render.calls;
  assert.ok(scheduler.cache.residentBytes() > 0);
  frame();
  assert.equal(f.renderer.info.render.calls, calls, 'static window draws no depth');
  f.moving.position.x++;
  frame();
  assert.equal(scheduler.cache.cache.stats.hits, 1);
  scheduler.invalidate(f.scene);
  frame();
  assert.equal(scheduler.cache.cache.stats.rebuilds, 2);
  f.renderer.shadowMap.render([], f.scene, f.camera);
  assert.equal(scheduler.cache.residentBytes(), 36, 'removing the last light releases targets');
  f.renderer.dispose();
  assert.equal(scheduler.cache.residentBytes(), 0);
});

test('a separate background scene does not evict the foreground static generation', () => {
  const f = fixture();
  f.frame();
  const bytes = f.gpu.residentBytes();
  f.gpu.render(() => {}, [], new T.Scene(), f.camera);
  assert.equal(f.gpu.residentBytes(), bytes);
  f.moving.position.x++;
  f.frame();
  assert.equal(f.gpu.cache.stats.hits, 1);
});

test('production adoption declares only art roots, replaces membership, and gates raw maps on CSM identity', () => {
  const f = fixture();
  f.gpu.dispose();
  const gpu = createShadowGPUCache(f.renderer);
  const frame = () => {
    f.scene.updateMatrixWorld(true);
    f.light.shadow.needsUpdate = true;
    gpu.render(f.pass, [f.light], f.scene, f.camera);
  };
  let owner = adoptStaticShadowCache(f.scene, [f.fixed]);
  frame();
  assert.equal(gpu.cache.classify(f.fixed).moving, false);
  assert.equal(gpu.cache.classify(f.moving).moving, true);
  owner.dispose();
  owner = adoptStaticShadowCache(f.scene, [f.moving]);
  frame();
  assert.equal(gpu.cache.classify(f.fixed).moving, true);
  assert.equal(gpu.cache.classify(f.moving).moving, false);
  f.renderer.shadowMap.type = T.BasicShadowMap;
  frame();
  frame();
  assert.equal(gpu.residentBytes(), 36, 'arbitrary raw-depth lights are unproved');
  markReferenceShadowLight(f.light);
  frame();
  assert.ok(gpu.residentBytes() > 36, 'pinned reference rig identity permits its raw depth');
  owner.dispose();
  assert.equal(gpu.residentBytes(), 36, 'run disposal releases targets before another render');
  frame();
  gpu.dispose();
});

test('restored raw reference depth bootstraps stock filter state before private static targets', () => {
  const f = fixture();
  f.renderer.shadowMap.type = T.BasicShadowMap;
  f.frame();
  f.frame();
  const count = f.passes.length,
    full = f.gpu.stats.fullDraws;
  const final = f.light.shadow.map;
  let disposed = 0;
  final!.addEventListener('dispose', () => {
    disposed++;
  });
  f.gpu.contextLost();
  assert.equal(disposed, 1);
  assert.equal(f.light.shadow.map, null);
  f.gpu.contextRestored();
  f.gpu.render(() => {}, [], new T.Scene(), f.camera);
  f.frame();
  assert.deepEqual(
    f.passes.slice(count).map(p => p.casters.length),
    [2, 1, 2],
  );
  assert.deepEqual(must(f.passes[count]).casters, [f.fixed, f.moving]);
  assert.equal(f.gpu.stats.fullDraws - full, 2, 'restoration stock work is counted');
  assert.equal(f.gpu.cache.stats.rebuilds, 2);
  f.gpu.dispose();
});

test('custom moving depth programs withdraw cache approval before reordered depth can present', () => {
  const f = fixture();
  f.frame();
  assert.ok(f.gpu.residentBytes() > 36);
  // Stock traversal may write static depth after this mover; a composite cannot
  // safely move that static depth before an order-dependent custom program.
  f.moving.customDepthMaterial = new T.MeshDepthMaterial({depthFunc: T.AlwaysDepth});
  const before = f.passes.length;
  f.frame();
  assert.equal(f.passes.length - before, 1);
  assert.deepEqual(f.passes.at(-1)!.casters, [f.fixed, f.moving]);
  assert.equal(f.gpu.residentBytes(), 36, 'old static attachment is retired');
  f.moving.customDepthMaterial.dispose();
  f.moving.customDepthMaterial = undefined;
  f.frame();
  assert.ok(f.gpu.residentBytes() > 36, 'standard depth can rebuild safely');
  f.gpu.dispose();
});
test('adapter contract: the private shadow-pass adapter runs only on the verified three revision (0.186)', () => {
  assert.equal(
    T.REVISION,
    SHADOW_GPU_THREE_REVISION,
    'engine upgrade: re-verify the WebGLShadowMap adapter, then move the pin',
  );
  assert.equal(shadowGPURevisionSupported(T.REVISION), true);
  for (const other of ['183', '185', '187', '186dev', ''])
    assert.equal(shadowGPURevisionSupported(other), false, other + ' is refused');
});
