// AssetLibrary.model: a model file is fetched once per session; live requesters share one parsed
// template; instances share its geometry and materials; a load that arrives after its owner left is disposed, never
// drawn (the late-GLB leak); no non-staged loader registers Draco.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import * as T from 'three';
import {createModelLibrary, modelBytes} from './models';
import {isAbortError} from './lease-cache';
import type {AssetDef} from './manifest';
import {must} from '../../testing/must';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const defs: AssetDef[] = [
  {
    id: 'asset.model.statue',
    kind: 'model',
    title: 'Statue',
    licence: 'original',
    provenance: {},
    variants: [{path: 'models/demo/statue.glb', format: 'glb'}],
  },
  {
    id: 'asset.model.crate',
    kind: 'model',
    title: 'Crate',
    licence: 'original',
    provenance: {},
    variants: [{path: 'models/demo/crate.glb', format: 'glb'}],
  },
  {
    id: 'asset.document.demo-readme',
    kind: 'document',
    title: 'Readme',
    licence: 'original',
    provenance: {},
    variants: [{path: 'models/demo/README.md', format: 'md'}],
  },
];
const statue = 'asset.model.statue';

function fixture() {
  const fetched: string[] = [];
  const disposed: string[] = [];
  const pending: {url: string; resolve: (b: ArrayBuffer) => void; reject: (e: unknown) => void}[] = [];
  const library = createModelLibrary({
    def: id => defs.find(d => d.id === id),
    fetchBytes: url => {
      fetched.push(url);
      return new Promise((resolve, reject) => pending.push({url, resolve, reject}));
    },
    parse: async (_bytes, url) => {
      const geometry = new T.BoxGeometry();
      const material = new T.MeshStandardMaterial({map: new T.Texture({width: 4, height: 4})});
      for (const r of [geometry, material, material.map!]) r.addEventListener('dispose', () => disposed.push(url));
      const scene = new T.Group();
      scene.add(new T.Mesh(geometry, material));
      return scene;
    },
  });
  const arrive = async () => {
    await settle();
    for (const p of pending.splice(0)) p.resolve(new ArrayBuffer(16));
    await settle();
    await settle();
  };
  return {library, fetched, disposed, arrive};
}

test('a model file is fetched once per session across scene visits; each visit gets its own template', async () => {
  const {library, fetched, disposed, arrive} = fixture();
  for (let visit = 0; visit < 3; visit++) {
    const life = new AbortController();
    const got = library.model(statue, {signal: life.signal});
    await arrive();
    const lease = await got;
    const a = lease.value.instantiate();
    assert.equal(a.userData.shared, undefined);
    const mesh = a.children[0] as T.Mesh;
    assert.equal((mesh.geometry as T.BufferGeometry).userData.shared, true, 'disposeOwnedTree spares it');
    assert.ok(
      library.owns(mesh.geometry) &&
        library.owns(mesh.material) &&
        library.owns((mesh.material as T.MeshStandardMaterial).map),
    );
    life.abort();
  }
  assert.deepEqual(fetched, ['/models/demo/statue.glb']);
  assert.deepEqual(library.stats().fetches, {'/models/demo/statue.glb': 1});
  assert.equal(library.stats().parses, 3, 'warm budget 0: the GPU copy is released between visits, as before');
  assert.equal(disposed.length, 9, 'three visits × geometry, material and texture');
});

test('live requesters share one template; instances share geometry and materials; the last release disposes', async () => {
  const {library, fetched, disposed, arrive} = fixture();
  const owners = [new AbortController(), new AbortController()];
  const leases = owners.map(o => library.model(statue, {signal: o.signal}));
  await arrive();
  const [a, b] = await Promise.all(leases);
  assert.ok(a);
  assert.ok(b);
  assert.equal(fetched.length, 1);
  assert.equal(a.value, b.value);
  const [x, y] = [a.value.instantiate(), b.value.instantiate()];
  assert.notEqual(x, y);
  assert.equal((x.children[0] as T.Mesh).geometry, (y.children[0] as T.Mesh).geometry);
  assert.equal((x.children[0] as T.Mesh).material, (y.children[0] as T.Mesh).material);
  a.release();
  a.release();
  assert.equal(disposed.length, 0);
  must(owners[1]).abort();
  assert.equal(disposed.length, 3);
});

