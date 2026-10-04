// The shed: a small room with a crate and the door back out. The room is one baked mesh (shed-scenery.ts); a hanging
// lamp lights it, and the window glows.
import {defineMaterial, defineScene, sceneLights, sceneParticles, Shape, SpotLight, Transform} from '@engine';
import {Solid, Walls} from '@kits/character';
import {Interactable} from '@kits/explore';
import {indoors, palette as P} from './look';
import {shedRoom} from './shed-scenery';
import {motes, playerAt, playerShadow, systems, wanderMotes} from './world';

export default defineScene({
  id: 'shed',
  title: 'Shed',
  type: 'area',
  view: {
    camera: {position: [0, 10.5, 12.9], target: [0, 0.7, 2], fov: 50, minWidthFov: 50},
    background: indoors.background,
    environment: indoors,
    output: {toneMapping: 'aces', exposure: 1.2},
  },
  lights: sceneLights({point: 0, spot: 1}),
  particles: sceneParticles({emitters: 1, max: 40}),
  entities: [
    [
      Transform(),
      Shape({kind: 'plane', size: [7.8, 0, 6.8], color: 0xe2c9ad}),
      defineMaterial({texture: 'planks', repeat: [3, 2], roughness: 0.9}),
    ],
    [Transform(), shedRoom()],
    // The window glass glows: daylight outside.
    [
      Transform({x: 1.6, y: 1.55, z: -3.3}),
      Shape({kind: 'box', size: [1.1, 0.86, 0.04], color: 0xffe2a6}),
      defineMaterial({emissive: 0xffd08a, emissiveIntensity: 2}),
    ],
    // The hanging lamp: a warm cone of light from under its shade, aimed at the floor.
    [
      Transform({y: 1.8, z: -0.6}),
      SpotLight({
        color: P.lantern,
        intensity: 14,
        distance: 9,
        angle: 1.1,
        penumbra: 0.6,
        target: [0, 0, -0.2],
        essential: true,
      }),
    ],
    [Walls({minX: -3.5, maxX: 3.5, minZ: -3, maxZ: 3})],
    [
      Transform({x: -2.2, y: 0.4, z: -1.8}),
      Shape({kind: 'box', size: [0.8, 0.8, 0.8], color: 0xffffff}),
      defineMaterial({texture: 'crate', roughness: 0.85}),
      Solid({halfX: 0.4, halfZ: 0.4}),
      Interactable({id: 'crate', label: 'game.use.crate'}),
    ],
    [
      Transform({y: 0.05, z: 2.9}),
      Shape({kind: 'box', size: [1, 0.1, 0.3], color: P.cream}),
      Interactable({id: 'to-garden', label: 'game.use.to-garden', reach: 1.2, to: 'garden', toX: 4, toZ: -2.3}),
    ],
    playerAt(0, 2),
    playerShadow(0x120c08),
    motes(0xffe9c0),
  ],
  systems: [...systems, wanderMotes(1.6, -2.2, 1.2, 0.8)],
});
