import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {SunLight} from 'three/addons/lights/SunLight.js';
import {LightProbeGridWebGL} from 'three/addons/lighting/LightProbeGridWebGL.js';
import {createColourTracker, createShadowTracker, readBatchState, stillSafe, type Surface} from './change-tracker';
import {must} from '../../testing/must';

const surface = (): Surface => ({
  domElement: {width: 800, height: 600},
  toneMapping: T.ACESFilmicToneMapping,
  toneMappingExposure: 1,
});

/** A lit scene holding every kind of dependency the trackers must observe: a plain caster, an instanced mesh,
 *  a batch, a skinned mesh whose bones sit partly under a hidden ancestor, and a morphed mesh. */
function fixture() {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(50, 4 / 3, 0.1, 100);
  camera.position.set(0, 3, 8);
  camera.lookAt(0, 0, 0);
  scene.add(camera);
  const sun = new T.DirectionalLight('#ffffff', 2);
  sun.castShadow = true;
  sun.position.set(5, 10, 5);
  scene.add(sun, sun.target);
  const material = new T.MeshStandardMaterial({color: '#88aacc'});
  const box = new T.Mesh(new T.BoxGeometry(), material);
  box.castShadow = true;
  scene.add(box);
  const instanced = new T.InstancedMesh(new T.BoxGeometry(), material, 4);
  instanced.castShadow = true;
  scene.add(instanced);
  const batch = new T.BatchedMesh(8, 2000, 6000, new T.MeshStandardMaterial());
  batch.castShadow = true;
  const cube = batch.addGeometry(new T.BoxGeometry(), -1, -1),
    ball = batch.addGeometry(new T.SphereGeometry(0.5, 8, 6), 400, 600);
  const pieces = [batch.addInstance(cube), batch.addInstance(cube), batch.addInstance(ball)];
  scene.add(batch);
  // Skeleton: a chain under the mesh, plus one bone under an invisible rig node (ADR 0057 counterexample 1).
  const skinned = new T.SkinnedMesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  skinned.castShadow = true;
  const hip = new T.Bone(),
    knee = new T.Bone();
  hip.add(knee);
  knee.position.y = 1;
  skinned.add(hip);
  const hiddenRig = new T.Group();
  hiddenRig.visible = false;
  const hand = new T.Bone();
  hiddenRig.add(hand);
  scene.add(skinned, hiddenRig);
  scene.updateMatrixWorld(true);
  skinned.bind(new T.Skeleton([hip, knee, hand]));
  const morph = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  morph.geometry.morphAttributes.position = [morph.geometry.getAttribute('position').clone()];
  morph.updateMorphTargets();
  morph.castShadow = true;
  scene.add(morph);
  return {
    scene,
    camera,
    sun,
    material,
    box,
    instanced,
    batch,
    cube,
    ball,
    pieces,
    skinned,
    hip,
    knee,
    hand,
    hiddenRig,
    morph,
  };
}
type Fixture = ReturnType<typeof fixture>;

function trackers(r: Fixture) {
  const out = surface(),
    colour = createColourTracker(),
    shadow = createShadowTracker();
  return {
    out,
    colour,
    shadow,
    // A due colour frame renders, and a render propagates world matrices (and attached bind inverses).
    colourDue: () => {
      const due = colour.scan(out, [r.scene, r.camera]).due;
      r.scene.updateMatrixWorld();
      return due;
    },
    // The shadow scan runs where three's shadow pass does: after world matrices propagate.
    shadowDue: () => {
      r.scene.updateMatrixWorld();
      return shadow.scan(r.scene).due;
    },
  };
}
/** Settled still state yields zero due frames over many scans. */
const still = (due: () => boolean, scans = 120) => {
  for (let i = 0; i < scans; i++) if (due()) return false;
  return true;
};

