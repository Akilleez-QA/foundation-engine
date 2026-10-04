// The garden: walls of hedge, a bench, a lamp you can switch, and the shed with its door. The shed, bench, lamp post,
// fence and the trees beyond are low-poly forms baked into two meshes (garden-scenery.ts); the hedges are one scatter
// of one blob. Collision is the Solid entities below. The lamp is a real light when it is on.
import {
  defineMaterial,
  defineScatter,
  defineScene,
  defineSystem,
  Name,
  PointLight,
  sceneLights,
  sceneParticles,
  sceneScatter,
  Shape,
  Transform,
} from '@engine';
import {Solid, Walls} from '@kits/character';
import {Interactable} from '@kits/explore';
import {gardenGround, gardenScenery, HEDGE} from './garden-scenery';
import {blobMesh} from './forms';
import {goldenHour, palette as P} from './look';
import {motes, playerAt, playerShadow, systems, wanderMotes} from './world';

const LAMP_ON = 0xffe9a8,
  LAMP_OFF = 0x8d9aa6;

/** The lamp reacts to being used (the world event 'interact' from the explore kit): its glass lights up, and so
 *  does the light it gives. */
export const lampSwitch = defineSystem({
  id: 'lamp-switch',
  run(ctx) {
    if (!ctx.world.read<{id: string}>('interact').some(e => e.id === 'lamp')) return;
    for (const [e, it, sh] of ctx.world.query(Interactable, Shape))
      if (it.id === 'lamp') {
        sh.color = sh.color === LAMP_ON ? LAMP_OFF : LAMP_ON;
        const light = ctx.world.get(e, PointLight);
        if (light) light.visible = sh.color === LAMP_ON;
      }
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
    camera: {position: [0, 10.5, 12.9], target: [0, 0.7, 2], fov: 50, minWidthFov: 55},
    background: goldenHour.background,
    environment: goldenHour,
    output: {toneMapping: 'aces', exposure: 1.1},
  },
  lights: sceneLights({point: 1}),
  scatter: sceneScatter(),
  particles: sceneParticles({emitters: 1, max: 40}),
  entities: [
    [Name({name: 'ground'}), Transform(), gardenGround()],
    [Name({name: 'scenery'}), Transform(), gardenScenery()],
    // The hedges: one leafy blob, copied along each hedge in one draw, each turned and tinted a little differently.
    // Essential, so a lighter quality preset never thins a hedge into gaps.
    [
      Name({name: 'hedges'}),
      Transform(),
      defineScatter({
        mesh: blobMesh(0.68, 0.95),
        points: HEDGE,
        y: 0.45,
        scale: [0.85, 1.15],
        ry: 'random',
        color: P.leaf,
        colorJitter: [0.01, 0.04, 0.05],
        essential: true,
      }),
      defineMaterial({shading: 'flat', roughness: 1}),
    ],
    [Walls({minX: -6.5, maxX: 6.5, minZ: -6.5, maxZ: 6.5})],
    hedge(0, -7, 14, 1),
    hedge(-7, 0, 1, 14),
    hedge(7, 0, 1, 14),
    // The shed, its door (a door: `to` another scene, arriving at toX/toZ there).
    [Transform({x: 4, y: 1.2, z: -4.5}), Solid({halfX: 1.5, halfZ: 1.2})],
    [
      Transform({x: 4, y: 0.9, z: -3.25}),
      Shape({kind: 'box', size: [0.9, 1.8, 0.1], color: 0x9c6b4a}),
      defineMaterial({texture: 'planks', repeat: [0.9, 1], roughness: 0.9}),
      Interactable({id: 'to-shed', label: 'game.use.to-shed', reach: 1.3, to: 'shed', toX: 0, toZ: 2.2}),
    ],
    [
      Transform({x: -3, y: 0.3, z: -2}),
      Solid({halfX: 0.9, halfZ: 0.3}),
      Interactable({id: 'bench', label: 'game.use.bench'}),
    ],
    [Transform({x: -4, y: 1.1, z: 3}), Solid({r: 0.2})],
    [
      Transform({x: -4, y: 2.3, z: 3}),
      Shape({kind: 'box', size: [0.34, 0.42, 0.34], color: LAMP_OFF}),
      defineMaterial({emissive: P.lantern, emissiveIntensity: 0.6}),
      PointLight({color: P.lantern, intensity: 6, distance: 7, visible: false}),
      Interactable({id: 'lamp', label: 'game.use.lamp'}),
    ],
    playerAt(0, 2),
    playerShadow(0x1e3312),
    motes(0xfff1c4),
  ],
  systems: [...systems, lampSwitch, wanderMotes(0, 0, 5, 4.5)],
});
