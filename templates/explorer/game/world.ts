// Shared parts of both scenes (a helper file: no default export). The three things to find are listed once here.
import {defineEmitter, defineMaterial, defineSystem, Name, Shape, Transform, type SceneContext} from '@engine';
import {cameraSystem} from '@kits/camera';
import {Character, characterSystem} from '@kits/character';
import {exploreSystem, usedCount} from '@kits/explore';
import {hud} from '@kits/ui';

export const THINGS = ['garden/bench', 'garden/lamp', 'shed/crate'] as const;

/** The player, standing at (x, z). The capsule's centre is at half its height. */
export const playerAt = (x: number, z: number) => [
  Name({name: 'player'}),
  Transform({x, y: 0.7, z}),
  Shape({kind: 'capsule', size: [0.6, 1.4, 0.6], color: 0xf2c14e}),
  Character({speed: 3.5}),
];

/** A soft round shadow under the player: a flat see-through disc that follows it (followShadow). */
export const playerShadow = (color: number) => [
  Name({name: 'player-shadow'}),
  Transform({y: 0.015}),
  Shape({kind: 'cylinder', size: [0.85, 0.01, 0.85], color}),
  defineMaterial({opacity: 0.35, transparent: true}),
];

/** Keeps the shadow under the player; touches the world only when the player has moved. */
export const followShadow = defineSystem({
  id: 'follow-shadow',
  phase: 'frame',
  run(ctx) {
    const p = ctx.named('player'),
      s = ctx.named('player-shadow');
    const from = p === undefined ? undefined : ctx.world.get(p, Transform),
      to = s === undefined ? undefined : ctx.world.get(s, Transform);
    if (!from || !to || (to.x === from.x && to.z === from.z)) return;
    to.x = from.x;
    to.z = from.z;
    ctx.world.touch();
  },
});

/** Motes drifting in the light: one emitter (one draw) whose source wanders slowly, so they spread out. */
export const motes = (color: number) => [
  Name({name: 'motes'}),
  Transform({y: 1}),
  defineEmitter({
    mode: 'continuous',
    rate: 5,
    max: 40,
    lifetime: [5, 8],
    speed: [0.05, 0.2],
    spread: Math.PI,
    gravity: [0.02, 0.025, 0],
    size: [0.08, 0.12, 0.08],
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
      tr.y = 0.9 + Math.sin(t * 0.37) * 0.4;
      ctx.world.touch();
    },
  });

/** Found-count line and the found-everything banner. */
export const progressHud = defineSystem({
  id: 'progress-hud',
  phase: 'frame',
  run(ctx) {
    const n = usedCount(ctx, THINGS);
    hud(ctx).line('found', ctx.text('game.hud.found', {n, total: THINGS.length}));
    hud(ctx).banner(n === THINGS.length ? ctx.text('game.found-all') : null);
  },
});

const prompt = (ctx: SceneContext, label: string) => ctx.text('game.prompt', {thing: ctx.text(label)});

/** Every scene's systems, in order: move, interact, then the camera and HUD each frame. */
export const systems = [
  characterSystem(),
  exploreSystem({prompt}),
  cameraSystem('orbit', {distance: 14, pitch: 0.78, yaw: 0, smooth: 0.15}),
  followShadow,
  progressHud,
];
