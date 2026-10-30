import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {World} from '../../core/ecs/world';
import {defineScene, Transform, type SceneContext} from '../../author';
import {openSceneExtension, type SceneExtensionContext} from '../../author/scene-extension';
import {customObject, hasThree, sceneThree, ThreeObject, useThree, three, type ThreeHandle} from './index';

/** A renderer stand-in with the state the kit guards; no GPU. */
function fakeRenderer() {
  let target: THREE.WebGLRenderTarget | null = null,
    ratio = 1;
  const size = new THREE.Vector2(800, 600);
  // A WebGLRenderer prototype with only the guarded state of a real one.
  const renderer: THREE.WebGLRenderer = Object.create(THREE.WebGLRenderer.prototype);
  return Object.assign(renderer, {
    shadowMap: {enabled: false, type: THREE.PCFShadowMap as THREE.ShadowMapType},
    getRenderTarget: () => target,
    setRenderTarget(t: THREE.WebGLRenderTarget | null) {
      target = t;
    },
    getPixelRatio: () => ratio,
    setPixelRatio(r: number) {
      ratio = r;
    },
    getSize: (v: THREE.Vector2) => v.copy(size),
    setSize(w: number, h: number) {
      size.set(w, h);
    },
  });
}

function visit(o: {kits?: string[]; dev?: boolean; world?: World} = {}) {
  const reports: unknown[] = [],
    ctx = {} as SceneContext,
    controller = new AbortController();
  let invalidated = 0,
    t = 0;
  const context: SceneExtensionContext = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    renderer: fakeRenderer(),
    canvas: {} as HTMLCanvasElement,
    backend: 'webgl2',
    ctx,
    world: o.world ?? new World(),
    kits: o.kits ?? ['three'],
    dev: o.dev ?? true,
    signal: controller.signal,
    time: () => ({t, calm: false}),
    mask: () => 1,
    invalidate: () => invalidated++,
    report: error => reports.push(error),
  };
  return {
    context,
    ctx,
    reports,
    advance: (dt: number) => (t += dt),
    get invalidated() {
      return invalidated;
    },
  };
}
const messages = (reports: unknown[]) => reports.map(r => String((r as Error).message ?? r));

test('the kit is a plain kit; a scene lists sceneThree() as an extension and defineScene keeps it', () => {
  assert.equal(three().id, 'three');
  const x = sceneThree();
  assert.equal(x.kind, 'scene-extension');
  const scene = defineScene({id: 'lit', title: 'Lit', extensions: [x]});
  assert.deepEqual(scene.extensions, [x]);
  assert.throws(
    () => defineScene({id: 'twice', title: 'T', extensions: [x, sceneThree()]}),
    /extension three is listed twice/,
  );
  assert.throws(
    () => defineScene({id: 'fake', title: 'F', extensions: [{kind: 'scene-extension', id: 'three'}]}),
    /takes what a kit makes/,
  );
  assert.throws(() => sceneThree({max: 1000}), /max must be an integer from 0 to 256/);
  assert.throws(() => sceneThree({shadows: 'soft' as never}), /shadows is/);
});

test('the handle exists from open to dispose, only in a game that lists three()', () => {
  const v = visit();
  let seen: ThreeHandle | null = null;
  const session = openSceneExtension(
    sceneThree({
      shadows: true,
      setup: h => {
        seen = h;
      },
    }),
    v.context,
  );
  assert.equal(hasThree(v.ctx), true);
  const h = useThree(v.ctx);
  assert.equal(seen, h, 'setup gets the same handle, before program preparation');
  assert.equal(h.THREE, THREE, 'the engine copy of three');
  assert.equal(h.scene, v.context.scene);
  assert.equal(h.root.parent, v.context.scene, 'the kit root is in the scene');
  assert.equal(h.renderer.shadowMap.enabled, true);
  assert.equal(h.renderer.shadowMap.type, THREE.PCFSoftShadowMap);
  session.dispose();
  assert.equal(hasThree(v.ctx), false);
  assert.throws(() => useThree(v.ctx), /list sceneThree\(\) in defineScene/);
  assert.equal(h.root.parent, null);
  const out = visit({kits: ['ui']});
  assert.throws(() => openSceneExtension(sceneThree(), out.context), /does not list three\(\) in defineGame/);
  assert.equal(hasThree(out.ctx), false);
});

