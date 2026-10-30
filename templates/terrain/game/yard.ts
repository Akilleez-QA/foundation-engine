import {defineScene, defineSystem, type SceneContext, Name, Shape, Transform, viewRay} from '@engine';
import {Character, characterSystem, Walls} from '@kits/character';
import {region} from './region';

import {terrainEntities, chunkSystem, enterChunks, exitChunks, currentSurface} from './chunks';

const characters = new WeakMap<SceneContext['world'], ReturnType<typeof characterSystem>>();
const movement = defineSystem({
  id: 'terrain-movement',
  run(ctx, dt) {
    characters.get(ctx.world)?.run(ctx, dt);
  },
});
function enter(ctx: SceneContext) {
  enterChunks(ctx);
  characters.set(
    ctx.world,
    characterSystem({
      relative: 'world',
      ground: (x, z) => currentSurface(ctx).sample(x, z),
      groundOffset: 0.7,
      pointerTarget: context => {
        const ray = viewRay(context.view, context.input.pointer);
        return currentSurface(context).raycast(
          {x: ray.origin[0], y: ray.origin[1], z: ray.origin[2]},
          {x: ray.dir[0], y: ray.dir[1], z: ray.dir[2]},
        );
      },
    }),
  );
}
export default defineScene({
  id: 'yard',
  title: 'Terrain yard',
  type: 'area',
  view: {camera: {position: [0, 14, 18], target: [0, 0, 0], fov: 50, minWidthFov: 65}, background: 0x9cc7e4},
  entities: [
    ...terrainEntities,
    [Walls({minX: -11.5, maxX: 11.5, minZ: -11.5, maxZ: 11.5})],
    [
      Name({name: 'player'}),
      Transform({x: 0, y: region.sample(0, 4)!.height + 0.7, z: 4}),
      Shape({kind: 'capsule', size: [0.6, 1.4, 0.6], color: 0xf2c14e}),
      Character(),
    ],
    [
      Name({name: 'pad-marker'}),
      Transform({x: 3, y: region.sample(3, 4)!.height + 0.2, z: 4}),
      Shape({kind: 'box', size: [0.8, 0.4, 0.8], color: 0x86d7df}),
    ],
  ],
  enter,
  exit: ctx => {
    characters.delete(ctx.world);
    exitChunks(ctx);
  },
  systems: [chunkSystem, movement],
});
