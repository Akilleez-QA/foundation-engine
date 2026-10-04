import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createSceneSurfaces} from './scene-materials';
import {createSceneResources} from './scene-resources';
import {MATERIAL_DEFAULTS, type MaterialData} from './material';
import type {TextureOptions} from '../platform/assets/textures';
import {AbortError} from '../platform/assets/lease-cache';

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
};
const data = (o: Partial<MaterialData> = {}): MaterialData => ({...MATERIAL_DEFAULTS, repeat: [1, 1], ...o});

/** A library double: one texture per (id, wrap) like the real key, counted leases, optional gating and failure. */
function library() {
  const shared = new Map<string, T.Texture>(),
    requests: (TextureOptions & {id: string})[] = [];
  let live = 0,
    gate: Promise<void> | null = null;
  return {
    requests,
    shared,
    get live() {
      return live;
    },
    hold() {
      let open!: () => void;
      gate = new Promise(r => {
        open = r;
      });
      return () => {
        gate = null;
        open();
      };
    },
    async texture(id: string, o: TextureOptions) {
      requests.push({...o, id});
      if (gate) await gate;
      if (id === 'missing') throw Error('[assets] unknown asset id missing');
      if (o.signal.aborted) throw new AbortError();
      const key = `${id}|${o.wrap ?? 'clamp'}`;
      let texture = shared.get(key);
      if (!texture) {
        texture = new T.Texture({width: 4, height: 4} as HTMLImageElement);
        texture.userData.shared = true;
        texture.wrapS = texture.wrapT = {
          clamp: T.ClampToEdgeWrapping,
          repeat: T.RepeatWrapping,
          mirror: T.MirroredRepeatWrapping,
        }[o.wrap ?? 'clamp'];
        shared.set(key, texture);
      }
      live++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          live--;
        }
      };
      o.signal.addEventListener('abort', release, {once: true});
      return {value: texture, key, id, variant: {path: id, format: 'png' as const}, release};
    },
  };
}
const setup = (o: {anisotropy?: number; signal?: AbortSignal; library?: ReturnType<typeof library> | null} = {}) => {
  const lib = o.library === undefined ? library() : o.library,
    resources = createSceneResources(),
    errors: unknown[] = [];
  let changed = 0;
  const surfaces = createSceneSurfaces({
    library: lib,
    resources,
    signal: o.signal ?? new AbortController().signal,
    anisotropy: o.anisotropy ?? 4,
    changed: () => {
      changed++;
    },
    report: e => errors.push(e),
  });
  return {
    lib: lib!,
    resources,
    errors,
    surfaces,
    get changed() {
      return changed;
    },
  };
};

test('a shape without Material keeps its original matte material', () => {
  const t = setup(),
    surface = t.surfaces.create(undefined, 0x123456);
  assert.ok(surface.material instanceof T.MeshLambertMaterial);
  assert.equal(surface.material.color.getHex(), 0x123456);
  assert.equal(surface.update(data()), false, 'a plain surface cannot become authored in place');
  surface.dispose();
  t.resources.dispose();
});