type Mutation = readonly [name: string, change: (r: Fixture) => void, shadowSees: boolean];
const mutations: Mutation[] = [
  [
    'caster moves',
    r => {
      r.box.position.x += 0.01;
    },
    true,
  ],
  [
    'caster hidden',
    r => {
      r.box.visible = false;
    },
    true,
  ],
  [
    'caster shown',
    r => {
      r.box.visible = true;
    },
    true,
  ],
  ['colour only', r => r.material.color.set('#ff0000'), false],
  [
    'alpha test',
    r => {
      r.material.alphaTest = 0.5;
    },
    true,
  ],
  [
    'texture upload',
    r => {
      r.material.map = new T.DataTexture(new Uint8Array(4), 1, 1);
    },
    true,
  ],
  [
    'texture version',
    r => {
      r.material.map!.needsUpdate = true;
    },
    true,
  ],
  [
    'geometry deformed',
    r => {
      r.box.geometry.getAttribute('position').needsUpdate = true;
    },
    true,
  ],
  [
    'instance matrix',
    r => {
      r.instanced.setMatrixAt(1, new T.Matrix4().makeTranslation(1, 0, 0));
      r.instanced.instanceMatrix.needsUpdate = true;
    },
    true,
  ],
  [
    'instance count',
    r => {
      r.instanced.count = 3;
    },
    true,
  ],
  ['batch setMatrixAt', r => r.batch.setMatrixAt(must(r.pieces[0]), new T.Matrix4().makeTranslation(0, 1, 0)), true],
  ['batch setColorAt', r => r.batch.setColorAt(must(r.pieces[0]), new T.Color(1, 0, 0)), false],
  ['batch setVisibleAt', r => r.batch.setVisibleAt(must(r.pieces[1]), false), true],
  ['batch setGeometryIdAt', r => r.batch.setGeometryIdAt(must(r.pieces[0]), r.ball), true],
  ['batch deleteInstance', r => r.batch.deleteInstance(must(r.pieces[1])), true],
  [
    'batch addInstance',
    r => {
      r.pieces[1] = r.batch.addInstance(r.cube);
    },
    true,
  ],
  ['batch setGeometryAt', r => r.batch.setGeometryAt(r.ball, new T.SphereGeometry(0.4, 8, 6)), true],
  [
    'bone pose',
    r => {
      r.knee.rotation.z = 0.3;
    },
    true,
  ],
  [
    'bone under hidden ancestor',
    r => {
      r.hand.position.x = 2;
    },
    true,
  ],
  [
    'hidden ancestor moves',
    r => {
      r.hiddenRig.position.y = 1;
    },
    true,
  ],
  [
    'inverse bind',
    r => {
      must(r.skinned.skeleton.boneInverses[2]).makeTranslation(-1, 0, 0);
    },
    true,
  ],
  [
    'bind matrix',
    r => {
      r.skinned.bindMatrix.makeTranslation(0, 0.1, 0);
      r.skinned.bindMatrixInverse.copy(r.skinned.bindMatrix).invert();
    },
    true,
  ],
  [
    'bind mode',
    r => {
      r.skinned.bindMode = T.DetachedBindMode;
    },
    true,
  ],
  [
    'skeleton reordered',
    r => {
      const s = r.skinned.skeleton;
      r.skinned.bind(
        new T.Skeleton(
          [must(s.bones[1]), must(s.bones[0]), must(s.bones[2])],
          [must(s.boneInverses[1]), must(s.boneInverses[0]), must(s.boneInverses[2])],
        ),
        r.skinned.bindMatrix,
      );
    },
    true,
  ],
  [
    'skeleton replaced',
    r => {
      const s = r.skinned.skeleton;
      r.skinned.bind(
        new T.Skeleton(
          s.bones.slice(),
          s.boneInverses.map(m => m.clone()),
        ),
        r.skinned.bindMatrix,
      );
    },
    true,
  ],
  [
    'bone reparented',
    r => {
      r.hip.attach(r.hand);
    },
    true,
  ],
  [
    'morph weight',
    r => {
      r.morph.morphTargetInfluences![0] = 0.5;
    },
    true,
  ],
  [
    'light moves',
    r => {
      r.sun.position.x = 6;
    },
    true,
  ],
  [
    'light dims',
    r => {
      r.sun.intensity = 1;
    },
    false,
  ],
  [
    'shadow map size',
    r => {
      r.sun.shadow.mapSize.set(2048, 2048);
    },
    true,
  ],
  [
    'caster added',
    r => {
      const m = new T.Mesh(new T.BoxGeometry(), r.material);
      m.castShadow = true;
      r.scene.add(m);
    },
    true,
  ],
];

test('colour tracker: every supported mutation makes the next frame due, then settles to zero due frames', () => {
  const r = fixture(),
    t = trackers(r);
  assert.equal(t.colourDue(), true, 'first frame');
  assert.ok(still(t.colourDue), 'a still scene with a batch and a skinned mesh is not pinned');
  for (const [name, change] of mutations) {
    change(r);
    assert.equal(t.colourDue(), true, name);
    assert.ok(still(t.colourDue, 5), name + ' settles');
  }
  const view: [string, () => void][] = [
    [
      'camera turns',
      () => {
        r.camera.rotation.y += 0.01;
      },
    ],
    [
      'zoom',
      () => {
        r.camera.fov = 40;
        r.camera.updateProjectionMatrix();
      },
    ],
    [
      'canvas resized',
      () => {
        (t.out.domElement as {width: number}).width = 801;
      },
    ],
    [
      'background',
      () => {
        r.scene.background = new T.Color('#102030');
      },
    ],
    [
      'fog',
      () => {
        r.scene.fog = new T.Fog('#000', 1, 50);
      },
    ],
  ];
  for (const [name, change] of view) {
    change();
    assert.equal(t.colourDue(), true, name);
    assert.ok(still(t.colourDue, 5), name + ' settles');
  }
  t.colour.invalidate();
  assert.equal(t.colourDue(), true, 'invalidate');
  assert.equal(t.colour.stats.forced, 0, 'nothing in this scene is unobservable');
});

