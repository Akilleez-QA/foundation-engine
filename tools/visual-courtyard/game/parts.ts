// The courtyard fixture's shared pieces (a helper file: no default export), ported from the visual-capability trial
// (docs: tools/visual-courtyard/README.md). Everything here is the public author API only.
import {
  defineComponent,
  defineEmitter,
  defineEntity,
  defineEnvironment,
  defineMaterial,
  defineSystem,
  Name,
  Shape,
  Transform,
  type ComponentInit,
} from '@engine';
import {cameraSystem} from '@kits/camera';
import {Character, characterSystem, Solid, Walls} from '@kits/character';
import {hud} from '@kits/ui';

/** One entity's components. */
export type Row = readonly ComponentInit<object>[];

// Deterministic star field (directions on the upper hemisphere).
const stars = Array.from({length: 160}, (_, i) => {
  const a = (i * 2.399963) % (Math.PI * 2),
    h = 0.15 + ((i * 0.618034) % 1) * 0.85;
  return {direction: [Math.cos(a), h, Math.sin(a)] as [number, number, number], color: i % 7 ? 0xcfd8ff : 0xfff1c8};
});

export const night = defineEnvironment({
  background: 0x070b1a,
  ambient: {sky: 0x2b3a6b, ground: 0x1a1008, intensity: 0.55},
  directional: {color: 0x8ea8ff, intensity: 0.45, position: [-6, 12, -4]},
  haze: {color: 0x0a1024, near: 9, far: 32},
  points: stars,
  pointSize: 2,
});

export const WARM = 0xffb04a;
export const SIZE = 11; // half-width of the courtyard

export const LANTERNS: readonly [number, number][] = [
  [-9, -9],
  [9, -9],
  [-9, 9],
  [9, 9],
  [-3.5, -3.5],
  [3.5, 3.5],
  [3.5, -3.5],
  [-3.5, 3.5],
];

const wall = (x: number, z: number, w: number, d: number): Row => [
  Transform({x, y: 1.6, z}),
  Shape({kind: 'box', size: [w, 3.2, d], color: 0xb9a596}),
  defineMaterial({texture: 'brick', repeat: [Math.max(w, d) / 2, 1.6], roughness: 0.95}),
  Solid({halfX: w / 2, halfZ: d / 2}),
];

const tree = (x: number, z: number, s = 1): Row[] => [
  [
    Transform({x, y: 0.7 * s, z}),
    Shape({kind: 'cylinder', size: [0.35 * s, 1.4 * s, 0.35 * s], color: 0x3b2618}),
    Solid({r: 0.4 * s}),
  ],
  [Transform({x, y: 2.2 * s, z}), Shape({kind: 'cone', size: [2.2 * s, 2.6 * s, 2.2 * s], color: 0x1f3d2a})],
  [Transform({x, y: 3.3 * s, z}), Shape({kind: 'cone', size: [1.6 * s, 2 * s, 1.6 * s], color: 0x24482f})],
];

const bench = (x: number, z: number, ry: number): Row[] => [
  [
    Transform({x, y: 0.42, z, ry}),
    Shape({kind: 'box', size: [1.8, 0.1, 0.5], color: 0x6b4a2e}),
    defineMaterial({roughness: 0.8}),
    Solid({halfX: ry ? 0.25 : 0.9, halfZ: ry ? 0.9 : 0.25}),
  ],
  [Transform({x, y: 0.2, z, ry}), Shape({kind: 'box', size: [1.5, 0.4, 0.3], color: 0x2a2d33})],
];

