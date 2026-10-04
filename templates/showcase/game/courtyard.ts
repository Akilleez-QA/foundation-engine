// The courtyard at night: lantern light baked into the stonework, glowing glass, a fountain, fireflies, and embers to
// find. Walk into an ember to take it; the gate in the north wall leads to the garden.
import {
  defineComponent,
  defineEmitter,
  defineEntity,
  defineMaterial,
  defineScatter,
  defineScene,
  defineSystem,
  Name,
  PointLight,
  sceneLights,
  sceneParticles,
  sceneScatter,
  sceneShadows,
  Shadow,
  Shape,
  Transform,
} from '@engine';
import {Solid, Walls} from '@kits/character';
import {Interactable} from '@kits/explore';
import {hud} from '@kits/ui';
import {
  BENCHES,
  courtyardGround,
  courtyardStone,
  FOUNTAIN_R,
  HALF,
  LANTERN_Y,
  PLANTERS,
  POSTS,
  SCONCES,
  STREET_LAMPS,
} from './courtyard-scenery';
import embers from './embers';
import {blobMesh} from './forms';
import {lanternNight, palette as P} from './look';
import {motes, player, systems, wanderMotes} from './world';

/** Something to find: its id (remembered once taken) and how close the player must come, in metres. */
export const Ember = defineComponent('ember', {id: '', reach: 0.7, phase: 0});

export const EMBERS: [number, number][] = [
  [-7.5, -2],
  [7.6, -2.5],
  [-3, -8.2],
  [4.2, 7.6],
  [-4.6, 7.4],
  [0, -6.4],
];

const ember = ([x, z]: [number, number], i: number) => [
  Transform({x, y: 0.9, z}),
  Shape({kind: 'sphere', size: [0.36, 0.36, 0.36], color: 0xff8a30}),
  defineMaterial({emissive: 0xff5a10, emissiveIntensity: 1.6}),
  Shadow({cast: false}),
  Ember({id: `ember-${i + 1}`, phase: i * 1.1}),
  defineEmitter({
    mode: 'continuous',
    rate: 7,
    max: 10,
    lifetime: [0.6, 1.2],
    speed: [0.15, 0.4],
    spread: 0.6,
    direction: [0, 1, 0],
    size: [0.1, 0.02],
    color: [0xffe0a0, 0xff7a1a],
    opacity: [1, 0],
  }),
];

/** Spawned where an ember was taken: a short shower of sparks that removes itself. */
export const emberBurst = defineEntity({
  id: 'ember-burst',
  components: [
    defineEmitter({
      mode: 'burst',
      count: 36,
      bursts: 1,
      max: 36,
      lifetime: [0.4, 0.8],
      speed: [1.5, 3],
      spread: Math.PI / 2,
      direction: [0, 1, 0],
      gravity: [0, -4, 0],
      size: [0.14, 0.02],
      color: [0xffffff, 0xffb04a, 0xff5a00],
      opacity: [1, 0],
      despawn: true,
      // Feedback the player needs (an ember was taken): never thinned, and still shown (held still) under Calm.
      essential: true,
    }),
  ],
});

/** Embers bob and turn; one the save says is taken is removed on entering. */
export const bobEmbers = defineSystem({
  id: 'bob-embers',
  phase: 'frame',
  run(ctx) {
    const taken = ctx.save(embers).get().taken;
    for (const [e, tr, em] of ctx.world.query(Transform, Ember)) {
      if (taken.includes(em.id)) {
        ctx.world.despawn(e);
        continue;
      }
      if (ctx.time.calm) continue;
      tr.y = 0.9 + Math.sin(ctx.time.t * 2 + em.phase) * 0.12;
      tr.ry = ctx.time.t + em.phase;
      ctx.world.touch();
    }
  },
});

/** Walking into an ember takes it: a burst of sparks, a sound, and it is remembered. */
export const takeEmbers = defineSystem({
  id: 'take-embers',
  run(ctx) {
    const p = ctx.named('player'),
      me = p === undefined ? undefined : ctx.world.get(p, Transform);
    if (!me) return;
    for (const [e, tr, em] of ctx.world.query(Transform, Ember)) {
      if (Math.hypot(tr.x - me.x, tr.z - me.z) > em.reach) continue;
      ctx.spawn(emberBurst, Transform({x: tr.x, y: tr.y, z: tr.z}));
      ctx.world.despawn(e);
      ctx.save(embers).update(d => {
        if (!d.taken.includes(em.id)) d.taken.push(em.id);
      });
      ctx.play('ui.success', {volume: 0.6});
    }
  },
});

export const emberHud = defineSystem({
  id: 'ember-hud',
  phase: 'frame',
  run(ctx) {
    const n = ctx.save(embers).get().taken.length;
    hud(ctx).line('embers', ctx.text('game.hud.embers', {n, total: EMBERS.length}));
    hud(ctx).banner(n === EMBERS.length ? ctx.text('game.embers-all') : null);
  },
});

/** Lantern glass: it glows (emissive 1: stronger glows wash out to white under tone mapping), and a point light in it
 *  lights the courtyard. The glass casts no shadow, or it would shadow its own light. */