test('shadow tracker: every depth mutation makes the map due; colour-only changes do not; settles to zero', () => {
  const r = fixture(),
    t = trackers(r);
  assert.equal(t.shadowDue(), true, 'first map');
  assert.ok(still(t.shadowDue), 'still batch and posed skinned mesh keep shadowDrawsIdle at 0');
  for (const [name, change, shadowSees] of mutations) {
    change(r);
    assert.equal(t.shadowDue(), shadowSees, name);
    assert.ok(still(t.shadowDue, 5), name + ' settles');
  }
  t.shadow.invalidate();
  assert.equal(t.shadowDue(), true, 'invalidate');
  assert.equal(t.shadow.stats.forced, 0);
});

test('a mutation after 120 unchanged scans reaches the very next frame (no alternate-frame shortcut)', () => {
  for (const [k, [name, change, shadowSees]] of mutations.entries()) {
    // Replay the earlier mutations first: some (showing, re-uploading) only mean something after another.
    const r = fixture(),
      t = trackers(r);
    for (const [, earlier] of mutations.slice(0, k)) earlier(r);
    t.colourDue();
    t.shadowDue();
    assert.ok(still(t.colourDue, 120) && still(t.shadowDue, 120), name + ' idle');
    change(r);
    assert.equal(t.colourDue(), true, name + ' colour');
    assert.equal(t.shadowDue(), shadowSees, name + ' shadow');
  }
});

test('ADR 0057 counterexamples: a hidden-ancestor bone and an inverse-bind-only change are both observed', () => {
  // The visible-node signature of the old tracker misses both; the skinned vertex still moves on screen.
  const r = fixture(),
    t = trackers(r);
  t.colourDue();
  t.shadowDue();
  r.hand.position.x = 3;
  assert.equal(t.colourDue(), true);
  assert.equal(t.shadowDue(), true);
  must(r.skinned.skeleton.boneInverses[2]).makeTranslation(-2, 0, 0);
  assert.equal(t.colourDue(), true);
  assert.equal(t.shadowDue(), true);
  // setGeometryIdAt changes no texture version. r186 also raises the private _visibilityChanged flag (r183 did not);
  // the trackers never read that flag, so it is cleared again here: only the ordered instance scan can see the change.
  const before = r.batch.getGeometryIdAt(must(r.pieces[2])),
    matrices = readBatchState(r.batch)!.matrices.version;
  const flags = r.batch as unknown as {_visibilityChanged: boolean};
  flags._visibilityChanged = false;
  r.batch.setGeometryIdAt(must(r.pieces[2]), before === r.cube ? r.ball : r.cube);
  assert.equal(flags._visibilityChanged, true, 'three r186 flags the instance change');
  flags._visibilityChanged = false;
  assert.equal(readBatchState(r.batch)!.matrices.version, matrices);
  assert.equal(flags._visibilityChanged, false);
  assert.equal(t.colourDue(), true);
  assert.equal(t.shadowDue(), true);
});