test('a GLB that arrives after its owner left is disposed on arrival, never handed out (late-GLB leak)', async () => {
  // Owner leaves while the file is downloading: the bytes are kept, nothing is parsed.
  const {library, disposed, arrive} = fixture();
  const life = new AbortController();
  const got = library.model('asset.model.crate', {signal: life.signal});
  await settle();
  life.abort();
  await assert.rejects(got, isAbortError);
  await arrive();
  assert.equal(library.stats().parses, 0);
  assert.equal(disposed.length, 0);

  // Owner leaves while the file is parsing: the parsed scene is disposed on arrival.
  let finish!: (scene: T.Object3D) => void;
  const geometry = new T.BoxGeometry();
  let geometryDisposed = 0;
  geometry.addEventListener('dispose', () => geometryDisposed++);
  const slow = createModelLibrary({
    def: id => defs.find(d => d.id === id),
    fetchBytes: async () => new ArrayBuffer(8),
    parse: () => new Promise(resolve => (finish = resolve)),
  });
  const owner = new AbortController();
  const late = slow.model('asset.model.crate', {signal: owner.signal});
  await settle();
  owner.abort();
  await assert.rejects(late, isAbortError);
  finish(new T.Mesh(geometry, new T.MeshBasicMaterial()));
  await settle();
  assert.equal(slow.stats().lateDrops, 1);
  assert.equal(geometryDisposed, 1);
});

test('an unknown id or a non-model def rejects', async () => {
  const {library} = fixture();
  const signal = new AbortController().signal;
  await assert.rejects(library.model('asset.model.nope', {signal}), /unknown asset id/);
  await assert.rejects(library.model('asset.document.demo-readme', {signal}), /not a model/);
});

test('modelBytes counts buffers and mipmapped texels', () => {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(new Float32Array(9), 3));
  g.setIndex([0, 1, 2]);
  const scene = new T.Mesh(g, new T.MeshBasicMaterial({map: new T.Texture({width: 3, height: 3})}));
  assert.equal(modelBytes(scene), 36 + 6 + 48);
});

test('no model loader registers Draco (meshopt is the only mesh compression)', () => {
  const src = join(import.meta.dirname, '../..');
  const traversal = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? traversal(path)
        : /\.ts$/.test(name) && !/\.test\.ts$/.test(name)
          ? [path]
          : [];
    });
  const draco = traversal(src).filter(path => /DRACOLoader|setDRACOLoader/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(draco, []);
});

test('skeletal instances have independent bones, clips, and owned skeleton disposal', async () => {
  const bone = new T.Bone();
  bone.name = 'joint';
  const mesh = new T.SkinnedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(new T.Skeleton([bone]));
  const scene = new T.Group();
  scene.add(mesh);
  const animation = new T.AnimationClip('bend', 1, [new T.NumberKeyframeTrack('joint.rotation[z]', [0, 1], [0, 1])]);
  const lib = createModelLibrary({
    def: () => defs[0],
    fetchBytes: async () => new ArrayBuffer(4),
    parse: async () => ({scene, animations: [animation]}),
    maxInstances: 2,
  });
  const life = new AbortController(),
    lease = await lib.model(statue, {signal: life.signal});
  const a = lease.value.instantiate(),
    b = lease.value.instantiate();
  const sa = (a.children[0] as T.SkinnedMesh).skeleton,
    sb = (b.children[0] as T.SkinnedMesh).skeleton;
  assert.notEqual(sa, sb);
  assert.notEqual(sa.bones[0], sb.bones[0]);
  assert.notEqual(sa.bones[0], bone);
  must(sa.bones[0]).rotation.z = 0.5;
  assert.equal(Math.abs(must(sb.bones[0]).rotation.z), 0);
  must(animation.tracks[0]).values[1] = 7;
  assert.equal(must(must(lease.value.animations[0]).tracks[0]).values[1], 1);
  assert.throws(() => lease.value.instantiate(), /instance budget/);
  lease.value.releaseInstance(a);
  lease.value.releaseInstance(a);
  assert.equal(lib.stats().instances, 1);
  life.abort();
  assert.equal(lib.stats().instances, 0);
  assert.throws(() => lease.value.instantiate(), /retired/);
});