test('hooks: onFrame keeps frames running and redraws; requestRender redraws once; onBeforeRender runs per draw', () => {
  const v = visit();
  const session = openSceneExtension(sceneThree(), v.context);
  const h = useThree(v.ctx);
  assert.equal(session.busy(), false);
  assert.equal(session.sync(0.016), false, 'nothing changed: no redraw');
  const frames: number[] = [];
  const off = h.onFrame(f => frames.push(f.dt));
  assert.equal(session.busy(), true, 'an onFrame hook keeps frames running');
  assert.equal(session.sync(0.016), true);
  assert.equal(session.sync(0), false, 'a pre-draw sync runs no frame hook');
  assert.deepEqual(frames, [0.016]);
  off();
  assert.equal(session.busy(), false);
  assert.equal(v.invalidated, 1, 'adding a frame hook asked for a frame');
  h.requestRender();
  assert.equal(v.invalidated, 2);
  assert.equal(session.sync(0), true);
  assert.equal(session.sync(0), false, 'once');
  let draws = 0;
  h.onBeforeRender(() => draws++);
  assert.equal(session.render!(), false, 'no override: the engine draws');
  assert.equal(draws, 1);
  const sizes: number[][] = [];
  h.onResize(s => sizes.push([s.width, s.height, s.pixelRatio]));
  session.resized!(640, 480, 2);
  assert.deepEqual(sizes, [[640, 480, 2]]);
  assert.deepEqual(h.size(), {width: 640, height: 480, pixelRatio: 2});
  session.dispose();
});

test('a render override draws instead of the engine; the engine-owned renderer state is restored and reported in dev', () => {
  const v = visit();
  const session = openSceneExtension(sceneThree(), v.context);
  const h = useThree(v.ctx);
  const target = new THREE.WebGLRenderTarget(4, 4);
  let calls = 0;
  h.setRenderOverride(({renderer, scene, camera}) => {
    assert.equal(scene, v.context.scene);
    assert.equal(camera, v.context.camera);
    calls++;
    renderer.setRenderTarget(target); // forgot to give the canvas back
    renderer.setPixelRatio(3);
  });
  assert.equal(session.render!(), true);
  assert.equal(calls, 1);
  assert.equal(v.context.renderer.getRenderTarget(), null, 'restored');
  assert.equal(v.context.renderer.getPixelRatio(), 1, 'restored');
  assert.equal(session.render!(), true);
  assert.equal(v.reports.length, 1, 'reported once');
  assert.match(messages(v.reports)[0]!, /left the renderer's render target, pixel ratio changed/);
  h.setRenderOverride(null);
  assert.equal(session.render!(), false);
  const hook = h.onFrame(() => {
    throw Error('boom');
  });
  assert.equal(session.sync(0.016), true);
  assert.equal(session.busy(), false, 'a throwing hook is dropped');
  hook();
  session.dispose();
  target.dispose();
});

test('dispose releases owned resources (newest first), the kit root tree, and reports what left the tree undisposed', () => {
  const v = visit({dev: true});
  const session = openSceneExtension(sceneThree(), v.context);
  const h = useThree(v.ctx);
  const order: string[] = [];
  h.own({dispose: () => order.push('composer')});
  h.own({dispose: () => order.push('controls')});
  const kept = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const dropped = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial());
  dropped.geometry.name = 'dropped-sphere';
  h.root.add(kept, dropped);
  const disposed = new Set<object>();
  for (const r of [kept.geometry, kept.material, dropped.geometry, dropped.material])
    r.addEventListener('dispose', () => disposed.add(r));
  session.render!(); // dev builds watch what is under root when frames draw
  h.root.remove(dropped); // detached and never disposed: a leak
  session.dispose();
  assert.deepEqual(order, ['controls', 'composer']);
  assert.ok(disposed.has(kept.geometry) && disposed.has(kept.material), 'the tree under root is disposed');
  assert.ok(!disposed.has(dropped.geometry));
  assert.equal(v.reports.length, 1);
  assert.match(messages(v.reports)[0]!, /2 resource\(s\) left the scene undisposed .*dropped-sphere/);
  let late = 0;
  h.own({dispose: () => late++});
  assert.equal(late, 1, 'own() after the visit disposes at once');
  session.dispose();
});

