import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {disposeOwnedTree} from './dispose-owned-tree';
import {must} from '../../testing/must';
test('throwing resource disposers do not skip sibling resources or dispose borrowed references', () => {
  const root = new T.Group(),
    first = new T.BoxGeometry(),
    second = new T.PlaneGeometry();
  const texture = new T.Texture(),
    borrowedTexture = new T.Texture();
  const owned = new T.MeshBasicMaterial({map: texture}),
    borrowed = new T.MeshBasicMaterial({map: borrowedTexture});
  root.add(new T.Mesh(first, [owned, borrowed]), new T.Mesh(second, owned));
  const calls: string[] = [],
    geometryFailure = Error('geometry listener failed'),
    materialFailure = Error('material listener failed');
  first.addEventListener('dispose', () => {
    calls.push('first');
    throw geometryFailure;
  });
  second.addEventListener('dispose', () => {
    calls.push('second');
  });
  owned.addEventListener('dispose', () => {
    calls.push('material');
    throw materialFailure;
  });
  texture.addEventListener('dispose', () => {
    calls.push('texture');
  });
  borrowed.addEventListener('dispose', () => {
    calls.push('borrowed');
  });
  borrowedTexture.addEventListener('dispose', () => {
    calls.push('borrowed texture');
  });
  assert.throws(
    () => disposeOwnedTree(root, {preserveMaterial: m => m === borrowed}),
    error => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [geometryFailure, materialFailure]);
      return true;
    },
  );
  assert.deepEqual(calls, ['first', 'second', 'material', 'texture']);
});
test('owned activity resources dispose once across meshes, lines, sprites and duplicate maps', () => {
  const root = new T.Group(),
    geometry = new T.BoxGeometry(),
    texture = new T.Texture(),
    material = new T.MeshBasicMaterial({map: texture, alphaMap: texture}),
    spriteMaterial = new T.SpriteMaterial({map: texture});
  root.add(
    new T.Mesh(geometry, [material, material]),
    new T.Mesh(geometry, material),
    new T.Line(geometry, material),
    new T.Sprite(spriteMaterial),
  );
  const counts = [0, 0, 0, 0];
  [geometry, texture, material, spriteMaterial].forEach((resource, i) =>
    resource.addEventListener('dispose', () => (counts[i] = must(counts[i]) + 1)),
  );
  const result = disposeOwnedTree(root);
  assert.deepEqual(counts, [1, 1, 1, 1]);
  assert.equal(result.textures, 1);
  assert.equal(result.materials, 2);
  assert.equal(result.geometries, 1);
  assert.deepEqual(disposeOwnedTree(undefined), {geometries: 0, materials: 0, textures: 0});
});

test('borrowed finishes and their textures survive disposal of an owning geometry tree', () => {
  const root = new T.Group(),
    geometry = new T.BoxGeometry(),
    sharedTexture = new T.Texture(),
    ownTexture = new T.Texture();
  const borrowed = new T.MeshBasicMaterial({map: sharedTexture}),
    owned = new T.MeshBasicMaterial({map: sharedTexture, alphaMap: ownTexture});
  root.add(new T.Mesh(geometry, [borrowed, owned]));
  const counts = [0, 0, 0, 0, 0];
  [geometry, borrowed, owned, sharedTexture, ownTexture].forEach((resource, i) =>
    resource.addEventListener('dispose', () => (counts[i] = must(counts[i]) + 1)),
  );
  assert.deepEqual(disposeOwnedTree(root, {preserveMaterial: m => m === borrowed}), {
    geometries: 1,
    materials: 1,
    textures: 1,
  });
  assert.deepEqual(counts, [1, 0, 1, 0, 1]);
  borrowed.dispose();
  sharedTexture.dispose();
});

