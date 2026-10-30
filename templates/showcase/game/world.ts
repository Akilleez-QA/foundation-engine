// Shared parts of both scenes (a helper file: no default export): the player and the parts that follow it, drifting
// motes, and every scene's systems.
import {
  defineComponent,
  defineEmitter,
  defineMaterial,
  defineSystem,
  Name,
  Shape,
  Transform,
  type SceneContext,
} from '@engine';
import {cameraSystem} from '@kits/camera';
import {Character, characterSystem} from '@kits/character';
import {exploreSystem} from '@kits/explore';
import {palette as P} from './look';

/** A part drawn with the player: it keeps the player's x and z, `dy` metres above the player's centre. */
export const Follow = defineComponent('follow', {dy: 0});

/** The player at (x, z): a cloaked body, a head and a pointed hat, and a soft shadow disc of colour `shadow` for a
 *  scene that casts no shadows (null in a scene with `sceneShadows()`). */
export const player = (x: number, z: number, shadow: number | null) => [
  [
    Name({name: 'player'}),
    Transform({x, y: 0.7, z}),
    Shape({kind: 'capsule', size: [0.6, 1.4, 0.6], color: P.ink}),
    Character({speed: 3.8}),
  ],
  [Transform({x, y: 1.55, z}), Shape({kind: 'sphere', size: [0.42, 0.42, 0.42], color: 0xf1c7a0}), Follow({dy: 0.85})],
  [Transform({x, y: 1.9, z}), Shape({kind: 'cone', size: [0.6, 0.5, 0.6], color: P.roof}), Follow({dy: 1.2})],
  ...(shadow === null
    ? []
    : [
        [
          Transform({x, y: 0.015, z}),
          Shape({kind: 'cylinder', size: [0.85, 0.01, 0.85], color: shadow}),
          defineMaterial({opacity: 0.4, transparent: true}),
          Follow({dy: -0.685}),
        ],
      ]),
];

/** Keeps every Follow part with the player; touches the world only when the player has moved. */
export const followPlayer = defineSystem({
  id: 'follow-player',
  phase: 'frame',
  run(ctx) {
    const p = ctx.named('player'),
      me = p === undefined ? undefined : ctx.world.get(p, Transform);
    if (!me) return;
    let moved = false;
    for (const [, tr, f] of ctx.world.query(Transform, Follow)) {
      if (tr.x === me.x && tr.z === me.z && tr.y === me.y + f.dy) continue;
      tr.x = me.x;
      tr.z = me.z;
      tr.y = me.y + f.dy;
      moved = true;
    }
    if (moved) ctx.world.touch();
  },
});

/** Motes drifting in the light: one emitter (one draw) whose source wanders slowly, so they spread out. */
export const motes = (color: number) => [
  Name({name: 'motes'}),
  Transform({y: 1}),
  defineEmitter({
    mode: 'continuous',
    rate: 6,
    max: 48,
    lifetime: [5, 8],
    speed: [0.05, 0.2],
    spread: Math.PI,
    gravity: [0.02, 0.025, 0],
    size: [0.1, 0.16, 0.1],
    color: [color],
    opacity: [0, 0.9, 0],
  }),
];

/** Moves the motes' source on a slow loop around (x, z), `rx` by `rz` metres. Decoration: it stays put under Calm. */
export const wanderMotes = (x: number, z: number, rx: number, rz: number) =>
  defineSystem({
    id: 'wander-motes',
    phase: 'frame',
    run(ctx) {
      const e = ctx.named('motes'),
        tr = e === undefined ? undefined : ctx.world.get(e, Transform);
      if (!tr || ctx.time.calm) return;
      const t = ctx.time.t;
      tr.x = x + Math.sin(t * 0.21) * rx + Math.sin(t * 0.53) * 0.4;
      tr.z = z + Math.cos(t * 0.17) * rz;
      tr.y = 0.9 + Math.sin(t * 0.37) * 0.5;
      ctx.world.touch();
    },
  });

const prompt = (ctx: SceneContext, label: string) => ctx.text('game.prompt', {thing: ctx.text(label)});

/** Every scene's systems, in order: move, interact, then the camera and the player's parts each frame. */
export const systems = [
  characterSystem(),
  exploreSystem({prompt}),
  cameraSystem('orbit', {distance: 16, pitch: 0.74, yaw: 0, smooth: 0.15}),
  followPlayer,
];