test('Material maps to a standard material; surfaces with the same texture, wrap and repeat share one view', async () => {
  const t = setup();
  const a = t.surfaces.create(
    data({
      texture: 'tiles',
      repeat: [4, 2],
      wrap: 'mirror',
      roughness: 0.3,
      metalness: 0.6,
      emissive: 0x112233,
      emissiveIntensity: 2,
      opacity: 0.5,
      transparent: true,
    }),
    0xffffff,
  );
  const b = t.surfaces.create(data({texture: 'tiles', repeat: [4, 2], wrap: 'mirror'}), 0xff0000);
  const c = t.surfaces.create(data({texture: 'tiles', wrap: 'clamp'}), 0xff0000);
  const m = a.material as T.MeshStandardMaterial;
  assert.deepEqual(
    [m.roughness, m.metalness, m.emissive.getHex(), m.emissiveIntensity, m.opacity, m.transparent],
    [0.3, 0.6, 0x112233, 2, 0.5, true],
  );
  assert.equal(m.map, null, 'untextured until the lease arrives');
  const shared = () => t.lib.shared.get('tiles|mirror')!;
  const versionAtLease = () => shared().source.version;
  await flush();
  assert.deepEqual(
    t.lib.requests.map(r => [r.anisotropy, r.colorSpace, r.wrap]),
    [
      [4, 'srgb', 'mirror'],
      [4, 'srgb', 'clamp'],
    ],
    'one lease per view',
  );
  const map = m.map!;
  assert.equal((b.material as T.MeshStandardMaterial).map, map, 'same texture, wrap and repeat: one view');
  assert.notEqual(map, shared(), 'the leased texture is never mutated');
  assert.equal(map.source, shared().source, 'the view draws the leased image');
  assert.equal(versionAtLease(), 0, 'making a view does not flag the image for another upload');
  assert.deepEqual([map.wrapS, map.repeat.x, map.repeat.y], [T.MirroredRepeatWrapping, 4, 2]);
  assert.deepEqual([shared().repeat.x], [1]);
  assert.deepEqual(t.surfaces.stats, {leased: 2, applied: 2, failed: 0, views: 2, gradients: 0});
  let disposed = 0;
  map.addEventListener('dispose', () => {
    disposed++;
  });
  a.dispose();
  assert.equal(disposed, 0, 'still used by b');
  b.dispose();
  assert.equal(disposed, 1);
  assert.equal(t.lib.live, 1);
  c.dispose();
  t.resources.dispose();
  assert.equal(t.lib.live, 0);
  assert.equal(t.surfaces.stats.views, 0);
});

test('animating opacity on a textured shape changes the material in place: no new material, lease or draw gap', async () => {
  const t = setup(),
    d = data({texture: 'tiles', transparent: true});
  const surface = t.surfaces.create(d, 0xffffff);
  await flush();
  const material = surface.material as T.MeshStandardMaterial,
    map = material.map!;
  let disposed = 0;
  material.addEventListener('dispose', () => {
    disposed++;
  });
  map.addEventListener('dispose', () => {
    disposed++;
  });
  const version = material.version;
  for (let i = 0; i < 60; i++) {
    d.opacity = 0.5 + 0.5 * Math.sin(i / 10);
    d.roughness = i / 60;
    assert.equal(surface.update(d), true);
    assert.equal(surface.material, material);
    assert.equal(material.map, map);
  }
  assert.equal(material.opacity, d.opacity);
  assert.equal(material.roughness, d.roughness);
  assert.equal(material.version, version, 'no program change for plain fields');
  assert.equal(t.lib.requests.length, 1);
  assert.equal(disposed, 0);
  surface.dispose();
  t.resources.dispose();
});

test('changing the texture keeps drawing the old one until the new one arrives, then releases the old', async () => {
  const t = setup(),
    d = data({texture: 'tiles'});
  const surface = t.surfaces.create(d, 0xffffff);
  await flush();
  const material = surface.material as T.MeshStandardMaterial,
    old = material.map!;
  const open = t.lib.hold();
  assert.equal(surface.update(data({texture: 'stone'})), true);
  await flush();
  assert.equal(material.map, old, 'no untextured frame while the new texture loads');
  assert.equal(t.lib.live, 1);
  open();
  await flush();
  assert.notEqual(material.map, old);
  assert.equal(material.map!.source, t.lib.shared.get('stone|repeat')!.source);
  assert.equal(t.lib.live, 1, 'the old lease released after the swap');
  surface.update(data({texture: ''}));
  assert.equal(material.map, null);
  assert.equal(t.lib.live, 0);
  surface.dispose();
  t.resources.dispose();
});

test('leaving the visit before a texture arrives releases it and never applies it', async () => {
  const lib = library(),
    visit = new AbortController(),
    t = setup({library: lib, signal: visit.signal});
  const open = lib.hold();
  const surface = t.surfaces.create(data({texture: 'tiles'}), 0xffffff);
  visit.abort();
  open();
  await flush();
  assert.equal((surface.material as T.MeshStandardMaterial).map, null);
  assert.equal(t.changed, 0);
  assert.equal(lib.live, 0);
  const late = t.surfaces.create(data({texture: 'tiles'}), 0xffffff);
  await flush();
  assert.equal(lib.requests.length, 1, 'no load starts after the visit ended');
  late.dispose();
  surface.dispose();
  t.resources.dispose();
  assert.deepEqual(t.errors, []);
});