test('oversized files never parse, oversized retention stays bounded, and live admission releases rejected resources', async () => {
  let parses = 0;
  const lib = createModelLibrary({
    def: () => defs[0],
    fetchBytes: async () => new ArrayBuffer(9),
    maxFileBytes: 8,
    parse: async () => {
      parses++;
      return new T.Group();
    },
  });
  await assert.rejects(lib.model(statue, {signal: new AbortController().signal}), /file exceeds/);
  assert.equal(parses, 0);
  const geometry = new T.BoxGeometry();
  let released = 0;
  geometry.addEventListener('dispose', () => released++);
  const limited = createModelLibrary({
    def: () => defs[0],
    fetchBytes: async () => new ArrayBuffer(9),
    keepBytes: 4,
    maxResidentBytes: 1,
    parse: async () => new T.Mesh(geometry, new T.MeshBasicMaterial()),
  });
  await assert.rejects(limited.model(statue, {signal: new AbortController().signal}), /resident budget/);
  assert.equal(limited.stats().bytesKeptMiB, 0);
  assert.equal(released, 1);
  assert.equal(limited.stats().residentMiB, 0);
});

test('original embedded GLB fixture retains real clip and independent skeletal nodes through default parser', async () => {
  const data = readFileSync(
    join(import.meta.dirname, '../../../templates/mechanics/game/public/models/mechanics/beacon.glb'),
  );
  const lib = createModelLibrary({
    def: () => defs[0],
    fetchBytes: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  });
  const lease = await lib.model(statue, {signal: new AbortController().signal});
  assert.equal(must(lease.value.animations[0]).name, 'pulse');
  const a = lease.value.instantiate(),
    b = lease.value.instantiate();
  assert.notEqual(a.getObjectByName('hand'), b.getObjectByName('hand'));
  const mixer = new T.AnimationMixer(a);
  mixer.clipAction(must(lease.value.animations[0])).play();
  mixer.update(0.25);
  assert.ok(a.getObjectByName('shoulder')!.position.y > 0.1);
  assert.equal(b.getObjectByName('hand')!.position.y, 0.6);
  mixer.stopAllAction();
  mixer.uncacheRoot(a);
  lease.release();
  assert.equal(lib.stats().instances, 0);
  lib.dispose();
});

test('embedded model policy rejects external dependencies before parser creates requests', async () => {
  const {validateEmbeddedGlb} = await import('./models');
  const json = Buffer.from(
    JSON.stringify({asset: {version: '2.0'}, buffers: [{uri: 'https://example.invalid/external.bin'}]}),
  );
  const bytes = new ArrayBuffer(20 + json.length),
    view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20).set(json);
  assert.throws(() => validateEmbeddedGlb(bytes), /must be embedded/);
});

test('immediate reacquire never inherits a cancelled file request from an old owner', async () => {
  let fetches = 0;
  const pending: ((bytes: ArrayBuffer) => void)[] = [];
  const lib = createModelLibrary({
    def: () => defs[0],
    fetchBytes: () => {
      fetches++;
      return new Promise(resolve => pending.push(resolve));
    },
    parse: async () => new T.Group(),
  });
  const old = new AbortController(),
    first = lib.model(statue, {signal: old.signal});
  await settle();
  old.abort();
  await assert.rejects(first, isAbortError);
  const replacement = lib.model(statue, {signal: new AbortController().signal});
  await settle();
  assert.equal(fetches, 2);
  must(pending[0])(new ArrayBuffer(4));
  must(pending[1])(new ArrayBuffer(4));
  const lease = await replacement;
  lease.release();
  lib.dispose();
});

