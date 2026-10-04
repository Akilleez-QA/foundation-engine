// The garden in daylight: hedges, a shed, a bench and a lamp, all low-poly forms baked into two meshes. Use the
// sundial to see the same garden under each light preset; the gap in the fence leads back to the courtyard.
import {defineMaterial, defineScene, defineSystem, Name, sceneParticles, Shape, Transform} from '@engine';
import {Solid, Walls} from '@kits/character';
import {Interactable} from '@kits/explore';
import {hud} from '@kits/ui';
import {gardenGround, gardenScenery, SUNDIAL} from './garden-scenery';
import {goldenHour, LOOKS, palette as P} from './look';
import {motes, player, systems, wanderMotes} from './world';

/** The string key naming each preset in LOOKS, in the same order. */
export const LOOK_NAMES = ['game.look.golden-hour', 'game.look.overcast', 'game.look.moonlight', 'game.look.studio'];

/** Using the sundial moves the garden on to the next light preset. */
export const turnSundial = defineSystem({
  id: 'turn-sundial',
  run(ctx) {
    if (!ctx.world.read<{id: string}>('interact').some(e => e.id === 'sundial')) return;
    ctx.state.look = ((ctx.state.look as number) + 1) % LOOKS.length;
    ctx.view.environment = LOOKS[ctx.state.look as number]!;
  },
});

export const lookHud = defineSystem({
  id: 'look-hud',
  phase: 'frame',
  run(ctx) {
    hud(ctx).line('look', ctx.text('game.hud.look', {name: ctx.text(LOOK_NAMES[ctx.state.look as number]!)}));
  },
});

/** A hedge's collision; it is drawn by the scenery mesh. */
const hedge = (x: number, z: number, w: number, d: number) => [
  Transform({x, y: 0.5, z}),
  Solid({halfX: w / 2, halfZ: d / 2}),
];

export default defineScene({
  id: 'garden',
  title: 'Garden',
  type: 'area',
  view: {
    camera: {position: [0, 11.5, 16.4], target: [0, 0.7, 4.6], fov: 50, minWidthFov: 55},
    background: goldenHour.background,
    environment: goldenHour,
  },
  particles: sceneParticles({emitters: 1, max: 48}),
  entities: [
    [Name({name: 'ground'}), Transform(), gardenGround()],
    [Name({name: 'scenery'}), Transform(), gardenScenery()],
    [Walls({minX: -6.5, maxX: 6.5, minZ: -6.5, maxZ: 6.5})],
    hedge(0, -7, 14, 1),
    hedge(-7, 0, 1, 14),
    hedge(7, 0, 1, 14),
    [Transform({x: 4, z: -4.5}), Solid({halfX: 1.5, halfZ: 1.2})],
    [
      Transform({x: 4, y: 0.9, z: -3.25}),
      Shape({kind: 'box', size: [0.9, 1.8, 0.1], color: 0x9c6b4a}),
      defineMaterial({texture: 'planks', repeat: [0.9, 1], roughness: 0.9}),
    ],
    [Transform({x: -3, z: -2}), Solid({halfX: 0.9, halfZ: 0.3})],
    [Transform({x: -4, z: 3}), Solid({r: 0.2})],
    [
      Transform({x: -4, y: 2.3, z: 3}),
      Shape({kind: 'sphere', size: [0.42, 0.42, 0.42], color: 0xfff1cc}),
      defineMaterial({emissive: P.lantern, emissiveIntensity: 0.8}),
    ],
    [
      Transform({x: SUNDIAL[0], z: SUNDIAL[1]}),
      Solid({r: 0.4}),
      Interactable({id: 'sundial', label: 'game.use.sundial', reach: 1.3}),
    ],
    [
      Transform({z: 6.6}),
      Interactable({id: 'back', label: 'game.use.back', reach: 1.2, to: 'courtyard', toX: 0, toZ: -8.4}),
    ],
    ...player(0, 4.6, 0x1e3312),
    [...motes(0xfff1c4)],
  ],
  systems: [...systems, turnSundial, lookHud, wanderMotes(0, 0, 5, 4.5)],
  enter(ctx) {
    ctx.state.look = 0;
  },
});