test('anything unobservable forces a redraw on every scan (a frame is spent, never a picture lost)', () => {
  const cases: [string, (r: Fixture) => void, 'colour' | 'shadow' | 'both'][] = [
    [
      'object render hook',
      r => {
        r.box.onBeforeRender = () => {};
      },
      'colour',
    ],
    [
      'material render hook',
      r => {
        r.material.onBeforeRender = () => {};
      },
      'colour',
    ],
    [
      'material compile hook',
      r => {
        r.material.onBeforeCompile = () => {};
      },
      'colour',
    ],
    // A map reaches the depth pass only through a discard (alphaTest): without one, the colour pass alone is forced.
    [
      'video texture',
      r => {
        r.material.map = Object.assign(new T.Texture(), {isVideoTexture: true}) as T.Texture;
      },
      'colour',
    ],
    [
      'render-target texture',
      r => {
        r.material.map = new T.WebGLRenderTarget(4, 4).texture;
      },
      'colour',
    ],
    [
      'video texture, alpha-tested',
      r => {
        r.material.alphaTest = 0.5;
        r.material.map = Object.assign(new T.Texture(), {isVideoTexture: true}) as T.Texture;
      },
      'both',
    ],
    [
      'render-target texture, alpha-tested',
      r => {
        r.material.alphaTest = 0.5;
        r.material.map = new T.WebGLRenderTarget(4, 4).texture;
      },
      'both',
    ],
    [
      'bone outside the scene',
      r => {
        const loose = new T.Bone(),
          s = r.skinned.skeleton;
        r.skinned.bind(new T.Skeleton([...s.bones, loose]), r.skinned.bindMatrix);
      },
      'both',
    ],
    [
      'custom batch render hook',
      r => {
        r.batch.onBeforeRender = () => {};
      },
      'colour',
    ],
    [
      'custom batch shadow hook',
      r => {
        r.batch.onBeforeShadow = () => {};
      },
      'both',
    ],
    [
      'custom batch sort',
      r => {
        r.batch.setCustomSort(() => {});
      },
      'both',
    ],
    [
      'batch state unreadable',
      r => {
        (r.batch as unknown as {_matricesTexture: null})._matricesTexture = null;
      },
      'both',
    ],
    [
      'object shadow hook',
      r => {
        r.box.onBeforeShadow = () => {};
      },
      'shadow',
    ],
    [
      'custom depth material',
      r => {
        r.box.customDepthMaterial = new T.MeshDepthMaterial();
      },
      'shadow',
    ],
    // three r186: a SunLight fits its cascades to the view camera inside the depth pass; the shadow scan reads no camera.
    [
      'camera-fitted shadow cascades',
      r => {
        const sun = new SunLight('#fff', 1);
        sun.castShadow = true;
        r.scene.add(sun);
      },
      'shadow',
    ],
    // three r186: a light probe grid's baked atlas is a render target, rebaked by rendering.
    [
      'light probe grid atlas',
      r => {
        const grid = new LightProbeGridWebGL(4, 2, 4);
        grid.texture = new T.WebGL3DRenderTarget(4, 4, 4).texture;
        r.scene.add(grid);
      },
      'colour',
    ],
  ];
  for (const [name, change, which] of cases) {
    const r = fixture(),
      t = trackers(r);
    t.colourDue();
    t.shadowDue();
    assert.ok(still(t.colourDue, 3) && still(t.shadowDue, 3));
    change(r);
    for (let i = 0; i < 5; i++) {
      const c = t.colour.scan(t.out, [r.scene, r.camera]);
      r.scene.updateMatrixWorld();
      const s = t.shadow.scan(r.scene);
      if (which !== 'shadow') {
        assert.equal(c.due, true, name + ' colour');
        assert.ok(c.forcedBy, name + ' colour forced');
      }
      if (which !== 'colour') {
        assert.equal(s.due, true, name + ' shadow');
        assert.ok(s.forcedBy, name + ' shadow forced');
      }
    }
  }
});

test('a hook marked still-safe does not force; the exact built-in batch hooks are exempt, no type forces', () => {
  const r = fixture(),
    t = trackers(r);
  r.box.onBeforeRender = stillSafe(() => {});
  r.material.onBeforeCompile = stillSafe(() => {});
  t.colourDue();
  t.shadowDue();
  assert.ok(still(t.colourDue) && still(t.shadowDue));
  assert.equal(t.colour.stats.forced, 0);
  assert.equal(t.shadow.stats.forced, 0);
});

test('light probe grid (three r186): placement, box, resolution and a still-safe atlas are observed without forcing', () => {
  const r = fixture(),
    grid = new LightProbeGridWebGL(4, 2, 4);
  grid.texture = stillSafe(new T.WebGL3DRenderTarget(4, 4, 4).texture);
  r.scene.add(grid);
  const t = trackers(r);
  t.colourDue();
  assert.ok(still(t.colourDue, 5), 'a baked grid settles');
  const changes: [string, () => void][] = [
    [
      'grid box',
      () => {
        grid.boundingBox.max.x += 1;
      },
    ],
    [
      'grid resolution',
      () => {
        grid.resolution.x += 1;
      },
    ],
    [
      'grid moved',
      () => {
        grid.position.x += 1;
      },
    ],
    [
      'grid hidden',
      () => {
        grid.visible = false;
      },
    ],
    [
      'grid shown',
      () => {
        grid.visible = true;
      },
    ],
    [
      'atlas rebaked into another target',
      () => {
        grid.texture = stillSafe(new T.WebGL3DRenderTarget(4, 4, 4).texture);
      },
    ],
    [
      'atlas released',
      () => {
        grid.texture = null;
      },
    ],
  ];
  for (const [name, change] of changes) {
    change();
    assert.equal(t.colourDue(), true, name);
    assert.ok(still(t.colourDue, 5), name + ' settles');
  }
  assert.equal(t.colour.stats.forced, 0);
});