const fountain = (): Row[] => [
  [
    Transform({y: 0.3}),
    Shape({kind: 'cylinder', size: [4.2, 0.6, 4.2], color: 0x8d8a86}),
    defineMaterial({roughness: 0.9}),
    Solid({r: 2.2}),
  ],
  [
    Transform({y: 0.58}),
    Shape({kind: 'cylinder', size: [3.7, 0.06, 3.7], color: 0x1b4f7a}),
    defineMaterial({
      emissive: 0x0f3a66,
      emissiveIntensity: 0.6,
      roughness: 0.05,
      metalness: 0.2,
      opacity: 0.85,
      transparent: true,
    }),
  ],
  [
    Transform({y: 1.1}),
    Shape({kind: 'cylinder', size: [0.4, 1.2, 0.4], color: 0x8d8a86}),
    defineMaterial({roughness: 0.9}),
  ],
  [
    Transform({y: 1.75}),
    Shape({kind: 'cylinder', size: [1.4, 0.2, 1.4], color: 0x8d8a86}),
    defineMaterial({roughness: 0.9}),
  ],
  [
    Transform({y: 1.9}),
    defineEmitter({
      mode: 'continuous',
      rate: 90,
      max: 160,
      lifetime: [0.8, 1.1],
      speed: [2.2, 2.8],
      spread: 0.35,
      gravity: [0, -9, 0],
      size: [0.07, 0.05],
      color: [0xcfe9ff, 0x6fb3ff],
      opacity: [0.8, 0],
      blending: 'additive',
    }),
  ],
];

/** Something to collect: how close the player's centre must come, in metres. */
export const Ember = defineComponent('ember', {radius: 0.7, baseY: 0.9, phase: 0});
const EMBERS: readonly [number, number][] = [
  [-7, -7],
  [7, -6],
  [-6, 6.5],
  [6.5, 7],
  [0, -8.5],
  [-8.8, 0],
  [8.8, 1],
];
export const TOTAL = EMBERS.length;

const ember = (x: number, z: number, i: number): Row => [
  Transform({x, y: 0.9, z}),
  Shape({kind: 'sphere', size: [0.32, 0.32, 0.32], color: 0xfff0c0}),
  defineMaterial({emissive: 0xff7a1a, emissiveIntensity: 5}),
  Ember({phase: i * 0.9}),
  defineEmitter({
    mode: 'continuous',
    rate: 8,
    max: 16,
    lifetime: [0.5, 0.9],
    speed: [0, 0.05],
    spread: Math.PI,
    size: [0.9, 1.1],
    color: [0xff8a2a],
    opacity: [0, 0.3, 0],
    essential: true,
  }),
];

export const pickupBurst = defineEntity({
  id: 'ember-burst',
  components: [
    defineEmitter({
      mode: 'burst',
      count: 40,
      bursts: 1,
      max: 40,
      lifetime: [0.4, 0.8],
      speed: [1.5, 3],
      spread: Math.PI / 2,
      direction: [0, 1, 0],
      gravity: [0, -4, 0],
      size: [0.16, 0.02],
      color: [0xffffff, 0xffb04a, 0xff5a00],
      opacity: [1, 0],
      despawn: true,
    }),
  ],
});

const bobEmbers = defineSystem({
  id: 'bob-embers',
  run(ctx) {
    ctx.state.t = (ctx.state.t as number) + 1 / 60;
    for (const [, tr, em] of ctx.world.query(Transform, Ember)) {
      tr.y = em.baseY + Math.sin((ctx.state.t as number) * 2 + em.phase) * 0.15;
      tr.ry += 0.03;
    }
  },
});

const collectEmbers = defineSystem({
  id: 'collect-embers',
  run(ctx) {
    const p = ctx.named('player');
    if (p === undefined) return;
    const me = ctx.world.get(p, Transform)!;
    for (const [e, tr, em] of ctx.world.query(Transform, Ember)) {
      if (Math.hypot(tr.x - me.x, tr.z - me.z) > em.radius) continue;
      ctx.spawn(pickupBurst, Transform({x: tr.x, y: tr.y, z: tr.z}));
      ctx.world.despawn(e);
      ctx.state.collected = (ctx.state.collected as number) + 1;
    }
  },
});

