// "After": the same courtyard through @kits/three. Lanterns are custom objects with real point lights (two of them cast
// shadows), the moon casts a shadow, and an EffectComposer with UnrealBloomPass makes the glass glow.
import {defineScene, sceneParticles, Transform} from '@engine';
import {Solid} from '@kits/character';
import {sceneThree, ThreeObject, THREE} from '@kits/three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {lantern, shadowedLantern} from './lantern';
import {bloom, shadows} from './look';
import {courtyardRows, courtyardSystems, courtyardView, LANTERNS, type Row} from './parts';

const SHADOWED = new Set([4, 5]);

export default defineScene({
  id: 'courtyard-lit',
  title: 'Courtyard (three.js kit)',
  particles: sceneParticles({emitters: 32, max: 4096}),
  extensions: [
    sceneThree({
      objects: [lantern, shadowedLantern],
      max: 8,
      shadows: 'pcf-soft',
      setup(three) {
        bloom(three, {strength: 0.65, radius: 0.5, threshold: 0.9});
        shadows(three);
      },
    }),
  ],
  view: courtyardView,
  entities: [
    ...courtyardRows(),
    ...LANTERNS.map(([x, z], i): Row => [
      Transform({x, z}),
      ThreeObject({use: SHADOWED.has(i) ? 'lantern-shadowed' : 'lantern'}),
      Solid({r: 0.2}),
    ]),
  ],
  systems: courtyardSystems,
  enter(ctx) {
    ctx.state.collected = 0;
    ctx.state.t = 0;
    // One three.js copy: what an addon makes is an instance of the engine's classes.
    const merged = mergeGeometries([new THREE.BoxGeometry()]);
    ctx.state.threeCopies = merged instanceof THREE.BufferGeometry ? 1 : 2;
    merged.dispose();
  },
});
