// The shed: a small room with a crate and the door back out.
import {defineScene, Shape, Transform} from '@engine';
import {Solid, Walls} from '@kits/character';
import {Interactable} from '@kits/explore';
import {playerAt, systems} from './world';

export default defineScene({
  id: 'shed',
  title: 'Shed',
  type: 'area',
  view: {camera: {position: [0, 8, 6], target: [0, 0, 0], fov: 50, minWidthFov: 50}, background: 0x2b1f18},
  entities: [
    [Transform(), Shape({kind: 'plane', size: [7, 0, 6], color: 0x7a5a3e})],
    [Walls({minX: -3.5, maxX: 3.5, minZ: -3, maxZ: 3})],
    [Transform({y: 1, z: -3.2}), Shape({kind: 'box', size: [7, 2, 0.3], color: 0x5c4030})],
    [
      Transform({x: -2.2, y: 0.4, z: -1.8}),
      Shape({kind: 'box', size: [0.8, 0.8, 0.8], color: 0xc9a46a}),
      Solid({halfX: 0.4, halfZ: 0.4}),
      Interactable({id: 'crate', label: 'game.use.crate'}),
    ],
    [
      Transform({y: 0.05, z: 2.9}),
      Shape({kind: 'box', size: [1, 0.1, 0.3], color: 0x4a2f1c}),
      Interactable({id: 'to-garden', label: 'game.use.to-garden', reach: 1.2, to: 'garden', toX: 4, toZ: -2.3}),
    ],
    playerAt(0, 2),
  ],
  systems,
});
