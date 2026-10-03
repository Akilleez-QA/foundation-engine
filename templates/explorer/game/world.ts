// Shared parts of both scenes (a helper file: no default export). The three things to find are listed once here.
import {defineSystem, Name, Shape, Transform, type SceneContext} from '@engine';
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
  cameraSystem('orbit', {distance: 11, pitch: 0.95, yaw: 0, smooth: 0.15}),
  progressHud,
];