test('module-lifetime resources survive: shared flags, kit finishes, ArrowHelper singletons', async () => {
  const {sharedGeometry, sharedMaterial, finishMaterial: kitMaterial} = await import('./shared-resources');
  const {pageResidents} = await import('../assets/app-ownership');
  const root = new T.Group(),
    kitMap = new T.Texture(),
    kit = kitMaterial('dispose-test finish', () => new T.MeshStandardMaterial({map: kitMap})),
    shared = sharedMaterial('dispose-test glint', () => new T.MeshBasicMaterial({map: new T.Texture()}));
  const sharedGeo = sharedGeometry('dispose-test sphere', () => new T.SphereGeometry(1, 4, 4)),
    patch = pageResidents.adopt(new T.Texture()),
    arrow = new T.ArrowHelper();
  const instanced = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial(), 4);
  root.add(
    new T.Mesh(sharedGeo, kit),
    new T.Mesh(new T.PlaneGeometry(), shared),
    new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({map: patch})),
    arrow,
    instanced,
  );
  const spared = [kit, kitMap, shared, shared.map!, sharedGeo, patch, arrow.line.geometry, arrow.cone.geometry],
    hits = spared.map(() => 0);
  spared.forEach((r, i) => r.addEventListener('dispose', () => (hits[i] = must(hits[i]) + 1)));
  const result = disposeOwnedTree(root);
  assert.deepEqual(
    hits,
    spared.map(() => 0),
  );
  // Owned: two plane geometries + instanced box; the patch mesh material, the instanced material and the two arrow materials.
  assert.deepEqual(result, {geometries: 3, materials: 4, textures: 0});
});

test('disposeOwnedTree spares every resource assets.owns() answers for ', async () => {
  const {assetOwners, pageResidents} = await import('../assets/app-ownership');
  const {
    finishMaterial: kitMaterial,
    releaseFinish: releaseKitMaterial,
    sharedGeometry,
    sharedMaterial,
  } = await import('./shared-resources');
  const {createTextureLibrary} = await import('../assets/textures');
  const library = createTextureLibrary({
    def: id => ({
      id,
      kind: 'texture',
      title: 't',
      licence: 'original',
      provenance: {},
      variants: [{path: 't.png', format: 'png', width: 4}],
    }),
    loadImage: async () => ({width: 4, height: 4}),
  });
  const unregister = assetOwners.register(library),
    abort = new AbortController();
  const leased = (await library.texture('asset.texture.test', {screenPx: 2, signal: abort.signal})).value;
  delete leased.userData.shared; // the library answers, not the legacy flag
  const kitMap = new T.Texture(),
    kit = kitMaterial('owns-test finish', () => new T.MeshStandardMaterial({map: kitMap}));
  const sharedGeo2 = sharedGeometry('owns-test ball', () => new T.SphereGeometry(1, 4, 4)),
    sharedMat2 = sharedMaterial('owns-test glint', () => new T.MeshBasicMaterial());
  const glow = pageResidents.adopt(new T.Texture()),
    glowMaterial = new T.SpriteMaterial({map: glow});
  const ownedMap = new T.Texture(),
    root = new T.Group();
  root.add(
    new T.Mesh(sharedGeo2, kit),
    new T.Mesh(new T.PlaneGeometry(), sharedMat2),
    new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({map: leased, alphaMap: ownedMap})),
    new T.Sprite(glowMaterial),
  );
  const spared = [leased, kit, kitMap, sharedGeo2, sharedMat2, glow],
    hits = spared.map(() => 0);
  spared.forEach((r, i) => r.addEventListener('dispose', () => (hits[i] = must(hits[i]) + 1)));
  for (const r of spared) if (r !== kitMap) assert.equal(assetOwners.owns(r), true); // kitMap is spared as a map of an owned finish
  let glowMaterialDisposed = 0;
  glowMaterial.addEventListener('dispose', () => glowMaterialDisposed++);
  // Owned: the two planes; the leased-map material and the glow sprite's material; the owned alpha map.
  assert.deepEqual(disposeOwnedTree(root), {geometries: 2, materials: 2, textures: 1});
  assert.deepEqual(
    hits,
    spared.map(() => 0),
  );
  assert.equal(glowMaterialDisposed, 1);
  // A released kit finish goes back to one owner, whose tree then disposes it.
  assert.equal(releaseKitMaterial('owns-test finish'), kit);
  assert.equal(assetOwners.owns(kit), false);
  const again = new T.Group();
  again.add(new T.Mesh(new T.PlaneGeometry(), kit));
  disposeOwnedTree(again);
  assert.equal(hits[1], 1);
  abort.abort();
  unregister();
  assert.equal(assetOwners.owns(leased), false);
});