const glass = (x: number, y: number, z: number, size: number, intensity: number) => [
  Transform({x, y, z}),
  Shape({kind: 'box', size: [size, size * 1.2, size], color: 0xff9a40}),
  defineMaterial({emissive: 0xff8a30, emissiveIntensity: 1}),
  PointLight({color: P.lantern, intensity, distance: 6.5, decay: 2}),
  Shadow({cast: false}),
];

export default defineScene({
  id: 'courtyard',
  title: 'Courtyard',
  type: 'area',
  view: {
    camera: {position: [0, 11.5, 18.3], target: [0, 0.7, 6.5], fov: 50, minWidthFov: 50},
    background: lanternNight.background,
    environment: lanternNight,
    output: {toneMapping: 'aces', exposure: 1.1},
    // Bloom spreads the lantern glass into a halo; a vignette and a cool lift hold the eye in the lit centre.
    post: {
      bloom: {strength: 0.8, threshold: 0.85, radius: 0.55},
      vignette: {amount: 0.35},
      grade: {lift: [0, 0.004, 0.02], gain: [1.04, 1, 0.96], saturation: 1.05},
    },
  },
  lights: sceneLights({point: 8}),
  shadows: sceneShadows(),
  scatter: sceneScatter(),
  particles: sceneParticles({emitters: 12, max: 512}),
  entities: [
    [Name({name: 'ground'}), Transform(), courtyardGround(), Shadow({cast: false})],
    [Name({name: 'stonework'}), Transform(), courtyardStone()],
    // Moss in a band along the foot of the walls: one blob copied 160 times, one draw. It casts no shadow (copies never
    // do) and a lighter quality preset draws fewer of them.
    [
      Name({name: 'moss'}),
      Transform(),
      defineScatter({
        mesh: blobMesh(0.32, 0.5),
        area: {kind: 'edge', rect: [-HALF + 0.1, -HALF + 0.1, HALF - 0.1, HALF - 0.1], width: 0.7},
        count: 160,
        seed: 5,
        y: 0.04,
        scale: [0.5, 1.4],
        ry: 'random',
        color: P.leafDark,
        colorJitter: [0.02, 0.06, 0.08],
      }),
      defineMaterial({shading: 'flat'}),
    ],
    // The water: see-through, slightly glowing, so it reads as water at night.
    [
      Transform({y: 0.46}),
      Shape({kind: 'cylinder', size: [2 * FOUNTAIN_R - 0.3, 0.04, 2 * FOUNTAIN_R - 0.3], color: P.water}),
      Shadow({cast: false, receive: false}),
      defineMaterial({
        emissive: 0x1d6f8f,
        emissiveIntensity: 1.2,
        roughness: 0.15,
        metalness: 0.3,
        opacity: 0.8,
        transparent: true,
      }),
    ],
    [
      Name({name: 'spray'}),
      Transform({y: 1.65}),
      defineEmitter({
        mode: 'continuous',
        rate: 70,
        max: 120,
        lifetime: [0.7, 1],
        speed: [1.6, 2.2],
        spread: 0.45,
        direction: [0, 1, 0],
        gravity: [0, -8, 0],
        size: [0.14, 0.08],
        color: [0xd8f0ff, 0x7fc2ff],
        opacity: [0.8, 0],
      }),
    ],
    ...[...POSTS, ...STREET_LAMPS].map(([x, z]) => glass(x, LANTERN_Y, z, 0.34, 30)),
    ...SCONCES.map(([x, y, z]) => glass(x, y, z, 0.26, 14)),
    // The gate: a plank door in the arch, a door to the garden.
    [
      Transform({y: 1.1, z: -HALF + 0.08}),
      Shape({kind: 'box', size: [2.6, 2.2, 0.1], color: 0xb08260}),
      defineMaterial({texture: 'planks', repeat: [2, 1], roughness: 0.9}),
      Interactable({id: 'gate', label: 'game.use.gate', reach: 1.6, to: 'garden', toX: 0, toZ: 4.6}),
    ],
    [
      Transform({x: -8.9, y: 0.35, z: 2.4}),
      Shape({kind: 'box', size: [0.7, 0.7, 0.7], color: 0xffffff}),
      defineMaterial({texture: 'crate'}),
    ],
    [
      Transform({x: 8.9, y: 0.3, z: -7.6, ry: 0.4}),
      Shape({kind: 'box', size: [0.6, 0.6, 0.6], color: 0xffffff}),
      defineMaterial({texture: 'crate'}),
    ],
    // Collision: the walls, the fountain, posts, planters and benches.
    [Walls({minX: -HALF + 0.6, maxX: HALF - 0.6, minZ: -HALF + 0.6, maxZ: HALF - 0.6})],
    [Transform(), Solid({r: FOUNTAIN_R + 0.1})],
    ...POSTS.map(([x, z]) => [Transform({x, z}), Solid({r: 0.25})]),
    ...PLANTERS.map(([x, z]) => [Transform({x, z}), Solid({halfX: 0.75, halfZ: 0.75})]),
    ...BENCHES.map(({at, ry}) => [
      Transform({x: at[0], z: at[2]}),
      Solid(ry ? {halfX: 0.25, halfZ: 0.9} : {halfX: 0.9, halfZ: 0.25}),
    ]),
    ...EMBERS.map(ember),
    [...motes(0xd9ff8a)],
    ...player(0, 6.5, null),
  ],
  systems: [...systems, takeEmbers, bobEmbers, emberHud, wanderMotes(0, 0, 7, 6)],
});