test('a failed texture is reported once and the surface keeps its colour', async () => {
  const t = setup();
  const a = t.surfaces.create(data({texture: 'missing'}), 0xffffff),
    b = t.surfaces.create(data({texture: 'missing'}), 0xffffff);
  await flush();
  assert.equal(t.errors.length, 1);
  assert.match(String(t.errors[0]), /missing/);
  assert.equal((a.material as T.MeshStandardMaterial).map, null);
  assert.equal(t.surfaces.stats.failed, 1);
  a.dispose();
  b.dispose();
  t.resources.dispose();
});

test('invalid runtime data is reported once and drawn plain; anisotropy is clamped', () => {
  const t = setup({anisotropy: 99});
  const surface = t.surfaces.create(data({roughness: 7}), 0xffffff);
  assert.ok(surface.material instanceof T.MeshLambertMaterial);
  assert.equal(t.errors.length, 1);
  assert.notEqual(surface.key, '', 'keyed by the data, so the runtime does not rebuild it every frame');
  const good = t.surfaces.create(data({texture: 'tiles'}), 0xffffff);
  assert.equal(good.update(data({roughness: 7})), false, 'invalid data cannot be shown in place');
  assert.equal(t.lib.requests[0]!.anisotropy, 16);
  t.resources.dispose();
});

test('without a texture library a textured material draws its colour and loads nothing', () => {
  const t = setup({library: null});
  const surface = t.surfaces.create(data({texture: 'tiles'}), 0x00ff00);
  assert.ok(surface.material instanceof T.MeshStandardMaterial);
  assert.equal(t.surfaces.stats.leased, 0);
  surface.dispose();
  t.resources.dispose();
});

test('shading picks one of three material classes; defaults keep the standard material exactly', () => {
  const t = setup();
  const standard = t.surfaces.create(data(), 0xffffff),
    flat = t.surfaces.create(data({shading: 'flat'}), 0xffffff),
    matte = t.surfaces.create(data({shading: 'matte', emissive: 0x330000}), 0xffffff),
    toon = t.surfaces.create(data({shading: 'toon', toonSteps: 4}), 0xffffff);
  assert.equal(standard.material.type, 'MeshStandardMaterial');
  const plainStandard = new T.MeshStandardMaterial({color: 0xffffff});
  for (const field of ['flatShading', 'side', 'alphaTest', 'vertexColors', 'transparent', 'opacity'] as const)
    assert.equal(
      (standard.material as T.MeshStandardMaterial)[field],
      plainStandard[field],
      `default ${field} unchanged`,
    );
  assert.equal(flat.material.type, 'MeshStandardMaterial');
  assert.equal((flat.material as T.MeshStandardMaterial).flatShading, true);
  assert.equal(matte.material.type, 'MeshLambertMaterial');
  assert.equal(matte.material.emissive.getHex(), 0x330000);
  assert.ok(matte.authored);
  assert.equal(toon.material.type, 'MeshToonMaterial');
  const ramp = (toon.material as T.MeshToonMaterial).gradientMap!;
  assert.equal(ramp.magFilter, T.NearestFilter);
  assert.deepEqual([...(ramp.image as {data: Uint8Array}).data], [0, 85, 170, 255]);
  t.resources.dispose();
});

test('faceting, side, cutout and vertex colours change in place; another class needs a new surface', () => {
  const t = setup();
  const surface = t.surfaces.create(data(), 0xffffff, {colors: true});
  const material = surface.material as T.MeshStandardMaterial;
  assert.equal(material.vertexColors, true, 'a mesh with colours draws them by default');
  const version = material.version;
  assert.equal(surface.update(data({shading: 'flat', side: 'double', alphaCutoff: 0.5, vertexColors: false})), true);
  assert.equal(surface.material, material, 'the same material');
  assert.deepEqual(
    [material.flatShading, material.side, material.alphaTest, material.vertexColors],
    [true, T.DoubleSide, 0.5, false],
  );
  assert.ok(material.version > version, 'program-affecting changes ask three to recompile once');
  const settled = material.version;
  assert.equal(surface.update(data({shading: 'flat', side: 'double', alphaCutoff: 0.6, vertexColors: false})), true);
  assert.equal(material.version, settled, 'a new cutoff value keeps the program');
  surface.colors(false);
  assert.equal(surface.update(data({shading: 'flat', vertexColors: true})), true);
  assert.equal(material.vertexColors, false, 'no colours on the geometry: none drawn');
  surface.colors(true);
  assert.equal(material.vertexColors, true);
  assert.equal(surface.update(data({shading: 'toon'})), false, 'standard to toon is a class change');
  assert.equal(surface.update(data({shading: 'matte'})), false, 'standard to matte is a class change');
  t.resources.dispose();
});