/** The character: the kit moves a capsule; a head and a little hat follow it (no parenting in the author API). */
export const Follow = defineComponent('follow', {dy: 0});
const followPlayer = defineSystem({
  id: 'follow-player',
  phase: 'frame',
  run(ctx) {
    const p = ctx.named('player');
    if (p === undefined) return;
    const me = ctx.world.get(p, Transform)!;
    for (const [, tr, f] of ctx.world.query(Transform, Follow)) {
      if (tr.x === me.x && tr.z === me.z && tr.y === me.y + f.dy) continue;
      tr.x = me.x;
      tr.z = me.z;
      tr.y = me.y + f.dy;
      tr.ry = me.ry;
      ctx.world.touch();
    }
  },
});

const collectHud = defineSystem({
  id: 'collect-hud',
  phase: 'frame',
  run(ctx) {
    const n = ctx.state.collected as number;
    hud(ctx).line('embers', ctx.text('game.hud.embers', {n, total: TOTAL}));
    hud(ctx).banner(n === TOTAL ? ctx.text('game.embers-all') : null);
  },
});

/** Everything but the lanterns: floor, walls, fountain, trees, benches, embers, fireflies and the character. */
export const courtyardRows = (): Row[] => [
  [
    Name({name: 'floor'}),
    Transform(),
    Shape({kind: 'plane', size: [2 * SIZE, 0, 2 * SIZE], color: 0x9a948c}),
    defineMaterial({texture: 'cobbles', repeat: [7, 7], roughness: 0.85}),
  ],
  [Walls({minX: -SIZE + 0.6, maxX: SIZE - 0.6, minZ: -SIZE + 0.6, maxZ: SIZE - 0.6})],
  wall(0, -SIZE, 2 * SIZE, 0.6),
  wall(0, SIZE, 2 * SIZE, 0.6),
  wall(-SIZE, 0, 0.6, 2 * SIZE),
  wall(SIZE, 0, 0.6, 2 * SIZE),
  ...fountain(),
  ...tree(-7.5, -4, 1),
  ...tree(7.5, 4.5, 1.1),
  ...tree(-5, 8.5, 0.9),
  ...tree(6, -8, 1),
  ...bench(0, -6, 0),
  ...bench(0, 6, 0),
  ...bench(-6, 0, Math.PI / 2),
  ...bench(6, 0, Math.PI / 2),
  ...EMBERS.map(([x, z], i) => ember(x, z, i)),
  // Fireflies drifting over the whole courtyard.
  [
    Transform({y: 1.5}),
    defineEmitter({
      mode: 'continuous',
      rate: 14,
      max: 64,
      lifetime: [3, 5],
      speed: [0.1, 0.4],
      spread: Math.PI,
      gravity: [0, 0.05, 0],
      size: [0.12, 0.16, 0.12],
      color: [0xd9ff7a, 0xa8ff5a],
      opacity: [0, 1, 0],
    }),
  ],
  [
    Name({name: 'player'}),
    Transform({x: 0, y: 0.7, z: 4}),
    Shape({kind: 'capsule', size: [0.6, 1.2, 0.6], color: 0x2f6fb3}),
    defineMaterial({roughness: 0.6}),
    Character({speed: 3.8}),
  ],
  [
    Transform({x: 0, y: 1.6, z: 4}),
    Shape({kind: 'sphere', size: [0.42, 0.42, 0.42], color: 0xf1c7a0}),
    Follow({dy: 0.9}),
  ],
  [
    Transform({x: 0, y: 1.95, z: 4}),
    Shape({kind: 'cone', size: [0.55, 0.45, 0.55], color: 0xa83a2a}),
    Follow({dy: 1.25}),
  ],
];

export const courtyardSystems = [
  characterSystem(),
  bobEmbers,
  collectEmbers,
  followPlayer,
  cameraSystem('orbit', {distance: 10, pitch: 0.62, yaw: 0, smooth: 0.15}),
  collectHud,
];

export const courtyardView = {
  camera: {
    position: [0, 9, 12] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fov: 50,
    minWidthFov: 60,
  },
  background: night.background,
  environment: night,
};