test('cancelled decoders retain pending admission until actual settlement', async () => {
  let finish!: (scene: T.Object3D) => void;
  const lib = createModelLibrary({
    def: () => defs[0],
    maxPending: 1,
    fetchBytes: async () => new ArrayBuffer(4),
    parse: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  });
  const owner = new AbortController(),
    pending = lib.model(statue, {signal: owner.signal});
  await settle();
  owner.abort();
  await assert.rejects(pending, isAbortError);
  for (let i = 0; i < 3; i++)
    await assert.rejects(lib.model(statue, {signal: new AbortController().signal}), /pending budget/);
  assert.equal(lib.stats().parses, 1);
  finish(new T.Group());
  await settle();
  const next = lib.model(statue, {signal: new AbortController().signal});
  await settle();
  finish(new T.Group());
  const lease = await next;
  lease.release();
  lib.dispose();
});

test('late replaced fetch cannot overwrite or double-charge retained bytes', async () => {
  const pending: ((bytes: ArrayBuffer) => void)[] = [],
    parsed: number[] = [];
  const lib = createModelLibrary({
    def: () => defs[0],
    fetchBytes: () => new Promise(resolve => pending.push(resolve)),
    parse: async bytes => {
      parsed.push(bytes.byteLength);
      return new T.Group();
    },
  });
  const owner = new AbortController(),
    old = lib.model(statue, {signal: owner.signal});
  await settle();
  owner.abort();
  await assert.rejects(old, isAbortError);
  const next = lib.model(statue, {signal: new AbortController().signal});
  await settle();
  must(pending[1])(new ArrayBuffer(8));
  const lease = await next;
  lease.release();
  must(pending[0])(new ArrayBuffer(4));
  await settle();
  assert.equal(lib.stats().bytesKeptMiB, 8 / (1024 * 1024));
  const again = await lib.model(statue, {signal: new AbortController().signal});
  assert.deepEqual(parsed, [8, 8]);
  again.release();
  lib.dispose();
});

test('warm model admission charges retained animation tracks', async () => {
  const clip = new T.AnimationClip('motion', 1, [new T.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])]);
  const lib = createModelLibrary({
    def: () => defs[0],
    warmBytes: 1,
    fetchBytes: async () => new ArrayBuffer(4),
    parse: async () => ({scene: new T.Group(), animations: [clip]}),
  });
  const lease = await lib.model(statue, {signal: new AbortController().signal});
  assert.ok(lib.stats().residentMiB > 0);
  lease.release();
  assert.equal(lib.stats().residentMiB, 0);
  assert.equal(lib.stats().disposed, 1);
  lib.dispose();
});

test('model cleanup closes each shared decoded bitmap once on normal, late and rejected loads', async () => {
  for (const mode of ['normal', 'late', 'rejected'] as const) {
    let closed = 0,
      disposed = 0,
      finish!: (scene: T.Object3D) => void;
    const image = {
        width: 4,
        height: 4,
        close() {
          closed++;
        },
      },
      a = new T.Texture(image),
      b = new T.Texture(image);
    const scene = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial({map: a, alphaMap: b}));
    a.addEventListener('dispose', () => disposed++);
    b.addEventListener('dispose', () => disposed++);
    const lib = createModelLibrary({
      def: () => defs[0],
      maxResidentBytes: mode === 'rejected' ? 1 : 1024 * 1024,
      fetchBytes: async () => new ArrayBuffer(4),
      parse: () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    });
    const owner = new AbortController(),
      pending = lib.model(statue, {signal: owner.signal});
    await settle();
    if (mode === 'late') {
      owner.abort();
      await assert.rejects(pending, isAbortError);
      finish(scene);
      await settle();
    } else if (mode === 'rejected') {
      finish(scene);
      await assert.rejects(pending, /resident budget/);
    } else {
      finish(scene);
      (await pending).release();
    }
    assert.equal(closed, 1, mode);
    assert.equal(disposed, 2, mode);
    lib.dispose();
  }
});