test('custom objects: one per entity, placed by Transform, updated, capped, bounded and disposed with the entity', () => {
  const world = new World();
  const v = visit({world});
  const log: string[] = [];
  const glow = customObject({
    id: 'glow',
    limits: {triangles: 12},
    create({own}) {
      log.push('create');
      const mesh = new THREE.Mesh(own(new THREE.BoxGeometry()), own(new THREE.MeshBasicMaterial()));
      own({dispose: () => log.push('owned')});
      return mesh;
    },
    update(object, {dt}) {
      object.rotation.y += dt;
      return dt > 0.02;
    },
    dispose: () => log.push('dispose'),
  });
  const big = customObject({id: 'big', limits: {triangles: 10}, create: () => new THREE.Mesh(new THREE.BoxGeometry())});
  const session = openSceneExtension(sceneThree({objects: [glow, big], max: 2}), v.context);
  const h = useThree(v.ctx);
  const a = world.spawn(Transform({x: 1, y: 2, z: 3, scale: 2}), ThreeObject({use: 'glow'}));
  assert.equal(session.sync(0), true);
  assert.deepEqual(log, ['create']);
  const object = h.root.children[0]!;
  assert.deepEqual(object.position.toArray(), [1, 2, 3]);
  assert.equal(object.scale.x, 2);
  assert.equal(session.busy(), true, 'an object with update keeps frames running');
  assert.equal(session.sync(0.01), false, 'update returned false: no redraw');
  assert.equal(session.sync(0.03), true);
  world.spawn(Transform(), ThreeObject({use: 'big'}));
  world.spawn(Transform(), ThreeObject({use: 'glow'}));
  world.spawn(Transform(), ThreeObject({use: 'glow'}));
  world.spawn(Transform(), ThreeObject({use: 'nope'}));
  session.sync(0);
  assert.deepEqual(
    messages(v.reports).map(m => m.replace(/:.*/, '')),
    ['custom object big', 'sceneThree', "ThreeObject use 'nope'"],
  );
  assert.match(messages(v.reports)[0]!, /12 triangles .* exceed its limits \(10, 8\); refused/);
  assert.match(messages(v.reports)[1]!, /more than 2 custom objects/);
  session.sync(0);
  assert.equal(v.reports.length, 3, 'each refusal is reported once');
  assert.deepEqual(session.stats!().admitted, 2);
  log.length = 0;
  world.despawn(a);
  assert.equal(session.sync(0), true);
  assert.deepEqual(log, ['dispose', 'owned'], 'dispose, then what create owned, then the tree');
  assert.equal(object.parent, null);
  session.dispose();
  assert.equal(h.root.children.length, 0);
});

test("a light's shadow map is released with its custom object, under root, and for the scene's own lights", () => {
  const world = new World();
  const v = visit({world});
  const maps: string[] = [];
  const shadowed = (name: string) => {
    const light = new THREE.PointLight();
    light.castShadow = true;
    light.shadow.map = new THREE.WebGLRenderTarget(4, 4);
    light.shadow.map.addEventListener('dispose', () => maps.push(name));
    return light;
  };
  const lamp = customObject({id: 'lamp', create: () => shadowed('object')});
  const session = openSceneExtension(sceneThree({objects: [lamp]}), v.context);
  const h = useThree(v.ctx);
  const e = world.spawn(Transform(), ThreeObject({use: 'lamp'}));
  session.sync(0);
  world.despawn(e);
  session.sync(0);
  assert.deepEqual(maps, ['object']);
  h.root.add(shadowed('root'));
  v.context.scene.add(shadowed('sun')); // an engine light the game made cast
  session.dispose();
  assert.deepEqual(maps.sort(), ['object', 'root', 'sun']);
});
