import {defineScene, defineSystem, Model, Name, Shape, Transform} from '@engine';
const inspect = defineSystem({
  id: 'inspect-export',
  run(ctx) {
    const entity = ctx.named('block')!;
    ctx.state.modelStatus = ctx.modelState(entity).status;
    if (ctx.input.pressed('turn')) {
      ctx.world.get(entity, Transform)!.ry += Math.PI / 2;
      ctx.state.turns = Number(ctx.state.turns) + 1;
      ctx.world.touch();
    }
    ctx.state.rotation = ctx.world.get(entity, Transform)!.ry;
  },
});
export default defineScene({
  id: 'main',
  title: 'Metre block',
  view: {camera: {position: [3, 2.5, 4], target: [0, 0.5, 0]}, background: 0x141a24},
  entities: [
    [Name({name: 'block'}), Transform(), Model({asset: 'metre-block'})],
    [Name({name: 'floor'}), Transform(), Shape({kind: 'plane', size: [4, 0, 4], color: 0x2a3342})],
  ],
  systems: [inspect],
  enter(ctx) {
    ctx.state.turns = 0;
  },
});