test('rejected model cleanup closes images even when a resource disposal listener throws', async () => {
  let closed = 0;
  const texture = new T.Texture({
      width: 4,
      height: 4,
      close() {
        closed++;
      },
    }),
    geometry = new T.BoxGeometry();
  geometry.addEventListener('dispose', () => {
    throw Error('listener failed');
  });
  const lib = createModelLibrary({
    def: () => defs[0],
    maxResidentBytes: 1,
    fetchBytes: async () => new ArrayBuffer(4),
    parse: async () => new T.Mesh(geometry, new T.MeshBasicMaterial({map: texture})),
  });
  await assert.rejects(lib.model(statue, {signal: new AbortController().signal}), /cleanup failed/);
  assert.equal(closed, 1);
  assert.equal(lib.stats().residentMiB, 0);
  lib.dispose();
});

test('throwing instance detachment cannot strand other instances or template resources', async () => {
  let closed = 0;
  const texture = new T.Texture({
    width: 4,
    height: 4,
    close() {
      closed++;
    },
  });
  const lib = createModelLibrary({
    def: () => defs[0],
    warmBytes: 1024 * 1024,
    fetchBytes: async () => new ArrayBuffer(4),
    parse: async () => new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial({map: texture})),
  });
  const lease = await lib.model(statue, {signal: new AbortController().signal}),
    a = lease.value.instantiate(),
    b = lease.value.instantiate(),
    parent = new T.Group();
  parent.add(a, b);
  a.addEventListener('removed', () => {
    throw Error('detach listener failed');
  });
  lease.release();
  assert.throws(() => lib.dispose(), /cleanup failed/);
  assert.equal(lib.stats().instances, 0);
  assert.equal(lib.stats().residentMiB, 0);
  assert.equal(closed, 1);
  assert.equal(b.parent, null);
  assert.equal(lib.stats().bytesKeptMiB, 0);
});

for (const cleanupThrows of [false, true]) {
  test(`failed animation preparation releases resources and permits retry (cleanup throws: ${cleanupThrows})`, async () => {
    const original = new Error('animation clone failed');
    const cleanupError = new Error('geometry cleanup failed');
    const disposals: string[] = [];
    let attempts = 0;
    const library = createModelLibrary({
      def: () => defs[0],
      fetchBytes: async () => new ArrayBuffer(0),
      maxResidentBytes: 1024,
      parse: async () => {
        const attempt = ++attempts;
        const geometry = new T.BoxGeometry();
        const material = new T.MeshBasicMaterial();
        geometry.addEventListener('dispose', () => {
          disposals.push(`geometry-${attempt}`);
          if (attempt === 1 && cleanupThrows) throw cleanupError;
        });
        material.addEventListener('dispose', () => disposals.push(`material-${attempt}`));
        const scene = new T.Group();
        scene.add(new T.Mesh(geometry, material));
        const clip = new T.AnimationClip('motion', 1, []);
        if (attempt === 1)
          clip.clone = () => {
            throw original;
          };
        return {scene, animations: [clip]};
      },
    });
    await assert.rejects(library.model(statue, {signal: new AbortController().signal}), error => {
      if (!cleanupThrows) assert.equal(error, original);
      else {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.cause, original);
        assert.equal(error.errors[0], original);
        assert.ok(error.errors[1] instanceof AggregateError);
        assert.deepEqual(error.errors[1].errors, [cleanupError]);
      }
      return true;
    });
    assert.equal(library.stats().residentMiB, 0);
    assert.deepEqual(disposals, ['geometry-1', 'material-1']);
    const lease = await library.model(statue, {signal: new AbortController().signal});
    assert.equal(must(lease.value.animations[0]).name, 'motion');
    assert.ok(library.stats().residentMiB > 0);
    lease.release();
    library.dispose();
    library.dispose();
    assert.equal(library.stats().residentMiB, 0);
    assert.deepEqual(disposals, ['geometry-1', 'material-1', 'geometry-2', 'material-2']);
  });
}

function sharedSkeletonScene(meshCount: number) {
  const scene = new T.Group(),
    bone = new T.Bone(),
    skeleton = new T.Skeleton([bone]);
  const geometry = new T.BufferGeometry(),
    material = new T.MeshBasicMaterial();
  scene.add(bone);
  for (let i = 0; i < meshCount; i++) {
    const mesh = new T.SkinnedMesh(geometry, material);
    mesh.bind(skeleton);
    scene.add(mesh);
  }
  return {scene, skeleton};
}