test('adapter contract: three 0.186 exposes the private batch state the trackers read', () => {
  assert.match(T.REVISION, /^186/, 'engine upgrade: re-verify readBatchState and every batch mutation above');
  const b = new T.BatchedMesh(4, 100, 300, new T.MeshBasicMaterial()),
    g = b.addGeometry(new T.BoxGeometry()),
    i = b.addInstance(g);
  const s = readBatchState(b);
  assert.ok(s);
  assert.ok(s.matrices.isDataTexture);
  assert.equal(s.colors, null);
  assert.deepEqual(
    s.instances.map(x => [x.active, x.visible, x.geometryIndex]),
    [[true, true, g]],
  );
  assert.deepEqual(
    Object.keys(must(s.geometries[0]))
      .filter(k => ['active', 'vertexStart', 'vertexCount', 'indexStart', 'indexCount', 'start', 'count'].includes(k))
      .sort(),
    ['active', 'count', 'indexCount', 'indexStart', 'start', 'vertexCount', 'vertexStart'],
  );
  const version = s.matrices.version;
  b.setMatrixAt(i, new T.Matrix4().makeScale(2, 2, 2));
  assert.ok(s.matrices.version > version);
  b.setColorAt(i, new T.Color(1, 0, 0));
  assert.ok(readBatchState(b)!.colors?.isDataTexture);
});

test('timing: tracker scans for 1,000 objects plus a 60-bone rig (ADR 0056 reversal threshold 0.1 ms)', () => {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(50, 1.6, 0.1, 500);
  scene.add(camera);
  const sun = new T.DirectionalLight('#fff', 2);
  sun.castShadow = true;
  scene.add(sun, sun.target);
  const materials = Array.from(
    {length: 40},
    (_, i) => new T.MeshStandardMaterial({color: new T.Color().setHSL(i / 40, 0.5, 0.5), roughness: 0.6}),
  );
  const geometries = [new T.BoxGeometry(), new T.SphereGeometry(0.5, 12, 8), new T.CylinderGeometry(0.3, 0.3, 1, 12)];
  for (let i = 0; i < 1000; i++) {
    const g = new T.Group(),
      m = new T.Mesh(geometries[i % 3], materials[i % 40]);
    m.castShadow = i % 2 === 0;
    m.position.set(i % 40, 0, Math.floor(i / 40));
    if (i % 10 === 0) {
      scene.add(g);
      g.add(m);
    } else scene.add(m);
  }
  const bones: T.Bone[] = [];
  for (let i = 0; i < 60; i++) {
    const b = new T.Bone();
    b.position.y = 0.1;
    (bones[i - 1] ?? scene).add(b);
    bones.push(b);
  }
  const rig = new T.SkinnedMesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  rig.castShadow = true;
  scene.add(rig);
  scene.updateMatrixWorld(true);
  rig.bind(new T.Skeleton(bones));
  const out = surface(),
    colour = createColourTracker(),
    shadow = createShadowTracker();
  const time = (scan: () => void) => {
    for (let i = 0; i < 2000; i++) scan();
    const samples: number[] = [];
    for (let k = 0; k < 25; k++) {
      const c0 = process.cpuUsage();
      for (let i = 0; i < 40; i++) scan();
      const used = process.cpuUsage(c0);
      samples.push((used.user + used.system) / 1e3 / 40);
    }
    samples.sort((a, b) => a - b);
    return {median: must(samples[12]), p90: must(samples[22])};
  };
  const c = time(() => colour.scan(out, [scene, camera])),
    s = time(() => shadow.scan(scene));
  const pose = time(() => {
    must(bones[30]).rotation.z += 1e-3;
    colour.scan(out, [scene, camera]);
  });
  console.log(
    `[change-tracker timing] 1000 meshes + 60-bone rig: colour scan median ${(c.median * 1000).toFixed(1)} µs (p90 ${(c.p90 * 1000).toFixed(1)}), ${colour.stats.values} values; shadow scan median ${(s.median * 1000).toFixed(1)} µs (p90 ${(s.p90 * 1000).toFixed(1)}), ${shadow.stats.values} values; colour scan while posing ${(pose.median * 1000).toFixed(1)} µs`,
  );
  assert.ok(colour.stats.forced === 0 && shadow.stats.forced === 0);
});