test('toon gradients are shared per step count and released with their last user', () => {
  const t = setup();
  const a = t.surfaces.create(data({shading: 'toon', toonSteps: 3}), 0xffffff),
    b = t.surfaces.create(data({shading: 'toon', toonSteps: 3}), 0xff0000),
    c = t.surfaces.create(data({shading: 'toon', toonSteps: 5}), 0xffffff);
  const ramp = (s: typeof a) => (s.material as T.MeshToonMaterial).gradientMap!;
  assert.equal(ramp(a), ramp(b), 'one gradient for every three-step surface');
  assert.notEqual(ramp(a), ramp(c));
  assert.equal(t.surfaces.stats.gradients, 2);
  let disposed = 0;
  ramp(a).addEventListener('dispose', () => disposed++);
  const three = ramp(a);
  assert.equal(c.update(data({shading: 'toon', toonSteps: 3})), true, 'steps change in place');
  assert.equal(ramp(c), three);
  assert.equal(t.surfaces.stats.gradients, 1, 'the five-step gradient went with its last user');
  a.dispose();
  b.dispose();
  assert.equal(disposed, 0);
  c.dispose();
  assert.equal(disposed, 1);
  assert.equal(t.surfaces.stats.gradients, 0);
  t.resources.dispose();
});

test('a plain mesh surface keeps the original matte material with its vertex colours', () => {
  const t = setup();
  const surface = t.surfaces.create(undefined, 0x123456, {colors: true});
  assert.equal(surface.material.type, 'MeshLambertMaterial');
  assert.equal(surface.material.vertexColors, true);
  surface.colors(false);
  assert.equal(surface.material.vertexColors, false);
  t.resources.dispose();
});

test('geometry without texture coordinates reports a texture once and loads nothing', () => {
  const t = setup();
  const surface = t.surfaces.create(data({texture: 'tiles', emissive: 0x112233}), 0xffffff, {uv: false});
  assert.equal(t.lib.requests.length, 0);
  assert.equal(t.errors.length, 1);
  assert.match(String(t.errors[0]), /no texture coordinates/);
  surface.update(data({texture: 'tiles', emissive: 0x332211}));
  assert.equal(t.errors.length, 1, 'reported once');
  assert.equal(surface.material.emissive.getHex(), 0x332211);
  t.resources.dispose();
});

test('leaving the visit disposes every shared toon gradient', () => {
  const life = new AbortController(),
    t = setup({signal: life.signal});
  const surface = t.surfaces.create(data({shading: 'toon'}), 0xffffff);
  let disposed = 0;
  (surface.material as T.MeshToonMaterial).gradientMap!.addEventListener('dispose', () => disposed++);
  life.abort();
  assert.equal(disposed, 1);
  assert.equal(t.surfaces.stats.gradients, 0);
  surface.dispose();
  assert.equal(disposed, 1, 'a later release does not dispose it again');
  t.resources.dispose();
});

test('every authored surface stays eligible for the static batching bake (no shader hooks)', async () => {
  const {bakeStaticMeshes} = await import('../platform/render/batching');
  const t = setup();
  for (const shading of ['standard', 'flat', 'matte', 'toon'] as const) {
    const surface = t.surfaces.create(data({shading, side: 'double', alphaCutoff: 0.3}), 0xffffff);
    assert.equal(surface.material.onBeforeCompile, T.Material.prototype.onBeforeCompile, shading);
    const scope = new T.Group(),
      geometry = new T.BoxGeometry();
    for (const x of [0, 2]) {
      const mesh = new T.Mesh(geometry, surface.material);
      mesh.position.x = x;
      scope.add(mesh);
    }
    assert.equal(bakeStaticMeshes(scope), 2, `${shading} parts merge into one draw`);
    assert.equal(scope.children.length, 1);
    geometry.dispose();
  }
  t.resources.dispose();
});