test('instance byte admission counts each cloned shared skeleton and restores released capacity', async () => {
  // Four nodes: 2048. Two one-bone meshes each need 64 initial matrix bytes and
  // a minimum 4x4 RGBAFloat CPU array + GPU texture (256 + 256): total 3200.
  const {scene} = sharedSkeletonScene(2);
  const lib = createModelLibrary({
    def: () => defs[0],
    fetchBytes: async () => new ArrayBuffer(4),
    parse: async () => scene,
    maxInstances: 10,
    maxInstanceBytes: 6400,
  });
  const lease = await lib.model(statue, {signal: new AbortController().signal});
  try {
    const a = lease.value.instantiate(),
      b = lease.value.instantiate();
    const meshes = a.children.filter(node => (node as T.SkinnedMesh).isSkinnedMesh) as T.SkinnedMesh[];
    assert.notStrictEqual(must(meshes[0]).skeleton, must(meshes[1]).skeleton);
    for (const mesh of meshes) {
      assert.equal(mesh.skeleton.boneMatrices!.byteLength, 64);
      mesh.skeleton.computeBoneTexture();
      assert.equal(mesh.skeleton.boneMatrices!.byteLength, 256);
    }
    assert.throws(() => lease.value.instantiate(), /instance budget/);
    assert.equal(lib.stats().instances, 2);
    let disposed = 0;
    for (const mesh of meshes) mesh.skeleton.boneTexture!.addEventListener('dispose', () => disposed++);
    lease.value.releaseInstance(a);
    assert.equal(disposed, 2);
    lease.value.releaseInstance(a);
    const c = lease.value.instantiate();
    assert.equal(lib.stats().instances, 2);
    lease.value.releaseInstance(b);
    lease.value.releaseInstance(c);
    assert.equal(lib.stats().instances, 0);
  } finally {
    lease.release();
    lib.dispose();
  }
});

test('per-mesh skeleton and tiny texture charges refuse one byte below each exact admission estimate', async () => {
  for (const [meshCount, budget] of [
    [1, 2111],
    [2, 3199],
  ] as const) {
    const {scene} = sharedSkeletonScene(meshCount);
    let clones = 0;
    const clone = scene.clone.bind(scene);
    scene.clone = (recursive?: boolean) => {
      clones++;
      return clone(recursive);
    };
    // Single-mesh estimate is 2112; shared-source two-mesh estimate is 3200.
    // The second case would admit incorrectly if padded buffers were counted only once.
    const lib = createModelLibrary({
      def: () => defs[0],
      fetchBytes: async () => new ArrayBuffer(4),
      parse: async () => scene,
      maxInstanceBytes: budget,
    });
    const lease = await lib.model(statue, {signal: new AbortController().signal});
    try {
      assert.throws(() => lease.value.instantiate(), /instance budget/);
      assert.equal(clones, 0);
      assert.equal(lib.stats().instances, 0);
    } finally {
      lease.release();
      lib.dispose();
    }
  }
});

test('unsafe instance skeleton estimates reject loading and release resident resources', async () => {
  const {scene, skeleton} = sharedSkeletonScene(1);
  let disposed = 0;
  skeleton.dispose = () => {
    disposed++;
  };
  // A custom parse provider can supply malformed structure. No enormous allocation is needed.
  skeleton.bones = new Proxy(skeleton.bones, {
    get(target, key, receiver) {
      return key === 'length' ? Number.MAX_SAFE_INTEGER : Reflect.get(target, key, receiver);
    },
  });
  const lib = createModelLibrary({
    def: () => defs[0],
    fetchBytes: async () => new ArrayBuffer(4),
    parse: async () => scene,
    maxInstanceBytes: Number.MAX_SAFE_INTEGER,
  });
  try {
    await assert.rejects(lib.model(statue, {signal: new AbortController().signal}), /instance estimate overflow/);
    assert.equal(disposed, 1);
    assert.equal(lib.stats().instances, 0);
    assert.equal(lib.stats().residentMiB, 0);
  } finally {
    lib.dispose();
  }
});
