// The garden: walls of hedge, a bench, a lamp you can switch, and the shed with its door.
import {defineScene, defineSystem, Shape, Transform} from '@engine';
import {Solid, Walls} from '@kits/character';
import {Interactable} from '@kits/explore';
import {playerAt, systems} from './world';

const LAMP_ON = 0xffe9a8,
  LAMP_OFF = 0x5b6270;

/** The lamp reacts to being used: the world event 'interact' from the explore kit. */
export const lampSwitch = defineSystem({
  id: 'lamp-switch',
  run(ctx) {
    if (!ctx.world.read<{id: string}>('interact').some(e => e.id === 'lamp')) return;
    for (const [, it, sh] of ctx.world.query(Interactable, Shape))
      if (it.id === 'lamp') sh.color = sh.color === LAMP_ON ? LAMP_OFF : LAMP_ON;
  },
});

const hedge = (x: number, z: number, w: number, d: number) => [
  Transform({x, y: 0.5, z}),
  Shape({kind: 'box', size: [w, 1, d], color: 0x2f6b3a}),
  Solid({halfX: w / 2, halfZ: d / 2}),
];

export default defineScene({
  id: 'garden',
  title: 'Garden',
  type: 'area',
  view: {camera: {position: [0, 9, 7], target: [0, 0, 0], fov: 50, minWidthFov: 55}, background: 0x9cc7e4},
  entities: [
    [Transform(), Shape({kind: 'plane', size: [40, 0, 40], color: 0x6fa05a})],
    [Walls({minX: -6.5, maxX: 6.5, minZ: -6.5, maxZ: 6.5})],
    hedge(0, -7, 14, 1),
    hedge(-7, 0, 1, 14),
    hedge(7, 0, 1, 14),
    // The shed, its door (a door: `to` another scene, arriving at toX/toZ there).
    [
      Transform({x: 4, y: 1.2, z: -4.5}),
      Shape({kind: 'box', size: [3, 2.4, 2.4], color: 0x9b6a43}),
      Solid({halfX: 1.5, halfZ: 1.2}),
    ],
    [
      Transform({x: 4, y: 0.9, z: -3.25}),
      Shape({kind: 'box', size: [0.9, 1.8, 0.1], color: 0x4a2f1c}),
      Interactable({id: 'to-shed', label: 'game.use.to-shed', reach: 1.3, to: 'shed', toX: 0, toZ: 2.2}),
    ],
    [
      Transform({x: -3, y: 0.3, z: -2}),
      Shape({kind: 'box', size: [1.8, 0.5, 0.6], color: 0xb08a5a}),
      Solid({halfX: 0.9, halfZ: 0.3}),
      Interactable({id: 'bench', label: 'game.use.bench'}),
    ],
    [
      Transform({x: -4, y: 1.1, z: 3}),
      Shape({kind: 'cylinder', size: [0.2, 2.2, 0.2], color: 0x3a3f4a}),
      Solid({r: 0.2}),
    ],
    [
      Transform({x: -4, y: 2.3, z: 3}),
      Shape({kind: 'sphere', size: [0.5, 0.5, 0.5], color: LAMP_OFF}),
      Interactable({id: 'lamp', label: 'game.use.lamp'}),
    ],
    playerAt(0, 2),
  ],
  systems: [...systems, lampSwitch],
});
